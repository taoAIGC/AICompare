// 跟踪输入法组合输入状态（用于中文输入法）
let isComposing = false;

const HOMEPAGE_PERF_PREFIX = 'homepage';
const HOMEPAGE_PERF_CACHE_KEY = '__homepagePerfMeasures';
const DEFAULT_SITE_GROUP = 'information';
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
const HOMEPAGE_DEFAULT_SEND_SHORTCUT = 'enter';
const HOMEPAGE_IS_MAC_PLATFORM = /Mac|iPhone|iPad|iPod/i.test(
    navigator.platform || navigator.userAgentData?.platform || navigator.userAgent || ''
);
const HOMEPAGE_BATCH_FAVORITES_STORAGE_KEY = 'homepageBatchFavorites';
const HOMEPAGE_PK_STARTER_STORAGE_KEY = 'homepagePkStarterShown';
const HOMEPAGE_COURSE_PROMO_STORAGE_KEY = 'homepageCoursePromoState';
const HOMEPAGE_COURSE_PROMO_CAMPAIGN = 'codex_course';
const AGENT_CUSTOM_SETTINGS_STORAGE_KEY = (window.AICompareAgentCatalog?.AGENT_CUSTOM_SETTINGS_STORAGE_KEY) || 'agentCustomSettings';
const CUSTOM_AGENTS_STORAGE_KEY = (window.AICompareAgentCatalog?.CUSTOM_AGENTS_STORAGE_KEY) || 'customAgents';
const AGENT_HIDDEN_IDS_STORAGE_KEY = (window.AICompareAgentCatalog?.AGENT_HIDDEN_IDS_STORAGE_KEY) || 'agentHiddenIds';
const SITE_GROUP_LABELS = {
    information: 'homepageTypeInformation',
    translate: 'homepageTypeTranslate'
};

const homepageSitesState = {
    supportedSites: [],
    selectedSites: new Map(),
    customSites: [],
    selectedCustomSites: new Map(),
    agentCatalog: {
        categories: [],
        agents: []
    },
    selectedAgents: new Map(),
    activeGroup: DEFAULT_SITE_GROUP,
    configuredGroups: [DEFAULT_SITE_GROUP],
    dragAndDropBound: false
};
let ensureHomepagePromptTemplatesPromise = null;
let homepageSubmitShortcutMode = HOMEPAGE_DEFAULT_SEND_SHORTCUT;
let remoteSearchHomepageState = null;
let remoteSearchHomepageListenerBound = false;
let homepageAgentNameTooltipController = null;
let homepageBatchModeEditor = null;
let homepageBatchFavorites = [];
let homepageActiveBatchFavoriteId = '';

async function ensureHomepageAgentCatalogReady() {
    if (typeof window.hydrateBundledAgentCatalogIfNeeded === 'function') {
        await window.hydrateBundledAgentCatalogIfNeeded().catch(() => false);
    }
    if (typeof window.RemoteAgentConfigManager?.autoCheckUpdate === 'function') {
        await window.RemoteAgentConfigManager.autoCheckUpdate().catch(() => null);
    }
    if (typeof window.AICompareAgentCatalog?.ensureCatalogHydrated === 'function') {
        await window.AICompareAgentCatalog.ensureCatalogHydrated().catch(() => null);
    }
}

async function loadHomepageSubmitShortcutMode() {
    let nextMode = HOMEPAGE_DEFAULT_SEND_SHORTCUT;

    try {
        const defaultButtonConfig = await window.AppConfigManager.getButtonConfig();
        nextMode = normalizeSendShortcutMode(defaultButtonConfig?.sendShortcut);
        const { buttonConfig } = await chrome.storage.sync.get('buttonConfig');
        nextMode = normalizeSendShortcutMode(buttonConfig?.sendShortcut ?? nextMode);
    } catch (error) {
        console.warn('Failed to load homepage submit shortcut mode:', error);
    }

    homepageSubmitShortcutMode = nextMode;
    return nextMode;
}

function applyHomepageSubmitShortcutMode(buttonConfig = {}) {
    homepageSubmitShortcutMode = normalizeSendShortcutMode(buttonConfig?.sendShortcut);
}

async function refreshHomepageVisibleQuerySuggestions() {
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
        console.warn('Failed to refresh homepage query suggestions:', error);
    }
}

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync' && changes.buttonConfig) {
        applyHomepageSubmitShortcutMode(changes.buttonConfig.newValue || {});
    }
    if (namespace === 'sync' && changes.promptTemplates) {
        void refreshHomepageVisibleQuerySuggestions();
    }
    if (namespace === 'sync' && changes[HOMEPAGE_BATCH_FAVORITES_STORAGE_KEY]) {
        homepageBatchFavorites = normalizeHomepageBatchFavorites(changes[HOMEPAGE_BATCH_FAVORITES_STORAGE_KEY].newValue);
        if (homepageActiveBatchFavoriteId && !homepageBatchFavorites.some(item => item.id === homepageActiveBatchFavoriteId)) {
            homepageActiveBatchFavoriteId = '';
        }
        renderBatchModeFavorites();
    }
    if (namespace === 'local' && changes[HOMEPAGE_PK_STARTER_STORAGE_KEY]) {
        void initializeHomepagePkStarterQuery();
    }
    if (namespace === 'local' && (changes._planCache || changes._planCacheAt || changes.firebase_uid)) {
        void initializeHomepageMembershipBanner();
    }
});

void loadHomepageSubmitShortcutMode();

function perfMark(name) {
    if (typeof performance === 'undefined' || typeof performance.mark !== 'function') {
        return;
    }
    try {
        performance.mark(`${HOMEPAGE_PERF_PREFIX}_${name}`);
    } catch (_) {}
}

function perfMeasure(name, startMark, endMark) {
    if (typeof performance === 'undefined' || typeof performance.measure !== 'function') {
        return;
    }
    try {
        performance.measure(
            `${HOMEPAGE_PERF_PREFIX}_${name}`,
            `${HOMEPAGE_PERF_PREFIX}_${startMark}`,
            `${HOMEPAGE_PERF_PREFIX}_${endMark}`
        );
    } catch (_) {}
}

function cacheHomepagePerfMeasures(reason) {
    if (typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') {
        return;
    }
    try {
        const measures = performance
            .getEntriesByType('measure')
            .filter(entry => entry.name.startsWith(`${HOMEPAGE_PERF_PREFIX}_`))
            .map(entry => ({
                name: entry.name,
                duration: Number(entry.duration.toFixed(2)),
                startTime: Number(entry.startTime.toFixed(2))
            }));
        window[HOMEPAGE_PERF_CACHE_KEY] = {
            reason,
            capturedAt: Date.now(),
            measures
        };
    } catch (_) {}
}

async function measureAsyncStep(stepName, runner) {
    const startMark = `${stepName}_start`;
    const endMark = `${stepName}_end`;
    perfMark(startMark);
    try {
        return await runner();
    } finally {
        perfMark(endMark);
        perfMeasure(`${stepName}_duration`, startMark, endMark);
    }
}

window.getHomepagePerfMeasures = function() {
    return window[HOMEPAGE_PERF_CACHE_KEY] || null;
};

perfMark('script_eval_start');

function trackEvent(name, params = {}) {
    const insightPayload = window.AICompareBehaviorInsights?.buildAnalyticsPayload?.({
        eventName: name,
        source: 'homepage',
        surface: params?.surface || 'homepage',
        trigger: params?.trigger || '',
        kind: params?.kind || '',
        hasQuery: Boolean(params?.has_query || params?.query_length),
        queryLength: Math.max(0, Number(params?.query_length) || 0),
        metadata: params
    }) || {
        eventName: name,
        source: 'homepage',
        hasQuery: Boolean(params?.has_query || params?.query_length),
        queryLength: Math.max(0, Number(params?.query_length) || 0),
        metadata: params
    };
    try {
        chrome.runtime.sendMessage({
            action: 'recordAnalyticsEvent',
            payload: insightPayload
        }, () => {
            if (chrome.runtime.lastError) {
                // Analytics must never block the product flow.
            }
        });
    } catch (_) {
        // Ignore analytics upload failures.
    }
    const analytics = window.AIShortcutsAnalytics;
    if (analytics && typeof analytics.logEvent === 'function') {
        analytics.logEvent(name, params);
    }
}

async function trackEventOnce(onceKey, name, params = {}) {
    const key = String(onceKey || name || '').trim();
    if (!key) return;
    try {
        const { behaviorInsightOnceEvents = {} } = await chrome.storage.local.get('behaviorInsightOnceEvents');
        if (behaviorInsightOnceEvents[key]) return;
        trackEvent(name, {
            ...params,
            kind: params.kind || 'activation'
        });
        await chrome.storage.local.set({
            behaviorInsightOnceEvents: {
                ...behaviorInsightOnceEvents,
                [key]: Date.now()
            }
        });
    } catch (_) {
        trackEvent(name, {
            ...params,
            kind: params.kind || 'activation'
        });
    }
}

function t(key, fallback = '') {
    return window.RuntimeI18n?.getMessage?.(key) || chrome?.i18n?.getMessage?.(key) || fallback;
}

function interpolateMessage(template, substitutions = []) {
    const values = Array.isArray(substitutions) ? substitutions : [substitutions];
    return values.reduce((result, value, index) => (
        result.replaceAll(`$${index + 1}`, String(value))
    ), String(template || ''));
}

function refreshHomepageDynamicI18n() {
    const searchButton = document.getElementById('searchButton');
    if (searchButton) {
        const compareLabel = t('startCompare', 'PK');
        searchButton.textContent = compareLabel;
        searchButton.title = compareLabel;
        searchButton.setAttribute('aria-label', compareLabel);
    }

    const fileUploadButton = document.getElementById('fileUploadButton');
    if (fileUploadButton) {
        const fileUploadTitle = t('fileUploadButtonTitle', 'Upload file to all AI sites');
        fileUploadButton.title = fileUploadTitle;
        fileUploadButton.setAttribute('aria-label', fileUploadTitle);
        fileUploadButton.setAttribute('data-tooltip', fileUploadTitle);
    }

    const batchModeButton = document.getElementById('batchModeButton');
    if (batchModeButton) {
        const batchModeTitle = t('homepageBatchModeButtonTitle', 'Batch mode');
        batchModeButton.title = batchModeTitle;
        batchModeButton.setAttribute('aria-label', batchModeTitle);
        batchModeButton.setAttribute('data-tooltip', batchModeTitle);
    }

    const saveBtn = document.getElementById('saveSitesBtn');
    if (saveBtn) {
        const saveTitle = t('saveFavoriteSitesTitle', '') || t('saveFavoriteSites', 'Save as default sites');
        saveBtn.setAttribute('aria-label', saveTitle);
    }

    if (remoteSearchHomepageState) {
        renderRemoteSearchHomepageCard(remoteSearchHomepageState);
    }

    refreshBatchModeEditorI18n();
    refreshBatchModeFavoriteNameI18n();
    renderBatchModeFavorites();
    renderSiteTypeTabs();
}

async function markHomepagePkStarterCompleted() {
    try {
        await chrome.storage.local.set({
            [HOMEPAGE_PK_STARTER_STORAGE_KEY]: true
        });
    } catch (error) {
        console.warn('Failed to persist homepage PK starter completion:', error);
    }
}

async function initializeHomepagePkStarterQuery() {
    const searchInput = document.getElementById('searchInput');
    if (!searchInput) {
        return;
    }

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('query')) {
        return;
    }

    if (String(searchInput.value || '').trim()) {
        return;
    }

    try {
        const stored = await chrome.storage.local.get([HOMEPAGE_PK_STARTER_STORAGE_KEY]);
        if (stored?.[HOMEPAGE_PK_STARTER_STORAGE_KEY] !== false) {
            return;
        }
    } catch (error) {
        console.warn('Failed to read homepage PK starter state:', error);
        return;
    }

    const starterQuery = t('homepagePkStarterQuery', '不比较不同AI的结果，只使用单一AI，会有什么风险？');
    if (!starterQuery) {
        return;
    }

    searchInput.value = starterQuery;
    searchInput.dispatchEvent(new Event('input'));

    try {
        await showQuerySuggestions(starterQuery);
    } catch (error) {
        console.warn('Failed to show homepage PK starter suggestions:', error);
    }
}

