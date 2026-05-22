let currentButtonConfig = null;
// 系统默认站点设置将通过 getDefaultSites() 动态获取
const TEMPLATE_TYPE_LABELS = {
  information: 'homepageTypeInformation',
  agents: 'homepageTypeAgents',
  translate: 'homepageTypeTranslate'
};
let configuredTemplateTypes = ['information'];
const AGENT_ENGINE_STORAGE_KEY = 'agentEngineConfig';
const AGENT_ENGINE_SECRET_STORAGE_KEY = 'agentEngineSecret';
const AGENT_ENGINE_SETTINGS_STORAGE_KEY = 'agentEngineSettings';
const AGENT_CUSTOM_SETTINGS_STORAGE_KEY = (window.AICompareAgentCatalog?.AGENT_CUSTOM_SETTINGS_STORAGE_KEY) || 'agentCustomSettings';
const CUSTOM_AGENTS_STORAGE_KEY = (window.AICompareAgentCatalog?.CUSTOM_AGENTS_STORAGE_KEY) || 'customAgents';
const AGENT_HIDDEN_IDS_STORAGE_KEY = (window.AICompareAgentCatalog?.AGENT_HIDDEN_IDS_STORAGE_KEY) || 'agentHiddenIds';
const GOOGLE_DRIVE_SYNC_STORAGE_KEY = 'googleDriveSyncConfig';
const LOCAL_SYNC_KEYS = ['pkHistory', 'favoriteFolders', AGENT_ENGINE_SECRET_STORAGE_KEY, CUSTOM_AGENTS_STORAGE_KEY, AGENT_HIDDEN_IDS_STORAGE_KEY];
const SYNC_KEYS = [
  'buttonConfig',
  'sites',
  'customSites',
  'siteSettings',
  'disabledSites',
  'promptTemplates',
  'analysisPromptTemplates',
  'favoritePrompts',
  'favoriteSites',
  AGENT_ENGINE_STORAGE_KEY,
  AGENT_ENGINE_SETTINGS_STORAGE_KEY,
  AGENT_CUSTOM_SETTINGS_STORAGE_KEY,
];
const RuntimeI18n = window.RuntimeI18n || null;
const UI_LANGUAGE_STORAGE_KEY = RuntimeI18n?.STORAGE_KEY || 'uiLanguage';


// 加载保存的配置
async function loadConfig() {
  const defaultButtonConfig = await window.AppConfigManager.getButtonConfig();
  chrome.storage.sync.get('buttonConfig', function(data) {
    currentButtonConfig = {
      ...defaultButtonConfig,
      ...(data.buttonConfig || {})
    };
    console.log('加载的buttonConfig:', currentButtonConfig);
    initializeButtonConfigs();
  });
}

// 获取翻译文本
function getMessage(key, substitutions = null) {
  return RuntimeI18n?.getMessage?.(key, substitutions) || chrome.i18n.getMessage(key, substitutions);
}

function getMessageWithFallback(key, fallback = '', substitutions = null) {
  return getMessage(key, substitutions) || fallback;
}

function getPromptTemplateUtils() {
  return window.PromptTemplateUtils || null;
}

async function loadConfiguredTemplateTypes() {
  try {
    const siteTypes = await window.AppConfigManager.getSiteTypes();
    configuredTemplateTypes = getPromptTemplateUtils()?.normalizePromptTemplateTypes?.(siteTypes) || ['information'];
  } catch (error) {
    configuredTemplateTypes = ['information'];
  }
  return configuredTemplateTypes;
}

function normalizeTemplateType(type) {
  return getPromptTemplateUtils()?.normalizePromptTemplateType?.(
    type,
    'information',
    configuredTemplateTypes
  ) || 'information';
}

function getPromptTemplateTypeLabel(type) {
  const normalizedType = normalizeTemplateType(type);
  const messageKey = TEMPLATE_TYPE_LABELS[normalizedType];
  return messageKey ? getMessage(messageKey) || normalizedType : normalizedType;
}

function populateTemplateTypeOptions(selectedType) {
  const typeSelect = document.getElementById('templateType');
  const availableTypes = configuredTemplateTypes;

  if (!typeSelect) return;

  typeSelect.innerHTML = availableTypes.map(type => `
    <option value="${type}">${getPromptTemplateTypeLabel(type)}</option>
  `).join('');
  typeSelect.value = normalizeTemplateType(selectedType);
}

// 显示吐司提示
function showToast(message, duration = 2000) {
  const toast = document.getElementById('toast');
  if (!toast) return;

  toast.classList.remove('show');
  void toast.offsetWidth;
  
  toast.textContent = message;
  toast.classList.add('show');
  
  if (toast.timeoutId) {
    clearTimeout(toast.timeoutId);
  }
  
  toast.timeoutId = setTimeout(() => {
    toast.classList.remove('show');
  }, duration);
}

// 初始化页面文本
function initializeI18n() {
  // 更新页面标题
  document.title = getMessage("appName") || document.title;

  // 更新所有带有 data-i18n 属性的元素
  document.querySelectorAll('[data-i18n]').forEach(element => {
    const key = element.getAttribute('data-i18n');
    const message = getMessage(key);
    if (message) {
      element.textContent = message;
    }
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
    const key = element.getAttribute('data-i18n-placeholder');
    const message = getMessage(key);
    if (message) {
      element.placeholder = message;
    }
  });

  document.querySelectorAll('[data-i18n-title]').forEach(element => {
    const key = element.getAttribute('data-i18n-title');
    const message = getMessage(key);
    if (message) {
      element.title = message;
    }
  });

  document.querySelectorAll('[data-i18n-aria-label]').forEach(element => {
    const key = element.getAttribute('data-i18n-aria-label');
    const message = getMessage(key);
    if (message) {
      element.setAttribute('aria-label', message);
    }
  });
}

function initializeI18nWithin(root) {
  if (!root || typeof root.querySelectorAll !== 'function') {
    return;
  }

  root.querySelectorAll('[data-i18n]').forEach(element => {
    const key = element.getAttribute('data-i18n');
    const message = getMessage(key);
    if (message) {
      element.textContent = message;
    }
  });

  root.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
    const key = element.getAttribute('data-i18n-placeholder');
    const message = getMessage(key);
    if (message) {
      element.placeholder = message;
    }
  });

  root.querySelectorAll('[data-i18n-title]').forEach(element => {
    const key = element.getAttribute('data-i18n-title');
    const message = getMessage(key);
    if (message) {
      element.title = message;
    }
  });

  root.querySelectorAll('[data-i18n-aria-label]').forEach(element => {
    const key = element.getAttribute('data-i18n-aria-label');
    const message = getMessage(key);
    if (message) {
      element.setAttribute('aria-label', message);
    }
  });
}

function getCurrentRuntimeLocale() {
  return RuntimeI18n?.getCurrentLocale?.() || chrome?.i18n?.getUILanguage?.() || 'en';
}

function getAgentCatalogRuntimeLocale() {
  const utils = getAgentCatalogUtils();
  if (typeof RuntimeI18n?.getCurrentLocale === 'function') {
    return RuntimeI18n.getCurrentLocale();
  }
  if (typeof utils?.getRuntimeLocale === 'function') {
    return utils.getRuntimeLocale('');
  }
  return '';
}

function buildLanguageSettingsMarkup(selectedLocale) {
  const options = RuntimeI18n?.getLanguageOptions?.() || [
    { value: 'auto', labelKey: 'languageOptionAuto', fallback: 'Follow browser language' },
    { value: 'en', labelKey: 'languageOptionEn', fallback: 'English' },
    { value: 'zh_CN', labelKey: 'languageOptionZhCn', fallback: '简体中文' },
    { value: 'zh_TW', labelKey: 'languageOptionZhTw', fallback: '繁體中文' }
  ];

  const optionHtml = options.map((option) => {
    const label = getMessage(option.labelKey) || option.fallback;
    const selected = option.value === selectedLocale ? 'selected' : '';
    return `<option value="${option.value}" ${selected}>${label}</option>`;
  }).join('');

  return `
    <div class="site-config">
      <div class="site-setting-row">
        <select id="uiLanguageSelect" class="site-setting-select">${optionHtml}</select>
      </div>
    </div>
  `;
}

async function initializeLanguageSettings() {
  const container = document.getElementById('languageSettingsContainer');
  if (!container) {
    return;
  }

  const selectedLocale = await (RuntimeI18n?.getStoredLocalePreference?.() || Promise.resolve('auto'));
  container.innerHTML = buildLanguageSettingsMarkup(selectedLocale);

  const select = container.querySelector('#uiLanguageSelect');
  if (!select) {
    return;
  }

  select.addEventListener('change', async (event) => {
    const nextLocale = String(event.target.value || 'auto');
    try {
      if (RuntimeI18n?.setLocalePreference) {
        await RuntimeI18n.setLocalePreference(nextLocale);
      } else {
        await chrome.storage.sync.set({ [UI_LANGUAGE_STORAGE_KEY]: nextLocale });
      }
      showToast(getMessage('saveSuccess') || 'Saved');
    } catch (error) {
      console.error('Failed to update UI language:', error);
      showToast(getMessage('saveFailed') || 'Save failed');
    }
  });
}

// 显示消息
function showMessage(message, isError = false) {
  const messageElement = document.createElement('div');
  messageElement.className = `message ${isError ? 'error' : 'success'}`;
  messageElement.textContent = message;
  
  document.body.appendChild(messageElement);
  
  setTimeout(() => {
    messageElement.remove();
  }, 3000);
}

function getLaunchSettingsUtils() {
  return window.SiteLaunchUtils || null;
}

function normalizeCustomSiteUrlValue(value) {
  const utils = getLaunchSettingsUtils();
  if (utils && typeof utils.normalizeCustomSiteUrl === 'function') {
    return utils.normalizeCustomSiteUrl(value);
  }

  const normalizedUrl = typeof value === 'string' ? value.trim() : '';
  if (!normalizedUrl) {
    return '';
  }

  try {
    new URL(normalizedUrl);
    return normalizedUrl;
  } catch (_) {
    // Add a default protocol for bare hostnames.
  }

  if (normalizedUrl.startsWith('//')) {
    return `https:${normalizedUrl}`;
  }

  return `https://${normalizedUrl}`;
}

function getLaunchMessage(key, fallback = '') {
  return getMessage(key) || fallback;
}

function getAgentPromptUtils() {
  return window.AICompareAgentPromptUtils || null;
}

function getBundledAgentEngineDefaults() {
  const promptUtils = getAgentPromptUtils();
  if (typeof promptUtils?.normalizeApiConfig === 'function') {
    return promptUtils.normalizeApiConfig({});
  }

  const rawDefaults = window.AICompareAgentEngineConfig?.getDefaults?.() || {};
  return {
    apiKey: String(rawDefaults.apiKey || '').trim(),
    baseUrl: String(rawDefaults.baseUrl || '').trim().replace(/\/+$/, ''),
    model: String(rawDefaults.model || '').trim(),
    concurrency: Math.max(1, Number(rawDefaults.concurrency) || 2),
    systemPrompt: String(rawDefaults.systemPrompt || '').trim()
  };
}

function getAgentCatalogUtils() {
  return window.AICompareAgentCatalog || null;
}

async function loadAgentEngineConfig() {
  const promptUtils = getAgentPromptUtils();
  const defaultConfig = getBundledAgentEngineDefaults();

  const [syncData, localData] = await Promise.all([
    chrome.storage.sync.get([AGENT_ENGINE_STORAGE_KEY, AGENT_ENGINE_SETTINGS_STORAGE_KEY]),
    chrome.storage.local.get(AGENT_ENGINE_SECRET_STORAGE_KEY)
  ]);

  const resolvedSettings = typeof promptUtils?.resolveAgentEngineSettings === 'function'
    ? promptUtils.resolveAgentEngineSettings(
        syncData?.[AGENT_ENGINE_SETTINGS_STORAGE_KEY] || {},
        localData?.[AGENT_ENGINE_SECRET_STORAGE_KEY] || {}
      )
    : null;

  const fallbackConfig = {
    ...(syncData?.[AGENT_ENGINE_STORAGE_KEY] || {}),
    apiKey: localData?.[AGENT_ENGINE_SECRET_STORAGE_KEY]?.apiKey || ''
  };

  const officialConfig = resolvedSettings?.officialConfig || promptUtils?.normalizeApiConfig?.({}, { useBundledDefaults: true }) || defaultConfig;
  const customConfig = resolvedSettings?.customConfig || promptUtils?.normalizeApiConfig?.(fallbackConfig, { useBundledDefaults: false }) || {
    ...defaultConfig,
    ...fallbackConfig
  };
  const selectedSource = resolvedSettings?.selectedSource || (customConfig?.apiKey && customConfig?.baseUrl && customConfig?.model ? 'custom' : 'official');

  return {
    selectedSource,
    officialConfig,
    customConfig,
    effectiveConfig: resolvedSettings?.effectiveConfig || (selectedSource === 'custom' ? customConfig : officialConfig)
  };
}

function isAgentEngineConfigured(config = {}) {
  return Boolean(
    String(config.baseUrl || '').trim() &&
    String(config.apiKey || '').trim() &&
    String(config.model || '').trim() &&
    Number(config.concurrency) >= 1
  );
}

function getAgentEngineUpgradePriceId() {
  const preferredPlan = String(window.AICompareAgentEngineConfig?.DEFAULT_CHECKOUT_PLAN || 'yearly').trim();
  if (preferredPlan === 'monthly') {
    return window.STRIPE_PRICES?.monthly || '';
  }
  return window.STRIPE_PRICES?.yearly || window.STRIPE_PRICES?.monthly || '';
}

async function getCurrentMembershipPlanInfo() {
  try {
    if (typeof window.getUserPlan === 'function') {
      return await window.getUserPlan();
    }
  } catch (_) {
    // Ignore plan lookup failures here and fall back to free.
  }
  return { plan: 'free', planExpiresAt: null };
}

async function ensureAgentEngineCheckoutReady() {
  const stored = await chrome.storage.local.get(['firebase_uid']);
  if (stored?.firebase_uid) {
    return true;
  }

  if (typeof window.firebaseSignInWithGoogle !== 'function') {
    throw new Error(getMessageWithFallback('membershipGoogleLoginUnavailable', 'Google sign-in is unavailable right now.'));
  }

  await window.firebaseSignInWithGoogle();
  return true;
}

async function handleOfficialAgentEngineUpgrade(button) {
  const priceId = getAgentEngineUpgradePriceId();
  if (!priceId || priceId.startsWith('price_REPLACE')) {
    showToast(getMessageWithFallback('membershipPriceNotConfigured', 'Stripe Price ID not configured. Please set it first.'), 3000);
    return false;
  }

  if (button) {
    button.disabled = true;
  }

  try {
    await ensureAgentEngineCheckoutReady();
    if (typeof window.startCheckout !== 'function') {
      throw new Error(getMessageWithFallback('stripePaymentScriptNotLoaded', 'stripe-payment.js is not loaded.'));
    }
    await window.startCheckout(priceId);
    return true;
  } catch (error) {
    showToast(error?.message || getMessageWithFallback('stripeCheckoutOpenFailed', 'Failed to open the checkout page.'), 3000);
    return false;
  } finally {
    if (button) {
      button.disabled = false;
    }
  }
}

async function refreshOfficialAgentEngineMeta() {
  const officialMeta = document.getElementById('officialAgentEngineMeta');
  const upgradeButton = document.getElementById('officialAgentEngineUpgradeBtn');

  if (!officialMeta || !upgradeButton) {
    return;
  }

  const planInfo = await getCurrentMembershipPlanInfo();
  const isPro = planInfo?.plan === 'pro';

  officialMeta.textContent = isPro
    ? getMessageWithFallback('agentEngineOfficialMetaPro', 'Current plan: PRO')
    : getMessageWithFallback('agentEngineOfficialMetaFree', 'Use the built-in API, free 3 times per day.');
  upgradeButton.textContent = isPro
    ? getMessageWithFallback('agentEngineManageProButton', '管理 PRO')
    : getMessageWithFallback('agentEngineUpgradeButton', '立即升级 PRO');
}

function renderAgentEngineCard(config = {}) {
  const card = document.getElementById('agentEngineCard');
  const statusBadge = document.getElementById('agentEngineStatusBadge');
  const customMeta = document.getElementById('customAgentEngineMeta');
  const editButton = document.getElementById('editAgentEngineBtn');

  if (!card || !statusBadge) {
    return;
  }

  const customCard = card;
  const officialCard = document.getElementById('officialAgentEngineCard');
  const selectedSource = config.selectedSource === 'custom' ? 'custom' : 'official';
  const customConfig = config.customConfig || {};
  const isCustomConfigured = isAgentEngineConfigured(customConfig);

  if (officialCard) {
    officialCard.dataset.selected = selectedSource === 'official' ? 'true' : 'false';
  }
  customCard.dataset.status = isCustomConfigured ? 'configured' : 'unconfigured';
  customCard.dataset.selected = selectedSource === 'custom' ? 'true' : 'false';
  statusBadge.textContent = isCustomConfigured
    ? getMessageWithFallback('agentEngineStatusConfigured', 'Configured')
    : getMessageWithFallback('agentEngineStatusUnconfigured', 'Not configured');
  if (customMeta) {
    customMeta.textContent = isCustomConfigured
      ? getMessageWithFallback('agentEngineCustomConfiguredHint', 'Use your own API for free')
      : getMessageWithFallback('agentEngineCustomCardHint', '填写自己的 API');
  }
  if (editButton) {
    editButton.textContent = isCustomConfigured
      ? getMessageWithFallback('agentEngineEditButton', '编辑自定义 API')
      : getMessageWithFallback('agentEngineEditButtonEmpty', '填写自己的 API');
  }
  customCard.title = '';
  if (officialCard) officialCard.title = '';
}

function openAgentEngineDialog(options = {}) {
  const dialog = document.getElementById('agentEngineDialog');
  if (!dialog) {
    return;
  }

  initializeI18nWithin(dialog);
  dialog.dataset.pendingSource = options.pendingSource === 'custom' ? 'custom' : '';
  dialog.style.display = 'block';
  document.getElementById('agentApiBaseUrl')?.focus();
}

async function setSelectedAgentEngineSource(nextSource) {
  const normalizedSource = nextSource === 'custom' ? 'custom' : 'official';
  const promptUtils = getAgentPromptUtils();
  const currentConfig = await loadAgentEngineConfig();

  if (normalizedSource === 'custom' && !isAgentEngineConfigured(currentConfig.customConfig || {})) {
    showToast(getMessageWithFallback('agentEngineCustomSelectRequiresConfig', 'Configure your custom API first'));
    return false;
  }

  const customConfig = promptUtils?.normalizeApiConfig?.(currentConfig.customConfig || {}, { useBundledDefaults: false }) || (currentConfig.customConfig || {});
  await chrome.storage.sync.set({
    [AGENT_ENGINE_SETTINGS_STORAGE_KEY]: {
      selectedSource: normalizedSource,
      customConfig: {
        baseUrl: String(customConfig.baseUrl || '').trim(),
        model: String(customConfig.model || '').trim(),
        concurrency: Math.max(1, Number(customConfig.concurrency) || 2),
        systemPrompt: String(customConfig.systemPrompt || '').trim()
      }
    }
  });

  return true;
}

function closeAgentEngineDialog() {
  const dialog = document.getElementById('agentEngineDialog');
  if (dialog) {
    dialog.style.display = 'none';
    dialog.dataset.pendingSource = '';
  }
}

