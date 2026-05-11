(function () {
  'use strict';

  const BRIDGE_VERSION = '1.1.0';
  const DEFAULT_TIMEOUT_MS = 60000;
  const DEFAULT_SITE_TIMEOUT_MS = 60000;
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
  const TERMINAL_STATUSES = new Set([
    ...READY_STATUSES,
    'timeout'
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

  async function getDefaultSites() {
    if (typeof window.getDefaultSites !== 'function') {
      return [];
    }

    try {
      const sites = await window.getDefaultSites();
      if (!Array.isArray(sites)) {
        return [];
      }

      return sites
        .filter((site) => site && !site.hidden && site.supportIframe !== false)
        .map((site) => String(site.name || '').trim())
        .filter(Boolean);
    } catch (error) {
      console.warn('Failed to resolve default sites for OpenClaw bridge:', error);
      return [];
    }
  }

  function getSearchQueryFromUi() {
    const searchInput = document.getElementById('searchInput');
    return (searchInput && searchInput.value ? String(searchInput.value) : '').trim();
  }

  function getAiCompareSearchApi() {
    const api = window.aiCompareSearch;
    if (api && typeof api.submitQuery === 'function') {
      return api;
    }
    return null;
  }

  async function ensureRunTriggered(query, forceRun) {
    if (!query) return;

    const searchInput = document.getElementById('searchInput');
    const current = (searchInput && searchInput.value ? searchInput.value : '').trim();
    if (!forceRun && current === query) {
      return;
    }

    const searchApi = getAiCompareSearchApi();
    if (searchApi) {
      await searchApi.submitQuery(query, {
        trigger: 'openclaw',
        syncInputValue: true,
        clearInputOnSuccess: true,
        armCollapseOnSuccess: true
      });
      return;
    }

    const searchButton = document.getElementById('searchButton');
    if (!searchInput || !searchButton) return;

    searchInput.value = query;
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    searchInput.dispatchEvent(new Event('change', { bubbles: true }));
    searchButton.click();
  }

  function isExtractionFallbackContent(content) {
    return content.includes('无法自动提取') || content.includes('内容提取失败');
  }

  function isPlaceholderAnswerContent(content) {
    if (!window.AICompareExtraction?.looksLikePlaceholderAnswerContent) {
      return false;
    }
    return Boolean(window.AICompareExtraction.looksLikePlaceholderAnswerContent(content));
  }

  function matchesAny(text, patterns) {
    return patterns.some((pattern) => pattern.test(text));
  }

  function toArray(value) {
    if (Array.isArray(value)) {
      return value.map((item) => String(item || '').trim()).filter(Boolean);
    }
    if (typeof value === 'string' && value.trim()) {
      return [value.trim()];
    }
    return [];
  }

  function matchesConfiguredPatterns(text, patternConfigs) {
    const normalizedText = String(text || '');
    return toArray(patternConfigs).some((patternConfig) => {
      try {
        return new RegExp(patternConfig, 'i').test(normalizedText);
      } catch (_) {
        return false;
      }
    });
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

  function urlMatchesHistoryFeature(url, urlFeature) {
    if (!urlFeature) return true;
    try {
      return new URL(url).pathname.includes(urlFeature);
    } catch (_) {
      return false;
    }
  }

  function getSiteRuntimeConfig(siteConfig) {
    return siteConfig?.openclawRuntime || {};
  }

  function buildConfigPreflightResult(siteName, message, siteConfig = null) {
    const content = String(message || '').trim();
    return {
      siteName: String(siteName || '').trim(),
      status: 'error',
      content,
      url: String(siteConfig?.url || '').trim(),
      length: content.length,
      extractionMethod: 'config-preflight',
      error: content,
      runtimePhase: 'config_preflight',
      final: true,
      searchId: '',
      updatedAt: new Date().toISOString(),
      runtimeSource: 'config-preflight',
      attempts: 0,
      stableRounds: 0,
      iframeSrc: '',
      contentPreview: buildContentPreview(content),
      receivedChildUpdate: false,
      timeoutHint: ''
    };
  }

  async function resolveRequestedSites(siteNames) {
    const supportedSites = [];
    const immediateResults = [];
    const reportedSites = [];

    for (const rawSiteName of siteNames || []) {
      const siteName = String(rawSiteName || '').trim();
      if (!siteName) continue;
      reportedSites.push(siteName);

      const siteConfig = await getSiteConfigByName(siteName);
      if (!siteConfig) {
        immediateResults.push(buildConfigPreflightResult(
          siteName,
          `No site config found for ${siteName}.`
        ));
        continue;
      }

      if (siteConfig.supportIframe === false) {
        immediateResults.push(buildConfigPreflightResult(
          siteName,
          `${siteName} does not support iframe mode, so OpenClaw cannot run it inside the compare page.`,
          siteConfig
        ));
        continue;
      }

      supportedSites.push(siteName);
    }

    return {
      supportedSites,
      immediateResults,
      reportedSites
    };
  }

  function isRateLimitedContent(content, siteConfig) {
    if (matchesAny(content, [
      /消息限制已达/i,
      /usage limit/i,
      /rate limit/i,
      /too many requests/i,
      /wait\s+\d+\s*(?:hour|minute|second)/i,
      /quota exceeded/i,
      /已达到.*限制/i
    ])) {
      return true;
    }

    return matchesConfiguredPatterns(content, getSiteRuntimeConfig(siteConfig).rateLimitedPatterns);
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

  function isLandingPageContent(siteConfig, url, content) {
    const runtimeConfig = getSiteRuntimeConfig(siteConfig);
    const landingPageConfig = runtimeConfig.landingPage || {};
    const text = (content || '').trim();
    if (!text) {
      return false;
    }

    if (landingPageConfig.requireRootLikeUrl !== false && !isRootLikeUrl(url)) {
      return false;
    }

    return matchesConfiguredPatterns(text, landingPageConfig.contentPatterns);
  }

  function isNotSubmittedContent(siteConfig, url, content) {
    const runtimeConfig = getSiteRuntimeConfig(siteConfig);
    const notSubmittedConfig = runtimeConfig.notSubmitted || {};
    const text = (content || '').trim();
    if (!text) return false;

    if (notSubmittedConfig.requireRootLikeUrl === true && !isRootLikeUrl(url)) {
      return false;
    }

    const urlPatterns = toArray(notSubmittedConfig.urlPatterns);
    if (urlPatterns.length > 0 && !matchesConfiguredPatterns(url || '', urlPatterns)) {
      return false;
    }

    const contentPatterns = toArray(notSubmittedConfig.contentPatterns);
    if (contentPatterns.length === 0) {
      return false;
    }

    return matchesConfiguredPatterns(text, contentPatterns);
  }

  function looksLikePendingShellContent(content, siteConfig) {
    const runtimeConfig = getSiteRuntimeConfig(siteConfig);
    const pendingShellConfig = runtimeConfig.pendingShell || {};
    const normalized = String(content || '').trim();
    if (!normalized) return false;

    const shellSignals = toArray(pendingShellConfig.signals);
    if (shellSignals.length === 0) return false;

    const matchedSignals = shellSignals.filter((signal) => normalized.includes(signal));
    const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean);
    const likelyTitleList = lines.length >= (Number(pendingShellConfig.likelyTitleListMinLines) || 8)
      && lines.every((line) => line.length <= (Number(pendingShellConfig.likelyTitleListMaxLineLength) || 24));

    return matchedSignals.length >= (Number(pendingShellConfig.minMatches) || 3)
      || (matchedSignals.length >= (Number(pendingShellConfig.fallbackMinMatches) || 2) && likelyTitleList);
  }

  function matchesPendingContentPatterns(content, siteConfig) {
    const runtimeConfig = getSiteRuntimeConfig(siteConfig);
    const normalized = String(content || '').trim();
    if (!normalized) return false;
    return matchesConfiguredPatterns(normalized, runtimeConfig.pendingContentPatterns);
  }

  function isAcceptableReadyContent(siteConfig, content, url) {
    const normalized = String(content || '').trim();
    if (!normalized) return false;
    if (window.AICompareExtraction?.looksLikePlaceholderAnswerContent?.(normalized)) return false;
    if (matchesPendingContentPatterns(normalized, siteConfig)) return false;
    if (looksLikePendingShellContent(normalized, siteConfig)) return false;
    if (isLandingPageContent(siteConfig, url, normalized)) return false;
    if (isNotSubmittedContent(siteConfig, url, normalized)) return false;
    return true;
  }

  function classifyResponse(item, minChars, siteConfig) {
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

    if (isRateLimitedContent(content, siteConfig)) {
      if (isAcceptableReadyContent(siteConfig, content, url)) {
        return { status: 'ok', error: '' };
      }
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

    if (isPlaceholderAnswerContent(content)) {
      return { status: 'pending', error: '' };
    }

    if (matchesPendingContentPatterns(content, siteConfig)) {
      return { status: 'pending', error: '' };
    }

    if (isNotSubmittedContent(siteConfig, url, content)) {
      return { status: 'not_submitted', error: 'not_submitted' };
    }

    if (looksLikePendingShellContent(content, siteConfig)) {
      return { status: 'pending', error: '' };
    }

    if (isLandingPageContent(siteConfig, url, content)) {
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

  function buildContentPreview(content, maxLength = 160) {
    const normalized = String(content || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return '';
    return normalized.slice(0, Math.max(40, Number(maxLength) || 160));
  }

  function hasChildRuntimeUpdate(item) {
    if (!item) return false;
    if (item.runtimeSource && item.runtimeSource !== 'iframe-parent') return true;
    if (item.url || item.error || item.content) return true;
    return ['script_start', 'submitted', 'waiting_response', 'streaming', 'ready', 'error', 'timeout']
      .includes(String(item.runtimePhase || '').trim());
  }

  function buildTimeoutHint(item) {
    if (!item) return '';
    if (!hasChildRuntimeUpdate(item)) {
      return 'no_runtime_update_from_iframe';
    }
    if ((item.runtimePhase === 'submitted' || item.runtimePhase === 'waiting_response') && !String(item.content || '').trim()) {
      return 'submitted_without_extractable_content';
    }
    if (item.runtimePhase === 'streaming') {
      return 'streaming_never_stabilized';
    }
    if (!item.url && item.iframeSrc) {
      return 'iframe_src_only_no_runtime_url';
    }
    return 'generic_timeout';
  }

  function shouldKeepTimeoutContent(item, minChars) {
    const content = String(item?.content || '').trim();
    if (!content) return false;
    if (content === '?') return false;
    if (isExtractionFallbackContent(content)) return false;
    if (window.AICompareExtraction?.looksLikePlaceholderAnswerContent?.(content)) return false;
    return true;
  }

  function finalizeTimedOutResults(results, timeoutMs) {
    return (results || []).map((item) => {
      if (!item) return item;
      if (READY_STATUSES.has(item.status) || item.status === 'timeout' || item.status === 'error') {
        return item;
      }

      const timeoutMessage = buildSiteTimeoutMessage(item.siteName, timeoutMs, item.status);
      const keepContent = shouldKeepTimeoutContent(item);
      return {
        ...item,
        url: item.url || item.iframeSrc || '',
        status: keepContent ? 'ok' : 'timeout',
        content: keepContent ? item.content : timeoutMessage,
        error: keepContent ? '' : timeoutMessage,
        timeoutHint: item.timeoutHint || buildTimeoutHint(item),
        contentPreview: buildContentPreview(keepContent ? item.content : timeoutMessage)
      };
    });
  }

  function applyPerSiteTimeouts(results, unresolvedSinceMap, siteTimeoutMs, minChars, now = Date.now()) {
    return (results || []).map((item) => {
      if (!item?.siteName) {
        return item;
      }

      if (TERMINAL_STATUSES.has(item.status) || item.status === 'error') {
        unresolvedSinceMap.delete(item.siteName);
        return item;
      }

      const firstSeenAt = unresolvedSinceMap.get(item.siteName) || now;
      if (!unresolvedSinceMap.has(item.siteName)) {
        unresolvedSinceMap.set(item.siteName, firstSeenAt);
      }

      if (now - firstSeenAt < siteTimeoutMs) {
        return item;
      }

      const timeoutMessage = buildSiteTimeoutMessage(item.siteName, siteTimeoutMs, item.status);
      const keepContent = shouldKeepTimeoutContent(item);
      return {
        ...item,
        url: item.url || item.iframeSrc || '',
        status: keepContent ? 'ok' : 'timeout',
        content: keepContent ? item.content : timeoutMessage,
        error: keepContent ? '' : timeoutMessage,
        runtimePhase: 'timeout',
        final: true,
        timeoutHint: item.timeoutHint || buildTimeoutHint(item),
        contentPreview: buildContentPreview(keepContent ? item.content : timeoutMessage)
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

  function findIframeBySiteName(siteName) {
    if (!siteName) return null;
    return document.querySelector(`.ai-iframe[data-site="${siteName}"]`);
  }

  async function getSiteConfigByName(siteName) {
    return window.AICompareExtraction?.getSiteConfigByName?.(siteName) || null;
  }

  function buildIframeRequestId(prefix, siteName) {
    return `${prefix}-${String(siteName || 'site').replace(/\s+/g, '-').toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  async function extractDirectIframeResult(siteName, siteConfig = null) {
    const iframe = findIframeBySiteName(siteName);
    if (!iframe) return null;

    let iframeDoc = null;
    let iframeUrl = '';

    try {
      iframeDoc = iframe.contentDocument || iframe.contentWindow?.document || null;
      iframeUrl = iframe.contentWindow?.location?.href || iframe.getAttribute('src') || '';
    } catch (_) {
      return null;
    }

    if (!iframeDoc) {
      return null;
    }

    let content = '';
    try {
      if (window.AICompareExtraction?.extractDocumentContent) {
        const siteConfig = await getSiteConfigByName(siteName);
        const extracted = await window.AICompareExtraction.extractDocumentContent(iframeDoc, siteName, siteConfig || {}, {
          includePageTextFallback: true,
          pageTextMaxLength: 1000,
          waitTimeoutMs: 300
        });
        if (typeof extracted === 'string') {
          content = extracted;
        } else if (extracted && typeof extracted.content === 'string') {
          content = extracted.content;
        }
      }
    } catch (_) {
      // Ignore direct extraction errors and fall back to URL-only repair when possible.
    }

    const runtimeConfig = getSiteRuntimeConfig(siteConfig);
    const directReadConfig = runtimeConfig.sameOriginDirectRead || null;
    if (directReadConfig && (!content || looksLikePendingShellContent(content, siteConfig))) {
      const candidateSelectors = toArray(directReadConfig.selectors);
      const seenNodes = new Set();
      const candidates = [];

      candidateSelectors.forEach((selector) => {
        iframeDoc.querySelectorAll(selector).forEach((node) => {
          if (seenNodes.has(node)) return;
          seenNodes.add(node);
          candidates.push(node);
        });
      });

      const mainRoot = iframeDoc.querySelector('main');
      if (mainRoot) {
        mainRoot.querySelectorAll('div, article, section, p, li').forEach((node) => {
          if (seenNodes.has(node)) return;
          seenNodes.add(node);
          candidates.push(node);
        });
      }

      const scoredCandidates = candidates
        .map((node) => {
          const text = String(node.innerText || node.textContent || '').trim();
          const minTextLength = Number(directReadConfig.minTextLength) || 80;
          if (!text || text.length < minTextLength) return null;
          const excludeClosestSelectors = toArray(directReadConfig.excludeClosestSelectors);
          if (excludeClosestSelectors.some((selector) => {
            try {
              return Boolean(node.closest(selector));
            } catch (_) {
              return false;
            }
          })) {
            return null;
          }
          if (looksLikePendingShellContent(text, siteConfig)) {
            return null;
          }

          const rect = typeof node.getBoundingClientRect === 'function'
            ? node.getBoundingClientRect()
            : { width: 0, height: 0, top: 0 };
          if (rect.width === 0 || rect.height === 0) {
            return null;
          }

          let score = text.length;
          const preferSelectors = toArray(directReadConfig.preferSelectors);
          preferSelectors.forEach((selector, index) => {
            try {
              if (node.matches(selector)) {
                score += Math.max(1, preferSelectors.length - index) * 600;
              }
            } catch (_) {
              // ignore invalid selectors
            }
          });
          if (/\n{2,}/.test(text)) score += 300;
          if (/[：:。.!?]/.test(text)) score += 100;
          if (rect.top > (Number(directReadConfig.minTopOffset) || 180)) score += 250;
          if (rect.top > (Number(directReadConfig.preferLowerContentMinTopOffset) || 320)) score += 250;
          if (rect.height > (Number(directReadConfig.minHeight) || 120)) score += 200;
          if (node.childElementCount <= (Number(directReadConfig.maxChildElements) || 12)) score += 120;

          return {
            text,
            score
          };
        })
        .filter(Boolean)
        .sort((left, right) => right.score - left.score);

      if (scoredCandidates.length > 0) {
        content = scoredCandidates[0].text.trim();
      }
    }

    try {
      const siteConfig = await getSiteConfigByName(siteName);
      iframeUrl = window.AICompareExtraction?.resolveDocumentUrl?.(
        iframeDoc,
        iframeUrl || iframe.getAttribute('src') || window.location.href,
        siteConfig || {}
      ) || iframeUrl;
    } catch (_) {
      // Keep the current iframe URL if alternate-link extraction fails.
    }

    return {
      content: String(content || '').trim(),
      url: String(iframeUrl || '').trim()
    };
  }

  async function requestIframeExtractedResult(siteName, timeoutMs = 2500) {
    const iframe = findIframeBySiteName(siteName);
    if (!iframe?.contentWindow) {
      return null;
    }

    const requestId = buildIframeRequestId('extract', siteName);
    return new Promise((resolve) => {
      let finished = false;

      const cleanup = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
      };

      const onMessage = (event) => {
        if (event.source !== iframe.contentWindow) return;
        if (event.data?.type !== 'EXTRACTED_CONTENT') return;
        if (event.data?.requestId && event.data.requestId !== requestId) return;
        if (!event.data?.requestId && event.data?.siteName !== siteName) return;
        cleanup();
        resolve({
          content: String(event.data?.content || '').trim(),
          url: String(event.data?.url || '').trim()
        });
      };

      const timer = setTimeout(() => {
        cleanup();
        resolve(null);
      }, Math.max(300, Number(timeoutMs) || 0));

      window.addEventListener('message', onMessage);

      try {
        iframe.contentWindow.postMessage({
          type: 'EXTRACT_CONTENT',
          siteName,
          requestId
        }, '*');
      } catch (_) {
        cleanup();
        resolve(null);
      }
    });
  }

  async function requestIframePromptResponseResult(siteName, query, occurrenceIndex = 0, timeoutMs = 3000) {
    const iframe = findIframeBySiteName(siteName);
    if (!iframe?.contentWindow) {
      return null;
    }

    const normalizedQuery = String(query || '').trim();
    if (!normalizedQuery) {
      return null;
    }

    const requestId = buildIframeRequestId('prompt', siteName);
    return new Promise((resolve) => {
      let finished = false;

      const cleanup = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
      };

      const onMessage = (event) => {
        if (event.source !== iframe.contentWindow) return;
        if (event.data?.type !== 'EXTRACT_PROMPT_RESPONSE_RESULT') return;
        if (event.data?.requestId && event.data.requestId !== requestId) return;
        if (!event.data?.requestId && event.data?.siteName !== siteName) return;
        cleanup();
        resolve({
          content: String(event.data?.content || '').trim(),
          answers: Array.isArray(event.data?.answers) ? event.data.answers : [],
          found: event.data?.found !== false,
          error: String(event.data?.error || '').trim()
        });
      };

      const timer = setTimeout(() => {
        cleanup();
        resolve(null);
      }, Math.max(300, Number(timeoutMs) || 0));

      window.addEventListener('message', onMessage);

      try {
        iframe.contentWindow.postMessage({
          type: 'EXTRACT_PROMPT_RESPONSE',
          siteName,
          query: normalizedQuery,
          occurrenceIndex: Math.max(0, Number(occurrenceIndex) || 0),
          requestId
        }, '*');
      } catch (_) {
        cleanup();
        resolve(null);
      }
    });
  }

  function getResultQualityScore(item) {
    if (!item) return -1;

    const baseScores = {
      ok: 700,
      rate_limited: 650,
      login_required: 650,
      blocked: 650,
      landing_page: 620,
      not_submitted: 620,
      timeout: 500,
      streaming: 420,
      short: 300,
      pending: 200,
      queued: 150,
      executing: 140,
      extraction_error: 60,
      error: 50
    };

    const status = String(item.status || 'pending').trim();
    const contentLength = String(item.content || '').trim().length;
    const urlBonus = item.url ? 5 : 0;
    const extractionMethodBonusMap = {
      'prompt-response': 240,
      'extract-content': 80,
      'same-origin-direct': 40,
      'active-report': 0
    };
    const extractionBonus = extractionMethodBonusMap[String(item.extractionMethod || '').trim()] || 0;
    return (baseScores[status] || 0) + Math.min(contentLength, 4000) / 20 + urlBonus + extractionBonus;
  }

  function pickBetterResolvedResult(current, candidate) {
    if (!candidate) return current;
    if (!current) return candidate;
    return getResultQualityScore(candidate) > getResultQualityScore(current) ? candidate : current;
  }

  function shouldResolveWithFallbackSources(item, siteConfig) {
    if (!item) return true;

    const runtimeConfig = getSiteRuntimeConfig(siteConfig);
    if (looksLikePendingShellContent(item.content, siteConfig)) {
      return true;
    }

    if (matchesPendingContentPatterns(item.content, siteConfig)) {
      return true;
    }

    if (runtimeConfig.requireHistoryUrlFeature === true && !urlMatchesHistoryFeature(item.url || '', siteConfig?.historyHandler?.urlFeature || '')) {
      return true;
    }

    if (item.status === 'short' || item.status === 'extraction_error') {
      return true;
    }

    if (!item.content && (item.final || ['ready', 'error', 'timeout'].includes(item.runtimePhase))) {
      return true;
    }

    if (item.status === 'pending' && item.final === true) {
      return true;
    }

    return false;
  }

  function normalizeResolvedEntry(entry, minChars, fallbackSiteName, siteConfig, extractionMethod) {
    const normalized = normalizeRuntimeEntry(entry, minChars, fallbackSiteName, siteConfig);
    return {
      ...normalized,
      extractionMethod: extractionMethod || normalized.extractionMethod
    };
  }

  async function resolveSiteResultWithPriority(siteName, snapshotEntry, minChars) {
    const siteConfig = await getSiteConfigByName(siteName);
    let bestResult = normalizeResolvedEntry(snapshotEntry, minChars, siteName, siteConfig, 'active-report');

    const query = String(snapshotEntry?.query || '').trim();
    if (query) {
      const promptResponse = await requestIframePromptResponseResult(siteName, query, 0);
      const promptContent = String(promptResponse?.content || '').trim()
        || (Array.isArray(promptResponse?.answers)
          ? promptResponse.answers.map((item) => String(item || '').trim()).filter(Boolean).join('\n\n')
          : '');
      if (promptContent) {
        const promptEntry = normalizeResolvedEntry({
          ...snapshotEntry,
          siteName,
          content: promptContent,
          url: bestResult.url || snapshotEntry?.url || '',
          phase: snapshotEntry?.phase || 'ready',
          error: ''
        }, minChars, siteName, siteConfig, 'prompt-response');
        bestResult = pickBetterResolvedResult(bestResult, promptEntry);
      }
    }

    if (!shouldResolveWithFallbackSources(bestResult, siteConfig)) {
      return bestResult;
    }

    const extractedResult = await requestIframeExtractedResult(siteName);
    if (extractedResult && (extractedResult.content || extractedResult.url)) {
      const extractedEntry = normalizeResolvedEntry({
        ...snapshotEntry,
        siteName,
        content: extractedResult.content || bestResult.content,
        url: extractedResult.url || bestResult.url,
        phase: snapshotEntry?.phase || 'ready',
        error: ''
      }, minChars, siteName, siteConfig, 'extract-content');
      bestResult = pickBetterResolvedResult(bestResult, extractedEntry);
      if (!shouldResolveWithFallbackSources(extractedEntry, siteConfig)) {
        return bestResult;
      }
    }

    const directResult = await extractDirectIframeResult(siteName, siteConfig);
    if (directResult && (directResult.content || directResult.url)) {
      const directEntry = normalizeResolvedEntry({
        ...snapshotEntry,
        siteName,
        content: directResult.content || bestResult.content,
        url: directResult.url || bestResult.url,
        phase: snapshotEntry?.phase || 'ready',
        error: ''
      }, minChars, siteName, siteConfig, 'same-origin-direct');
      bestResult = pickBetterResolvedResult(bestResult, directEntry);
    }

    return bestResult;
  }

  function normalizeRuntimeEntry(entry, minChars, fallbackSiteName, siteConfig) {
    const siteName = entry?.siteName ? String(entry.siteName).trim() : String(fallbackSiteName || '').trim();
    const content = entry && typeof entry.content === 'string' ? entry.content.trim() : '';
    const url = entry?.url ? String(entry.url).trim() : '';
    const iframeSrc = entry?.iframeSrc ? String(entry.iframeSrc).trim() : '';
    const runtimePhase = entry?.phase ? String(entry.phase).trim() : 'pending';
    const runtimeError = entry?.error ? String(entry.error).trim() : '';
    const baseItem = {
      siteName,
      status: 'pending',
      content,
      url: url || iframeSrc,
      length: content.length,
      extractionMethod: 'active-report',
      error: runtimeError,
      runtimePhase,
      final: entry?.final === true,
      searchId: entry?.searchId || '',
      updatedAt: entry?.updatedAt || '',
      runtimeSource: entry?.source || 'iframe-parent',
      attempts: Number.isFinite(entry?.attempts) ? entry.attempts : 0,
      stableRounds: Number.isFinite(entry?.stableRounds) ? entry.stableRounds : 0,
      iframeSrc,
      contentPreview: buildContentPreview(content),
      receivedChildUpdate: hasChildRuntimeUpdate({
        runtimeSource: entry?.source || 'iframe-parent',
        runtimePhase,
        url: url || iframeSrc,
        error: runtimeError,
        content
      }),
      timeoutHint: ''
    };

    if (!entry) {
      return baseItem;
    }

    if (runtimePhase === 'timeout') {
      return {
        ...baseItem,
        status: 'timeout',
        timeoutHint: buildTimeoutHint(baseItem)
      };
    }

    const classified = classifyResponse({
      siteName,
      content,
      url,
      error: runtimePhase === 'error',
      errorMessage: runtimeError
    }, minChars, siteConfig);

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
        : ((classified.status === 'pending' || classified.status === 'short')
          && !window.AICompareExtraction?.looksLikePlaceholderAnswerContent?.(content)
          ? (isAcceptableReadyContent(siteConfig, content, url) ? 'ok' : classified.status)
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

  async function getRuntimeResults(siteNames, minChars) {
    const bridge = getSiteRuntimeBridge();
    if (!bridge) {
      throw new Error('aiCompareSiteRuntime is not available on window');
    }

    const snapshot = bridge.getSnapshot(siteNames);
    return Promise.all(siteNames.map((siteName) => {
      return resolveSiteResultWithPriority(siteName, snapshot?.bySite?.[siteName], minChars);
    }));
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
      urlRemoteMode: params.get('remote_mode') === '1',
      urlRemotePairId: (params.get('remote_pair_id') || '').trim(),
      urlRemoteRequestId: (params.get('remote_request_id') || '').trim(),
      urlCallback: (params.get('openclaw_callback') || '').trim(),
      urlTimeoutMs: parseNumber(params.get('openclaw_timeout_ms'), DEFAULT_TIMEOUT_MS),
      urlSiteTimeoutMs: parseNumber(params.get('openclaw_site_timeout_ms'), DEFAULT_SITE_TIMEOUT_MS),
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
    const resolvedSites = results.filter((item) => TERMINAL_STATUSES.has(item.status)).length;

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

  async function postRemoteRuntimeProgress(context, result, state, forceFinal) {
    if (!context || context.enabled !== true || !context.requestId || !result) {
      return;
    }

    const snapshot = debugSnapshotHash(result);
    if (!forceFinal && snapshot === state.lastPostedRemoteSnapshot) {
      return;
    }

    state.lastPostedRemoteSnapshot = snapshot;

    try {
      await chrome.runtime.sendMessage({
        action: 'remoteSearchProgress',
        requestId: context.requestId,
        pairId: context.pairId,
        result,
        completed: forceFinal === true
      });
    } catch (error) {
      console.warn('[openclaw-bridge] remote runtime progress post failed:', error);
    }
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
    const requestedSiteResolution = requestedSites.length > 0
      ? await resolveRequestedSites(requestedSites)
      : { supportedSites: [], immediateResults: [], reportedSites: [] };
    const callbackUrl = (typeof opts.callbackUrl === 'string' ? opts.callbackUrl : defaults.urlCallback || '').trim();
    const timeoutMs = Math.max(1000, parseNumber(opts.timeoutMs, defaults.urlTimeoutMs));
    const siteTimeoutMs = Math.max(1000, parseNumber(opts.siteTimeoutMs, defaults.urlSiteTimeoutMs));
    const pollIntervalMs = Math.max(500, parseNumber(opts.pollIntervalMs, defaults.urlPollIntervalMs));
    const minChars = Math.max(1, parseNumber(opts.minChars, defaults.urlMinChars));
    const stableRounds = Math.max(0, parseNumber(opts.stableRounds, defaults.urlStableRounds));
    const waitForIframesMs = Math.max(0, parseNumber(opts.waitForIframesMs, defaults.urlWaitForIframesMs));
    const forceRun = Boolean(opts.forceRun);
    const remoteContext = {
      enabled: opts.remoteMode === true || defaults.urlRemoteMode === true,
      pairId: (typeof opts.remotePairId === 'string' ? opts.remotePairId : defaults.urlRemotePairId || '').trim(),
      requestId: (typeof opts.remoteRequestId === 'string' ? opts.remoteRequestId : defaults.urlRemoteRequestId || '').trim()
    };

    const startAt = Date.now();
    const runId = `${startAt}-${Math.random().toString(36).slice(2, 8)}`;
    const callbackState = {
      lastPostedSnapshot: '',
      lastPostedRemoteSnapshot: ''
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

    const resolvedDefaultSites = requestedSites.length > 0 ? [] : await getDefaultSites();
    const immediateResults = requestedSiteResolution.immediateResults.slice();
    const reportedRequestedSites = requestedSiteResolution.reportedSites.slice();
    let frozenTargetSites = requestedSites.length > 0 ? requestedSiteResolution.supportedSites.slice() : [];
    const shouldSkipQueryTrigger = requestedSites.length > 0
      && frozenTargetSites.length === 0
      && immediateResults.length > 0;

    if (!shouldSkipQueryTrigger) {
      await ensureRunTriggered(query, forceRun);
    }

    if (!shouldSkipQueryTrigger) {
      const waitIframesUntil = Date.now() + waitForIframesMs;
      while (Date.now() < waitIframesUntil) {
        if (getOpenedSites().length > 0) break;
        await sleep(200);
      }
    }

    if (!shouldSkipQueryTrigger && !getSiteRuntimeBridge()) {
      throw new Error('aiCompareSiteRuntime is not available on window');
    }

    const stableState = new Map();
    const unresolvedSinceMap = new Map();
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
      const reportedTargetSites = requestedSites.length > 0 ? reportedRequestedSites : finalTargetSites;
      const combinedTargetCount = finalTargetSites.length + immediateResults.length;

      if (combinedTargetCount === 0) {
        updateDebugState({
          totalSites: 0,
          resolvedSites: 0,
          results: []
        });
        await sleep(Math.min(pollIntervalMs, 1000));
        continue;
      }

      if (finalTargetSites.length === 0) {
        normalizedResults = [];
        break;
      }

      try {
        normalizedResults = await getRuntimeResults(finalTargetSites, minChars);
        normalizedResults = applyPerSiteTimeouts(
          normalizedResults,
          unresolvedSinceMap,
          siteTimeoutMs,
          minChars
        );
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

      const combinedResults = normalizedResults.concat(immediateResults);

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
        targetSites: reportedTargetSites,
        results: combinedResults
      });

      updateDebugState({
        phase: 'running',
        totalSites: runningResult.totalSites,
        resolvedSites: runningResult.resolvedSites,
        results: runningResult.results
      });
      await maybePostProgress(callbackUrl, runningResult, callbackState, false);
      await postRemoteRuntimeProgress(remoteContext, runningResult, callbackState, false);

      const allResolved = normalizedResults.length > 0
        && combinedResults.every((item) => TERMINAL_STATUSES.has(item.status));

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

    const finalResults = normalizedResults.concat(immediateResults);
    const finalReportedSites = requestedSites.length > 0 ? reportedRequestedSites : finalTargetSites;

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
      targetSites: finalReportedSites,
      results: finalResults
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
    await postRemoteRuntimeProgress(remoteContext, result, callbackState, true);
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
          remoteMode: params.get('remote_mode') === '1',
          remotePairId: (params.get('remote_pair_id') || '').trim(),
          remoteRequestId: (params.get('remote_request_id') || '').trim(),
          forceRun: false
        }).catch((error) => {
          const remoteRequestId = (params.get('remote_request_id') || '').trim();
          const remotePairId = (params.get('remote_pair_id') || '').trim();
          if (params.get('remote_mode') === '1' && remoteRequestId) {
            chrome.runtime.sendMessage({
              action: 'remoteSearchProgress',
              requestId: remoteRequestId,
              pairId: remotePairId,
              completed: true,
              result: {
                runId: '',
                phase: 'error',
                query: (params.get('query') || '').trim(),
                timedOut: false,
                completed: false,
                finished: true,
                targetSites: [],
                totalSites: 0,
                resolvedSites: 0,
                results: [
                  {
                    siteName: 'AI Compare',
                    status: 'error',
                    content: '',
                    error: error && error.message ? error.message : String(error)
                  }
                ]
              }
            }).catch((remoteError) => {
              console.warn('[openclaw-bridge] remote callback error after auto run failure:', remoteError);
            });
          }
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
