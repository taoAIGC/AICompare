import {
  getIframeLoadBehavior
} from '../shared/iframe-query-run-utils.mjs';
import {
  resolveLiveSummaryAutoAnalysisDueAt
} from './live-summary-utils.mjs';

const SiteLaunchUtils = window.SiteLaunchUtils || {};
const AgentCatalog = window.AICompareAgentCatalog || {};
const AgentEngineConfig = window.AICompareAgentEngineConfig || {};
const AgentPromptUtils = window.AICompareAgentPromptUtils || {};
const HybridHistoryDB = window.AICompareHybridHistoryDB || {};
const MarkdownRenderer = window.AICompareMarkdownRenderer || {};
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
const LIVE_SUMMARY_ANALYSIS_STREAM_PORT_NAME = 'standalone-analysis-stream';
const AGENT_ENGINE_STORAGE_KEY = 'agentEngineConfig';
const AGENT_ENGINE_SECRET_STORAGE_KEY = 'agentEngineSecret';
const AGENT_ENGINE_SETTINGS_STORAGE_KEY = 'agentEngineSettings';
const AGENT_CUSTOM_SETTINGS_STORAGE_KEY = AgentCatalog.AGENT_CUSTOM_SETTINGS_STORAGE_KEY || 'agentCustomSettings';
const CUSTOM_AGENTS_STORAGE_KEY = AgentCatalog.CUSTOM_AGENTS_STORAGE_KEY || 'customAgents';
const AGENT_HIDDEN_IDS_STORAGE_KEY = AgentCatalog.AGENT_HIDDEN_IDS_STORAGE_KEY || 'agentHiddenIds';
const DEFAULT_ANALYSIS_TEMPLATE_ID_STORAGE_KEY = 'defaultAnalysisTemplateId';

async function ensureIframeAgentCatalogReady() {
  if (typeof window.hydrateBundledAgentCatalogIfNeeded === 'function') {
    await window.hydrateBundledAgentCatalogIfNeeded().catch(() => false);
  }
  if (typeof window.AICompareAgentCatalog?.ensureCatalogHydrated === 'function') {
    await window.AICompareAgentCatalog.ensureCatalogHydrated().catch(() => null);
  }
}

// 全局文件粘贴检测和处理
let filePasteHandlerAdded = false;

// 跟踪输入法组合输入状态（用于中文输入法）
let isComposing = false;
let searchBarAutoCollapseArmed = false;
let searchBarCollapseTimer = null;
let iframeSubmitShortcutMode = IFRAME_DEFAULT_SEND_SHORTCUT;
const LIVE_SUMMARY_RECHECK_DELAY_MS = 1200;
const LIVE_SUMMARY_AUTO_ANALYSIS_DELAY_MS = 60000;
const liveSummaryContext = {
  analysisQuery: '',
  analysisTemplates: [],
  selectedAnalysisTemplateId: '',
  requestGeneration: 0,
  requestSequenceByEntryKey: new Map(),
  analysisPortsByEntryKey: new Map()
};
const liveSummaryState = {
  activeEntryKey: '',
  visibleEntryKeys: [],
  status: 'hidden',
  version: 0,
  displayedVersion: 0,
  expandedEntryKeys: new Set(),
  analyzingEntryKeys: new Set(),
  pendingTimersByEntryKey: new Map(),
  autoAnalysisTimersByEntryKey: new Map(),
  hintTimer: null,
  updatedAt: '',
  readySignature: '',
  compareSites: [],
  lastGeneratedEntryKey: '',
  summariesByEntryKey: new Map()
};

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

async function refreshIframeVisibleQuerySuggestions() {
  const searchInput = document.getElementById('searchInput');
  const querySuggestions = document.getElementById('querySuggestions');
  if (!searchInput || !querySuggestions || querySuggestions.style.display === 'none') {
    return;
  }

  const query = String(searchInput.value || '').trim();
  if (!query) {
    querySuggestions.innerHTML = '';
    querySuggestions.style.display = 'none';
    return;
  }

  try {
    await showQuerySuggestions(query);
  } catch (error) {
    console.warn('Failed to refresh iframe query suggestions:', error);
  }
}

async function refreshOpenAnalysisTemplateSelects() {
  const previousLiveSummaryTemplateId = String(liveSummaryContext.selectedAnalysisTemplateId || '').trim();
  const overlays = Array.from(document.querySelectorAll('.timeline-copy-preview-overlay'));
  const overlayTasks = overlays.length
    ? overlays.map(async (overlay) => {
        const selectEl = overlay?.querySelector?.('.timeline-copy-preview-analysis-select');
        if (!(selectEl instanceof HTMLSelectElement)) {
          return;
        }

        const selectedTemplateId = String(
          overlay.__timelineSelectedAnalysisTemplateId
          || selectEl.value
          || ''
        ).trim();

        try {
          await hydrateAnalysisTemplateSelect(overlay, selectedTemplateId);
        } catch (error) {
          console.warn('Failed to refresh analysis template select:', error);
        }
      })
    : [];

  overlayTasks.push((async () => {
    try {
      await hydrateLiveSummaryAnalysisTemplateSelect(liveSummaryContext.selectedAnalysisTemplateId);
    } catch (error) {
      console.warn('Failed to refresh live summary analysis template select:', error);
    }
  })());

  await Promise.all(overlayTasks);

  const nextLiveSummaryTemplateId = String(liveSummaryContext.selectedAnalysisTemplateId || '').trim();
  if (previousLiveSummaryTemplateId !== nextLiveSummaryTemplateId) {
    const query = getLiveSummaryCurrentQuery();
    const entryKey = getLiveSummaryCurrentEntryKey();
    if (query) {
      void refreshLiveSummaryForCurrentQuery({
        query,
        entryKey,
        preserveActiveEntry: true
      }).catch((error) => {
        console.warn('刷新自动总结分析模板后的结果失败:', error);
      });
    }
  }
}

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync' && changes.buttonConfig) {
    applyIframeSubmitShortcutMode(changes.buttonConfig.newValue || {});
  }
  if (namespace === 'sync' && changes.promptTemplates) {
    void refreshIframeVisibleQuerySuggestions();
  }
  if (namespace === 'sync' && changes.analysisPromptTemplates) {
    void refreshOpenAnalysisTemplateSelects();
  }
  if (namespace === 'sync' && changes[DEFAULT_ANALYSIS_TEMPLATE_ID_STORAGE_KEY]) {
    void refreshOpenAnalysisTemplateSelects();
  }
  if (namespace === 'local' && changes[AGENT_HIDDEN_IDS_STORAGE_KEY]) {
    renderSideNav().catch((error) => {
      console.warn('Failed to refresh side nav after hidden agent update:', error);
    });
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
  shown: false,
  previousFocus: null
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
  : ((entry, existingEntries = []) => {
      const normalizedQuery = String(entry?.query || '').trim();
      const explicitOccurrenceIndex = Number.isFinite(Number(entry?.occurrenceIndex))
        ? Math.max(0, Number(entry.occurrenceIndex) || 0)
        : null;
      const occurrenceIndex = explicitOccurrenceIndex !== null
        ? explicitOccurrenceIndex
        : (Array.isArray(existingEntries) ? existingEntries : []).filter((item) => item && item.normalizedQuery === normalizedQuery).length;
      return {
        ...entry,
        query: normalizedQuery,
        normalizedQuery,
        occurrenceIndex,
        timelineId: String(entry?.historyId || Date.now())
      };
    });
const timelineBuildCopyText = typeof TimelineUtils.buildTimelineCopyText === 'function'
  ? TimelineUtils.buildTimelineCopyText
  : ((entry, responses) => JSON.stringify({ entry, responses }, null, 2));
const timelineBuildEntryKey = typeof TimelineUtils.buildTimelineEntryKey === 'function'
  ? TimelineUtils.buildTimelineEntryKey
  : ((entry) => {
      const normalizedQuery = String(entry?.normalizedQuery || entry?.query || '').trim();
      const occurrenceIndex = Math.max(0, Number(entry?.occurrenceIndex) || 0);
      return normalizedQuery ? `${normalizedQuery}::${occurrenceIndex}` : '';
    });
const timelineFindEntryByKey = typeof TimelineUtils.findTimelineEntryByKey === 'function'
  ? TimelineUtils.findTimelineEntryByKey
  : ((entries, entryKey) => (Array.isArray(entries) ? entries : []).find((entry) => timelineBuildEntryKey(entry) === String(entryKey || '').trim()) || null);
const timelineFindEntryByTimelineId = typeof TimelineUtils.findTimelineEntryByTimelineId === 'function'
  ? TimelineUtils.findTimelineEntryByTimelineId
  : ((entries, timelineId) => (Array.isArray(entries) ? entries : []).find((entry) => String(entry?.timelineId || '').trim() === String(timelineId || '').trim()) || null);
const timelineFindEntryByQuery = typeof TimelineUtils.findTimelineEntryByQuery === 'function'
  ? TimelineUtils.findTimelineEntryByQuery
  : ((entries, query) => {
      const normalizedQuery = String(query || '').replace(/\s+/g, ' ').trim();
      if (!normalizedQuery) return null;
      return (Array.isArray(entries) ? entries : []).find((entry) => String(entry?.normalizedQuery || entry?.query || '').trim() === normalizedQuery) || null;
    });
const timelineMergeSnapshots = typeof TimelineUtils.mergeTimelinePromptSnapshots === 'function'
  ? TimelineUtils.mergeTimelinePromptSnapshots
  : ((snapshots) => snapshots || []);
const timelineNormalizeQuery = typeof TimelineUtils.normalizeTimelineQuery === 'function'
  ? TimelineUtils.normalizeTimelineQuery
  : ((query) => String(query || '').replace(/\s+/g, ' ').trim());
const timelineExtractPromptsFromMessages = typeof TimelineUtils.extractTimelinePromptsFromMessages === 'function'
  ? TimelineUtils.extractTimelinePromptsFromMessages
  : ((messages) => (Array.isArray(messages) ? messages
      .filter((message) => message?.role === 'user')
      .map((message) => ({
        text: String(message?.content || '').replace(/\s+/g, ' ').trim()
      }))
      .filter((prompt) => prompt.text) : []));
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
const analysisBuildSharePayload = typeof AnalysisUtils.buildTimelineAnalysisSharePayload === 'function'
  ? AnalysisUtils.buildTimelineAnalysisSharePayload
  : ((payload = {}) => ({
      version: Number(payload.version) || 1,
      entry: payload.entry || null,
      question: String(payload.question || payload.entry?.query || '').trim(),
      summaryText: String(payload.summaryText || payload.copyText || '').trim(),
      responses: Array.isArray(payload.responses) ? payload.responses : [],
      compareSites: Array.isArray(payload.compareSites) ? payload.compareSites : [],
      successCount: Math.max(0, Number(payload.successCount) || 0),
      totalCount: Math.max(0, Number(payload.totalCount) || 0),
      analysisTemplateId: String(payload.analysisTemplateId || '').trim(),
      analysisTemplateName: String(payload.analysisTemplateName || '').trim(),
      analysisTemplateQuery: String(payload.analysisTemplateQuery || '').trim(),
      createdAt: String(payload.createdAt || new Date().toISOString()).trim()
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
const DEFAULT_TIMELINE_SHARE_RELAY_BASE_URL = 'http://64.188.6.42:8789';
function getRuntimeAgentCatalogLocale() {
  if (typeof RuntimeI18n?.getCurrentLocale === 'function') {
    return RuntimeI18n.getCurrentLocale();
  }
  if (typeof AgentCatalog.getRuntimeLocale === 'function') {
    return AgentCatalog.getRuntimeLocale('');
  }
  return '';
}

async function getRemoteSearchRelayBaseUrl() {
  try {
    const settings = await chrome.storage.sync.get('remoteSearchSettings');
    const configuredBaseUrl = String(settings?.remoteSearchSettings?.relayBaseUrl || '').trim().replace(/\/+$/, '');
    return configuredBaseUrl || DEFAULT_TIMELINE_SHARE_RELAY_BASE_URL;
  } catch (_) {
    return DEFAULT_TIMELINE_SHARE_RELAY_BASE_URL;
  }
}
const timelineState = {
  entries: [],
  isOpen: false,
  isPinned: false,
  openMode: null,
  sharePickerActive: false,
  activeTimelineId: null,
  promptSnapshotsBySite: new Map(),
  favoriteEntryKeys: new Set()
};
let timelineSyncTimer = null;
let timelineMessageBridgeInitialized = false;
let agentRuntimeMessageBridgeInitialized = false;
let agentRuntimeKeepalivePorts = new Map();
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
window.addEventListener(AI_COMPARE_RUNTIME_EVENT, () => {
  if (!currentHybridHistorySessionId || isReadonlyHistoryMode) {
    return;
  }
  persistCurrentHybridHistorySession().catch((error) => {
    console.warn('站点运行时更新后保存 hybrid 历史失败:', error);
  });
});

// Keep iframe permissions narrow to avoid cross-site browser permission prompts
// when opening many third-party AI sites in parallel.
const IFRAME_ALLOW_PERMISSIONS = 'clipboard-read; clipboard-write; autoplay; fullscreen; picture-in-picture';

async function getReviewUrlFromConfig() {
  const fallbackUrl = window.ExtensionEnvironment?.getChromeWebStoreReviewUrl?.()
    || 'https://chromewebstore.google.com/detail/dkhpgbbhlnmjbkihoeniojpkggkabbbl/reviews';
  try {
    if (window.AppConfigManager?.loadConfig) {
      const config = await window.AppConfigManager.loadConfig();
      const externalLinks = config?.externalLinks || {};
      if (window.ExtensionEnvironment?.getChromeWebStoreReviewUrl) {
        return window.ExtensionEnvironment.getChromeWebStoreReviewUrl(externalLinks);
      }
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
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && overlay.contains(activeElement)) {
      const previousFocus = ratingPromptState.previousFocus;
      if (previousFocus instanceof HTMLElement && document.contains(previousFocus)) {
        previousFocus.focus({ preventScroll: true });
      } else {
        activeElement.blur();
      }
    }
    ratingPromptState.previousFocus = null;
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
        const activeElement = document.activeElement;
        ratingPromptState.previousFocus = activeElement instanceof HTMLElement ? activeElement : null;
        overlay.setAttribute('aria-hidden', 'false');
        overlay.classList.add('is-visible');
        const primaryButton = overlay.querySelector('.rating-modal-primary');
        primaryButton?.focus({ preventScroll: true });
        trackEvent(kind === 'reminder' ? 'rating_prompt_reminder_shown' : 'rating_prompt_shown');
      }
    }, 120000);
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
    const message = window.RuntimeI18n?.getMessage?.(key, substitutions) || chrome?.i18n?.getMessage(key, substitutions);
    return message || fallback;
  } catch (_) {
    return fallback;
  }
}

function getLiveSummaryElements() {
  return {
    card: document.getElementById('liveSummaryCard'),
    title: document.getElementById('liveSummaryTitle'),
    tabs: document.getElementById('liveSummaryTabs'),
    pendingSummarizeButton: document.getElementById('liveSummaryPendingSummarizeButton'),
    hint: document.getElementById('liveSummaryHint'),
    meta: document.getElementById('liveSummaryMeta'),
    body: document.getElementById('liveSummaryCardBody'),
    content: document.getElementById('liveSummaryContent'),
    actionsCluster: document.querySelector('#liveSummaryCard .live-summary-actions-cluster'),
    sites: document.getElementById('liveSummarySites'),
    retryCluster: document.getElementById('liveSummaryRetryCluster'),
    analysisTemplateSelect: document.getElementById('liveSummaryAnalysisTemplateSelect'),
    shareButton: document.getElementById('liveSummaryShareButton'),
    downloadButton: document.getElementById('liveSummaryDownloadButton'),
    copyButton: document.getElementById('liveSummaryCopyButton'),
    immediateAnalyzeButton: document.getElementById('liveSummaryImmediateAnalyzeButton')
  };
}

function clearLiveSummaryPendingTimer() {
  const normalizedEntryKey = String(arguments[0] || '').trim();
  if (normalizedEntryKey) {
    const timer = liveSummaryState.pendingTimersByEntryKey.get(normalizedEntryKey);
    if (timer) {
      clearTimeout(timer);
      liveSummaryState.pendingTimersByEntryKey.delete(normalizedEntryKey);
    }
    return;
  }

  liveSummaryState.pendingTimersByEntryKey.forEach((timer) => {
    clearTimeout(timer);
  });
  liveSummaryState.pendingTimersByEntryKey.clear();
}

function clearLiveSummaryAutoAnalysisTimer(entryKey = '') {
  const normalizedEntryKey = String(entryKey || '').trim();
  if (normalizedEntryKey) {
    const timer = liveSummaryState.autoAnalysisTimersByEntryKey.get(normalizedEntryKey);
    if (timer) {
      clearTimeout(timer);
      liveSummaryState.autoAnalysisTimersByEntryKey.delete(normalizedEntryKey);
    }
    return;
  }

  liveSummaryState.autoAnalysisTimersByEntryKey.forEach((timer) => {
    clearTimeout(timer);
  });
  liveSummaryState.autoAnalysisTimersByEntryKey.clear();
}

function getLiveSummaryAutoAnalysisDueAt(query = '', entryKey = '') {
  const record = getLiveSummaryRecord(query, entryKey);
  return Math.max(0, Number(record?.autoAnalysisDueAt) || 0);
}

function isLiveSummaryEntryExpanded(entryKey = '') {
  const normalizedEntryKey = String(entryKey || '').trim();
  if (!normalizedEntryKey) {
    return false;
  }
  return liveSummaryState.expandedEntryKeys.has(normalizedEntryKey);
}

function setLiveSummaryEntryExpanded(entryKey = '', expanded = false) {
  const normalizedEntryKey = String(entryKey || '').trim();
  if (!normalizedEntryKey) {
    return false;
  }
  if (expanded) {
    liveSummaryState.expandedEntryKeys.add(normalizedEntryKey);
  } else {
    liveSummaryState.expandedEntryKeys.delete(normalizedEntryKey);
  }
  return expanded;
}

function expandLiveSummaryEntryAfterAutoAnalysis(entryKey = '', requestSource = '') {
  const normalizedEntryKey = String(entryKey || '').trim();
  if (!normalizedEntryKey || String(requestSource || '').trim() !== 'auto-analysis') {
    return false;
  }
  if (String(liveSummaryState.activeEntryKey || '').trim() !== normalizedEntryKey) {
    return false;
  }
  if (isLiveSummaryEntryExpanded(normalizedEntryKey)) {
    return false;
  }
  return setLiveSummaryEntryExpanded(normalizedEntryKey, true);
}

function isLiveSummaryEntryAnalyzing(entryKey = '') {
  const normalizedEntryKey = String(entryKey || '').trim();
  if (!normalizedEntryKey) {
    return false;
  }
  return liveSummaryState.analyzingEntryKeys.has(normalizedEntryKey);
}

function setLiveSummaryEntryAnalyzing(entryKey = '', analyzing = false) {
  const normalizedEntryKey = String(entryKey || '').trim();
  if (!normalizedEntryKey) {
    return false;
  }
  if (analyzing) {
    liveSummaryState.analyzingEntryKeys.add(normalizedEntryKey);
  } else {
    liveSummaryState.analyzingEntryKeys.delete(normalizedEntryKey);
  }
  return analyzing;
}

function setLiveSummaryAutoAnalysisDueAt(query = '', entryKey = '', dueAt = 0) {
  const normalizedDueAt = Math.max(0, Number(dueAt) || 0);
  return setLiveSummaryRecord(query, {
    autoAnalysisDueAt: normalizedDueAt
  }, entryKey);
}

function ensureLiveSummaryAutoAnalysisDueAt(query = '', entryKey = '') {
  const currentDueAt = getLiveSummaryAutoAnalysisDueAt(query, entryKey);
  if (currentDueAt) {
    return currentDueAt;
  }
  const nextDueAt = Date.now() + LIVE_SUMMARY_AUTO_ANALYSIS_DELAY_MS;
  setLiveSummaryAutoAnalysisDueAt(query, entryKey, nextDueAt);
  return nextDueAt;
}

function clearLiveSummaryHintTimer() {
  if (liveSummaryState.hintTimer) {
    clearInterval(liveSummaryState.hintTimer);
    liveSummaryState.hintTimer = null;
  }
}

function disconnectLiveSummaryAnalysisPort(entryKey = '', reason = 'replaced') {
  const normalizedEntryKey = String(entryKey || '').trim();
  if (normalizedEntryKey) {
    const port = liveSummaryContext.analysisPortsByEntryKey.get(normalizedEntryKey);
    if (!port) {
      return;
    }
    liveSummaryContext.analysisPortsByEntryKey.delete(normalizedEntryKey);
    try {
      port.__aiCompareExpectedDisconnect = true;
      port.__aiCompareDisconnectReason = String(reason || 'replaced').trim() || 'replaced';
      port.disconnect();
    } catch (_) {
      // ignore
    }
    return;
  }

  liveSummaryContext.analysisPortsByEntryKey.forEach((port, key) => {
    try {
      port.__aiCompareExpectedDisconnect = true;
      port.__aiCompareDisconnectReason = String(reason || 'replaced').trim() || 'replaced';
      port.disconnect();
    } catch (_) {
      // ignore
    }
    liveSummaryContext.analysisPortsByEntryKey.delete(key);
  });
}

function beginLiveSummaryAnalysisRequest(entryKey = '') {
  const normalizedEntryKey = String(entryKey || '').trim();
  if (!normalizedEntryKey) {
    return {
      entryKey: '',
      generation: liveSummaryContext.requestGeneration,
      sequence: 0
    };
  }

  const currentSequence = Math.max(
    0,
    Number(liveSummaryContext.requestSequenceByEntryKey.get(normalizedEntryKey)) || 0
  );
  const nextSequence = currentSequence + 1;
  liveSummaryContext.requestSequenceByEntryKey.set(normalizedEntryKey, nextSequence);
  return {
    entryKey: normalizedEntryKey,
    generation: liveSummaryContext.requestGeneration,
    sequence: nextSequence
  };
}

function isLiveSummaryAnalysisRequestCurrent(token = null) {
  const normalizedEntryKey = String(token?.entryKey || '').trim();
  if (!normalizedEntryKey) {
    return false;
  }
  if (Number(token?.generation) !== liveSummaryContext.requestGeneration) {
    return false;
  }
  const currentSequence = Math.max(
    0,
    Number(liveSummaryContext.requestSequenceByEntryKey.get(normalizedEntryKey)) || 0
  );
  return currentSequence === Math.max(0, Number(token?.sequence) || 0);
}

function normalizeLiveSummaryQuery(query = '') {
  return timelineNormalizeQuery(query);
}

function getLiveSummaryEntryKey(entry) {
  return timelineBuildEntryKey(entry);
}

function getActiveTimelineEntryKey() {
  return getLiveSummaryEntryKey(getActiveTimelineEntry());
}

function getActiveTimelineEntry() {
  return timelineFindEntryByTimelineId(timelineState.entries, timelineState.activeTimelineId);
}

function buildLiveSummaryEntry(query = '', occurrenceIndex = null) {
  return timelineBuildEntry({
    query: normalizeLiveSummaryQuery(query),
    ...(Number.isFinite(Number(occurrenceIndex)) ? { occurrenceIndex: Math.max(0, Number(occurrenceIndex) || 0) } : {})
  }, timelineState.entries);
}

function getLiveSummaryRecordQueryByEntryKey(entryKey = '') {
  const normalizedEntryKey = String(entryKey || '').trim();
  if (!normalizedEntryKey) {
    return '';
  }
  const existingRecord = liveSummaryState.summariesByEntryKey.get(normalizedEntryKey);
  return normalizeLiveSummaryQuery(existingRecord?.query || '');
}

function getLiveSummaryTimelineEntry(query = '', entryKey = '') {
  const normalizedEntryKey = String(entryKey || '').trim();
  if (normalizedEntryKey) {
    const existingEntryByKey = timelineFindEntryByKey(timelineState.entries, normalizedEntryKey);
    if (existingEntryByKey) {
      return existingEntryByKey;
    }
    const occurrenceMatch = normalizedEntryKey.match(/::(\d+)$/);
    const occurrenceIndex = occurrenceMatch ? Number(occurrenceMatch[1]) : null;
    const recordQuery = getLiveSummaryRecordQueryByEntryKey(normalizedEntryKey);
    if (recordQuery) {
      return buildLiveSummaryEntry(recordQuery, occurrenceIndex);
    }
    const normalizedQueryFromArg = normalizeLiveSummaryQuery(query);
    if (normalizedQueryFromArg) {
      return buildLiveSummaryEntry(normalizedQueryFromArg, occurrenceIndex);
    }
  }

  const normalizedQuery = normalizeLiveSummaryQuery(query);
  if (!normalizedQuery) {
    return buildLiveSummaryEntry('');
  }
  const existingEntryByQuery = timelineFindEntryByQuery(timelineState.entries, normalizedQuery);
  if (existingEntryByQuery) {
    return existingEntryByQuery;
  }
  return buildLiveSummaryEntry(normalizedQuery);
}

function getLiveSummaryEntryQuery(entryKey = '') {
  return normalizeLiveSummaryQuery(getLiveSummaryTimelineEntry('', entryKey)?.query || '');
}

function getLiveSummaryCurrentEntryKey() {
  const candidates = [
    String(liveSummaryState.activeEntryKey || '').trim(),
    getActiveTimelineEntryKey(),
    String(liveSummaryState.lastGeneratedEntryKey || '').trim(),
    getLiveSummaryEntryKey(getLiveSummaryTimelineEntry(getLiveSummaryQueryFromPanels())),
    getLiveSummaryEntryKey(getLiveSummaryTimelineEntry(getCurrentSearchInputQuery()))
  ];

  for (const candidate of candidates) {
    const normalizedEntryKey = String(candidate || '').trim();
    if (normalizedEntryKey) {
      return normalizedEntryKey;
    }
  }

  return '';
}

function syncTimelineSelectionForLiveSummary(entryOrQuery = null, entryKey = '') {
  const entry = entryOrQuery && typeof entryOrQuery === 'object'
    ? entryOrQuery
    : getLiveSummaryTimelineEntry(entryOrQuery, entryKey);
  const requestedEntryKey = String(entryKey || '').trim();
  const resolvedEntryKey = requestedEntryKey || getLiveSummaryEntryKey(entry);
  const matchingEntry = resolvedEntryKey
    ? timelineFindEntryByKey(timelineState.entries, resolvedEntryKey)
    : null;
  if (resolvedEntryKey) {
    if (!matchingEntry) {
      return false;
    }
    if (timelineState.activeTimelineId !== matchingEntry.timelineId) {
      timelineState.activeTimelineId = matchingEntry.timelineId;
      renderTimeline();
    }
    return true;
  }

  const fallbackEntry = timelineFindEntryByQuery(timelineState.entries, entry?.query || '');
  if (!fallbackEntry) {
    return false;
  }
  const nextEntry = fallbackEntry;
  if (timelineState.activeTimelineId !== nextEntry.timelineId) {
    timelineState.activeTimelineId = nextEntry.timelineId;
    renderTimeline();
  }
  return true;
}

function buildEmptyLiveSummaryRecord(query = '', entryKey = '') {
  return {
    entryKey: String(entryKey || '').trim(),
    query: normalizeLiveSummaryQuery(query),
    status: 'collecting',
    isStreaming: false,
    summaryText: '',
    shortSummaryText: '',
    collectedSummaryText: '',
    responses: [],
    successSiteNames: [],
    failedSiteNames: [],
    successCount: 0,
    totalCount: 0,
    updatedAt: '',
    readySignature: '',
    analysisSignature: '',
    analysisTemplateId: '',
    analysisTemplateName: '',
    summarySource: 'analysis',
    summaryError: '',
    compareSites: [],
    autoAnalysisDueAt: 0
  };
}

function getLiveSummaryRecord(query = '', entryKey = '') {
  const normalizedEntryKey = String(entryKey || '').trim();
  if (normalizedEntryKey) {
    const existingRecord = liveSummaryState.summariesByEntryKey.get(normalizedEntryKey);
    if (existingRecord) {
      return existingRecord;
    }
    return buildEmptyLiveSummaryRecord(
      getLiveSummaryEntryQuery(normalizedEntryKey) || query,
      normalizedEntryKey
    );
  }

  const entry = getLiveSummaryTimelineEntry(query);
  const resolvedEntryKey = getLiveSummaryEntryKey(entry);
  if (!resolvedEntryKey) {
    return buildEmptyLiveSummaryRecord(entry?.query || '');
  }
  return liveSummaryState.summariesByEntryKey.get(resolvedEntryKey)
    || buildEmptyLiveSummaryRecord(entry?.query || '', resolvedEntryKey);
}

function setLiveSummaryRecord(query = '', nextRecord = {}, entryKey = '') {
  const requestedEntryKey = String(nextRecord?.entryKey || entryKey || '').trim();
  const entry = getLiveSummaryTimelineEntry(nextRecord?.query || query, requestedEntryKey);
  const resolvedEntryKey = requestedEntryKey || getLiveSummaryEntryKey(entry);
  const normalizedQuery = normalizeLiveSummaryQuery(nextRecord?.query || entry?.query || query);
  if (!normalizedQuery && !resolvedEntryKey) {
    return buildEmptyLiveSummaryRecord('');
  }
  const merged = {
    ...buildEmptyLiveSummaryRecord(normalizedQuery, resolvedEntryKey),
    ...(resolvedEntryKey ? getLiveSummaryRecord(normalizedQuery, resolvedEntryKey) : {}),
    ...(nextRecord && typeof nextRecord === 'object' ? nextRecord : {}),
    entryKey: resolvedEntryKey,
    query: normalizedQuery
  };
  if (resolvedEntryKey) {
    liveSummaryState.summariesByEntryKey.set(resolvedEntryKey, merged);
  }
  return merged;
}

function getActiveLiveSummaryEntry() {
  return getLiveSummaryTimelineEntry('', getLiveSummaryCurrentEntryKey());
}

function getActiveLiveSummaryRecord() {
  const activeEntry = getActiveLiveSummaryEntry();
  return getLiveSummaryRecord(activeEntry?.query || '', getLiveSummaryEntryKey(activeEntry));
}

function buildLiveSummaryVisibleEntryKeys() {
  const ordered = [];
  const seen = new Set();
  const hasTimelineEntries = Array.isArray(timelineState.entries) && timelineState.entries.length > 0;
  const pushEntryKey = (value) => {
    const normalizedEntryKey = String(value || '').trim();
    if (!normalizedEntryKey || seen.has(normalizedEntryKey)) return;
    if (hasTimelineEntries && !timelineFindEntryByKey(timelineState.entries, normalizedEntryKey)) {
      return;
    }
    seen.add(normalizedEntryKey);
    ordered.push(normalizedEntryKey);
  };
  const pushEntry = (entry) => {
    pushEntryKey(getLiveSummaryEntryKey(entry));
  };

  timelineState.entries.forEach((entry) => {
    pushEntry(entry);
  });
  pushEntryKey(liveSummaryState.activeEntryKey);
  pushEntryKey(liveSummaryState.lastGeneratedEntryKey);
  if (!ordered.length) {
    pushEntry(getLiveSummaryTimelineEntry(getLiveSummaryQueryFromPanels()));
    pushEntry(getLiveSummaryTimelineEntry(getCurrentSearchInputQuery()));
  }

  return ordered;
}

function syncLiveSummaryVisibleEntryKeys(preferredEntryKey = '') {
  const normalizedPreferredEntryKey = String(preferredEntryKey || '').trim();
  const visibleEntryKeys = buildLiveSummaryVisibleEntryKeys();
  const activeTimelineEntryKey = getActiveTimelineEntryKey();
  const normalizedActiveEntryKey = String(liveSummaryState.activeEntryKey || '').trim();
  const normalizedLastGeneratedEntryKey = String(liveSummaryState.lastGeneratedEntryKey || '').trim();
  liveSummaryState.visibleEntryKeys = visibleEntryKeys;
  const visibleEntryKeySet = new Set(visibleEntryKeys);
  Array.from(liveSummaryState.expandedEntryKeys).forEach((entryKey) => {
    if (!visibleEntryKeySet.has(entryKey)) {
      liveSummaryState.expandedEntryKeys.delete(entryKey);
    }
  });
  Array.from(liveSummaryState.analyzingEntryKeys).forEach((entryKey) => {
    if (!visibleEntryKeySet.has(entryKey)) {
      liveSummaryState.analyzingEntryKeys.delete(entryKey);
    }
  });
  Array.from(liveSummaryState.pendingTimersByEntryKey.keys()).forEach((entryKey) => {
    if (!visibleEntryKeySet.has(entryKey)) {
      clearLiveSummaryPendingTimer(entryKey);
    }
  });

  if (normalizedPreferredEntryKey && visibleEntryKeys.includes(normalizedPreferredEntryKey)) {
    liveSummaryState.activeEntryKey = normalizedPreferredEntryKey;
  } else if (normalizedActiveEntryKey && visibleEntryKeys.includes(normalizedActiveEntryKey)) {
    liveSummaryState.activeEntryKey = normalizedActiveEntryKey;
  } else if (activeTimelineEntryKey && visibleEntryKeys.includes(activeTimelineEntryKey)) {
    liveSummaryState.activeEntryKey = activeTimelineEntryKey;
  } else if (normalizedLastGeneratedEntryKey && visibleEntryKeys.includes(normalizedLastGeneratedEntryKey)) {
    liveSummaryState.activeEntryKey = normalizedLastGeneratedEntryKey;
  } else if (!visibleEntryKeys.includes(liveSummaryState.activeEntryKey)) {
    liveSummaryState.activeEntryKey = visibleEntryKeys[visibleEntryKeys.length - 1] || '';
  }
}

function getLiveSummaryTabLabel(query = '') {
  return truncateLiveSummaryText(String(query || '').trim(), 24) || t('liveSummaryTitle', '自动总结');
}

function getLiveSummaryTabCountdownSeconds(query = '', entryKey = '') {
  const dueAt = getLiveSummaryAutoAnalysisDueAt(query, entryKey);
  if (!dueAt || dueAt <= Date.now()) {
    return 0;
  }
  return Math.max(1, Math.ceil((dueAt - Date.now()) / 1000));
}

function hasLiveSummaryVisibleCountdown() {
  const visibleEntryKeys = Array.isArray(liveSummaryState.visibleEntryKeys) ? liveSummaryState.visibleEntryKeys : [];
  return visibleEntryKeys.some((entryKey) => {
    const query = getLiveSummaryEntryQuery(entryKey);
    return getLiveSummaryTabCountdownSeconds(query, entryKey) > 0;
  });
}

function getLiveSummaryPendingCountdownTargets() {
  const visibleEntryKeys = Array.isArray(liveSummaryState.visibleEntryKeys) ? liveSummaryState.visibleEntryKeys : [];
  const analysisTemplateReady = isLiveSummaryAnalysisTemplateReady();
  const targets = [];

  visibleEntryKeys.forEach((entryKey, index) => {
    const entry = getLiveSummaryTimelineEntry('', entryKey);
    const query = normalizeLiveSummaryQuery(entry?.query || getLiveSummaryEntryQuery(entryKey));
    const dueAt = getLiveSummaryAutoAnalysisDueAt(query, entryKey);
    if (!query || !dueAt || dueAt <= Date.now()) {
      return;
    }
    if (!canTriggerLiveSummaryImmediateAnalysis(query, entryKey, {
      activeRecord: getLiveSummaryRecord(query, entryKey),
      analysisTemplateReady,
      isAnalyzing: isLiveSummaryEntryAnalyzing(entryKey)
    })) {
      return;
    }
    targets.push({
      entry,
      entryKey,
      query,
      dueAt,
      order: index
    });
  });

  return targets.sort((left, right) => (
    (left.dueAt - right.dueAt)
    || (left.order - right.order)
  ));
}

function getLiveSummarySoonestPendingCountdownTarget() {
  return getLiveSummaryPendingCountdownTargets()[0] || null;
}

function refreshLiveSummaryPendingSummarizeButton() {
  const { pendingSummarizeButton } = getLiveSummaryElements();
  if (!(pendingSummarizeButton instanceof HTMLButtonElement)) {
    return;
  }

  const label = t('liveSummarySummarizeNow', '立即总结');
  const target = getLiveSummarySoonestPendingCountdownTarget();
  pendingSummarizeButton.textContent = label;
  pendingSummarizeButton.title = label;
  pendingSummarizeButton.setAttribute('aria-label', label);
  pendingSummarizeButton.hidden = !target;
  pendingSummarizeButton.disabled = !target;
  pendingSummarizeButton.dataset.entryKey = target?.entryKey || '';
}

async function triggerLiveSummarySoonestPendingAnalysis() {
  const target = getLiveSummarySoonestPendingCountdownTarget();
  if (!target) {
    return;
  }

  clearLiveSummaryAutoAnalysisTimer(target.entryKey);
  clearLiveSummaryPendingTimer(target.entryKey);
  setLiveSummaryAutoAnalysisDueAt(target.query, target.entryKey, 0);
  liveSummaryState.activeEntryKey = target.entryKey;
  syncTimelineSelectionForLiveSummary(target.entry, target.entryKey);
  syncLiveSummaryVisibleEntryKeys(target.entryKey);
  setLiveSummaryEntryExpanded(target.entryKey, true);
  renderLiveSummaryCard();

  await refreshLiveSummaryForCurrentQuery({
    query: target.query,
    entryKey: target.entryKey,
    forceGenerate: true,
    source: 'auto-analysis',
    preserveActiveEntry: true
  });
}

function renderLiveSummaryTabs() {
  const { tabs } = getLiveSummaryElements();
  if (!(tabs instanceof HTMLElement)) return;

  const visibleEntryKeys = Array.isArray(liveSummaryState.visibleEntryKeys) ? liveSummaryState.visibleEntryKeys : [];
  if (!visibleEntryKeys.length) {
    tabs.innerHTML = '';
    return;
  }

  const fragment = document.createDocumentFragment();
  visibleEntryKeys.forEach((entryKey) => {
    const entry = getLiveSummaryTimelineEntry('', entryKey);
    const query = normalizeLiveSummaryQuery(entry?.query || getLiveSummaryEntryQuery(entryKey));
    const isActive = entryKey === liveSummaryState.activeEntryKey;
    const countdownSeconds = getLiveSummaryTabCountdownSeconds(query, entryKey);
    const button = document.createElement('button');
    button.className = `live-summary-tab${isActive ? ' is-active' : ''}`;
    button.type = 'button';
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', isActive ? 'true' : 'false');
    button.title = query;
    button.setAttribute('aria-label', countdownSeconds > 0 ? `${query} ${countdownSeconds}s` : query);
    button.dataset.entryKey = entryKey;
    const label = document.createElement('span');
    label.className = 'live-summary-tab-label';
    label.textContent = getLiveSummaryTabLabel(query);
    button.appendChild(label);
    if (countdownSeconds > 0) {
      const countdown = document.createElement('span');
      countdown.className = 'live-summary-tab-countdown';
      countdown.textContent = `${countdownSeconds}s`;
      button.appendChild(countdown);
    }
    fragment.appendChild(button);
  });

  tabs.innerHTML = '';
  tabs.appendChild(fragment);

  tabs.querySelectorAll('.live-summary-tab').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const entryKey = String(button.getAttribute('data-entry-key') || '').trim();
      const entry = getLiveSummaryTimelineEntry('', entryKey);
      const query = normalizeLiveSummaryQuery(entry?.query || getLiveSummaryEntryQuery(entryKey));
      const previousActiveEntryKey = String(liveSummaryState.activeEntryKey || '').trim();
      const isSameEntry = entryKey === previousActiveEntryKey;
      const shouldExpandOnTabSwitch = Boolean(
        previousActiveEntryKey && !isLiveSummaryEntryExpanded(previousActiveEntryKey)
      );
      if (!entryKey || !query) {
        return;
      }
      if (isSameEntry) {
        setLiveSummaryEntryExpanded(entryKey, !isLiveSummaryEntryExpanded(entryKey));
        renderLiveSummaryCard();
        return;
      }
      clearLiveSummaryPendingTimer(entryKey);
      liveSummaryState.activeEntryKey = entryKey;
      if (shouldExpandOnTabSwitch) {
        setLiveSummaryEntryExpanded(entryKey, true);
      }
      syncTimelineSelectionForLiveSummary(entry, entryKey);
      renderLiveSummaryCard();
      refreshLiveSummaryForCurrentQuery({
        query,
        entryKey,
        source: 'tab',
        preserveActiveEntry: true
      }).catch((error) => {
        console.warn('切换自动总结标签后刷新失败:', error);
      });
    });
  });
}

