import {
  getIframeLoadBehavior
} from '../shared/iframe-query-run-utils.mjs';

const SiteLaunchUtils = window.SiteLaunchUtils || {};
const SubmitShortcutUtils = window.SubmitShortcutUtils || {};
const normalizeSendShortcutMode = typeof SubmitShortcutUtils.normalizeSendShortcutMode === 'function'
  ? SubmitShortcutUtils.normalizeSendShortcutMode
  : ((value) => value === 'modifierEnter' ? 'modifierEnter' : 'enter');
const shouldSubmitOnEnterKey = typeof SubmitShortcutUtils.shouldSubmitOnEnterKey === 'function'
  ? SubmitShortcutUtils.shouldSubmitOnEnterKey
  : ((eventLike, options = {}) => {
      if (eventLike?.key !== 'Enter' || eventLike?.shiftKey) {
        return false;
      }
      return normalizeSendShortcutMode(options.mode) === 'modifierEnter'
        ? (options.isMac ? Boolean(eventLike?.metaKey) : Boolean(eventLike?.ctrlKey))
        : true;
    });
const IFRAME_DEFAULT_SEND_SHORTCUT = 'enter';
const IFRAME_IS_MAC_PLATFORM = /Mac|iPhone|iPad|iPod/i.test(
  navigator.platform || navigator.userAgentData?.platform || navigator.userAgent || ''
);

// 全局文件粘贴检测和处理
let filePasteHandlerAdded = false;

// 跟踪输入法组合输入状态（用于中文输入法）
let isComposing = false;
let searchBarAutoCollapseArmed = false;
let searchBarCollapseTimer = null;
let iframeSubmitShortcutMode = IFRAME_DEFAULT_SEND_SHORTCUT;

async function loadIframeSubmitShortcutMode() {
  let nextMode = IFRAME_DEFAULT_SEND_SHORTCUT;

  try {
    const defaultButtonConfig = await window.AppConfigManager.getButtonConfig();
    nextMode = normalizeSendShortcutMode(defaultButtonConfig?.sendShortcut);
    const { buttonConfig } = await chrome.storage.sync.get('buttonConfig');
    nextMode = normalizeSendShortcutMode(buttonConfig?.sendShortcut ?? nextMode);
  } catch (error) {
    console.warn('Failed to load iframe submit shortcut mode:', error);
  }

  iframeSubmitShortcutMode = nextMode;
  return nextMode;
}

function applyIframeSubmitShortcutMode(buttonConfig = {}) {
  iframeSubmitShortcutMode = normalizeSendShortcutMode(buttonConfig?.sendShortcut);
}

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync' && changes.buttonConfig) {
    applyIframeSubmitShortcutMode(changes.buttonConfig.newValue || {});
  }
});

void loadIframeSubmitShortcutMode();

function trackEvent(name, params = {}) {
  const analytics = window.AIShortcutsAnalytics;
  if (analytics && typeof analytics.logEvent === 'function') {
    analytics.logEvent(name, params);
  }
}

const ratingPromptState = {
  batchId: 0,
  total: 0,
  loaded: 0,
  shown: false
};

const ratingReminderState = {
  reminderTargetCount: 10
};

const TimelineUtils = window.IframeTimelineUtils || {};
const AnalysisUtils = window.IframeAnalysisUtils || {};
const DEEP_RESEARCH_TIMEOUT_MS = 8000;
let deepResearchBatchInProgress = false;
const timelineBuildEntry = typeof TimelineUtils.buildTimelineEntry === 'function'
  ? TimelineUtils.buildTimelineEntry
  : ((entry) => ({
      ...entry,
      query: String(entry?.query || '').trim(),
      normalizedQuery: String(entry?.query || '').trim(),
      occurrenceIndex: 0,
      timelineId: String(entry?.historyId || Date.now())
    }));
const timelineBuildCopyText = typeof TimelineUtils.buildTimelineCopyText === 'function'
  ? TimelineUtils.buildTimelineCopyText
  : ((entry, responses) => JSON.stringify({ entry, responses }, null, 2));
const timelineMergeSnapshots = typeof TimelineUtils.mergeTimelinePromptSnapshots === 'function'
  ? TimelineUtils.mergeTimelinePromptSnapshots
  : ((snapshots) => snapshots || []);
const analysisBuildPayload = typeof AnalysisUtils.buildTimelineAnalysisPayload === 'function'
  ? AnalysisUtils.buildTimelineAnalysisPayload
  : ((options = {}) => ({
      version: 1,
      token: '',
      createdAt: new Date().toISOString(),
      entry: options?.entry || null,
      question: String(options?.question || options?.entry?.query || '').trim(),
      summaryText: String(options?.summaryText || options?.copyText || '').trim(),
      responses: Array.isArray(options?.responses) ? options.responses : [],
      compareSites: [],
      successCount: Math.max(0, Number(options?.successCount) || 0),
      totalCount: Math.max(0, Number(options?.totalCount) || 0),
      analysisPrompt: '',
      displayText: ''
    }));
const analysisSavePayload = typeof AnalysisUtils.saveTimelineAnalysisPayload === 'function'
  ? AnalysisUtils.saveTimelineAnalysisPayload
  : async (payload) => ({
      token: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      payload
    });
const analysisBuildCompareUrl = typeof AnalysisUtils.buildTimelineAnalysisCompareUrl === 'function'
  ? AnalysisUtils.buildTimelineAnalysisCompareUrl
  : ((token) => {
      if (!token || !chrome?.runtime?.getURL) return '';
      return chrome.runtime.getURL(`iframe/iframe.html?analysisToken=${encodeURIComponent(token)}&analysisMode=1`);
    });
const timelineState = {
  entries: [],
  isOpen: false,
  isPinned: false,
  openMode: null,
  activeTimelineId: null,
  promptSnapshotsBySite: new Map(),
  favoriteEntryKeys: new Set()
};
let timelineSyncTimer = null;
let timelineMessageBridgeInitialized = false;
const TIMELINE_EDGE_TRIGGER_ID = 'timelineEdgeTrigger';
const TIMELINE_HIDE_DELAY_MS = 180;
let timelineHideTimer = null;
const AI_COMPARE_RUNTIME_EVENT = 'aicompare:site-runtime-update';

function ensureAiCompareSiteRuntimeStore() {
  if (!window.__AI_COMPARE_SITE_RUNTIME__ || typeof window.__AI_COMPARE_SITE_RUNTIME__ !== 'object') {
    window.__AI_COMPARE_SITE_RUNTIME__ = {
      version: 1,
      updatedAt: '',
      sites: {}
    };
  }
  if (!window.__AI_COMPARE_SITE_RUNTIME__.sites || typeof window.__AI_COMPARE_SITE_RUNTIME__.sites !== 'object') {
    window.__AI_COMPARE_SITE_RUNTIME__.sites = {};
  }
  return window.__AI_COMPARE_SITE_RUNTIME__;
}

