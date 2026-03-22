const fs = require('fs');
const path = require('path');

const SOURCE_SELECTOR =
  'div[role="textbox"][contenteditable="true"][aria-labelledby="translation-source-heading"]';
const TARGET_SELECTOR =
  'div[role="textbox"][contenteditable="true"][aria-labelledby="translation-target-heading"]';

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
      if (msg.error) {
        reject(new Error(JSON.stringify(msg.error)));
      } else {
        resolve(msg.result);
      }
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
  const query = process.env.DEEPL_QUERY || '你好世界';
  const client = createClient(readWsEndpoint());
  await client.opened;

  const { targetId } = await client.send('Target.createTarget', {
    url: 'https://www.deepl.com/en/translator'
  });
  const { sessionId } = await client.send('Target.attachToTarget', {
    targetId,
    flatten: true
  });

  try {
    await client.send('Page.enable', {}, sessionId);
    await client.send('Runtime.enable', {}, sessionId);
    await waitForLoad(client, sessionId, 25000);
    await sleep(3000);

    const start = await evaluate(
      client,
      sessionId,
      `(() => ({ title: document.title, url: location.href }))()`
    );

    const injected = await evaluate(
      client,
      sessionId,
      `(() => {
        const input = document.querySelector(${JSON.stringify(SOURCE_SELECTOR)});
        if (!input) {
          return { ok: false, reason: 'input-not-found' };
        }
        input.focus();
        input.textContent = ${JSON.stringify(query)};
        input.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: ${JSON.stringify(query)}
        }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('blur', { bubbles: true }));
        input.dispatchEvent(new Event('focus', { bubbles: true }));
        return {
          ok: true,
          inputText: input.innerText || '',
          inputHTML: input.innerHTML || ''
        };
      })()`
    );

    let finalState = null;
    for (let i = 0; i < 25; i++) {
      await sleep(1000);
      finalState = await evaluate(
        client,
        sessionId,
        `(() => ({
          inputText: document.querySelector(${JSON.stringify(SOURCE_SELECTOR)})?.innerText || '',
          outputText: document.querySelector(${JSON.stringify(TARGET_SELECTOR)})?.innerText || '',
          outputHTML: document.querySelector(${JSON.stringify(TARGET_SELECTOR)})?.innerHTML || '',
          extractedText: (document.querySelector(${JSON.stringify(TARGET_SELECTOR)})?.textContent || '').trim()
        }))()`
      );
      if ((finalState.outputText || '').trim()) {
        break;
      }
    }

    console.log(JSON.stringify({
      start,
      query,
      injected,
      finalState,
      success: /hello(?:,\s*|\s+)world/i.test(finalState?.outputText || '')
    }, null, 2));
  } finally {
    await client.send('Target.closeTarget', { targetId }).catch(() => {});
    client.ws.close();
  }
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
