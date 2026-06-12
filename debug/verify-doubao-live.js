#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  classifyExternalStatus,
  createUnifiedResult,
  printResultAndExit,
  trimPreview
} = require('./live-verifier-common');

const SITE_NAME = '豆包';
const TARGET_URL = process.env.DOUBAO_URL || 'https://doubao.com/chat';
const TEST_QUERY = process.env.TEST_QUERY || '你好世界';
const WAIT_AFTER_INPUT_MS = Number(process.env.WAIT_AFTER_INPUT_MS || 1500);
const WAIT_AFTER_CLICK_MS = Number(process.env.WAIT_AFTER_CLICK_MS || 12000);
const DEVTOOLS_ACTIVE_PORT =
  process.env.DEVTOOLS_ACTIVE_PORT ||
  path.join(process.env.HOME || '', 'Library/Application Support/Google/Chrome/DevToolsActivePort');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readChromeEndpoint() {
  const raw = fs.readFileSync(DEVTOOLS_ACTIVE_PORT, 'utf8').trim().split('\n');
  const port = raw[0];
  const browserPath = raw[1];
  if (!port || !browserPath) {
    throw new Error(`DevToolsActivePort is invalid: ${DEVTOOLS_ACTIVE_PORT}`);
  }
  return `ws://127.0.0.1:${port}${browserPath}`;
}

class CDPClient {
  constructor(endpoint) {
    this.endpoint = endpoint;
    this.ws = null;
    this.id = 0;
    this.pending = new Map();
  }

  async connect() {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(this.endpoint);
      this.ws = ws;

      ws.addEventListener('open', () => resolve());
      ws.addEventListener('error', (error) => reject(error));
      ws.addEventListener('message', (event) => {
        const msg = JSON.parse(String(event.data));
        if (msg.id && this.pending.has(msg.id)) {
          const pending = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) {
            pending.reject(new Error(JSON.stringify(msg.error)));
          } else {
            pending.resolve(msg.result);
          }
        }
      });
      ws.addEventListener('close', () => {
        for (const pending of this.pending.values()) {
          pending.reject(new Error('CDP connection closed'));
        }
        this.pending.clear();
      });
    });
  }

  send(method, params = {}, sessionId = undefined) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pending.set(id, { resolve, reject });
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      this.ws.send(JSON.stringify(payload));
    });
  }

  async close() {
    if (!this.ws) return;
    await new Promise((resolve) => {
      this.ws.addEventListener('close', () => resolve(), { once: true });
      this.ws.close();
    }).catch(() => {});
  }
}

async function createPage(client, url) {
  const { targetId } = await client.send('Target.createTarget', { url });
  await sleep(1200);
  const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });
  await client.send('Page.enable', {}, sessionId);
  await client.send('Runtime.enable', {}, sessionId);
  return { targetId, sessionId };
}

async function evaluate(client, sessionId, expression) {
  const result = await client.send(
    'Runtime.evaluate',
    {
      expression,
      returnByValue: true,
      awaitPromise: true
    },
    sessionId
  );
  return result?.result?.value;
}

async function waitForReady(client, sessionId, timeoutMs = 20000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const ready = await evaluate(
      client,
      sessionId,
      'document.readyState === "interactive" || document.readyState === "complete"'
    );
    if (ready) return;
    await sleep(300);
  }
  throw new Error('Timed out waiting for page ready state');
}

