#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const EXTENSION_ID = process.env.EXTENSION_ID || 'hhkhgpadepocnmjfpohcmjdcgkmfnadi';
const SITE_NAME = 'Nano Banana';
const TEST_QUERY = process.env.TEST_QUERY || '请生成一张极简风格的黄色香蕉产品海报，白色背景，柔和阴影。';
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

async function waitForNanoResult(client, sessionId, timeoutMs = 90000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const state = await evaluate(
      client,
      sessionId,
      `(() => {
        const container = document.querySelector('.iframe-container[data-site-name="${SITE_NAME}"]');
        const overlay = container ? container.querySelector('.inject-progress') : null;
        const latestState = window.__OPENCLAW_LAST_RESULT__ || null;
        return {
          title: document.title,
          phase: latestState?.phase || null,
          siteResult: latestState?.results?.find((item) => item.siteName === ${JSON.stringify(SITE_NAME)}) || null,
          overlayVisible: !!(overlay && overlay.classList.contains('is-visible')),
          overlayTitle: overlay?.querySelector('.inject-progress-title')?.textContent?.trim() || null,
          overlayDetail: overlay?.querySelector('.inject-progress-detail')?.textContent?.trim() || null,
          overlayStatus: overlay?.dataset?.lastStatus || null
        };
      })()`
    );

    if (state?.siteResult?.status && state.phase === 'completed') {
      return state;
    }
    if (state?.overlayStatus === 'complete' || state?.overlayStatus === 'error') {
      return state;
    }
    await sleep(1500);
  }
  throw new Error(`Timed out waiting for Nano Banana result after ${timeoutMs}ms`);
}

async function main() {
  const endpoint = readChromeEndpoint();
  const client = new CDPClient(endpoint);
  await client.connect();

  let targetId = null;
  try {
    const timeoutMs = Number(process.env.TIMEOUT_MS || 90000);
    const params = new URLSearchParams({
      openclaw: '1',
      query: TEST_QUERY,
      sites: SITE_NAME,
      type: 'image',
      openclaw_timeout_ms: String(timeoutMs),
      openclaw_poll_ms: '3000',
      openclaw_min_chars: '1',
      openclaw_stable_rounds: '1',
      openclaw_wait_iframes_ms: '20000'
    });
    const url = `chrome-extension://${EXTENSION_ID}/iframe/iframe.html?${params.toString()}`;
    const page = await createPage(client, url);
    targetId = page.targetId;
    await waitForReady(client, page.sessionId);
    const state = await waitForNanoResult(client, page.sessionId, timeoutMs + 10000);

    const payload = {
      ok: false,
      checkedAt: new Date().toISOString(),
      pageUrl: url,
      siteName: SITE_NAME,
      query: TEST_QUERY,
      phase: state?.phase || null,
      status: state?.siteResult?.status || state?.overlayStatus || 'missing',
      siteResult: state?.siteResult || null,
      overlayVisible: state?.overlayVisible || false,
      overlayTitle: state?.overlayTitle || null,
      overlayDetail: state?.overlayDetail || null
    };

    payload.ok = payload.status === 'ok' || payload.status === 'rate_limited' || payload.status === 'blocked';
    const output = JSON.stringify(payload, null, 2);
    if (!payload.ok) {
      console.error(output);
      process.exit(1);
    }
    console.log(output);
  } finally {
    if (targetId) {
      await client.send('Target.closeTarget', { targetId }).catch(() => {});
    }
    await client.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