function createSiteSearchId(siteName) {
  return `${String(siteName || 'site').replace(/\s+/g, '-').toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function dispatchAiCompareSiteRuntimeEvent(detail) {
  try {
    window.dispatchEvent(new CustomEvent(AI_COMPARE_RUNTIME_EVENT, {
      detail
    }));
  } catch (_) {
    // ignore
  }
}

function cloneAiCompareSiteRuntimeEntry(entry) {
  if (!entry) return null;
  return {
    ...entry
  };
}

function queueAiCompareSiteRuntime(siteName, query, context = {}) {
  const normalizedSiteName = String(siteName || '').trim();
  if (!normalizedSiteName) return '';

  const store = ensureAiCompareSiteRuntimeStore();
  const searchId = context.searchId || createSiteSearchId(normalizedSiteName);
  const now = new Date().toISOString();
  const nextEntry = {
    siteName: normalizedSiteName,
    query: String(query || '').trim(),
    searchId,
    phase: 'queued',
    content: '',
    url: '',
    error: '',
    final: false,
    source: 'iframe-parent',
    updatedAt: now,
    requestedAt: now,
    iframeSrc: context.iframeSrc || ''
  };

  store.sites[normalizedSiteName] = nextEntry;
  store.updatedAt = now;
  dispatchAiCompareSiteRuntimeEvent({
    siteName: normalizedSiteName,
    entry: cloneAiCompareSiteRuntimeEntry(nextEntry),
    reason: 'queued'
  });
  return searchId;
}

function applyAiCompareSiteRuntimeUpdate(payload, sourceIframe = null) {
  const normalizedSiteName = String(payload?.siteName || '').trim();
  if (!normalizedSiteName) return null;

  const store = ensureAiCompareSiteRuntimeStore();
  const previous = store.sites[normalizedSiteName] || {
    siteName: normalizedSiteName,
    query: '',
    searchId: '',
    phase: 'idle',
    content: '',
    url: '',
    error: '',
    final: false,
    source: 'inject-script',
    updatedAt: ''
  };

  if (previous.searchId && payload?.searchId && previous.searchId !== payload.searchId) {
    console.log('忽略过期的站点运行时消息:', {
      siteName: normalizedSiteName,
      currentSearchId: previous.searchId,
      ignoredSearchId: payload.searchId
    });
    return previous;
  }

  const now = new Date().toISOString();
  const nextEntry = {
    ...previous,
    siteName: normalizedSiteName,
    query: payload?.query ? String(payload.query).trim() : previous.query,
    searchId: payload?.searchId || previous.searchId || '',
    phase: payload?.phase || previous.phase || 'idle',
    content: typeof payload?.content === 'string' ? payload.content : previous.content,
    url: payload?.url || previous.url || sourceIframe?.src || '',
    error: payload?.error ? String(payload.error) : '',
    final: payload?.final === true,
    source: payload?.source || 'inject-script',
    updatedAt: payload?.updatedAt || now,
    startedAt: payload?.startedAt || previous.startedAt || '',
    submittedAt: payload?.submittedAt || previous.submittedAt || '',
    attempts: Number.isFinite(payload?.attempts) ? payload.attempts : (previous.attempts || 0),
    stableRounds: Number.isFinite(payload?.stableRounds) ? payload.stableRounds : (previous.stableRounds || 0),
    iframeSrc: sourceIframe?.src || previous.iframeSrc || ''
  };

  store.sites[normalizedSiteName] = nextEntry;
  store.updatedAt = nextEntry.updatedAt || now;
  dispatchAiCompareSiteRuntimeEvent({
    siteName: normalizedSiteName,
    entry: cloneAiCompareSiteRuntimeEntry(nextEntry),
    reason: 'child-update'
  });
  return nextEntry;
}

function getAiCompareSiteRuntimeSnapshot(siteNames = null) {
  const store = ensureAiCompareSiteRuntimeStore();
  const requestedNames = Array.isArray(siteNames) && siteNames.length
    ? siteNames.map((name) => String(name || '').trim()).filter(Boolean)
    : Object.keys(store.sites);

  const uniqueNames = Array.from(new Set(requestedNames));
  const results = uniqueNames.map((siteName) => cloneAiCompareSiteRuntimeEntry(store.sites[siteName]) || {
    siteName,
    query: '',
    searchId: '',
    phase: 'pending',
    content: '',
    url: '',
    error: '',
    final: false,
    source: 'iframe-parent',
    updatedAt: store.updatedAt || ''
  });

  return {
    updatedAt: store.updatedAt || '',
    results,
    bySite: results.reduce((acc, entry) => {
      acc[entry.siteName] = entry;
      return acc;
    }, {})
  };
}

function initializeAiCompareSiteRuntimeBridge() {
  if (window.aiCompareSiteRuntime?.initialized) {
    return window.aiCompareSiteRuntime;
  }

  window.addEventListener('message', (event) => {
    const data = event?.data;
    if (!data || data.type !== 'AI_COMPARE_SITE_RUNTIME' || data.source !== 'inject-script') {
      return;
    }

    const sourceIframe = Array.from(document.querySelectorAll('.ai-iframe'))
      .find((iframe) => iframe.contentWindow && iframe.contentWindow === event.source);

    applyAiCompareSiteRuntimeUpdate(data, sourceIframe || null);
  });

  window.aiCompareSiteRuntime = {
    initialized: true,
    eventName: AI_COMPARE_RUNTIME_EVENT,
    queueSiteRuntime: queueAiCompareSiteRuntime,
    updateSiteRuntime: applyAiCompareSiteRuntimeUpdate,
    getSnapshot: getAiCompareSiteRuntimeSnapshot,
    getStore: ensureAiCompareSiteRuntimeStore
  };

  ensureAiCompareSiteRuntimeStore();
  return window.aiCompareSiteRuntime;
}

initializeAiCompareSiteRuntimeBridge();

// Keep iframe permissions narrow to avoid cross-site browser permission prompts
// when opening many third-party AI sites in parallel.
const IFRAME_ALLOW_PERMISSIONS = 'clipboard-read; clipboard-write; autoplay; fullscreen; picture-in-picture';

async function getReviewUrlFromConfig() {
  const fallbackUrl = chrome.runtime.getURL('homepage/homepage.html');
  try {
    if (window.AppConfigManager?.loadConfig) {
      const config = await window.AppConfigManager.loadConfig();
      const externalLinks = config?.externalLinks || {};
      if (externalLinks.reviewLink) {
        return externalLinks.reviewLink;
      }
    }
  } catch (error) {
    console.warn('读取评分链接配置失败，使用默认链接:', error);
  }
  return fallbackUrl;
}

async function startRatingPromptBatch(totalIframes) {
  if (!totalIframes || totalIframes <= 0) return null;
  const currentParams = new URLSearchParams(window.location.search);
  if (currentParams.get('openclaw') === '1' || currentParams.get('source') === 'openclaw') {
    return null;
  }
  try {
    const { ratingPromptShown = false, ratingPromptFinalDismissed = false } = await chrome.storage.local.get([
      'ratingPromptShown',
      'ratingPromptFinalDismissed'
    ]);
    if (ratingPromptShown || ratingPromptFinalDismissed) return null;

    const reminder = await chrome.storage.local.get([
      'ratingPromptDeferred',
      'ratingPromptReminderShown',
      'ratingPromptSuccessCount'
    ]);
    const deferred = reminder.ratingPromptDeferred === true;
    const reminderShown = reminder.ratingPromptReminderShown === true;

    if (deferred && reminderShown) {
      return null;
    }
  } catch (error) {
    console.warn('读取评分提示状态失败:', error);
  }

  ratingPromptState.batchId += 1;
  ratingPromptState.total = totalIframes;
  ratingPromptState.loaded = 0;
  ratingPromptState.shown = false;
  return ratingPromptState.batchId;
}

function ensureRatingModal() {
  let overlay = document.getElementById('ratingPromptOverlay');
  if (overlay) return overlay;

  overlay = document.createElement('div');
  overlay.id = 'ratingPromptOverlay';
  overlay.className = 'rating-modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-hidden', 'true');

  overlay.innerHTML = `
    <div class="rating-modal">
      <div class="rating-modal-title">${t('ratingModalTitle', '喜欢这个插件吗？')}</div>
      <div class="rating-modal-subtitle">${t('ratingModalSubtitle', '如果它帮到你，给我们一个五星好评吧！')}</div>
      <div class="rating-modal-stars" aria-label="${t('ratingModalStars', '五星好评')}">
        <span>★</span><span>★</span><span>★</span><span>★</span><span>★</span>
      </div>
      <div class="rating-modal-actions">
        <button class="rating-modal-secondary" type="button">${t('ratingModalLater', '以后再说')}</button>
        <button class="rating-modal-primary" type="button">${t('ratingModalGoRate', '去评分')}</button>
      </div>
    </div>
  `;

  const laterBtn = overlay.querySelector('.rating-modal-secondary');
  const rateBtn = overlay.querySelector('.rating-modal-primary');

  const closeModal = () => {
    overlay.classList.remove('is-visible');
    overlay.setAttribute('aria-hidden', 'true');
  };

  laterBtn?.addEventListener('click', async () => {
    await handleRatingPromptLater();
    closeModal();
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      closeModal();
    }
  });

  rateBtn?.addEventListener('click', async () => {
    const reviewUrl = await getReviewUrlFromConfig();
    if (reviewUrl) {
      chrome.tabs.create({ url: reviewUrl });
      trackEvent('rating_prompt_clicked');
      await chrome.storage.local.set({
        ratingPromptFinalDismissed: true,
        ratingPromptShown: true
      });
    } else {
      showToast(t('ratingModalNoLink', '无法获取评分链接'));
    }
    closeModal();
  });

  document.body.appendChild(overlay);
  return overlay;
}

async function handleRatingPromptLater() {
  try {
    const { ratingPromptReminderShown = false } = await chrome.storage.local.get('ratingPromptReminderShown');
    if (ratingPromptReminderShown) {
      await chrome.storage.local.set({
        ratingPromptFinalDismissed: true,
        ratingPromptShown: true
      });
    } else {
      await chrome.storage.local.set({
        ratingPromptDeferred: true,
        ratingPromptSuccessCount: 0
      });
    }
    trackEvent('rating_prompt_later');
  } catch (error) {
    console.warn('保存评分稍后状态失败:', error);
  }
}

async function showRatingPromptOnce(kind) {
  if (ratingPromptState.shown) return;
  ratingPromptState.shown = true;

  try {
    if (kind === 'reminder') {
      await chrome.storage.local.set({ ratingPromptReminderShown: true });
    } else {
      await chrome.storage.local.set({ ratingPromptInitialShown: true });
    }
  } catch (error) {
    console.warn('保存评分提示状态失败:', error);
  }

  const overlay = ensureRatingModal();
  if (overlay) {
    setTimeout(() => {
      if (ratingPromptState.shown) {
        overlay.setAttribute('aria-hidden', 'false');
        overlay.classList.add('is-visible');
        trackEvent(kind === 'reminder' ? 'rating_prompt_reminder_shown' : 'rating_prompt_shown');
      }
    }, 5000);
  }
}

function handleIframeLoadedForRating(iframe) {
  if (!iframe || ratingPromptState.shown || ratingPromptState.total <= 0) return;
  const batchId = Number(iframe.dataset.ratingBatchId || '0');
  if (!batchId || batchId !== ratingPromptState.batchId) return;
  if (iframe.dataset.ratingLoaded === '1') return;
  iframe.dataset.ratingLoaded = '1';
  ratingPromptState.loaded += 1;
  if (ratingPromptState.loaded >= ratingPromptState.total) {
    handleRatingPromptAfterSuccess();
  }
}

async function incrementRatingSuccessIfDeferred() {
  try {
    const data = await chrome.storage.local.get([
      'ratingPromptShown',
      'ratingPromptFinalDismissed',
      'ratingPromptDeferred',
      'ratingPromptReminderShown',
      'ratingPromptSuccessCount'
    ]);
    if (data.ratingPromptShown === true || data.ratingPromptFinalDismissed === true) return;
    if (data.ratingPromptDeferred !== true) return;
    if (data.ratingPromptReminderShown === true) return;

    const nextCount = (Number(data.ratingPromptSuccessCount) || 0) + 1;
    const shouldRemind = nextCount >= ratingReminderState.reminderTargetCount;
    await chrome.storage.local.set({
      ratingPromptSuccessCount: nextCount
    });
    if (shouldRemind) {
      await showRatingPromptOnce('reminder');
    }
  } catch (error) {
    console.warn('更新评分延后计数失败:', error);
  }
}

async function handleRatingPromptAfterSuccess() {
  const currentParams = new URLSearchParams(window.location.search);
  if (currentParams.get('openclaw') === '1' || currentParams.get('source') === 'openclaw') return;
  try {
    const data = await chrome.storage.local.get([
      'ratingPromptShown',
      'ratingPromptFinalDismissed',
      'ratingPromptInitialShown',
      'ratingPromptDeferred',
      'ratingPromptReminderShown'
    ]);
    if (data.ratingPromptShown === true || data.ratingPromptFinalDismissed === true) return;

    if (data.ratingPromptDeferred === true) {
      if (data.ratingPromptReminderShown !== true) {
        await incrementRatingSuccessIfDeferred();
      }
      return;
    }

    if (data.ratingPromptInitialShown !== true) {
      await showRatingPromptOnce('initial');
    }
  } catch (error) {
    console.warn('处理评分提示状态失败:', error);
  }
}

// 常用站点优先排序（enabled=true 在前，再按 order 排序）
function sortSitesFavoriteFirst(sites) {
  return [...sites].sort((a, b) => {
    const aFav = a.enabled ? 0 : 1;
    const bFav = b.enabled ? 0 : 1;
    if (aFav !== bFav) return aFav - bFav;
    const orderA = a.order !== undefined ? a.order : 999;
    const orderB = b.order !== undefined ? b.order : 999;
    if (orderA !== orderB) return orderA - orderB;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
}

function t(key, fallback = '', substitutions = undefined) {
  try {
    const message = chrome?.i18n?.getMessage(key, substitutions);
    return message || fallback;
  } catch (_) {
    return fallback;
  }
}

function getTimelineElements() {
  return {
    panel: document.getElementById('timelinePanel'),
    list: document.getElementById('timelineList'),
    toggleButton: document.getElementById('timelineToggleButton'),
    closeButton: document.getElementById('timelineCloseButton'),
    edgeTrigger: document.getElementById(TIMELINE_EDGE_TRIGGER_ID)
  };
}

function formatTimelineDateLabel(timestamp) {
  try {
    return new Date(timestamp).toLocaleString(chrome?.i18n?.getUILanguage?.() || undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (_) {
    return new Date(timestamp).toLocaleString();
  }
}

async function refreshTimelineCopyPreviewModal(overlay, metaEl, contentEl, confirmBtn, refreshBtn, entryOverride = null) {
  if (!overlay || !metaEl || !contentEl || !confirmBtn || !refreshBtn) return;
  const analyzeBtn = overlay.querySelector('.timeline-copy-preview-analyze');
  const templateSelect = overlay.querySelector('.timeline-copy-preview-analysis-select');

  const currentEntryKey = overlay.dataset.activeEntryKey || '';
  const entry = entryOverride
    || overlay.__timelineCopyPreviewEntry
    || timelineState.entries.find((item) => String(item?.timelineId || buildTimelineFavoriteKey(item)) === currentEntryKey);
  if (!entry) {
    refreshBtn.disabled = false;
    refreshBtn.textContent = t('timelineCopyPreviewRefresh', '刷新');
    overlay.dataset.loading = 'false';
    metaEl.textContent = t('timelineCopyPreviewLoadFailed', '加载回答失败，请稍后重试。');
    contentEl.textContent = '';
    showToast(t('timelineCopyPreviewLoadFailed', '加载回答失败，请稍后重试。'));
    return;
  }

  overlay.dataset.loading = 'true';
  refreshBtn.disabled = true;
  refreshBtn.textContent = t('timelineCopyPreviewRefreshing', '刷新中...');
  metaEl.textContent = t('timelineCopyPreviewLoading', '正在收集各站点回答...');
  contentEl.textContent = '';
  confirmBtn.disabled = true;
  confirmBtn.dataset.copyText = '';
  confirmBtn.dataset.successCount = '0';
  confirmBtn.dataset.totalCount = '0';

  try {
    const { copyText, successCount, totalCount, responses } = await collectTimelineEntryResponses(entry);
    if (overlay.dataset.activeEntryKey !== currentEntryKey) return;

    const previewText = String(copyText || '').trim() || t('timelineCopyPreviewEmpty', '当前没有可复制的回答内容。');
    metaEl.textContent = t(
      'timelineCopyPreviewSummary',
      '已汇总 $1/$2 个子页面的回答，请确认后复制。',
      [String(successCount), String(totalCount)]
    );
    contentEl.textContent = previewText;
    confirmBtn.disabled = !String(copyText || '').trim();
    confirmBtn.dataset.copyText = copyText || '';
    confirmBtn.dataset.successCount = String(successCount);
    confirmBtn.dataset.totalCount = String(totalCount);
    overlay.__timelineCopyPreviewResponses = Array.isArray(responses) ? responses : [];
    overlay.__timelineCopyPreviewCopyText = copyText || '';
    if (analyzeBtn instanceof HTMLButtonElement) {
      analyzeBtn.disabled = !String(copyText || '').trim() || Boolean(templateSelect?.disabled);
      analyzeBtn.textContent = t('timelineCopyPreviewAnalyze', '分析');
    }
  } catch (error) {
    if (overlay.dataset.activeEntryKey !== currentEntryKey) return;
    console.error('刷新时间线回答预览失败:', error);
    metaEl.textContent = t('timelineCopyPreviewLoadFailed', '加载回答失败，请稍后重试。');
    contentEl.textContent = error?.message || String(error);
    confirmBtn.disabled = true;
    overlay.__timelineCopyPreviewResponses = [];
    overlay.__timelineCopyPreviewCopyText = '';
    if (analyzeBtn instanceof HTMLButtonElement) {
      analyzeBtn.disabled = true;
      analyzeBtn.textContent = t('timelineCopyPreviewAnalyze', '分析');
    }
  } finally {
    if (overlay.dataset.activeEntryKey === currentEntryKey) {
      overlay.dataset.loading = 'false';
      refreshBtn.disabled = false;
      refreshBtn.textContent = t('timelineCopyPreviewRefresh', '刷新');
    }
  }
}

function ensureTimelineCopyPreviewModal() {
  let overlay = document.getElementById('timelineCopyPreviewOverlay');
  if (overlay) {
    return overlay;
  }

  overlay = document.createElement('div');
  overlay.id = 'timelineCopyPreviewOverlay';
  overlay.className = 'timeline-copy-preview-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'timelineCopyPreviewTitle');
  overlay.innerHTML = `
    <div class="timeline-copy-preview-modal">
      <div class="timeline-copy-preview-header">
        <div class="timeline-copy-preview-heading">
          <div class="timeline-copy-preview-title" id="timelineCopyPreviewTitle">${escapeHtml(t('timelineCopyPreviewTitle', '复制回答汇总'))}</div>
          <div class="timeline-copy-preview-meta"></div>
        </div>
        <div class="timeline-copy-preview-header-actions">
          <button class="timeline-copy-preview-refresh" type="button">${escapeHtml(t('timelineCopyPreviewRefresh', '刷新'))}</button>
          <button
            class="timeline-copy-preview-close"
            type="button"
            aria-label="${escapeHtml(t('closeButton', '关闭'))}"
          >×</button>
        </div>
      </div>
      <div class="timeline-copy-preview-body">
        <pre class="timeline-copy-preview-content" aria-live="polite"></pre>
      </div>
      <div class="timeline-copy-preview-actions">
        <div class="timeline-copy-preview-tools">
          <select class="timeline-copy-preview-analysis-select" aria-label="${escapeHtml(t('analysisPromptTemplateSelectLabel', '分析提示词选择'))}"></select>
          <button class="timeline-copy-preview-analyze" type="button">${escapeHtml(t('timelineCopyPreviewAnalyze', '分析'))}</button>
        </div>
        <button class="timeline-copy-preview-confirm" type="button">${escapeHtml(t('timelineCopyPreviewConfirm', '确认复制'))}</button>
      </div>
    </div>
  `;

  const closeModal = () => {
    overlay.classList.remove('is-visible');
  };

  overlay.querySelector('.timeline-copy-preview-confirm')?.addEventListener('click', async () => {
    const confirmBtn = overlay.querySelector('.timeline-copy-preview-confirm');
    if (!(confirmBtn instanceof HTMLButtonElement)) return;

    const copyText = confirmBtn.dataset.copyText || '';
    const successCount = confirmBtn.dataset.successCount || '0';
    const totalCount = confirmBtn.dataset.totalCount || '0';
    if (!copyText.trim()) return;

    try {
      await copyTextToClipboard(copyText);
      closeModal();
      showToast(t('timelineCopySuccess', '已复制这条提问的回答（$1/$2）', [successCount, totalCount]));
      trackEvent('iframe_timeline_copy', {
        sites_total: Number(totalCount) || 0,
        sites_with_content: Number(successCount) || 0
      });
    } catch (error) {
      console.error('复制时间线回答失败:', error);
      showToast(t('timelineCopyFailed', '复制失败，请重试'));
    }
  });

  overlay.querySelector('.timeline-copy-preview-analyze')?.addEventListener('click', async () => {
    const analyzeBtn = overlay.querySelector('.timeline-copy-preview-analyze');
    const confirmBtn = overlay.querySelector('.timeline-copy-preview-confirm');
    const templateSelect = overlay.querySelector('.timeline-copy-preview-analysis-select');
    if (!(analyzeBtn instanceof HTMLButtonElement) || !(confirmBtn instanceof HTMLButtonElement)) return;

    const copyText = overlay.__timelineCopyPreviewCopyText || confirmBtn.dataset.copyText || '';
    if (!String(copyText || '').trim()) return;

    const selectedTemplateId = templateSelect instanceof HTMLSelectElement ? templateSelect.value : '';
    const selectedTemplate = (Array.isArray(overlay.__timelineAnalysisTemplates) ? overlay.__timelineAnalysisTemplates : [])
      .find((template) => template.id === selectedTemplateId) || null;

    analyzeBtn.disabled = true;
    analyzeBtn.textContent = t('timelineCopyPreviewAnalyzeLoading', '打开中...');

    try {
      const payload = analysisBuildPayload({
        entry: overlay.__timelineCopyPreviewEntry || null,
        summaryText: copyText,
        responses: Array.isArray(overlay.__timelineCopyPreviewResponses) ? overlay.__timelineCopyPreviewResponses : [],
        question: overlay.__timelineCopyPreviewEntry?.query || '',
        successCount: Number(confirmBtn.dataset.successCount || '0') || 0,
        totalCount: Number(confirmBtn.dataset.totalCount || '0') || 0,
        analysisTemplateId: selectedTemplate?.id || '',
        analysisTemplateName: selectedTemplate?.name || '',
        analysisTemplateQuery: selectedTemplate?.query || ''
      });
      const saved = await analysisSavePayload(payload);
      const analysisUrl = analysisBuildCompareUrl(saved?.token || '');
      if (!analysisUrl) {
        throw new Error('Failed to build analysis url');
      }

      chrome.tabs.create({ url: analysisUrl });
      closeModal();
    } catch (error) {
      console.error('打开新标签页分析失败:', error);
      showToast(t('timelineCopyPreviewAnalyzeFailed', '打开分析页失败，请重试'));
    } finally {
      analyzeBtn.disabled = false;
      analyzeBtn.textContent = t('timelineCopyPreviewAnalyze', '分析');
    }
  });

  overlay.querySelector('.timeline-copy-preview-refresh')?.addEventListener('click', async () => {
    const metaEl = overlay.querySelector('.timeline-copy-preview-meta');
    const contentEl = overlay.querySelector('.timeline-copy-preview-content');
    const confirmBtn = overlay.querySelector('.timeline-copy-preview-confirm');
    const refreshBtn = overlay.querySelector('.timeline-copy-preview-refresh');
    if (!(metaEl instanceof HTMLElement) || !(contentEl instanceof HTMLElement)) return;
    if (!(confirmBtn instanceof HTMLButtonElement) || !(refreshBtn instanceof HTMLButtonElement)) return;
    await refreshTimelineCopyPreviewModal(overlay, metaEl, contentEl, confirmBtn, refreshBtn, overlay.__timelineCopyPreviewEntry || null);
  });

  overlay.querySelector('.timeline-copy-preview-close')?.addEventListener('click', closeModal);
  overlay.querySelector('.timeline-copy-preview-analysis-select')?.addEventListener('change', (event) => {
    overlay.__timelineSelectedAnalysisTemplateId = event.target?.value || '';
  });
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      closeModal();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && overlay.classList.contains('is-visible')) {
      closeModal();
    }
  });

  document.body.appendChild(overlay);
  return overlay;
}

async function showTimelineCopyPreviewModal(entry) {
  const overlay = ensureTimelineCopyPreviewModal();
  const metaEl = overlay.querySelector('.timeline-copy-preview-meta');
  const contentEl = overlay.querySelector('.timeline-copy-preview-content');
  const confirmBtn = overlay.querySelector('.timeline-copy-preview-confirm');
  const refreshBtn = overlay.querySelector('.timeline-copy-preview-refresh');
  const analyzeBtn = overlay.querySelector('.timeline-copy-preview-analyze');
  const templateSelect = overlay.querySelector('.timeline-copy-preview-analysis-select');
  const closeBtn = overlay.querySelector('.timeline-copy-preview-close');
  if (!metaEl || !contentEl || !confirmBtn || !refreshBtn || !analyzeBtn || !templateSelect || !closeBtn) return;

  const activeEntryKey = String(entry?.timelineId || buildTimelineFavoriteKey(entry));
  const isSameVisibleEntry = overlay.classList.contains('is-visible')
    && overlay.dataset.activeEntryKey === activeEntryKey;
  if (isSameVisibleEntry && overlay.dataset.loading !== 'true') {
    return;
  }

  const requestToken = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  overlay.dataset.requestToken = requestToken;
  overlay.dataset.activeEntryKey = activeEntryKey;
  overlay.dataset.loading = 'true';
  overlay.__timelineCopyPreviewEntry = entry;
  overlay.classList.add('is-visible');
  closeBtn.focus();

  metaEl.textContent = t('timelineCopyPreviewLoading', '正在收集各站点回答...');
  contentEl.textContent = '';
  confirmBtn.disabled = true;
  confirmBtn.dataset.copyText = '';
  confirmBtn.dataset.successCount = '0';
  confirmBtn.dataset.totalCount = '0';
  overlay.__timelineCopyPreviewResponses = [];
  overlay.__timelineCopyPreviewCopyText = '';
  overlay.__timelineAnalysisTemplates = [];
  overlay.__timelineSelectedAnalysisTemplateId = '';
  analyzeBtn.disabled = true;
  analyzeBtn.textContent = t('timelineCopyPreviewAnalyzeLoading', '打开中...');
  refreshBtn.disabled = true;
  templateSelect.disabled = true;
  templateSelect.innerHTML = `<option value="">${escapeHtml(t('analysisTemplateLoading', '加载分析提示词...'))}</option>`;
  await hydrateAnalysisTemplateSelect(overlay, overlay.__timelineSelectedAnalysisTemplateId);
  await refreshTimelineCopyPreviewModal(overlay, metaEl, contentEl, confirmBtn, refreshBtn, entry);
  if (overlay.dataset.requestToken === requestToken) {
    overlay.dataset.loading = 'false';
    analyzeBtn.disabled = !String(confirmBtn.dataset.copyText || '').trim() || Boolean(templateSelect.disabled);
    analyzeBtn.textContent = t('timelineCopyPreviewAnalyze', '分析');
  }
}

function syncTimelinePanelUi() {
  const { panel, toggleButton, edgeTrigger } = getTimelineElements();
  if (panel) {
    panel.hidden = !timelineState.isOpen;
    panel.classList.toggle('is-edge-preview', timelineState.isOpen && timelineState.openMode === 'hover');
  }
  if (toggleButton) {
    toggleButton.classList.toggle('is-active', timelineState.isOpen);
    toggleButton.setAttribute('aria-expanded', timelineState.isOpen ? 'true' : 'false');
  }
  if (edgeTrigger) {
    edgeTrigger.classList.toggle('is-active', timelineState.isOpen);
    edgeTrigger.setAttribute('aria-expanded', timelineState.isOpen ? 'true' : 'false');
  }
}

function setTimelinePanelOpen(isOpen, options = {}) {
  timelineState.isOpen = Boolean(isOpen);
  timelineState.isPinned = timelineState.isOpen ? options.pinned === true : false;
  timelineState.openMode = timelineState.isOpen ? (options.mode || (timelineState.isPinned ? 'toggle' : 'hover')) : null;
  syncTimelinePanelUi();
}

function clearTimelineHideTimer() {
  if (timelineHideTimer !== null) {
    clearTimeout(timelineHideTimer);
    timelineHideTimer = null;
  }
}

function refreshTimelinePanelOnOpen() {
  refreshTimelineFavoriteState().catch((error) => {
    console.warn('刷新时间线收藏状态失败:', error);
  });
  scheduleTimelineSync(0);
}

function openTimelinePanel(options = {}) {
  clearTimelineHideTimer();
  const shouldRefresh = !timelineState.isOpen || options.refresh === true;
  setTimelinePanelOpen(true, {
    pinned: options.pinned === true,
    mode: options.mode || (options.pinned ? 'toggle' : 'hover')
  });
  if (shouldRefresh) {
    refreshTimelinePanelOnOpen();
  }
}

function closeTimelinePanel() {
  clearTimelineHideTimer();
  setTimelinePanelOpen(false);
}

function scheduleHideTimelinePanel() {
  if (timelineState.isPinned) return;
  clearTimelineHideTimer();
  timelineHideTimer = setTimeout(() => {
    if (!timelineState.isPinned) {
      closeTimelinePanel();
    }
  }, TIMELINE_HIDE_DELAY_MS);
}

function ensureTimelineEdgeTrigger() {
  let trigger = document.getElementById(TIMELINE_EDGE_TRIGGER_ID);
  if (!trigger) {
    trigger = document.createElement('button');
    trigger.id = TIMELINE_EDGE_TRIGGER_ID;
    trigger.type = 'button';
    trigger.className = 'timeline-edge-trigger';
    document.body.appendChild(trigger);
  }

  const label = t('timelineToggleTitle', '聊天时间线');
  trigger.title = label;
  trigger.setAttribute('aria-label', label);
  trigger.setAttribute('aria-expanded', timelineState.isOpen ? 'true' : 'false');
  return trigger;
}

function buildTimelineFavoriteKey(entry) {
  const normalizedQuery = String(entry?.normalizedQuery || entry?.query || '').trim();
  const occurrenceIndex = Math.max(0, Number(entry?.occurrenceIndex) || 0);
  return `${normalizedQuery}::${occurrenceIndex}`;
}

function normalizeRestoreContext(context, fallbackQuery = '') {
  if (!context || typeof context !== 'object') return null;
  const query = String(context?.query || fallbackQuery || '').trim();
  if (!query) return null;

  return {
    source: String(context?.source || '').trim(),
    query,
    autoSearch: context?.autoSearch === true,
    scrollToPrompt: context?.scrollToPrompt !== false,
    occurrenceIndex: Math.max(0, Number(context?.occurrenceIndex) || 0),
    sourceHistoryId: context?.sourceHistoryId ? String(context.sourceHistoryId) : null
  };
}

async function getHistoryItemById(historyId) {
  if (!historyId) return null;
  const { pkHistory = [] } = await chrome.storage.local.get('pkHistory');
  return pkHistory.find((item) => String(item?.id || '') === String(historyId)) || null;
}

async function getHistoryRestoreContext(historyId) {
  const historyItem = await getHistoryItemById(historyId);
  if (!historyItem) return null;
  return normalizeRestoreContext(historyItem.restoreContext, historyItem.query);
}

function isTimelineEntryFavorited(entry) {
  return timelineState.favoriteEntryKeys.has(buildTimelineFavoriteKey(entry));
}

async function refreshTimelineFavoriteState() {
  const sourceHistoryId = window._currentHistoryId ? String(window._currentHistoryId) : null;
  const nextFavoriteKeys = new Set();

  if (sourceHistoryId) {
    const { pkHistory = [] } = await chrome.storage.local.get('pkHistory');
    pkHistory.forEach((item) => {
      const restoreContext = normalizeRestoreContext(item?.restoreContext, item?.query);
      const isFavorited = Array.isArray(item?.sites) && item.sites.some((site) => site?.isFavorite === true);
      if (!restoreContext || !isFavorited) return;
      if (restoreContext.source !== 'timeline') return;
      if (restoreContext.sourceHistoryId !== sourceHistoryId) return;

      nextFavoriteKeys.add(buildTimelineFavoriteKey({
        query: item.query,
        normalizedQuery: item.query,
        occurrenceIndex: restoreContext.occurrenceIndex
      }));
    });
  }

  timelineState.favoriteEntryKeys = nextFavoriteKeys;
  renderTimeline();
}

async function getTimelineFavoriteMatch(entry, pkHistory = null) {
  const sourceHistoryId = window._currentHistoryId ? String(window._currentHistoryId) : null;
  if (!sourceHistoryId) return { history: Array.isArray(pkHistory) ? pkHistory : [], index: -1 };

  const historyList = Array.isArray(pkHistory)
    ? pkHistory
    : ((await chrome.storage.local.get('pkHistory')).pkHistory || []);
  const index = historyList.findIndex((item) => {
    const restoreContext = normalizeRestoreContext(item?.restoreContext, item?.query);
    return Boolean(
      restoreContext &&
      restoreContext.source === 'timeline' &&
      restoreContext.sourceHistoryId === sourceHistoryId &&
      String(item?.query || '').trim() === String(entry?.query || '').trim() &&
      restoreContext.occurrenceIndex === Math.max(0, Number(entry?.occurrenceIndex) || 0)
    );
  });

  return { history: historyList, index };
}

async function getCurrentTimelineFavoriteSites(folderId) {
  const iframes = Array.from(document.querySelectorAll('.ai-iframe'));
  const sourceHistoryId = window._currentHistoryId || null;
  const currentHistoryItem = sourceHistoryId ? await getHistoryItemById(sourceHistoryId) : null;

  const sites = await Promise.all(iframes.map(async (iframe) => {
    const siteName = String(iframe.getAttribute('data-site') || '').trim();
    if (!siteName) return null;

    const existingSite = currentHistoryItem?.sites?.find((site) => site?.name === siteName) || null;
    const latestUrl = await getIframeLatestUrl(iframe, siteName, sourceHistoryId);

    return {
      ...(existingSite || {}),
      name: siteName,
      url: latestUrl || existingSite?.url || iframe.src || '',
      isFavorite: true,
      favoriteFolder: folderId
    };
  }));

  return sites.filter((site) => site && site.name);
}

async function resolveMaxHistoryCount() {
  let maxHistory = 100;
  try {
    if (window.AppConfigManager) {
      const appConfig = await window.AppConfigManager.loadConfig();
      if (appConfig && appConfig.history && appConfig.history.maxCount) {
        maxHistory = appConfig.history.maxCount;
      }
    }
  } catch (error) {
    console.warn('读取历史记录数量配置失败，使用默认值 100:', error);
  }
  return maxHistory;
}

async function favoriteTimelineEntry(entry) {
  if (!entry?.query) return;

  const initialMatch = await getTimelineFavoriteMatch(entry);
  const existingFavorite = initialMatch.index >= 0 ? initialMatch.history[initialMatch.index] : null;
  const defaultFolderId = existingFavorite?.sites?.find((site) => site?.isFavorite)?.favoriteFolder || null;

  const result = await window.showFavoriteFolderModal(
    defaultFolderId ? { defaultFolderId } : {}
  );
  if (!result) return;

  const { history: pkHistory, index: historyIndex } = await getTimelineFavoriteMatch(entry);
  const favoriteKey = buildTimelineFavoriteKey(entry);

  if (result.action === 'remove') {
    if (historyIndex >= 0) {
      const favoriteRecord = pkHistory[historyIndex];
      if (Array.isArray(favoriteRecord.sites)) {
        favoriteRecord.sites.forEach((site) => {
          site.isFavorite = false;
          delete site.favoriteFolder;
        });
      }
      await chrome.storage.local.set({ pkHistory });
      if (typeof window.firebaseSyncUploadIfLoggedIn === 'function') window.firebaseSyncUploadIfLoggedIn();
    }

    timelineState.favoriteEntryKeys.delete(favoriteKey);
    renderTimeline();
    showToast(t('removedFromFavorites', '已取消收藏'));
    return;
  }

  const favoriteSites = await getCurrentTimelineFavoriteSites(result.folderId);
  if (!favoriteSites.length) {
    showToast(t('timelineNoIframes', '当前没有可用的子页面'));
    return;
  }

  const sourceHistoryId = window._currentHistoryId ? String(window._currentHistoryId) : null;
  const now = Date.now();
  const formattedDate = new Date(now).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
  const favoriteRecord = historyIndex >= 0
    ? pkHistory[historyIndex]
    : {
        id: `timeline-favorite-${now}`,
        query: String(entry.query || '').trim(),
        timestamp: now,
        date: formattedDate
      };

  favoriteRecord.query = String(entry.query || '').trim();
  favoriteRecord.timestamp = now;
  favoriteRecord.date = formattedDate;
  favoriteRecord.sites = favoriteSites;
  favoriteRecord.restoreContext = {
    source: 'timeline',
    query: String(entry.query || '').trim(),
    autoSearch: true,
    scrollToPrompt: true,
    occurrenceIndex: Math.max(0, Number(entry?.occurrenceIndex) || 0),
    sourceHistoryId
  };

  let nextHistory = [...pkHistory];
  if (historyIndex >= 0) {
    nextHistory.splice(historyIndex, 1);
  }
  nextHistory.unshift(favoriteRecord);

  const maxHistory = await resolveMaxHistoryCount();
  nextHistory = nextHistory.slice(0, maxHistory);

  await chrome.storage.local.set({ pkHistory: nextHistory });
  if (typeof window.firebaseSyncUploadIfLoggedIn === 'function') window.firebaseSyncUploadIfLoggedIn();

  timelineState.favoriteEntryKeys.add(favoriteKey);
  renderTimeline();
  showToast(t('savedToFavorites', '已收藏'));
}

function renderTimeline() {
  const { list } = getTimelineElements();
  if (!list) return;

  if (!timelineState.entries.length) {
    list.innerHTML = `<div class="timeline-empty">${escapeHtml(t('timelineEmpty', '还没有提问记录，发送问题后会显示在这里。'))}</div>`;
    return;
  }

  const fragment = document.createDocumentFragment();

  timelineState.entries.forEach((entry, index) => {
    const item = document.createElement('div');
    const isFavorited = isTimelineEntryFavorited(entry);
    item.className = 'timeline-item';
    if (entry.timelineId === timelineState.activeTimelineId) {
      item.classList.add('is-active');
    }

    item.innerHTML = `
      <div class="timeline-item-index">${index + 1}</div>
      <button class="timeline-item-main" type="button">
        <div class="timeline-item-query">${escapeHtml(entry.query || '')}</div>
        <div class="timeline-item-meta">${escapeHtml(
          entry.siteCount
            ? t('timelineDetectedSites', '已在 $1 个子页面中识别', [String(entry.siteCount)])
            : (entry.dateLabel || formatTimelineDateLabel(entry.timestamp))
        )}</div>
      </button>
      <div class="timeline-item-actions">
        <button
          class="timeline-item-copy"
          type="button"
          title="${escapeHtml(t('timelineCopyButton', '复制'))}"
          aria-label="${escapeHtml(t('timelineCopyButton', '复制'))}"
        >
          <svg class="timeline-item-copy-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M9 9.75A2.25 2.25 0 0 1 11.25 7.5h7.5A2.25 2.25 0 0 1 21 9.75v7.5a2.25 2.25 0 0 1-2.25 2.25h-7.5A2.25 2.25 0 0 1 9 17.25z"></path>
            <path d="M5.25 15.75A2.25 2.25 0 0 1 3 13.5V6a2.25 2.25 0 0 1 2.25-2.25h7.5A2.25 2.25 0 0 1 15 6v.75h-3.75A3.75 3.75 0 0 0 7.5 10.5v5.25z"></path>
          </svg>
        </button>
        <button
          class="timeline-item-favorite"
          type="button"
          title="${escapeHtml(isFavorited ? t('iframeUnfavoriteTitle', '取消收藏') : t('iframeFavoriteTitle', '收藏'))}"
          aria-label="${escapeHtml(isFavorited ? t('iframeUnfavoriteTitle', '取消收藏') : t('iframeFavoriteTitle', '收藏'))}"
        >
          <img
            class="timeline-item-favorite-icon"
            src="${isFavorited ? '../icons/star_saved.svg' : '../icons/star_unsaved.svg'}"
            alt=""
            aria-hidden="true"
          >
        </button>
      </div>
    `;

    item.querySelector('.timeline-item-main')?.addEventListener('click', async () => {
      timelineState.activeTimelineId = entry.timelineId;
      renderTimeline();
      await scrollToTimelineEntry(entry);
    });

    item.querySelector('.timeline-item-copy')?.addEventListener('click', async (event) => {
      event.stopPropagation();
      await copyTimelineEntryResponses(entry);
    });

    item.querySelector('.timeline-item-favorite')?.addEventListener('click', async (event) => {
      event.stopPropagation();
      await favoriteTimelineEntry(entry);
    });

    fragment.appendChild(item);
  });

  list.innerHTML = '';
  list.appendChild(fragment);
}

function upsertTimelineEntry(entry, options = {}) {
  const query = String(entry?.query || '').trim();
  if (!query) return null;

  const historyId = entry?.historyId || null;
  if (historyId && options.dedupeByHistoryId) {
    const existingEntry = timelineState.entries.find((item) => item.historyId === historyId);
    if (existingEntry) {
      existingEntry.query = query;
      existingEntry.normalizedQuery = query;
      existingEntry.timestamp = Number(entry?.timestamp) || existingEntry.timestamp || Date.now();
      existingEntry.dateLabel = entry?.dateLabel || existingEntry.dateLabel || formatTimelineDateLabel(existingEntry.timestamp);
      timelineState.activeTimelineId = existingEntry.timelineId;
      renderTimeline();
      return existingEntry;
    }
  }

  const normalizedEntry = timelineBuildEntry({
    query,
    historyId,
    timestamp: Number(entry?.timestamp) || Date.now(),
    dateLabel: entry?.dateLabel || formatTimelineDateLabel(Number(entry?.timestamp) || Date.now())
  }, timelineState.entries);

  timelineState.entries.push(normalizedEntry);
  timelineState.activeTimelineId = normalizedEntry.timelineId;
  renderTimeline();
  return normalizedEntry;
}

function initializeTimelinePanel() {
  const edgeTrigger = ensureTimelineEdgeTrigger();
  const { toggleButton, closeButton, panel } = getTimelineElements();
  initializeTimelineMessageBridge();
  setTimelinePanelOpen(false);

  if (toggleButton && toggleButton.dataset.bound !== '1') {
    toggleButton.dataset.bound = '1';
    toggleButton.addEventListener('mouseenter', () => {
      if (timelineState.isPinned) {
        clearTimelineHideTimer();
        return;
      }
      openTimelinePanel({
        pinned: false,
        mode: 'hover',
        refresh: true
      });
    });
    toggleButton.addEventListener('mouseleave', () => {
      scheduleHideTimelinePanel();
    });
    toggleButton.addEventListener('focus', () => {
      if (timelineState.isPinned) {
        clearTimelineHideTimer();
        return;
      }
      openTimelinePanel({
        pinned: false,
        mode: 'hover',
        refresh: true
      });
    });
    toggleButton.addEventListener('blur', () => {
      scheduleHideTimelinePanel();
    });
    toggleButton.addEventListener('click', (event) => {
      event.stopPropagation();
      if (!timelineState.isPinned) {
        openTimelinePanel({
          pinned: true,
          mode: 'toggle',
          refresh: true
        });
      } else {
        closeTimelinePanel();
      }
      trackEvent('iframe_timeline_toggle', {
        is_open: timelineState.isOpen
      });
    });
  }

  if (closeButton && closeButton.dataset.bound !== '1') {
    closeButton.dataset.bound = '1';
    closeButton.addEventListener('click', () => {
      closeTimelinePanel();
    });
  }

  if (panel && panel.dataset.bound !== '1') {
    panel.dataset.bound = '1';
    panel.addEventListener('click', (event) => {
      event.stopPropagation();
    });
    panel.addEventListener('mouseenter', () => {
      clearTimelineHideTimer();
    });
    panel.addEventListener('mouseleave', () => {
      scheduleHideTimelinePanel();
    });
  }

  if (edgeTrigger && edgeTrigger.dataset.bound !== '1') {
    edgeTrigger.addEventListener('mouseenter', () => {
      if (timelineState.isPinned) {
        clearTimelineHideTimer();
        return;
      }
      openTimelinePanel({
        pinned: false,
        mode: 'hover'
      });
    });
    edgeTrigger.addEventListener('mouseleave', () => {
      scheduleHideTimelinePanel();
    });
    edgeTrigger.addEventListener('focus', () => {
      if (timelineState.isPinned) {
        clearTimelineHideTimer();
        return;
      }
      openTimelinePanel({
        pinned: false,
        mode: 'hover'
      });
    });
    edgeTrigger.addEventListener('blur', () => {
      scheduleHideTimelinePanel();
    });
    edgeTrigger.dataset.bound = '1';
  }

  document.addEventListener('click', (event) => {
    if (!timelineState.isOpen) return;
    const { panel: timelinePanel, toggleButton: timelineToggleButton } = getTimelineElements();
    if (!timelinePanel || timelinePanel.hidden) return;
    if (
      timelinePanel.contains(event.target) ||
      timelineToggleButton?.contains(event.target) ||
      edgeTrigger?.contains(event.target)
    ) return;
    closeTimelinePanel();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && timelineState.isOpen) {
      closeTimelinePanel();
    }
  });

  syncTimelinePanelUi();
  renderTimeline();
}

function buildTimelineIdFromQuery(query) {
  return `timeline-${encodeURIComponent(String(query || '').slice(0, 200))}`;
}

function getOpenTimelineSiteNames() {
  return Array.from(document.querySelectorAll('.ai-iframe'))
    .map((iframe) => String(iframe.getAttribute('data-site') || '').trim())
    .filter(Boolean);
}

function resetTimelinePromptSnapshots() {
  timelineState.promptSnapshotsBySite.clear();
  timelineState.entries = [];
  timelineState.activeTimelineId = null;
  renderTimeline();
}

function rebuildTimelineEntriesFromSnapshots() {
  const openSiteNames = getOpenTimelineSiteNames();
  if (!openSiteNames.length) {
    timelineState.promptSnapshotsBySite.clear();
    timelineState.entries = [];
    timelineState.activeTimelineId = null;
    renderTimeline();
    return;
  }

  const openSiteSet = new Set(openSiteNames);
  Array.from(timelineState.promptSnapshotsBySite.keys()).forEach((siteName) => {
    if (!openSiteSet.has(siteName)) {
      timelineState.promptSnapshotsBySite.delete(siteName);
    }
  });

  const snapshots = openSiteNames.map((siteName) => {
    const snapshot = timelineState.promptSnapshotsBySite.get(siteName);
    if (!snapshot) return null;
    return {
      siteName: snapshot.siteName || siteName,
      prompts: Array.isArray(snapshot.prompts) ? snapshot.prompts : []
    };
  }).filter(Boolean);

  const mergedEntries = timelineMergeSnapshots(snapshots);
  const previousEntries = timelineState.entries;
  const activeEntry = previousEntries.find((entry) => entry.timelineId === timelineState.activeTimelineId);

  timelineState.entries = mergedEntries.map((entry) => {
    const existingEntry = previousEntries.find((item) => item.normalizedQuery === entry.normalizedQuery);
    const builtEntry = timelineBuildEntry({
      query: entry.query,
      timelineId: buildTimelineIdFromQuery(entry.query),
      timestamp: existingEntry?.timestamp || Date.now()
    }, []);

    return {
      ...builtEntry,
      timelineId: existingEntry?.timelineId || builtEntry.timelineId,
      sourceSites: entry.sourceSites || [],
      siteCount: Array.isArray(entry.sourceSites) ? entry.sourceSites.length : 0
    };
  });

  if (activeEntry) {
    const nextActiveEntry = timelineState.entries.find((entry) => entry.normalizedQuery === activeEntry.normalizedQuery);
    timelineState.activeTimelineId = nextActiveEntry?.timelineId || null;
  } else if (!timelineState.entries.find((entry) => entry.timelineId === timelineState.activeTimelineId)) {
    timelineState.activeTimelineId = timelineState.entries[timelineState.entries.length - 1]?.timelineId || null;
  }

  renderTimeline();
}

function updateTimelineSnapshotFromIframe(siteName, prompts) {
  const normalizedSiteName = String(siteName || '').trim();
  if (!normalizedSiteName) return;

  const normalizedPrompts = Array.isArray(prompts)
    ? prompts
        .map((prompt) => ({
          text: String(prompt?.text || '').trim()
        }))
        .filter((prompt) => prompt.text)
    : [];

  const nextSignature = JSON.stringify(normalizedPrompts.map((prompt) => prompt.text));
  const existingSnapshot = timelineState.promptSnapshotsBySite.get(normalizedSiteName);
  if (existingSnapshot?.signature === nextSignature) {
    return;
  }

  timelineState.promptSnapshotsBySite.set(normalizedSiteName, {
    siteName: normalizedSiteName,
    prompts: normalizedPrompts,
    signature: nextSignature
  });
  rebuildTimelineEntriesFromSnapshots();
}

function clearTimelineSnapshotForSite(siteName) {
  const normalizedSiteName = String(siteName || '').trim();
  if (!normalizedSiteName) return;
  if (!timelineState.promptSnapshotsBySite.has(normalizedSiteName)) return;
  timelineState.promptSnapshotsBySite.delete(normalizedSiteName);
  rebuildTimelineEntriesFromSnapshots();
}

function initializeTimelineMessageBridge() {
  if (timelineMessageBridgeInitialized) return;
  timelineMessageBridgeInitialized = true;

  window.addEventListener('message', (event) => {
    if (event.data?.type !== 'TIMELINE_PROMPTS_SNAPSHOT' || event.data?.source !== 'inject-script') {
      return;
    }

    const sourceIframe = Array.from(document.querySelectorAll('.ai-iframe')).find((iframe) => {
      return iframe.contentWindow && event.source === iframe.contentWindow;
    });
    if (!sourceIframe) return;

    const siteName = sourceIframe.getAttribute('data-site') || event.data.siteName || '';
    updateTimelineSnapshotFromIframe(siteName, event.data.prompts);
  });
}

async function syncTimelineFromIframes() {
  const iframes = Array.from(document.querySelectorAll('.ai-iframe'));
  if (!iframes.length) {
    resetTimelinePromptSnapshots();
    return;
  }

  rebuildTimelineEntriesFromSnapshots();
}

function scheduleTimelineSync(delayMs = 1200) {
  if (timelineSyncTimer) {
    clearTimeout(timelineSyncTimer);
  }

  timelineSyncTimer = setTimeout(() => {
    syncTimelineFromIframes().catch((error) => {
      console.warn('同步时间线失败:', error);
    });
  }, Math.max(0, Number(delayMs) || 0));
}

function scheduleTimelineSyncBurst(delays = [1200, 3200, 6200]) {
  const normalizedDelays = Array.isArray(delays) ? delays : [delays];
  normalizedDelays.forEach((delay) => {
    setTimeout(() => {
      syncTimelineFromIframes().catch((error) => {
        console.warn('同步时间线失败:', error);
      });
    }, Math.max(0, Number(delay) || 0));
  });
}

function requestIframeTimelineAction(iframe, requestType, responseType, payload = {}, timeoutMs = 8000) {
  const siteName = iframe?.getAttribute('data-site') || payload.siteName || '';
  const requestId = `timeline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return new Promise((resolve) => {
    if (!iframe?.contentWindow) {
      resolve({
        siteName,
        error: t('timelineSiteNotReady', '页面尚未就绪')
      });
      return;
    }

    const cleanup = (handler, timer) => {
      window.removeEventListener('message', handler);
      clearTimeout(timer);
    };

    const handler = (event) => {
      if (event.source !== iframe.contentWindow) return;
      if (event.data?.type !== responseType) return;
      if (event.data?.requestId !== requestId) return;
      cleanup(handler, timer);
      resolve({
        ...event.data,
        siteName: event.data?.siteName || siteName
      });
    };

    const timer = setTimeout(() => {
      cleanup(handler, timer);
      resolve({
        siteName,
        error: t('timelineActionTimeout', '请求超时')
      });
    }, timeoutMs);

    window.addEventListener('message', handler);

    try {
      iframe.contentWindow.postMessage({
        type: requestType,
        requestId,
        siteName,
        ...payload
      }, '*');
    } catch (error) {
      cleanup(handler, timer);
      resolve({
        siteName,
        error: error?.message || String(error)
      });
    }
  });
}

function getDeepResearchButton() {
  return document.getElementById('deepResearchButton');
}

function setDeepResearchButtonBusy(isBusy) {
  const button = getDeepResearchButton();
  if (!button) return;

  button.disabled = isBusy;
  button.dataset.busy = isBusy ? 'true' : 'false';
  button.textContent = isBusy
    ? t('deepResearchButtonBusy', '研究中...')
    : t('deepResearchButtonLabel', '深度研究');
}

