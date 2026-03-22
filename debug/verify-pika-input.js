const fs = require('fs');
const path = require('path');

const INPUT_SELECTOR = 'textarea#promptText';

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

async function waitForLoad(client, sessionId, timeoutMs = 15000) {
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
  const query = process.env.PIKA_QUERY || 'A cinematic red balloon floating into the sky';
  const client = createClient(readWsEndpoint());
  await client.opened;

  const { targetId } = await client.send('Target.createTarget', { url: 'https://pika.art/' });
  const { sessionId } = await client.send('Target.attachToTarget', {
    targetId,
    flatten: true
  });

  try {
    await client.send('Page.enable', {}, sessionId);
    await client.send('Runtime.enable', {}, sessionId);
    await waitForLoad(client, sessionId, 15000);
    await sleep(4000);

    const result = await evaluate(
      client,
      sessionId,
      `(() => {
        const input = document.querySelector(${JSON.stringify(INPUT_SELECTOR)});
        if (!input) {
          return { ok: false, reason: 'input-not-found' };
        }
        input.focus();
        input.value = ${JSON.stringify(query)};
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
          placeholder: input.getAttribute('placeholder') || '',
          value: input.value || '',
          url: location.href
        };
      })()`
    );

    console.log(JSON.stringify({
      query,
      result,
      success: result && result.ok === true && result.value === query
    }, null, 2));
  } finally {
    client.send('Target.closeTarget', { targetId }).catch(() => {});
    client.ws.close();
  }
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
