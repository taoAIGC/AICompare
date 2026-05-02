(function () {
  'use strict';

  const BRIDGE_VERSION = '1.1.0';
  const DEFAULT_TIMEOUT_MS = 180000;
  const DEFAULT_POLL_INTERVAL_MS = 5000;
  const DEFAULT_MIN_CHARS = 20;
  const DEFAULT_STABLE_ROUNDS = 2;
  const DEFAULT_WAIT_IFRAMES_MS = 20000;
  const READY_STATUSES = new Set([
    'ok',
    'error',
    'rate_limited',
    'login_required',
    'blocked',
    'landing_page',
    'not_submitted'
  ]);
  const STABLE_REQUIRED_STATUSES = new Set([
    'ok',
    'rate_limited',
    'login_required',
    'blocked',
    'landing_page',
    'not_submitted'
  ]);

  let lastResult = null;
  let activeRunPromise = null;
  let debugState = null;

  function parseNumber(value, fallback) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  }

  function parseSites(input) {
    if (!input) return [];
    if (Array.isArray(input)) {
      return input.map((item) => String(item).trim()).filter(Boolean);
    }
    return String(input)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getI18nMessage(key, fallback) {
    try {
      if (typeof chrome !== 'undefined' && chrome.i18n && chrome.i18n.getMessage) {
        const message = chrome.i18n.getMessage(key);
        return message || fallback;
      }
    } catch (_) {
      // Ignore i18n lookup errors and fall back to the provided text.
    }
    return fallback;
  }

  function getOpenedSites() {
    return Array.from(document.querySelectorAll('.ai-iframe[data-site]'))
      .map((iframe) => iframe.getAttribute('data-site'))
      .filter(Boolean);
  }

  async function getDefaultEnabledSites() {
    if (typeof window.getDefaultSites !== 'function') {
      return [];
    }

    try {
      const sites = await window.getDefaultSites();
      if (!Array.isArray(sites)) {
        return [];
      }

      return sites
        .filter((site) => site && site.enabled && !site.hidden)
        .map((site) => String(site.name || '').trim())
        .filter(Boolean);
    } catch (error) {
      console.warn('Failed to resolve default enabled sites for OpenClaw bridge:', error);
      return [];
    }
  }

  function getSearchQueryFromUi() {
    const searchInput = document.getElementById('searchInput');
    return (searchInput && searchInput.value ? String(searchInput.value) : '').trim();
  }

  function ensureRunTriggered(query, forceRun) {
    if (!query) return;

    const searchInput = document.getElementById('searchInput');
    const searchButton = document.getElementById('searchButton');
    if (!searchInput || !searchButton) return;

    const current = (searchInput.value || '').trim();
    if (!forceRun && current === query) {
      return;
    }

    searchInput.value = query;
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    searchInput.dispatchEvent(new Event('change', { bubbles: true }));
    searchButton.click();
  }

  function isExtractionFallbackContent(content) {
    return content.includes('无法自动提取') || content.includes('内容提取失败');
  }

  function matchesAny(text, patterns) {
    return patterns.some((pattern) => pattern.test(text));
  }

  function parseUrl(url) {
    try {
      return new URL(url);
    } catch (_) {
      return null;
    }
  }

  function isRootLikeUrl(url) {
    const parsed = parseUrl(url);
    if (!parsed) return false;
    return parsed.pathname === '/' || parsed.pathname === '/chat' || parsed.pathname === '/home';
  }

  function isRateLimitedContent(content) {
    return matchesAny(content, [
      /消息限制已达/i,
      /usage limit/i,
      /rate limit/i,
      /too many requests/i,
      /wait\s+\d+\s*(?:hour|minute|second)/i,
      /SuperGrok/i,
      /quota exceeded/i,
      /已达到.*限制/i
    ]);
  }

  function isLoginRequiredContent(content, url) {
    return matchesAny(content, [
      /sign in/i,
      /log in/i,
      /login/i,
      /connect your .* account/i,
      /unlock .*features/i,
      /continue with google/i,
      /登录/i,
      /登入/i,
      /请先登录/i,
      /关联你的.*账户/i,
      /解锁.*功能/i
    ]) || /\/login|\/signin|\/auth/i.test(url || '');
  }

  function isBlockedContent(content, url) {
    return matchesAny(content, [
      /verify you are human/i,
      /captcha/i,
      /access denied/i,
      /request blocked/i,
      /temporarily unavailable/i,
      /暂时不可用/i,
      /访问受限/i
    ]) || /\/pricing/i.test(url || '');
  }

  function isLandingPageContent(siteName, url, content) {
    const text = (content || '').trim();
    if (!text || !isRootLikeUrl(url)) {
      return false;
    }

    if (siteName === 'ChatGPT' && /what(?:'|’)?s on the agenda today\??/i.test(text)) {
      return true;
    }

    return matchesAny(text, [
      /^ask anything/i,
      /^what can i help/i,
      /^how can i help/i,
      /welcome back/i,
      /meet gemini/i,
      /talk to grok/i,
      /start a new chat/i
    ]);
  }

  function isNotSubmittedContent(siteName, url, content) {
    const text = (content || '').trim();
    if (!text) return false;

    if (siteName === 'ChatGPT' && /^https:\/\/chatgpt\.com\/?$/i.test(url || '')) {
      return /what(?:'|’)?s on the agenda today\??/i.test(text);
    }

    if (siteName === 'Grok') {
      return isRootLikeUrl(url) && /^ask anything/i.test(text);
    }

    if (siteName === 'Gemini') {
      return isRootLikeUrl(url) && /meet gemini/i.test(text);
    }

    return false;
  }

  function classifyResponse(item, minChars) {
    if (!item) {
      return { status: 'pending', error: '' };
    }

    const url = item.url ? String(item.url).trim() : '';
    const content = (item.content || '').trim();
    const siteName = item.siteName ? String(item.siteName).trim() : '';
    const errorText = item.errorMessage
      ? String(item.errorMessage).trim()
      : (item.error ? String(item.content || '').trim() : '');

    if (item.error) {
      if (isLoginRequiredContent(`${errorText} ${content}`.trim(), url)) {
        return { status: 'login_required', error: errorText || 'login_required' };
      }
      if (isBlockedContent(`${errorText} ${content}`.trim(), url)) {
        return { status: 'blocked', error: errorText || 'blocked' };
      }
      return { status: 'error', error: errorText || 'extract_failed' };
    }

    if (!content) {
      return { status: 'pending', error: '' };
    }

    if (isRateLimitedContent(content)) {
      return { status: 'rate_limited', error: 'rate_limited' };
    }

    if (isLoginRequiredContent(content, url)) {
      return { status: 'login_required', error: 'login_required' };
    }

    if (isBlockedContent(content, url)) {
      return { status: 'blocked', error: 'blocked' };
    }

    if (isExtractionFallbackContent(content)) {
      return { status: 'extraction_error', error: 'extraction_error' };
    }

    if (isNotSubmittedContent(siteName, url, content)) {
      return { status: 'not_submitted', error: 'not_submitted' };
    }

    if (isLandingPageContent(siteName, url, content)) {
      return { status: 'landing_page', error: 'landing_page' };
    }

    if (content.length < minChars) {
      return { status: 'short', error: '' };
    }

    return { status: 'ok', error: '' };
  }

  function buildSiteTimeoutMessage(siteName, timeoutMs, lastStatus) {
    const seconds = Math.round(timeoutMs / 1000);
    const suffix = lastStatus && lastStatus !== 'pending'
      ? ` Last observed status: ${lastStatus}.`
      : '';
    return `Timed out waiting for ${siteName} after about ${seconds} seconds.${suffix}`;
  }

  function finalizeTimedOutResults(results, timeoutMs) {
    return (results || []).map((item) => {
      if (!item) return item;
      if (READY_STATUSES.has(item.status) || item.status === 'timeout' || item.status === 'error') {
        return item;
      }

      const timeoutMessage = buildSiteTimeoutMessage(item.siteName, timeoutMs, item.status);
      return {
        ...item,
        status: 'timeout',
        content: item.content || timeoutMessage,
        error: timeoutMessage
      };
    });
  }

  function stableHash(item) {
    const content = (item.content || '').trim();
    return `${item.status}::${item.url || ''}::${content.slice(0, 2000)}`;
  }

  function debugSnapshotHash(result) {
    const sites = Array.isArray(result && result.results) ? result.results : [];
    return JSON.stringify({
      phase: result && result.phase ? result.phase : 'running',
      targetSites: Array.isArray(result && result.targetSites) ? result.targetSites : [],
      sites: sites.map((item) => ({
        siteName: item.siteName,
        status: item.status,
        error: item.error || '',
        url: item.url || '',
        length: item.length || 0
      }))
    });
  }

  function toResponseMap(responses) {
    const map = new Map();
    responses.forEach((entry) => {
      if (entry && entry.siteName) {
        map.set(entry.siteName, entry);
      }
    });
    return map;
  }

  function getSiteRuntimeBridge() {
    const bridge = window.aiCompareSiteRuntime;
    if (bridge && typeof bridge.getSnapshot === 'function') {
      return bridge;
    }
    return null;
  }

  function normalizeRuntimeEntry(entry, minChars, fallbackSiteName) {
    const siteName = entry?.siteName ? String(entry.siteName).trim() : String(fallbackSiteName || '').trim();
    const content = entry && typeof entry.content === 'string' ? entry.content.trim() : '';
    const url = entry?.url ? String(entry.url).trim() : '';
    const runtimePhase = entry?.phase ? String(entry.phase).trim() : 'pending';
    const runtimeError = entry?.error ? String(entry.error).trim() : '';
    const baseItem = {
      siteName,
      status: 'pending',
      content,
      url,
      length: content.length,
      extractionMethod: 'active-report',
      error: runtimeError,
      runtimePhase,
      final: entry?.final === true,
      searchId: entry?.searchId || ''
    };

    if (!entry) {
      return baseItem;
    }

    if (runtimePhase === 'timeout') {
      return {
        ...baseItem,
        status: 'timeout'
      };
    }

    const classified = classifyResponse({
      siteName,
      content,
      url,
      error: runtimePhase === 'error',
      errorMessage: runtimeError
    }, minChars);

    if (runtimePhase === 'queued') {
      return {
        ...baseItem,
        status: 'queued'
      };
    }

    if (runtimePhase === 'script_start') {
      return {
        ...baseItem,
        status: 'executing',
        error: runtimeError
      };
    }

    if (runtimePhase === 'submitted' || runtimePhase === 'waiting_response') {
      return {
        ...baseItem,
        status: READY_STATUSES.has(classified.status) ? classified.status : 'pending',
        error: classified.error || runtimeError
      };
    }

    if (runtimePhase === 'streaming') {
      return {
        ...baseItem,
        status: READY_STATUSES.has(classified.status) ? classified.status : (content ? 'streaming' : 'pending'),
        error: classified.error || runtimeError
      };
    }

    if (runtimePhase === 'ready') {
      const readyStatus = !content
        ? 'pending'
        : (classified.status === 'pending' || classified.status === 'short'
          ? 'ok'
          : classified.status);
      return {
        ...baseItem,
        status: readyStatus,
        error: classified.error || runtimeError
      };
    }

    if (runtimePhase === 'error') {
      return {
        ...baseItem,
        status: READY_STATUSES.has(classified.status) ? classified.status : 'error',
        error: classified.error || runtimeError || 'error'
      };
    }

    return {
      ...baseItem,
      status: classified.status,
      error: classified.error || runtimeError
    };
  }

  function getRuntimeResults(siteNames, minChars) {
    const bridge = getSiteRuntimeBridge();
    if (!bridge) {
      throw new Error('aiCompareSiteRuntime is not available on window');
    }

    const snapshot = bridge.getSnapshot(siteNames);
    return siteNames.map((siteName) => normalizeRuntimeEntry(snapshot?.bySite?.[siteName], minChars, siteName));
  }

  function waitForRuntimeUpdate(timeoutMs) {
    return new Promise((resolve) => {
      let finished = false;
      const eventName = (window.aiCompareSiteRuntime && window.aiCompareSiteRuntime.eventName)
        ? window.aiCompareSiteRuntime.eventName
        : 'aicompare:site-runtime-update';

      const cleanup = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        window.removeEventListener(eventName, onUpdate);
      };

      const onUpdate = () => {
        cleanup();
        resolve('update');
      };

      const timer = setTimeout(() => {
        cleanup();
        resolve('timeout');
      }, Math.max(200, Number(timeoutMs) || 0));

      window.addEventListener(eventName, onUpdate);
    });
  }

  function readUrlParamsDefaults() {
    const params = new URLSearchParams(window.location.search);
    return {
      urlQuery: (params.get('query') || '').trim(),
      urlSites: parseSites(params.get('sites') || ''),
      urlCallback: (params.get('openclaw_callback') || '').trim(),
      urlTimeoutMs: parseNumber(params.get('openclaw_timeout_ms'), DEFAULT_TIMEOUT_MS),
      urlPollIntervalMs: parseNumber(params.get('openclaw_poll_ms'), DEFAULT_POLL_INTERVAL_MS),
      urlMinChars: parseNumber(params.get('openclaw_min_chars'), DEFAULT_MIN_CHARS),
      urlStableRounds: parseNumber(params.get('openclaw_stable_rounds'), DEFAULT_STABLE_ROUNDS),
      urlWaitForIframesMs: parseNumber(params.get('openclaw_wait_iframes_ms'), DEFAULT_WAIT_IFRAMES_MS)
    };
  }

  function formatClockTime(isoString) {
    if (!isoString) return '';
    try {
      return new Date(isoString).toLocaleTimeString();
    } catch (_) {
      return isoString;
    }
  }

  function ensureDebugPanel() {
    const params = new URLSearchParams(window.location.search);
    const autoEnabled = params.get('openclaw') === '1' || params.get('source') === 'openclaw';
    if (!autoEnabled) {
      return null;
    }

    let panel = document.getElementById('openclaw-debug-panel');
    if (panel) {
      return panel;
    }

    panel = document.createElement('aside');
    panel.id = 'openclaw-debug-panel';
    panel.className = 'openclaw-debug-panel';
    panel.innerHTML = `
      <div class="openclaw-debug-header">
        <div class="openclaw-debug-title">${getI18nMessage('openclawModeTitle', 'OpenClaw mode')}</div>
        <div class="openclaw-debug-phase" data-role="phase"></div>
      </div>
      <div class="openclaw-debug-meta">
        <div class="openclaw-debug-meta-row">
          <span class="openclaw-debug-label">${getI18nMessage('openclawDebugQuery', 'Query')}</span>
          <span class="openclaw-debug-value" data-role="query"></span>
        </div>
        <div class="openclaw-debug-meta-row">
          <span class="openclaw-debug-label">${getI18nMessage('openclawDebugCallback', 'Callback')}</span>
          <span class="openclaw-debug-value" data-role="callback"></span>
        </div>
        <div class="openclaw-debug-meta-row">
          <span class="openclaw-debug-label">${getI18nMessage('openclawDebugProgress', 'Progress')}</span>
          <span class="openclaw-debug-value" data-role="progress"></span>
        </div>
        <div class="openclaw-debug-meta-row">
          <span class="openclaw-debug-label">${getI18nMessage('openclawDebugLastCallback', 'Last callback')}</span>
          <span class="openclaw-debug-value" data-role="last-callback"></span>
        </div>
      </div>
      <div class="openclaw-debug-sites" data-role="sites"></div>
    `;
    document.body.appendChild(panel);
    return panel;
  }

  function resolvePhaseLabel(phase) {
    switch (phase) {
      case 'completed':
        return getI18nMessage('openclawStatusCompleted', 'Completed');
      case 'timed_out':
        return getI18nMessage('openclawStatusTimedOut', 'Timed out');
      case 'error':
        return getI18nMessage('openclawStatusError', 'Error');
      case 'running':
      default:
        return getI18nMessage('openclawStatusRunning', 'Running');
    }
  }

  function renderDebugPanel() {
    const panel = ensureDebugPanel();
    if (!panel || !debugState) {
      return;
    }

    panel.dataset.phase = debugState.phase || 'running';

    const phaseEl = panel.querySelector('[data-role="phase"]');
    const queryEl = panel.querySelector('[data-role="query"]');
    const callbackEl = panel.querySelector('[data-role="callback"]');
    const progressEl = panel.querySelector('[data-role="progress"]');
    const lastCallbackEl = panel.querySelector('[data-role="last-callback"]');
    const sitesEl = panel.querySelector('[data-role="sites"]');

    if (phaseEl) {
      phaseEl.textContent = resolvePhaseLabel(debugState.phase);
    }

    if (queryEl) {
      queryEl.textContent = debugState.query || '—';
      queryEl.title = debugState.query || '';
    }

    if (callbackEl) {
      if (debugState.callbackUrl) {
        callbackEl.textContent = debugState.callbackState === 'error'
          ? getI18nMessage('openclawDebugCallbackFailed', 'Send failed')
          : (debugState.callbackState === 'sent'
            ? getI18nMessage('openclawDebugCallbackSent', 'Sent')
            : getI18nMessage('openclawDebugCallbackWaiting', 'Waiting'));
      } else {
        callbackEl.textContent = '—';
      }
    }

    if (progressEl) {
      const total = Number.isFinite(debugState.totalSites) ? debugState.totalSites : 0;
      const resolved = Number.isFinite(debugState.resolvedSites) ? debugState.resolvedSites : 0;
      progressEl.textContent = total > 0 ? `${resolved}/${total}` : '0/0';
    }

    if (lastCallbackEl) {
      lastCallbackEl.textContent = debugState.lastCallbackAt
        ? formatClockTime(debugState.lastCallbackAt)
        : '—';
    }

    if (sitesEl) {
      sitesEl.innerHTML = '';
      (debugState.results || []).forEach((item) => {
        const row = document.createElement('div');
        row.className = 'openclaw-debug-site';
        row.dataset.status = item.status || 'pending';

        const name = document.createElement('span');
        name.className = 'openclaw-debug-site-name';
        name.textContent = item.siteName || 'Unknown';

        const status = document.createElement('span');
        status.className = 'openclaw-debug-site-status';
        status.textContent = item.status || 'pending';

        row.appendChild(name);
        row.appendChild(status);

        if (item.error) {
          row.title = item.error;
        } else if (item.url) {
          row.title = item.url;
        }

        sitesEl.appendChild(row);
      });
    }
  }

  function updateDebugState(patch) {
    debugState = {
      ...(debugState || {
        phase: 'running',
        query: '',
        callbackUrl: '',
        callbackState: 'waiting',
        lastCallbackAt: '',
        totalSites: 0,
        resolvedSites: 0,
        results: []
      }),
      ...(patch || {})
    };
    renderDebugPanel();
  }

  function buildRunResult(params) {
    const results = Array.isArray(params.results) ? params.results : [];
    const targetSites = Array.isArray(params.targetSites) ? params.targetSites : [];
    const resolvedSites = results.filter((item) => READY_STATUSES.has(item.status) || item.status === 'timeout').length;

    return {
      runId: params.runId,
      phase: params.phase,
      query: params.query,
      historyId: window._currentHistoryId || null,
      startedAt: params.startedAt,
      finishedAt: new Date().toISOString(),
      timeoutMs: params.timeoutMs,
      pollIntervalMs: params.pollIntervalMs,
      minChars: params.minChars,
      stableRounds: params.stableRounds,
      timedOut: Boolean(params.timedOut),
      completed: !params.timedOut,
      finished: params.phase !== 'running',
      openedSites: getOpenedSites(),
      resolvedDefaultSites: params.resolvedDefaultSites,
      targetSites,
      totalSites: targetSites.length,
      resolvedSites,
      results
    };
  }

  async function postCallback(callbackUrl, payload) {
    if (!callbackUrl) return;
    updateDebugState({ callbackState: 'sending' });
    await fetch(callbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    updateDebugState({
      callbackState: 'sent',
      lastCallbackAt: new Date().toISOString()
    });
  }

  async function maybePostProgress(callbackUrl, result, state, forceFinal) {
    if (!callbackUrl || !result) {
      return;
    }

    const snapshot = debugSnapshotHash(result);
    if (!forceFinal && snapshot === state.lastPostedSnapshot) {
      return;
    }

    state.lastPostedSnapshot = snapshot;

    try {
      await postCallback(callbackUrl, {
        ok: true,
        source: 'ai-compare-openclaw',
        version: BRIDGE_VERSION,
        completed: Boolean(forceFinal),
        result
      });
    } catch (error) {
      updateDebugState({
        callbackState: 'error',
        lastCallbackAt: new Date().toISOString()
      });
      console.warn('[openclaw-bridge] callback post failed:', error);
    }
  }

  async function runOpenClawComparison(options) {
    const opts = options || {};
    const defaults = readUrlParamsDefaults();

    const query = (typeof opts.query === 'string' ? opts.query : defaults.urlQuery || getSearchQueryFromUi()).trim();
    const requestedSites = parseSites(opts.sites && opts.sites.length ? opts.sites : defaults.urlSites);
    const callbackUrl = (typeof opts.callbackUrl === 'string' ? opts.callbackUrl : defaults.urlCallback || '').trim();
    const timeoutMs = Math.max(1000, parseNumber(opts.timeoutMs, defaults.urlTimeoutMs));
    const pollIntervalMs = Math.max(500, parseNumber(opts.pollIntervalMs, defaults.urlPollIntervalMs));
    const minChars = Math.max(1, parseNumber(opts.minChars, defaults.urlMinChars));
    const stableRounds = Math.max(0, parseNumber(opts.stableRounds, defaults.urlStableRounds));
    const waitForIframesMs = Math.max(0, parseNumber(opts.waitForIframesMs, defaults.urlWaitForIframesMs));
    const forceRun = Boolean(opts.forceRun);

    const startAt = Date.now();
    const runId = `${startAt}-${Math.random().toString(36).slice(2, 8)}`;
    const callbackState = {
      lastPostedSnapshot: ''
    };

    updateDebugState({
      runId,
      phase: 'running',
      query,
      callbackUrl,
      callbackState: callbackUrl ? 'waiting' : 'none',
      lastCallbackAt: '',
      totalSites: 0,
      resolvedSites: 0,
      results: []
    });

    ensureRunTriggered(query, forceRun);

    const resolvedDefaultSites = requestedSites.length > 0 ? [] : await getDefaultEnabledSites();
    let frozenTargetSites = requestedSites.length > 0 ? requestedSites.slice() : [];

    const waitIframesUntil = Date.now() + waitForIframesMs;
    while (Date.now() < waitIframesUntil) {
      if (getOpenedSites().length > 0) break;
      await sleep(200);
    }

    if (!getSiteRuntimeBridge()) {
      throw new Error('aiCompareSiteRuntime is not available on window');
    }

    const stableState = new Map();
    let normalizedResults = [];
    let finalTargetSites = frozenTargetSites.slice();
    let timedOut = false;

    while (true) {
      const elapsed = Date.now() - startAt;
      if (elapsed >= timeoutMs) {
        timedOut = true;
        break;
      }

      if (frozenTargetSites.length === 0) {
        const openedSites = getOpenedSites();
        const candidateSites = openedSites.length > 0 ? openedSites : resolvedDefaultSites;
        if (candidateSites.length > 0) {
          frozenTargetSites = candidateSites.slice();
        }
      }

      finalTargetSites = frozenTargetSites.slice();

      if (finalTargetSites.length === 0) {
        updateDebugState({
          totalSites: 0,
          resolvedSites: 0,
          results: []
        });
        await sleep(Math.min(pollIntervalMs, 1000));
        continue;
      }

      try {
        normalizedResults = getRuntimeResults(finalTargetSites, minChars);
      } catch (error) {
        normalizedResults = finalTargetSites.map((siteName) => ({
          siteName,
          status: 'error',
          content: '',
          url: '',
          length: 0,
          extractionMethod: 'active-report',
          error: error && error.message ? error.message : String(error),
          runtimePhase: 'error',
          final: true
        }));
        timedOut = true;
        break;
      }

      const runningResult = buildRunResult({
        runId,
        phase: 'running',
        query: query || getSearchQueryFromUi(),
        startedAt: new Date(startAt).toISOString(),
        timeoutMs,
        pollIntervalMs,
        minChars,
        stableRounds,
        timedOut: false,
        resolvedDefaultSites,
        targetSites: finalTargetSites,
        results: normalizedResults
      });

      updateDebugState({
        phase: 'running',
        totalSites: runningResult.totalSites,
        resolvedSites: runningResult.resolvedSites,
        results: runningResult.results
      });
      await maybePostProgress(callbackUrl, runningResult, callbackState, false);

      const allResolved = normalizedResults.length > 0
        && normalizedResults.every((item) => READY_STATUSES.has(item.status));

      let stableEnough = stableRounds === 0;
      if (!stableEnough) {
        stableEnough = normalizedResults.every((item) => {
          if (item?.final === true) return true;
          if (!STABLE_REQUIRED_STATUSES.has(item.status)) return true;
          const hash = stableHash(item);
          const prev = stableState.get(item.siteName);
          if (!prev || prev.hash !== hash) {
            stableState.set(item.siteName, { hash, rounds: 0 });
            return false;
          }
          const rounds = prev.rounds + 1;
          stableState.set(item.siteName, { hash, rounds });
          return rounds >= stableRounds;
        });
      }

      if (allResolved && stableEnough) {
        break;
      }

      await waitForRuntimeUpdate(pollIntervalMs);
    }

    if (timedOut) {
      normalizedResults = finalizeTimedOutResults(normalizedResults, timeoutMs);
    }

    const result = buildRunResult({
      runId,
      phase: timedOut ? 'timed_out' : 'completed',
      query: query || getSearchQueryFromUi(),
      startedAt: new Date(startAt).toISOString(),
      timeoutMs,
      pollIntervalMs,
      minChars,
      stableRounds,
      timedOut,
      resolvedDefaultSites,
      targetSites: finalTargetSites,
      results: normalizedResults
    });

    lastResult = result;
    window.__OPENCLAW_LAST_RESULT__ = result;

    updateDebugState({
      phase: result.phase,
      totalSites: result.totalSites,
      resolvedSites: result.resolvedSites,
      results: result.results
    });

    const payload = JSON.stringify(result, null, 2);
    let outputEl = document.getElementById('openclaw-result-json');
    if (!outputEl) {
      outputEl = document.createElement('pre');
      outputEl.id = 'openclaw-result-json';
      outputEl.style.display = 'none';
      document.body.appendChild(outputEl);
    }
    outputEl.textContent = payload;

    window.dispatchEvent(new CustomEvent('aicompare:openclaw-result', { detail: result }));
    await maybePostProgress(callbackUrl, result, callbackState, true);
    return result;
  }

  async function run(options) {
    if (activeRunPromise) {
      return activeRunPromise;
    }
    activeRunPromise = runOpenClawComparison(options).finally(() => {
      activeRunPromise = null;
    });
    return activeRunPromise;
  }

  window.aiCompareOpenClaw = {
    run,
    getLastResult: function () {
      return lastResult;
    },
    getOpenedSites,
    version: BRIDGE_VERSION
  };

  window.addEventListener('message', function (event) {
    const data = event && event.data;
    if (!data || data.type !== 'OPENCLAW_RUN_COMPARISON') {
      return;
    }

    run(data.options || {})
      .then((result) => {
        window.postMessage({
          type: 'OPENCLAW_RUN_COMPARISON_RESULT',
          requestId: data.requestId || null,
          ok: true,
          result
        }, '*');
      })
      .catch((error) => {
        window.postMessage({
          type: 'OPENCLAW_RUN_COMPARISON_RESULT',
          requestId: data.requestId || null,
          ok: false,
          error: error && error.message ? error.message : String(error)
        }, '*');
      });
  });

  const params = new URLSearchParams(window.location.search);
  const autoEnabled = params.get('openclaw') === '1' || params.get('source') === 'openclaw';
  if (autoEnabled) {
    ensureDebugPanel();
    window.addEventListener('load', function () {
      setTimeout(function () {
        run({
          query: (params.get('query') || '').trim(),
          sites: parseSites(params.get('sites') || ''),
          callbackUrl: (params.get('openclaw_callback') || '').trim(),
          forceRun: false
        }).catch((error) => {
          postCallback((params.get('openclaw_callback') || '').trim(), {
            ok: false,
            source: 'ai-compare-openclaw',
            version: BRIDGE_VERSION,
            completed: true,
            error: error && error.message ? error.message : String(error)
          }).catch(function (callbackError) {
            console.warn('[openclaw-bridge] callback error after auto run failure:', callbackError);
          });
          updateDebugState({
            phase: 'error',
            callbackState: 'error',
            lastCallbackAt: new Date().toISOString()
          });
          console.warn('[openclaw-bridge] auto run failed:', error);
        });
      }, 300);
    });
  }
})();
