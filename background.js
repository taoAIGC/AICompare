importScripts(
  './shared/site-launch-utils.js',
  './config/agentCatalogData.js',
  './config/agentCatalog.js',
  './config/agentEngineConfig.js',
  './shared/agent-prompt-utils.js',
  './config/baseConfig.js',
  './config/firebaseConfig.js',
  './remote/common.js',
  './remote/crypto.js',
  './remote/state.js',
  './remote/storage.js',
  './remote/sw-runtime.js'
);     // 加载共享启动解析器和基础配置

const SiteLaunchUtils = self.SiteLaunchUtils || {};
const AgentCatalog = self.AICompareAgentCatalog || {};
const AgentEngineConfig = self.AICompareAgentEngineConfig || {};
const AgentPromptUtils = self.AICompareAgentPromptUtils || {};
const UI_LANGUAGE_STORAGE_KEY = 'uiLanguage';
const AGENT_ENGINE_STORAGE_KEY = 'agentEngineConfig';
const AGENT_ENGINE_SECRET_STORAGE_KEY = 'agentEngineSecret';
const AGENT_ENGINE_SETTINGS_STORAGE_KEY = 'agentEngineSettings';
const AGENT_ENGINE_USAGE_STORAGE_KEY = 'agentOfficialUsage';
const AGENT_ENGINE_ANONYMOUS_CLIENT_ID_STORAGE_KEY = 'agentOfficialAnonymousClientId';
const AGENT_CUSTOM_SETTINGS_STORAGE_KEY = AgentCatalog.AGENT_CUSTOM_SETTINGS_STORAGE_KEY || 'agentCustomSettings';
const CUSTOM_AGENTS_STORAGE_KEY = AgentCatalog.CUSTOM_AGENTS_STORAGE_KEY || 'customAgents';
const AGENT_HIDDEN_IDS_STORAGE_KEY = AgentCatalog.AGENT_HIDDEN_IDS_STORAGE_KEY || 'agentHiddenIds';
const DRIVE_SYNC_CONFIG_KEY = 'googleDriveSyncConfig';
const DRIVE_SYNC_FILENAME = 'multiAI-settings.json';
const DRIVE_SYNC_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
let googleDriveConnectInFlight = null;
const OFFICIAL_AGENT_DAILY_FREE_LIMIT = Math.max(
  0,
  Number(AgentEngineConfig.DEFAULT_DAILY_FREE_LIMIT ?? 0) || 0
);

function getDefaultAgentEngineConfig() {
  const bundledDefaults = typeof AgentEngineConfig.getDefaults === 'function'
    ? AgentEngineConfig.getDefaults()
    : {};
  const normalizedDefaults = typeof AgentPromptUtils.normalizeApiConfig === 'function'
    ? AgentPromptUtils.normalizeApiConfig(bundledDefaults)
    : bundledDefaults;

  return {
    baseUrl: String(normalizedDefaults.baseUrl || '').trim().replace(/\/+$/, ''),
    model: String(normalizedDefaults.model || '').trim(),
    concurrency: Math.max(1, Number(normalizedDefaults.concurrency) || 10),
    systemPrompt: String(normalizedDefaults.systemPrompt || '').trim()
  };
}

const DEFAULT_AGENT_ENGINE_CONFIG = Object.freeze(getDefaultAgentEngineConfig());
const AGENT_RUNTIME_KEEPALIVE_PORT_NAME = 'agent-runtime-keepalive';
const STANDALONE_ANALYSIS_STREAM_PORT_NAME = 'standalone-analysis-stream';
const AGENT_RUNTIME_KEEPALIVE_INTERVAL_MS = 20000;
const agentRuntimeState = {
  activeCount: 0,
  queue: [],
  jobs: new Map(),
  panelJobMap: new Map(),
  keepalivePorts: new Map(),
  keepaliveTimers: new Map()
};

function getBrowserUiLocale() {
  try {
    return chrome?.i18n?.getUILanguage?.() || 'en';
  } catch (_) {
    return 'en';
  }
}

async function getBillingLocale() {
  try {
    const stored = await chrome.storage.sync.get(UI_LANGUAGE_STORAGE_KEY);
    const requestedLocale = String(stored?.[UI_LANGUAGE_STORAGE_KEY] || '').trim();
    if (requestedLocale && requestedLocale !== 'auto') {
      return requestedLocale;
    }
  } catch (_) {
    // Fall back to the browser UI language if sync storage is unavailable.
  }
  return getBrowserUiLocale();
}

async function isOfficialAgentBillingEnabled() {
  const locale = await getBillingLocale();
  if (typeof AgentEngineConfig.shouldEnableBillingForLocale === 'function') {
    return AgentEngineConfig.shouldEnableBillingForLocale(locale);
  }
  return !String(locale || '').trim().toLowerCase().startsWith('zh');
}

function t(key, fallback = '', substitutions = undefined) {
  try {
    return chrome?.i18n?.getMessage?.(key, substitutions) || fallback;
  } catch (_) {
    return fallback;
  }
}

function getExtensionActionIconPaths() {
  if (self.ExtensionEnvironment && typeof self.ExtensionEnvironment.getActionIconPaths === 'function') {
    return self.ExtensionEnvironment.getActionIconPaths();
  }

  return {
    16: 'icons/icon16.png',
    48: 'icons/icon48.png',
    128: 'icons/icon128.png'
  };
}

async function applyExtensionActionBranding() {
  try {
    await chrome.action.setIcon({
      path: getExtensionActionIconPaths()
    });
  } catch (error) {
    console.error('设置扩展图标失败:', error);
  }
}

// 开发环境：输出当前扩展ID供search_url使用
function logExtensionIdForDevelopment() {
  const extensionId = chrome.runtime.id;
  console.log('='.repeat(60));
  console.log('🔧 开发调试信息');
  console.log('当前扩展ID:', extensionId);
  console.log('search_url应该设置为:');
  console.log(`chrome-extension://${extensionId}/iframe/iframe.html?query={searchTerms}`);
  console.log('='.repeat(60));
  
  // 可选：将正确的URL复制到剪贴板（需要clipboardWrite权限）
  try {
    const searchUrl = `chrome-extension://${extensionId}/iframe/iframe.html?query={searchTerms}`;
    // 存储到local storage供手动获取
    chrome.storage.local.set({ 
      developmentSearchUrl: searchUrl,
      currentExtensionId: extensionId 
    });
  } catch (error) {
    console.log('无法自动复制URL，请手动复制上面的search_url');
  }
}

async function ensureDefaultAgentEngineConfig() {
  try {
    const [syncData, localData] = await Promise.all([
      chrome.storage.sync.get([AGENT_ENGINE_STORAGE_KEY, AGENT_ENGINE_SETTINGS_STORAGE_KEY]),
      chrome.storage.local.get(AGENT_ENGINE_SECRET_STORAGE_KEY)
    ]);
    const legacySyncConfig = typeof AgentPromptUtils.migrateLegacyApiConfig === 'function'
      ? AgentPromptUtils.migrateLegacyApiConfig(syncData?.[AGENT_ENGINE_STORAGE_KEY] || {})
      : (syncData?.[AGENT_ENGINE_STORAGE_KEY] || {});
    const resolvedSettings = typeof AgentPromptUtils.resolveAgentEngineSettings === 'function'
      ? AgentPromptUtils.resolveAgentEngineSettings(
          syncData?.[AGENT_ENGINE_SETTINGS_STORAGE_KEY] || legacySyncConfig,
          localData?.[AGENT_ENGINE_SECRET_STORAGE_KEY] || {}
        )
      : null;
    const officialConfig = resolvedSettings?.officialConfig || DEFAULT_AGENT_ENGINE_CONFIG;
    const customConfig = resolvedSettings?.customConfig || {};
    const selectedSource = resolvedSettings?.selectedSource === 'custom' ? 'custom' : 'official';

    await Promise.all([
      chrome.storage.sync.set({
        [AGENT_ENGINE_SETTINGS_STORAGE_KEY]: {
          selectedSource,
          customConfig: {
            baseUrl: String(customConfig.baseUrl || '').trim(),
            model: String(customConfig.model || '').trim(),
            concurrency: Math.max(1, Number(customConfig.concurrency) || 10),
            systemPrompt: String(customConfig.systemPrompt || '').trim()
          }
        },
        [AGENT_ENGINE_STORAGE_KEY]: {
          baseUrl: String(customConfig.baseUrl || '').trim(),
          model: String(customConfig.model || '').trim(),
          concurrency: Math.max(1, Number(customConfig.concurrency) || 10),
          systemPrompt: String(customConfig.systemPrompt || '').trim()
        }
      }),
      chrome.storage.local.set({
        [AGENT_ENGINE_SECRET_STORAGE_KEY]: {
          apiKey: localData?.[AGENT_ENGINE_SECRET_STORAGE_KEY]?.apiKey || '',
          customApiKey: localData?.[AGENT_ENGINE_SECRET_STORAGE_KEY]?.customApiKey || localData?.[AGENT_ENGINE_SECRET_STORAGE_KEY]?.apiKey || ''
        }
      })
    ]);
  } catch (error) {
    console.error('初始化默认智能体引擎配置失败:', error);
  }
}

async function getAgentEngineConfig() {
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
    ...DEFAULT_AGENT_ENGINE_CONFIG,
    ...(syncData?.[AGENT_ENGINE_STORAGE_KEY] || {}),
    apiKey: localData?.[AGENT_ENGINE_SECRET_STORAGE_KEY]?.apiKey || ''
  };

  if (typeof AgentPromptUtils.normalizeApiConfig === 'function') {
    return AgentPromptUtils.normalizeApiConfig(rawConfig);
  }

  return {
    apiKey: String(rawConfig.apiKey || '').trim(),
    baseUrl: String(rawConfig.baseUrl || DEFAULT_AGENT_ENGINE_CONFIG.baseUrl).replace(/\/+$/, ''),
    model: String(rawConfig.model || DEFAULT_AGENT_ENGINE_CONFIG.model).trim(),
    concurrency: Math.max(1, Number(rawConfig.concurrency) || DEFAULT_AGENT_ENGINE_CONFIG.concurrency),
    systemPrompt: String(rawConfig.systemPrompt || '').trim()
  };
}

function isOfficialAgentEngineSource(config = {}) {
  return (config.selectedSource || 'official') !== 'custom';
}

function isAgentEngineRuntimeConfigured(config = {}) {
  if (isOfficialAgentEngineSource(config)) {
    return Boolean(config.model);
  }
  return Boolean(config.apiKey && config.baseUrl && config.model);
}

function getCloudFunctionsBaseUrl() {
  const configuredUrl = String(FirebaseConfig?.cloudFunctionsBaseUrl || '').trim().replace(/\/+$/, '');
  return configuredUrl || 'https://aicompare.club';
}

function createAnonymousClientId() {
  try {
    if (self.crypto?.randomUUID) {
      return self.crypto.randomUUID();
    }
  } catch (_) {
    // Fall back to a timestamp/random id on older extension runtimes.
  }
  return `anon_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

async function getOrCreateAnonymousClientId() {
  const stored = await chrome.storage.local.get(AGENT_ENGINE_ANONYMOUS_CLIENT_ID_STORAGE_KEY);
  const existingId = String(stored?.[AGENT_ENGINE_ANONYMOUS_CLIENT_ID_STORAGE_KEY] || '').trim();
  if (existingId) {
    return existingId;
  }

  const clientId = createAnonymousClientId();
  await chrome.storage.local.set({
    [AGENT_ENGINE_ANONYMOUS_CLIENT_ID_STORAGE_KEY]: clientId
  });
  return clientId;
}

async function getFirebaseIdTokenIfAvailable() {
  const auth = await getBackgroundFirebaseAuth();
  if (!auth.uid || !auth.idToken || auth.expiresAt <= Date.now() + 60000) {
    return '';
  }
  return auth.idToken;
}

async function fetchAgentChatCompletion(config = {}, payload = {}, options = {}) {
  if (!isOfficialAgentEngineSource(config)) {
    return fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify(payload),
      signal: options.signal
    });
  }

  const [idToken, clientId] = await Promise.all([
    getFirebaseIdTokenIfAvailable(),
    getOrCreateAnonymousClientId()
  ]);
  const locale = await getBillingLocale();
  const headers = {
    'Content-Type': 'application/json',
    'X-AI-Compare-Locale': locale,
    'X-AI-Compare-Client-Id': clientId
  };
  if (idToken) {
    headers.Authorization = `Bearer ${idToken}`;
  }

  return fetch(`${getCloudFunctionsBaseUrl()}/officialAgentChat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...payload,
      locale
    }),
    signal: options.signal
  });
}

function getOfficialUsageDateKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function getCachedBackgroundPlan() {
  try {
    const stored = await chrome.storage.local.get(['_planCache', '_planCacheAt']);
    const cacheAge = Date.now() - (stored._planCacheAt || 0);
    if (stored._planCache && cacheAge < 5 * 60 * 1000) {
      return JSON.parse(stored._planCache);
    }
  } catch (_) {
    // ignore cache parse errors
  }
  return { plan: 'free', planExpiresAt: null };
}

async function getBackgroundFirebaseAuth() {
  const stored = await chrome.storage.local.get([
    'firebase_uid',
    'firebase_idToken',
    'firebase_expiresAt',
    'firebase_refreshToken'
  ]);
  return {
    uid: stored.firebase_uid || null,
    idToken: stored.firebase_idToken || null,
    expiresAt: stored.firebase_expiresAt || 0,
    refreshToken: stored.firebase_refreshToken || null
  };
}

