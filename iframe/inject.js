
console.log('🎯 inject.js 脚本已加载');
const SiteLaunchUtils = window.SiteLaunchUtils || {};

// 从 DOM 节点获取 React Fiber（用于 Slate 等 React 编辑器）
function getReactFiber(domNode) {
  if (!domNode) return null;
  for (const key of Object.keys(domNode)) {
    if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) {
      return domNode[key];
    }
  }
  return null;
}

// 在 Fiber 树中查找带有 value/setInputValue/onValueUpdate/onChange 的节点
function findReactNodeWithValueSetter(fiber, maxDepth = 20, depth = 0, visited = new Set()) {
  if (!fiber || depth > maxDepth || visited.has(fiber)) return null;
  visited.add(fiber);
  try {
    const props = fiber.memoizedProps || {};
    if (typeof props.setInputValue === 'function' || typeof props.onValueUpdate === 'function' ||
        (typeof props.onChange === 'function' && props.value != null)) {
      return fiber;
    }
  } catch (_) {}
  return (
    findReactNodeWithValueSetter(fiber.child, maxDepth, depth + 1, visited) ||
    findReactNodeWithValueSetter(fiber.sibling, maxDepth, depth + 1, visited) ||
    findReactNodeWithValueSetter(fiber.return, maxDepth, depth + 1, visited)
  );
}

// 每个 iframe（每个注入实例）独立保存本次 PK 的历史上下文
let __aiCompareHistoryContext = {
  historyId: null,
  siteName: null
};

// 直接在 AI 站点使用时的历史记录上下文
let __directHistoryContext = {
  historyId: null,
  siteName: null
};

let __directHistoryInit = false;
let __directHistoryLastQuery = '';
let __directHistoryLastAt = 0;
let __directHistoryIsComposing = false;
let __userPromptButtonsInit = false;
let __currentInjectStepMeta = null;
let __timelinePromptPushInitialized = false;
let __timelinePromptPushTimer = null;
let __timelinePromptObserver = null;
let __timelinePromptLastSignature = null;
let __activeSearchMonitor = null;
let __lastStableSearchRuntime = null;

const ACTIVE_SEARCH_MONITOR_INTERVAL_MS = 1500;
const ACTIVE_SEARCH_MONITOR_SETTLE_MS = 400;
const ACTIVE_SEARCH_MONITOR_TIMEOUT_MS = 60000;
const ACTIVE_SEARCH_MONITOR_STABLE_ROUNDS = 2;

function t(key, fallback = '', substitutions = undefined) {
  try {
    const message = chrome?.i18n?.getMessage(key, substitutions);
    return message || fallback;
  } catch (_) {
    return fallback;
  }
}

function isRunningInExtensionIframe() {
  try {
    if (window.top === window) return false;
    const ancestors = window.location?.ancestorOrigins;
    if (ancestors && ancestors.length) {
      for (const origin of ancestors) {
        if (origin && origin.startsWith('chrome-extension://')) return true;
      }
    }
    const referrer = document.referrer || '';
    return referrer.startsWith('chrome-extension://');
  } catch (_) {
    return false;
  }
}

function isExtensionContextValid() {
  try {
    return !!(chrome && chrome.runtime && chrome.runtime.id);
  } catch (_) {
    return false;
  }
}

async function safeStorageGet(keys) {
  if (!isExtensionContextValid()) return {};
  try {
    return await chrome.storage.local.get(keys);
  } catch (error) {
    console.warn('DirectHistory: storage.get failed', error);
    return {};
  }
}

async function safeStorageSet(data) {
  if (!isExtensionContextValid()) return false;
  try {
    await chrome.storage.local.set(data);
    return true;
  } catch (error) {
    console.warn('DirectHistory: storage.set failed', error);
    return false;
  }
}

// 动态检查是否在 AI 站点中运行
async function isAISite() {
  try {
    // 使用新的统一站点检测器
    if (window.siteDetector) {
      const isAI = await window.siteDetector.isAISite();
      if (isAI) {
        console.log('🎯 使用新检测器匹配到 AI 站点');
      } else {
        console.log('🎯 使用新检测器：当前站点不在 AI 站点配置中', window.location.hostname);
        // 降级到原有逻辑再试一次
        if (window.getDefaultSites) {
          const sites = await window.getDefaultSites();
          console.log('🎯 降级检测：getDefaultSites 数量', sites?.length || 0);
          if (sites && Array.isArray(sites)) {
            const currentHostname = window.location.hostname;
            const matchedSite = sites.find(site => {
              if (!site.url || site.hidden) return false;
              try {
                const siteUrl = new URL(site.url);
                const siteHostname = siteUrl.hostname;
                return currentHostname === siteHostname ||
                       currentHostname.includes(siteHostname) ||
                       siteHostname.includes(currentHostname);
              } catch (_) {
                return false;
              }
            });
            if (matchedSite) {
              console.log('🎯 降级检测匹配到 AI 站点:', matchedSite.name);
              return true;
            }
          }
        }
      }
      return isAI;
    }
    
    // 降级到原有逻辑
    if (!window.getDefaultSites) {
      console.log('🎯 getDefaultSites 函数不可用，跳过处理');
      return false;
    }
    
    const sites = await window.getDefaultSites();
    
    if (!sites || !Array.isArray(sites)) {
      console.log('🎯 获取站点列表失败，跳过处理');
      return false;
    }
    
    const currentHostname = window.location.hostname;
    
    // 检查当前站点是否在配置中
    const matchedSite = sites.find(site => {
      if (!site.url || site.hidden) return false;
      
      try {
        const siteUrl = new URL(site.url);
        const siteHostname = siteUrl.hostname;
        
        // 检查域名匹配
        return currentHostname === siteHostname || 
               currentHostname.includes(siteHostname) || 
               siteHostname.includes(currentHostname);
      } catch (urlError) {
        return false;
      }
    });
    
    if (matchedSite) {
      console.log('🎯 匹配到 AI 站点:', matchedSite.name);
      return true;
    } else {
      console.log('🎯 当前站点不在 AI 站点配置中，跳过处理');
      return false;
    }
  } catch (error) {
    console.log('🎯 检查 AI 站点配置失败:', error);
    return false;
  }
}

// 等待页面加载完成后检查
let isAISiteChecked = false;
let isAISiteResult = false;

async function checkAISite() {
  if (!isAISiteChecked) {
    isAISiteResult = await isAISite();
    isAISiteChecked = true;
  }
  return isAISiteResult;
}

// 向父页面发送执行进度
function postInjectProgress(payload) {
  try {
    window.parent.postMessage({
      type: 'INJECT_PROGRESS',
      source: 'inject-script',
      ...payload
    }, '*');
  } catch (error) {
    // ignore
  }
}

function postSiteRuntimeUpdate(payload) {
  try {
    window.parent.postMessage({
      type: 'AI_COMPARE_SITE_RUNTIME',
      source: 'inject-script',
      ...payload
    }, '*');
  } catch (_) {
    // ignore
  }
}

