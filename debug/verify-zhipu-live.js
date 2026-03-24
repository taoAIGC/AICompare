#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const SITE_NAME = '智谱';
const TARGET_URL = process.env.ZHIPU_URL || 'https://chatglm.cn/chat';
const TEST_QUERY = process.env.TEST_QUERY || '';
const WAIT_AFTER_EXEC_MS = Number(process.env.WAIT_AFTER_EXEC_MS || 7000);
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

async function snapshot(client, sessionId) {
  return evaluate(
    client,
    sessionId,
    `(() => {
      const queryAll = (selector) => Array.from(document.querySelectorAll(selector));
      const text = (node) => String(node?.innerText || node?.textContent || '').replace(/\\s+/g, ' ').trim();
      const summarize = (el) => {
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName,
          type: el.getAttribute('type'),
          id: el.id || null,
          role: el.getAttribute('role'),
          placeholder: el.getAttribute('placeholder'),
          ariaLabel: el.getAttribute('aria-label'),
          className: String(el.className || '').slice(0, 240),
          text: text(el).slice(0, 160),
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

      const candidates = queryAll('textarea, input, button, [contenteditable="true"], [role="textbox"]')
        .filter((el) => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        })
        .slice(0, 200)
        .map(summarize);

      return {
        url: location.href,
        title: document.title,
        bodyText: text(document.body).slice(0, 2400),
        candidates,
        sendArea: summarize(document.querySelector('.enter')),
        sendButton: summarize(document.querySelector('.enter-icon-container')),
        textarea: summarize(document.querySelector('textarea')),
        userPromptCandidates: queryAll('div, p, span')
          .filter((node) => {
            const value = text(node);
            if (!value) return false;
            if (!value.includes('你好世界')) return false;
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          })
          .slice(0, 20)
          .map(summarize),
        assistantCandidates: queryAll('div, p, span, article, section')
          .filter((node) => {
            const value = text(node);
            if (!value) return false;
            const rect = node.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return false;
            return (
              value.includes('ChatGLM') ||
              value.includes('我是GLM') ||
              value.includes('停止对话')
            );
          })
          .slice(0, 30)
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

async function inspectContentExtractor(client, sessionId, site) {
  const extractor = site?.contentExtractor || {};
  return evaluate(
    client,
    sessionId,
    `(() => {
      const extractor = ${JSON.stringify(extractor)};
      const text = (node) => String(node?.innerText || node?.textContent || '').replace(/\\s+/g, ' ').trim();
      const summarize = (el) => {
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName,
          className: String(el.className || '').slice(0, 240),
          id: el.id || null,
          text: text(el).slice(0, 220),
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
        ? Array.from(root.querySelectorAll(extractor.messageContainer)).slice(-3).map(summarize)
        : [];

      const contentHits = Array.isArray(extractor.contentSelectors)
        ? extractor.contentSelectors.map((selector) => {
            const nodes = root ? Array.from(root.querySelectorAll(selector)) : [];
            return {
              selector,
              count: nodes.length,
              samples: nodes.slice(0, 3).map(summarize)
            };
          })
        : [];

      return {
        root: root ? summarize(root) : null,
        messageNodes,
        contentHits
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
    return { action: 'wait', duration: Number(step.duration) || 0 };
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
      const keys = ${JSON.stringify(step.keys || '')};

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

      if (${JSON.stringify(step.action)} === 'focus') {
        element.focus();
      } else if (${JSON.stringify(step.action)} === 'setValue') {
        element.focus();
        element.value = query;
      } else if (${JSON.stringify(step.action)} === 'triggerEvents') {
        for (const eventName of events) {
          if (eventName === 'input') {
            element.dispatchEvent(new InputEvent('input', {
              bubbles: true,
              cancelable: true,
              inputType: 'insertText',
              data: query
            }));
          } else {
            element.dispatchEvent(new Event(eventName, { bubbles: true, cancelable: true }));
          }
        }
      } else if (${JSON.stringify(step.action)} === 'sendKeys') {
        if (keys === 'Enter') {
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
        } else {
          return { ok: false, reason: 'unsupported_keys', keys };
        }
      } else {
        return { ok: false, reason: 'unsupported_action', action: ${JSON.stringify(step.action)} };
      }

      return {
        ok: true,
        action: ${JSON.stringify(step.action)},
        selector: foundSelector,
        activeTag: document.activeElement ? document.activeElement.tagName : null,
        value: typeof element.value === 'string' ? element.value : null,
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
    if (!result?.ok && step.action !== 'wait') {
      throw new Error(`Failed step ${step.action}: ${JSON.stringify(result)}`);
    }
  }
  return results;
}

async function main() {
  const site = getSiteConfig();
  const endpoint = readChromeEndpoint();
  const client = new CDPClient(endpoint);
  await client.connect();

  let targetId = null;

  try {
    const page = await createPage(client, TARGET_URL);
    targetId = page.targetId;
    await waitForReady(client, page.sessionId);
    await sleep(7000);

    const before = await snapshot(client, page.sessionId);
    const payload = {
      siteName: SITE_NAME,
      targetUrl: TARGET_URL,
      configuredUrl: site.url,
      query: TEST_QUERY,
      before
    };

    if (TEST_QUERY) {
      payload.stepResults = await executeConfiguredHandler(client, page.sessionId, site, TEST_QUERY);
      await sleep(WAIT_AFTER_EXEC_MS);
      payload.afterExecute = await snapshot(client, page.sessionId);
      payload.extractorInspection = await inspectContentExtractor(client, page.sessionId, site);
    }

    console.log(JSON.stringify(payload, null, 2));
    if (targetId) {
      await client.send('Target.closeTarget', { targetId }).catch(() => {});
    }
    if (client.ws) {
      try {
        client.ws.close();
      } catch (_) {}
    }
    return;
  } finally {
    // Keep the debug script best-effort. The Chrome target is already closed above.
  }
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