async function getBackgroundUserPlan() {
  try {
    const auth = await getBackgroundFirebaseAuth();
    if (!auth.uid || !auth.idToken || auth.expiresAt <= Date.now() + 60000) {
      return getCachedBackgroundPlan();
    }

    if (!FirebaseConfig?.projectId || !FirebaseConfig?.apiKey) {
      return getCachedBackgroundPlan();
    }

    const url = `https://firestore.googleapis.com/v1/projects/${FirebaseConfig.projectId}/databases/(default)/documents/users/${auth.uid}?key=${FirebaseConfig.apiKey}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${auth.idToken}`
      }
    });

    if (!res.ok) {
      return getCachedBackgroundPlan();
    }

    const doc = await res.json();
    const fields = doc.fields || {};
    const plan = fields.plan?.stringValue || 'free';
    const planExpiresAt = fields.planExpiresAt?.timestampValue || null;
    const isExpired = planExpiresAt && new Date(planExpiresAt) < new Date();
    const effectivePlan = (plan === 'pro' && !isExpired) ? 'pro' : 'free';

    await chrome.storage.local.set({
      _planCache: JSON.stringify({ plan: effectivePlan, planExpiresAt }),
      _planCacheAt: Date.now()
    });

    return { plan: effectivePlan, planExpiresAt };
  } catch (_) {
    return getCachedBackgroundPlan();
  }
}

async function getOfficialUsageStatus() {
  const billingEnabled = await isOfficialAgentBillingEnabled();
  if (!billingEnabled) {
    return {
      billingEnabled: false,
      plan: 'free',
      limit: OFFICIAL_AGENT_DAILY_FREE_LIMIT,
      used: 0,
      remaining: Infinity
    };
  }

  const planInfo = await getBackgroundUserPlan();
  if (planInfo?.plan === 'pro') {
    return {
      billingEnabled: true,
      plan: 'pro',
      limit: OFFICIAL_AGENT_DAILY_FREE_LIMIT,
      used: 0,
      remaining: Infinity
    };
  }

  const stored = await chrome.storage.local.get(AGENT_ENGINE_USAGE_STORAGE_KEY);
  const usage = stored?.[AGENT_ENGINE_USAGE_STORAGE_KEY] || {};
  const today = getOfficialUsageDateKey();
  const used = usage.date === today ? Math.max(0, Number(usage.count) || 0) : 0;

  return {
    billingEnabled: true,
    plan: 'free',
    limit: OFFICIAL_AGENT_DAILY_FREE_LIMIT,
    used,
    remaining: Math.max(0, OFFICIAL_AGENT_DAILY_FREE_LIMIT - used)
  };
}

async function consumeOfficialUsageQuota() {
  const status = await getOfficialUsageStatus();
  if (status.plan === 'pro' || status.billingEnabled === false) {
    return status;
  }

  if (status.used >= status.limit) {
    throw new Error(t(
      'agentEngineOfficialQuotaExceeded',
      `You've used today's ${status.limit} free official API requests. Upgrade to PRO or switch to your own API.`,
      [String(status.limit)]
    ));
  }

  const nextStatus = {
    ...status,
    used: status.used + 1,
    remaining: Math.max(0, status.limit - status.used - 1)
  };
  await chrome.storage.local.set({
    [AGENT_ENGINE_USAGE_STORAGE_KEY]: {
      date: getOfficialUsageDateKey(),
      count: nextStatus.used
    }
  });
  return nextStatus;
}

async function getAgentCatalogWithCustomSettings() {
  if (typeof AgentCatalog.ensureCatalogHydrated === 'function') {
    await AgentCatalog.ensureCatalogHydrated().catch(() => null);
  }

  const [
    { [AGENT_CUSTOM_SETTINGS_STORAGE_KEY]: storedSettings },
    { [CUSTOM_AGENTS_STORAGE_KEY]: localCustomAgents },
    { [CUSTOM_AGENTS_STORAGE_KEY]: syncCustomAgents },
    { [AGENT_HIDDEN_IDS_STORAGE_KEY]: hiddenAgentIds },
    { [UI_LANGUAGE_STORAGE_KEY]: uiLanguage }
  ] = await Promise.all([
    chrome.storage.sync.get(AGENT_CUSTOM_SETTINGS_STORAGE_KEY),
    chrome.storage.local.get(CUSTOM_AGENTS_STORAGE_KEY),
    chrome.storage.sync.get(CUSTOM_AGENTS_STORAGE_KEY),
    chrome.storage.local.get(AGENT_HIDDEN_IDS_STORAGE_KEY),
    chrome.storage.sync.get(UI_LANGUAGE_STORAGE_KEY)
  ]);

  const customAgents = Array.isArray(localCustomAgents) && localCustomAgents.length > 0
    ? localCustomAgents
    : (Array.isArray(syncCustomAgents) ? syncCustomAgents : []);
  const requestedLocale = typeof AgentCatalog.getRuntimeLocale === 'function'
    ? AgentCatalog.getRuntimeLocale(uiLanguage)
    : String(uiLanguage || '').trim();
  const hiddenSet = new Set(
    typeof AgentCatalog.normalizeAgentHiddenIds === 'function'
      ? AgentCatalog.normalizeAgentHiddenIds(hiddenAgentIds)
      : (Array.isArray(hiddenAgentIds) ? hiddenAgentIds.filter(Boolean) : [])
  );
  if (typeof AgentCatalog.buildCatalogWithCustomSettings === 'function') {
    const catalog = AgentCatalog.buildCatalogWithCustomSettings(storedSettings, customAgents, requestedLocale);
    return {
      ...catalog,
      agents: Array.isArray(catalog?.agents)
        ? catalog.agents.filter((agent) => agent && !hiddenSet.has(agent.id))
        : []
    };
  }

  const fallbackCatalog = typeof AgentCatalog.getCatalog === 'function'
    ? AgentCatalog.getCatalog(requestedLocale)
    : { categories: [], agents: [] };
  return {
    ...fallbackCatalog,
    agents: Array.isArray(fallbackCatalog?.agents)
      ? fallbackCatalog.agents.filter((agent) => agent && !hiddenSet.has(agent.id))
      : []
  };
}

async function getAgentByIdWithCustomSettings(agentId) {
  const normalizedAgentId = String(agentId || '').trim();
  if (!normalizedAgentId) {
    return null;
  }

  const catalog = await getAgentCatalogWithCustomSettings();
  return (catalog?.agents || []).find((agent) => agent.id === normalizedAgentId) || null;
}

function buildAgentRequestJob(payload) {
  return {
    jobId: String(payload?.jobId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    panelId: String(payload?.panelId || '').trim(),
    agentId: String(payload?.agentId || '').trim(),
    messages: Array.isArray(payload?.messages) ? payload.messages.map((message) => ({
      ...message,
      attachments: Array.isArray(message?.attachments) ? message.attachments : []
    })) : [],
    meta: payload?.meta || {},
    createdAt: Date.now(),
    status: 'queued',
    abortController: null
  };
}

function validateAgentMessageAttachments(messages = []) {
  const normalizedMessages = Array.isArray(messages) ? messages : [];
  normalizedMessages.forEach((message) => {
    const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
    attachments.forEach((attachment) => {
      const mediaCategory = String(
        attachment?.mediaCategory
        || (typeof AgentPromptUtils.getAttachmentMediaCategory === 'function'
          ? AgentPromptUtils.getAttachmentMediaCategory(attachment?.name, attachment?.type)
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

      if (typeof attachment?.dataUrl !== 'string' || !attachment.dataUrl.trim()) {
        throw new Error(
          t(
            'agentAttachmentSourceMissing',
            'The original attachment is no longer available. Please attach the file again.'
          )
        );
      }
    });
  });
}

function sendAgentRuntimeEvent(job, data) {
  chrome.runtime.sendMessage({
    type: 'agentRuntimeEvent',
    panelId: job.panelId,
    jobId: job.jobId,
    agentId: job.agentId,
    ...data
  }).catch(() => {});
}

function clearAgentKeepaliveTimer(jobId = '') {
  const normalizedJobId = String(jobId || '').trim();
  if (!normalizedJobId) return;

  const timerId = agentRuntimeState.keepaliveTimers.get(normalizedJobId);
  if (timerId) {
    clearInterval(timerId);
    agentRuntimeState.keepaliveTimers.delete(normalizedJobId);
  }
}

function releaseAgentKeepalive(jobId = '') {
  const normalizedJobId = String(jobId || '').trim();
  if (!normalizedJobId) return;

  clearAgentKeepaliveTimer(normalizedJobId);
  const port = agentRuntimeState.keepalivePorts.get(normalizedJobId);
  if (port) {
    agentRuntimeState.keepalivePorts.delete(normalizedJobId);
    try {
      port.disconnect();
    } catch (_) {}
  }
}

function attachAgentKeepalivePort(jobId, port) {
  const normalizedJobId = String(jobId || '').trim();
  if (!normalizedJobId || !port) return;

  releaseAgentKeepalive(normalizedJobId);
  agentRuntimeState.keepalivePorts.set(normalizedJobId, port);

  port.onDisconnect.addListener(() => {
    clearAgentKeepaliveTimer(normalizedJobId);
    if (agentRuntimeState.keepalivePorts.get(normalizedJobId) === port) {
      agentRuntimeState.keepalivePorts.delete(normalizedJobId);
    }
  });

  const timerId = setInterval(() => {
    if (agentRuntimeState.keepalivePorts.get(normalizedJobId) !== port) {
      clearAgentKeepaliveTimer(normalizedJobId);
      return;
    }

    try {
      port.postMessage({
        type: 'agentRuntimeKeepalive',
        jobId: normalizedJobId,
        ts: Date.now()
      });
    } catch (_) {
      releaseAgentKeepalive(normalizedJobId);
    }
  }, AGENT_RUNTIME_KEEPALIVE_INTERVAL_MS);

  agentRuntimeState.keepaliveTimers.set(normalizedJobId, timerId);
}

function removeQueuedJobsForPanel(panelId, keepJobId = '') {
  const normalizedPanelId = String(panelId || '').trim();
  if (!normalizedPanelId) return;

  agentRuntimeState.queue = agentRuntimeState.queue.filter((job) => {
    const shouldKeep = job.panelId !== normalizedPanelId || (keepJobId && job.jobId === keepJobId);
    if (!shouldKeep) {
      agentRuntimeState.jobs.delete(job.jobId);
      releaseAgentKeepalive(job.jobId);
    }
    return shouldKeep;
  });
}

function cancelAgentJob(panelId, reason = 'replaced') {
  const normalizedPanelId = String(panelId || '').trim();
  if (!normalizedPanelId) return;

  removeQueuedJobsForPanel(normalizedPanelId);
  const activeJobId = agentRuntimeState.panelJobMap.get(normalizedPanelId);
  if (!activeJobId) return;

  const activeJob = agentRuntimeState.jobs.get(activeJobId);
  if (activeJob?.abortController) {
    activeJob.status = 'cancelled';
    activeJob.abortController.abort();
    sendAgentRuntimeEvent(activeJob, {
      event: 'cancelled',
      reason
    });
  }
}

async function readChatCompletionStream(response, handlers = {}) {
  const onDelta = typeof handlers.onDelta === 'function'
    ? handlers.onDelta
    : () => {};
  const reader = response.body?.getReader?.();
  if (!reader) {
    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content || '';
    if (text) {
      onDelta(text);
    }
    return text;
  }

  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let content = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;

      let parsed;
      try {
        parsed = JSON.parse(payload);
      } catch (_) {
        continue;
      }

      const delta = parsed?.choices?.[0]?.delta?.content
        || parsed?.choices?.[0]?.delta?.reasoning_content
        || '';
      if (!delta) continue;
      content += delta;
      onDelta(delta, content);
    }
  }

  return content;
}

async function consumeAgentStream(job, response) {
  return readChatCompletionStream(response, {
    onDelta(delta) {
      sendAgentRuntimeEvent(job, {
        event: 'delta',
        delta
      });
    }
  });
}

function postStandaloneAnalysisStreamEvent(port, message = {}) {
  try {
    port.postMessage(message);
    return true;
  } catch (_) {
    return false;
  }
}

async function streamStandaloneAnalysis(port, payload = {}, requestId = '') {
  const config = await getAgentEngineConfig();
  const normalizedPrompt = String(payload?.prompt || '').trim();
  const normalizedSystemPrompt = String(payload?.systemPrompt || config.systemPrompt || '').trim();
  const normalizedRequestId = String(requestId || '').trim();

  if (!normalizedPrompt) {
    throw new Error('Analysis prompt is required');
  }
  if (!isAgentEngineRuntimeConfigured(config)) {
    throw new Error(t('agentEngineNotConfigured', 'Agent engine is not configured'));
  }
  const abortController = new AbortController();
  let disconnected = false;
  port.onDisconnect.addListener(() => {
    disconnected = true;
    abortController.abort();
  });

  const messages = [];
  if (normalizedSystemPrompt) {
    messages.push({
      role: 'system',
      content: normalizedSystemPrompt
    });
  }
  messages.push({
    role: 'user',
    content: normalizedPrompt
  });

  const response = await fetchAgentChatCompletion(config, {
      model: config.model,
      stream: true,
      thinking: {
        type: 'disabled'
      },
      messages
    }, { signal: abortController.signal });

  if (!response.ok) {
    throw new Error(await parseAgentErrorMessage(response));
  }

  postStandaloneAnalysisStreamEvent(port, {
    type: 'standaloneAnalysisStarted',
    requestId: normalizedRequestId,
    model: config.model,
    selectedSource: config.selectedSource || 'official'
  });

  let latestContent = '';
  const content = await readChatCompletionStream(response, {
    onDelta(delta, nextContent = '') {
      latestContent = String(nextContent || (latestContent + delta));
      if (disconnected) {
        return;
      }
      postStandaloneAnalysisStreamEvent(port, {
        type: 'standaloneAnalysisDelta',
        requestId: normalizedRequestId,
        delta,
        content: latestContent
      });
    }
  });

  if (!disconnected) {
    postStandaloneAnalysisStreamEvent(port, {
      type: 'standaloneAnalysisCompleted',
      requestId: normalizedRequestId,
      content,
      model: config.model,
      selectedSource: config.selectedSource || 'official'
    });
  }
}

async function parseAgentErrorMessage(response) {
  const fallback = `HTTP ${response.status}: ${response.statusText || 'Request failed'}`;

  try {
    const rawText = await response.text();
    const requestUrl = String(response?.url || '').trim();
    const isHermesLocalApi = /:\/\/(?:localhost|127\.0\.0\.1):8642\/v1\//i.test(requestUrl);
    const withAuthHint = (baseMessage) => {
      if (!isHermesLocalApi || (response.status !== 401 && response.status !== 403)) {
        return baseMessage;
      }
      return `${baseMessage} Hint: check that Hermes API server is enabled, the base URL is http://localhost:8642/v1, and the API key exactly matches API_SERVER_KEY.`;
    };

    if (!rawText) {
      return withAuthHint(fallback);
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
        return withAuthHint(`HTTP ${response.status}: ${message}`);
      }
    } catch (_) {
      // ignore json parse errors and fall back to raw text
    }

    return withAuthHint(`HTTP ${response.status}: ${rawText.trim()}`);
  } catch (_) {
    return fallback;
  }
}

