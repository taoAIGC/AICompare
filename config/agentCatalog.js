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
  const AGENT_CONFIG_VERSION_STORAGE_KEY = 'agentConfigVersion';
  const REMOTE_AGENT_CATALOG_STORAGE_KEY = 'remoteAgentCatalog';
  const AGENT_CONFIG_SOURCE_STORAGE_KEY = 'agentConfigSource';
  const AGENT_CONFIG_LAST_UPDATE_TIME_STORAGE_KEY = 'agentConfigLastUpdateTime';
  const AGENT_CONFIG_UPDATE_HISTORY_STORAGE_KEY = 'agentConfigUpdateHistory';
  const REMOTE_AGENT_CATALOG_URL = 'https://raw.githubusercontent.com/taoAIGC/AI-Shortcuts/main/config/agentCatalog.json';
  const NODE_LOCALE_MESSAGES_CACHE = new Map();
  const AgentCatalogData = resolveAgentCatalogData();

  let currentCatalogData = resolveCurrentCatalogData();
  let hydratePromise = null;
  let fetchPromise = null;

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

  function resolveCurrentCatalogData() {
    try {
      const runtimeData = typeof AgentCatalogData.getCatalogData === 'function'
        ? AgentCatalogData.getCatalogData()
        : AgentCatalogData;
      return normalizeCatalogData(runtimeData);
    } catch (_) {
      return normalizeCatalogData(AgentCatalogData);
    }
  }

  function normalizeString(value) {
    return String(value || '').trim();
  }

  function normalizeColor(value, fallback = '#4f6b95') {
    const color = normalizeString(value);
    return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color) ? color : fallback;
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

  function cloneDefinitions(items = []) {
    return Array.isArray(items) ? items.map((item) => ({ ...item })) : [];
  }

  function normalizeCatalogData(rawCatalog) {
    const fallback = AgentCatalogData?.FALLBACK_CATALOG || {};
    const categories = cloneDefinitions(
      rawCatalog?.CATEGORY_DEFINITIONS
      || rawCatalog?.categories
      || fallback.categories
    );
    const agents = cloneDefinitions(
      rawCatalog?.AGENT_DEFINITIONS
      || rawCatalog?.agents
      || fallback.agents
    );

    return {
      version: normalizeString(rawCatalog?.version || fallback.version || Date.now()),
      CATEGORY_DEFINITIONS: Object.freeze(categories),
      AGENT_DEFINITIONS: Object.freeze(agents)
    };
  }

  function applyCatalogData(rawCatalog) {
    currentCatalogData = normalizeCatalogData(rawCatalog);
    if (typeof AgentCatalogData?.setCatalogData === 'function') {
      AgentCatalogData.setCatalogData({
        version: currentCatalogData.version,
        categories: currentCatalogData.CATEGORY_DEFINITIONS,
        agents: currentCatalogData.AGENT_DEFINITIONS
      });
      currentCatalogData = normalizeCatalogData(AgentCatalogData.getCatalogData());
    }
    return currentCatalogData;
  }

  async function loadLocalAgentCatalogSnapshot() {
    const response = await fetch(chrome.runtime.getURL('config/agentCatalog.json'));
    if (!response.ok) {
      throw new Error(`加载本地技能配置失败: HTTP ${response.status}`);
    }
    return await response.json();
  }

  function compareVersions(version1, version2) {
    if (String(version1) === String(version2)) {
      return 0;
    }

    const parseVersion = (version) => {
      if (typeof version === 'string') {
        const cleanVersion = version.replace(/^v/, '');
        return cleanVersion.split('.').map((part) => {
          const match = part.match(/^(\d+)(.*)$/);
          return {
            number: parseInt(match ? match[1] : part, 10) || 0,
            suffix: match ? match[2] : ''
          };
        });
      }
      return [{ number: parseInt(version, 10) || 0, suffix: '' }];
    };

    const v1Parts = parseVersion(version1);
    const v2Parts = parseVersion(version2);
    const maxLength = Math.max(v1Parts.length, v2Parts.length);

    for (let i = 0; i < maxLength; i += 1) {
      const v1Part = v1Parts[i] || { number: 0, suffix: '' };
      const v2Part = v2Parts[i] || { number: 0, suffix: '' };

      if (v1Part.number !== v2Part.number) {
        return v1Part.number > v2Part.number ? 1 : -1;
      }

      if (v1Part.suffix !== v2Part.suffix) {
        if (v1Part.suffix === '' && v2Part.suffix !== '') {
          return 1;
        }
        if (v1Part.suffix !== '' && v2Part.suffix === '') {
          return -1;
        }
        return v1Part.suffix > v2Part.suffix ? 1 : -1;
      }
    }

    return 0;
  }

  async function hydrateBundledAgentCatalogIfNeeded() {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      return getCatalogData();
    }

    const {
      [REMOTE_AGENT_CATALOG_STORAGE_KEY]: cachedCatalog,
      [AGENT_CONFIG_VERSION_STORAGE_KEY]: cachedVersion,
      [AGENT_CONFIG_SOURCE_STORAGE_KEY]: configSource,
      [AGENT_CONFIG_LAST_UPDATE_TIME_STORAGE_KEY]: lastUpdateTime
    } = await chrome.storage.local.get([
      REMOTE_AGENT_CATALOG_STORAGE_KEY,
      AGENT_CONFIG_VERSION_STORAGE_KEY,
      AGENT_CONFIG_SOURCE_STORAGE_KEY,
      AGENT_CONFIG_LAST_UPDATE_TIME_STORAGE_KEY
    ]);

    let localCatalog = null;
    try {
      localCatalog = await loadLocalAgentCatalogSnapshot();
    } catch (_) {
      if (cachedCatalog) {
        applyCatalogData(cachedCatalog);
      }
      return getCatalogData();
    }

    const normalizedLocal = normalizeCatalogData(localCatalog);
    const normalizedCached = normalizeCatalogData(cachedCatalog || {});
    const effectiveCachedCategories = normalizedCached.CATEGORY_DEFINITIONS;
    const effectiveCachedAgents = normalizedCached.AGENT_DEFINITIONS;
    const effectiveCachedVersion = normalizeString(
      cachedCatalog?.version
      || cachedVersion
      || normalizedCached.version
    );
    const versionComparison = compareVersions(normalizedLocal.version, effectiveCachedVersion);
    const cacheLooksRemoteManaged = configSource === 'remote' || Boolean(lastUpdateTime);
    const bundledDiffersFromCache =
      JSON.stringify(normalizedLocal.CATEGORY_DEFINITIONS) !== JSON.stringify(effectiveCachedCategories)
      || JSON.stringify(normalizedLocal.AGENT_DEFINITIONS) !== JSON.stringify(effectiveCachedAgents);

    const shouldRefreshFromBundled =
      effectiveCachedCategories.length === 0
      || effectiveCachedAgents.length === 0
      || versionComparison > 0
      || (versionComparison === 0 && !cacheLooksRemoteManaged && bundledDiffersFromCache);

    if (shouldRefreshFromBundled) {
      await chrome.storage.local.set({
        [AGENT_CONFIG_VERSION_STORAGE_KEY]: normalizedLocal.version || Date.now(),
        [REMOTE_AGENT_CATALOG_STORAGE_KEY]: {
          version: normalizedLocal.version,
          categories: normalizedLocal.CATEGORY_DEFINITIONS,
          agents: normalizedLocal.AGENT_DEFINITIONS
        },
        [AGENT_CONFIG_SOURCE_STORAGE_KEY]: 'bundled'
      });
      applyCatalogData({
        version: normalizedLocal.version,
        categories: normalizedLocal.CATEGORY_DEFINITIONS,
        agents: normalizedLocal.AGENT_DEFINITIONS
      });
      return getCatalogData();
    }

    if (cachedCatalog) {
      applyCatalogData(cachedCatalog);
    } else {
      applyCatalogData({
        version: normalizedLocal.version,
        categories: normalizedLocal.CATEGORY_DEFINITIONS,
        agents: normalizedLocal.AGENT_DEFINITIONS
      });
    }

    if (!configSource && effectiveCachedCategories.length > 0 && effectiveCachedAgents.length > 0) {
      await chrome.storage.local.set({
        [AGENT_CONFIG_SOURCE_STORAGE_KEY]: cacheLooksRemoteManaged ? 'remote' : 'bundled'
      });
    }

    return getCatalogData();
  }

  async function hydrateCatalogFromStorageIfPossible() {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      return getCatalogData();
    }
    return await hydrateBundledAgentCatalogIfNeeded();
  }

  async function ensureCatalogHydrated() {
    if (hydratePromise) {
      return hydratePromise;
    }

    hydratePromise = hydrateCatalogFromStorageIfPossible()
      .catch(() => getCatalogData())
      .finally(() => {
        hydratePromise = null;
      });

    return hydratePromise;
  }

  async function getLocalVersion() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        const result = await chrome.storage.local.get(AGENT_CONFIG_VERSION_STORAGE_KEY);
        if (result?.[AGENT_CONFIG_VERSION_STORAGE_KEY]) {
          return result[AGENT_CONFIG_VERSION_STORAGE_KEY];
        }
      }

      const localCatalog = await loadLocalAgentCatalogSnapshot();
      return normalizeString(localCatalog?.version || 0);
    } catch (_) {
      return normalizeString(currentCatalogData?.version || 0);
    }
  }

  async function updateLocalCatalog(remoteCatalog) {
    const normalized = normalizeCatalogData(remoteCatalog);
    const currentTime = Date.now();

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const {
        [AGENT_CONFIG_UPDATE_HISTORY_STORAGE_KEY]: updateHistory = [],
        [REMOTE_AGENT_CATALOG_STORAGE_KEY]: previousCatalog
      } = await chrome.storage.local.get([
        AGENT_CONFIG_UPDATE_HISTORY_STORAGE_KEY,
        REMOTE_AGENT_CATALOG_STORAGE_KEY
      ]);

      const previousNormalized = normalizeCatalogData(previousCatalog || {});
      const previousCategories = previousNormalized.CATEGORY_DEFINITIONS;
      const previousAgents = previousNormalized.AGENT_DEFINITIONS;

      const newCategoryNames = normalized.CATEGORY_DEFINITIONS
        .filter((category) => !previousCategories.some((oldCategory) => oldCategory.id === category.id))
        .map((category) => category.name || category.id)
        .filter(Boolean);

      const newAgentNames = normalized.AGENT_DEFINITIONS
        .filter((agent) => !previousAgents.some((oldAgent) => oldAgent.id === agent.id))
        .map((agent) => agent.name || agent.id)
        .filter(Boolean);

      const updatedAgentNames = normalized.AGENT_DEFINITIONS
        .filter((agent) => {
          const oldAgent = previousAgents.find((item) => item.id === agent.id);
          if (!oldAgent) {
            return false;
          }
          return JSON.stringify(oldAgent) !== JSON.stringify(agent);
        })
        .map((agent) => agent.name || agent.id)
        .filter(Boolean);

      const updateRecord = {
        timestamp: currentTime,
        version: normalized.version || currentTime,
        newCategories: newCategoryNames,
        newAgents: newAgentNames,
        updatedAgents: updatedAgentNames,
        totalCategories: normalized.CATEGORY_DEFINITIONS.length,
        totalAgents: normalized.AGENT_DEFINITIONS.length,
        oldVersion: normalizeString(previousCatalog?.version || 'unknown')
      };

      const nextUpdateHistory = [...updateHistory, updateRecord].slice(-10);

      await chrome.storage.local.set({
        [AGENT_CONFIG_VERSION_STORAGE_KEY]: normalized.version || currentTime,
        [REMOTE_AGENT_CATALOG_STORAGE_KEY]: {
          version: normalized.version,
          categories: normalized.CATEGORY_DEFINITIONS,
          agents: normalized.AGENT_DEFINITIONS
        },
        [AGENT_CONFIG_SOURCE_STORAGE_KEY]: 'remote',
        [AGENT_CONFIG_LAST_UPDATE_TIME_STORAGE_KEY]: currentTime,
        [AGENT_CONFIG_UPDATE_HISTORY_STORAGE_KEY]: nextUpdateHistory
      });
    }

    applyCatalogData({
      version: normalized.version,
      categories: normalized.CATEGORY_DEFINITIONS,
      agents: normalized.AGENT_DEFINITIONS
    });
    return getCatalogData();
  }

  async function fetchAndApplyRemoteCatalog() {
    const response = await fetch(REMOTE_AGENT_CATALOG_URL, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`技能配置服务器错误: ${response.status}`);
    }

    const remoteCatalog = await response.json();
    const remoteVersion = normalizeString(remoteCatalog?.version || Date.now());
    const localVersion = await getLocalVersion();
    const versionComparison = compareVersions(remoteVersion, localVersion);

    if (versionComparison > 0) {
      await updateLocalCatalog(remoteCatalog);
      return {
        hasUpdate: true,
        config: remoteCatalog,
        version: remoteVersion,
        oldVersion: localVersion,
        versionComparison
      };
    }

    return {
      hasUpdate: false,
      reason: versionComparison < 0 ? 'remote_older' : 'same_version',
      version: remoteVersion,
      remoteVersion,
      localVersion
    };
  }

  async function autoCheckUpdate() {
    if (fetchPromise) {
      return fetchPromise;
    }

    fetchPromise = fetchAndApplyRemoteCatalog()
      .catch((error) => ({ hasUpdate: false, error: error.message }))
      .finally(() => {
        fetchPromise = null;
      });

    return fetchPromise;
  }

  function getCatalogData() {
    return currentCatalogData;
  }

  function getStaticLocalizedVariant(definition, locale) {
    const localeKey = normalizeString(definition?.localeKey);
    return {
      name: normalizeString(getLocaleMessage(`${localeKey}Name`, '', undefined, locale)),
      description: normalizeString(getLocaleMessage(`${localeKey}Description`, '', undefined, locale))
    };
  }

  function buildCategory(definition, locale) {
    const variant = getStaticLocalizedVariant(definition, locale);
    return {
      id: definition.id,
      name: normalizeString(variant.name) || normalizeString(definition.name),
      description: normalizeString(variant.description) || normalizeString(definition.description)
    };
  }

  function buildAgent(definition, locale) {
    const variant = getStaticLocalizedVariant(definition, locale);
    const configuredName = normalizeString(definition.name);
    const legacyDefaultEnabled = definition.defaultEnabled === true;
    return {
      id: definition.id,
      name: normalizeString(variant.name) || configuredName,
      type: definition.type,
      categoryId: definition.categoryId,
      color: definition.color,
      description: normalizeString(variant.description) || normalizeString(definition.description),
      enabled: definition.enabled === true || legacyDefaultEnabled,
      defaultSelected: definition.defaultSelected === true || legacyDefaultEnabled,
      personaPrompt: normalizeString(definition.personaPrompt)
    };
  }

  function getCategories(locale) {
    return getCatalogData().CATEGORY_DEFINITIONS.map((definition) => buildCategory(definition, locale));
  }

  function getAgents(locale) {
    return getCatalogData().AGENT_DEFINITIONS.map((definition) => buildAgent(definition, locale));
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
    const type = normalizeString(rawAgent.type) || 'information';
    const legacyDefaultEnabled = rawAgent.defaultEnabled === true;

    return {
      id,
      name,
      description: normalizeString(rawAgent.description),
      personaPrompt,
      type,
      categoryId,
      color: normalizeColor(rawAgent.color, '#4f6b95'),
      enabled: rawAgent.enabled === true || legacyDefaultEnabled,
      defaultSelected: rawAgent.defaultSelected === true || legacyDefaultEnabled,
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

    getCatalogData().AGENT_DEFINITIONS.forEach((definition) => {
      const raw = settingsMap?.[definition.id];
      if (!raw || typeof raw !== 'object') {
        return;
      }

      const entry = {};
      const configuredName = normalizeString(definition.name);
      const configuredDescription = normalizeString(definition.description);
      const configuredPersonaPrompt = normalizeString(definition.personaPrompt);

      if (typeof raw.enabled === 'boolean') {
        entry.enabled = raw.enabled;
      } else if (typeof raw.defaultEnabled === 'boolean') {
        entry.enabled = raw.defaultEnabled;
      }

      if (typeof raw.defaultSelected === 'boolean') {
        entry.defaultSelected = raw.defaultSelected;
      } else if (typeof raw.defaultEnabled === 'boolean') {
        entry.defaultSelected = raw.defaultEnabled;
      }

      if (typeof raw.name === 'string') {
        const name = raw.name.trim();
        if (name && name !== configuredName) {
          entry.name = name;
        }
      }

      if (typeof raw.description === 'string') {
        const description = raw.description.trim();
        if (description !== configuredDescription) {
          entry.description = description;
        }
      }

      if (typeof raw.personaPrompt === 'string') {
        const personaPrompt = raw.personaPrompt.trim();
        if (personaPrompt && personaPrompt !== configuredPersonaPrompt) {
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
    }

    if (typeof customSettings.description === 'string') {
      baseAgent.description = customSettings.description.trim();
    }

    if (typeof customSettings.personaPrompt === 'string' && customSettings.personaPrompt.trim()) {
      baseAgent.personaPrompt = customSettings.personaPrompt.trim();
    }

    if (typeof customSettings.enabled === 'boolean') {
      baseAgent.enabled = customSettings.enabled;
    } else if (typeof customSettings.defaultEnabled === 'boolean') {
      baseAgent.enabled = customSettings.defaultEnabled;
    }

    if (typeof customSettings.defaultSelected === 'boolean') {
      baseAgent.defaultSelected = customSettings.defaultSelected;
    } else if (typeof customSettings.defaultEnabled === 'boolean') {
      baseAgent.defaultSelected = customSettings.defaultEnabled;
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
    AGENT_CONFIG_VERSION_STORAGE_KEY,
    REMOTE_AGENT_CATALOG_STORAGE_KEY,
    AGENT_CONFIG_SOURCE_STORAGE_KEY,
    AGENT_CONFIG_LAST_UPDATE_TIME_STORAGE_KEY,
    AGENT_CONFIG_UPDATE_HISTORY_STORAGE_KEY,
    REMOTE_AGENT_CATALOG_URL,
    autoCheckUpdate,
    applyCatalogData,
    buildCatalogWithCustomSettings,
    ensureCatalogHydrated,
    getCatalog,
    getCatalogData,
    getAgentById,
    getCategoryById,
    getLocalVersion,
    getRuntimeLocale,
    hydrateBundledAgentCatalogIfNeeded,
    listAgents,
    listCategories,
    listAgentsByCategory,
    mergeAgentWithCustomSettings,
    normalizeAgentCustomSettingsMap,
    normalizeCatalogData,
    normalizeCustomAgent,
    normalizeCustomAgents,
    normalizeAgentHiddenIds,
    migrateLegacyCustomAgentsStorage,
    updateLocalCatalog
  };
});