function requestIframeDeepResearchToggle(iframe, timeoutMs = DEEP_RESEARCH_TIMEOUT_MS) {
  const siteName = iframe?.getAttribute('data-site') || '';
  const requestId = `deep-research-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return new Promise((resolve) => {
    if (!iframe?.contentWindow) {
      resolve({
        siteName,
        status: 'timeout',
        detail: t('timelineSiteNotReady', '页面尚未就绪')
      });
      return;
    }

    const cleanup = (handler, timer) => {
      window.removeEventListener('message', handler);
      clearTimeout(timer);
    };

    const handler = (event) => {
      if (event.source !== iframe.contentWindow) return;
      if (event.data?.type !== 'DEEP_RESEARCH_RESULT') return;
      if (event.data?.requestId !== requestId) return;

      cleanup(handler, timer);
      resolve({
        siteName: event.data?.siteName || siteName,
        status: String(event.data?.status || 'error').trim() || 'error',
        detail: typeof event.data?.detail === 'string' ? event.data.detail : ''
      });
    };

    const timer = setTimeout(() => {
      cleanup(handler, timer);
      resolve({
        siteName,
        status: 'timeout',
        detail: t('timelineActionTimeout', '请求超时')
      });
    }, timeoutMs);

    window.addEventListener('message', handler);

    try {
      iframe.contentWindow.postMessage({
        type: 'TRIGGER_DEEP_RESEARCH',
        requestId,
        siteName
      }, '*');
    } catch (error) {
      cleanup(handler, timer);
      resolve({
        siteName,
        status: 'error',
        detail: error?.message || String(error)
      });
    }
  });
}

async function runDeepResearchAcrossOpenIframes() {
  if (deepResearchBatchInProgress) {
    showToast(t('deepResearchToastRunning', '正在为所有子页面开启深度研究...'));
    return;
  }

  const iframes = Array.from(document.querySelectorAll('.ai-iframe[data-site]'));
  if (!iframes.length) {
    showToast(t('timelineNoIframes', '当前没有可用的子页面'));
    return;
  }

  deepResearchBatchInProgress = true;
  setDeepResearchButtonBusy(true);
  showToast(t('deepResearchToastRunning', '正在为所有子页面开启深度研究...'), 1400);

  try {
    const results = await Promise.all(iframes.map((iframe) => requestIframeDeepResearchToggle(iframe)));
    const counts = {
      enabled: 0,
      already_enabled: 0,
      unsupported: 0,
      not_found: 0,
      error: 0,
      timeout: 0
    };

    results.forEach((result) => {
      const status = Object.prototype.hasOwnProperty.call(counts, result?.status) ? result.status : 'error';
      counts[status] += 1;
    });

    const total = results.length;
    const successCount = counts.enabled + counts.already_enabled;
    const unsupportedCount = counts.unsupported + counts.not_found;
    const failureCount = counts.error + counts.timeout;

    if (successCount === 0 && failureCount === 0) {
      showToast(
        t('deepResearchToastAllUnsupported', '当前打开的 $1 个子页面里没有可用的深度研究开关。', [String(total)]),
        3200
      );
      return;
    }

    if (failureCount > 0) {
      showToast(
        t(
          'deepResearchToastPartialFailure',
          '深度研究已处理 $1/$2 个子页面：新开启 $3，已开启 $4，跳过 $5，失败 $6。',
          [
            String(successCount),
            String(total),
            String(counts.enabled),
            String(counts.already_enabled),
            String(unsupportedCount),
            String(failureCount)
          ]
        ),
        3600
      );
      return;
    }

    showToast(
      t(
        'deepResearchToastSummary',
        '深度研究已就绪：共 $1/$2 个子页面，新开启 $3，已开启 $4，跳过 $5。',
        [
          String(successCount),
          String(total),
          String(counts.enabled),
          String(counts.already_enabled),
          String(unsupportedCount)
        ]
      ),
      3200
    );
  } finally {
    deepResearchBatchInProgress = false;
    setDeepResearchButtonBusy(false);
  }
}

async function scrollToTimelineEntry(entry, options = {}) {
  const { showToast: shouldShowToast = true, trackEvent: shouldTrackEvent = true } = options;
  const iframes = Array.from(document.querySelectorAll('.ai-iframe'));
  if (!iframes.length) {
    if (shouldShowToast) {
      showToast(t('timelineNoIframes', '当前没有可用的子页面'));
    }
    return;
  }

  const results = await Promise.all(iframes.map((iframe) => {
    return requestIframeTimelineAction(
      iframe,
      'SCROLL_TO_PROMPT',
      'SCROLL_TO_PROMPT_RESULT',
      {
        query: entry.query,
        occurrenceIndex: entry.occurrenceIndex
      }
    );
  }));

  const successCount = results.filter((item) => item?.found).length;
  if (successCount === 0) {
    if (shouldShowToast) {
      showToast(t('timelineScrollNotFound', '没有在当前子页面中找到这条提问'));
    }
  } else {
    if (shouldShowToast) {
      showToast(t('timelineScrollSuccess', '已定位 $1/$2 个子页面', [String(successCount), String(results.length)]));
    }
  }

  if (shouldTrackEvent) {
    trackEvent('iframe_timeline_scroll', {
      sites_total: results.length,
      sites_found: successCount
    });
  }
}

async function copyTextToClipboard(text) {
  const copyWithExecCommand = () => {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    const succeeded = document.execCommand('copy');
    textarea.remove();
    if (!succeeded) {
      throw new Error('execCommand copy failed');
    }
  };

  if (navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (error) {
      console.warn('navigator.clipboard.writeText failed, falling back to execCommand:', error);
      copyWithExecCommand();
      return;
    }
  }

  copyWithExecCommand();
}

function sortAnalysisPromptTemplates(templates = []) {
  return (Array.isArray(templates) ? templates : [])
    .filter((template) => template && template.name && template.query)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

async function loadAnalysisPromptTemplates() {
  try {
    const { analysisPromptTemplates = [] } = await chrome.storage.sync.get('analysisPromptTemplates');
    return sortAnalysisPromptTemplates(analysisPromptTemplates);
  } catch (error) {
    console.warn('加载分析提示词模板失败:', error);
    return [];
  }
}

async function hydrateAnalysisTemplateSelect(overlay, selectedTemplateId = '') {
  const selectEl = overlay?.querySelector?.('.timeline-copy-preview-analysis-select');
  const analyzeBtn = overlay?.querySelector?.('.timeline-copy-preview-analyze');
  if (!(selectEl instanceof HTMLSelectElement)) return [];

  selectEl.disabled = true;
  selectEl.innerHTML = `<option value="">${escapeHtml(t('analysisTemplateLoading', '加载分析提示词...'))}</option>`;
  if (analyzeBtn instanceof HTMLButtonElement) {
    analyzeBtn.disabled = true;
  }

  const templates = await loadAnalysisPromptTemplates();
  overlay.__timelineAnalysisTemplates = templates;

  if (!templates.length) {
    selectEl.innerHTML = `<option value="">${escapeHtml(t('analysisTemplateEmpty', '暂无分析提示词模板'))}</option>`;
    selectEl.disabled = true;
    return templates;
  }

  const options = templates.map((template) => {
    const safeName = escapeHtml(template.name);
    const safeId = escapeHtml(template.id);
    return `<option value="${safeId}">${safeName}</option>`;
  }).join('');
  selectEl.innerHTML = options;

  const nextSelectedId = templates.some((template) => template.id === selectedTemplateId)
    ? selectedTemplateId
    : (templates[0]?.id || '');
  selectEl.value = nextSelectedId;
  overlay.__timelineSelectedAnalysisTemplateId = nextSelectedId;
  selectEl.disabled = false;
  if (analyzeBtn instanceof HTMLButtonElement) {
    analyzeBtn.disabled = !String(overlay.__timelineCopyPreviewCopyText || '').trim();
  }
  return templates;
}

async function collectTimelineEntryResponses(entry) {
  const iframes = Array.from(document.querySelectorAll('.ai-iframe'));
  if (!iframes.length) {
    return {
      responses: [],
      copyText: '',
      successCount: 0,
      totalCount: 0
    };
  }

  const responses = await Promise.all(iframes.map((iframe) => {
    return requestIframeTimelineAction(
      iframe,
      'EXTRACT_PROMPT_RESPONSE',
      'EXTRACT_PROMPT_RESPONSE_RESULT',
      {
        query: entry.query,
        occurrenceIndex: entry.occurrenceIndex
      },
      12000
    );
  }));

  const normalizedResponses = responses.map((item) => ({
    siteName: item?.siteName || '',
    answers: Array.isArray(item?.answers) ? item.answers : [],
    content: item?.content || '',
    error: item?.error || ''
  }));

  const successCount = responses.filter((item) => {
    if (Array.isArray(item?.answers) && item.answers.some((answer) => String(answer || '').trim())) {
      return true;
    }
    return String(item?.content || '').trim().length > 0;
  }).length;

  return {
    responses: normalizedResponses,
    copyText: timelineBuildCopyText(entry, normalizedResponses),
    successCount,
    totalCount: responses.length
  };
}

function sanitizeTimelineExportFileName(entry) {
  const queryPart = String(entry?.query || '')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 48)
    .trim();
  const fallbackDate = new Date().toISOString().slice(0, 10);
  const datePart = String(entry?.dateLabel || fallbackDate)
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 24);
  const safeQuery = queryPart || 'chat-timeline';
  const safeDate = datePart || fallbackDate;
  return `${safeQuery}-${safeDate}.md`;
}

function downloadTimelineMarkdownFile(content, filename) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyTimelineEntryResponses(entry) {
  const iframes = Array.from(document.querySelectorAll('.ai-iframe'));
  if (!iframes.length) {
    showToast(t('timelineNoIframes', '当前没有可用的子页面'));
    return;
  }

  await showTimelineCopyPreviewModal(entry);
}

function setIframeHeaderStatus(iframeContainer, text, isHidden = false) {
  if (!iframeContainer) return;
  if (iframeContainer.__headerStatusTimer) {
    clearTimeout(iframeContainer.__headerStatusTimer);
    iframeContainer.__headerStatusTimer = null;
  }
  const statusEl = iframeContainer.querySelector('.iframe-header-status');
  if (!statusEl) return;
  statusEl.textContent = text || '';
  statusEl.classList.toggle('is-hidden', isHidden || !text);
}

function scheduleIframeHeaderStatus(iframeContainer, text, delayMs = 0) {
  if (!iframeContainer || !text) return;
  if (iframeContainer.__headerStatusTimer) {
    clearTimeout(iframeContainer.__headerStatusTimer);
  }
  iframeContainer.__headerStatusTimer = setTimeout(() => {
    setIframeHeaderStatus(iframeContainer, text);
  }, Math.max(0, Number(delayMs) || 0));
}

function hideIframeHeaderStatus(iframeContainer) {
  setIframeHeaderStatus(iframeContainer, '', true);
}

function getSearchBarElements() {
  return {
    bar: document.getElementById('searchBar'),
    input: document.getElementById('searchInput'),
    suggestions: document.getElementById('querySuggestions')
  };
}

function clearSearchBarCollapseTimer() {
  if (searchBarCollapseTimer) {
    clearTimeout(searchBarCollapseTimer);
    searchBarCollapseTimer = null;
  }
}

function hideQuerySuggestionsPanel() {
  const { suggestions } = getSearchBarElements();
  if (suggestions) {
    suggestions.style.display = 'none';
  }
}

function shouldAutoCollapseSearchBar() {
  const { bar, input } = getSearchBarElements();
  if (!bar || !input || !searchBarAutoCollapseArmed) return false;
  if (!document.body.classList.contains('search-bar-bottom')) return false;
  if (bar.classList.contains('search-bar-dragging')) return false;
  return !input.value.trim();
}

function setSearchBarCollapsed(collapsed, options = {}) {
  const { blurInput = true, focusInput = false, keepArmed = true } = options;
  const { bar, input } = getSearchBarElements();
  if (!bar || !input) return;

  clearSearchBarCollapseTimer();

  if (collapsed) {
    if (!shouldAutoCollapseSearchBar()) return;
    hideQuerySuggestionsPanel();
    bar.classList.add('search-bar-auto-collapsed');
    if (blurInput && document.activeElement === input) {
      input.blur();
    }
    return;
  }

  if (!keepArmed) {
    searchBarAutoCollapseArmed = false;
  }
  bar.classList.remove('search-bar-auto-collapsed');

  if (focusInput) {
    requestAnimationFrame(() => {
      const { bar: latestBar, input: latestInput } = getSearchBarElements();
      if (!latestBar || !latestInput || latestBar.classList.contains('search-bar-auto-collapsed')) {
        return;
      }
      try {
        latestInput.focus({ preventScroll: true });
      } catch (_) {
        latestInput.focus();
      }
      if (typeof latestInput.setSelectionRange === 'function') {
        const caret = latestInput.value.length;
        try {
          latestInput.setSelectionRange(caret, caret);
        } catch (_) {
          // Ignore selection errors on non-text inputs.
        }
      }
    });
  }
}

function scheduleSearchBarCollapse(delayMs = 140, options = {}) {
  const { ignoreFocusWithinBar = false } = options;
  clearSearchBarCollapseTimer();
  if (!searchBarAutoCollapseArmed) return;
  searchBarCollapseTimer = setTimeout(() => {
    const { bar, input } = getSearchBarElements();
    if (!bar) return;
    const activeElement = document.activeElement;
    if (bar.matches(':hover')) return;
    if (activeElement && bar.contains(activeElement)) {
      if (!ignoreFocusWithinBar) return;
      if (input && activeElement === input) {
        input.blur();
      }
    }
    setSearchBarCollapsed(true);
  }, Math.max(0, Number(delayMs) || 0));
}

function armSearchBarAutoCollapse() {
  searchBarAutoCollapseArmed = true;
  setSearchBarCollapsed(true);
}

function disarmSearchBarAutoCollapse() {
  searchBarAutoCollapseArmed = false;
  clearSearchBarCollapseTimer();
  setSearchBarCollapsed(false, { keepArmed: false });
}

function initSearchBarAutoCollapse() {
  const { bar, input } = getSearchBarElements();
  if (!bar || !input) return;

  bar.addEventListener('mouseenter', () => {
    if (!searchBarAutoCollapseArmed || !bar.classList.contains('search-bar-auto-collapsed')) return;
    setSearchBarCollapsed(false, { focusInput: true });
  });

  bar.addEventListener('mouseleave', () => {
    scheduleSearchBarCollapse(140, { ignoreFocusWithinBar: true });
  });

  bar.addEventListener('focusin', () => {
    clearSearchBarCollapseTimer();
    if (bar.classList.contains('search-bar-auto-collapsed')) {
      setSearchBarCollapsed(false, { keepArmed: true });
    }
  });

  bar.addEventListener('focusout', () => {
    setTimeout(() => {
      scheduleSearchBarCollapse();
    }, 0);
  });

  input.addEventListener('input', () => {
    if (input.value.trim()) {
      disarmSearchBarAutoCollapse();
      return;
    }
    if (searchBarAutoCollapseArmed && !bar.matches(':hover')) {
      scheduleSearchBarCollapse();
    }
  });
}

// 应用 iframe 输入框位置设置（iframe 页固定底部）
async function applyIframeInputPosition() {
  document.body.classList.add('search-bar-bottom');
}

// 底部 search-bar 拖动（支持左右/上下）：用 transform 平移，不触发布局
function initSearchBarDrag() {
  const bar = document.getElementById('searchBar');
  const handle = document.getElementById('searchBarDragHandle');
  if (!bar || !handle || !document.body.classList.contains('search-bar-bottom')) return;

  let pointerOffsetX = 0;
  let pointerOffsetY = 0;
  let pointerDownX = 0;
  let pointerDownY = 0;
  let originLeft = 0;
  let originTop = 0;
  let baseTranslateX = 0;
  let baseTranslateY = 0;
  let cachedBarWidth = 0;
  let cachedBarHeight = 0;
  let cachedViewportWidth = 0;
  let cachedViewportHeight = 0;
  let isPointerDown = false;
  let isDragging = false;
  let activePointerId = null;
  let rafId = 0;
  let pendingClientX = null;
  let pendingClientY = null;
  const dragStartThreshold = 4;

  function clampTargetLeft(targetLeft) {
    const maxLeft = Math.max(0, cachedViewportWidth - cachedBarWidth);
    return Math.max(0, Math.min(maxLeft, targetLeft));
  }

  function clampTargetTop(targetTop) {
    const maxTop = Math.max(0, cachedViewportHeight - cachedBarHeight);
    return Math.max(0, Math.min(maxTop, targetTop));
  }

  function readCurrentTranslate() {
    const transform = (bar.style.transform || getComputedStyle(bar).transform || '').trim();
    if (!transform || transform === 'none') {
      return { x: 0, y: 0 };
    }
    if (typeof DOMMatrixReadOnly === 'function') {
      try {
        const matrix = new DOMMatrixReadOnly(transform);
        return {
          x: Number.isFinite(matrix.m41) ? matrix.m41 : 0,
          y: Number.isFinite(matrix.m42) ? matrix.m42 : 0
        };
      } catch (_) {
        // Fallback to manual parsing below.
      }
    }
    const matchMatrix3d = transform.match(/^matrix3d\((.+)\)$/);
    if (matchMatrix3d) {
      const values = matchMatrix3d[1].split(',').map((value) => Number.parseFloat(value.trim()));
      if (values.length === 16) {
        return {
          x: Number.isFinite(values[12]) ? values[12] : 0,
          y: Number.isFinite(values[13]) ? values[13] : 0
        };
      }
    }
    const matchMatrix2d = transform.match(/^matrix\((.+)\)$/);
    if (matchMatrix2d) {
      const values = matchMatrix2d[1].split(',').map((value) => Number.parseFloat(value.trim()));
      if (values.length === 6) {
        return {
          x: Number.isFinite(values[4]) ? values[4] : 0,
          y: Number.isFinite(values[5]) ? values[5] : 0
        };
      }
    }
    const matchTranslate3d = transform.match(/^translate3d\((.+)\)$/);
    if (matchTranslate3d) {
      const values = matchTranslate3d[1].split(',').map((value) => Number.parseFloat(value.trim()));
      if (values.length >= 2) {
        return {
          x: Number.isFinite(values[0]) ? values[0] : 0,
          y: Number.isFinite(values[1]) ? values[1] : 0
        };
      }
    }
    const matchTranslate = transform.match(/^translate\((.+)\)$/);
    if (matchTranslate) {
      const values = matchTranslate[1].split(',').map((value) => Number.parseFloat(value.trim()));
      if (values.length >= 1) {
        return {
          x: Number.isFinite(values[0]) ? values[0] : 0,
          y: Number.isFinite(values[1]) ? values[1] : 0
        };
      }
    }
    const matchTranslateX = transform.match(/^translateX\((.+)\)$/);
    if (matchTranslateX) {
      const valueX = Number.parseFloat(matchTranslateX[1].trim());
      return {
        x: Number.isFinite(valueX) ? valueX : 0,
        y: 0
      };
    }
    const matchTranslateY = transform.match(/^translateY\((.+)\)$/);
    if (matchTranslateY) {
      const valueY = Number.parseFloat(matchTranslateY[1].trim());
      return {
        x: 0,
        y: Number.isFinite(valueY) ? valueY : 0
      };
    }
    return { x: 0, y: 0 };
  }

  function flushPosition() {
    if (pendingClientX === null || pendingClientY === null) return;
    const x = pendingClientX;
    const y = pendingClientY;
    pendingClientX = null;
    pendingClientY = null;
    rafId = 0;
    const targetLeft = clampTargetLeft(x - pointerOffsetX);
    const targetTop = clampTargetTop(y - pointerOffsetY);
    const tx = Math.round(baseTranslateX + (targetLeft - originLeft));
    const ty = Math.round(baseTranslateY + (targetTop - originTop));
    bar.style.transform = 'translate3d(' + tx + 'px, ' + ty + 'px, 0)';
  }

  function onPointerMove(e) {
    if (!isPointerDown || e.pointerId !== activePointerId) return;
    if (!isDragging) {
      const movedX = Math.abs(e.clientX - pointerDownX);
      const movedY = Math.abs(e.clientY - pointerDownY);
      if (movedX < dragStartThreshold && movedY < dragStartThreshold) {
        return;
      }
      isDragging = true;
      bar.classList.add('search-bar-dragging');
      document.body.classList.add('search-bar-drag-active');
    }
    pendingClientX = e.clientX;
    pendingClientY = e.clientY;
    if (rafId === 0) {
      rafId = requestAnimationFrame(flushPosition);
    }
  }

  function endDrag() {
    if (!isPointerDown && !isDragging) return;
    isPointerDown = false;
    pointerDownX = 0;
    pointerDownY = 0;
    isDragging = false;
    activePointerId = null;
    bar.classList.remove('search-bar-dragging');
    document.body.classList.remove('search-bar-drag-active');
    if (rafId !== 0) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    pendingClientX = null;
    pendingClientY = null;
    handle.removeEventListener('pointermove', onPointerMove);
    handle.removeEventListener('pointerup', onPointerUp);
    handle.removeEventListener('pointercancel', onPointerCancel);
  }

  function onPointerUp(e) {
    if (e.pointerId !== activePointerId) return;
    if (handle.hasPointerCapture(e.pointerId)) {
      handle.releasePointerCapture(e.pointerId);
    }
    endDrag();
  }

  function onPointerCancel(e) {
    if (e.pointerId !== activePointerId) return;
    endDrag();
  }

  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || isPointerDown) return;
    e.preventDefault();
    e.stopPropagation();
    isPointerDown = true;
    isDragging = false;
    activePointerId = e.pointerId;
    pendingClientX = null;
    pendingClientY = null;
    const rect = bar.getBoundingClientRect();
    pointerDownX = e.clientX;
    pointerDownY = e.clientY;
    pointerOffsetX = e.clientX - rect.left;
    pointerOffsetY = e.clientY - rect.top;
    originLeft = rect.left;
    originTop = rect.top;
    const currentTranslate = readCurrentTranslate();
    baseTranslateX = currentTranslate.x;
    baseTranslateY = currentTranslate.y;
    cachedBarWidth = rect.width;
    cachedBarHeight = rect.height;
    cachedViewportWidth = document.documentElement.clientWidth;
    cachedViewportHeight = document.documentElement.clientHeight;
    handle.setPointerCapture(e.pointerId);
    handle.addEventListener('pointermove', onPointerMove);
    handle.addEventListener('pointerup', onPointerUp);
    handle.addEventListener('pointercancel', onPointerCancel);
  });
}

function createInjectProgressOverlay(siteName) {
  const overlay = document.createElement('div');
  overlay.className = 'inject-progress';
  overlay.dataset.visibleSince = '0';
  overlay.dataset.lastStatus = '';
  overlay.innerHTML = `
    <div class="inject-progress-content">
      <div class="inject-progress-title">${t('injectProgressTitleRunning', '正在执行脚本...')}</div>
      <div class="inject-progress-detail">${t('injectProgressDetailPreparing', '准备中')}</div>
      <div class="inject-progress-actions">
        <button class="inject-progress-retry" type="button">${t('injectProgressButtonRetry', '重试')}</button>
        <button class="inject-progress-close" type="button">${t('injectProgressButtonClose', '关闭')}</button>
      </div>
    </div>
  `;

  const retryBtn = overlay.querySelector('.inject-progress-retry');
  const closeBtn = overlay.querySelector('.inject-progress-close');
  retryBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const container = overlay.closest('.iframe-container');
    const iframe = container?.querySelector('iframe');
    const query = (container?.dataset.lastQuery || '').trim() || (document.getElementById('searchInput')?.value || '').trim();
    if (!query) {
      showToast(t('injectProgressToastNeedQuery', '请输入问题'));
      return;
    }
    setInjectProgressState(overlay, {
      status: 'start',
      totalSteps: 0,
      description: t('injectProgressDetailRetrying', '重试中')
    });
    await retryInjectForIframe(iframe, siteName, query);
  });
  closeBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (overlay.__hideTimer) {
      clearTimeout(overlay.__hideTimer);
      overlay.__hideTimer = null;
    }
    overlay.classList.remove('is-visible', 'is-error');
  });

  return overlay;
}

function clearInjectProgressHideTimer(overlay) {
  if (!overlay?.__hideTimer) return;
  clearTimeout(overlay.__hideTimer);
  overlay.__hideTimer = null;
}

function markInjectProgressVisible(overlay) {
  if (!overlay) return;
  clearInjectProgressHideTimer(overlay);
  if (!overlay.classList.contains('is-visible')) {
    overlay.dataset.visibleSince = String(Date.now());
  } else if (!overlay.dataset.visibleSince || overlay.dataset.visibleSince === '0') {
    overlay.dataset.visibleSince = String(Date.now());
  }
  overlay.classList.add('is-visible');
}

function scheduleInjectProgressHide(overlay, delayMs = 0) {
  if (!overlay) return;
  clearInjectProgressHideTimer(overlay);
  overlay.__hideTimer = setTimeout(() => {
    overlay.classList.remove('is-visible', 'is-error');
    overlay.dataset.visibleSince = '0';
    overlay.__hideTimer = null;
  }, Math.max(0, Number(delayMs) || 0));
}

function setInjectProgressState(overlay, payload) {
  if (!overlay) return;
  const titleEl = overlay.querySelector('.inject-progress-title');
  const detailEl = overlay.querySelector('.inject-progress-detail');
  const retryBtn = overlay.querySelector('.inject-progress-retry');
  const closeBtn = overlay.querySelector('.inject-progress-close');

  const status = payload.status;
  if (status === 'complete') {
    const minVisibleMs = Number(payload.minVisibleMs || 900);
    const completeHoldMs = Number(payload.completeHoldMs || 600);
    const visibleSince = Number(overlay.dataset.visibleSince || 0);
    const elapsed = visibleSince > 0 ? (Date.now() - visibleSince) : minVisibleMs;
    const delayMs = Math.max(0, minVisibleMs - elapsed) + completeHoldMs;
    markInjectProgressVisible(overlay);
    overlay.classList.remove('is-error');
    overlay.dataset.lastStatus = status;
    if (titleEl) titleEl.textContent = t('injectProgressTitleComplete', '执行完成');
    if (detailEl) detailEl.textContent = payload.description || t('injectProgressDetailComplete', '脚本已执行完成');
    if (retryBtn) retryBtn.style.display = 'none';
    if (closeBtn) closeBtn.style.display = 'none';
    scheduleInjectProgressHide(overlay, delayMs);
    return;
  }

  const rawDescription = payload.description || '';
  const cleanedDescription = rawDescription
    .replace(/（支持重试）/g, '')
    .replace(/\(支持重试\)/g, '')
    .trim();
  const descriptionI18nMap = {
    '使用URL查询，无需输入框操作': 'injectStepDescUrlQueryNoInput',
    '发送 ⌘ + Enter (Mac) 或 Ctrl + Enter (Windows) 提交Prompt': 'injectStepDescSendCmdOrCtrlEnter',
    '发送回车键': 'injectStepDescSendEnter',
    '发送回车键提交': 'injectStepDescSendEnterSubmit',
    '发送消息给父窗口': 'injectStepDescSendMessageToParent',
    '执行文件粘贴操作': 'injectStepDescExecuteFilePaste',
    '点击Claude发送按钮': 'injectStepDescClickClaudeSend',
    '点击POE发送按钮': 'injectStepDescClickPoeSend',
    '点击发送按钮': 'injectStepDescClickSend',
    '点击豆包发送按钮': 'injectStepDescClickDoubaoSend',
    '站点暂未实现搜索处理器': 'injectStepDescHandlerNotImplemented',
    '等待100ms': 'injectStepDescWait100ms',
    '等待200ms确保聚焦完成': 'injectStepDescWait200msEnsureFocus',
    '等待200ms，确保Angular变更检测完成': 'injectStepDescWait200msAngular',
    '等待400ms让 Slate/React 状态更新并启用发送按钮后再发送': 'injectStepDescWait400msSlateReact',
    '聚焦 Lexical 编辑器输入框': 'injectStepDescFocusLexicalInput',
    '聚焦AI Studio提示输入区域': 'injectStepDescFocusAIStudioPrompt',
    '聚焦AI Studio输入框准备文件粘贴': 'injectStepDescFocusAIStudioInputForPaste',
    '聚焦ChatGPT输入框': 'injectStepDescFocusChatGPTInput',
    '聚焦ChatGPT输入框准备文件粘贴': 'injectStepDescFocusChatGPTInputForPaste',
    '聚焦Claude输入框准备文件粘贴': 'injectStepDescFocusClaudeInputForPaste',
    '聚焦Copilot输入框': 'injectStepDescFocusCopilotInput',
    '聚焦Copilot输入框准备文件粘贴': 'injectStepDescFocusCopilotInputForPaste',
    '聚焦Gemini输入框准备文件粘贴': 'injectStepDescFocusGeminiInputForPaste',
    '聚焦Grok输入框准备文件粘贴': 'injectStepDescFocusGrokInputForPaste',
    '聚焦Kimi Lexical编辑器输入框准备文件粘贴': 'injectStepDescFocusKimiLexicalInputForPaste',
    '聚焦POE输入框准备文件粘贴': 'injectStepDescFocusPoeInputForPaste',
    '聚焦Qwen输入框准备文件粘贴': 'injectStepDescFocusQwenInputForPaste',
    '聚焦可编辑区域': 'injectStepDescFocusEditableArea',
    '聚焦可编辑区域准备文件粘贴': 'injectStepDescFocusEditableAreaForPaste',
    '聚焦推荐框或输入框': 'injectStepDescFocusSuggestionOrInput',
    '聚焦文心一言编辑器': 'injectStepDescFocusWenxinEditor',
    '聚焦文心一言编辑器准备文件粘贴': 'injectStepDescFocusWenxinEditorForPaste',
    '聚焦秘塔AI输入框准备文件粘贴': 'injectStepDescFocusMetasoInputForPaste',
    '聚焦豆包输入框': 'injectStepDescFocusDoubaoInput',
    '聚焦豆包输入框准备文件粘贴': 'injectStepDescFocusDoubaoInputForPaste',
    '聚焦输入框': 'injectStepDescFocusInput',
    '聚焦输入框准备文件粘贴': 'injectStepDescFocusInputForPaste',
    '聚焦输入框（Slate 编辑器）': 'injectStepDescFocusInputSlate',
    '聚焦通义千问输入框准备文件粘贴': 'injectStepDescFocusTongyiInputForPaste',
    '触发多种输入事件': 'injectStepDescTriggerMultipleInputEvents',
    '触发完整的输入事件序列': 'injectStepDescTriggerFullInputEventSequence',
    '触发特殊输入事件': 'injectStepDescTriggerSpecialInputEvents',
    '触发输入事件': 'injectStepDescTriggerInputEvents',
    '触发输入事件（含 InputEvent 文本，同步 React 状态以启用发送按钮）': 'injectStepDescTriggerInputEventsWithInputEvent',
    '设置 Lexical 编辑器内容（自动创建 span[data-lexical-text] 结构）': 'injectStepDescSetLexicalContent',
    '设置AI Studio输入内容（Angular FormControl）': 'injectStepDescSetAIStudioInputAngular',
    '设置ChatGPT输入框内容': 'injectStepDescSetChatGPTInputContent',
    '设置Copilot输入框的值': 'injectStepDescSetCopilotInputValue',
    '设置POE特殊输入框的值': 'injectStepDescSetPoeSpecialInputValue',
    '设置可编辑区域内容': 'injectStepDescSetEditableAreaContent',
    '设置文心一言特殊编辑器内容': 'injectStepDescSetWenxinSpecialEditorContent',
    '设置秘塔输入框的值': 'injectStepDescSetMetasoInputValue',
    '设置豆包输入框的值': 'injectStepDescSetDoubaoInputValue',
    '设置输入框的值': 'injectStepDescSetInputValue'
  };
  const descriptionKey = descriptionI18nMap[cleanedDescription];
  const translatedDescription = descriptionKey ? t(descriptionKey, cleanedDescription) : cleanedDescription;
  const isEnglish = (chrome?.i18n?.getUILanguage() || '').toLowerCase().startsWith('en');
  const hasChinese = /[\u4e00-\u9fff]/.test(translatedDescription);
  const actionLabelMap = {
    click: t('injectStepActionClick', 'Click'),
    focus: t('injectStepActionFocus', 'Focus'),
    setValue: t('injectStepActionSetValue', 'Set value'),
    triggerEvents: t('injectStepActionTriggerEvents', 'Trigger events'),
    sendKeys: t('injectStepActionSendKeys', 'Send keys'),
    replace: t('injectStepActionReplace', 'Replace'),
    wait: t('injectStepActionWait', 'Wait'),
    custom: t('injectStepActionCustom', 'Custom action'),
    paste: t('injectStepActionPaste', 'Paste')
  };
  const actionLabel = payload.action ? actionLabelMap[payload.action] : '';
  const description = (!translatedDescription || (isEnglish && hasChinese))
    ? (actionLabel || translatedDescription)
    : translatedDescription;
  const retryInfo = (payload.retryAttempts && payload.retryMax)
    ? t('injectProgressRetryInfo', '重试 $1/$2', [String(payload.retryAttempts), String(payload.retryMax)])
    : '';
  const retrySuffix = retryInfo ? `（${retryInfo}）` : '';
  const notLoadedMessage = t(
    'injectProgressErrorPageNotLoadedOrChanged',
    '网页未加载成功或者已经改版'
  );
  const elementNotFoundMessage = t('injectProgressErrorElementNotFound', '未找到元素');
  const isElementNotFoundError = String(payload.errorMessage || '').trim() === elementNotFoundMessage;

  if (status === 'error') {
    markInjectProgressVisible(overlay);
    overlay.classList.add('is-error');
    overlay.dataset.lastStatus = status;
    if (titleEl) titleEl.textContent = t('injectProgressTitleError', '执行失败');
    if (detailEl) {
      if (isElementNotFoundError) {
        detailEl.textContent = notLoadedMessage;
      } else {
        const stepInfo = payload.stepIndex && payload.totalSteps
          ? t('injectProgressStepInfo', '步骤 $1/$2', [String(payload.stepIndex), String(payload.totalSteps)])
          : t('injectProgressStepInfoFallback', '执行中断');
        const detailText = description ? `${stepInfo}：${description}${retrySuffix}` : stepInfo;
        detailEl.textContent = payload.errorMessage ? `${detailText}（${payload.errorMessage}）` : detailText;
      }
    }
    if (retryBtn) retryBtn.style.display = 'inline-flex';
    if (closeBtn) closeBtn.style.display = 'inline-flex';
    return;
  }

  markInjectProgressVisible(overlay);
  overlay.classList.remove('is-error');
  overlay.dataset.lastStatus = status;
  if (retryBtn) retryBtn.style.display = 'inline-flex';
  if (closeBtn) closeBtn.style.display = 'inline-flex';

  if (status === 'start') {
    if (titleEl) titleEl.textContent = t('injectProgressTitleRunning', '正在执行脚本...');
    if (detailEl) detailEl.textContent = description || t('injectProgressDetailPreparing', '准备中');
    return;
  }

  if (status === 'step' || status === 'step_complete') {
    const stepInfo = payload.stepIndex && payload.totalSteps
      ? t('injectProgressStepInfo', '步骤 $1/$2', [String(payload.stepIndex), String(payload.totalSteps)])
      : t('injectProgressStepInfoFallbackProgress', '执行中');
    const detailText = description ? `${stepInfo}：${description}${retrySuffix}` : stepInfo;
    if (titleEl) titleEl.textContent = t('injectProgressTitleRunning', '正在执行脚本...');
    if (detailEl) detailEl.textContent = detailText;
  }
}

async function retryInjectForIframe(iframe, siteName, query) {
  if (!iframe) return;
  try {
    const historyId = window._currentHistoryId || null;
    const handler = await getIframeHandler(iframe.src, siteName);
    if (handler) {
      await handler(iframe, query, historyId);
      return;
    }
    const domain = new URL(iframe.src).hostname;
    const searchId = window.aiCompareSiteRuntime?.queueSiteRuntime
      ? window.aiCompareSiteRuntime.queueSiteRuntime(siteName, query, { iframeSrc: iframe.src })
      : createSiteSearchId(siteName);
    iframe.contentWindow?.postMessage({
      type: 'search',
      query,
      domain,
      historyId,
      siteName,
      searchId
    }, '*');
  } catch (error) {
    console.error('重试失败:', error);
  }
}

function normalizeSiteMatchPath(pathname) {
  if (!pathname || pathname === '/') return '/';
  return pathname.replace(/\/+$/, '') || '/';
}

function resolveSiteForIframeUrl(sites, iframeUrl, preferredSiteName = null) {
  let currentUrl;
  try {
    currentUrl = new URL(iframeUrl);
  } catch (_) {
    return null;
  }

  const currentDomain = currentUrl.hostname;
  const currentPath = normalizeSiteMatchPath(currentUrl.pathname || '/');

  const matches = (sites || []).map((site) => {
    if (!site || !site.url || site.hidden) return null;
    try {
      const siteUrl = new URL(site.url);
      const siteDomain = siteUrl.hostname;
      const domainMatched =
        currentDomain === siteDomain ||
        currentDomain.includes(siteDomain) ||
        siteDomain.includes(currentDomain);

      if (!domainMatched) return null;

      const preferredNameMatched = preferredSiteName && site.name === preferredSiteName;

      const sitePath = normalizeSiteMatchPath(siteUrl.pathname || '/');
      let pathScore = 0;

      if (currentPath === sitePath) {
        pathScore = 400 + sitePath.length;
      } else if (sitePath !== '/' && currentPath.startsWith(sitePath + '/')) {
        pathScore = 300 + sitePath.length;
      } else if (preferredNameMatched) {
        // Redirected workspace URLs can move away from the original entry-page
        // path. When the iframe already carries the concrete site name, keep
        // resolving that handler on the same domain.
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
          (currentDomain === siteDomain ? 100 : 50) +
          pathScore
      };
    } catch (_) {
      return null;
    }
  }).filter(Boolean);

  matches.sort((a, b) => b.score - a.score);
  return matches[0]?.site || null;
}

function getOpenedSites() {
  return Array.from(document.querySelectorAll('.ai-iframe'))
    .map(iframe => iframe.getAttribute('data-site'))
    .filter(Boolean);
}

// 统一的文件扩展名检测
const SUPPORTED_FILE_EXTENSIONS = [
  // Office文档类型
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'odt', 'ods', 'odp', 'rtf', 'pages', 'numbers', 'key',
  'wps', 'et', 'dps', 'vsd', 'vsdx', 'pub', 'one', 'msg', 'eml', 'mpp',
  // 文本和数据文件
  'txt', 'csv', 'json', 'xml', 'html', 'css', 'js', 'md', 'yaml', 'yml',
  // 图片格式
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'tiff', 'ico', 'avif',
  // 音视频格式
  'mp4', 'avi', 'mov', 'wmv', 'webm', 'mp3', 'wav', 'ogg', 'flac', 'm4a',
  // 代码文件
  'py', 'java', 'cpp', 'c', 'php', 'rb', 'go', 'rs', 'swift', 'kt', 'ts',
  // 压缩文件
  'zip', 'rar', '7z', 'gz', 'tar', 'bz2', 'xz'
];

// 检测是否具有有效的文件扩展名
function hasValidFileExtension(text) {
  if (!text || typeof text !== 'string') {
    return false;
  }
  
  const firstLine = text.trim().split('\n')[0];
  
  // 排除URL（包含http/https协议的内容）
  if (firstLine.includes('http://') || firstLine.includes('https://')) {
    return false;
  }
  
  // 排除包含域名模式的内容（如www.xxx.com）
  if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}\//i.test(firstLine) || /www\./i.test(firstLine)) {
    return false;
  }
  
  const fileExtensionRegex = new RegExp(`\\.(${SUPPORTED_FILE_EXTENSIONS.join('|')})$`, 'i');
  return fileExtensionRegex.test(firstLine) && firstLine.length < 100;
}

// 请求剪贴板权限的函数
async function requestClipboardPermission() {
  try {
    console.log('🔍 开始请求剪贴板权限...');
    
    // 检查权限状态
    const permissionStatus = await navigator.permissions.query({ name: 'clipboard-read' });
    console.log('当前剪贴板权限状态:', permissionStatus.state);
    console.log('权限对象详情:', permissionStatus);
    
    if (permissionStatus.state === 'granted') {
      console.log('✅ 剪贴板权限已授予');
      return true;
    } else if (permissionStatus.state === 'prompt') {
      console.log('🔄 需要用户授权剪贴板权限');
      console.log('📋 尝试读取剪贴板来触发权限请求...');
      
      // 尝试读取剪贴板来触发权限请求
      try {
        const clipboardData = await navigator.clipboard.read();
        console.log('✅ 剪贴板权限请求成功');
        console.log('剪贴板内容:', clipboardData);
        return true;
      } catch (error) {
        console.log('❌ 剪贴板权限请求失败:', error);
        console.log('错误名称:', error.name);
        console.log('错误消息:', error.message);
        console.log('错误堆栈:', error.stack);
        return false;
      }
    } else {
      console.log('❌ 剪贴板权限被拒绝');
      console.log('💡 建议: 请检查浏览器设置中的剪贴板权限');
      return false;
    }
  } catch (error) {
    console.log('❌ 检查剪贴板权限失败:', error);
    console.log('错误详情:', error);
    return false;
  }
}

// 页面加载完成后的初始化
document.addEventListener('DOMContentLoaded', async function() {
    // 初始化自动调整高度的输入框
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        const resizeUtils = globalThis.TextareaResizeUtils;
        const inputWrapper = searchInput.closest('.input-wrapper');
        const mirror = document.createElement('div');
        mirror.setAttribute('aria-hidden', 'true');
        mirror.style.position = 'absolute';
        mirror.style.top = '-9999px';
        mirror.style.left = '-9999px';
        mirror.style.visibility = 'hidden';
        mirror.style.whiteSpace = 'pre-wrap';
        mirror.style.wordWrap = 'break-word';
        mirror.style.boxSizing = 'border-box';
        document.body.appendChild(mirror);

        function syncMirrorStyles() {
            const styles = window.getComputedStyle(searchInput);
            mirror.style.fontFamily = styles.fontFamily;
            mirror.style.fontSize = styles.fontSize;
            mirror.style.lineHeight = styles.lineHeight;
            mirror.style.letterSpacing = styles.letterSpacing;
            mirror.style.paddingTop = styles.paddingTop;
            mirror.style.paddingBottom = styles.paddingBottom;
            mirror.style.paddingLeft = styles.paddingLeft;
            mirror.style.paddingRight = styles.paddingRight;
            mirror.style.borderTopWidth = styles.borderTopWidth;
            mirror.style.borderBottomWidth = styles.borderBottomWidth;
        }

        function getSingleLineHeightPx() {
            const styles = window.getComputedStyle(searchInput);
            const fontSize = parseFloat(styles.fontSize) || 14;
            let lineHeight = parseFloat(styles.lineHeight);
            if (Number.isNaN(lineHeight)) {
                lineHeight = fontSize * 1.2;
            }
            const paddingTop = parseFloat(styles.paddingTop) || 0;
            const paddingBottom = parseFloat(styles.paddingBottom) || 0;
            const borderTop = parseFloat(styles.borderTopWidth) || 0;
            const borderBottom = parseFloat(styles.borderBottomWidth) || 0;
            return Math.ceil(lineHeight + paddingTop + paddingBottom + borderTop + borderBottom);
        }

        syncMirrorStyles();

        // 自动调整输入框高度
        function autoResizeTextarea() {
            const minHeightFallback = 36; // 默认高度
            const maxHeight = 200; // 最大高度
            const actionsWidth = inputWrapper
                ? inputWrapper.querySelector('.input-actions')?.offsetWidth || 0
                : 0;
            const availableWidth = searchInput.clientWidth - actionsWidth - 6;

            // 计算单行真实高度，避免空内容时看起来像两行
            const singleLineHeight = getSingleLineHeightPx();
            const minHeight = Math.max(minHeightFallback, singleLineHeight);
            // 记录默认高度（固定）
            searchInput.dataset.singleLineHeight = String(minHeightFallback);

            mirror.style.width = Math.max(0, availableWidth) + 'px';
            mirror.textContent = searchInput.value + '\n';
            const compactContentHeight = Math.ceil(mirror.scrollHeight);

            mirror.style.width = searchInput.clientWidth + 'px';
            mirror.textContent = searchInput.value + '\n';
            const expandedContentHeight = Math.ceil(mirror.scrollHeight);

            const layout = resizeUtils.calculateTextareaLayout({
                hasValue: searchInput.value.length > 0,
                compactContentHeight,
                expandedContentHeight,
                minHeight,
                defaultHeight: minHeightFallback,
                maxHeight
            });

            if (inputWrapper) {
                inputWrapper.classList.toggle('avoid-overlap', layout.avoidOverlap);
                inputWrapper.classList.toggle('compact', layout.compact);
            }

            searchInput.style.height = layout.height + 'px';
            searchInput.style.overflowY = layout.overflowY;

            if (!layout.isScrollable) {
                searchInput.scrollTop = 0;
            }
        }
        
        // 监听输入事件
        searchInput.addEventListener('input', autoResizeTextarea);
        
        // 监听粘贴事件
        searchInput.addEventListener('paste', () => {
            // 延迟执行，等待粘贴内容处理完成
            setTimeout(autoResizeTextarea, 10);
        });
        
        // 监听聚焦事件，自动调整高度
        searchInput.addEventListener('focus', () => {
            autoResizeTextarea();
        });
        
        // 监听失焦事件，保留有内容时的高度并隐藏建议
        searchInput.addEventListener('blur', (e) => {
            autoResizeTextarea();
            if (!searchInput.value) {
                searchInput.scrollTop = 0;
            }
            
            // 延迟隐藏查询建议，以便用户能够点击建议项
            setTimeout(() => {
                const querySuggestions = document.getElementById('querySuggestions');
                if (querySuggestions) {
                    querySuggestions.style.display = 'none';
                }
            }, 200);
        });
        
        // 初始调整
        autoResizeTextarea();
    }

    // 应用输入框位置设置
    await applyIframeInputPosition();
    initSearchBarDrag();
    initSearchBarAutoCollapse();

    // 检测是否在侧边栏中打开
    const isSidePanel = window.location.href.includes('side_panel') || 
                       window.location.search.includes('side_panel') ||
                       (window.top !== window); // 如果被嵌入，可能是在侧边栏中

    // 从存储中获取列数设置
    let { preferredColumns = '3' } = await chrome.storage.sync.get('preferredColumns');
    
    // 如果在侧边栏中打开，或窗口极窄，临时使用1列
    if (window.innerWidth < 180 || isSidePanel || window.innerWidth < 500) {
       preferredColumns = '1';
    }
    
    // 设置默认激活状态和当前显示
    setActiveColumnOption(preferredColumns);
    updateCurrentDisplay(preferredColumns);
    updateColumns(preferredColumns);

    // 检查 URL 参数，判断打开方式
    const urlParams = new URLSearchParams(window.location.search);
    const analysisToken = urlParams.get('analysisToken');
    const analysisContext = analysisToken && typeof AnalysisUtils.loadTimelineAnalysisPayload === 'function'
      ? await AnalysisUtils.loadTimelineAnalysisPayload(analysisToken)
      : null;
    const analysisQuery = analysisContext && typeof AnalysisUtils.buildAnalysisPrompt === 'function'
      ? AnalysisUtils.buildAnalysisPrompt(analysisContext)
      : '';
    const hasQueryParam = urlParams.has('query') || Boolean(analysisContext);
    const hasSitesParam = urlParams.has('sites');
    const hasCustomSitesParam = urlParams.has('customSites');

    // 如果 URL 中携带了 historyId，表示从历史/收藏页打开，直接恢复该记录的 ID，
    // 避免 createIframes → savePKHistory 创建重复记录
    const urlHistoryId = urlParams.get('historyId');
    const historyItem = urlHistoryId ? await getHistoryItemById(urlHistoryId) : null;
    const historyRestoreContext = urlHistoryId ? await getHistoryRestoreContext(urlHistoryId) : null;
    if (urlHistoryId) {
        window._currentHistoryId = urlHistoryId;
        window._openedFromHistory = true;
        console.log('从历史记录打开，historyId:', urlHistoryId);
    }
    
    // 获取指定的站点列表（如果存在）
    let selectedSiteNames = null;
    if (hasSitesParam) {
        const sitesParam = urlParams.get('sites');
        if (sitesParam) {
            selectedSiteNames = sitesParam.split(',').map(name => name.trim()).filter(name => name);
            console.log('从 URL 参数获取指定的站点列表:', selectedSiteNames);
        }
    }
    if (!selectedSiteNames && Array.isArray(analysisContext?.compareSites) && analysisContext.compareSites.length > 0) {
        selectedSiteNames = analysisContext.compareSites.map((name) => String(name || '').trim()).filter(Boolean);
        console.log('从分析载荷获取指定的站点列表:', selectedSiteNames);
    }

    let selectedCustomSiteIds = null;
    if (hasCustomSitesParam) {
        const customSitesParam = urlParams.get('customSites');
        if (customSitesParam) {
            selectedCustomSiteIds = customSitesParam.split(',').map(id => id.trim()).filter(Boolean);
            console.log('从 URL 参数获取指定的 customSites:', selectedCustomSiteIds);
        }
    }

    const allCustomSites = typeof window.getCustomSites === 'function'
      ? await window.getCustomSites()
      : [];
    const selectedCustomSites = selectedCustomSiteIds && selectedCustomSiteIds.length > 0
      ? allCustomSites.filter(site => selectedCustomSiteIds.includes(site.id) || selectedCustomSiteIds.includes(site.name))
      : [];

    let restoredHistoryIframesOnInit = false;
    const historySites = Array.isArray(historyItem?.sites) ? historyItem.sites : [];
    const filteredHistorySites = selectedSiteNames && selectedSiteNames.length > 0
      ? historySites.filter((site) => selectedSiteNames.includes(site?.name))
      : historySites;
    const initialHistorySites = filteredHistorySites.length > 0 ? filteredHistorySites : historySites;
    const shouldDeferQueryDrivenInit = initialHistorySites.length > 0 && Boolean(historyRestoreContext?.autoSearch);

    if (urlHistoryId && initialHistorySites.length > 0) {
        console.log('检测到 historyId，首屏直接恢复历史 iframe:', {
            historyId: urlHistoryId,
            sites: initialHistorySites.map((site) => site?.name).filter(Boolean)
        });
        await loadHistoryIframes(initialHistorySites, historyRestoreContext);
        restoredHistoryIframesOnInit = true;
    }
    
    if (!restoredHistoryIframesOnInit && hasQueryParam) {
        // 从 URL 参数中获取查询内容
        const query = historyRestoreContext?.query || analysisQuery || urlParams.get('query');
        console.log('从 URL 参数获取查询内容:', query);
        
        if (query && query !== 'true') {
            // 将查询内容填入搜索框
            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                searchInput.value = query;
                updateFavoriteButtonVisibility(query);
            }

            if (shouldDeferQueryDrivenInit) {
                console.log('检测到收藏恢复上下文，等待历史 iframe 恢复消息');
            } else {
                // 获取站点配置并创建 iframes
                getDefaultSites().then((sites) => {
                    if (sites && sites.length > 0) {
                        const availableSites = getInitialIframeSites(sites, selectedSiteNames);

                        if (selectedSiteNames && selectedSiteNames.length > 0) {
                            console.log('根据选中的站点列表过滤:', selectedSiteNames, availableSites);
                        } else {
                            console.log('如果没有指定站点列表，默认只打开已启用的站点:', availableSites);
                        }

                        if (availableSites.length > 0) {
                            console.log('使用查询内容创建 iframes:', query, availableSites);
                            createIframes(query, availableSites, selectedCustomSites);
                        } else {
                            console.log('没有可用的站点');
                        }
                    }
                });
            }
        } else {
            // 如果查询参数是 'true' 或空，按直接打开处理
            console.log('URL 参数 query=true，按直接打开处理');
            getDefaultSites().then((sites) => {
                if (sites && sites.length > 0) {
                    const availableSites = getInitialIframeSites(sites, selectedSiteNames);

                    if (selectedSiteNames && selectedSiteNames.length > 0) {
                        console.log('根据选中的站点列表过滤:', selectedSiteNames, availableSites);
                    } else {
                        console.log('如果没有指定站点列表，默认只打开已启用的站点:', availableSites);
                    }

                    if (availableSites.length > 0) {
                        console.log('初始化可用站点:', availableSites);
                        createIframes('', availableSites, selectedCustomSites);
                    } else {
                        console.log('没有可用的站点');
                    }
                }
            });
        }
    } else if (!restoredHistoryIframesOnInit) {
        // 直接打开（方式1）
        getDefaultSites().then((sites) => {
            if (sites && sites.length > 0) {
                const availableSites = getInitialIframeSites(sites, selectedSiteNames);

                if (selectedSiteNames && selectedSiteNames.length > 0) {
                    console.log('根据选中的站点列表过滤:', selectedSiteNames, availableSites);
                } else {
                    console.log('如果没有指定站点列表，默认只打开已启用的站点:', availableSites);
                }

                if (availableSites.length > 0) {
                    console.log('初始化可用站点:', availableSites);
                    createIframes('', availableSites, selectedCustomSites);
                } else {
                    console.log('没有可用的站点');
                }
            }
        });
    }

    // 统一的文件粘贴处理 - 只添加一次监听器
    if (!filePasteHandlerAdded) {
        document.addEventListener('paste', handleUnifiedFilePaste);
        filePasteHandlerAdded = true;
        console.log('🎯 统一文件粘贴监听器已添加');
    }

    // 添加文件上传功能的事件监听器
    initializeFileUpload();
    
    // 检查 URL 参数，如果 upload=true，显示提示信息
    // 注意：urlParams 已经在上面第 169 行声明了，这里直接使用
    if (urlParams.get('upload') === 'true') {
        // 立即显示提示，停留时间更长
        showToast(t('uploadToastClickLinkIcon', 'After the page loads, click the 🔗 icon in the input box'), 8000); // 显示 8 秒
    }

});

// 显示本地文件限制警告
function showLocalFileWarning(fileName, fileExtension) {
  const warning = document.createElement('div');
  warning.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: linear-gradient(135deg, #ff6b6b, #ee5a24);
    color: white;
    padding: 24px;
    border-radius: 16px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.3);
    z-index: 10001;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    max-width: 480px;
    width: 90%;
    text-align: left;
    line-height: 1.6;
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255,255,255,0.2);
    animation: slideInScale 0.3s ease-out;
  `;
  
  // 使用通用的文件图标
  const icon = '📁';
  
  // 获取国际化消息
  const localFileDetected = chrome.i18n.getMessage('localFileDetected');
  const browserSecurityRestriction = chrome.i18n.getMessage('browserSecurityRestriction');
  const localFileSecurityMessage = chrome.i18n.getMessage('localFileSecurityMessage');
  const suggestedActions = chrome.i18n.getMessage('suggestedActions');
  const uploadFileAction = chrome.i18n.getMessage('uploadFileAction');
  const dismissWarning = chrome.i18n.getMessage('dismissWarning');
  
  warning.innerHTML = `
    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
      <span style="font-size: 32px;">${icon}</span>
      <div>
        <div style="font-weight: 600; font-size: 16px;">${localFileDetected}</div>
        <div style="font-size: 12px; opacity: 0.9;">${fileName}</div>
      </div>
    </div>
    
    <div style="background: rgba(238, 199, 199, 0.1); padding: 12px; border-radius: 8px; margin-bottom: 16px;">
      <div style="font-size: 13px; margin-bottom: 8px;">🚫 <strong>${browserSecurityRestriction}</strong></div>
      <div style="font-size: 12px; opacity: 0.9;">
        ${localFileSecurityMessage}
      </div>
    </div>
    
    <div style="font-size: 13px; margin-bottom: 16px;">
      <div style="font-weight: 600; margin-bottom: 8px;">💡 ${suggestedActions}</div>
      <div style="margin-left: 16px;">
        <div style="margin-bottom: 4px;">• ${uploadFileAction}</div>
      </div>
    </div>
    
    <div style="display: flex; gap: 12px; justify-content: flex-end;">
      <button id="dismissWarning" style="
        background: rgba(255,255,255,0.2);
        border: 1px solid rgba(255,255,255,0.3);
        color: white;
        padding: 8px 16px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 12px;
        transition: all 0.2s;
      ">${dismissWarning}</button>
    </div>
  `;
  
  // 添加 CSS 动画
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideInScale {
      from { 
        transform: translate(-50%, -50%) scale(0.8); 
        opacity: 0; 
      }
      to { 
        transform: translate(-50%, -50%) scale(1); 
        opacity: 1; 
      }
    }
    #dismissWarning:hover {
      background: rgba(255,255,255,0.3) !important;
      transform: translateY(-1px);
    }
  `;
  document.head.appendChild(style);
  
  document.body.appendChild(warning);
  
  // 点击关闭
  const dismissBtn = warning.querySelector('#dismissWarning');
  dismissBtn.addEventListener('click', () => {
    warning.style.animation = 'slideInScale 0.3s ease-out reverse';
    setTimeout(() => {
      if (warning.parentElement) {
        warning.remove();
        style.remove();
      }
    }, 300);
  });
  
  // 8秒后自动关闭
  setTimeout(() => {
    if (warning.parentElement) {
      dismissBtn.click();
    }
  }, 8000);
}

// 检测文本内容是否为本地文件路径（真正的路径，不是简单文件名）
function isLocalFile(text) {
  if (!text || typeof text !== 'string') {
    return false;
  }
  
  const firstLine = text.trim().split('\n')[0];
  
  // 排除URL（包含http/https协议的内容）
  if (firstLine.includes('http://') || firstLine.includes('https://')) {
    return false;
  }
  
  // 排除包含域名模式的内容（如www.xxx.com或domain.com）
  if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/i.test(firstLine) || /www\./i.test(firstLine)) {
    return false;
  }
  
  // 检测真正的文件路径模式（必须包含路径分隔符）
  const filePathPatterns = [
    // Windows 路径: C:\Users\... 或 D:\...
    /^[A-Za-z]:\\[^<>:"|?*\n]+\.[a-zA-Z0-9]+$/,
    // Unix/Linux/Mac 路径: /Users/... 或 ~/...
    /^[~\/][^<>:"|?*\n]*\.[a-zA-Z0-9]+$/,
    // UNC 路径: \\server\share\...
    /^\\\\[^<>:"|?*\n]+\\[^<>:"|?*\n]*\.[a-zA-Z0-9]+$/
  ];
  
  // 检查是否包含路径分隔符（真正的文件路径特征）
  const hasPathSeparator = firstLine.includes('/') || firstLine.includes('\\');
  const matchesPattern = filePathPatterns.some(pattern => pattern.test(firstLine));
  
  // 排除自动生成的文件名
  const isAutoGeneratedName = /^(clipboard|screenshot|download|image|file)-\d+\./i.test(firstLine);
  
  const isRealFilePath = (matchesPattern || hasPathSeparator) && !isAutoGeneratedName;
  
  if (isRealFilePath) {
    console.log('🎯 检测到真正的文件路径:', firstLine);
  }
  
  return isRealFilePath;
}

// 统一的文件粘贴处理函数
async function handleUnifiedFilePaste(event) {
  console.log('🎯 检测到粘贴事件，开始处理');
  
  try {
    // 1. 首先请求剪贴板权限
    const hasPermission = await requestClipboardPermission();
    if (!hasPermission) {
      console.log('❌ 无法访问剪贴板，权限不足，允许默认行为');
      return;
    }
    
    // 2. 检查剪贴板内容
    const clipboardData = await navigator.clipboard.read();
    console.log('剪贴板内容:', clipboardData);
    
    let hasImage = false;
    let hasText = false;
    
    for (const item of clipboardData) {
      console.log('剪贴板项目类型:', item.types);
      console.log('剪贴板项目详情:', item);
      
      // 检查是否有图片
      if (item.types.some(type => type.startsWith('image/'))) {
        hasImage = true;
        console.log('🎯 检测到图片内容');
      }
      
      // 检查是否有纯文字
      if (item.types.includes('text/plain')) {
        hasText = true;
        console.log('🎯 检测到纯文字内容');
      }
    }
    
    console.log('🎯 内容分析结果:', {
      hasText,
      hasImage
    });
    
    // 采用排除法：只允许纯文本和图片，其他都阻止
    // 1. 纯文字内容 - 直接粘贴（允许默认行为）
    if (hasText && !hasImage) {
      console.log('🎯 纯文字内容，允许默认粘贴行为');
      return;
    }
    
    // 2. 检测到图片 - 处理图片并阻止默认行为
    if (hasImage) {
      console.log('🎯 检测到图片，开始处理图片数据');
      
      for (const item of clipboardData) {
        if (item.types.some(type => type.startsWith('image/'))) {
          try {
            // 获取图片数据
            const imageType = item.types.find(type => type.startsWith('image/'));
            const imageData = await item.getType(imageType);
            
            console.log('🎯 图片数据获取成功:', {
              type: imageType,
              size: imageData.size
            });
            
            // 创建文件数据对象
            const fileObj = {
              name: `clipboard_image_${Date.now()}.${imageType.split('/')[1] || 'png'}`,
              type: imageType,
              size: imageData.size || 0,
              blob: imageData,
              data: imageData
            };
            
            // 发送到所有iframe
            await sendFileToAllIframes(fileObj);
            console.log('🎯 图片已发送到所有iframe');
            
          } catch (imageError) {
            console.log('🎯 处理图片失败:', imageError);
          }
        }
      }
      
      // 图片处理完成后，阻止默认粘贴行为
      console.log('🎯 图片处理完成，阻止默认粘贴行为');
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    
    // 3. 其他所有情况 - 直接阻止粘贴行为（排除法）
    console.log('🎯 非纯文本非图片内容，阻止粘贴行为');
    event.preventDefault();
    event.stopPropagation();
    return;
    
    // 默认情况：允许默认行为
    console.log('🎯 默认情况，允许粘贴行为');
    
  } catch (error) {
    console.error('🎯 粘贴处理出错:', error);
    // 出错时允许默认行为
  }
}

// 发送文件到所有iframe的简化函数
async function sendFileToAllIframes(fileObj) {
  const iframes = document.querySelectorAll('.ai-iframe');
  console.log(`🎯 开始向 ${iframes.length} 个iframe发送文件`);
  console.log('🎯 文件对象详情:', {
    name: fileObj.name,
    type: fileObj.type,
    size: fileObj.size
  });
  
  // 使用逐个处理的方式，确保每个iframe有足够时间处理
  await executeFileUploadSequentially(iframes, fileObj);
  
  console.log('🎯 所有iframe文件发送完成');
}

// 逐个执行文件上传的函数
async function executeFileUploadSequentially(iframes, fileData, fallbackMode = false) {
  const totalIframes = iframes.length;
  let successCount = 0;
  let failureCount = 0;
  
  console.log(`开始逐个执行文件粘贴，共 ${totalIframes} 个 iframe`);
  
  // 显示进度提示
  showFileUploadProgress(0, totalIframes, 'starting');
  
  for (let i = 0; i < iframes.length; i++) {
    const iframe = iframes[i];
    
    try {
      const domain = new URL(iframe.src).hostname;
      const siteName = iframe.getAttribute('data-site');
      
      console.log(`🎯 处理第 ${i + 1}/${totalIframes} 个 iframe: ${siteName} (${domain})`);
      
      // 更新进度提示
      showFileUploadProgress(i + 1, totalIframes, 'processing', siteName);
      
      // 给 iframe 一些时间来准备接收
      await new Promise(resolve => setTimeout(resolve, 200));
      
      if (fallbackMode) {
        // 降级模式：让 iframe 自己尝试读取剪贴板
        iframe.contentWindow.postMessage({
          type: 'TRIGGER_PASTE',
          domain: domain,
          source: 'iframe-parent',
          global: true,
          fallback: true,
          index: i + 1,
          total: totalIframes
        }, '*');
      } else {
        // 优先模式：使用站点特定的文件上传处理器
        iframe.contentWindow.postMessage({
          type: 'TRIGGER_PASTE',
          domain: domain,
          source: 'iframe-parent',
          global: true,
          fileData: fileData, // 传递文件数据供站点处理器使用
          useSiteHandler: true, // 标记使用站点处理器
          index: i + 1,
          total: totalIframes
        }, '*');
      }
      
      // 等待一段时间让 iframe 处理完成
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      successCount++;
      console.log(`✅ 第 ${i + 1} 个 iframe 处理完成`);
      
    } catch (error) {
      console.error(`❌ 第 ${i + 1} 个 iframe 处理失败:`, error);
      failureCount++;
    }
    
    // 在处理间隔中等待，避免权限冲突
    if (i < iframes.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
  
  console.log(`🎯 逐个文件粘贴执行完成: 成功 ${successCount}/${totalIframes}, 失败 ${failureCount}`);
  
  // 显示完成状态
  showFileUploadProgress(totalIframes, totalIframes, 'completed', null, { successCount, failureCount });
  
  // 3秒后隐藏进度提示
  setTimeout(() => {
    hideFileUploadProgress();
  }, 3000);
}

// 显示文件上传进度提示
function showFileUploadProgress(current, total, status, siteName = null, result = null) {
  let progressElement = document.getElementById('file-upload-progress');
  
  if (!progressElement) {
    progressElement = document.createElement('div');
    progressElement.id = 'file-upload-progress';
    progressElement.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 12px 16px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 10001;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      min-width: 200px;
      animation: slideInRight 0.3s ease-out;
    `;
    
    // 添加CSS动画
    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideInRight {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
    `;
    document.head.appendChild(style);
    
    document.body.appendChild(progressElement);
  }
  
  let message = '';
  let emoji = '';
  let fileInfo = '';
  
  if (currentUploadBatch) {
    const safeName = escapeHtml(currentUploadBatch.name);
    fileInfo = `<br><small style="opacity: 0.8;">文件: ${safeName} (${currentUploadBatch.index}/${currentUploadBatch.total})</small>`;
  }
  
  switch (status) {
    case 'starting':
      emoji = '🚀';
      message = '开始文件粘贴...';
      break;
    case 'processing':
      emoji = '⏳';
      message = `正在处理 ${current}/${total}`;
      if (siteName) {
        message += `<br><small style="opacity: 0.8;">${siteName}</small>`;
      }
      break;
    case 'completed':
      emoji = '✅';
      if (result) {
        if (result.failureCount === 0) {
          message = `文件粘贴完成<br><small>成功: ${result.successCount}/${total}</small>`;
        } else {
          message = `文件粘贴完成<br><small>成功: ${result.successCount}, 失败: ${result.failureCount}</small>`;
        }
      } else {
        message = '文件粘贴完成';
      }
      break;
  }
  
  message += fileInfo;
  
  progressElement.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px;">
      <span style="font-size: 16px;">${emoji}</span>
      <div>${message}</div>
    </div>
  `;
}