async function runStandaloneAnalysis(payload = {}) {
  const config = await getAgentEngineConfig();
  const normalizedPrompt = String(payload?.prompt || '').trim();
  const normalizedSystemPrompt = String(payload?.systemPrompt || config.systemPrompt || '').trim();

  if (!normalizedPrompt) {
    throw new Error('Analysis prompt is required');
  }
  if (!isAgentEngineRuntimeConfigured(config)) {
    throw new Error(t('agentEngineNotConfigured', 'Agent engine is not configured'));
  }
  const messages = [];
  if (normalizedSystemPrompt) {
    messages.push({
      role: 'system',
      content: normalizedSystemPrompt
    });
  }
  messages.push({
    role: 'user',
    content: normalizedPrompt
  });

  const response = await fetchAgentChatCompletion(config, {
      model: config.model,
      stream: false,
      thinking: {
        type: 'disabled'
      },
      messages
  });

  if (!response.ok) {
    throw new Error(await parseAgentErrorMessage(response));
  }

  let data = null;
  try {
    data = await response.json();
  } catch (_) {
    data = null;
  }

  const content = String(
    data?.choices?.[0]?.message?.content
    || data?.choices?.[0]?.text
    || ''
  ).trim();

  if (!content) {
    throw new Error(t('agentRequestFailed', 'Skill request failed'));
  }

  return {
    content,
    model: config.model,
    selectedSource: config.selectedSource || 'official'
  };
}

async function executeAgentJob(job) {
  const agent = await getAgentByIdWithCustomSettings(job.agentId);
  const config = await getAgentEngineConfig();

  if (!agent) {
    throw new Error(t('agentUnknownError', `Unknown agent: ${job.agentId}`, [job.agentId]));
  }
  if (!isAgentEngineRuntimeConfigured(config)) {
    throw new Error(t('agentEngineNotConfigured', 'Agent engine is not configured'));
  }
  const abortController = new AbortController();
  job.abortController = abortController;
  job.status = 'running';
  agentRuntimeState.activeCount += 1;
  agentRuntimeState.panelJobMap.set(job.panelId, job.jobId);

  sendAgentRuntimeEvent(job, {
    event: 'started',
    model: config.model
  });

  try {
    const systemMessages = typeof AgentPromptUtils.buildChatMessages === 'function'
      ? AgentPromptUtils.buildChatMessages(agent, job.messages, config)
      : job.messages;

    const response = await fetchAgentChatCompletion(config, {
        model: config.model,
        stream: true,
        thinking: {
          type: 'disabled'
        },
        messages: systemMessages
      }, { signal: abortController.signal });

    if (!response.ok) {
      throw new Error(await parseAgentErrorMessage(response));
    }

    const content = await consumeAgentStream(job, response);
    job.status = 'completed';
    sendAgentRuntimeEvent(job, {
      event: 'completed',
      content
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      job.status = 'cancelled';
      return;
    }
    job.status = 'error';
    sendAgentRuntimeEvent(job, {
      event: 'error',
      error: error?.message || String(error)
    });
  } finally {
    agentRuntimeState.activeCount = Math.max(0, agentRuntimeState.activeCount - 1);
    if (agentRuntimeState.panelJobMap.get(job.panelId) === job.jobId) {
      agentRuntimeState.panelJobMap.delete(job.panelId);
    }
    agentRuntimeState.jobs.delete(job.jobId);
    releaseAgentKeepalive(job.jobId);
    flushAgentRuntimeQueue().catch((error) => {
      console.error('刷新智能体队列失败:', error);
    });
  }
}

async function flushAgentRuntimeQueue() {
  const config = await getAgentEngineConfig();
  const maxConcurrency = Math.max(1, Number(config.concurrency) || 10);

  while (agentRuntimeState.activeCount < maxConcurrency && agentRuntimeState.queue.length > 0) {
    const nextJob = agentRuntimeState.queue.shift();
    if (!nextJob) {
      break;
    }
    executeAgentJob(nextJob).catch((error) => {
      console.error('执行智能体任务失败:', error);
    });
  }
}

async function enqueueAgentJob(payload) {
  const job = buildAgentRequestJob(payload);
  if (!job.panelId || !job.agentId) {
    throw new Error('panelId and agentId are required');
  }
  validateAgentMessageAttachments(job.messages);

  cancelAgentJob(job.panelId, 'replaced');
  removeQueuedJobsForPanel(job.panelId, job.jobId);
  agentRuntimeState.jobs.set(job.jobId, job);
  agentRuntimeState.queue.push(job);

  sendAgentRuntimeEvent(job, {
    event: 'queued'
  });

  await flushAgentRuntimeQueue();
  return {
    jobId: job.jobId
  };
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === STANDALONE_ANALYSIS_STREAM_PORT_NAME) {
    let started = false;
    port.onMessage.addListener((message) => {
      if (started || message?.type !== 'startStandaloneAnalysis') {
        return;
      }
      started = true;
      streamStandaloneAnalysis(port, message.payload || {}, message.requestId || '')
        .catch((error) => {
          if (error?.name === 'AbortError') {
            return;
          }
          postStandaloneAnalysisStreamEvent(port, {
            type: 'standaloneAnalysisError',
            requestId: String(message.requestId || '').trim(),
            error: error?.message || String(error)
          });
        })
        .finally(() => {
          try {
            port.disconnect();
          } catch (_) {}
        });
    });
    return;
  }

  if (port.name !== AGENT_RUNTIME_KEEPALIVE_PORT_NAME) {
    return;
  }

  let boundJobId = '';

  port.onMessage.addListener((message) => {
    if (message?.type !== 'bindAgentRuntimeJob') {
      return;
    }

    const nextJobId = String(message.jobId || '').trim();
    if (!nextJobId) {
      return;
    }

    if (boundJobId && boundJobId !== nextJobId) {
      releaseAgentKeepalive(boundJobId);
    }

    boundJobId = nextJobId;
    attachAgentKeepalivePort(nextJobId, port);
  });

  port.onDisconnect.addListener(() => {
    if (boundJobId) {
      releaseAgentKeepalive(boundJobId);
      boundJobId = '';
    }
  });
});

// 从本地文件初始化配置到 Chrome Storage Local
async function initializeLocalConfig() {
  try {
    console.log('开始从本地文件初始化配置...');
    
    // 检查是否已经有 remoteSiteHandlers 数据
    const existingData = await chrome.storage.local.get('remoteSiteHandlers');
    if (existingData.remoteSiteHandlers && existingData.remoteSiteHandlers.sites) {
      console.log('remoteSiteHandlers 已存在，跳过本地初始化');
      return;
    }
    
    // 从本地文件读取配置
    const response = await fetch(chrome.runtime.getURL('config/siteHandlers.json'));
    if (!response.ok) {
      throw new Error(`无法读取本地配置文件: ${response.status}`);
    }
    
    const localConfig = await response.json();
    if (!localConfig.sites || localConfig.sites.length === 0) {
      throw new Error('本地配置文件中没有站点数据');
    }
    
    // 将本地配置存储到 chrome.storage.local
    await chrome.storage.local.set({
      siteConfigVersion: localConfig.version || Date.now(),
      remoteSiteHandlers: localConfig
    });
    
    console.log('本地配置初始化成功，站点数量:', localConfig.sites.length);
    console.log('配置版本:', localConfig.version || Date.now());
    
  } catch (error) {
    console.error('本地配置初始化失败:', error);
  }
}

async function initializeLocalAgentCatalog() {
  try {
    if (typeof AgentCatalog.hydrateBundledAgentCatalogIfNeeded === 'function') {
      await AgentCatalog.hydrateBundledAgentCatalogIfNeeded();
    }
  } catch (error) {
    console.error('本地技能配置初始化失败:', error);
  }
}

// 初始化默认提示词模板
function getDefaultPromptTemplates() {
  return [
    {
      id: 'risk_analysis',
      name: chrome.i18n.getMessage('defaultTemplateRiskAnalysisName') || 'Risk Review',
      query: chrome.i18n.getMessage('defaultTemplateRiskAnalysisQuery') || 'Review this topic as a risk assessment. Start with the 3-5 biggest risks, then for each one explain: why it matters, what could trigger it, how serious the impact would be, and how to prevent or reduce it. End with the single risk that deserves attention first.\n\nTopic: {query}',
      type: 'information',
      order: 1,
      isDefault: true
    },
    {
      id: 'best_practice',
      name: chrome.i18n.getMessage('defaultTemplateBestPracticeName') || 'Best Practice Checklist',
      query: chrome.i18n.getMessage('defaultTemplateBestPracticeQuery') || 'Turn this topic into a practical best-practice checklist. Start with the goal and success criteria, then list the most important practices to follow, common mistakes to avoid, and a short step-by-step plan someone can use right away.\n\nTopic: {query}',
      type: 'information',
      order: 2,
      isDefault: true
    },
    {
      id: 'translate_to_chinese',
      name: chrome.i18n.getMessage('defaultTemplateTranslateToChineseName') || 'Translate to Chinese',
      query: chrome.i18n.getMessage('defaultTemplateTranslateToChineseQuery') || 'Translate the following content into Chinese:\n\n{query}',
      type: 'information',
      order: 3,
      isDefault: true
    }
  ];
}

const LEGACY_PROMPT_TEMPLATE_SIGNATURES = {
  risk_analysis: [
    {
      name: 'RiskAnalysis',
      query: 'Root cause of the failure:「{query}」'
    },
    {
      name: 'Risk Analysis',
      query: 'Root cause of the failure:「{query}」'
    },
    {
      name: '风险分析',
      query: '导致失败的根本原因：「{query}」'
    },
    {
      name: '風險分析',
      query: '導致失敗的根本原因：「{query}」'
    },
    {
      name: 'リスク分析',
      query: 'この失敗の根本原因を分析してください:「{query}」'
    },
    {
      name: '리스크 분석',
      query: '이 실패의 근본 원인을 분석해 주세요:「{query}」'
    },
    {
      name: 'Análisis de riesgos',
      query: 'Analiza la causa raíz de este fallo:「{query}」'
    },
    {
      name: 'Analyse des risques',
      query: 'Analyse la cause racine de cet échec :「{query}」'
    },
    {
      name: 'Risikoanalyse',
      query: 'Analysiere die Grundursache dieses Scheiterns:「{query}」'
    },
    {
      name: 'Análise de risco',
      query: 'Analise a causa raiz desta falha:「{query}」'
    },
    {
      name: 'تحليل المخاطر',
      query: 'حلل السبب الجذري لهذا الفشل:「{query}」'
    }
  ],
  best_practice: [
    {
      name: 'BestPractice',
      query: 'Write a success retrospective report on this project:「{query}」'
    },
    {
      name: 'Best Practice',
      query: 'Write a success retrospective report on this project:「{query}」'
    },
    {
      name: '最佳实践',
      query: '围绕这个项目写一份成功复盘报告：「{query}」'
    },
    {
      name: '最佳實踐',
      query: '圍繞這個專案寫一份成功復盤報告：「{query}」'
    },
    {
      name: 'ベストプラクティス',
      query: 'このプロジェクトの成功レトロスペクティブレポートを書いてください:「{query}」'
    },
    {
      name: '베스트 프랙티스',
      query: '이 프로젝트에 대한 성공 회고 보고서를 작성해 주세요:「{query}」'
    },
    {
      name: 'Buenas prácticas',
      query: 'Escribe un informe de retrospectiva de éxito para este proyecto:「{query}」'
    },
    {
      name: 'Bonnes pratiques',
      query: 'Rédige un rapport de rétrospective de réussite pour ce projet :「{query}」'
    },
    {
      name: 'Best Practices',
      query: 'Schreibe einen Erfolgs-Retrospektivenbericht für dieses Projekt:「{query}」'
    },
    {
      name: 'Boas práticas',
      query: 'Escreva um relatório de retrospectiva de sucesso para este projeto:「{query}」'
    },
    {
      name: 'أفضل الممارسات',
      query: 'اكتب تقرير مراجعة نجاح لهذا المشروع:「{query}」'
    }
  ],
  translate_to_chinese: []
};