async function saveAgentEngineConfig() {
  const baseUrlInput = document.getElementById('agentApiBaseUrl');
  const apiKeyInput = document.getElementById('agentApiKey');
  const modelInput = document.getElementById('agentApiModel');
  const concurrencyInput = document.getElementById('agentApiConcurrency');
  const promptUtils = getAgentPromptUtils();

  const normalizedConfig = promptUtils?.normalizeApiConfig?.({
    baseUrl: baseUrlInput?.value || '',
    apiKey: apiKeyInput?.value || '',
    model: modelInput?.value || '',
    concurrency: concurrencyInput?.value || 2
  }, { useBundledDefaults: false }) || {
    baseUrl: String(baseUrlInput?.value || '').trim(),
    apiKey: String(apiKeyInput?.value || '').trim(),
    model: String(modelInput?.value || '').trim(),
    concurrency: Math.max(1, Number(concurrencyInput?.value) || 2)
  };

  if (!isAgentEngineConfigured(normalizedConfig)) {
    showToast(getMessageWithFallback('agentEngineValidationFailed', 'Please fill in all required agent engine fields'));
    return false;
  }

  const dialog = document.getElementById('agentEngineDialog');
  const currentConfig = await loadAgentEngineConfig();
  const nextSelectedSource = dialog?.dataset?.pendingSource === 'custom'
    ? 'custom'
    : (currentConfig.selectedSource === 'custom' ? 'custom' : 'official');

  await Promise.all([
    chrome.storage.sync.set({
      [AGENT_ENGINE_SETTINGS_STORAGE_KEY]: {
        selectedSource: nextSelectedSource,
        customConfig: {
          baseUrl: normalizedConfig.baseUrl,
          model: normalizedConfig.model,
          concurrency: normalizedConfig.concurrency
        }
      },
      [AGENT_ENGINE_STORAGE_KEY]: {
        baseUrl: normalizedConfig.baseUrl,
        model: normalizedConfig.model,
        concurrency: normalizedConfig.concurrency
      }
    }),
    chrome.storage.local.set({
      [AGENT_ENGINE_SECRET_STORAGE_KEY]: {
        apiKey: normalizedConfig.apiKey,
        customApiKey: normalizedConfig.apiKey
      }
    })
  ]);

  showToast(getMessageWithFallback('agentEngineSaveSuccess', 'Custom API saved'));
  return true;
}

async function initializeAgentEngineSettings() {
  const baseUrlInput = document.getElementById('agentApiBaseUrl');
  const apiKeyInput = document.getElementById('agentApiKey');
  const modelInput = document.getElementById('agentApiModel');
  const concurrencyInput = document.getElementById('agentApiConcurrency');
  const saveButton = document.getElementById('saveAgentEngineBtn');
  const editButton = document.getElementById('editAgentEngineBtn');
  const closeButton = document.getElementById('agentEngineDialogClose');
  const cancelButton = document.getElementById('cancelAgentEngine');
  const overlay = document.getElementById('agentEngineDialogOverlay');
  const officialCard = document.getElementById('officialAgentEngineCard');
  const officialSelectButton = document.getElementById('officialAgentEngineSelectBtn');
  const officialUpgradeButton = document.getElementById('officialAgentEngineUpgradeBtn');
  const customCard = document.getElementById('agentEngineCard');
  const customSelectButton = document.getElementById('customAgentEngineSelectBtn');

  if (!baseUrlInput || !apiKeyInput || !modelInput || !concurrencyInput || !saveButton || !editButton || !closeButton || !cancelButton || !overlay || !officialCard || !officialSelectButton || !customCard || !customSelectButton || !officialUpgradeButton) {
    return;
  }

  try {
    const config = await loadAgentEngineConfig();
    const editableConfig = config.customConfig || {};
    baseUrlInput.value = editableConfig.baseUrl || '';
    apiKeyInput.value = editableConfig.apiKey || '';
    modelInput.value = editableConfig.model || '';
    concurrencyInput.value = String(editableConfig.concurrency || 2);
    renderAgentEngineCard(config);
    await refreshOfficialAgentEngineMeta();
  } catch (error) {
    console.error('加载智能体引擎设置失败:', error);
    showToast(getMessageWithFallback('agentEngineLoadFailed', 'Failed to load agent engine settings'));
  }

  if (editButton.dataset.bound !== 'true') {
    editButton.dataset.bound = 'true';
    editButton.addEventListener('click', (event) => {
      event.stopPropagation();
      openAgentEngineDialog({ pendingSource: 'custom' });
    });
  }

  if (officialSelectButton.dataset.bound !== 'true') {
    officialSelectButton.dataset.bound = 'true';
    officialSelectButton.addEventListener('click', async () => {
      try {
        const changed = await setSelectedAgentEngineSource('official');
        if (!changed) return;
        const config = await loadAgentEngineConfig();
        renderAgentEngineCard(config);
        await refreshOfficialAgentEngineMeta();
      } catch (error) {
        console.error('切换官方 API 失败:', error);
        showToast(getMessageWithFallback('saveFailed', 'Save failed'));
      }
    });
  }

  if (customSelectButton.dataset.bound !== 'true') {
    customSelectButton.dataset.bound = 'true';
    customSelectButton.addEventListener('click', async () => {
      try {
        const changed = await setSelectedAgentEngineSource('custom');
        if (!changed) {
          openAgentEngineDialog({ pendingSource: 'custom' });
          return;
        }
        const config = await loadAgentEngineConfig();
        renderAgentEngineCard(config);
        await refreshOfficialAgentEngineMeta();
      } catch (error) {
        console.error('切换自定义 API 失败:', error);
        showToast(getMessageWithFallback('saveFailed', 'Save failed'));
      }
    });
  }

  if (officialUpgradeButton.dataset.bound !== 'true') {
    officialUpgradeButton.dataset.bound = 'true';
    officialUpgradeButton.addEventListener('click', async (event) => {
      event.stopPropagation();
      const planInfo = await getCurrentMembershipPlanInfo();
      if (planInfo?.plan === 'pro') {
        if (typeof window.openCustomerPortal === 'function') {
          officialUpgradeButton.disabled = true;
          try {
            await window.openCustomerPortal();
          } catch (error) {
            showToast(error?.message || getMessageWithFallback('stripePortalOpenFailed', 'Failed to open the subscription management page.'), 3000);
          } finally {
            officialUpgradeButton.disabled = false;
          }
          return;
        }
      }
      const opened = await handleOfficialAgentEngineUpgrade(officialUpgradeButton);
      if (opened) {
        await refreshOfficialAgentEngineMeta();
      }
    });
  }

  [closeButton, cancelButton, overlay].forEach((element) => {
    if (!element || element.dataset.bound === 'true') {
      return;
    }
    element.dataset.bound = 'true';
    element.addEventListener('click', closeAgentEngineDialog);
  });

  if (saveButton.dataset.bound !== 'true') {
    saveButton.dataset.bound = 'true';
    saveButton.addEventListener('click', async () => {
      try {
        const saved = await saveAgentEngineConfig();
        if (!saved) {
          return;
        }
        const config = await loadAgentEngineConfig();
        const effectiveConfig = config.customConfig || config.effectiveConfig || {};
        baseUrlInput.value = effectiveConfig.baseUrl || '';
        apiKeyInput.value = effectiveConfig.apiKey || '';
        modelInput.value = effectiveConfig.model || '';
        concurrencyInput.value = String(effectiveConfig.concurrency || 2);
        renderAgentEngineCard(config);
        await refreshOfficialAgentEngineMeta();
        closeAgentEngineDialog();
      } catch (error) {
        console.error('保存智能体引擎设置失败:', error);
        showToast(getMessageWithFallback('saveFailed', 'Save failed'));
      }
    });
  }
}

async function loadAgentCatalogFromBackground() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getAgentCatalog' });
    if (response?.success) {
      return response.result || { categories: [], agents: [] };
    }
  } catch (error) {
    console.error('加载智能体目录失败:', error);
  }

  return { categories: [], agents: [] };
}

async function loadAgentCustomSettingsMap() {
  const [{ [AGENT_CUSTOM_SETTINGS_STORAGE_KEY]: storedSettings }, { [CUSTOM_AGENTS_STORAGE_KEY]: localCustomAgents, [AGENT_HIDDEN_IDS_STORAGE_KEY]: hiddenAgentIds }, { [CUSTOM_AGENTS_STORAGE_KEY]: syncCustomAgents }, fallbackCatalog] = await Promise.all([
    chrome.storage.sync.get(AGENT_CUSTOM_SETTINGS_STORAGE_KEY),
    chrome.storage.local.get([CUSTOM_AGENTS_STORAGE_KEY, AGENT_HIDDEN_IDS_STORAGE_KEY]),
    chrome.storage.sync.get(CUSTOM_AGENTS_STORAGE_KEY),
    loadAgentCatalogFromBackground()
  ]);

  const utils = getAgentCatalogUtils();
  const runtimeLocale = getAgentCatalogRuntimeLocale();
  const normalizedSettings = typeof utils?.normalizeAgentCustomSettingsMap === 'function'
    ? utils.normalizeAgentCustomSettingsMap(storedSettings)
    : (storedSettings && typeof storedSettings === 'object' ? storedSettings : {});
  const normalizedCustomAgents = typeof utils?.migrateLegacyCustomAgentsStorage === 'function'
    ? utils.migrateLegacyCustomAgentsStorage(syncCustomAgents, localCustomAgents)
    : (Array.isArray(localCustomAgents) && localCustomAgents.length > 0
      ? localCustomAgents
      : (Array.isArray(syncCustomAgents) ? syncCustomAgents : []));
  const catalog = typeof utils?.buildCatalogWithCustomSettings === 'function'
    ? utils.buildCatalogWithCustomSettings(normalizedSettings, normalizedCustomAgents, runtimeLocale)
    : (typeof utils?.getCatalog === 'function' ? utils.getCatalog(runtimeLocale) : fallbackCatalog);

  return {
    catalog,
    customSettingsMap: normalizedSettings,
    customAgents: Array.isArray(normalizedCustomAgents) ? normalizedCustomAgents : [],
    hiddenAgentIds: typeof utils?.normalizeAgentHiddenIds === 'function'
      ? utils.normalizeAgentHiddenIds(hiddenAgentIds)
      : (Array.isArray(hiddenAgentIds) ? hiddenAgentIds.filter(Boolean) : [])
  };
}

function getAgentTimestamp(agent) {
  const value = agent?.importedAt || agent?.createdAt || agent?.updatedAt || '';
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortAgentsByNewestFirst(agents = []) {
  return [...(Array.isArray(agents) ? agents : [])].sort((a, b) => {
    const timeDelta = getAgentTimestamp(b) - getAgentTimestamp(a);
    if (timeDelta !== 0) {
      return timeDelta;
    }
    return String(a?.name || '').localeCompare(String(b?.name || ''));
  });
}

function buildMergedAgentList(catalog, customSettingsMap = {}, hiddenAgentIds = []) {
  const utils = getAgentCatalogUtils();
  const categories = Array.isArray(catalog?.categories) ? catalog.categories : [];
  const agents = Array.isArray(catalog?.agents) ? catalog.agents : [];
  const hiddenSet = new Set(
    (Array.isArray(hiddenAgentIds) ? hiddenAgentIds : [])
      .map((id) => String(id || '').trim())
      .filter(Boolean)
  );

  return {
    categories,
    agents: sortAgentsByNewestFirst(agents.map((agent) => {
      if (typeof utils?.mergeAgentWithCustomSettings === 'function') {
        return utils.mergeAgentWithCustomSettings(agent, customSettingsMap);
      }
      return { ...agent };
    }).filter((agent) => agent && !hiddenSet.has(agent.id)))
  };
}

async function loadAgentCustomSettingsManager() {
  const container = document.getElementById('agentCustomSettingsList');
  if (!container) {
    return;
  }

  try {
    const { catalog, customSettingsMap, customAgents, hiddenAgentIds } = await loadAgentCustomSettingsMap();
    renderAgentCustomSettingsManager(buildMergedAgentList(catalog, customSettingsMap, hiddenAgentIds), customSettingsMap, customAgents, hiddenAgentIds);
  } catch (error) {
    console.error('加载智能体自定义设置失败:', error);
    container.innerHTML = `
      <div class="error-state state-panel">
        <p>${getMessageWithFallback('agentCustomSettingsLoadFailed', 'Failed to load agent settings')}</p>
      </div>
    `;
  }
}

function renderAgentCustomSettingsManager(catalog, customSettingsMap = {}, customAgents = [], hiddenAgentIds = []) {
  const container = document.getElementById('agentCustomSettingsList');
  if (!container) {
    return;
  }

  const agents = Array.isArray(catalog?.agents) ? catalog.agents : [];
  container.innerHTML = '';

  if (!agents.length) {
    container.innerHTML = `
      <div class="state-panel">
        <p>${getMessageWithFallback('agentCustomSettingsEmpty', 'No agents available')}</p>
      </div>
    `;
    return;
  }

  const fragment = document.createDocumentFragment();

  agents.forEach((agent) => {
    const customSettings = customSettingsMap?.[agent.id] || {};
    const summaryParts = [];
    if (Object.keys(customSettings).length > 0) {
      summaryParts.push(getMessageWithFallback('agentCustomOverriddenBadge', 'Customized'));
    }

    const card = document.createElement('div');
    card.className = 'template-item';
    card.dataset.agentId = agent.id;
    card.innerHTML = `
      <div class="template-item-head">
        <div class="template-item-body">
          <h4 class="template-item-title">${escapeHtml(agent.name || '')}</h4>
          <div class="custom-site-detail">${escapeHtml(agent.description || '')}</div>
          <div class="custom-site-summary">${summaryParts.map(escapeHtml).join(' · ')}</div>
        </div>
        <div class="template-actions">
          <button type="button" class="edit-agent-custom-btn icon-action-btn" data-agent-id="${escapeHtml(agent.id)}" title="${getMessageWithFallback('editButton', 'Edit')}" aria-label="${getMessageWithFallback('editButton', 'Edit')}">
            <img src="../icons/edit.svg" alt="">
          </button>
          <button
            type="button"
            class="delete-agent-custom-btn icon-action-btn"
            data-agent-id="${escapeHtml(agent.id)}"
            data-agent-source="${agent.isCustom ? 'custom' : 'builtin'}"
            title="${getMessageWithFallback('deleteButton', 'Delete')}"
            aria-label="${getMessageWithFallback('deleteButton', 'Delete')}"
          >
            <img src="../icons/trash.svg" alt="">
          </button>
        </div>
      </div>
    `;

    fragment.appendChild(card);
  });

  container.appendChild(fragment);
}

function bindAgentCustomSettingsEvents() {
  if (bindAgentCustomSettingsEvents.bound === true) {
    return;
  }
  bindAgentCustomSettingsEvents.bound = true;
  document.getElementById('agentCustomSettingsList')?.addEventListener('click', handleAgentCustomSettingsListClick);
  document.getElementById('agentCustomDialogClose')?.addEventListener('click', closeAgentCustomDialog);
  document.getElementById('cancelAgentCustom')?.addEventListener('click', closeAgentCustomDialog);
  document.getElementById('saveAgentCustom')?.addEventListener('click', saveAgentCustomSettingsFromDialog);
  document.getElementById('resetAgentCustom')?.addEventListener('click', resetAgentCustomSettingsFromDialog);
  document.getElementById('agentCustomDialogOverlay')?.addEventListener('click', closeAgentCustomDialog);
  document.getElementById('addAgentBtn')?.addEventListener('click', openNewAgentDialog);
  document.getElementById('importAgentBtn')?.addEventListener('click', openAgentImportDialog);
  document.getElementById('agentImportDialogClose')?.addEventListener('click', closeAgentImportDialog);
  document.getElementById('cancelAgentImport')?.addEventListener('click', closeAgentImportDialog);
  document.getElementById('saveAgentImport')?.addEventListener('click', importSkillAsCustomAgent);
  document.getElementById('agentImportDialogOverlay')?.addEventListener('click', closeAgentImportDialog);
  const urlInput = document.getElementById('agentSkillUrl');
  if (urlInput && urlInput.dataset.bound !== 'true') {
    urlInput.dataset.bound = 'true';
    urlInput.addEventListener('input', scheduleAutoFetchAgentSkillContent);
    urlInput.addEventListener('change', scheduleAutoFetchAgentSkillContent);
    urlInput.addEventListener('blur', scheduleAutoFetchAgentSkillContent);
    urlInput.addEventListener('paste', () => {
      setTimeout(scheduleAutoFetchAgentSkillContent, 0);
    });
  }
}

async function handleAgentCustomSettingsListClick(event) {
  const editButton = event.target.closest('.edit-agent-custom-btn');
  const deleteButton = event.target.closest('.delete-agent-custom-btn');
  if (!editButton) {
    if (!deleteButton) {
      return;
    }
    const deleteAgentId = deleteButton.dataset.agentId;
    const deleteAgentSource = String(deleteButton.dataset.agentSource || '').trim();
    if (deleteAgentId) {
      if (deleteAgentSource === 'builtin') {
        await hideBuiltinAgent(deleteAgentId);
      } else {
        await deleteCustomAgent(deleteAgentId);
      }
    }
    return;
  }

  const agentId = editButton.dataset.agentId;
  if (!agentId) {
    return;
  }

  await openAgentCustomDialog(agentId);
}

async function openAgentCustomDialog(agentId) {
  const dialog = document.getElementById('agentCustomDialog');
  const resetButton = document.getElementById('resetAgentCustom');
  if (!dialog) {
    return;
  }

  initializeI18nWithin(dialog);

  const { catalog, customSettingsMap, hiddenAgentIds } = await loadAgentCustomSettingsMap();
  const mergedCatalog = buildMergedAgentList(catalog, customSettingsMap, hiddenAgentIds);
  const baseAgent = (Array.isArray(catalog?.agents) ? catalog.agents : []).find((item) => item.id === agentId);
  const mergedAgent = (Array.isArray(mergedCatalog?.agents) ? mergedCatalog.agents : []).find((item) => item.id === agentId);
  const customSettings = customSettingsMap?.[agentId] || {};

  if (!baseAgent || !mergedAgent) {
    return;
  }

  currentEditingAgentId = agentId;

  const title = document.getElementById('agentCustomDialogTitle');
  const agentNameInput = document.getElementById('agentCustomName');
  const agentDescriptionInput = document.getElementById('agentCustomDescription');
  const agentPersonaInput = document.getElementById('agentCustomPersonaPrompt');

  if (title) {
    title.textContent = getMessageWithFallback('agentCustomDialogTitle', 'Customize skill');
  }
  if (agentNameInput) {
    agentNameInput.value = mergedAgent.name || '';
  }
  if (agentDescriptionInput) {
    agentDescriptionInput.value = mergedAgent.description || '';
  }
  if (agentPersonaInput) {
    agentPersonaInput.value = mergedAgent.personaPrompt || '';
  }

  dialog.dataset.hasCustom = Object.keys(customSettings).length > 0 ? 'true' : 'false';
  dialog.dataset.baseName = baseAgent.name || '';
  dialog.dataset.baseDescription = baseAgent.description || '';
  dialog.dataset.basePersonaPrompt = baseAgent.personaPrompt || '';
  dialog.dataset.isCustomAgent = baseAgent.isCustom ? 'true' : 'false';
  dialog.dataset.mode = 'edit';
  if (resetButton) {
    resetButton.style.display = baseAgent.isCustom ? 'none' : '';
  }
  dialog.style.display = 'block';
  agentNameInput?.focus();
}

async function openNewAgentDialog() {
  const dialog = document.getElementById('agentCustomDialog');
  const resetButton = document.getElementById('resetAgentCustom');
  if (!dialog) {
    return;
  }

  initializeI18nWithin(dialog);

  currentEditingAgentId = `custom-${Date.now()}`;
  dialog.dataset.baseName = '';
  dialog.dataset.baseDescription = '';
  dialog.dataset.basePersonaPrompt = '';
  dialog.dataset.isCustomAgent = 'false';
  dialog.dataset.mode = 'create';

  const title = document.getElementById('agentCustomDialogTitle');
  const agentNameInput = document.getElementById('agentCustomName');
  const agentDescriptionInput = document.getElementById('agentCustomDescription');
  const agentPersonaInput = document.getElementById('agentCustomPersonaPrompt');

  if (title) {
    title.textContent = getMessageWithFallback('agentCustomNewTitle', 'New skill');
  }
  if (agentNameInput) {
    agentNameInput.value = '';
  }
  if (agentDescriptionInput) {
    agentDescriptionInput.value = '';
  }
  if (agentPersonaInput) {
    agentPersonaInput.value = '';
  }
  if (resetButton) {
    resetButton.style.display = 'none';
  }

  dialog.style.display = 'block';
  agentNameInput?.focus();
}

function openAgentImportDialog() {
  const dialog = document.getElementById('agentImportDialog');
  if (!dialog) {
    return;
  }

  initializeI18nWithin(dialog);
  dialog.style.display = 'block';
  document.getElementById('agentSkillUrl')?.focus();
}

function closeAgentImportDialog() {
  const dialog = document.getElementById('agentImportDialog');
  if (dialog) {
    dialog.style.display = 'none';
  }
}

function closeAgentCustomDialog() {
  const dialog = document.getElementById('agentCustomDialog');
  if (dialog) {
    dialog.style.display = 'none';
    dialog.dataset.mode = '';
  }
  currentEditingAgentId = null;
}

function readAgentCustomDialogValue() {
  const dialog = document.getElementById('agentCustomDialog');
  if (!dialog || !currentEditingAgentId) {
    return null;
  }

  const baseName = String(dialog.dataset.baseName || '').trim();
  const baseDescription = String(dialog.dataset.baseDescription || '').trim();
  const basePersonaPrompt = String(dialog.dataset.basePersonaPrompt || '').trim();
  const isCustomAgent = dialog.dataset.isCustomAgent === 'true';

  const nextName = String(document.getElementById('agentCustomName')?.value || '').trim();
  const nextDescription = String(document.getElementById('agentCustomDescription')?.value || '').trim();
  const nextPersonaPrompt = String(document.getElementById('agentCustomPersonaPrompt')?.value || '').trim();

  if (!nextName) {
    return {
      error: getMessageWithFallback('agentCustomValidationFailed', 'Please fill in the agent name')
    };
  }

  if (!nextPersonaPrompt) {
    return {
      error: getMessageWithFallback('agentCustomPromptRequired', 'Please fill in the persona prompt')
    };
  }

  const patch = {};
  if (nextName !== baseName) {
    patch.name = nextName;
  }
  if (nextDescription !== baseDescription) {
    patch.description = nextDescription;
  }
  if (nextPersonaPrompt !== basePersonaPrompt) {
    patch.personaPrompt = nextPersonaPrompt;
  }

  return {
    agentId: currentEditingAgentId,
    patch,
    isCustomAgent,
    mode: dialog.dataset.mode || 'edit'
  };
}

async function saveAgentCustomSettingsFromDialog() {
  try {
    const nextValue = readAgentCustomDialogValue();
    if (!nextValue) {
      return;
    }
    if (nextValue.error) {
      showToast(nextValue.error, 3000);
      return;
    }

    if (nextValue.mode === 'create') {
      await saveNewCustomAgentFromDialog(nextValue);
      showToast(getMessageWithFallback('agentCustomSaveSuccess', 'Skill settings saved'));
      closeAgentCustomDialog();
      await loadAgentCustomSettingsManager();
      return;
    }

    if (nextValue.isCustomAgent) {
      await saveImportedAgentFromDialog(nextValue);
      showToast(getMessageWithFallback('agentCustomSaveSuccess', 'Skill settings saved'));
      closeAgentCustomDialog();
      await loadAgentCustomSettingsManager();
      return;
    }

    const { [AGENT_CUSTOM_SETTINGS_STORAGE_KEY]: storedSettings } = await chrome.storage.sync.get(AGENT_CUSTOM_SETTINGS_STORAGE_KEY);
    const utils = getAgentCatalogUtils();
    const normalizedSettings = typeof utils?.normalizeAgentCustomSettingsMap === 'function'
      ? utils.normalizeAgentCustomSettingsMap(storedSettings)
      : (storedSettings && typeof storedSettings === 'object' ? storedSettings : {});

    const nextSettings = { ...normalizedSettings };
    if (Object.keys(nextValue.patch).length > 0) {
      nextSettings[nextValue.agentId] = nextValue.patch;
    } else {
      delete nextSettings[nextValue.agentId];
    }

    await chrome.storage.sync.set({
      [AGENT_CUSTOM_SETTINGS_STORAGE_KEY]: nextSettings
    });

    showToast(getMessageWithFallback('agentCustomSaveSuccess', 'Skill settings saved'));
    closeAgentCustomDialog();
    await loadAgentCustomSettingsManager();
  } catch (error) {
    console.error('保存智能体自定义设置失败:', error);
    showToast(getMessageWithFallback('saveFailed', 'Save failed'), 3000);
  }
}

async function resetAgentCustomSettingsFromDialog() {
  if (!currentEditingAgentId) {
    return;
  }

  try {
    const dialog = document.getElementById('agentCustomDialog');
    if (dialog?.dataset.isCustomAgent === 'true') {
      closeAgentCustomDialog();
      await loadAgentCustomSettingsManager();
      return;
    }

    const { [AGENT_CUSTOM_SETTINGS_STORAGE_KEY]: storedSettings } = await chrome.storage.sync.get(AGENT_CUSTOM_SETTINGS_STORAGE_KEY);
    const utils = getAgentCatalogUtils();
    const normalizedSettings = typeof utils?.normalizeAgentCustomSettingsMap === 'function'
      ? utils.normalizeAgentCustomSettingsMap(storedSettings)
      : (storedSettings && typeof storedSettings === 'object' ? storedSettings : {});

    if (!normalizedSettings[currentEditingAgentId]) {
      closeAgentCustomDialog();
      await loadAgentCustomSettingsManager();
      return;
    }

    delete normalizedSettings[currentEditingAgentId];
    await chrome.storage.sync.set({
      [AGENT_CUSTOM_SETTINGS_STORAGE_KEY]: normalizedSettings
    });

    showToast(getMessageWithFallback('agentCustomResetSuccess', 'Skill settings reset'));
    closeAgentCustomDialog();
    await loadAgentCustomSettingsManager();
  } catch (error) {
    console.error('重置智能体自定义设置失败:', error);
    showToast(getMessageWithFallback('saveFailed', 'Save failed'), 3000);
  }
}

async function saveNewCustomAgentFromDialog(nextValue) {
  const name = String(document.getElementById('agentCustomName')?.value || '').trim();
  const description = String(document.getElementById('agentCustomDescription')?.value || '').trim();
  const personaPrompt = String(document.getElementById('agentCustomPersonaPrompt')?.value || '').trim();

  if (!name) {
    throw new Error(getMessageWithFallback('agentCustomValidationFailed', 'Please fill in the agent name'));
  }
  if (!personaPrompt) {
    throw new Error(getMessageWithFallback('agentCustomPromptRequired', 'Please fill in the persona prompt'));
  }

  await saveCustomAgent({
    id: nextValue.agentId,
    name,
    shortName: name.slice(0, 1),
    description,
    personaPrompt,
    type: 'information',
    color: '#4f6b95',
    defaultEnabled: false,
    sourceType: 'manual',
    importedAt: new Date().toISOString()
  });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case '\'':
        return '&#39;';
      default:
        return char;
    }
  });
}

