#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const SITE_NAME = '秘塔';
const TARGET_URL = process.env.METASO_URL || 'https://metaso.cn/';
const TEST_QUERY = process.env.TEST_QUERY || '你好世界';
const SECOND_QUERY = process.env.SECOND_QUERY || `${TEST_QUERY} 第二次`;
const WAIT_AFTER_EXEC_MS = Number(process.env.WAIT_AFTER_EXEC_MS || 5000);
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
            const rect = element.getBoundingClientRect();
            return {
              found: true,
              selector,
              tag: element.tagName,
              className: String(element.className || '').slice(0, 240),
              value: typeof element.value === 'string' ? element.value : null,
              text: String(element.innerText || element.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 200),
              visible: rect.width > 0 && rect.height > 0
            };
          }
        }
        return { found: false };
      })()`
    );
    if (result?.found) return result;
    await sleep(retryInterval);
  }
  throw new Error(`Element not found: ${selectors.join(', ')}`);
}

async function snapshot(client, sessionId) {
  return evaluate(
    client,
    sessionId,
    `(() => {
      const text = (node) => String(node?.innerText || node?.textContent || '').replace(/\\s+/g, ' ').trim();
      const summarize = (el) => {
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName,
          className: String(el.className || '').slice(0, 240),
          value: typeof el.value === 'string' ? el.value : null,
          placeholder: el.getAttribute('placeholder'),
          text: text(el).slice(0, 300),
          visible: rect.width > 0 && rect.height > 0,
          disabled: !!el.disabled
        };
      };
      const selectors = [
        '.search-consult-textarea',
        'textarea',
        'button[type="submit"]',
        'button',
        'div.MuiBox-root.css-qtri4c'
      ];
      return {
        url: location.href,
        title: document.title,
        bodyText: text(document.body).slice(0, 1600),
        textarea: summarize(document.querySelector('.search-consult-textarea')),
        submitButton: summarize(
          Array.from(document.querySelectorAll('button')).find((el) => {
            const label = text(el);
            return label.includes('发送') || label.includes('提问') || label.includes('搜索') || label.includes('submit');
          })
        ),
        selectorHits: selectors.map((selector) => ({
          selector,
          count: document.querySelectorAll(selector).length
        })),
        queryMarkers: Array.from(document.querySelectorAll('div, span, p'))
          .map((el) => text(el))
          .filter((value) => value && (value.includes(${JSON.stringify(TEST_QUERY)}) || value.includes(${JSON.stringify(SECOND_QUERY)})))
          .slice(0, 20)
      };
    })()`
  );
}

async function executeStep(client, sessionId, step, query) {
  if (step.action === 'wait') {
    await sleep(Number(step.duration) || 0);
    return { ok: true, action: 'wait', duration: Number(step.duration) || 0 };
  }

  const maxAttempts = step.maxAttempts || (step.waitForElement ? 5 : 1);
  const retryInterval = step.retryInterval || 200;
  const selectors = Array.isArray(step.selector) ? step.selector : [step.selector];
  const located = await waitForSelector(client, sessionId, selectors, maxAttempts, retryInterval);

  const result = await evaluate(
    client,
    sessionId,
    `(() => {
      const selectors = ${JSON.stringify(selectors)};
      const query = ${JSON.stringify(query)};
      const events = ${JSON.stringify(step.events || [])};
      const keys = ${JSON.stringify(step.keys || '')};
      const action = ${JSON.stringify(step.action)};

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

      const readValue = () => (
        typeof element.value === 'string'
          ? element.value
          : String(element.innerText || element.textContent || '')
      );

      if (action === 'focus') {
        element.focus();
      } else if (action === 'setValue') {
        element.focus();
        if (typeof element.value === 'string') {
          element.value = query;
        } else if (element.isContentEditable) {
          element.textContent = query;
        }
      } else if (action === 'triggerEvents') {
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
      } else if (action === 'sendKeys') {
        element.focus();
        if (keys !== 'Enter') {
          return { ok: false, reason: 'unsupported_keys', keys };
        }
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
        valueAfter: readValue(),
        url: location.href
      };
    })()`
  );

  return {
    step,
    located,
    result
  };
}

async function executeConfiguredHandler(client, sessionId, site, query) {
  const steps = site?.searchHandler?.steps || [];
  const results = [];
  for (const step of steps) {
    const outcome = await executeStep(client, sessionId, step, query);
    results.push(outcome);
    if (!outcome?.result?.ok) {
      throw new Error(`Failed step ${step.action}: ${JSON.stringify(outcome)}`);
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
    await sleep(6000);

    const payload = {
      siteName: SITE_NAME,
      targetUrl: TARGET_URL,
      queries: [TEST_QUERY, SECOND_QUERY],
      initial: await snapshot(client, page.sessionId)
    };

    payload.firstRun = {
      steps: await executeConfiguredHandler(client, page.sessionId, site, TEST_QUERY)
    };
    await sleep(WAIT_AFTER_EXEC_MS);
    payload.afterFirstRun = await snapshot(client, page.sessionId);

    payload.secondRun = {
      steps: await executeConfiguredHandler(client, page.sessionId, site, SECOND_QUERY)
    };
    await sleep(WAIT_AFTER_EXEC_MS);
    payload.afterSecondRun = await snapshot(client, page.sessionId);

    console.log(JSON.stringify(payload, null, 2));
  } finally {
    if (targetId) {
      await client.send('Target.closeTarget', { targetId }).catch(() => {});
    }
    if (client.ws) {
      try {
        client.ws.close();
      } catch (_) {}
    }
  }
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