async function initializeDefaultPromptTemplates() {
  try {
    const { promptTemplates = [] } = await chrome.storage.sync.get('promptTemplates');
    const defaultTemplates = getDefaultPromptTemplates();
    const existingTemplates = Array.isArray(promptTemplates) ? promptTemplates : [];
    const existingTemplateIds = new Set(
      existingTemplates
        .map(template => template?.id)
        .filter(Boolean)
    );
    const missingTemplates = defaultTemplates.filter(template => !existingTemplateIds.has(template.id));
    const migratedTemplates = existingTemplates.map((template) => {
      const desiredTemplate = defaultTemplates.find((item) => item.id === template?.id);
      if (!desiredTemplate) {
        return template;
      }

      const legacySignatures = LEGACY_PROMPT_TEMPLATE_SIGNATURES[template.id] || [];
      const matchesKnownDefault = legacySignatures.some((signature) => {
        return String(signature?.name || '').trim() === String(template?.name || '').trim()
          && String(signature?.query || '').trim() === String(template?.query || '').trim();
      });

      if (!matchesKnownDefault) {
        return template;
      }

      const needsUpdate = (
        String(template?.name || '').trim() !== desiredTemplate.name
        || String(template?.query || '').trim() !== desiredTemplate.query
        || String(template?.type || '').trim() !== desiredTemplate.type
        || Number(template?.order || 0) !== desiredTemplate.order
        || template?.isDefault !== true
      );

      if (!needsUpdate) {
        return template;
      }

      return {
        ...template,
        name: desiredTemplate.name,
        query: desiredTemplate.query,
        type: desiredTemplate.type,
        order: desiredTemplate.order,
        isDefault: true
      };
    });
    const migrationChanged = JSON.stringify(migratedTemplates) !== JSON.stringify(existingTemplates);

    if (existingTemplates.length === 0) {
      await chrome.storage.sync.set({ promptTemplates: defaultTemplates });
      console.log('已初始化默认提示词模板');
    } else if (migrationChanged || missingTemplates.length > 0) {
      const mergedTemplates = [...migratedTemplates, ...missingTemplates]
        .sort((a, b) => (a.order || 0) - (b.order || 0));
      await chrome.storage.sync.set({ promptTemplates: mergedTemplates });
      if (migrationChanged) {
        console.log('已迁移旧版默认提示词模板');
      }
      console.log('已补充缺失的默认提示词模板:', missingTemplates.map(template => template.id));
    } else {
      console.log('提示词模板已存在，跳过初始化');
    }
  } catch (error) {
    console.error('初始化默认提示词模板失败:', error);
  }
}

const ANALYSIS_TEMPLATE_LOCALE_DIRS = [
  'ar',
  'de',
  'en',
  'es',
  'fr',
  'ja',
  'ko',
  'pt_BR',
  'zh_CN',
  'zh_TW'
];

let analysisTemplateSignaturesCache = null;

async function getDefaultAnalysisTemplateConfig() {
  try {
    const templateConfig = await self.AppConfigManager.getAnalysisPromptTemplateConfig();
    const definitions = Array.isArray(templateConfig?.defaults) ? templateConfig.defaults : [];
    return {
      defaultTemplateId: String(templateConfig?.defaultTemplateId || '').trim(),
      definitions
    };
  } catch (error) {
    console.error('读取分析提示词配置失败:', error);
    return {
      defaultTemplateId: '',
      definitions: []
    };
  }
}

async function buildRuntimeDefaultAnalysisTemplates() {
  const { definitions } = await getDefaultAnalysisTemplateConfig();
  return definitions.map((definition) => ({
    id: definition.id,
    name: chrome.i18n.getMessage(definition.nameKey) || definition.fallbackName,
    query: chrome.i18n.getMessage(definition.queryKey) || definition.fallbackQuery,
    order: definition.order,
    isDefault: true
  }));
}

const LEGACY_ANALYSIS_TEMPLATE_SIGNATURES = {
  analysis_summary: [],
  analysis_geo_diagnostic: [],
  analysis_conclusion_first: [
    {
      name: 'Conclusion First',
      query: 'Please give the conclusion first, then explain the reasons.\n\nQuestion: {question}\n\nSummary:\n{summary}\n\nRaw Answers:\n{rawAnswers}'
    },
    {
      name: '结论优先',
      query: '请先给出结论，再说明理由。\n\n问题：{question}\n\n汇总结果：\n{summary}\n\n各站原始答案：\n{rawAnswers}'
    },
    {
      name: '结论先行',
      query: '请先给出一个明确判断，再用最关键的证据支撑它。最后补充你的置信度和可能例外。\n\n问题：{question}\n\n汇总结果：\n{summary}\n\n各站原始答案：\n{rawAnswers}'
    }
  ],
  analysis_difference_focus: [
    {
      name: 'Difference Analysis',
      query: 'Focus on the shared points, differences, and conflicts across the answers, and give the most credible conclusion.\n\n{analysisInput}'
    },
    {
      name: '差异分析',
      query: '请重点比较各站回答的共同点、差异点和冲突点，并给出更可信的结论。\n\n{analysisInput}'
    }
  ],
  analysis_report: [
    {
      name: 'Structured Report',
      query: 'Please write a structured analysis report with conclusion, reasons, differences, and recommendations.\n\n{analysisInput}'
    },
    {
      name: '结构化报告',
      query: '请输出一份结构化分析报告，包含：结论、理由、差异点、建议。\n\n{analysisInput}'
    }
  ]
};

async function getLegacyAnalysisTemplateSignatures() {
  if (analysisTemplateSignaturesCache) {
    return analysisTemplateSignaturesCache;
  }

  const { definitions } = await getDefaultAnalysisTemplateConfig();
  const signatureMap = {};
  definitions.forEach(({ id }) => {
    signatureMap[id] = [];
  });
  signatureMap.analysis_conclusion_first = [];

  Object.entries(LEGACY_ANALYSIS_TEMPLATE_SIGNATURES).forEach(([id, signatures]) => {
    if (!signatureMap[id]) {
      signatureMap[id] = [];
    }
    signatureMap[id].push(...signatures);
  });

  const keyMappings = [
    ...definitions.map(({ id, nameKey, queryKey }) => ({ id, nameKey, queryKey })),
    {
      id: 'analysis_conclusion_first',
      nameKey: 'defaultAnalysisTemplateConclusionName',
      queryKey: 'defaultAnalysisTemplateConclusionQuery'
    }
  ];

  for (const localeDir of ANALYSIS_TEMPLATE_LOCALE_DIRS) {
    try {
      const response = await fetch(chrome.runtime.getURL(`_locales/${localeDir}/messages.json`));
      if (!response.ok) {
        continue;
      }

      const localeMessages = await response.json();
      keyMappings.forEach(({ id, nameKey, queryKey }) => {
        const name = String(localeMessages?.[nameKey]?.message || '').trim();
        const query = String(localeMessages?.[queryKey]?.message || '').trim();
        if (!name || !query) {
          return;
        }

        const alreadyExists = signatureMap[id].some((signature) => {
          return signature.name === name && signature.query === query;
        });
        if (!alreadyExists) {
          signatureMap[id].push({ name, query });
        }
      });
    } catch (error) {
      console.warn(`读取分析提示词 locale 失败: ${localeDir}`, error);
    }
  }

  analysisTemplateSignaturesCache = signatureMap;
  return signatureMap;
}

function shouldMigrateAnalysisTemplate(template, desiredTemplate, legacySignatures = []) {
  if (!template || !desiredTemplate || template.id !== desiredTemplate.id) {
    return false;
  }

  const currentName = String(template.name || '').trim();
  const currentQuery = String(template.query || '').trim();

  return legacySignatures.some((signature) => {
    return currentName === signature.name && currentQuery === signature.query;
  });
}

async function initializeDefaultAnalysisPromptTemplates() {
  try {
    const { analysisPromptTemplates = [] } = await chrome.storage.sync.get('analysisPromptTemplates');
    const defaultTemplates = await buildRuntimeDefaultAnalysisTemplates();
    const { defaultTemplateId: configuredDefaultTemplateId } = await getDefaultAnalysisTemplateConfig();
    const legacySignatures = await getLegacyAnalysisTemplateSignatures();
    const existingTemplates = Array.isArray(analysisPromptTemplates) ? analysisPromptTemplates : [];
    const existingWithoutRemovedDefaults = existingTemplates.filter((template) => {
      return template?.id !== 'analysis_conclusion_first';
    });
    const existingTemplateIds = new Set(
      existingWithoutRemovedDefaults
        .map(template => template?.id)
        .filter(Boolean)
    );
    const missingTemplates = defaultTemplates.filter(template => !existingTemplateIds.has(template.id));
    const migratedTemplates = existingWithoutRemovedDefaults.map((template) => {
      const desiredTemplate = defaultTemplates.find((item) => item.id === template?.id);
      const legacyTemplateSignatures = legacySignatures[template?.id] || [];
      if (!shouldMigrateAnalysisTemplate(template, desiredTemplate, legacyTemplateSignatures)) {
        return template;
      }

      return {
        ...template,
        name: desiredTemplate.name,
        query: desiredTemplate.query,
        order: desiredTemplate.order,
        isDefault: true
      };
    });
    const removedDeprecatedDefaults = existingWithoutRemovedDefaults.length !== existingTemplates.length;
    const migrationChanged = JSON.stringify(migratedTemplates) !== JSON.stringify(existingWithoutRemovedDefaults);

    if (existingWithoutRemovedDefaults.length === 0) {
      await chrome.storage.sync.set({ analysisPromptTemplates: defaultTemplates });
      const { defaultAnalysisTemplateId = '' } = await chrome.storage.sync.get('defaultAnalysisTemplateId');
      if (!String(defaultAnalysisTemplateId || '').trim() && configuredDefaultTemplateId) {
        await chrome.storage.sync.set({ defaultAnalysisTemplateId: configuredDefaultTemplateId });
      }
      console.log('已初始化默认分析提示词模板');
    } else if (removedDeprecatedDefaults || migrationChanged || missingTemplates.length > 0) {
      const mergedTemplates = [...migratedTemplates, ...missingTemplates]
        .sort((a, b) => (a.order || 0) - (b.order || 0));
      await chrome.storage.sync.set({ analysisPromptTemplates: mergedTemplates });
      const { defaultAnalysisTemplateId = '' } = await chrome.storage.sync.get('defaultAnalysisTemplateId');
      if (!String(defaultAnalysisTemplateId || '').trim() && configuredDefaultTemplateId) {
        await chrome.storage.sync.set({ defaultAnalysisTemplateId: configuredDefaultTemplateId });
      }
      if (removedDeprecatedDefaults) {
        console.log('已移除废弃的默认分析提示词模板: analysis_conclusion_first');
      }
      if (migrationChanged) {
        console.log('已迁移旧版默认分析提示词模板');
      }
      if (missingTemplates.length > 0) {
        console.log('已补充缺失的默认分析提示词模板:', missingTemplates.map(template => template.id));
      }
    } else {
      console.log('分析提示词模板已存在，跳过初始化');
    }
  } catch (error) {
    console.error('初始化默认分析提示词模板失败:', error);
  }
}

const CONTEXT_MENU_COMPARE_ROOT_ID = 'searchWithMultiAI';
const CONTEXT_MENU_DIRECT_COMPARE_ID = 'searchWithMultiAI:direct';
const CONTEXT_MENU_TEMPLATE_PREFIX = 'searchWithMultiAI:template:';

function applyPromptTemplate(templateQuery, selectedText) {
  const safeTemplate = typeof templateQuery === 'string' ? templateQuery : '';
  const safeSelection = typeof selectedText === 'string' ? selectedText : '';

  if (!safeTemplate) {
    return safeSelection;
  }

  if (safeTemplate.includes('{query}')) {
    return safeTemplate.split('{query}').join(safeSelection);
  }

  return `${safeTemplate}\n\n${safeSelection}`.trim();
}

async function getPromptTemplates() {
  try {
    const { promptTemplates = [] } = await chrome.storage.sync.get('promptTemplates');
    return promptTemplates
      .filter(template => template?.name && template?.query)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
  } catch (error) {
    console.error('加载提示词模板失败:', error);
    return [];
  }
}

function getTemplateContextMenuId(templateId) {
  return `${CONTEXT_MENU_TEMPLATE_PREFIX}${encodeURIComponent(String(templateId))}`;
}

function getPromptTemplateMenuKey(template, fallbackIndex = 0) {
  if (template?.id) {
    return String(template.id);
  }

  return `${fallbackIndex}:${template?.order || 0}:${template?.name || ''}`;
}

function parseTemplateIdFromMenuItemId(menuItemId) {
  if (typeof menuItemId !== 'string' || !menuItemId.startsWith(CONTEXT_MENU_TEMPLATE_PREFIX)) {
    return null;
  }

  return decodeURIComponent(menuItemId.slice(CONTEXT_MENU_TEMPLATE_PREFIX.length));
}

// 扩展启动时检查配置更新
chrome.runtime.onStartup.addListener(async () => {
  try {
    await applyExtensionActionBranding();
    // 开发环境调试：显示当前扩展ID
    logExtensionIdForDevelopment();
    await ensureDefaultAgentEngineConfig();
    await initializeLocalAgentCatalog();
    await initializeDefaultPromptTemplates();
    await initializeDefaultAnalysisPromptTemplates();
    
    console.log('扩展启动，检查站点配置更新...');
    if (self.RemoteConfigManager) {
      const updateInfo = await self.RemoteConfigManager.autoCheckUpdate();
      console.log('启动时站点配置检查结果:', updateInfo);
      if (updateInfo && updateInfo.hasUpdate) {
        console.log('发现新版本站点配置，自动更新');
        // 自动更新配置
        await self.RemoteConfigManager.updateLocalConfig(updateInfo.config);
        console.log('启动时站点配置更新完成');
      } else {
        console.log('启动时站点配置无需更新，原因:', updateInfo?.reason || 'unknown');
      }
    } else {
      console.error('RemoteConfigManager 未加载');
    }

    if (self.RemoteAgentConfigManager) {
      const agentUpdateInfo = await self.RemoteAgentConfigManager.autoCheckUpdate();
      console.log('启动时技能配置检查结果:', agentUpdateInfo);
    }
  } catch (error) {
    console.error('启动时检查更新失败:', error);
  }
});

