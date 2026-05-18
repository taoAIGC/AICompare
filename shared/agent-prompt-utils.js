(function(root, factory) {
  const api = factory();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (root && typeof root === 'object') {
    root.AICompareAgentPromptUtils = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const LEGACY_DEFAULT_MODEL = 'gpt-5.4-mini';
  const LEGACY_DEFAULT_BASE_URL = 'https://api.pptoken.org/v1';
  const DEFAULT_MODEL = 'glm-5.1';
  const DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/coding/v3';
  const DEFAULT_API_KEY = 'ark-d4be039c-7683-4a1d-ba62-04f670dc237f-e6173';

  function normalizeString(value) {
    return String(value || '').trim();
  }

  function normalizeMultilineString(value) {
    return String(value || '').replace(/\r\n/g, '\n').trim();
  }

  function migrateLegacyApiConfig(config = {}) {
    const nextConfig = config && typeof config === 'object'
      ? { ...config }
      : {};
    const baseUrl = normalizeString(nextConfig.baseUrl).replace(/\/+$/, '');
    const model = normalizeString(nextConfig.model);

    if (baseUrl === LEGACY_DEFAULT_BASE_URL) {
      nextConfig.baseUrl = DEFAULT_BASE_URL;
    }

    if (model === LEGACY_DEFAULT_MODEL) {
      nextConfig.model = DEFAULT_MODEL;
    }

    return nextConfig;
  }

  function buildSystemPrompt(agent, engineConfig = {}) {
    const globalSystemPrompt = normalizeMultilineString(engineConfig?.systemPrompt);
    const personaPrompt = normalizeMultilineString(agent?.personaPrompt);
    return [globalSystemPrompt, personaPrompt].filter(Boolean).join('\n\n');
  }

  function normalizeApiConfig(config = {}) {
    const migratedConfig = migrateLegacyApiConfig(config);
    const apiKey = normalizeString(migratedConfig.apiKey) || DEFAULT_API_KEY;
    const baseUrl = normalizeString(migratedConfig.baseUrl).replace(/\/+$/, '') || DEFAULT_BASE_URL;
    const model = normalizeString(migratedConfig.model) || DEFAULT_MODEL;
    const concurrency = Math.max(1, Number(migratedConfig.concurrency) || 2);
    const systemPrompt = normalizeMultilineString(migratedConfig.systemPrompt);

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
    LEGACY_DEFAULT_BASE_URL,
    LEGACY_DEFAULT_MODEL,
    buildChatMessages,
    buildSystemPrompt,
    migrateLegacyApiConfig,
    normalizeApiConfig
  };
});