// 隐藏文件上传进度提示
function hideFileUploadProgress() {
  const progressElement = document.getElementById('file-upload-progress');
  if (progressElement) {
    progressElement.style.animation = 'slideInRight 0.3s ease-out reverse';
    setTimeout(() => {
      if (progressElement.parentElement) {
        progressElement.remove();
      }
    }, 300);
  }
}

let currentColumnsValue = '3';
let navColumnOutsideClickBound = false;
let requestedIframeSiteType = '';
let iframeConfiguredTypes = ['information'];
let ensureIframePromptTemplatesPromise = null;
const DEFAULT_IFRAME_SITE_TYPE = 'information';
const IFRAME_SITE_TYPE_ALIASES = {
  chat: 'information',
  agent: 'agents',
  translation: 'translate'
};

function normalizeSiteTypeToken(rawValue) {
  const normalized = String(rawValue || '').trim().toLowerCase();
  if (!normalized) return '';
  return IFRAME_SITE_TYPE_ALIASES[normalized] || normalized;
}

function normalizeSiteCategory(site) {
  return normalizeSiteTypeToken(site?.category || site?.type);
}

function getRequestedIframeSiteType() {
  if (requestedIframeSiteType) {
    return requestedIframeSiteType;
  }
  try {
    const urlParams = new URLSearchParams(window.location.search);
    requestedIframeSiteType = normalizeSiteTypeToken(urlParams.get('type')) || DEFAULT_IFRAME_SITE_TYPE;
  } catch (_) {
    requestedIframeSiteType = DEFAULT_IFRAME_SITE_TYPE;
  }
  return requestedIframeSiteType;
}

async function loadIframeConfiguredTypes() {
  try {
    const configuredTypes = await window.AppConfigManager.getSiteTypes();
    iframeConfiguredTypes = window.PromptTemplateUtils?.normalizePromptTemplateTypes?.(configuredTypes) || ['information'];
  } catch (_) {
    iframeConfiguredTypes = ['information'];
  }
  return iframeConfiguredTypes;
}

async function ensureIframePromptTemplates() {
  if (ensureIframePromptTemplatesPromise) {
    return ensureIframePromptTemplatesPromise;
  }

  ensureIframePromptTemplatesPromise = chrome.runtime.sendMessage({
    action: 'initializeDefaultTemplates'
  }).catch(error => {
    console.warn('iframe 补齐默认提示词模板失败:', error);
  });

  return ensureIframePromptTemplatesPromise;
}

function getIframePromptTemplateType() {
  return window.PromptTemplateUtils?.normalizePromptTemplateType?.(
    getRequestedIframeSiteType(),
    DEFAULT_IFRAME_SITE_TYPE,
    iframeConfiguredTypes
  )
    || DEFAULT_IFRAME_SITE_TYPE;
}

function siteMatchesRequestedType(site) {
  const requestedType = getRequestedIframeSiteType();
  if (!requestedType) {
    return true;
  }
  return normalizeSiteCategory(site) === requestedType;
}

function getFilteredNavSites(sites = []) {
  return (sites || []).filter(siteMatchesRequestedType);
}