// 扩展安装和更新时的统一处理
chrome.runtime.onInstalled.addListener(async (details) => {
  try {
    await applyExtensionActionBranding();
    console.log('扩展事件触发:', details.reason, '版本:', details.previousVersion, '->', chrome.runtime.getManifest().version);
    
    // 开发环境调试：显示当前扩展ID
    logExtensionIdForDevelopment();
    await ensureDefaultAgentEngineConfig();
    await initializeLocalAgentCatalog();
    
    // 初始化默认提示词模板
    await initializeDefaultPromptTemplates();
    await initializeDefaultAnalysisPromptTemplates();
    
    // 检查配置更新
    if (self.RemoteConfigManager) {
      // 首次安装时，先从本地文件初始化配置
      if (details.reason === 'install') {
        console.log('首次安装，从本地文件初始化配置');
        await initializeLocalConfig();
      }
      
      // 然后检查远程配置更新
      console.log('开始检查站点配置更新...');
      const updateInfo = await self.RemoteConfigManager.autoCheckUpdate();
      console.log('站点配置检查结果:', updateInfo);
      
      if (updateInfo && updateInfo.hasUpdate) {
        if (details.reason === 'install') {
          console.log('首次安装，获取远程最新配置');
        } else if (details.reason === 'update') {
          console.log('扩展更新，自动更新站点配置');
        }
        console.log('开始更新站点配置...');
        await self.RemoteConfigManager.updateLocalConfig(updateInfo.config);
        console.log('站点配置更新完成');
      } else {
        if (details.reason === 'install') {
          console.log('首次安装，配置已是最新');
        } else if (details.reason === 'update') {
          console.log('扩展更新，配置无需更新，原因:', updateInfo?.reason || 'unknown');
        }
      }
    }

    if (self.RemoteAgentConfigManager) {
      const agentUpdateInfo = await self.RemoteAgentConfigManager.autoCheckUpdate();
      console.log('技能配置检查结果:', agentUpdateInfo);
    }
    
    // 获取当前存储的数据
    const { favoriteSites, buttonConfig } = await chrome.storage.sync.get(['favoriteSites', 'buttonConfig']);
    const { siteSettings } = await chrome.storage.sync.get(['siteSettings']);
    
    // 处理 sites 数据 - 将完整配置存储到 local，用户设置存储到 sync
    console.log('开始初始化站点配置');
    const defaultSites = await self.getDefaultSites();
    console.log('获取到的默认站点:', defaultSites);
    
    if (defaultSites && defaultSites.length > 0) {
      console.log('站点配置已加载，数量:', defaultSites.length);
      
      // 处理用户设置（enabled 状态）
      if (siteSettings && Object.keys(siteSettings).length > 0) {
        console.log('已加载用户设置');
      }
    } else {
      console.error('无法获取默认站点配置');
    }
    
    // 只在首次安装时初始化用户设置
    if (details.reason === 'install') {
      console.log('首次安装，初始化用户设置');
      
      // 标记为新用户（用于显示 pin 引导）
      await chrome.storage.local.set({ 
        pinGuideShown: false 
      });
      console.log('已标记为新用户（pinGuideShown: false）');
      
      // 处理 favoriteSites 数据
      if (!favoriteSites || !favoriteSites.length) {
        const defaultFavoriteSites = await self.AppConfigManager.getDefaultFavoriteSites();
        await chrome.storage.sync.set({ 
          favoriteSites: defaultFavoriteSites 
        });
        console.log('已初始化 favoriteSites:', defaultFavoriteSites);
      }

      // 处理 buttonConfig 数据
      if (!buttonConfig) {
        const defaultButtonConfig = await self.AppConfigManager.getButtonConfig();
        await chrome.storage.sync.set({ buttonConfig: defaultButtonConfig });
        console.log('已初始化 buttonConfig:', defaultButtonConfig);
      }

      // 首次安装后自动打开首页
      chrome.tabs.create({
        url: chrome.runtime.getURL('homepage/homepage.html')
      });
    } else if (details.reason === 'update') {
      console.log('扩展更新，保持用户设置不变');
      
      // 扩展更新时，只在必要时合并新配置
      if (buttonConfig) {
        const defaultButtonConfig = await self.AppConfigManager.getButtonConfig();
        // 检查是否有新的配置项需要添加
        const hasNewConfig = Object.keys(defaultButtonConfig).some(key => !(key in buttonConfig));
        if (hasNewConfig) {
          const mergedButtonConfig = {
            ...defaultButtonConfig,  // 使用默认配置作为基础
            ...buttonConfig          // 保持用户的现有设置
          };
          await chrome.storage.sync.set({ buttonConfig: mergedButtonConfig });
          console.log('已合并新配置项到 buttonConfig:', mergedButtonConfig);
        }
      }
    }
    
    // 创建右键菜单
    createContextMenu();
    
    console.log('Extension installed');
  } catch (error) {
    console.error('初始化失败:', error);
  }
});

async function syncCompatibilitySessionRules() {
  if (!chrome?.declarativeNetRequest?.getSessionRules || !chrome?.declarativeNetRequest?.updateSessionRules) {
    console.warn('declarativeNetRequest session rules are unavailable in this browser');
    return;
  }

  try {
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    console.log('当前生效的规则:', rules);
  } catch (error) {
    console.warn('读取 session rules 失败:', error);
  }

  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [999],
      addRules: [{
        id: 999,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          responseHeaders: [
            {
              header: 'content-security-policy',
              operation: 'remove'
            },
            {
              header: 'x-frame-options',
              operation: 'remove'
            }
          ]
        },
        condition: {
          urlFilter: '*://*/*',
          resourceTypes: ['main_frame', 'sub_frame']
        }
      }]
    });

    const updatedRules = await chrome.declarativeNetRequest.getSessionRules();
    console.log('更新后的规则:', updatedRules);
  } catch (error) {
    console.warn('更新 session rules 失败，继续使用静态规则:', error);
  }
}

syncCompatibilitySessionRules();





// 处理右键菜单点击和消息
chrome.contextMenus.onClicked.addListener((info, tab) => {
  (async () => {
    if (
      (info.menuItemId === CONTEXT_MENU_COMPARE_ROOT_ID ||
        info.menuItemId === CONTEXT_MENU_DIRECT_COMPARE_ID) &&
      info.selectionText
    ) {
      await openSearchTabs(info.selectionText, null, {
        openExternalSites: false
      });
      return;
    }

    const templateId = parseTemplateIdFromMenuItemId(info.menuItemId);
    if (templateId && info.selectionText) {
      const templates = await getPromptTemplates();
      const template = templates.find((item, index) => getPromptTemplateMenuKey(item, index) === templateId);
      const formattedQuery = template
        ? applyPromptTemplate(template.query, info.selectionText)
        : info.selectionText;

      await openSearchTabs(formattedQuery, null, {
        openExternalSites: false
      });
      return;
    }

    if (info.menuItemId === "openOptions") {
      // 打开选项页面
      await chrome.tabs.create({
        url: chrome.runtime.getURL('options/options.html')
      });
      return;
    }

    if (info.menuItemId === "openHistory") {
      // 打开历史记录页面
      await chrome.tabs.create({
        url: chrome.runtime.getURL('history/history.html')
      });
      return;
    }

    if (info.menuItemId === "openFavorites") {
      // 打开收藏记录页面
      await chrome.tabs.create({
        url: chrome.runtime.getURL('favorites/favorites.html')
      });
    }
  })().catch(error => {
    console.error('处理右键菜单点击失败:', error, info, tab);
  });
});