function createSearchSessionId(siteName) {
  return `${String(siteName || 'site').replace(/\s+/g, '-').toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildSearchContentComparable(text) {
  return cleanExtractedText(String(text || '').replace(/\u200B/g, '')).replace(/\s+/g, ' ').trim();
}

function stopActiveSearchMonitor(reason = 'replaced') {
  if (!__activeSearchMonitor) return;
  if (__activeSearchMonitor.mutationObserver) {
    __activeSearchMonitor.mutationObserver.disconnect();
  }
  if (__activeSearchMonitor.settleTimer) {
    clearTimeout(__activeSearchMonitor.settleTimer);
  }
  if (__activeSearchMonitor.intervalTimer) {
    clearInterval(__activeSearchMonitor.intervalTimer);
  }
  __activeSearchMonitor.stopped = true;
  __activeSearchMonitor.stopReason = reason;
  __activeSearchMonitor = null;
}

async function resolveCurrentPageUrl(preferredSiteName = null) {
  try {
    const siteHandler = await getSiteHandler(window.location.hostname, preferredSiteName || __aiCompareHistoryContext.siteName || null);
    return window.AICompareExtraction?.resolveDocumentUrl?.(document, window.location.href, siteHandler || {}) || window.location.href;
  } catch (error) {
    console.log('⚠️ URL清理失败，使用原始URL:', error);
  }
  return window.location.href;
}

function urlMatchesHistoryFeature(url, urlFeature) {
  if (!urlFeature) return true;
  try {
    return new URL(url).pathname.includes(urlFeature);
  } catch (_) {
    return false;
  }
}

function toPatternArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }
  return [];
}

function matchesRuntimePatterns(text, patternConfigs) {
  const normalizedText = String(text || '');
  return toPatternArray(patternConfigs).some((patternConfig) => {
    try {
      return new RegExp(patternConfig, 'i').test(normalizedText);
    } catch (_) {
      return false;
    }
  });
}

function getSiteRuntimeConfig(siteHandler) {
  return siteHandler?.openclawRuntime || {};
}

function looksLikePendingShellFromConfig(content, siteHandler) {
  const runtimeConfig = getSiteRuntimeConfig(siteHandler);
  const pendingShellConfig = runtimeConfig.pendingShell || {};
  const normalized = cleanExtractedText(String(content || ''));
  if (!normalized) return false;

  const shellSignals = toPatternArray(pendingShellConfig.signals);
  if (shellSignals.length === 0) return false;

  const matchedSignals = shellSignals.filter((signal) => normalized.includes(signal));
  const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean);
  const likelyTitleList = lines.length >= (Number(pendingShellConfig.likelyTitleListMinLines) || 8)
    && lines.every((line) => line.length <= (Number(pendingShellConfig.likelyTitleListMaxLineLength) || 24));

  return matchedSignals.length >= (Number(pendingShellConfig.minMatches) || 3)
    || (matchedSignals.length >= (Number(pendingShellConfig.fallbackMinMatches) || 2) && likelyTitleList);
}

function looksLikeConfiguredPendingContent(content, siteHandler) {
  const runtimeConfig = getSiteRuntimeConfig(siteHandler);
  const normalized = cleanExtractedText(String(content || ''));
  if (!normalized) return false;

  return matchesRuntimePatterns(normalized, runtimeConfig.pendingContentPatterns);
}

function shouldTreatAsPendingSiteContent(siteHandler, content, url) {
  if (looksLikeConfiguredPendingContent(content, siteHandler)) {
    return true;
  }

  if (looksLikePendingShellFromConfig(content, siteHandler)) {
    return true;
  }

  const runtimeConfig = getSiteRuntimeConfig(siteHandler);
  if (runtimeConfig.requireHistoryUrlFeature === true && url && !urlMatchesHistoryFeature(url, siteHandler?.historyHandler?.urlFeature || '')) {
    return true;
  }

  return false;
}

function buildSiteRuntimeSignature(payload) {
  return JSON.stringify({
    siteName: String(payload?.siteName || '').trim(),
    searchId: String(payload?.searchId || '').trim(),
    phase: String(payload?.phase || '').trim(),
    final: Boolean(payload?.final),
    error: String(payload?.error || '').trim(),
    url: String(payload?.url || '').trim(),
    content: buildSearchContentComparable(payload?.content || '')
  });
}

function normalizeStableSearchRuntimePayload(payload = {}) {
  const siteName = String(payload.siteName || '').trim();
  if (!siteName) return null;

  return {
    siteName,
    query: String(payload.query || '').trim(),
    searchId: String(payload.searchId || '').trim(),
    phase: String(payload.phase || '').trim(),
    content: typeof payload.content === 'string' ? payload.content : '',
    url: String(payload.url || '').trim(),
    error: String(payload.error || '').trim(),
    final: payload.final === true,
    updatedAt: payload.updatedAt || new Date().toISOString(),
    stableRounds: Number.isFinite(payload.stableRounds) ? payload.stableRounds : 0
  };
}

function rememberStableSearchRuntime(payload) {
  const normalized = normalizeStableSearchRuntimePayload(payload);
  if (!normalized) return null;
  __lastStableSearchRuntime = normalized;
  return normalized;
}

function getActiveSearchMonitorSnapshot(siteName = null) {
  if (!__activeSearchMonitor || __activeSearchMonitor.stopped) {
    return null;
  }

  const normalizedSiteName = String(siteName || '').trim();
  if (normalizedSiteName && normalizedSiteName !== String(__activeSearchMonitor.siteName || '').trim()) {
    return null;
  }

  return normalizeStableSearchRuntimePayload({
    siteName: __activeSearchMonitor.siteName,
    query: __activeSearchMonitor.query,
    searchId: __activeSearchMonitor.searchId,
    phase: __activeSearchMonitor.phase,
    content: __activeSearchMonitor.lastContent,
    url: __activeSearchMonitor.lastUrl,
    error: '',
    final: __activeSearchMonitor.phase === 'ready',
    updatedAt: new Date().toISOString(),
    stableRounds: __activeSearchMonitor.stableRounds || 0
  });
}

function getLastStableSearchRuntime(siteName = null) {
  if (!__lastStableSearchRuntime) return null;
  const normalizedSiteName = String(siteName || '').trim();
  if (normalizedSiteName && normalizedSiteName !== String(__lastStableSearchRuntime.siteName || '').trim()) {
    return null;
  }
  return {
    ...__lastStableSearchRuntime
  };
}

function isReusableSearchRuntimePayload(payload, siteName = null) {
  if (!payload) return false;

  const normalizedSiteName = String(siteName || '').trim();
  if (normalizedSiteName && normalizedSiteName !== String(payload.siteName || '').trim()) {
    return false;
  }

  if (!String(payload.content || '').trim() && !String(payload.url || '').trim()) {
    return false;
  }

  if (String(payload.phase || '').trim() === 'error') {
    return false;
  }

  if (shouldTreatAsPendingSiteContent(payload.siteName, payload.content || '', payload.url || '')) {
    return false;
  }

  const stableRounds = Number(payload.stableRounds) || 0;
  return payload.final === true || stableRounds >= ACTIVE_SEARCH_MONITOR_STABLE_ROUNDS;
}

function getPreferredExtractContentResult(siteName = null) {
  const activeSnapshot = getActiveSearchMonitorSnapshot(siteName);
  if (isReusableSearchRuntimePayload(activeSnapshot, siteName)) {
    return activeSnapshot;
  }

  const stableSnapshot = getLastStableSearchRuntime(siteName);
  if (isReusableSearchRuntimePayload(stableSnapshot, siteName)) {
    return stableSnapshot;
  }

  return null;
}

async function postMonitorRuntimeUpdate(monitor, patch = {}) {
  if (!monitor || monitor.stopped || __activeSearchMonitor !== monitor) {
    return;
  }

  const payload = {
    siteName: monitor.siteName,
    query: monitor.query,
    searchId: monitor.searchId,
    phase: patch.phase || monitor.phase || 'submitted',
    content: typeof patch.content === 'string' ? patch.content : (monitor.lastContent || ''),
    url: patch.url || monitor.lastUrl || '',
    error: patch.error || '',
    final: Boolean(patch.final),
    startedAt: monitor.startedAt,
    submittedAt: monitor.submittedAt || monitor.startedAt,
    updatedAt: new Date().toISOString(),
    attempts: monitor.attempts || 0,
    stableRounds: monitor.stableRounds || 0
  };

  if (!payload.url) {
    payload.url = await resolveCurrentPageUrl(monitor.siteName);
  }

  if (typeof patch.content === 'string') {
    monitor.lastContent = patch.content;
  }
  if (payload.url) {
    monitor.lastUrl = payload.url;
  }
  monitor.phase = payload.phase;

  const signature = buildSiteRuntimeSignature(payload);
  if (!patch.force && signature === monitor.lastPostedSignature) {
    return;
  }
  monitor.lastPostedSignature = signature;
  if (payload.final || payload.phase === 'ready') {
    rememberStableSearchRuntime(payload);
  }
  postSiteRuntimeUpdate(payload);
}

function scheduleActiveSearchMonitor(monitor, delayMs = ACTIVE_SEARCH_MONITOR_SETTLE_MS) {
  if (!monitor || monitor.stopped || __activeSearchMonitor !== monitor) return;
  if (monitor.settleTimer) {
    clearTimeout(monitor.settleTimer);
  }
  monitor.settleTimer = setTimeout(() => {
    runActiveSearchMonitorCheck(monitor).catch((error) => {
      console.warn('主动搜索监控执行失败:', error);
    });
  }, Math.max(0, Number(delayMs) || 0));
}

async function runActiveSearchMonitorCheck(monitor) {
  if (!monitor || monitor.stopped || __activeSearchMonitor !== monitor || monitor.isChecking) {
    return;
  }

  monitor.isChecking = true;
  monitor.attempts = (monitor.attempts || 0) + 1;

  try {
    const elapsed = Date.now() - monitor.createdAt;
    if (elapsed >= monitor.timeoutMs) {
      await postMonitorRuntimeUpdate(monitor, {
        phase: 'timeout',
        final: true,
        error: t('openclawStatusTimedOut', 'Timed out')
      });
      stopActiveSearchMonitor('timeout');
      return;
    }

    const content = await extractPageContent(monitor.siteName);
    const normalizedContent = buildSearchContentComparable(content);
    const url = await resolveCurrentPageUrl(monitor.siteName);
    const siteHandler = await getSiteHandler(window.location.hostname, monitor.siteName);
    const requiredUrlFeature = String(siteHandler?.historyHandler?.urlFeature || '').trim();
    const hasRequiredUrl = urlMatchesHistoryFeature(url, requiredUrlFeature);

    if (!normalizedContent) {
      await postMonitorRuntimeUpdate(monitor, {
        phase: monitor.attempts <= 1 ? 'submitted' : 'waiting_response',
        content: '',
        url
      });
      return;
    }

    if (shouldTreatAsPendingSiteContent(siteHandler, content, url)) {
      await postMonitorRuntimeUpdate(monitor, {
        phase: monitor.attempts <= 1 ? 'submitted' : 'waiting_response',
        content: '',
        url
      });
      return;
    }

    const isErrorContent = content.includes('无法自动提取') || content.includes('内容提取失败');
    monitor.lastContent = content;
    monitor.lastUrl = url;

    if (normalizedContent !== monitor.lastComparableContent) {
      monitor.lastComparableContent = normalizedContent;
      monitor.stableRounds = 0;
      await postMonitorRuntimeUpdate(monitor, {
        phase: isErrorContent ? 'error' : 'streaming',
        content,
        url,
        error: isErrorContent ? content : ''
      });
      if (isErrorContent) {
        await postMonitorRuntimeUpdate(monitor, {
          phase: 'error',
          content,
          url,
          error: content,
          final: true,
          force: true
        });
        stopActiveSearchMonitor('error-content');
      }
      return;
    }

    monitor.stableRounds = (monitor.stableRounds || 0) + 1;
    const isReady = monitor.stableRounds >= ACTIVE_SEARCH_MONITOR_STABLE_ROUNDS && hasRequiredUrl;
    await postMonitorRuntimeUpdate(monitor, {
      phase: isReady ? 'ready' : 'streaming',
      content,
      url,
      final: isReady
    });

    if (isReady) {
      stopActiveSearchMonitor('ready');
    }
  } finally {
    monitor.isChecking = false;
  }
}

function startActiveSearchMonitor(siteName, query, searchId) {
  stopActiveSearchMonitor('new-search');
  __lastStableSearchRuntime = null;

  const monitor = {
    siteName,
    query,
    searchId: searchId || createSearchSessionId(siteName),
    createdAt: Date.now(),
    startedAt: new Date().toISOString(),
    submittedAt: new Date().toISOString(),
    timeoutMs: ACTIVE_SEARCH_MONITOR_TIMEOUT_MS,
    attempts: 0,
    stableRounds: 0,
    lastComparableContent: '',
    lastContent: '',
    lastUrl: '',
    lastPostedSignature: '',
    isChecking: false,
    stopped: false,
    settleTimer: null,
    intervalTimer: null,
    mutationObserver: null,
    phase: 'submitted'
  };

  __activeSearchMonitor = monitor;
  postMonitorRuntimeUpdate(monitor, {
    phase: 'submitted',
    force: true
  }).catch(() => {});

  if (typeof MutationObserver === 'function') {
    const targetNode = document.body || document.documentElement;
    if (targetNode) {
      monitor.mutationObserver = new MutationObserver(() => {
        scheduleActiveSearchMonitor(monitor);
      });
      monitor.mutationObserver.observe(targetNode, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }
  }

  monitor.intervalTimer = setInterval(() => {
    scheduleActiveSearchMonitor(monitor, 0);
  }, ACTIVE_SEARCH_MONITOR_INTERVAL_MS);

  scheduleActiveSearchMonitor(monitor, ACTIVE_SEARCH_MONITOR_SETTLE_MS);
  return monitor;
}

function createRetryExhaustedError(message) {
  const error = new Error(message);
  error.manualRetryRequired = true;
  return error;
}

const DEFAULT_STEP_MAX_ATTEMPTS = 10;

function reportStepRetry(attempts, maxAttempts) {
  if (!__currentInjectStepMeta) return;
  const description = __currentInjectStepMeta.description || __currentInjectStepMeta.action || '';
  const retryInfo = t('injectProgressRetryInfo', '重试 $1/$2', [String(attempts), String(maxAttempts)]);
  postInjectProgress({
    siteName: __currentInjectStepMeta.siteName,
    status: 'step',
    stepIndex: __currentInjectStepMeta.stepIndex,
    totalSteps: __currentInjectStepMeta.totalSteps,
    description,
    action: __currentInjectStepMeta.action,
    retryAttempts: attempts,
    retryMax: maxAttempts
  });
  console.log(`🔁 ${__currentInjectStepMeta.siteName || ''} ${description} ${retryInfo}`);
}

function getStepTimeoutMs(step) {
  if (!step) return 15000;
  if (Number.isFinite(step.timeoutMs)) return step.timeoutMs;
  const retryInterval = step.retryInterval || 200;
  const maxAttempts = step.maxAttempts || (step.waitForElement ? DEFAULT_STEP_MAX_ATTEMPTS : (step.retryOnDisabled ? DEFAULT_STEP_MAX_ATTEMPTS : 1));
  if (step.action === 'wait') {
    const rawDuration = Number(step.duration);
    const duration = Number.isFinite(rawDuration) && rawDuration >= 0 ? rawDuration : 0;
    return duration + 2000;
  }
  if (step.waitForElement || step.retryOnDisabled || step.maxAttempts) {
    return maxAttempts * retryInterval + 2000;
  }
  return 15000;
}

// 通用的配置化站点处理器 - 基于流程的标准化处理
async function executeSiteHandler(query, handlerConfig, siteName = null) {
  console.log('🚀 executeSiteHandler 开始执行');
  console.log('🔍 调试信息 - 查询内容:', query);
  console.log('🔍 调试信息 - 处理器配置:', handlerConfig);
  
  if (!handlerConfig || !handlerConfig.steps) {
    console.error('❌ 无效的处理器配置');
    if (siteName) {
      postInjectProgress({
        siteName,
        status: 'error',
        errorMessage: t('injectProgressErrorInvalidHandler', '无效的处理器配置')
      });
    }
    return;
  }

  console.log('✅ 开始执行配置化处理器，步骤数:', handlerConfig.steps.length);
  if (siteName) {
    postInjectProgress({
      siteName,
      status: 'start',
      totalSteps: handlerConfig.steps.length
    });
  }

  for (let i = 0; i < handlerConfig.steps.length; i++) {
    const step = handlerConfig.steps[i];
    console.log(`执行步骤 ${i + 1}:`, step.action);
    __currentInjectStepMeta = {
      siteName,
      stepIndex: i + 1,
      totalSteps: handlerConfig.steps.length,
      description: step.description || '',
      action: step.action || ''
    };

    try {
      if (siteName) {
        postInjectProgress({
          siteName,
          status: 'step',
          stepIndex: i + 1,
          totalSteps: handlerConfig.steps.length,
          description: step.description || step.action || '',
          action: step.action || ''
        });
      }
      const stepPromise = (async () => {
        switch (step.action) {
          case 'click':
            await executeClick(step);
            break;
          case 'focus':
            await executeFocus(step);
            break;
          case 'setValue':
            await executeSetValue(step, query);
            break;
          case 'triggerEvents':
            await executeTriggerEvents(step);
            break;
          case 'sendKeys':
            await executeSendKeys(step, query);
            break;
          case 'replace':
            await executeReplace(step, query);
            break;
          case 'wait':
            await executeWait(step);
            break;
          case 'custom':
            await executeCustom(step, query);
            break;
          case 'paste':
            await executePaste(step);
            break;
          default:
            console.warn('未知的步骤类型:', step.action);
        }
      })();

      const timeoutMs = getStepTimeoutMs(step);
      await Promise.race([
        stepPromise,
        new Promise((_, reject) => {
          setTimeout(() => {
            const label = step.description || step.action || '';
            const base = t('injectProgressErrorStepTimeout', '步骤超时');
            reject(createRetryExhaustedError(label ? `${base}：${label}` : base));
          }, timeoutMs);
        })
      ]);

      // 步骤间等待
      if (step.waitAfter) {
        await new Promise(resolve => setTimeout(resolve, step.waitAfter));
      }
      if (siteName) {
        postInjectProgress({
          siteName,
          status: 'step_complete',
          stepIndex: i + 1,
          totalSteps: handlerConfig.steps.length,
          description: step.description || step.action || '',
          action: step.action || ''
        });
      }
    } catch (error) {
      console.error(`步骤 ${i + 1} 执行失败:`, error);
      if (step.required === false) {
        console.warn(`⚠️ 可选步骤 ${i + 1} 失败，已跳过:`, error?.message || String(error));
        __currentInjectStepMeta = null;
        continue;
      }
      const manualRetryRequired = error?.manualRetryRequired === true ||
        step?.retryOnDisabled === true ||
        step?.waitForElement === true ||
        typeof step?.maxAttempts === 'number';
      if (siteName) {
        postInjectProgress({
          siteName,
          status: 'error',
          stepIndex: i + 1,
          totalSteps: handlerConfig.steps.length,
          description: step.description || step.action || '',
          action: step.action || '',
          errorMessage: error?.message || String(error),
          manualRetryRequired
        });
      }
      throw error;
    }
    __currentInjectStepMeta = null;
  }

  console.log('配置化处理器执行完成');
  if (siteName) {
    postInjectProgress({
      siteName,
      status: 'complete',
      totalSteps: handlerConfig.steps.length
    });
  }
}

// 执行粘贴操作
async function executePaste(step) {
  console.log('🎯 执行粘贴操作');
  console.log('粘贴步骤配置:', step);
  
  // 验证配置加载状态
  console.log('🔍 配置验证:');
  console.log('- window.AppConfigManager 存在:', !!window.AppConfigManager);
  if (window.AppConfigManager) {
    try {
      const testTypes = await window.AppConfigManager.getAllSupportedFileTypes();
      console.log('- 配置加载成功，支持文件类型数量:', testTypes.length);
    } catch (error) {
      console.error('- 配置加载失败:', error);
    }
  }
  
  try {
    // 优先使用全局存储的文件数据（来自父页面传递）
    if (window._currentFileData) {
      console.log('🎯 使用传递的文件数据进行粘贴');
      await handleFileDataPaste(window._currentFileData);
      return;
    }
    
    // 检查剪贴板权限
    const permissionStatus = await navigator.permissions.query({ name: 'clipboard-read' });
    console.log('剪贴板权限状态:', permissionStatus.state);
    console.log('权限详情:', permissionStatus);
    
    if (permissionStatus.state === 'denied') {
      console.log('❌ 剪贴板权限被拒绝，无法执行粘贴操作');
      throw new Error('剪贴板权限被拒绝');
    }
    
    if (permissionStatus.state === 'prompt') {
      console.log('🔄 剪贴板权限需要用户授权，尝试请求权限...');
    }
    
    // 确保文档获得焦点（解决多iframe环境下的焦点问题）
    console.log('🔍 检查文档焦点状态...');
    if (!document.hasFocus()) {
      console.log('⚠️ 文档没有焦点，尝试获取焦点...');
      window.focus();
      // 等待一小段时间让焦点生效
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // 检查当前聚焦的元素
    const activeElement = document.activeElement;
    console.log('当前聚焦元素:', activeElement);
    
    // 读取剪贴板内容
    console.log('📋 尝试读取剪贴板内容...');
    let clipboardData;
    try {
      clipboardData = await navigator.clipboard.read();
    } catch (clipboardError) {
      console.log('❌ 剪贴板读取失败:', clipboardError.message);
      
      // 如果是焦点问题，尝试通过用户交互触发
      if (clipboardError.name === 'NotAllowedError' && clipboardError.message.includes('not focused')) {
        console.log('🔄 检测到焦点问题，尝试通过模拟用户交互解决...');
        
        // 创建一个临时的用户交互事件
        const tempButton = document.createElement('button');
        tempButton.style.position = 'fixed';
        tempButton.style.top = '-1000px';
        tempButton.style.left = '-1000px';
        tempButton.style.opacity = '0';
        tempButton.style.pointerEvents = 'none';
        document.body.appendChild(tempButton);
        
        // 模拟点击事件来获取用户交互上下文
        tempButton.focus();
        tempButton.click();
        
        // 再次尝试读取剪贴板
        try {
          clipboardData = await navigator.clipboard.read();
          console.log('✅ 通过用户交互成功读取剪贴板');
        } catch (retryError) {
          console.log('❌ 重试仍然失败:', retryError.message);
          throw retryError;
        } finally {
          // 清理临时按钮
          document.body.removeChild(tempButton);
        }
      } else {
        throw clipboardError;
      }
    }
    console.log('剪切板内容:', clipboardData);
    console.log('剪贴板项目数量:', clipboardData.length);
    
    if (clipboardData.length === 0) {
      console.log('❌ 剪贴板为空');
      throw new Error('剪贴板为空');
    }
    
    // 处理剪贴板中的文件
    // 从配置中获取支持的文件类型
    const fileTypes = await window.AppConfigManager.getAllSupportedFileTypes();
    console.log('从配置获取支持的文件类型:', fileTypes);
    
    for (const item of clipboardData) {
      console.log('剪贴板项目类型:', item.types);
      
      // 检查是否是文件类型
      const isFile = fileTypes.some(type => item.types.includes(type));
      
      if (isFile) {
        console.log('🎯 检测到文件在剪贴板中，类型:', item.types);
        
        // 尝试获取文件数据
        let file = null;
        let fileType = null;
        
        // 首先尝试获取 Files 类型
        if (item.types.includes('Files')) {
          file = await item.getType('Files');
          fileType = 'Files';
        } else {
          // 如果没有 Files 类型，尝试获取其他文件类型
          for (const type of fileTypes) {
            if (item.types.includes(type)) {
              file = await item.getType(type);
              fileType = type;
              break;
            }
          }
        }
        
        console.log('文件对象:', file);
        console.log('文件类型:', fileType);
        
        // 创建 DataTransfer 对象
        const dataTransfer = new DataTransfer();
        if (file) {
          // 如果获取到的是 Blob，需要转换为 File 对象 - 使用智能文件名生成
          let fileToAdd = file;
          if (file instanceof Blob && !(file instanceof File)) {
            // 使用智能文件名生成
            let fileName = null;
            if (window.AppConfigManager) {
              fileName = await window.AppConfigManager.generateFileName(null, fileType, 'clipboard');
              console.log('🎯 生成智能文件名:', fileName, '基于 MIME 类型:', fileType);
            } else {
              // 降级处理
              const extension = await getFileExtensionFromMimeType(fileType);
              fileName = `clipboard-${Date.now()}.${extension}`;
            }
            
            fileToAdd = new File([file], fileName, { type: fileType });
            console.log('将 Blob 转换为 File:', {
              name: fileToAdd.name,
              type: fileToAdd.type,
              size: fileToAdd.size,
              originalType: fileType
            });
          }
          dataTransfer.items.add(fileToAdd);
        }
        
        // 创建文件粘贴事件
        const pasteEvent = new ClipboardEvent('paste', {
          clipboardData: dataTransfer,
          bubbles: true,
          cancelable: true
        });
        
        // 触发粘贴事件到当前聚焦的元素
        const activeElement = document.activeElement;
        if (activeElement) {
          console.log('已向聚焦元素发送文件粘贴事件:', activeElement);
          activeElement.dispatchEvent(pasteEvent);
        } else {
          console.log('没有聚焦的元素，向 document 发送文件粘贴事件');
          document.dispatchEvent(pasteEvent);
        }
        
        console.log('✅ 文件粘贴事件已触发');
        
      } else if (item.types.includes('text/plain')) {
        console.log('🎯 检测到文本在剪贴板中');
        
        // 获取文本内容
        const textContent = await item.getType('text/plain');
        console.log('文本内容:', textContent);
        
        // 创建 DataTransfer 对象
        const dataTransfer = new DataTransfer();
        dataTransfer.setData('text/plain', textContent);
        
        // 创建文本粘贴事件
        const pasteEvent = new ClipboardEvent('paste', {
          clipboardData: dataTransfer,
          bubbles: true,
          cancelable: true
        });
        
        // 触发粘贴事件
        const activeElement = document.activeElement;
        if (activeElement) {
          console.log('已向聚焦元素发送文本粘贴事件:', activeElement);
          activeElement.dispatchEvent(pasteEvent);
        } else {
          console.log('没有聚焦的元素，向 document 发送文本粘贴事件');
          document.dispatchEvent(pasteEvent);
        }
        
        console.log('✅ 文本粘贴事件已触发');
      }
    }
    
    console.log('✅ 粘贴操作执行完成');
    
  } catch (error) {
    console.error('❌ 粘贴操作失败:', error);
    throw error;
  }
}

// 执行点击操作
async function executeClick(step) {
  let element = null;
  let foundSelector = null;
  
  // 支持多个选择器
  const selectors = Array.isArray(step.selector) ? step.selector : [step.selector];
  
  for (const selector of selectors) {
    // 如果选择器是特殊格式 "text:内容"，则通过文本内容查找
    if (selector.startsWith('text:')) {
      const textToFind = selector.substring(5);
      // 查找所有按钮，匹配文本内容
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        const text = btn.textContent || btn.innerText || btn.getAttribute('aria-label') || '';
        if (text.toLowerCase().includes(textToFind.toLowerCase())) {
          element = btn;
          foundSelector = selector;
          break;
        }
      }
      if (element) break;
    } else {
      // 标准 CSS 选择器
      element = document.querySelector(selector);
      if (element) {
        foundSelector = selector;
        break;
      }
    }
  }
  
  if (!element) {
    throw new Error(t('injectProgressErrorElementNotFound', '未找到元素'));
  }
  
  if (step.condition) {
    // 检查条件
    const conditionElement = document.querySelector(step.condition.selector);
    if (!conditionElement) {
      console.log(`条件元素不存在，跳过点击: ${step.condition.selector}`);
      return;
    }
  }

  // 如果指定了重试机制，则使用重试逻辑
  if (step.retryOnDisabled) {
    const maxAttempts = step.maxAttempts || DEFAULT_STEP_MAX_ATTEMPTS;
    const retryInterval = step.retryInterval || 200;
    let attempts = 0;
    
    const tryClick = () => {
      if (!element.disabled) {
        element.click();
        console.log('点击元素:', foundSelector);
        return true;
      }
      
    attempts++;
    if (attempts < maxAttempts) {
      reportStepRetry(attempts, maxAttempts);
      console.log(`按钮被禁用，${retryInterval}ms后重试 (${attempts}/${maxAttempts})`);
      return new Promise(resolve => {
        setTimeout(() => resolve(tryClick()), retryInterval);
      });
      } else {
        console.error('达到最大尝试次数，按钮仍然被禁用');
        throw createRetryExhaustedError(t('injectProgressErrorButtonDisabled', '按钮达到最大重试次数仍被禁用'));
      }
    };
    
    // 延迟100ms开始尝试，给页面一些时间
    await new Promise((resolve, reject) => {
      setTimeout(async () => {
        try {
          await tryClick();
          resolve();
        } catch (error) {
          reject(error);
        }
      }, 100);
    });
  } else {
    element.click();
    console.log('点击元素:', foundSelector);
  }
}

// 执行聚焦操作
async function executeFocus(step) {
  let element = null;
  let foundSelector = null;
  
  // 支持多个选择器
  const selectors = Array.isArray(step.selector) ? step.selector : [step.selector];
  
  // 如果指定了重试机制，使用重试逻辑
  const maxAttempts = step.maxAttempts || (step.waitForElement ? DEFAULT_STEP_MAX_ATTEMPTS : 1);
  const retryInterval = step.retryInterval || 200;
  let attempts = 0;
  
  const tryFocus = async () => {
    // 尝试查找元素
    for (const selector of selectors) {
      element = document.querySelector(selector);
      if (element) {
        foundSelector = selector;
        break;
      }
    }
    
    if (element) {
      // 元素找到了，执行聚焦
      element.focus();
      console.log('聚焦元素:', foundSelector);
      if (document.activeElement === element) {
        return;
      }
      attempts++;
      if (attempts < maxAttempts && (step.waitForElement || step.maxAttempts)) {
        reportStepRetry(attempts, maxAttempts);
        console.log(`焦点未生效，${retryInterval}ms后重试 (${attempts}/${maxAttempts})`);
        await new Promise(resolve => setTimeout(resolve, retryInterval));
        return tryFocus();
      }
      throw createRetryExhaustedError(t('injectProgressErrorElementNotFound', '未找到元素'));
    }
    
    // 元素未找到，如果允许重试则重试
    attempts++;
    if (attempts < maxAttempts && (step.waitForElement || step.maxAttempts)) {
      reportStepRetry(attempts, maxAttempts);
      console.log(`元素未找到，${retryInterval}ms后重试 (${attempts}/${maxAttempts}): ${selectors.join(', ')}`);
      await new Promise(resolve => setTimeout(resolve, retryInterval));
      return tryFocus();
    } else {
      throw createRetryExhaustedError(t('injectProgressErrorElementNotFound', '未找到元素'));
    }
  };
  
  await tryFocus();
}

function setNativeFormControlValue(element, value) {
  if (!element || typeof value !== 'string') return;

  const prototype =
    element.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement?.prototype
      : window.HTMLInputElement?.prototype;
  const descriptor = prototype ? Object.getOwnPropertyDescriptor(prototype, 'value') : null;

  if (descriptor && typeof descriptor.set === 'function') {
    descriptor.set.call(element, value);
  } else {
    element.value = value;
  }

  if (typeof element.setSelectionRange === 'function') {
    try {
      element.setSelectionRange(value.length, value.length);
    } catch (_) {}
  }
}

// 执行设置值操作
async function executeSetValue(step, query) {
  let element = null;
  let foundSelector = null;
  
  // 支持多个选择器
  const selectors = Array.isArray(step.selector) ? step.selector : [step.selector];
  
  // 如果指定了重试机制，使用重试逻辑
  const maxAttempts = step.maxAttempts || (step.waitForElement ? DEFAULT_STEP_MAX_ATTEMPTS : 1);
  const retryInterval = step.retryInterval || 200;
  let attempts = 0;
  
  const trySetValue = async () => {
    // 尝试查找元素
    for (const selector of selectors) {
      element = document.querySelector(selector);
      if (element) {
        foundSelector = selector;
        break;
      }
    }
    
    if (!element) {
      // 元素未找到，如果允许重试则重试
      attempts++;
      if (attempts < maxAttempts && (step.waitForElement || step.maxAttempts)) {
        reportStepRetry(attempts, maxAttempts);
        console.log(`元素未找到，${retryInterval}ms后重试 (${attempts}/${maxAttempts}): ${selectors.join(', ')}`);
        await new Promise(resolve => setTimeout(resolve, retryInterval));
        return trySetValue();
      } else {
        throw createRetryExhaustedError(t('injectProgressErrorElementNotFound', '未找到元素'));
      }
    }
    
    // 元素找到，继续执行设置值
    return element;
  };
  
  element = await trySetValue();

  if (step.inputType === 'contenteditable') {
    // 检查是否是 Slate 编辑器（通义千问等，通过 data-slate-editor 属性）
    const isSlateEditor = element.getAttribute('data-slate-editor') === 'true';
    if (isSlateEditor) {
      const isQwenSite = window.location.hostname.includes('qianwen.com');
      console.log('检测到 Slate 编辑器，尝试同步内部状态');
      element.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      const p = element.querySelector('p[data-slate-node="element"]') || element.querySelector('p');
      const getSlateText = () => {
        const strings = element.querySelectorAll('[data-slate-string]');
        const fromStrings = Array.from(strings).map(node => node.textContent || '').join('');
        if (fromStrings.length > 0) return fromStrings;
        // 千问等：execCommand 后内容可能在 data-slate-zero-width 中，用 innerText 兜底，避免误判后覆盖 DOM 导致发送按钮仍灰
        const visible = (element.innerText || element.textContent || '').trim();
        const placeholder = (element.getAttribute('data-placeholder') || '').trim();
        if (visible && visible !== placeholder) return visible;
        return '';
      };
      const normalizeText = (text) => (text || '').replace(/\s+/g, '').trim();
      const slateHasText = () => normalizeText(getSlateText()).length > 0;
      const slateMatchesQuery = () => normalizeText(getSlateText()) === normalizeText(query);
      const waitForSlateUpdate = async (attempts = 3, delay = 30) => {
        for (let i = 0; i < attempts; i++) {
          if (slateMatchesQuery() || slateHasText()) return true;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        return false;
      };
      const collapseToSingleQuery = async () => {
        if (!query) return;
        const current = normalizeText(getSlateText());
        const normalizedQuery = normalizeText(query);
        if (!current || !normalizedQuery) return;
        if (current === normalizedQuery) return;
        if (!current.includes(normalizedQuery)) return;
        const repeated = current.split(normalizedQuery).filter(Boolean).length;
        if (repeated < 1) return;
        const fallbackP = element.querySelector('p[data-slate-node=\"element\"]') || element.querySelector('p');
        if (fallbackP) {
          fallbackP.innerHTML = '';
          const textSpan = document.createElement('span');
          textSpan.setAttribute('data-slate-node', 'text');
          const leafSpan = document.createElement('span');
          leafSpan.setAttribute('data-slate-leaf', 'true');
          const stringSpan = document.createElement('span');
          stringSpan.setAttribute('data-slate-string', 'true');
          stringSpan.textContent = query;
          leafSpan.appendChild(stringSpan);
          textSpan.appendChild(leafSpan);
          fallbackP.appendChild(textSpan);
        }
        element.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: query }));
        element.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: query }));
        await waitForSlateUpdate();
        console.log('Slate: 已强制去重重复内容');
      };
      let slateUpdated = false;

      if (isQwenSite && query) {
        const normalizedQuery = normalizeText(query);
        const now = Date.now();
        if (window.__qwenLastQuery === normalizedQuery && window.__qwenLastQueryAt && now - window.__qwenLastQueryAt < 3000) {
          console.log('Qwen: 重复写入拦截，跳过');
          return;
        }
        window.__qwenLastQuery = normalizedQuery;
        window.__qwenLastQueryAt = now;

        // 方法1（优先）：通过 beforeinput 事件写入
        // Slate 编辑器原生监听 beforeinput 事件，会 preventDefault 并通过内部逻辑处理文本插入，
        // 确保 data-slate-string 等内部状态正确同步，发送按钮也会正常启用
        if (!slateUpdated) try {
          element.focus();
          await new Promise(r => setTimeout(r, 50));
          // 模拟用户点击交互，确保编辑器建立正确的选区
          element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
          element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
          element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          element.focus();
          await new Promise(r => setTimeout(r, 50));
          // 将光标定位到编辑器段落末尾
          const curP = element.querySelector('p[data-slate-node="element"]') || element.querySelector('p');
          if (curP) {
            sel.removeAllRanges();
            range.selectNodeContents(curP);
            range.collapse(false);
            sel.addRange(range);
          }
          element.dispatchEvent(new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: query,
            composed: true
          }));
          slateUpdated = await waitForSlateUpdate(5, 60);
          if (slateUpdated) {
            console.log('Qwen: beforeinput 事件写入完成');
            return;
          }
        } catch (e1) {
          console.log('Qwen: beforeinput 事件写入失败', e1);
        }

        // 方法2：通过 React Fiber 内部 setter 写入
        if (!slateUpdated) try {
          const fiber = getReactFiber(element);
          const node = findReactNodeWithValueSetter(fiber);
          if (node && node.memoizedProps) {
            const props = node.memoizedProps;
            if (typeof props.setInputValue === 'function') {
              props.setInputValue(query);
            } else if (typeof props.onValueUpdate === 'function') {
              props.onValueUpdate(query);
            } else if (typeof props.onChange === 'function' && Array.isArray(props.value)) {
              const newValue = [{ type: 'paragraph', children: [{ text: query }] }];
              props.onChange(newValue);
            }
            slateUpdated = await waitForSlateUpdate();
            if (slateUpdated) {
              console.log('Qwen: React 路径写入完成');
              return;
            }
          }
        } catch (e2) {
          console.log('Qwen: React 路径失败', e2);
        }

        // 方法3：整段 execCommand insertText
        if (!slateUpdated) try {
          element.focus();
          sel.removeAllRanges();
          if (p) range.selectNodeContents(p);
          else range.selectNodeContents(element);
          sel.addRange(range);
          if (document.execCommand('insertText', false, query)) {
            slateUpdated = await waitForSlateUpdate(10, 60);
            if (slateUpdated) {
              console.log('Qwen: execCommand insertText 完成');
              return;
            }
          }
        } catch (e3) {
          console.log('Qwen: execCommand 失败', e3);
        }

        // 方法4（兜底）：直接构建 Slate DOM 结构
        if (!slateUpdated) {
          const fallbackP = element.querySelector('p[data-slate-node="element"]') || element.querySelector('p');
          if (fallbackP) {
            fallbackP.innerHTML = '';
            const textSpan = document.createElement('span');
            textSpan.setAttribute('data-slate-node', 'text');
            const leafSpan = document.createElement('span');
            leafSpan.setAttribute('data-slate-leaf', 'true');
            const stringSpan = document.createElement('span');
            stringSpan.setAttribute('data-slate-string', 'true');
            stringSpan.textContent = query;
            leafSpan.appendChild(stringSpan);
            textSpan.appendChild(leafSpan);
            fallbackP.appendChild(textSpan);
          }
          element.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: query }));
          element.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: query }));
          await waitForSlateUpdate();
          console.log('Qwen: DOM 兜底路径写入完成');
        }
        return;
      }

      if (query && slateMatchesQuery()) {
        console.log('Slate: 输入框已有相同内容，跳过写入');
        slateUpdated = true;
      }

      // 方法1：先选中整段内容再 insertText（避免选到 data-slate-zero-width 导致 data-slate-length 仍为 0）
      if (!slateUpdated) try {
        sel.removeAllRanges();
        if (p) {
          range.selectNodeContents(p);
        } else {
          range.selectNodeContents(element);
        }
        sel.addRange(range);
        if (query && document.execCommand('insertText', false, query)) {
          slateUpdated = await waitForSlateUpdate();
          console.log('Slate: 全选后 execCommand insertText 完成', { slateUpdated });
        }
      } catch (e) {
        console.log('Slate: execCommand 失败', e);
      }

      // 方法2：通过 React 内部 setValue/onChange 等回调更新（千问等）
      if (!slateUpdated && query) {
        try {
          const fiber = getReactFiber(element);
          const node = findReactNodeWithValueSetter(fiber);
          if (node && node.memoizedProps) {
            const props = node.memoizedProps;
            if (typeof props.setInputValue === 'function') {
              props.setInputValue(query);
            } else if (typeof props.onValueUpdate === 'function') {
              props.onValueUpdate(query);
            } else if (typeof props.onChange === 'function' && Array.isArray(props.value)) {
              try {
                const newValue = [{ type: 'paragraph', children: [{ text: query }] }];
                props.onChange(newValue);
              } catch (_) {}
            }
            slateUpdated = await waitForSlateUpdate();
            console.log('Slate: React 路径完成', { slateUpdated });
          }
        } catch (e2) {
          console.log('Slate: React 路径失败', e2);
        }
      }

      // 方法3：粘贴事件（选区已设为整段）
      if (!slateUpdated && query && query.trim()) {
        try {
          sel.removeAllRanges();
          if (p) range.selectNodeContents(p);
          else range.selectNodeContents(element);
          sel.addRange(range);
          const dt = new DataTransfer();
          dt.setData('text/plain', query);
          element.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertFromPaste', data: query }));
          element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
          slateUpdated = await waitForSlateUpdate();
          console.log('Slate: 模拟粘贴完成', { slateUpdated });
        } catch (e3) {
          console.log('Slate: 模拟粘贴失败', e3);
        }
      }

      // 方法4：直接构建 Slate 结构并触发输入事件
      if (!slateUpdated && query) {
        const fallbackP = element.querySelector('p[data-slate-node="element"]') || element.querySelector('p');
        if (fallbackP) {
          fallbackP.innerHTML = '';
          const textSpan = document.createElement('span');
          textSpan.setAttribute('data-slate-node', 'text');
          const leafSpan = document.createElement('span');
          leafSpan.setAttribute('data-slate-leaf', 'true');
          const stringSpan = document.createElement('span');
          stringSpan.setAttribute('data-slate-string', 'true');
          stringSpan.textContent = query;
          leafSpan.appendChild(stringSpan);
          textSpan.appendChild(leafSpan);
          fallbackP.appendChild(textSpan);
        }
        element.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: query }));
        element.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: query }));
        slateUpdated = await waitForSlateUpdate();
        console.log('Slate: DOM 构建完成', { slateUpdated });
      }

      if (slateUpdated) {
        await collapseToSingleQuery();
      }
    } else {
    // 检查是否是 Lexical 编辑器（通过 data-lexical-editor 属性）
    const isLexicalEditor = element.hasAttribute('data-lexical-editor') || 
                           element.getAttribute('data-lexical-editor') === 'true';
    
    if (isLexicalEditor) {
      // 处理 Lexical 编辑器：尝试多种方法更新内容
      console.log('检测到 Lexical 编辑器，尝试更新内容');
      
      // 方法1: 尝试通过 Lexical 的内部 API 更新
      let updatedViaAPI = false;
      try {
        // Lexical 编辑器通常会在元素上存储编辑器实例
        const editorKey = Object.keys(element).find(key => 
          key.includes('__lexical') || key.includes('lexical') || key.includes('editor')
        );
        
        if (editorKey && element[editorKey]) {
          const editor = element[editorKey];
          if (editor.update && typeof editor.update === 'function') {
            editor.update(() => {
              const root = editor.getRootElement();
              if (root) {
                root.innerHTML = '';
                const p = document.createElement('p');
                const span = document.createElement('span');
                span.setAttribute('data-lexical-text', 'true');
                span.textContent = query;
                p.appendChild(span);
                root.appendChild(p);
              }
            });
            updatedViaAPI = true;
            console.log('通过 Lexical API 更新内容');
          }
        }
      } catch (apiError) {
        console.log('Lexical API 方法失败，尝试其他方法:', apiError);
      }
      
      // 方法2: 如果 API 方法失败，使用 DOM 操作 + 事件触发
      if (!updatedViaAPI) {
        // 先聚焦元素
        element.focus();
        
        // 清空现有内容
        const pElements = element.querySelectorAll('p');
        if (pElements.length > 0) {
          if (pElements.length > 1) {
            for (let i = 1; i < pElements.length; i++) {
              pElements[i].remove();
            }
          }
          const pElement = pElements[0];
          
          // 清空并创建新内容
          if (query.trim()) {
            pElement.innerHTML = '';
            const span = document.createElement('span');
            span.setAttribute('data-lexical-text', 'true');
            span.textContent = query;
            pElement.appendChild(span);
          } else {
            pElement.innerHTML = '';
          }
        } else {
          // 如果没有 p 元素，创建完整的 Lexical 结构
          element.innerHTML = '';
          const pElement = document.createElement('p');
          if (query.trim()) {
            const span = document.createElement('span');
            span.setAttribute('data-lexical-text', 'true');
            span.textContent = query;
            pElement.appendChild(span);
          }
          element.appendChild(pElement);
        }
        
        // 触发多种事件让 Lexical 识别变化
        // 1. 触发 input 事件
        const inputEvent = new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: query
        });
        element.dispatchEvent(inputEvent);
        
        // 2. 触发 beforeinput 事件（Lexical 可能监听此事件）
        const beforeInputEvent = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: query
        });
        element.dispatchEvent(beforeInputEvent);
        
        // 3. 触发 compositionstart, compositionupdate, compositionend（模拟输入法输入）
        element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        element.dispatchEvent(new CompositionEvent('compositionupdate', { 
          bubbles: true, 
          data: query 
        }));
        element.dispatchEvent(new CompositionEvent('compositionend', { 
          bubbles: true, 
          data: query 
        }));
        
        // 4. 触发 change 事件
        const changeEvent = new Event('change', {
          bubbles: true,
          cancelable: true
        });
        element.dispatchEvent(changeEvent);
        
        // 5. 尝试使用 execCommand（如果浏览器支持）
        let execCommandSuccess = false;
        try {
          // 选中所有内容
          const range = document.createRange();
          range.selectNodeContents(element);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          
          // 使用 insertText 命令
          if (document.execCommand('insertText', false, query)) {
            console.log('使用 execCommand 插入文本成功');
            execCommandSuccess = true;
          }
        } catch (execError) {
          console.log('execCommand 方法失败:', execError);
        }
        
        // 6. 如果 execCommand 失败，尝试通过 DataTransfer 模拟粘贴（作为最后手段）
        if (!execCommandSuccess && query.trim()) {
          try {
            // 先聚焦并选中所有内容
            element.focus();
            const range = document.createRange();
            range.selectNodeContents(element);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            
            // 创建 DataTransfer 对象模拟粘贴
            const dataTransfer = new DataTransfer();
            dataTransfer.setData('text/plain', query);
            
            // 触发 paste 事件
            const pasteEvent = new ClipboardEvent('paste', {
              clipboardData: dataTransfer,
              bubbles: true,
              cancelable: true
            });
            
            // 先触发 beforeinput
            const beforeInputEvent = new InputEvent('beforeinput', {
              bubbles: true,
              cancelable: true,
              inputType: 'insertFromPaste',
              data: query
            });
            element.dispatchEvent(beforeInputEvent);
            
            // 触发 paste 事件
            const pasteHandled = element.dispatchEvent(pasteEvent);
            
            if (pasteHandled) {
              console.log('通过模拟粘贴事件完成');
            } else {
              // 如果 paste 事件被阻止，尝试直接使用 insertText
              document.execCommand('insertText', false, query);
              console.log('通过 insertText 命令完成');
            }
          } catch (fallbackError) {
            console.log('备用方法失败:', fallbackError);
          }
        }
        
        console.log('Lexical 编辑器内容已设置（通过 DOM + 事件）');
      }
    } else {
      // 处理普通 contenteditable 元素（支持 Tiptap/ProseMirror 等编辑器）
      // 查找所有 p 元素，清空并替换为新内容
      const pElements = element.querySelectorAll('p');
      
      if (pElements.length > 0) {
        // 如果存在 p 元素，清空所有并只保留第一个
        if (pElements.length > 1) {
          // 如果有多个 p 元素，删除多余的
          for (let i = 1; i < pElements.length; i++) {
            pElements[i].remove();
          }
        }
        const pElement = pElements[0];
        // 移除空状态类（如 is-empty, is-editor-empty）
        pElement.classList.remove('is-empty', 'is-editor-empty');
        // 设置文本内容
        pElement.innerText = query;
        // 如果没有内容，保留空 p 元素，但移除占位符类
        if (!query.trim()) {
          pElement.innerHTML = '';
        }
      } else {
        // 如果没有 p 元素，创建一个新的
        element.innerHTML = '<p></p>';
        const newP = element.querySelector('p');
        if (newP) {
          newP.innerText = query;
        }
      }
    }
    }
  } else if (step.inputType === 'special') {
    // 使用配置驱动的特殊处理
    await executeSpecialSetValue(step, query, element);
  } else if (step.inputType === 'angular') {
    // 处理 Angular FormControl（如 Google AI Studio）
    // Angular FormControl 的值由框架管理，不会直接反映在 DOM 中
    // 需要通过事件来触发 Angular 的变更检测
    
    // 方法1: 设置值并触发事件
    element.focus();
    setNativeFormControlValue(element, query);
    
    // 触发 input 事件（使用 InputEvent，Angular 监听此事件）
    const inputEvent = new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: query
    });
    element.dispatchEvent(inputEvent);
    
    // 触发 change 事件
    const changeEvent = new Event('change', {
      bubbles: true,
      cancelable: true
    });
    element.dispatchEvent(changeEvent);
    
    // 如果元素有 formControlName 属性，尝试直接访问 Angular FormControl
    // 注意：这需要 Angular 的调试模式或特定上下文
    try {
      // 尝试通过 Angular 的 __ngContext__ 访问 FormControl
      const ngElement = element;
      if (ngElement.__ngContext__) {
        // 找到对应的 FormControl 并设置值
        const context = ngElement.__ngContext__;
        for (let i = 0; i < context.length; i++) {
          if (context[i] && typeof context[i].setValue === 'function') {
            context[i].setValue(query);
            console.log('通过 Angular FormControl API 设置值');
            break;
          }
        }
      }
    } catch (error) {
      // 如果无法访问 Angular API，继续使用事件方式
      console.log('无法访问 Angular FormControl API，使用事件方式');
    }
    
    // 再次触发 focus（保持焦点）
    element.focus();
    
    console.log('Angular FormControl 值已设置并触发事件');
  } else {
    // 普通输入框
    setNativeFormControlValue(element, query);
    
    // 触发 input 事件确保框架能够检测到变化
    const beforeInputEvent = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: query
    });
    element.dispatchEvent(beforeInputEvent);

    const inputEvent = new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: query
    });
    element.dispatchEvent(inputEvent);
  }

  console.log('设置元素值:', foundSelector);
}

// 配置驱动的特殊值设置
async function executeSpecialSetValue(step, query, element) {
  const specialConfig = step.specialConfig;
  
  if (!specialConfig) {
    // 兼容旧的 customSetValue 方式
    await executeLegacySpecialSetValue(step, query);
    return;
  }
  
  switch (specialConfig.type) {
    case 'lexical-editor':
      await handleLexicalEditor(specialConfig, query);
      break;
    case 'growing-textarea':
      await handleGrowingTextarea(specialConfig, query);
      break;
    case 'custom-element':
      await handleCustomElement(specialConfig, query);
      break;
    case 'multi-sync':
      await handleMultiSync(specialConfig, query);
      break;
    default:
      console.warn('未知的特殊处理类型:', specialConfig.type);
      // 回退到普通处理
      element.value = query;
  }
}

// 处理 Lexical 编辑器（如文心一言）
async function handleLexicalEditor(config, query) {
  const container = document.querySelector(config.containerSelector);
  if (!container) {
    throw new Error(`未找到容器元素: ${config.containerSelector}`);
  }
  
  // 清空容器
  if (config.clearContainer !== false) {
    container.innerHTML = '';
  }
  
  // 创建元素
  const element = document.createElement(config.elementType || 'span');
  
  // 设置属性
  if (config.attributes) {
    Object.entries(config.attributes).forEach(([key, value]) => {
      element.setAttribute(key, value);
    });
  }
  
  // 设置内容
  if (config.contentType === 'innerHTML') {
    element.innerHTML = query;
  } else {
    element.textContent = query;
  }
  
  // 添加到容器
  container.appendChild(element);
  
  console.log('Lexical 编辑器内容已设置');
}

// 处理自适应文本框（如 POE）
async function handleGrowingTextarea(config, query) {
  const container = document.querySelector(config.containerSelector);
  if (!container) {
    throw new Error(t('injectProgressErrorElementNotFound', '未找到元素'));
  }
  
  // 设置容器属性
  if (config.containerAttribute) {
    container.setAttribute(config.containerAttribute, query);
  }
  
  // 设置内部输入框
  if (config.inputSelector) {
    const input = container.querySelector(config.inputSelector);
    if (input) {
      input.value = query;
    }
  }
  
  console.log('自适应文本框内容已设置');
}

// 处理自定义元素
async function handleCustomElement(config, query) {
  const element = document.querySelector(config.selector);
  if (!element) {
    throw new Error(t('injectProgressErrorElementNotFound', '未找到元素'));
  }
  
  // 执行自定义方法
  if (config.method === 'setAttribute') {
    element.setAttribute(config.attribute, query);
  } else if (config.method === 'setProperty') {
    element[config.property] = query;
  } else if (config.method === 'innerHTML') {
    element.innerHTML = query;
  } else if (config.method === 'textContent') {
    element.textContent = query;
  }
  
  console.log('自定义元素内容已设置');
}

// 处理多元素同步
async function handleMultiSync(config, query) {
  const elements = config.elements || [];
  
  for (const elementConfig of elements) {
    const element = document.querySelector(elementConfig.selector);
    if (element) {
      if (elementConfig.method === 'value') {
        element.value = query;
      } else if (elementConfig.method === 'attribute') {
        element.setAttribute(elementConfig.attribute, query);
      } else if (elementConfig.method === 'textContent') {
        element.textContent = query;
      }
    }
  }
  
  console.log('多元素同步完成');
}

// 兼容旧的特殊处理方式
async function executeLegacySpecialSetValue(step, query) {
  if (step.customSetValue === 'wenxin') {
    const p = document.querySelector('p.yc-editor-paragraph');
    if (p) {
      p.innerHTML = '';
    }
    const span = document.createElement('span');
    span.setAttribute('data-lexical-text', 'true');
    span.textContent = query;
    p.appendChild(span);
  } else if (step.customSetValue === 'poe') {
    const growingTextArea = document.querySelector('.GrowingTextArea_growWrap__im5W3');
    if (growingTextArea) {
      growingTextArea.setAttribute('data-replicated-value', query);
      const textarea = growingTextArea.querySelector('textarea');
      if (textarea) {
        textarea.value = query;
      }
    }
  }
}

// 执行触发事件操作
async function executeTriggerEvents(step) {
  let element = null;
  let foundSelector = null;
  
  // 支持多个选择器
  const selectors = Array.isArray(step.selector) ? step.selector : [step.selector];
  
  // 如果指定了重试机制，使用重试逻辑
  const maxAttempts = step.maxAttempts || (step.waitForElement ? DEFAULT_STEP_MAX_ATTEMPTS : 1);
  const retryInterval = step.retryInterval || 200;
  let attempts = 0;
  
  const tryTriggerEvents = async () => {
    // 尝试查找元素
    let foundElement = null;
    let foundSel = null;
    
    for (const selector of selectors) {
      foundElement = document.querySelector(selector);
      if (foundElement) {
        foundSel = selector;
        break;
      }
    }
    
    if (!foundElement) {
      // 元素未找到，如果允许重试则重试
      attempts++;
      if (attempts < maxAttempts && (step.waitForElement || step.maxAttempts)) {
        reportStepRetry(attempts, maxAttempts);
        console.log(`元素未找到，${retryInterval}ms后重试 (${attempts}/${maxAttempts}): ${selectors.join(', ')}`);
        await new Promise(resolve => setTimeout(resolve, retryInterval));
        return tryTriggerEvents();
      } else {
        throw createRetryExhaustedError(t('injectProgressErrorElementNotFound', '未找到元素'));
      }
    }
    
    // 元素找到，设置变量并继续执行触发事件
    element = foundElement;
    foundSelector = foundSel;
    return { element: foundElement, selector: foundSel };
  };
  
  const result = await tryTriggerEvents();
  element = result.element;
  foundSelector = result.selector;

  // Slate 编辑器（千问等）：用当前 DOM 文本派发 InputEvent，便于页面同步 React 状态并启用发送按钮
  const isSlateEditor = element.getAttribute('data-slate-editor') === 'true';
  const getTextForInputEvent = () => {
    if (isSlateEditor) {
      const strings = element.querySelectorAll('[data-slate-string]');
      if (strings.length) return Array.from(strings).map(n => n.textContent || '').join('');
    }
    return element.value != null ? element.value : (element.innerText || element.textContent || '');
  };

  const events = step.events || ['input', 'change'];
  events.forEach(eventName => {
    if (eventName === 'input') {
      if (step.inputType === 'special' || isSlateEditor || element.isContentEditable) {
        const text = getTextForInputEvent();
        const inputEvent = new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: text
        });
        element.dispatchEvent(inputEvent);
      } else {
        element.dispatchEvent(new Event(eventName, { bubbles: true }));
      }
    } else {
      element.dispatchEvent(new Event(eventName, { bubbles: true }));
    }
  });

  console.log('触发事件:', events, '在元素:', foundSelector, isSlateEditor ? '(Slate 已用 InputEvent+data)' : '');
}

// 执行发送按键操作
async function executeSendKeys(step, query) {
  let element = null;
  let foundSelector = null;
  
  // 支持多个选择器
  const selectors = Array.isArray(step.selector) ? step.selector : [step.selector];
  const maxAttempts = step.maxAttempts || (step.waitForElement ? DEFAULT_STEP_MAX_ATTEMPTS : 1);
  const retryInterval = step.retryInterval || 200;
  let attempts = 0;

  const tryFindElement = async () => {
    for (const selector of selectors) {
      element = document.querySelector(selector);
      if (element) {
        foundSelector = selector;
        break;
      }
    }

    if (!element) {
      attempts++;
      if (attempts < maxAttempts && (step.waitForElement || step.maxAttempts)) {
        reportStepRetry(attempts, maxAttempts);
        console.log(`元素未找到，${retryInterval}ms后重试 (${attempts}/${maxAttempts}): ${selectors.join(', ')}`);
        await new Promise(resolve => setTimeout(resolve, retryInterval));
        return tryFindElement();
      }
      throw createRetryExhaustedError(t('injectProgressErrorElementNotFound', '未找到元素'));
    }

    return element;
  };

  element = await tryFindElement();

  // 检测平台（Mac 使用 Command/Meta，Windows/Linux 使用 Ctrl）
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0 || 
                navigator.userAgent.toUpperCase().indexOf('MAC') >= 0;

  if (step.keys === 'Enter') {
    element.focus();
    const enterOpts = { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13, location: 0, repeat: false, isComposing: false };
    element.dispatchEvent(new KeyboardEvent('keydown', enterOpts));
    element.dispatchEvent(new KeyboardEvent('keypress', enterOpts));
    element.dispatchEvent(new KeyboardEvent('keyup', enterOpts));
    console.log('发送回车键到元素:', foundSelector);
  } else if (step.keys === '⌘ + Enter' || step.keys === 'Command+Enter' || step.keys === 'Meta+Enter') {
    // 处理 ⌘ + Enter 组合键
    // Mac 使用 Meta (Command) 键，Windows/Linux 使用 Ctrl 键
    const metaKey = isMac; // Mac 使用 metaKey
    const ctrlKey = !isMac; // Windows/Linux 使用 ctrlKey
    
    // 先触发 keydown 事件，包含修饰键
    const keyDownEvent = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      location: 0,
      repeat: false,
      isComposing: false,
      ctrlKey: ctrlKey,
      metaKey: metaKey,
      shiftKey: false,
      altKey: false
    });
    element.dispatchEvent(keyDownEvent);
    
    // 再触发 keyup 事件，包含修饰键
    const keyUpEvent = new KeyboardEvent('keyup', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      location: 0,
      repeat: false,
      isComposing: false,
      ctrlKey: ctrlKey,
      metaKey: metaKey,
      shiftKey: false,
      altKey: false
    });
    element.dispatchEvent(keyUpEvent);
    
    console.log(`发送 ${isMac ? '⌘ + Enter (Meta+Enter)' : 'Ctrl + Enter'} 到元素:`, foundSelector);
  } else if (step.keys === 'Ctrl+Enter' || step.keys === 'Control+Enter') {
    // 处理 Ctrl + Enter 组合键
    const keyDownEvent = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      location: 0,
      repeat: false,
      isComposing: false,
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      altKey: false
    });
    element.dispatchEvent(keyDownEvent);
    
    const keyUpEvent = new KeyboardEvent('keyup', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      location: 0,
      repeat: false,
      isComposing: false,
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      altKey: false
    });
    element.dispatchEvent(keyUpEvent);
    
    console.log('发送 Ctrl + Enter 到元素:', foundSelector);
  } else {
    console.warn('不支持的按键类型:', step.keys);
  }
}

// 执行元素替换操作
async function executeReplace(step, query) {
  console.log('🔧 executeReplace 开始执行');
  console.log('🔧 步骤配置:', step);
  console.log('🔧 查询内容:', query);
  
  let element = null;
  let foundSelector = null;
  
  // 支持多个选择器
  const selectors = Array.isArray(step.selector) ? step.selector : [step.selector];
  console.log('🔧 尝试的选择器:', selectors);
  
  for (const selector of selectors) {
    element = document.querySelector(selector);
    console.log(`🔧 选择器 ${selector} 结果:`, element);
    if (element) {
      foundSelector = selector;
      break;
    }
  }
  
  if (!element) {
    throw new Error(t('injectProgressErrorElementNotFound', '未找到元素'));
  }

  console.log('🔧 找到元素:', element);
  console.log('🔧 元素当前HTML:', element.innerHTML);
  
  // 清空容器内容
  element.innerHTML = '';
  console.log('🔧 清空后HTML:', element.innerHTML);
  
  // 创建并插入新元素
  if (step.write && Array.isArray(step.write)) {
    console.log('🔧 开始创建元素，配置数量:', step.write.length);
    for (const elementConfig of step.write) {
      console.log('🔧 创建元素配置:', elementConfig);
      const newElement = createElementFromConfig(elementConfig, query);
      console.log('🔧 创建的元素:', newElement);
      console.log('🔧 创建的元素HTML:', newElement.outerHTML);
      element.appendChild(newElement);
    }
  }
  
  console.log('🔧 最终元素HTML:', element.innerHTML);
  console.log('✅ 元素替换完成:', foundSelector, '内容:', query);
}

// 根据配置创建DOM元素
function createElementFromConfig(config, query) {
  console.log('🔧 createElementFromConfig 开始，配置:', config, '查询:', query);
  
  const element = document.createElement(config.tag);
  console.log('🔧 创建元素:', config.tag, element);
  
  // 设置属性
  if (config.attributes) {
    console.log('🔧 设置属性:', config.attributes);
    Object.entries(config.attributes).forEach(([key, value]) => {
      element.setAttribute(key, value);
      console.log(`🔧 设置属性 ${key} = ${value}`);
    });
  }
  
  // 设置文本内容
  if (config.text) {
    // 替换 $query 为实际查询内容
    const text = config.text.replace(/\$query/g, query);
    console.log('🔧 设置文本内容:', text);
    element.textContent = text;
  }
  
  // 设置HTML内容
  if (config.html) {
    // 替换 $query 为实际查询内容
    const html = config.html.replace(/\$query/g, query);
    console.log('🔧 设置HTML内容:', html);
    element.innerHTML = html;
  }
  
  // 递归创建子元素
  if (config.children && Array.isArray(config.children)) {
    console.log('🔧 创建子元素，数量:', config.children.length);
    config.children.forEach((childConfig, index) => {
      console.log(`🔧 创建子元素 ${index}:`, childConfig);
      const childElement = createElementFromConfig(childConfig, query);
      element.appendChild(childElement);
    });
  }
  
  console.log('🔧 最终创建的元素:', element.outerHTML);
  return element;
}

// 执行等待操作
async function executeWait(step) {
  const rawDuration = Number(step?.duration);
  const duration = Number.isFinite(rawDuration) && rawDuration >= 0 ? rawDuration : 0;
  await new Promise(resolve => setTimeout(resolve, duration));
  console.log('等待:', duration + 'ms');
}

// 执行自定义操作
async function executeCustom(step, query) {
  if (step.customAction === 'metaso_recommend') {
    const iframeUrl = window.frameElement ? window.frameElement.src : window.location.href;
    if (iframeUrl.includes('/search/')) {
      const recommendBox = document.querySelector('div.MuiBox-root.css-qtri4c');
      if (recommendBox) {
        recommendBox.click();
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  } else if (step.customAction === 'send_message') {
    window.parent.postMessage({ type: 'message_received', originalType: step.messageType }, '*');
  } else if (step.customAction === 'retry_click') {
    // 已废弃：retry_click 功能已合并到 click action 中
    console.warn('retry_click 已废弃，请使用 click action 配合 retryOnDisabled 参数');
  } else if (step.customAction === 'url_query') {
    console.log('站点使用URL查询，无需搜索处理器');
  } else if (step.customAction === 'placeholder') {
    console.log('站点暂未实现搜索处理器');
  }
  
  console.log('执行自定义操作:', step.customAction);
}

function normalizeMatchPath(pathname) {
  if (!pathname || pathname === '/') return '/';
  return pathname.replace(/\/+$/, '') || '/';
}

function resolveBestSiteMatch(sites, domain, preferredSiteName = null, currentUrl = window.location.href) {
  let current;
  try {
    current = new URL(currentUrl);
  } catch (_) {
    current = null;
  }

  const matches = (sites || []).map((site) => {
    if (!site || !site.url || site.hidden) return null;
    try {
      const siteUrl = new URL(site.url);
      const siteDomain = siteUrl.hostname;
      const domainMatched =
        domain === siteDomain ||
        domain.includes(siteDomain) ||
        siteDomain.includes(domain);

      if (!domainMatched) return null;

      const preferredNameMatched = preferredSiteName && site.name === preferredSiteName;

      const currentPath = normalizeMatchPath(current?.pathname || '/');
      const sitePath = normalizeMatchPath(siteUrl.pathname || '/');
      let pathScore = 0;

      if (currentPath === sitePath) {
        pathScore = 400 + sitePath.length;
      } else if (sitePath !== '/' && currentPath.startsWith(sitePath + '/')) {
        pathScore = 300 + sitePath.length;
      } else if (preferredNameMatched) {
        // Workspace pages can redirect away from the original entry-path while
        // staying on the same product domain. If the caller already knows the
        // exact site name, keep resolving that handler instead of dropping it.
        pathScore = 200;
      } else if (sitePath === '/') {
        pathScore = 100;
      } else {
        return null;
      }

      return {
        site,
        score:
          (preferredNameMatched ? 1000 : 0) +
          (domain === siteDomain ? 100 : 50) +
          pathScore
      };
    } catch (_) {
      return null;
    }
  }).filter(Boolean);

  matches.sort((a, b) => b.score - a.score);
  return matches[0]?.site || null;
}

// 根据域名获取站点处理器
async function getSiteHandler(domain, preferredSiteName = null) {
  try {
    let sites = [];
    try {
      if (!window.getDefaultSites) {
        console.error('window.getDefaultSites 不可用，请检查 baseConfig.js 是否正确加载');
        return null;
      }
      
      sites = await window.getDefaultSites();
      console.log('从 getDefaultSites 获取站点配置成功，数量:', sites.length);
    } catch (error) {
      console.error('获取站点配置失败:', error);
    }
    
    // 使用配置
    if (!sites || sites.length === 0) {
      console.warn('没有找到站点配置，请检查网络连接或重新加载扩展');
      return null;
    }

    const site = resolveBestSiteMatch(sites, domain, preferredSiteName, window.location.href);
    
    if (!site) {
      console.warn('未找到匹配的站点配置:', { domain, preferredSiteName, currentUrl: window.location.href });
      return null;
    }
    
    console.log(`找到站点配置: ${site.name}`);
    console.log('站点配置详情:', {
      name: site.name,
      hasSearchHandler: !!site.searchHandler,
      hasFileUploadHandler: !!site.fileUploadHandler
    });
    
    return {
      name: site.name,
      searchHandler: site.searchHandler,
      fileUploadHandler: site.fileUploadHandler,
      contentExtractor: site.contentExtractor,
      historyHandler: site.historyHandler,
      userPrompt: site.userPrompt
    };
  } catch (error) {
    console.error('获取站点处理器失败:', error);
    return null;
  }
}

// 监听来自扩展的消息
window.addEventListener('message', async function(event) {
    // 首先检查是否在 AI 站点中运行
    const isAI = await checkAISite();
    if (!isAI) {
        return; // 不在 AI 站点中，跳过所有处理
    }
    
    // 过滤消息：只处理来自 AIShortcuts扩展的消息
    if (!event.data || typeof event.data !== 'object') {
        return; // 静默跳过非对象消息
    }
    
    // 检查是否是 AIShortcuts 扩展的消息
    if (!event.data.query && !event.data.type && !event.data.fileData) {
        return; // 静默跳过缺少必要字段的消息
    }
    
    // 过滤掉来自 AI 站点的内部消息
    if (event.data.action || event.data.payload || event.data._stripeJsV3 || 
        event.data.sourceFrameId || event.data.targetFrameId || 
        event.data.controllerAppFrameId) {
        return; // 静默跳过 AI 站点的内部消息
    }
    
    // 只记录有效的 AIShortcuts 消息
    console.log('🎯🎯🎯 inject.js 收到 AIShortcuts 消息:', event.data, '来源:', event.origin);
    
    // 过滤掉其他扩展的消息（如广告拦截器等）
    if (event.data.type && (
        event.data.type.includes('ad-finder') || 
        event.data.type.includes('wxt') ||
        event.data.type.includes('content-script-started') ||
        event.data.type.includes('ads#') ||
        event.data.type.includes('adblock') ||
        event.data.type.includes('ublock') ||
        event.data.type.includes('ghostery') ||
        event.data.type.includes('privacy') ||
        event.data.type.startsWith('laankejkbhbdhmipfmgcngdelahlfoji') ||
        event.data.type.includes('INIT') ||
        event.data.type.includes('EXTENSION_')
    )) {
        return;
    }
    
    // 只处理 AIShortcuts 扩展的特定消息类型
    const validMultiAITypes = ['TRIGGER_PASTE', 'search', 'EXTRACT_CONTENT', 'SET_HISTORY_CONTEXT', 'GET_CURRENT_URL', 'SCROLL_TO_PROMPT', 'EXTRACT_PROMPT_RESPONSE', 'LIST_USER_PROMPTS', 'SET_ACTIVE_SEARCH_CONTEXT'];
    
    if (!validMultiAITypes.includes(event.data.type)) {
        return;
    }
    
    console.log('收到消息类型:', event.data.type);

    // 接收父页面下发的历史上下文（用于把 URL 更新写回正确的 history 记录）
    if (event.data.type === 'SET_HISTORY_CONTEXT') {
        __aiCompareHistoryContext.historyId = event.data.historyId || null;
        __aiCompareHistoryContext.siteName = event.data.siteName || __aiCompareHistoryContext.siteName;
        console.log('✅ 已更新历史上下文:', __aiCompareHistoryContext);
        scheduleTimelinePromptSnapshot(80, { force: true });
        return;
    }
    
    // 处理文件粘贴消息 - 优先使用站点特定处理器
    if (event.data.type === 'TRIGGER_PASTE') {
        console.log('🎯 收到文件粘贴触发消息');
        console.log('消息详情:', event.data);
        
        if (event.data.index && event.data.total) {
            console.log(`🎯 当前处理进度: ${event.data.index}/${event.data.total}`);
        }
        
        // 检查消息模式
        if (event.data.fallback) {
            console.log('🎯 降级模式：iframe 自行尝试读取剪贴板');
        } else if (event.data.useSiteHandler) {
            console.log('🎯 优先模式：使用站点特定的文件上传处理器');
        } else if (event.data.global) {
            console.log('🎯 全局文件粘贴操作');
            if (event.data.forced) {
                console.log('🎯 强制处理模式');
            }
        } else {
            console.log('🎯 单个 iframe 的文件粘贴操作');
        }
        
        // 获取站点处理器
        const domain = event.data.domain || window.location.hostname;
        const siteHandler = await getSiteHandler(domain, event.data.siteName || null);
        
        if (siteHandler && siteHandler.fileUploadHandler) {
            console.log(`🎯 使用 ${siteHandler.name} 的文件上传处理器`);
            console.log('站点处理器配置:', siteHandler.fileUploadHandler);
            
            try {
                // 如果有传递文件数据，先将其存储到全局变量供处理器使用
                if (event.data.fileData) {
                    console.log('🎯 收到传递的文件数据，存储供站点处理器使用');
                    window._currentFileData = event.data.fileData;
                }
                
                await executeSiteHandler(null, siteHandler.fileUploadHandler, siteHandler.name);
                console.log('🎯 站点文件上传处理器执行完成');
                
                // 清理临时数据
                if (window._currentFileData) {
                    delete window._currentFileData;
                }
                
            } catch (error) {
                console.error(`${siteHandler.name} 文件上传处理失败:`, error);
                
                // 降级策略：如果有文件数据，尝试直接粘贴
                if (event.data.fileData) {
                    console.log('🎯 降级到直接文件数据粘贴');
                    try {
                        await handleFileDataPaste(event.data.fileData);
                        console.log('✅ 降级文件数据粘贴成功');
                    } catch (fallbackError) {
                        console.error('❌ 降级文件数据粘贴也失败:', fallbackError);
                        // 最后的降级：默认粘贴操作
                        await executeSiteHandler(null, { 
                            steps: [{ 
                                action: 'paste', 
                                description: '最后降级：默认粘贴操作' 
                            }] 
                        }, siteHandler.name);
                    }
                } else {
                    // 没有文件数据时的降级
                    console.log('🎯 降级到默认粘贴操作');
                    await executeSiteHandler(null, { 
                        steps: [{ 
                            action: 'paste', 
                            description: '降级：默认粘贴操作' 
                        }] 
                    }, siteHandler.name);
                }
            }
        } else {
            console.log('❌ 未找到文件上传处理器');
            
            // 如果没有站点处理器，但有文件数据，尝试直接粘贴
            if (event.data.fileData) {
                console.log('🎯 使用直接文件数据粘贴');
                try {
                    await handleFileDataPaste(event.data.fileData);
                    console.log('✅ 直接文件数据粘贴成功');
                } catch (error) {
                    console.error('❌ 直接文件数据粘贴失败:', error);
                }
            } else {
                console.log('🎯 使用默认粘贴处理方式');
                await executeSiteHandler(null, { 
                    steps: [{ 
                        action: 'paste', 
                        description: '默认粘贴操作' 
                    }] 
                }, siteHandler.name);
            }
        }
        return;
    }

    // 处理获取当前 URL 消息
    if (event.data.type === 'GET_CURRENT_URL') {
        console.log('🎯 收到获取当前 URL 请求:', event.data);

        const preferredResult = getPreferredExtractContentResult(event.data.siteName || null);
        let pageUrl = preferredResult?.url || '';
        if (!pageUrl) {
            pageUrl = await resolveCurrentPageUrl(event.data.siteName || null);
        }
        
        // 发送当前 URL 回父窗口
        window.parent.postMessage({
            type: 'GET_CURRENT_URL_RESPONSE',
            requestId: event.data.requestId || null,
            siteName: event.data.siteName,
            url: pageUrl
        }, '*');
        
        console.log('✅ 已发送当前 URL:', pageUrl);
        return;
    }

    if (event.data.type === 'LIST_USER_PROMPTS') {
        const domain = event.data.domain || window.location.hostname;
        const siteHandler = await getSiteHandler(domain, event.data.siteName || null);
        const promptRecords = collectTimelinePromptRecords(siteHandler);

        window.parent.postMessage({
            type: 'LIST_USER_PROMPTS_RESULT',
            requestId: event.data.requestId,
            siteName: event.data.siteName || siteHandler?.name || domain,
            prompts: promptRecords.map((item) => ({
                text: item.text
            }))
        }, '*');
        return;
    }

    if (event.data.type === 'SCROLL_TO_PROMPT') {
        const domain = event.data.domain || window.location.hostname;
        const siteHandler = await getSiteHandler(domain, event.data.siteName || null);
        let result;
        try {
            result = await scrollToPromptForTimeline(
                siteHandler,
                event.data.query,
                Number(event.data.occurrenceIndex) || 0
            );
        } catch (error) {
            result = {
                found: false,
                error: error?.message || String(error)
            };
        }

        window.parent.postMessage({
            type: 'SCROLL_TO_PROMPT_RESULT',
            requestId: event.data.requestId,
            siteName: event.data.siteName || siteHandler?.name || domain,
            ...result
        }, '*');
        return;
    }

    if (event.data.type === 'EXTRACT_PROMPT_RESPONSE') {
        const domain = event.data.domain || window.location.hostname;
        const siteHandler = await getSiteHandler(domain, event.data.siteName || null);
        let result;
        try {
            result = await extractPromptResponseForTimeline(
                siteHandler,
                event.data.query,
                Number(event.data.occurrenceIndex) || 0
            );
        } catch (error) {
            result = {
                found: false,
                error: error?.message || String(error)
            };
        }

        window.parent.postMessage({
            type: 'EXTRACT_PROMPT_RESPONSE_RESULT',
            requestId: event.data.requestId,
            siteName: event.data.siteName || siteHandler?.name || domain,
            ...result
        }, '*');
        return;
    }

    // 处理内容提取消息
    if (event.data.type === 'EXTRACT_CONTENT') {
        console.log('🎯 收到内容提取请求:', event.data);
        
        // 使用 async/await 处理异步内容提取
        (async () => {
            try {
                const preferredResult = getPreferredExtractContentResult(event.data.siteName || null);
                const content = preferredResult?.content || await extractPageContent(event.data.siteName || null);
                const pageUrl = preferredResult?.url || await resolveCurrentPageUrl(event.data.siteName || null);
                
                // 发送提取结果回主窗口
                window.parent.postMessage({
                    type: 'EXTRACTED_CONTENT',
                    requestId: event.data.requestId || null,
                    siteName: event.data.siteName,
                    content: content,
                    url: pageUrl
                }, '*');
                
                console.log('✅ 内容提取完成，已发送结果');
            } catch (error) {
                console.error('❌ 内容提取失败:', error);
                
                // 发送错误结果
                window.parent.postMessage({
                    type: 'EXTRACTED_CONTENT',
                    requestId: event.data.requestId || null,
                    siteName: event.data.siteName,
                    content: `内容提取失败: ${error.message}`
                }, '*');
            }
        })();
        return;
    }

    if (event.data.type === 'SET_ACTIVE_SEARCH_CONTEXT') {
        const runtimeSiteName = event.data.siteName || __aiCompareHistoryContext.siteName || window.location.hostname;
        startActiveSearchMonitor(
            runtimeSiteName,
            event.data.query || '',
            event.data.searchId || createSearchSessionId(runtimeSiteName)
        );
        return;
    }

    // 对于搜索消息，必须包含 query 字段
    if (event.data.type !== 'TRIGGER_PASTE' && !event.data.query) {
        return;
    }
    
    console.log('收到query:',event.data.query, '收到type:',event.data.type);
    console.log('收到消息event 原始:',event);

    // 使用新的统一处理逻辑
    const domain = event.data.domain || window.location.hostname;
    console.log('🔍 调试信息 - 域名:', domain, '当前hostname:', window.location.hostname);
    
    const siteHandler = await getSiteHandler(domain, event.data.siteName || null);
    console.log('🔍 调试信息 - 站点处理器:', siteHandler);
    
    if (siteHandler && siteHandler.searchHandler && event.data.query) {
        const searchId = event.data.searchId || createSearchSessionId(siteHandler.name || event.data.siteName || domain);
        // 记录本次搜索关联的 historyId（父页面会在消息里携带）
        if (event.data.historyId) {
            __aiCompareHistoryContext.historyId = event.data.historyId;
            __aiCompareHistoryContext.siteName = siteHandler.name;
        }

        stopActiveSearchMonitor('new-search-message');
        postSiteRuntimeUpdate({
            siteName: siteHandler.name,
            query: event.data.query,
            searchId,
            phase: 'script_start',
            content: '',
            url: '',
            error: '',
            final: false,
            startedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });

        console.log(`✅ 使用 ${siteHandler.name} 配置化处理器处理消息`);
        console.log('🔍 调试信息 - 搜索处理器配置:', siteHandler.searchHandler);
        try {
            // 使用配置化处理器执行
            await executeSiteHandler(event.data.query, siteHandler.searchHandler, siteHandler.name);
            console.log(`✅ ${siteHandler.name} 处理完成`);
            scheduleTimelinePromptSnapshot(200, { force: true });
            setTimeout(() => scheduleTimelinePromptSnapshot(0, { force: true }), 1200);
            startActiveSearchMonitor(siteHandler.name, event.data.query, searchId);
            
            // 执行完成后，启动 URL 检测逻辑（如果配置了 historyHandler）
            console.log('🔍 检查 historyHandler 配置:', {
                hasHistoryHandler: !!siteHandler.historyHandler,
                historyHandler: siteHandler.historyHandler,
                urlFeature: siteHandler.historyHandler?.urlFeature
            });
            if (siteHandler.historyHandler && siteHandler.historyHandler.urlFeature) {
                console.log(`✅ 启动 ${siteHandler.name} 的 URL 检测，特征: ${siteHandler.historyHandler.urlFeature}`);
                startHistoryUrlDetection(
                    siteHandler.name,
                    siteHandler.historyHandler.urlFeature,
                    event.data.historyId || __aiCompareHistoryContext.historyId
                );
            } else {
                console.warn(`⚠️ ${siteHandler.name} 未配置 historyHandler 或 urlFeature，跳过 URL 检测`);
            }
        } catch (error) {
            console.error(`❌ ${siteHandler.name} 处理失败:`, error);
            postInjectProgress({
                siteName: siteHandler.name,
                status: 'error',
                errorMessage: error?.message || String(error),
                manualRetryRequired: error?.manualRetryRequired === true
            });
            postSiteRuntimeUpdate({
                siteName: siteHandler.name,
                query: event.data.query,
                searchId,
                phase: 'error',
                content: '',
                url: await resolveCurrentPageUrl(siteHandler.name),
                error: error?.message || String(error),
                final: true,
                startedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            });
        }
        return;
    }

    // 如果没有找到对应的处理器，记录警告
    console.warn('❌ 未找到对应的站点处理器');
    console.warn('🔍 调试信息 - 域名:', domain);
    console.warn('🔍 调试信息 - 站点处理器:', siteHandler);
    console.warn('🔍 调试信息 - 消息类型:', event.data.type);
    console.warn('🔍 调试信息 - 查询内容:', event.data.query);
    if (event.data.query) {
        postInjectProgress({
            siteName: event.data.siteName || domain,
            status: 'error',
            errorMessage: t('injectProgressErrorNoSiteHandler', '未找到站点处理器')
        });
        postSiteRuntimeUpdate({
            siteName: event.data.siteName || domain,
            query: event.data.query,
            searchId: event.data.searchId || createSearchSessionId(event.data.siteName || domain),
            phase: 'error',
            content: '',
            url: await resolveCurrentPageUrl(event.data.siteName || domain),
            error: t('injectProgressErrorNoSiteHandler', '未找到站点处理器'),
            final: true,
            startedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });
    }
}); 

// 处理传递的文件数据粘贴
async function handleFileDataPaste(fileData) {
    console.log('🎯 开始处理传递的文件数据');
    console.log('文件数据:', fileData);
    
    if (!fileData || (!fileData.blob && !fileData.data)) {
        console.error('❌ 无效的文件数据');
        return;
    }
    
    try {
        // 确保文档获得焦点
        console.log('🔍 检查文档焦点状态...');
        if (!document.hasFocus()) {
            console.log('⚠️ 文档没有焦点，尝试获取焦点...');
            window.focus();
            // 等待一小段时间让焦点生效
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // 创建 File 对象 - 使用改进的文件名生成逻辑
        const blobData = fileData.blob || fileData.data; // 支持两种数据结构
        let file = blobData;
        
        if (blobData instanceof Blob && !(blobData instanceof File)) {
            // 使用传递的智能文件名，如果没有则生成一个
            let fileName = fileData.fileName || fileData.name;
            if (!fileName && window.AppConfigManager) {
                fileName = await window.AppConfigManager.generateFileName(
                    fileData.originalName, 
                    fileData.type, 
                    'clipboard'
                );
                console.log('🎯 生成智能文件名:', fileName);
            } else if (!fileName) {
                // 最后的降级处理
                const extension = await getFileExtensionFromMimeType(fileData.type);
                fileName = `clipboard-${Date.now()}.${extension}`;
            }
            
            file = new File([blobData], fileName, { type: fileData.type });
            console.log('将 Blob 转换为 File:', {
                name: file.name,
                type: file.type,
                size: file.size,
                originalData: fileData
            });
        }
        
        // 创建 DataTransfer 对象
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        
        // 创建文件粘贴事件
        const pasteEvent = new ClipboardEvent('paste', {
            clipboardData: dataTransfer,
            bubbles: true,
            cancelable: true
        });
        
        // 触发粘贴事件到当前聚焦的元素
        const activeElement = document.activeElement;
        if (activeElement) {
            console.log('已向聚焦元素发送文件粘贴事件:', activeElement);
            activeElement.dispatchEvent(pasteEvent);
        } else {
            console.log('没有聚焦的元素，向 document 发送文件粘贴事件');
            document.dispatchEvent(pasteEvent);
        }
        
        console.log('✅ 文件数据粘贴事件已触发');
        
    } catch (error) {
        console.error('❌ 文件数据粘贴失败:', error);
        throw error;
    }
}

// 辅助函数：从 MIME 类型获取文件扩展名
async function getFileExtensionFromMimeType(mimeType) {
    if (window.AppConfigManager) {
        return await window.AppConfigManager.getFileExtensionByMimeType(mimeType);
    }
    
    // 简单的降级映射
    const basicMappings = {
        'application/pdf': 'pdf',
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'text/plain': 'txt',
        'Files': 'file'
    };
    
    return basicMappings[mimeType] || 'bin';
} 

// 显示剪切板权限提示
function showClipboardPermissionTip() {
  console.log('提示: 需要用户授权剪切板访问权限');
  console.log('解决方法: 请重新加载扩展以应用新的权限设置');
  console.log('或者点击页面获得焦点后重试');
}

// 提取页面内容
async function extractPageContent(preferredSiteName = null) {
    console.log('🔍 开始提取页面内容...');
    
    try {
        // 获取当前域名
        const domain = window.location.hostname;
        console.log('🔍 当前域名:', domain);
        
        
        // 获取站点配置
        const siteHandler = await getSiteHandler(domain, preferredSiteName || __aiCompareHistoryContext.siteName || null);
        console.log('🔍 站点处理器:', siteHandler);
        
        let content = '';

        if (siteHandler && siteHandler.contentExtractor) {
            // 使用配置文件中的提取规则
            console.log('✅ 使用配置文件中的内容提取规则');
            content = await extractWithConfig(siteHandler.contentExtractor, siteHandler.name);
            if (looksLikeConfiguredPageShell(siteHandler, content)) {
                console.log('⏳ 站点仍处于页面壳或流式加载阶段，继续等待真实回答');
                return '';
            }
        } else {
            // 没有找到站点配置，返回提示信息
            const siteName = siteHandler ? siteHandler.name : domain;
            console.log(`⚠️ 未找到 ${siteName} 的内容提取配置，返回提示信息`);
            content = `无法自动提取 ${siteName} 的详细内容，请手动复制。\n\n提示：该站点可能尚未配置内容提取规则，或者页面结构发生了变化。`;
        }
        
        console.log('✅ 内容提取完成，长度:', content.length);
        return content;
        
    } catch (error) {
        console.error('❌ 内容提取失败:', error);
        return `内容提取失败: ${error.message}`;
    }
}

function getAICompareExtractionCore() {
    return window.AICompareExtraction || null;
}

function collectTimelinePromptRecords(siteHandler) {
    const core = getAICompareExtractionCore();
    return core?.collectTimelinePromptRecords?.(document, siteHandler) || [];
}

function findTimelinePromptRecord(promptRecords, query, occurrenceIndex) {
    const core = getAICompareExtractionCore();
    if (typeof core?.findTimelinePromptRecord === 'function') {
        return core.findTimelinePromptRecord(promptRecords, query, occurrenceIndex);
    }
    return null;
}

function buildTimelinePromptSnapshotSignature(siteName, prompts) {
    return JSON.stringify({
        siteName: String(siteName || '').trim(),
        prompts: Array.isArray(prompts) ? prompts.map((prompt) => String(prompt?.text || '').trim()) : []
    });
}

async function pushTimelinePromptSnapshot(options = {}) {
    if (!isRunningInExtensionIframe() || !window.parent || window.parent === window) {
        return;
    }

    const siteHandler = await getSiteHandler(window.location.hostname, __aiCompareHistoryContext.siteName || null);
    const siteName = siteHandler?.name || __aiCompareHistoryContext.siteName || window.location.hostname;
    const promptRecords = collectTimelinePromptRecords(siteHandler);
    const prompts = promptRecords.map((item) => ({
        text: item.text
    }));
    const nextSignature = buildTimelinePromptSnapshotSignature(siteName, prompts);

    if (!options.force && __timelinePromptLastSignature === nextSignature) {
        return;
    }

    __timelinePromptLastSignature = nextSignature;
    window.parent.postMessage({
        type: 'TIMELINE_PROMPTS_SNAPSHOT',
        source: 'inject-script',
        siteName,
        prompts
    }, '*');
}

function scheduleTimelinePromptSnapshot(delayMs = 240, options = {}) {
    if (!isRunningInExtensionIframe()) return;
    if (__timelinePromptPushTimer) {
        clearTimeout(__timelinePromptPushTimer);
    }
    __timelinePromptPushTimer = setTimeout(() => {
        pushTimelinePromptSnapshot(options).catch((error) => {
            console.warn('时间线 prompt 推送失败:', error);
        });
    }, Math.max(0, Number(delayMs) || 0));
}

function initializeTimelinePromptPush() {
    if (__timelinePromptPushInitialized || !isRunningInExtensionIframe()) {
        return;
    }
    __timelinePromptPushInitialized = true;

    const startObserver = () => {
        if (__timelinePromptObserver || typeof MutationObserver !== 'function') return;
        const targetNode = document.body || document.documentElement;
        if (!targetNode) return;

        __timelinePromptObserver = new MutationObserver(() => {
            scheduleTimelinePromptSnapshot(260);
        });
        __timelinePromptObserver.observe(targetNode, {
            childList: true,
            subtree: true,
            characterData: true
        });
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            startObserver();
            scheduleTimelinePromptSnapshot(160, { force: true });
        }, { once: true });
    } else {
        startObserver();
        scheduleTimelinePromptSnapshot(160, { force: true });
    }

    window.addEventListener('load', () => {
        scheduleTimelinePromptSnapshot(120, { force: true });
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            scheduleTimelinePromptSnapshot(180, { force: true });
        }
    });

    [900, 2400, 5200].forEach((delay) => {
        setTimeout(() => {
            scheduleTimelinePromptSnapshot(0, { force: true });
        }, delay);
    });
}

initializeTimelinePromptPush();

function ensureTimelinePromptHighlightStyle() {
    if (document.getElementById('ai-compare-timeline-highlight-style')) return;
    const style = document.createElement('style');
    style.id = 'ai-compare-timeline-highlight-style';
    style.textContent = `
      .ai-compare-timeline-highlight {
        outline: 2px solid #111 !important;
        outline-offset: 4px !important;
        border-radius: 10px !important;
      }
    `;
    document.documentElement.appendChild(style);
}

let activeTimelineHighlightNode = null;
let activeTimelineHighlightTimer = null;

function highlightTimelinePromptNode(node) {
    if (!node) return;
    ensureTimelinePromptHighlightStyle();
    if (activeTimelineHighlightNode && activeTimelineHighlightNode !== node) {
        activeTimelineHighlightNode.classList.remove('ai-compare-timeline-highlight');
    }
    if (activeTimelineHighlightTimer) {
        clearTimeout(activeTimelineHighlightTimer);
    }
    activeTimelineHighlightNode = node;
    node.classList.add('ai-compare-timeline-highlight');
    activeTimelineHighlightTimer = setTimeout(() => {
        node.classList.remove('ai-compare-timeline-highlight');
        if (activeTimelineHighlightNode === node) {
            activeTimelineHighlightNode = null;
        }
    }, 2200);
}

async function scrollToPromptForTimeline(siteHandler, query, occurrenceIndex) {
    const promptRecords = collectTimelinePromptRecords(siteHandler);
    const matchedPrompt = findTimelinePromptRecord(promptRecords, query, occurrenceIndex);
    if (!matchedPrompt) {
        return {
            found: false,
            error: 'Prompt not found'
        };
    }

    const scrollTarget = matchedPrompt.anchor || matchedPrompt.container;
    scrollTarget.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'nearest'
    });
    highlightTimelinePromptNode(scrollTarget);

    return {
        found: true
    };
}

async function extractPromptResponseForTimeline(siteHandler, query, occurrenceIndex) {
    const core = getAICompareExtractionCore();
    if (!core?.extractPromptResponseForTimeline) {
        return {
            found: false,
            error: 'Extraction core unavailable'
        };
    }

    return core.extractPromptResponseForTimeline(document, siteHandler, query, occurrenceIndex);
}

function looksLikeConfiguredPageShell(siteHandler, content) {
    if (!content) return true;

    const normalized = String(content).trim();
    if (!normalized || normalized === '●') {
        return true;
    }

    return matchesRuntimePatterns(normalized, siteHandler?.contentExtractor?.latestVisibleResponse?.shellPatterns || []);
}

async function extractMessagesWithContainerForInject(contentExtractor, siteName) {
    const result = await window.AICompareExtraction?.extractMessagesWithContainer?.(document, { contentExtractor }, siteName, {
        waitTimeoutMs: 1000
    });
    return result?.content || '';
}

// 使用配置文件提取内容（优化版）
async function extractWithConfig(contentExtractor, siteName) {
    console.log(`🔍 使用 ${siteName} 配置提取内容...`);
    console.log('🔍 内容提取配置:', contentExtractor);
    
    const startTime = performance.now();
    let content = '';
    let extractionMethod = '';
    
    try {
        const sharedResult = await window.AICompareExtraction?.extractDocumentContent?.(document, siteName, { contentExtractor }, {
            includePageTextFallback: false,
            waitTimeoutMs: 1000
        });

        if (sharedResult?.content && !sharedResult.content.includes('无法自动提取')) {
            extractionMethod = sharedResult.extractionMethod || 'shared-core';
            console.log(`✅ 共享提取内核成功: ${extractionMethod}`);
            return sharedResult.content;
        }

        if (contentExtractor?.latestVisibleResponse) {
            console.log('⏳ latestVisibleResponse 已启用，但当前尚无稳定内容，跳过额外兜底提取');
            return '';
        }
        
        // 3. 尝试智能内容检测
        console.log('🔍 尝试智能内容检测...');
        content = await intelligentContentDetection(siteName);
        
        if (content.trim() && !content.includes('无法自动提取')) {
            extractionMethod = '智能检测';
            console.log('✅ 智能内容检测成功');
            return content;
        }
        
        // 4. 最后尝试通用内容提取
        console.log('🔍 尝试通用内容提取...');
        content = await genericContentExtraction(siteName);
        
        if (content.trim() && !content.includes('无法自动提取')) {
            extractionMethod = '通用提取';
            console.log('✅ 通用内容提取成功');
            return content;
        }
        
    } catch (error) {
        console.error('❌ 内容提取过程中发生错误:', error);
        return `内容提取失败: ${error.message}`;
    } finally {
        const endTime = performance.now();
        const duration = endTime - startTime;
        console.log(`📊 内容提取完成 - 方法: ${extractionMethod || '失败'}, 耗时: ${duration.toFixed(2)}ms`);
    }
}

// 启动历史记录 URL 检测
// 持续检测当前页面的 URL 是否包含指定的 urlFeature，如果匹配则通知父窗口更新历史记录
function startHistoryUrlDetection(siteName, urlFeature, historyId) {
  console.log(`🔍 开始检测 ${siteName} 的 URL 特征: ${urlFeature}`);
  const targetHistoryId = historyId || __aiCompareHistoryContext.historyId || null;
  
  let lastMatchedUrl = null; // 记录上一次匹配的 URL，避免重复发送
  let checkInterval = null;
  let checkCount = 0;
  const maxChecks = 60; // 最多检测 60 次（30秒，每次间隔500ms）
  
  // 检查 URL 是否匹配
  const checkUrl = () => {
    try {
      const currentUrl = window.location.href;
      const currentPath = window.location.pathname;
      
      // 检查 URL 路径是否包含 urlFeature
      if (currentPath.includes(urlFeature)) {
        if (SiteLaunchUtils.isLikelyPlaceholderHistoryUrl?.(currentUrl, siteName)) {
          console.log(`⏳ ${siteName} 命中占位页 URL，继续等待真实历史地址: ${currentUrl}`);
          return false;
        }
        // URL 匹配，且与上次匹配的 URL 不同
        if (currentUrl !== lastMatchedUrl) {
          lastMatchedUrl = currentUrl;
          console.log(`✅ ${siteName} URL 匹配成功: ${currentUrl}`);
          
          // 发送消息通知父窗口更新历史记录
          window.parent.postMessage({
            type: 'HISTORY_URL_UPDATE',
            source: 'inject-script',
            siteName: siteName,
            url: currentUrl,
            historyId: targetHistoryId
          }, '*');
          
          console.log(`📤 已通知父窗口更新 ${siteName} 的历史记录 URL`);
          
          // 停止检测
          if (checkInterval) {
            clearInterval(checkInterval);
            checkInterval = null;
          }
          return true;
        }
      }
      
      checkCount++;
      if (checkCount >= maxChecks) {
        console.log(`⏰ ${siteName} URL 检测超时（${maxChecks} 次检查），停止检测`);
        if (checkInterval) {
          clearInterval(checkInterval);
          checkInterval = null;
        }
        return false;
      }
      
      return false;
    } catch (error) {
      console.error(`❌ ${siteName} URL 检测失败:`, error);
      if (checkInterval) {
        clearInterval(checkInterval);
        checkInterval = null;
      }
      return false;
    }
  };
  
  // 立即检查一次（页面可能已经跳转）
  if (checkUrl()) {
    return; // 如果立即匹配，则不再设置定时器
  }
  
  // 每 500ms 检查一次
  checkInterval = setInterval(checkUrl, 500);
  
  // 同时监听 URL 变化事件（pushState, replaceState, popstate, hashchange）
  const urlChangeHandler = () => {
    checkUrl();
  };
  
  // 包装原生方法以监听 URL 变化
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  
  history.pushState = function(...args) {
    originalPushState.apply(history, args);
    setTimeout(urlChangeHandler, 100); // 延迟检查，确保 URL 已更新
  };
  
  history.replaceState = function(...args) {
    originalReplaceState.apply(history, args);
    setTimeout(urlChangeHandler, 100);
  };
  
  window.addEventListener('popstate', urlChangeHandler);
  window.addEventListener('hashchange', urlChangeHandler);
  
  console.log(`⏱️ ${siteName} URL 检测已启动，将每 500ms 检查一次，最多检测 ${maxChecks} 次`);
}

// 直接模式：更新本地历史记录中的站点 URL
async function updateLocalHistorySiteUrl(siteName, url, historyId) {
  try {
    if (!historyId || !siteName || !url) return;
    if (SiteLaunchUtils.isLikelyPlaceholderHistoryUrl?.(url, siteName)) return;
    const { pkHistory = [] } = await safeStorageGet('pkHistory');
    const historyIndex = pkHistory.findIndex(item => item.id === historyId);
    if (historyIndex === -1) return;
    const historyItem = pkHistory[historyIndex];
    const updatedSites = (historyItem.sites || []).map(site => {
      if (site.name === siteName) {
        return { ...site, url };
      }
      return site;
    });
    const updatedHistory = [...pkHistory];
    updatedHistory[historyIndex] = { ...historyItem, sites: updatedSites };
    await safeStorageSet({ pkHistory: updatedHistory });
  } catch (error) {
    console.error('直接模式更新历史 URL 失败:', error);
  }
}

// 直接模式：检测 URL 并更新历史记录
function startDirectHistoryUrlDetection(siteName, urlFeature, historyId) {
  const targetHistoryId = historyId || __directHistoryContext.historyId || null;
  if (!targetHistoryId) return;
  let lastMatchedUrl = null;
  let checkCount = 0;
  const maxChecks = 60;
  const interval = setInterval(async () => {
    try {
      const currentUrl = window.location.href;
      const currentPath = window.location.pathname;
      if (currentPath.includes(urlFeature)) {
        if (SiteLaunchUtils.isLikelyPlaceholderHistoryUrl?.(currentUrl, siteName)) {
          return;
        }
        if (currentUrl !== lastMatchedUrl) {
          lastMatchedUrl = currentUrl;
          await updateLocalHistorySiteUrl(siteName, currentUrl, targetHistoryId);
          clearInterval(interval);
          return;
        }
      }
      checkCount++;
      if (checkCount >= maxChecks) {
        clearInterval(interval);
      }
    } catch (error) {
      clearInterval(interval);
    }
  }, 500);
}

function extractEditableText(target) {
  if (!target) return '';
  const tag = target.tagName?.toLowerCase();
  if (tag === 'textarea' || (tag === 'input' && (target.type === 'text' || target.type === 'search'))) {
    const text = target.value || '';
    console.log('DirectHistory: extract textarea/input', { text: text.slice(0, 80) });
    return text;
  }
  const isSlateEditor = target.getAttribute && target.getAttribute('data-slate-editor') === 'true';
  if (isSlateEditor) {
    const strings = target.querySelectorAll('[data-slate-string]');
    const text = Array.from(strings).map(node => node.textContent || '').join('');
    console.log('DirectHistory: extract slate', { text: text.slice(0, 80) });
    return text;
  }
  if (target.isContentEditable) {
    const text = target.innerText || '';
    console.log('DirectHistory: extract contenteditable', { text: text.slice(0, 80) });
    return text;
  }
  return '';
}

async function saveDirectHistory(query, siteName, siteConfig) {
  if (!query || !siteName) return;
  if (!isExtensionContextValid()) {
    console.warn('DirectHistory: extension context invalid, skip save');
    return;
  }
  const now = Date.now();
  if (query === __directHistoryLastQuery && now - __directHistoryLastAt < 2000) return;
  __directHistoryLastQuery = query;
  __directHistoryLastAt = now;
  console.log('DirectHistory: save', { siteName, query: query.slice(0, 80) });

  let urlToSave = window.location.href;
  if (SiteLaunchUtils.isLikelyPlaceholderHistoryUrl?.(urlToSave, siteName)) {
    urlToSave = '';
  }
  if (siteConfig?.historyHandler?.urlFeature) {
    try {
      const currentPath = window.location.pathname;
      if (!currentPath.includes(siteConfig.historyHandler.urlFeature)) {
        urlToSave = '';
      }
    } catch (_) {
      urlToSave = '';
    }
  }

  const historyId = Date.now().toString();
  const historyItem = {
    id: historyId,
    query: query.trim(),
    sites: [{ name: siteName, url: urlToSave, isFavorite: false }],
    timestamp: Date.now(),
    date: new Date().toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  };

  const { pkHistory = [] } = await safeStorageGet('pkHistory');
  console.log('DirectHistory: pkHistory size', pkHistory.length);
  let updatedHistory = pkHistory;
  const lastItem = pkHistory[0];
  if (lastItem && lastItem.query === historyItem.query && lastItem.sites?.[0]?.name === siteName) {
    const merged = {
      ...lastItem,
      timestamp: historyItem.timestamp,
      date: historyItem.date,
      sites: [{ ...lastItem.sites[0], url: urlToSave || lastItem.sites[0].url || '' }]
    };
    updatedHistory = [merged, ...pkHistory.slice(1)];
    __directHistoryContext.historyId = lastItem.id;
  } else {
    updatedHistory = [historyItem, ...pkHistory];
    __directHistoryContext.historyId = historyId;
  }

  let maxHistory = 100;
  try {
    if (window.AppConfigManager) {
      const appConfig = await window.AppConfigManager.loadConfig();
      if (appConfig?.history?.maxCount) maxHistory = appConfig.history.maxCount;
    }
  } catch (_) {}
  updatedHistory = updatedHistory.slice(0, maxHistory);
  await safeStorageSet({ pkHistory: updatedHistory });
  console.log('DirectHistory: saved', { historyId: __directHistoryContext.historyId || historyId });

  __directHistoryContext.siteName = siteName;

  if (siteConfig?.historyHandler?.urlFeature) {
    startDirectHistoryUrlDetection(siteName, siteConfig.historyHandler.urlFeature, __directHistoryContext.historyId);
  }
}

async function initDirectHistoryTracking() {
  if (__directHistoryInit) return;
  __directHistoryInit = true;

  // 仅在非 iframe 的页面记录（避免第三方 iframe 干扰）
  if (window.top !== window) {
    console.log('DirectHistory: in iframe, skip', window.location.hostname);
    return;
  }

  // 仅跳过插件 iframe
  if (isRunningInExtensionIframe()) {
    console.log('DirectHistory: in extension iframe, skip');
    return;
  }

  const isAI = await checkAISite();
  if (!isAI) {
    console.log('DirectHistory: not AI site, skip');
    return;
  }

  const domain = window.location.hostname;
  const siteHandler = await getSiteHandler(domain);
  const siteName = siteHandler?.name || (window.getSiteNameFromDomain ? await window.getSiteNameFromDomain(domain) : domain);
  console.log('DirectHistory: init', { domain, siteName });

  document.addEventListener('compositionstart', () => {
    __directHistoryIsComposing = true;
  }, true);
  document.addEventListener('compositionend', () => {
    __directHistoryIsComposing = false;
  }, true);

  document.addEventListener('keydown', async (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.isComposing || __directHistoryIsComposing) return;
    const target = event.target;
    const text = extractEditableText(target);
    if (!text || !text.trim()) return;
    console.log('DirectHistory: keydown submit', { siteName, text: text.trim().slice(0, 80) });
    await saveDirectHistory(text.trim(), siteName, siteHandler);
  }, true);

  document.addEventListener('click', async (event) => {
    const target = event.target;
    if (!target) return;
    const button = target.closest('button, [role="button"], input[type="submit"]');
    if (!button || button.disabled) return;
    const active = document.activeElement;
    const text = extractEditableText(active);
    if (!text || !text.trim()) return;
    console.log('DirectHistory: click submit', { siteName, text: text.trim().slice(0, 80) });
    await saveDirectHistory(text.trim(), siteName, siteHandler);
  }, true);
}

initDirectHistoryTracking();

function buildCompareUrl(query) {
  if (!query || !query.trim()) return '';
  try {
    const baseUrl = chrome?.runtime?.getURL ? chrome.runtime.getURL('iframe/iframe.html') : '';
    if (!baseUrl) return '';
    const params = new URLSearchParams();
    params.set('query', query.trim());
    return `${baseUrl}?${params.toString()}`;
  } catch (e) {
    console.error('buildCompareUrl failed:', e);
    return '';
  }
}

// ─── 直接使用 AI 站点时的收藏功能 ───

let __favModalStylesInjected = false;

function injectFavModalStyles() {
  if (__favModalStylesInjected) return;
  __favModalStylesInjected = true;
  const style = document.createElement('style');
  style.id = 'ai-fav-modal-styles';
  style.textContent = `
    .ai-fav-modal-overlay{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.4);z-index:2147483646;display:flex;align-items:center;justify-content:center;animation:aiFavFadeIn 0.15s ease}
    @keyframes aiFavFadeIn{from{opacity:0}to{opacity:1}}
    @keyframes aiFavSlideIn{from{opacity:0;transform:translateY(-12px) scale(0.97)}to{opacity:1;transform:translateY(0) scale(1)}}
    .ai-fav-modal{background:#fff;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,0.18);width:360px;max-width:90vw;max-height:80vh;display:flex;flex-direction:column;overflow:hidden;animation:aiFavSlideIn 0.2s ease;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
    .ai-fav-modal-header{display:flex;align-items:center;justify-content:space-between;padding:16px 20px 12px;border-bottom:1px solid #f0f0f0}
    .ai-fav-modal-header h3{margin:0;font-size:16px;font-weight:600;color:#333}
    .ai-fav-modal-close{width:28px;height:28px;border:none;background:none;cursor:pointer;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#999;font-size:18px;transition:all 0.15s ease}
    .ai-fav-modal-close:hover{background:#f5f5f5;color:#333}
    .ai-fav-modal-body{padding:12px 20px;overflow-y:auto;flex:1}
    .ai-fav-folder-list{display:flex;flex-direction:column;gap:4px}
    .ai-fav-folder-item{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;cursor:pointer;transition:background 0.15s ease;user-select:none}
    .ai-fav-folder-item:hover{background:#f5f7fa}
    .ai-fav-folder-item.selected{background:#eef4ff}
    .ai-fav-folder-radio{width:18px;height:18px;border:2px solid #ccc;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all 0.15s ease}
    .ai-fav-folder-item.selected .ai-fav-folder-radio{border-color:#4a90e2}
    .ai-fav-folder-radio-inner{width:10px;height:10px;border-radius:50%;background:transparent;transition:background 0.15s ease}
    .ai-fav-folder-item.selected .ai-fav-folder-radio-inner{background:#4a90e2}
    .ai-fav-folder-name{flex:1;font-size:14px;color:#333;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .ai-fav-folder-count{font-size:12px;color:#999;flex-shrink:0}
    .ai-fav-folder-new-row{display:flex;align-items:center;gap:8px;margin-top:8px;padding-top:8px;border-top:1px solid #f0f0f0}
    .ai-fav-folder-new-btn{display:flex;align-items:center;gap:6px;padding:8px 12px;border:1px dashed #ccc;border-radius:8px;background:none;cursor:pointer;color:#666;font-size:13px;transition:all 0.15s ease;width:100%}
    .ai-fav-folder-new-btn:hover{border-color:#4a90e2;color:#4a90e2;background:#f8faff}
    .ai-fav-folder-new-input-row{display:flex;align-items:center;gap:8px;width:100%}
    .ai-fav-folder-new-input{flex:1;padding:8px 12px;border:1px solid #ddd;border-radius:8px;font-size:13px;outline:none;transition:border-color 0.15s ease}
    .ai-fav-folder-new-input:focus{border-color:#4a90e2}
    .ai-fav-folder-new-confirm{width:32px;height:32px;border:none;background:#4a90e2;color:#fff;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background 0.15s ease}
    .ai-fav-folder-new-confirm:hover{background:#3a7bd5}
    .ai-fav-folder-new-cancel{width:32px;height:32px;border:1px solid #ddd;background:#fff;color:#999;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all 0.15s ease}
    .ai-fav-folder-new-cancel:hover{border-color:#ccc;color:#666}
    .ai-fav-modal-footer{display:flex;justify-content:flex-end;gap:10px;padding:12px 20px 16px;border-top:1px solid #f0f0f0}
    .ai-fav-modal-footer button{padding:8px 20px;border-radius:8px;font-size:14px;font-weight:500;cursor:pointer;transition:all 0.15s ease}
    .ai-fav-modal-remove-btn{background:#fff;border:1px solid #fca5a5;color:#dc2626}
    .ai-fav-modal-remove-btn:hover{background:#fef2f2;border-color:#f87171;color:#b91c1c}
    .ai-fav-modal-save-btn{background:#4a90e2;border:1px solid #4a90e2;color:#fff}
    .ai-fav-modal-save-btn:hover{background:#3a7bd5}
    .ai-fav-modal-save-btn:disabled{background:#b0c4de;border-color:#b0c4de;cursor:not-allowed}
    .ai-fav-toast{position:fixed;bottom:32px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.75);color:#fff;padding:8px 20px;border-radius:8px;font-size:13px;z-index:2147483647;pointer-events:none;animation:aiFavFadeIn 0.2s ease}
  `;
  (document.head || document.documentElement).appendChild(style);
}

const AI_FAV_FOLDERS_KEY = 'favoriteFolders';
const AI_FAV_DEFAULT_FOLDER_ID = 'default';

async function getAiFavFolders() {
  const data = await safeStorageGet(AI_FAV_FOLDERS_KEY);
  return data[AI_FAV_FOLDERS_KEY] || [];
}

async function saveAiFavFolders(folders) {
  await safeStorageSet({ [AI_FAV_FOLDERS_KEY]: folders });
}

async function ensureAiFavDefaultFolder() {
  let folders = await getAiFavFolders();
  if (!folders.find(f => f.id === AI_FAV_DEFAULT_FOLDER_ID)) {
    folders.unshift({ id: AI_FAV_DEFAULT_FOLDER_ID, name: t('favFolderDefault', '默认收藏'), createdAt: Date.now(), order: 0 });
    await saveAiFavFolders(folders);
  }
  return folders;
}

async function getAiFavFolderCounts() {
  const { pkHistory = [] } = await safeStorageGet('pkHistory');
  const counts = {};
  pkHistory.forEach(item => {
    if (!item.sites) return;
    const seen = new Set();
    item.sites.forEach(site => {
      if (site.isFavorite) {
        const fid = site.favoriteFolder || AI_FAV_DEFAULT_FOLDER_ID;
        if (!seen.has(fid)) { counts[fid] = (counts[fid] || 0) + 1; seen.add(fid); }
      }
    });
  });
  return counts;
}

async function checkPromptIsFavorited(text, siteName) {
  const { pkHistory = [] } = await safeStorageGet('pkHistory');
  return pkHistory.some(item =>
    item.query === text.trim() &&
    item.sites && item.sites.some(s => s.name === siteName && s.isFavorite === true)
  );
}

async function getFavoritedFolderId(text, siteName) {
  const { pkHistory = [] } = await safeStorageGet('pkHistory');
  const item = pkHistory.find(h =>
    h.query === text.trim() && h.sites && h.sites.some(s => s.name === siteName && s.isFavorite)
  );
  if (!item) return AI_FAV_DEFAULT_FOLDER_ID;
  const site = item.sites.find(s => s.name === siteName && s.isFavorite);
  return site?.favoriteFolder || AI_FAV_DEFAULT_FOLDER_ID;
}

async function saveFavoritePromptToHistory(text, siteName, folderId, remove) {
  const { pkHistory = [] } = await safeStorageGet('pkHistory');
  const trimmedText = text.trim();
  const idx = pkHistory.findIndex(item =>
    item.query === trimmedText && item.sites && item.sites.some(s => s.name === siteName)
  );
  let updated;
  if (idx !== -1) {
    updated = pkHistory.slice();
    updated[idx] = {
      ...updated[idx],
      sites: updated[idx].sites.map(s => {
        if (s.name !== siteName) return s;
        const upd = { ...s, isFavorite: !remove };
        if (!remove && folderId) upd.favoriteFolder = folderId;
        if (remove) delete upd.favoriteFolder;
        return upd;
      })
    };
  } else if (!remove) {
    const newItem = {
      id: Date.now().toString(),
      query: trimmedText,
      sites: [{ name: siteName, url: window.location.href, isFavorite: true, favoriteFolder: folderId || AI_FAV_DEFAULT_FOLDER_ID }],
      timestamp: Date.now(),
      date: new Date().toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    };
    updated = [newItem, ...pkHistory];
  } else {
    return;
  }
  await safeStorageSet({ pkHistory: updated });
  if (typeof window.firebaseSyncUploadIfLoggedIn === 'function') window.firebaseSyncUploadIfLoggedIn();
}

function showAiFavToast(msg) {
  injectFavModalStyles();
  const toast = document.createElement('div');
  toast.className = 'ai-fav-toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
}

function showAiFavModal(currentFolderId, onDone) {
  injectFavModalStyles();
  let resolved = false;
  function finish(result) {
    if (resolved) return;
    resolved = true;
    overlay.remove();
    document.removeEventListener('keydown', onKeydown);
    onDone(result);
  }

  const overlay = document.createElement('div');
  overlay.className = 'ai-fav-modal-overlay';
  overlay.addEventListener('click', e => { if (e.target === overlay) finish(null); });

  const modal = document.createElement('div');
  modal.className = 'ai-fav-modal';

  const header = document.createElement('div');
  header.className = 'ai-fav-modal-header';
  const titleEl = document.createElement('h3');
  titleEl.textContent = t('favFolderSaveToFolder', '保存到收藏夹');
  const closeBtn = document.createElement('button');
  closeBtn.className = 'ai-fav-modal-close';
  closeBtn.innerHTML = '&#x2715;';
  closeBtn.addEventListener('click', () => finish(null));
  header.appendChild(titleEl);
  header.appendChild(closeBtn);

  const body = document.createElement('div');
  body.className = 'ai-fav-modal-body';

  const listEl = document.createElement('div');
  listEl.className = 'ai-fav-folder-list';

  let folders = [];
  let counts = {};
  let selectedId = currentFolderId || AI_FAV_DEFAULT_FOLDER_ID;

  function renderList() {
    listEl.innerHTML = '';
    folders.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
    folders.forEach(folder => {
      const item = document.createElement('div');
      item.className = 'ai-fav-folder-item' + (folder.id === selectedId ? ' selected' : '');
      const radio = document.createElement('div');
      radio.className = 'ai-fav-folder-radio';
      const inner = document.createElement('div');
      inner.className = 'ai-fav-folder-radio-inner';
      radio.appendChild(inner);
      const nameEl = document.createElement('span');
      nameEl.className = 'ai-fav-folder-name';
      nameEl.textContent = folder.name;
      const countEl = document.createElement('span');
      countEl.className = 'ai-fav-folder-count';
      const c = counts[folder.id] || 0;
      countEl.textContent = c > 0 ? `${c}` : '';
      item.appendChild(radio);
      item.appendChild(nameEl);
      item.appendChild(countEl);
      item.addEventListener('click', () => { selectedId = folder.id; renderList(); });
      listEl.appendChild(item);
    });
  }

  body.appendChild(listEl);

  const newRow = document.createElement('div');
  newRow.className = 'ai-fav-folder-new-row';
  const newBtn = document.createElement('button');
  newBtn.className = 'ai-fav-folder-new-btn';
  newBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> <span>${t('favFolderNewFolder', '新建文件夹')}</span>`;

  const inputRow = document.createElement('div');
  inputRow.className = 'ai-fav-folder-new-input-row';
  inputRow.style.display = 'none';

  const newInput = document.createElement('input');
  newInput.className = 'ai-fav-folder-new-input';
  newInput.type = 'text';
  newInput.placeholder = t('favFolderNamePlaceholder', '输入文件夹名称');
  newInput.maxLength = 30;

  const confirmNewBtn = document.createElement('button');
  confirmNewBtn.className = 'ai-fav-folder-new-confirm';
  confirmNewBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7l4 4 6-8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const cancelNewBtn = document.createElement('button');
  cancelNewBtn.className = 'ai-fav-folder-new-cancel';
  cancelNewBtn.innerHTML = '&#x2715;';

  inputRow.appendChild(newInput);
  inputRow.appendChild(confirmNewBtn);
  inputRow.appendChild(cancelNewBtn);

  newBtn.addEventListener('click', () => {
    newBtn.style.display = 'none';
    inputRow.style.display = 'flex';
    newInput.value = '';
    newInput.focus();
  });
  cancelNewBtn.addEventListener('click', () => {
    inputRow.style.display = 'none';
    newBtn.style.display = 'flex';
  });

  async function createFolder() {
    const name = newInput.value.trim();
    if (!name) return;
    const id = 'folder_' + Date.now();
    folders.push({ id, name, createdAt: Date.now(), order: folders.length });
    await saveAiFavFolders(folders);
    selectedId = id;
    renderList();
    inputRow.style.display = 'none';
    newBtn.style.display = 'flex';
  }

  confirmNewBtn.addEventListener('click', createFolder);
  newInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); createFolder(); }
    if (e.key === 'Escape') { inputRow.style.display = 'none'; newBtn.style.display = 'flex'; }
  });

  newRow.appendChild(newBtn);
  newRow.appendChild(inputRow);
  body.appendChild(newRow);

  const footer = document.createElement('div');
  footer.className = 'ai-fav-modal-footer';

  const removeBtn = document.createElement('button');
  removeBtn.className = 'ai-fav-modal-remove-btn';
  removeBtn.textContent = t('favFolderRemove', '移除收藏');
  removeBtn.addEventListener('click', () => finish({ action: 'remove' }));

  const saveBtn = document.createElement('button');
  saveBtn.className = 'ai-fav-modal-save-btn';
  saveBtn.textContent = t('saveButton', '保存');
  saveBtn.addEventListener('click', () => finish({ folderId: selectedId }));

  footer.appendChild(removeBtn);
  footer.appendChild(saveBtn);
  modal.appendChild(header);
  modal.appendChild(body);
  modal.appendChild(footer);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  (async () => {
    folders = await ensureAiFavDefaultFolder();
    counts = await getAiFavFolderCounts();
    renderList();
  })();

  function onKeydown(e) {
    if (e.key === 'Escape') finish(null);
  }
  document.addEventListener('keydown', onKeydown);
}

async function initDirectUserPromptButtons() {
  if (__userPromptButtonsInit) return;
  __userPromptButtonsInit = true;

  const isAI = await checkAISite();
  if (!isAI) {
    console.log('DirectUserPrompt: not AI site, skip');
    return;
  }

  if (window.__aiCompareUserPromptButtonsInitialized) {
    console.log('DirectUserPrompt: already initialized on this page, skip');
    return;
  }
  window.__aiCompareUserPromptButtonsInitialized = true;

  const domain = window.location.hostname;
  const siteHandler = await getSiteHandler(domain);
  const siteName = siteHandler?.name || (window.getSiteNameFromDomain ? await window.getSiteNameFromDomain(domain) : domain);
  let config = siteHandler?.userPrompt || siteHandler?.userPromptButton;
  // 始终尝试合并本地配置（本地字段优先），避免远端配置滞后导致按钮逻辑不一致
  try {
    if (chrome?.runtime?.getURL) {
      const resp = await fetch(chrome.runtime.getURL('config/siteHandlers.json'));
      if (resp.ok) {
        const localConfig = await resp.json();
        const matched = (localConfig.sites || []).find(s => {
          try {
            const host = new URL(s.url).hostname;
            return host === domain || domain.includes(host) || host.includes(domain);
          } catch (_) {
            return false;
          }
        });
        const localPromptConfig = matched?.userPrompt || matched?.userPromptButton;
        if (localPromptConfig) {
          config = {
            ...(config || {}),
            ...localPromptConfig
          };
        }
      }
    }
  } catch (_) {}
  if (!config?.textSelector) {
    console.log('DirectUserPrompt: missing config, skip', { siteName });
    return;
  }

  console.log('DirectUserPrompt: init', { siteName, config });
  const inExtensionIframe = isRunningInExtensionIframe();
  let userPromptLabel = chrome?.i18n?.getMessage?.('compareButtonLabel') || '多AI 对比';
  const labelZh = chrome?.i18n?.getMessage?.('compareButtonLabelZh') || '多AI 对比';
  const labelEn = chrome?.i18n?.getMessage?.('compareButtonLabelEn') || 'Multi-AI Compare';
  try {
    const { compareButtonLang } = await chrome.storage.sync.get(['compareButtonLang']);
    if (compareButtonLang === 'zh') {
      userPromptLabel = labelZh;
    } else if (compareButtonLang === 'en') {
      userPromptLabel = labelEn;
    } else if (compareButtonLang === 'bilingual') {
      userPromptLabel = `${labelZh} / ${labelEn}`;
    }
  } catch (e) {
    console.warn('DirectUserPrompt: read compareButtonLang failed', e);
  }

  const wrapToContainer = new WeakMap();
  const containerToWrap = new WeakMap();
  const wrapToMessageNode = new WeakMap();
  const messageNodeToWrap = new WeakMap();
  const messageKeyToWrap = new Map();
  const ensureUserPromptButtonStyles = (() => {
    let injected = false;
    return () => {
      if (injected) return;
      injected = true;
      const style = document.createElement('style');
      style.id = 'ai-compare-userprompt-btn-styles';
      style.textContent = `
        .ai-compare-userprompt-btn-wrap {
          position: fixed;
          transform: translateY(-50%);
          z-index: 9999;
          pointer-events: auto;
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        .ai-compare-userprompt-btn-wrap.ai-compare-userprompt-btn-wrap-extension {
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.15s ease;
        }
        html:hover .ai-compare-userprompt-btn-wrap.ai-compare-userprompt-btn-wrap-extension,
        body:hover .ai-compare-userprompt-btn-wrap.ai-compare-userprompt-btn-wrap-extension {
          opacity: 1;
          pointer-events: auto;
        }
        .ai-compare-userprompt-action-btn {
          border: 1px solid #dfdfdf;
          background: #fff;
          color: #333;
          border-radius: 8px;
          width: 34px;
          height: 34px;
          padding: 0;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          box-shadow: none;
          transition: border-color 0.15s ease, background 0.15s ease;
        }
        .ai-compare-userprompt-action-btn:hover {
          border-color: #111;
        }
        .ai-compare-userprompt-action-btn:focus,
        .ai-compare-userprompt-action-btn:focus-visible {
          outline: none;
          border-color: #111;
        }
        .ai-compare-userprompt-action-icon {
          width: 16px;
          height: 16px;
          display: block;
        }
      `;
      (document.head || document.documentElement).appendChild(style);
    };
  })();
  const messageNodeSelector = config.messageNodeSelector || '[data-testid="message-block-container"], [data-message-id], [data-turn-id]';
  const requireMessageNode = !!config.requireMessageNode;
  let skipMessageIdRegex = null;
  if (typeof config.skipMessageIdPattern === 'string' && config.skipMessageIdPattern.trim()) {
    try {
      skipMessageIdRegex = new RegExp(config.skipMessageIdPattern, 'i');
    } catch (error) {
      console.warn('DirectUserPrompt: invalid skipMessageIdPattern', config.skipMessageIdPattern, error);
    }
  }
  const getContainerMessageId = (container) => {
    const idContainer = container.closest('[data-message-id], [id]');
    return (idContainer?.getAttribute('data-message-id') || idContainer?.id || '').trim();
  };
  const getPositionAnchor = (container) => {
    const msgContent = container.closest('[data-testid="message_content"]');
    return msgContent?.firstElementChild || container.closest('[data-testid="message-block-container"]') || container;
  };
  const getMessageNode = (container) => {
    const messageNode = container.closest(messageNodeSelector);
    if (!messageNode && requireMessageNode) return null;
    return messageNode || container;
  };
  const removeWrap = (btnWrap) => {
    if (!btnWrap) return;
    const container = wrapToContainer.get(btnWrap);
    if (container && containerToWrap.get(container) === btnWrap) {
      containerToWrap.delete(container);
    }
    const key = btnWrap.dataset.messageKey;
    if (key && messageKeyToWrap.get(key) === btnWrap) {
      messageKeyToWrap.delete(key);
    }
    const messageNode = wrapToMessageNode.get(btnWrap);
    if (messageNode && messageNodeToWrap.get(messageNode) === btnWrap) {
      messageNodeToWrap.delete(messageNode);
    }
    wrapToMessageNode.delete(btnWrap);
    wrapToContainer.delete(btnWrap);
    btnWrap.remove();
  };
  const isContainerVisible = (container) => {
    try {
      const style = window.getComputedStyle(container);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      const rect = container.getBoundingClientRect();
      return rect.width > 4 && rect.height > 4;
    } catch (_) {
      return false;
    }
  };
  const getContainerMessageKey = (container, text) => {
    const messageId = getContainerMessageId(container);
    if (messageId) return `id:${messageId}`;
    const anchor = getPositionAnchor(container);
    const rect = anchor.getBoundingClientRect();
    const shortText = (text || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    return `txt:${shortText}|x:${Math.round(rect.left / 8)}|y:${Math.round(rect.top / 8)}`;
  };

  const updateFloatingPositions = () => {
    document.querySelectorAll('.ai-compare-userprompt-btn-wrap').forEach(btnWrap => {
      const container = wrapToContainer.get(btnWrap);
      if (!container) {
        removeWrap(btnWrap);
        return;
      }
      if (!document.contains(container)) {
        removeWrap(btnWrap);
        return;
      }
      const anchor = getPositionAnchor(container);
      const rect = anchor.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (rect.top < -50 || rect.bottom > vh + 50) {
        btnWrap.style.visibility = 'hidden';
      } else {
        const btnWidth = Math.max(btnWrap.offsetWidth || 0, 34);
        const btnHeight = Math.max(btnWrap.offsetHeight || 0, 34);
        const gap = 10;
        const maxX = Math.max(8, vw - btnWidth - 8);
        const rightX = rect.right + gap;
        const leftX = rect.left - btnWidth - gap;
        let x = rightX;
        if (rightX > maxX) {
          x = leftX >= 8 ? leftX : maxX;
        }

        const centerY = rect.top + rect.height / 2;
        const minCenterY = 8 + btnHeight / 2;
        const maxCenterY = vh - 8 - btnHeight / 2;
        const y = Math.min(Math.max(centerY, minCenterY), maxCenterY);

        btnWrap.style.visibility = '';
        btnWrap.style.left = `${Math.max(8, Math.min(x, maxX))}px`;
        btnWrap.style.top = `${y}px`;
      }
    });
  };

  const addButtonToContainer = (node) => {
    if (!node) return;
    const container = config.containerSelector ? node : (node.parentElement || node);
    if (!container) return;
    if (container.closest('.ai-compare-userprompt-btn-wrap, .ai-fav-modal-overlay, dialog, [role="dialog"], [aria-modal="true"]')) return;
    if (!isContainerVisible(container)) return;
    const messageId = getContainerMessageId(container);
    if (skipMessageIdRegex && messageId && skipMessageIdRegex.test(messageId)) return;
    const messageNode = getMessageNode(container);
    if (!messageNode) return;
    const existingMessageWrap = messageNodeToWrap.get(messageNode);
    if (existingMessageWrap && !document.contains(existingMessageWrap)) {
      removeWrap(existingMessageWrap);
    }
    if (existingMessageWrap && document.contains(existingMessageWrap)) return;
    const existingWrap = containerToWrap.get(container);
    if (existingWrap && !document.contains(existingWrap)) {
      removeWrap(existingWrap);
    }
    if (existingWrap && document.contains(existingWrap)) return;
    if (existingWrap) {
      removeWrap(existingWrap);
    }
    const textNode = config.containerSelector ? container.querySelector(config.textSelector) : node;
    const text = ((textNode || container).textContent || '').trim();
    if (!text) return;
    const messageKey = getContainerMessageKey(container, text);
    const keyedWrap = messageKeyToWrap.get(messageKey);
    if (keyedWrap && document.contains(keyedWrap)) return;
    if (keyedWrap) messageKeyToWrap.delete(messageKey);

    ensureUserPromptButtonStyles();
    const btnWrap = document.createElement('span');
    btnWrap.className = 'ai-compare-userprompt-btn-wrap';
    if (inExtensionIframe) {
      btnWrap.classList.add('ai-compare-userprompt-btn-wrap-extension');
    }
    btnWrap.dataset.messageKey = messageKey;
    wrapToContainer.set(btnWrap, container);
    containerToWrap.set(container, btnWrap);
    wrapToMessageNode.set(btnWrap, messageNode);
    messageNodeToWrap.set(messageNode, btnWrap);
    messageKeyToWrap.set(messageKey, btnWrap);

    if (!inExtensionIframe) {
      const btn = document.createElement('button');
      btn.className = 'ai-compare-userprompt-btn ai-compare-userprompt-action-btn';
      btn.title = userPromptLabel;
      btn.setAttribute('aria-label', userPromptLabel);
      const icon = document.createElement('img');
      icon.className = 'ai-compare-userprompt-action-icon';
      icon.src = chrome.runtime.getURL('icons/columns-2.svg');
      icon.alt = '';
      btn.appendChild(icon);
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const url = buildCompareUrl(text);
        if (url) {
          window.open(url, '_blank');
        }
      });
      btnWrap.appendChild(btn);
    }

    // 收藏按钮
    const favBtn = document.createElement('button');
    favBtn.className = 'ai-compare-userprompt-fav-btn ai-compare-userprompt-action-btn';
    const favIcon = document.createElement('img');
    favIcon.className = 'ai-compare-userprompt-action-icon';
    favIcon.alt = '';

    const updateFavBtnState = (isFavd) => {
      favIcon.src = chrome.runtime.getURL(isFavd ? 'icons/star_saved.svg' : 'icons/star_unsaved.svg');
      const title = isFavd ? t('removeFromFavorites', '取消收藏') : t('addToFavorites', '收藏');
      favBtn.title = title;
      favBtn.setAttribute('aria-label', title);
      favBtn.dataset.favorited = isFavd ? '1' : '0';
    };

    updateFavBtnState(false);
    favBtn.appendChild(favIcon);
    checkPromptIsFavorited(text, siteName).then(state => updateFavBtnState(state));

    favBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isFavd = favBtn.dataset.favorited === '1';
      const currentFolderId = isFavd ? await getFavoritedFolderId(text, siteName) : AI_FAV_DEFAULT_FOLDER_ID;
      showAiFavModal(currentFolderId, async (result) => {
        if (!result) return;
        const shouldRemove = result.action === 'remove';
        await saveFavoritePromptToHistory(text, siteName, result.folderId, shouldRemove);
        updateFavBtnState(!shouldRemove);
        showAiFavToast(shouldRemove ? t('removedFromFavorites', '已取消收藏') : t('savedToFavorites', '已收藏'));
      });
    });
    btnWrap.appendChild(favBtn);

    document.body.appendChild(btnWrap);
    updateFloatingPositions();
  };

  const onScrollResize = () => {
    requestAnimationFrame(updateFloatingPositions);
  };
  window.addEventListener('scroll', onScrollResize, true);
  window.addEventListener('resize', onScrollResize);

  const scan = () => {
    const rawContainers = Array.from(document.querySelectorAll(config.containerSelector || config.textSelector));
    // 去掉嵌套重复命中的节点，避免同一条消息出现多组按钮
    const containers = rawContainers.filter(node => !rawContainers.some(other => other !== node && other.contains(node)));
    console.log('DirectUserPrompt: scan containers', containers.length);
    containers.forEach(node => addButtonToContainer(node));
    updateFloatingPositions();
  };

  const waitForBody = () => new Promise(resolve => {
    if (document.body) return resolve();
    const timer = setInterval(() => {
      if (document.body) {
        clearInterval(timer);
        resolve();
      }
    }, 50);
  });

  await waitForBody();
  scan();
  const observer = new MutationObserver(() => scan());
  observer.observe(document.body, { childList: true, subtree: true });
  // 豆包等 SPA 的消息列表异步渲染，需延时重试
  [1000, 2500, 5000].forEach(ms => setTimeout(scan, ms));
  // 持续轮询以捕获新发送的消息（新对话中发送后不会触发页面级 MutationObserver）
  const pollInterval = setInterval(scan, 2000);
  setTimeout(() => clearInterval(pollInterval), 60000);
}

initDirectUserPromptButtons();

// 验证选择器有效性
function validateSelectors(selectors, searchRoot = document) {
    const validSelectors = [];
    for (const selector of selectors) {
        try {
            const elements = searchRoot.querySelectorAll(selector);
            if (elements.length > 0) {
                validSelectors.push(selector);
                console.log(`✅ 选择器 ${selector} 有效，找到 ${elements.length} 个元素`);
            } else {
                console.log(`⚠️ 选择器 ${selector} 无效，未找到元素`);
            }
        } catch (error) {
            console.error(`❌ 选择器 ${selector} 语法错误:`, error);
        }
    }
    return validSelectors;
}


// 优化版选择器提取内容
// maxMessages: 仅导出最新N条消息，null表示导出全部
async function extractWithSelectorsOptimized(selectors, siteName, excludeSelectors = [], messageContainer = null, maxMessages = null) {
    console.log(`🔍 开始提取 ${siteName} 的内容...`);
    console.log(`🔍 使用选择器:`, selectors);
    console.log(`🔍 排除选择器:`, excludeSelectors);
    console.log(`🔍 消息容器:`, messageContainer);
    console.log(`🔍 导出最新条数:`, maxMessages ?? '全部');
    
    let content = '';
    
    // 默认排除的选择器
    const defaultExcludeSelectors = ['nav', 'header', 'footer', '.sidebar', '.menu'];
    const allExcludeSelectors = [...defaultExcludeSelectors, ...(excludeSelectors || [])];
    
    // 如果指定了消息容器，先查找容器
    let searchRoot = document;
    let messageContainers = [];
    if (messageContainer) {
        messageContainers = Array.from(document.querySelectorAll(messageContainer));
        console.log(`🔍 找到 ${messageContainers.length} 个消息容器`);
        
        if (messageContainers.length === 0) {
            console.log(`⚠️ 未找到消息容器 ${messageContainer}，使用整个文档`);
        } else {
            // 导出规则：只导出每个站点最新内容
            if (maxMessages === 1 && messageContainers.length > 1) {
                messageContainers = messageContainers.slice(-1);
                console.log(`🔍 仅导出最新1条消息`);
            } else if (maxMessages && maxMessages > 0 && messageContainers.length > maxMessages) {
                messageContainers = messageContainers.slice(-maxMessages);
                console.log(`🔍 仅导出最新${maxMessages}条消息`);
            }
            console.log(`🔍 将在 ${messageContainers.length} 个消息容器中搜索内容`);
        }
    }
    
    // 如果没有消息容器，使用整个文档
    if (messageContainers.length === 0) {
        messageContainers = [document];
    }
    
    // 遍历所有消息容器进行内容提取
    for (const [containerIndex, container] of messageContainers.entries()) {
        console.log(`🔍 处理第 ${containerIndex + 1}/${messageContainers.length} 个消息容器`);
        
        
        // 验证选择器有效性
        const validSelectors = validateSelectors(selectors, container);
        console.log(`🔍 容器内有效选择器数量: ${validSelectors.length}/${selectors.length}`);
    
        // 使用 Promise.all 并行处理选择器
        const extractionPromises = validSelectors.map(async (selector) => {
            try {
                let elements = Array.from(container.querySelectorAll(selector));
                // 导出规则：只导出最新内容，当无messageContainer时仅取最后一个匹配元素
                if (maxMessages === 1 && elements.length > 1 && container === document) {
                    elements = elements.slice(-1);
                    console.log(`🔍 无消息容器时仅取最后1个匹配元素`);
                }
            
            if (elements.length === 0) return '';
            
            let selectorContent = '';
            
            for (const [index, element] of elements.entries()) {
                // 检查是否应该排除此元素
                const shouldExclude = allExcludeSelectors.some(excludeSelector => 
                    element.closest(excludeSelector)
                );
                
                if (shouldExclude) {
                    console.log(`🔍 排除元素:`, element);
                    continue;
                }
                
                // 等待元素内容加载完成
                await waitForContentLoad(element);
                
                // 尝试提取 markdown 格式的内容
                let text = await extractElementContent(element);
                
                if (text.trim()) {
                    selectorContent += `\n\n${text.trim()}\n`;
                }
            }
            
            return selectorContent;
            } catch (error) {
                console.warn(`容器内选择器 ${selector} 提取失败:`, error);
                return '';
            }
        });
        
        // 等待所有选择器处理完成
        const results = await Promise.all(extractionPromises);
        
        // 合并结果，去重处理
        const uniqueResults = [];
        const seenContent = new Set();
        
        for (const result of results) {
            if (result.trim() && !seenContent.has(result.trim())) {
                uniqueResults.push(result);
                seenContent.add(result.trim());
            }
        }
        
        content += uniqueResults.join('\n');
    }
    
    if (!content.trim()) {
        content = `无法自动提取 ${siteName} 的详细内容，请手动复制。`;
    }
    
    return content.trim();
}

// 等待内容加载完成
async function waitForContentLoad(element, timeout = 1000) {
    return window.AICompareExtraction?.waitForContentLoad?.(element, timeout);
}

// 提取元素内容（优化版）
async function extractElementContent(element) {
    return window.AICompareExtraction?.extractElementContent?.(element) || '';
}

// 清理提取的文本（保留换行，仅压缩行内空白）
function cleanExtractedText(text) {
    return window.AICompareExtraction?.cleanExtractedText?.(text) || '';
}

// 智能内容检测
async function intelligentContentDetection(siteName) {
    console.log(`🧠 开始智能内容检测 ${siteName}...`);
    
    try {
        // 1. 检测流式内容
        const streamingContent = await detectStreamingContent();
        if (streamingContent) {
            console.log('✅ 检测到流式内容');
            return streamingContent;
        }
        
        // 2. 检测最新生成的内容
        const latestContent = await detectLatestContent();
        if (latestContent) {
            console.log('✅ 检测到最新内容');
            return latestContent;
        }
        
        // 3. 检测高价值内容区域
        const valuableContent = await detectValuableContent();
        if (valuableContent) {
            console.log('✅ 检测到高价值内容');
            return valuableContent;
        }
        
    } catch (error) {
        console.error('智能内容检测失败:', error);
    }
    
    return '';
}

// 检测流式内容
async function detectStreamingContent() {
    const streamingSelectors = [
        '.streaming',
        '.typing',
        '.generating',
        '[class*="stream"]',
        '[class*="typing"]',
        '[class*="generating"]',
        '.result-streaming',
        '.response-streaming'
    ];
    
    for (const selector of streamingSelectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
            const content = await extractElementContent(elements[0]);
            if (content) {
                return content;
            }
        }
    }
    
    return '';
}

// 检测最新生成的内容
async function detectLatestContent() {
    // 查找最近添加的元素
    const recentElements = document.querySelectorAll('[class*="message"], [class*="response"], [class*="answer"]');
    
    if (recentElements.length === 0) return '';
    
    // 按时间戳或位置排序，获取最新的
    const latestElement = Array.from(recentElements).pop();
    const content = await extractElementContent(latestElement);
    
    if (content) {
        return content;
    }
    
    return '';
}

// 检测高价值内容区域
async function detectValuableContent() {
    const valuableSelectors = [
        'main',
        'article',
        '.content',
        '.main-content',
        '.chat-content',
        '.conversation',
        '.messages'
    ];
    
    for (const selector of valuableSelectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
            const content = await extractElementContent(elements[0]);
            if (content && content.length > 100) {
                return content;
            }
        }
    }
    
    return '';
}

// 通用内容提取
async function genericContentExtraction(siteName) {
    console.log(`🔧 开始通用内容提取 ${siteName}...`);
    
    try {
        // 获取页面主要内容
        const mainContent = document.querySelector('main') || document.querySelector('article') || document.body;
        
        if (mainContent) {
            const content = await extractElementContent(mainContent);
            if (content && content.length > 50) {
                return content;
            }
        }
        
        // 如果主要内容提取失败，尝试提取整个页面
        const bodyContent = document.body ? document.body.textContent || document.body.innerText : '';
        if (bodyContent && bodyContent.length > 100) {
            return cleanExtractedText(bodyContent);
        }
        
    } catch (error) {
        console.error('通用内容提取失败:', error);
    }
    
    return '';
}


// 将 HTML 转换为 Markdown
function convertHtmlToMarkdown(html) {
    try {
        // 创建一个临时容器来解析 HTML
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        tempDiv.querySelectorAll('script, style, noscript, svg, button').forEach(node => node.remove());
        
        // 简单的 HTML 到 Markdown 转换
        let markdown = tempDiv.innerHTML
            // 标题
            .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n')
            .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n')
            .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n')
            .replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n\n')
            .replace(/<h5[^>]*>(.*?)<\/h5>/gi, '##### $1\n\n')
            .replace(/<h6[^>]*>(.*?)<\/h6>/gi, '###### $1\n\n')
            
            // 粗体和斜体
            .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
            .replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**')
            .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
            .replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*')
            
            // 链接
            .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')
            
            // 代码
            .replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`')
            .replace(/<pre[^>]*><code[^>]*>(.*?)<\/code><\/pre>/gi, '```\n$1\n```')
            
            // 列表
            .replace(/<ul[^>]*>(.*?)<\/ul>/gis, (match, content) => {
                return content.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n') + '\n';
            })
            .replace(/<ol[^>]*>(.*?)<\/ol>/gis, (match, content) => {
                let counter = 1;
                return content.replace(/<li[^>]*>(.*?)<\/li>/gi, (liMatch, itemContent) => `${counter++}. ${itemContent}\n`) + '\n';
            })
            
            // 段落和块级元素（保留换行）
            .replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n')
            .replace(/<div[^>]*>([\s\S]*?)<\/div>/gi, '$1\n')
            
            // 换行
            .replace(/<br[^>]*\/?>/gi, '\n')
            
            // 表格（简单处理）
            .replace(/<table[^>]*>(.*?)<\/table>/gis, (match, content) => {
                // 提取表头
                const headerMatch = content.match(/<thead[^>]*>(.*?)<\/thead>/is);
                const bodyMatch = content.match(/<tbody[^>]*>(.*?)<\/tbody>/is);
                
                if (headerMatch && bodyMatch) {
                    // 处理表头
                    const headers = headerMatch[1].match(/<th[^>]*>(.*?)<\/th>/gi) || [];
                    const headerRow = headers.map(h => h.replace(/<[^>]*>/g, '').trim()).join(' | ');
                    
                    // 处理表体
                    const rows = bodyMatch[1].match(/<tr[^>]*>(.*?)<\/tr>/gi) || [];
                    const dataRows = rows.map(row => {
                        const cells = row.match(/<td[^>]*>(.*?)<\/td>/gi) || [];
                        return cells.map(cell => cell.replace(/<[^>]*>/g, '').trim()).join(' | ');
                    });
                    
                    return `\n${headerRow}\n${headers.map(() => '---').join(' | ')}\n${dataRows.join('\n')}\n\n`;
                }
                return match;
            })
            
            // 移除其他 HTML 标签
            .replace(/<[^>]*>/g, '')
            
            // 清理多余的空行
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        
        return markdown;
        
    } catch (error) {
        console.warn('HTML 到 Markdown 转换失败:', error);
        // 降级到纯文本
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        return tempDiv.textContent || tempDiv.innerText || '';
    }
}