function slugifyAgentId(value) {
  const normalized = String(value || '').trim().toLowerCase();
  const slug = normalized
    .replace(/https?:\/\/+/g, '')
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || `agent-${Date.now()}`;
}

function getGithubSkillCandidates(value) {
  const input = String(value || '').trim();
  if (!input) {
    return [];
  }

  try {
    const url = new URL(input);
    if (url.hostname === 'github.com') {
      const parts = url.pathname.split('/').filter(Boolean);
      const markerIndex = parts.findIndex((part) => part === 'blob' || part === 'tree');
      if (parts.length >= 4 && markerIndex >= 2) {
        const owner = parts[0];
        const repo = parts[1];
        const branch = parts[markerIndex + 1];
        const fileParts = parts.slice(markerIndex + 2);
        const filePath = fileParts.join('/');
        if (owner && repo && branch && filePath) {
          const baseRaw = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
          const baseRawDir = baseRaw.replace(/\/+$/, '');
          const candidateSet = new Set([
            baseRawDir.endsWith('/SKILL.md') || baseRawDir.endsWith('/skill.md') || baseRawDir.endsWith('/README.md')
              ? baseRawDir
              : `${baseRawDir}/SKILL.md`,
            `${baseRawDir}/skill.md`,
            `${baseRawDir}/README.md`,
            baseRaw
          ]);
          return Array.from(candidateSet);
        }
      }

      if (parts.length === 2) {
        const owner = parts[0];
        const repo = parts[1];
        return [
          `https://raw.githubusercontent.com/${owner}/${repo}/main/SKILL.md`,
          `https://raw.githubusercontent.com/${owner}/${repo}/master/SKILL.md`,
          input.replace(/\/+$/, '') + '/blob/main/SKILL.md'
        ];
      }

      if (parts.length >= 3 && !markerIndex && parts[2] === 'blob') {
        const baseInput = input.replace(/\/+$/, '');
        return [
          `${baseInput}/SKILL.md`,
          `${baseInput}/skill.md`,
          `${baseInput}/README.md`,
          input
        ];
      }

      if (parts.length >= 2) {
        const owner = parts[0];
        const repo = parts[1];
        const baseInput = input.replace(/\/+$/, '');
        return Array.from(new Set([
          `${baseInput}/SKILL.md`,
          `${baseInput}/skill.md`,
          `${baseInput}/README.md`,
          `https://raw.githubusercontent.com/${owner}/${repo}/main/SKILL.md`,
          `https://raw.githubusercontent.com/${owner}/${repo}/master/SKILL.md`,
          input
        ]));
      }
    }

    return [url.toString()];
  } catch (_) {
    return [input];
  }
}

function normalizeGithubSkillUrl(value) {
  const candidates = getGithubSkillCandidates(value);
  return candidates[0] || '';
}

async function tryFetchText(url) {
  const response = await fetch(url);
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    url,
    contentType,
    text
  };
}

function looksLikeSkillMarkdown(text = '', contentType = '') {
  const normalizedText = String(text || '').replace(/\r\n/g, '\n').trim();
  const normalizedType = String(contentType || '').toLowerCase();
  if (!normalizedText) {
    return false;
  }

  if (normalizedText.startsWith('<!DOCTYPE html') || normalizedText.startsWith('<html')) {
    return false;
  }

  if (normalizedType.includes('text/html')) {
    return false;
  }

  if (/^---\n[\s\S]*?\n---/.test(normalizedText)) {
    return true;
  }

  return /^#\s+/m.test(normalizedText);
}

function parseSkillFrontmatter(markdown = '') {
  const normalizedMarkdown = String(markdown || '').replace(/\r\n/g, '\n');
  const match = normalizedMarkdown.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) {
    return {};
  }

  const lines = match[1].split('\n');
  const result = {};
  let currentKey = '';
  let currentMode = '';
  let currentBuffer = [];

  function flushCurrentField() {
    if (!currentKey) {
      return;
    }

    if (currentMode === 'block') {
      result[currentKey] = currentBuffer.join('\n').trim();
    } else if (currentBuffer.length > 0) {
      result[currentKey] = currentBuffer.join('\n').trim();
    }

    currentKey = '';
    currentMode = '';
    currentBuffer = [];
  }

  for (const rawLine of lines) {
    const keyMatch = rawLine.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (keyMatch && !rawLine.startsWith('  ')) {
      flushCurrentField();
      currentKey = keyMatch[1];
      const inlineValue = keyMatch[2] || '';
      if (inlineValue === '|' || inlineValue === '>') {
        currentMode = 'block';
      } else {
        result[currentKey] = inlineValue.trim();
        currentKey = '';
      }
      continue;
    }

    if (currentMode === 'block') {
      currentBuffer.push(rawLine.replace(/^  /, ''));
    }
  }

  flushCurrentField();
  return result;
}

function stripSkillFrontmatter(markdown = '') {
  return String(markdown || '')
    .replace(/\r\n/g, '\n')
    .replace(/^---\n[\s\S]*?\n---(?:\n|$)/, '')
    .trim();
}

async function fetchSkillMarkdownFromUrl(inputUrl) {
  const input = String(inputUrl || '').trim();
  const candidates = getGithubSkillCandidates(input);
  let lastFailure = null;
  const tried = new Set();

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeGithubSkillUrl(candidate);
    if (!normalizedCandidate || tried.has(normalizedCandidate)) {
      continue;
    }
    tried.add(normalizedCandidate);
    try {
      const result = await tryFetchText(normalizedCandidate);
      if (result.ok && looksLikeSkillMarkdown(result.text, result.contentType)) {
        return {
          url: normalizedCandidate,
          content: result.text
        }
      }
      if (result.status === 404) {
        lastFailure = new Error('HTTP 404');
        continue;
      }
      lastFailure = new Error(`HTTP ${result.status}`);
    } catch (error) {
      lastFailure = error;
    }
  }

  throw lastFailure || new Error('Unable to fetch a valid SKILL.md');
}

function extractSkillTitle(markdown = '', fallback = '') {
  const normalizedMarkdown = String(markdown || '').replace(/\r\n/g, '\n');
  const frontmatter = parseSkillFrontmatter(normalizedMarkdown);
  if (frontmatter.name) {
    return String(frontmatter.name).trim();
  }

  const headingMatch = normalizedMarkdown.match(/^#\s+(.+)$/m);
  if (headingMatch?.[1]) {
    return headingMatch[1].trim();
  }
  return String(fallback || '').trim() || 'Imported Skill Agent';
}

function extractSkillDescription(markdown = '') {
  const normalizedMarkdown = String(markdown || '').replace(/\r\n/g, '\n');
  const frontmatter = parseSkillFrontmatter(normalizedMarkdown);
  if (frontmatter.description) {
    return String(frontmatter.description).trim().replace(/\s+/g, ' ');
  }

  const strippedMarkdown = stripSkillFrontmatter(normalizedMarkdown);
  const lines = strippedMarkdown.split('\n');
  const collected = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (collected.length > 0) {
        break;
      }
      continue;
    }
    if (line.startsWith('#') || line === '---') {
      continue;
    }
    if (/^(use when|ask the questions|if a question|interview me relentlessly)/i.test(line) && collected.length > 0) {
      break;
    }
    collected.push(line.replace(/^[-*]\s+/, ''));
    if (collected.join(' ').length >= 240) {
      break;
    }
  }

  if (collected.length > 0) {
    return collected.join(' ').replace(/\s+/g, ' ').trim();
  }
  return '';
}

function detectSkillCompatibility(markdown = '') {
  const content = String(markdown || '').toLowerCase();
  const heavyKeywords = [
    'apply_patch',
    'exec_command',
    'spawn_agent',
    'playwright',
    'browser',
    'mcp',
    'git ',
    'npm ',
    'pnpm ',
    'yarn ',
    'python ',
    'bash ',
    'shell '
  ];
  return heavyKeywords.some((keyword) => content.includes(keyword))
    ? 'prompt_only'
    : 'native';
}

function buildImportedAgentPersonaPrompt(markdown = '', skillUrl = '') {
  const normalizedMarkdown = String(markdown || '').replace(/\r\n/g, '\n');
  const strippedMarkdown = stripSkillFrontmatter(normalizedMarkdown);

  if (!strippedMarkdown) {
    return '';
  }

  return strippedMarkdown.trim();
}

async function saveCustomAgent(agent) {
  const utils = getAgentCatalogUtils();
  const [{ [CUSTOM_AGENTS_STORAGE_KEY]: localAgents }, { [CUSTOM_AGENTS_STORAGE_KEY]: syncAgents }] = await Promise.all([
    chrome.storage.local.get(CUSTOM_AGENTS_STORAGE_KEY),
    chrome.storage.sync.get(CUSTOM_AGENTS_STORAGE_KEY)
  ]);
  const currentAgents = Array.isArray(localAgents) && localAgents.length > 0
    ? localAgents
    : (Array.isArray(syncAgents) ? syncAgents : []);
  const normalizedCandidate = typeof utils?.normalizeCustomAgent === 'function'
    ? utils.normalizeCustomAgent(agent)
    : agent;

  if (!normalizedCandidate) {
    throw new Error(getMessageWithFallback('agentSkillImportInvalid', 'Failed to parse the skill into an agent'));
  }

  const nextAgents = currentAgents.filter((item) => item?.id !== normalizedCandidate.id);
  nextAgents.push(normalizedCandidate);
  await chrome.storage.local.set({
    [CUSTOM_AGENTS_STORAGE_KEY]: nextAgents
  });
}

async function saveImportedAgentFromDialog(nextValue) {
  const [{ [CUSTOM_AGENTS_STORAGE_KEY]: localAgents }, { [CUSTOM_AGENTS_STORAGE_KEY]: syncAgents }] = await Promise.all([
    chrome.storage.local.get(CUSTOM_AGENTS_STORAGE_KEY),
    chrome.storage.sync.get(CUSTOM_AGENTS_STORAGE_KEY)
  ]);
  const currentAgents = Array.isArray(localAgents) && localAgents.length > 0
    ? localAgents
    : (Array.isArray(syncAgents) ? syncAgents : []);
  const targetAgent = currentAgents.find((agent) => agent?.id === nextValue.agentId);
  if (!targetAgent) {
    throw new Error(getMessageWithFallback('agentUnknownError', 'Unknown skill'));
  }

  await saveCustomAgent({
    ...targetAgent,
    ...nextValue.patch,
    id: targetAgent.id
  });
}

async function deleteCustomAgent(agentId) {
  const confirmMessage = getMessageWithFallback('agentCustomDeleteConfirm', 'Delete this imported skill?');
  if (!window.confirm(confirmMessage)) {
    return;
  }

  const [{ [CUSTOM_AGENTS_STORAGE_KEY]: localAgents }, { [CUSTOM_AGENTS_STORAGE_KEY]: syncAgents }, { [AGENT_CUSTOM_SETTINGS_STORAGE_KEY]: storedSettings }] = await Promise.all([
    chrome.storage.local.get(CUSTOM_AGENTS_STORAGE_KEY),
    chrome.storage.sync.get(CUSTOM_AGENTS_STORAGE_KEY),
    chrome.storage.sync.get(AGENT_CUSTOM_SETTINGS_STORAGE_KEY)
  ]);

  const currentAgents = Array.isArray(localAgents) && localAgents.length > 0
    ? localAgents
    : (Array.isArray(syncAgents) ? syncAgents : []);
  const nextAgents = currentAgents.filter((agent) => agent?.id !== agentId);

  const utils = getAgentCatalogUtils();
  const normalizedSettings = typeof utils?.normalizeAgentCustomSettingsMap === 'function'
    ? utils.normalizeAgentCustomSettingsMap(storedSettings)
    : (storedSettings && typeof storedSettings === 'object' ? storedSettings : {});
  delete normalizedSettings[agentId];

  await chrome.storage.local.set({
    [CUSTOM_AGENTS_STORAGE_KEY]: nextAgents
  });
  await chrome.storage.sync.remove(CUSTOM_AGENTS_STORAGE_KEY);
  await chrome.storage.sync.set({
    [AGENT_CUSTOM_SETTINGS_STORAGE_KEY]: normalizedSettings
  });

  showToast(getMessageWithFallback('agentCustomDeleteSuccess', 'Imported skill deleted'));
  await loadAgentCustomSettingsManager();
}