function stripSummaryText(text = '') {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeLiveSummaryPreviewSource(text = '') {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitLiveSummaryTablePreviewRow(line = '') {
  const rawLine = String(line || '').trim();
  if (!rawLine.includes('|')) {
    return [];
  }

  let content = rawLine;
  if (content.startsWith('|')) {
    content = content.slice(1);
  }
  if (content.endsWith('|')) {
    content = content.slice(0, -1);
  }

  return content
    .split('|')
    .map((cell) => String(cell || '').trim())
    .filter((cell, index, arr) => cell || arr.length > 1);
}

function isLiveSummaryTableDelimiterLine(line = '') {
  const cells = splitLiveSummaryTablePreviewRow(line);
  if (!cells.length) {
    return false;
  }
  return cells.every((cell) => /^:?-{2,}:?$/.test(cell));
}

function normalizeLiveSummaryPreviewLine(line = '') {
  let text = String(line || '').trim();
  if (!text) {
    return '';
  }

  const tableCells = splitLiveSummaryTablePreviewRow(text);
  if (tableCells.length >= 2 && !isLiveSummaryTableDelimiterLine(text)) {
    text = tableCells.join(' | ');
  }

  text = text
    .replace(/^#{1,6}\s+/, '')
    .replace(/^\s*>\s?/, '')
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/^\s*\d+\.\s+/, '')
    .replace(/!\[([^\]]*)\]\(([^)]*)\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]*)\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/_([^_\n]+)_/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  return text;
}

function getLiveSummaryComparableText(text = '') {
  return stripSummaryText(text).replace(/\s+/g, ' ').trim().toLowerCase();
}

function truncateLiveSummaryText(text = '', maxLength = 220) {
  const normalized = stripSummaryText(text);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function getLiveSummaryCollapsedText(summaryText = '') {
  const source = normalizeLiveSummaryPreviewSource(summaryText);
  if (!source) {
    return '';
  }

  const lines = source.split('\n');
  const previewLines = [];
  let totalLength = 0;
  let inCodeBlock = false;
  const MAX_PREVIEW_LINES = 5;
  const MAX_PREVIEW_LENGTH = 280;

  const pushPreviewLine = (line) => {
    const normalizedLine = normalizeLiveSummaryPreviewLine(line);
    if (!normalizedLine) {
      return false;
    }

    const nextLength = totalLength ? totalLength + 1 + normalizedLine.length : normalizedLine.length;
    if (previewLines.length >= MAX_PREVIEW_LINES || nextLength > MAX_PREVIEW_LENGTH) {
      if (!previewLines.length) {
        previewLines.push(truncateLiveSummaryText(normalizedLine, MAX_PREVIEW_LENGTH));
      } else if (nextLength > MAX_PREVIEW_LENGTH) {
        const remainLength = Math.max(12, MAX_PREVIEW_LENGTH - totalLength - 1);
        previewLines.push(truncateLiveSummaryText(normalizedLine, remainLength));
      }
      return true;
    }

    previewLines.push(normalizedLine);
    totalLength = nextLength;
    return false;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = String(lines[index] || '');
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    if (/^(```+|~~~+)/.test(trimmed)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock || isLiveSummaryTableDelimiterLine(trimmed) || /^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      continue;
    }

    if (pushPreviewLine(trimmed)) {
      break;
    }
  }

  return previewLines.join('\n');
}

function buildLiveSummaryAnalysisSignature(query = '', contentSignature = '', templateId = '', entryKey = '') {
  return [
    String(entryKey || '').trim(),
    String(query || '').trim(),
    String(contentSignature || '').trim(),
    String(templateId || '').trim()
  ].join('||');
}

function shouldDeferLiveSummaryCollection(query = '', requestSource = '', entryKey = '') {
  const normalizedSource = String(requestSource || '').trim();
  if (normalizedSource === 'manual-analysis' || normalizedSource === 'auto-analysis') {
    return false;
  }

  const currentRecord = getLiveSummaryRecord(query, entryKey);
  if (currentRecord.status === 'ready' && String(currentRecord.summaryText || '').trim()) {
    return false;
  }

  const dueAt = getLiveSummaryAutoAnalysisDueAt(query, entryKey);
  return dueAt > Date.now();
}

function finalizeLiveSummaryAnalysisRequest(requestSource = '', query = '', entryKey = '') {
  const normalizedSource = String(requestSource || '').trim();
  if (normalizedSource === 'manual-analysis' || normalizedSource === 'auto-analysis') {
    clearLiveSummaryAutoAnalysisTimer(entryKey);
    setLiveSummaryAutoAnalysisDueAt(query, entryKey, 0);
  }
}

function getSelectedLiveSummaryAnalysisTemplate() {
  const templates = Array.isArray(liveSummaryContext.analysisTemplates)
    ? liveSummaryContext.analysisTemplates
    : [];
  return templates.find((template) => template.id === liveSummaryContext.selectedAnalysisTemplateId) || null;
}

function buildLiveSummaryAnalysisPayload({
  entry = null,
  summaryText = '',
  responses = [],
  question = '',
  successCount = 0,
  totalCount = 0,
  analysisTemplateId = '',
  analysisTemplateName = '',
  analysisTemplateQuery = '',
  compareSites = []
} = {}) {
  const payload = analysisBuildPayload({
    entry,
    summaryText,
    responses,
    question,
    successCount,
    totalCount,
    analysisTemplateId,
    analysisTemplateName,
    analysisTemplateQuery
  });
  if (Array.isArray(compareSites) && compareSites.length > 0) {
    payload.compareSites = compareSites.slice();
  }
  return payload;
}

function buildLiveSummaryAnalysisPrompt(payload = {}) {
  if (typeof AnalysisUtils.buildAnalysisPrompt === 'function') {
    return AnalysisUtils.buildAnalysisPrompt(payload);
  }
  return String(payload?.question || '').trim();
}

async function requestLiveSummaryAnalysis(prompt = '', options = {}) {
  const normalizedPrompt = String(prompt || '').trim();
  if (!normalizedPrompt) {
    throw new Error('Analysis prompt is required');
  }

  const normalizedEntryKey = String(options.entryKey || '').trim();
  const requestId = String(
    options.requestId
    || `live-summary-${normalizedEntryKey || 'entry'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  ).trim();

  return new Promise((resolve, reject) => {
    let port = null;
    let settled = false;
    let latestContent = '';

    const cleanup = () => {
      if (port) {
        try {
          port.onMessage.removeListener(handleMessage);
        } catch (_) {
          // ignore
        }
        try {
          port.onDisconnect.removeListener(handleDisconnect);
        } catch (_) {
          // ignore
        }
      }
      if (normalizedEntryKey && liveSummaryContext.analysisPortsByEntryKey.get(normalizedEntryKey) === port) {
        liveSummaryContext.analysisPortsByEntryKey.delete(normalizedEntryKey);
      }
    };

    const finalizeResolve = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(String(value || ''));
    };

    const finalizeReject = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error || t('agentRequestFailed', 'Skill request failed'))));
    };

    const handleMessage = (message = {}) => {
      if (message?.requestId && String(message.requestId).trim() !== requestId) {
        return;
      }

      if (message?.type === 'standaloneAnalysisStarted') {
        if (typeof options.onStart === 'function') {
          options.onStart({
            requestId,
            model: String(message?.model || '').trim(),
            selectedSource: String(message?.selectedSource || '').trim()
          });
        }
        return;
      }

      if (message?.type === 'standaloneAnalysisDelta') {
        latestContent = typeof message?.content === 'string'
          ? message.content
          : `${latestContent}${String(message?.delta || '')}`;
        if (typeof options.onDelta === 'function') {
          options.onDelta(latestContent, {
            requestId,
            delta: String(message?.delta || ''),
            model: String(message?.model || '').trim(),
            selectedSource: String(message?.selectedSource || '').trim()
          });
        }
        return;
      }

      if (message?.type === 'standaloneAnalysisCompleted') {
        latestContent = typeof message?.content === 'string' ? message.content : latestContent;
        finalizeResolve(latestContent);
        return;
      }

      if (message?.type === 'standaloneAnalysisError') {
        finalizeReject(new Error(String(message?.error || t('agentRequestFailed', 'Skill request failed'))));
      }
    };

    const handleDisconnect = () => {
      if (settled) {
        return;
      }
      const disconnectReason = String(port?.__aiCompareDisconnectReason || '').trim();
      const isExpected = port?.__aiCompareExpectedDisconnect === true;
      const lastErrorMessage = chrome?.runtime?.lastError?.message || '';
      const error = new Error(
        disconnectReason
          || lastErrorMessage
          || t('agentRequestFailed', 'Skill request failed')
      );
      if (isExpected) {
        error.name = 'AbortError';
      }
      finalizeReject(error);
    };

    try {
      if (normalizedEntryKey) {
        disconnectLiveSummaryAnalysisPort(normalizedEntryKey, 'replaced');
      }
      port = chrome.runtime.connect({
        name: LIVE_SUMMARY_ANALYSIS_STREAM_PORT_NAME
      });
      if (normalizedEntryKey) {
        liveSummaryContext.analysisPortsByEntryKey.set(normalizedEntryKey, port);
      }
      port.onMessage.addListener(handleMessage);
      port.onDisconnect.addListener(handleDisconnect);
      port.postMessage({
        type: 'startStandaloneAnalysis',
        requestId,
        payload: {
          prompt: normalizedPrompt
        }
      });
    } catch (error) {
      finalizeReject(error);
    }
  });
}

function escapeLiveSummaryHtml(text = '') {
  if (typeof MarkdownRenderer.escapeHtml === 'function') {
    return MarkdownRenderer.escapeHtml(text);
  }
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderLiveSummaryEmptyStateHtml(options = {}) {
  const promptText = String(options.promptText || t('liveSummaryEmptyPrompt', '倒计时结束后，自动总结所有回答')).trim();
  const actionText = String(options.actionText || t('liveSummarySummarizeNow', '立即总结')).trim();
  const disabledAttributes = options.actionDisabled ? ' disabled aria-disabled="true"' : '';
  return `
    <p class="live-summary-empty-state">
      <span class="live-summary-empty-text">${escapeLiveSummaryHtml(promptText)}</span>
      <button
        type="button"
        class="live-summary-empty-action"
        title="${escapeLiveSummaryHtml(actionText)}"
        aria-label="${escapeLiveSummaryHtml(actionText)}"${disabledAttributes}
      >${escapeLiveSummaryHtml(actionText)}</button>
    </p>
  `;
}

function renderLiveSummaryContentHtml(summaryText = '', summaryError = '', options = {}) {
  const normalized = stripSummaryText(summaryText);
  if (!normalized) {
    const normalizedError = String(summaryError || '').trim();
    if (!normalizedError && options.showThinking) {
      return `<p class="live-summary-thinking">${escapeLiveSummaryHtml(t('liveSummaryThinking', 'thinking'))}</p>`;
    }
    if (!normalizedError && options.showEmptyAction) {
      return renderLiveSummaryEmptyStateHtml(options);
    }
    const fallbackText = normalizedError || t('liveSummaryEmpty', '暂无可展示的总结。');
    return `<p>${escapeLiveSummaryHtml(fallbackText)}</p>`;
  }

  if (typeof MarkdownRenderer.renderMarkdownToHtml === 'function') {
    const rendered = String(MarkdownRenderer.renderMarkdownToHtml(normalized) || '').trim();
    if (rendered) {
      return rendered;
    }
  }

  return normalized
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.split('\n').map((line) => escapeLiveSummaryHtml(line)).join('<br>')}</p>`)
    .join('');
}

function renderLiveSummaryPreviewHtml(summaryText = '', summaryError = '') {
  const normalized = stripSummaryText(summaryText);
  if (!normalized) {
    return renderLiveSummaryContentHtml('', summaryError);
  }

  return normalized
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.split('\n').map((line) => escapeLiveSummaryHtml(line)).join('<br>')}</p>`)
    .join('');
}

function formatLiveSummaryMeta() {
  const activeRecord = getActiveLiveSummaryRecord();
  if (activeRecord.status === 'error') {
    return String(activeRecord.summaryError || t('agentRequestFailed', 'Skill request failed')).trim();
  }
  const countText = t('liveSummaryMetaReady', '$1 / $2 个面板已纳入总结', [
    String(activeRecord.successCount || 0),
    String(activeRecord.totalCount || 0)
  ]);
  if (activeRecord.isStreaming) {
    const metaParts = [];
    const templateName = String(activeRecord.analysisTemplateName || '').trim();
    if (activeRecord.summarySource === 'analysis' && templateName) {
      metaParts.push(t('liveSummaryMetaTemplateAnalysis', '已使用“$1”分析', [templateName]));
    }
    if (countText) {
      metaParts.push(countText);
    }
    return metaParts.join(' · ');
  }
  if (activeRecord.status === 'collecting') {
    if (String(activeRecord.summaryError || '').trim()) {
      return String(activeRecord.summaryError || '').trim();
    }
    return t('liveSummaryCollecting', '正在等待各面板回答稳定后自动总结...');
  }

  if (activeRecord.status === 'refreshing') {
    const baseText = t('liveSummaryRefreshing', '已有总结，正在静默刷新...');
    if (activeRecord.successCount > 0 || activeRecord.totalCount > 0) {
      return `${baseText} · ${t('liveSummaryMetaReady', '$1 / $2 个面板已纳入总结', [
        String(activeRecord.successCount || 0),
        String(activeRecord.totalCount || 0)
      ])}`;
    }
    return baseText;
  }

  if (liveSummaryState.status === 'hidden') {
    return '';
  }

  const updatedAtText = activeRecord.updatedAt
    ? formatTimelineDateLabel(activeRecord.updatedAt)
    : '';
  const metaParts = [];
  const templateName = String(activeRecord.analysisTemplateName || '').trim();
  if (activeRecord.summarySource === 'analysis' && templateName) {
    metaParts.push(t('liveSummaryMetaTemplateAnalysis', '已使用“$1”分析', [templateName]));
  }
  metaParts.push(countText);
  if (updatedAtText) {
    metaParts.push(updatedAtText);
  }
  return metaParts.join(' · ');
}

function formatLiveSummaryHint() {
  const activeRecord = getActiveLiveSummaryRecord();
  const failedSiteNames = Array.isArray(activeRecord?.failedSiteNames)
    ? activeRecord.failedSiteNames.map((name) => String(name || '').trim()).filter(Boolean)
    : [];
  if (!failedSiteNames.length) {
    return '';
  }
  return t('liveSummaryFailedSiteHint', '注意：$1 抓取答案失败', [
    formatLiveSummaryHintSiteNames(failedSiteNames)
  ]);
}

function formatLiveSummaryHintHtml() {
  const activeRecord = getActiveLiveSummaryRecord();
  const failedSiteNames = Array.isArray(activeRecord?.failedSiteNames)
    ? activeRecord.failedSiteNames.map((name) => String(name || '').trim()).filter(Boolean)
    : [];
  if (!failedSiteNames.length) {
    return '';
  }

  const siteNamesText = formatLiveSummaryHintSiteNames(failedSiteNames);
  const template = t('liveSummaryFailedSiteHint', '注意：$1 抓取答案失败');
  if (!template.includes('$1')) {
    return escapeLiveSummaryHtml(siteNamesText);
  }

  const [beforeText, ...afterParts] = template.split('$1');
  const afterText = afterParts.join('$1');
  return `${escapeLiveSummaryHtml(beforeText)}<span class="live-summary-card-hint-site-names">${escapeLiveSummaryHtml(siteNamesText)}</span>${escapeLiveSummaryHtml(afterText)}`;
}

function formatLiveSummaryHintSiteNames(siteNames = []) {
  const names = Array.isArray(siteNames)
    ? siteNames.map((name) => String(name || '').trim()).filter(Boolean)
    : [];
  if (!names.length) {
    return '';
  }
  const uiLanguage = String(chrome?.i18n?.getUILanguage?.() || navigator.language || '').toLowerCase();
  const separator = /^(zh|ja|ko)/.test(uiLanguage) ? '、' : ', ';
  return names.join(separator);
}

function formatLiveSummaryRefreshButtonText(activeRecord = getActiveLiveSummaryRecord()) {
  if (activeRecord?.isStreaming) {
    return t('liveSummaryRefresh', '分析');
  }

  const dueAt = Math.max(0, Number(activeRecord?.autoAnalysisDueAt) || 0);
  if (dueAt > Date.now()) {
    const remainingSeconds = Math.max(1, Math.ceil((dueAt - Date.now()) / 1000));
    return t('liveSummaryRefreshCountdown', '分析（$1s）', [String(remainingSeconds)]);
  }

  return t('liveSummaryRefresh', '分析');
}

function shouldDisableLiveSummaryAnalysisTemplateSelect(select = getLiveSummaryElements().analysisTemplateSelect) {
  return select instanceof HTMLSelectElement
    && select.options.length <= 1
    && !liveSummaryContext.analysisTemplates.length;
}

function isLiveSummaryAnalysisTemplateReady(select = getLiveSummaryElements().analysisTemplateSelect) {
  return !(select instanceof HTMLSelectElement) || !shouldDisableLiveSummaryAnalysisTemplateSelect(select);
}

function shouldShowLiveSummaryEmptyAction(activeRecord = getActiveLiveSummaryRecord()) {
  if (!activeRecord || activeRecord.status !== 'collecting' || activeRecord.isStreaming) {
    return false;
  }
  if (String(activeRecord.summaryText || '').trim()) {
    return false;
  }
  return !String(activeRecord.summaryError || '').trim();
}