// 处理来自 float-button 和 popup 和 content-scripts 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('收到消息:', message);
  
  if (message.action === 'createComparisonPage') {
    console.log('createComparisonPage-opensearchtab:', message.query);
    openSearchTabs(message.query, null, {
      openExternalSites: false
    }).then((result) => {
      sendResponse({ success: true, result });
    }).catch(error => {
      console.error('创建对比页面失败:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true; // 保持消息通道开放
  } 
  else if (message.action === 'processQuery') {
    // 添加对 processQuery 消息的处理
    console.log('processQuery:', message.query, message.sites, message.customSiteIds);
    openSearchTabs(message.query, message.sites, {
      openIframePage: message.openIframePage !== false,
      customSiteIds: message.customSiteIds,
      openExternalSites: true
    }).then((result) => {
      sendResponse({ success: true, result });
    }).catch(error => {
      console.error('处理查询失败:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true; // 保持消息通道开放
  }
  else if (message.action === 'singleSiteSearch') {
    console.log('singleSiteSearch:', message.query, message.siteName);
    handleSingleSiteSearch(message.query, message.siteName).then(() => {
      sendResponse({ success: true });
    }).catch(error => {
      console.error('单站点搜索失败:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true; // 保持消息通道开放
  }
  else if (message.action === 'openOptionsPage') {
    // 立即打开设置页面
    chrome.tabs.create({
      url: chrome.runtime.getURL('options/options.html')
    });
    sendResponse({ success: true });
  }
  else if (message.action === 'initializeDefaultTemplates') {
    // 手动触发默认提示词模板初始化
    Promise.all([
      initializeDefaultPromptTemplates(),
      initializeDefaultAnalysisPromptTemplates()
    ]).then(() => {
      sendResponse({ success: true });
    }).catch(error => {
      console.error('手动初始化默认模板失败:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true; // 保持消息通道开放
  }
  else if (message.action === 'getAgentCatalog') {
    getAgentCatalogWithCustomSettings().then((catalog) => {
      sendResponse({
        success: true,
        result: catalog
      });
    }).catch((error) => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }
  else if (message.action === 'getAgentEngineConfig') {
    getAgentEngineConfig().then((config) => {
      sendResponse({
        success: true,
        result: {
          selectedSource: config.selectedSource || 'official',
          baseUrl: config.baseUrl,
          model: config.model,
          concurrency: config.concurrency,
          systemPrompt: config.systemPrompt,
          hasApiKey: isAgentEngineRuntimeConfigured(config)
        }
      });
    }).catch((error) => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }
  else if (message.action === 'agentChat') {
    enqueueAgentJob(message.payload || {}).then((result) => {
      sendResponse({ success: true, result });
    }).catch((error) => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }
  else if (message.action === 'runStandaloneAnalysis') {
    runStandaloneAnalysis(message.payload || {}).then((result) => {
      sendResponse({ success: true, result });
    }).catch((error) => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }
  else if (message.action === 'cancelAgentChat') {
    try {
      cancelAgentJob(String(message.panelId || '').trim(), 'cancelled');
      sendResponse({ success: true });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
    return true;
  }
  else if (message.action === 'webdavImport') {
    // 从 options 页面委托执行的 WebDAV 拉取，在 service worker 中 fetch 避免 CORS/跨域限制
    webdavDownload()
      .then(() => sendResponse({ success: true }))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true; // 保持消息通道开放
  }
  else if (message.action === 'webdavAutoDownload') {
    // 首页每次打开时触发一次云端拉取（静默模式）
    webdavDownload()
      .then(() => sendResponse({ success: true }))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true; // 保持消息通道开放
  }
  else if (message.action === 'googleDriveConnect') {
    googleDriveConnect()
      .then((result) => sendResponse({ success: true, result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }
  else if (message.action === 'googleDriveDisconnect') {
    googleDriveDisconnect()
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }
  else if (message.action === 'googleDriveGetStatus') {
    getGoogleDriveStatus()
      .then((result) => sendResponse({ success: true, result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }
  else if (message.action === 'googleDriveImport') {
    googleDriveDownload()
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }
  else if (message.action === 'googleDriveAutoDownload') {
    googleDriveDownload({ silent: true })
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }
  else if (message.type === 'TOGGLE_SIDE_PANEL') {
    // 处理侧边栏切换消息
    const windowId = sender.tab.windowId;
    console.log('🔍 收到TOGGLE_SIDE_PANEL消息，windowId:', windowId);
    
    // 在打开侧边栏之前，设置路径并添加 side_panel 参数
    // 注意：setOptions 必须在用户手势响应中同步调用，且不能包含 windowId
    if (chrome.sidePanel && chrome.sidePanel.setOptions) {
      try {
        chrome.sidePanel.setOptions({
          path: 'homepage/homepage.html?side_panel=true',
          enabled: true
        });
        console.log('✅ 已设置侧边栏路径（带 side_panel 参数）');
      } catch (setOptionsError) {
        console.warn('⚠️ 设置侧边栏路径失败，使用默认路径:', setOptionsError);
      }
    }
    
    // 同步调用 sidePanel.open()，保持用户手势上下文
    if (chrome.sidePanel && chrome.sidePanel.open) {
      chrome.sidePanel.open({ windowId }).then(() => {
        sidePanelOpenState.set(windowId, true);
        console.log('✅ 侧边栏已打开');
      }).catch((error) => {
        console.error('❌ 打开侧边栏失败:', error);
        sidePanelOpenState.set(windowId, false);
      });
    } else {
      console.error('❌ 当前浏览器不支持 sidePanel API');
    }
    
    // 立即返回成功响应
    sendResponse({ success: true });
    return true; // 保持消息通道开放
  }
});

// 处理来自 iframe 的消息
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.action === 'executeHandler') {
    (async () => {
      const siteHandler = await getHandlerForUrl(message.url);
      if (siteHandler && siteHandler.searchHandler) {
        executeSiteHandler(sender.tab.id, message.query, siteHandler).catch(error => {
          console.error('站点处理失败:', error);
        });
      }
    })().catch((error) => {
      console.error('处理 iframe 消息失败:', error);
    });
  }
});





// 站点处理函数集合
// 站点处理函数已迁移到 siteHandlers.json 中的 searchHandler 字段

// 执行站点处理函数 - 使用配置化处理器
async function executeSiteHandler(tabId, query, siteHandler) {
  try {
    console.log(`开始处理 ${siteHandler.name} 站点, tabId:`, tabId);
    console.log('待发送的查询:', query);
    
    // 先激活标签页
    await chrome.tabs.update(tabId, { active: true });
    const tab = await chrome.tabs.get(tabId);
    console.log('标签页状态:', {
      id: tab.id,
      url: tab.url,
      status: tab.status,
      active: tab.active
    });

    try {
      // 给页面一点加载时间
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // 使用配置化处理器 - 发送消息到页面的 inject.js
      await chrome.tabs.sendMessage(tabId, {
        type: 'search',
        query: query,
        domain: new URL(tab.url).hostname
      });
      
      console.log('已发送配置化处理消息到页面');
    } catch (scriptError) {
      console.error('发送配置化处理消息失败:', scriptError);
      throw scriptError;
    }
  } catch (error) {
    console.error(`${siteHandler.name} 处理过程出错:`, error);
    throw error;
  }
}

function waitForTabComplete(tabId) {
  return new Promise((resolve) => {
    const listener = (updatedTabId, info) => {
      if (updatedTabId === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function openOfficialSiteTab(siteConfig, query) {
  if (!siteConfig) {
    return null;
  }

  const launchTarget = SiteLaunchUtils.resolveOfficialLaunchTarget(siteConfig, query);
  if (!launchTarget.url) {
    console.warn('站点没有可用的启动 URL:', siteConfig.name);
    return null;
  }

  console.log('打开官方站点:', {
    siteName: siteConfig.name,
    url: launchTarget.url,
    shouldAutoRun: launchTarget.shouldAutoRun,
    source: launchTarget.source
  });

  const tab = await chrome.tabs.create({
    url: launchTarget.url,
    active: true
  });

  if (launchTarget.shouldAutoRun) {
    await waitForTabComplete(tab.id);
    await executeSiteHandler(tab.id, query, {
      name: siteConfig.name,
      searchHandler: siteConfig.searchHandler,
      supportUrlQuery: siteConfig.supportUrlQuery,
      entryUrl: siteConfig.entryUrl
    });
  }

  return {
    tab,
    launchTarget
  };
}

async function openCustomSiteTab(customSite) {
  if (!customSite) {
    return null;
  }

  const launchTarget = SiteLaunchUtils.resolveCustomLaunchTarget(customSite);
  if (!launchTarget.url) {
    console.warn('custom site 没有可用的启动 URL:', customSite.name);
    return null;
  }

  console.log('打开 custom site:', {
    siteName: customSite.name,
    url: launchTarget.url,
    supportIframe: customSite.supportIframe === true
  });

  const tab = await chrome.tabs.create({
    url: launchTarget.url,
    active: true
  });

  return {
    tab,
    launchTarget
  };
}

// 根据 URL 获取处理函数
async function getHandlerForUrl(url) {
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
    
    // 优先使用新的统一站点检测器
    if (self.siteDetector) {
      const siteHandler = await self.siteDetector.getSiteHandler(hostname);
      if (siteHandler) {
        console.log(`✅ 使用新检测器找到站点配置: ${siteHandler.name}`);
        return {
          name: siteHandler.name,
          searchHandler: siteHandler.searchHandler,
          supportUrlQuery: siteHandler.supportUrlQuery,
          deepResearchHandler: siteHandler.deepResearchHandler
        };
      }
    }
    
    // 降级到原有逻辑
    let sites = [];
    try {
      const result = await chrome.storage.local.get('remoteSiteHandlers');
      sites = result.remoteSiteHandlers?.sites || [];
    } catch (error) {
      console.error('从 remoteSiteHandlers 读取配置失败:', error);
    }
    
    // 如果存储中没有数据，尝试从远程配置获取
    if (!sites || sites.length === 0) {
      console.log('remoteSiteHandlers 中无数据，尝试从远程配置获取...');
      if (self.RemoteConfigManager) {
        sites = await self.RemoteConfigManager.getCurrentSites();
      }
    }
    
    if (!sites || sites.length === 0) {
      console.warn('没有找到站点配置');
      return null;
    }
    
    // 查找匹配的站点
    for (const site of sites) {
      if (!site.url) continue;
      
      try {
        const siteUrl = new URL(site.url);
        const siteDomain = siteUrl.hostname;
        
        // 直接匹配域名
        if (hostname === siteDomain) {
          console.log('找到匹配站点:', site.name);
          return {
            name: site.name,
            searchHandler: site.searchHandler,
            supportUrlQuery: site.supportUrlQuery,
            deepResearchHandler: site.deepResearchHandler
          };
        }
        
        // 模糊匹配域名
        if (hostname.includes(siteDomain) || siteDomain.includes(hostname)) {
          console.log('找到匹配站点:', site.name);
          return {
            name: site.name,
            searchHandler: site.searchHandler,
            supportUrlQuery: site.supportUrlQuery,
            deepResearchHandler: site.deepResearchHandler
          };
        }
      } catch (urlError) {
        // 如果URL解析失败，跳过这个站点
        continue;
      }
    }
    
    console.log('未找到对应的处理函数');
    return null;
  } catch (error) {
    console.error('URL 解析失败:', error, 'URL:', url);
    return null;
  }
}

  // 处理单站点搜索
  async function handleSingleSiteSearch(query, siteName) {
    console.log('开始处理单站点搜索:', query, siteName);

  try {
    console.log('handleSingleSiteSearch处理单站点搜索:', query, siteName);
    const sites = await self.getDefaultSites();
    if (!sites || !sites.length) {
      console.error('未找到站点配置');
      return;
    }
    const siteConfig = sites.find(site => site.name === siteName);
    if (!siteConfig) {
      console.error('未找到站点配置:', siteName);
      return;
    }
    
    // 检查站点是否被隐藏
    if (siteConfig.hidden) {
      console.error('站点已被隐藏，无法使用:', siteName);
      return;
    }

    await openOfficialSiteTab(siteConfig, query);
  } catch (error) {
    console.error('单站点搜索失败:', error);
  }
}

// 修改后的 openSearchTabs 函数
async function openSearchTabs(query, checkedSites = null, options = {}) {
  console.log('开始执行多AI查询 查询词:', query);
  const shouldOpenIframePage = options.openIframePage !== false;
  const shouldOpenExternalSites = options.openExternalSites === true;
  const requestedCustomSiteIds = Array.isArray(options.customSiteIds)
    ? options.customSiteIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];

  const [sites, customSites] = await Promise.all([
    self.getDefaultSites(),
    typeof self.getCustomSites === 'function' ? self.getCustomSites() : Promise.resolve([])
  ]);
  
  if ((!sites || !sites.length) && (!customSites || !customSites.length)) {
    console.error('未找到AI站点配置');
    return {
      iframeSiteNames: [],
      externalSiteNames: [],
      customIframeSiteNames: [],
      customExternalSiteNames: [],
      openedIframePage: false
    };
  }
  
  const selectedOfficialSites = checkedSites
    ? sites.filter(site => checkedSites.includes(site.name) && !site.hidden)
    : sites.filter(site => site.enabled && !site.hidden);
  const selectedCustomSites = requestedCustomSiteIds.length > 0
    ? customSites.filter(site => requestedCustomSiteIds.includes(site.id) || requestedCustomSiteIds.includes(site.name))
    : [];
    
  console.log('符合条件的官方站点:', selectedOfficialSites);
  console.log('符合条件的 customSites:', selectedCustomSites);

  const iframeSites = selectedOfficialSites.filter(site => site.supportIframe === true);
  const externalSites = selectedOfficialSites.filter(site => site.supportIframe !== true);

  const customIframeSites = shouldOpenIframePage
    ? selectedCustomSites.filter(site => site.supportIframe === true)
    : [];
  const customExternalSites = shouldOpenExternalSites
    ? (shouldOpenIframePage
      ? selectedCustomSites.filter(site => site.supportIframe !== true)
      : selectedCustomSites)
    : [];

  if (shouldOpenExternalSites && externalSites.length > 0) {
    console.log('找到不支持 iframe 的官方站点，将使用新标签页打开:', externalSites);
    openSitesSequentially(externalSites, (site) => openOfficialSiteTab(site, query)).catch(error => {
      console.error('逐个打开非 iframe 官方站点失败:', error);
    });
  }

  if (customExternalSites.length > 0) {
    console.log('找到需要外部打开的 customSites:', customExternalSites);
    openSitesSequentially(customExternalSites, openCustomSiteTab).catch(error => {
      console.error('逐个打开 customSites 失败:', error);
    });
  }

  let openedIframePage = false;

  if ((iframeSites.length > 0 || customIframeSites.length > 0) && shouldOpenIframePage) {
      console.log('找到支持 iframe 的站点:', {
        official: iframeSites,
        custom: customIframeSites
      });
      
      const newTab = await chrome.tabs.create({
          url: chrome.runtime.getURL(`iframe/iframe.html?query=${encodeURIComponent(query)}`),
          active: true
      });

      // 等待新标签页加载完成
      chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
          if (tabId === newTab.id && info.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              
              // 向新标签页发送消息,传递查询词和需要加载的站点信息
              chrome.tabs.sendMessage(newTab.id, {
                  type: 'loadIframes',
                  query: query,
                  sites: iframeSites,
                  customSites: customIframeSites
              });
          }
      });
      openedIframePage = true;
  }

  return {
      iframeSiteNames: iframeSites.map(site => site.name).filter(Boolean),
      externalSiteNames: externalSites.map(site => site.name).filter(Boolean),
      customIframeSiteNames: customIframeSites.map(site => site.name).filter(Boolean),
      customExternalSiteNames: customExternalSites.map(site => site.name).filter(Boolean),
      openedIframePage
  };
}

async function openSitesSequentially(sites, opener) {
  for (const site of sites) {
    try {
      await opener(site);
    } catch (error) {
      console.error(`站点打开失败: ${site?.name || 'unknown'}`, error);
    }
  }
}

// 获取网站的基本域名
function getBaseDomain(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return hostname;
  //  const parts = hostname.split('.');
  //  return parts.slice(-2).join('.');
  } catch (e) {
    console.error('URL解析失败:', url);
    return url;
  }
}

// 查找已存在的标签页
function findExistingTab(tabs, targetDomain) {
  return tabs.find(tab => {
    try {
      return getBaseDomain(tab.url) === targetDomain;
    } catch (e) {
      return false;
    }
  });
} 

// 处理扩展图标点击事件
chrome.action.onClicked.addListener((tab) => {
  // 打开新标签页显示精简首页 homepage.html
  chrome.tabs.create({
    url: chrome.runtime.getURL('homepage/homepage.html')
  });
});

applyExtensionActionBranding();


// 错误处理监听器已移除，避免干扰其他消息处理

// 添加基本的生命周期处理
self.addEventListener('install', (event) => {
    console.log('Service Worker 安装');
});

self.addEventListener('activate', (event) => {
    console.log('Service Worker 激活');
});

// 添加错误处理
self.addEventListener('error', (error) => {
    console.error('Service Worker 错误:', error);
});

const REMOTE_RECONNECT_ALARM = 'remote-search-reconnect';
let remoteSearchRuntime = null;
let remoteSearchRuntimePromise = null;

async function ensureRemoteSearchRuntime() {
  if (remoteSearchRuntime) {
    return remoteSearchRuntime;
  }

  if (!remoteSearchRuntimePromise) {
    remoteSearchRuntimePromise = (async () => {
      if (!self.AIRemoteRuntimeFactory || typeof self.AIRemoteRuntimeFactory.createRemoteRuntime !== 'function') {
        throw new Error('AIRemoteRuntimeFactory is not available.');
      }

      const runtime = self.AIRemoteRuntimeFactory.createRemoteRuntime({
        chromeApi: chrome,
        storageArea: chrome.storage.local,
        fetchImpl: fetch.bind(globalThis),
        WebSocketImpl: WebSocket,
        logger: console
      });
      await runtime.initialize();
      remoteSearchRuntime = runtime;
      return runtime;
    })().catch((error) => {
      remoteSearchRuntimePromise = null;
      console.error('初始化远程搜索运行时失败:', error);
      throw error;
    });
  }

  return remoteSearchRuntimePromise;
}

function createRemoteReconnectAlarm() {
  if (!chrome.alarms || typeof chrome.alarms.create !== 'function') {
    return;
  }

  chrome.alarms.create(REMOTE_RECONNECT_ALARM, {
    periodInMinutes: 1
  });
}

chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm?.name !== REMOTE_RECONNECT_ALARM) {
    return;
  }

  ensureRemoteSearchRuntime()
    .then((runtime) => runtime.ensureConnection())
    .catch((error) => {
      console.error('远程搜索重连检查失败:', error);
    });
});

chrome.notifications?.onButtonClicked.addListener((notificationId, buttonIndex) => {
  ensureRemoteSearchRuntime()
    .then((runtime) => runtime.handleNotificationClick(notificationId, buttonIndex))
    .catch((error) => {
      console.error('处理远程配对通知按钮失败:', error);
    });
});

chrome.notifications?.onClicked.addListener((notificationId) => {
  if (notificationId !== (self.AIRemoteCommon?.NOTIFICATION_IDS?.PAIR_REQUEST || 'remote-search-pair-request')) {
    return;
  }

  ensureRemoteSearchRuntime()
    .then((runtime) => runtime.openOptionsRemoteSearch())
    .catch((error) => {
      console.error('打开远程搜索设置页失败:', error);
    });
});

chrome.tabs?.onRemoved.addListener((tabId) => {
  ensureRemoteSearchRuntime()
    .then((runtime) => runtime.handleTabRemoved(tabId))
    .catch((error) => {
      console.error('处理远程搜索标签页关闭失败:', error);
    });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const remoteActions = new Set([
    'remoteGetState',
    'remoteUpdateSettings',
    'remoteCreatePairingTicket',
    'remoteApprovePendingPair',
    'remoteRejectPendingPair',
    'remoteRevokePairing',
    'remoteSearchProgress'
  ]);

  if (!remoteActions.has(message?.action)) {
    return undefined;
  }

  ensureRemoteSearchRuntime()
    .then((runtime) => runtime.handleMessage(message, sender))
    .then((result) => {
      sendResponse({
        success: true,
        result
      });
    })
    .catch((error) => {
      console.error('远程搜索消息处理失败:', error);
      sendResponse({
        success: false,
        error: error?.message || String(error)
      });
    });

  return true;
});

createRemoteReconnectAlarm();
void ensureRemoteSearchRuntime().catch((error) => {
  console.warn('远程搜索运行时启动失败:', error);
});

// 捕获未处理的 Promise rejection
self.addEventListener('unhandledrejection', (event) => {
    // 忽略 "No SW" 错误，这是 Chrome 扩展的正常行为
    if (event.reason && event.reason.message && event.reason.message.includes('No SW')) {
        // 静默处理，不输出错误
        event.preventDefault();
        return;
    }
    console.error('未处理的 Promise rejection:', event.reason);
    event.preventDefault(); // 防止错误显示在控制台
});


// 防抖变量，避免短时间内多次调用
let contextMenuTimeout = null;

// 创建右键菜单
async function createContextMenu() {
  // 清除之前的定时器
  if (contextMenuTimeout) {
    clearTimeout(contextMenuTimeout);
  }
  
  // 设置防抖延迟
  contextMenuTimeout = setTimeout(async () => {
    try {
      // 先移除所有现有菜单，然后创建新菜单
      // 这样可以避免重复创建的问题
      await chrome.contextMenus.removeAll();
      
      // 创建扩展图标上的右键菜单（选项、历史记录、收藏记录）
      chrome.contextMenus.create({
        id: "openOptions",
        title: chrome.i18n.getMessage("settingsLink") || "选项",
        contexts: ["action"]  // 在扩展图标上右键时显示
      });
      
      chrome.contextMenus.create({
        id: "openHistory",
        title: chrome.i18n.getMessage("historyLink") || "历史记录",
        contexts: ["action"]  // 在扩展图标上右键时显示
      });
      
      chrome.contextMenus.create({
        id: "openFavorites",
        title: chrome.i18n.getMessage("favoritesLink") || "收藏记录",
        contexts: ["action"]  // 在扩展图标上右键时显示
      });
      
      // 获取配置
      const { buttonConfig } = await chrome.storage.sync.get('buttonConfig');
      
      // 检查是否启用页面右键菜单（选中文本时的菜单）
      if (buttonConfig && buttonConfig.contextMenu) {
        const promptTemplates = await getPromptTemplates();

        // 创建页面上的右键菜单（选中文本时显示）
        chrome.contextMenus.create({
          id: CONTEXT_MENU_COMPARE_ROOT_ID,
          title: chrome.i18n.getMessage("searchWithMultiAI"),
          contexts: ["selection"]  // 只在选中文本时显示
        });

        chrome.contextMenus.create({
          id: CONTEXT_MENU_DIRECT_COMPARE_ID,
          parentId: CONTEXT_MENU_COMPARE_ROOT_ID,
          title: chrome.i18n.getMessage("contextMenuDirectCompare") || "Direct Compare",
          contexts: ["selection"]
        });

        promptTemplates.forEach((template, index) => {
          const templateMenuKey = getPromptTemplateMenuKey(template, index);
          chrome.contextMenus.create({
            id: getTemplateContextMenuId(templateMenuKey),
            parentId: CONTEXT_MENU_COMPARE_ROOT_ID,
            title: template.name,
            contexts: ["selection"]
          });
        });

        console.log('页面右键菜单已创建');
      }
      
      console.log('扩展图标右键菜单已创建');
    } catch (error) {
      console.error('创建右键菜单失败:', error);
    }
  }, 100); // 100ms 防抖延迟
}

// 监听存储变化，当配置更改时更新右键菜单
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync' && (changes.buttonConfig || changes.promptTemplates || changes.analysisPromptTemplates)) {
    createContextMenu();
  }
});

// ── WebDAV 自动同步 ────────────────────────────────────────────
const WEBDAV_SYNC_KEY      = 'webdavSyncConfig';
const WEBDAV_SYNC_FILENAME = 'multiAI-settings.json';
const WEBDAV_SYNC_KEYS = [
  'buttonConfig', 'sites', 'customSites',
  'siteSettings', 'disabledSites', 'promptTemplates', 'analysisPromptTemplates',
  'favoritePrompts', 'favoriteSites', AGENT_ENGINE_STORAGE_KEY, AGENT_ENGINE_SETTINGS_STORAGE_KEY, AGENT_CUSTOM_SETTINGS_STORAGE_KEY,
];
const WEBDAV_LOCAL_SYNC_KEYS = ['pkHistory', 'favoriteFolders', AGENT_ENGINE_SECRET_STORAGE_KEY, CUSTOM_AGENTS_STORAGE_KEY, AGENT_HIDDEN_IDS_STORAGE_KEY];

function getGoogleDriveClientId() {
  const firebaseValue = String(globalThis.FirebaseConfig?.googleClientId || '').trim();
  if (firebaseValue) {
    return firebaseValue;
  }

  const manifestValue = String(
    chrome?.runtime?.getManifest?.()?.oauth2?.client_id || ''
  ).trim();
  return manifestValue || '';
}

async function getGoogleDriveConfig() {
  const { [DRIVE_SYNC_CONFIG_KEY]: cfg = {} } = await chrome.storage.local.get(DRIVE_SYNC_CONFIG_KEY);
  return cfg;
}

async function setGoogleDriveConfig(patch = {}) {
  const current = await getGoogleDriveConfig();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [DRIVE_SYNC_CONFIG_KEY]: next });
  return next;
}

async function clearGoogleDriveConfig() {
  await chrome.storage.local.remove(DRIVE_SYNC_CONFIG_KEY);
}

async function clearGoogleDriveCachedToken(token) {
  const normalizedToken = String(token || '').trim();
  if (!normalizedToken) {
    return;
  }

  try {
    if (chrome.identity?.removeCachedAuthToken) {
      await chrome.identity.removeCachedAuthToken({ token: normalizedToken });
    }
  } catch (error) {
    console.warn('[Google Drive Sync] remove cached token failed:', error.message);
  }
}

async function tryChromeIdentityDriveToken({ interactive = false } = {}) {
  if (!chrome.identity?.getAuthToken) {
    return null;
  }

  try {
    const result = await chrome.identity.getAuthToken({
      interactive,
      scopes: [DRIVE_SYNC_SCOPE]
    });
    const token = String(result?.token || result || '').trim();
    if (!token) {
      return null;
    }

    await setGoogleDriveConfig({
      enabled: true,
      accessToken: token,
      expiresAt: Date.now() + 55 * 60 * 1000,
      authProvider: 'chromeIdentity'
    });

    return token;
  } catch (error) {
    if (interactive || String(error?.message || '').trim()) {
      console.warn('[Google Drive Sync] chrome.identity.getAuthToken failed:', error.message);
    }
    return null;
  }
}

function launchWebAuthFlowAsync(url) {
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url, interactive: true }, (redirectedTo) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message || 'Google authorization failed'));
        return;
      }
      resolve(redirectedTo || '');
    });
  });
}

function parseGoogleDriveOAuthCallback(callbackUrl, redirectUri) {
  if (!callbackUrl.startsWith(redirectUri)) {
    throw new Error(
      t(
        'googleDriveSyncInvalidRedirect',
        'Google authorization did not return a valid redirect'
      )
    );
  }
  const url = new URL(callbackUrl);
  const hash = url.hash ? url.hash.slice(1) : '';
  const hashParams = new URLSearchParams(hash);
  const queryParams = url.search ? new URLSearchParams(url.search.slice(1)) : new URLSearchParams();
  const params = hashParams.toString() ? hashParams : queryParams;
  const oauthError = params.get('error');
  const oauthErrorDescription = params.get('error_description');
  const oauthErrorSubtype = params.get('error_subtype');

  if (oauthError) {
    const detailParts = [oauthError, oauthErrorDescription, oauthErrorSubtype].filter(Boolean);
    throw new Error(
      t('googleDriveSyncAuthorizationFailed', 'Google authorization failed')
      + (detailParts.length ? `: ${detailParts.join(' | ')}` : '')
    );
  }

  const accessToken = params.get('access_token');
  const expiresIn = Math.max(300, Number(params.get('expires_in')) || 3600);
  if (!accessToken) {
    throw new Error(
      t(
        'googleDriveSyncMissingAccessToken',
        'No Google Drive access token was returned'
      )
    );
  }
  return { accessToken, expiresIn };
}

async function fetchGoogleProfile(accessToken) {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) {
    throw new Error(await buildGoogleApiErrorMessage(res, 'Failed to load Google account'));
  }
  const profile = await res.json();
  return {
    email: String(profile.email || '').trim(),
    name: String(profile.name || '').trim(),
    picture: String(profile.picture || '').trim()
  };
}

async function runGoogleDriveInitialSync() {
  try {
    await googleDriveDownload({ interactive: false });
    return;
  } catch (error) {
    const message = String(error?.message || '').trim();
    if (!/No Google Drive backup was found/i.test(message)) {
      await setGoogleDriveConfig({
        lastError: message
      });
      console.warn('[Google Drive Sync] initial download failed:', message);
      return;
    }
  }

  try {
    await setGoogleDriveConfig({
      lastError: ''
    });
    await googleDriveUpload({ interactive: false });
  } catch (error) {
    const message = String(error?.message || '').trim();
    await setGoogleDriveConfig({
      lastError: message
    });
    console.warn('[Google Drive Sync] initial upload failed:', message);
  }
}

async function googleDriveConnect() {
  if (googleDriveConnectInFlight) {
    return googleDriveConnectInFlight;
  }

  googleDriveConnectInFlight = (async () => {
  let accessToken = '';
  let expiresIn = 55 * 60;

  const clientId = getGoogleDriveClientId();
  if (!clientId) {
    throw new Error(
      t(
        'googleDriveSyncMissingClientId',
        'Missing Google client ID for Drive sync'
      )
    );
  }

  if (!chrome.identity?.launchWebAuthFlow) {
    throw new Error(
      t(
        'googleDriveSyncBrowserUnsupported',
        'This browser does not support Google authorization'
      )
    );
  }

  const redirectUri = `https://${chrome.runtime.id}.chromiumapp.org/`;
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'token');
  authUrl.searchParams.set('scope', `${DRIVE_SYNC_SCOPE} openid email profile`);
  authUrl.searchParams.set('prompt', 'consent');

  const callbackUrl = await launchWebAuthFlowAsync(authUrl.toString());
  const parsed = parseGoogleDriveOAuthCallback(callbackUrl, redirectUri);
  accessToken = parsed.accessToken;
  expiresIn = parsed.expiresIn;

  const profile = await fetchGoogleProfile(accessToken);
  const config = await setGoogleDriveConfig({
    enabled: true,
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
    email: profile.email || '',
    accountName: profile.name || profile.email || '',
    avatarUrl: profile.picture || '',
    lastConnectedAt: new Date().toISOString(),
    lastError: ''
  });

  void runGoogleDriveInitialSync();

  return {
    enabled: true,
    email: config.email || '',
    accountName: config.accountName || '',
    expiresAt: config.expiresAt || 0
  };
  })();

  try {
    return await googleDriveConnectInFlight;
  } finally {
    googleDriveConnectInFlight = null;
  }
}