async function hideBuiltinAgent(agentId) {
  const confirmMessage = getMessageWithFallback('agentBuiltinDeleteConfirm', 'Delete this built-in skill? It will be hidden on this device.');
  if (!window.confirm(confirmMessage)) {
    return;
  }

  const utils = getAgentCatalogUtils();
  const [
    { [AGENT_HIDDEN_IDS_STORAGE_KEY]: hiddenAgentIds },
    { [AGENT_CUSTOM_SETTINGS_STORAGE_KEY]: storedSettings }
  ] = await Promise.all([
    chrome.storage.local.get(AGENT_HIDDEN_IDS_STORAGE_KEY),
    chrome.storage.sync.get(AGENT_CUSTOM_SETTINGS_STORAGE_KEY)
  ]);

  const normalizedHiddenIds = typeof utils?.normalizeAgentHiddenIds === 'function'
    ? utils.normalizeAgentHiddenIds(hiddenAgentIds)
    : (Array.isArray(hiddenAgentIds) ? hiddenAgentIds.filter(Boolean) : []);
  const nextHiddenIds = Array.from(new Set([...normalizedHiddenIds, agentId]));

  const normalizedSettings = typeof utils?.normalizeAgentCustomSettingsMap === 'function'
    ? utils.normalizeAgentCustomSettingsMap(storedSettings)
    : (storedSettings && typeof storedSettings === 'object' ? storedSettings : {});
  if (normalizedSettings[agentId]) {
    delete normalizedSettings[agentId];
  }

  await Promise.all([
    chrome.storage.local.set({
      [AGENT_HIDDEN_IDS_STORAGE_KEY]: nextHiddenIds
    }),
    chrome.storage.sync.set({
      [AGENT_CUSTOM_SETTINGS_STORAGE_KEY]: normalizedSettings
    })
  ]);

  showToast(getMessageWithFallback('agentBuiltinDeleteSuccess', 'Built-in skill deleted'));
  await loadAgentCustomSettingsManager();
}

async function importSkillAsCustomAgent() {
  const urlInput = document.getElementById('agentSkillUrl');
  const contentInput = document.getElementById('agentSkillContent');

  const rawUrl = String(urlInput?.value || '').trim();
  const pastedContent = String(contentInput?.value || '').trim();

  if (!rawUrl && !pastedContent) {
    showToast(getMessageWithFallback('agentSkillImportValidationFailed', 'Please provide a Skill URL or Skill content'), 3000);
    return;
  }

  try {
    let skillUrl = '';
    let skillMarkdown = pastedContent;

    if (rawUrl) {
      const fetched = await fetchSkillMarkdownFromUrl(rawUrl);
      skillUrl = fetched.url;
      skillMarkdown = String(fetched.content || '').trim();
      if (contentInput && skillMarkdown) {
        contentInput.value = skillMarkdown;
      }
    }

    if (!skillMarkdown) {
      throw new Error(getMessageWithFallback('agentSkillImportEmpty', 'The fetched Skill is empty'));
    }

    const title = extractSkillTitle(skillMarkdown, rawUrl);
    const description = extractSkillDescription(skillMarkdown);
    const compatibility = detectSkillCompatibility(skillMarkdown);
    const agentId = `skill-${slugifyAgentId(skillUrl || title)}`;
    const personaPrompt = buildImportedAgentPersonaPrompt(skillMarkdown, skillUrl);

    if (!personaPrompt) {
      throw new Error(getMessageWithFallback('agentSkillImportInvalid', 'Failed to parse this Skill into a skill'));
    }

    await saveCustomAgent({
      id: agentId,
      name: title,
      shortName: title.slice(0, 1),
      description,
      personaPrompt,
      type: 'information',
      color: '#4f6b95',
      defaultEnabled: false,
      sourceType: 'skill',
      sourceUrl: skillUrl,
      sourceTitle: title,
      importedAt: new Date().toISOString(),
      compatibility
    });

    showToast(
      compatibility === 'prompt_only'
        ? getMessageWithFallback('agentSkillImportPartialSuccess', 'Skill imported as a prompt-style skill')
        : getMessageWithFallback('agentSkillImportSuccess', 'Skill imported successfully')
    );

    if (urlInput) urlInput.value = '';
    if (contentInput) contentInput.value = '';
    closeAgentImportDialog();
    await loadAgentCustomSettingsManager();
  } catch (error) {
    console.error('导入 skill 失败:', error);
    showToast(
      getMessageWithFallback('agentSkillImportFailed', 'Skill import failed') + (error?.message ? `: ${error.message}` : ''),
      4000
    );
  }
}

let agentSkillUrlAutoFetchTimer = null;

async function autoFetchAgentSkillContentFromUrl() {
  const urlInput = document.getElementById('agentSkillUrl');
  const contentInput = document.getElementById('agentSkillContent');
  const rawUrl = String(urlInput?.value || '').trim();
  if (!rawUrl || !contentInput) {
    return;
  }

  contentInput.dataset.skillContentLoading = 'true';
  try {
    const fetched = await fetchSkillMarkdownFromUrl(rawUrl);
    contentInput.value = String(fetched.content || '').trim();
  } catch (error) {
    console.warn('自动抓取 Skill 内容失败:', error);
  } finally {
    delete contentInput.dataset.skillContentLoading;
  }
}

function scheduleAutoFetchAgentSkillContent() {
  clearTimeout(agentSkillUrlAutoFetchTimer);
  agentSkillUrlAutoFetchTimer = setTimeout(() => {
    autoFetchAgentSkillContentFromUrl().catch((error) => {
      console.warn('自动抓取 Skill 内容失败:', error);
    });
  }, 500);
}

async function initializeLaunchSettings() {
  try {
    await Promise.allSettled([
      renderOfficialEntryUrlConfigs(),
      loadCustomSitesManager()
    ]);
    bindCustomSiteManagerEvents();
  } catch (error) {
    console.error('初始化 launch settings 失败:', error);
  }
}

async function saveOfficialEntryUrl(siteName, entryUrl) {
  try {
    const normalizedEntryUrl = typeof entryUrl === 'string' ? entryUrl.trim() : '';
    const { sites: existingUserSettings = {} } = await chrome.storage.sync.get('sites');
    const updatedUserSettings = { ...existingUserSettings };
    if (!updatedUserSettings[siteName]) {
      updatedUserSettings[siteName] = {};
    }

    if (normalizedEntryUrl) {
      updatedUserSettings[siteName].entryUrl = normalizedEntryUrl;
    } else {
      delete updatedUserSettings[siteName].entryUrl;
    }

    await chrome.storage.sync.set({ sites: updatedUserSettings });
    showToast(getLaunchMessage('saveSuccess', 'Configuration saved'));
    await renderOfficialEntryUrlConfigs();
  } catch (error) {
    console.error('保存 entryUrl 失败:', error);
    showToast(getLaunchMessage('saveFailed', 'Save failed'), true);
  }
}

async function renderOfficialEntryUrlConfigs() {
  const container = document.getElementById('officialEntryUrlConfigs');
  if (!container) {
    return;
  }

  try {
    const [sites, syncData] = await Promise.all([
      window.getDefaultSites?.() || [],
      chrome.storage.sync.get('sites')
    ]);
    const userSites = syncData?.sites || {};

    container.innerHTML = '';

    if (!Array.isArray(sites) || sites.length === 0) {
      container.innerHTML = `
        <div class="site-list-empty" style="grid-column: 1 / -1;">
          ${getLaunchMessage('officialEntryUrlEmpty', 'No official sites found')}
        </div>
      `;
      return;
    }

    const fragment = document.createDocumentFragment();
    sites.forEach((site, index) => {
      const siteName = site?.name || '';
      if (!siteName) {
        return;
      }

      const storedEntryUrl = typeof userSites[siteName]?.entryUrl === 'string'
        ? userSites[siteName].entryUrl
        : '';
      const currentEntryUrl = storedEntryUrl || site.entryUrl || '';
      const safeId = `entry-url-${index}-${String(siteName).replace(/[^a-zA-Z0-9_-]/g, '_')}`;

      const card = document.createElement('div');
      card.className = 'site-config';
      card.dataset.siteName = siteName;
      card.innerHTML = `
        <div class="site-header site-setting-row">
          <span class="site-name-display">${siteName}</span>
          <div class="site-setting-actions">
            <button type="button" class="btn-secondary reset-entry-url-btn" data-site-name="${siteName}">
              ${getLaunchMessage('entryUrlResetButton', 'Reset')}
            </button>
            <button type="button" class="btn-primary save-entry-url-btn" data-site-name="${siteName}">
              ${getLaunchMessage('saveButton', 'Save')}
            </button>
          </div>
        </div>
        <div class="site-setting-field">
          <label for="${safeId}" class="site-setting-label">
            ${getLaunchMessage('entryUrlLabel', 'Entry URL')}
          </label>
          <input
            type="url"
            id="${safeId}"
            class="entry-url-input"
            value="${currentEntryUrl.replace(/"/g, '&quot;')}"
            placeholder="${getLaunchMessage('entryUrlPlaceholder', 'Enter a launch URL or use {query}')}"
          >
        </div>
      `;

      const input = card.querySelector('.entry-url-input');
      const saveBtn = card.querySelector('.save-entry-url-btn');
      const resetBtn = card.querySelector('.reset-entry-url-btn');

      saveBtn?.addEventListener('click', async () => {
        await saveOfficialEntryUrl(siteName, input?.value || '');
      });
      resetBtn?.addEventListener('click', async () => {
        if (input) {
          input.value = '';
        }
        await saveOfficialEntryUrl(siteName, '');
      });

      fragment.appendChild(card);
    });

    container.appendChild(fragment);
  } catch (error) {
    console.error('渲染 entryUrl 配置失败:', error);
    container.innerHTML = `
      <div class="site-list-empty" style="grid-column: 1 / -1;">
        ${getLaunchMessage('officialEntryUrlLoadFailed', 'Failed to load official site settings')}
      </div>
    `;
  }
}

async function loadCustomSitesManager() {
  const container = document.getElementById('customSitesAdminList');
  if (!container) {
    return;
  }

  try {
    const customSites = await window.getCustomSites?.() || [];
    renderCustomSitesManager(customSites);
  } catch (error) {
    console.error('加载 customSites 管理列表失败:', error);
    container.innerHTML = `
      <div class="site-list-empty" style="grid-column: 1 / -1;">
        ${getLaunchMessage('customSiteListLoadFailed', 'Failed to load custom sites.')}
      </div>
    `;
  }
}

function renderCustomSitesManager(customSites = []) {
  const container = document.getElementById('customSitesAdminList');
  if (!container) {
    return;
  }

  container.innerHTML = '';
  const list = Array.isArray(customSites) ? customSites : [];

  if (list.length === 0) {
    container.innerHTML = `
      <div class="site-list-empty" style="grid-column: 1 / -1;">
        ${getLaunchMessage('customSiteListEmpty', 'No custom sites yet')}
      </div>
    `;
    return;
  }

  const fragment = document.createDocumentFragment();
  list.forEach(site => {
    const siteId = escapeHtml(site?.id || '');
    const siteName = escapeHtml(site?.name || '');
    const siteUrl = escapeHtml(site?.url || '');
    const siteNote = typeof site?.note === 'string' ? site.note.trim() : '';
    const siteIcon = typeof site?.icon === 'string' ? site.icon.trim() : '';
    const displayNote = siteNote
      ? `
        <div class="custom-site-detail">
          ${getLaunchMessage('customSiteNoteLabel', 'Note')}: ${escapeHtml(siteNote)}
        </div>
      `
      : '';
    const displayIcon = siteIcon
      ? `
        <div class="custom-site-detail">
          ${getLaunchMessage('customSiteIconLabel', 'Icon')}: ${escapeHtml(siteIcon)}
        </div>
      `
      : '';
    const card = document.createElement('div');
    card.className = 'template-item custom-site-card';
    card.dataset.siteId = site?.id || '';
    card.title = [siteNote, siteIcon, site?.url || '']
      .filter(Boolean)
      .join(' · ');
    card.innerHTML = `
      <div class="template-item-head">
        <div class="template-item-body">
          <h4 class="template-item-title">${siteName}</h4>
          <div class="custom-site-url">${siteUrl}</div>
          ${displayNote}
          ${displayIcon}
          <div class="custom-site-summary">
            ${site.enabled ? getLaunchMessage('customSiteEnabledBadge', 'Enabled') : getLaunchMessage('customSiteDisabledBadge', 'Disabled')}
            ${site.order !== undefined ? ` · #${site.order}` : ''}
          </div>
        </div>
        <div class="template-actions">
          <button type="button" class="btn-secondary edit-custom-site-btn" data-site-id="${siteId}">${getLaunchMessage('editButton', 'Edit')}</button>
          <button type="button" class="btn-secondary delete-custom-site-btn" data-site-id="${siteId}">${getLaunchMessage('deleteButton', 'Delete')}</button>
        </div>
      </div>
    `;
    fragment.appendChild(card);
  });

  container.appendChild(fragment);
}

function bindCustomSiteManagerEvents() {
  if (bindCustomSiteManagerEvents.bound === true) {
    return;
  }
  bindCustomSiteManagerEvents.bound = true;

  document.getElementById('addCustomSiteBtn')?.addEventListener('click', () => {
    openCustomSiteDialog();
  });

  document.getElementById('customSitesAdminList')?.addEventListener('click', handleCustomSiteListClick);

  document.getElementById('customSiteDialogClose')?.addEventListener('click', closeCustomSiteDialog);
  document.getElementById('cancelCustomSite')?.addEventListener('click', closeCustomSiteDialog);
  document.getElementById('saveCustomSite')?.addEventListener('click', saveCustomSiteFromDialog);
  document.getElementById('customSiteDialogOverlay')?.addEventListener('click', closeCustomSiteDialog);
}

function openCustomSiteDialog(site = null) {
  currentEditingCustomSiteId = site?.id || null;

  const dialog = document.getElementById('customSiteDialog');
  const title = document.getElementById('customSiteDialogTitle');
  const idInput = document.getElementById('customSiteId');
  const nameInput = document.getElementById('customSiteName');
  const urlInput = document.getElementById('customSiteUrl');
  const enabledInput = document.getElementById('customSiteEnabled');
  const orderInput = document.getElementById('customSiteOrder');

  if (!dialog) {
    return;
  }

  if (title) {
    title.textContent = site
      ? getLaunchMessage('customSiteEditTitle', 'Edit custom site')
      : getLaunchMessage('customSiteAddTitle', 'Add custom site');
  }

  if (idInput) idInput.value = site?.id || '';
  if (nameInput) nameInput.value = site?.name || '';
  if (urlInput) urlInput.value = site?.url || '';
  if (enabledInput) enabledInput.checked = site?.enabled !== false;
  if (orderInput) orderInput.value = Number.isFinite(Number(site?.order)) ? String(site.order) : '0';

  dialog.style.display = 'block';
}

function closeCustomSiteDialog() {
  const dialog = document.getElementById('customSiteDialog');
  if (dialog) {
    dialog.style.display = 'none';
  }
  currentEditingCustomSiteId = null;
}

function readCustomSiteDialogValue() {
  const idInput = document.getElementById('customSiteId');
  const nameInput = document.getElementById('customSiteName');
  const urlInput = document.getElementById('customSiteUrl');
  const enabledInput = document.getElementById('customSiteEnabled');
  const orderInput = document.getElementById('customSiteOrder');

  const rawSite = {
    id: idInput?.value || currentEditingCustomSiteId || '',
    name: nameInput?.value.trim() || '',
    url: urlInput?.value.trim() || '',
    enabled: enabledInput?.checked !== false,
    order: Number.isFinite(Number(orderInput?.value)) ? Number(orderInput.value) : 0
  };

  const utils = getLaunchSettingsUtils();
  if (utils && typeof utils.normalizeCustomSite === 'function') {
    const normalizedSite = utils.normalizeCustomSite(rawSite, rawSite.order);
    if (!normalizedSite) {
      return null;
    }
    const { note, icon, ...siteWithoutDialogOnlyFields } = normalizedSite;
    return siteWithoutDialogOnlyFields;
  }

  if (!rawSite.name || !rawSite.url) {
    return null;
  }

  return {
    ...rawSite,
    id: rawSite.id || `custom-site-${Date.now()}`,
    url: normalizeCustomSiteUrlValue(rawSite.url),
    supportIframe: true,
    order: rawSite.order || 0
  };
}

async function saveCustomSiteFromDialog() {
  try {
    const nextSite = readCustomSiteDialogValue();
    if (!nextSite) {
      showToast(getLaunchMessage('customSiteValidationFailed', 'Please fill in name and URL'), true);
      return;
    }

    const { customSites: existingCustomSites = [] } = await chrome.storage.sync.get('customSites');
    const currentList = Array.isArray(existingCustomSites) ? existingCustomSites : [];
    const nextId = currentEditingCustomSiteId || nextSite.id;
    const replaced = currentList.some(site => site.id === nextId)
      ? currentList.map(site => (site.id === nextId ? { ...site, ...nextSite, id: nextId } : site))
      : [...currentList, { ...nextSite, id: nextId }];

    const utils = getLaunchSettingsUtils();
    const normalized = utils && typeof utils.normalizeCustomSites === 'function'
      ? utils.normalizeCustomSites(replaced)
      : replaced;

    await chrome.storage.sync.set({ customSites: normalized });
    showToast(getLaunchMessage('saveSuccess', 'Configuration saved'));
    await loadCustomSitesManager();
    closeCustomSiteDialog();
  } catch (error) {
    console.error('保存 customSite 失败:', error);
    showToast(getLaunchMessage('saveFailed', 'Save failed'), true);
  }
}

async function deleteCustomSite(siteId) {
  try {
    const confirmMessage = getLaunchMessage('customSiteDeleteConfirm', 'Delete this custom site?');
    if (!window.confirm(confirmMessage)) {
      return;
    }

    const { customSites: existingCustomSites = [] } = await chrome.storage.sync.get('customSites');
    const nextList = (Array.isArray(existingCustomSites) ? existingCustomSites : []).filter(site => site.id !== siteId);
    const utils = getLaunchSettingsUtils();
    const normalized = utils && typeof utils.normalizeCustomSites === 'function'
      ? utils.normalizeCustomSites(nextList)
      : nextList;

    await chrome.storage.sync.set({ customSites: normalized });
    showToast(getLaunchMessage('saveSuccess', 'Configuration saved'));
    await loadCustomSitesManager();
  } catch (error) {
    console.error('删除 customSite 失败:', error);
    showToast(getLaunchMessage('saveFailed', 'Save failed'), true);
  }
}

function handleCustomSiteListClick(event) {
  const editBtn = event.target.closest('.edit-custom-site-btn');
  const deleteBtn = event.target.closest('.delete-custom-site-btn');
  if (!editBtn && !deleteBtn) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const siteId = editBtn?.dataset.siteId || deleteBtn?.dataset.siteId;
  if (!siteId) {
    return;
  }

  (async () => {
    const { customSites: existingCustomSites = [] } = await chrome.storage.sync.get('customSites');
    const site = (Array.isArray(existingCustomSites) ? existingCustomSites : []).find(item => item.id === siteId);
    if (!site) {
      return;
    }

    if (editBtn) {
      openCustomSiteDialog(site);
      return;
    }

    if (deleteBtn) {
      await deleteCustomSite(siteId);
    }
  })();
}


// 初始化快捷入口配置
async function initializeButtonConfigs() {
  try {
    // 获取存储的按钮配置
    let { buttonConfig } = await chrome.storage.sync.get(['buttonConfig']);
    
    // 从 appConfig.json 获取默认配置
    const defaultButtonConfig = await window.AppConfigManager.getButtonConfig();
    
    let currentConfig = {
      ...defaultButtonConfig,
      ...(buttonConfig || {})
    };

    console.log('初始配置:', currentConfig);

    // 配置项定义
    const configItems = [
      { id: 'floatButtonSwitch', configKey: 'floatButton', name: getMessage("floatButton") },
      { id: 'selectionQuickSearchSwitch', configKey: 'selectionQuickSearch', name: getMessage("selectionQuickSearch") },
      { id: 'selectionCompareButtonSwitch', configKey: 'selectionCompareButton', name: getMessage("selectionCompareButton") },
      { id: 'aiSiteUserPromptButtonsSwitch', configKey: 'aiSiteUserPromptButtons', name: getMessage("aiSiteUserPromptButtons") || 'AI site buttons (compare/favorite)' },
      { id: 'contextMenuSwitch', configKey: 'contextMenu', name: getMessage("contextMenu") },
      { id: 'searchEngineSwitch', configKey: 'searchEngine', name: getMessage("searchEngine") }
    ];

    const buttonContainer = document.getElementById('buttonSiteConfigs');
    if (!buttonContainer) return;
    
    buttonContainer.innerHTML = '';

    configItems.forEach(item => {
      const configDiv = document.createElement('div');
      configDiv.className = 'site-config';
      configDiv.innerHTML = `
        <div class="site-header">
          <label class="switch">
            <input type="checkbox" id="${item.id}"
              ${currentConfig[item.configKey] ? 'checked' : ''}>
            <span class="slider round"></span>
          </label>
          <span class="site-name-display">${item.name}</span>
        </div>
      `;
      buttonContainer.appendChild(configDiv);

      const switchElement = configDiv.querySelector(`#${item.id}`);
      switchElement.addEventListener('change', async (e) => {
        // 每次更改前先获取最新的配置
        const { buttonConfig: latestConfig } = await chrome.storage.sync.get(['buttonConfig']);
        const updatedConfig = {
          ...defaultButtonConfig,
          ...(latestConfig || currentConfig),  // 使用最新的配置作为基础
          [item.configKey]: e.target.checked
        };
        
        await chrome.storage.sync.set({ buttonConfig: updatedConfig });
        // 更新当前配置
        currentConfig = updatedConfig;
        console.log(`已更新${item.name}配置:`, updatedConfig);
        if (chrome.runtime.lastError) {
          showToast(getMessage("saveFailed", [chrome.runtime.lastError.message]));
          return;
        }
        showToast(getMessage("saveSuccess"));
        
      });
    });

    const sendShortcutContainer = document.getElementById('sendShortcutConfig');
    if (sendShortcutContainer) {
      const enterLabel = getMessage('sendShortcutOptionEnter') || 'Send with Enter';
      const modifierLabel = getMessage('sendShortcutOptionModifierEnter') || 'Send with Ctrl+Enter / ⌘+Enter';

      sendShortcutContainer.innerHTML = `
        <div class="site-config">
          <div class="site-header site-setting-row">
            <div class="site-setting-meta">
              <span class="site-setting-title">${getMessage('sendShortcutTitle') || 'Submit Shortcut'}</span>
              <div class="site-config-help">${getMessage('sendShortcutHelp') || 'Shift+Enter always inserts a newline.'}</div>
            </div>
            <select id="sendShortcutSelect" class="site-setting-select">
              <option value="enter">${enterLabel}</option>
              <option value="modifierEnter">${modifierLabel}</option>
            </select>
          </div>
        </div>
      `;

      const sendShortcutSelect = sendShortcutContainer.querySelector('#sendShortcutSelect');
      if (sendShortcutSelect) {
        sendShortcutSelect.value = currentConfig.sendShortcut || 'enter';
        sendShortcutSelect.addEventListener('change', async (e) => {
          const { buttonConfig: latestConfig } = await chrome.storage.sync.get(['buttonConfig']);
          const updatedConfig = {
            ...defaultButtonConfig,
            ...(latestConfig || currentConfig),
            sendShortcut: e.target.value
          };

          await chrome.storage.sync.set({ buttonConfig: updatedConfig });
          currentConfig = updatedConfig;
          if (chrome.runtime.lastError) {
            showToast(getMessage("saveFailed", [chrome.runtime.lastError.message]));
            return;
          }
          showToast(getMessage("saveSuccess"));
        });
      }
    }

  } catch (error) {
    console.error('初始化按钮配置失败:', error);
  }
}