function openHomepageMembershipPage() {
    window.location.href = chrome.runtime.getURL('options/options.html#membership');
}

function renderHomepageMembershipBanner(planInfo = {}) {
    const banner = document.getElementById('homepagePlanBanner');
    if (!banner) {
        return;
    }

    banner.hidden = String(planInfo?.plan || 'free').trim() === 'pro';
}

async function initializeHomepageMembershipBanner() {
    const banner = document.getElementById('homepagePlanBanner');
    const upgradeButton = document.getElementById('homepagePlanBannerUpgradeBtn');

    if (upgradeButton && upgradeButton.dataset.bound !== 'true') {
        upgradeButton.dataset.bound = 'true';
        upgradeButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            trackEvent('homepage_membership_upgrade_click', {
                source: 'free_plan_banner'
            });
            openHomepageMembershipPage();
        });
    }

    if (!banner) {
        return;
    }

    let planInfo = { plan: 'free', planExpiresAt: null };

    try {
        if (typeof window.getUserPlan === 'function') {
            planInfo = await window.getUserPlan();
        }
    } catch (error) {
        console.warn('Failed to load homepage membership plan:', error);
    }

    renderHomepageMembershipBanner(planInfo);
}

function getHomepageCoursePromoEndpoint() {
    try {
        const baseUrl = String(window.FirebaseConfig?.getCloudFunctionsBaseUrl?.() || '').trim().replace(/\/+$/, '');
        return baseUrl ? `${baseUrl}/api/public/course-promo` : '';
    } catch (_) {
        return '';
    }
}

function getHomepageLocaleCandidates() {
    const locales = [];
    try {
        const chromeLocale = chrome.i18n.getUILanguage?.();
        if (chromeLocale) locales.push(chromeLocale);
    } catch (_) {
        // Ignore locale API failures; navigator still gives us useful hints.
    }
    if (navigator.language) locales.push(navigator.language);
    if (Array.isArray(navigator.languages)) {
        locales.push(...navigator.languages);
    }
    return [...new Set(locales.map(normalizeHomepageLocale).filter(Boolean))];
}

function normalizeHomepageLocale(value = '') {
    return String(value || '').trim().replace('-', '_').toLowerCase();
}

function homepageLocaleMatchesCoursePromo(targetLocales = []) {
    const currentLocales = getHomepageLocaleCandidates();
    if (!currentLocales.length) return false;
    const candidates = Array.isArray(targetLocales) && targetLocales.length ? targetLocales : ['zh_CN', 'zh_TW', 'zh'];
    return candidates.some((locale) => {
        const target = normalizeHomepageLocale(locale);
        return target && currentLocales.some((current) => (
            current === target || current.startsWith(`${target}_`) || target.startsWith(`${current}_`)
        ));
    });
}

function isHttpsUrl(value = '') {
    try {
        return new URL(String(value || '')).protocol === 'https:';
    } catch (_) {
        return false;
    }
}

function getTodayDateKey() {
    return new Date().toISOString().slice(0, 10);
}

async function readHomepageCoursePromoState() {
    try {
        const result = await chrome.storage.local.get(HOMEPAGE_COURSE_PROMO_STORAGE_KEY);
        return result[HOMEPAGE_COURSE_PROMO_STORAGE_KEY] || {};
    } catch (_) {
        return {};
    }
}

async function writeHomepageCoursePromoState(nextState = {}) {
    try {
        await chrome.storage.local.set({ [HOMEPAGE_COURSE_PROMO_STORAGE_KEY]: nextState });
    } catch (_) {
        // Promo state should never block the homepage.
    }
}

function isHomepageCoursePromoDismissed(state = {}, dismissDays = 7) {
    const dismissedAt = Number(state.dismissedAt || 0);
    if (!dismissedAt) return false;
    const durationMs = Math.max(1, Number(dismissDays) || 7) * 24 * 60 * 60 * 1000;
    return Date.now() - dismissedAt < durationMs;
}

function hasHomepageCoursePromoDailyCapacity(state = {}, maxImpressionsPerDay = 3) {
    const today = getTodayDateKey();
    if (state.impressionDate !== today) return true;
    return (Number(state.impressionsToday) || 0) < Math.max(1, Number(maxImpressionsPerDay) || 3);
}

async function markHomepageCoursePromoImpression(state = {}) {
    const today = getTodayDateKey();
    const nextState = {
        ...state,
        impressionDate: today,
        impressionsToday: state.impressionDate === today ? (Number(state.impressionsToday) || 0) + 1 : 1,
        lastImpressionAt: Date.now()
    };
    await writeHomepageCoursePromoState(nextState);
    return nextState;
}

function normalizeHomepageCoursePromoConfig(payload = {}) {
    const config = payload?.config && typeof payload.config === 'object' ? payload.config : payload;
    return {
        enabled: config?.enabled === true,
        imageUrl: String(config?.imageUrl || '').trim(),
        targetUrl: String(config?.targetUrl || '').trim(),
        title: String(config?.title || '').trim(),
        subtitle: String(config?.subtitle || '').trim(),
        ctaText: String(config?.ctaText || '').trim() || '查看课程',
        textAdEnabled: config?.textAdEnabled === true,
        textAdText: String(config?.textAdText || '').trim(),
        textAdUrl: String(config?.textAdUrl || '').trim(),
        targetLocales: Array.isArray(config?.targetLocales) ? config.targetLocales : ['zh_CN', 'zh_TW', 'zh'],
        dismissDays: Math.max(1, Math.min(365, Number(config?.dismissDays) || 7)),
        maxImpressionsPerDay: Math.max(1, Math.min(20, Number(config?.maxImpressionsPerDay) || 3))
    };
}

function getHomepageCoursePromoMessage(key, fallback = '') {
    try {
        return chrome.i18n.getMessage(key) || fallback;
    } catch (_) {
        return fallback;
    }
}

function hideHomepageCoursePromo() {
    const banner = document.getElementById('coursePromoBanner');
    if (banner) {
        banner.hidden = true;
        banner.innerHTML = '';
    }
    hideHomepageCoursePromoTextAd();
}

function hideHomepageCoursePromoTextAd() {
    const textAd = document.getElementById('coursePromoTextAd');
    if (!textAd) return;
    textAd.hidden = true;
    textAd.textContent = '';
    textAd.removeAttribute('aria-label');
    textAd.onclick = null;
}

function escapeHomepageCoursePromoAttr(value) {
    return String(value ?? '').replace(/[&<>"]/g, (char) => {
        switch (char) {
            case '&': return '&amp;';
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '"': return '&quot;';
            default: return char;
        }
    });
}

function renderHomepageCoursePromo(config, state) {
    const banner = document.getElementById('coursePromoBanner');
    if (!banner) return;

    const title = config.title || 'Codex 编程课';
    const subtitle = config.subtitle || '';
    const ctaText = config.ctaText || getHomepageCoursePromoMessage('coursePromoDefaultCta', '查看课程');
    const hasImage = isHttpsUrl(config.imageUrl);
    banner.classList.toggle('is-text-only', !hasImage);
    banner.innerHTML = `
        <div class="homepage-course-promo-inner">
            ${hasImage ? `<img class="homepage-course-promo-image" src="${escapeHomepageCoursePromoAttr(config.imageUrl)}" alt="${escapeHomepageCoursePromoAttr(title)}">` : ''}
            <div class="homepage-course-promo-body">
                <span class="homepage-course-promo-badge">${escapeHtml(getHomepageCoursePromoMessage('coursePromoBadge', '课程'))}</span>
                <div class="homepage-course-promo-title">${escapeHtml(title)}</div>
                ${subtitle ? `<div class="homepage-course-promo-subtitle">${escapeHtml(subtitle)}</div>` : ''}
                <div class="homepage-course-promo-actions">
                    <button type="button" class="homepage-course-promo-cta">${escapeHtml(ctaText)}</button>
                    <button type="button" class="homepage-course-promo-dismiss">${escapeHtml(getHomepageCoursePromoMessage('coursePromoDismissLater', '稍后再说'))}</button>
                </div>
            </div>
        </div>
    `;

    const openPromo = () => {
        trackEvent('course_promo_click', {
            surface: 'homepage',
            campaign: HOMEPAGE_COURSE_PROMO_CAMPAIGN,
            target: 'video_shop',
            kind: 'subscription'
        });
        chrome.tabs.create({ url: config.targetUrl });
    };

    const image = banner.querySelector('.homepage-course-promo-image');
    if (image) {
        image.addEventListener('error', () => {
            banner.classList.add('is-text-only');
            image.remove();
        }, { once: true });
        image.addEventListener('click', openPromo);
    }
    banner.querySelector('.homepage-course-promo-cta')?.addEventListener('click', openPromo);
    banner.querySelector('.homepage-course-promo-dismiss')?.addEventListener('click', async () => {
        const nextState = {
            ...state,
            dismissedAt: Date.now()
        };
        await writeHomepageCoursePromoState(nextState);
        trackEvent('course_promo_dismiss', {
            surface: 'homepage',
            campaign: HOMEPAGE_COURSE_PROMO_CAMPAIGN,
            target: 'video_shop',
            kind: 'subscription'
        });
        hideHomepageCoursePromo();
    });
    banner.hidden = false;
}

function renderHomepageCoursePromoTextAd(config) {
    const textAd = document.getElementById('coursePromoTextAd');
    if (!textAd) return false;
    if (!config.textAdEnabled || !config.textAdText || !isHttpsUrl(config.textAdUrl)) {
        hideHomepageCoursePromoTextAd();
        return false;
    }

    textAd.textContent = config.textAdText;
    textAd.title = config.textAdText;
    textAd.setAttribute('aria-label', config.textAdText);
    textAd.onclick = () => {
        trackEvent('course_promo_text_ad_click', {
            surface: 'homepage_search_bar',
            campaign: HOMEPAGE_COURSE_PROMO_CAMPAIGN,
            target: 'video_shop',
            kind: 'subscription'
        });
        chrome.tabs.create({ url: config.textAdUrl });
    };
    textAd.hidden = false;
    trackEvent('course_promo_text_ad_impression', {
        surface: 'homepage_search_bar',
        campaign: HOMEPAGE_COURSE_PROMO_CAMPAIGN,
        target: 'video_shop',
        kind: 'subscription'
    });
    return true;
}

async function initializeHomepageCoursePromo() {
    const banner = document.getElementById('coursePromoBanner');
    const textAd = document.getElementById('coursePromoTextAd');
    if (!banner && !textAd) return;
    hideHomepageCoursePromo();

    const endpoint = getHomepageCoursePromoEndpoint();
    if (!endpoint) return;

    try {
        const response = await fetch(endpoint, { cache: 'no-store' });
        if (!response.ok) return;
        const payload = await response.json();
        const config = normalizeHomepageCoursePromoConfig(payload);
        if (!homepageLocaleMatchesCoursePromo(config.targetLocales)) {
            return;
        }
        renderHomepageCoursePromoTextAd(config);

        if (config.enabled && isHttpsUrl(config.targetUrl) && (isHttpsUrl(config.imageUrl) || config.title)) {
            const state = await readHomepageCoursePromoState();
            if (isHomepageCoursePromoDismissed(state, config.dismissDays)) return;
            if (!hasHomepageCoursePromoDailyCapacity(state, config.maxImpressionsPerDay)) return;
            const nextState = await markHomepageCoursePromoImpression(state);
            renderHomepageCoursePromo(config, nextState);
            trackEvent('course_promo_impression', {
                surface: 'homepage',
                campaign: HOMEPAGE_COURSE_PROMO_CAMPAIGN,
                target: 'video_shop',
                kind: 'subscription'
            });
        }
    } catch (error) {
        hideHomepageCoursePromo();
    }
}