function getSiteConfig() {
  const configPath = path.join(__dirname, '..', 'config', 'siteHandlers.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const site = (config.sites || []).find((item) => item && item.name === SITE_NAME);
  if (!site) {
    throw new Error(`Site config not found: ${SITE_NAME}`);
  }
  return site;
}

function getPatchedSetValueExpression() {
  return `
    const setNativeValue = (el, value) => {
      if (!el || typeof value !== 'string') return;
      const prototype = el.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement?.prototype
        : window.HTMLInputElement?.prototype;
      const descriptor = prototype ? Object.getOwnPropertyDescriptor(prototype, 'value') : null;
      if (descriptor && typeof descriptor.set === 'function') {
        descriptor.set.call(el, value);
      } else {
        el.value = value;
      }
      if (typeof el.setSelectionRange === 'function') {
        try {
          el.setSelectionRange(value.length, value.length);
        } catch (_) {}
      }
    };
  `;
}

async function snapshot(client, sessionId, site, query = TEST_QUERY) {
  return evaluate(
    client,
    sessionId,
    `(() => {
      const query = ${JSON.stringify(query)};
      const site = ${JSON.stringify(site)};
      const text = (node) => String(node?.innerText || node?.textContent || '').replace(/\\s+/g, ' ').trim();
      const visible = (el) => {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const summarize = (el) => {
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName,
          id: el.id || null,
          role: el.getAttribute('role'),
          type: el.getAttribute('type'),
          placeholder: el.getAttribute('placeholder'),
          ariaLabel: el.getAttribute('aria-label'),
          dataTestId: el.getAttribute('data-testid'),
          dataPluginIdentifier: el.getAttribute('data-plugin-identifier'),
          contenteditable: el.getAttribute('contenteditable'),
          className: String(el.className || '').slice(0, 300),
          text: text(el).slice(0, 300),
          disabled: !!el.disabled,
          visible: visible(el),
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          }
        };
      };
      const summarizeWithAncestors = (el) => {
        const base = summarize(el);
        if (!base || !el) return base;
        const ancestors = [];
        let current = el;
        let depth = 0;
        while (current && depth < 5) {
          ancestors.push({
            tag: current.tagName,
            id: current.id || null,
            role: current.getAttribute('role'),
            ariaLabel: current.getAttribute('aria-label'),
            dataPluginIdentifier: current.getAttribute('data-plugin-identifier'),
            dataTestId: current.getAttribute('data-testid'),
            className: String(current.className || '').slice(0, 220),
            text: text(current).slice(0, 180)
          });
          current = current.parentElement;
          depth += 1;
        }
        return {
          ...base,
          ancestors
        };
      };
      const hitsForSelectors = (selectors) => (selectors || []).map((selector) => {
        try {
          const nodes = Array.from(document.querySelectorAll(selector));
          return {
            selector,
            count: nodes.length,
            visibleCount: nodes.filter((node) => visible(node)).length,
            samples: nodes.filter((node) => visible(node)).slice(0, 5).map(summarize)
          };
        } catch (error) {
          return {
            selector,
            error: String(error && error.message ? error.message : error)
          };
        }
      });

      const stepSelectors = Array.from(new Set(
        ((site.searchHandler && site.searchHandler.steps) || [])
          .flatMap((step) => Array.isArray(step.selector) ? step.selector : [step.selector])
          .filter(Boolean)
      ));
      const userPromptSelectors = Array.from(new Set(
        [site.userPrompt?.containerSelector, site.userPrompt?.textSelector].filter(Boolean)
      ));
      const extractorSelectors = Array.from(new Set(
        [
          site.contentExtractor?.containerSelector,
          site.contentExtractor?.messageContainer,
          ...((site.contentExtractor?.contentSelectors || [])),
          ...((site.contentExtractor?.fallbackSelectors || [])),
          ...((site.contentExtractor?.selectors || []))
        ].filter(Boolean)
      ));

      const candidates = Array.from(document.querySelectorAll('textarea, input, button, [contenteditable="true"], [role="textbox"], [data-testid], [aria-label], [placeholder]'))
        .filter((el) => visible(el))
        .slice(0, 200)
        .map(summarize);

      const composerTextarea = document.querySelector('textarea[placeholder="发消息..."]');
      const findComposerRoot = (el) => {
        let current = el ? el.parentElement : null;
        while (current) {
          if (current.querySelector('button')) return current;
          current = current.parentElement;
        }
        return el ? el.parentElement : null;
      };
      const composerRoot = findComposerRoot(composerTextarea);
      const composerButtons = composerRoot
        ? Array.from(composerRoot.querySelectorAll('button')).filter((el) => visible(el)).slice(0, 20).map(summarize)
        : [];
      const composerButtonSelectors = composerRoot
        ? Array.from(composerRoot.querySelectorAll('button'))
            .filter((el) => visible(el))
            .slice(0, 20)
            .map((el) => ({
              text: text(el).slice(0, 80),
              ariaLabel: el.getAttribute('aria-label'),
              className: String(el.className || '').slice(0, 200),
              id: el.id || null
            }))
        : [];
      const composerAncestors = [];
      {
        let current = composerTextarea;
        let depth = 0;
        while (current && depth < 6) {
          composerAncestors.push(summarize(current));
          current = current.parentElement;
          depth += 1;
        }
      }

      const queryHits = Array.from(document.querySelectorAll('div, p, span, article, section'))
        .filter((el) => {
          const value = text(el);
          return visible(el) && value && value.includes(query);
        })
        .slice(0, 30)
        .map(summarize);
      const exactQueryNodes = Array.from(document.querySelectorAll('div, p, span, article, section'))
        .filter((el) => {
          const value = text(el);
          return visible(el) && value === query;
        })
        .slice(0, 10)
        .map(summarizeWithAncestors);
      const replyNodes = Array.from(document.querySelectorAll('div, p, span, article, section'))
        .filter((el) => {
          const value = text(el);
          return visible(el) && value && value.includes(query) && value.length > query.length + 3;
        })
        .slice(0, 10)
        .map(summarizeWithAncestors);

      return {
        url: location.href,
        title: document.title,
        bodyText: text(document.body).slice(0, 3000),
        currentInputValue: (() => {
          const active = document.activeElement;
          if (!active) return null;
          return typeof active.value === 'string' ? active.value : text(active);
        })(),
        configSelectorHits: hitsForSelectors(stepSelectors),
        userPromptHits: hitsForSelectors(userPromptSelectors),
        extractorHits: hitsForSelectors(extractorSelectors),
        candidates,
        composerTextarea: summarize(composerTextarea),
        composerRoot: summarize(composerRoot),
        composerRootHtml: composerRoot ? String(composerRoot.outerHTML || '').slice(0, 2500) : null,
        composerAncestors,
        composerButtons,
        composerButtonSelectors,
        queryHits,
        exactQueryNodes,
        replyNodes,
        oldInput: summarize(document.querySelector('textarea[data-testid="chat_input_input"]')),
        oldSendButton: summarize(document.querySelector('#flow-end-msg-send'))
      };
    })()`
  );
}

async function executeCurrentHandler(client, sessionId, site, query) {
  const steps = site?.searchHandler?.steps || [];
  const stepResults = [];

  for (const step of steps) {
    if (step.action === 'wait') {
      await sleep(Number(step.duration) || 0);
      stepResults.push({
        ok: true,
        action: 'wait',
        description: step.description || '',
        duration: Number(step.duration) || 0
      });
      continue;
    }

    const selectors = Array.isArray(step.selector) ? step.selector : [step.selector];
    const result = await evaluate(
      client,
      sessionId,
      `(() => {
        const selectors = ${JSON.stringify(selectors)};
        const step = ${JSON.stringify(step)};
        const query = ${JSON.stringify(query)};
        const text = (node) => String(node?.innerText || node?.textContent || '').replace(/\\s+/g, ' ').trim();
        ${getPatchedSetValueExpression()}

        let element = null;
        let foundSelector = null;
        for (const selector of selectors) {
          if (!selector) continue;
          element = document.querySelector(selector);
          if (element) {
            foundSelector = selector;
            break;
          }
        }

        if (!element) {
          return {
            ok: false,
            action: step.action,
            description: step.description || '',
            selectors,
            reason: 'element_not_found'
          };
        }

        const readState = () => ({
          selector: foundSelector,
          tag: element.tagName,
          role: element.getAttribute('role'),
          ariaLabel: element.getAttribute('aria-label'),
          dataTestId: element.getAttribute('data-testid'),
          placeholder: element.getAttribute('placeholder'),
          className: String(element.className || '').slice(0, 240),
          disabled: !!element.disabled,
          value: typeof element.value === 'string' ? element.value : null,
          text: text(element).slice(0, 240),
          html: String(element.innerHTML || '').slice(0, 300)
        });

        if (step.action === 'focus') {
          element.focus();
          return { ok: true, action: step.action, description: step.description || '', state: readState() };
        }

        if (step.action === 'setValue') {
          element.focus();
          if (step.inputType === 'contenteditable') {
            element.textContent = query;
          } else {
            setNativeValue(element, query);
            element.dispatchEvent(new InputEvent('beforeinput', {
              bubbles: true,
              cancelable: true,
              inputType: 'insertText',
              data: query
            }));
            element.dispatchEvent(new InputEvent('input', {
              bubbles: true,
              cancelable: true,
              inputType: 'insertText',
              data: query
            }));
          }
          return { ok: true, action: step.action, description: step.description || '', state: readState() };
        }

        if (step.action === 'triggerEvents') {
          for (const eventName of step.events || []) {
            if (eventName === 'input') {
              element.dispatchEvent(new InputEvent('input', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertText',
                data: query
              }));
            } else if (eventName === 'beforeinput') {
              element.dispatchEvent(new InputEvent('beforeinput', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertText',
                data: query
              }));
            } else if (eventName === 'keydown' || eventName === 'keyup' || eventName === 'keypress') {
              element.dispatchEvent(new KeyboardEvent(eventName, {
                bubbles: true,
                cancelable: true,
                key: 'Enter',
                code: 'Enter',
                keyCode: 13,
                which: 13
              }));
            } else {
              element.dispatchEvent(new Event(eventName, {
                bubbles: true,
                cancelable: true
              }));
            }
          }
          return { ok: true, action: step.action, description: step.description || '', state: readState() };
        }

        if (step.action === 'click') {
          element.click();
          return { ok: true, action: step.action, description: step.description || '', state: readState() };
        }

        if (step.action === 'sendKeys') {
          element.focus();
          const opts = {
            bubbles: true,
            cancelable: true,
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13
          };
          element.dispatchEvent(new KeyboardEvent('keydown', opts));
          element.dispatchEvent(new KeyboardEvent('keypress', opts));
          element.dispatchEvent(new KeyboardEvent('keyup', opts));
          return { ok: true, action: step.action, description: step.description || '', state: readState() };
        }

        return {
          ok: false,
          action: step.action,
          description: step.description || '',
          reason: 'unsupported_action'
        };
      })()`
    );

    stepResults.push(result);
    if (!result?.ok) break;

    if (step.action !== 'focus') {
      await sleep(300);
    }
  }

  return stepResults;
}

async function runAlternateProbe(client, sessionId, query) {
  const result = await evaluate(
    client,
    sessionId,
    `(() => {
      const query = ${JSON.stringify(query)};
      const text = (node) => String(node?.innerText || node?.textContent || '').replace(/\\s+/g, ' ').trim();
      const visible = (el) => {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const summarize = (el) => {
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName,
          id: el.id || null,
          role: el.getAttribute('role'),
          type: el.getAttribute('type'),
          placeholder: el.getAttribute('placeholder'),
          ariaLabel: el.getAttribute('aria-label'),
          dataTestId: el.getAttribute('data-testid'),
          className: String(el.className || '').slice(0, 300),
          text: text(el).slice(0, 300),
          disabled: !!el.disabled,
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          }
        };
      };

      const textarea = document.querySelector('textarea[placeholder="发消息..."]');
      if (!textarea) {
        return { ok: false, reason: 'textarea_not_found' };
      }

      textarea.focus();
      textarea.value = query;
      textarea.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: query
      }));
      textarea.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      textarea.dispatchEvent(new Event('blur', { bubbles: true, cancelable: true }));
      textarea.dispatchEvent(new Event('focus', { bubbles: true, cancelable: true }));

      let current = textarea.parentElement;
      let composerRoot = null;
      while (current) {
        if (current.querySelector('button')) {
          composerRoot = current;
          break;
        }
        current = current.parentElement;
      }

      const allVisibleButtons = Array.from(document.querySelectorAll('button'))
        .filter((el) => visible(el))
        .slice(0, 80)
        .map(summarize);

      return {
        ok: true,
        textarea: summarize(textarea),
        composerRoot: summarize(composerRoot),
        composerRootHtml: composerRoot ? String(composerRoot.outerHTML || '').slice(0, 3000) : null,
        composerButtons: composerRoot
          ? Array.from(composerRoot.querySelectorAll('button')).filter((el) => visible(el)).slice(0, 20).map(summarize)
          : [],
        allVisibleButtons
      };
    })()`
  );

  await sleep(800);
  return result;
}

async function runEnterProbe(client, sessionId, query) {
  const trigger = await evaluate(
    client,
    sessionId,
    `(() => {
      const query = ${JSON.stringify(query)};
      const text = (node) => String(node?.innerText || node?.textContent || '').replace(/\\s+/g, ' ').trim();
      const textarea = document.querySelector('textarea[placeholder="发消息..."]');
      if (!textarea) {
        return { ok: false, reason: 'textarea_not_found' };
      }

      textarea.focus();
      if (typeof textarea.value !== 'string' || textarea.value !== query) {
        textarea.value = query;
        textarea.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: query
        }));
        textarea.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      }

      const keyboardEventInit = {
        bubbles: true,
        cancelable: true,
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13
      };
      textarea.dispatchEvent(new KeyboardEvent('keydown', keyboardEventInit));
      textarea.dispatchEvent(new KeyboardEvent('keypress', keyboardEventInit));
      textarea.dispatchEvent(new KeyboardEvent('keyup', keyboardEventInit));

      return {
        ok: true,
        activeTag: document.activeElement ? document.activeElement.tagName : null,
        textareaValue: textarea.value,
        textareaText: text(textarea)
      };
    })()`
  );

  await sleep(8000);
  return trigger;
}

async function main() {
  const endpoint = readChromeEndpoint();
  const client = new CDPClient(endpoint);
  await client.connect();

  const site = getSiteConfig();
  let targetId = null;

  try {
    const page = await createPage(client, TARGET_URL);
    targetId = page.targetId;
    await waitForReady(client, page.sessionId);
    await sleep(10000);

    const before = await snapshot(client, page.sessionId, site);
    const stepResults = await executeCurrentHandler(client, page.sessionId, site, TEST_QUERY);
    const alternateProbe = await runAlternateProbe(client, page.sessionId, TEST_QUERY);
    const enterProbe = await runEnterProbe(client, page.sessionId, TEST_QUERY);
    await sleep(WAIT_AFTER_INPUT_MS);
    const afterInput = await snapshot(client, page.sessionId, site);
    await sleep(WAIT_AFTER_CLICK_MS);
    const afterWait = await snapshot(client, page.sessionId, site);
    const summary = {
      historyUrlChanged: before.url !== afterWait.url,
      oldInputFoundBefore: !!before.oldInput,
      oldSendFoundBefore: !!before.oldSendButton,
      userMessageRecorded: afterWait.queryHits.some((item) => (item?.text || '').includes(TEST_QUERY)),
      assistantSignalDetected: afterWait.extractorHits.some((item) => (item?.visibleCount || 0) > 0),
      finalUrl: afterWait.url,
      finalTitle: afterWait.title
    };

    const payload = {
      siteName: SITE_NAME,
      targetUrl: TARGET_URL,
      testQuery: TEST_QUERY,
      searchHandler: site.searchHandler,
      userPrompt: site.userPrompt,
      contentExtractor: site.contentExtractor,
      summary,
      before,
      stepResults,
      alternateProbe,
      enterProbe,
      afterInput,
      afterWait
    };

    const externalStatus = classifyExternalStatus(String(afterWait.bodyText || ''));
    const finalUrl = String(summary.finalUrl || afterWait.url || TARGET_URL);
    const looksLikeChatUrl = /\/chat\/[^/?#]+/i.test(finalUrl);
    const flowTriggered = summary.historyUrlChanged || summary.userMessageRecorded || looksLikeChatUrl;
    const status = externalStatus || (flowTriggered ? 'ok' : 'not_submitted');
    const contentPreview = trimPreview(
      afterWait.replyNodes?.[0]?.text
      || afterWait.extractorHits?.flatMap((item) => item.samples || []).map((sample) => sample?.text).find(Boolean)
      || afterWait.bodyText
    );
    const unified = createUnifiedResult({
      siteName: SITE_NAME,
      mode: 'live_direct',
      ok: status === 'ok',
      status,
      query: TEST_QUERY,
      pageUrl: TARGET_URL,
      runtimeUrl: finalUrl,
      contentPreview,
      evidence: payload
    });

    printResultAndExit(unified);
  } finally {
    if (targetId) {
      await client.send('Target.closeTarget', { targetId }).catch(() => {});
    }
    await client.close();
  }
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
