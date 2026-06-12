#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  classifyExternalStatus,
  createUnifiedResult,
  printResultAndExit,
  trimPreview
} = require('./live-verifier-common');

const SITE_NAME = 'MiniMax';
const DEFAULT_URL = 'https://agent.minimax.io/';
const TEST_QUERY = process.env.TEST_QUERY || '你好世界';
const WAIT_AFTER_EXEC_MS = Number(process.env.WAIT_AFTER_EXEC_MS || 18000);
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

async function reattachToTarget(client, targetId) {
  const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });
  await client.send('Page.enable', {}, sessionId).catch(() => {});
  await client.send('Runtime.enable', {}, sessionId).catch(() => {});
  return sessionId;
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

async function snapshot(client, sessionId) {
  return evaluate(
    client,
    sessionId,
    `(() => {
      const queryAll = (selector) => Array.from(document.querySelectorAll(selector));
      const text = (node) => String(node?.innerText || node?.textContent || '').replace(/\\s+/g, ' ').trim();
      const summarize = (el) => {
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName,
          type: el.getAttribute('type'),
          id: el.id || null,
          role: el.getAttribute('role'),
          placeholder: el.getAttribute('placeholder'),
          ariaLabel: el.getAttribute('aria-label'),
          href: el.getAttribute('href'),
          className: String(el.className || '').slice(0, 240),
          text: text(el).slice(0, 200),
          disabled: !!el.disabled,
          contenteditable: el.getAttribute('contenteditable'),
          dataTestId: el.getAttribute('data-testid'),
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          }
        };
      };

      return {
        url: location.href,
        title: document.title,
        bodyText: text(document.body).slice(0, 3000),
        editor: summarize(document.querySelector('div.tiptap.ProseMirror.tiptap-editor')),
        sendIcon: summarize(document.querySelector('#input-send-icon')),
        sendIconChild: summarize(document.querySelector('#input-send-icon')?.firstElementChild),
        messageContainer: summarize(document.querySelector('#message-container')),
        studioPanel: summarize(document.querySelector('#mmx-studio')),
        candidates: queryAll('textarea, input, button, [contenteditable="true"], [role="textbox"], a')
          .filter((el) => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          })
          .slice(0, 200)
          .map(summarize),
        userMessageCandidates: queryAll('#message-container div.message.sent, #message-container div[class*="message"].sent')
          .filter((el) => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          })
          .slice(0, 20)
          .map(summarize),
        assistantMessageCandidates: queryAll('#message-container div.message:not(.sent)')
          .filter((el) => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          })
          .slice(0, 20)
          .map(summarize),
        processPanelHits: queryAll('div, section, article, span, p, button')
          .filter((node) => {
            const value = text(node);
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && value && (
              value.includes('当前进程') ||
              value.includes('结束') ||
              value.includes('控制权') ||
              value.includes('processor') ||
              value.includes('report writer')
            );
          })
          .slice(0, 20)
          .map(summarize),
        dialogTexts: queryAll('[role="dialog"], .dialog, .modal, .popup, .el-overlay, .el-dialog, .login')
          .map((node) => text(node))
          .filter(Boolean)
          .slice(0, 10)
      };
    })()`
  );
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

async function inspectUserPrompt(client, sessionId, site) {
  const userPrompt = site?.userPrompt || {};
  return evaluate(
    client,
    sessionId,
    `(() => {
      const config = ${JSON.stringify(userPrompt)};
      const text = (node) => String(node?.innerText || node?.textContent || '').replace(/\\s+/g, ' ').trim();
      const summarize = (el) => {
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName,
          className: String(el.className || '').slice(0, 240),
          text: text(el).slice(0, 240),
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          }
        };
      };

      const containers = config.containerSelector
        ? Array.from(document.querySelectorAll(config.containerSelector)).slice(0, 10).map(summarize)
        : [];
      const texts = config.textSelector
        ? Array.from(document.querySelectorAll(config.textSelector)).slice(0, 10).map(summarize)
        : [];

      return { containers, texts };
    })()`
  );
}

async function inspectContentExtractor(client, sessionId, site) {
  const extractor = site?.contentExtractor || {};
  return evaluate(
    client,
    sessionId,
    `(() => {
      const extractor = ${JSON.stringify(extractor)};
      const text = (node) => String(node?.innerText || node?.textContent || '').replace(/\\s+/g, ' ').trim();
      const summarize = (el) => {
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName,
          className: String(el.className || '').slice(0, 240),
          id: el.id || null,
          text: text(el).slice(0, 260),
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          }
        };
      };

      const root = extractor.containerSelector ? document.querySelector(extractor.containerSelector) : document;
      const messageNodes = extractor.messageContainer && root
        ? Array.from(root.querySelectorAll(extractor.messageContainer)).slice(-5).map(summarize)
        : [];

      const contentHits = Array.isArray(extractor.contentSelectors)
        ? extractor.contentSelectors.map((selector) => {
            const nodes = root ? Array.from(root.querySelectorAll(selector)) : [];
            return {
              selector,
              count: nodes.length,
              samples: nodes.slice(0, 5).map(summarize)
            };
          })
        : [];

      const fallbackHits = Array.isArray(extractor.fallbackSelectors)
        ? extractor.fallbackSelectors.map((selector) => {
            const nodes = root ? Array.from(root.querySelectorAll(selector)) : [];
            return {
              selector,
              count: nodes.length,
              samples: nodes.slice(0, 5).map(summarize)
            };
          })
        : [];

      return {
        root: root ? summarize(root) : null,
        messageNodes,
        contentHits,
        fallbackHits
      };
    })()`
  );
}

async function waitForSelector(client, sessionId, selector, maxAttempts = 1, retryInterval = 200) {
  const selectors = Array.isArray(selector) ? selector : [selector];
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const result = await evaluate(
      client,
      sessionId,
      `(() => {
        const selectors = ${JSON.stringify(selectors)};
        for (const selector of selectors) {
          const element = document.querySelector(selector);
          if (element) {
            return {
              found: true,
              selector,
              className: String(element.className || ''),
              tag: element.tagName
            };
          }
        }
        return { found: false };
      })()`
    );
    if (result?.found) {
      return result;
    }
    await sleep(retryInterval);
  }
  throw new Error(`Element not found: ${selectors.join(', ')}`);
}

