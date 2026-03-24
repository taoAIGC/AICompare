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
      if (sessionId) {
        payload.sessionId = sessionId;
      }
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

async function getTargets(client) {
  const { targetInfos } = await client.send('Target.getTargets');
  return targetInfos || [];
}

async function findExtensionPageTarget(client) {
  const targets = await getTargets(client);
  return targets.find((target) =>
    target.type === 'page' &&
    String(target.url || '').startsWith(`chrome-extension://${EXTENSION_ID}/`)
  ) || null;
}

async function createExtensionTarget(client, url) {
  const { targetId } = await client.send('Target.createTarget', { url });
  return targetId;
}

async function attachToTarget(client, targetId) {
  const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });
  await client.send('Runtime.enable', {}, sessionId);
  await client.send('Page.enable', {}, sessionId);
  return sessionId;
}

async function evaluate(client, sessionId, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  }, sessionId);
  return result?.result?.value;
}

async function waitFor(client, sessionId, expression, { timeoutMs = 30000, intervalMs = 500 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = await evaluate(client, sessionId, expression);
    if (value) {
      return value;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timeout waiting for expression: ${expression}`);
}

async function reloadExtension(client) {
  let target = await findExtensionPageTarget(client);
  if (!target) {
    const targetId = await createExtensionTarget(
      client,
      `chrome-extension://${EXTENSION_ID}/homepage/homepage.html`
    );
    await sleep(1200);
    target = { targetId };
  }

  const sessionId = await attachToTarget(client, target.targetId);
  try {
    await evaluate(client, sessionId, 'chrome.runtime.reload(); true');
  } catch (_) {
    // Expected when the page is torn down during reload.
  }
  await sleep(2500);
}

async function openRegressionPage(client) {
  const url = `chrome-extension://${EXTENSION_ID}/iframe/iframe.html?sites=${encodeURIComponent(SITE_NAME)}&type=image`;
  const targetId = await createExtensionTarget(client, url);
  await sleep(1500);
  const sessionId = await attachToTarget(client, targetId);
  await waitFor(
    client,
    sessionId,
    'document.readyState === "interactive" || document.readyState === "complete"'
  );
  return { targetId, sessionId, url };
}

async function waitForNanoIframe(client, sessionId) {
  const siteName = JSON.stringify(SITE_NAME);
  const expr = `!!document.querySelector('iframe.ai-iframe[data-site=' + JSON.stringify(${siteName}) + ']')`;
  return waitFor(client, sessionId, expr, { timeoutMs: 30000, intervalMs: 500 });
}

async function triggerSearch(client, sessionId) {
  const query = JSON.stringify(TEST_QUERY);
  const expr = `
    (() => {
      const input = document.getElementById('searchInput');
      const button = document.getElementById('searchButton');
      if (!input || !button) {
        return { ok: false, reason: 'controls_missing' };
      }
      input.focus();
      input.value = ${query};
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      button.click();
      return { ok: true };
    })()
  `;
  return evaluate(client, sessionId, expr);
}

async function snapshotPageState(client, sessionId) {
  const siteName = JSON.stringify(SITE_NAME);
  const expr = `
    (async () => {
      const siteName = ${siteName};
      const runtimeSites = typeof getDefaultSites === 'function' ? await getDefaultSites() : [];
      const runtimeSite = Array.isArray(runtimeSites) ? runtimeSites.find((site) => site && site.name === siteName) : null;
      const container = document.querySelector('.iframe-container[data-site-name="' + siteName + '"]');
      const overlay = container ? container.querySelector('.inject-progress') : null;
      const iframe = container ? container.querySelector('iframe.ai-iframe[data-site="' + siteName + '"]') : null;

      let latestUrl = null;
      let latestUrlError = null;
      if (iframe && typeof getIframeLatestUrl === 'function') {
        try {
          latestUrl = await getIframeLatestUrl(iframe, siteName);
        } catch (error) {
          latestUrlError = String(error && error.message ? error.message : error);
        }
      }

      return {
        runtimeSiteUrl: runtimeSite ? runtimeSite.url : null,
        runtimeSiteEnabled: runtimeSite ? runtimeSite.enabled : null,
        runtimeSiteType: runtimeSite ? (runtimeSite.type || runtimeSite.category || null) : null,
        title: overlay && overlay.querySelector('.inject-progress-title') ? overlay.querySelector('.inject-progress-title').textContent.trim() : null,
        detail: overlay && overlay.querySelector('.inject-progress-detail') ? overlay.querySelector('.inject-progress-detail').textContent.trim() : null,
        visible: !!(overlay && overlay.classList.contains('is-visible')),
        lastStatus: overlay && overlay.dataset ? (overlay.dataset.lastStatus || null) : null,
        iframeSrc: iframe ? iframe.src : null,
        latestUrl,
        latestUrlError
      };
    })()
  `;
  return evaluate(client, sessionId, expr);
}

function hasNoHandlerError(state) {
  const haystack = `${state?.title || ''}\n${state?.detail || ''}`;
  return /Site handler not found|未找到站点处理器/i.test(haystack);
}

async function waitForRegressionOutcome(client, sessionId) {
  const startedAt = Date.now();
  const timeoutMs = 70000;
  const states = [];

  while (Date.now() - startedAt < timeoutMs) {
    const state = await snapshotPageState(client, sessionId);
    states.push({
      atMs: Date.now() - startedAt,
      ...state
    });

    if (hasNoHandlerError(state)) {
      return {
        ok: false,
        reason: 'site_handler_not_found',
        finalState: state,
        states
      };
    }

    if (state?.lastStatus === 'complete') {
      return {
        ok: true,
        reason: 'script_completed',
        finalState: state,
        states
      };
    }

    if (state?.lastStatus === 'error') {
      return {
        ok: false,
        reason: 'script_error',
        finalState: state,
        states
      };
    }

    await sleep(1500);
  }

  const finalState = states[states.length - 1] || null;
  return {
    ok: false,
    reason: 'timeout',
    finalState,
    states
  };
}

async function main() {
  const endpoint = readChromeEndpoint();
  const client = new CDPClient(endpoint);
  await client.connect();

  let createdTargetId = null;

  try {
    await reloadExtension(client);

    const regressionPage = await openRegressionPage(client);
    createdTargetId = regressionPage.targetId;

    await waitForNanoIframe(client, regressionPage.sessionId);

    const triggerResult = await triggerSearch(client, regressionPage.sessionId);
    if (!triggerResult?.ok) {
      throw new Error(`Failed to trigger Nano Banana search: ${JSON.stringify(triggerResult)}`);
    }

    const outcome = await waitForRegressionOutcome(client, regressionPage.sessionId);
    const latestState = await snapshotPageState(client, regressionPage.sessionId);
    const sawProjectUrl = /\/project\//.test(latestState?.latestUrl || '');

    const payload = {
      ok: outcome.ok,
      reason: outcome.reason,
      extensionId: EXTENSION_ID,
      siteName: SITE_NAME,
      query: TEST_QUERY,
      sawProjectUrl,
      finalState: latestState,
      observedStates: outcome.states.slice(-12)
    };

    if (!outcome.ok) {
      console.error(JSON.stringify(payload, null, 2));
      process.exit(1);
    }

    console.log(JSON.stringify(payload, null, 2));
  } finally {
    if (createdTargetId) {
      await client.send('Target.closeTarget', { targetId: createdTargetId }).catch(() => {});
    }
    await client.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
