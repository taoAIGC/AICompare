(function(root, factory) {
  const api = factory();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (root && typeof root === 'object') {
    root.AICompareAgentCatalog = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const AGENT_CUSTOM_SETTINGS_STORAGE_KEY = 'agentCustomSettings';
  const CUSTOM_AGENTS_STORAGE_KEY = 'customAgents';
  const AGENT_HIDDEN_IDS_STORAGE_KEY = 'agentHiddenIds';
  const NODE_LOCALE_MESSAGES_CACHE = new Map();
  const AgentCatalogData = resolveAgentCatalogData();
  const CATEGORY_DEFINITIONS = Object.freeze(Array.isArray(AgentCatalogData.CATEGORY_DEFINITIONS) ? AgentCatalogData.CATEGORY_DEFINITIONS : []);
  const AGENT_DEFINITIONS = Object.freeze(Array.isArray(AgentCatalogData.AGENT_DEFINITIONS) ? AgentCatalogData.AGENT_DEFINITIONS : []);

  function resolveAgentCatalogData() {
    try {
      if (globalThis?.AICompareAgentCatalogData && typeof globalThis.AICompareAgentCatalogData === 'object') {
        return globalThis.AICompareAgentCatalogData;
      }
    } catch (_) {}

    try {
      if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
        const nodeData = require('./agentCatalogData.js');
        if (nodeData && typeof nodeData === 'object') {
          return nodeData;
        }
      }
    } catch (_) {}

    return {};
  }

  function normalizeString(value) {
    return String(value || '').trim();
  }

  function normalizeColor(value, fallback = '#4f6b95') {
    const color = normalizeString(value);
    return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color) ? color : fallback;
  }

  function buildShortName(name, fallback = 'A') {
    const normalizedName = normalizeString(name);
    if (!normalizedName) {
      return fallback;
    }

    const firstToken = normalizedName.split(/\s+/).find(Boolean) || normalizedName;
    const cjkMatch = normalizedName.match(/[\u3400-\u9fff]/);
    if (cjkMatch) {
      return cjkMatch[0];
    }

    return firstToken.slice(0, 1).toUpperCase() || fallback;
  }

  function normalizeLocale(locale) {
    return normalizeString(locale).replace('_', '-').toLowerCase();
  }

  function getRuntimeLocale(preferredLocale = '') {
    const normalizedPreferredLocale = normalizeLocale(preferredLocale);
    if (normalizedPreferredLocale) {
      return normalizedPreferredLocale;
    }

    try {
      if (typeof chrome !== 'undefined' && chrome?.i18n?.getUILanguage) {
        return normalizeLocale(chrome.i18n.getUILanguage());
      }
    } catch (_) {}

    try {
      if (typeof navigator !== 'undefined') {
        return normalizeLocale(navigator.language || navigator.userLanguage || '');
      }
    } catch (_) {}

    return 'en';
  }

  function getLocaleChain(locale) {
    const normalized = normalizeLocale(locale || getRuntimeLocale()) || 'en';
    const chain = [];

    if (normalized) {
      const localeToken = normalized.replace(/-/g, '_');
      chain.push(localeToken);

      const languageOnly = localeToken.split('_')[0];
      if (languageOnly && languageOnly !== localeToken) {
        chain.push(languageOnly);
      }
    }

    if (!chain.includes('en')) {
      chain.push('en');
    }

    return chain;
  }

  function getNodeLocaleDirName(localeToken) {
    switch (localeToken) {
      case 'zh_cn':
        return 'zh_CN';
      case 'zh_tw':
        return 'zh_TW';
      case 'pt_br':
        return 'pt_BR';
      default:
        return localeToken;
    }
  }

  function getNodeLocaleMessages(locale) {
    if (typeof module === 'undefined' || !module.exports || typeof require !== 'function' || typeof __dirname === 'undefined') {
      return null;
    }

    const cacheKey = getLocaleChain(locale).join('|') || 'en';
    if (NODE_LOCALE_MESSAGES_CACHE.has(cacheKey)) {
      return NODE_LOCALE_MESSAGES_CACHE.get(cacheKey);
    }

    try {
      const fs = require('fs');
      const path = require('path');
      const mergedMessages = {};
      const localeChain = getLocaleChain(locale);

      for (let index = localeChain.length - 1; index >= 0; index -= 1) {
        const localeToken = localeChain[index];
        const filePath = path.join(__dirname, '..', '_locales', getNodeLocaleDirName(localeToken), 'messages.json');
        if (!fs.existsSync(filePath)) {
          continue;
        }

        const localeMessages = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        Object.assign(mergedMessages, localeMessages);
      }

      NODE_LOCALE_MESSAGES_CACHE.set(cacheKey, mergedMessages);
      return mergedMessages;
    } catch (_) {
      NODE_LOCALE_MESSAGES_CACHE.set(cacheKey, null);
      return null;
    }
  }

  function getLocaleMessage(key, fallback = '', substitutions = undefined, locale = '') {
    const nodeMessages = getNodeLocaleMessages(locale);
    const nodeMessage = normalizeString(nodeMessages?.[key]?.message);
    if (nodeMessage) {
      return nodeMessage;
    }

    try {
      const runtimeMessage = globalThis?.RuntimeI18n?.getMessage?.(key, substitutions);
      if (runtimeMessage) {
        return runtimeMessage;
      }
    } catch (_) {}

    try {
      if (typeof chrome !== 'undefined' && chrome?.i18n?.getMessage) {
        const message = chrome.i18n.getMessage(key, substitutions);
        if (message) {
          return message;
        }
      }
    } catch (_) {}

    return fallback;
  }

  function getStaticLocalizedVariant(definition, locale) {
    const localeKey = normalizeString(definition?.localeKey);
    return {
      name: normalizeString(getLocaleMessage(`${localeKey}Name`, '', undefined, locale)),
      description: normalizeString(getLocaleMessage(`${localeKey}Description`, '', undefined, locale)),
      shortName: normalizeString(getLocaleMessage(`${localeKey}ShortName`, '', undefined, locale)),
      personaPrompt: normalizeString(getLocaleMessage(`${localeKey}PersonaPrompt`, '', undefined, locale))
    };
  }

  function buildCategory(definition, locale) {
    const variant = getStaticLocalizedVariant(definition, locale);
    return {
      id: definition.id,
      name: normalizeString(variant.name) || definition.fallbackName,
      description: normalizeString(variant.description) || definition.fallbackDescription
    };
  }

  function buildAgent(definition, locale) {
    const variant = getStaticLocalizedVariant(definition, locale);
    return {
      id: definition.id,
      name: normalizeString(variant.name) || definition.fallbackName,
      shortName: normalizeString(variant.shortName) || definition.fallbackShortName || normalizeString(variant.name) || definition.fallbackName,
      type: definition.type,
      categoryId: definition.categoryId,
      color: definition.color,
      description: normalizeString(variant.description) || definition.fallbackDescription,
      defaultEnabled: definition.defaultEnabled === true,
      personaPrompt: normalizeString(variant.personaPrompt) || definition.fallbackPersonaPrompt
    };
  }

  function getCategories(locale) {
    return CATEGORY_DEFINITIONS.map((definition) => buildCategory(definition, locale));
  }

  function getAgents(locale) {
    return AGENT_DEFINITIONS.map((definition) => buildAgent(definition, locale));
  }

  function getCategoryMap(locale) {
    return new Map(getCategories(locale).map((category) => [category.id, category]));
  }

  function getAgentMap(locale) {
    return new Map(getAgents(locale).map((agent) => [agent.id, agent]));
  }

  function listCategories(locale) {
    return getCategories(locale).map((category) => ({ ...category }));
  }

  function listAgents(locale) {
    return getAgents(locale).map((agent) => ({ ...agent }));
  }

  function getAgentById(agentId, locale) {
    const agent = getAgentMap(locale).get(normalizeString(agentId));
    return agent ? { ...agent } : null;
  }

  function getCategoryById(categoryId, locale) {
    const category = getCategoryMap(locale).get(normalizeString(categoryId));
    return category ? { ...category } : null;
  }

  function listAgentsByCategory(categoryId, locale) {
    const normalizedCategoryId = normalizeString(categoryId);
    return getAgents(locale)
      .filter((agent) => agent.categoryId === normalizedCategoryId)
      .map((agent) => ({ ...agent }));
  }

  function getCatalog(locale) {
    return {
      categories: listCategories(locale),
      agents: listAgents(locale)
    };
  }

  function normalizeCustomAgent(rawAgent, categoryIds = []) {
    if (!rawAgent || typeof rawAgent !== 'object') {
      return null;
    }

    const id = normalizeString(rawAgent.id);
    const name = normalizeString(rawAgent.name);
    const personaPrompt = String(rawAgent.personaPrompt || '').replace(/\r\n/g, '\n').trim();
    if (!id || !name || !personaPrompt) {
      return null;
    }

    const normalizedCategoryIds = Array.isArray(categoryIds) ? categoryIds.filter(Boolean) : [];
    const categoryId = normalizedCategoryIds.includes(normalizeString(rawAgent.categoryId))
      ? normalizeString(rawAgent.categoryId)
      : 'technology';
    const shortName = normalizeString(rawAgent.shortName) || buildShortName(name, 'A');
    const type = normalizeString(rawAgent.type) || 'information';

    return {
      id,
      name,
      shortName,
      description: normalizeString(rawAgent.description),
      personaPrompt,
      type,
      categoryId,
      color: normalizeColor(rawAgent.color, '#4f6b95'),
      defaultEnabled: rawAgent.defaultEnabled === true,
      sourceType: normalizeString(rawAgent.sourceType) || 'custom',
      sourceUrl: normalizeString(rawAgent.sourceUrl),
      sourceTitle: normalizeString(rawAgent.sourceTitle),
      compatibility: normalizeString(rawAgent.compatibility) || 'prompt_only',
      importedAt: normalizeString(rawAgent.importedAt) || new Date().toISOString(),
      isCustom: true
    };
  }

  function normalizeCustomAgents(customAgents = [], locale) {
    if (!Array.isArray(customAgents)) {
      return [];
    }

    const categoryIds = listCategories(locale).map((category) => category.id);
    const seen = new Set();
    const normalizedAgents = [];

    customAgents.forEach((rawAgent) => {
      const normalizedAgent = normalizeCustomAgent(rawAgent, categoryIds);
      if (!normalizedAgent || seen.has(normalizedAgent.id)) {
        return;
      }
      seen.add(normalizedAgent.id);
      normalizedAgents.push(normalizedAgent);
    });

    return normalizedAgents;
  }

  function migrateLegacyCustomAgentsStorage(syncCustomAgents = [], localCustomAgents = []) {
    const syncList = Array.isArray(syncCustomAgents) ? syncCustomAgents : [];
    const localList = Array.isArray(localCustomAgents) ? localCustomAgents : [];
    if (localList.length > 0) {
      return localList;
    }
    return syncList;
  }

  function normalizeAgentCustomSettingsMap(settingsMap) {
    const nextMap = {};
    if (!settingsMap || typeof settingsMap !== 'object') {
      return nextMap;
    }

    AGENT_DEFINITIONS.forEach((definition) => {
      const raw = settingsMap?.[definition.id];
      if (!raw || typeof raw !== 'object') {
        return;
      }

      const entry = {};
      const fallbackName = normalizeString(definition.fallbackName);
      const fallbackDescription = normalizeString(definition.fallbackDescription);
      const fallbackPersonaPrompt = normalizeString(definition.fallbackPersonaPrompt);

      if (typeof raw.defaultEnabled === 'boolean') {
        entry.defaultEnabled = raw.defaultEnabled;
      }

      if (typeof raw.name === 'string') {
        const name = raw.name.trim();
        if (name && name !== fallbackName) {
          entry.name = name;
        }
      }

      if (typeof raw.description === 'string') {
        const description = raw.description.trim();
        if (description !== fallbackDescription) {
          entry.description = description;
        }
      }

      if (typeof raw.personaPrompt === 'string') {
        const personaPrompt = raw.personaPrompt.trim();
        if (personaPrompt && personaPrompt !== fallbackPersonaPrompt) {
          entry.personaPrompt = personaPrompt;
        }
      }

      if (Object.keys(entry).length > 0) {
        nextMap[definition.id] = entry;
      }
    });

    return nextMap;
  }

  function mergeAgentWithCustomSettings(agent, customSettingsMap = {}) {
    const baseAgent = agent ? { ...agent } : null;
    if (!baseAgent) {
      return null;
    }

    const customSettings = customSettingsMap?.[baseAgent.id];
    if (!customSettings || typeof customSettings !== 'object') {
      return baseAgent;
    }

    const originalName = baseAgent.name;

    if (typeof customSettings.name === 'string' && customSettings.name.trim()) {
      baseAgent.name = customSettings.name.trim();
      if (!baseAgent.shortName || baseAgent.shortName === originalName) {
        baseAgent.shortName = customSettings.name.trim();
      }
    }

    if (typeof customSettings.description === 'string') {
      baseAgent.description = customSettings.description.trim();
    }

    if (typeof customSettings.personaPrompt === 'string' && customSettings.personaPrompt.trim()) {
      baseAgent.personaPrompt = customSettings.personaPrompt.trim();
    }

    if (typeof customSettings.defaultEnabled === 'boolean') {
      baseAgent.defaultEnabled = customSettings.defaultEnabled;
    }

    return baseAgent;
  }

  function normalizeAgentHiddenIds(hiddenIds = []) {
    if (!Array.isArray(hiddenIds)) {
      return [];
    }

    const seen = new Set();
    const normalizedHiddenIds = [];
    hiddenIds.forEach((value) => {
      const normalizedValue = normalizeString(value);
      if (!normalizedValue || seen.has(normalizedValue)) {
        return;
      }
      seen.add(normalizedValue);
      normalizedHiddenIds.push(normalizedValue);
    });

    return normalizedHiddenIds;
  }

  function buildCatalogWithCustomSettings(customSettingsMap = {}, customAgents = [], locale) {
    const normalizedMap = normalizeAgentCustomSettingsMap(customSettingsMap);
    const builtinAgents = getAgents(locale).map((agent) => mergeAgentWithCustomSettings(agent, normalizedMap));
    const normalizedCustomAgents = normalizeCustomAgents(customAgents, locale);

    return {
      categories: listCategories(locale),
      agents: builtinAgents.concat(normalizedCustomAgents)
    };
  }

  return {
    AGENT_CUSTOM_SETTINGS_STORAGE_KEY,
    CUSTOM_AGENTS_STORAGE_KEY,
    AGENT_HIDDEN_IDS_STORAGE_KEY,
    buildCatalogWithCustomSettings,
    getCatalog,
    getAgentById,
    getCategoryById,
    getRuntimeLocale,
    listAgents,
    listCategories,
    listAgentsByCategory,
    mergeAgentWithCustomSettings,
    normalizeAgentCustomSettingsMap,
    normalizeCustomAgent,
    normalizeCustomAgents,
    normalizeAgentHiddenIds,
    migrateLegacyCustomAgentsStorage
  };
});