function canTriggerLiveSummaryImmediateAnalysis(query = '', entryKey = '', options = {}) {
  const normalizedQuery = String(query || getLiveSummaryCurrentQuery() || '').trim();
  const normalizedEntryKey = String(entryKey || getLiveSummaryCurrentEntryKey() || '').trim();
  const activeRecord = options.activeRecord || getLiveSummaryRecord(normalizedQuery, normalizedEntryKey);
  const analysisTemplateReady = typeof options.analysisTemplateReady === 'boolean'
    ? options.analysisTemplateReady
    : isLiveSummaryAnalysisTemplateReady();
  const isAnalyzing = options.isAnalyzing === true || isLiveSummaryEntryAnalyzing(normalizedEntryKey);
  return Boolean(
    normalizedQuery
    && normalizedEntryKey
    && analysisTemplateReady
    && !isAnalyzing
    && !activeRecord?.isStreaming
  );
}

async function triggerLiveSummaryImmediateAnalysis(query = '', entryKey = '') {
  const normalizedQuery = String(query || getLiveSummaryCurrentQuery() || '').trim();
  const normalizedEntryKey = String(entryKey || getLiveSummaryCurrentEntryKey() || '').trim();
  if (!canTriggerLiveSummaryImmediateAnalysis(normalizedQuery, normalizedEntryKey)) {
    return;
  }
  await rerunLiveSummaryAnalysis({
    query: normalizedQuery,
    entryKey: normalizedEntryKey
  });
}

function shouldShowLiveSummaryImmediateAnalyzeButton(activeRecord = getActiveLiveSummaryRecord()) {
  if (!activeRecord || activeRecord.isStreaming) {
    return false;
  }
  const dueAt = Math.max(0, Number(activeRecord.autoAnalysisDueAt) || 0);
  return dueAt > Date.now();
}

async function collectTimelineEntryResponsesWithRetry(entry, options = {}) {
  const normalizedEntry = entry && typeof entry === 'object' ? entry : null;
  if (!normalizedEntry) {
    return collectTimelineEntryResponses(entry);
  }

  const initialBundle = await collectTimelineEntryResponses(normalizedEntry);
  const shouldRetryFailedSites = options.retryFailedSites === true;
  if (!shouldRetryFailedSites) {
    return initialBundle;
  }

  const failedSiteNameSet = new Set(
    (Array.isArray(initialBundle?.failedSiteNames) ? initialBundle.failedSiteNames : [])
      .map((name) => String(name || '').trim())
      .filter(Boolean)
  );
  if (!failedSiteNameSet.size) {
    return initialBundle;
  }

  const failedIframes = getSiteIframes().filter((iframe) => {
    const siteName = String(iframe?.dataset?.site || '').trim();
    return siteName && failedSiteNameSet.has(siteName);
  });
  if (!failedIframes.length) {
    return initialBundle;
  }

  const retrySiteResponses = await Promise.all(failedIframes.map((iframe) => {
    return requestIframeTimelineAction(
      iframe,
      'EXTRACT_PROMPT_RESPONSE',
      'EXTRACT_PROMPT_RESPONSE_RESULT',
      {
        query: normalizedEntry.query,
        occurrenceIndex: normalizedEntry.occurrenceIndex
      },
      12000
    );
  }));

  const retriedResponseBySite = new Map(retrySiteResponses.map((item) => {
    const siteName = String(item?.siteName || '').trim();
    return [
      siteName,
      {
        siteName,
        answers: Array.isArray(item?.answers) ? item.answers : [],
        content: item?.content || '',
        error: item?.error || ''
      }
    ];
  }).filter(([siteName]) => siteName));

  const mergedResponses = (Array.isArray(initialBundle?.responses) ? initialBundle.responses : []).map((response) => {
    const siteName = String(response?.siteName || '').trim();
    return retriedResponseBySite.get(siteName) || response;
  });
  const { successResponses, successSiteNames, failedSiteNames } = partitionTimelineResponses(mergedResponses);

  return {
    responses: mergedResponses,
    copyText: timelineBuildCopyText(normalizedEntry, successResponses),
    successCount: successResponses.length,
    successSiteNames,
    failedSiteNames,
    totalCount: mergedResponses.length
  };
}

async function rerunLiveSummaryAnalysis(options = {}) {
  const query = String(options.query || getLiveSummaryCurrentQuery() || '').trim();
  const entryKey = String(options.entryKey || getLiveSummaryCurrentEntryKey() || '').trim();
  if (!query || !entryKey) return;

  clearLiveSummaryAutoAnalysisTimer(entryKey);
  setLiveSummaryAutoAnalysisDueAt(query, entryKey, 0);
  markLiveSummaryCollecting(query, entryKey, { armAutoAnalysis: false });
  setLiveSummaryEntryAnalyzing(entryKey, true);
  renderLiveSummaryCard();
  try {
    await waitForNextFrame();
    await refreshLiveSummaryForCurrentQuery({
      query,
      entryKey,
      forceGenerate: true,
      source: 'manual-analysis',
      preserveActiveEntry: true,
      retryFailedSites: true
    });
  } catch (error) {
    console.warn('手动触发自动总结分析失败:', error);
  } finally {
    setLiveSummaryEntryAnalyzing(entryKey, false);
    renderLiveSummaryCard();
  }
}

function getLiveSummaryExportEntry() {
  const activeEntry = getActiveLiveSummaryEntry();
  if (activeEntry) {
    return activeEntry;
  }
  const query = getLiveSummaryCurrentQuery();
  return query ? getLiveSummaryTimelineEntry(query, getLiveSummaryCurrentEntryKey()) : null;
}

function getLiveSummaryExportBundle() {
  const entry = getLiveSummaryExportEntry();
  const entryKey = getLiveSummaryEntryKey(entry);
  const record = getLiveSummaryRecord(entry?.query || '', entryKey);
  const responses = Array.isArray(record?.responses) ? record.responses : [];
  const { successResponses, successSiteNames } = partitionTimelineResponses(responses);
  const collectedSummaryText = String(record?.collectedSummaryText || '').trim();
  const analysisSummaryText = String(record?.summaryText || '').trim();
  const successCount = Math.max(0, Number(record?.successCount) || 0);
  const totalCount = Math.max(0, Number(record?.totalCount) || responses.length);
  const exportSuccessCount = successResponses.length;
  const exportTotalCount = successResponses.length;
  const exportSections = [];
  if (analysisSummaryText) {
    exportSections.push(`分析结论：\n${analysisSummaryText}`);
  }
  if (collectedSummaryText) {
    exportSections.push(`各站原始答案汇总：\n${collectedSummaryText}`);
  }
  const copyText = exportSections.join('\n\n').trim() || collectedSummaryText || analysisSummaryText;
  return {
    entry,
    record,
    responses,
    exportResponses: successResponses,
    exportSiteNames: successSiteNames,
    collectedSummaryText,
    analysisSummaryText,
    copyText,
    successCount,
    totalCount,
    exportSuccessCount,
    exportTotalCount
  };
}

async function refreshLiveSummaryExportBundle(options = {}) {
  const entry = getLiveSummaryExportEntry();
  const entryKey = getLiveSummaryEntryKey(entry);
  const query = normalizeLiveSummaryQuery(entry?.query || '');
  if (!entry || !entryKey || !query) {
    return getLiveSummaryExportBundle();
  }

  try {
    const responseBundle = await collectTimelineEntryResponsesWithRetry(entry, {
      retryFailedSites: options.retryFailedSites === true
    });
    const responses = Array.isArray(responseBundle?.responses) ? responseBundle.responses : [];
    const successCount = Number(responseBundle?.successCount || 0) || 0;
    const totalCount = Number(responseBundle?.totalCount || responses.length) || responses.length;
    const successSiteNames = Array.isArray(responseBundle?.successSiteNames)
      ? responseBundle.successSiteNames
      : partitionLiveSummaryResponses(responses).successSiteNames;
    const failedSiteNames = Array.isArray(responseBundle?.failedSiteNames)
      ? responseBundle.failedSiteNames
      : partitionLiveSummaryResponses(responses).failedSiteNames;
    const collectedSummaryText = String(responseBundle?.copyText || '').trim();
    const compareSites = responses.map((response) => String(response?.siteName || '').trim()).filter(Boolean);

    setLiveSummaryRecord(query, {
      responses,
      collectedSummaryText,
      successSiteNames,
      failedSiteNames,
      successCount,
      totalCount,
      compareSites
    }, entryKey);

    if (String(liveSummaryState.activeEntryKey || '').trim() === entryKey) {
      renderLiveSummaryCard();
    }
  } catch (error) {
    console.warn('刷新自动总结导出状态失败:', error);
  }

  return getLiveSummaryExportBundle();
}

function refreshLiveSummaryAnalysisTemplateSelectLabel() {
  const { analysisTemplateSelect } = getLiveSummaryElements();
  if (!(analysisTemplateSelect instanceof HTMLSelectElement)) {
    return;
  }

  Array.from(analysisTemplateSelect.options || []).forEach((option) => {
    const baseLabel = String(option.dataset.baseLabel || option.textContent || '').trim();
    if (!option.dataset.baseLabel) {
      option.dataset.baseLabel = baseLabel;
    }
    option.textContent = option.dataset.baseLabel;
  });

  const selectedOption = analysisTemplateSelect.selectedOptions?.[0] || null;
  const selectedBaseLabel = String(selectedOption?.dataset?.baseLabel || selectedOption?.textContent || '').trim();
  const selectLabel = t('analysisPromptTemplateSelectLabel', '分析提示词选择');
  analysisTemplateSelect.title = selectedBaseLabel;
  analysisTemplateSelect.setAttribute('aria-label', selectedBaseLabel ? `${selectLabel} ${selectedBaseLabel}` : selectLabel);
}

function refreshLiveSummaryHintText() {
  const { hint, retryCluster } = getLiveSummaryElements();
  if (hint instanceof HTMLElement) {
    const hintText = formatLiveSummaryHint();
    hint.innerHTML = formatLiveSummaryHintHtml();
    hint.title = hintText || '';
    hint.hidden = !hintText;
    hint.classList.toggle('is-warning', Boolean(hintText));
    if (retryCluster instanceof HTMLElement) {
      retryCluster.hidden = !hintText;
    }
    const sitesCluster = hint.closest('.live-summary-sites-cluster');
    if (sitesCluster instanceof HTMLElement) {
      sitesCluster.hidden = !hintText;
    }
    const subtitleRow = hint.closest('.live-summary-card-subtitle-row');
    if (subtitleRow instanceof HTMLElement) {
      subtitleRow.classList.toggle('is-compact', !hintText);
    }
  }
  renderLiveSummaryTabs();
  refreshLiveSummaryPendingSummarizeButton();
  refreshLiveSummaryAnalysisTemplateSelectLabel();
}

function syncLiveSummaryHintTimer() {
  clearLiveSummaryHintTimer();
  if (liveSummaryState.status === 'hidden') {
    return;
  }

  refreshLiveSummaryHintText();
  if (!hasLiveSummaryVisibleCountdown()) {
    return;
  }

  liveSummaryState.hintTimer = setInterval(() => {
    refreshLiveSummaryHintText();
    if (!hasLiveSummaryVisibleCountdown() || liveSummaryState.status === 'hidden') {
      clearLiveSummaryHintTimer();
      refreshLiveSummaryHintText();
    }
  }, 1000);
}

function renderLiveSummarySites() {
  const { sites } = getLiveSummaryElements();
  if (!(sites instanceof HTMLElement)) return;
  sites.innerHTML = '';
  sites.hidden = true;
}

function renderLiveSummaryCard() {
  const {
    card,
    title,
    tabs,
    pendingSummarizeButton,
    hint,
    meta,
    body,
    content,
    retryCluster,
    analysisTemplateSelect,
    refreshButton,
    shareButton,
    downloadButton,
    copyButton,
    immediateAnalyzeButton
  } = getLiveSummaryElements();
  if (!(card instanceof HTMLElement) || !(meta instanceof HTMLElement) || !(content instanceof HTMLElement) || !(body instanceof HTMLElement)) {
    return;
  }
  if (title instanceof HTMLElement) {
    title.textContent = t('liveSummaryTitle', 'Auto summary');
  }
  const activeRecord = getActiveLiveSummaryRecord();
  const activeEntryKey = getLiveSummaryCurrentEntryKey();
  const isExpanded = isLiveSummaryEntryExpanded(activeEntryKey);
  const isAnalyzing = isLiveSummaryEntryAnalyzing(activeEntryKey);
  const shouldDisableAnalysisTemplateSelect = shouldDisableLiveSummaryAnalysisTemplateSelect(analysisTemplateSelect);
  const analysisTemplateReady = !(analysisTemplateSelect instanceof HTMLSelectElement)
    || !shouldDisableAnalysisTemplateSelect;
  const canTriggerImmediateAnalysis = canTriggerLiveSummaryImmediateAnalysis(activeRecord.query, activeEntryKey, {
    activeRecord,
    analysisTemplateReady,
    isAnalyzing
  });
  const canCollapseSummary = Boolean(
    String(activeRecord.summaryText || '').trim()
    && String(activeRecord.shortSummaryText || '').trim()
    && activeRecord.shortSummaryText !== activeRecord.summaryText
  );
  const shouldRenderCollapsedPreview = canCollapseSummary && !isExpanded;
  const displaySummaryText = String(activeRecord.summaryText || '');
  const shouldShowThinking = Boolean(
    activeRecord.isStreaming
    && !String(displaySummaryText || '').trim()
    && !String(activeRecord.summaryError || '').trim()
  );
  const isDisplayEmpty = !String(displaySummaryText || '').trim() && !String(activeRecord.summaryError || '').trim();
  const showEmptyAction = shouldShowLiveSummaryEmptyAction(activeRecord);
  const hasFailedSiteHint = Array.isArray(activeRecord?.failedSiteNames)
    && activeRecord.failedSiteNames.some((siteName) => String(siteName || '').trim());

  const isVisible = liveSummaryState.status !== 'hidden';
  card.hidden = !isVisible;
  if (!isVisible) {
    card.classList.remove('is-actions-visible');
    hideTimelineCopyPreviewTooltip(card);
    hideTimelineCopyPreviewSharePanel(card);
    return;
  }

  card.classList.toggle('is-collecting', activeRecord.status === 'collecting');
  card.classList.toggle('is-expanded', isExpanded);
  card.classList.toggle('is-collapsed', !isExpanded);
  if (!isExpanded) {
    card.classList.remove('is-actions-visible');
  }
  card.classList.toggle('has-failed-sites', hasFailedSiteHint);
  syncLiveSummaryHintTimer();
  if (tabs instanceof HTMLElement) {
    renderLiveSummaryTabs();
  }
  if (pendingSummarizeButton instanceof HTMLButtonElement) {
    refreshLiveSummaryPendingSummarizeButton();
  }
  const metaText = formatLiveSummaryMeta();
  meta.textContent = metaText;
  meta.hidden = !isExpanded || !metaText;
  body.hidden = !isExpanded;
  content.classList.toggle('is-collapsed', shouldRenderCollapsedPreview);
  content.classList.toggle('is-preview', shouldRenderCollapsedPreview);
  content.classList.toggle('is-empty', isDisplayEmpty);
  content.classList.toggle('is-error', activeRecord.status === 'error' && !String(activeRecord.summaryText || '').trim());
  content.classList.toggle('is-streaming', activeRecord.isStreaming);
  content.classList.toggle('is-thinking', shouldShowThinking);
  content.innerHTML = shouldRenderCollapsedPreview
    ? renderLiveSummaryPreviewHtml(activeRecord.shortSummaryText, activeRecord.summaryError)
    : renderLiveSummaryContentHtml(displaySummaryText, activeRecord.summaryError, {
      showThinking: shouldShowThinking,
      showEmptyAction,
      actionDisabled: showEmptyAction && !canTriggerImmediateAnalysis
    });
  renderLiveSummarySites();

  const exportBundle = getLiveSummaryExportBundle();
  if (shareButton instanceof HTMLButtonElement) {
    shareButton.setAttribute('data-tooltip', t('timelineCopyPreviewShare', '分享'));
  }
  if (downloadButton instanceof HTMLButtonElement) {
    downloadButton.setAttribute('data-tooltip', t('timelineCopyPreviewDownload', '下载 MD'));
  }
  if (copyButton instanceof HTMLButtonElement) {
    copyButton.setAttribute('data-tooltip', t('timelineCopyPreviewConfirm', '复制'));
    copyButton.dataset.copyText = exportBundle.copyText || '';
    copyButton.dataset.successCount = String(exportBundle.exportSuccessCount || 0);
    copyButton.dataset.totalCount = String(exportBundle.exportTotalCount || 0);
  }
  if (immediateAnalyzeButton instanceof HTMLButtonElement) {
    const immediateAnalyzeLabel = t('liveSummaryRefresh', '分析');
    immediateAnalyzeButton.hidden = !hasFailedSiteHint;
    immediateAnalyzeButton.setAttribute('data-tooltip', immediateAnalyzeLabel);
    immediateAnalyzeButton.title = immediateAnalyzeLabel;
    immediateAnalyzeButton.setAttribute('aria-label', immediateAnalyzeLabel);
    immediateAnalyzeButton.disabled = !canTriggerImmediateAnalysis;
  }
  if (retryCluster instanceof HTMLElement) {
    retryCluster.hidden = !hasFailedSiteHint;
  }
  if (analysisTemplateSelect instanceof HTMLSelectElement) {
    analysisTemplateSelect.disabled = shouldDisableAnalysisTemplateSelect;
  }
}

function hideLiveSummaryCard() {
  liveSummaryContext.requestGeneration += 1;
  liveSummaryContext.requestSequenceByEntryKey.clear();
  disconnectLiveSummaryAnalysisPort('', 'hidden');
  clearLiveSummaryPendingTimer();
  clearLiveSummaryAutoAnalysisTimer();
  clearLiveSummaryHintTimer();
  liveSummaryState.activeEntryKey = '';
  liveSummaryState.visibleEntryKeys = [];
  liveSummaryState.status = 'hidden';
  liveSummaryState.version = 0;
  liveSummaryState.displayedVersion = 0;
  liveSummaryState.lastGeneratedEntryKey = '';
  renderLiveSummaryCard();
}

function getLiveSummaryQueryFromPanels() {
  const queryCounts = new Map();
  document.querySelectorAll('.iframe-container[data-last-query]').forEach((container) => {
    const query = String(container?.dataset?.lastQuery || '').trim();
    if (!query) {
      return;
    }
    queryCounts.set(query, (queryCounts.get(query) || 0) + 1);
  });

  let bestQuery = '';
  let bestCount = 0;
  for (const [query, count] of queryCounts.entries()) {
    if (count > bestCount) {
      bestQuery = query;
      bestCount = count;
    }
  }

  return bestQuery;
}

function markLiveSummaryCollecting(query = '', entryKey = '', options = {}) {
  const timelineEntry = getLiveSummaryTimelineEntry(query, entryKey);
  const normalizedQuery = normalizeLiveSummaryQuery(timelineEntry?.query || '');
  const resolvedEntryKey = getLiveSummaryEntryKey(timelineEntry);
  if (!normalizedQuery || !resolvedEntryKey) {
    hideLiveSummaryCard();
    return;
  }

  clearLiveSummaryPendingTimer(resolvedEntryKey);
  const existingRecord = getLiveSummaryRecord(normalizedQuery, resolvedEntryKey);
  const hasExistingSummary = Boolean(existingRecord.summaryText);
  const shouldArmAutoAnalysis = options.armAutoAnalysis !== false;
  const nextDueAt = resolveLiveSummaryAutoAnalysisDueAt({
    existingDueAt: existingRecord.autoAnalysisDueAt,
    hasExistingSummary,
    shouldArmAutoAnalysis,
    delayMs: LIVE_SUMMARY_AUTO_ANALYSIS_DELAY_MS
  });
  setLiveSummaryRecord(normalizedQuery, {
    ...(hasExistingSummary ? {} : buildEmptyLiveSummaryRecord(normalizedQuery, resolvedEntryKey)),
    status: hasExistingSummary ? 'refreshing' : 'collecting',
    isStreaming: false,
    summaryError: '',
    autoAnalysisDueAt: nextDueAt
  }, resolvedEntryKey);
  liveSummaryState.activeEntryKey = resolvedEntryKey;
  syncTimelineSelectionForLiveSummary(timelineEntry, resolvedEntryKey);
  syncLiveSummaryVisibleEntryKeys(resolvedEntryKey);
  liveSummaryState.status = 'ready';
  liveSummaryState.version += 1;
  liveSummaryState.lastGeneratedEntryKey = resolvedEntryKey;
  renderLiveSummaryCard();
  if (shouldArmAutoAnalysis) {
    scheduleLiveSummaryAutoAnalysis(normalizedQuery, resolvedEntryKey);
  }
}

function applyLiveSummaryActiveEntry(entry, options = {}) {
  const entryKey = getLiveSummaryEntryKey(entry);
  if (!entryKey) {
    return '';
  }
  liveSummaryState.activeEntryKey = entryKey;
  syncLiveSummaryVisibleEntryKeys(entryKey);
  if (options.rememberGenerated !== false) {
    liveSummaryState.lastGeneratedEntryKey = entryKey;
  }
  if (options.syncTimeline === true) {
    syncTimelineSelectionForLiveSummary(entry, entryKey);
  }
  return entryKey;
}

function syncLiveSummaryRefreshSelection(entry, options = {}) {
  const entryKey = getLiveSummaryEntryKey(entry);
  if (!entryKey) {
    return '';
  }

  if (options.preserveActiveEntry === true) {
    if (options.rememberGenerated !== false) {
      liveSummaryState.lastGeneratedEntryKey = entryKey;
    }
    syncLiveSummaryVisibleEntryKeys(String(liveSummaryState.activeEntryKey || '').trim() || entryKey);
    return entryKey;
  }

  return applyLiveSummaryActiveEntry(entry, options);
}

function getLiveSummaryCurrentQuery() {
  const currentEntryKey = getLiveSummaryCurrentEntryKey();
  if (currentEntryKey) {
    const query = getLiveSummaryEntryQuery(currentEntryKey);
    if (query) {
      return query;
    }
  }
  return normalizeLiveSummaryQuery(getLiveSummaryQueryFromPanels() || getCurrentSearchInputQuery());
}

function resolveLiveSummaryRefreshTarget(query = '', entryKey = '') {
  const timelineEntry = getLiveSummaryTimelineEntry(
    query || getLiveSummaryQueryFromPanels() || getCurrentSearchInputQuery() || '',
    entryKey || ''
  );

  return {
    timelineEntry,
    query: normalizeLiveSummaryQuery(timelineEntry?.query || ''),
    entryKey: getLiveSummaryEntryKey(timelineEntry)
  };
}

function getCurrentSearchInputQuery() {
  const searchInput = document.getElementById('searchInput');
  return searchInput ? String(searchInput.value || '').trim() : '';
}

function getLatestAgentResponseForLiveSummary(state, query = '') {
  if (!state || !Array.isArray(state.messages)) {
    return '';
  }
  const normalizedQuery = String(query || '').trim();
  if (!normalizedQuery) {
    return '';
  }

  for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    const message = state.messages[index];
    if (message?.role !== 'user') continue;
    if (String(message?.content || '').trim() !== normalizedQuery) continue;
    for (let responseIndex = index + 1; responseIndex < state.messages.length; responseIndex += 1) {
      const response = state.messages[responseIndex];
      if (response?.role === 'assistant' && String(response?.content || '').trim()) {
        return String(response.content || '').trim();
      }
      if (response?.role === 'user') {
        break;
      }
    }
    break;
  }

  return '';
}

function isLiveSummaryResponseUsable(response) {
  if (!response || typeof response !== 'object') return false;
  const answers = Array.isArray(response.answers) ? response.answers : [];
  if (answers.some((answer) => String(answer || '').trim())) {
    return true;
  }
  const content = String(response.content || '').trim();
  const error = String(response.error || '').trim();
  if (!content) {
    return false;
  }
  return !(error && content === error);
}

function partitionLiveSummaryResponses(responses = []) {
  const successResponses = [];
  const successSiteNames = [];
  const failedSiteNames = [];

  for (const response of Array.isArray(responses) ? responses : []) {
    const siteName = String(response?.siteName || '').trim();
    if (!siteName) continue;
    if (isLiveSummaryResponseUsable(response)) {
      successResponses.push(response);
      successSiteNames.push(siteName);
    } else {
      failedSiteNames.push(siteName);
    }
  }

  return {
    successResponses,
    successSiteNames,
    failedSiteNames
  };
}

function getCurrentLiveSummaryResponses(query = '') {
  const normalizedQuery = String(query || '').trim();
  const siteIframes = getSiteIframes();
  const siteNames = siteIframes.map((iframe) => String(iframe.dataset.site || '').trim()).filter(Boolean);
  const siteSnapshot = window.aiCompareSiteRuntime?.getSnapshot
    ? window.aiCompareSiteRuntime.getSnapshot(siteNames)
    : { bySite: {} };

  const siteResponses = siteNames.map((siteName) => {
    const runtimeEntry = siteSnapshot.bySite?.[siteName] || null;
    const matchesQuery = !normalizedQuery || String(runtimeEntry?.query || '').trim() === normalizedQuery;
    if (!matchesQuery) {
      return null;
    }
    const content = String(runtimeEntry?.content || '').trim();
    const error = String(runtimeEntry?.error || '').trim();
    return {
      siteName,
      answers: content && !(error && content === error) ? [content] : [],
      content: error && content === error ? '' : content,
      error
    };
  }).filter(Boolean);

  const agentResponses = getOpenedAgentIds().map((agentId) => {
    const state = getAgentState(agentId);
    const lastUserMessage = Array.isArray(state?.messages)
      ? [...state.messages].reverse().find((message) => message?.role === 'user' && String(message?.content || '').trim())
      : null;
    const matchesQuery = !normalizedQuery || String(lastUserMessage?.content || '').trim() === normalizedQuery;
    const content = getLatestAgentResponseForLiveSummary(state, normalizedQuery);
    const error = String(state?.error || '').trim();
    const siteName = String(state?.name || agentId).trim();
    const normalizedContent = error && content === error ? '' : content;
    if (!matchesQuery && !content) {
      return null;
    }
    return {
      siteName,
      answers: normalizedContent ? [normalizedContent] : [],
      content: normalizedContent || '',
      error
    };
  }).filter(Boolean);

  const responses = [...siteResponses, ...agentResponses];
  const { successResponses, successSiteNames, failedSiteNames } = partitionLiveSummaryResponses(responses);

  return {
    responses,
    successCount: successResponses.length,
    totalCount: responses.length,
    successSiteNames,
    failedSiteNames
  };
}

function getLiveSummaryAgentStatuses(query = '') {
  return getOpenedAgentIds().map((agentId) => {
    const state = getAgentState(agentId);
    const lastUserMessage = Array.isArray(state?.messages)
      ? [...state.messages].reverse().find((message) => message?.role === 'user' && String(message?.content || '').trim())
      : null;
    const lastMessage = Array.isArray(state?.messages) ? state.messages[state.messages.length - 1] : null;
    const assistantContent = getLatestAgentResponseForLiveSummary(state, query);
    const hasAssistantContent = Boolean(String(assistantContent || '').trim());
    const isErrored = Boolean(state?.error) || Boolean(lastMessage?.isError);
    const matchesQuery = !query || String(lastUserMessage?.content || '').trim() === String(query || '').trim();
    const participates = matchesQuery || hasAssistantContent || Boolean(state?.isLoading);
    const isReady = participates && (isErrored || (!state?.isLoading && hasAssistantContent));
    return {
      agentId,
      participates,
      ready: isReady,
      hasContent: hasAssistantContent,
      failed: isErrored
    };
  });
}

function getLiveSummarySiteStatuses(query = '') {
  const iframes = getSiteIframes();
  const siteNames = iframes.map((iframe) => String(iframe.dataset.site || '').trim()).filter(Boolean);
  const snapshot = window.aiCompareSiteRuntime?.getSnapshot
    ? window.aiCompareSiteRuntime.getSnapshot(siteNames)
    : { bySite: {} };
  const normalizedQuery = String(query || '').trim();

  return iframes.map((iframe) => {
    const siteName = String(iframe?.dataset?.site || '').trim();
    if (!siteName) {
      return null;
    }
    const iframeContainer = iframe.closest('.iframe-container');
    const panelQuery = String(iframeContainer?.dataset?.lastQuery || '').trim();
    const entry = snapshot.bySite?.[siteName] || null;
    const runtimeQuery = String(entry?.query || '').trim();
    const panelMatchesQuery = Boolean(normalizedQuery) && panelQuery === normalizedQuery;
    const runtimeMatchesQuery = !normalizedQuery || runtimeQuery === normalizedQuery;
    const isFinal = entry?.final === true || Number(entry?.stableRounds || 0) >= 2;
    const hasContent = Boolean(String(entry?.content || '').trim());
    const failed = entry?.phase === 'error' || Boolean(String(entry?.error || '').trim());
    const participates = panelMatchesQuery || (runtimeMatchesQuery && Boolean(runtimeQuery));
    const ready = participates && (failed || isFinal);
    return {
      siteName,
      participates,
      ready,
      hasContent,
      failed
    };
  }).filter(Boolean);
}

function getLiveSummaryStatus(query = '') {
  const siteStatuses = getLiveSummarySiteStatuses(query);
  const agentStatuses = getLiveSummaryAgentStatuses(query);
  const allStatuses = [...siteStatuses, ...agentStatuses].filter((item) => item.participates !== false);
  const totalCount = allStatuses.length;
  const readyCount = allStatuses.filter((item) => item.ready).length;
  const allReady = totalCount > 0 && readyCount === totalCount;
  return {
    totalCount,
    readyCount,
    allReady
  };
}

