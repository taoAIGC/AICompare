const fs = require('fs');
const path = require('path');

function readWsEndpoint() {
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
    for (const fn of listeners) fn(msg);
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const result = await client.send(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true },
    sessionId
  );
  return result.result ? result.result.value : undefined;
}

async function run() {
  const url = process.env.TARGET_URL;
  if (!url) {
    throw new Error('TARGET_URL is required');
  }

  const clickText = process.env.CLICK_TEXT || '';
  const clickSelector = process.env.CLICK_SELECTOR || '';
  const client = createClient(readWsEndpoint());
  await client.opened;

  const { targetId } = await client.send('Target.createTarget', { url });
  const { sessionId } = await client.send('Target.attachToTarget', {
    targetId,
    flatten: true
  });

  try {
    await client.send('Page.enable', {}, sessionId);
    await client.send('Runtime.enable', {}, sessionId);
    await waitForLoad(client, sessionId, Number(process.env.TIMEOUT_MS || 20000));
    await sleep(Number(process.env.POST_LOAD_WAIT_MS || 2500));

    let clickResult = null;
    if (clickText || clickSelector) {
      clickResult = await evaluate(
        client,
        sessionId,
        `(() => {
          const clickText = ${JSON.stringify(clickText)};
          const clickSelector = ${JSON.stringify(clickSelector)};
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

          const el = candidates[0] || null;
          if (!el) {
            return { clicked: false, reason: 'not-found', clickText, clickSelector };
          }

          el.click();
          return {
            clicked: true,
            tag: el.tagName.toLowerCase(),
            text: normalize(el.innerText || el.textContent),
            selector: clickSelector
          };
        })()`
      );

      if (clickResult && clickResult.clicked) {
        await waitForLoad(client, sessionId, Number(process.env.POST_CLICK_WAIT_MS || 12000));
        await sleep(Number(process.env.POST_CLICK_WAIT_MS || 2500));
      }
    }

    const result = await evaluate(
      client,
      sessionId,
      `(() => {
        const visible = (el) => {
          const s = getComputedStyle(el);
          if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
          const r = el.getBoundingClientRect();
          return r.width > 6 && r.height > 6;
        };

        const summarize = (el) => {
          const r = el.getBoundingClientRect();
          return {
            tag: el.tagName.toLowerCase(),
            id: el.id || '',
            className: typeof el.className === 'string' ? el.className : '',
            role: el.getAttribute('role') || '',
            type: el.getAttribute('type') || '',
            name: el.getAttribute('name') || '',
            placeholder: el.getAttribute('placeholder') || '',
            ariaLabel: el.getAttribute('aria-label') || '',
            ariaLabelledby: el.getAttribute('aria-labelledby') || '',
            contenteditable: el.getAttribute('contenteditable') || '',
            text: (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 160),
            rect: {
              x: Math.round(r.x),
              y: Math.round(r.y),
              w: Math.round(r.width),
              h: Math.round(r.height)
            },
            outerHTML: el.outerHTML.slice(0, 300)
          };
        };

        const collect = (selectors) => {
          const seen = new Set();
          const items = [];
          for (const selector of selectors) {
            for (const el of document.querySelectorAll(selector)) {
              if (!visible(el)) continue;
              const summary = summarize(el);
              const key = [
                summary.tag,
                summary.id,
                summary.className,
                summary.role,
                summary.text,
                summary.rect.x,
                summary.rect.y
              ].join('|');
              if (seen.has(key)) continue;
              seen.add(key);
              items.push(summary);
            }
          }
          items.sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
          return items;
        };

        const inputs = collect([
          'textarea',
          'input',
          '[contenteditable="true"]',
          '[role="textbox"]',
          '.ProseMirror'
        ]);

        const buttons = collect([
          'button',
          'a',
          '[role="button"]'
        ]);

        return {
          title: document.title,
          url: location.href,
          inputs: inputs.slice(0, 30),
          buttons: buttons.slice(0, 30)
        };
      })()`
    );

    result.clickResult = clickResult;
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } finally {
    client.send('Target.closeTarget', { targetId }).catch(() => {});
    client.ws.close();
  }
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