function getDefaultOpenIframeSites(sites = []) {
  return sortSitesFavoriteFirst(
    (sites || [])
      .filter(site => site && site.enabled === true)
      .filter(site => !site.hidden)
      .filter(siteMatchesRequestedType)
  );
}

function getInitialIframeSites(sites = [], selectedSiteNames = null) {
  if (Array.isArray(selectedSiteNames) && selectedSiteNames.length > 0) {
    return sortSitesFavoriteFirst(
      (sites || []).filter(site =>
        selectedSiteNames.includes(site.name) &&
        !site.hidden &&
        siteMatchesRequestedType(site)
      )
    );
  }

  return getDefaultOpenIframeSites(sites);
}

function getColumnSvgTemplate(columns) {
  const svgTemplates = {
    '1': `<rect x="6" y="3" width="8" height="14" rx="1" stroke="currentColor" stroke-width="2" fill="none"/>`,
    '2': `<rect x="2" y="3" width="6" height="14" rx="1" stroke="currentColor" stroke-width="2" fill="none"/>
          <rect x="12" y="3" width="6" height="14" rx="1" stroke="currentColor" stroke-width="2" fill="none"/>`,
    '3': `<rect x="1" y="3" width="4" height="14" rx="1" stroke="currentColor" stroke-width="2" fill="none"/>
          <rect x="8" y="3" width="4" height="14" rx="1" stroke="currentColor" stroke-width="2" fill="none"/>
          <rect x="15" y="3" width="4" height="14" rx="1" stroke="currentColor" stroke-width="2" fill="none"/>`,
    '4': `<rect x="1" y="3" width="3" height="14" rx="1" stroke="currentColor" stroke-width="1.8" fill="none"/>
          <rect x="6" y="3" width="3" height="14" rx="1" stroke="currentColor" stroke-width="1.8" fill="none"/>
          <rect x="11" y="3" width="3" height="14" rx="1" stroke="currentColor" stroke-width="1.8" fill="none"/>
          <rect x="16" y="3" width="3" height="14" rx="1" stroke="currentColor" stroke-width="1.8" fill="none"/>`
  };
  return svgTemplates[String(columns)] || svgTemplates['3'];
}

function setColumnCurrentButtonIcon(button, columns) {
  if (!button) return;
  let svg = button.querySelector('svg');
  if (!svg) {
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '20');
    svg.setAttribute('viewBox', '0 0 20 20');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.style.display = 'block';
    button.innerHTML = '';
    button.appendChild(svg);
  }
  svg.innerHTML = getColumnSvgTemplate(columns);
}

function getColumnOptionButtons() {
  return document.querySelectorAll('.column-option-btn');
}

function toggleNavColumnDropdown() {
  const navDropdown = document.getElementById('navColumnDropdown');
  if (!navDropdown) return;
  const isOpen = navDropdown.classList.contains('show');
  if (isOpen) {
    closeNavColumnDropdown();
  } else {
    openNavColumnDropdown();
  }
}

function openNavColumnDropdown() {
  const navDropdown = document.getElementById('navColumnDropdown');
  if (navDropdown) {
    navDropdown.classList.add('show');
  }
}

function closeNavColumnDropdown() {
  const navDropdown = document.getElementById('navColumnDropdown');
  if (navDropdown) {
    navDropdown.classList.remove('show');
  }
}

// 选择列数选项
function selectColumnOption(columns) {
    const normalizedColumns = String(columns);
    // 更新激活状态
    setActiveColumnOption(normalizedColumns);
    
    // 更新当前显示
    updateCurrentDisplay(normalizedColumns);
    
    // 更新布局
    updateColumns(normalizedColumns);
    
    // 保存到存储
    chrome.storage.sync.set({ 'preferredColumns': normalizedColumns });
    
    // 关闭 nav 下拉菜单
    closeNavColumnDropdown();
}

// 设置激活的列数选项
function setActiveColumnOption(columns) {
    const normalizedColumns = String(columns);
    const columnOptionBtns = getColumnOptionButtons();
    columnOptionBtns.forEach(btn => {
        btn.classList.remove('active');
        if (btn.getAttribute('data-columns') === normalizedColumns) {
            btn.classList.add('active');
        }
    });
}

// 更新当前显示的图标
function updateCurrentDisplay(columns) {
    const normalizedColumns = String(columns);
    const navBtn = document.getElementById('navColumnCurrentBtn');
    setColumnCurrentButtonIcon(navBtn, normalizedColumns);
}

// 更新列数的辅助函数
function updateColumns(columns) {
    currentColumnsValue = String(columns);
    const iframesContainer = document.getElementById('iframes-container');
    if (iframesContainer) {
      iframesContainer.dataset.columns = currentColumnsValue;
    }
    document.documentElement.style.setProperty('--columns', currentColumnsValue);
}

function getNavColumnControlsMarkup(columns = '3') {
  const c = String(columns);
  const columnsTitle = chrome?.i18n?.getMessage?.('columnsTitle') || '列数';
  const title1 = chrome?.i18n?.getMessage?.('column1') || '1列';
  const title2 = chrome?.i18n?.getMessage?.('column2') || '2列';
  const title3 = chrome?.i18n?.getMessage?.('column3') || '3列';
  const title4 = chrome?.i18n?.getMessage?.('column4') || '4列';
  return `
    <div class="column-selector nav-column-selector">
      <div class="column-current nav-column-current">
        <button class="column-current-btn nav-column-current-btn" id="navColumnCurrentBtn" type="button" title="${columnsTitle}">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" style="display: block;">
            ${getColumnSvgTemplate(c)}
          </svg>
        </button>
      </div>
      <div class="column-dropdown nav-column-dropdown" id="navColumnDropdown">
        <div class="column-options">
          <button class="column-option-btn nav-column-option-btn" type="button" data-columns="1" title="${title1}">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" style="display: block;">
              ${getColumnSvgTemplate('1')}
            </svg>
          </button>
          <button class="column-option-btn nav-column-option-btn" type="button" data-columns="2" title="${title2}">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" style="display: block;">
              ${getColumnSvgTemplate('2')}
            </svg>
          </button>
          <button class="column-option-btn nav-column-option-btn" type="button" data-columns="3" title="${title3}">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" style="display: block;">
              ${getColumnSvgTemplate('3')}
            </svg>
          </button>
          <button class="column-option-btn nav-column-option-btn" type="button" data-columns="4" title="${title4}">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" style="display: block;">
              ${getColumnSvgTemplate('4')}
            </svg>
          </button>
        </div>
      </div>
    </div>
  `;
}

function initNavColumnControls() {
  const navCurrentBtn = document.getElementById('navColumnCurrentBtn');
  const navDropdown = document.getElementById('navColumnDropdown');
  if (!navCurrentBtn || !navDropdown) return;

  if (navCurrentBtn.dataset.bound !== '1') {
    navCurrentBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleNavColumnDropdown();
    });
    navCurrentBtn.dataset.bound = '1';
  }

  const navOptionBtns = navDropdown.querySelectorAll('.nav-column-option-btn');
  navOptionBtns.forEach((btn) => {
    if (btn.dataset.bound === '1') return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const columns = e.currentTarget.getAttribute('data-columns');
      selectColumnOption(columns);
    });
    btn.dataset.bound = '1';
  });

  if (!navColumnOutsideClickBound) {
    document.addEventListener('click', (e) => {
      const currentBtn = document.getElementById('navColumnCurrentBtn');
      const dropdown = document.getElementById('navColumnDropdown');
      if (!currentBtn || !dropdown) return;
      if (!dropdown.contains(e.target) && !currentBtn.contains(e.target)) {
        closeNavColumnDropdown();
      }
    });
    navColumnOutsideClickBound = true;
  }
}

const NAV_EDGE_TRIGGER_ID = 'navEdgeTrigger';
const NAV_HIDE_DELAY_MS = 120;
let navHideTimer = null;
let navAvailableSitesCache = [];

function clearNavHideTimer() {
  if (navHideTimer !== null) {
    clearTimeout(navHideTimer);
    navHideTimer = null;
  }
}

function showSideNav() {
  clearNavHideTimer();
  const nav = document.querySelector('.nav');
  if (nav) {
    nav.classList.add('is-visible');
  }
}

function hideSideNav() {
  clearNavHideTimer();
  const nav = document.querySelector('.nav');
  if (nav) {
    nav.classList.remove('is-visible');
  }
}

function scheduleHideSideNav() {
  clearNavHideTimer();
  navHideTimer = setTimeout(() => {
    hideSideNav();
  }, NAV_HIDE_DELAY_MS);
}

function deriveIconFileNameFromSite(site) {
  try {
    const hostname = new URL(site.url).hostname.toLowerCase();
    return hostname.replace(/[^a-z0-9.-]/g, '_') + '.png';
  } catch (_) {
    return 'icon16.png';
  }
}

function getSiteIconPath(site) {
  if (site && typeof site.icon === 'string' && site.icon.trim()) {
    return `../siteIcons/${site.icon.trim()}`;
  }
  return `../siteIcons/${deriveIconFileNameFromSite(site)}`;
}

function getOpenedSiteSet() {
  return new Set(getOpenedSites());
}

async function getAvailableIframeSites() {
  try {
    const sites = await getDefaultSites();
    const availableSites = (sites || [])
      .filter(site => !site.hidden)
      .filter(siteMatchesRequestedType);
    navAvailableSitesCache = sortSitesFavoriteFirst(availableSites);
  } catch (error) {
    console.error('获取可用站点失败:', error);
    navAvailableSitesCache = [];
  }
  return navAvailableSitesCache;
}

function getSiteFromAvailableCache(siteName) {
  return navAvailableSitesCache.find(site => site.name === siteName) || null;
}

async function resolveAvailableSite(siteName) {
  if (!siteName) return null;
  let site = getSiteFromAvailableCache(siteName);
  if (site) return site;
  const sites = await getAvailableIframeSites();
  site = sites.find(item => item.name === siteName);
  return site || null;
}

function getCurrentQueryText() {
  const searchInput = document.getElementById('searchInput');
  return searchInput ? searchInput.value.trim() : '';
}

function buildSiteUrlForQuery(site, query) {
  if (!site) return '';
  if (site.customSite === true || site.isCustomSite === true) {
    return SiteLaunchUtils.resolveCustomLaunchTarget
      ? SiteLaunchUtils.resolveCustomLaunchTarget(site, query).url
      : (site.url || '');
  }

  return SiteLaunchUtils.resolveOfficialLaunchTarget
    ? SiteLaunchUtils.resolveOfficialLaunchTarget(site, query).url
    : (site.url || '');
}

async function ensureSiteIframeByName(siteName) {
  if (!siteName) return false;
  const existingIframe = Array.from(document.querySelectorAll('.ai-iframe'))
    .find(iframe => iframe.getAttribute('data-site') === siteName);
  if (existingIframe) return true;

  const site = await resolveAvailableSite(siteName);
  if (!site) {
    console.warn('未找到可用站点配置:', siteName);
    return false;
  }

  const container = document.getElementById('iframes-container');
  if (!container) {
    console.error('未找到 iframes 容器');
    return false;
  }

  const query = getCurrentQueryText();
  const iframeUrl = buildSiteUrlForQuery(site, query);
  createSingleIframe(site.name, iframeUrl, container, query, null);
  return true;
}

function removeSiteIframeByName(siteName) {
  if (!siteName) return false;
  const targetIframe = Array.from(document.querySelectorAll('.ai-iframe'))
    .find(iframe => iframe.getAttribute('data-site') === siteName);
  if (!targetIframe) return false;
  const iframeContainer = targetIframe.closest('.iframe-container');
  if (!iframeContainer) return false;
  iframeContainer.remove();
  clearTimelineSnapshotForSite(siteName);
  return true;
}

function syncNavCheckboxStates() {
  const openedSet = getOpenedSiteSet();
  const checkboxes = document.querySelectorAll('.nav-site-checkbox');
  checkboxes.forEach(checkbox => {
    const siteName = checkbox.dataset.siteName;
    checkbox.checked = openedSet.has(siteName);
  });
}

function getIframeContainerBySiteName(siteName, container = document.getElementById('iframes-container')) {
  if (!container || !siteName) return null;
  const targetIframe = Array.from(container.querySelectorAll('.ai-iframe'))
    .find(iframe => iframe.getAttribute('data-site') === siteName);
  return targetIframe ? targetIframe.closest('.iframe-container') : null;
}

function setActiveNavItem(activeNavItem) {
  if (!activeNavItem) return;
  const navList = activeNavItem.closest('.nav-list');
  if (!navList) return;
  navList.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
  activeNavItem.classList.add('active');
}

function createNavItemElement(site, container = document.getElementById('iframes-container')) {
  const siteName = site.name;
  const navItem = document.createElement('li');
  navItem.className = 'nav-item nav-site-item';
  navItem.dataset.siteName = siteName;

  const row = document.createElement('div');
  row.className = 'nav-site-row';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'nav-site-checkbox';
  checkbox.dataset.siteName = siteName;
  checkbox.checked = getOpenedSiteSet().has(siteName);

  const iconBtn = document.createElement('button');
  iconBtn.type = 'button';
  iconBtn.className = 'nav-site-icon-btn';
  iconBtn.title = siteName;
  iconBtn.setAttribute('aria-label', siteName);

  const iconImage = document.createElement('img');
  iconImage.className = 'nav-site-icon';
  iconImage.src = getSiteIconPath(site);
  iconImage.alt = siteName;
  iconImage.loading = 'lazy';
  iconImage.addEventListener('error', () => {
    if (!iconImage.dataset.fallback) {
      iconImage.dataset.fallback = '1';
      iconImage.src = '../icons/icon16.png';
    }
  });
  iconBtn.appendChild(iconImage);

  row.appendChild(checkbox);
  row.appendChild(iconBtn);
  navItem.appendChild(row);

  checkbox.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  checkbox.addEventListener('change', async (e) => {
    const targetCheckbox = e.currentTarget;
    const targetSiteName = targetCheckbox.dataset.siteName;
    targetCheckbox.disabled = true;
    try {
      if (targetCheckbox.checked) {
        await ensureSiteIframeByName(targetSiteName);
      } else {
        removeSiteIframeByName(targetSiteName);
      }
    } catch (error) {
      console.error('切换导航站点失败:', error);
    } finally {
      targetCheckbox.disabled = false;
      syncNavCheckboxStates();
    }
  });

  iconBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!checkbox.checked) return;
    setActiveNavItem(navItem);
    const iframeContainer = getIframeContainerBySiteName(siteName, container);
    if (iframeContainer) {
      iframeContainer.scrollIntoView({ behavior: 'smooth' });
    }
  });

  return navItem;
}

function removeNavItemBySiteName(siteName) {
  if (!siteName) return;
  syncNavCheckboxStates();
}

function ensureSideNavShell() {
  const container = document.getElementById('iframes-container');
  if (!container) return { nav: null, navList: null };

  let nav = document.querySelector('.nav');
  if (!nav) {
    nav = document.createElement('nav');
    nav.className = 'nav';
    document.body.insertBefore(nav, container);
  }

  let trigger = document.getElementById(NAV_EDGE_TRIGGER_ID);
  if (!trigger) {
    trigger = document.createElement('div');
    trigger.id = NAV_EDGE_TRIGGER_ID;
    trigger.className = 'nav-edge-trigger';
    document.body.appendChild(trigger);
  }

  if (trigger.dataset.bound !== '1') {
    trigger.addEventListener('mouseenter', showSideNav);
    trigger.addEventListener('mouseleave', scheduleHideSideNav);
    trigger.dataset.bound = '1';
  }

  if (nav.dataset.bound !== '1') {
    nav.addEventListener('mouseenter', showSideNav);
    nav.addEventListener('mouseleave', scheduleHideSideNav);
    nav.dataset.bound = '1';
  }

  let navControls = nav.querySelector('.nav-controls');
  if (!navControls) {
    navControls = document.createElement('div');
    navControls.className = 'nav-controls';
    nav.appendChild(navControls);
  }

  let navList = nav.querySelector('.nav-list');
  if (!navList) {
    navList = document.createElement('ul');
    navList.className = 'nav-list';
    nav.appendChild(navList);
  }

  return { nav, navList };
}

async function renderSideNav() {
  const { nav } = ensureSideNavShell();
  if (!nav) return;

  const sites = await getAvailableIframeSites();

  const navControls = nav.querySelector('.nav-controls');
  if (navControls) {
    navControls.innerHTML = getNavColumnControlsMarkup(currentColumnsValue);
  }

  initNavColumnControls();
  setActiveColumnOption(currentColumnsValue);
  updateCurrentDisplay(currentColumnsValue);

  const container = document.getElementById('iframes-container');
  const existingNavList = nav.querySelector('.nav-list');
  if (existingNavList) {
    existingNavList.remove();
  }

  const navList = document.createElement('ul');
  navList.className = 'nav-list';
  nav.appendChild(navList);

  const normalizedSites = (sites || [])
    .map(site => typeof site === 'string' ? { name: site } : site)
    .filter(site => site && site.name);

  normalizedSites.forEach((site, index) => {
    const navItem = createNavItemElement(site, container);
    navItem.dataset.originalIndex = String(index);
    navList.appendChild(navItem);
  });

  // 默认隐藏，鼠标移动到左侧热区再显示
  hideSideNav();

  // 根据当前实际 iframe 状态同步勾选
  syncNavCheckboxStates();
}

// 监听来自 background 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('iframe.js 收到消息:', message);
  if (message.type === 'loadIframes') {
    console.log('开始加载 iframes, 查询词:', message.query);
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
      searchInput.value = message.query;
      updateFavoriteButtonVisibility(message.query);
    }
    createIframes(message.query, message.sites, message.customSites || []);
  } else if (message.type === 'loadHistoryIframes') {
    console.log('开始加载历史记录 iframes:', message.sites);
    // 设置当前历史记录 ID（如果提供了）
    if (message.historyId) {
      window._currentHistoryId = message.historyId;
      console.log('设置当前历史记录 ID:', message.historyId);
    }
    Promise.resolve()
      .then(async () => {
        const restoreContext = message.historyId
          ? await getHistoryRestoreContext(message.historyId)
          : null;
        await loadHistoryIframes(message.sites, restoreContext);
      })
      .catch((error) => {
        console.error('恢复历史记录 iframe 失败:', error);
      });
  }
});

// 处理 iframe 的创建和加载
async function createIframes(query, sites, customSites = []) {
  const enabledSites = Array.isArray(sites) ? sites : [];
  const normalizedCustomSites = SiteLaunchUtils.normalizeCustomSites
    ? SiteLaunchUtils.normalizeCustomSites(customSites)
    : [];
    
  console.log('过滤后的官方站点:', enabledSites);
  console.log('过滤后的 customSites:', normalizedCustomSites);
    
    // 获取容器元素
  const container = document.getElementById('iframes-container');
  if (!container) {
    console.error('未找到 iframes 容器');
    return;
  }

  const hasQuery = query && query.trim() !== '';
  const ratingBatchId = hasQuery ? await startRatingPromptBatch(enabledSites.length) : null;
  
  // 保持原有的grid布局，但确保支持order属性
  // 不覆盖CSS中定义的display: grid
    
  try {
    if (query) {
      resetTimelinePromptSnapshots();
      // 如果有查询词,清空容器内容
      container.innerHTML = '';
      console.log("清空iframe")

    } 
    // 调整主容器样式以适应导航栏
    // container.style.marginLeft = '72px';
    // 为每个启用的站点创建 iframe，传入 query 参数
    enabledSites.forEach(site => {
      const launchTarget = SiteLaunchUtils.resolveOfficialLaunchTarget
        ? SiteLaunchUtils.resolveOfficialLaunchTarget(site, query)
        : {
            url: site.url,
            queryInUrl: Boolean(query) && site.supportUrlQuery === true,
            shouldAutoRun: Boolean(query) && site.supportUrlQuery !== true
          };
      const url = launchTarget.url || site.url;
        
      console.log("即将开始调用创建单个 iframe", site.name, url);
      createSingleIframe(site.name, url, container, query, ratingBatchId, {
        site,
        siteKind: 'official',
        launchTarget
      });
    });

    normalizedCustomSites.forEach(site => {
      const launchTarget = SiteLaunchUtils.resolveCustomLaunchTarget
        ? SiteLaunchUtils.resolveCustomLaunchTarget(site, query)
        : {
            url: site.url,
            queryInUrl: false,
            shouldAutoRun: false
          };
      const url = launchTarget.url || site.url;

      console.log('即将开始调用创建 custom iframe', site.name, url);
      createSingleIframe(site.name, url, container, query, ratingBatchId, {
        site,
        siteKind: 'custom',
        launchTarget
      });
    });
  } catch (error) {
    console.error('创建 iframes 失败:', error);
  }

  await renderSideNav();
 
  
  // 创建导航栏
  // const nav = document.createElement('nav');
  // nav.className = 'nav';

  // // 创建导航列表
  // const navList = document.createElement('ul');
  // navList.className = 'nav-list';

  // // 为每个站点创建导航项
  // enabledSites.forEach((site, index) => {
  //   const navItem = document.createElement('li');
  //   navItem.className = 'nav-item';
  //   navItem.textContent = site.name;
  //   navItem.draggable = true;
  //   navItem.dataset.siteName = site.name;
  //   navItem.dataset.originalIndex = index;
  //   
  //   // 监听页面滚动事件
  //   window.addEventListener('scroll', () => {
  //     // 获取所有 iframe 容器
  //     const iframes = container.querySelectorAll('.iframe-container');
  //     // 获取所有导航项
  //     const navItems = navList.querySelectorAll('li');
  //     
  //     // 遍历所有 iframe 检查哪个在视口中
  //     iframes.forEach((iframe, idx) => {
  //       const rect = iframe.getBoundingClientRect();
  //       // 如果 iframe 在视口中(考虑到导航栏高度60px的偏移)
  //       if (rect.top <= window.innerHeight / 2) {
  //         // 移除所有激活状态
  //         navItems.forEach(item => {
  //           item.style.backgroundColor = '';
  //           item.classList.remove('active');
  //         });
  //         
  //         // 激活对应的导航项
  //         navItems[idx].style.backgroundColor = '#e0e0e0';
  //         navItems[idx].classList.add('active');
  //       }
  //     });
  //   });

  //   // 点击导航项时滚动到对应的iframe
  //   navItem.addEventListener('click', () => {
  //     // 移除所有激活状态
  //     navList.querySelectorAll('li').forEach(item => {
  //       item.style.backgroundColor = '';
  //       item.classList.remove('active');
  //     });
  //     
  //     // 激活当前点击项
  //     navItem.style.backgroundColor = '#e0e0e0';
  //     navItem.classList.add('active');
  //     
  //     // 滚动到对应的iframe
  //     const iframes = container.querySelectorAll('.iframe-container');
  //     if(iframes[index]) {
  //       iframes[index].scrollIntoView({ behavior: 'smooth' });
  //     }
  //   });
  //   
  //   navList.appendChild(navItem);
  // });

  // // 添加拖拽排序功能
  // addDragAndDropToNavList(navList, enabledSites);

  // nav.appendChild(navList);
  // document.body.insertBefore(nav, container);

  // 如果有查询词，保存历史记录（只保存 ID 和 query，URL 由各 iframe 内部脚本检测后更新）
  // 如果是从历史/收藏页打开的，跳过保存（避免重复创建记录）
  if (query && query.trim() !== '' && !window._openedFromHistory) {
    // 立即保存历史记录，不等待 iframe 加载
    await savePKHistory(query);
  }

  // 首页/直达页带着 query 进来后，站点已开始自动发送；发送链路启动后即可清空顶部输入框，
  // 方便用户直接输入下一轮问题。
  if (query && query.trim() !== '' && !window._openedFromHistory) {
    clearIframeSearchInput();
    armSearchBarAutoCollapse();
  }
}


// 获取 iframe 的最新 URL
// @param {HTMLIFrameElement} iframe - iframe 元素
// @param {string} siteName - 站点名称
// @param {string|null} historyId - 可选的历史记录 ID，如果提供则从历史记录中查找
// @returns {Promise<string|null>} - 返回最新的 URL，如果无法获取则返回 null
async function getIframeLatestUrl(iframe, siteName, historyId = null) {
  try {
    // 方法1: 尝试从 iframe.contentWindow.location.href 获取（如果同源）
    try {
      const currentUrl = iframe.contentWindow.location.href;
      if (currentUrl && currentUrl !== 'about:blank' && !SiteLaunchUtils.isLikelyPlaceholderHistoryUrl?.(currentUrl, siteName)) {
        console.log(`从 iframe.contentWindow 获取 ${siteName} 的 URL:`, currentUrl);
        return currentUrl;
      }
    } catch (e) {
      // 跨域限制，无法直接访问
      console.log(`无法直接访问 ${siteName} iframe 的 location（可能跨域）`);
    }
    
    // 方法2: 尝试通过 postMessage 从 iframe 内部获取实际 URL
    try {
      const urlFromMessage = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          window.removeEventListener('message', messageHandler);
          reject(new Error('获取 URL 超时'));
        }, 1000); // 1秒超时
        
        const messageHandler = (event) => {
          // 确保消息来自目标 iframe
          if (event.source === iframe.contentWindow && 
              event.data.type === 'GET_CURRENT_URL_RESPONSE' &&
              event.data.siteName === siteName) {
            clearTimeout(timeout);
            window.removeEventListener('message', messageHandler);
            resolve(event.data.url);
          }
        };
        
        window.addEventListener('message', messageHandler);
        
        // 发送请求到 iframe
        try {
          iframe.contentWindow.postMessage({
            type: 'GET_CURRENT_URL',
            siteName: siteName
          }, '*');
        } catch (postError) {
          clearTimeout(timeout);
          window.removeEventListener('message', messageHandler);
          reject(postError);
        }
      });
      
      if (urlFromMessage && urlFromMessage !== 'about:blank' && !SiteLaunchUtils.isLikelyPlaceholderHistoryUrl?.(urlFromMessage, siteName)) {
        console.log(`通过 postMessage 获取 ${siteName} 的 URL:`, urlFromMessage);
        return urlFromMessage;
      }
    } catch (e) {
      console.log(`无法通过 postMessage 获取 ${siteName} 的 URL:`, e.message);
    }
    
    // 方法3: 从历史记录中获取该站点的最新 URL（如果提供了 historyId 或存在当前历史记录 ID）
    const targetHistoryId = historyId || window._currentHistoryId;
    if (targetHistoryId) {
      const { pkHistory = [] } = await chrome.storage.local.get('pkHistory');
      const historyItem = pkHistory.find(item => item.id === targetHistoryId);
      if (historyItem && historyItem.sites) {
        const siteItem = historyItem.sites.find(s => s.name === siteName);
        if (siteItem && siteItem.url && !SiteLaunchUtils.isLikelyPlaceholderHistoryUrl?.(siteItem.url, siteName)) {
          console.log(`从历史记录获取 ${siteName} 的 URL:`, siteItem.url);
          return siteItem.url;
        }
      }
    }
    
    // 方法4: 使用 iframe.src 作为后备
    const srcUrl = iframe.src;
    if (srcUrl && srcUrl !== 'about:blank' && !SiteLaunchUtils.isLikelyPlaceholderHistoryUrl?.(srcUrl, siteName)) {
      console.log(`使用 iframe.src 作为 ${siteName} 的 URL:`, srcUrl);
      return srcUrl;
    }
    
    console.warn(`无法获取 ${siteName} 的 URL`);
    return null;
  } catch (error) {
    console.error(`获取 ${siteName} 的 URL 失败:`, error);
    // 出错时返回 iframe.src 作为后备
    return iframe.src || null;
  }
}