const DEFAULT_SETTINGS_SECTION = 'quick-entry';
const SETTINGS_SCROLL_TARGET_PARAM = 'scrollTarget';

function getSettingsSections() {
  return Array.from(document.querySelectorAll('.settings-section'))
    .map(section => section?.id)
    .filter(Boolean);
}

function getSafeSettingsSection(sectionId) {
  const sections = getSettingsSections();
  if (sectionId && sections.includes(sectionId)) {
    return sectionId;
  }
  return sections.includes(DEFAULT_SETTINGS_SECTION)
    ? DEFAULT_SETTINGS_SECTION
    : (sections[0] || '');
}

function showSettingsSection(sectionId, options = {}) {
  const { updateHash = false, scrollToTop = true } = options;
  const activeSection = getSafeSettingsSection(sectionId);
  if (!activeSection) {
    return;
  }

  document.querySelectorAll('.settings-section').forEach(section => {
    const isActive = section.id === activeSection;
    section.classList.toggle('is-active', isActive);
    section.hidden = !isActive;
    section.setAttribute('aria-hidden', String(!isActive));
  });

  document.querySelectorAll('.nav-link').forEach(link => {
    const isActive = link.getAttribute('data-section') === activeSection;
    link.classList.toggle('active', isActive);
    if (isActive) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });

  if (updateHash) {
    const nextHash = `#${activeSection}`;
    if (window.location.hash !== nextHash) {
      window.history.pushState(null, '', nextHash);
    }
  }

  if (scrollToTop) {
    const mainContent = document.querySelector('.main-content');
    if (mainContent) {
      mainContent.scrollTop = 0;
    }
    window.scrollTo(0, 0);
  }
}

function getRequestedSettingsScrollTarget() {
  try {
    return new URLSearchParams(window.location.search).get(SETTINGS_SCROLL_TARGET_PARAM) || '';
  } catch (_) {
    return '';
  }
}

function clearRequestedSettingsScrollTarget() {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(SETTINGS_SCROLL_TARGET_PARAM)) {
      return;
    }
    url.searchParams.delete(SETTINGS_SCROLL_TARGET_PARAM);
    window.history.replaceState(null, '', url.toString());
  } catch (_) {}
}

function scrollToSettingsTarget(targetId) {
  const normalizedTargetId = String(targetId || '').trim();
  if (!normalizedTargetId) {
    return false;
  }

  const target = document.getElementById(normalizedTargetId);
  if (!target) {
    return false;
  }

  const mainContent = document.querySelector('.main-content');
  if (mainContent && typeof target.offsetTop === 'number') {
    mainContent.scrollTo({
      top: Math.max(0, target.offsetTop - 20),
      behavior: 'smooth'
    });
  } else {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  return true;
}

function handleHashNavigation() {
  const requestedSection = window.location.hash
    ? window.location.hash.substring(1)
    : DEFAULT_SETTINGS_SECTION;
  const activeSection = getSafeSettingsSection(requestedSection);
  showSettingsSection(activeSection, { updateHash: false, scrollToTop: false });

  const scrollTarget = getRequestedSettingsScrollTarget();
  if (!scrollTarget) {
    return;
  }

  requestAnimationFrame(() => {
    scrollToSettingsTarget(scrollTarget);
    clearRequestedSettingsScrollTarget();
  });
}

// 初始化导航功能
function initializeNavigation() {
  const navLinks = document.querySelectorAll('.nav-link');

  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const targetSection = link.getAttribute('data-section');
      showSettingsSection(targetSection, { updateHash: true });
    });
  });
}

