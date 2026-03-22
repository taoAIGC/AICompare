const fs = require('fs');
const path = require('path');

const INPUT_SELECTOR = 'div[contenteditable="true"][role="textbox"].tiptap.ProseMirror';

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

async function waitForInput(client, sessionId, timeoutMs = 20000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const state = await evaluate(
      client,
      sessionId,
      `(() => {
        const input = document.querySelector(${JSON.stringify(INPUT_SELECTOR)});
        if (!input) {
          return { found: false };
        }
        const style = getComputedStyle(input);
        const rect = input.getBoundingClientRect();
        const visible =
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.opacity !== '0' &&
          rect.width > 6 &&
          rect.height > 6;
        return {
          found: true,
          visible,
          text: (input.innerText || input.textContent || '').trim(),
          placeholder: input.querySelector('.rich-placeholder-widget')?.textContent?.trim() || '',
          url: location.href
        };
      })()`
    );

    if (state && state.found && state.visible) {
      return state;
    }
    await sleep(1000);
  }

  return { found: false, visible: false };
}

async function run() {
  const query = process.env.DREAMINA_QUERY || 'A crystal fox walking through neon fog';
  const client = createClient(readWsEndpoint());
  await client.opened;

  const { targetId } = await client.send('Target.createTarget', { url: 'https://dreamina.capcut.com/' });
  const { sessionId } = await client.send('Target.attachToTarget', {
    targetId,
    flatten: true
  });

  try {
    await client.send('Page.enable', {}, sessionId);
    await client.send('Runtime.enable', {}, sessionId);
    await waitForLoad(client, sessionId, 20000);

    const inputState = await waitForInput(client, sessionId, 22000);
    if (!inputState.found) {
      console.log(JSON.stringify({
        query,
        result: {
          ok: false,
          reason: 'input-not-found'
        },
        success: false
      }, null, 2));
      return;
    }

    const result = await evaluate(
      client,
      sessionId,
      `(() => {
        const input = document.querySelector(${JSON.stringify(INPUT_SELECTOR)});
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
          text: (input.innerText || input.textContent || '').trim(),
          html: input.innerHTML || '',
          placeholder: input.querySelector('.rich-placeholder-widget')?.textContent?.trim() || '',
          url: location.href
        };
      })()`
    );

    console.log(JSON.stringify({
      query,
      inputState,
      result,
      success: result && result.ok === true && result.text === query
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