async function executeStep(client, sessionId, step, query) {
  if (step.action === 'wait') {
    await sleep(Number(step.duration) || 0);
    return { ok: true, action: 'wait', duration: Number(step.duration) || 0 };
  }

  const maxAttempts = step.maxAttempts || (step.waitForElement ? 5 : 1);
  const retryInterval = step.retryInterval || 200;
  const selectors = Array.isArray(step.selector) ? step.selector : [step.selector];
  await waitForSelector(client, sessionId, selectors, maxAttempts, retryInterval);

  return evaluate(
    client,
    sessionId,
    `(() => {
      const selectors = ${JSON.stringify(selectors)};
      const query = ${JSON.stringify(query)};
      const events = ${JSON.stringify(step.events || [])};
      const action = ${JSON.stringify(step.action)};
      const inputType = ${JSON.stringify(step.inputType || '')};

      const text = (node) => String(node?.innerText || node?.textContent || '').replace(/\\s+/g, ' ').trim();
      let element = null;
      let foundSelector = null;
      for (const selector of selectors) {
        element = document.querySelector(selector);
        if (element) {
          foundSelector = selector;
          break;
        }
      }
      if (!element) {
        return { ok: false, reason: 'element_missing', selectors };
      }

      if (action === 'focus') {
        element.focus();
      } else if (action === 'setValue') {
        element.focus();
        if (inputType === 'contenteditable') {
          const p = element.querySelector('p') || (() => {
            const np = document.createElement('p');
            element.innerHTML = '';
            element.appendChild(np);
            return np;
          })();
          p.classList.remove('is-empty', 'is-editor-empty');
          p.innerText = query;
        } else {
          element.value = query;
        }
      } else if (action === 'triggerEvents') {
        for (const eventName of events) {
          if (eventName === 'input' || eventName === 'beforeinput') {
            element.dispatchEvent(new InputEvent(eventName, {
              bubbles: true,
              cancelable: true,
              inputType: 'insertText',
              data: query
            }));
          } else {
            element.dispatchEvent(new Event(eventName, { bubbles: true, cancelable: true }));
          }
        }
      } else if (action === 'click') {
        const ev = { bubbles: true, cancelable: true, composed: true };
        element.dispatchEvent(new MouseEvent('mousedown', ev));
        element.dispatchEvent(new MouseEvent('mouseup', ev));
        element.dispatchEvent(new MouseEvent('click', ev));
        if (typeof element.click === 'function') {
          element.click();
        }
      } else if (action === 'sendKeys') {
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
      } else {
        return { ok: false, reason: 'unsupported_action', action };
      }

      return {
        ok: true,
        action,
        selector: foundSelector,
        activeTag: document.activeElement ? document.activeElement.tagName : null,
        value: typeof element.value === 'string' ? element.value : null,
        text: text(element).slice(0, 200),
        className: String(element.className || '')
      };
    })()`
  );
}