// 初始化规则信息
async function initializeRuleInfo() {
  try {
    let timeDisplay = getMessage('ruleUpdateTimePrefix');
    
    // 获取存储中的版本时间
    let storageTime = null;
    const { siteConfigVersion } = await chrome.storage.local.get('siteConfigVersion');
    if (siteConfigVersion) {
      try {
        const timestamp = parseInt(siteConfigVersion);
        if (!isNaN(timestamp)) {
          storageTime = new Date(timestamp);
          console.log('存储中的时间:', storageTime);
        }
      } catch (error) {
        console.error('解析存储时间失败:', error);
      }
    }
    
    // 获取本地配置文件的时间
    let localTime = null;
    try {
      const response = await fetch(chrome.runtime.getURL('config/siteHandlers.json'));
      const localConfig = await response.json();
      if (localConfig.lastUpdated) {
        localTime = new Date(localConfig.lastUpdated);
        console.log('本地配置文件时间:', localTime);
      }
    } catch (error) {
      console.error('读取本地配置文件失败:', error);
    }
    
    // 比较两个时间，取较大值
    let latestTime = null;
    if (storageTime && localTime) {
      latestTime = storageTime > localTime ? storageTime : localTime;
      console.log('取较大时间:', latestTime);
    } else if (storageTime) {
      latestTime = storageTime;
      console.log('使用存储时间:', latestTime);
    } else if (localTime) {
      latestTime = localTime;
      console.log('使用本地时间:', latestTime);
    }
    
    // 格式化显示
    if (latestTime) {
      const year = latestTime.getFullYear();
      const month = String(latestTime.getMonth() + 1).padStart(2, '0');
      const day = String(latestTime.getDate()).padStart(2, '0');
      const hours = String(latestTime.getHours()).padStart(2, '0');
      const minutes = String(latestTime.getMinutes()).padStart(2, '0');
      const seconds = String(latestTime.getSeconds()).padStart(2, '0');
      timeDisplay = `${getMessage('ruleUpdateTimePrefix')}${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    } else {
      timeDisplay = getMessage('ruleUpdateTimeNotAvailable');
    }
    
    // 更新显示
    const timeElement = document.getElementById('ruleUpdateTime');
    if (timeElement) {
      timeElement.textContent = timeDisplay;
    }
    
    // 添加参与规则开发按钮的点击事件
    const devButton = document.getElementById('participateRuleDev');
    if (devButton) {
      devButton.onclick = () => {
        chrome.tabs.create({
          url: 'https://github.com/taoAIGC/AI-Shortcuts/blob/main/config/siteHandlers.json'
        });
      };
    }
    
  } catch (error) {
    console.error('初始化规则信息失败:', error);
    
    // 显示错误信息
    const timeElement = document.getElementById('ruleUpdateTime');
    if (timeElement) {
      timeElement.textContent = getMessage('ruleUpdateTimeError');
    }
  }
}

// 初始化禁用网站管理
async function initializeDisabledSites() {
  const container = document.getElementById('disabledSitesList');
  if (!container) return;

  try {
    const { disabledSites = [] } = await chrome.storage.sync.get('disabledSites');
    
    if (disabledSites.length === 0) {
      container.innerHTML = `
        <div class="empty-state state-panel">
          <p>${getMessage('noDisabledSites') || 'No disabled sites'}</p>
        </div>
      `;
      return;
    }

    container.innerHTML = disabledSites.map(site => `
      <div class="disabled-site-item">
        <div class="site-info">
          <span class="site-domain">${site}</span>
          <span class="site-note">${getMessage('floatButtonDisabledNote') || 'Floating button disabled'}</span>
        </div>
        <div class="site-actions">
          <button class="enable-btn btn-secondary" data-domain="${site}">
            ${getMessage('reEnableFloatButtonButton') || 'Re-enable'}
          </button>
        </div>
      </div>
    `).join('');

    if (container.dataset.bound !== 'true') {
      container.dataset.bound = 'true';
      container.addEventListener('click', handleDisabledSiteAction);
    }
    
  } catch (error) {
    console.error('加载禁用网站列表失败:', error);
    container.innerHTML = `
      <div class="error-state state-panel">
        <p>${getMessage('disabledSitesLoadFailed') || 'Failed to load. Please refresh and try again.'}</p>
      </div>
    `;
  }
}

// 处理禁用网站操作
async function handleDisabledSiteAction(event) {
  const target = event.target;
  if (!target.matches('.enable-btn')) return;
  
  const domain = target.getAttribute('data-domain');
  if (!domain) return;

  try {
    const { disabledSites = [] } = await chrome.storage.sync.get('disabledSites');
    
    // 重新启用网站 - 从禁用列表中移除
    const updatedSites = disabledSites.filter(site => site !== domain);
    await chrome.storage.sync.set({ disabledSites: updatedSites });
    
    showToast(getMessageWithFallback('reEnableFloatButtonSuccess', 'Re-enabled the floating button for $1', [domain]));

    // 重新加载列表
    initializeDisabledSites();
    
  } catch (error) {
    console.error('操作失败:', error);
    showToast(getMessageWithFallback('operationFailedRetry', 'Operation failed. Please try again.'));
  }
}

// ============================
// 提示词模板管理功能
// ============================

// 当前编辑的模板ID
let currentEditingTemplateId = null;
let currentEditingAnalysisTemplateId = null;
let currentEditingCustomSiteId = null;
let currentEditingAgentId = null;
const PROMPT_TEMPLATE_LOCALE_DIRS = ['ar', 'de', 'en', 'es', 'fr', 'ja', 'ko', 'pt_BR', 'zh_CN', 'zh_TW'];
const PROMPT_TEMPLATE_DEFAULT_DEFINITIONS = [
  {
    id: 'risk_analysis',
    nameKey: 'defaultTemplateRiskAnalysisName',
    queryKey: 'defaultTemplateRiskAnalysisQuery',
    fallbackName: 'RiskAnalysis',
    fallbackQuery: 'Root cause of the failure:「{query}」',
    type: 'information',
    order: 1
  },
  {
    id: 'best_practice',
    nameKey: 'defaultTemplateBestPracticeName',
    queryKey: 'defaultTemplateBestPracticeQuery',
    fallbackName: 'BestPractice',
    fallbackQuery: 'Write a success retrospective report on this project:「{query}」',
    type: 'information',
    order: 2
  },
  {
    id: 'translate_to_chinese',
    nameKey: 'defaultTemplateTranslateToChineseName',
    queryKey: 'defaultTemplateTranslateToChineseQuery',
    fallbackName: 'Translate to Chinese',
    fallbackQuery: 'Translate the following content into Chinese:\n\n{query}',
    type: 'information',
    order: 3
  }
];
const LEGACY_PROMPT_TEMPLATE_SIGNATURES = {
  risk_analysis: [
    {
      name: 'RiskAnalysis',
      query: 'Root cause of the failure:「{query}」'
    }
  ],
  best_practice: [
    {
      name: 'BestPractice',
      query: 'Write a success retrospective report on this project:「{query}」'
    }
  ],
  translate_to_chinese: []
};
let promptTemplateSignatureMapPromise = null;
const ANALYSIS_TEMPLATE_LOCALE_DIRS = ['ar', 'de', 'en', 'es', 'fr', 'ja', 'ko', 'pt_BR', 'zh_CN', 'zh_TW'];
const ANALYSIS_TEMPLATE_DEFAULT_DEFINITIONS = [
  {
    id: 'analysis_conclusion_first',
    nameKey: 'defaultAnalysisTemplateConclusionName',
    queryKey: 'defaultAnalysisTemplateConclusionQuery',
    fallbackName: '结论先行',
    fallbackQuery: '请先给出一个明确判断，再用最关键的证据支撑它。最后补充你的置信度和可能例外。\n\n{analysisInput}',
    order: 1
  },
  {
    id: 'analysis_difference_focus',
    nameKey: 'defaultAnalysisTemplateDifferenceName',
    queryKey: 'defaultAnalysisTemplateDifferenceQuery',
    fallbackName: '对比拆解',
    fallbackQuery: '请把各站答案做逐项对比，至少从“共同点 / 分歧点 / 互相矛盾 / 谁更可靠”四个角度分析，并尽量用表格或分组方式呈现。\n\n{analysisInput}',
    order: 2
  },
  {
    id: 'analysis_report',
    nameKey: 'defaultAnalysisTemplateReportName',
    queryKey: 'defaultAnalysisTemplateReportQuery',
    fallbackName: '决策备忘录',
    fallbackQuery: '请把这份材料写成一页决策备忘录：先给建议，再说明为什么这么选、有什么风险、下一步怎么做。语气直接，面向实际决策。\n\n{analysisInput}',
    order: 3
  }
];
const LEGACY_ANALYSIS_TEMPLATE_SIGNATURES = {
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
let analysisTemplateSignatureMapPromise = null;

// 初始化提示词模板管理
async function initializePromptTemplates() {
  try {
    await loadConfiguredTemplateTypes();

    // 确保有默认模板
    await ensureDefaultTemplates();
    await syncDefaultPromptTemplatesToRuntimeLanguage();
    
    // 加载并显示模板列表
    await loadTemplatesList();
    
    // 绑定事件监听器
    bindTemplateEvents();
    
    console.log('提示词模板管理初始化完成');
  } catch (error) {
    console.error('初始化提示词模板失败:', error);
  }
}

function buildRuntimeDefaultPromptTemplates() {
  return PROMPT_TEMPLATE_DEFAULT_DEFINITIONS.map((definition) => ({
    id: definition.id,
    name: getMessage(definition.nameKey) || definition.fallbackName,
    query: getMessage(definition.queryKey) || definition.fallbackQuery,
    type: definition.type,
    order: definition.order,
    isDefault: true
  }));
}

async function getPromptTemplateSignatureMap() {
  if (promptTemplateSignatureMapPromise) {
    return promptTemplateSignatureMapPromise;
  }

  promptTemplateSignatureMapPromise = (async () => {
    const signatureMap = {};

    PROMPT_TEMPLATE_DEFAULT_DEFINITIONS.forEach(({ id }) => {
      signatureMap[id] = [...(LEGACY_PROMPT_TEMPLATE_SIGNATURES[id] || [])];
    });

    for (const localeDir of PROMPT_TEMPLATE_LOCALE_DIRS) {
      try {
        const response = await fetch(chrome.runtime.getURL(`_locales/${localeDir}/messages.json`));
        if (!response.ok) {
          continue;
        }

        const localeMessages = await response.json();
        PROMPT_TEMPLATE_DEFAULT_DEFINITIONS.forEach(({ id, nameKey, queryKey }) => {
          const name = String(localeMessages?.[nameKey]?.message || '').trim();
          const query = String(localeMessages?.[queryKey]?.message || '').trim();
          if (!name || !query) {
            return;
          }

          const alreadyExists = signatureMap[id].some((signature) => (
            signature.name === name && signature.query === query
          ));
          if (!alreadyExists) {
            signatureMap[id].push({ name, query });
          }
        });
      } catch (error) {
        console.warn(`读取聊天提示词 locale 失败: ${localeDir}`, error);
      }
    }

    return signatureMap;
  })();

  return promptTemplateSignatureMapPromise;
}

async function syncDefaultPromptTemplatesToRuntimeLanguage() {
  const { promptTemplates = [] } = await chrome.storage.sync.get('promptTemplates');
  const existingTemplates = Array.isArray(promptTemplates) ? promptTemplates : [];
  if (existingTemplates.length === 0) {
    return false;
  }

  const desiredTemplates = buildRuntimeDefaultPromptTemplates();
  const desiredById = new Map(desiredTemplates.map((template) => [template.id, template]));
  const signaturesById = await getPromptTemplateSignatureMap();

  let changed = false;
  const nextTemplates = existingTemplates.map((template) => {
    const desired = desiredById.get(template?.id);
    if (!desired) {
      return template;
    }

    const signatures = signaturesById[template.id] || [];
    const matchesKnownDefault = signatures.some((signature) => (
      String(signature?.name || '').trim() === String(template?.name || '').trim()
      && String(signature?.query || '').trim() === String(template?.query || '').trim()
    ));

    if (!matchesKnownDefault) {
      return template;
    }

    const needsUpdate = (
      String(template?.name || '').trim() !== desired.name
      || String(template?.query || '').trim() !== desired.query
      || String(template?.type || '').trim() !== desired.type
      || Number(template?.order || 0) !== desired.order
      || template?.isDefault !== true
    );

    if (!needsUpdate) {
      return template;
    }

    changed = true;
    return {
      ...template,
      name: desired.name,
      query: desired.query,
      type: desired.type,
      order: desired.order,
      isDefault: true
    };
  });

  if (changed) {
    await chrome.storage.sync.set({ promptTemplates: nextTemplates });
  }

  return changed;
}

async function initializeAnalysisPromptTemplates() {
  try {
    await ensureDefaultAnalysisTemplates();
    await syncDefaultAnalysisPromptTemplatesToRuntimeLanguage();
    await loadAnalysisTemplatesList();
    bindAnalysisTemplateEvents();
    console.log('分析提示词模板管理初始化完成');
  } catch (error) {
    console.error('初始化分析提示词模板失败:', error);
  }
}

function buildRuntimeDefaultAnalysisTemplates() {
  return ANALYSIS_TEMPLATE_DEFAULT_DEFINITIONS.map((definition) => ({
    id: definition.id,
    name: getMessage(definition.nameKey) || definition.fallbackName,
    query: getMessage(definition.queryKey) || definition.fallbackQuery,
    order: definition.order,
    isDefault: true
  }));
}

async function getAnalysisTemplateSignatureMap() {
  if (analysisTemplateSignatureMapPromise) {
    return analysisTemplateSignatureMapPromise;
  }

  analysisTemplateSignatureMapPromise = (async () => {
    const signatureMap = {};

    ANALYSIS_TEMPLATE_DEFAULT_DEFINITIONS.forEach(({ id }) => {
      signatureMap[id] = [...(LEGACY_ANALYSIS_TEMPLATE_SIGNATURES[id] || [])];
    });

    for (const localeDir of ANALYSIS_TEMPLATE_LOCALE_DIRS) {
      try {
        const response = await fetch(chrome.runtime.getURL(`_locales/${localeDir}/messages.json`));
        if (!response.ok) {
          continue;
        }

        const localeMessages = await response.json();
        ANALYSIS_TEMPLATE_DEFAULT_DEFINITIONS.forEach(({ id, nameKey, queryKey }) => {
          const name = String(localeMessages?.[nameKey]?.message || '').trim();
          const query = String(localeMessages?.[queryKey]?.message || '').trim();
          if (!name || !query) {
            return;
          }

          const alreadyExists = signatureMap[id].some((signature) => (
            signature.name === name && signature.query === query
          ));
          if (!alreadyExists) {
            signatureMap[id].push({ name, query });
          }
        });
      } catch (error) {
        console.warn(`读取分析提示词 locale 失败: ${localeDir}`, error);
      }
    }

    return signatureMap;
  })();

  return analysisTemplateSignatureMapPromise;
}

async function syncDefaultAnalysisPromptTemplatesToRuntimeLanguage() {
  const { analysisPromptTemplates = [] } = await chrome.storage.sync.get('analysisPromptTemplates');
  const existingTemplates = Array.isArray(analysisPromptTemplates) ? analysisPromptTemplates : [];
  if (existingTemplates.length === 0) {
    return false;
  }

  const desiredTemplates = buildRuntimeDefaultAnalysisTemplates();
  const desiredById = new Map(desiredTemplates.map((template) => [template.id, template]));
  const signaturesById = await getAnalysisTemplateSignatureMap();

  let changed = false;
  const nextTemplates = existingTemplates.map((template) => {
    const desired = desiredById.get(template?.id);
    if (!desired || template?.isDefault !== true) {
      return template;
    }

    const signatures = signaturesById[template.id] || [];
    const matchesKnownDefault = signatures.some((signature) => (
      String(signature?.name || '').trim() === String(template?.name || '').trim()
      && String(signature?.query || '').trim() === String(template?.query || '').trim()
    ));

    if (!matchesKnownDefault) {
      return template;
    }

    const needsUpdate = (
      String(template?.name || '').trim() !== desired.name
      || String(template?.query || '').trim() !== desired.query
      || Number(template?.order || 0) !== desired.order
    );

    if (!needsUpdate) {
      return template;
    }

    changed = true;
    return {
      ...template,
      name: desired.name,
      query: desired.query,
      order: desired.order,
      isDefault: true
    };
  });

  if (changed) {
    await chrome.storage.sync.set({ analysisPromptTemplates: nextTemplates });
  }

  return changed;
}

// 确保存在默认模板
async function ensureDefaultTemplates() {
  try {
    try {
      await chrome.runtime.sendMessage({ action: 'initializeDefaultTemplates' });
    } catch (error) {
      console.log('无法发送初始化消息，background 可能已处理:', error);
    }
  } catch (error) {
    console.error('检查默认模板失败:', error);
  }
}

// 加载模板列表
async function loadTemplatesList() {
  try {
    const { promptTemplates = [] } = await chrome.storage.sync.get('promptTemplates');
    const container = document.getElementById('templatesList');
    
    if (!container) return;
    
    const sortedTemplates = getPromptTemplateUtils()?.sortPromptTemplates
      ? getPromptTemplateUtils().sortPromptTemplates(promptTemplates, configuredTemplateTypes)
      : promptTemplates.sort((a, b) => (a.order || 0) - (b.order || 0));
    
    if (sortedTemplates.length === 0) {
      container.innerHTML = `
        <div class="state-panel">
          <p>${getMessageWithFallback('promptTemplatesEmpty', 'No prompt templates yet')}</p>
          <p class="state-message">${getMessageWithFallback('promptTemplatesEmptyHint', 'Click the add button above to create one')}</p>
        </div>
      `;
      return;
    }
    
    container.innerHTML = sortedTemplates.map(template => `
      <div class="template-item" data-template-id="${template.id}">
        <div class="template-item-head">
          <div class="template-item-body">
            <h4 class="template-item-title">${template.name}</h4>
            <div class="template-meta">
              <span>${getMessage('templateOrderLabel') || 'Order'}: ${template.order}</span>
              <span class="template-badge">${getPromptTemplateTypeLabel(template.type)}</span>
            </div>
          </div>
          <div class="template-actions">
            <button class="edit-template-btn icon-action-btn" data-template-id="${template.id}" title="${getMessage('editButton')}" aria-label="${getMessage('editButton')}">
              <img src="../icons/edit.svg" alt="">
            </button>
            ${!template.isDefault ? `<button class="delete-template-btn danger-btn" data-template-id="${template.id}" data-i18n="deleteButton">删除</button>` : ''}
          </div>
        </div>
        <div class="template-code">${template.query}</div>
      </div>
    `).join('');
    
  } catch (error) {
    console.error('加载模板列表失败:', error);
  }
}

// 绑定模板相关事件
function bindTemplateEvents() {
  if (bindTemplateEvents.bound === true) {
    return;
  }
  bindTemplateEvents.bound = true;

  // 添加模板按钮
  const addBtn = document.getElementById('addTemplateBtn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      currentEditingTemplateId = null;
      void showTemplateDialog();
    });
  }
  
  // 对话框关闭按钮
  const dialogClose = document.getElementById('dialogClose');
  const cancelBtn = document.getElementById('cancelTemplate');
  const overlay = document.getElementById('dialogOverlay');
  
  [dialogClose, cancelBtn, overlay].forEach(el => {
    if (el) {
      el.addEventListener('click', hideTemplateDialog);
    }
  });
  
  // 保存按钮
  const saveBtn = document.getElementById('saveTemplate');
  if (saveBtn) {
    saveBtn.addEventListener('click', saveTemplate);
  }
  
  // 模板列表事件委托
  const templatesList = document.getElementById('templatesList');
  if (templatesList) {
    templatesList.addEventListener('click', handleTemplateListClick);
  }
}

// 处理模板列表点击事件
async function handleTemplateListClick(event) {
  const editBtn = event.target.closest('.edit-template-btn');
  const deleteBtn = event.target.closest('.delete-template-btn');

  if (editBtn) {
    const templateId = editBtn.getAttribute('data-template-id');
    if (templateId) await editTemplate(templateId);
  } else if (deleteBtn) {
    const templateId = deleteBtn.getAttribute('data-template-id');
    if (templateId) await deleteTemplate(templateId);
  }
}

// 显示模板对话框
async function showTemplateDialog(template = null) {
  const dialog = document.getElementById('templateDialog');
  const title = document.getElementById('dialogTitle');
  const nameInput = document.getElementById('templateName');
  const queryInput = document.getElementById('templateQuery');
  const typeInput = document.getElementById('templateType');
  const orderInput = document.getElementById('templateOrder');
  
  if (!dialog) return;
  await loadConfiguredTemplateTypes();
  
  if (template) {
    // 编辑模式
    title.textContent = getMessage('editTemplateTitle');
    nameInput.value = template.name;
    queryInput.value = template.query;
    populateTemplateTypeOptions(template.type);
    orderInput.value = template.order || 1;
  } else {
    // 添加模式
    title.textContent = getMessage('addTemplateTitle');
    nameInput.value = '';
    queryInput.value = '';
    populateTemplateTypeOptions('information');
    orderInput.value = 1;
    void getNextOrder().then(nextOrder => {
      orderInput.value = nextOrder;
    });
  }
  
  dialog.style.display = 'block';
  typeInput?.blur();
  nameInput.focus();
}

// 隐藏模板对话框
function hideTemplateDialog() {
  const dialog = document.getElementById('templateDialog');
  if (dialog) {
    dialog.style.display = 'none';
  }
  currentEditingTemplateId = null;
}

// 获取下一个排序值
async function getNextOrder() {
  try {
    const { promptTemplates = [] } = await chrome.storage.sync.get('promptTemplates');
    const maxOrder = promptTemplates.reduce((max, template) => 
      Math.max(max, template.order || 0), 0);
    return maxOrder + 1;
  } catch (error) {
    return 1;
  }
}

// 保存模板
async function saveTemplate() {
  const nameInput = document.getElementById('templateName');
  const queryInput = document.getElementById('templateQuery');
  const typeInput = document.getElementById('templateType');
  const orderInput = document.getElementById('templateOrder');
  
  const name = nameInput.value.trim();
  const query = queryInput.value.trim();
  const type = normalizeTemplateType(typeInput?.value);
  const order = parseInt(orderInput.value) || 1;
  
  // 验证
  if (!name) {
    showToast(getMessage('templateNameRequired'));
    nameInput.focus();
    return;
  }
  
  if (!query) {
    showToast(getMessage('templateQueryRequired'));
    queryInput.focus();
    return;
  }
  
  try {
    const { promptTemplates = [] } = await chrome.storage.sync.get('promptTemplates');
    
    if (currentEditingTemplateId) {
      // 编辑现有模板
      const index = promptTemplates.findIndex(t => t.id === currentEditingTemplateId);
      if (index !== -1) {
        promptTemplates[index] = {
          ...promptTemplates[index],
          name,
          query,
          type,
          order
        };
      }
    } else {
      // 添加新模板
      const newTemplate = {
        id: generateTemplateId(),
        name,
        query,
        type,
        order,
        isDefault: false
      };
      promptTemplates.push(newTemplate);
    }
    
    await chrome.storage.sync.set({ promptTemplates });
    hideTemplateDialog();
    await loadTemplatesList();
    showToast(getMessage('templateSavedSuccess'));
    
  } catch (error) {
    console.error('保存模板失败:', error);
    showToast(getMessageWithFallback('saveFailedGeneric', 'Save failed. Please try again.'));
  }
}

// 编辑模板
async function editTemplate(templateId) {
  try {
    const { promptTemplates = [] } = await chrome.storage.sync.get('promptTemplates');
    const template = promptTemplates.find(t => t.id === templateId);
    
    if (template) {
      currentEditingTemplateId = templateId;
      await showTemplateDialog(template);
    }
  } catch (error) {
    console.error('编辑模板失败:', error);
  }
}

// 删除模板
async function deleteTemplate(templateId) {
  const confirmMessage = getMessage('confirmDeleteTemplate');
  if (!confirm(confirmMessage)) {
    return;
  }
  
  try {
    const { promptTemplates = [] } = await chrome.storage.sync.get('promptTemplates');
    const filteredTemplates = promptTemplates.filter(t => t.id !== templateId);
    
    await chrome.storage.sync.set({ promptTemplates: filteredTemplates });
    await loadTemplatesList();
    showToast(getMessage('templateDeletedSuccess'));
    
  } catch (error) {
    console.error('删除模板失败:', error);
    showToast('删除失败，请重试');
  }
}

// 生成唯一模板ID
function generateTemplateId() {
  return 'template_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

async function ensureDefaultAnalysisTemplates() {
  try {
    await chrome.runtime.sendMessage({ action: 'initializeDefaultTemplates' });
  } catch (error) {
    console.log('无法发送分析模板初始化消息，background 可能已处理:', error);
  }
}

function generateAnalysisTemplateId() {
  return 'analysis_template_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

async function getNextAnalysisOrder() {
  try {
    const { analysisPromptTemplates = [] } = await chrome.storage.sync.get('analysisPromptTemplates');
    const maxOrder = analysisPromptTemplates.reduce((max, template) =>
      Math.max(max, template.order || 0), 0);
    return maxOrder + 1;
  } catch (error) {
    return 1;
  }
}

async function loadAnalysisTemplatesList() {
  try {
    const { analysisPromptTemplates = [] } = await chrome.storage.sync.get('analysisPromptTemplates');
    const container = document.getElementById('analysisTemplatesList');
    if (!container) return;

    const sortedTemplates = (Array.isArray(analysisPromptTemplates) ? analysisPromptTemplates : [])
      .filter(template => template?.name && template?.query)
      .sort((a, b) => (a.order || 0) - (b.order || 0));

    if (sortedTemplates.length === 0) {
      container.innerHTML = `
        <div class="state-panel">
          <p>${getMessage('analysisTemplateListEmpty') || '暂无分析提示词模板'}</p>
          <p class="state-message">${getMessage('analysisTemplateListHint') || '点击上方“添加分析提示词”按钮开始创建'}</p>
        </div>
      `;
      return;
    }

    container.innerHTML = sortedTemplates.map(template => `
      <div class="template-item" data-template-id="${template.id}">
        <div class="template-item-head">
          <div class="template-item-body">
            <h4 class="template-item-title">${template.name}</h4>
            <div class="template-meta">
              <span>${getMessage('templateOrderLabel') || 'Order'}: ${template.order}</span>
              <span class="template-badge">${getMessage('analysisPromptTemplateBadge') || 'Analysis'}</span>
            </div>
          </div>
          <div class="template-actions">
            <button class="edit-analysis-template-btn icon-action-btn" data-template-id="${template.id}" title="${getMessage('editButton')}" aria-label="${getMessage('editButton')}">
              <img src="../icons/edit.svg" alt="">
            </button>
            ${!template.isDefault ? `<button class="delete-analysis-template-btn danger-btn" data-template-id="${template.id}">${getMessage('deleteButton') || 'Delete'}</button>` : ''}
          </div>
        </div>
        <div class="template-code preserve-lines">${template.query}</div>
      </div>
    `).join('');
  } catch (error) {
    console.error('加载分析提示词模板列表失败:', error);
  }
}

function bindAnalysisTemplateEvents() {
  if (bindAnalysisTemplateEvents.bound === true) {
    return;
  }
  bindAnalysisTemplateEvents.bound = true;

  const addBtn = document.getElementById('addAnalysisTemplateBtn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      currentEditingAnalysisTemplateId = null;
      void showAnalysisTemplateDialog();
    });
  }

  const dialogClose = document.getElementById('analysisDialogClose');
  const cancelBtn = document.getElementById('cancelAnalysisTemplate');
  const overlay = document.getElementById('analysisDialogOverlay');

  [dialogClose, cancelBtn, overlay].forEach(el => {
    if (el) {
      el.addEventListener('click', hideAnalysisTemplateDialog);
    }
  });

  document.getElementById('saveAnalysisTemplate')?.addEventListener('click', saveAnalysisTemplate);
  document.getElementById('analysisTemplatesList')?.addEventListener('click', handleAnalysisTemplateListClick);
}

async function showAnalysisTemplateDialog(template = null) {
  const dialog = document.getElementById('analysisTemplateDialog');
  const title = document.getElementById('analysisDialogTitle');
  const nameInput = document.getElementById('analysisTemplateName');
  const queryInput = document.getElementById('analysisTemplateQuery');
  const orderInput = document.getElementById('analysisTemplateOrder');

  if (!dialog) return;

  if (template) {
    title.textContent = getMessage('editAnalysisTemplateTitle') || 'Edit analysis prompt';
    nameInput.value = template.name;
    queryInput.value = template.query;
    orderInput.value = template.order || 1;
  } else {
    title.textContent = getMessage('addAnalysisTemplateTitle') || 'Add analysis prompt';
    nameInput.value = '';
    queryInput.value = '';
    orderInput.value = 1;
    void getNextAnalysisOrder().then(nextOrder => {
      orderInput.value = nextOrder;
    });
  }

  dialog.style.display = 'block';
  nameInput.focus();
}

function hideAnalysisTemplateDialog() {
  const dialog = document.getElementById('analysisTemplateDialog');
  if (dialog) {
    dialog.style.display = 'none';
  }
  currentEditingAnalysisTemplateId = null;
}

async function saveAnalysisTemplate() {
  const nameInput = document.getElementById('analysisTemplateName');
  const queryInput = document.getElementById('analysisTemplateQuery');
  const orderInput = document.getElementById('analysisTemplateOrder');

  const name = nameInput.value.trim();
  const query = queryInput.value.trim();
  const order = parseInt(orderInput.value) || 1;

  if (!name) {
    showToast(getMessage('templateNameRequired'));
    nameInput.focus();
    return;
  }

  if (!query) {
    showToast(getMessage('templateQueryRequired'));
    queryInput.focus();
    return;
  }

  try {
    const { analysisPromptTemplates = [] } = await chrome.storage.sync.get('analysisPromptTemplates');

    if (currentEditingAnalysisTemplateId) {
      const index = analysisPromptTemplates.findIndex(t => t.id === currentEditingAnalysisTemplateId);
      if (index !== -1) {
        analysisPromptTemplates[index] = {
          ...analysisPromptTemplates[index],
          name,
          query,
          order
        };
      }
    } else {
      analysisPromptTemplates.push({
        id: generateAnalysisTemplateId(),
        name,
        query,
        order,
        isDefault: false
      });
    }

    await chrome.storage.sync.set({ analysisPromptTemplates });
    hideAnalysisTemplateDialog();
    await loadAnalysisTemplatesList();
    showToast(getMessage('templateSavedSuccess'));
  } catch (error) {
    console.error('保存分析提示词失败:', error);
    showToast(getMessageWithFallback('saveFailedGeneric', 'Save failed. Please try again.'));
  }
}

async function editAnalysisTemplate(templateId) {
  try {
    const { analysisPromptTemplates = [] } = await chrome.storage.sync.get('analysisPromptTemplates');
    const template = analysisPromptTemplates.find(t => t.id === templateId);
    if (template) {
      currentEditingAnalysisTemplateId = templateId;
      await showAnalysisTemplateDialog(template);
    }
  } catch (error) {
    console.error('编辑分析提示词失败:', error);
  }
}

async function deleteAnalysisTemplate(templateId) {
  const confirmMessage = getMessage('confirmDeleteTemplate');
  if (!confirm(confirmMessage)) {
    return;
  }

  try {
    const { analysisPromptTemplates = [] } = await chrome.storage.sync.get('analysisPromptTemplates');
    const filteredTemplates = analysisPromptTemplates.filter(t => t.id !== templateId);
    await chrome.storage.sync.set({ analysisPromptTemplates: filteredTemplates });
    await loadAnalysisTemplatesList();
    showToast(getMessage('templateDeletedSuccess'));
  } catch (error) {
    console.error('删除分析提示词失败:', error);
    showToast(getMessageWithFallback('deleteFailed', 'Delete failed. Please try again.'));
  }
}

async function handleAnalysisTemplateListClick(event) {
  const editBtn = event.target.closest('.edit-analysis-template-btn');
  const deleteBtn = event.target.closest('.delete-analysis-template-btn');

  if (editBtn) {
    const templateId = editBtn.getAttribute('data-template-id');
    if (templateId) await editAnalysisTemplate(templateId);
  } else if (deleteBtn) {
    const templateId = deleteBtn.getAttribute('data-template-id');
    if (templateId) await deleteAnalysisTemplate(templateId);
  }
}

// ── 数据同步（WebDAV）──────────────────────────────────────────

const SYNC_STORAGE_KEY = 'webdavSyncConfig';
const SYNC_DATA_FILENAME = 'multiAI-settings.json';
const LOCAL_SYNC_FILE_PREFIX = 'multiAI-settings-backup';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pickSyncPayload(source = {}, keys = []) {
  const payload = {};

  keys.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(source, key) && typeof source[key] !== 'undefined') {
      payload[key] = source[key];
    }
  });

  return payload;
}

function createLocalSyncFileName() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${LOCAL_SYNC_FILE_PREFIX}-${stamp}.json`;
}

function downloadJsonFile(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function getLocalSyncImportSource(rawPayload) {
  if (!isPlainObject(rawPayload)) {
    return null;
  }

  const hasTopLevelSyncKeys = [...SYNC_KEYS, ...LOCAL_SYNC_KEYS].some((key) =>
    Object.prototype.hasOwnProperty.call(rawPayload, key)
  );

  if (hasTopLevelSyncKeys) {
    return rawPayload;
  }

  const nestedSync = isPlainObject(rawPayload.sync) ? rawPayload.sync : null;
  const nestedLocal = isPlainObject(rawPayload.local) ? rawPayload.local : null;

  if (nestedSync || nestedLocal) {
    return {
      ...(nestedSync || {}),
      ...(nestedLocal || {})
    };
  }

  return null;
}

function getLocalSyncImportPayload(rawPayload) {
  const source = getLocalSyncImportSource(rawPayload);
  if (!source) {
    throw new Error(getMessage('localSyncInvalidFile') || 'Invalid backup file');
  }

  const syncPatch = pickSyncPayload(source, SYNC_KEYS);
  const localPatch = pickSyncPayload(source, LOCAL_SYNC_KEYS);

  if (!Object.keys(syncPatch).length && !Object.keys(localPatch).length) {
    throw new Error(getMessage('localSyncInvalidFile') || 'Invalid backup file');
  }

  return { syncPatch, localPatch };
}

function showSyncStatus(message, type = 'info') {
  const el = document.getElementById('syncStatus');
  if (!el) return;
  el.textContent = message;
  el.className = `sync-status ${type}`;
  el.style.display = 'block';
  if (type === 'success') {
    setTimeout(() => { el.style.display = 'none'; }, 4000);
  }
}

function formatGoogleDriveSyncAccountText(status = {}) {
  if (status?.email) {
    let summary = status.accountName ? `${status.accountName} · ${status.email}` : status.email;
    if (status?.lastSyncedAt) {
      summary += ` · ${getMessage('googleDriveSyncLastSynced') || 'Last synced'}: ${status.lastSyncedAt}`;
    }
    if (status?.lastError) {
      summary += ` · ${getMessage('googleDriveSyncLastError') || 'Last error'}: ${status.lastError}`;
    }
    return summary;
  }
  return getMessage('googleDriveSyncNotConnected') || 'Not connected yet';
}

async function refreshGoogleDriveSyncStatus() {
  const accountEl = document.getElementById('googleDriveSyncAccount');
  const connectBtn = document.getElementById('connectGoogleDriveSync');
  const disconnectBtn = document.getElementById('disconnectGoogleDriveSync');

  if (!accountEl) {
    return null;
  }

  try {
    const resp = await chrome.runtime.sendMessage({ action: 'googleDriveGetStatus' });
    const status = resp?.success ? (resp.result || {}) : {};
    const connected = status.enabled === true && Boolean(status.email);

    accountEl.textContent = formatGoogleDriveSyncAccountText(status);
    if (disconnectBtn) disconnectBtn.disabled = !connected;
    if (connectBtn) {
      const label = connected
        ? (getMessage('googleDriveSyncReconnectButton') || 'Reconnect Google Drive')
        : (getMessage('googleDriveSyncConnectButton') || 'Sign in with Google');
      const textNode = connectBtn.querySelector('[data-i18n="googleDriveSyncConnectButton"], [data-i18n="googleDriveSyncReconnectButton"]');
      if (textNode) {
        textNode.textContent = label;
        textNode.setAttribute('data-i18n', connected ? 'googleDriveSyncReconnectButton' : 'googleDriveSyncConnectButton');
      }
    }

    return status;
  } catch (error) {
    accountEl.textContent = getMessage('googleDriveSyncStatusLoadFailed') || 'Failed to load Drive connection status';
    if (disconnectBtn) disconnectBtn.disabled = true;
    return null;
  }
}

async function connectGoogleDriveSync() {
  const connectBtn = document.getElementById('connectGoogleDriveSync');
  if (connectBtn) connectBtn.disabled = true;
  showSyncStatus(getMessage('googleDriveSyncConnecting') || 'Opening Google authorization…', 'loading');
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'googleDriveConnect' });
    if (!resp?.success) {
      throw new Error(resp?.error || 'Google Drive connection failed');
    }
    showSyncStatus(getMessage('googleDriveSyncConnected') || 'Google Drive connected', 'success');
    const status = await refreshGoogleDriveSyncStatus();
    if (status?.lastError) {
      showSyncStatus(`${getMessage('googleDriveSyncConnectFailed') || 'Failed to connect Google Drive'}: ${status.lastError}`, 'error');
    }
  } catch (error) {
    showSyncStatus(`${getMessage('googleDriveSyncConnectFailed') || 'Failed to connect Google Drive'}: ${error.message}`, 'error');
  } finally {
    if (connectBtn) connectBtn.disabled = false;
  }
}

