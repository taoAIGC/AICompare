// analytics.js

const ANALYTICS_EVENTS = {
  // 首页相关
  HOMEPAGE_SEARCH_SUBMIT: 'homepage_search_submit',
  HOMEPAGE_UPLOAD_CLICK: 'homepage_upload_click',
  HOMEPAGE_SITE_TOGGLE: 'homepage_site_toggle',
  HOMEPAGE_REVIEW_CLICK: 'homepage_review_click',
  HOMEPAGE_FEEDBACK_CLICK: 'homepage_feedback_click',
  HOMEPAGE_SETTINGS_CLICK: 'homepage_settings_click',
  HOMEPAGE_HISTORY_CLICK: 'homepage_history_click',
  HOMEPAGE_FAVORITES_CLICK: 'homepage_favorites_click',
  HOMEPAGE_SAVE_FAVORITE_SITES: 'homepage_save_favorite_sites',
  HOMEPAGE_PROMPT_TEMPLATES_SETTINGS_CLICK: 'homepage_prompt_templates_settings_click',

  // iframe 主功能相关
  IFRAME_SEARCH_SUBMIT: 'iframe_search_submit',
  IFRAME_UPLOAD_CLICK: 'iframe_upload_click',
  IFRAME_EXPORT_CLICK: 'iframe_export_click',
  IFRAME_SITE_TOGGLE: 'iframe_site_toggle',

  // iframe 站点收藏相关
  IFRAME_SITE_FAVORITE_TOGGLE: 'iframe_site_favorite_toggle',
  IFRAME_FAVORITE_ALL_IFRAMES: 'iframe_favorite_all_iframes',

  // iframe 提示词收藏相关
  IFRAME_PROMPT_FAVORITE_TOGGLE: 'iframe_prompt_favorite_toggle',
  IFRAME_PROMPT_FAVORITES_OPEN: 'iframe_prompt_favorites_open',
  IFRAME_PROMPT_FAVORITE_SELECT: 'iframe_prompt_favorite_select',
  IFRAME_PROMPT_FAVORITE_DELETE: 'iframe_prompt_favorite_delete',
  IFRAME_PROMPT_FAVORITE_EDIT_CLICK: 'iframe_prompt_favorite_edit_click'
};

let analyticsConfigCache = null;
let hasWarnedMissingConfig = false;

async function loadAnalyticsConfig() {
  if (analyticsConfigCache) {
    return analyticsConfigCache;
  }

  try {
    if (typeof AppConfigManager !== 'undefined' && AppConfigManager?.loadConfig) {
      const config = await AppConfigManager.loadConfig();
      analyticsConfigCache = config?.analytics || null;
      return analyticsConfigCache;
    }

    const response = await fetch(chrome.runtime.getURL('config/appConfig.json'));
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const config = await response.json();
    analyticsConfigCache = config?.analytics || null;
    return analyticsConfigCache;
  } catch (error) {
    if (!hasWarnedMissingConfig) {
      console.warn('Analytics 配置加载失败:', error);
      hasWarnedMissingConfig = true;
    }
    return null;
  }
}

// 获取或生成唯一的 Client ID (保证同一个用户的数据连贯)
async function getOrCreateClientId() {
  const result = await chrome.storage.local.get('clientId');
  let clientId = result.clientId;
  if (!clientId) {
    clientId = self.crypto.randomUUID();
    await chrome.storage.local.set({ clientId });
  }
  return clientId;
}

// 核心发送函数
async function logEvent(name, params = {}) {
  const analyticsConfig = await loadAnalyticsConfig();
  if (!analyticsConfig || analyticsConfig.enabled !== true) {
    return;
  }

  const measurementId = analyticsConfig.measurementId;
  const apiSecret = analyticsConfig.apiSecret;

  if (!measurementId || !apiSecret) {
    if (!hasWarnedMissingConfig) {
      console.warn('Analytics 配置不完整，请检查 measurementId 和 apiSecret');
      hasWarnedMissingConfig = true;
    }
    return;
  }

  const clientId = await getOrCreateClientId();

  const payload = {
    client_id: clientId,
    events: [{
      name,
      params
    }]
  };

  const directEndpoint = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`;

  const relayBaseUrl = (() => {
    try {
      const base = globalThis.FirebaseConfig?.getCloudFunctionsBaseUrl?.();
      if (base) return String(base).trim().replace(/\/+$/, '');
    } catch (_) {}
    return 'https://aicompare.club';
  })();

  const relayEndpoint = `${relayBaseUrl}/ga/mp/collect`;

  try {
    const response = await fetch(directEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      return;
    }
  } catch (_) {
    // Network environments (e.g. CN) may block google-analytics.com; fall back to relay.
  }

  try {
    await fetch(relayEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        measurementId,
        apiSecret,
        ...payload
      })
    });
  } catch (_) {
    // Swallow errors to avoid impacting user flows.
  }
}

if (typeof window !== 'undefined') {
  window.AIShortcutsAnalytics = {
    logEvent,
    EVENTS: ANALYTICS_EVENTS
  };
}