function openRemoteSearchSettingsPage() {
    const targetUrl = chrome.runtime.getURL('options/options.html#remote-search');
    window.location.href = targetUrl;
}

function getRemoteSearchHomepageStatusText(status) {
    switch (String(status || '').trim()) {
        case 'online':
            return t('remoteSearchStatusOnline', 'Online');
        case 'connecting':
            return t('remoteSearchStatusConnecting', 'Connecting');
        case 'offline':
            return t('remoteSearchStatusOffline', 'Offline');
        case 'error':
            return t('remoteSearchStatusError', 'Error');
        case 'disabled':
        default:
            return t('remoteSearchStatusDisabled', 'Disabled');
    }
}

async function sendRemoteSearchHomepageMessage(action, payload = {}) {
    const response = await chrome.runtime.sendMessage({
        action,
        ...payload
    });

    if (!response?.success) {
        throw new Error(response?.error || 'Remote Search request failed');
    }

    return response.result;
}

function renderRemoteSearchHomepageCard(state) {
    remoteSearchHomepageState = state || null;
    const card = document.getElementById('remoteSearchStatusCard');
    const badge = document.getElementById('remoteSearchHomeBadge');
    const description = document.getElementById('remoteSearchHomeDescription');
    if (card) {
        card.hidden = false;
    }
    if (!badge || !description) {
        return;
    }

    const status = String(state?.connectionStatus || 'disabled').trim() || 'disabled';
    badge.dataset.status = status;
    badge.textContent = getRemoteSearchHomepageStatusText(status);

    if (state?.pairRecord?.phoneName) {
        description.textContent = interpolateMessage(
            t('remoteSearchHomepagePairedDescription', `Paired with ${state.pairRecord.phoneName}.`),
            [state.pairRecord.phoneName]
        );
        return;
    }

    if (state?.settings?.enabled === true) {
        description.textContent = t(
            'remoteSearchHomepageDescriptionEnabled',
            'Remote search is ready for pairing from the settings page.'
        );
        return;
    }

    description.textContent = t(
        'remoteSearchHomepageDescription',
        'Pair one phone to this Chrome session and launch compare searches remotely.'
    );
}

async function initializeRemoteSearchHomepageCard() {
    const openButton = document.getElementById('remoteSearchOpenSettingsBtn');
    if (openButton && openButton.dataset.bound !== 'true') {
        openButton.dataset.bound = 'true';
        openButton.addEventListener('click', () => {
            trackEvent('homepage_remote_search_open_settings');
            openRemoteSearchSettingsPage();
        });
    }

    if (!remoteSearchHomepageListenerBound) {
        chrome.runtime.onMessage.addListener((message) => {
            if (message?.type !== 'remoteStateChanged' || !message.state) {
                return;
            }
            renderRemoteSearchHomepageCard(message.state);
        });
        remoteSearchHomepageListenerBound = true;
    }

    const state = await sendRemoteSearchHomepageMessage('remoteGetState');
    renderRemoteSearchHomepageCard(state);
}

function updateCustomSitesEmptyState(isEmpty) {
    const customSitesSection = document.querySelector('.custom-sites-section');

    if (customSitesSection) {
        customSitesSection.hidden = isEmpty;
    }
}

function getSiteGroup(site) {
    const rawGroup = String(site?.type || site?.category || 'other').trim().toLowerCase();
    if (!rawGroup) {
        return 'other';
    }
    if (rawGroup === 'chat' || rawGroup === 'information') {
        return 'information';
    }
    if (rawGroup === 'translation' || rawGroup === 'translate') {
        return 'translate';
    }
    return rawGroup;
}

function getSiteGroupLabel(groupKey) {
    const normalizedGroup = String(groupKey || '').trim().toLowerCase();
    if (SITE_GROUP_LABELS[normalizedGroup]) {
        return t(SITE_GROUP_LABELS[normalizedGroup], normalizedGroup);
    }
    if (!normalizedGroup) {
        return 'Other';
    }
    return normalizedGroup.charAt(0).toUpperCase() + normalizedGroup.slice(1);
}

function getHomepagePromptTemplateType() {
    return window.PromptTemplateUtils?.normalizePromptTemplateType?.(
        homepageSitesState.activeGroup,
        DEFAULT_SITE_GROUP,
        homepageSitesState.configuredGroups
    )
        || DEFAULT_SITE_GROUP;
}

async function ensureHomepagePromptTemplates() {
    if (ensureHomepagePromptTemplatesPromise) {
        return ensureHomepagePromptTemplatesPromise;
    }

    ensureHomepagePromptTemplatesPromise = chrome.runtime.sendMessage({
        action: 'initializeDefaultTemplates'
    }).catch(error => {
        console.warn('首页补齐默认提示词模板失败:', error);
    });

    return ensureHomepagePromptTemplatesPromise;
}

function getHomepageSiteIndicatorIcon(site) {
    return window.HomepageSiteIndicatorUtils?.getHomepageSiteIndicatorIcon?.(site) || null;
}

function getHomepageSiteIconPath(site) {
    return window.HomepageSiteIndicatorUtils?.getHomepageSiteIconPath?.(site) || '../icons/icon16.png';
}

function getHomepageSiteIconFallbackPath() {
    return window.HomepageSiteIndicatorUtils?.getHomepageSiteIconFallbackPath?.() || '../icons/icon16.png';
}

function createHomepageSiteAvatar(site) {
    const avatar = document.createElement('img');
    avatar.className = 'site-avatar';
    avatar.src = getHomepageSiteIconPath(site);
    avatar.alt = '';
    avatar.loading = 'lazy';
    avatar.draggable = false;
    avatar.setAttribute('aria-hidden', 'true');
    avatar.addEventListener('error', () => {
        if (!avatar.dataset.fallbackApplied) {
            avatar.dataset.fallbackApplied = '1';
            avatar.src = getHomepageSiteIconFallbackPath();
        }
    });
    return avatar;
}

function getAvailableSiteGroups(sites) {
    const configuredGroups = Array.isArray(homepageSitesState.configuredGroups) && homepageSitesState.configuredGroups.length > 0
        ? homepageSitesState.configuredGroups
        : [DEFAULT_SITE_GROUP];
    const siteGroups = new Set((sites || []).map(site => getSiteGroup(site)).filter(Boolean));
    const visibleConfiguredGroups = configuredGroups.filter(group => siteGroups.has(group));
    return visibleConfiguredGroups.length > 0 ? visibleConfiguredGroups : configuredGroups;
}

function getFilteredSites() {
    if (!homepageSitesState.activeGroup) {
        return homepageSitesState.supportedSites;
    }
    return homepageSitesState.supportedSites.filter(
        site => getSiteGroup(site) === homepageSitesState.activeGroup
    );
}

function renderSiteTypeTabs() {
    const tabsContainer = document.getElementById('siteTypeTabs');
    if (!tabsContainer) {
        return;
    }

    const availableGroups = getAvailableSiteGroups(homepageSitesState.supportedSites);
    if (!availableGroups.includes(homepageSitesState.activeGroup)) {
        homepageSitesState.activeGroup = availableGroups.includes(DEFAULT_SITE_GROUP)
            ? DEFAULT_SITE_GROUP
            : (availableGroups[0] || '');
    }

    tabsContainer.innerHTML = '';

    const fragment = document.createDocumentFragment();
    availableGroups.forEach(groupKey => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'site-type-tab';
        button.textContent = getSiteGroupLabel(groupKey);
        button.dataset.group = groupKey;
        button.setAttribute('role', 'tab');
        button.setAttribute('aria-selected', String(groupKey === homepageSitesState.activeGroup));
        button.classList.toggle('active', groupKey === homepageSitesState.activeGroup);
        button.addEventListener('click', () => {
            if (homepageSitesState.activeGroup === groupKey) {
                return;
            }
            homepageSitesState.activeGroup = groupKey;
            renderSiteTypeTabs();
            renderSitesList();
            updateAgentsSectionVisibility();
        });
        fragment.appendChild(button);
    });

    tabsContainer.appendChild(fragment);
}

function renderSitesList() {
    const sitesList = document.getElementById('sitesList');
    if (!sitesList) {
        return;
    }

    const filteredSites = getFilteredSites();
    sitesList.innerHTML = '';

    if (filteredSites.length === 0) {
        sitesList.innerHTML = `<div class="site-list-empty">${t('siteListEmpty', 'No sites in this type yet')}</div>`;
        return;
    }

    const fragment = document.createDocumentFragment();

    filteredSites.forEach(site => {
        const div = document.createElement('div');
        div.className = 'site-item';
        div.draggable = true;
        div.dataset.siteName = site.name;

        const dragHandle = document.createElement('span');
        dragHandle.className = 'site-drag-handle';
        dragHandle.setAttribute('aria-hidden', 'true');

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'site-checkbox';
        checkbox.id = `site-${site.name}`;
        checkbox.checked = homepageSitesState.selectedSites.get(site.name) === true;

        checkbox.addEventListener('change', () => {
            homepageSitesState.selectedSites.set(site.name, checkbox.checked);
            trackEvent('homepage_site_toggle', {
                site_name: site.name,
                enabled: checkbox.checked
            });
        });

        const nameLabel = document.createElement('label');
        nameLabel.textContent = site.name;
        nameLabel.htmlFor = `site-${site.name}`;

        const avatar = createHomepageSiteAvatar(site);

        const siteIndicatorIcon = getHomepageSiteIndicatorIcon(site);
        let indicator = null;
        if (siteIndicatorIcon) {
            indicator = document.createElement('img');
            indicator.className = 'site-support-indicator';
            indicator.src = siteIndicatorIcon;
            indicator.alt = '';
            indicator.setAttribute('aria-hidden', 'true');
            indicator.draggable = false;
        }

        div.addEventListener('click', (e) => {
            if (sitesList.classList.contains('drag-active')) {
                return;
            }
            if (
                e.target !== checkbox
                && e.target !== nameLabel
                && e.target !== dragHandle
                && e.target !== indicator
            ) {
                checkbox.click();
            }
        });

        div.appendChild(dragHandle);
        div.appendChild(checkbox);
        div.appendChild(avatar);
        div.appendChild(nameLabel);
        if (indicator) {
            div.appendChild(indicator);
        }
        fragment.appendChild(div);
    });

    sitesList.appendChild(fragment);
}

function getSelectedCustomSiteIds() {
    return (homepageSitesState.customSites || [])
        .filter(site => homepageSitesState.selectedCustomSites.get(site.id) === true)
        .map(site => site.id);
}

function getSelectedAgentIds() {
    return (homepageSitesState.agentCatalog?.agents || [])
        .filter(agent => homepageSitesState.selectedAgents.get(agent.id) === true)
        .map(agent => agent.id);
}

function getFilteredAgents() {
    return homepageSitesState.agentCatalog?.agents || [];
}

function updateAgentsSectionVisibility() {
    const agentsSection = document.getElementById('agentsSection');
    if (!agentsSection) {
        return;
    }

    const hasVisibleAgents = (homepageSitesState.agentCatalog?.agents || []).length > 0;
    agentsSection.hidden = !hasVisibleAgents;
}

function refreshHomepageAgentNameTooltipEligibility() {
    const agentsList = document.getElementById('agentsList');
    if (!agentsList) {
        return;
    }

    agentsList.querySelectorAll('.agent-name-label').forEach((label) => {
        if (!(label instanceof HTMLElement)) {
            return;
        }
        const fullName = String(label.dataset.agentName || label.textContent || '').trim();
        const isTruncated = label.scrollWidth > label.clientWidth + 1;
        if (isTruncated && fullName) {
            label.setAttribute('data-url', fullName);
            label.setAttribute('aria-label', fullName);
        } else {
            label.removeAttribute('data-url');
            if (label.getAttribute('aria-label') === fullName) {
                label.removeAttribute('aria-label');
            }
        }
        label.removeAttribute('title');
        label.removeAttribute('data-original-title');
    });
}

