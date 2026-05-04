#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const DEFAULT_EXTENSION_ID = process.env.EXTENSION_ID || 'hhkhgpadepocnmjfpohcmjdcgkmfnadi';
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

async function reloadExtension(client, extensionId) {
  const page = await createPage(client, `chrome-extension://${extensionId}/iframe/iframe.html`);
  try {
    await evaluate(client, page.sessionId, 'chrome.runtime.reload(); "reloaded"');
  } catch (_) {
    // Ignore reload teardown.
  } finally {
    await client.send('Target.closeTarget', { targetId: page.targetId }).catch(() => {});
  }
  await sleep(2500);
}

async function waitForOpenClawResult(client, sessionId, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = await evaluate(
      client,
      sessionId,
      `(() => {
        const result = window.__OPENCLAW_LAST_RESULT__ || null;
        return {
          title: document.title,
          result
        };
      })()`
    );
    if (snapshot?.result?.phase === 'completed' || snapshot?.result?.phase === 'timed_out') {
      return snapshot;
    }
    await sleep(1500);
  }
  throw new Error(`Timed out waiting for OpenClaw result after ${timeoutMs}ms`);
}

async function collectResponses(client, sessionId, siteName) {
  return evaluate(
    client,
    sessionId,
    `(async () => {
      if (typeof collectResponses !== 'function') {
        return { ok: false, reason: 'collectResponses_missing' };
      }
      const responses = await collectResponses(new Set([${JSON.stringify(siteName)}]));
      const markdown = typeof generateExportContent === 'function'
        ? generateExportContent(responses, 'markdown')
        : '';
      return {
        ok: true,
        responses,
        markdown
      };
    })()`
  );
}

function buildStatusPayload(siteName, query, snapshot, collected) {
  const result = snapshot?.result?.results?.find((item) => item.siteName === siteName) || null;
  const exported = Array.isArray(collected?.responses) ? collected.responses[0] || null : null;
  const exportedContent = String(exported?.content || '');
  const resultContent = String(result?.content || '');
  return {
    siteName,
    query,
    phase: snapshot?.result?.phase || null,
    status: result?.status || 'missing',
    openclawResult: result,
    exported,
    suspiciousEcho: !!query && exportedContent.trim() === query.trim(),
    emptyExport: exportedContent.trim().length === 0,
    hasMarkdownExport: !!String(collected?.markdown || '').trim(),
    contentPreview: (exportedContent || resultContent).slice(0, 300)
  };
}

async function runExtensionFlowCheck(options) {
  const extensionId = options.extensionId || DEFAULT_EXTENSION_ID;
  const siteName = String(options.siteName || '').trim();
  const query = String(options.query || '你好世界');
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 90000;
  const pollMs = Number.isFinite(options.pollMs) ? options.pollMs : 3000;
  const minChars = Number.isFinite(options.minChars) ? options.minChars : 20;
  const stableRounds = Number.isFinite(options.stableRounds) ? options.stableRounds : 2;
  const waitForIframesMs = Number.isFinite(options.waitForIframesMs) ? options.waitForIframesMs : 20000;
  const reload = options.reloadExtension === true;
  const extraParams = options.extraParams || {};

  if (!siteName) {
    throw new Error('siteName is required');
  }

  const endpoint = readChromeEndpoint();
  const client = new CDPClient(endpoint);
  await client.connect();

  let targetId = null;
  try {
    if (reload) {
      await reloadExtension(client, extensionId);
    }

    const params = new URLSearchParams({
      openclaw: '1',
      query,
      sites: siteName,
      openclaw_timeout_ms: String(timeoutMs),
      openclaw_poll_ms: String(pollMs),
      openclaw_min_chars: String(minChars),
      openclaw_stable_rounds: String(stableRounds),
      openclaw_wait_iframes_ms: String(waitForIframesMs)
    });

    for (const [key, value] of Object.entries(extraParams)) {
      if (value === null || value === undefined || value === '') continue;
      params.set(key, String(value));
    }

    const url = `chrome-extension://${extensionId}/iframe/iframe.html?${params.toString()}`;
    const page = await createPage(client, url);
    targetId = page.targetId;
    await waitForReady(client, page.sessionId);

    const snapshot = await waitForOpenClawResult(client, page.sessionId, timeoutMs + 10000);
    const collected = await collectResponses(client, page.sessionId, siteName);
    const payload = {
      ok: false,
      checkedAt: new Date().toISOString(),
      pageUrl: url,
      title: snapshot?.title || null,
      ...buildStatusPayload(siteName, query, snapshot, collected),
      rawOpenClaw: snapshot?.result || null,
      rawCollected: collected
    };

    payload.ok = payload.status === 'ok' && !payload.suspiciousEcho && !payload.emptyExport;
    return payload;
  } finally {
    if (targetId) {
      await client.send('Target.closeTarget', { targetId }).catch(() => {});
    }
    await client.close().catch(() => {});
  }
}

module.exports = {
  runExtensionFlowCheck
};