function scheduleLiveSummaryRefresh(delayMs = LIVE_SUMMARY_RECHECK_DELAY_MS) {
  const options = arguments[1] && typeof arguments[1] === 'object'
    ? arguments[1]
    : {};
  const target = resolveLiveSummaryRefreshTarget(options.query || '', options.entryKey || '');
  if (!target.query || !target.entryKey) {
    if (options.preserveActiveEntry === true) {
      return;
    }
    hideLiveSummaryCard();
    return;
  }
  clearLiveSummaryPendingTimer(target.entryKey);
  const nextTimer = setTimeout(() => {
    clearLiveSummaryPendingTimer(target.entryKey);
    refreshLiveSummaryForCurrentQuery({
      ...options,
      query: target.query,
      entryKey: target.entryKey,
      preserveActiveEntry: options.preserveActiveEntry !== false
    }).catch((error) => {
      console.warn('刷新自动总结失败:', error);
    });
  }, Math.max(0, Number(delayMs) || 0));
  liveSummaryState.pendingTimersByEntryKey.set(target.entryKey, nextTimer);
}

async function refreshLiveSummaryForCurrentQuery(options = {}) {
  const timelineEntry = getLiveSummaryTimelineEntry(options.query || getLiveSummaryCurrentQuery() || '', options.entryKey || '');
  const query = normalizeLiveSummaryQuery(timelineEntry?.query || '');
  const entryKey = getLiveSummaryEntryKey(timelineEntry);
  const forceGenerate = options.forceGenerate === true;
  const preserveActiveEntry = options.preserveActiveEntry === true;
  const retryFailedSites = options.retryFailedSites === true;
  const requestSource = String(options.source || '').trim();
  const skipRuntimeStatusCheck = requestSource === 'tab'
    || requestSource === 'manual-analysis'
    || requestSource === 'auto-analysis';
  const isTargetActiveEntry = String(liveSummaryState.activeEntryKey || '').trim() === entryKey;
  if (!query || !entryKey) {
    if (!preserveActiveEntry && isTargetActiveEntry) {
      hideLiveSummaryCard();
    }
    return;
  }

  const existingRecord = getLiveSummaryRecord(query, entryKey);
  if (
    requestSource === 'tab'
    && !forceGenerate
    && existingRecord.status === 'ready'
    && String(existingRecord.summaryText || '').trim()
  ) {
    applyLiveSummaryActiveEntry(timelineEntry);
    liveSummaryState.status = 'ready';
    renderLiveSummaryCard();
    syncLiveSummaryHintTimer();
    return;
  }
  if (existingRecord.isStreaming && !forceGenerate) {
    applyLiveSummaryActiveEntry(timelineEntry);
    renderLiveSummaryCard();
    return;
  }

  if (shouldDeferLiveSummaryCollection(query, requestSource, entryKey)) {
  markLiveSummaryCollecting(query, entryKey, { armAutoAnalysis: false });
    return;
  }

  const status = getLiveSummaryStatus(query);
  if (!skipRuntimeStatusCheck && !status.totalCount) {
    if (!preserveActiveEntry && isTargetActiveEntry) {
      hideLiveSummaryCard();
    }
    return;
  }

  if (!skipRuntimeStatusCheck && !status.allReady && !forceGenerate) {
    markLiveSummaryCollecting(query, entryKey);
    scheduleLiveSummaryRefresh(LIVE_SUMMARY_RECHECK_DELAY_MS, {
      query,
      entryKey,
      preserveActiveEntry: true
    });
    return;
  }

  const responseBundle = retryFailedSites
    ? await collectTimelineEntryResponsesWithRetry(timelineEntry, { retryFailedSites: true })
    : await collectTimelineEntryResponses(timelineEntry);
  const responses = Array.isArray(responseBundle?.responses) ? responseBundle.responses : [];
  const successCount = Number(responseBundle?.successCount || 0) || 0;
  const totalCount = Number(responseBundle?.totalCount || responses.length) || responses.length;
  const successSiteNames = Array.isArray(responseBundle?.successSiteNames)
    ? responseBundle.successSiteNames
    : partitionLiveSummaryResponses(responses).successSiteNames;
  const failedSiteNames = Array.isArray(responseBundle?.failedSiteNames)
    ? responseBundle.failedSiteNames
    : partitionLiveSummaryResponses(responses).failedSiteNames;
  const copyText = String(responseBundle?.copyText || '').trim();
  const compareSites = responses.map((response) => String(response?.siteName || '').trim()).filter(Boolean);
  const collectedSummaryText = copyText || t('liveSummaryEmpty', '暂时还没有可展示的总结。');
  const contentSignature = [
    query,
    getLiveSummaryComparableText(collectedSummaryText),
    ...responses.map((response) => {
      const siteName = String(response?.siteName || '').trim();
      const content = String(response?.content || '').trim();
      const error = String(response?.error || '').trim();
      const firstAnswer = Array.isArray(response?.answers)
        ? String(response.answers.find((item) => String(item || '').trim()) || '').trim()
        : '';
      return `${siteName}:${getLiveSummaryComparableText(firstAnswer || content || error)}`;
    })
  ].join('||');
  if (!liveSummaryContext.analysisTemplates.length) {
    try {
      await hydrateLiveSummaryAnalysisTemplateSelect(liveSummaryContext.selectedAnalysisTemplateId);
    } catch (error) {
      console.warn('自动总结刷新时加载分析提示词失败:', error);
    }
  }
  let selectedTemplate = getSelectedLiveSummaryAnalysisTemplate();
  if (!selectedTemplate && Array.isArray(liveSummaryContext.analysisTemplates) && liveSummaryContext.analysisTemplates.length) {
    try {
      await hydrateLiveSummaryAnalysisTemplateSelect(liveSummaryContext.selectedAnalysisTemplateId);
    } catch (error) {
      console.warn('自动总结刷新时重新解析默认分析提示词失败:', error);
    }
    selectedTemplate = getSelectedLiveSummaryAnalysisTemplate();
  }
  const selectedTemplateId = String(selectedTemplate?.id || '').trim();
  const selectedTemplateName = String(selectedTemplate?.name || '').trim();
  const analysisSignature = buildLiveSummaryAnalysisSignature(query, contentSignature, selectedTemplateId, entryKey);
  const currentRecord = getLiveSummaryRecord(query, entryKey);
  const canReuseExistingAnalysis = (
    !forceGenerate &&
    currentRecord.status === 'ready' &&
    currentRecord.analysisSignature === analysisSignature &&
    String(currentRecord.summaryText || '').trim()
  );

  if (canReuseExistingAnalysis) {
    setLiveSummaryRecord(query, {
      status: 'ready',
      isStreaming: false,
      responses,
      collectedSummaryText,
      successSiteNames,
      failedSiteNames,
      successCount,
      totalCount,
      updatedAt: currentRecord.updatedAt || new Date().toISOString(),
      readySignature: contentSignature,
      analysisSignature,
      analysisTemplateId: selectedTemplateId,
      analysisTemplateName: selectedTemplateName,
      compareSites
    }, entryKey);
    syncLiveSummaryRefreshSelection(timelineEntry, { preserveActiveEntry });
    liveSummaryState.status = 'ready';
    liveSummaryState.version += 1;
    liveSummaryState.displayedVersion = liveSummaryState.version;
    expandLiveSummaryEntryAfterAutoAnalysis(entryKey, requestSource);
    finalizeLiveSummaryAnalysisRequest(requestSource, query, entryKey);
    renderLiveSummaryCard();
    syncLiveSummaryHintTimer();
    return;
  }

  const analysisPayload = buildLiveSummaryAnalysisPayload({
    entry: timelineEntry,
    summaryText: collectedSummaryText,
    responses,
    question: query,
    successCount,
    totalCount,
    analysisTemplateId: selectedTemplateId,
    analysisTemplateName: selectedTemplateName,
    analysisTemplateQuery: selectedTemplate?.query || '',
    compareSites
  });
  const analysisPrompt = buildLiveSummaryAnalysisPrompt(analysisPayload);
  const requestToken = beginLiveSummaryAnalysisRequest(entryKey);
  const hadExistingSummary = Boolean(stripSummaryText(currentRecord.summaryText));
  if (!String(analysisPrompt || '').trim()) {
    setLiveSummaryRecord(query, {
      status: 'error',
      isStreaming: false,
      responses,
      collectedSummaryText,
      summaryText: '',
      shortSummaryText: '',
      successSiteNames,
      failedSiteNames,
      successCount,
      totalCount,
      updatedAt: new Date().toISOString(),
      readySignature: contentSignature,
      analysisSignature,
      analysisTemplateId: selectedTemplateId,
      analysisTemplateName: selectedTemplateName,
      summarySource: 'analysis',
      summaryError: t('analysisTemplateEmpty', '暂无分析提示词模板'),
      compareSites
    }, entryKey);
    syncLiveSummaryRefreshSelection(timelineEntry, { preserveActiveEntry });
    liveSummaryState.status = 'ready';
    liveSummaryState.version += 1;
    liveSummaryState.displayedVersion = liveSummaryState.version;
    finalizeLiveSummaryAnalysisRequest(requestSource, query, entryKey);
    renderLiveSummaryCard();
    syncLiveSummaryHintTimer();
    return;
  }

  let analyzedSummaryText = '';
  try {
    finalizeLiveSummaryAnalysisRequest(requestSource, query, entryKey);
    setLiveSummaryRecord(query, {
      status: hadExistingSummary ? 'refreshing' : 'collecting',
      isStreaming: true,
      responses,
      collectedSummaryText,
      summaryText: '',
      shortSummaryText: '',
      successSiteNames,
      failedSiteNames,
      successCount,
      totalCount,
      updatedAt: '',
      readySignature: contentSignature,
      analysisSignature,
      analysisTemplateId: selectedTemplateId,
      analysisTemplateName: selectedTemplateName,
      summarySource: 'analysis',
      summaryError: '',
      compareSites
    }, entryKey);
    syncLiveSummaryRefreshSelection(timelineEntry, { preserveActiveEntry });
    liveSummaryState.status = 'ready';
    renderLiveSummaryCard();
    syncLiveSummaryHintTimer();

    analyzedSummaryText = await requestLiveSummaryAnalysis(analysisPrompt, {
      entryKey,
      onDelta(nextContent) {
        if (!isLiveSummaryAnalysisRequestCurrent(requestToken)) {
          return;
        }
        const streamingSummaryText = String(nextContent || '');
        setLiveSummaryRecord(query, {
          status: hadExistingSummary ? 'refreshing' : 'collecting',
          isStreaming: true,
          responses,
          collectedSummaryText,
          summaryText: streamingSummaryText,
          shortSummaryText: getLiveSummaryCollapsedText(streamingSummaryText),
          successSiteNames,
          failedSiteNames,
          successCount,
          totalCount,
          updatedAt: '',
          readySignature: contentSignature,
          analysisSignature,
          analysisTemplateId: selectedTemplateId,
          analysisTemplateName: selectedTemplateName,
          summarySource: 'analysis',
          summaryError: '',
          compareSites
        }, entryKey);
        if (String(liveSummaryState.activeEntryKey || '').trim() === entryKey) {
          renderLiveSummaryCard();
        }
      }
    });
    if (!isLiveSummaryAnalysisRequestCurrent(requestToken)) {
      return;
    }
  } catch (error) {
    if (!isLiveSummaryAnalysisRequestCurrent(requestToken)) {
      return;
    }
    const summaryError = String(error?.message || '').trim() || t('agentRequestFailed', 'Skill request failed');
    console.warn('自动总结分析请求失败:', error);
    setLiveSummaryRecord(query, {
      status: 'error',
      isStreaming: false,
      responses,
      collectedSummaryText,
      summaryText: '',
      shortSummaryText: '',
      successSiteNames,
      failedSiteNames,
      successCount,
      totalCount,
      updatedAt: new Date().toISOString(),
      readySignature: contentSignature,
      analysisSignature,
      analysisTemplateId: selectedTemplateId,
      analysisTemplateName: selectedTemplateName,
      summarySource: 'analysis',
      summaryError,
      compareSites
    }, entryKey);
    syncLiveSummaryRefreshSelection(timelineEntry, { preserveActiveEntry });
    liveSummaryState.status = 'ready';
    liveSummaryState.version += 1;
    liveSummaryState.displayedVersion = liveSummaryState.version;
    finalizeLiveSummaryAnalysisRequest(requestSource, query, entryKey);
    renderLiveSummaryCard();
    syncLiveSummaryHintTimer();
    return;
  }

  const finalSummaryText = String(analyzedSummaryText || '').trim();
  if (!finalSummaryText) {
    setLiveSummaryRecord(query, {
      status: 'error',
      isStreaming: false,
      responses,
      collectedSummaryText,
      summaryText: '',
      shortSummaryText: '',
      successSiteNames,
      failedSiteNames,
      successCount,
      totalCount,
      updatedAt: new Date().toISOString(),
      readySignature: contentSignature,
      analysisSignature,
      analysisTemplateId: selectedTemplateId,
      analysisTemplateName: selectedTemplateName,
      summarySource: 'analysis',
      summaryError: t('agentRequestFailed', 'Skill request failed'),
      compareSites
    }, entryKey);
    syncLiveSummaryRefreshSelection(timelineEntry, { preserveActiveEntry });
    liveSummaryState.status = 'ready';
    liveSummaryState.version += 1;
    liveSummaryState.displayedVersion = liveSummaryState.version;
    finalizeLiveSummaryAnalysisRequest(requestSource, query, entryKey);
    renderLiveSummaryCard();
    syncLiveSummaryHintTimer();
    return;
  }

  const shortSummaryText = getLiveSummaryCollapsedText(finalSummaryText);

  setLiveSummaryRecord(query, {
    status: 'ready',
    isStreaming: false,
    responses,
    collectedSummaryText,
    summaryText: finalSummaryText,
    shortSummaryText: shortSummaryText || finalSummaryText,
    successSiteNames,
    failedSiteNames,
    successCount,
    totalCount,
    updatedAt: new Date().toISOString(),
    readySignature: contentSignature,
    analysisSignature,
    analysisTemplateId: selectedTemplateId,
    analysisTemplateName: selectedTemplateName,
    summarySource: 'analysis',
    summaryError: '',
    compareSites
  }, entryKey);
  syncLiveSummaryRefreshSelection(timelineEntry, { preserveActiveEntry });
  liveSummaryState.status = 'ready';
  liveSummaryState.version += 1;
  liveSummaryState.displayedVersion = liveSummaryState.version;
  expandLiveSummaryEntryAfterAutoAnalysis(entryKey, requestSource);

  finalizeLiveSummaryAnalysisRequest(requestSource, query, entryKey);
  renderLiveSummaryCard();
  syncLiveSummaryHintTimer();
}

function scheduleLiveSummaryAutoAnalysis(query = '', entryKey = '') {
  const timelineEntry = getLiveSummaryTimelineEntry(query, entryKey);
  const normalizedQuery = normalizeLiveSummaryQuery(timelineEntry?.query || '');
  const resolvedEntryKey = getLiveSummaryEntryKey(timelineEntry);
  if (!normalizedQuery || !resolvedEntryKey) {
    return;
  }

  clearLiveSummaryAutoAnalysisTimer(resolvedEntryKey);
  const now = Date.now();
  const dueAt = ensureLiveSummaryAutoAnalysisDueAt(normalizedQuery, resolvedEntryKey);
  const remainingMs = Math.max(0, dueAt - now);
  if (!remainingMs) {
    return;
  }

  const nextTimer = setTimeout(() => {
    clearLiveSummaryAutoAnalysisTimer(resolvedEntryKey);
    renderLiveSummaryCard();
    refreshLiveSummaryForCurrentQuery({
      query: normalizedQuery,
      entryKey: resolvedEntryKey,
      forceGenerate: true,
      source: 'auto-analysis',
      preserveActiveEntry: true
    }).catch((error) => {
      console.warn('自动分析前刷新自动总结失败:', error);
    });
  }, remainingMs);
  liveSummaryState.autoAnalysisTimersByEntryKey.set(resolvedEntryKey, nextTimer);
}

function initializeLiveSummaryCard() {
  const {
    card,
    actionsCluster,
    shareButton,
    downloadButton,
    copyButton,
    immediateAnalyzeButton,
    pendingSummarizeButton,
    analysisTemplateSelect,
    content
  } = getLiveSummaryElements();
  void hydrateLiveSummaryAnalysisTemplateSelect(liveSummaryContext.selectedAnalysisTemplateId).catch((error) => {
    console.warn('加载自动总结分析提示词模板失败:', error);
  });

  if (card instanceof HTMLElement && card.dataset.actionsVisibilityBound !== '1') {
    const ACTIONS_HIDE_DELAY_MS = 220;
    let hideActionsTimer = null;
    const canShowActions = () => {
      if (card.hidden) {
        return false;
      }
      const activeEntryKey = String(getLiveSummaryCurrentEntryKey() || '').trim();
      return Boolean(activeEntryKey && isLiveSummaryEntryExpanded(activeEntryKey));
    };
    const clearHideActionsTimer = () => {
      if (hideActionsTimer) {
        window.clearTimeout(hideActionsTimer);
        hideActionsTimer = null;
      }
    };
    const showActions = () => {
      clearHideActionsTimer();
      if (!canShowActions()) return;
      card.classList.add('is-actions-visible');
    };
    const hideActions = () => {
      clearHideActionsTimer();
      card.classList.remove('is-actions-visible');
    };
    const scheduleHideActions = () => {
      clearHideActionsTimer();
      hideActionsTimer = window.setTimeout(() => {
        hideActionsTimer = null;
        if (!hasInteractiveFocus() && !hasInteractiveHover()) {
          hideActions();
        }
      }, ACTIONS_HIDE_DELAY_MS);
    };
    const isInsideInteractiveArea = (target) => {
      if (!(target instanceof Node)) {
        return false;
      }
      return Boolean(
        content?.contains(target)
        || actionsCluster?.contains(target)
      );
    };
    const hasInteractiveHover = () => Boolean(
      content?.matches(':hover')
      || actionsCluster?.matches(':hover')
    );
    const hasInteractiveFocus = () => isInsideInteractiveArea(document.activeElement);

    if (content instanceof HTMLElement) {
      content.addEventListener('mouseenter', showActions);
      content.addEventListener('focusin', showActions);
      content.addEventListener('mouseleave', (event) => {
        if (isInsideInteractiveArea(event.relatedTarget)) {
          return;
        }
        scheduleHideActions();
      });
    }

    if (actionsCluster instanceof HTMLElement) {
      actionsCluster.addEventListener('mouseenter', showActions);
      actionsCluster.addEventListener('focusin', showActions);
      actionsCluster.addEventListener('mouseleave', (event) => {
        if (isInsideInteractiveArea(event.relatedTarget)) {
          return;
        }
        scheduleHideActions();
      });
    }

    card.addEventListener('mouseleave', hideActions);
    card.addEventListener('focusout', () => {
      window.requestAnimationFrame(() => {
        if (!hasInteractiveFocus() && !hasInteractiveHover()) {
          hideActions();
        }
      });
    });

    card.dataset.actionsVisibilityBound = '1';
  }

  [shareButton, downloadButton, copyButton].forEach((button) => {
    if (!(button instanceof HTMLButtonElement) || !(card instanceof HTMLElement)) return;
    button.addEventListener('mouseenter', () => {
      showTimelineCopyPreviewTooltip(card, button, button.getAttribute('data-tooltip') || button.getAttribute('aria-label') || '');
    });
    button.addEventListener('mouseleave', () => {
      hideTimelineCopyPreviewTooltip(card);
    });
    button.addEventListener('focus', () => {
      showTimelineCopyPreviewTooltip(card, button, button.getAttribute('data-tooltip') || button.getAttribute('aria-label') || '');
    });
    button.addEventListener('blur', () => {
      hideTimelineCopyPreviewTooltip(card);
    });
  });

  if (analysisTemplateSelect instanceof HTMLSelectElement) {
    analysisTemplateSelect.addEventListener('change', (event) => {
      liveSummaryContext.selectedAnalysisTemplateId = event.target?.value || '';
      renderLiveSummaryCard();
      const query = getLiveSummaryCurrentQuery();
      const entryKey = getLiveSummaryCurrentEntryKey();
      if (query && entryKey) {
        void rerunLiveSummaryAnalysis({ query, entryKey }).catch((error) => {
          console.warn('切换自动总结分析提示词后刷新失败:', error);
        });
      }
    });
  }

  if (copyButton instanceof HTMLButtonElement && card instanceof HTMLElement) {
    copyButton.addEventListener('click', async () => {
      hideTimelineCopyPreviewSharePanel(card);
      const exportBundle = await refreshLiveSummaryExportBundle({ retryFailedSites: true });
      if (!String(exportBundle.copyText || '').trim()) return;
      try {
        await copyTextToClipboard(exportBundle.copyText);
        showTimelineCopyPreviewActionFeedback(
          card,
          copyButton,
          t('timelineCopySuccess', '已复制这条提问的回答（$1/$2）', [
            String(exportBundle.exportSuccessCount || 0),
            String(exportBundle.exportTotalCount || 0)
          ]),
          'success'
        );
      } catch (error) {
        console.error('复制自动总结原文汇总失败:', error);
        showTimelineCopyPreviewActionFeedback(
          card,
          copyButton,
          t('timelineCopyFailed', '复制失败，请重试'),
          'error',
          2600
        );
      }
    });
  }

  if (downloadButton instanceof HTMLButtonElement && card instanceof HTMLElement) {
    downloadButton.addEventListener('click', async () => {
      hideTimelineCopyPreviewSharePanel(card);
      const exportBundle = await refreshLiveSummaryExportBundle({ retryFailedSites: true });
      if (!exportBundle.entry || !String(exportBundle.copyText || '').trim()) return;
      try {
        const filename = sanitizeTimelineExportFileName(exportBundle.entry);
        downloadTimelineMarkdownFile(exportBundle.copyText, filename);
        showToast(t('timelineCopyPreviewDownloadSuccess', 'MD 文件已下载'));
      } catch (error) {
        console.error('下载自动总结原文汇总失败:', error);
        showToast(t('timelineCopyPreviewDownloadFailed', '下载失败，请重试'));
      } finally {
        renderLiveSummaryCard();
      }
    });
  }

  if (shareButton instanceof HTMLButtonElement && card instanceof HTMLElement) {
    shareButton.addEventListener('click', async () => {
      hideTimelineCopyPreviewTooltip(card);
      await refreshLiveSummaryExportBundle({ retryFailedSites: true });
      await createLiveSummaryShareLink(shareButton);
    });
  }

  if (immediateAnalyzeButton instanceof HTMLButtonElement) {
    immediateAnalyzeButton.addEventListener('click', async () => {
      await triggerLiveSummaryImmediateAnalysis();
    });
  }

  if (pendingSummarizeButton instanceof HTMLButtonElement) {
    pendingSummarizeButton.addEventListener('click', async () => {
      await triggerLiveSummarySoonestPendingAnalysis();
    });
  }

  if (content instanceof HTMLElement) {
    content.addEventListener('click', async (event) => {
      const target = event.target instanceof Element
        ? event.target.closest('.live-summary-empty-action')
        : null;
      if (!(target instanceof HTMLButtonElement) || target.disabled) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      await triggerLiveSummaryImmediateAnalysis();
    });
  }

  window.addEventListener(AI_COMPARE_RUNTIME_EVENT, () => {
    const currentSummaryQuery = getLiveSummaryCurrentQuery();
    const currentEntryKey = getLiveSummaryCurrentEntryKey();
    if (!currentSummaryQuery) return;
    scheduleLiveSummaryRefresh(900, {
      query: currentSummaryQuery,
      entryKey: currentEntryKey,
      preserveActiveEntry: true
    });
  });

  if (card instanceof HTMLElement) {
    card.addEventListener('click', (event) => {
      const panel = card.querySelector('.timeline-copy-preview-share-panel');
      const clickedInsidePanel = panel instanceof HTMLElement && panel.contains(event.target);
      const clickedShareBtn = shareButton instanceof HTMLElement && shareButton.contains(event.target);
      if (!clickedInsidePanel && !clickedShareBtn) {
        hideTimelineCopyPreviewSharePanel(card);
      }
    });
  }
}

function startLiveSummaryForQuery(query = '', options = {}) {
  const normalizedQuery = normalizeLiveSummaryQuery(query);
  if (!normalizedQuery) {
    hideLiveSummaryCard();
    return;
  }
  const entryKey = String(options?.entryKey || '').trim();
  markLiveSummaryCollecting(normalizedQuery, entryKey);
  scheduleLiveSummaryRefresh(800, {
    query: normalizedQuery,
    entryKey,
    preserveActiveEntry: true
  });
}

function refreshIframeControlTitles(root = document) {
  root.querySelectorAll('.refresh-page-btn').forEach((button) => {
    button.title = t('refresh', '刷新');
  });
  root.querySelectorAll('.open-page-btn').forEach((button) => {
    button.title = t('openInNewTab', '在新标签页打开');
  });
  root.querySelectorAll('.close-btn').forEach((button) => {
    button.title = t('closeButton', '关闭');
  });
}

function refreshIframeFavoriteI18n() {
  const favoriteIcon = document.querySelector('.favorite-icon');
  if (favoriteIcon) {
    favoriteIcon.title = t('favoriteAllSites', '收藏全部站点');
  }

  document.querySelectorAll('.iframe-favorite-btn').forEach((button) => {
    const isFavorite = button.dataset.favorite === 'true';
    button.title = isFavorite
      ? t('iframeUnfavoriteTitle', '取消收藏')
      : t('iframeFavoriteTitle', '收藏');
    const icon = button.querySelector('.iframe-favorite-icon');
    if (icon) {
      icon.alt = t('iframeFavoriteTitle', '收藏');
    }
  });
}

function refreshIframeDynamicI18n() {
  const searchButton = document.getElementById('searchButton');
  if (searchButton) {
    searchButton.textContent = t('startCompare', 'PK');
  }

  refreshIframeControlTitles();
  refreshIframeFavoriteI18n();
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, '&quot;');
}

function formatTimelineSiteNames(siteNames = []) {
  const names = Array.isArray(siteNames)
    ? siteNames.map((name) => String(name || '').trim()).filter(Boolean)
    : [];
  return names.length ? names.join('、') : '—';
}

function buildTimelineCopyPreviewMetaHtml(successSiteNames = [], failedSiteNames = []) {
  const successLabel = t('timelineCopyPreviewSuccessSitesLabel', '成功站点');
  const failedLabel = t('timelineCopyPreviewFailedSitesLabel', '失败站点');
  const successText = formatTimelineSiteNames(successSiteNames);
  const failedText = formatTimelineSiteNames(failedSiteNames);
  const hasFailedSites = Array.isArray(failedSiteNames) && failedSiteNames.length > 0;

  return [
    `<span class="timeline-copy-preview-meta-line">`
      + `<span class="timeline-copy-preview-meta-label">${escapeHtml(successLabel)}：</span>`
      + `<span class="timeline-copy-preview-meta-sites">${escapeHtml(successText)}</span>`
      + `</span>`,
    `<span class="timeline-copy-preview-meta-line">`
      + `<span class="timeline-copy-preview-meta-label">${escapeHtml(failedLabel)}：</span>`
      + `<span class="timeline-copy-preview-meta-sites${hasFailedSites ? ' is-failed' : ''}">${escapeHtml(failedText)}</span>`
      + `</span>`
  ].join('');
}

function isTimelineResponseCopyable(response) {
  if (!response || typeof response !== 'object') return false;
  if (Array.isArray(response.answers) && response.answers.some((answer) => String(answer || '').trim())) {
    return true;
  }
  return String(response.content || '').trim().length > 0;
}

function partitionTimelineResponses(responses = []) {
  const successResponses = [];
  const successSiteNames = [];
  const failedSiteNames = [];

  for (const response of Array.isArray(responses) ? responses : []) {
    const siteName = String(response?.siteName || '').trim();
    if (!siteName) continue;
    if (isTimelineResponseCopyable(response)) {
      successResponses.push(response);
      successSiteNames.push(siteName);
    } else {
      failedSiteNames.push(siteName);
    }
  }

  return {
    successResponses,
    successSiteNames,
    failedSiteNames
  };
}

function showTimelineCopyPreviewActionFeedback(overlay, anchorButton, message, tone = 'success', duration = 2200) {
  if (!overlay || !anchorButton || !message) return;

  let bubble = overlay.querySelector('.timeline-copy-preview-action-feedback');
  if (!(bubble instanceof HTMLElement)) {
    bubble = document.createElement('div');
    bubble.className = 'timeline-copy-preview-action-feedback';
    bubble.setAttribute('role', 'status');
    bubble.setAttribute('aria-live', 'polite');
    overlay.appendChild(bubble);
  }

  const overlayRect = overlay.getBoundingClientRect();
  const anchorRect = anchorButton.getBoundingClientRect();
  const sharePanel = anchorButton.closest('.timeline-copy-preview-share-panel');
  const referenceRect = sharePanel instanceof HTMLElement
    ? sharePanel.getBoundingClientRect()
    : anchorRect;
  bubble.textContent = String(message);
  bubble.dataset.tone = tone === 'error' ? 'error' : 'success';
  const preferredLeft = anchorRect.left - overlayRect.left - 12;
  const maxLeft = Math.max(16, overlayRect.width - 260);
  bubble.style.left = `${Math.min(Math.max(16, preferredLeft), maxLeft)}px`;
  bubble.style.top = `${Math.max(16, referenceRect.top - overlayRect.top - 46)}px`;
  bubble.classList.add('is-visible');

  if (bubble.__hideTimer) {
    clearTimeout(bubble.__hideTimer);
  }
  bubble.__hideTimer = setTimeout(() => {
    bubble.classList.remove('is-visible');
  }, duration);
}

