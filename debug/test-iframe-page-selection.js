const fs = require('fs');
const path = require('path');

function readDevtoolsEndpoint() {
  const portFile = path.join(
    process.env.HOME,
    'Library',
    'Application Support',
    'Google',
    'Chrome',
    'DevToolsActivePort'
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
    for (const listener of listeners) {
      listener(msg);
    }
  });

  const opened = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true });
    ws.addEventListener(
      'error',
      (event) => reject(event.error || new Error('WebSocket error')),
      { once: true }
    );
  });

  return {
    ws,
    opened,
    send(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        const msgId = ++id;
        pending.set(msgId, { resolve, reject });
        const payload = { id: msgId, method, params };
        if (sessionId) payload.sessionId = sessionId;
        ws.send(JSON.stringify(payload));
      });
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
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
    {
      expression,
      returnByValue: true,
      awaitPromise: true
    },
    sessionId
  );
  return result.result ? result.result.value : undefined;
}

async function findExtensionId(client) {
  const { targetInfos } = await client.send('Target.getTargets');
  const extensionTarget = targetInfos.find((target) => {
    const url = String(target.url || '');
    return url.startsWith('chrome-extension://');
  });
  if (!extensionTarget) {
    throw new Error('Could not find the loaded extension target in Chrome.');
  }
  return new URL(extensionTarget.url).host;
}

async function run() {
  const wsEndpoint = readDevtoolsEndpoint();
  const client = createClient(wsEndpoint);
  await client.opened;

  const extensionId = await findExtensionId(client);
  const query = encodeURIComponent(process.env.TEST_QUERY || 'hello world');
  const sites = encodeURIComponent(process.env.TEST_SITES || 'Perplexity,ChatGPT,Gemini');
  const type = encodeURIComponent(process.env.TEST_TYPE || 'other');
  const targetUrl =
    `chrome-extension://${extensionId}/iframe/iframe.html?query=${query}&sites=${sites}&type=${type}`;

  const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await client.send('Target.attachToTarget', {
    targetId,
    flatten: true
  });

  try {
    await client.send('Page.enable', {}, sessionId);
    await client.send('Runtime.enable', {}, sessionId);
    await client.send('Page.navigate', { url: targetUrl }, sessionId);
    await waitForLoad(client, sessionId);
    await sleep(Number(process.env.SETTLE_MS || 6000));

    const state = await evaluate(
      client,
      sessionId,
      `(() => {
        const iframes = Array.from(document.querySelectorAll('.ai-iframe'));
        const navItems = Array.from(document.querySelectorAll('.nav-site-item'));
        const emptyText = document.getElementById('iframes-container')?.innerText || '';
        return {
          locationHref: location.href,
          iframeCount: iframes.length,
          iframeSites: iframes.map((item) => item.getAttribute('data-site')),
          navCount: navItems.length,
          navSites: navItems.map((item) => item.dataset.siteName),
          bodyText: document.body.innerText.slice(0, 500),
          emptyText: emptyText.slice(0, 500)
        };
      })()`
    );

    console.log(JSON.stringify({ extensionId, targetUrl, state }, null, 2));
  } finally {
    await client.send('Target.closeTarget', { targetId }).catch(() => {});
    client.ws.close();
  }
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