async function googleDriveDisconnect() {
  const cfg = await getGoogleDriveConfig();
  const token = String(cfg.accessToken || '').trim();
  if (token) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
    } catch (error) {
      console.warn('[Google Drive Sync] revoke token failed:', error.message);
    }
  }
  await clearGoogleDriveConfig();
}

async function getGoogleDriveStatus() {
  const cfg = await getGoogleDriveConfig();
  return {
    enabled: cfg.enabled === true,
    email: String(cfg.email || '').trim(),
    accountName: String(cfg.accountName || '').trim(),
    expiresAt: Number(cfg.expiresAt) || 0,
    lastSyncedAt: String(cfg.lastSyncedAt || '').trim(),
    lastError: String(cfg.lastError || '').trim()
  };
}

async function getGoogleDriveAccessToken({ interactive = false } = {}) {
  const cfg = await getGoogleDriveConfig();
  const token = String(cfg.accessToken || '').trim();
  const expiresAt = Number(cfg.expiresAt) || 0;

  if (token && expiresAt > Date.now() + 60 * 1000) {
    return token;
  }

  const chromeIdentityToken = await tryChromeIdentityDriveToken({ interactive });
  if (chromeIdentityToken) {
    return chromeIdentityToken;
  }

  const clientId = getGoogleDriveClientId();
  if (token && clientId && chrome.identity?.launchWebAuthFlow) {
    try {
      const redirectUri = `https://${chrome.runtime.id}.chromiumapp.org/`;
      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authUrl.searchParams.set('client_id', clientId);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('response_type', 'token');
      authUrl.searchParams.set('scope', `${DRIVE_SYNC_SCOPE} openid email profile`);
      authUrl.searchParams.set('prompt', 'none');
      const callbackUrl = await new Promise((resolve, reject) => {
        chrome.identity.launchWebAuthFlow({ url: authUrl.toString(), interactive: false }, (redirectedTo) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message || 'Silent Google authorization failed'));
            return;
          }
          resolve(redirectedTo || '');
        });
      });
      const renewed = parseGoogleDriveOAuthCallback(callbackUrl, redirectUri);
      await setGoogleDriveConfig({
        accessToken: renewed.accessToken,
        expiresAt: Date.now() + renewed.expiresIn * 1000,
        enabled: true
      });
      return renewed.accessToken;
    } catch (error) {
      console.warn('[Google Drive Sync] silent token refresh failed:', error.message);
    }
  }

  if (!interactive) {
    throw new Error('Google Drive sync is not connected');
  }

  const connected = await googleDriveConnect();
  const nextCfg = await getGoogleDriveConfig();
  const nextToken = String(nextCfg.accessToken || '').trim();
  if (!nextToken) {
    throw new Error('Google Drive authorization failed');
  }
  return nextToken;
}