function setTimelineShareButtonLoading(button, isLoading = false) {
  if (!(button instanceof HTMLButtonElement)) return;
  button.classList.toggle('is-loading', isLoading);
  button.setAttribute('aria-busy', isLoading ? 'true' : 'false');
}

function ensureTimelineCopyPreviewTooltip(overlay) {
  let tooltip = overlay.querySelector('.timeline-copy-preview-tooltip');
  if (!(tooltip instanceof HTMLElement)) {
    tooltip = document.createElement('div');
    tooltip.className = 'timeline-copy-preview-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    overlay.appendChild(tooltip);
  }
  return tooltip;
}

function showTimelineCopyPreviewTooltip(overlay, anchorButton, message) {
  if (!overlay || !anchorButton || !message) return;
  const tooltip = ensureTimelineCopyPreviewTooltip(overlay);
  const overlayRect = overlay.getBoundingClientRect();
  const anchorRect = anchorButton.getBoundingClientRect();
  tooltip.textContent = String(message);
  tooltip.classList.remove('is-below');
  tooltip.classList.add('is-visible');

  const tooltipRect = tooltip.getBoundingClientRect();
  const tooltipWidth = Math.max(tooltipRect.width || 0, tooltip.offsetWidth || 0, 48);
  const tooltipHeight = Math.max(tooltipRect.height || 0, tooltip.offsetHeight || 0, 24);
  const padding = 12;
  const anchorCenterX = anchorRect.left - overlayRect.left + (anchorRect.width / 2);
  const minLeft = padding;
  const maxLeft = Math.max(minLeft, overlayRect.width - tooltipWidth - padding);
  const nextLeft = Math.min(Math.max(anchorCenterX - (tooltipWidth / 2), minLeft), maxLeft);
  const anchorTop = anchorRect.top - overlayRect.top;
  const anchorBottom = anchorRect.bottom - overlayRect.top;
  let nextTop = anchorTop - tooltipHeight - 10;
  const shouldPlaceBelow = nextTop < padding;
  if (shouldPlaceBelow) {
    nextTop = Math.min(anchorBottom + 10, Math.max(padding, overlayRect.height - tooltipHeight - padding));
    tooltip.classList.add('is-below');
  }

  const arrowLeft = Math.min(
    Math.max(anchorCenterX - nextLeft, 14),
    Math.max(14, tooltipWidth - 14)
  );
  tooltip.style.left = `${nextLeft}px`;
  tooltip.style.top = `${Math.max(padding, nextTop)}px`;
  tooltip.style.setProperty('--timeline-tooltip-arrow-left', `${arrowLeft}px`);
  tooltip.classList.add('is-visible');
}

function hideTimelineCopyPreviewTooltip(overlay) {
  const tooltip = overlay?.querySelector('.timeline-copy-preview-tooltip');
  if (tooltip instanceof HTMLElement) {
    tooltip.classList.remove('is-visible');
  }
}