// 创建单个 iframe 时添加标识
function createSingleIframe(siteName, url, container, query, ratingBatchId, launchInfo = {}) {
  const iframeContainer = document.createElement('div');
  iframeContainer.className = 'iframe-container';
  iframeContainer.dataset.siteName = siteName;
  iframeContainer.dataset.lastQuery = query || '';
  const isCustomSite = launchInfo.siteKind === 'custom' || launchInfo.isCustomSite === true;
  if (isCustomSite) {
    iframeContainer.dataset.customSite = 'true';
  }
  setIframeHeaderStatus(iframeContainer, t('iframeStatusNetworkLoading', '网络加载中...'));
  
  // iframe容器不需要特殊的布局设置，CSS Grid会自动处理
  
  const iframe = document.createElement('iframe');
  iframe.className = 'ai-iframe';
  iframe.setAttribute('data-site', siteName);
  if (isCustomSite) {
    iframe.dataset.customSite = 'true';
  }
  if (ratingBatchId) {
    iframe.dataset.ratingBatchId = String(ratingBatchId);
  }
  
  // 临时移除 sandbox 属性以测试剪贴板权限
  // iframe.sandbox = 'allow-same-origin allow-scripts allow-popups allow-forms allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation';
  
  iframe.allow = IFRAME_ALLOW_PERMISSIONS;
  
  // 记录是否已经处理过点击事件
  let clickHandlerAdded = false;
  
  iframe.addEventListener('load', () => {
    const currentInputQuery = document.getElementById('searchInput')?.value || '';
    const launchTarget = launchInfo.launchTarget || null;
    const loadBehavior = getIframeLoadBehavior({
      initialQuery: query,
      lastQuery: iframeContainer.dataset.lastQuery,
      currentInputQuery,
      supportUrlQuery: isCustomSite ? true : Boolean(launchTarget?.queryInUrl),
      queryInUrl: isCustomSite ? true : Boolean(launchTarget?.queryInUrl),
      clickHandlerAdded
    });
    setIframeHeaderStatus(iframeContainer, t('iframeStatusPageLoaded', '页面已加载'));

    if (loadBehavior.shouldBindClickHandler) {
      try {
        // 添加点击事件监听器
        iframe.contentWindow.addEventListener('click', (e) => {
          const link = e.target.closest('a');
          if (link && link.href) {
            e.preventDefault();
            window.open(link.href, '_blank');
             console.log("iframe 内点击事件处理成功")
          }
        });

        clickHandlerAdded = true;
      } catch (error) {
        console.log('无法直接添加监听器，将通过 inject.js 处理');
        
        // 只在未添加处理器时注入
        if (!clickHandlerAdded) {
          iframe.contentWindow.postMessage({
            type: 'INJECT_CLICK_HANDLER',
            source: 'iframe-parent'
          }, '*');
          clickHandlerAdded = true;
        }
      }
    }
    
    // 处理查询内容（如果有的话）
    const latestQuery = loadBehavior.resolvedQuery;
    iframeContainer.dataset.lastQuery = latestQuery;

    if (latestQuery) {
      console.log("iframe onload 加载完成，查询内容:", latestQuery);
      if (loadBehavior.shouldAutoRunQuery) {
        setIframeHeaderStatus(iframeContainer, t('iframeStatusPreparingScript', '准备执行脚本...'));
      }
      
      // 使用异步函数处理
      (async () => {
        const sites = await window.getDefaultSites();
        const site = sites.find(s => s.name === siteName) || sites.find(s => s.url === url || url.startsWith(s.url));
        const shouldAutoRunQuery = site ? getIframeLoadBehavior({
          initialQuery: query,
          lastQuery: latestQuery,
          currentInputQuery,
          supportUrlQuery: isCustomSite ? true : Boolean(launchTarget?.queryInUrl),
          queryInUrl: isCustomSite ? true : Boolean(launchTarget?.queryInUrl),
          clickHandlerAdded
        }).shouldAutoRunQuery : false;

        if (shouldAutoRunQuery && !isCustomSite) {
          // 使用动态处理函数
          const handler = await getIframeHandler(url, site.name);
          if (handler) {
            console.log('执行动态 iframe 处理函数:', site.name);
            await handler(iframe, latestQuery);
          } else {
            console.log('未找到对应的处理函数', site.name);
          }
        }
      })();
    }
    
    // 重新设置输入框焦点
    document.getElementById('searchInput').focus();

    handleIframeLoadedForRating(iframe);
    scheduleTimelineSync(900);
  });
  
  // 添加消息监听（确保只处理一次）
  const messageHandler = (event) => {
    if (event.data.type === 'LINK_CLICK' && event.data.href) {
      window.open(event.data.href, '_blank');
    }
    
    // 注入脚本执行进度
    if (event.data.type === 'INJECT_PROGRESS' && event.data.source === 'inject-script') {
      if (iframe.contentWindow && event.source === iframe.contentWindow) {
        if (!event.data.siteName || event.data.siteName === siteName) {
          const runtimeEntry = window.aiCompareSiteRuntime?.getSnapshot
            ? window.aiCompareSiteRuntime.getSnapshot([siteName]).bySite?.[siteName]
            : null;
          const runtimeSearchId = runtimeEntry?.searchId || '';
          const runtimeQuery = runtimeEntry?.query || (iframeContainer?.dataset.lastQuery || '').trim();

          if (window.aiCompareSiteRuntime?.updateSiteRuntime) {
            if (event.data.status === 'start' || event.data.status === 'step' || event.data.status === 'step_complete') {
              window.aiCompareSiteRuntime.updateSiteRuntime({
                siteName,
                searchId: runtimeSearchId,
                query: runtimeQuery,
                phase: 'script_start',
                url: iframe.src || '',
                final: false
              }, iframe);
            } else if (event.data.status === 'complete') {
              window.aiCompareSiteRuntime.updateSiteRuntime({
                siteName,
                searchId: runtimeSearchId,
                query: runtimeQuery,
                phase: 'submitted',
                url: iframe.src || '',
                final: false
              }, iframe);
              if (runtimeQuery) {
                try {
                  iframe.contentWindow?.postMessage({
                    type: 'SET_ACTIVE_SEARCH_CONTEXT',
                    siteName,
                    query: runtimeQuery,
                    searchId: runtimeSearchId || createSiteSearchId(siteName)
                  }, '*');
                } catch (error) {
                  console.warn('触发主动结果监控失败:', error);
                }
              }
            } else if (event.data.status === 'error') {
              window.aiCompareSiteRuntime.updateSiteRuntime({
                siteName,
                searchId: runtimeSearchId,
                query: runtimeQuery,
                phase: 'error',
                url: iframe.src || '',
                error: event.data.errorMessage || '',
                final: true
              }, iframe);
            }
          }

          if (event.data.status === 'start') {
            hideIframeHeaderStatus(iframeContainer);
          }
          setInjectProgressState(iframeContainer.querySelector('.inject-progress'), event.data);
          if (event.data.status === 'start' || event.data.status === 'step' || event.data.status === 'step_complete' || event.data.status === 'error') {
            const stepLabel = event.data.stepIndex && event.data.totalSteps
              ? `步骤 ${event.data.stepIndex}/${event.data.totalSteps}`
              : '步骤';
            const desc = event.data.description ? `：${event.data.description}` : '';
            console.log(`[inject-progress] ${siteName || ''} ${event.data.status} ${stepLabel}${desc}`);
          }
        }
      }
    }

    // 处理历史记录 URL 更新消息
    if (event.data.type === 'HISTORY_URL_UPDATE' && event.data.source === 'inject-script') {
      // 确保消息来自当前 iframe
      if (iframe.contentWindow && event.source === iframe.contentWindow) {
        const siteName = event.data.siteName;
        const url = event.data.url;
        const historyId = event.data.historyId || window._currentHistoryId;
        
        if (siteName && url && historyId) {
          console.log(`📝 收到 ${siteName} 的 URL 更新: ${url}，历史记录 ID: ${historyId}`);
          updateHistorySiteUrl(siteName, url, historyId);
          const runtimeEntry = window.aiCompareSiteRuntime?.getSnapshot
            ? window.aiCompareSiteRuntime.getSnapshot([siteName]).bySite?.[siteName]
            : null;
          if (window.aiCompareSiteRuntime?.updateSiteRuntime) {
            window.aiCompareSiteRuntime.updateSiteRuntime({
              siteName,
              searchId: runtimeEntry?.searchId || '',
              query: runtimeEntry?.query || (iframeContainer?.dataset.lastQuery || '').trim(),
              phase: runtimeEntry?.phase || 'submitted',
              content: runtimeEntry?.content || '',
              url,
              error: runtimeEntry?.error || '',
              final: runtimeEntry?.final === true
            }, iframe);
          }
        } else {
          console.warn('历史记录 URL 更新消息缺少必要参数:', { siteName, url, historyId });
        }
      }
    }
  };
  
  window.removeEventListener('message', messageHandler); // 移除可能存在的旧监听器
  window.addEventListener('message', messageHandler);
  
  // 合并和优化 iframe 加载事件处理
  iframe.addEventListener('load', () => {
    const searchInput = document.getElementById('searchInput');
    
    // 设置 iframe 为不可聚焦
    iframe.setAttribute('tabindex', '-1');
    
    // 防止 iframe 内容获取焦点
    try {
      const doc = iframe.contentDocument || iframe.contentWindow.document;
      doc.documentElement.setAttribute('tabindex', '-1');
      doc.body.setAttribute('tabindex', '-1');
      
      // 只监听焦点事件，保持搜索框焦点
      doc.addEventListener('focus', (e) => {
        e.preventDefault();
        e.stopPropagation();
        searchInput.focus();
      }, true);
    } catch (error) {
      console.log('无法直接访问 iframe 内容，将通过消息通信处理');
      iframe.contentWindow.postMessage({
        type: 'PREVENT_FOCUS',
        source: 'iframe-parent'
      }, '*');
    }
    
    // 确保搜索输入框保持焦点
    setTimeout(() => {
      searchInput.focus();
    }, 100);
  });

  // 在父页面级别阻止 iframe 获取焦点
  document.addEventListener('focusin', (e) => {
    if (e.target.tagName === 'IFRAME') {
      e.preventDefault();
      document.getElementById('searchInput').focus();
    }
  }, true);
  iframe.src = url;

  // 在 iframe 加载完成后，将页面滚动回顶部
  /*
  iframe.addEventListener('load', () => {
    window.scrollTo(0, 0);
  });*/
  
  // 创建 header
  const header = document.createElement('div');
  header.className = 'iframe-header';
  header.innerHTML = `
    <span class="site-name">${siteName}</span>
    <span class="iframe-header-status" aria-live="polite">${t('iframeStatusNetworkLoading', '网络加载中...')}</span>
    <div class="iframe-controls">
      <button class="refresh-page-btn"></button>
      <button class="open-page-btn"></button>
      <button class="close-btn"></button>
    </div>
  `;
  
  // 添加 Chrome 浏览器特征
  iframe.setAttribute('user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
  
  // 添加其他常见的 Chrome 浏览器头部信息
  iframe.setAttribute('accept-language', 'zh-CN,zh;q=0.9,en;q=0.8');
  iframe.setAttribute('sec-ch-ua', '"Chromium";v="122", "Google Chrome";v="122"');
  iframe.setAttribute('sec-ch-ua-mobile', '?0');
  iframe.setAttribute('sec-ch-ua-platform', '"Macintosh"');
  
  
  // 组装元素
  iframeContainer.appendChild(header);
  iframeContainer.appendChild(iframe);
  iframeContainer.appendChild(createInjectProgressOverlay(siteName));
  container.appendChild(iframeContainer);
  scheduleIframeHeaderStatus(iframeContainer, t('iframeStatusPageLoading', '页面加载中...'), 700);
  
  // 添加按钮事件处理
  const refreshPageBtn = header.querySelector('.refresh-page-btn');
  const openPageBtn = header.querySelector('.open-page-btn');
  const closeBtn = header.querySelector('.close-btn');
  
  // 设置按钮提示
  refreshPageBtn.title = chrome.i18n.getMessage('refresh') || '刷新';
  openPageBtn.title = chrome.i18n.getMessage('openInNewTab') || '在新标签页打开';
  closeBtn.title = chrome.i18n.getMessage('closeButton') || '关闭';

  // 刷新按钮点击事件
  refreshPageBtn.onclick = (e) => {
    e.stopPropagation();
    try {
      iframe.contentWindow?.location.reload();
    } catch (_) {
      iframe.src = iframe.src;
    }
  };
  
  // 打开页面按钮点击事件
  openPageBtn.onclick = async (e) => {
    e.stopPropagation();
    // 获取 iframe 的最新 URL，传递历史记录 ID（如果存在）
    const historyId = window._currentHistoryId || null;
    const iframeUrl = await getIframeLatestUrl(iframe, siteName, historyId);
    if (iframeUrl) {
      // 在新标签页打开
      chrome.tabs.create({ url: iframeUrl });
    } else {
      console.warn(`无法获取 ${siteName} 的 URL，尝试使用 iframe.src`);
      // 如果无法获取 URL，至少尝试使用 iframe.src
      if (iframe.src && iframe.src !== 'about:blank') {
        chrome.tabs.create({ url: iframe.src });
      }
    }
  };
  
  closeBtn.onclick = () => {
    // 1. 获取对应的 iframe
    iframeContainer.remove();
    // 在导航栏中找到对应的 nav-item 并删除
    removeNavItemBySiteName(siteName);
    clearTimelineSnapshotForSite(siteName);
    
  };

}

// 导出函数供其他文件使用
export { createIframes }; 


// 根据 URL 获取处理函数
function getHandlerForUrl(url) {
    try {
      // 确保 URL 是有效的
      if (!url) {
        console.error('URL 为空');
        return null;
      }
  
      // 如果 URL 不包含协议，添加 https://
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }
      console.log('处理URL:', url);
      const hostname = new URL(url).hostname;
      console.log('当前网站:', hostname);
      
      // 遍历所有处理函数，找到匹配的
      for (const [domain, handler] of Object.entries(siteHandlers)) {
        if (hostname.includes(domain)) {
          console.log('找到处理函数:', domain);
          console.log('处理函数:', handler);
          return handler;
        }
      }
      
      console.log('未找到对应的处理函数');
      return null;
    } catch (error) {
      console.error('URL 解析失败:', error, 'URL:', url);
      return null;
    }
  }

// 简化的 iframe 处理函数 - 只负责消息发送
async function getIframeHandler(iframeUrl, preferredSiteName = null) {
  try {
    // 解析 iframe URL 获取域名
    let domain;
    try {
      const urlObj = new URL(iframeUrl);
      domain = urlObj.hostname;
    } catch (e) {
      console.error('URL解析失败:', iframeUrl);
      return null;
    }
    
    // 使用 getDefaultSites 获取合并后的站点配置
    let sites = [];
    try {
      sites = await getDefaultSites();
    } catch (error) {
      console.error('获取站点配置失败:', error);
    }
    
    if (!sites || sites.length === 0) {
      console.warn('没有找到站点配置');
      return null;
    }

    const matchedSite = resolveSiteForIframeUrl(sites, iframeUrl, preferredSiteName);
    if (matchedSite) {
      return async function(iframe, query, historyId) {
        try {
          // 等待页面加载
          await new Promise(resolve => setTimeout(resolve, 2000));
          const targetSiteName = preferredSiteName || matchedSite.name;
          const searchId = window.aiCompareSiteRuntime?.queueSiteRuntime
            ? window.aiCompareSiteRuntime.queueSiteRuntime(targetSiteName, query, { iframeSrc: iframe.src })
            : createSiteSearchId(targetSiteName);

          // 向 iframe 发送统一格式的消息
          iframe.contentWindow.postMessage({
            type: 'search',
            query: query,
            domain: domain,
            historyId: historyId || null,
            siteName: targetSiteName,
            searchId
          }, '*');

          console.log(`已向 ${domain} 发送搜索消息`, {
            preferredSiteName,
            resolvedSiteName: matchedSite.name,
            searchId
          });
        } catch (error) {
          console.error(`${domain} iframe 处理失败:`, error);
        }
      };
    }
    
    console.warn('未找到匹配的站点配置:', { domain, preferredSiteName, iframeUrl });
    return null;
  } catch (error) {
    console.error('获取 iframe 处理函数失败:', error);
    return null;
  }
}
// 添加搜索按钮
document.getElementById('searchButton').addEventListener('click', async () => {
  await submitIframeSearch('button');
});

// 监听输入法组合输入事件
document.getElementById('searchInput').addEventListener('compositionstart', () => {
    isComposing = true;
    console.log('🎯 输入法组合输入开始');
});

document.getElementById('searchInput').addEventListener('compositionend', () => {
    isComposing = false;
    console.log('🎯 输入法组合输入结束');
});

// 处理回车键
document.getElementById('searchInput').addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') {
        return;
    }

    // 如果正在使用输入法组合输入，不触发查询操作
    if (isComposing) {
        console.log('🎯 输入法组合输入中，不触发查询');
        return; // 让输入法处理回车键
    }

    if (!shouldSubmitOnEnterKey(e, {
        mode: iframeSubmitShortcutMode,
        isMac: IFRAME_IS_MAC_PLATFORM
    })) {
        return;
    }

    e.preventDefault();
    await submitIframeSearch('enter');
});   

// 添加输入监听器，当searchInput有内容时显示建议
document.getElementById('searchInput').addEventListener('input', (e) => {
    const query = e.target.value.trim();
    const inputWrapper = e.target.closest('.input-wrapper');
    if (inputWrapper) {
        inputWrapper.classList.remove('compact');
    }
    showQuerySuggestions(query);
    updateFavoriteButtonVisibility(query);
});

// 添加焦点事件监听器
document.getElementById('searchInput').addEventListener('focus', (e) => {
    const query = e.target.value.trim();
    showQuerySuggestions(query);
    updateFavoriteButtonVisibility(e.target.value);
});

// 注意：失焦事件监听器已合并到DOMContentLoaded中的自动调整高度功能中

// 在 DOMContentLoaded 时设置按钮文案
document.addEventListener('DOMContentLoaded', () => {
    // 获取按钮元素
    const searchButton = document.getElementById('searchButton');
    if (searchButton) {
        // 获取当前语言的文案
        const buttonText = chrome.i18n.getMessage('startCompare');
        searchButton.textContent = buttonText;
        
        // 调试日志
        console.log('按钮文案设置:', {
            当前语言: chrome.i18n.getUILanguage(),
            文案: buttonText
        });
    }
});

// Toast 提示函数
function showToast(message, duration = 2000) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    
    // 添加显示类名触发动画
    setTimeout(() => toast.classList.add('show'), 10);
    
    // 定时移除
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// 收藏当前记录的所有 iframe
async function favoriteAllIframes() {
    try {
        const historyId = window._currentHistoryId;
        if (!historyId) {
            console.warn('没有当前历史记录 ID，无法收藏');
            return;
        }
        
        // 弹窗前先读取当前收藏文件夹，作为弹窗的默认选中项（取第一个已收藏站点的文件夹）
        let currentFolderIdAll = null;
        {
            const { pkHistory: ph = [] } = await chrome.storage.local.get('pkHistory');
            const hi = ph.find(item => item.id === historyId);
            if (hi && hi.sites) {
                const favSite = hi.sites.find(s => s.isFavorite);
                if (favSite) currentFolderIdAll = favSite.favoriteFolder || 'default';
            }
        }

        // 弹出文件夹选择弹窗
        const result = await window.showFavoriteFolderModal(
            currentFolderIdAll ? { defaultFolderId: currentFolderIdAll } : {}
        );
        if (!result) return;

        const isRemove = result.action === 'remove';

        // 从存储中获取历史记录
        const { pkHistory = [] } = await chrome.storage.local.get('pkHistory');
        const historyIndex = pkHistory.findIndex(item => item.id === historyId);
        
        if (historyIndex === -1) {
            console.warn(`未找到历史记录 ID: ${historyId}`);
            return;
        }
        
        const historyItem = pkHistory[historyIndex];
        
        if (!historyItem.sites) {
            historyItem.sites = [];
        }
        
        historyItem.sites.forEach(site => {
            if (isRemove) {
                site.isFavorite = false;
                delete site.favoriteFolder;
            } else {
                site.isFavorite = true;
                site.favoriteFolder = result.folderId;
            }
        });
        
        trackEvent('iframe_favorite_all_iframes', {
            history_id: historyId,
            sites_count: historyItem.sites.length,
            action: isRemove ? 'remove' : 'save'
        });
        
        // 保存更新后的历史记录
        await chrome.storage.local.set({ pkHistory: pkHistory });
        if (typeof window.firebaseSyncUploadIfLoggedIn === 'function') window.firebaseSyncUploadIfLoggedIn();
        
        // 更新 UI 中的收藏按钮状态
        updateAllIframeFavoriteButtons(!isRemove);
        updateFavoriteAllIcon(!isRemove);
        
        console.log(isRemove ? '✅ 已移除当前记录的所有收藏' : '✅ 已收藏当前记录的所有 iframe');
    } catch (error) {
        console.error('收藏所有 iframe 失败:', error);
    }
}

// 更新右侧「全部收藏」星标图标：仅当当前记录下所有子 iframe 都已收藏时才显示实心星
function updateFavoriteAllIcon(isFavorited) {
    const el = document.querySelector('.favorite-icon-container .favorite-icon');
    if (el) {
        el.src = isFavorited ? '../icons/star_saved.svg' : '../icons/star_unsaved.svg';
    }
}

// 更新单个收藏按钮的视觉状态
function updateFavoriteButtonState(btn, isFavorite) {
    const icon = btn.querySelector('.iframe-favorite-icon');
    if (icon) {
        icon.src = isFavorite ? '../icons/star_saved.svg' : '../icons/star_unsaved.svg';
    }
    btn.dataset.favorite = isFavorite ? 'true' : 'false';
    btn.title = isFavorite ? (chrome.i18n.getMessage('iframeUnfavoriteTitle') || '取消收藏') : (chrome.i18n.getMessage('iframeFavoriteTitle') || '收藏');
}

// 更新所有 iframe 的收藏按钮状态
function updateAllIframeFavoriteButtons(isFavorite) {
    const favoriteButtons = document.querySelectorAll('.iframe-favorite-btn');
    favoriteButtons.forEach(btn => {
        updateFavoriteButtonState(btn, isFavorite);
    });
}

// 为 iframe 容器添加悬浮收藏按钮
function addFavoriteButtonToIframe(iframeContainer, siteName, isFavorite = false) {
    // 检查是否已经存在收藏按钮
    if (iframeContainer.querySelector('.iframe-favorite-btn-float')) {
        return;
    }
    
    // 创建悬浮收藏按钮
    const favoriteBtn = document.createElement('button');
    favoriteBtn.className = 'iframe-favorite-btn iframe-favorite-btn-float';
    favoriteBtn.dataset.siteName = siteName;
    favoriteBtn.dataset.favorite = isFavorite ? 'true' : 'false';
    favoriteBtn.title = isFavorite ? (chrome.i18n.getMessage('iframeUnfavoriteTitle') || '取消收藏') : (chrome.i18n.getMessage('iframeFavoriteTitle') || '收藏');
    
    const favoriteIcon = document.createElement('img');
    favoriteIcon.className = 'iframe-favorite-icon';
    favoriteIcon.src = isFavorite ? '../icons/star_saved.svg' : '../icons/star_unsaved.svg';
    favoriteIcon.alt = chrome.i18n.getMessage('iframeFavoriteTitle') || '收藏';
    
    favoriteBtn.appendChild(favoriteIcon);
    
    // 添加点击事件
    favoriteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        e.preventDefault();
        await toggleIframeFavorite(siteName, favoriteBtn);
    });
    
    // 将按钮添加到 iframe 容器
    iframeContainer.appendChild(favoriteBtn);
}

// 切换单个 iframe 的收藏状态
async function toggleIframeFavorite(siteName, favoriteBtn) {
    try {
        const historyId = window._currentHistoryId;
        if (!historyId) {
            console.warn('没有当前历史记录 ID，无法收藏');
            return;
        }

        // 弹窗前先读取当前收藏文件夹，作为弹窗的默认选中项
        let currentFolderId = null;
        {
            const { pkHistory: ph = [] } = await chrome.storage.local.get('pkHistory');
            const hi = ph.find(item => item.id === historyId);
            if (hi && hi.sites) {
                const si = hi.sites.find(s => s.name === siteName);
                if (si && si.isFavorite) currentFolderId = si.favoriteFolder || 'default';
            }
        }

        // 弹出文件夹选择弹窗（Save / Remove / 关闭）
        const result = await window.showFavoriteFolderModal(
            currentFolderId ? { defaultFolderId: currentFolderId } : {}
        );
        if (!result) return;

        // 弹窗关闭后重新读取最新的 pkHistory，避免写入过时数据
        const { pkHistory = [] } = await chrome.storage.local.get('pkHistory');
        const historyIndex = pkHistory.findIndex(item => item.id === historyId);

        if (historyIndex === -1) {
            console.warn(`未找到历史记录 ID: ${historyId}`);
            return;
        }

        const historyItem = pkHistory[historyIndex];
        if (!historyItem.sites) historyItem.sites = [];

        const siteItem = historyItem.sites.find(s => s.name === siteName);
        if (!siteItem) {
            console.warn(`未找到站点: ${siteName}`);
            return;
        }

        if (result.action === 'remove') {
            siteItem.isFavorite = false;
            delete siteItem.favoriteFolder;
        } else {
            siteItem.isFavorite = true;
            siteItem.favoriteFolder = result.folderId;
        }

        // 保存更新后的历史记录
        await chrome.storage.local.set({ pkHistory: pkHistory });
        if (typeof window.firebaseSyncUploadIfLoggedIn === 'function') window.firebaseSyncUploadIfLoggedIn();
        
        // 更新当前站点所有收藏按钮状态
        const favoriteButtons = document.querySelectorAll('.iframe-favorite-btn');
        favoriteButtons.forEach(btn => {
            if (btn.dataset.siteName === siteName) {
                updateFavoriteButtonState(btn, siteItem.isFavorite);
            }
        });
        const allFavorited = historyItem.sites.length > 0 && historyItem.sites.every(s => s.isFavorite);
        updateFavoriteAllIcon(allFavorited);
        
        trackEvent('iframe_site_favorite_toggle', {
            site_name: siteName,
            is_favorite: siteItem.isFavorite
        });
        
        console.log(`✅ ${siteItem.isFavorite ? '已收藏' : '已取消收藏'} iframe: ${siteName}`);
    } catch (error) {
        console.error('切换 iframe 收藏状态失败:', error);
    }
}

// 收藏按钮点击事件
const favoriteIcon = document.querySelector('.favorite-icon');
if (favoriteIcon) {
    // 设置收藏按钮的国际化标题
    const favoriteAllSitesTitle = chrome.i18n.getMessage('favoriteAllSites');
    if (favoriteAllSitesTitle) {
        favoriteIcon.title = favoriteAllSitesTitle;
    }
    
    favoriteIcon.addEventListener('click', async (e) => {
        e.stopPropagation();
        // 收藏当前记录的所有 iframe
        await favoriteAllIframes();
    });
}

// 初始化国际化
function initializeI18n() {
    document.title = t('iframePageTitle', 'AI Compare');

    // 处理所有带有 data-i18n 属性的元素（不包含 data-i18n-title / data-i18n-alt，避免重复）
    document.querySelectorAll('[data-i18n]:not([data-i18n-title]):not([data-i18n-alt])').forEach(element => {
        const key = element.getAttribute('data-i18n');
        const message = chrome.i18n.getMessage(key);
        if (message) {
            if ((element.tagName.toLowerCase() === 'input' && 
                element.type === 'text') || 
                element.tagName.toLowerCase() === 'textarea') {
                element.placeholder = message;
            } else if (element.tagName.toLowerCase() === 'img') {
                element.alt = message;
            } else {
                // 按钮、其他元素：设置可见文本
                element.textContent = message;
            }
        }
    });
    
    // 处理 data-i18n-title：设置元素的 title 属性
    document.querySelectorAll('[data-i18n-title]').forEach(element => {
        const key = element.getAttribute('data-i18n-title');
        const message = chrome.i18n.getMessage(key);
        if (message) {
            element.title = message;
        }
    });
    
    // 处理 data-i18n-alt：设置 img 的 alt 属性
    document.querySelectorAll('[data-i18n-alt]').forEach(element => {
        const key = element.getAttribute('data-i18n-alt');
        const message = chrome.i18n.getMessage(key);
        if (message) {
            element.alt = message;
        }
    });

    // 处理 data-i18n-aria-label：设置元素的 aria-label 属性
    document.querySelectorAll('[data-i18n-aria-label]').forEach(element => {
        const key = element.getAttribute('data-i18n-aria-label');
        const message = chrome.i18n.getMessage(key);
        if (message) {
            element.setAttribute('aria-label', message);
        }
    });
    
    // 手动设置输入框的占位符
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        const placeholderMessage = chrome.i18n.getMessage('inputPlaceholder');
        if (placeholderMessage) {
            searchInput.placeholder = placeholderMessage;
        }
    }
}



// 显示查询建议
async function showQuerySuggestions(query) {
  const querySuggestions = document.getElementById('querySuggestions');

  try {
    await ensureIframePromptTemplates();
    // 从存储中获取提示词模板
    const { promptTemplates = [] } = await chrome.storage.sync.get('promptTemplates');
    await loadIframeConfiguredTypes();
    const currentType = getIframePromptTemplateType();
    const recommendedQueries = window.PromptTemplateUtils?.buildPromptTemplateSuggestions
      ? window.PromptTemplateUtils.buildPromptTemplateSuggestions(
          promptTemplates,
          query,
          currentType,
          iframeConfiguredTypes
        )
      : [];

    if (recommendedQueries.length === 0) {
      querySuggestions.innerHTML = '';
      querySuggestions.style.display = 'none';
      return;
    }

    // 清空之前的内容
    querySuggestions.innerHTML = '';

    // 添加提示文案
    const label = document.createElement('div');
    const labelText = (chrome?.i18n?.getMessage && chrome.i18n.getMessage('promptTemplatesLabel')) || '模板：';
    label.textContent = labelText;
    label.classList.add('query-suggestion-label');
    querySuggestions.appendChild(label);

    // 创建建议项
    recommendedQueries.forEach(recommendedQuery => {
      const suggestionItem = document.createElement('div');
      suggestionItem.textContent = recommendedQuery.name;
      suggestionItem.classList.add('query-suggestion-item');
      // 防止点击时触发 textarea 失焦收缩，导致点击被中断
      suggestionItem.addEventListener('mousedown', (e) => {
        e.preventDefault();
      });
      suggestionItem.addEventListener('click', () => {
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
          searchInput.value = recommendedQuery.query;
          updateFavoriteButtonVisibility(recommendedQuery.query);
        }
        querySuggestions.style.display = 'none';
      });
      querySuggestions.appendChild(suggestionItem);
    });
    // 添加设置图标到 querySuggestions 区域
    const settingsIcon = document.createElement('img');
    settingsIcon.src = '../icons/edit.svg';
    const editTemplateLabel = t('editPromptTemplate', 'Edit prompt templates');
    settingsIcon.alt = editTemplateLabel;
    settingsIcon.title = editTemplateLabel;
    settingsIcon.classList.add('query-suggestion-settings-icon');
    settingsIcon.style.cursor = 'pointer';
    settingsIcon.style.width = '14px';
    settingsIcon.style.height = '14px';
    settingsIcon.style.marginLeft = '8px';
    settingsIcon.style.verticalAlign = 'middle';
    // 防止 mousedown 导致 textarea 失焦收缩，影响点击跳转
    settingsIcon.addEventListener('mousedown', (e) => {
      e.preventDefault();
    });

    // 点击后在新标签页打开设置页面并跳转到模板编辑区域
    settingsIcon.addEventListener('click', (e) => {
      e.stopPropagation();
      // 跳转到 options.html 的提示词模板设置区域
      window.open(chrome.runtime.getURL('options/options.html#prompt-templates'), '_blank');
    });

    // 将设置图标添加到 querySuggestions 区域
    querySuggestions.appendChild(settingsIcon);

    // 显示建议
    querySuggestions.style.display = 'flex';
    
  } catch (error) {
    console.error('加载提示词模板失败:', error);
    // 如果加载失败，隐藏建议
    querySuggestions.style.display = 'none';
  }
}


// 切换图标晃动动画函数
function shakeToggleIcon() {
  const toggleIcon = document.getElementById('toggleIcon');
  if (toggleIcon) {
    // 添加晃动动画类
    toggleIcon.classList.add('toggle-icon-shake');
    
    // 动画结束后移除类名
    setTimeout(() => {
      toggleIcon.classList.remove('toggle-icon-shake');
    }, 500); // 与CSS动画持续时间一致
  }
}

// 添加收藏按钮点击事件（仅当元素存在时）
const favoriteButton = document.getElementById('favoriteButton');
if (favoriteButton) {
  favoriteButton.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleFavorite();
    shakeToggleIcon();
  });
}

// 添加图标点击事件（仅当元素存在时）
const toggleIconBtn = document.getElementById('toggleIcon');
if (toggleIconBtn) {
  toggleIconBtn.addEventListener('click', () => {
    const queryList = document.getElementById('queryList');
    if (queryList.style.display === 'none') {
      toggleIconBtn.src = '../icons/up.svg';
      queryList.style.display = 'block';
      showFavorites();
    } else {
      queryList.style.display = 'none';
      toggleIconBtn.src = '../icons/down.svg';
    }
  });
}

// 点击收藏夹以外区域隐藏收藏夹
document.addEventListener('click', (e) => {
  const queryList = document.getElementById('queryList');
  const toggleIcon = document.getElementById('toggleIcon');
  const favoriteIconContainer = document.querySelector('.favorite-icon-container');
  
  // 如果收藏夹是显示的
  if (queryList && queryList.style.display === 'block') {
    // 检查点击的元素是否在收藏夹、切换图标或收藏按钮内
    const isClickInsideFavorites = queryList.contains(e.target);
    const isClickOnToggleIcon = toggleIcon && toggleIcon.contains(e.target);
    const isClickOnFavoriteIcon = favoriteIconContainer && favoriteIconContainer.contains(e.target);
    
    // 如果点击在收藏夹、切换图标和收藏按钮以外
    if (!isClickInsideFavorites && !isClickOnToggleIcon && !isClickOnFavoriteIcon) {
      // 隐藏收藏夹
      queryList.style.display = 'none';
      // 切换图标回 down.svg
      if (toggleIcon) {
        toggleIcon.src = '../icons/down.svg';
      }
    }
  }
});


// 创建闪烁效果函数
function shanshuo() {
  // 获取搜索按钮元素
  const searchButton = document.getElementById('searchButton');
      searchButton.classList.add('active');
      
      // 200ms后移除active效果
      setTimeout(() => {
          searchButton.classList.remove('active');
      }, 200);
}

function clearIframeSearchInput() {
  const searchInput = document.getElementById('searchInput');
  if (!searchInput) return;

  if (!searchInput.value) return;

  searchInput.value = '';
  searchInput.dispatchEvent(new Event('input', { bubbles: true }));
}