function bindHomepageAgentNameTooltip() {
    const agentsList = document.getElementById('agentsList');
    const tooltipApi = window.SiteUrlTooltip;
    if (!agentsList || typeof tooltipApi?.attachUrlTooltip !== 'function') {
        return;
    }

    if (homepageAgentNameTooltipController?.destroy) {
        homepageAgentNameTooltipController.destroy();
    }

    homepageAgentNameTooltipController = tooltipApi.attachUrlTooltip(agentsList, {
        selector: '.agent-name-label[data-url]',
        tooltipId: 'homepageAgentNameTooltip',
        showDelay: 80
    });

    refreshHomepageAgentNameTooltipEligibility();
}

function renderAgentsList() {
    const agentsList = document.getElementById('agentsList');
    if (!agentsList) {
        return;
    }

    const agents = getFilteredAgents();
    agentsList.innerHTML = '';

    if (!agents.length) {
        agentsList.innerHTML = `<div class="site-list-empty">${t('siteListEmpty', 'No sites in this type yet')}</div>`;
        return;
    }

    const fragment = document.createDocumentFragment();

    agents.forEach((agent) => {
        const item = document.createElement('div');
        item.className = 'site-item agent-item';
        item.dataset.agentId = agent.id;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'site-checkbox';
        checkbox.id = `agent-${agent.id}`;
        checkbox.checked = homepageSitesState.selectedAgents.get(agent.id) === true;
        checkbox.addEventListener('change', () => {
            homepageSitesState.selectedAgents.set(agent.id, checkbox.checked);
            trackEvent('homepage_agent_toggle', {
                agent_id: agent.id,
                enabled: checkbox.checked
            });
        });

        const body = document.createElement('div');
        body.className = 'agent-item-body';

        const head = document.createElement('div');
        head.className = 'agent-item-head';

        const label = document.createElement('label');
        label.htmlFor = `agent-${agent.id}`;
        label.textContent = agent.name;
        label.className = 'agent-name-label';
        label.dataset.agentName = agent.name || '';

        const description = document.createElement('div');
        description.className = 'agent-description';
        description.textContent = agent.description || '';

        head.appendChild(label);
        body.appendChild(head);
        if (description.textContent) {
            body.appendChild(description);
        }

        item.appendChild(checkbox);
        item.appendChild(body);

        item.addEventListener('click', (event) => {
            if (event.target === checkbox || event.target === label) {
                return;
            }
            checkbox.click();
        });

        fragment.appendChild(item);
    });

    agentsList.appendChild(fragment);
    refreshHomepageAgentNameTooltipEligibility();
}

function updateHomepageAgentSelection(checked) {
    (homepageSitesState.agentCatalog?.agents || []).forEach((agent) => {
        homepageSitesState.selectedAgents.set(agent.id, checked);
    });
    renderAgentsList();
}

function initializeAgentSelectionActions() {
    const selectAllButton = document.getElementById('selectAllAgentsBtn');
    const clearAllButton = document.getElementById('clearAllAgentsBtn');

    if (selectAllButton) {
        selectAllButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            updateHomepageAgentSelection(true);
            trackEvent('homepage_agents_select_all');
        });
    }

    if (clearAllButton) {
        clearAllButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            updateHomepageAgentSelection(false);
            trackEvent('homepage_agents_clear_all');
        });
    }
}

async function initializeAgentsList() {
    try {
        const [syncData, localStorageData] = await Promise.all([
            chrome.storage.sync.get([AGENT_CUSTOM_SETTINGS_STORAGE_KEY, CUSTOM_AGENTS_STORAGE_KEY]),
            chrome.storage.local.get([AGENT_HIDDEN_IDS_STORAGE_KEY, CUSTOM_AGENTS_STORAGE_KEY])
        ]);
        const agentCatalogUtils = window.AICompareAgentCatalog || null;
        const runtimeLocale = window.RuntimeI18n?.getCurrentLocale?.()
            || agentCatalogUtils?.getRuntimeLocale?.('')
            || '';
        const normalizedSettings = typeof agentCatalogUtils?.normalizeAgentCustomSettingsMap === 'function'
            ? agentCatalogUtils.normalizeAgentCustomSettingsMap(syncData?.[AGENT_CUSTOM_SETTINGS_STORAGE_KEY])
            : (syncData?.[AGENT_CUSTOM_SETTINGS_STORAGE_KEY] && typeof syncData[AGENT_CUSTOM_SETTINGS_STORAGE_KEY] === 'object'
                ? syncData[AGENT_CUSTOM_SETTINGS_STORAGE_KEY]
                : {});
        const normalizedCustomAgents = typeof agentCatalogUtils?.migrateLegacyCustomAgentsStorage === 'function'
            ? agentCatalogUtils.migrateLegacyCustomAgentsStorage(syncData?.[CUSTOM_AGENTS_STORAGE_KEY], localStorageData?.[CUSTOM_AGENTS_STORAGE_KEY])
            : (Array.isArray(localStorageData?.[CUSTOM_AGENTS_STORAGE_KEY]) && localStorageData[CUSTOM_AGENTS_STORAGE_KEY].length > 0
                ? localStorageData[CUSTOM_AGENTS_STORAGE_KEY]
                : (Array.isArray(syncData?.[CUSTOM_AGENTS_STORAGE_KEY]) ? syncData[CUSTOM_AGENTS_STORAGE_KEY] : []));
        const hiddenAgentIds = typeof window.AICompareAgentCatalog?.normalizeAgentHiddenIds === 'function'
            ? window.AICompareAgentCatalog.normalizeAgentHiddenIds(localStorageData?.[AGENT_HIDDEN_IDS_STORAGE_KEY])
            : (Array.isArray(localStorageData?.[AGENT_HIDDEN_IDS_STORAGE_KEY]) ? localStorageData[AGENT_HIDDEN_IDS_STORAGE_KEY].filter(Boolean) : []);
        const hiddenAgentIdSet = new Set(hiddenAgentIds.map(id => String(id || '').trim()).filter(Boolean));
        const catalog = typeof agentCatalogUtils?.buildCatalogWithCustomSettings === 'function'
            ? agentCatalogUtils.buildCatalogWithCustomSettings(normalizedSettings, normalizedCustomAgents, runtimeLocale)
            : (typeof agentCatalogUtils?.getCatalog === 'function'
                ? agentCatalogUtils.getCatalog(runtimeLocale)
                : { categories: [], agents: [] });
        homepageSitesState.agentCatalog = {
            categories: Array.isArray(catalog?.categories) ? catalog.categories : [],
            agents: Array.isArray(catalog?.agents)
                ? catalog.agents.filter(agent =>
                    agent
                    && !hiddenAgentIdSet.has(String(agent.id || '').trim())
                )
                : []
        };
        const previousSelectedAgents = homepageSitesState.selectedAgents instanceof Map
            ? homepageSitesState.selectedAgents
            : new Map();
        homepageSitesState.selectedAgents = new Map(
            (homepageSitesState.agentCatalog.agents || []).map(agent => [
                agent.id,
                previousSelectedAgents.has(agent.id)
                    ? previousSelectedAgents.get(agent.id)
                    : (agent.enabled === true)
            ])
        );
        updateAgentsSectionVisibility();
        renderAgentsList();
    } catch (error) {
        console.error('加载智能体列表失败:', error);
    }
}

function renderCustomSitesList() {
    const customSitesList = document.getElementById('customSitesList');
    if (!customSitesList) {
        return;
    }

    const customSites = homepageSitesState.customSites || [];
    customSitesList.innerHTML = '';

    if (customSites.length === 0) {
        updateCustomSitesEmptyState(true);
        return;
    }

    updateCustomSitesEmptyState(false);

    const fragment = document.createDocumentFragment();
    customSites.forEach(site => {
        const div = document.createElement('div');
        div.className = 'site-item custom-site-item';
        div.dataset.siteId = site.id;
        div.title = site.note || site.url || '';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'site-checkbox';
        checkbox.id = `custom-site-${site.id}`;
        checkbox.checked = homepageSitesState.selectedCustomSites.get(site.id) === true;

        checkbox.addEventListener('change', () => {
            homepageSitesState.selectedCustomSites.set(site.id, checkbox.checked);
            trackEvent('homepage_custom_site_toggle', {
                site_name: site.name,
                enabled: checkbox.checked
            });
        });

        const nameLabel = document.createElement('label');
        nameLabel.textContent = site.name;
        nameLabel.htmlFor = `custom-site-${site.id}`;

        const avatar = createHomepageSiteAvatar(site);

        div.addEventListener('click', (e) => {
            if (e.target === checkbox || e.target === nameLabel) {
                return;
            }
            checkbox.click();
        });

        div.appendChild(checkbox);
        div.appendChild(avatar);
        div.appendChild(nameLabel);
        fragment.appendChild(div);
    });

    customSitesList.appendChild(fragment);
}

async function initializeCustomSitesList() {
    const customSitesList = document.getElementById('customSitesList');
    if (!customSitesList) {
        return;
    }

    try {
        const customSites = await window.getCustomSites?.() || [];
        homepageSitesState.customSites = sortSitesFavoriteFirst(customSites);
        homepageSitesState.selectedCustomSites = new Map(
            homepageSitesState.customSites.map(site => [site.id, site.enabled === true])
        );
        renderCustomSitesList();
        customSitesList.classList.remove('sites-list-skeleton');
        customSitesList.removeAttribute('aria-busy');
    } catch (error) {
        console.error('获取 customSites 失败:', error);
        updateCustomSitesEmptyState(false);
        customSitesList.innerHTML = `<div style="padding: 20px; color: #666; text-align: center;">${t('customSiteListLoadFailed', 'Failed to load custom sites. Please refresh and try again.')}</div>`;
        customSitesList.classList.remove('sites-list-skeleton');
        customSitesList.removeAttribute('aria-busy');
    }
}

