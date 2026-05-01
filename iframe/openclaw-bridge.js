(function () {
  'use strict';

  const DEFAULT_TIMEOUT_MS = 180000;
  const DEFAULT_POLL_INTERVAL_MS = 5000;
  const DEFAULT_MIN_CHARS = 20;
  const DEFAULT_STABLE_ROUNDS = 2;
  const DEFAULT_WAIT_IFRAMES_MS = 20000;

  let lastResult = null;
  let activeRunPromise = null;

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

  function buildResponseStatus(item, minChars) {
    if (!item) {
      return 'pending';
    }
    if (item.error) {
      return 'error';
    }

    const content = (item.content || '').trim();
    if (!content) {
      return 'empty';
    }

    if (isExtractionFallbackContent(content)) {
      return 'extraction_error';
    }

    if (content.length < minChars) {
      return 'short';
    }

    return 'ok';
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
      if (item.status === 'ok' || item.status === 'error' || item.status === 'timeout') {
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

  function toResponseMap(responses) {
    const map = new Map();
    responses.forEach((entry) => {
      if (entry && entry.siteName) {
        map.set(entry.siteName, entry);
      }
    });
    return map;
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

  async function postCallback(callbackUrl, payload) {
    if (!callbackUrl) return;
    await fetch(callbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
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
    ensureRunTriggered(query, forceRun);

    const resolvedDefaultSites = requestedSites.length > 0 ? [] : await getDefaultEnabledSites();

    const waitIframesUntil = Date.now() + waitForIframesMs;
    while (Date.now() < waitIframesUntil) {
      if (getOpenedSites().length > 0) break;
      await sleep(200);
    }

    if (typeof window.collectResponses !== 'function') {
      throw new Error('collectResponses is not available on window');
    }

    const stableState = new Map();
    let normalizedResults = [];
    let finalTargetSites = [];
    let timedOut = false;

    while (true) {
      const elapsed = Date.now() - startAt;
      if (elapsed >= timeoutMs) {
        timedOut = true;
        break;
      }

      const openedSites = getOpenedSites();
      finalTargetSites = requestedSites.length > 0
        ? requestedSites
        : (resolvedDefaultSites.length > 0 ? resolvedDefaultSites : openedSites);

      if (finalTargetSites.length === 0) {
        await sleep(Math.min(pollIntervalMs, 1000));
        continue;
      }

      let rawResponses = [];
      try {
        rawResponses = await window.collectResponses(new Set(finalTargetSites));
      } catch (error) {
        normalizedResults = finalTargetSites.map((siteName) => ({
          siteName,
          status: 'error',
          content: '',
          url: '',
          length: 0,
          error: error && error.message ? error.message : String(error)
        }));
        timedOut = true;
        break;
      }

      const responseMap = toResponseMap(rawResponses || []);
      normalizedResults = finalTargetSites.map((siteName) => {
        const raw = responseMap.get(siteName);
        const content = raw && typeof raw.content === 'string' ? raw.content.trim() : '';
        const status = buildResponseStatus(raw, minChars);
        return {
          siteName,
          status,
          content,
          url: raw && raw.url ? raw.url : '',
          length: content.length,
          extractionMethod: raw && raw.extractionMethod ? raw.extractionMethod : '',
          error: raw && raw.error ? (raw.errorMessage || 'extract_failed') : ''
        };
      });

      // Extraction fallback content often appears before the site iframe finishes
      // wiring its injected extractor, so keep polling instead of treating the
      // first "无法自动提取..." result as final.
      const terminalStatuses = new Set(['ok', 'error']);
      const allTerminal = normalizedResults.every((item) => terminalStatuses.has(item.status));

      let stableEnough = stableRounds === 0;
      if (!stableEnough) {
        stableEnough = normalizedResults.every((item) => {
          if (item.status !== 'ok') return true;
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

      if (allTerminal && stableEnough) {
        break;
      }

      await sleep(pollIntervalMs);
    }

    if (timedOut) {
      normalizedResults = finalizeTimedOutResults(normalizedResults, timeoutMs);
    }

    const result = {
      query: query || getSearchQueryFromUi(),
      historyId: window._currentHistoryId || null,
      startedAt: new Date(startAt).toISOString(),
      finishedAt: new Date().toISOString(),
      timeoutMs,
      pollIntervalMs,
      minChars,
      stableRounds,
      timedOut,
      completed: !timedOut,
      openedSites: getOpenedSites(),
      resolvedDefaultSites,
      targetSites: finalTargetSites,
      totalSites: finalTargetSites.length,
      results: normalizedResults
    };

    lastResult = result;
    window.__OPENCLAW_LAST_RESULT__ = result;

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
    await postCallback(callbackUrl, {
      ok: true,
      source: 'ai-compare-openclaw',
      version: '1.0.0',
      result
    });
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
    version: '1.0.0'
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
            version: '1.0.0',
            error: error && error.message ? error.message : String(error)
          }).catch(function (callbackError) {
            console.warn('[openclaw-bridge] callback error after auto run failure:', callbackError);
          });
          console.warn('[openclaw-bridge] auto run failed:', error);
        });
      }, 300);
    });
  }
})();