function setIframeSearchInputValue(query) {
  const searchInput = document.getElementById('searchInput');
  if (!searchInput) return false;

  searchInput.value = String(query || '').trim();
  searchInput.dispatchEvent(new Event('input', { bubbles: true }));
  searchInput.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function resetIframePageToDefaultType() {
  const targetUrl = `${chrome.runtime.getURL('iframe/iframe.html')}?type=information`;
  window.location.href = targetUrl;
}

async function runIframeSearchQuery(query, options = {}) {
  const normalizedQuery = String(query || '').trim();
  const trigger = options.trigger || 'button';
  const clearInputOnSuccess = options.clearInputOnSuccess !== false;
  const armCollapseOnSuccess = options.armCollapseOnSuccess !== false;

  if (!normalizedQuery) return false;

  if (options.syncInputValue !== false) {
    setIframeSearchInputValue(normalizedQuery);
  }

  const openedSites = getOpenedSites();
  trackEvent('iframe_search_submit', {
    query_length: normalizedQuery.length,
    selected_sites_count: openedSites.length,
    selected_sites: openedSites,
    trigger
  });

  shanshuo();
  const sent = await iframeFresh(normalizedQuery, {
    persistHistory: options.persistHistory,
    historyId: options.historyId,
    preferCurrentPage: options.preferCurrentPage
  });
  if (sent) {
    if (clearInputOnSuccess) {
      clearIframeSearchInput();
    }
    if (armCollapseOnSuccess) {
      armSearchBarAutoCollapse();
    }
  }
  return sent;
}

async function submitIframeSearch(trigger) {
  const searchInput = document.getElementById('searchInput');
  const query = searchInput ? searchInput.value.trim() : '';
  if (!query) return false;

  return runIframeSearchQuery(query, {
    trigger,
    syncInputValue: false,
    clearInputOnSuccess: true,
    armCollapseOnSuccess: true
  });
}

async function runQueryAcrossOpenIframes(query, options = {}) {
      const {
        persistHistory = true,
        historyId: providedHistoryId = null,
        preferCurrentPage = false,
        targetSiteNames = null
      } = options;

      const targetSiteNameSet = Array.isArray(targetSiteNames) && targetSiteNames.length > 0
        ? new Set(targetSiteNames.map((name) => String(name || '').trim()).filter(Boolean))
        : null;

      let historyId = providedHistoryId || window._currentHistoryId || null;
      if (persistHistory) {
        try {
          historyId = await savePKHistory(query);
        } catch (error) {
          console.error('立即保存 PK 历史记录失败（将继续执行 PK）:', error);
        }
      }
        
      const iframes = document.querySelectorAll('iframe');
      let sites = [];
      try {
        sites = await getDefaultSites();
      } catch (error) {
        console.error('getDefaultSites 获取失败（将继续执行 PK）:', error);
        sites = [];
      }

      iframes.forEach(iframe => {
        try {
            const url = new URL(iframe.src);
            const domain = url.hostname;
            const siteName = iframe.getAttribute('data-site');
            if (targetSiteNameSet && !targetSiteNameSet.has(String(siteName || '').trim())) {
              return;
            }
            const iframeContainer = iframe.closest('.iframe-container');
            if (iframeContainer) {
              iframeContainer.dataset.lastQuery = query || '';
            }

            const siteConfig = sites.find(site => site.name === siteName);
            const launchTarget = siteConfig
              ? (SiteLaunchUtils.resolveOfficialLaunchTarget
                ? SiteLaunchUtils.resolveOfficialLaunchTarget(siteConfig, query)
                : {
                    url: siteConfig.url,
                    queryInUrl: Boolean(query) && siteConfig.supportUrlQuery === true,
                    shouldAutoRun: Boolean(query) && siteConfig.supportUrlQuery !== true
                  })
              : null;
            if (!siteConfig) {
              console.log('custom site 保持只打开页面，不执行自动注入:', siteName);
              return;
            }
            const fallbackToUrlQuery = () => {
              if (!(launchTarget && launchTarget.queryInUrl)) {
                console.log('没有找到处理函数');
                return;
              }

              if (iframeContainer) {
                setIframeHeaderStatus(iframeContainer, t('iframeStatusNetworkLoading', '网络加载中...'));
              }
              const nextUrl = launchTarget.url;
              console.log(`为 ${siteName} iframe 生成新的 URL: ${nextUrl}`);
              if (historyId) {
                const onLoadSendHistoryContext = () => {
                  try {
                    iframe.removeEventListener('load', onLoadSendHistoryContext);
                    iframe.contentWindow?.postMessage({
                      type: 'SET_HISTORY_CONTEXT',
                      historyId,
                      siteName
                    }, '*');
                  } catch (_) {}
                };
                iframe.addEventListener('load', onLoadSendHistoryContext);
              }
              iframe.src = nextUrl;
              if (iframeContainer) {
                scheduleIframeHeaderStatus(iframeContainer, t('iframeStatusPageLoading', '页面加载中...'), 700);
              }
            };

            if (launchTarget && launchTarget.queryInUrl && !preferCurrentPage) {
              fallbackToUrlQuery();
            } else {
              getIframeHandler(iframe.src, siteName).then(handler => {
                if (handler) {
                  if (iframeContainer) {
                    setIframeHeaderStatus(iframeContainer, t('iframeStatusPreparingScript', '准备执行脚本...'));
                  }
                  console.log(`重新处理 ${domain} iframe`, {
                      时间: new Date().toISOString(),
                      query: query
                  });
                  if (historyId) {
                    try {
                      iframe.contentWindow?.postMessage({
                        type: 'SET_HISTORY_CONTEXT',
                        historyId,
                        siteName
                      }, '*');
                    } catch (_) {}
                  }
                  handler(iframe, query, historyId);
                } else if (launchTarget && launchTarget.queryInUrl) {
                  fallbackToUrlQuery();
                } else {
                  console.log('没有找到处理函数');
                }
              }).catch(error => {
                console.error('获取处理函数失败:', error);
              });
            }
        } catch (error) {
            console.error('处理 iframe 失败:', error);
        }
    });

      scheduleTimelineSyncBurst([1800, 4200, 7600]);
      return iframes.length > 0;
}

function scheduleRestoreScrollToPrompt(restoreContext) {
  if (!restoreContext?.query || restoreContext.scrollToPrompt !== true) return;

  const entry = {
    query: restoreContext.query,
    occurrenceIndex: restoreContext.occurrenceIndex
  };

  [2800, 5600, 9000].forEach((delayMs) => {
    setTimeout(() => {
      scrollToTimelineEntry(entry, {
        showToast: false,
        trackEvent: false
      }).catch((error) => {
        console.warn('恢复收藏提问定位失败:', error);
      });
    }, delayMs);
  });
}

async function restoreFavoriteHistoryContext(restoreContext) {
  if (!restoreContext?.query) return;

  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.value = restoreContext.query;
    updateFavoriteButtonVisibility(restoreContext.query);
  }

  if (restoreContext.autoSearch) {
    await runQueryAcrossOpenIframes(restoreContext.query, {
      persistHistory: false,
      historyId: window._currentHistoryId || null,
      preferCurrentPage: true
    });
  }

  scheduleRestoreScrollToPrompt(restoreContext);
}

async function iframeFresh(query, options = {}) {
      return runQueryAcrossOpenIframes(query, {
        persistHistory: options.persistHistory !== false,
        historyId: options.historyId || null,
        preferCurrentPage: options.preferCurrentPage === true
      });
}

window.aiCompareSearch = {
  submitQuery(query, options = {}) {
    return runIframeSearchQuery(query, {
      trigger: options.trigger || 'api',
      syncInputValue: options.syncInputValue !== false,
      clearInputOnSuccess: options.clearInputOnSuccess !== false,
      armCollapseOnSuccess: options.armCollapseOnSuccess !== false,
      persistHistory: options.persistHistory,
      historyId: options.historyId || null,
      preferCurrentPage: options.preferCurrentPage === true
    });
  },
  setQuery(query) {
    return setIframeSearchInputValue(query);
  },
  getQuery() {
    return getCurrentQueryText();
  },
  runQueryAcrossOpenIframes
};



// 从历史记录加载 iframe
async function loadHistoryIframes(sites, restoreContext = null) {
  try {
    const container = document.getElementById('iframes-container');
    if (!container) {
      console.error('未找到 iframes 容器');
      return;
    }
    
    resetTimelinePromptSnapshots();
    // 清空现有 iframe
    container.innerHTML = '';

    let siteConfigs = [];
    try {
      siteConfigs = await getDefaultSites();
    } catch (error) {
      console.warn('加载站点配置失败，历史恢复将使用保存的 URL:', error);
    }
    const replaySiteNames = [];
    
    // 调整主容器样式以适应导航栏
    // container.style.marginLeft = '72px';
    
    // 为每个站点创建 iframe，直接使用历史记录中的 URL（不进行任何处理）
    sites.forEach(site => {
      const siteName = site.name;
      const savedUrl = site.url; // 直接使用历史记录中保存的 URL
      const siteConfig = siteConfigs.find((item) => item.name === siteName) || null;
      const shouldReplayQueryForSite = !savedUrl || SiteLaunchUtils.isLikelyPlaceholderHistoryUrl?.(savedUrl, siteName);
      const url = shouldReplayQueryForSite && siteConfig
        ? (buildSiteUrlForQuery(siteConfig, '') || savedUrl)
        : savedUrl;
      if (shouldReplayQueryForSite) {
        replaySiteNames.push(siteName);
      }
      
      // 确保 isFavorite 字段存在（兼容旧数据）
      if (site.isFavorite === undefined) {
        site.isFavorite = false;
      }
      
      console.log('从历史记录创建 iframe:', siteName, url);
      
      // 创建 iframe 容器
      const iframeContainer = document.createElement('div');
      iframeContainer.className = 'iframe-container';
      setIframeHeaderStatus(iframeContainer, t('iframeStatusNetworkLoading', '网络加载中...'));
      
      const iframe = document.createElement('iframe');
      iframe.className = 'ai-iframe';
      iframe.setAttribute('data-site', siteName);
      iframe.allow = IFRAME_ALLOW_PERMISSIONS;
      iframe.src = url; // 直接使用历史记录中的 URL
      
      // 创建 header
      const header = document.createElement('div');
      header.className = 'iframe-header';
      header.innerHTML = `
        <span class="site-name">${siteName}</span>
        <span class="iframe-header-status" aria-live="polite">${t('iframeStatusNetworkLoading', '网络加载中...')}</span>
        <div class="iframe-controls">
          <button class="refresh-page-btn"></button>
          <button class="open-page-btn"></button>
          <button class="close-btn"></button>
        </div>
      `;
      
      // 添加按钮事件
      const refreshPageBtn = header.querySelector('.refresh-page-btn');
      const openPageBtn = header.querySelector('.open-page-btn');
      const closeBtn = header.querySelector('.close-btn');
      
      // 设置按钮提示
      refreshPageBtn.title = chrome.i18n.getMessage('refresh') || '刷新';
      openPageBtn.title = chrome.i18n.getMessage('openInNewTab') || '在新标签页打开';
      closeBtn.title = chrome.i18n.getMessage('closeButton') || '关闭';

      iframe.addEventListener('load', () => {
        setIframeHeaderStatus(iframeContainer, t('iframeStatusPageLoaded', '页面已加载'));
        scheduleTimelineSync(900);
      });

      // 刷新按钮点击事件
      refreshPageBtn.onclick = (e) => {
        e.stopPropagation();
        try {
          iframe.contentWindow?.location.reload();
        } catch (_) {
          iframe.src = iframe.src;
        }
      };

      // 打开页面按钮点击事件
      openPageBtn.onclick = async (e) => {
        e.stopPropagation();
        // 获取 iframe 的最新 URL，传递历史记录 ID（如果存在）
        const historyId = window._currentHistoryId || null;
        const iframeUrl = await getIframeLatestUrl(iframe, siteName, historyId);
        if (iframeUrl) {
          // 在新标签页打开
          chrome.tabs.create({ url: iframeUrl });
        } else {
          console.warn(`无法获取 ${siteName} 的 URL，尝试使用 iframe.src`);
          // 如果无法获取 URL，至少尝试使用 iframe.src
          if (iframe.src && iframe.src !== 'about:blank') {
            chrome.tabs.create({ url: iframe.src });
          }
        }
      };
      
      // 关闭按钮事件
      closeBtn.onclick = () => {
        iframeContainer.remove();
        removeNavItemBySiteName(siteName);
        clearTimelineSnapshotForSite(siteName);
      };
      
      // 组装元素
      iframeContainer.appendChild(header);
      iframeContainer.appendChild(iframe);
      container.appendChild(iframeContainer);
      scheduleIframeHeaderStatus(iframeContainer, t('iframeStatusPageLoading', '页面加载中...'), 700);
      
    });
    
    // 仅当当前记录下所有子 iframe 都被收藏时，顶部「收藏全部」图标才显示为已收藏
    const allFavorited = sites.length > 0 && sites.every(s => s.isFavorite);
    updateFavoriteAllIcon(allFavorited);
    await renderSideNav();
    await refreshTimelineFavoriteState();
    
    // 创建导航栏
    // const nav = document.createElement('nav');
    // nav.className = 'nav';
    // 
    // const navList = document.createElement('ul');
    // navList.className = 'nav-list';
    // 
    // sites.forEach((site, index) => {
    //   const navItem = document.createElement('li');
    //   navItem.className = 'nav-item';
    //   navItem.textContent = site.name;
    //   navItem.dataset.siteName = site.name;
    //   navItem.dataset.originalIndex = index;
    //   
    //   // 点击导航项时滚动到对应的iframe
    //   navItem.addEventListener('click', () => {
    //     navList.querySelectorAll('li').forEach(item => {
    //       item.style.backgroundColor = '';
    //       item.classList.remove('active');
    //     });
    //     
    //     navItem.style.backgroundColor = '#e0e0e0';
    //     navItem.classList.add('active');
    //     
    //     const iframes = container.querySelectorAll('.iframe-container');
    //     if (iframes[index]) {
    //       iframes[index].scrollIntoView({ behavior: 'smooth' });
    //     }
    //   });
    //   
    //   navList.appendChild(navItem);
    // });
    // 
    // nav.appendChild(navList);
    // document.body.insertBefore(nav, container);
    
    // 设置搜索框的值（如果有的话）
    const urlParams = new URLSearchParams(window.location.search);
    let resolvedRestoreContext = normalizeRestoreContext(restoreContext, '');
    const query = resolvedRestoreContext?.query || urlParams.get('query');
    if (!resolvedRestoreContext && query && replaySiteNames.length > 0) {
      resolvedRestoreContext = {
        source: 'history',
        query,
        autoSearch: true,
        scrollToPrompt: false,
        occurrenceIndex: 0,
        sourceHistoryId: window._currentHistoryId ? String(window._currentHistoryId) : null
      };
    }
    if (query) {
      const searchInput = document.getElementById('searchInput');
      if (searchInput) {
        searchInput.value = query;
        updateFavoriteButtonVisibility(query);
      }
    }

    if (resolvedRestoreContext) {
      setTimeout(() => {
        restoreFavoriteHistoryContext(resolvedRestoreContext).catch((error) => {
          console.error('恢复收藏提问上下文失败:', error);
        });
      }, 900);
    }

    if (resolvedRestoreContext?.query && replaySiteNames.length > 0) {
      setTimeout(() => {
        runQueryAcrossOpenIframes(resolvedRestoreContext.query, {
          persistHistory: false,
          historyId: window._currentHistoryId || null,
          preferCurrentPage: true,
          targetSiteNames: replaySiteNames
        }).catch((error) => {
          console.error('重放占位历史站点失败:', error);
        });
      }, 1200);
    }
    
  } catch (error) {
    console.error('加载历史记录 iframe 失败:', error);
  }
}

// 检查两个历史记录是否相同（基于 query 和 urlFeature）
async function isHistoryDuplicate(newItem, existingItem) {
  try {
    // 首先检查 query 是否相同
    if (newItem.query.trim() !== existingItem.query.trim()) {
      return false;
    }
    
    // 获取站点配置
    let siteConfigs = [];
    try {
      if (window.getDefaultSites) {
        siteConfigs = await window.getDefaultSites();
      } else if (window.siteDetector) {
        // 如果使用 siteDetector，需要获取所有站点配置
        siteConfigs = await window.siteDetector.getSites();
      }
    } catch (error) {
      console.warn('获取站点配置失败，跳过 urlFeature 对比:', error);
      return false;
    }
    
    // 检查每个站点是否匹配
    const newSites = newItem.sites || [];
    const existingSites = existingItem.sites || [];
    
    // 如果站点数量不同，认为不是重复
    if (newSites.length !== existingSites.length) {
      return false;
    }
    
    // 对每个站点进行匹配检查
    for (const newSite of newSites) {
      const existingSite = existingSites.find(s => s.name === newSite.name);
      if (!existingSite) {
        return false; // 站点名称不匹配
      }
      
      // 获取该站点的配置
      const siteConfig = siteConfigs.find(s => s.name === newSite.name);
      if (siteConfig && siteConfig.historyHandler && siteConfig.historyHandler.urlFeature) {
        // 如果配置了 urlFeature，需要检查 URL 是否包含相同的 urlFeature
        const urlFeature = siteConfig.historyHandler.urlFeature;
        
        // 提取新站点和现有站点的 URL pathname
        let newPathname = '';
        let existingPathname = '';
        
        try {
          if (newSite.url) {
            const newUrlObj = new URL(newSite.url);
            newPathname = newUrlObj.pathname;
          }
        } catch (e) {
          // URL 可能为空或无效，继续处理
        }
        
        try {
          if (existingSite.url) {
            const existingUrlObj = new URL(existingSite.url);
            existingPathname = existingUrlObj.pathname;
          }
        } catch (e) {
          // URL 可能为空或无效，继续处理
        }
        
        // 如果两个 URL 都包含相同的 urlFeature，认为是重复
        if (newPathname && existingPathname) {
          const newHasFeature = SiteLaunchUtils.urlMatchesHistoryFeature
            ? SiteLaunchUtils.urlMatchesHistoryFeature(newSite.url, urlFeature)
            : newPathname.includes(urlFeature);
          const existingHasFeature = SiteLaunchUtils.urlMatchesHistoryFeature
            ? SiteLaunchUtils.urlMatchesHistoryFeature(existingSite.url, urlFeature)
            : existingPathname.includes(urlFeature);
          
          // 如果都包含 urlFeature，认为是重复
          if (newHasFeature && existingHasFeature) {
            continue; // 这个站点匹配，继续检查下一个
          }
          
          // 如果都不包含 urlFeature，也认为可能匹配（URL 可能还未更新）
          if (!newHasFeature && !existingHasFeature) {
            continue; // 这个站点可能匹配，继续检查下一个
          }
          
          // 一个包含一个不包含，认为不匹配
          return false;
        } else if (!newPathname && !existingPathname) {
          // 两个 URL 都为空，认为可能匹配
          continue;
        } else {
          // 一个为空一个不为空，认为不匹配
          return false;
        }
      } else {
        // 如果没有配置 urlFeature，只检查站点名称是否相同
        // 站点名称已经匹配，继续检查下一个
        continue;
      }
    }
    
    // 所有站点都匹配，认为是重复记录
    return true;
  } catch (error) {
    console.error('检查历史记录重复失败:', error);
    return false;
  }
}

// 保存 PK 历史记录
async function savePKHistory(query) {
  try {
    if (!query || query.trim() === '') {
      return null; // 如果查询为空，不保存
    }
    
    // 获取所有 iframe
    const iframes = document.querySelectorAll('.ai-iframe');
    if (iframes.length === 0) {
      return null; // 如果没有 iframe，不保存
    }
    
    // 获取站点配置，用于检查 urlFeature
    let siteConfigs = [];
    try {
      if (window.getDefaultSites) {
        siteConfigs = await window.getDefaultSites();
      } else if (window.siteDetector) {
        siteConfigs = await window.siteDetector.getSites();
      }
    } catch (error) {
      console.warn('获取站点配置失败:', error);
    }
    
    // 收集所有站点的名称和 URL（尝试立即获取，如果获取不到则留空，由后续消息通信更新）
    // 如果配置了 urlFeature，只保存包含 urlFeature 的 URL
    const sites = [];
    for (const iframe of iframes) {
      const siteName = iframe.getAttribute('data-site');
      if (siteName) {
        // 尝试立即获取 iframe 的最新 URL
        const url = await getIframeLatestUrl(iframe, siteName);
        
        // 获取该站点的配置
        const siteConfig = siteConfigs.find(s => s.name === siteName);
        
        // 如果配置了 urlFeature，检查 URL 是否包含它
        if (siteConfig && siteConfig.historyHandler && siteConfig.historyHandler.urlFeature) {
          const urlFeature = siteConfig.historyHandler.urlFeature;
          
          // 如果 URL 不为空，检查是否包含 urlFeature
          if (url) {
            try {
              // 如果 URL 不包含 urlFeature，不保存该 URL（留空，等待后续更新）
              const matchesHistoryFeature = SiteLaunchUtils.urlMatchesHistoryFeature
                ? SiteLaunchUtils.urlMatchesHistoryFeature(url, urlFeature)
                : new URL(url).pathname.includes(urlFeature);
              if (!matchesHistoryFeature) {
                console.log(`⚠️ ${siteName} 的 URL 不包含 urlFeature "${urlFeature}"，不保存该 URL（等待后续更新）: ${url}`);
                sites.push({
                  name: siteName,
                  url: '', // 留空，等待后续通过消息更新
                  isFavorite: false
                });
                continue;
              }
            } catch (e) {
              console.warn(`解析 ${siteName} 的 URL 失败: ${url}`, e);
              // URL 格式错误，留空
              sites.push({
                name: siteName,
                url: '',
                isFavorite: false
              });
              continue;
            }
          } else {
            // URL 为空，留空等待后续更新
            sites.push({
              name: siteName,
              url: '',
              isFavorite: false
            });
            continue;
          }
        }
        
        if (url && SiteLaunchUtils.isLikelyPlaceholderHistoryUrl?.(url, siteName)) {
          sites.push({
            name: siteName,
            url: '',
            isFavorite: false
          });
          continue;
        }

        // 如果未配置 urlFeature，或者 URL 包含 urlFeature，正常保存
        sites.push({
          name: siteName,
          url: url || '', // 如果获取不到 URL，留空，由后续消息通信更新
          isFavorite: false
        });
      }
    }
    
    if (sites.length === 0) {
      return null; // 如果没有有效的站点，不保存
    }
    
    // 创建历史记录项（尝试立即获取 URL，如果获取不到则由各 iframe 内部脚本检测并更新）
    let historyId = Date.now().toString();
    const historyItem = {
      id: historyId,
      query: query.trim(),
      sites: sites, // 尝试立即获取 URL，如果为空则由后续消息通信更新
      timestamp: Date.now(),
      date: new Date().toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      })
    };
    
    // 从存储中获取现有历史记录
    const { pkHistory = [] } = await chrome.storage.local.get('pkHistory');
    
    // 检查是否存在重复记录（基于 query 和 urlFeature）
    let existingHistoryId = null;
    for (const existingItem of pkHistory) {
      const isDuplicate = await isHistoryDuplicate(historyItem, existingItem);
      if (isDuplicate) {
        existingHistoryId = existingItem.id;
        console.log('发现重复的历史记录，将更新现有记录:', existingItem.id);
        break;
      }
    }
    
    let updatedHistory;
    if (existingHistoryId) {
      // 如果存在重复记录，更新现有记录而不是创建新记录
      updatedHistory = pkHistory.map(item => {
        if (item.id === existingHistoryId) {
          // 更新现有记录的时间戳和日期
          return {
            ...item,
            timestamp: Date.now(),
            date: new Date().toLocaleString('zh-CN', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit'
            }),
            // 更新站点 URL（如果新记录的 URL 更完整）
            sites: item.sites.map(existingSite => {
              const newSite = historyItem.sites.find(s => s.name === existingSite.name);
              if (newSite && newSite.url && (!existingSite.url || existingSite.url === '')) {
                return { ...existingSite, url: newSite.url };
              }
              return existingSite;
            })
          };
        }
        return item;
      });
      // 将更新的记录移到最前面
      const updatedItem = updatedHistory.find(item => item.id === existingHistoryId);
      updatedHistory = updatedHistory.filter(item => item.id !== existingHistoryId);
      updatedHistory = [updatedItem, ...updatedHistory];
      historyId = existingHistoryId; // 使用现有记录的 ID
    } else {
      // 如果没有重复，将新记录添加到开头
      updatedHistory = [historyItem, ...pkHistory];
    }
    
    // 限制历史记录数量（从 appConfig.json 读取配置）
    let maxHistory = 100; // 默认值
    try {
      if (window.AppConfigManager) {
        const appConfig = await window.AppConfigManager.loadConfig();
        if (appConfig && appConfig.history && appConfig.history.maxCount) {
          maxHistory = appConfig.history.maxCount;
        }
      }
    } catch (error) {
      console.warn('读取历史记录数量配置失败，使用默认值 100:', error);
    }
    const limitedHistory = updatedHistory.slice(0, maxHistory);
    
    // 保存到存储
    await chrome.storage.local.set({ pkHistory: limitedHistory });
    if (typeof window.firebaseSyncUploadIfLoggedIn === 'function') window.firebaseSyncUploadIfLoggedIn();
    
    // 将历史记录 ID 存储到全局变量，供 iframe 内部脚本更新 URL 时使用
    window._currentHistoryId = historyId;
    refreshTimelineFavoriteState().catch((error) => {
      console.warn('刷新时间线收藏状态失败:', error);
    });
    
    if (existingHistoryId) {
      console.log('PK 历史记录已更新（待 iframe 更新 URL）:', historyItem);
    } else {
      console.log('PK 历史记录已创建（待 iframe 更新 URL）:', historyItem);
    }
    return historyId;
  } catch (error) {
    console.error('保存 PK 历史记录失败:', error);
    return null;
  }
}

// 更新历史记录中特定站点的 URL
async function updateHistorySiteUrl(siteName, url, historyId) {
  try {
    if (SiteLaunchUtils.isLikelyPlaceholderHistoryUrl?.(url, siteName)) {
      console.log(`⚠️ ${siteName} 的 URL 仍是占位页，不更新历史记录: ${url}`);
      return;
    }
    // 获取站点配置，检查 urlFeature
    let siteConfigs = [];
    try {
      if (window.getDefaultSites) {
        siteConfigs = await window.getDefaultSites();
      } else if (window.siteDetector) {
        siteConfigs = await window.siteDetector.getSites();
      }
    } catch (error) {
      console.warn('获取站点配置失败:', error);
    }
    
    // 获取该站点的配置
    const siteConfig = siteConfigs.find(s => s.name === siteName);
    
    // 如果配置了 urlFeature，检查 URL 是否包含它
    if (siteConfig && siteConfig.historyHandler && siteConfig.historyHandler.urlFeature) {
      const urlFeature = siteConfig.historyHandler.urlFeature;
      
      if (!url) {
        // URL 为空，不更新
        console.log(`⚠️ ${siteName} 配置了 urlFeature "${urlFeature}" 但 URL 为空，不更新历史记录`);
        return;
      }
      
      try {
        // 如果 URL 不包含 urlFeature，不更新
        const matchesHistoryFeature = SiteLaunchUtils.urlMatchesHistoryFeature
          ? SiteLaunchUtils.urlMatchesHistoryFeature(url, urlFeature)
          : new URL(url).pathname.includes(urlFeature);
        if (!matchesHistoryFeature) {
          console.log(`⚠️ ${siteName} 的 URL 不包含 urlFeature "${urlFeature}"，不更新历史记录: ${url}`);
          return;
        }
      } catch (e) {
        console.warn(`解析 ${siteName} 的 URL 失败: ${url}`, e);
        // URL 格式错误，不更新
        return;
      }
    }
    
    // 从存储中获取历史记录
    const { pkHistory = [] } = await chrome.storage.local.get('pkHistory');
    
    // 查找对应的历史记录
    const historyIndex = pkHistory.findIndex(item => item.id === historyId);
    if (historyIndex === -1) {
      console.warn(`未找到历史记录 ID: ${historyId}`);
      return;
    }
    
    const historyItem = pkHistory[historyIndex];
    
    // 确保 sites 数组存在
    if (!historyItem.sites) {
      historyItem.sites = [];
    }
    
    // 查找或创建站点项
    let siteItem = historyItem.sites.find(s => s.name === siteName);
    if (siteItem) {
      // 更新现有站点的 URL
      siteItem.url = url;
      // 确保 isFavorite 字段存在（兼容旧数据）
      if (siteItem.isFavorite === undefined) {
        siteItem.isFavorite = false;
      }
    } else {
      // 创建新的站点项，默认 isFavorite 为 false
      siteItem = { name: siteName, url: url, isFavorite: false };
      historyItem.sites.push(siteItem);
    }
    
    // 检查历史记录中是否至少有一个站点的 URL 包含 urlFeature
    // 如果所有站点的 URL 都不包含 urlFeature，删除该历史记录
    let hasValidUrl = false;
    for (const site of historyItem.sites) {
      const siteCfg = siteConfigs.find(s => s.name === site.name);
      if (siteCfg && siteCfg.historyHandler && siteCfg.historyHandler.urlFeature) {
        const urlFeature = siteCfg.historyHandler.urlFeature;
        if (site.url) {
          try {
            const matchesHistoryFeature = SiteLaunchUtils.urlMatchesHistoryFeature
              ? SiteLaunchUtils.urlMatchesHistoryFeature(site.url, urlFeature)
              : new URL(site.url).pathname.includes(urlFeature);
            if (matchesHistoryFeature) {
              hasValidUrl = true;
              break;
            }
          } catch (e) {
            // URL 格式错误，跳过
          }
        }
      } else {
        // 如果站点未配置 urlFeature，认为该站点有效
        hasValidUrl = true;
        break;
      }
    }
    
    // 如果所有站点的 URL 都不包含 urlFeature，删除该历史记录
    if (!hasValidUrl && historyItem.sites.length > 0) {
      // 检查是否所有站点都配置了 urlFeature
      const allSitesHaveUrlFeature = historyItem.sites.every(site => {
        const siteCfg = siteConfigs.find(s => s.name === site.name);
        return siteCfg && siteCfg.historyHandler && siteCfg.historyHandler.urlFeature;
      });
      
      if (allSitesHaveUrlFeature) {
        // 所有站点都配置了 urlFeature，但没有任何站点的 URL 包含 urlFeature，删除该历史记录
        pkHistory.splice(historyIndex, 1);
        console.log(`🗑️ 历史记录 ${historyId} 的所有站点 URL 都不包含 urlFeature，删除整条记录`);
        await chrome.storage.local.set({ pkHistory: pkHistory });
        if (typeof window.firebaseSyncUploadIfLoggedIn === 'function') window.firebaseSyncUploadIfLoggedIn();
        return;
      }
    }
    
    // 保存更新后的历史记录
    await chrome.storage.local.set({ pkHistory: pkHistory });
    if (typeof window.firebaseSyncUploadIfLoggedIn === 'function') window.firebaseSyncUploadIfLoggedIn();
    
    console.log(`✅ 更新历史记录 ${historyId} 中 ${siteName} 的 URL:`, url);
  } catch (error) {
    console.error('更新历史记录站点 URL 失败:', error);
  }
}

// 全页面快速 tooltip（约 100ms 显示，替代原生 title 的长时间延迟），显示时暂时移除 title 避免原生提示再出现
function initQuickTooltips() {
  const tooltip = document.getElementById('quickTooltip');
  if (!tooltip) return;
  let showTimer = null;
  let currentEl = null;
  function show(el) {
    const text = el.getAttribute('title') || el.getAttribute('data-original-title');
    if (!text) return;
    currentEl = el;
    el.setAttribute('data-original-title', text);
    el.removeAttribute('title');
    tooltip.textContent = text;
    const rect = el.getBoundingClientRect();
    const tw = tooltip.offsetWidth;
    tooltip.style.left = `${rect.left + (rect.width - tw) / 2}px`;
    tooltip.style.top = `${rect.bottom + 6}px`;
    tooltip.classList.add('visible');
  }
  function hide() {
    if (currentEl) {
      const saved = currentEl.getAttribute('data-original-title');
      if (saved) currentEl.setAttribute('title', saved);
      currentEl.removeAttribute('data-original-title');
      currentEl = null;
    }
    tooltip.classList.remove('visible');
  }
  function getTooltipEl(node) {
    return node && (node.closest('[title]') || node.closest('[data-original-title]'));
  }
  document.body.addEventListener('mouseover', (e) => {
    const el = getTooltipEl(e.target);
    if (!el) return;
    if (showTimer) clearTimeout(showTimer);
    showTimer = setTimeout(() => show(el), 100);
  });
  document.body.addEventListener('mouseout', (e) => {
    const stillOver = getTooltipEl(e.relatedTarget);
    if (stillOver) return;
    if (showTimer) clearTimeout(showTimer);
    showTimer = null;
    hide();
  });
}

// 在页面加载时调用
document.addEventListener('DOMContentLoaded', async () => {
  initializeI18n();
  setDeepResearchButtonBusy(false);
  initializeTimelinePanel();
  const deepResearchButton = getDeepResearchButton();
  if (deepResearchButton) {
    deepResearchButton.addEventListener('click', () => {
      void runDeepResearchAcrossOpenIframes();
    });
  }
  const resetIframePageButton = document.getElementById('resetIframePageButton');
  if (resetIframePageButton) {
    resetIframePageButton.addEventListener('click', () => {
      resetIframePageToDefaultType();
    });
  }
  await initializeFavorites();
  if (typeof window.migrateLegacyFavorites === 'function') await window.migrateLegacyFavorites();
  checkForSiteConfigUpdates();
  initQuickTooltips();
  // 根据当前输入框内容同步收藏按钮显示（解决输入后按钮不显示的问题）
  const searchInput = document.getElementById('searchInput');
  if (searchInput) updateFavoriteButtonVisibility(searchInput.value);
  // 检查剪贴板权限状态
  checkClipboardPermissionStatus();
  // 注意：粘贴事件监听器已在主 DOMContentLoaded 中统一处理，无需重复添加
});


// 检查剪贴板权限状态
async function checkClipboardPermissionStatus() {
  try {
    // 检查是否支持剪贴板API
    if (!navigator.clipboard) {
      console.log('❌ 浏览器不支持剪贴板API');
      return;
    }
    
    const permissionStatus = await navigator.permissions.query({ name: 'clipboard-read' });
    console.log('剪贴板权限状态:', permissionStatus.state);
    
    // 只在权限被拒绝时显示提示，避免在页面加载时打扰用户
    if (permissionStatus.state === 'denied') {
      console.log('❌ 剪贴板权限被拒绝，文件粘贴功能将不可用');
      // 延迟显示提示，避免在页面加载时立即弹出
      setTimeout(() => {
        showClipboardDeniedMessage();
      }, 3000);
    } else if (permissionStatus.state === 'granted') {
      console.log('✅ 剪贴板权限已授予');
    } else {
      console.log('🔄 剪贴板权限状态: prompt，将在用户粘贴时请求');
    }
  } catch (error) {
    console.log('❌ 检查剪贴板权限失败:', error);
  }
}

