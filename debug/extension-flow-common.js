#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawnSync } = require('child_process');
const { CDPClient } = require('./cdp-client');
const { createUnifiedResult, classifyExternalStatus } = require('./live-verifier-common');

const DEFAULT_EXTENSION_ID = process.env.EXTENSION_ID || '<EXTENSION_ID>';
const DEVTOOLS_ACTIVE_PORT =
  process.env.DEVTOOLS_ACTIVE_PORT ||
  path.join(process.env.HOME || '', 'Library/Application Support/Google/Chrome/DevToolsActivePort');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildExtensionUrl(extensionId, query, sites, extraParams = {}) {
  const params = new URLSearchParams();
  params.set('openclaw', '1');
  if (query) params.set('query', query);
  if (Array.isArray(sites) && sites.length > 0) {
    params.set('sites', sites.join(','));
  }
  Object.entries(extraParams || {}).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') return;
    params.set(key, String(value));
  });
  return `chrome-extension://${extensionId}/iframe/iframe.html?${params.toString()}`;
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function createCallbackServer(timeoutMs) {
  const token = crypto.randomBytes(16).toString('hex');
  const deferred = createDeferred();
  let lastPayload = null;
  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url, 'http://127.0.0.1');
    if (req.method !== 'POST' || requestUrl.pathname !== `/openclaw-callback/${token}`) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }

    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) {
        req.destroy(new Error('Callback payload too large'));
      }
    });
    req.on('error', (error) => {
      deferred.reject(error);
    });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        lastPayload = payload;
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true }));
        const isFinal = payload && typeof payload === 'object' && (
          payload.ok === false
          || payload.completed === true
          || (payload.result && payload.result.finished === true)
        );
        if (isFinal) {
          deferred.resolve(payload);
        }
      } catch (error) {
        res.statusCode = 400;
        res.end('invalid json');
        deferred.reject(error);
      }
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : 0;
  const callbackUrl = `http://127.0.0.1:${port}/openclaw-callback/${token}`;
  const timer = setTimeout(() => {
    const progress = lastPayload && typeof lastPayload === 'object'
      ? JSON.stringify(lastPayload).slice(0, 2000)
      : '';
    deferred.reject(new Error(`Timed out waiting for extension callback after about ${Math.round(timeoutMs / 1000)} seconds.${progress ? ` Last callback: ${progress}` : ''}`));
  }, timeoutMs + 10000);

  let closed = false;
  return {
    callbackUrl,
    async waitForPayload() {
      try {
        return await deferred.promise;
      } finally {
        clearTimeout(timer);
        if (!closed) {
          closed = true;
          await new Promise((resolve) => server.close(() => resolve()));
        }
      }
    },
    async close() {
      clearTimeout(timer);
      if (!closed) {
        closed = true;
        await new Promise((resolve) => server.close(() => resolve()));
      }
    }
  };
}

function openUrlInBrowser(url, browserApp) {
  if (process.platform === 'darwin') {
    const appCandidates = browserApp
      ? [browserApp]
      : ['Google Chrome', 'Chromium', 'Microsoft Edge'];
    for (const appName of appCandidates) {
      const result = spawnSync('open', ['-a', appName, url], { stdio: 'ignore' });
      if (result.status === 0) {
        return;
      }
    }
    const bundleCandidates = [
      'com.google.Chrome',
      'org.chromium.Chromium',
      'com.microsoft.edgemac'
    ];
    for (const bundleId of bundleCandidates) {
      const result = spawnSync('open', ['-b', bundleId, url], { stdio: 'ignore' });
      if (result.status === 0) {
        return;
      }
    }
    throw new Error('Failed to open browser via macOS open command for any supported Chrome-family browser');
  }

  if (process.platform === 'win32') {
    const result = spawnSync('cmd', ['/c', 'start', '', url], { stdio: 'ignore' });
    if (result.status !== 0) {
      throw new Error('Failed to open browser via Windows start command');
    }
    return;
  }

  const command = browserApp || 'xdg-open';
  const result = spawnSync(command, [url], { stdio: 'ignore' });
  if (result.status !== 0) {
    throw new Error(`Failed to open browser via ${command}`);
  }
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
      if (typeof collectResponses === 'function') {
        const responses = await collectResponses(new Set([${JSON.stringify(siteName)}]));
        const markdown = typeof generateExportContent === 'function'
          ? generateExportContent(responses, 'markdown')
          : '';
        return {
          ok: true,
          source: 'export_responses',
          responses,
          markdown
        };
      }

      const runtime = window.__OPENCLAW_LAST_RESULT__ || null;
      const item = Array.isArray(runtime?.results)
        ? runtime.results.find((entry) => String(entry?.siteName || '') === ${JSON.stringify(siteName)})
        : null;

      if (!item) {
        return { ok: false, reason: 'runtime_result_missing' };
      }

      const normalizedResponse = {
        siteName: String(item.siteName || ${JSON.stringify(siteName)}),
        content: String(item.content || ''),
        url: String(item.url || ''),
        status: String(item.status || ''),
        error: item.error || ''
      };

      return {
        ok: true,
        source: 'openclaw_runtime',
        responses: [normalizedResponse],
        markdown: normalizedResponse.content
          ? '## ' + normalizedResponse.siteName + '\n\n' + normalizedResponse.content
          : ''
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

function resolveUnifiedStatus(payload) {
  if (payload.status === 'ok' && !payload.suspiciousEcho && !payload.emptyExport) {
    return 'ok';
  }

  const errorText = [
    payload.openclawResult?.error,
    payload.exported?.error,
    payload.contentPreview
  ].filter(Boolean).join('\n');
  const externalStatus = classifyExternalStatus(errorText);
  if (externalStatus) {
    return externalStatus;
  }

  if (payload.status && payload.status !== 'missing') {
    return payload.status;
  }

  return 'error';
}

async function runExtensionFlowCheck(options) {
  const transport = String(options.transport || 'gui').trim().toLowerCase();
  if (transport !== 'cdp') {
    return runExtensionFlowGuiCheck(options);
  }

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
      checkedAt: new Date().toISOString(),
      pageUrl: url,
      title: snapshot?.title || null,
      ...buildStatusPayload(siteName, query, snapshot, collected),
      rawOpenClaw: snapshot?.result || null,
      rawCollected: collected
    };
    const status = resolveUnifiedStatus(payload);
    const unifiedResult = createUnifiedResult({
      siteName,
      mode: 'extension_url',
      ok: status === 'ok',
      status,
      query,
      pageUrl: url,
      runtimeUrl: payload.exported?.url || payload.openclawResult?.url || '',
      contentPreview: payload.contentPreview,
      checkedAt: payload.checkedAt,
      evidence: {
        phase: payload.phase,
        title: payload.title,
        suspiciousEcho: payload.suspiciousEcho,
        emptyExport: payload.emptyExport,
        hasMarkdownExport: payload.hasMarkdownExport,
        openclawResult: payload.openclawResult,
        exported: payload.exported,
        rawOpenClaw: payload.rawOpenClaw,
        rawCollected: payload.rawCollected
      }
    });

    return unifiedResult;
  } finally {
    if (targetId) {
      await client.send('Target.closeTarget', { targetId }).catch(() => {});
    }
    await client.close().catch(() => {});
  }
}

