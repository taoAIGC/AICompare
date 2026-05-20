(function(root, factory) {
  const api = factory(root);

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (root && typeof root === 'object') {
    root.AICompareAgentPromptUtils = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function(root) {
  function normalizeString(value) {
    return String(value || '').trim();
  }

  function normalizeMultilineString(value) {
    return String(value || '').replace(/\r\n/g, '\n').trim();
  }

  function resolveBundledAgentEngineDefaults() {
    const bundledConfig = root?.AICompareAgentEngineConfig;
    if (bundledConfig && typeof bundledConfig.getDefaults === 'function') {
      return bundledConfig.getDefaults();
    }

    if (typeof module !== 'undefined' && module.exports) {
      try {
        const nodeConfig = require('../config/agentEngineConfig.js');
        if (nodeConfig && typeof nodeConfig.getDefaults === 'function') {
          return nodeConfig.getDefaults();
        }
      } catch (_) {
        // Ignore missing config in non-browser environments.
      }
    }

    return {
      baseUrl: '',
      apiKey: '',
      model: '',
      concurrency: 2,
      systemPrompt: ''
    };
  }

  const AGENT_ENGINE_DEFAULTS = resolveBundledAgentEngineDefaults();
  const DEFAULT_MODEL = normalizeString(AGENT_ENGINE_DEFAULTS.model);
  const DEFAULT_BASE_URL = normalizeString(AGENT_ENGINE_DEFAULTS.baseUrl).replace(/\/+$/, '');
  const DEFAULT_API_KEY = normalizeString(AGENT_ENGINE_DEFAULTS.apiKey);
  const DEFAULT_CONCURRENCY = Math.max(1, Number(AGENT_ENGINE_DEFAULTS.concurrency) || 2);
  const DEFAULT_SYSTEM_PROMPT = normalizeMultilineString(AGENT_ENGINE_DEFAULTS.systemPrompt);
  const LEGACY_AUTO_MIGRATED_MODEL = 'glm-5.1';
  const LEGACY_AUTO_MIGRATED_BASE_URL = 'https://ark.cn-beijing.volces.com/api/coding/v3';
  const AGENT_ENGINE_SOURCE_OFFICIAL = 'official';
  const AGENT_ENGINE_SOURCE_CUSTOM = 'custom';

  function migrateLegacyApiConfig(config = {}) {
    return config && typeof config === 'object'
      ? { ...config }
      : {};
  }

  function buildSystemPrompt(agent, engineConfig = {}) {
    const personaPrompt = normalizeMultilineString(agent?.personaPrompt);
    return personaPrompt;
  }

  function normalizeApiConfig(config = {}, options = {}) {
    const migratedConfig = migrateLegacyApiConfig(config);
    const useBundledDefaults = options?.useBundledDefaults !== false;
    const defaultApiKey = useBundledDefaults ? DEFAULT_API_KEY : '';
    const defaultBaseUrl = useBundledDefaults ? DEFAULT_BASE_URL : '';
    const defaultModel = useBundledDefaults ? DEFAULT_MODEL : '';
    const defaultConcurrency = useBundledDefaults ? DEFAULT_CONCURRENCY : 2;
    const defaultSystemPrompt = useBundledDefaults ? DEFAULT_SYSTEM_PROMPT : '';
    const apiKey = normalizeString(migratedConfig.apiKey) || defaultApiKey;
    let baseUrl = normalizeString(migratedConfig.baseUrl).replace(/\/+$/, '') || defaultBaseUrl;
    let model = normalizeString(migratedConfig.model) || defaultModel;
    const concurrency = Math.max(1, Number(migratedConfig.concurrency) || defaultConcurrency);
    const systemPrompt = normalizeMultilineString(migratedConfig.systemPrompt) || defaultSystemPrompt;

    // Older builds forcibly rewrote the pptoken defaults to Ark defaults.
    // If the saved key is still an `sk-*` style key, restore the expected
    // pptoken-compatible defaults automatically.
    if (
      apiKey.startsWith('sk-') &&
      baseUrl === LEGACY_AUTO_MIGRATED_BASE_URL &&
      model === LEGACY_AUTO_MIGRATED_MODEL
    ) {
      baseUrl = DEFAULT_BASE_URL;
      model = DEFAULT_MODEL;
    }

    return {
      apiKey,
      baseUrl,
      model,
      concurrency,
      systemPrompt
    };
  }

  function isApiConfigConfigured(config = {}) {
    return Boolean(
      normalizeString(config.apiKey) &&
      normalizeString(config.baseUrl) &&
      normalizeString(config.model) &&
      Math.max(1, Number(config.concurrency) || 0) >= 1
    );
  }

  function areApiConfigsEquivalent(leftConfig = {}, rightConfig = {}) {
    const left = normalizeApiConfig(leftConfig, { useBundledDefaults: false });
    const right = normalizeApiConfig(rightConfig, { useBundledDefaults: false });

    return (
      left.apiKey === right.apiKey &&
      left.baseUrl === right.baseUrl &&
      left.model === right.model &&
      left.concurrency === right.concurrency &&
      left.systemPrompt === right.systemPrompt
    );
  }

  function getEmptyCustomApiConfig() {
    return normalizeApiConfig({}, { useBundledDefaults: false });
  }

  function resolveAgentEngineSettings(syncConfig = {}, localSecret = {}) {
    const normalizedSyncConfig = syncConfig && typeof syncConfig === 'object'
      ? syncConfig
      : {};
    const normalizedLocalSecret = localSecret && typeof localSecret === 'object'
      ? localSecret
      : {};
    const officialConfig = normalizeApiConfig({}, { useBundledDefaults: true });
    const hasStructuredSettings = (
      Object.prototype.hasOwnProperty.call(normalizedSyncConfig, 'selectedSource') ||
      Object.prototype.hasOwnProperty.call(normalizedSyncConfig, 'customConfig')
    );

    if (hasStructuredSettings) {
      const customRawConfig = normalizedSyncConfig.customConfig && typeof normalizedSyncConfig.customConfig === 'object'
        ? normalizedSyncConfig.customConfig
        : {};
      const customConfig = normalizeApiConfig({
        ...customRawConfig,
        apiKey: normalizedLocalSecret.customApiKey || normalizedLocalSecret.apiKey || ''
      }, { useBundledDefaults: false });
      const selectedSource = normalizedSyncConfig.selectedSource === AGENT_ENGINE_SOURCE_CUSTOM
        ? AGENT_ENGINE_SOURCE_CUSTOM
        : AGENT_ENGINE_SOURCE_OFFICIAL;

      return {
        selectedSource,
        officialConfig,
        customConfig,
        effectiveConfig: selectedSource === AGENT_ENGINE_SOURCE_CUSTOM ? customConfig : officialConfig
      };
    }

    const legacyCustomConfig = normalizeApiConfig({
      ...normalizedSyncConfig,
      apiKey: normalizedLocalSecret.apiKey || ''
    }, { useBundledDefaults: false });
    const shouldUseLegacyCustomConfig = (
      isApiConfigConfigured(legacyCustomConfig) &&
      !areApiConfigsEquivalent(legacyCustomConfig, officialConfig)
    );
    const selectedSource = shouldUseLegacyCustomConfig
      ? AGENT_ENGINE_SOURCE_CUSTOM
      : AGENT_ENGINE_SOURCE_OFFICIAL;
    const customConfig = shouldUseLegacyCustomConfig
      ? legacyCustomConfig
      : getEmptyCustomApiConfig();

    return {
      selectedSource,
      officialConfig,
      customConfig,
      effectiveConfig: selectedSource === AGENT_ENGINE_SOURCE_CUSTOM ? customConfig : officialConfig
    };
  }

  function buildChatMessages(agent, threadMessages = [], engineConfig = {}) {
    const normalizedThreadMessages = Array.isArray(threadMessages) ? threadMessages : [];
    const systemPrompt = buildSystemPrompt(agent, engineConfig);
    const messages = [{ role: 'system', content: systemPrompt }];

    normalizedThreadMessages.forEach((message) => {
      const role = normalizeString(message?.role) || 'user';
      const content = normalizeString(message?.content);
      if (!content) {
        return;
      }

      if (role === 'assistant' || role === 'user' || role === 'system') {
        messages.push({
          role,
          content
        });
      }
    });

    return messages;
  }

  return {
    DEFAULT_BASE_URL,
    DEFAULT_API_KEY,
    DEFAULT_MODEL,
    DEFAULT_CONCURRENCY,
    AGENT_ENGINE_SOURCE_OFFICIAL,
    AGENT_ENGINE_SOURCE_CUSTOM,
    areApiConfigsEquivalent,
    buildChatMessages,
    buildSystemPrompt,
    getEmptyCustomApiConfig,
    isApiConfigConfigured,
    migrateLegacyApiConfig,
    normalizeApiConfig,
    resolveAgentEngineSettings
  };
});