// 页面加载完成后的初始化
document.addEventListener('DOMContentLoaded', async function() {
    if (window.RuntimeI18n?.initializeRuntimeI18n) {
        await window.RuntimeI18n.initializeRuntimeI18n();
    }

    perfMark('dom_content_loaded');
    perfMeasure('script_to_dom_content_loaded_duration', 'script_eval_start', 'dom_content_loaded');
    perfMark('dom_init_start');

    // 初始化自动调整高度的输入框
    const searchInput = document.getElementById('searchInput');
    perfMark('search_input_setup_start');
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
            mirror.style.width = searchInput.clientWidth + 'px';
            mirror.textContent = 'A';
            const singleLineHeight = Math.ceil(mirror.scrollHeight);
            const minHeight = Math.max(minHeightFallback, singleLineHeight);
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
            setTimeout(autoResizeTextarea, 10);
        });
        
        // 监听聚焦事件（仅在需要时扩展高度）
        searchInput.addEventListener('focus', autoResizeTextarea);

        // 监听失焦事件，保留有内容时的高度，空输入时恢复默认高度
        searchInput.addEventListener('blur', () => {
            autoResizeTextarea();
            if (!searchInput.value) {
                searchInput.scrollTop = 0;
            }
        });
        
        // 初始调整
        autoResizeTextarea();
    }
    perfMark('search_input_setup_end');
    perfMeasure('search_input_setup_duration', 'search_input_setup_start', 'search_input_setup_end');
    
    // 检查 URL 参数，判断是否有预填充的查询和是否在侧边栏中
    const urlParams = new URLSearchParams(window.location.search);
    const isSidePanel = urlParams.get('side_panel') === 'true';
    if (isSidePanel) {
        document.body.classList.add('is-side-panel');
    }
    void trackEventOnce('app_first_open', 'app_first_open', {
        surface: 'homepage',
        side_panel: isSidePanel
    });
    const hasQueryParam = urlParams.has('query');

    // 输入框固定在底部
    applyHomepageInputPosition();
    
    // 延迟设置焦点，防止页面自动滚动
    // 使用 setTimeout 确保页面完全加载后再聚焦
    if (searchInput) {
        setTimeout(() => {
            if (isSidePanel) {
                // 在侧边栏中：更积极的防止滚动
                // 1. 立即滚动到顶部
                window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
                document.documentElement.scrollTop = 0;
                document.body.scrollTop = 0;
                
                // 2. 等待一下，确保滚动完成
                setTimeout(() => {
                    // 3. 再次确保在顶部
                    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
                    // 4. 使用 preventScroll 设置焦点
                    searchInput.focus({ preventScroll: true });
                    
                    // 5. 设置焦点后再次确保滚动位置
                    setTimeout(() => {
                        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
                        document.documentElement.scrollTop = 0;
                        document.body.scrollTop = 0;
                    }, 50);
                }, 50);
            } else {
                // 在新标签页中：正常处理
                window.scrollTo(0, 0);
                searchInput.focus({ preventScroll: true });
            }
        }, isSidePanel ? 200 : 100); // 侧边栏需要更长的延迟
    }
    
    if (hasQueryParam) {
        // 从 URL 参数中获取查询内容并填入搜索框
        const query = urlParams.get('query');
        if (query && query !== 'true') {
            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                searchInput.value = query;
                // 触发自动调整高度
                searchInput.dispatchEvent(new Event('input'));
            }
        }
    }
    
    // 初始化国际化
    perfMark('i18n_init_start');
    initializeI18n();
    perfMark('i18n_init_end');
    perfMeasure('i18n_init_duration', 'i18n_init_start', 'i18n_init_end');
    void initializeHomepagePkStarterQuery();
    void initializeHomepageMembershipBanner();

    // 初始化保存按钮，避免被异步站点列表初始化阻塞
    perfMark('save_button_init_start');
    initializeSaveSitesButton();
    perfMark('save_button_init_end');
    perfMeasure('save_button_init_duration', 'save_button_init_start', 'save_button_init_end');

    initializeAgentSelectionActions();
    initializeBatchModeModal();

    bindHomepageAgentNameTooltip();
    window.addEventListener('resize', refreshHomepageAgentNameTooltipEligibility);
    
    // 非关键初始化并行执行，减少首屏等待
    perfMark('non_critical_init_start');
    void Promise.allSettled([
        measureAsyncStep('agent_catalog_ready_init', () => ensureHomepageAgentCatalogReady()),
        measureAsyncStep('pin_guide_init', () => checkAndShowPinGuide()),
        measureAsyncStep('query_suggestions_init', () => initializeQuerySuggestions()),
        measureAsyncStep('sites_list_init', () => initializeSitesList()),
        measureAsyncStep('agents_list_init', () => initializeAgentsList()),
        measureAsyncStep('custom_sites_init', () => initializeCustomSitesList()),
        measureAsyncStep('remote_search_card_init', () => initializeRemoteSearchHomepageCard()),
        measureAsyncStep('course_promo_init', () => initializeHomepageCoursePromo())
    ]).finally(() => {
        perfMark('non_critical_init_end');
        perfMeasure('non_critical_init_duration', 'non_critical_init_start', 'non_critical_init_end');
        cacheHomepagePerfMeasures('non_critical_init_settled');
    });
    
    // 侧边栏导航由 shared/sidebar.js 统一初始化

    // 页面加载时，若已登录则自动同步一次
    void measureAsyncStep('auto_sync', async () => {
        try {
            // WebDAV: 首页每次打开时都尝试拉取一次（静默失败）
            try {
                await chrome.runtime.sendMessage({ action: 'webdavAutoDownload' });
            } catch (_) {}
            try {
                await chrome.runtime.sendMessage({ action: 'googleDriveAutoDownload' });
            } catch (_) {}
        } catch (e) {
            console.warn('Homepage auto sync failed', e);
        } finally {
            cacheHomepagePerfMeasures('auto_sync_finished');
        }
    });

    perfMark('dom_init_end');
    perfMeasure('dom_init_duration', 'dom_init_start', 'dom_init_end');
    perfMeasure('script_eval_to_dom_init_end_duration', 'script_eval_start', 'dom_init_end');
    cacheHomepagePerfMeasures('dom_init_finished');
});

// 输入框固定在底部
function applyHomepageInputPosition() {
    document.body.classList.add('search-bar-bottom');
}

