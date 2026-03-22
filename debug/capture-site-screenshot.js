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

async function waitForLoad(client, sessionId, timeoutMs = 12000) {
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
  const filePath = process.env.OUT_PATH;
  const clickText = process.env.CLICK_TEXT || '';

  if (!url) throw new Error('TARGET_URL is required');
  if (!filePath) throw new Error('OUT_PATH is required');

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
    await waitForLoad(client, sessionId, Number(process.env.TIMEOUT_MS || 12000));
    await sleep(Number(process.env.POST_LOAD_WAIT_MS || 3000));

    let clickResult = null;
    if (clickText) {
      clickResult = await evaluate(
        client,
        sessionId,
        `(() => {
          const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
          const candidates = Array.from(document.querySelectorAll('button, a, [role="button"]'))
            .filter((el) => normalize(el.innerText || el.textContent) === ${JSON.stringify(clickText)});
          const el = candidates[0] || null;
          if (!el) {
            return { clicked: false, reason: 'not-found', clickText: ${JSON.stringify(clickText)} };
          }
          el.click();
          return { clicked: true, text: normalize(el.innerText || el.textContent) };
        })()`
      );
      await waitForLoad(client, sessionId, Number(process.env.POST_CLICK_WAIT_MS || 12000));
      await sleep(Number(process.env.POST_CLICK_WAIT_MS || 3000));
    }

    const meta = await evaluate(
      client,
      sessionId,
      `(() => ({ title: document.title, url: location.href }))()`
    );

    const screenshot = await client.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true
    }, sessionId);

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, Buffer.from(screenshot.data, 'base64'));
    console.log(JSON.stringify({ filePath, clickResult, ...meta }, null, 2));
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