async function disconnectGoogleDriveSync() {
  const confirmMessage = getMessage('googleDriveSyncDisconnectConfirm')
    || 'Disconnect Google Drive sync on this device?';
  if (!window.confirm(confirmMessage)) {
    return;
  }

  showSyncStatus(getMessage('googleDriveSyncDisconnecting') || 'Disconnecting Google Drive…', 'loading');
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'googleDriveDisconnect' });
    if (!resp?.success) {
      throw new Error(resp?.error || 'Google Drive disconnect failed');
    }
    showSyncStatus(getMessage('googleDriveSyncDisconnected') || 'Google Drive disconnected', 'success');
    await refreshGoogleDriveSyncStatus();
  } catch (error) {
    showSyncStatus(`${getMessage('googleDriveSyncDisconnectFailed') || 'Failed to disconnect Google Drive'}: ${error.message}`, 'error');
  }
}

async function loadSyncConfig() {
  const { [SYNC_STORAGE_KEY]: cfg = {} } = await chrome.storage.local.get(SYNC_STORAGE_KEY);
  const enabled  = document.getElementById('syncEnabled');
  const url      = document.getElementById('syncUrl');
  const username = document.getElementById('syncUsername');
  const password = document.getElementById('syncPassword');
  const authType = document.getElementById('syncAuthType');

  if (enabled)  enabled.checked  = !!cfg.enabled;
  if (url)      url.value        = cfg.url      || '';
  if (username) username.value   = cfg.username || '';
  if (password) password.value   = cfg.password || '';
  if (authType) authType.value   = cfg.authType || 'password';

  updateConnectionTableState(!!cfg.enabled);
  updateAuthTypeUI(cfg.authType || 'password');
}

function updateAuthTypeUI(authType) {
  const table          = document.getElementById('syncConnectionConfig');
  const passwordHeader = document.getElementById('syncPasswordHeader');
  const passwordInput  = document.getElementById('syncPassword');

  if (authType === 'token') {
    table?.classList.add('token-mode');
    if (passwordHeader) passwordHeader.textContent  = getMessage('syncAuthToken') || 'Token';
    if (passwordInput) {
      passwordInput.placeholder  = getMessage('syncTokenPlaceholder') || '输入 Token';
      passwordInput.autocomplete = 'off';
    }
  } else {
    table?.classList.remove('token-mode');
    if (passwordHeader) passwordHeader.textContent  = getMessage('syncPassword') || '密码';
    if (passwordInput) {
      passwordInput.placeholder  = '••••••••';
      passwordInput.autocomplete = 'current-password';
    }
  }
}

function updateConnectionTableState(enabled) {
  const table = document.getElementById('syncConnectionConfig');
  if (!table) return;
  if (enabled) {
    table.classList.remove('disabled');
  } else {
    table.classList.add('disabled');
  }
}

async function saveSyncConfig() {
  const cfg = {
    enabled:  document.getElementById('syncEnabled')?.checked  || false,
    authType: document.getElementById('syncAuthType')?.value   || 'password',
    url:      (document.getElementById('syncUrl')?.value       || '').trim(),
    username: (document.getElementById('syncUsername')?.value  || '').trim(),
    password: document.getElementById('syncPassword')?.value   || '',
  };

  if (!cfg.url) {
    showSyncStatus(getMessage('syncErrorNoUrl') || '请填写 WebDAV 地址', 'error');
    document.getElementById('syncUrl')?.focus();
    return;
  }
  if (cfg.authType !== 'token' && !cfg.username) {
    showSyncStatus(getMessage('syncErrorNoUsername') || '请填写用户名', 'error');
    document.getElementById('syncUsername')?.focus();
    return;
  }
  if (!cfg.password) {
    showSyncStatus(
      cfg.authType === 'token'
        ? (getMessage('syncErrorNoToken') || '请填写 Token')
        : (getMessage('syncErrorNoPassword') || '请填写密码'),
      'error'
    );
    document.getElementById('syncPassword')?.focus();
    return;
  }

  await chrome.storage.local.set({ [SYNC_STORAGE_KEY]: cfg });
  showSyncStatus(getMessage('saveSuccess') || '已保存', 'success');
  updateConnectionTableState(cfg.enabled);
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
  let base = cfg.url.trim();
  if (!base.endsWith('/')) base += '/';
  return base + SYNC_DATA_FILENAME;
}

async function testSyncConnection() {
  const cfg = await getSyncConfig();
  if (!cfg || !cfg.url) {
    showSyncStatus(getMessage('syncErrorNoUrl') || '请先填写 WebDAV 地址', 'error');
    return;
  }
  showSyncStatus(getMessage('syncTesting') || '正在测试连接…', 'loading');
  try {
    const res = await fetch(cfg.url, {
      method: 'PROPFIND',
      headers: { ...buildWebDAVHeaders(cfg), 'Depth': '0' },
    });
    if (res.ok || res.status === 207) {
      showSyncStatus(getMessage('syncTestSuccess') || '连接成功！', 'success');
    } else {
      showSyncStatus(
        (getMessage('syncTestFailed') || '连接失败') + `: HTTP ${res.status}`,
        'error'
      );
    }
  } catch (e) {
    showSyncStatus(
      (getMessage('syncTestFailed') || '连接失败') + `: ${e.message}`,
      'error'
    );
  }
}

async function getSyncConfig() {
  const { [SYNC_STORAGE_KEY]: cfg = {} } = await chrome.storage.local.get(SYNC_STORAGE_KEY);
  return cfg;
}

async function exportAllSettings() {
  const [syncData, localData, legacySyncCustomAgents] = await Promise.all([
    chrome.storage.sync.get(SYNC_KEYS),
    chrome.storage.local.get(LOCAL_SYNC_KEYS),
    chrome.storage.sync.get(CUSTOM_AGENTS_STORAGE_KEY)
  ]);
  const localCustomAgents = Array.isArray(localData?.[CUSTOM_AGENTS_STORAGE_KEY]) ? localData[CUSTOM_AGENTS_STORAGE_KEY] : [];
  const syncCustomAgents = Array.isArray(legacySyncCustomAgents?.[CUSTOM_AGENTS_STORAGE_KEY])
    ? legacySyncCustomAgents[CUSTOM_AGENTS_STORAGE_KEY]
    : [];
  return {
    ...syncData,
    [CUSTOM_AGENTS_STORAGE_KEY]: localCustomAgents.length > 0 ? localCustomAgents : syncCustomAgents,
    pkHistory: (localData.pkHistory || []).slice(0, 500),
    favoriteFolders: localData.favoriteFolders || [],
    [AGENT_ENGINE_SECRET_STORAGE_KEY]: localData[AGENT_ENGINE_SECRET_STORAGE_KEY] || '',
    [AGENT_HIDDEN_IDS_STORAGE_KEY]: Array.isArray(localData?.[AGENT_HIDDEN_IDS_STORAGE_KEY])
      ? localData[AGENT_HIDDEN_IDS_STORAGE_KEY]
      : [],
    _syncVersion: 1,
    _exportedAt: new Date().toISOString(),
  };
}

async function exportLocalSyncBackup() {
  try {
    const payload = await exportAllSettings();
    downloadJsonFile(createLocalSyncFileName(), payload);
    showSyncStatus(getMessage('localSyncExportSuccess') || '备份已下载', 'success');
  } catch (error) {
    console.error('导出本地备份失败:', error);
    showSyncStatus(
      `${getMessage('localSyncExportFailed') || '导出失败'}: ${error.message}`,
      'error'
    );
  }
}

async function importLocalSyncBackupFromFile(file) {
  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    const rawPayload = JSON.parse(text.replace(/^\uFEFF/, '').trim());
    const confirmMessage = getMessage('localSyncImportConfirm')
      || 'Import this backup and overwrite the current sync data?';

    if (!window.confirm(confirmMessage)) {
      return;
    }

    const { syncPatch, localPatch } = getLocalSyncImportPayload(rawPayload);

    showSyncStatus(getMessage('localSyncImporting') || '正在恢复本地备份…', 'loading');

    const writeTasks = [];
    if (Object.keys(syncPatch).length > 0) {
      writeTasks.push(chrome.storage.sync.set(syncPatch));
    }
    if (Object.keys(localPatch).length > 0) {
      writeTasks.push(chrome.storage.local.set(localPatch));
    }
    if (Object.prototype.hasOwnProperty.call(localPatch, CUSTOM_AGENTS_STORAGE_KEY)) {
      writeTasks.push(chrome.storage.sync.remove(CUSTOM_AGENTS_STORAGE_KEY));
    }

    await Promise.all(writeTasks);

    showSyncStatus(
      getMessage('localSyncImportSuccess') || '本地备份已恢复，请刷新页面生效',
      'success'
    );
  } catch (error) {
    console.error('导入本地备份失败:', error);
    const invalidMessage = getMessage('localSyncInvalidFile') || 'This file is not a valid AI Compare backup';
    const detail = error instanceof SyntaxError ? invalidMessage : (error.message || invalidMessage);
    showSyncStatus(
      `${getMessage('localSyncImportFailed') || '恢复失败'}: ${detail}`,
      'error'
    );
  } finally {
    const input = document.getElementById('localSyncFileInput');
    if (input) {
      input.value = '';
    }
  }
}

function handleLocalSyncImportClick() {
  const input = document.getElementById('localSyncFileInput');
  if (input) {
    input.click();
  }
}

async function handleLocalSyncFileSelection(event) {
  const file = event?.target?.files?.[0];
  if (!file) {
    return;
  }
  await importLocalSyncBackupFromFile(file);
}

async function syncNow() {
  const cfg = await getSyncConfig();
  if (!cfg.enabled || !cfg.url) {
    showSyncStatus(getMessage('syncErrorNotConfigured') || '请先启用同步并填写 WebDAV 配置', 'error');
    return;
  }
  showSyncStatus(getMessage('syncUploading') || '正在上传数据…', 'loading');
  try {
    const payload = await exportAllSettings();
    const fileURL  = getWebDAVFileURL(cfg);
    const res = await fetch(fileURL, {
      method: 'PUT',
      headers: buildWebDAVHeaders(cfg),
      body: JSON.stringify(payload, null, 2),
    });
    if (res.ok || res.status === 201 || res.status === 204) {
      const timeStr = new Date().toLocaleTimeString();
      showSyncStatus(
        (getMessage('syncSuccess') || '同步成功') + ' · ' + timeStr,
        'success'
      );
    } else {
      showSyncStatus(
        (getMessage('syncFailed') || '同步失败') + `: HTTP ${res.status}`,
        'error'
      );
    }
  } catch (e) {
    showSyncStatus(
      (getMessage('syncFailed') || '同步失败') + `: ${e.message}`,
      'error'
    );
  }
}

async function importFromSync() {
  const cfg = await getSyncConfig();
  if (!cfg.enabled || !cfg.url) {
    showSyncStatus(getMessage('syncErrorNotConfigured') || '请先启用同步并填写 WebDAV 配置', 'error');
    return;
  }
  showSyncStatus(getMessage('syncDownloading') || '正在从云端下载数据…', 'loading');
  try {
    // 委托 background service worker 执行 fetch，避免 options 页面跨域/CORS 限制
    const resp = await chrome.runtime.sendMessage({ action: 'webdavImport' });
    if (resp && resp.success) {
      showSyncStatus(
        (getMessage('syncImportSuccess') || '云端数据已恢复，请刷新页面生效'),
        'success'
      );
    } else {
      const errMsg = (getMessage('syncImportFailed') || '恢复失败') +
        (resp?.error ? `: ${resp.error}` : '');
      showSyncStatus(errMsg, 'error');
    }
  } catch (e) {
    showSyncStatus(
      (getMessage('syncImportFailed') || '恢复失败') + `: ${e.message}`,
      'error'
    );
  }
}

function initializeDataSync() {
  loadSyncConfig();
  refreshGoogleDriveSyncStatus();

  document.getElementById('syncEnabled')?.addEventListener('change', (e) => {
    updateConnectionTableState(e.target.checked);
  });

  document.getElementById('syncAuthType')?.addEventListener('change', (e) => {
    updateAuthTypeUI(e.target.value);
  });

  const saveSyncBtn = document.getElementById('saveSyncConfig');
  if (saveSyncBtn && saveSyncBtn.dataset.bound !== 'true') {
    saveSyncBtn.dataset.bound = 'true';
    saveSyncBtn.addEventListener('click', saveSyncConfig);
  }

  const importSyncBtn = document.getElementById('importFromSync');
  if (importSyncBtn && importSyncBtn.dataset.bound !== 'true') {
    importSyncBtn.dataset.bound = 'true';
    importSyncBtn.addEventListener('click', importFromSync);
  }

  const exportLocalBtn = document.getElementById('exportLocalSync');
  if (exportLocalBtn && exportLocalBtn.dataset.bound !== 'true') {
    exportLocalBtn.dataset.bound = 'true';
    exportLocalBtn.addEventListener('click', exportLocalSyncBackup);
  }

  const importLocalBtn = document.getElementById('importLocalSync');
  if (importLocalBtn && importLocalBtn.dataset.bound !== 'true') {
    importLocalBtn.dataset.bound = 'true';
    importLocalBtn.addEventListener('click', handleLocalSyncImportClick);
  }

  const localSyncFileInput = document.getElementById('localSyncFileInput');
  if (localSyncFileInput && localSyncFileInput.dataset.bound !== 'true') {
    localSyncFileInput.dataset.bound = 'true';
    localSyncFileInput.addEventListener('change', handleLocalSyncFileSelection);
  }

  const connectGoogleDriveBtn = document.getElementById('connectGoogleDriveSync');
  if (connectGoogleDriveBtn && connectGoogleDriveBtn.dataset.bound !== 'true') {
    connectGoogleDriveBtn.dataset.bound = 'true';
    connectGoogleDriveBtn.addEventListener('click', connectGoogleDriveSync);
  }

  const disconnectGoogleDriveBtn = document.getElementById('disconnectGoogleDriveSync');
  if (disconnectGoogleDriveBtn && disconnectGoogleDriveBtn.dataset.bound !== 'true') {
    disconnectGoogleDriveBtn.dataset.bound = 'true';
    disconnectGoogleDriveBtn.addEventListener('click', disconnectGoogleDriveSync);
  }

  const togglePasswordBtn = document.getElementById('togglePassword');
  if (togglePasswordBtn && togglePasswordBtn.dataset.bound !== 'true') {
    togglePasswordBtn.dataset.bound = 'true';
    togglePasswordBtn.addEventListener('click', () => {
    const input = document.getElementById('syncPassword');
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
    });
  }
}

let remoteSearchUiInitialized = false;
let remoteSearchMessageListenerBound = false;
let remoteSearchState = null;
let remoteSearchStateUpdatedAt = 0;
let remoteSearchQrLoadToken = 0;

function getRemoteSearchStatusMessage(status) {
  const normalizedStatus = String(status || '').trim();
  switch (normalizedStatus) {
    case 'online':
      return getMessage('remoteSearchStatusOnline') || 'Online';
    case 'connecting':
      return getMessage('remoteSearchStatusConnecting') || 'Connecting';
    case 'offline':
      return getMessage('remoteSearchStatusOffline') || 'Offline';
    case 'error':
      return getMessage('remoteSearchStatusError') || 'Error';
    case 'disabled':
    default:
      return getMessage('remoteSearchStatusDisabled') || 'Disabled';
  }
}

function formatRemoteSearchTime(value) {
  const rawValue = String(value || '').trim();
  if (!rawValue) {
    return '-';
  }

  const parsed = new Date(rawValue);
  if (Number.isNaN(parsed.getTime())) {
    return rawValue;
  }

  try {
    return parsed.toLocaleString();
  } catch (_) {
    return rawValue;
  }
}