function ensureTimelineCopyPreviewSharePanel(overlay) {
  let panel = overlay.querySelector('.timeline-copy-preview-share-panel');
  if (panel) return panel;

  panel = document.createElement('div');
  panel.className = 'timeline-copy-preview-share-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="timeline-copy-preview-share-panel__row">
      <input class="timeline-copy-preview-share-panel__input" type="text" readonly>
    </div>
    <div class="timeline-copy-preview-share-panel__actions">
      <button class="timeline-copy-preview-share-panel__open" type="button"></button>
      <button class="timeline-copy-preview-share-panel__copy" type="button"></button>
    </div>
  `;
  overlay.appendChild(panel);
  return panel;
}

function hideTimelineCopyPreviewSharePanel(overlay) {
  const panel = overlay?.querySelector('.timeline-copy-preview-share-panel');
  if (panel instanceof HTMLElement) {
    panel.hidden = true;
    panel.classList.remove('is-visible');
  }
}

function showTimelineCopyPreviewSharePanel(overlay, anchorButton, shareUrl, options = {}) {
  if (!overlay || !anchorButton || !shareUrl) return;
  const panel = ensureTimelineCopyPreviewSharePanel(overlay);
  const input = panel.querySelector('.timeline-copy-preview-share-panel__input');
  const openBtn = panel.querySelector('.timeline-copy-preview-share-panel__open');
  const copyBtn = panel.querySelector('.timeline-copy-preview-share-panel__copy');
  if (!(input instanceof HTMLInputElement) || !(openBtn instanceof HTMLButtonElement) || !(copyBtn instanceof HTMLButtonElement)) return;

  input.value = shareUrl;
  openBtn.textContent = t('timelineCopyPreviewOpen', '打开');
  copyBtn.textContent = t('timelineCopyPreviewConfirm', '复制');
  const copySuccessMessage = String(options?.copySuccessMessage || t('timelineCopyPreviewShareSuccess', '分享链接已复制'));
  openBtn.onclick = async () => {
    try {
      if (chrome?.tabs?.create) {
        await chrome.tabs.create({ url: shareUrl });
      } else {
        window.open(shareUrl, '_blank', 'noopener,noreferrer');
      }
    } catch (error) {
      console.error('打开分享链接失败:', error);
      showTimelineCopyPreviewActionFeedback(
        overlay,
        anchorButton,
        t('timelineCopyPreviewShareFailed', '生成分享链接失败，请重试'),
        'error',
        2600
      );
    }
  };
  copyBtn.onclick = async () => {
    try {
      await copyTextToClipboard(shareUrl);
      showTimelineCopyPreviewActionFeedback(
        overlay,
        copyBtn,
        copySuccessMessage,
        'success'
      );
    } catch (error) {
      console.error('复制分享链接失败:', error);
      showTimelineCopyPreviewActionFeedback(
        overlay,
        copyBtn,
        t('timelineCopyFailed', '复制失败，请重试'),
        'error',
        2600
      );
    }
  };

  const overlayRect = overlay.getBoundingClientRect();
  const anchorRect = anchorButton.getBoundingClientRect();
  const preferredLeft = anchorRect.left - overlayRect.left - 120;
  const maxLeft = Math.max(16, overlayRect.width - 360);
  panel.style.left = `${Math.min(Math.max(16, preferredLeft), maxLeft)}px`;
  panel.style.top = `${Math.max(16, anchorRect.top - overlayRect.top - 96)}px`;
  panel.hidden = false;
  requestAnimationFrame(() => panel.classList.add('is-visible'));
}

function getTimelineElements() {
  return {
    panel: document.getElementById('timelinePanel'),
    hint: document.getElementById('timelinePanelHint'),
    list: document.getElementById('timelineList'),
    toggleButton: document.getElementById('timelineToggleButton'),
    shareButton: document.getElementById('shareTimelineButton'),
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
  hideTimelineCopyPreviewTooltip(overlay);
  hideTimelineCopyPreviewSharePanel(overlay);
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
    const { successSiteNames, failedSiteNames } = partitionTimelineResponses(responses);
    metaEl.innerHTML = buildTimelineCopyPreviewMetaHtml(successSiteNames, failedSiteNames);
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
        <div class="timeline-copy-preview-export-actions">
          <button class="timeline-copy-preview-share" type="button" aria-label="${escapeHtml(t('timelineCopyPreviewShare', '分享'))}" data-tooltip="${escapeAttr(t('timelineCopyPreviewShare', '分享'))}">
            <img src="../icons/link.svg" alt="" aria-hidden="true">
          </button>
          <button class="timeline-copy-preview-download" type="button" aria-label="${escapeHtml(t('timelineCopyPreviewDownload', '下载 MD'))}" data-tooltip="${escapeAttr(t('timelineCopyPreviewDownload', '下载 MD'))}">
            <img src="../icons/download.svg" alt="" aria-hidden="true">
          </button>
          <button class="timeline-copy-preview-confirm" type="button" aria-label="${escapeHtml(t('timelineCopyPreviewConfirm', '复制'))}" data-tooltip="${escapeAttr(t('timelineCopyPreviewConfirm', '复制'))}">
            <span aria-hidden="true">⧉</span>
          </button>
        </div>
      </div>
    </div>
  `;

  const closeModal = () => {
    hideTimelineCopyPreviewTooltip(overlay);
    hideTimelineCopyPreviewSharePanel(overlay);
    overlay.classList.remove('is-visible');
  };

  overlay.querySelectorAll('.timeline-copy-preview-export-actions button').forEach((button) => {
    button.addEventListener('mouseenter', () => {
      showTimelineCopyPreviewTooltip(overlay, button, button.getAttribute('data-tooltip') || button.getAttribute('aria-label') || '');
    });
    button.addEventListener('mouseleave', () => {
      hideTimelineCopyPreviewTooltip(overlay);
    });
    button.addEventListener('focus', () => {
      showTimelineCopyPreviewTooltip(overlay, button, button.getAttribute('data-tooltip') || button.getAttribute('aria-label') || '');
    });
    button.addEventListener('blur', () => {
      hideTimelineCopyPreviewTooltip(overlay);
    });
  });

  overlay.querySelector('.timeline-copy-preview-confirm')?.addEventListener('click', async () => {
    const confirmBtn = overlay.querySelector('.timeline-copy-preview-confirm');
    if (!(confirmBtn instanceof HTMLButtonElement)) return;
    hideTimelineCopyPreviewSharePanel(overlay);

    const copyText = confirmBtn.dataset.copyText || '';
    const successCount = confirmBtn.dataset.successCount || '0';
    const totalCount = confirmBtn.dataset.totalCount || '0';
    if (!copyText.trim()) return;

    try {
      await copyTextToClipboard(copyText);
      showTimelineCopyPreviewActionFeedback(
        overlay,
        confirmBtn,
        t('timelineCopySuccess', '已复制这条提问的回答（$1/$2）', [successCount, totalCount]),
        'success'
      );
      trackEvent('iframe_timeline_copy', {
        sites_total: Number(totalCount) || 0,
        sites_with_content: Number(successCount) || 0
      });
    } catch (error) {
      console.error('复制时间线回答失败:', error);
      showTimelineCopyPreviewActionFeedback(
        overlay,
        confirmBtn,
        t('timelineCopyFailed', '复制失败，请重试'),
        'error',
        2600
      );
    }
  });

  overlay.querySelector('.timeline-copy-preview-download')?.addEventListener('click', async () => {
    const downloadBtn = overlay.querySelector('.timeline-copy-preview-download');
    if (!(downloadBtn instanceof HTMLButtonElement)) return;
    hideTimelineCopyPreviewSharePanel(overlay);

    const markdownContent = getTimelineCopyPreviewMarkdownContent(overlay);
    if (!markdownContent) return;

    try {
      downloadBtn.disabled = true;
      const filename = sanitizeTimelineExportFileName(overlay.__timelineCopyPreviewEntry || null);
      downloadTimelineMarkdownFile(markdownContent, filename);
      showToast(t('timelineCopyPreviewDownloadSuccess', 'MD 文件已下载'));
    } catch (error) {
      console.error('下载时间线回答失败:', error);
      showToast(t('timelineCopyPreviewDownloadFailed', '下载失败，请重试'));
    } finally {
      downloadBtn.disabled = false;
    }
  });

  overlay.querySelector('.timeline-copy-preview-share')?.addEventListener('click', async () => {
    hideTimelineCopyPreviewTooltip(overlay);
    await createTimelineShareLink(overlay, 'web');
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
      return;
    }
    const panel = overlay.querySelector('.timeline-copy-preview-share-panel');
    const shareBtn = overlay.querySelector('.timeline-copy-preview-share');
    const clickedInsidePanel = panel instanceof HTMLElement && panel.contains(event.target);
    const clickedShareBtn = shareBtn instanceof HTMLElement && shareBtn.contains(event.target);
    if (!clickedInsidePanel && !clickedShareBtn) {
      hideTimelineCopyPreviewSharePanel(overlay);
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

async function createTimelineShareLink(overlay, viewMode = 'web') {
  const shareBtn = overlay.querySelector(viewMode === 'image'
    ? '.timeline-copy-preview-share-image'
    : '.timeline-copy-preview-share');
  const confirmBtn = overlay.querySelector('.timeline-copy-preview-confirm');
  if (!(shareBtn instanceof HTMLButtonElement) || !(confirmBtn instanceof HTMLButtonElement)) return;

  const rawPayload = analysisBuildSharePayload({
    entry: overlay.__timelineCopyPreviewEntry || null,
    summaryText: overlay.__timelineCopyPreviewCopyText || confirmBtn.dataset.copyText || '',
    responses: Array.isArray(overlay.__timelineCopyPreviewResponses) ? overlay.__timelineCopyPreviewResponses : [],
    question: overlay.__timelineCopyPreviewEntry?.query || '',
    successCount: Number(confirmBtn.dataset.successCount || '0') || 0,
    totalCount: Number(confirmBtn.dataset.totalCount || '0') || 0,
    analysisTemplateId: overlay.__timelineSelectedAnalysisTemplateId || '',
    analysisTemplateName: '',
    analysisTemplateQuery: ''
  });

  if (!rawPayload) {
    showTimelineCopyPreviewActionFeedback(
      overlay,
      shareBtn,
      t('timelineCopyPreviewShareFailed', '生成分享链接失败，请重试'),
      'error',
      2600
    );
    return;
  }

  const relayBaseUrl = await getRemoteSearchRelayBaseUrl();
  if (!relayBaseUrl) {
    showTimelineCopyPreviewActionFeedback(
      overlay,
      shareBtn,
      t('timelineCopyPreviewShareNoRelay', '请先在设置中填写 relay 地址'),
      'error',
      2600
    );
    return;
  }

  shareBtn.disabled = true;
  setTimelineShareButtonLoading(shareBtn, true);
  try {
    const response = await fetch(`${relayBaseUrl.replace(/\/+$/, '')}/shares`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(rawPayload)
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok || !data?.shareId) {
      throw new Error(data?.error || `share_http_${response.status}`);
    }

    const baseShareUrl = String(data.publicUrl || data.shareUrl || `/share/${encodeURIComponent(data.shareId)}`).trim().startsWith('http')
      ? String(data.publicUrl || data.shareUrl).trim()
      : `${relayBaseUrl.replace(/\/+$/, '')}${String(data.publicUrl || data.shareUrl || `/share/${encodeURIComponent(data.shareId)}`).trim()}`;
    const shareUrl = viewMode === 'image'
      ? `${baseShareUrl}${baseShareUrl.includes('?') ? '&' : '?'}view=image`
      : baseShareUrl;
    showTimelineCopyPreviewSharePanel(overlay, shareBtn, shareUrl, {
      copySuccessMessage: viewMode === 'image'
        ? t('timelineCopyPreviewShareImageSuccess', '图模式链接已复制')
        : t('timelineCopyPreviewShareSuccess', '分享链接已复制')
    });
  } catch (error) {
    console.error('生成分享链接失败:', error);
    showTimelineCopyPreviewActionFeedback(
      overlay,
      shareBtn,
      t('timelineCopyPreviewShareFailed', '生成分享链接失败，请重试'),
      'error',
      2600
    );
  } finally {
    setTimelineShareButtonLoading(shareBtn, false);
    shareBtn.disabled = false;
  }
}

async function createLiveSummaryShareLink(anchorButton) {
  const { card } = getLiveSummaryElements();
  if (!(card instanceof HTMLElement) || !(anchorButton instanceof HTMLButtonElement)) return;

  const exportBundle = getLiveSummaryExportBundle();
  const shareSummaryText = String(exportBundle.analysisSummaryText || '').trim();
  if (!exportBundle.entry || !shareSummaryText) {
    showTimelineCopyPreviewActionFeedback(
      card,
      anchorButton,
      t('timelineCopyPreviewShareFailed', '生成分享链接失败，请重试'),
      'error',
      2600
    );
    return;
  }

  const selectedTemplate = getSelectedLiveSummaryAnalysisTemplate();
  const rawPayload = analysisBuildSharePayload({
    entry: exportBundle.entry,
    summaryText: shareSummaryText,
    responses: exportBundle.exportResponses,
    question: exportBundle.entry?.query || '',
    successCount: exportBundle.exportSuccessCount,
    totalCount: exportBundle.exportTotalCount,
    analysisTemplateId: selectedTemplate?.id || '',
    analysisTemplateName: selectedTemplate?.name || '',
    analysisTemplateQuery: selectedTemplate?.query || ''
  });

  if (!rawPayload) {
    showTimelineCopyPreviewActionFeedback(
      card,
      anchorButton,
      t('timelineCopyPreviewShareFailed', '生成分享链接失败，请重试'),
      'error',
      2600
    );
    return;
  }

  const relayBaseUrl = await getRemoteSearchRelayBaseUrl();
  if (!relayBaseUrl) {
    showTimelineCopyPreviewActionFeedback(
      card,
      anchorButton,
      t('timelineCopyPreviewShareNoRelay', '请先在设置中填写 relay 地址'),
      'error',
      2600
    );
    return;
  }

  anchorButton.disabled = true;
  setTimelineShareButtonLoading(anchorButton, true);
  try {
    const response = await fetch(`${relayBaseUrl.replace(/\/+$/, '')}/shares`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(rawPayload)
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok || !data?.shareId) {
      throw new Error(data?.error || `share_http_${response.status}`);
    }

    const baseShareUrl = String(data.publicUrl || data.shareUrl || `/share/${encodeURIComponent(data.shareId)}`).trim().startsWith('http')
      ? String(data.publicUrl || data.shareUrl).trim()
      : `${relayBaseUrl.replace(/\/+$/, '')}${String(data.publicUrl || data.shareUrl || `/share/${encodeURIComponent(data.shareId)}`).trim()}`;
    showTimelineCopyPreviewSharePanel(card, anchorButton, baseShareUrl, {
      copySuccessMessage: t('timelineCopyPreviewShareSuccess', '分享链接已复制')
    });
  } catch (error) {
    console.error('生成自动总结分享链接失败:', error);
    showTimelineCopyPreviewActionFeedback(
      card,
      anchorButton,
      t('timelineCopyPreviewShareFailed', '生成分享链接失败，请重试'),
      'error',
      2600
    );
  } finally {
    setTimelineShareButtonLoading(anchorButton, false);
    anchorButton.disabled = false;
  }
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
  hideTimelineCopyPreviewTooltip(overlay);
  hideTimelineCopyPreviewSharePanel(overlay);

  const activeEntryKey = String(entry?.timelineId || getLiveSummaryEntryKey(entry));
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
  const { panel, hint, toggleButton, shareButton, edgeTrigger } = getTimelineElements();
  if (panel) {
    panel.hidden = !timelineState.isOpen;
    panel.classList.toggle('is-edge-preview', timelineState.isOpen && timelineState.openMode === 'hover');
    panel.classList.toggle('is-share-picker-active', timelineState.isOpen && timelineState.sharePickerActive);
  }
  if (hint) {
    hint.hidden = !(timelineState.isOpen && timelineState.sharePickerActive);
  }
  if (toggleButton) {
    toggleButton.classList.toggle('is-active', timelineState.isOpen);
    toggleButton.setAttribute('aria-expanded', timelineState.isOpen ? 'true' : 'false');
  }
  if (shareButton) {
    shareButton.setAttribute('aria-expanded', timelineState.isOpen && timelineState.sharePickerActive ? 'true' : 'false');
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

function setTimelineSharePickerActive(isActive) {
  timelineState.sharePickerActive = Boolean(isActive);
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
  setTimelineSharePickerActive(false);
  setTimelinePanelOpen(false);
}

async function openTopLevelShareFlow() {
  if (timelineState.isOpen && timelineState.isPinned && timelineState.sharePickerActive) {
    closeTimelinePanel();
    return;
  }

  if (!isReadonlyHistoryMode) {
    try {
      await syncTimelineFromIframes();
    } catch (error) {
      console.warn('打开分享入口前同步时间线失败:', error);
    }
  }

  if (!timelineState.entries.length) {
    showToast(t('timelineEmpty', '还没有提问记录，发送问题后会显示在这里。'));
    return;
  }

  if (timelineState.entries.length === 1) {
    setTimelineSharePickerActive(false);
    await copyTimelineEntryResponses(timelineState.entries[0]);
    return;
  }

  openTimelinePanel({
    pinned: true,
    mode: 'hover'
  });
  setTimelineSharePickerActive(true);
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
  return getLiveSummaryEntryKey(entry);
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
  const hybridSession = await getHybridHistorySessionById(historyId);
  if (hybridSession) {
    return hybridSession;
  }
  const { pkHistory = [] } = await chrome.storage.local.get('pkHistory');
  return pkHistory.find((item) => String(item?.id || '') === String(historyId)) || null;
}

async function getHistoryRestoreContext(historyId) {
  const historyItem = await getHistoryItemById(historyId);
  if (!historyItem) return null;
  return normalizeRestoreContext(historyItem.restoreContext, historyItem.query);
}

function isHybridHistoryRecord(record) {
  if (!record || typeof record !== 'object') return false;
  if (String(record.mode || '').trim() === 'hybrid') return true;
  if (Array.isArray(record.openAgentIds) && record.openAgentIds.length > 0) return true;
  if (Array.isArray(record.openSiteNames) && record.openSiteNames.length > 0) return true;
  return Boolean(record.panels && typeof record.panels === 'object');
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
          title="${escapeHtml(t('timelineCopyPreviewShare', '分享'))}"
          aria-label="${escapeHtml(t('timelineCopyPreviewShare', '分享'))}"
        >
          <img class="timeline-item-copy-icon" src="../icons/share.svg" alt="" aria-hidden="true">
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
      syncLiveSummaryVisibleEntryKeys(getLiveSummaryEntryKey(entry));
      renderLiveSummaryCard();
      if (timelineState.sharePickerActive) {
        closeTimelinePanel();
        await copyTimelineEntryResponses(entry);
        return;
      }
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
  const query = normalizeLiveSummaryQuery(entry?.query);
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
        syncLiveSummaryVisibleEntryKeys(getLiveSummaryEntryKey(existingEntry));
        renderLiveSummaryCard();
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
  syncLiveSummaryVisibleEntryKeys(getLiveSummaryEntryKey(normalizedEntry));
  renderLiveSummaryCard();
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
    const { panel: timelinePanel, toggleButton: timelineToggleButton, shareButton: timelineShareButton } = getTimelineElements();
    if (!timelinePanel || timelinePanel.hidden) return;
    if (
      timelinePanel.contains(event.target) ||
      timelineToggleButton?.contains(event.target) ||
      timelineShareButton?.contains(event.target) ||
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

function buildTimelineIdFromQuery(query, occurrenceIndex = 0) {
  const normalizedQuery = String(query || '').slice(0, 200);
  return `timeline-${encodeURIComponent(normalizedQuery)}-${Math.max(0, Number(occurrenceIndex) || 0)}`;
}

function getOpenTimelineSiteNames() {
  return getSiteIframes()
    .map((iframe) => String(iframe.getAttribute('data-site') || '').trim())
    .filter(Boolean);
}

function getOpenTimelineSnapshots() {
  const siteNames = getOpenTimelineSiteNames();
  const snapshots = siteNames.map((siteName) => {
    const snapshot = timelineState.promptSnapshotsBySite.get(siteName);
    if (!snapshot) return null;
    return {
      siteName: snapshot.siteName || siteName,
      prompts: Array.isArray(snapshot.prompts) ? snapshot.prompts : []
    };
  }).filter(Boolean);

  getOpenedAgentIds().forEach((agentId) => {
    const state = getAgentState(agentId);
    if (!state) return;
    const siteName = String(state?.name || agentId || '').trim();
    const prompts = timelineExtractPromptsFromMessages(state.messages);
    if (!siteName || !prompts.length) return;
    snapshots.push({
      siteName,
      prompts
    });
  });

  return snapshots;
}

function resetTimelinePromptSnapshots() {
  timelineState.promptSnapshotsBySite.clear();
  timelineState.entries = [];
  timelineState.activeTimelineId = null;
  renderTimeline();
}

function rebuildTimelineEntriesFromSnapshots() {
  const openSiteNames = getOpenTimelineSiteNames();
  const hasAgentPanels = getOpenedAgentIds().length > 0;
  if (!openSiteNames.length && !hasAgentPanels) {
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

  const snapshots = getOpenTimelineSnapshots();

  const previousEntries = timelineState.entries;
  const mergedEntries = timelineMergeSnapshots(snapshots, previousEntries);
  const previousEntryKeySet = new Set(previousEntries.map((entry) => timelineBuildEntryKey(entry)).filter(Boolean));
  const activeEntry = previousEntries.find((entry) => entry.timelineId === timelineState.activeTimelineId);
  const filteredMergedEntries = mergedEntries.filter((entry) => {
    const occurrenceIndex = Math.max(0, Number(entry?.occurrenceIndex) || 0);
    if (occurrenceIndex === 0) {
      return true;
    }
    const entryKey = timelineBuildEntryKey({
      query: entry?.query || '',
      normalizedQuery: entry?.normalizedQuery || '',
      occurrenceIndex
    });
    if (entryKey && previousEntryKeySet.has(entryKey)) {
      return true;
    }
    return false;
  });

  const nextEntries = [];
  timelineState.entries = filteredMergedEntries.map((entry) => {
    const entryKey = timelineBuildEntryKey({
      query: entry.query,
      normalizedQuery: entry.normalizedQuery,
      occurrenceIndex: Math.max(0, Number(entry?.occurrenceIndex) || 0)
    });
    const existingEntry = previousEntries.find((item) => timelineBuildEntryKey(item) === entryKey);
    const builtEntry = timelineBuildEntry({
      query: entry.query,
      occurrenceIndex: Math.max(0, Number(entry?.occurrenceIndex) || 0),
      timelineId: buildTimelineIdFromQuery(entry.query, entry?.occurrenceIndex),
      timestamp: existingEntry?.timestamp || Date.now()
    }, nextEntries);
    nextEntries.push(builtEntry);

    return {
      ...builtEntry,
      timelineId: existingEntry?.timelineId || builtEntry.timelineId,
      sourceSites: entry.sourceSites || [],
      siteCount: Array.isArray(entry.sourceSites) ? entry.sourceSites.length : 0
    };
  });

  if (activeEntry) {
    const activeEntryKey = timelineBuildEntryKey(activeEntry);
    const nextActiveEntry = activeEntryKey
      ? timelineFindEntryByKey(timelineState.entries, activeEntryKey)
      : null;
    timelineState.activeTimelineId = nextActiveEntry?.timelineId || null;
  } else if (!timelineState.entries.find((entry) => entry.timelineId === timelineState.activeTimelineId)) {
    timelineState.activeTimelineId = timelineState.entries[timelineState.entries.length - 1]?.timelineId || null;
  }

  renderTimeline();
  syncLiveSummaryVisibleEntryKeys();
  renderLiveSummaryCard();
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
  initializeAgentRuntimeMessageBridge();

  window.addEventListener('message', (event) => {
    const data = event.data || {};
    if (data.type !== 'AGENT_PANEL_EVENT') {
      return;
    }
    if (data.event === 'attachmentError' && data.error) {
      showToast(String(data.error));
      return;
    }
    if (data.event === 'localDraftChanged' && data.agentId) {
      updateAgentDraftState(String(data.agentId), String(data.draft || ''));
      return;
    }
    if (data.event === 'pendingAttachmentsChanged' && data.agentId) {
      updateAgentPendingAttachments(
        String(data.agentId),
        normalizeAgentAttachments(data.attachments)
      );
      return;
    }
    if (data.event === 'pendingAttachmentFilesSelected' && data.agentId) {
      stageAgentAttachmentSourcesFromPanel({
        agentId: String(data.agentId),
        entries: Array.isArray(data.entries) ? data.entries : []
      });
      return;
    }
    if (
      data.event === 'submitLocalMessage' &&
      data.agentId &&
      (String(data.content || '').trim() || (Array.isArray(data.attachments) && data.attachments.length > 0))
    ) {
      runAgentPrompt(
        String(data.agentId),
        String(data.content || ''),
        'local',
        normalizeAgentAttachments(data.attachments)
      ).catch((error) => {
        console.error('执行智能体本地提问失败:', error);
      });
    }
  });

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
  const hasAgentPanels = getOpenedAgentIds().length > 0;
  if (!iframes.length && !hasAgentPanels) {
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
  const normalizedText = String(text ?? '');

  const copyWithExecCommand = () => {
    const textarea = document.createElement('textarea');
    textarea.value = normalizedText;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.inset = '0 auto auto 0';
    textarea.style.width = '1px';
    textarea.style.height = '1px';
    textarea.style.padding = '0';
    textarea.style.border = '0';
    textarea.style.outline = '0';
    textarea.style.boxShadow = 'none';
    textarea.style.background = 'transparent';
    textarea.style.opacity = '0.01';
    textarea.style.pointerEvents = 'none';
    textarea.style.zIndex = '-1';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);

    const succeeded = document.execCommand('copy');
    textarea.remove();
    if (!succeeded) {
      throw new Error('execCommand copy failed');
    }
  };

  if (navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(normalizedText);
      return;
    } catch (error) {
      console.warn('navigator.clipboard.writeText failed, falling back to execCommand:', error);
    }
  }

  try {
    copyWithExecCommand();
    return;
  } catch (error) {
    console.warn('execCommand copy failed, falling back to prompt:', error);
  }

  const manualText = window.prompt(
    t('timelineCopyPreviewShareManualPrompt', '自动复制失败，请手动复制下面的链接：'),
    normalizedText
  );

  if (manualText === null) {
    throw new Error('manual_copy_cancelled');
  }
}

function sortAnalysisPromptTemplates(templates = []) {
  return (Array.isArray(templates) ? templates : [])
    .filter((template) => template && template.name && template.query)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

async function getStoredDefaultAnalysisTemplateId() {
  try {
    const data = await chrome.storage.sync.get(DEFAULT_ANALYSIS_TEMPLATE_ID_STORAGE_KEY);
    return String(data?.[DEFAULT_ANALYSIS_TEMPLATE_ID_STORAGE_KEY] || '').trim();
  } catch (error) {
    console.warn('加载默认分析提示词失败:', error);
    return '';
  }
}

async function resolvePreferredAnalysisTemplateId(templates = [], selectedTemplateId = '') {
  const normalizedTemplates = Array.isArray(templates) ? templates : [];
  if (!normalizedTemplates.length) {
    return '';
  }

  const requestedId = String(selectedTemplateId || '').trim();
  if (requestedId && normalizedTemplates.some((template) => template.id === requestedId)) {
    return requestedId;
  }

  const storedDefaultId = await getStoredDefaultAnalysisTemplateId();
  if (storedDefaultId && normalizedTemplates.some((template) => template.id === storedDefaultId)) {
    return storedDefaultId;
  }

  try {
    const analysisConfig = await window.AppConfigManager.getAnalysisPromptTemplateConfig();
    const configuredDefaultId = String(analysisConfig?.defaultTemplateId || '').trim();
    if (configuredDefaultId && normalizedTemplates.some((template) => template.id === configuredDefaultId)) {
      return configuredDefaultId;
    }
  } catch (error) {
    console.warn('Failed to load configured default analysis template id:', error);
  }

  return String(normalizedTemplates[0]?.id || '').trim();
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

  const nextSelectedId = await resolvePreferredAnalysisTemplateId(templates, selectedTemplateId);
  selectEl.value = nextSelectedId;
  overlay.__timelineSelectedAnalysisTemplateId = nextSelectedId;
  selectEl.disabled = false;
  if (analyzeBtn instanceof HTMLButtonElement) {
    analyzeBtn.disabled = !String(overlay.__timelineCopyPreviewCopyText || '').trim();
  }
  return templates;
}

async function hydrateLiveSummaryAnalysisTemplateSelect(selectedTemplateId = '') {
  const { analysisTemplateSelect, immediateAnalyzeButton } = getLiveSummaryElements();
  if (!(analysisTemplateSelect instanceof HTMLSelectElement)) {
    return [];
  }

  analysisTemplateSelect.disabled = true;
  analysisTemplateSelect.innerHTML = `<option value="">${escapeHtml(t('analysisTemplateLoading', '加载分析提示词...'))}</option>`;
  if (immediateAnalyzeButton instanceof HTMLButtonElement) {
    immediateAnalyzeButton.disabled = true;
  }

  const templates = await loadAnalysisPromptTemplates();
  liveSummaryContext.analysisTemplates = templates;

  if (!templates.length) {
    analysisTemplateSelect.innerHTML = `<option value="">${escapeHtml(t('analysisTemplateEmpty', '暂无分析提示词模板'))}</option>`;
    analysisTemplateSelect.disabled = true;
    return templates;
  }

  analysisTemplateSelect.innerHTML = templates.map((template) => `
    <option value="${escapeHtml(template.id)}">${escapeHtml(template.name)}</option>
  `).join('');
  Array.from(analysisTemplateSelect.options || []).forEach((option) => {
    option.dataset.baseLabel = String(option.textContent || '').trim();
  });

  const nextSelectedId = await resolvePreferredAnalysisTemplateId(templates, selectedTemplateId);
  analysisTemplateSelect.value = nextSelectedId;
  analysisTemplateSelect.disabled = false;
  liveSummaryContext.selectedAnalysisTemplateId = nextSelectedId;
  refreshLiveSummaryAnalysisTemplateSelectLabel();
  if (immediateAnalyzeButton instanceof HTMLButtonElement) {
    immediateAnalyzeButton.disabled = !getLiveSummaryCurrentQuery() || !nextSelectedId;
  }
  return templates;
}

async function collectTimelineEntryResponses(entry) {
  if (isReadonlyHistoryMode && readonlyHistorySession) {
    const responses = collectReadonlyTimelineEntryResponses(entry, readonlyHistorySession);
    const { successResponses } = partitionTimelineResponses(responses);

    return {
      responses,
      copyText: timelineBuildCopyText(entry, successResponses),
      successCount: successResponses.length,
      totalCount: responses.length
    };
  }

  const iframes = getSiteIframes();
  const agentResponses = getLiveAgentTimelineResponses(entry);
  if (!iframes.length) {
    const { successResponses } = partitionTimelineResponses(agentResponses);
    return {
      responses: agentResponses,
      copyText: timelineBuildCopyText(entry, successResponses),
      successCount: successResponses.length,
      totalCount: agentResponses.length
    };
  }

  const siteResponses = await Promise.all(iframes.map((iframe) => {
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

  const normalizedResponses = siteResponses.map((item) => ({
    siteName: item?.siteName || '',
    answers: Array.isArray(item?.answers) ? item.answers : [],
    content: item?.content || '',
    error: item?.error || ''
  }));
  normalizedResponses.push(...agentResponses);

  const { successResponses, successSiteNames, failedSiteNames } = partitionTimelineResponses(normalizedResponses);

  return {
    responses: normalizedResponses,
    copyText: timelineBuildCopyText(entry, successResponses),
    successCount: successResponses.length,
    successSiteNames,
    failedSiteNames,
    totalCount: normalizedResponses.length
  };
}

function getPanelEntriesInOrder(session) {
  const panels = session?.panels && typeof session.panels === 'object' ? session.panels : {};
  const panelOrder = Array.isArray(session?.panelOrder) ? session.panelOrder : [];
  const ordered = panelOrder
    .map((panelId) => panels[String(panelId || '').trim()] || null)
    .filter(Boolean);
  const unordered = Object.entries(panels)
    .filter(([panelId]) => !panelOrder.includes(panelId))
    .map(([, panel]) => panel);
  return [...ordered, ...unordered];
}

function collectReadonlyTimelineEntryResponses(entry, session) {
  const panelEntries = getPanelEntriesInOrder(session);
  return panelEntries.map((panel) => {
    const panelType = String(panel?.panelType || '').trim();
    const title = String(panel?.title || panel?.agentName || panel?.siteName || panel?.agentId || 'Panel').trim();

    if (panelType === PANEL_KIND.AGENT || panelType === PANEL_KIND.AGENT_SNAPSHOT || panelType === 'agent') {
      const assistantContent = getAgentResponseForTimelineEntry({
        messages: Array.isArray(panel?.messages) ? panel.messages : []
      }, entry);
      return {
        siteName: title,
        answers: assistantContent ? [assistantContent] : [],
        content: assistantContent || '',
        error: assistantContent ? '' : t('timelineCopyPreviewEmpty', '当前没有可复制的回答内容。')
      };
    }

    const content = String(panel?.snapshotText || panel?.content || panel?.url || '').trim();
    return {
      siteName: title,
      answers: content ? [content] : [],
      content,
      error: content ? '' : t('timelineCopyPreviewEmpty', '当前没有可复制的回答内容。')
    };
  });
}

function getLiveAgentTimelineResponses(entry) {
  return getOpenedAgentIds().map((agentId) => {
    const state = getAgentState(agentId);
    const content = getAgentResponseForTimelineEntry(state, entry);
    return {
      siteName: state?.name || agentId,
      answers: content ? [content] : [],
      content,
      error: content ? '' : t('timelineCopyPreviewEmpty', '当前没有可复制的回答内容。')
    };
  });
}

function getAgentResponseForTimelineEntry(state, entry) {
  if (!state || !Array.isArray(state.messages) || !entry?.query) {
    return '';
  }

  const query = String(entry.query || '').trim();
  if (!query) return '';

  let matchedUserIndex = -1;
  let matchedCount = -1;
  let userOccurrenceIndex = 0;

  state.messages.forEach((message, index) => {
    if (message?.role !== 'user') return;
    const content = String(message?.content || '').trim();
    if (!content) return;
    if (content !== query) return;
    if (userOccurrenceIndex === Number(entry?.occurrenceIndex || 0)) {
      matchedUserIndex = index;
      matchedCount = userOccurrenceIndex;
    }
    userOccurrenceIndex += 1;
  });

  if (matchedUserIndex === -1 && matchedCount === -1) {
    for (let index = state.messages.length - 1; index >= 0; index -= 1) {
      const message = state.messages[index];
      if (message?.role === 'user' && String(message?.content || '').trim() === query) {
        matchedUserIndex = index;
        break;
      }
    }
  }

  if (matchedUserIndex === -1) {
    return '';
  }

  for (let index = matchedUserIndex + 1; index < state.messages.length; index += 1) {
    const message = state.messages[index];
    if (message?.role === 'assistant' && String(message?.content || '').trim()) {
      return String(message.content || '').trim();
    }
    if (message?.role === 'user') {
      break;
    }
  }

  return '';
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

function getTimelineCopyPreviewMarkdownContent(overlay) {
  const directText = String(overlay?.__timelineCopyPreviewCopyText || '').trim();
  if (directText) {
    return directText;
  }

  const confirmBtn = overlay?.querySelector?.('.timeline-copy-preview-confirm');
  return String(confirmBtn?.dataset?.copyText || '').trim();
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
  const iframes = getSiteIframes();
  const agentCount = getAgentPanelFrames().length;
  const hasReadonlySnapshotPanels = isReadonlyHistoryMode && readonlyHistorySession;
  if (!iframes.length && agentCount === 0 && !hasReadonlySnapshotPanels) {
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

async function retryCurrentUploadBatch() {
  if (!currentUploadRetryContext?.file) {
    showToast(t('fileUploadFailedTitle', 'File upload failed'));
    return;
  }

  const file = currentUploadRetryContext.file;
  currentUploadBatch = {
    index: 1,
    total: 1,
    name: file.name
  };
  await processUploadedFile(file);
}

function buildAgentPanelState(agent) {
  return {
    agentId: agent.id,
    panelId: `agent:${agent.id}`,
    name: agent.name,
    color: agent.color || '#111111',
    messages: [],
    localDraft: '',
    pendingAttachments: [],
    isLoading: false,
    error: '',
    participatesInGlobal: true
  };
}

function normalizeAgentAttachments(attachments = []) {
  if (!Array.isArray(attachments)) {
    return [];
  }

  return attachments.map((attachment) => {
    if (!attachment || typeof attachment !== 'object') {
      return null;
    }

    const name = String(attachment.name || attachment.fileName || '').trim();
    if (!name) {
      return null;
    }

    return {
      id: String(attachment.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
      name,
      type: String(attachment.type || '').trim(),
      size: Math.max(0, Number(attachment.size) || 0),
      dataUrl: typeof attachment.dataUrl === 'string' ? attachment.dataUrl : '',
      textContent: typeof attachment.textContent === 'string' ? attachment.textContent : '',
      textPreview: typeof attachment.textPreview === 'string' ? attachment.textPreview : '',
      fileId: typeof attachment.fileId === 'string' ? attachment.fileId.trim() : '',
      uploadMode: typeof attachment.uploadMode === 'string' ? attachment.uploadMode.trim() : '',
      mediaCategory: String(attachment.mediaCategory || '').trim(),
      extractedAsText: attachment.extractedAsText === true
    };
  }).filter(Boolean);
}

async function getAgentCustomSettingsMapForIframe() {
  const { [AGENT_CUSTOM_SETTINGS_STORAGE_KEY]: storedSettings } = await chrome.storage.sync.get(AGENT_CUSTOM_SETTINGS_STORAGE_KEY);
  if (typeof AgentCatalog.normalizeAgentCustomSettingsMap === 'function') {
    return AgentCatalog.normalizeAgentCustomSettingsMap(storedSettings);
  }
  return storedSettings && typeof storedSettings === 'object' ? storedSettings : {};
}

async function getCustomAgentsForIframe() {
  const [{ [CUSTOM_AGENTS_STORAGE_KEY]: localCustomAgents }, { [CUSTOM_AGENTS_STORAGE_KEY]: syncCustomAgents }] = await Promise.all([
    chrome.storage.local.get(CUSTOM_AGENTS_STORAGE_KEY),
    chrome.storage.sync.get(CUSTOM_AGENTS_STORAGE_KEY)
  ]);

  if (typeof AgentCatalog.migrateLegacyCustomAgentsStorage === 'function') {
    return AgentCatalog.migrateLegacyCustomAgentsStorage(syncCustomAgents, localCustomAgents);
  }

  if (Array.isArray(localCustomAgents) && localCustomAgents.length > 0) {
    return localCustomAgents;
  }

  return Array.isArray(syncCustomAgents) ? syncCustomAgents : [];
}

async function getHiddenAgentIdSetForIframe() {
  const { [AGENT_HIDDEN_IDS_STORAGE_KEY]: hiddenAgentIds } = await chrome.storage.local.get(AGENT_HIDDEN_IDS_STORAGE_KEY);
  const normalizedHiddenIds = typeof AgentCatalog.normalizeAgentHiddenIds === 'function'
    ? AgentCatalog.normalizeAgentHiddenIds(hiddenAgentIds)
    : (Array.isArray(hiddenAgentIds) ? hiddenAgentIds.filter(Boolean) : []);
  return new Set(
    normalizedHiddenIds
      .map((id) => String(id || '').trim())
      .filter(Boolean)
  );
}

function filterHiddenAgentsForIframe(agents, hiddenAgentIdSet = new Set()) {
  const visibleSet = hiddenAgentIdSet instanceof Set ? hiddenAgentIdSet : new Set();
  return Array.isArray(agents)
    ? agents.filter((agent) => agent && !visibleSet.has(String(agent.id || '').trim()))
    : [];
}

async function getMergedAgentByIdForIframe(agentId) {
  const normalizedAgentId = String(agentId || '').trim();
  if (!normalizedAgentId) {
    return null;
  }

  const catalog = await getAvailableAgentCatalog().catch(() => ({ agents: [] }));
  const matchedAgent = Array.isArray(catalog?.agents)
    ? catalog.agents.find((agent) => agent.id === normalizedAgentId)
    : null;

  return matchedAgent ? { ...matchedAgent } : null;
}

function getAgentState(agentId) {
  return activeAgentPanelStore.get(String(agentId || '').trim()) || null;
}

function setAgentState(agentId, nextState) {
  activeAgentPanelStore.set(String(agentId || '').trim(), nextState);
  return nextState;
}

function updateAgentDraftState(agentId, draft = '') {
  const existingState = getAgentState(agentId);
  if (!existingState) return null;

  const nextState = {
    ...existingState,
    localDraft: String(draft || '')
  };
  setAgentState(agentId, nextState);

  const iframe = getAgentPanelFrames().find((item) => item.dataset.agentId === agentId);
  if (iframe) {
    syncAgentPanelStateToFrame(iframe, nextState);
  }

  persistCurrentHybridHistorySession().catch((error) => {
    console.warn('保存智能体草稿历史失败:', error);
  });
  return nextState;
}

function updateAgentPendingAttachments(agentId, attachments = []) {
  const existingState = getAgentState(agentId);
  if (!existingState) return null;

  const normalizedAttachments = normalizeAgentAttachments(attachments);
  const nextAttachmentIdSet = new Set(
    normalizedAttachments
      .map((attachment) => String(attachment?.id || '').trim())
      .filter(Boolean)
  );
  normalizeAgentAttachments(existingState.pendingAttachments).forEach((attachment) => {
    const attachmentId = String(attachment?.id || '').trim();
    if (attachmentId && !nextAttachmentIdSet.has(attachmentId)) {
      forgetAgentAttachmentSource(agentId, attachmentId);
    }
  });

  const nextState = {
    ...existingState,
    pendingAttachments: normalizedAttachments
  };
  setAgentState(agentId, nextState);

  const iframe = getAgentPanelFrames().find((item) => item.dataset.agentId === agentId);
  if (iframe) {
    syncAgentPanelStateToFrame(iframe, nextState);
  }

  persistCurrentHybridHistorySession().catch((error) => {
    console.warn('保存智能体附件历史失败:', error);
  });
  return nextState;
}

async function getAgentEngineConfigForIframe() {
  const [syncData, localData] = await Promise.all([
    chrome.storage.sync.get([AGENT_ENGINE_STORAGE_KEY, AGENT_ENGINE_SETTINGS_STORAGE_KEY]),
    chrome.storage.local.get(AGENT_ENGINE_SECRET_STORAGE_KEY)
  ]);
  const resolvedSettings = typeof AgentPromptUtils.resolveAgentEngineSettings === 'function'
    ? AgentPromptUtils.resolveAgentEngineSettings(
        syncData?.[AGENT_ENGINE_SETTINGS_STORAGE_KEY] || syncData?.[AGENT_ENGINE_STORAGE_KEY] || {},
        localData?.[AGENT_ENGINE_SECRET_STORAGE_KEY] || {}
      )
    : null;

  if (resolvedSettings?.effectiveConfig) {
    return {
      ...resolvedSettings.effectiveConfig,
      selectedSource: resolvedSettings.selectedSource || 'official'
    };
  }

  const rawConfig = {
    ...(syncData?.[AGENT_ENGINE_STORAGE_KEY] || {}),
    apiKey: localData?.[AGENT_ENGINE_SECRET_STORAGE_KEY]?.apiKey || ''
  };

  if (typeof AgentPromptUtils.normalizeApiConfig === 'function') {
    return AgentPromptUtils.normalizeApiConfig(rawConfig);
  }

  const bundledDefaults = typeof AgentEngineConfig.getDefaults === 'function'
    ? AgentEngineConfig.getDefaults()
    : {};

  return {
    apiKey: String(rawConfig.apiKey || bundledDefaults.apiKey || '').trim(),
    baseUrl: String(rawConfig.baseUrl || bundledDefaults.baseUrl || '').replace(/\/+$/, ''),
    model: String(rawConfig.model || bundledDefaults.model || '').trim(),
    concurrency: Math.max(1, Number(rawConfig.concurrency) || Number(bundledDefaults.concurrency) || 10),
    systemPrompt: String(rawConfig.systemPrompt || bundledDefaults.systemPrompt || '').trim(),
    selectedSource: 'official'
  };
}

function getAgentAbortController(agentId) {
  const state = getAgentState(agentId);
  return state?.abortController || null;
}

function cancelInFlightAgentRequest(agentId) {
  closeAgentRuntimeKeepalivePort(agentId);
  const controller = getAgentAbortController(agentId);
  const state = getAgentState(agentId);
  if (controller) {
    try {
      controller.abort();
    } catch (_) {}
  }
  chrome.runtime.sendMessage({
    action: 'cancelAgentChat',
    panelId: state?.panelId || `agent:${String(agentId || '').trim()}`
  }).catch(() => {});
}

async function parseAgentCompletionError(response) {
  const fallback = `HTTP ${response.status}: ${response.statusText || 'Request failed'}`;

  try {
    const rawText = await response.text();
    if (!rawText) {
      return fallback;
    }

    try {
      const parsed = JSON.parse(rawText);
      const message = String(
        parsed?.error?.message ||
        parsed?.message ||
        parsed?.detail ||
        ''
      ).trim();
      if (message) {
        return `HTTP ${response.status}: ${message}`;
      }
    } catch (_) {
      // ignore json parse errors and fall back to raw text
    }

    return `HTTP ${response.status}: ${rawText.trim()}`;
  } catch (_) {
    return fallback;
  }
}

function postMessageToAgentPanel(iframe, payload) {
  try {
    iframe.contentWindow?.postMessage(payload, '*');
  } catch (error) {
    console.warn('发送消息到智能体面板失败:', error);
  }
}

function syncAgentPanelStateToFrame(iframe, state) {
  if (!iframe || !state) return;
  postMessageToAgentPanel(iframe, {
    type: 'AGENT_PANEL_STATE',
    state
  });
}

function waitForNextFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function createAgentIframe(agent, container) {
  const panelState = setAgentState(agent.id, buildAgentPanelState(agent));
  const iframeContainer = document.createElement('div');
  iframeContainer.className = 'iframe-container';
  iframeContainer.dataset.siteName = agent.name;
  iframeContainer.dataset.panelKind = PANEL_KIND.AGENT;
  iframeContainer.dataset.agentId = agent.id;
  iframeContainer.dataset.lastQuery = getLiveSummaryCurrentQuery();

  const iframe = document.createElement('iframe');
  iframe.className = 'ai-iframe';
  iframe.dataset.site = agent.name;
  iframe.dataset.siteName = agent.name;
  iframe.dataset.agentId = agent.id;
  iframe.dataset.panelId = panelState.panelId;
  iframe.dataset.panelKind = PANEL_KIND.AGENT;
  iframe.allow = IFRAME_ALLOW_PERMISSIONS;
  iframe.src = buildAgentPanelUrl(agent.id);

  const header = document.createElement('div');
  header.className = 'iframe-header';
  header.innerHTML = `
    <span class="site-name">${escapeHtml(agent.name)}</span>
    <span class="iframe-header-status" aria-live="polite">${escapeHtml(t('iframeStatusPageLoading', '页面加载中...'))}</span>
    <div class="iframe-controls">
      <button class="refresh-page-btn"></button>
      <button class="open-page-btn"></button>
      <button class="close-btn"></button>
    </div>
  `;

  iframe.addEventListener('load', () => {
    setIframeHeaderStatus(iframeContainer, t('iframeStatusPageLoaded', '页面已加载'));
    syncAgentPanelStateToFrame(iframe, getAgentState(agent.id));
  });

  const refreshPageBtn = header.querySelector('.refresh-page-btn');
  const openPageBtn = header.querySelector('.open-page-btn');
  const closeBtn = header.querySelector('.close-btn');

  refreshPageBtn.title = t('refresh', '刷新');
  openPageBtn.title = t('openInNewTab', '在新标签页打开');
  closeBtn.title = t('closeButton', '关闭');

  refreshPageBtn.onclick = (event) => {
    event.stopPropagation();
    cancelInFlightAgentRequest(agent.id);
    forgetAllAgentAttachmentSources(agent.id);
    iframe.src = buildAgentPanelUrl(agent.id);
    setAgentState(agent.id, buildAgentPanelState(agent));
    rebuildTimelineEntriesFromSnapshots();
    scheduleLiveSummaryRefresh(200);
  };

  openPageBtn.onclick = (event) => {
    event.stopPropagation();
    chrome.tabs.create({ url: buildAgentPanelUrl(agent.id) });
  };

  closeBtn.onclick = () => {
    cancelInFlightAgentRequest(agent.id);
    forgetAllAgentAttachmentSources(agent.id);
    iframeContainer.remove();
    activeAgentPanelStore.delete(String(agent.id || '').trim());
    rebuildTimelineEntriesFromSnapshots();
    syncNavCheckboxStates();
    scheduleLiveSummaryRefresh(150);
    persistCurrentHybridHistorySession().catch((error) => {
      console.warn('关闭智能体面板后保存历史失败:', error);
    });
  };

  iframeContainer.appendChild(header);
  iframeContainer.appendChild(iframe);
  container.appendChild(iframeContainer);
  return iframe;
}

function createSnapshotPanel(title, content, container, panelKind, panelId) {
  const panelContainer = document.createElement('div');
  panelContainer.className = 'iframe-container';
  panelContainer.dataset.siteName = title;
  panelContainer.dataset.panelKind = panelKind;
  panelContainer.dataset.panelId = panelId;

  const header = document.createElement('div');
  header.className = 'iframe-header';
  header.innerHTML = `
    <span class="site-name">${escapeHtml(title)}</span>
    <span class="iframe-header-status" aria-live="polite">${escapeHtml(t('historyLink', 'History'))}</span>
    <div class="iframe-controls">
      <button class="open-page-btn"></button>
      <button class="close-btn"></button>
    </div>
  `;

  const body = document.createElement('div');
  body.className = 'snapshot-panel';
  const pre = document.createElement('pre');
  pre.textContent = String(content || '').trim() || '-';
  body.appendChild(pre);

  const openPageBtn = header.querySelector('.open-page-btn');
  const closeBtn = header.querySelector('.close-btn');
  openPageBtn.title = t('openInNewTab', 'Open in New Tab');
  closeBtn.title = t('closeButton', 'Close');
  openPageBtn.style.display = 'none';
  closeBtn.onclick = () => {
    panelContainer.remove();
  };

  panelContainer.appendChild(header);
  panelContainer.appendChild(body);
  container.appendChild(panelContainer);
}

function restoreHybridSessionTimeline(hybridSession) {
  const timelineEntries = Array.isArray(hybridSession?.timelineEntries) ? hybridSession.timelineEntries : [];
  if (timelineEntries.length > 0) {
    timelineEntries.forEach((timelineEntry, index) => {
      upsertTimelineEntry({
        query: timelineEntry?.query || '',
        timelineId: String(timelineEntry?.timelineId || `${hybridSession.id}-${index}`),
        historyId: timelineEntry?.historyId || hybridSession.id,
        timestamp: Number(timelineEntry?.timestamp) || hybridSession.updatedAt || hybridSession.createdAt || Date.now(),
        dateLabel: timelineEntry?.dateLabel || formatTimelineDateLabel(Number(timelineEntry?.timestamp) || hybridSession.updatedAt || hybridSession.createdAt || Date.now())
      }, {
        dedupeByHistoryId: false
      });
    });
    return;
  }

  const panelEntries = getPanelEntriesInOrder(hybridSession);
  const agentSnapshots = panelEntries.map((panel) => {
    const panelType = String(panel?.panelType || '').trim();
    if (panelType !== PANEL_KIND.AGENT && panelType !== PANEL_KIND.AGENT_SNAPSHOT && panelType !== 'agent') {
      return null;
    }

    const siteName = String(panel?.title || panel?.agentName || panel?.agentId || '').trim();
    const prompts = timelineExtractPromptsFromMessages(panel?.messages || []);
    if (!siteName || !prompts.length) {
      return null;
    }

    return {
      siteName,
      prompts
    };
  }).filter(Boolean);

  if (agentSnapshots.length > 0) {
    const mergedEntries = timelineMergeSnapshots(agentSnapshots);
    mergedEntries.forEach((timelineEntry, index) => {
      upsertTimelineEntry({
        query: timelineEntry?.query || '',
        timelineId: String(timelineEntry?.timelineId || `${hybridSession.id}-agent-${index}`),
        historyId: null,
        timestamp: Number(hybridSession.updatedAt || hybridSession.createdAt) || Date.now(),
        dateLabel: formatTimelineDateLabel(Number(hybridSession.updatedAt || hybridSession.createdAt) || Date.now())
      }, {
        dedupeByHistoryId: false
      });
    });
    return;
  }

  if (String(hybridSession?.query || '').trim()) {
    upsertTimelineEntry({
      query: hybridSession.query,
      historyId: hybridSession.id,
      timestamp: Number(hybridSession.updatedAt || hybridSession.createdAt) || Date.now(),
      dateLabel: formatTimelineDateLabel(Number(hybridSession.updatedAt || hybridSession.createdAt) || Date.now())
    }, {
      dedupeByHistoryId: true
    });
  }
}

async function restoreHybridSessionAsLivePanels(hybridSession, container) {
  const siteConfigs = await getDefaultSites().catch((error) => {
    console.warn('恢复 hybrid live 站点时加载配置失败:', error);
    return [];
  });
  const customSites = typeof window.getCustomSites === 'function'
    ? await window.getCustomSites().catch((error) => {
        console.warn('恢复 hybrid live 自定义站点时加载配置失败:', error);
        return [];
      })
    : [];
  const catalog = await getAvailableAgentCatalog().catch((error) => {
    console.warn('恢复 hybrid live 智能体时加载目录失败:', error);
    return { agents: [] };
  });
  const panelEntries = getPanelEntriesInOrder(hybridSession);
  const panelsById = hybridSession?.panels && typeof hybridSession.panels === 'object'
    ? hybridSession.panels
    : {};

  const resolvedPanelEntries = panelEntries.length > 0
    ? panelEntries
    : [
        ...(Array.isArray(hybridSession?.openSiteNames)
          ? hybridSession.openSiteNames.map((siteName) => ({
              panelId: `site:${siteName}`,
              panelType: PANEL_KIND.SITE,
              siteName,
              title: siteName
            }))
          : []),
        ...(Array.isArray(hybridSession?.openAgentIds)
          ? hybridSession.openAgentIds.map((agentId) => ({
              panelId: `agent:${agentId}`,
              panelType: PANEL_KIND.AGENT,
              agentId,
              title: agentId
            }))
          : [])
      ];

  for (const panel of resolvedPanelEntries) {
    const panelType = String(panel?.panelType || '').trim();
    if (panelType === PANEL_KIND.AGENT || panelType === 'agent' || panelType === PANEL_KIND.AGENT_SNAPSHOT) {
      const agentId = String(panel?.agentId || '').trim();
      if (!agentId) continue;
      const agent = (catalog?.agents || []).find((item) => item.id === agentId);
      if (!agent) continue;
      createAgentIframe(agent, container);
      const restoredMessages = Array.isArray(panel?.messages) ? panel.messages : [];
      const nextState = {
        ...buildAgentPanelState(agent),
        messages: restoredMessages,
        localDraft: String(panel?.localDraft || '').trim(),
        pendingAttachments: normalizeAgentAttachments(panel?.pendingAttachments),
        isLoading: false,
        error: ''
      };
      setAgentState(agentId, nextState);
      const iframe = getAgentPanelFrames().find((item) => item.dataset.agentId === agentId);
      if (iframe) {
        syncAgentPanelStateToFrame(iframe, nextState);
      }
      continue;
    }

    const siteName = String(panel?.siteName || panel?.title || '').trim();
    if (!siteName) continue;
    const siteConfig = siteConfigs.find((item) => item.name === siteName) || null;
    const customSite = customSites.find((item) => item.name === siteName) || null;
    const savedPanel = panelsById[String(panel?.panelId || '').trim()] || panel;
    const savedUrl = String(savedPanel?.url || '').trim();
    const site = siteConfig || customSite || { name: siteName, url: savedUrl };
    const isCustomSite = Boolean(customSite && !siteConfig);
    const launchTarget = isCustomSite
      ? (SiteLaunchUtils.resolveCustomLaunchTarget
        ? SiteLaunchUtils.resolveCustomLaunchTarget(site, '')
        : { url: site.url || savedUrl, queryInUrl: false, shouldAutoRun: false })
      : (SiteLaunchUtils.resolveOfficialLaunchTarget
        ? SiteLaunchUtils.resolveOfficialLaunchTarget(site, '')
        : { url: site.url || savedUrl, queryInUrl: false, shouldAutoRun: false });
    const fallbackUrl = isCustomSite
      ? (site.url || savedUrl)
      : (buildSiteUrlForQuery(site, '') || site.url || savedUrl);
    const liveUrl = savedUrl && !SiteLaunchUtils.isLikelyPlaceholderHistoryUrl?.(savedUrl, siteName)
      ? savedUrl
      : (launchTarget?.url || fallbackUrl);

    createSingleIframe(siteName, liveUrl, container, '', null, {
      site,
      siteKind: isCustomSite ? 'custom' : 'official',
      isCustomSite,
      launchTarget: {
        ...(launchTarget || {}),
        url: liveUrl,
        queryInUrl: false,
        shouldAutoRun: false
      }
    });
  }
}

function appendAgentMessage(agentId, message) {
  const existingState = getAgentState(agentId);
  if (!existingState) return null;

  const normalizedMessage = {
    ...message,
    attachments: normalizeAgentAttachments(message?.attachments)
  };

  const nextState = {
    ...existingState,
    messages: [...existingState.messages, normalizedMessage]
  };
  setAgentState(agentId, nextState);

  const iframe = getAgentPanelFrames().find((item) => item.dataset.agentId === agentId);
  if (iframe) {
    syncAgentPanelStateToFrame(iframe, nextState);
  }
  rebuildTimelineEntriesFromSnapshots();
  persistCurrentHybridHistorySession().catch((error) => {
    console.warn('保存智能体消息历史失败:', error);
  });
  return nextState;
}

function updateAgentLoadingState(agentId, isLoading, error = '') {
  const existingState = getAgentState(agentId);
  if (!existingState) return null;

  const nextState = {
    ...existingState,
    isLoading,
    error: error || '',
    abortController: isLoading ? existingState.abortController || null : null
  };
  setAgentState(agentId, nextState);

  const iframe = getAgentPanelFrames().find((item) => item.dataset.agentId === agentId);
  if (iframe) {
    syncAgentPanelStateToFrame(iframe, nextState);
  }
  persistCurrentHybridHistorySession().catch((saveError) => {
    console.warn('保存智能体状态历史失败:', saveError);
  });
  return nextState;
}

async function prepareAgentAttachmentsForDispatch(agentId, attachments = []) {
  const normalizedAgentId = String(agentId || '').trim();
  const normalizedAttachments = normalizeAgentAttachments(attachments);
  if (!normalizedAgentId || normalizedAttachments.length === 0) {
    return [];
  }

  const preparedAttachments = [];
  for (const attachment of normalizedAttachments) {
    const mediaCategory = String(
      attachment.mediaCategory
      || (typeof AgentPromptUtils.getAttachmentMediaCategory === 'function'
        ? AgentPromptUtils.getAttachmentMediaCategory(attachment.name, attachment.type)
        : '')
    ).trim();

    if (mediaCategory !== 'image') {
      throw new Error(
        t(
          'agentAttachmentImagesOnly',
          'The current skill model only supports sending original image attachments directly. Please keep non-image files on site panels.'
        )
      );
    }

    if (attachment.dataUrl) {
      preparedAttachments.push({
        ...attachment,
        mediaCategory: 'image'
      });
      continue;
    }

    const source = getAgentAttachmentSource(normalizedAgentId, attachment.id);
    if (!source) {
      throw new Error(
        t(
          'agentAttachmentSourceMissing',
          'The original attachment is no longer available. Please attach the file again.'
        )
      );
    }

    if (typeof AgentPromptUtils.readSourceAsDataUrl !== 'function') {
      throw new Error(t('agentRequestFailed', 'Skill request failed'));
    }

    preparedAttachments.push({
      ...attachment,
      mediaCategory: 'image',
      dataUrl: await AgentPromptUtils.readSourceAsDataUrl(source, attachment.type || 'image/*')
    });
  }

  return preparedAttachments;
}

function getAgentRuntimeKeepalivePort(agentId) {
  return agentRuntimeKeepalivePorts.get(String(agentId || '').trim()) || null;
}

function closeAgentRuntimeKeepalivePort(agentId) {
  const normalizedAgentId = String(agentId || '').trim();
  if (!normalizedAgentId) return;

  const port = getAgentRuntimeKeepalivePort(normalizedAgentId);
  if (!port) return;

  agentRuntimeKeepalivePorts.delete(normalizedAgentId);
  try {
    port.disconnect();
  } catch (_) {}
}

function bindAgentRuntimeKeepalivePort(agentId, jobId) {
  const normalizedAgentId = String(agentId || '').trim();
  const normalizedJobId = String(jobId || '').trim();
  if (!normalizedAgentId || !normalizedJobId) {
    return;
  }

  closeAgentRuntimeKeepalivePort(normalizedAgentId);

  let port = null;
  try {
    port = chrome.runtime.connect({ name: 'agent-runtime-keepalive' });
  } catch (error) {
    console.warn('创建技能运行保活通道失败:', error);
    return;
  }

  agentRuntimeKeepalivePorts.set(normalizedAgentId, port);

  port.onDisconnect.addListener(() => {
    if (agentRuntimeKeepalivePorts.get(normalizedAgentId) === port) {
      agentRuntimeKeepalivePorts.delete(normalizedAgentId);
    }
  });

  try {
    port.postMessage({
      type: 'bindAgentRuntimeJob',
      agentId: normalizedAgentId,
      jobId: normalizedJobId
    });
  } catch (error) {
    console.warn('绑定技能运行保活任务失败:', error);
    closeAgentRuntimeKeepalivePort(normalizedAgentId);
  }
}

function initializeAgentRuntimeMessageBridge() {
  if (agentRuntimeMessageBridgeInitialized) {
    return;
  }
  agentRuntimeMessageBridgeInitialized = true;

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== 'agentRuntimeEvent' || !message.agentId) {
      return;
    }

    const agentId = String(message.agentId || '').trim();
    const currentState = getAgentState(agentId);
    if (!currentState) {
      return;
    }

    if (message.event === 'started' || message.event === 'queued') {
      if (message.jobId) {
        bindAgentRuntimeKeepalivePort(agentId, message.jobId);
      }
      updateAgentLoadingState(agentId, true);
      scheduleLiveSummaryRefresh(250);
      return;
    }

    if (message.event === 'delta') {
      const latestState = getAgentState(agentId);
      if (!latestState) return;
      const messages = [...latestState.messages];
      const lastAssistant = messages[messages.length - 1];
      if (lastAssistant && lastAssistant.role === 'assistant') {
        lastAssistant.content = `${lastAssistant.content || ''}${message.delta || ''}`;
      } else {
        messages.push({
          role: 'assistant',
          content: message.delta || ''
        });
      }
      const nextState = {
        ...latestState,
        messages
      };
      setAgentState(agentId, nextState);
      const iframe = getAgentPanelFrames().find((item) => item.dataset.agentId === agentId);
      if (iframe) {
        syncAgentPanelStateToFrame(iframe, nextState);
      }
      scheduleLiveSummaryRefresh(250);
      return;
    }

    if (message.event === 'completed') {
      closeAgentRuntimeKeepalivePort(agentId);
      updateAgentLoadingState(agentId, false);
      scheduleLiveSummaryRefresh(250);
      return;
    }

    if (message.event === 'error') {
      closeAgentRuntimeKeepalivePort(agentId);
      updateAgentLoadingState(agentId, false, message.error || '');
      appendAgentMessage(agentId, {
        role: 'assistant',
        content: message.error || t('agentRequestFailed', 'Skill request failed'),
        isError: true
      });
      scheduleLiveSummaryRefresh(250);
      return;
    }

    if (message.event === 'cancelled') {
      closeAgentRuntimeKeepalivePort(agentId);
      updateAgentLoadingState(agentId, false);
      scheduleLiveSummaryRefresh(250);
    }
  });
}

async function runAgentPrompt(agentId, content, source = 'global', attachments = []) {
  initializeAgentRuntimeMessageBridge();
  const existingState = getAgentState(agentId);
  if (!existingState) return false;
  const normalizedContent = String(content || '').trim();
  const explicitAttachments = normalizeAgentAttachments(attachments);
  const pendingAttachmentsBeforeSubmit = normalizeAgentAttachments(existingState.pendingAttachments);
  const normalizedAttachments = explicitAttachments.length > 0
    ? explicitAttachments
    : pendingAttachmentsBeforeSubmit;
  if (!normalizedContent && normalizedAttachments.length === 0) {
    return false;
  }

  let preparedAttachments = [];
  try {
    preparedAttachments = await prepareAgentAttachmentsForDispatch(agentId, normalizedAttachments);
  } catch (error) {
    const attachmentError = error?.message || t('agentRequestFailed', 'Skill request failed');
    updateAgentLoadingState(agentId, false, attachmentError);
    appendAgentMessage(agentId, {
      role: 'assistant',
      content: attachmentError,
      isError: true
    });
    return false;
  }

  cancelInFlightAgentRequest(agentId);
  if (pendingAttachmentsBeforeSubmit.length > 0) {
    updateAgentPendingAttachments(agentId, []);
  }
  if (existingState.localDraft) {
    updateAgentDraftState(agentId, '');
  }

  appendAgentMessage(agentId, {
    role: 'user',
    content: normalizedContent,
    source,
    attachments: preparedAttachments
  });
  updateAgentLoadingState(agentId, true);

  const stateAfterUserMessage = getAgentState(agentId);
  const messages = (stateAfterUserMessage?.messages || []).map((message) => ({
    role: message.role,
    content: message.content,
    source: message.source,
    attachments: normalizeAgentAttachments(message.attachments)
  }));

  const agent = await getMergedAgentByIdForIframe(agentId);

  if (!agent) {
    const unknownAgentError = chrome?.i18n?.getMessage?.('agentUnknownError', [agentId]) || `Unknown skill: ${agentId}`;
    updateAgentLoadingState(agentId, false, unknownAgentError);
    appendAgentMessage(agentId, {
      role: 'assistant',
      content: unknownAgentError,
      isError: true
    });
    return false;
  }

  const backgroundConfigResponse = await chrome.runtime.sendMessage({
    action: 'getAgentEngineConfig'
  }).catch(() => null);
  const runtimeConfig = backgroundConfigResponse?.success ? backgroundConfigResponse.result : null;

  if (!runtimeConfig?.hasApiKey || !runtimeConfig?.baseUrl || !runtimeConfig?.model) {
    const agentConfigError = chrome?.i18n?.getMessage?.('agentEngineNotConfigured') || 'Skill engine is not configured';
    updateAgentLoadingState(agentId, false, agentConfigError);
    appendAgentMessage(agentId, {
      role: 'assistant',
      content: agentConfigError,
      isError: true
    });
    return false;
  }

  const existingAssistantState = getAgentState(agentId);
  const nextState = {
    ...existingAssistantState,
    abortController: null,
    messages: [
      ...existingAssistantState.messages,
      {
        role: 'assistant',
        content: ''
      }
    ]
  };
  setAgentState(agentId, nextState);
  const iframe = getAgentPanelFrames().find((item) => item.dataset.agentId === agentId);
  if (iframe) {
    syncAgentPanelStateToFrame(iframe, nextState);
  }

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'agentChat',
      payload: {
        panelId: existingState.panelId || `agent:${agentId}`,
        agentId,
        messages
      }
    });

    if (!response?.success) {
      throw new Error(response?.error || t('agentRequestFailed', 'Skill request failed'));
    }
    if (response?.result?.jobId) {
      bindAgentRuntimeKeepalivePort(agentId, response.result.jobId);
    }
    forgetAgentAttachmentSources(agentId, normalizedAttachments);
  } catch (error) {
    closeAgentRuntimeKeepalivePort(agentId);
    updateAgentLoadingState(agentId, false, error?.message || t('agentRequestFailed', 'Skill request failed'));
    appendAgentMessage(agentId, {
      role: 'assistant',
      content: error?.message || t('agentRequestFailed', 'Skill request failed'),
      isError: true
    });
    return false;
  }
  return true;
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
  return getSiteIframes()
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
    if (window.RuntimeI18n?.initializeRuntimeI18n) {
        await window.RuntimeI18n.initializeRuntimeI18n();
    }

    initializeAgentRuntimeMessageBridge();
    await ensureIframeAgentCatalogReady();
    if (typeof window.RemoteAgentConfigManager?.autoCheckUpdate === 'function') {
        window.RemoteAgentConfigManager.autoCheckUpdate().catch((error) => {
            console.warn('技能目录后台更新检查失败:', error);
        });
    }

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
    liveSummaryContext.analysisQuery = String(analysisQuery || '').trim();
    const hasQueryParam = urlParams.has('query') || Boolean(analysisContext);
    const hasSitesParam = urlParams.has('sites');
    const hasCustomSitesParam = urlParams.has('customSites');
    const hasAgentsParam = urlParams.has('agents');

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

    let selectedAgentIds = null;
    if (hasAgentsParam) {
      const agentsParam = urlParams.get('agents');
      if (agentsParam) {
        selectedAgentIds = agentsParam.split(',').map(id => id.trim()).filter(Boolean);
      }
    }
    const agentCatalog = await getAvailableAgentCatalog();
    const selectedAgents = selectedAgentIds && selectedAgentIds.length > 0
      ? (agentCatalog?.agents || []).filter(agent => selectedAgentIds.includes(agent.id))
      : [];
    const shouldOpenDefaultSites = shouldFallbackToDefaultSites({
      hasSitesParam,
      hasCustomSitesParam,
      hasAgentsParam,
      selectedSiteNames,
      selectedCustomSites,
      selectedAgents
    });

    let restoredHistoryIframesOnInit = false;
    const shouldRestoreHybridHistoryOnInit = Boolean(urlHistoryId && isHybridHistoryRecord(historyItem));
    const historySites = Array.isArray(historyItem?.sites) ? historyItem.sites : [];
    const filteredHistorySites = selectedSiteNames && selectedSiteNames.length > 0
      ? historySites.filter((site) => selectedSiteNames.includes(site?.name))
      : historySites;
    const initialHistorySites = filteredHistorySites.length > 0 ? filteredHistorySites : historySites;
    const shouldDeferQueryDrivenInit = !shouldRestoreHybridHistoryOnInit
      && initialHistorySites.length > 0
      && Boolean(historyRestoreContext?.autoSearch);

    if (urlHistoryId && (shouldRestoreHybridHistoryOnInit || initialHistorySites.length > 0)) {
        console.log('检测到 historyId，首屏直接恢复历史 iframe:', {
            historyId: urlHistoryId,
            hybrid: shouldRestoreHybridHistoryOnInit,
            sites: initialHistorySites.map((site) => site?.name).filter(Boolean)
        });
        await loadHistoryIframes(shouldRestoreHybridHistoryOnInit ? [] : initialHistorySites, historyRestoreContext);
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
                        const availableSites = shouldOpenDefaultSites
                          ? getInitialIframeSites(sites, selectedSiteNames)
                          : (Array.isArray(selectedSiteNames) && selectedSiteNames.length > 0
                              ? getInitialIframeSites(sites, selectedSiteNames)
                              : []);

                        if (selectedSiteNames && selectedSiteNames.length > 0) {
                            console.log('根据选中的站点列表过滤:', selectedSiteNames, availableSites);
                        } else if (!shouldOpenDefaultSites) {
                            console.log('URL 中已显式指定面板且没有站点，跳过默认站点回退');
                        } else {
                            console.log('如果没有指定站点列表，默认只打开已启用的站点:', availableSites);
                        }

                        if (availableSites.length > 0) {
                            console.log('使用查询内容创建 iframes:', query, availableSites);
                            createIframes(query, availableSites, selectedCustomSites, selectedAgents);
                        } else {
                            createIframes(query, [], selectedCustomSites, selectedAgents);
                        }
                    } else {
                        createIframes(query, [], selectedCustomSites, selectedAgents);
                    }
                });
            }
        } else {
            // 如果查询参数是 'true' 或空，按直接打开处理
            console.log('URL 参数 query=true，按直接打开处理');
            getDefaultSites().then((sites) => {
                if (sites && sites.length > 0) {
                    const availableSites = shouldOpenDefaultSites
                      ? getInitialIframeSites(sites, selectedSiteNames)
                      : (Array.isArray(selectedSiteNames) && selectedSiteNames.length > 0
                          ? getInitialIframeSites(sites, selectedSiteNames)
                          : []);

                    if (selectedSiteNames && selectedSiteNames.length > 0) {
                        console.log('根据选中的站点列表过滤:', selectedSiteNames, availableSites);
                    } else if (!shouldOpenDefaultSites) {
                        console.log('URL 中已显式指定面板且没有站点，跳过默认站点回退');
                    } else {
                        console.log('如果没有指定站点列表，默认只打开已启用的站点:', availableSites);
                    }

                    if (availableSites.length > 0) {
                        console.log('初始化可用站点:', availableSites);
                        createIframes('', availableSites, selectedCustomSites, selectedAgents);
                    } else {
                        createIframes('', [], selectedCustomSites, selectedAgents);
                    }
                } else {
                    createIframes('', [], selectedCustomSites, selectedAgents);
                }
            });
        }
    } else if (!restoredHistoryIframesOnInit) {
        // 直接打开（方式1）
        getDefaultSites().then((sites) => {
            if (sites && sites.length > 0) {
                const availableSites = shouldOpenDefaultSites
                  ? getInitialIframeSites(sites, selectedSiteNames)
                  : (Array.isArray(selectedSiteNames) && selectedSiteNames.length > 0
                      ? getInitialIframeSites(sites, selectedSiteNames)
                      : []);

                if (selectedSiteNames && selectedSiteNames.length > 0) {
                    console.log('根据选中的站点列表过滤:', selectedSiteNames, availableSites);
                } else if (!shouldOpenDefaultSites) {
                    console.log('URL 中已显式指定面板且没有站点，跳过默认站点回退');
                } else {
                    console.log('如果没有指定站点列表，默认只打开已启用的站点:', availableSites);
                }

                if (availableSites.length > 0) {
                    console.log('初始化可用站点:', availableSites);
                    createIframes('', availableSites, selectedCustomSites, selectedAgents);
                } else {
                    createIframes('', [], selectedCustomSites, selectedAgents);
                }
            } else {
                createIframes('', [], selectedCustomSites, selectedAgents);
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
  const localFileDetected = t('localFileDetected', 'Local file detected');
  const browserSecurityRestriction = t('browserSecurityRestriction', 'Browser security restriction');
  const localFileSecurityMessage = t('localFileSecurityMessage', 'Local files cannot be read directly by webpages for security reasons.');
  const suggestedActions = t('suggestedActions', 'Suggested actions');
  const uploadFileAction = t('uploadFileAction', 'Upload this file through the attachment button instead');
  const dismissWarning = t('dismissWarning', 'Dismiss');
  
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
  const siteIframes = getSiteIframes();
  const agentCount = getOpenedAgentIds().length;
  console.log(`🎯 开始发送文件到面板: 站点 ${siteIframes.length} 个，skills ${agentCount} 个`);
  console.log('🎯 文件对象详情:', {
    name: fileObj.name,
    type: fileObj.type,
    size: fileObj.size
  });

  const fileData = {
    type: fileObj.type,
    blob: fileObj.blob || fileObj.data || fileObj.file || null,
    data: fileObj.data || fileObj.blob || null,
    file: fileObj.file || null,
    fileName: fileObj.name,
    originalName: fileObj.name,
    size: fileObj.size,
    lastModified: fileObj.lastModified || Date.now(),
    name: fileObj.name
  };

  const processed = await processFileToAllIframes(fileData);
  if (!processed) {
    throw new Error(t('fileUploadNoAvailablePanels', 'No available panels were found'));
  }

  console.log('🎯 所有面板文件发送完成');
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
let activeAgentPanelStore = new Map();
let agentAttachmentSourceStore = new Map();
let currentHybridHistorySessionId = null;
let isReadonlyHistoryMode = false;
let readonlyHistorySession = null;
const DEFAULT_IFRAME_SITE_TYPE = 'information';
const IFRAME_SITE_TYPE_ALIASES = {
  chat: 'information',
  agent: 'agents',
  translation: 'translate'
};
const PANEL_KIND = Object.freeze({
  SITE: 'site',
  AGENT: 'agent',
  SITE_SNAPSHOT: 'site_snapshot',
  AGENT_SNAPSHOT: 'agent_snapshot'
});

function normalizeSiteTypeToken(rawValue) {
  const normalized = String(rawValue || '').trim().toLowerCase();
  if (!normalized) return '';
  return IFRAME_SITE_TYPE_ALIASES[normalized] || normalized;
}

function getPanelKindFromElement(element) {
  return String(element?.dataset?.panelKind || PANEL_KIND.SITE).trim() || PANEL_KIND.SITE;
}

function getSiteIframes() {
  return Array.from(document.querySelectorAll('.ai-iframe'))
    .filter((iframe) => getPanelKindFromElement(iframe) === PANEL_KIND.SITE);
}

function getAllPanelFrames() {
  return Array.from(document.querySelectorAll('.ai-iframe'));
}

function getAgentPanelFrames() {
  return getAllPanelFrames().filter((iframe) => getPanelKindFromElement(iframe) === PANEL_KIND.AGENT);
}

function getOpenedPanelIds() {
  return getAllPanelFrames()
    .map((iframe) => String(iframe.dataset.panelId || '').trim())
    .filter(Boolean);
}

function getOpenedAgentIds() {
  return getAgentPanelFrames()
    .map((iframe) => String(iframe.dataset.agentId || '').trim())
    .filter(Boolean);
}

function getAgentAttachmentSourceStore(agentId) {
  const normalizedAgentId = String(agentId || '').trim();
  if (!normalizedAgentId) {
    return null;
  }
  let store = agentAttachmentSourceStore.get(normalizedAgentId);
  if (!(store instanceof Map)) {
    store = new Map();
    agentAttachmentSourceStore.set(normalizedAgentId, store);
  }
  return store;
}

function rememberAgentAttachmentSource(agentId, attachmentId, source) {
  const normalizedAttachmentId = String(attachmentId || '').trim();
  if (!normalizedAttachmentId || !source) {
    return false;
  }
  const store = getAgentAttachmentSourceStore(agentId);
  if (!store) {
    return false;
  }
  store.set(normalizedAttachmentId, source);
  return true;
}

function getAgentAttachmentSource(agentId, attachmentId) {
  const normalizedAgentId = String(agentId || '').trim();
  const normalizedAttachmentId = String(attachmentId || '').trim();
  if (!normalizedAgentId || !normalizedAttachmentId) {
    return null;
  }
  return agentAttachmentSourceStore.get(normalizedAgentId)?.get(normalizedAttachmentId) || null;
}

function forgetAgentAttachmentSource(agentId, attachmentId) {
  const normalizedAgentId = String(agentId || '').trim();
  const normalizedAttachmentId = String(attachmentId || '').trim();
  if (!normalizedAgentId || !normalizedAttachmentId) {
    return;
  }
  const store = agentAttachmentSourceStore.get(normalizedAgentId);
  if (!(store instanceof Map)) {
    return;
  }
  store.delete(normalizedAttachmentId);
  if (store.size === 0) {
    agentAttachmentSourceStore.delete(normalizedAgentId);
  }
}

function forgetAgentAttachmentSources(agentId, attachments = []) {
  normalizeAgentAttachments(attachments).forEach((attachment) => {
    forgetAgentAttachmentSource(agentId, attachment.id);
  });
}

function forgetAllAgentAttachmentSources(agentId) {
  const normalizedAgentId = String(agentId || '').trim();
  if (!normalizedAgentId) {
    return;
  }
  agentAttachmentSourceStore.delete(normalizedAgentId);
}

function stageAgentAttachmentSourcesFromPanel(payload = {}) {
  const agentId = String(payload.agentId || '').trim();
  const entries = Array.isArray(payload.entries) ? payload.entries : [];
  if (!agentId || entries.length === 0) {
    return 0;
  }

  let stagedCount = 0;
  entries.forEach((entry) => {
    const attachmentId = String(entry?.attachmentId || entry?.id || '').trim();
    const source = entry?.file || entry?.source || entry?.blob || entry?.data || entry?.fileData || null;
    if (!attachmentId || !source) {
      return;
    }
    if (rememberAgentAttachmentSource(agentId, attachmentId, source)) {
      stagedCount += 1;
    }
  });
  return stagedCount;
}

window.AICompareIframeAgentAttachmentBridge = {
  stageFilesFromPanel: stageAgentAttachmentSourcesFromPanel
};

async function buildAgentAttachmentPayloadFromFileSource(source) {
  if (!source) {
    return null;
  }

  if (typeof AgentPromptUtils.buildAttachmentPayloadFromSource === 'function') {
    return AgentPromptUtils.buildAttachmentPayloadFromSource(source, {
      name: source.fileName || source.originalName || source.name || '',
      type: source.type || '',
      size: source.size || 0,
      maxTextLength: 12000,
      previewLength: 800
    });
  }

  return normalizeAgentAttachments([{
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: source.fileName || source.originalName || source.name || 'attachment',
    type: source.type || '',
    size: Math.max(0, Number(source.size) || 0),
    mediaCategory: String(source.type || '').startsWith('image/') ? 'image' : 'binary'
  }])[0] || null;
}

async function stageFileForAllAgentPanels(fileSource) {
  const openedAgentIds = getOpenedAgentIds();
  if (openedAgentIds.length === 0) {
    return {
      total: 0,
      successCount: 0,
      failureCount: 0
    };
  }

  let successCount = 0;
  let failureCount = 0;
  for (const agentId of openedAgentIds) {
    const existingState = getAgentState(agentId);
    if (!existingState) {
      failureCount += 1;
      continue;
    }

    try {
      const builtAttachment = await buildAgentAttachmentPayloadFromFileSource(fileSource);
      const attachment = {
        ...(builtAttachment || {})
      };
      if (!attachment.name) {
        throw new Error('Failed to build skill attachment payload');
      }
      rememberAgentAttachmentSource(agentId, attachment.id, fileSource.file || fileSource.blob || fileSource.data || fileSource);
      updateAgentPendingAttachments(agentId, [
        ...(Array.isArray(existingState.pendingAttachments) ? existingState.pendingAttachments : []),
        attachment
      ]);
      successCount += 1;
    } catch (error) {
      console.warn(`添加技能附件失败: ${agentId}`, error);
      failureCount += 1;
    }
  }

  return {
    total: openedAgentIds.length,
    successCount,
    failureCount
  };
}

function resetOpenedAgentPanelsForNewConversation() {
  const openedAgentIds = getOpenedAgentIds();
  openedAgentIds.forEach((agentId) => {
    cancelInFlightAgentRequest(agentId);
    forgetAllAgentAttachmentSources(agentId);
  });

  openedAgentIds.forEach((agentId) => {
    const state = getAgentState(agentId);
    if (!state) return;
    setAgentState(agentId, {
      ...state,
      messages: [],
      localDraft: '',
      isLoading: false,
      error: '',
      abortController: null
    });
  });

  getAgentPanelFrames().forEach((iframe) => {
    const agentId = String(iframe.dataset.agentId || '').trim();
    if (!agentId) return;
    syncAgentPanelStateToFrame(iframe, getAgentState(agentId));
  });
}

function buildHybridHistorySessionId() {
  return `hybrid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function saveHybridHistorySession(record) {
  if (typeof HybridHistoryDB.saveSession !== 'function') {
    return null;
  }
  return HybridHistoryDB.saveSession(record);
}

async function getHybridHistorySessionById(sessionId) {
  if (!sessionId || typeof HybridHistoryDB.getSession !== 'function') {
    return null;
  }
  return HybridHistoryDB.getSession(sessionId);
}

async function persistCurrentHybridHistorySession(query = '') {
  if (!currentHybridHistorySessionId || typeof HybridHistoryDB.saveSession !== 'function') {
    return null;
  }

  const existingSession = await getHybridHistorySessionById(currentHybridHistorySessionId).catch(() => null);

  const normalizedIncomingQuery = String(query || '').trim();
  const currentSearchQuery = getCurrentQueryText();
  const resolvedQuery = normalizedIncomingQuery
    || currentSearchQuery
    || String(readonlyHistorySession?.query || '').trim()
    || String(existingSession?.query || '').trim();

  const runtimeSnapshot = window.aiCompareSiteRuntime?.getSnapshot?.(getOpenedSites()) || { bySite: {} };
  const sitePanels = await Promise.all(getSiteIframes().map(async (iframe) => {
    const siteName = String(iframe.dataset.site || iframe.dataset.siteName || '').trim();
    const panelId = String(iframe.dataset.panelId || `site:${siteName}`).trim();
    const url = await getIframeLatestUrl(iframe, siteName, window._currentHistoryId || null);
    const runtimeEntry = runtimeSnapshot?.bySite?.[siteName] || null;
    const snapshotText = String(runtimeEntry?.content || '').trim();
    return {
      panelId,
      panelType: PANEL_KIND.SITE,
      title: siteName,
      siteName,
      url: url || iframe.src || '',
      snapshotText: snapshotText || url || iframe.src || '',
      content: snapshotText || '',
      runtimePhase: String(runtimeEntry?.phase || '').trim(),
      runtimeUpdatedAt: runtimeEntry?.updatedAt || ''
    };
  }));

  const agentPanels = getOpenedAgentIds().map((agentId) => {
    const state = getAgentState(agentId);
    if (!state) return null;
    return {
      panelId: state.panelId,
      panelType: PANEL_KIND.AGENT,
      title: state.name,
      agentId,
      agentName: state.name,
      messages: state.messages || [],
      localDraft: state.localDraft || '',
      pendingAttachments: normalizeAgentAttachments(state.pendingAttachments)
    };
  }).filter(Boolean);

  const panels = {};
  [...sitePanels, ...agentPanels].forEach((panel) => {
    panels[panel.panelId] = panel;
  });

  return saveHybridHistorySession({
    id: currentHybridHistorySessionId,
    query: resolvedQuery,
    createdAt: existingSession?.createdAt || readonlyHistorySession?.createdAt || Date.now(),
    updatedAt: Date.now(),
    isFavorite: existingSession?.isFavorite === true,
    favoriteFolder: existingSession?.isFavorite === true
      ? (String(existingSession?.favoriteFolder || '').trim() || 'default')
      : '',
    openSiteNames: getOpenedSites(),
    openAgentIds: getOpenedAgentIds(),
    panelOrder: getOpenedPanelIds(),
    panels,
    timelineEntries: timelineState.entries.map((timelineEntry) => ({
      query: String(timelineEntry?.query || '').trim(),
      timelineId: String(timelineEntry?.timelineId || '').trim(),
      historyId: timelineEntry?.historyId || null,
      timestamp: Number(timelineEntry?.timestamp) || Date.now(),
      dateLabel: timelineEntry?.dateLabel || '',
      occurrenceIndex: Math.max(0, Number(timelineEntry?.occurrenceIndex) || 0),
      sourceSites: Array.isArray(timelineEntry?.sourceSites) ? [...timelineEntry.sourceSites] : [],
      siteCount: Math.max(0, Number(timelineEntry?.siteCount) || 0)
    }))
  });
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

function shouldFallbackToDefaultSites(options = {}) {
  const hasSitesParam = options.hasSitesParam === true;
  const hasCustomSitesParam = options.hasCustomSitesParam === true;
  const hasAgentsParam = options.hasAgentsParam === true;
  const selectedSiteNames = Array.isArray(options.selectedSiteNames) ? options.selectedSiteNames : [];
  const selectedCustomSites = Array.isArray(options.selectedCustomSites) ? options.selectedCustomSites : [];
  const selectedAgents = Array.isArray(options.selectedAgents) ? options.selectedAgents : [];

  const hasAnyExplicitPanelParams = hasSitesParam || hasCustomSitesParam || hasAgentsParam;
  if (!hasAnyExplicitPanelParams) {
    return true;
  }

  const hasAnyResolvedPanels = selectedSiteNames.length > 0 || selectedCustomSites.length > 0 || selectedAgents.length > 0;
  return !hasAnyResolvedPanels;
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

function getOpenedAgentSet() {
  return new Set(getOpenedAgentIds());
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

async function getAvailableAgentCatalog() {
  const hiddenAgentIdSet = await getHiddenAgentIdSetForIframe().catch(() => new Set());
  const customSettingsMap = await getAgentCustomSettingsMapForIframe().catch(() => ({}));
  const customAgents = await getCustomAgentsForIframe().catch(() => []);
  const runtimeLocale = getRuntimeAgentCatalogLocale();
  if (typeof AgentCatalog.buildCatalogWithCustomSettings === 'function') {
    const catalog = AgentCatalog.buildCatalogWithCustomSettings(customSettingsMap, customAgents, runtimeLocale);
    return {
      ...catalog,
      agents: filterHiddenAgentsForIframe(catalog?.agents, hiddenAgentIdSet)
    };
  }

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'getAgentCatalog'
    });
    if (response?.success) {
      const catalog = response.result || { categories: [], agents: [] };
      return {
        ...catalog,
        agents: filterHiddenAgentsForIframe(catalog?.agents, hiddenAgentIdSet)
      };
    }
  } catch (error) {
    console.warn('获取智能体目录失败:', error);
  }

  const catalog = typeof AgentCatalog.getCatalog === 'function'
    ? AgentCatalog.getCatalog(runtimeLocale)
    : { categories: [], agents: [] };
  return {
    ...catalog,
    agents: filterHiddenAgentsForIframe(catalog?.agents, hiddenAgentIdSet)
  };
}

function buildAgentPanelUrl(agentId) {
  const params = new URLSearchParams();
  params.set('agentId', agentId);
  return `${chrome.runtime.getURL('iframe/agent-panel.html')}?${params.toString()}`;
}

async function ensureAgentIframeById(agentId) {
  if (!agentId) return false;
  const existingIframe = getAgentPanelFrames()
    .find((iframe) => iframe.getAttribute('data-agent-id') === agentId);
  if (existingIframe) return true;

  const catalog = await getAvailableAgentCatalog();
  const agent = (catalog?.agents || []).find((item) => item.id === agentId);
  if (!agent) {
    return false;
  }

  const container = document.getElementById('iframes-container');
  if (!container) return false;

  createAgentIframe(agent, container);
  return true;
}

function removeAgentIframeById(agentId) {
  cancelInFlightAgentRequest(agentId);
  const iframe = getAgentPanelFrames()
    .find((item) => item.getAttribute('data-agent-id') === agentId);
  const container = iframe?.closest('.iframe-container');
  forgetAllAgentAttachmentSources(agentId);
  if (!container) return false;
  container.remove();
  activeAgentPanelStore.delete(String(agentId || '').trim());
  rebuildTimelineEntriesFromSnapshots();
  return true;
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

  const iframeUrl = buildSiteUrlForQuery(site, '');
  createSingleIframe(site.name, iframeUrl, container, '', null);
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
  scheduleLiveSummaryRefresh(150);
  return true;
}

function syncNavCheckboxStates() {
  const openedSet = getOpenedSiteSet();
  const checkboxes = document.querySelectorAll('.nav-site-checkbox');
  checkboxes.forEach(checkbox => {
    const siteName = checkbox.dataset.siteName;
    checkbox.checked = openedSet.has(siteName);
  });

  const openedAgentSet = getOpenedAgentSet();
  const agentCheckboxes = document.querySelectorAll('.nav-agent-checkbox');
  agentCheckboxes.forEach((checkbox) => {
    const agentId = checkbox.dataset.agentId;
    checkbox.checked = openedAgentSet.has(agentId);
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

  const nameLabel = document.createElement('span');
  nameLabel.className = 'nav-site-name';
  nameLabel.textContent = siteName;
  nameLabel.title = siteName;

  row.appendChild(checkbox);
  row.appendChild(iconBtn);
  row.appendChild(nameLabel);
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

function createNavAgentItemElement(agent, container = document.getElementById('iframes-container')) {
  const agentId = agent.id;
  const navItem = document.createElement('li');
  navItem.className = 'nav-item nav-site-item';
  navItem.dataset.agentId = agentId;

  const row = document.createElement('div');
  row.className = 'nav-site-row';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'nav-site-checkbox nav-agent-checkbox';
  checkbox.dataset.agentId = agentId;
  checkbox.checked = getOpenedAgentSet().has(agentId);

  const iconBtn = document.createElement('button');
  iconBtn.type = 'button';
  iconBtn.className = 'nav-site-icon-btn nav-agent-badge-btn';
  iconBtn.title = agent.name;
  iconBtn.setAttribute('aria-label', agent.name);
  iconBtn.textContent = String(agent.shortName || agent.name || '?').slice(0, 1);
  iconBtn.style.background = agent.color || '#111111';
  iconBtn.style.color = '#ffffff';
  iconBtn.style.fontWeight = '700';

  const nameLabel = document.createElement('span');
  nameLabel.className = 'nav-site-name nav-agent-name';
  nameLabel.textContent = String(agent.name || '');
  nameLabel.title = String(agent.name || '');

  row.appendChild(checkbox);
  row.appendChild(iconBtn);
  row.appendChild(nameLabel);
  navItem.appendChild(row);

  checkbox.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  checkbox.addEventListener('change', async (event) => {
    const targetCheckbox = event.currentTarget;
    const targetAgentId = targetCheckbox.dataset.agentId;
    targetCheckbox.disabled = true;
    try {
      if (targetCheckbox.checked) {
        await ensureAgentIframeById(targetAgentId);
      } else {
        removeAgentIframeById(targetAgentId);
      }
    } finally {
      targetCheckbox.disabled = false;
      syncNavCheckboxStates();
    }
  });

  iconBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!checkbox.checked) return;
    setActiveNavItem(navItem);
    const targetIframe = getAgentPanelFrames()
      .find((iframe) => iframe.getAttribute('data-agent-id') === agentId);
    const targetContainer = targetIframe?.closest('.iframe-container');
    if (targetContainer) {
      targetContainer.scrollIntoView({ behavior: 'smooth' });
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
  const agentCatalog = await getAvailableAgentCatalog();
  const visibleAgents = filterHiddenAgentsForIframe(agentCatalog?.agents);

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

  const siteGroup = document.createElement('li');
  siteGroup.className = 'nav-group';
  siteGroup.innerHTML = `<div class="nav-group-title">Sites</div>`;
  const siteGroupList = document.createElement('ul');
  siteGroupList.className = 'nav-list';
  siteGroup.appendChild(siteGroupList);
  navList.appendChild(siteGroup);

  const normalizedSites = (sites || [])
    .map(site => typeof site === 'string' ? { name: site } : site)
    .filter(site => site && site.name);

  normalizedSites.forEach((site, index) => {
    const navItem = createNavItemElement(site, container);
    navItem.dataset.originalIndex = String(index);
    siteGroupList.appendChild(navItem);
  });

  if (visibleAgents.length > 0) {
    const agentGroup = document.createElement('li');
    agentGroup.className = 'nav-group';
    agentGroup.innerHTML = `<div class="nav-group-title">Skills</div>`;
    const agentGroupList = document.createElement('ul');
    agentGroupList.className = 'nav-list';
    agentGroup.appendChild(agentGroupList);
    navList.appendChild(agentGroup);

    visibleAgents.forEach((agent) => {
      agentGroupList.appendChild(createNavAgentItemElement(agent, container));
    });
  }

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
async function createIframes(query, sites, customSites = [], agents = []) {
  const enabledSites = Array.isArray(sites) ? sites : [];
  const normalizedCustomSites = SiteLaunchUtils.normalizeCustomSites
    ? SiteLaunchUtils.normalizeCustomSites(customSites)
    : [];
  const normalizedAgents = Array.isArray(agents) ? agents : [];
    
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
  if (hasQuery) {
    const timelineEntry = upsertTimelineEntry({
      query,
      timestamp: Date.now(),
      dateLabel: formatTimelineDateLabel(Date.now())
    });
    startLiveSummaryForQuery(query, {
      entryKey: getLiveSummaryEntryKey(timelineEntry)
    });
  } else {
    hideLiveSummaryCard();
  }
  
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

    normalizedAgents.forEach((agent) => {
      createAgentIframe(agent, container);
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
    const hasAgentPanels = normalizedAgents.length > 0;
    if (hasAgentPanels) {
      currentHybridHistorySessionId = currentHybridHistorySessionId || buildHybridHistorySessionId();
      await saveHybridHistorySession({
        id: currentHybridHistorySessionId,
        query,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        openSiteNames: [...enabledSites.map((site) => site.name), ...normalizedCustomSites.map((site) => site.name)],
        openAgentIds: normalizedAgents.map((agent) => agent.id),
        panelOrder: getOpenedPanelIds(),
        panels: {}
      });
      window._currentHistoryId = currentHybridHistorySessionId;
    } else {
      await savePKHistory(query);
    }
  }

  // 首页/直达页带着 query 进来后，站点已开始自动发送；发送链路启动后即可清空顶部输入框，
  // 方便用户直接输入下一轮问题。
  if (query && query.trim() !== '' && !window._openedFromHistory) {
    clearIframeSearchInput();
    armSearchBarAutoCollapse();
  }

  if (query && query.trim() !== '' && normalizedAgents.length > 0 && !window._openedFromHistory) {
    normalizedAgents.forEach((agent) => {
      runAgentPrompt(agent.id, query, 'global').catch((error) => {
        console.error('初始化智能体提问失败:', error);
      });
    });
  }

  if (hasQuery) {
    scheduleLiveSummaryRefresh(900, {
      query,
      preserveActiveEntry: true
    });
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
    const historyId = window._currentHistoryId || null;
    if (historyId) {
      try {
        iframe.contentWindow?.postMessage({
          type: 'SET_HISTORY_CONTEXT',
          historyId,
          siteName
        }, '*');
      } catch (error) {
        console.warn('iframe load 时设置历史上下文失败:', error);
      }
    }

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
            const historyId = window._currentHistoryId || null;
            if (historyId) {
              try {
                iframe.contentWindow?.postMessage({
                  type: 'SET_HISTORY_CONTEXT',
                  historyId,
                  siteName
                }, '*');
              } catch (error) {
                console.warn('首屏自动执行时设置历史上下文失败:', error);
              }
            }
            await handler(iframe, latestQuery, historyId);
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
  refreshPageBtn.title = t('refresh', '刷新');
  openPageBtn.title = t('openInNewTab', '在新标签页打开');
  closeBtn.title = t('closeButton', '关闭');

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
        const buttonText = t('startCompare', 'PK');
        searchButton.textContent = buttonText;
        
        // 调试日志
        console.log('按钮文案设置:', {
            当前语言: window.RuntimeI18n?.getCurrentLocale?.() || navigator.language || 'en',
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
    btn.title = isFavorite ? t('iframeUnfavoriteTitle', '取消收藏') : t('iframeFavoriteTitle', '收藏');
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
    favoriteBtn.title = isFavorite ? t('iframeUnfavoriteTitle', '取消收藏') : t('iframeFavoriteTitle', '收藏');
    
    const favoriteIcon = document.createElement('img');
    favoriteIcon.className = 'iframe-favorite-icon';
    favoriteIcon.src = isFavorite ? '../icons/star_saved.svg' : '../icons/star_unsaved.svg';
    favoriteIcon.alt = t('iframeFavoriteTitle', '收藏');
    
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
    const favoriteAllSitesTitle = t('favoriteAllSites');
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
        const message = t(key);
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
        const message = t(key);
        if (message) {
            element.title = message;
        }
    });
    
    // 处理 data-i18n-alt：设置 img 的 alt 属性
    document.querySelectorAll('[data-i18n-alt]').forEach(element => {
        const key = element.getAttribute('data-i18n-alt');
        const message = t(key);
        if (message) {
            element.alt = message;
        }
    });

    // 处理 data-i18n-aria-label：设置元素的 aria-label 属性
    document.querySelectorAll('[data-i18n-aria-label]').forEach(element => {
        const key = element.getAttribute('data-i18n-aria-label');
        const message = t(key);
        if (message) {
            element.setAttribute('aria-label', message);
        }
    });
    
    // 手动设置输入框的占位符
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        const placeholderMessage = t('inputPlaceholder');
        if (placeholderMessage) {
            searchInput.placeholder = placeholderMessage;
        }
    }

    refreshIframeDynamicI18n();
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
    const labelText = t('promptTemplatesLabel', '模板：');
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

function resetIframePageToCurrentPanels() {
  const currentUrl = new URL(window.location.href);
  const params = new URLSearchParams(currentUrl.search);

  const openedSiteNames = getOpenedSites();
  const openedAgentIds = getOpenedAgentIds();

  resetOpenedAgentPanelsForNewConversation();

  if (openedSiteNames.length > 0) {
    params.set('sites', openedSiteNames.join(','));
  } else {
    params.delete('sites');
  }

  if (openedAgentIds.length > 0) {
    params.set('agents', openedAgentIds.join(','));
  } else {
    params.delete('agents');
  }

  const customSiteIds = Array.from(document.querySelectorAll('.ai-iframe[data-custom-site="true"][data-site]'))
    .map((iframe) => String(iframe.getAttribute('data-site') || '').trim())
    .filter(Boolean);
  if (customSiteIds.length > 0) {
    params.set('customSites', customSiteIds.join(','));
  } else {
    params.delete('customSites');
  }

  params.delete('query');
  params.delete('historyId');

  const targetUrl = `${chrome.runtime.getURL('iframe/iframe.html')}?${params.toString()}`;
  window.location.href = targetUrl;
}

async function runIframeSearchQuery(query, options = {}) {
  const normalizedQuery = String(query || '').trim();
  const trigger = options.trigger || 'button';
  const clearInputOnSuccess = options.clearInputOnSuccess !== false;
  const armCollapseOnSuccess = options.armCollapseOnSuccess !== false;

  if (!normalizedQuery) return false;

  if (isReadonlyHistoryMode && readonlyHistorySession) {
    const params = new URLSearchParams();
    params.set('query', normalizedQuery);
    if (Array.isArray(readonlyHistorySession.openSiteNames) && readonlyHistorySession.openSiteNames.length > 0) {
      params.set('sites', readonlyHistorySession.openSiteNames.join(','));
    }
    if (Array.isArray(readonlyHistorySession.openAgentIds) && readonlyHistorySession.openAgentIds.length > 0) {
      params.set('agents', readonlyHistorySession.openAgentIds.join(','));
    }
    window.location.href = `${chrome.runtime.getURL('iframe/iframe.html')}?${params.toString()}`;
    return true;
  }

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
    const timelineEntry = upsertTimelineEntry({
      query: normalizedQuery,
      timestamp: Date.now(),
      dateLabel: formatTimelineDateLabel(Date.now())
    });
    const entryKey = getLiveSummaryEntryKey(timelineEntry);
    startLiveSummaryForQuery(normalizedQuery, { entryKey });
    scheduleLiveSummaryRefresh(900, {
      query: normalizedQuery,
      entryKey,
      preserveActiveEntry: true
    });
    if (clearInputOnSuccess) {
      clearIframeSearchInput();
    }
    if (armCollapseOnSuccess) {
      armSearchBarAutoCollapse();
    }
  } else if (getLiveSummaryCurrentQuery() === normalizedQuery && getActiveLiveSummaryRecord().status !== 'ready') {
    hideLiveSummaryCard();
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
      const hasAgentPanels = getAgentPanelFrames().length > 0;

      let historyId = providedHistoryId || window._currentHistoryId || null;
      if (persistHistory) {
        try {
          if (hasAgentPanels) {
            currentHybridHistorySessionId = buildHybridHistorySessionId();
            historyId = currentHybridHistorySessionId;
            window._currentHistoryId = currentHybridHistorySessionId;
            await persistCurrentHybridHistorySession(query);
          } else {
            historyId = await savePKHistory(query);
          }
        } catch (error) {
          console.error('立即保存 PK 历史记录失败（将继续执行 PK）:', error);
        }
      }
        
      const iframes = getSiteIframes();
      const agentIframes = getAgentPanelFrames();
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

              const nextUrl = launchTarget.url;
              if (window.aiCompareSiteRuntime?.queueSiteRuntime) {
                window.aiCompareSiteRuntime.queueSiteRuntime(siteName, query, { iframeSrc: nextUrl || iframe.src });
              }
              if (iframeContainer) {
                setIframeHeaderStatus(iframeContainer, t('iframeStatusNetworkLoading', '网络加载中...'));
              }
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

      for (const agentIframe of agentIframes) {
        const agentId = String(agentIframe.dataset.agentId || '').trim();
        if (!agentId) {
          continue;
        }
        if (targetSiteNameSet && !targetSiteNameSet.has(String(agentIframe.dataset.site || '').trim()) && !targetSiteNameSet.has(agentId)) {
          continue;
        }
        runAgentPrompt(agentId, query, 'global').catch((error) => {
          console.error('执行智能体全局提问失败:', error);
        });
      }

      scheduleTimelineSyncBurst([1800, 4200, 7600]);
      return iframes.length > 0 || agentIframes.length > 0;
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

    const hybridSession = window._currentHistoryId
      ? await getHybridHistorySessionById(window._currentHistoryId)
      : null;
    if (hybridSession) {
      isReadonlyHistoryMode = false;
      readonlyHistorySession = hybridSession;
      currentHybridHistorySessionId = hybridSession.id;
      await restoreHybridSessionAsLivePanels(hybridSession, container);

      const searchInput = document.getElementById('searchInput');
      if (searchInput) {
        searchInput.value = hybridSession.query || '';
        updateFavoriteButtonVisibility(hybridSession.query || '');
      }

      restoreHybridSessionTimeline(hybridSession);

      await renderSideNav();
      return;
    }

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
      refreshPageBtn.title = t('refresh', '刷新');
      openPageBtn.title = t('openInNewTab', '在新标签页打开');
      closeBtn.title = t('closeButton', '关闭');

      iframe.addEventListener('load', () => {
        const historyId = window._currentHistoryId || null;
        if (historyId) {
          try {
            iframe.contentWindow?.postMessage({
              type: 'SET_HISTORY_CONTEXT',
              historyId,
              siteName
            }, '*');
          } catch (error) {
            console.warn('历史 iframe load 时设置历史上下文失败:', error);
          }
        }

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
        return;
      }
    }
    
    // 保存更新后的历史记录
    await chrome.storage.local.set({ pkHistory: pkHistory });
    
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
  initializeLiveSummaryCard();
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
      resetIframePageToCurrentPanels();
    });
  }
  const shareTimelineButton = document.getElementById('shareTimelineButton');
  if (shareTimelineButton) {
    shareTimelineButton.addEventListener('click', (event) => {
      event.stopPropagation();
      void openTopLevelShareFlow();
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

if (typeof window !== 'undefined') {
  window.addEventListener('runtime-language-changed', () => {
    initializeI18n();
    renderLiveSummaryCard();
    void refreshIframeVisibleQuerySuggestions();
    void refreshOpenAnalysisTemplateSelects();
    renderSideNav().catch((error) => {
      console.warn('Failed to rerender side nav after language change:', error);
    });
    if (document.getElementById('queryList')?.style.display === 'block') {
      showFavorites();
    }
  });
}


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
  const deniedTitle = t('clipboardPermissionDenied', 'Clipboard permission denied');
  const deniedDetail = t(
    'clipboardPermissionDeniedDetail',
    'Please allow clipboard access in your browser settings, or click the lock icon to the left of the address bar to update the permission.'
  );
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
      <span style="font-weight: 600;">${escapeHtml(deniedTitle)}</span>
    </div>
    <div style="font-size: 12px; opacity: 0.9;">
      ${escapeHtml(deniedDetail)}
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
  } catch (error) {
    console.error('保存收藏失败:', error);
  }
}

// 显示收藏夹
function showFavorites() {
  const queryList = document.getElementById('queryList');
  
  if (favoritePrompts.length === 0) {
    const favoritesTitle = t('favoritesTitle', 'Favorites');
    const noFavoritesMessage = t('noFavorites', 'No favorites yet');
    queryList.innerHTML = `<div class="favorites-section"><div class="favorites-title">${favoritesTitle}</div><div style="padding: 10px; color: #666; text-align: center;">${noFavoritesMessage}</div></div>`;
  } else {
    const favoritesTitle = t('favoritesTitle', 'Favorites');
    const deleteTitle = t('favoriteItemDeleteTitle', '') || t('deleteButton', 'Delete');
    const deleteAlt = t('favoriteItemDeleteAlt', deleteTitle);
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

            <button class="favorite-item-delete" title="${escapeAttr(deleteTitle)}" aria-label="${escapeAttr(deleteTitle)}">
              <img src="../icons/close.svg" alt="${escapeAttr(deleteAlt)}">
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
  showToast(t('comingSoonNotice', 'In development, not available yet'));
}

// 删除收藏项
async function deleteFavoriteItem(item) {
  console.log('deleteFavoriteItem 函数被调用');
  const index = parseInt(item.getAttribute('data-index'));
  const prompt = item.getAttribute('data-prompt');
  console.log('删除索引:', index, '提示词:', prompt);
  
  const deleteConfirmMessage = t('deleteConfirm', 'Delete this item?');
  if (confirm(deleteConfirmMessage)) {
    try {
      // 从数组中删除
      favoritePrompts.splice(index, 1);
      
      // 保存到存储
      await chrome.storage.sync.set({ favoritePrompts: favoritePrompts });
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
let currentUploadRetryContext = null;

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
    currentUploadRetryContext = {
      file,
      fileData: null,
      lastErrorMessage: '',
      lastFailedSiteName: '',
      kind: 'file-upload'
    };
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
      if (currentUploadRetryContext) {
        currentUploadRetryContext.lastErrorMessage = result.errorMessage || '';
      }
      showFileUploadError(`文件 "${file.name}" 处理失败${reason}${remainingText}`);
    }
  }
  
  currentUploadBatch = null;
  currentUploadRetryContext.file = null;
  currentUploadRetryContext.fileData = null;
  
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
    // 创建文件数据对象
    const fileData = {
      type: file.type,
      blob: file,
      data: file,
      file,
      fileName: file.name,
      originalName: file.name,
      size: file.size,
      lastModified: file.lastModified
    };
    if (currentUploadRetryContext) {
      currentUploadRetryContext.fileData = fileData;
      currentUploadRetryContext.file = file;
    }
    
    console.log('🎯 文件数据准备完成:', fileData);
    
    // 调用现有的多iframe文件处理流程
    const ok = await processFileToAllIframes(fileData);
    if (!ok) {
      return { ok: false, errorMessage: t('fileUploadNoAvailablePanels', 'No available panels were found') };
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
  console.log('🎯 开始向所有面板发送文件');

  const siteIframes = getSiteIframes();
  const openedAgentIds = getOpenedAgentIds();
  console.log(`找到 ${siteIframes.length} 个站点 iframe，${openedAgentIds.length} 个 skill 面板`);

  if (siteIframes.length === 0 && openedAgentIds.length === 0) {
    showFileUploadError(t('fileUploadNoAvailablePanels', 'No available panels were found'));
    return false;
  }

  if (siteIframes.length > 0) {
    await executeFileUploadSequentially(siteIframes, fileData);
  }

  if (openedAgentIds.length > 0) {
    await stageFileForAllAgentPanels(fileData);
  }
  if (currentUploadRetryContext) {
    currentUploadRetryContext.fileData = fileData;
  }

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
  
  const uploadFailedTitle = t('fileUploadFailedTitle', 'File upload failed');
  error.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
      <span style="font-size: 18px;">❌</span>
      <span style="font-weight: 600;">${escapeHtml(uploadFailedTitle)}</span>
    </div>
    <div style="font-size: 13px; opacity: 0.9;">${safeMessage}</div>
  `;

  const retryButton = document.createElement('button');
  retryButton.type = 'button';
  retryButton.textContent = t('uploadRetryButton', '重新上传文件');
  retryButton.style.cssText = `
    margin-top: 12px;
    padding: 8px 12px;
    border: 0;
    border-radius: 8px;
    background: rgba(255,255,255,0.16);
    color: white;
    cursor: pointer;
    font-size: 13px;
  `;
  retryButton.addEventListener('click', async () => {
    error.remove();
    await retryCurrentUploadBatch();
  });
  error.appendChild(retryButton);
  
  document.body.appendChild(error);
  
  // 3秒后自动关闭
  setTimeout(() => {
    if (error.parentElement) {
      error.remove();
    }
  }, 3000);
}