// 显示剪贴板权限被拒绝的消息
function showClipboardDeniedMessage() {
  const message = document.createElement('div');
  message.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: #f44336;
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    z-index: 10000;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    max-width: 400px;
    text-align: center;
  `;
  
  message.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
      <span>🚫</span>
      <span style="font-weight: 600;">剪贴板权限被拒绝</span>
    </div>
    <div style="font-size: 12px; opacity: 0.9;">
      请在浏览器设置中允许剪贴板访问权限，或点击地址栏左侧的锁图标进行设置
    </div>
  `;
  
  document.body.appendChild(message);
  
  // 5秒后自动关闭
  setTimeout(() => {
    if (message.parentNode) {
      message.remove();
    }
  }, 5000);
}

function getUpdateUiLocale() {
  try {
    const locale = chrome?.i18n?.getUILanguage?.() || navigator.language || 'en';
    return String(locale).replace('_', '-');
  } catch (_) {
    return String(navigator.language || 'en').replace('_', '-');
  }
}

function formatUpdateRelativeTime(timestamp) {
  const value = Number(timestamp);
  if (!Number.isFinite(value) || value <= 0) {
    return t('unknownTime', 'Unknown time');
  }

  const diff = value - Date.now();
  const absDiff = Math.abs(diff);

  try {
    if (typeof Intl !== 'undefined' && typeof Intl.RelativeTimeFormat === 'function') {
      const formatter = new Intl.RelativeTimeFormat(getUpdateUiLocale(), { numeric: 'auto' });
      const units = [
        ['year', 31536000000],
        ['month', 2592000000],
        ['week', 604800000],
        ['day', 86400000],
        ['hour', 3600000],
        ['minute', 60000],
        ['second', 1000]
      ];

      for (const [unit, unitMs] of units) {
        if (absDiff >= unitMs || unit === 'second') {
          return formatter.format(Math.round(diff / unitMs), unit);
        }
      }
    }
  } catch (error) {
    console.warn('Failed to format relative update time:', error);
  }

  const minutes = Math.max(1, Math.round(absDiff / 60000));
  return diff < 0 ? `${minutes}m ago` : `in ${minutes}m`;
}

function formatUpdateAbsoluteTime(timestamp) {
  const value = Number(timestamp);
  if (!Number.isFinite(value) || value <= 0) {
    return t('unknownTime', 'Unknown time');
  }

  const date = new Date(value);
  try {
    return new Intl.DateTimeFormat(getUpdateUiLocale(), {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  } catch (error) {
    console.warn('Failed to format absolute update time:', error);
    try {
      return date.toLocaleString(getUpdateUiLocale());
    } catch (_) {
      return date.toLocaleString();
    }
  }
}

function buildUpdateMetricCards(latestUpdate, siteConfigVersion) {
  const cards = [];
  const versionText = latestUpdate?.version || siteConfigVersion || '';

  if (versionText) {
    cards.push({ tone: 'version', text: `V ${versionText}` });
  }

  if (Number(latestUpdate?.newSites) > 0) {
    cards.push({
      tone: 'success',
      text: t('newSitesCount', 'Added $1 new sites', [latestUpdate.newSites])
    });
  }

  if (Number(latestUpdate?.updatedSites) > 0) {
    cards.push({
      tone: 'warning',
      text: t('updatedSitesCount', 'Updated $1 sites', [latestUpdate.updatedSites])
    });
  }

  if (Number(latestUpdate?.totalSites) > 0) {
    cards.push({
      tone: 'info',
      text: t('totalSitesCount', 'Total $1 sites', [latestUpdate.totalSites])
    });
  }

  if (cards.length === 0) {
    cards.push({
      tone: 'version',
      text: t('unknownTime', 'Unknown time')
    });
  }

  return cards.map(card => `
    <div class="config-update-metric" data-tone="${escapeHtml(card.tone)}">
      <span class="config-update-metric__text">${escapeHtml(card.text)}</span>
    </div>
  `).join('');
}

function buildUpdateHistoryCards(updateHistory, siteConfigVersion) {
  const items = Array.isArray(updateHistory)
    ? updateHistory.filter((update, index, arr) => {
        if (index === arr.length - 1 && update.version === siteConfigVersion) {
          return false;
        }
        return true;
      }).slice(-5).reverse()
    : [];

  if (items.length === 0) {
    return `
      <div class="config-update-dialog__empty">
        <div class="config-update-dialog__empty-title">${escapeHtml(t('noUpdateHistory', 'No update history available'))}</div>
      </div>
    `;
  }

  return items.map(update => {
    const chips = [];
    if (Number(update.newSites) > 0) {
      chips.push(`<span class="config-update-dialog__chip config-update-dialog__chip--success">${escapeHtml(t('newSitesCount', 'Added $1 new sites', [update.newSites]))}</span>`);
    }
    if (Number(update.updatedSites) > 0) {
      chips.push(`<span class="config-update-dialog__chip config-update-dialog__chip--warning">${escapeHtml(t('updatedSitesCount', 'Updated $1 sites', [update.updatedSites]))}</span>`);
    }
    if (Number(update.totalSites) > 0) {
      chips.push(`<span class="config-update-dialog__chip config-update-dialog__chip--info">${escapeHtml(t('totalSitesCount', 'Total $1 sites', [update.totalSites]))}</span>`);
    }

    return `
      <article class="config-update-dialog__history-item">
        <div class="config-update-dialog__history-head">
          <div class="config-update-dialog__history-version">V ${escapeHtml(update.version || siteConfigVersion || '—')}</div>
          <div class="config-update-dialog__history-time">${escapeHtml(formatUpdateAbsoluteTime(update.timestamp))}</div>
        </div>
        ${chips.length > 0 ? `<div class="config-update-dialog__history-chips">${chips.join('')}</div>` : ''}
      </article>
    `;
  }).join('');
}

function getConfigUpdateChangedSiteNames(latestUpdate) {
  const changedSiteNames = Array.isArray(latestUpdate?.changedSiteNames)
    ? latestUpdate.changedSiteNames
    : [
        ...(Array.isArray(latestUpdate?.newSiteNames) ? latestUpdate.newSiteNames : []),
        ...(Array.isArray(latestUpdate?.updatedSiteNames) ? latestUpdate.updatedSiteNames : [])
      ];

  return Array.from(new Set(
    changedSiteNames.map((name) => String(name || '').trim()).filter(Boolean)
  ));
}

function buildConfigUpdateSiteSummary(latestUpdate) {
  const uniqueNames = getConfigUpdateChangedSiteNames(latestUpdate);
  const totalChanged = Number(latestUpdate?.newSites || 0) + Number(latestUpdate?.updatedSites || 0);
  const fallbackCount = Number.isFinite(totalChanged) && totalChanged > 0
    ? totalChanged
    : Number(latestUpdate?.totalSites || 0);

  if (uniqueNames.length > 0) {
    return t('configUpdateToastSubtitleWithNames', '配置文件已更新，涉及以下站点。');
  }

  return t('configUpdateToastSubtitleWithCount', '配置文件已更新，涉及 $1 个站点。', [String(Math.max(1, fallbackCount || 0))]);
}

function buildConfigUpdateSiteList(latestUpdate) {
  const uniqueNames = getConfigUpdateChangedSiteNames(latestUpdate);
  if (uniqueNames.length === 0) {
    return '';
  }

  return `
    <div class="config-update-toast__site-list" aria-label="${escapeHtml(t('configUpdateToastSitesLabel', 'Updated sites'))}">
      ${uniqueNames.map((siteName) => `<span class="config-update-toast__site-chip">${escapeHtml(siteName)}</span>`).join('')}
    </div>
  `;
}


// 检查站点配置更新
async function checkForSiteConfigUpdates() {
  try {
    if (window.RemoteConfigManager) {
      // 首先检查是否有未显示的更新
      const { siteConfigVersion, lastUpdateTime, updateNotificationShown } = await chrome.storage.local.get(['siteConfigVersion', 'lastUpdateTime', 'updateNotificationShown']);
      
      // 如果有更新记录且还没有显示过通知，则显示提示
      if (lastUpdateTime && !updateNotificationShown) {
        console.log('检测到配置更新，显示提示');
        showUpdateNotification();
        // 标记已显示通知，避免重复显示
        await chrome.storage.local.set({ updateNotificationShown: true });
        return;
      }
      
      // 然后检查是否有新的远程更新
      const updateInfo = await window.RemoteConfigManager.autoCheckUpdate();
      if (updateInfo && updateInfo.hasUpdate) {
        console.log('发现新版本站点配置，自动更新');
        // 自动更新配置
        await window.RemoteConfigManager.updateLocalConfig(updateInfo.config);
        // 显示更新成功提示
        showUpdateNotification();
      }
    }
  } catch (error) {
    console.error('检查站点配置更新失败:', error);
  }
}

// 显示更新通知
async function showUpdateNotification() {
  try {
    const { siteConfigVersion, lastUpdateTime, updateHistory } = await chrome.storage.local.get(['siteConfigVersion', 'lastUpdateTime', 'updateHistory']);
    const latestUpdate = Array.isArray(updateHistory) && updateHistory.length > 0
      ? updateHistory[updateHistory.length - 1]
      : null;
    const subtitleText = buildConfigUpdateSiteSummary(latestUpdate);
    const siteListMarkup = buildConfigUpdateSiteList(latestUpdate);

    const notification = document.createElement('div');
    notification.id = 'configUpdateToastShell';
    notification.className = 'config-update-toast-shell';
    notification.setAttribute('role', 'status');
    notification.setAttribute('aria-live', 'polite');
    notification.setAttribute('aria-atomic', 'true');
    notification.dir = 'auto';

    notification.innerHTML = `
      <div class="config-update-toast">
        <button class="config-update-toast__close" type="button" aria-label="${escapeHtml(t('configUpdateToastDismiss', 'Dismiss'))}">×</button>
        <div class="config-update-toast__header">
          <div class="config-update-toast__copy">
            <div class="config-update-toast__title-row">
              <div class="config-update-toast__title">${escapeHtml(t('configUpdateToastTitle', 'Configuration updated'))}</div>
              <span class="config-update-toast__time">${escapeHtml(formatUpdateRelativeTime(latestUpdate?.timestamp || lastUpdateTime))}</span>
            </div>
            <div class="config-update-toast__subtitle">${escapeHtml(subtitleText)}</div>
            ${siteListMarkup}
          </div>
        </div>
        <div class="config-update-toast__actions">
          <button class="config-update-toast__button config-update-toast__button--secondary" type="button">${escapeHtml(t('configUpdateToastDismiss', 'Got it'))}</button>
        </div>
      </div>
    `;

    const toastCard = notification.querySelector('.config-update-toast');
    const dismissButtons = notification.querySelectorAll('.config-update-toast__close, .config-update-toast__button--secondary');
    let autoHideTimer = null;
    let isClosing = false;

    const clearAutoHide = () => {
      if (autoHideTimer) {
        clearTimeout(autoHideTimer);
        autoHideTimer = null;
      }
    };

    const closeToast = (openDetails = false) => {
      if (isClosing) return;
      isClosing = true;
      clearAutoHide();
      toastCard.classList.remove('is-visible');
      notification.classList.remove('is-visible');

      setTimeout(() => {
        if (notification.parentElement) {
          notification.remove();
        }
      }, 240);
    };

    const scheduleAutoHide = (delayMs = 10000) => {
      clearAutoHide();
      autoHideTimer = setTimeout(() => closeToast(false), delayMs);
    };

    dismissButtons.forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        closeToast(false);
      });
    });

    toastCard.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeToast(false);
        return;
      }
    });

    toastCard.addEventListener('mouseenter', clearAutoHide);
    toastCard.addEventListener('mouseleave', () => scheduleAutoHide(5000));
    toastCard.addEventListener('focusin', clearAutoHide);
    toastCard.addEventListener('focusout', () => {
      if (!toastCard.contains(document.activeElement)) {
        scheduleAutoHide(5000);
      }
    });

    document.body.appendChild(notification);
    requestAnimationFrame(() => {
      notification.classList.add('is-visible');
      toastCard.classList.add('is-visible');
    });

    scheduleAutoHide(10000);
  } catch (error) {
    console.error('显示更新通知失败:', error);
    showToast(t('configUpdateToastFallback', 'Configuration updated, but the notification UI could not be displayed.'));
  }
}

// 显示详细更新信息
async function showDetailedUpdateInfo() {
  try {
    const { updateHistory, siteConfigVersion, lastUpdateTime } = await chrome.storage.local.get(['updateHistory', 'siteConfigVersion', 'lastUpdateTime']);
    const latestUpdate = Array.isArray(updateHistory) && updateHistory.length > 0
      ? updateHistory[updateHistory.length - 1]
      : null;

    const existingOverlay = document.getElementById('configUpdateDialogOverlay');
    if (existingOverlay) {
      existingOverlay.remove();
    }

    const overlay = document.createElement('div');
    overlay.id = 'configUpdateDialogOverlay';
    overlay.className = 'config-update-dialog-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'configUpdateDialogTitle');
    overlay.dir = 'auto';

    overlay.innerHTML = `
      <div class="config-update-dialog">
        <div class="config-update-dialog__hero">
          <button class="config-update-dialog__close" type="button" aria-label="${escapeHtml(t('configUpdateDetailsClose', 'Close'))}">×</button>
          <div class="config-update-dialog__eyebrow">
            <span class="config-update-dialog__badge">${escapeHtml(t('configUpdateToastTag', 'Configuration update'))}</span>
            <span class="config-update-dialog__time">${escapeHtml(formatUpdateRelativeTime(latestUpdate?.timestamp || lastUpdateTime))}</span>
          </div>
          <h2 class="config-update-dialog__title" id="configUpdateDialogTitle">${escapeHtml(t('configUpdateDetailsTitle', 'Update details'))}</h2>
          <p class="config-update-dialog__subtitle">${escapeHtml(t('configUpdateDetailsSubtitle', 'Recent version records, site changes, and sync source.'))}</p>
          <div class="config-update-metrics config-update-metrics--dialog">
            ${buildUpdateMetricCards(latestUpdate, siteConfigVersion)}
          </div>
        </div>
        <div class="config-update-dialog__body">
          <section class="config-update-dialog__section">
            <div class="config-update-dialog__section-header">
              <h3 class="config-update-dialog__section-title">${escapeHtml(t('recentUpdateRecords', 'Recent Update Records'))}</h3>
            </div>
            <div class="config-update-dialog__history-list">
              ${buildUpdateHistoryCards(updateHistory, siteConfigVersion)}
            </div>
          </section>
        </div>
        <div class="config-update-dialog__footer">
          <button class="config-update-dialog__button config-update-dialog__button--secondary" type="button" data-action="source">${escapeHtml(t('configUpdateDetailsSource', 'Open source file'))}</button>
          <button class="config-update-dialog__button config-update-dialog__button--primary" type="button" data-action="refresh">${escapeHtml(t('checkUpdates', 'Check updates'))}</button>
        </div>
      </div>
    `;

    const panel = overlay.querySelector('.config-update-dialog');
    const closeButton = overlay.querySelector('.config-update-dialog__close');
    const sourceButton = overlay.querySelector('[data-action="source"]');
    const refreshButton = overlay.querySelector('[data-action="refresh"]');
    let isClosing = false;

    const handleEsc = (e) => {
      if (e.key === 'Escape') {
        closeModal();
      }
    };

    const closeModal = () => {
      if (isClosing) return;
      isClosing = true;
      overlay.classList.remove('is-visible');
      panel.classList.remove('is-visible');
      document.removeEventListener('keydown', handleEsc);

      setTimeout(() => {
        if (overlay.parentElement) {
          overlay.remove();
        }
      }, 260);
    };

    closeButton.addEventListener('click', closeModal);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeModal();
      }
    });

    sourceButton.addEventListener('click', () => {
      window.open('https://github.com/taoAIGC/AI-Shortcuts/blob/main/config/siteHandlers.json', '_blank', 'noopener,noreferrer');
    });

    refreshButton.addEventListener('click', async () => {
      const originalText = refreshButton.textContent;
      refreshButton.textContent = t('refreshConfigChecking', 'Checking for updates...');
      refreshButton.disabled = true;

      try {
        if (window.RemoteConfigManager) {
          const updateInfo = await window.RemoteConfigManager.autoCheckUpdate();
          if (updateInfo && updateInfo.hasUpdate) {
            await window.RemoteConfigManager.updateLocalConfig(updateInfo.config);
            closeModal();
            showToast(t('refreshConfigUpdated', 'Configuration has been updated to the latest version.'));
            setTimeout(() => showUpdateNotification(), 500);
          } else {
            showToast(t('refreshConfigLatest', 'Already up to date.'));
          }
        } else {
          showToast(t('refreshConfigUnavailable', 'Update check is unavailable.'));
        }
      } catch (error) {
        console.error('检查更新失败:', error);
        showToast(t('refreshConfigFailed', 'Failed to check for updates.'));
      } finally {
        refreshButton.textContent = originalText;
        refreshButton.disabled = false;
      }
    });

    document.addEventListener('keydown', handleEsc);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => {
      overlay.classList.add('is-visible');
      panel.classList.add('is-visible');
    });
    closeButton.focus();
  } catch (error) {
    console.error('显示详细更新信息失败:', error);
    showToast(t('updateInfoShowFailed', 'Failed to show update details.'));
  }
}


// 收藏功能实现
let favoritePrompts = [];

// 初始化收藏功能
async function initializeFavorites() {
  try {
    const { favoritePrompts: savedFavorites = [] } = await chrome.storage.sync.get('favoritePrompts');
    favoritePrompts = savedFavorites;
    console.log('加载的收藏提示词:', favoritePrompts);
  } catch (error) {
    console.error('加载收藏提示词失败:', error);
  }
}

// 更新收藏按钮的显示状态
function updateFavoriteButtonVisibility(query) {
  const favoriteButton = document.getElementById('favoriteButton');
  const favoriteIcon = document.getElementById('favoriteIcon');
  if (!favoriteButton || !favoriteIcon) return;

  const trimmed = typeof query === 'string' ? query.trim() : '';
  if (trimmed) {
    favoriteButton.style.display = 'block';
    // 检查当前文本是否已收藏
    const isFavorited = favoritePrompts.includes(trimmed);
    favoriteIcon.src = isFavorited ? '../icons/star_saved.svg' : '../icons/star_unsaved.svg';
  } else {
    favoriteButton.style.display = 'none';
  }
}

// 切换收藏状态
async function toggleFavorite() {
  const searchInput = document.getElementById('searchInput');
  const query = searchInput.value.trim();
  const favoriteIcon = document.getElementById('favoriteIcon');
  
  if (!query) return;
  
  try {
    const index = favoritePrompts.indexOf(query);
    
    if (index > -1) {
      // 取消收藏
      favoritePrompts.splice(index, 1);
      favoriteIcon.src = '../icons/star_unsaved.svg';
      console.log('取消收藏:', query);
      // 埋点：取消收藏提示词
      trackEvent('iframe_prompt_favorite_toggle', {
        query_length: query.length,
        is_favorite: false
      });
    } else {
      // 添加收藏
      favoritePrompts.push(query);
      favoriteIcon.src = '../icons/star_saved.svg';
      console.log('添加收藏:', query);
      // 埋点：添加收藏提示词
      trackEvent('iframe_prompt_favorite_toggle', {
        query_length: query.length,
        is_favorite: true
      });
    }
    
    // 保存到存储
    await chrome.storage.sync.set({ favoritePrompts: favoritePrompts });
    console.log('收藏列表已更新:', favoritePrompts);
    if (typeof window.firebaseSyncUploadFavoritesIfLoggedIn === 'function') window.firebaseSyncUploadFavoritesIfLoggedIn();
  } catch (error) {
    console.error('保存收藏失败:', error);
  }
}

// 显示收藏夹
function showFavorites() {
  const queryList = document.getElementById('queryList');
  
  if (favoritePrompts.length === 0) {
    const favoritesTitle = chrome.i18n.getMessage('favoritesTitle');
    const noFavoritesMessage = chrome.i18n.getMessage('noFavorites');
    queryList.innerHTML = `<div class="favorites-section"><div class="favorites-title">${favoritesTitle}</div><div style="padding: 10px; color: #666; text-align: center;">${noFavoritesMessage}</div></div>`;
  } else {
    const favoritesTitle = chrome.i18n.getMessage('favoritesTitle');
    let html = `<div class="favorites-section"><div class="favorites-title">${favoritesTitle}</div>`;
    
    favoritePrompts.forEach((prompt, index) => {
      html += `
        <div class="favorite-item" data-prompt="${prompt.replace(/"/g, '&quot;')}" data-index="${index}">
          <div class="favorite-item-content">${prompt}</div>
          <div class="favorite-item-actions">
          
           <!--
            <button class="favorite-item-edit" title="编辑">
              <img src="../icons/edit.svg" alt="编辑">
            </button>
            -->

            <button class="favorite-item-delete" title="删除">
              <img src="../icons/close.svg" alt="删除">
            </button>
           
          </div>
        </div>
      `;
    });
    
    html += '</div>';
    queryList.innerHTML = html;
    
    // 添加点击事件
    queryList.querySelectorAll('.favorite-item').forEach(item => {
      const content = item.querySelector('.favorite-item-content');
      const editBtn = item.querySelector('.favorite-item-edit');
      const deleteBtn = item.querySelector('.favorite-item-delete');
      
      // 点击内容区域选择提示词
      content.addEventListener('click', (e) => {
        e.stopPropagation();
        const prompt = item.getAttribute('data-prompt');
        document.getElementById('searchInput').value = prompt;
        queryList.style.display = 'none';
        document.getElementById('toggleIcon').src = '../icons/down.svg';
        
        // 更新收藏按钮状态
        updateFavoriteButtonVisibility(prompt);

        // 埋点：从收藏列表选择提示词
        trackEvent('iframe_prompt_favorite_select', {
          query_length: prompt.length
        });
      });
      
      // 编辑按钮点击事件（如果存在）
      if (editBtn) {
        editBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          editFavoriteItem(item);
        });
      }
      
      // 删除按钮点击事件
      if (deleteBtn) {
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          console.log('删除按钮被点击');
          deleteFavoriteItem(item);
        });
      }
    });
  }
  
  // 埋点：打开提示词收藏列表
  trackEvent('iframe_prompt_favorites_open', {
    favorites_count: favoritePrompts.length
  });

  queryList.style.display = 'block';
}

// 编辑收藏项
function editFavoriteItem(item) {
  console.log('进入编辑收藏项');
  // 埋点：点击编辑收藏提示词（功能预留）
  try {
    const prompt = item.getAttribute('data-prompt');
    trackEvent('iframe_prompt_favorite_edit_click', {
      query_length: prompt ? prompt.length : 0
    });
  } catch (e) {
    // 忽略埋点中的异常，避免影响主流程
    console.warn('记录编辑收藏埋点失败:', e);
  }
  showToast('coming soon');
}

// 删除收藏项
async function deleteFavoriteItem(item) {
  console.log('deleteFavoriteItem 函数被调用');
  const index = parseInt(item.getAttribute('data-index'));
  const prompt = item.getAttribute('data-prompt');
  console.log('删除索引:', index, '提示词:', prompt);
  
  const deleteConfirmMessage = chrome.i18n.getMessage('deleteConfirm');
  if (confirm(deleteConfirmMessage)) {
    try {
      // 从数组中删除
      favoritePrompts.splice(index, 1);
      
      // 保存到存储
      await chrome.storage.sync.set({ favoritePrompts: favoritePrompts });
      if (typeof window.firebaseSyncUploadFavoritesIfLoggedIn === 'function') window.firebaseSyncUploadFavoritesIfLoggedIn();
      // 重新显示收藏夹
      showFavorites();
      
      console.log('删除收藏提示词:', prompt);
      // 埋点：删除收藏提示词
      trackEvent('iframe_prompt_favorite_delete', {
        query_length: prompt ? prompt.length : 0
      });
    } catch (error) {
      console.error('删除收藏失败:', error);
    }
  }
}

// 添加拖拽排序功能到导航列表
function addDragAndDropToNavList(navList, enabledSites) {
  let draggedElement = null;
  let draggedIndex = null;

  // 拖拽开始
  navList.addEventListener('dragstart', (e) => {
    if (e.target.classList.contains('nav-item')) {
      draggedElement = e.target;
      draggedIndex = Array.from(navList.children).indexOf(e.target);
      e.target.classList.add('dragging');
      navList.classList.add('drag-active');
      
      // 设置拖拽数据
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/html', e.target.outerHTML);
    }
  });

  // 拖拽结束
  navList.addEventListener('dragend', (e) => {
    if (e.target.classList.contains('nav-item')) {
      e.target.classList.remove('dragging');
      navList.classList.remove('drag-active');
      
      // 移除所有拖拽悬停效果
      navList.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('drag-over');
      });
      
      draggedElement = null;
      draggedIndex = null;
    }
  });

  // 拖拽悬停
  navList.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    
    const afterElement = getDragAfterElement(navList, e.clientY);
    const dragging = navList.querySelector('.dragging');
    
    if (afterElement == null) {
      navList.appendChild(dragging);
    } else {
      navList.insertBefore(dragging, afterElement);
    }
  });

  // 拖拽进入
  navList.addEventListener('dragenter', (e) => {
    e.preventDefault();
    if (e.target.classList.contains('nav-item') && e.target !== draggedElement) {
      e.target.classList.add('drag-over');
    }
  });

  // 拖拽离开
  navList.addEventListener('dragleave', (e) => {
    if (e.target.classList.contains('nav-item')) {
      e.target.classList.remove('drag-over');
    }
  });

  // 拖拽放置
  navList.addEventListener('drop', async (e) => {
    e.preventDefault();
    
    if (draggedElement) {
      const newIndex = Array.from(navList.children).indexOf(draggedElement);
      
      if (newIndex !== draggedIndex) {
        // 更新站点顺序
        await updateSitesOrder(enabledSites, draggedIndex, newIndex);
        
        // 重新排列iframe
        await reorderIframes(draggedIndex, newIndex);
        
        console.log('导航项顺序已更新');
      }
    }
  });
}

// 获取拖拽后的元素位置
function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll('.nav-item:not(.dragging)')];
  
  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    
    if (offset < 0 && offset > closest.offset) {
      return { offset: offset, element: child };
    } else {
      return closest;
    }
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

// 更新站点顺序
async function updateSitesOrder(enabledSites, fromIndex, toIndex) {
  // 移动数组中的元素
  const movedSite = enabledSites.splice(fromIndex, 1)[0];
  enabledSites.splice(toIndex, 0, movedSite);
  
  try {
    // 从 chrome.storage.sync 读取现有的用户设置
    const { sites: existingUserSettings = {} } = await chrome.storage.sync.get('sites');
    
    // 更新拖拽后站点的order字段
    const updatedUserSettings = { ...existingUserSettings };
    enabledSites.forEach((site, index) => {
      if (!updatedUserSettings[site.name]) {
        updatedUserSettings[site.name] = {};
      }
      updatedUserSettings[site.name].order = index;
    });
    
    // 保存用户设置到 chrome.storage.sync
    await chrome.storage.sync.set({ sites: updatedUserSettings });
    
    console.log('iframe侧边栏站点顺序已保存到 sync 存储');
  } catch (error) {
    console.error('保存站点顺序失败:', error);
  }
}

// 重新排列iframe
async function reorderIframes(fromIndex, toIndex) {
  const container = document.getElementById('iframes-container');
  const iframeContainers = Array.from(container.querySelectorAll('.iframe-container'));
  
  if (iframeContainers.length > 0) {
    // 获取导航项的新顺序
    const navList = document.querySelector('.nav-list');
    const navItems = Array.from(navList.children);
    
    // 为每个iframe容器设置CSS order属性，避免移动DOM元素
    navItems.forEach((navItem, index) => {
      const siteName = navItem.dataset.siteName || navItem.textContent.trim();
      const iframeContainer = iframeContainers.find(container => {
        const iframe = container.querySelector('iframe');
        return iframe && iframe.getAttribute('data-site') === siteName;
      });
      
      if (iframeContainer) {
        // 使用CSS order属性来控制显示顺序，不移动DOM元素
        iframeContainer.style.order = index;
      }
    });
    
    // CSS Grid布局已经支持order属性，无需额外设置
    
    console.log('iframe顺序已更新，使用CSS order属性');
  }
}

// 初始化文件上传功能
function initializeFileUpload() {
  const fileUploadButton = document.getElementById('fileUploadButton');
  const fileInput = document.getElementById('fileInput');
  
  if (!fileUploadButton || !fileInput) {
    console.warn('文件上传元素未找到');
    return;
  }
  
  // 点击上传按钮触发文件选择
  fileUploadButton.addEventListener('click', () => {
    trackEvent('iframe_upload_click', {
      trigger: 'button'
    });
    fileInput.click();
  });
  
  // 文件选择变化时处理
  fileInput.addEventListener('change', handleFileSelection);
  
  console.log('🎯 文件上传功能已初始化');
}

// 当前批次文件上传状态（用于进度提示）
let currentUploadBatch = null;

// 简单的 HTML 转义，避免文件名插入到 innerHTML 时出现问题
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 处理文件选择
async function handleFileSelection(event) {
  const files = event.target.files;
  
  if (!files || files.length === 0) {
    console.log('未选择文件');
    return;
  }
  
  console.log('🎯 用户选择了文件:', files.length, '个');
  
  // 逐个处理文件，避免并发触发上传流程
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    currentUploadBatch = {
      index: index + 1,
      total: files.length,
      name: file.name
    };
    
    const result = await processUploadedFile(file);
    
    if (!result.ok) {
      const remaining = files.length - index - 1;
      const remainingText = remaining > 0 ? `，继续处理剩余 ${remaining} 个文件` : '';
      const reason = result.errorMessage ? `：${result.errorMessage}` : '';
      showFileUploadError(`文件 "${file.name}" 处理失败${reason}${remainingText}`);
    }
  }
  
  currentUploadBatch = null;
  
  // 清空input，允许重复选择同一文件
  event.target.value = '';
}

// 处理上传的文件
async function processUploadedFile(file) {
  console.log('🎯 开始处理上传的文件:', {
    name: file.name,
    type: file.type,
    size: file.size,
    lastModified: file.lastModified
  });
  
  // 文件大小检查（限制50MB）
  const maxSize = 50 * 1024 * 1024; // 50MB
  if (file.size > maxSize) {
    return {
      ok: false,
      errorMessage: `文件大小超过限制（${Math.round(maxSize / 1024 / 1024)}MB）`
    };
  }
  
  try {
    // 读取文件内容
    const arrayBuffer = await file.arrayBuffer();
    const blob = new Blob([arrayBuffer], { type: file.type });
    
    // 创建文件数据对象
    const fileData = {
      type: file.type,
      blob: blob,
      fileName: file.name,
      originalName: file.name,
      size: file.size,
      lastModified: file.lastModified
    };
    
    console.log('🎯 文件数据准备完成:', fileData);
    
    // 调用现有的多iframe文件处理流程
    const ok = await processFileToAllIframes(fileData);
    if (!ok) {
      return { ok: false, errorMessage: '没有找到可用的AI站点' };
    }
    
    return { ok: true };
    
  } catch (error) {
    console.error('❌ 文件处理失败:', error);
    return {
      ok: false,
      errorMessage: `文件处理失败: ${error.message}`
    };
  }
}

// 向所有iframe发送文件
async function processFileToAllIframes(fileData) {
  console.log('🎯 开始向所有iframe发送文件');
  
  // 获取所有 iframe 元素
  const iframes = document.querySelectorAll('.ai-iframe');
  console.log(`找到 ${iframes.length} 个 iframe`);
  
  if (iframes.length === 0) {
    showFileUploadError('没有找到可用的AI站点');
    return false;
  }
  
  // 调用现有的文件上传处理流程
  await executeFileUploadSequentially(iframes, fileData);
  
  return true;
}

// 显示文件上传错误
function showFileUploadError(message) {
  const error = document.createElement('div');
  error.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: linear-gradient(135deg, #ff6b6b, #ee5a24);
    color: white;
    padding: 16px 24px;
    border-radius: 12px;
    box-shadow: 0 8px 25px rgba(0,0,0,0.3);
    z-index: 10001;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    max-width: 400px;
    text-align: center;
    animation: slideInScale 0.3s ease-out;
  `;
  
  const safeMessage = escapeHtml(message);
  
  error.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
      <span style="font-size: 18px;">❌</span>
      <span style="font-weight: 600;">文件上传失败</span>
    </div>
    <div style="font-size: 13px; opacity: 0.9;">${safeMessage}</div>
  `;
  
  document.body.appendChild(error);
  
  // 3秒后自动关闭
  setTimeout(() => {
    if (error.parentElement) {
      error.remove();
    }
  }, 3000);
}