function buildGuiStatusPayload(siteName, query, result) {
  const item = Array.isArray(result?.results)
    ? result.results.find((entry) => String(entry?.siteName || '') === siteName) || null
    : null;
  const content = String(item?.content || '');
  return {
    siteName,
    query,
    phase: result?.phase || null,
    status: item?.status || 'missing',
    openclawResult: item,
    exported: item,
    suspiciousEcho: !!query && content.trim() === query.trim(),
    emptyExport: content.trim().length === 0,
    hasMarkdownExport: content.trim().length > 0,
    contentPreview: content.slice(0, 300)
  };
}

async function runExtensionFlowGuiCheck(options) {
  const extensionId = options.extensionId || process.env.AI_COMPARE_EXTENSION_ID || process.env.EXTENSION_ID || 'hhkhgpadepocnmjfpohcmjdcgkmfnadi';
  const siteName = String(options.siteName || '').trim();
  const query = String(options.query || '你好世界');
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 90000;
  const pollMs = Number.isFinite(options.pollMs) ? options.pollMs : 3000;
  const minChars = Number.isFinite(options.minChars) ? options.minChars : 20;
  const stableRounds = Number.isFinite(options.stableRounds) ? options.stableRounds : 2;
  const waitForIframesMs = Number.isFinite(options.waitForIframesMs) ? options.waitForIframesMs : 20000;

  if (!siteName) {
    throw new Error('siteName is required');
  }

  const callbackServer = await createCallbackServer(timeoutMs);
  const triggerUrl = buildExtensionUrl(extensionId, query, [siteName], {
    openclaw_callback: callbackServer.callbackUrl,
    openclaw_timeout_ms: timeoutMs,
    openclaw_site_timeout_ms: timeoutMs,
    openclaw_poll_ms: pollMs,
    openclaw_min_chars: minChars,
    openclaw_stable_rounds: stableRounds,
    openclaw_wait_iframes_ms: waitForIframesMs
  });

  let callbackPayload = null;
  try {
    openUrlInBrowser(triggerUrl, options.browserApp || process.env.AI_COMPARE_BROWSER_APP || '');
    callbackPayload = await callbackServer.waitForPayload();
  } catch (error) {
    await callbackServer.close().catch(() => {});
    throw error;
  }

  if (!callbackPayload || callbackPayload.ok !== true || !callbackPayload.result) {
    const callbackError = callbackPayload && callbackPayload.error
      ? callbackPayload.error
      : 'Extension callback returned no result payload';
    throw new Error(callbackError);
  }

  const guiPayload = {
    ok: true,
    mode: 'gui',
    extensionId,
    triggerUrl,
    openedBrowser: true,
    browserApp: options.browserApp || null,
    callbackReceived: true,
    result: callbackPayload.result
  };

  const payload = {
    checkedAt: new Date().toISOString(),
    pageUrl: String(guiPayload.triggerUrl || ''),
    title: '',
    ...buildGuiStatusPayload(siteName, query, guiPayload.result),
    rawOpenClaw: guiPayload.result || null,
    rawCollected: guiPayload
  };
  const status = resolveUnifiedStatus(payload);

  return createUnifiedResult({
    siteName,
    mode: 'extension_url',
    ok: status === 'ok',
    status,
    query,
    pageUrl: payload.pageUrl,
    runtimeUrl: payload.exported?.url || '',
    contentPreview: payload.contentPreview,
    checkedAt: payload.checkedAt,
    evidence: {
      phase: payload.phase,
      suspiciousEcho: payload.suspiciousEcho,
      emptyExport: payload.emptyExport,
      hasMarkdownExport: payload.hasMarkdownExport,
      openclawResult: payload.openclawResult,
      exported: payload.exported,
      rawOpenClaw: payload.rawOpenClaw,
      rawCollected: payload.rawCollected
    }
  });
}

module.exports = {
  runExtensionFlowCheck
};
