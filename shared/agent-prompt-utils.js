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

  function migrateLegacyApiConfig(config = {}) {
    return config && typeof config === 'object'
      ? { ...config }
      : {};
  }

  function buildSystemPrompt(agent, engineConfig = {}) {
    const personaPrompt = normalizeMultilineString(agent?.personaPrompt);
    return personaPrompt;
  }

  function normalizeApiConfig(config = {}) {
    const migratedConfig = migrateLegacyApiConfig(config);
    const apiKey = normalizeString(migratedConfig.apiKey) || DEFAULT_API_KEY;
    let baseUrl = normalizeString(migratedConfig.baseUrl).replace(/\/+$/, '') || DEFAULT_BASE_URL;
    let model = normalizeString(migratedConfig.model) || DEFAULT_MODEL;
    const concurrency = Math.max(1, Number(migratedConfig.concurrency) || DEFAULT_CONCURRENCY);
    const systemPrompt = normalizeMultilineString(migratedConfig.systemPrompt) || DEFAULT_SYSTEM_PROMPT;

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
    buildChatMessages,
    buildSystemPrompt,
    migrateLegacyApiConfig,
    normalizeApiConfig
  };
});