async function executeConfiguredHandler(client, sessionId, site, query) {
  const steps = site?.searchHandler?.steps || [];
  const results = [];
  for (const step of steps) {
    const result = await executeStep(client, sessionId, step, query);
    results.push({
      action: step.action,
      description: step.description || '',
      result
    });
    if (!result?.ok) {
      throw new Error(`Failed step ${step.action}: ${JSON.stringify(result)}`);
    }
  }
  return results;
}

async function withSessionRetry(client, targetId, sessionId, work) {
  try {
    return {
      sessionId,
      value: await work(sessionId)
    };
  } catch (error) {
    const message = String(error && error.message ? error.message : error);
    if (!message.includes('Session with given id not found')) {
      throw error;
    }
    const nextSessionId = await reattachToTarget(client, targetId);
    return {
      sessionId: nextSessionId,
      value: await work(nextSessionId)
    };
  }
}

async function main() {
  const site = getSiteConfig();
  const targetUrl = process.env.MINIMAX_URL || site.url || DEFAULT_URL;
  const endpoint = readChromeEndpoint();
  const client = new CDPClient(endpoint);
  await client.connect();

  let targetId = null;

  try {
    const page = await createPage(client, targetUrl);
    targetId = page.targetId;
    await waitForReady(client, page.sessionId);
    await sleep(9000);

    const payload = {
      siteName: SITE_NAME,
      targetUrl,
      configuredUrl: site.url,
      query: TEST_QUERY,
      waitAfterExecMs: WAIT_AFTER_EXEC_MS,
      before: await snapshot(client, page.sessionId)
    };

    if (TEST_QUERY) {
      let activeSessionId = page.sessionId;
      payload.stepResults = await executeConfiguredHandler(client, activeSessionId, site, TEST_QUERY);
      await sleep(WAIT_AFTER_EXEC_MS);
      const afterSnapshot = await withSessionRetry(client, targetId, activeSessionId, (sessionId) =>
        snapshot(client, sessionId)
      );
      activeSessionId = afterSnapshot.sessionId;
      payload.afterExecute = afterSnapshot.value;

      const userPromptInspection = await withSessionRetry(client, targetId, activeSessionId, (sessionId) =>
        inspectUserPrompt(client, sessionId, site)
      );
      activeSessionId = userPromptInspection.sessionId;
      payload.userPromptInspection = userPromptInspection.value;

      const extractorInspection = await withSessionRetry(client, targetId, activeSessionId, (sessionId) =>
        inspectContentExtractor(client, sessionId, site)
      );
      payload.extractorInspection = extractorInspection.value;
    }

    const afterExecute = payload.afterExecute || {};
    const bodyText = String(afterExecute.bodyText || payload.before?.bodyText || '');
    const externalStatus = classifyExternalStatus(bodyText);
    const hasChatUrl = /\/chat\b/i.test(String(afterExecute.url || ''));
    const hasUserMessage = Array.isArray(afterExecute.userMessageCandidates) && afterExecute.userMessageCandidates.length > 0;
    const hasAssistantSignal = Array.isArray(afterExecute.assistantMessageCandidates) && afterExecute.assistantMessageCandidates.length > 0;
    const hasProcessSignal = Array.isArray(afterExecute.processPanelHits) && afterExecute.processPanelHits.length > 0;
    const status = externalStatus || ((hasChatUrl || hasUserMessage || hasAssistantSignal || hasProcessSignal) ? 'ok' : 'not_submitted');
    const contentPreview = trimPreview(
      afterExecute.assistantMessageCandidates?.[0]?.text
      || afterExecute.processPanelHits?.[0]?.text
      || bodyText
    );
    const unified = createUnifiedResult({
      siteName: SITE_NAME,
      mode: 'live_direct',
      ok: status === 'ok',
      status,
      query: TEST_QUERY,
      pageUrl: targetUrl,
      runtimeUrl: String(afterExecute.url || targetUrl),
      contentPreview,
      evidence: payload
    });

    if (targetId) {
      await client.send('Target.closeTarget', { targetId }).catch(() => {});
    }
    await client.close();
    printResultAndExit(unified);
  } finally {
    // best effort debug script
  }
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