function getRemoteSearchStateUpdatedAt(state) {
  const rawValue = String(state?.updatedAt || '').trim();
  if (!rawValue) {
    return 0;
  }

  const parsedValue = Date.parse(rawValue);
  return Number.isFinite(parsedValue) ? parsedValue : 0;
}

function shouldIgnoreRemoteSearchStateUpdate(nextState) {
  if (!remoteSearchState || !remoteSearchStateUpdatedAt) {
    return false;
  }

  const nextUpdatedAt = getRemoteSearchStateUpdatedAt(nextState);
  if (!nextUpdatedAt) {
    return true;
  }

  return nextUpdatedAt < remoteSearchStateUpdatedAt;
}

function clearRemoteSearchQrImage(qrImage) {
  if (!qrImage) {
    return;
  }

  qrImage.hidden = true;
  qrImage.removeAttribute('src');
}

function buildRemoteSearchQrImageSource(svgText) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(String(svgText || ''))}`;
}

function shouldEnableRemoteSearchGenerateButton(state, draftSettings = null) {
  return state?.settings?.enabled === true || draftSettings?.enabled === true;
}

function getRemoteSearchDraftSettings() {
  return {
    enabled: document.getElementById('remoteSearchEnabled')?.checked === true,
    relayBaseUrl: document.getElementById('remoteSearchRelayUrl')?.value?.trim() || '',
    desktopName: document.getElementById('remoteSearchDesktopName')?.value?.trim() || ''
  };
}

function updateRemoteSearchGenerateButtonState(state = remoteSearchState) {
  const generateQrButton = document.getElementById('generateRemoteSearchQr');
  if (!generateQrButton) {
    return;
  }

  generateQrButton.disabled = !shouldEnableRemoteSearchGenerateButton(
    state,
    getRemoteSearchDraftSettings()
  );
}

async function sendRemoteSearchRuntimeMessage(action, payload = {}) {
  const response = await chrome.runtime.sendMessage({
    action,
    ...payload
  });

  if (!response?.success) {
    throw new Error(response?.error || 'Remote Search request failed');
  }

  return response.result;
}

function readRemoteSearchSettingsFromForm() {
  return getRemoteSearchDraftSettings();
}

function setRemoteSearchQrPlaceholderText(message) {
  const placeholder = document.getElementById('remoteSearchQrPlaceholder');
  if (placeholder) {
    placeholder.textContent = message || (getMessage('remoteSearchQrEmpty') || 'Enable remote search to generate a pairing QR code.');
  }
}

async function renderRemoteSearchQr(ticket, relayBaseUrl) {
  const qrImage = document.getElementById('remoteSearchQrImage');
  const placeholder = document.getElementById('remoteSearchQrPlaceholder');
  const expiresAt = document.getElementById('remoteSearchTicketExpiresAt');
  const loadToken = ++remoteSearchQrLoadToken;

  if (expiresAt) {
    expiresAt.textContent = formatRemoteSearchTime(ticket?.expiresAt);
  }

  if (!qrImage) {
    return;
  }

  if (!ticket?.qrPayload) {
    clearRemoteSearchQrImage(qrImage);
    if (placeholder) {
      placeholder.hidden = false;
    }
    return;
  }

  const effectiveRelayUrl = String(ticket.relayBaseUrl || relayBaseUrl || '').trim();
  if (!effectiveRelayUrl) {
    clearRemoteSearchQrImage(qrImage);
    if (placeholder) {
      placeholder.hidden = false;
    }
    setRemoteSearchQrPlaceholderText(getMessage('remoteSearchQrEmpty') || 'Enable remote search to generate a pairing QR code.');
    return;
  }

  setRemoteSearchQrPlaceholderText(getMessage('remoteSearchQrLoading') || 'Generating QR code...');
  if (placeholder) {
    placeholder.hidden = false;
  }
  clearRemoteSearchQrImage(qrImage);

  try {
    const qrResponse = await fetch(`${effectiveRelayUrl.replace(/\/+$/, '')}/qr?data=${encodeURIComponent(JSON.stringify(ticket.qrPayload))}`);
    if (!qrResponse.ok) {
      throw new Error(`HTTP ${qrResponse.status}`);
    }

    const svgText = await qrResponse.text();
    if (loadToken !== remoteSearchQrLoadToken) {
      return;
    }

    qrImage.src = buildRemoteSearchQrImageSource(svgText);
    qrImage.hidden = false;
    if (placeholder) {
      placeholder.hidden = true;
    }
  } catch (error) {
    console.error('加载远程搜索二维码失败:', error);
    clearRemoteSearchQrImage(qrImage);
    if (placeholder) {
      placeholder.hidden = false;
    }
    setRemoteSearchQrPlaceholderText(
      `${getMessage('remoteSearchQrLoadFailed') || 'Failed to load QR code'}: ${error.message || error}`
    );
  }
}

function renderRemoteSearchState(state) {
  if (state && shouldIgnoreRemoteSearchStateUpdate(state)) {
    return remoteSearchState;
  }

  remoteSearchState = state || null;
  remoteSearchStateUpdatedAt = getRemoteSearchStateUpdatedAt(remoteSearchState);

  const status = String(state?.connectionStatus || 'disabled').trim() || 'disabled';
  const statusText = getRemoteSearchStatusMessage(status);
  const enabledInput = document.getElementById('remoteSearchEnabled');
  const relayInput = document.getElementById('remoteSearchRelayUrl');
  const desktopNameInput = document.getElementById('remoteSearchDesktopName');
  const connectionBadge = document.getElementById('remoteSearchConnectionBadge');
  const statusLabel = document.getElementById('remoteSearchStatusText');
  const pendingCard = document.getElementById('remoteSearchPendingPairCard');
  const pairedEmpty = document.getElementById('remoteSearchPairedEmpty');
  const pairedDetails = document.getElementById('remoteSearchPairedDetails');
  const lastError = document.getElementById('remoteSearchLastError');
  const generateQrButton = document.getElementById('generateRemoteSearchQr');

  if (enabledInput) {
    enabledInput.checked = state?.settings?.enabled === true;
  }
  if (relayInput) {
    relayInput.value = state?.settings?.relayBaseUrl || relayInput.value || '';
  }
  if (desktopNameInput) {
    desktopNameInput.value = state?.settings?.desktopName || state?.deviceIdentity?.deviceName || desktopNameInput.value || '';
  }

  if (connectionBadge) {
    connectionBadge.textContent = statusText;
    connectionBadge.dataset.status = status;
  }
  if (statusLabel) {
    statusLabel.textContent = statusText;
  }
  if (generateQrButton) {
    updateRemoteSearchGenerateButtonState(state);
  }

  const pendingPair = state?.pendingPairRequest || null;
  if (pendingCard) {
    pendingCard.hidden = !pendingPair;
  }
  const pendingPhoneName = document.getElementById('remoteSearchPendingPhoneName');
  const pendingPhonePlatform = document.getElementById('remoteSearchPendingPhonePlatform');
  const pendingFingerprint = document.getElementById('remoteSearchPendingFingerprint');
  if (pendingPhoneName) {
    pendingPhoneName.textContent = pendingPair?.phoneName || pendingPair?.phoneDeviceId || '-';
  }
  if (pendingPhonePlatform) {
    pendingPhonePlatform.textContent = pendingPair?.phonePlatform || '-';
  }
  if (pendingFingerprint) {
    pendingFingerprint.textContent = pendingPair?.phoneFingerprint || '-';
  }

  const pairRecord = state?.pairRecord || null;
  if (pairedEmpty) {
    pairedEmpty.hidden = Boolean(pairRecord);
  }
  if (pairedDetails) {
    pairedDetails.hidden = !pairRecord;
  }
  const pairedPhoneName = document.getElementById('remoteSearchPairedPhoneName');
  const pairedPhonePlatform = document.getElementById('remoteSearchPairedPhonePlatform');
  const pairedFingerprint = document.getElementById('remoteSearchPairedFingerprint');
  if (pairedPhoneName) {
    pairedPhoneName.textContent = pairRecord?.phoneName || pairRecord?.phoneDeviceId || '-';
  }
  if (pairedPhonePlatform) {
    pairedPhonePlatform.textContent = pairRecord?.phonePlatform || '-';
  }
  if (pairedFingerprint) {
    pairedFingerprint.textContent = pairRecord?.phoneFingerprint || '-';
  }

  if (lastError) {
    lastError.textContent = state?.lastError || getMessage('remoteSearchNoLastError') || 'No recent errors.';
  }

  void renderRemoteSearchQr(state?.pairingTicket || null, state?.settings?.relayBaseUrl || '');
}

async function refreshRemoteSearchState() {
  const state = await sendRemoteSearchRuntimeMessage('remoteGetState');
  renderRemoteSearchState(state);
  return state;
}

async function saveRemoteSearchSettings(options = {}) {
  const nextState = await sendRemoteSearchRuntimeMessage('remoteUpdateSettings', {
    settings: readRemoteSearchSettingsFromForm()
  });
  renderRemoteSearchState(nextState);
  if (options.silent !== true) {
    showToast(getMessage('saveSuccess') || 'Configuration saved');
  }
  return nextState;
}

async function createRemoteSearchPairingTicket() {
  await saveRemoteSearchSettings({ silent: true });
  await sendRemoteSearchRuntimeMessage('remoteCreatePairingTicket');
  await refreshRemoteSearchState();
  showToast(getMessage('remoteSearchQrReadyToast') || 'Pairing QR code is ready');
}

function handleRemoteSearchRuntimeUpdateMessage(message) {
  if (message?.type !== 'remoteStateChanged' || !message.state) {
    return;
  }

  renderRemoteSearchState(message.state);
}

function initializeRemoteSearchSettings() {
  if (remoteSearchUiInitialized) {
    return;
  }

  remoteSearchUiInitialized = true;

  const syncGenerateButtonState = () => {
    updateRemoteSearchGenerateButtonState(remoteSearchState);
  };

  document.getElementById('saveRemoteSearchSettings')?.addEventListener('click', async () => {
    try {
      await saveRemoteSearchSettings();
    } catch (error) {
      console.error('保存远程搜索设置失败:', error);
      showToast(`${getMessage('saveFailed', [error.message || String(error)]) || `Save failed: ${error.message || error}`}`);
    }
  });

  document.getElementById('generateRemoteSearchQr')?.addEventListener('click', async () => {
    try {
      await createRemoteSearchPairingTicket();
    } catch (error) {
      console.error('生成远程搜索二维码失败:', error);
      showToast(`${getMessage('saveFailed', [error.message || String(error)]) || `Save failed: ${error.message || error}`}`);
    }
  });

  document.getElementById('remoteSearchEnabled')?.addEventListener('change', syncGenerateButtonState);
  document.getElementById('remoteSearchRelayUrl')?.addEventListener('input', syncGenerateButtonState);
  document.getElementById('remoteSearchDesktopName')?.addEventListener('input', syncGenerateButtonState);

  document.getElementById('remoteSearchApprovePair')?.addEventListener('click', async () => {
    try {
      await sendRemoteSearchRuntimeMessage('remoteApprovePendingPair');
      await refreshRemoteSearchState();
      showToast(getMessage('saveSuccess') || 'Configuration saved');
    } catch (error) {
      console.error('批准远程搜索配对失败:', error);
      showToast(`${getMessage('saveFailed', [error.message || String(error)]) || `Save failed: ${error.message || error}`}`);
    }
  });

  document.getElementById('remoteSearchRejectPair')?.addEventListener('click', async () => {
    try {
      await sendRemoteSearchRuntimeMessage('remoteRejectPendingPair');
      await refreshRemoteSearchState();
    } catch (error) {
      console.error('拒绝远程搜索配对失败:', error);
      showToast(`${getMessage('saveFailed', [error.message || String(error)]) || `Save failed: ${error.message || error}`}`);
    }
  });

  document.getElementById('remoteSearchUnpair')?.addEventListener('click', async () => {
    try {
      await sendRemoteSearchRuntimeMessage('remoteRevokePairing');
      await refreshRemoteSearchState();
    } catch (error) {
      console.error('解除远程搜索绑定失败:', error);
      showToast(`${getMessage('saveFailed', [error.message || String(error)]) || `Save failed: ${error.message || error}`}`);
    }
  });

  if (!remoteSearchMessageListenerBound) {
    chrome.runtime.onMessage.addListener(handleRemoteSearchRuntimeUpdateMessage);
    remoteSearchMessageListenerBound = true;
  }

  refreshRemoteSearchState().catch((error) => {
    console.error('加载远程搜索状态失败:', error);
    showToast(`${getMessage('saveFailed', [error.message || String(error)]) || `Save failed: ${error.message || error}`}`);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Pro 会员 UI
// ─────────────────────────────────────────────────────────────────────────────

async function initializeMembership() {
  const loadingEl = document.getElementById('membershipLoadingMsg');
  const loginHintEl = document.getElementById('membershipLoginHint');
  const loginActionsEl = document.getElementById('membershipLoginActions');
  const plansEl = document.getElementById('membershipPlans');
  const proActionsEl = document.getElementById('membershipProActions');
  const badgeEl = document.getElementById('membershipBadge');
  const planLabelEl = document.getElementById('membershipPlanLabel');
  const emailEl = document.getElementById('membershipEmail');
  const expiryEl = document.getElementById('membershipExpiry');

  function setLoading(show) {
    if (loadingEl) loadingEl.style.display = show ? 'block' : 'none';
  }

  const loginBtn = document.getElementById('membershipGoogleLoginBtn');
  if (loginBtn && !loginBtn.dataset.bound) {
    loginBtn.dataset.bound = 'true';
    loginBtn.addEventListener('click', async () => {
      loginBtn.disabled = true;
      try {
        if (typeof window.firebaseSignInWithGoogle !== 'function') {
          throw new Error(getMessageWithFallback('membershipGoogleLoginUnavailable', 'Google sign-in is unavailable right now.'));
        }
        await window.firebaseSignInWithGoogle();
        await initializeMembership();
      } catch (error) {
        showToast(error.message || getMessageWithFallback('membershipGoogleLoginFailed', 'Failed to sign in with Google.'), 3000);
      } finally {
        loginBtn.disabled = false;
      }
    });
  }

  setLoading(true);

  // 检查是否已登录
  const stored = await chrome.storage.local.get(['firebase_uid', 'firebase_email']);
  const uid = stored.firebase_uid;
  const email = stored.firebase_email || '';

  if (!uid) {
    setLoading(false);
    if (loginHintEl) loginHintEl.style.display = 'block';
    if (loginActionsEl) loginActionsEl.style.display = 'block';
    return;
  }

  if (loginHintEl) loginHintEl.style.display = 'none';
  if (loginActionsEl) loginActionsEl.style.display = 'none';
  if (emailEl) emailEl.textContent = email;

  // 读取 plan
  let planInfo = { plan: 'free', planExpiresAt: null };
  try {
    if (typeof window.getUserPlan === 'function') {
      planInfo = await window.getUserPlan();
    }
  } catch (e) {
    console.warn('Failed to load plan:', e);
  }

  setLoading(false);

  const isPro = planInfo.plan === 'pro';

  if (badgeEl) {
    badgeEl.className = 'membership-badge' + (isPro ? ' pro' : '');
  }
  if (planLabelEl) {
    planLabelEl.textContent = isPro
      ? (getMessage('membershipPlanPro') || 'Pro')
      : (getMessage('membershipPlanFree') || 'Free');
  }

  if (isPro && planInfo.planExpiresAt && expiryEl) {
    const expiryDate = new Date(planInfo.planExpiresAt);
    const dateStr = expiryDate.toLocaleDateString();
    const expiryLabel = getMessage('membershipExpiresOn') || '到期时间：';
    expiryEl.textContent = `${expiryLabel}${dateStr}`;
    expiryEl.style.display = 'block';
  }

  if (isPro) {
    if (plansEl) plansEl.style.display = 'none';
    if (proActionsEl) proActionsEl.style.display = 'block';
  } else {
    if (plansEl) plansEl.style.display = 'flex';
    if (proActionsEl) proActionsEl.style.display = 'none';
  }

  // 升级按钮事件
  const btnMonthly = document.getElementById('btnUpgradeMonthly');
  const btnYearly = document.getElementById('btnUpgradeYearly');

  async function handleUpgrade(priceId, btn) {
    if (!priceId || priceId.startsWith('price_REPLACE')) {
      showToast(getMessage('membershipPriceNotConfigured') || 'Stripe Price ID not configured. Please set it first.', 3000);
      return;
    }
    if (btn) btn.disabled = true;
    try {
      if (typeof window.startCheckout === 'function') {
        await window.startCheckout(priceId);
      } else {
        showToast(getMessageWithFallback('stripePaymentScriptNotLoaded', 'stripe-payment.js is not loaded.'), 3000);
      }
    } catch (e) {
      showToast(e.message || getMessageWithFallback('stripeCheckoutOpenFailed', 'Failed to open the checkout page.'), 3000);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  if (btnMonthly) {
    if (btnMonthly.dataset.bound !== 'true') {
      btnMonthly.dataset.bound = 'true';
      btnMonthly.addEventListener('click', () => {
        const priceId = (window.STRIPE_PRICES && window.STRIPE_PRICES.monthly) || '';
        handleUpgrade(priceId, btnMonthly);
      });
    }
  }

  if (btnYearly) {
    if (btnYearly.dataset.bound !== 'true') {
      btnYearly.dataset.bound = 'true';
      btnYearly.addEventListener('click', () => {
        const priceId = (window.STRIPE_PRICES && window.STRIPE_PRICES.yearly) || '';
        handleUpgrade(priceId, btnYearly);
      });
    }
  }

  // 管理订阅按钮
  const btnManage = document.getElementById('btnManageSubscription');
  if (btnManage && btnManage.dataset.bound !== 'true') {
    btnManage.dataset.bound = 'true';
    btnManage.addEventListener('click', async () => {
      btnManage.disabled = true;
      try {
        if (typeof window.openCustomerPortal === 'function') {
          await window.openCustomerPortal();
        } else {
          showToast(getMessageWithFallback('stripePaymentScriptNotLoaded', 'stripe-payment.js is not loaded.'), 3000);
        }
      } catch (e) {
        showToast(e.message || getMessageWithFallback('stripePortalOpenFailed', 'Failed to open the subscription management page.'), 3000);
      } finally {
        btnManage.disabled = false;
      }
    });
  }

}

async function initializeOptionsPage() {
  console.log('Options page loaded');

  if (RuntimeI18n?.initializeRuntimeI18n) {
    await RuntimeI18n.initializeRuntimeI18n();
  }

  initializeI18n();
  await initializeLanguageSettings();

  loadConfig();
  await initializeLaunchSettings();
  initializeNavigation();
  initializeDisabledSites();
  initializeRuleInfo();
  await initializePromptTemplates();
  await initializeAnalysisPromptTemplates();
  initializeAgentEngineSettings();
  loadAgentCustomSettingsManager();
  bindAgentCustomSettingsEvents();
  handleHashNavigation();
  window.addEventListener('hashchange', handleHashNavigation);
  initializeDataSync();
  initializeRemoteSearchSettings();
  initializeMembership();
}

async function refreshOptionsPageForLanguageChange() {
  initializeI18n();
  await initializeLanguageSettings();
  await initializeButtonConfigs();
  await initializeLaunchSettings();
  initializeDisabledSites();
  initializeRuleInfo();
  await initializePromptTemplates();
  await initializeAnalysisPromptTemplates();
  await initializeAgentEngineSettings();
  await loadAgentCustomSettingsManager();
  await refreshGoogleDriveSyncStatus();
  await initializeMembership();
}

if (typeof window !== 'undefined') {
  window.addEventListener('runtime-language-changed', async () => {
    await refreshOptionsPageForLanguageChange();
  });
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('DOMContentLoaded', () => {
    void initializeOptionsPage();
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildRemoteSearchQrImageSource,
    shouldEnableRemoteSearchGenerateButton,
    getRemoteSearchDraftSettings
  };
}