async function buildUnifiedSyncPayload() {
  const syncData = await chrome.storage.sync.get(WEBDAV_SYNC_KEYS);
  const localData = await chrome.storage.local.get(WEBDAV_LOCAL_SYNC_KEYS);
  const normalizedAgentEngineSecret = typeof AgentPromptUtils.normalizeAgentEngineSecret === 'function'
    ? AgentPromptUtils.normalizeAgentEngineSecret(localData[AGENT_ENGINE_SECRET_STORAGE_KEY])
    : (localData[AGENT_ENGINE_SECRET_STORAGE_KEY] || {});
  return {
    ...syncData,
    pkHistory: Array.isArray(localData.pkHistory) ? localData.pkHistory.slice(0, 500) : [],
    favoriteFolders: Array.isArray(localData.favoriteFolders) ? localData.favoriteFolders : [],
    [AGENT_ENGINE_SECRET_STORAGE_KEY]: normalizedAgentEngineSecret,
    [CUSTOM_AGENTS_STORAGE_KEY]: Array.isArray(localData[CUSTOM_AGENTS_STORAGE_KEY])
      ? localData[CUSTOM_AGENTS_STORAGE_KEY]
      : [],
    [AGENT_HIDDEN_IDS_STORAGE_KEY]: Array.isArray(localData[AGENT_HIDDEN_IDS_STORAGE_KEY])
      ? localData[AGENT_HIDDEN_IDS_STORAGE_KEY]
      : [],
    _syncVersion: 1,
    _exportedAt: new Date().toISOString(),
  };
}

async function applyUnifiedSyncPayload(data = {}) {
  const {
    _syncVersion,
    _exportedAt,
    pkHistory,
    favoriteFolders,
    [AGENT_ENGINE_SECRET_STORAGE_KEY]: agentEngineSecret,
    [CUSTOM_AGENTS_STORAGE_KEY]: customAgents,
    [AGENT_HIDDEN_IDS_STORAGE_KEY]: hiddenAgentIds,
    ...rest
  } = data || {};

  const filteredSync = {};
  for (const key of WEBDAV_SYNC_KEYS) {
    if (Object.prototype.hasOwnProperty.call(rest, key)) {
      filteredSync[key] = rest[key];
    }
  }
  if (Object.keys(filteredSync).length > 0) {
    await chrome.storage.sync.set(filteredSync);
  }

  const localPatch = {};
  if (Array.isArray(pkHistory)) {
    localPatch.pkHistory = pkHistory;
  }
  if (Array.isArray(favoriteFolders)) {
    localPatch.favoriteFolders = favoriteFolders;
  }
  const normalizedAgentEngineSecret = typeof AgentPromptUtils.normalizeAgentEngineSecret === 'function'
    ? AgentPromptUtils.normalizeAgentEngineSecret(agentEngineSecret)
    : (agentEngineSecret && typeof agentEngineSecret === 'object' ? agentEngineSecret : {});
  if (normalizedAgentEngineSecret.apiKey || normalizedAgentEngineSecret.customApiKey) {
    localPatch[AGENT_ENGINE_SECRET_STORAGE_KEY] = normalizedAgentEngineSecret;
  }
  if (Array.isArray(customAgents)) {
    localPatch[CUSTOM_AGENTS_STORAGE_KEY] = customAgents;
  }
  if (Array.isArray(hiddenAgentIds)) {
    localPatch[AGENT_HIDDEN_IDS_STORAGE_KEY] = hiddenAgentIds;
  }
  if (Object.keys(localPatch).length > 0) {
    await chrome.storage.local.set(localPatch);
  }
}

async function googleDriveRequest(path, options = {}, { interactive = false } = {}) {
  const token = await getGoogleDriveAccessToken({ interactive });
  const request = async (accessToken) => fetch(`https://www.googleapis.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {})
    }
  });

  let res = await request(token);
  if ((res.status === 401 || res.status === 403) && token) {
    await clearGoogleDriveCachedToken(token);
    await setGoogleDriveConfig({
      accessToken: '',
      expiresAt: 0
    });
    const retryToken = interactive
      ? await getGoogleDriveAccessToken({ interactive: true })
      : await tryChromeIdentityDriveToken({ interactive: false });
    if (retryToken) {
      res = await request(retryToken);
    }
  }
  return res;
}

async function buildGoogleApiErrorMessage(res, fallbackPrefix) {
  const prefix = String(fallbackPrefix || 'Google API request failed').trim();
  const status = Number(res?.status) || 0;
  const baseMessage = status ? `${prefix}: HTTP ${status}` : prefix;

  if (!res) {
    return baseMessage;
  }

  try {
    const cloned = typeof res.clone === 'function' ? res.clone() : res;
    const payload = await cloned.json();
    const reason = String(payload?.error?.errors?.[0]?.reason || payload?.error?.status || '').trim();
    const message = String(payload?.error?.message || '').trim();

    if (reason && message && !message.includes(reason)) {
      return `${baseMessage} (${reason}): ${message}`;
    }
    if (message) {
      return `${baseMessage}: ${message}`;
    }
    if (reason) {
      return `${baseMessage}: ${reason}`;
    }
  } catch (_) {
    // Ignore JSON parse failures and fall back to text/status.
  }

  try {
    const cloned = typeof res.clone === 'function' ? res.clone() : res;
    const text = String(await cloned.text()).trim();
    if (text) {
      return `${baseMessage}: ${text.slice(0, 300)}`;
    }
  } catch (_) {
    // Ignore text parse failures and return the status-based fallback.
  }

  return baseMessage;
}

async function findGoogleDriveSyncFileId({ interactive = false } = {}) {
  const query = encodeURIComponent(`name='${DRIVE_SYNC_FILENAME}' and 'appDataFolder' in parents and trashed=false`);
  const res = await googleDriveRequest(
    `/drive/v3/files?q=${query}&spaces=appDataFolder&fields=files(id%2Cname%2CmodifiedTime)&pageSize=1`,
    {},
    { interactive }
  );
  if (!res.ok) {
    throw new Error(await buildGoogleApiErrorMessage(res, 'Failed to query Drive sync file'));
  }
  const json = await res.json();
  return json.files?.[0] || null;
}

async function googleDriveUpload({ interactive = false } = {}) {
  const cfg = await getGoogleDriveConfig();
  if (!cfg.enabled) {
    return;
  }
  try {
    const payload = await buildUnifiedSyncPayload();
    const existingFile = await findGoogleDriveSyncFileId({ interactive });
    const boundary = `----multi-ai-sync-${Date.now()}`;
    const metadata = {
      name: DRIVE_SYNC_FILENAME,
      parents: ['appDataFolder']
    };
    const multipartBody = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(payload, null, 2),
      `--${boundary}--`
    ].join('\r\n');

    const method = existingFile?.id ? 'PATCH' : 'POST';
    const path = existingFile?.id
      ? `/upload/drive/v3/files/${encodeURIComponent(existingFile.id)}?uploadType=multipart`
      : '/upload/drive/v3/files?uploadType=multipart';
    const res = await googleDriveRequest(path, {
      method,
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body: multipartBody
    }, { interactive });

    if (!res.ok) {
      throw new Error(await buildGoogleApiErrorMessage(res, 'Failed to upload Drive sync data'));
    }

    await setGoogleDriveConfig({
      enabled: true,
      lastSyncedAt: new Date().toISOString(),
      lastError: ''
    });
  } catch (error) {
    await setGoogleDriveConfig({
      lastError: String(error?.message || '').trim()
    });
    throw error;
  }
}

async function googleDriveDownload(options = {}) {
  const { silent = false, interactive = false } = options;
  const cfg = await getGoogleDriveConfig();
  if (!cfg.enabled) {
    if (silent) return;
    throw new Error('Google Drive sync is not connected');
  }

  try {
    const existingFile = await findGoogleDriveSyncFileId({ interactive });
    if (!existingFile?.id) {
      if (silent) return;
      throw new Error('No Google Drive backup was found');
    }

    const res = await googleDriveRequest(
      `/drive/v3/files/${encodeURIComponent(existingFile.id)}?alt=media`,
      {},
      { interactive }
    );
    if (!res.ok) {
      throw new Error(await buildGoogleApiErrorMessage(res, 'Failed to download Drive sync data'));
    }
    const data = await res.json();
    await applyUnifiedSyncPayload(data);
    await setGoogleDriveConfig({
      enabled: true,
      lastSyncedAt: new Date().toISOString(),
      lastError: ''
    });
  } catch (error) {
    if (!silent) {
      await setGoogleDriveConfig({
        lastError: String(error?.message || '').trim()
      });
    }
    throw error;
  }
}

async function getWebDAVConfig() {
  const { [WEBDAV_SYNC_KEY]: cfg = {} } = await chrome.storage.local.get(WEBDAV_SYNC_KEY);
  return cfg;
}

function buildWebDAVHeaders(cfg) {
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.authType === 'token') {
    headers['Authorization'] = `Bearer ${cfg.password}`;
  } else {
    headers['Authorization'] = 'Basic ' + btoa(`${cfg.username}:${cfg.password}`);
  }
  return headers;
}

function getWebDAVFileURL(cfg) {
  let base = (cfg.url || '').trim();
  if (!base.endsWith('/')) base += '/';
  return base + WEBDAV_SYNC_FILENAME;
}

async function webdavUpload() {
  const cfg = await getWebDAVConfig();
  if (!cfg.enabled || !cfg.url) return;
  try {
    const data = await buildUnifiedSyncPayload();
    await fetch(getWebDAVFileURL(cfg), {
      method: 'PUT',
      headers: buildWebDAVHeaders(cfg),
      body: JSON.stringify(data, null, 2),
    });
    console.log('[WebDAV Sync] 上传成功');
  } catch (e) {
    console.warn('[WebDAV Sync] 上传失败:', e.message);
  }
}

async function webdavDownload() {
  const cfg = await getWebDAVConfig();
  if (!cfg.enabled || !cfg.url) {
    throw new Error('WebDAV 未配置或未启用');
  }
  const res = await fetch(getWebDAVFileURL(cfg), {
    method: 'GET',
    headers: buildWebDAVHeaders(cfg),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const data = await res.json();
  await applyUnifiedSyncPayload(data);

  console.log('[WebDAV Sync] 下载并恢复成功');
}

// 设置变更时自动上传
let syncDebounceTimer = null;
chrome.storage.onChanged.addListener((changes, namespace) => {
  const syncChanged = namespace === 'sync' && WEBDAV_SYNC_KEYS.some(k => k in changes);
  const localChanged = namespace === 'local' && WEBDAV_LOCAL_SYNC_KEYS.some(k => k in changes);
  const relevantKey = syncChanged || localChanged;
  if (!relevantKey) return;
  // 防抖：500ms 内多次变更合并为一次上传
  clearTimeout(syncDebounceTimer);
  syncDebounceTimer = setTimeout(() => {
    webdavUpload();
    googleDriveUpload().catch((error) => {
      const message = String(error?.message || '').trim();
      if (!/not connected|authorization failed/i.test(message)) {
        console.warn('[Google Drive Sync] 自动上传失败:', error.message);
      }
    });
  }, 500);
});



// 监听扩展卸载事件
chrome.runtime.setUninstallURL(self.externalLinks?.uninstallSurvey || '', () => {
  if (chrome.runtime.lastError) {
    console.error('设置卸载 URL 失败:', chrome.runtime.lastError);
  }
});

// 跟踪侧边栏状态
let sidePanelOpenState = new Map();

// 重置侧边栏状态的函数
function resetSidePanelState(windowId) {
  console.log('重置侧边栏状态，windowId:', windowId);
  sidePanelOpenState.set(windowId, false);
}



// Omnibox 事件处理
chrome.omnibox.onInputChanged.addListener((text, suggest) => {
  console.log('Omnibox 输入变化:', text);
  
  // 提供搜索建议
  const suggestions = [
    {
      content: `ai ${text}`,
      description: `🔍 使用AI快捷键搜索: ${text}`
    }
  ];
  
  suggest(suggestions);
});

chrome.omnibox.onInputEntered.addListener((text, disposition) => {
  console.log('Omnibox 输入确认:', text, disposition);
  
  // 解析输入文本
  const query = text.replace(/^ai\s+/, '').trim();
  
  if (query) {
    // 打开AI快捷键搜索页面
    const searchUrl = chrome.runtime.getURL(`iframe/iframe.html?query=${encodeURIComponent(query)}`);
    
    if (disposition === 'currentTab') {
      // 在当前标签页打开
      chrome.tabs.update({ url: searchUrl });
    } else {
      // 在新标签页打开
      chrome.tabs.create({ url: searchUrl });
    }
  } else {
    // 如果没有查询内容，直接打开AI快捷键页面
    const defaultUrl = chrome.runtime.getURL('iframe/iframe.html');
    
    if (disposition === 'currentTab') {
      chrome.tabs.update({ url: defaultUrl });
    } else {
      chrome.tabs.create({ url: defaultUrl });
    }
  }
});
