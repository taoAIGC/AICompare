const fs = require('fs');
const path = require('path');

function readDevToolsEndpoint() {
  const portFile = path.join(
    process.env.HOME,
    'Library/Application Support/Google/Chrome/DevToolsActivePort'
  );
  const [port, browserPath] = fs.readFileSync(portFile, 'utf8').trim().split('\n');
  return `ws://127.0.0.1:${port}${browserPath}`;
}

function createClient(wsEndpoint) {
  const ws = new WebSocket(wsEndpoint);
  let id = 0;
  const pending = new Map();
  const listeners = new Set();

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(String(event.data));
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
      return;
    }
    for (const listener of listeners) listener(msg);
  });

  const opened = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true });
    ws.addEventListener('error', (event) => reject(event.error || new Error('WebSocket error')), { once: true });
  });

  return {
    ws,
    opened,
    onEvent(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    send(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        const msgId = ++id;
        pending.set(msgId, { resolve, reject });
        const payload = { id: msgId, method, params };
        if (sessionId) payload.sessionId = sessionId;
        ws.send(JSON.stringify(payload));
      });
    }
  };
}

async function waitForLoad(client, sessionId, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      off();
      resolve();
    }, timeoutMs);
    const off = client.onEvent((msg) => {
      if (msg.sessionId === sessionId && msg.method === 'Page.loadEventFired') {
        clearTimeout(timer);
        off();
        resolve();
      }
    });
  });
}

async function evaluate(client, sessionId, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    returnByValue: true
  }, sessionId);
  return result.result ? result.result.value : undefined;
}

function parseSelectors() {
  const raw = process.env.SELECTORS || '';
  return raw
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForClickTarget(client, sessionId, clickSelector, clickText, clickIndex, timeoutMs, pollMs) {
  const expression = `(() => {
    const clickSelector = ${JSON.stringify(clickSelector)};
    const clickText = ${JSON.stringify(clickText)};
    const clickIndex = ${JSON.stringify(clickIndex)};
    const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
    let candidates = [];

    if (clickSelector) {
      candidates = Array.from(document.querySelectorAll(clickSelector));
    } else {
      candidates = Array.from(document.querySelectorAll('button, a, [role="button"], [role="tab"]'));
    }

    if (clickText) {
      candidates = candidates.filter((el) => normalize(el.innerText || el.textContent) === clickText);
    }

    return {
      found: Boolean(candidates[clickIndex]),
      count: candidates.length
    };
  })()`;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await evaluate(client, sessionId, expression);
    if (result && result.found) {
      return true;
    }
    await sleep(pollMs);
  }

  return false;
}

async function performOptionalClick(client, sessionId) {
  const clickSelector = process.env.CLICK_SELECTOR || '';
  const clickText = process.env.CLICK_TEXT || '';
  const clickIndex = Number(process.env.CLICK_INDEX || 0);
  const clickTimeoutMs = Number(process.env.CLICK_TIMEOUT_MS || 15000);
  const clickPollMs = Number(process.env.CLICK_POLL_MS || 500);

  if (!clickSelector && !clickText) {
    return null;
  }

  await waitForClickTarget(
    client,
    sessionId,
    clickSelector,
    clickText,
    clickIndex,
    clickTimeoutMs,
    clickPollMs
  );

  const expression = `(() => {
    const clickSelector = ${JSON.stringify(clickSelector)};
    const clickText = ${JSON.stringify(clickText)};
    const clickIndex = ${JSON.stringify(clickIndex)};
    const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
    let candidates = [];

    if (clickSelector) {
      candidates = Array.from(document.querySelectorAll(clickSelector));
    } else {
      candidates = Array.from(document.querySelectorAll('button, a, [role="button"], [role="tab"]'));
    }

    if (clickText) {
      candidates = candidates.filter((el) => normalize(el.innerText || el.textContent) === clickText);
    }

    const el = candidates[clickIndex] || null;
    if (!el) {
      return {
        clicked: false,
        reason: 'not-found',
        clickSelector,
        clickText,
        clickIndex
      };
    }

    const rect = el.getBoundingClientRect();
    el.click();

    return {
      clicked: true,
      clickSelector,
      clickText,
      clickIndex,
      tag: el.tagName.toLowerCase(),
      text: normalize(el.innerText || el.textContent),
      ariaLabel: el.getAttribute('aria-label') || '',
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.width),
        h: Math.round(rect.height)
      }
    };
  })()`;

  const clickResult = await evaluate(client, sessionId, expression);
  if (clickResult && clickResult.clicked) {
    await waitForLoad(client, sessionId, Number(process.env.POST_CLICK_WAIT_MS || 12000));
  }
  return clickResult;
}

async function inspect(url, selectors) {
  const client = createClient(readDevToolsEndpoint());
  await client.opened;
  const { targetId } = await client.send('Target.createTarget', { url });
  const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });

  try {
    await client.send('Page.enable', {}, sessionId);
    await client.send('Runtime.enable', {}, sessionId);
    await waitForLoad(client, sessionId, Number(process.env.TIMEOUT_MS || 20000));
    const clickResult = await performOptionalClick(client, sessionId);

    const expression = `(() => {
      const selectors = ${JSON.stringify(selectors)};
      const visible = (el) => {
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
        const r = el.getBoundingClientRect();
        return r.width > 6 && r.height > 6;
      };
      const summarizeNode = (el) => {
        const r = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          id: el.id || '',
          className: typeof el.className === 'string' ? el.className : '',
          role: el.getAttribute('role') || '',
          type: el.getAttribute('type') || '',
          name: el.getAttribute('name') || '',
          ariaLabel: el.getAttribute('aria-label') || '',
          ariaLabelledby: el.getAttribute('aria-labelledby') || '',
          placeholder: el.getAttribute('placeholder') || '',
          contenteditable: el.getAttribute('contenteditable') || '',
          visible: visible(el),
          rect: {
            x: Math.round(r.x),
            y: Math.round(r.y),
            w: Math.round(r.width),
            h: Math.round(r.height)
          },
          text: (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 160),
          outerHTML: el.outerHTML.slice(0, 400)
        };
      };
      const selectorResults = selectors.map((selector) => ({
        selector,
        matches: Array.from(document.querySelectorAll(selector)).map(summarizeNode)
      }));
      const fallbackSelectors = [
        'textarea',
        'input',
        'button',
        '[contenteditable=\"true\"]',
        '[role=\"textbox\"]',
        '[aria-label]',
        '[aria-labelledby]',
        '.ProseMirror',
        '.tiptap'
      ];
      const seen = new Set();
      const interesting = [];
      for (const selector of fallbackSelectors) {
        for (const el of document.querySelectorAll(selector)) {
          const summary = summarizeNode(el);
          const key = [
            summary.tag,
            summary.id,
            summary.className,
            summary.role,
            summary.ariaLabel,
            summary.ariaLabelledby,
            summary.placeholder,
            summary.rect.x,
            summary.rect.y
          ].join('|');
          if (seen.has(key)) continue;
          seen.add(key);
          if (!summary.visible) continue;
          interesting.push(summary);
        }
      }
      interesting.sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
      return {
        title: document.title,
        url: location.href,
        selectorResults,
        interesting: interesting.slice(0, 80)
      };
    })()`;

    const result = await evaluate(client, sessionId, expression);
    result.clickResult = clickResult;
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await client.send('Target.closeTarget', { targetId }).catch(() => {});
    client.ws.close();
  }
}

const url = process.env.TARGET_URL;
if (!url) {
  console.error('TARGET_URL is required');
  process.exit(1);
}

inspect(url, parseSelectors()).catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