// 初始化国际化
function initializeI18n() {
    // 处理所有带有 data-i18n 属性的元素
    document.querySelectorAll('[data-i18n]').forEach(element => {
        const key = element.getAttribute('data-i18n');
        const message = t(key);
        if (message) {
            if ((element.tagName.toLowerCase() === 'input' && 
                element.type === 'text') || 
                element.tagName.toLowerCase() === 'textarea') {
                // 对于输入框和文本域，设置 placeholder
                element.placeholder = message;
            } else if (element.tagName.toLowerCase() === 'img') {
                // 对于图片，设置 alt
                element.alt = message;
            } else {
                // 对于其他元素，设置文本内容
                element.textContent = message;
            }
        }
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
        const key = element.getAttribute('data-i18n-placeholder');
        const message = t(key);
        if (message) {
            element.placeholder = message;
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
    
    // 处理 data-i18n-alt：设置 img 的 alt 属性（若未在 data-i18n 中处理）
    document.querySelectorAll('[data-i18n-alt]').forEach(element => {
        const key = element.getAttribute('data-i18n-alt');
        const message = t(key);
        if (message) {
            element.alt = message;
        }
    });

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

    refreshHomepageDynamicI18n();
}

// 初始化查询建议
async function initializeQuerySuggestions() {
    const searchInput = document.getElementById('searchInput');
    if (!searchInput) return;
    
    // 添加输入监听器，当searchInput有内容时显示建议
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        showQuerySuggestions(query);
    });
    
    // 添加焦点事件监听器
    searchInput.addEventListener('focus', (e) => {
        const query = e.target.value.trim();
        showQuerySuggestions(query);
    });
    
    // 失焦时隐藏建议
    searchInput.addEventListener('blur', () => {
        setTimeout(() => {
            const querySuggestions = document.getElementById('querySuggestions');
            if (querySuggestions) {
                querySuggestions.style.display = 'none';
            }
        }, 200);
    });
}

// 显示查询建议
async function showQuerySuggestions(query) {
    const querySuggestions = document.getElementById('querySuggestions');

    try {
        await ensureHomepagePromptTemplates();
        // 从存储中获取提示词模板
        const { promptTemplates = [] } = await chrome.storage.sync.get('promptTemplates');
        const currentType = getHomepagePromptTemplateType();
        const recommendedQueries = window.PromptTemplateUtils?.buildPromptTemplateSuggestions
            ? window.PromptTemplateUtils.buildPromptTemplateSuggestions(
                promptTemplates,
                query,
                currentType,
                homepageSitesState.configuredGroups
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
            suggestionItem.addEventListener('click', () => {
                document.getElementById('searchInput').value = recommendedQuery.query;
                querySuggestions.style.display = 'none';
                // 触发自动调整高度
                document.getElementById('searchInput').dispatchEvent(new Event('input'));
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

        // 点击后在新标签页打开设置页面并跳转到模板编辑区域
        settingsIcon.addEventListener('click', (e) => {
            e.stopPropagation();
            // 埋点：从首页提示词建议区域打开模板设置
            trackEvent('homepage_prompt_templates_settings_click');
            window.open(chrome.runtime.getURL('options/options.html#prompt-templates'), '_blank');
        });

        // 将设置图标添加到 querySuggestions 区域
        querySuggestions.appendChild(settingsIcon);

        // 显示建议
        querySuggestions.style.display = 'flex';
        
    } catch (error) {
        console.error('加载提示词模板失败:', error);
        querySuggestions.style.display = 'none';
    }
}

// 检查并显示 pin 引导提示（仅首次安装时）
async function checkAndShowPinGuide() {
    try {
        // 检查是否已经显示过引导
        perfMark('pin_guide_storage_get_start');
        const { pinGuideShown } = await chrome.storage.local.get(['pinGuideShown']);
        perfMark('pin_guide_storage_get_end');
        perfMeasure('pin_guide_storage_get_duration', 'pin_guide_storage_get_start', 'pin_guide_storage_get_end');
        
        // 如果已经显示过，不显示
        if (pinGuideShown === true) {
            return;
        }
        
        // 如果是首次安装（pinGuideShown 为 false 或 undefined），显示引导
        showPinGuide();
    } catch (error) {
        console.error('检查 pin 引导失败:', error);
    }
}

// 显示 pin 引导提示
function showPinGuide() {
    const pinGuideBanner = document.getElementById('pinGuideBanner');
    if (!pinGuideBanner) {
        return;
    }
    
    pinGuideBanner.style.display = 'block';
    
    // 设置 pin 图片路径
    const pinGuideImage = document.getElementById('pinGuideImage');
    if (pinGuideImage) {
        pinGuideImage.src = chrome.runtime.getURL('icons/pin.png');
    }
    
    // 绑定关闭按钮事件
    const closeButton = document.getElementById('pinGuideClose');
    if (closeButton) {
        closeButton.addEventListener('click', async () => {
            pinGuideBanner.style.display = 'none';
            // 标记为已显示，以后不再显示
            await chrome.storage.local.set({ pinGuideShown: true });
        });
    }
}

function normalizeHomepageQuery(query) {
    return String(query || '').replace(/^ai\s+/i, '').trim();
}

function getHomepageSelectionContext() {
    const selectedSites = getSelectedSites();
    const selectedCustomSiteIds = getSelectedCustomSiteIds();
    const selectedAgentIds = getSelectedAgentIds();
    const selectedSiteConfigs = homepageSitesState.supportedSites.filter(site =>
        selectedSites.includes(site.name)
    );
    const selectedCustomSiteConfigs = (homepageSitesState.customSites || []).filter(site =>
        selectedCustomSiteIds.includes(site.id)
    );
    const iframeSiteNames = selectedSiteConfigs
        .filter(site => site.supportIframe === true)
        .map(site => site.name)
        .filter(Boolean);
    const externalSiteNames = selectedSiteConfigs
        .filter(site => site.supportIframe !== true)
        .map(site => site.name)
        .filter(Boolean);
    const customIframeSiteIds = selectedCustomSiteConfigs
        .filter(site => site.supportIframe === true)
        .map(site => site.id)
        .filter(Boolean);
    const customExternalSiteIds = selectedCustomSiteConfigs
        .filter(site => site.supportIframe !== true)
        .map(site => site.id)
        .filter(Boolean);
    const urlParams = new URLSearchParams(window.location.search);
    const isSidePanel = urlParams.get('side_panel') === 'true';

    return {
        selectedSites,
        selectedCustomSiteIds,
        selectedAgentIds,
        iframeSiteNames,
        externalSiteNames,
        customIframeSiteIds,
        customExternalSiteIds,
        isSidePanel,
        hasAnySelectedPanels: selectedSites.length > 0 || selectedCustomSiteIds.length > 0 || selectedAgentIds.length > 0,
        hasRunnableIframePanels: iframeSiteNames.length > 0 || customIframeSiteIds.length > 0 || selectedAgentIds.length > 0
    };
}

function buildHomepageIframeSearchUrl(query, options = {}) {
    const {
        selectionContext = getHomepageSelectionContext(),
        includeSidePanelParam = true
    } = options;
    const params = new URLSearchParams();
    const processedQuery = normalizeHomepageQuery(query);

    if (processedQuery) {
        params.set('query', processedQuery);
    }
    if (selectionContext.iframeSiteNames.length > 0) {
        params.set('sites', selectionContext.iframeSiteNames.join(','));
    }
    if (selectionContext.customIframeSiteIds.length > 0) {
        params.set('customSites', selectionContext.customIframeSiteIds.join(','));
    }
    if (selectionContext.selectedAgentIds.length > 0) {
        params.set('agents', selectionContext.selectedAgentIds.join(','));
    }
    if (homepageSitesState.activeGroup) {
        params.set('type', homepageSitesState.activeGroup);
    }
    if (includeSidePanelParam && selectionContext.isSidePanel) {
        params.set('side_panel', 'true');
    }

    let searchUrl = chrome.runtime.getURL('iframe/iframe.html');
    if (params.toString()) {
        searchUrl += '?' + params.toString();
    }
    return searchUrl;
}

function getBatchModeElements() {
    return {
        modal: document.getElementById('batchModeModal'),
        backdrop: document.getElementById('batchModeBackdrop'),
        editorHost: document.getElementById('batchModeEditor'),
        favoritesList: document.getElementById('batchModeFavoritesList'),
        saveFavoriteButton: document.getElementById('batchModeSaveFavoriteButton'),
        openButton: document.getElementById('batchModeButton'),
        cancelButton: document.getElementById('batchModeCancelButton'),
        submitButton: document.getElementById('batchModeSubmitButton'),
        nameModal: document.getElementById('batchModeFavoriteNameModal'),
        nameBackdrop: document.getElementById('batchModeFavoriteNameBackdrop'),
        nameInput: document.getElementById('batchModeFavoriteNameInput'),
        nameCancelButton: document.getElementById('batchModeFavoriteNameCancelButton'),
        nameConfirmButton: document.getElementById('batchModeFavoriteNameConfirmButton')
    };
}

function getBatchModeEditorValue() {
    return homepageBatchModeEditor?.getValue?.() || '';
}

function setBatchModeEditorValue(value, cursorToEnd = false) {
    if (!homepageBatchModeEditor?.session) {
        return;
    }
    homepageBatchModeEditor.session.setValue(String(value || ''));
    if (cursorToEnd) {
        homepageBatchModeEditor.navigateFileEnd();
    }
}

function refreshBatchModeEditorI18n() {
    const { editorHost } = getBatchModeElements();
    const placeholder = t(
        'homepageBatchTextareaPlaceholder',
        'Enter one prompt per line and run them line by line'
    );

    if (editorHost) {
        editorHost.setAttribute('aria-label', placeholder);
    }

    if (homepageBatchModeEditor) {
        homepageBatchModeEditor.setOption('placeholder', placeholder);
    }
}

function refreshBatchModeFavoriteNameI18n() {
    const { nameInput } = getBatchModeElements();
    if (nameInput) {
        nameInput.placeholder = t(
            'homepageBatchFavoriteNamePlaceholder',
            'Enter a name for this batch'
        );
    }
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function createBatchFavoriteId() {
    return `batch_fav_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeHomepageBatchFavorites(list = []) {
    return (Array.isArray(list) ? list : [])
        .map((item) => {
            const id = String(item?.id || '').trim() || createBatchFavoriteId();
            const name = String(item?.name || '').trim();
            const prompts = String(item?.prompts || '').replace(/\r\n?/g, '\n').trim();
            const updatedAt = Number(item?.updatedAt) || Date.now();
            if (!name || !prompts) {
                return null;
            }
            return {
                id,
                name,
                prompts,
                updatedAt
            };
        })
        .filter(Boolean)
        .sort((left, right) => right.updatedAt - left.updatedAt);
}

async function loadHomepageBatchFavorites() {
    try {
        const stored = await chrome.storage.sync.get(HOMEPAGE_BATCH_FAVORITES_STORAGE_KEY);
        homepageBatchFavorites = normalizeHomepageBatchFavorites(stored[HOMEPAGE_BATCH_FAVORITES_STORAGE_KEY]);
        renderBatchModeFavorites();
    } catch (error) {
        console.error('Failed to load homepage batch favorites:', error);
    }
}

async function persistHomepageBatchFavorites() {
    await chrome.storage.sync.set({
        [HOMEPAGE_BATCH_FAVORITES_STORAGE_KEY]: homepageBatchFavorites
    });
}

function renderBatchModeFavorites() {
    const { favoritesList } = getBatchModeElements();
    if (!favoritesList) {
        return;
    }

    if (homepageBatchFavorites.length === 0) {
        favoritesList.innerHTML = `<div class="batch-mode-favorites-empty">${escapeHtml(t('homepageBatchFavoritesEmpty', 'No saved batches yet'))}</div>`;
        return;
    }

    const deleteTitle = t('favoriteItemDeleteTitle', 'Delete favorite prompt');
    const deleteAlt = t('favoriteItemDeleteAlt', deleteTitle);
    favoritesList.innerHTML = homepageBatchFavorites.map((item) => {
        const activeClass = item.id === homepageActiveBatchFavoriteId ? ' is-active' : '';
        return `
            <div class="batch-mode-favorite-item${activeClass}" data-batch-favorite-id="${escapeHtml(item.id)}">
                <button
                    type="button"
                    class="batch-mode-favorite-trigger"
                    data-batch-favorite-id="${escapeHtml(item.id)}"
                    title="${escapeHtml(item.name)}"
                >
                    <span class="batch-mode-favorite-name">${escapeHtml(item.name)}</span>
                </button>
                <button
                    type="button"
                    class="batch-mode-favorite-delete"
                    data-batch-favorite-delete="${escapeHtml(item.id)}"
                    title="${escapeHtml(deleteTitle)}"
                    aria-label="${escapeHtml(deleteTitle)}"
                >
                    <img src="../icons/trash.svg" alt="${escapeHtml(deleteAlt)}">
                </button>
            </div>
        `;
    }).join('');
}

function closeBatchFavoriteNameModal() {
    const { nameModal, nameInput } = getBatchModeElements();
    if (!nameModal) {
        return;
    }
    nameModal.hidden = true;
    if (nameInput) {
        nameInput.value = '';
    }
}

function openBatchFavoriteNameModal() {
    const { nameModal, nameInput } = getBatchModeElements();
    if (!nameModal) {
        return;
    }

    nameModal.hidden = false;
    requestAnimationFrame(() => {
        nameInput?.focus();
        nameInput?.select();
    });
}

async function handleSaveBatchFavorite() {
    const prompts = getBatchModeEditorValue().trim();
    if (!prompts) {
        showToast(t('homepageBatchNoQueries', 'Enter at least one prompt line'));
        return;
    }
    openBatchFavoriteNameModal();
}

async function confirmSaveBatchFavorite() {
    const { nameInput } = getBatchModeElements();
    const name = String(nameInput?.value || '').trim();
    const prompts = getBatchModeEditorValue().trim();

    if (!prompts) {
        showToast(t('homepageBatchNoQueries', 'Enter at least one prompt line'));
        return;
    }
    if (!name) {
        showToast(t('homepageBatchFavoriteNameRequired', 'Please enter a favorite name'));
        nameInput?.focus();
        return;
    }

    const existingIndex = homepageBatchFavorites.findIndex(item => item.name === name);
    const now = Date.now();
    const nextItem = {
        id: existingIndex >= 0 ? homepageBatchFavorites[existingIndex].id : createBatchFavoriteId(),
        name,
        prompts,
        updatedAt: now
    };

    if (existingIndex >= 0) {
        homepageBatchFavorites.splice(existingIndex, 1, nextItem);
    } else {
        homepageBatchFavorites.unshift(nextItem);
    }
    homepageBatchFavorites = normalizeHomepageBatchFavorites(homepageBatchFavorites);
    homepageActiveBatchFavoriteId = nextItem.id;

    try {
        await persistHomepageBatchFavorites();
        renderBatchModeFavorites();
        closeBatchFavoriteNameModal();
        showToast(t('homepageBatchFavoriteSaved', 'Saved batch favorite'));
        trackEvent('homepage_batch_favorite_save', {
            name_length: name.length,
            prompt_count: getBatchModeQueries().length
        });
    } catch (error) {
        console.error('Failed to save homepage batch favorite:', error);
        showToast(t('saveFailed', '保存失败，请重试'));
    }
}

function applyBatchFavoriteById(favoriteId) {
    const target = homepageBatchFavorites.find(item => item.id === favoriteId);
    if (!target) {
        return;
    }

    homepageActiveBatchFavoriteId = target.id;
    setBatchModeEditorValue(target.prompts, true);
    renderBatchModeFavorites();
    requestAnimationFrame(() => {
        homepageBatchModeEditor?.focus();
    });
    trackEvent('homepage_batch_favorite_apply', {
        name_length: target.name.length
    });
}

async function deleteBatchFavoriteById(favoriteId) {
    const target = homepageBatchFavorites.find(item => item.id === favoriteId);
    if (!target) {
        return;
    }

    const confirmMessage = t('deleteConfirm', 'Delete this item?');
    if (!window.confirm(confirmMessage)) {
        return;
    }

    homepageBatchFavorites = homepageBatchFavorites.filter(item => item.id !== favoriteId);
    if (homepageActiveBatchFavoriteId === favoriteId) {
        homepageActiveBatchFavoriteId = '';
    }

    try {
        await persistHomepageBatchFavorites();
        renderBatchModeFavorites();
        showToast(t('homepageBatchFavoriteDeleted', 'Deleted batch favorite'));
        trackEvent('homepage_batch_favorite_delete', {
            name_length: target.name.length
        });
    } catch (error) {
        console.error('Failed to delete homepage batch favorite:', error);
        showToast(t('saveFailed', '保存失败，请重试'));
    }
}

function closeBatchModeModal() {
    const { modal } = getBatchModeElements();
    if (!modal) {
        return;
    }

    modal.hidden = true;
    document.body.classList.remove('batch-mode-modal-open');
    closeBatchFavoriteNameModal();
}

function openBatchModeModal() {
    const { modal } = getBatchModeElements();
    if (!modal || !homepageBatchModeEditor) {
        return;
    }

    if (!getBatchModeEditorValue().trim()) {
        const searchInput = document.getElementById('searchInput');
        const seededQuery = normalizeHomepageQuery(searchInput?.value || '');
        if (seededQuery) {
            setBatchModeEditorValue(seededQuery);
        }
    }

    modal.hidden = false;
    document.body.classList.add('batch-mode-modal-open');

    requestAnimationFrame(() => {
        homepageBatchModeEditor.resize(true);
        homepageBatchModeEditor.focus();
        homepageBatchModeEditor.navigateFileEnd();
    });
}

function getBatchModeQueries() {
    return getBatchModeEditorValue()
        .split(/\r?\n/)
        .map(line => normalizeHomepageQuery(line))
        .filter(Boolean);
}

function normalizeBatchPastedText(text) {
    const normalizedText = String(text || '').replace(/\r\n?/g, '\n');
    const nonEmptyLines = normalizedText
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);

    if (nonEmptyLines.length <= 1) {
        return normalizedText;
    }

    const totalLength = nonEmptyLines.reduce((sum, line) => sum + line.length, 0);
    const averageLineLength = totalLength / nonEmptyLines.length;
    const shortLineCount = nonEmptyLines.filter(line => line.length <= 40).length;
    const looksLikeBatchList = nonEmptyLines.length >= 4
        || shortLineCount >= Math.ceil(nonEmptyLines.length * 0.6);

    // Long copied paragraphs sometimes arrive with unintended hard wraps.
    if (!looksLikeBatchList && averageLineLength >= 45) {
        return nonEmptyLines.join(' ');
    }

    return normalizedText;
}

async function handleBatchModeSubmit() {
    const selectionContext = getHomepageSelectionContext();
    if (!selectionContext.hasAnySelectedPanels) {
        showToast(t('homepageNoPanelsSelected', 'Select at least one site or agent'));
        return;
    }
    if (!selectionContext.hasRunnableIframePanels) {
        showToast(t('homepageBatchNoIframePanels', 'Batch mode requires at least one site or skill that can open in the compare page'));
        return;
    }

    const queries = getBatchModeQueries();
    if (queries.length === 0) {
        showToast(t('homepageBatchNoQueries', 'Enter at least one prompt line'));
        return;
    }

    trackEvent('homepage_batch_submit', {
        query_count: queries.length,
        selected_sites_count: selectionContext.selectedSites.length,
        custom_sites_count: selectionContext.selectedCustomSiteIds.length,
        agents_count: selectionContext.selectedAgentIds.length
    });

    try {
        for (let index = 0; index < queries.length; index += 1) {
            const iframeUrl = buildHomepageIframeSearchUrl(queries[index], {
                selectionContext,
                includeSidePanelParam: false
            });
            await chrome.tabs.create({
                url: iframeUrl,
                active: index === 0
            });
        }

        closeBatchModeModal();
        showToast(interpolateMessage(t('homepageBatchOpened', 'Opened $1 batch tasks'), [queries.length]));
    } catch (error) {
        console.error('homepage 批量查询处理失败:', error);
        showToast(t('homepageSearchFailed', '搜索启动失败，请重试'));
    }
}

function initializeBatchModeModal() {
    const {
        modal,
        backdrop,
        editorHost,
        favoritesList,
        saveFavoriteButton,
        openButton,
        cancelButton,
        submitButton,
        nameModal,
        nameBackdrop,
        nameInput,
        nameCancelButton,
        nameConfirmButton
    } = getBatchModeElements();

    if (!modal || !editorHost || !favoritesList || !saveFavoriteButton || !openButton || !cancelButton || !submitButton) {
        return;
    }
    if (modal.dataset.bound === '1') {
        return;
    }
    modal.dataset.bound = '1';

    if (!homepageBatchModeEditor && window.ace && editorHost) {
        homepageBatchModeEditor = window.ace.edit(editorHost);
        homepageBatchModeEditor.setTheme('ace/theme/textmate');
        homepageBatchModeEditor.session.setMode('ace/mode/text');
        homepageBatchModeEditor.setOptions({
            fontSize: '14px',
            showPrintMargin: false,
            highlightActiveLine: true,
            highlightGutterLine: true,
            displayIndentGuides: false,
            wrap: false,
            tabSize: 2,
            useSoftTabs: true,
            newLineMode: 'unix'
        });
        homepageBatchModeEditor.renderer.setPadding(16);
        homepageBatchModeEditor.renderer.setScrollMargin(14, 14, 0, 0);
        homepageBatchModeEditor.session.setUseWrapMode(false);
        homepageBatchModeEditor.setShowFoldWidgets(false);
        homepageBatchModeEditor.setBehavioursEnabled(false);
        homepageBatchModeEditor.setHighlightSelectedWord(false);
        homepageBatchModeEditor.setOption('cursorStyle', 'smooth');
        homepageBatchModeEditor.setOption('useWorker', false);
        homepageBatchModeEditor.commands.addCommand({
            name: 'submitBatchMode',
            bindKey: { win: 'Ctrl-Enter', mac: 'Command-Enter' },
            exec: () => {
                void handleBatchModeSubmit();
            }
        });
        homepageBatchModeEditor.on('paste', (event) => {
            if (event && typeof event.text === 'string') {
                event.text = normalizeBatchPastedText(event.text);
            }
        });
        refreshBatchModeEditorI18n();
    }

    openButton.addEventListener('click', () => {
        openBatchModeModal();
    });
    saveFavoriteButton.addEventListener('click', () => {
        void handleSaveBatchFavorite();
    });
    favoritesList.addEventListener('click', (event) => {
        const deleteTarget = event.target.closest('[data-batch-favorite-delete]');
        if (deleteTarget) {
            event.stopPropagation();
            void deleteBatchFavoriteById(deleteTarget.getAttribute('data-batch-favorite-delete'));
            return;
        }

        const favoriteTarget = event.target.closest('[data-batch-favorite-id]');
        if (favoriteTarget) {
            applyBatchFavoriteById(favoriteTarget.getAttribute('data-batch-favorite-id'));
        }
    });
    cancelButton.addEventListener('click', () => {
        closeBatchModeModal();
    });
    submitButton.addEventListener('click', () => {
        void handleBatchModeSubmit();
    });
    backdrop?.addEventListener('click', () => {
        closeBatchModeModal();
    });
    nameCancelButton?.addEventListener('click', () => {
        closeBatchFavoriteNameModal();
    });
    nameBackdrop?.addEventListener('click', () => {
        closeBatchFavoriteNameModal();
    });
    nameConfirmButton?.addEventListener('click', () => {
        void confirmSaveBatchFavorite();
    });
    nameInput?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            void confirmSaveBatchFavorite();
        }
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && nameModal?.hidden !== true) {
            closeBatchFavoriteNameModal();
            return;
        }
        if (event.key === 'Escape' && modal.hidden !== true) {
            closeBatchModeModal();
        }
    });

    void loadHomepageBatchFavorites();
    renderBatchModeFavorites();
}

async function handleQuery(query) {
    const processedQuery = normalizeHomepageQuery(query);
    const selectionContext = getHomepageSelectionContext();

    if (!selectionContext.hasAnySelectedPanels) {
        showToast(t('homepageNoPanelsSelected', 'Select at least one site or agent'));
        return;
    }

    void trackEventOnce('activation_site_selected', 'activation_site_selected', {
        surface: 'homepage',
        selected_sites_count: selectionContext.selectedSites.length,
        custom_sites_count: selectionContext.selectedCustomSiteIds.length,
        agents_count: selectionContext.selectedAgentIds.length,
        side_panel: selectionContext.isSidePanel
    });
    void trackEventOnce('activation_first_query_submitted', 'activation_first_query_submitted', {
        surface: 'homepage',
        query_length: processedQuery.length,
        selected_sites_count: selectionContext.selectedSites.length,
        custom_sites_count: selectionContext.selectedCustomSiteIds.length,
        agents_count: selectionContext.selectedAgentIds.length,
        side_panel: selectionContext.isSidePanel,
        has_query: Boolean(processedQuery)
    });

    trackEvent('homepage_search_submit', {
        query_length: processedQuery.length,
        selected_sites_count: selectionContext.selectedSites.length,
        selected_sites: selectionContext.selectedSites,
        custom_sites_count: selectionContext.selectedCustomSiteIds.length,
        custom_sites: selectionContext.selectedCustomSiteIds,
        agents_count: selectionContext.selectedAgentIds.length,
        agents: selectionContext.selectedAgentIds,
        iframe_sites_count: selectionContext.iframeSiteNames.length,
        external_sites_count: selectionContext.externalSiteNames.length,
        custom_iframe_sites_count: selectionContext.customIframeSiteIds.length,
        custom_external_sites_count: selectionContext.customExternalSiteIds.length,
        side_panel: selectionContext.isSidePanel,
        has_query: Boolean(processedQuery)
    });
    
    try {
        if (selectionContext.externalSiteNames.length > 0 || selectionContext.customExternalSiteIds.length > 0) {
            const externalSearchPromise = chrome.runtime.sendMessage({
                action: 'processQuery',
                query: processedQuery,
                sites: selectionContext.externalSiteNames,
                customSiteIds: selectionContext.customExternalSiteIds,
                openIframePage: false,
                skipChatPlanUsage: Boolean(processedQuery && selectionContext.hasRunnableIframePanels)
            });
            if (selectionContext.hasRunnableIframePanels) {
                externalSearchPromise.catch((error) => {
                    console.error('homepage 外部站点查询处理失败:', error);
                });
            } else {
                const response = await externalSearchPromise;
                if (!response?.success) {
                    throw new Error(response?.error || 'processQuery failed');
                }
            }
        }

        if (selectionContext.hasRunnableIframePanels) {
            if (processedQuery) {
                void markHomepagePkStarterCompleted();
            }
            window.location.href = buildHomepageIframeSearchUrl(processedQuery, {
                selectionContext,
                includeSidePanelParam: true
            });
        } else if (processedQuery && (selectionContext.externalSiteNames.length > 0 || selectionContext.customExternalSiteIds.length > 0)) {
            void markHomepagePkStarterCompleted();
        }
    } catch (error) {
        console.error('homepage 查询处理失败:', error);
        showToast(t('homepageSearchFailed', '搜索启动失败，请重试'));
    }
}

// 获取选中的站点名称列表
function getSelectedSites() {
    return getFilteredSites()
        .filter(site => homepageSitesState.selectedSites.get(site.name) === true)
        .map(site => site.name);
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

// 初始化站点列表
async function initializeSitesList() {
    const sitesList = document.getElementById('sitesList');
    if (!sitesList) {
        console.error('站点列表容器未找到');
        return;
    }
    
    perfMark('sites_list_flow_start');
    try {
        const configuredGroups = await window.AppConfigManager.getSiteTypes();
        homepageSitesState.configuredGroups = window.PromptTemplateUtils?.normalizePromptTemplateTypes?.(configuredGroups)
            || [DEFAULT_SITE_GROUP];

        // 使用 getDefaultSites 获取合并后的站点配置
        perfMark('sites_list_get_data_start');
        const sites = await getDefaultSites();
        perfMark('sites_list_get_data_end');
        perfMeasure('sites_list_get_data_duration', 'sites_list_get_data_start', 'sites_list_get_data_end');
        
        // homepage 站点列表只按可见性过滤，
        // 不再因为 supportIframe 或 enabled 把站点挡掉。
        const supportedSites = sites.filter(site =>
            !site.hidden && site.hiddenInHomepage !== true
        );
        const sortedSites = sortSitesFavoriteFirst(supportedSites);
        homepageSitesState.supportedSites = sortedSites;
        homepageSitesState.selectedSites = new Map(
            sortedSites.map(site => [site.name, site.enabled === true])
        );
        homepageSitesState.activeGroup = getAvailableSiteGroups(sortedSites).includes(DEFAULT_SITE_GROUP)
            ? DEFAULT_SITE_GROUP
            : (getAvailableSiteGroups(sortedSites)[0] || '');
        
        console.log('从getDefaultSites() 获取的可以使用的站点:', sortedSites.map(site => ({ name: site.name, enabled: site.enabled })));
        perfMark('sites_list_render_start');
        renderSiteTypeTabs();
        renderSitesList();
        updateAgentsSectionVisibility();
        perfMark('sites_list_render_end');
        perfMeasure('sites_list_render_duration', 'sites_list_render_start', 'sites_list_render_end');
        
        // 添加拖拽排序功能
        if (!homepageSitesState.dragAndDropBound) {
            addDragAndDropToSitesList(sitesList);
            homepageSitesState.dragAndDropBound = true;
        }
        
    } catch (error) {
        console.error('获取站点配置失败:', error);
        if (sitesList) {
            sitesList.innerHTML = `<div style="padding: 20px; color: #666; text-align: center;">${t('siteListLoadFailed', 'Failed to load site configuration. Please refresh and try again.')}</div>`;
        }
    } finally {
        sitesList.classList.remove('sites-list-skeleton');
        sitesList.removeAttribute('aria-busy');
        perfMark('sites_list_flow_end');
        perfMeasure('sites_list_flow_duration', 'sites_list_flow_start', 'sites_list_flow_end');
    }
}

// 为站点列表添加拖拽排序功能
function addDragAndDropToSitesList(listEl) {
    let draggedElement = null;
    let draggedIndex = null;
    
    listEl.addEventListener('dragstart', (e) => {
        const item = e.target.closest('.site-item');
        if (!item) return;
        draggedElement = item;
        draggedIndex = Array.from(listEl.children).indexOf(item);
        item.classList.add('dragging');
        listEl.classList.add('drag-active');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/html', item.outerHTML);
    });
    
    listEl.addEventListener('dragend', (e) => {
        const item = e.target.closest('.site-item');
        if (!item) return;
        item.classList.remove('dragging');
        listEl.classList.remove('drag-active');
        listEl.querySelectorAll('.site-item').forEach(el => el.classList.remove('drag-over'));
        draggedElement = null;
        draggedIndex = null;
    });
    
    listEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const afterElement = getSitesDragAfterElement(listEl, e.clientY);
        const dragging = listEl.querySelector('.dragging');
        if (!dragging) return;
        if (afterElement == null) {
            listEl.appendChild(dragging);
        } else {
            listEl.insertBefore(dragging, afterElement);
        }
    });
    
    listEl.addEventListener('dragenter', (e) => {
        const item = e.target.closest('.site-item');
        if (item && item !== draggedElement) {
            item.classList.add('drag-over');
        }
    });
    
    listEl.addEventListener('dragleave', (e) => {
        const item = e.target.closest('.site-item');
        if (item) {
            item.classList.remove('drag-over');
        }
    });
    
    listEl.addEventListener('drop', async (e) => {
        e.preventDefault();
        if (!draggedElement) return;
        const newIndex = Array.from(listEl.children).indexOf(draggedElement);
        if (newIndex !== draggedIndex) {
            await updateHomepageSitesOrder(listEl);
            console.log('主页站点顺序已更新并保存');
        }
    });
}

// 获取拖拽后的插入位置
function getSitesDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.site-item:not(.dragging)')];
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        }
        return closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

// 保存主页站点排序到 storage
async function updateHomepageSitesOrder(listEl) {
    try {
        const visibleNames = Array.from(listEl.children)
            .map(el => el.dataset.siteName)
            .filter(Boolean);
        const visibleNameSet = new Set(visibleNames);
        let visibleIndex = 0;
        const orderedNames = homepageSitesState.supportedSites.map(site => {
            if (!visibleNameSet.has(site.name)) {
                return site.name;
            }
            const nextName = visibleNames[visibleIndex];
            visibleIndex += 1;
            return nextName;
        });
        
        const { sites: existingUserSettings = {} } = await chrome.storage.sync.get('sites');
        const updatedUserSettings = { ...existingUserSettings };
        const orderMap = new Map(orderedNames.map((name, index) => [name, index]));
        
        orderedNames.forEach((name, index) => {
            if (!updatedUserSettings[name]) {
                updatedUserSettings[name] = {};
            }
            updatedUserSettings[name].order = index;
        });
        
        await chrome.storage.sync.set({ sites: updatedUserSettings });
        
        homepageSitesState.supportedSites.sort(
            (a, b) => (orderMap.get(a.name) ?? 999) - (orderMap.get(b.name) ?? 999)
        );

        showToast(t('saveSuccess', '配置已保存'));
    } catch (error) {
        console.error('保存主页站点顺序失败:', error);
    }
}

// 初始化保存站点按钮
function initializeSaveSitesButton() {
    const saveBtn = document.getElementById('saveSitesBtn');
    
    if (!saveBtn) {
        console.error('保存按钮未找到: saveSitesBtn');
        return;
    }
    
    console.log('保存按钮已找到，开始绑定事件');
    
    // 使用自定义 tooltip（快速显示），仅设置 aria-label 供无障碍
    const saveTitle = t('saveFavoriteSitesTitle') || 
        t('saveFavoriteSites') || 
        'Save as default sites';
    saveBtn.setAttribute('aria-label', saveTitle);
    
    // 点击保存按钮
    saveBtn.addEventListener('click', async (e) => {
        console.log('保存按钮被点击');
        e.preventDefault();
        e.stopPropagation();
        
        try {
            // 获取当前选中的站点
            const selectedSites = getSelectedSites();
            const selectedCustomSiteIds = getSelectedCustomSiteIds();
            const selectedAgentIds = getSelectedAgentIds();
            console.log('选中的站点:', selectedSites);
            console.log('选中的 customSites:', selectedCustomSiteIds);
            console.log('选中的 agents:', selectedAgentIds);
            
            if (selectedSites.length === 0 && selectedCustomSiteIds.length === 0 && selectedAgentIds.length === 0) {
                showToast(t('homepageNoPanelsSelected', 'Select at least one site or agent'));
                return;
            }
            
            // 1. 读取现有的用户设置
            const {
                sites: existingUserSettings = {},
                agentCustomSettings: storedAgentCustomSettings = {}
            } = await chrome.storage.sync.get(['sites', 'agentCustomSettings']);
            console.log('现有的用户设置:', existingUserSettings);
            
            // 2. 获取所有可用站点（用于更新所有站点的 enabled 状态）
            const allSites = await getDefaultSites();
            console.log('所有可用站点数量:', allSites.length);
            
            if (!allSites || allSites.length === 0) {
                console.error('无法获取站点列表，保存失败');
                showToast(t('saveFailed', '保存失败，请重试'));
                return;
            }
            
            const allSiteNames = allSites.map(site => site.name);
            console.log('所有站点名称:', allSiteNames);
            
            // 3. 更新用户设置：选中的站点 enabled=true，未选中的 enabled=false
            const updatedUserSettings = { ...existingUserSettings };
            allSiteNames.forEach(siteName => {
                if (!updatedUserSettings[siteName]) {
                    updatedUserSettings[siteName] = {};
                }
                // 根据是否在选中列表中设置 enabled 状态
                updatedUserSettings[siteName].enabled = selectedSites.includes(siteName);
            });

            const customSites = await window.getCustomSites?.() || [];
            const updatedCustomSites = customSites.map(site => ({
                ...site,
                enabled: selectedCustomSiteIds.includes(site.id)
            }));

            const agentCatalogUtils = window.AICompareAgentCatalog || null;
            const normalizedAgentSettings = typeof agentCatalogUtils?.normalizeAgentCustomSettingsMap === 'function'
                ? agentCatalogUtils.normalizeAgentCustomSettingsMap(storedAgentCustomSettings)
                : (storedAgentCustomSettings && typeof storedAgentCustomSettings === 'object'
                    ? { ...storedAgentCustomSettings }
                    : {});
            const updatedAgentCustomSettings = {
                ...normalizedAgentSettings
            };

            (homepageSitesState.agentCatalog?.agents || []).forEach((agent) => {
                const currentSettings = updatedAgentCustomSettings[agent.id] && typeof updatedAgentCustomSettings[agent.id] === 'object'
                    ? updatedAgentCustomSettings[agent.id]
                    : {};
                updatedAgentCustomSettings[agent.id] = {
                    ...currentSettings,
                    enabled: selectedAgentIds.includes(agent.id)
                };
            });
            
            console.log('更新后的用户设置:', updatedUserSettings);
            console.log('更新后的 customSites:', updatedCustomSites);
            console.log('更新后的 agentCustomSettings:', updatedAgentCustomSettings);
            
            // 4. 保存到 chrome.storage.sync.sites、customSites 和 agentCustomSettings
            await chrome.storage.sync.set({
                sites: updatedUserSettings,
                customSites: updatedCustomSites,
                agentCustomSettings: updatedAgentCustomSettings
            });
            if (homepageSitesState.agentCatalog?.agents) {
                homepageSitesState.agentCatalog = {
                    ...homepageSitesState.agentCatalog,
                    agents: homepageSitesState.agentCatalog.agents.map((agent) => ({
                        ...agent,
                        enabled: selectedAgentIds.includes(agent.id)
                    }))
                };
            }
            homepageSitesState.customSites = updatedCustomSites;
            homepageSitesState.selectedCustomSites = new Map(
                updatedCustomSites.map(site => [site.id, site.enabled === true])
            );
            homepageSitesState.selectedAgents = new Map(
                (homepageSitesState.agentCatalog?.agents || []).map(agent => [agent.id, selectedAgentIds.includes(agent.id)])
            );
            renderCustomSitesList();
            renderAgentsList();
            console.log('已保存到 chrome.storage.sync.sites');
            
            // 记录分析事件
            trackEvent('homepage_save_favorite_sites', {
                sites_count: selectedSites.length,
                sites: selectedSites,
                custom_sites_count: selectedCustomSiteIds.length,
                custom_sites: selectedCustomSiteIds,
                agents_count: selectedAgentIds.length,
                agents: selectedAgentIds
            });
            
            // 显示成功提示
            showToast(t('saveSuccess', '配置已保存'));
            
            console.log('常用站点已保存到 sites:', updatedUserSettings);
        } catch (error) {
            console.error('保存常用站点失败:', error);
            showToast(t('saveFailed', '保存失败，请重试'));
        }
    });
    
    console.log('保存按钮事件绑定完成');
}

if (typeof window !== 'undefined') {
    window.addEventListener('runtime-language-changed', () => {
        initializeI18n();
        void initializeAgentsList();
        void refreshHomepageVisibleQuerySuggestions();
    });
}

// 添加上传附件按钮点击事件
document.getElementById('fileUploadButton').addEventListener('click', () => {
    // 打开 iframe.html 页面，并传递 upload=true 参数来触发文件上传
    const urlParams = new URLSearchParams();
    urlParams.set('upload', 'true');
    
    // 获取选中的站点列表
    const selectedSites = getSelectedSites();
    const selectedCustomSiteIds = getSelectedCustomSiteIds();
    const selectedAgentIds = getSelectedAgentIds();
    const selectedSiteConfigs = homepageSitesState.supportedSites.filter(site =>
        selectedSites.includes(site.name)
    );
    const selectedCustomSiteConfigs = (homepageSitesState.customSites || []).filter(site =>
        selectedCustomSiteIds.includes(site.id)
    );
    const iframeSiteNames = selectedSiteConfigs
        .filter(site => site.supportIframe === true)
        .map(site => site.name)
        .filter(Boolean);
    const customIframeSiteIds = selectedCustomSiteConfigs
        .filter(site => site.supportIframe === true)
        .map(site => site.id)
        .filter(Boolean);
    if (iframeSiteNames.length > 0) {
        urlParams.set('sites', iframeSiteNames.join(','));
    }
    if (customIframeSiteIds.length > 0) {
        urlParams.set('customSites', customIframeSiteIds.join(','));
    }
    if (selectedAgentIds.length > 0) {
        urlParams.set('agents', selectedAgentIds.join(','));
    }
    if (homepageSitesState.activeGroup) {
        urlParams.set('type', homepageSitesState.activeGroup);
    }
    
    // 检查当前页面是否在侧边栏中
    const currentUrlParams = new URLSearchParams(window.location.search);
    const isSidePanel = currentUrlParams.get('side_panel') === 'true';
    if (isSidePanel) {
        urlParams.set('side_panel', 'true');
    }

    trackEvent('homepage_upload_click', {
        selected_sites_count: selectedSites.length,
        custom_sites_count: selectedCustomSiteIds.length,
        agents_count: selectedAgentIds.length,
        side_panel: isSidePanel
    });
    
    // 构建 URL
    const iframeUrl = chrome.runtime.getURL(`iframe/iframe.html?${urlParams.toString()}`);
    
    // 在当前页面跳转，而不是打开新标签页
    window.location.href = iframeUrl;
});

// 添加搜索按钮点击事件
document.getElementById('searchButton').addEventListener('click', () => {
    const query = document.getElementById('searchInput').value.trim();
    handleQuery(query);
});

// 监听输入法组合输入事件
document.getElementById('searchInput').addEventListener('compositionstart', () => {
    isComposing = true;
});

document.getElementById('searchInput').addEventListener('compositionend', () => {
    isComposing = false;
});

// 处理回车键
document.getElementById('searchInput').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') {
        return;
    }

    // 如果正在使用输入法组合输入，不触发查询操作
    if (isComposing) {
        return;
    }

    if (!shouldSubmitOnEnterKey(e, {
        mode: homepageSubmitShortcutMode,
        isMac: HOMEPAGE_IS_MAC_PLATFORM
    })) {
        return;
    }

    e.preventDefault();
    const query = document.getElementById('searchInput').value.trim();
    handleQuery(query);
});


// Toast 提示函数
function showToast(message, duration = 2000) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 12px 24px;
        border-radius: 8px;
        z-index: 10000;
        font-size: 14px;
        animation: slideInUp 0.3s ease-out;
    `;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideInUp 0.3s ease-out reverse';
        setTimeout(() => {
            if (toast.parentElement) {
                toast.remove();
            }
        }, 300);
    }, duration);
}
