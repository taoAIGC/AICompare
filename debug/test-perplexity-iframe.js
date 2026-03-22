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
      if (msg.error) {
        reject(new Error(JSON.stringify(msg.error)));
      } else {
        resolve(msg.result);
      }
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
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    send(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        const msgId = ++id;
        pending.set(msgId, { resolve, reject });
        const payload = { id: msgId, method, params };
        if (sessionId) {
          payload.sessionId = sessionId;
        }
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
    return (
      url.startsWith('chrome-extension://') &&
      (
        url.endsWith('/background.js') ||
        url.includes('/options/options.html') ||
        url.includes('/homepage/homepage.html') ||
        url.includes('/debug/')
      )
    );
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
  const targetUrl = 'about:blank';
  const perplexityUrl =
    process.env.PERPLEXITY_TEST_URL ||
    'https://www.perplexity.ai/search?q=hello%20world';

  const { targetId } = await client.send('Target.createTarget', { url: targetUrl });
  const { sessionId } = await client.send('Target.attachToTarget', {
    targetId,
    flatten: true
  });

  try {
    await client.send('Page.enable', {}, sessionId);
    await client.send('Runtime.enable', {}, sessionId);
    await waitForLoad(client, sessionId);

    await evaluate(
      client,
      sessionId,
      `(() => {
        document.body.innerHTML = '';
        window.__perplexityIframeEvents = [];
        const title = document.createElement('h1');
        title.textContent = 'Perplexity iframe test';
        title.style.font = '16px sans-serif';
        title.style.margin = '8px';
        const iframe = document.createElement('iframe');
        iframe.id = 'perplexity-frame';
        iframe.src = ${JSON.stringify(perplexityUrl)};
        iframe.style.width = '1280px';
        iframe.style.height = '900px';
        iframe.style.border = '1px solid #ccc';
        iframe.addEventListener('load', () => {
          window.__perplexityIframeEvents.push({
            type: 'load',
            ts: Date.now()
          });
        });
        iframe.addEventListener('error', () => {
          window.__perplexityIframeEvents.push({
            type: 'error',
            ts: Date.now()
          });
        });
        document.body.appendChild(title);
        document.body.appendChild(iframe);
        return {
          inserted: true,
          iframeSrc: iframe.src
        };
      })()`
    );

    await sleep(Number(process.env.IFRAME_WAIT_MS || 8000));

    const domState = await evaluate(
      client,
      sessionId,
      `(() => {
        const iframe = document.getElementById('perplexity-frame');
        if (!iframe) {
          return { found: false };
        }
        let accessibleHref = null;
        let accessibleTitle = null;
        let accessError = '';
        try {
          accessibleHref = iframe.contentWindow?.location?.href || null;
          accessibleTitle = iframe.contentDocument?.title || null;
        } catch (error) {
          accessError = String(error && error.message ? error.message : error);
        }
        return {
          found: true,
          src: iframe.src,
          clientWidth: iframe.clientWidth,
          clientHeight: iframe.clientHeight,
          events: window.__perplexityIframeEvents || [],
          accessibleHref,
          accessibleTitle,
          accessError
        };
      })()`
    );

    const frameTree = await client.send('Page.getFrameTree', {}, sessionId);
    const flattenedFrames = [];
    (function walk(node) {
      if (!node) return;
      if (node.frame) {
        flattenedFrames.push({
          id: node.frame.id,
          parentId: node.frame.parentId || '',
          url: node.frame.url || '',
          securityOrigin: node.frame.securityOrigin || '',
          mimeType: node.frame.mimeType || '',
          unreachableUrl: node.frame.unreachableUrl || '',
          name: node.frame.name || ''
        });
      }
      const children = Array.isArray(node.childFrames) ? node.childFrames : [];
      children.forEach(walk);
    })(frameTree.frameTree);

    const screenshot = await client.send(
      'Page.captureScreenshot',
      {
        format: 'png',
        fromSurface: true
      },
      sessionId
    );

    const screenshotDir = path.join(__dirname, 'output', 'perplexity-iframe-test');
    fs.mkdirSync(screenshotDir, { recursive: true });
    const screenshotPath = path.join(screenshotDir, `perplexity-iframe-${Date.now()}.png`);
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));

    const result = {
      extensionId,
      targetUrl,
      perplexityUrl,
      domState,
      frames: flattenedFrames,
      screenshotPath
    };

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await client.send('Target.closeTarget', { targetId }).catch(() => {});
    client.ws.close();
  }
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
