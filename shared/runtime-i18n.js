(() => {
  const STORAGE_KEY = 'uiLanguage';
  const AUTO_VALUE = 'auto';
  const DEFAULT_LOCALE = 'en';
  const RTL_LANGS = new Set(['ar', 'he', 'fa', 'ur']);
  const NODE_LOCALE_DIRS = [
    'ar', 'am', 'bg', 'bn', 'ca', 'cs', 'da', 'de', 'el', 'en', 'en_AU',
    'en_GB', 'en_US', 'es', 'es_419', 'et', 'fa', 'fi', 'fil', 'fr', 'gu',
    'he', 'hi', 'hr', 'hu', 'id', 'it', 'ja', 'kn', 'ko', 'lt', 'lv', 'ml',
    'mr', 'ms', 'nl', 'no', 'pl', 'pt_BR', 'pt_PT', 'ro', 'ru', 'sk', 'sl',
    'sr', 'sv', 'sw', 'ta', 'te', 'th', 'tr', 'uk', 'vi', 'zh_CN', 'zh_TW'
  ];
  const messageCache = new Map();
  let activeLocale = '';
  let activeMessages = {};
  let initialized = false;
  let storageListenerBound = false;
  let initializationPromise = null;

  function normalizeLocale(locale = '') {
    const value = String(locale || '').trim().replace('-', '_');
    if (!value) return '';
    const lower = value.toLowerCase();
    if (lower === 'zh_cn' || lower === 'zh-hans') return 'zh_CN';
    if (lower === 'zh_tw' || lower === 'zh_hk' || lower === 'zh_mo' || lower === 'zh-hant') return 'zh_TW';
    if (lower === 'pt_br') return 'pt_BR';
    const [lang, region] = value.split('_');
    if (!region) return lang.toLowerCase();
    return `${lang.toLowerCase()}_${region.toUpperCase()}`;
  }

  function getBrowserLocale() {
    try {
      return normalizeLocale(chrome?.i18n?.getUILanguage?.() || navigator.language || DEFAULT_LOCALE) || DEFAULT_LOCALE;
    } catch (_) {
      return DEFAULT_LOCALE;
    }
  }

  function getLocaleChain(locale = '') {
    const normalized = normalizeLocale(locale) || DEFAULT_LOCALE;
    const chain = [normalized];
    if (normalized.includes('_')) {
      const base = normalized.split('_')[0];
      if (base && !chain.includes(base)) {
        chain.push(base);
      }
    }
    if (!chain.includes(DEFAULT_LOCALE)) {
      chain.push(DEFAULT_LOCALE);
    }
    return chain.filter((token, index, list) => token && list.indexOf(token) === index);
  }

  function getDirCandidates(localeToken = '') {
    const normalized = normalizeLocale(localeToken);
    const candidates = [];
    if (!normalized) return candidates;
    if (NODE_LOCALE_DIRS.includes(normalized)) candidates.push(normalized);
    if (normalized === 'zh') {
      candidates.push('zh_CN');
    }
    if (normalized.includes('_')) {
      const base = normalized.split('_')[0];
      if (NODE_LOCALE_DIRS.includes(base)) candidates.push(base);
      if (base === 'zh') candidates.push('zh_CN');
    }
    return candidates.filter((token, index, list) => token && list.indexOf(token) === index);
  }

  async function loadLocaleMessages(locale = '') {
    const cacheKey = normalizeLocale(locale) || DEFAULT_LOCALE;
    if (messageCache.has(cacheKey)) {
      return messageCache.get(cacheKey);
    }

    const merged = {};
    const dirs = [];
    getLocaleChain(cacheKey).forEach((token) => {
      getDirCandidates(token).forEach((dir) => {
        if (!dirs.includes(dir)) {
          dirs.push(dir);
        }
      });
    });

    for (let index = dirs.length - 1; index >= 0; index -= 1) {
      const dir = dirs[index];
      try {
        const response = await fetch(chrome.runtime.getURL(`_locales/${dir}/messages.json`));
        if (!response.ok) continue;
        const json = await response.json();
        Object.assign(merged, json || {});
      } catch (_) {}
    }

    messageCache.set(cacheKey, merged);
    return merged;
  }

  function getTextDirection(locale = '') {
    const normalized = normalizeLocale(locale);
    const language = normalized.split('_')[0];
    return RTL_LANGS.has(language) ? 'rtl' : 'ltr';
  }

  async function getStoredLocalePreference() {
    try {
      const result = await chrome.storage.sync.get(STORAGE_KEY);
      return normalizeLocale(result?.[STORAGE_KEY]) || AUTO_VALUE;
    } catch (_) {
      return AUTO_VALUE;
    }
  }

  async function initializeRuntimeI18n() {
    if (initialized && activeLocale) {
      return activeLocale;
    }

    if (!initializationPromise) {
      initializationPromise = (async () => {
        const storedLocale = await getStoredLocalePreference();
        const resolvedLocale = storedLocale === AUTO_VALUE ? getBrowserLocale() : storedLocale;
        activeLocale = resolvedLocale || DEFAULT_LOCALE;
        activeMessages = await loadLocaleMessages(activeLocale);
        initialized = true;
        bindStorageListener();

        if (typeof document !== 'undefined') {
          const root = document.documentElement;
          if (root) {
            root.lang = activeLocale.replace('_', '-');
            root.dir = getTextDirection(activeLocale);
          }
        }

        return activeLocale;
      })();
    }

    try {
      return await initializationPromise;
    } finally {
      initializationPromise = null;
    }
  }

  async function setLocalePreference(nextLocale = AUTO_VALUE) {
    const normalized = normalizeLocale(nextLocale) || AUTO_VALUE;
    const storedValue = normalized === AUTO_VALUE ? AUTO_VALUE : normalized;
    await chrome.storage.sync.set({ [STORAGE_KEY]: storedValue });
    activeLocale = storedValue === AUTO_VALUE ? getBrowserLocale() : storedValue;
    activeMessages = await loadLocaleMessages(activeLocale);
    initialized = true;
    bindStorageListener();

    if (typeof document !== 'undefined') {
      const root = document.documentElement;
      if (root) {
        root.lang = activeLocale.replace('_', '-');
        root.dir = getTextDirection(activeLocale);
      }
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('runtime-language-changed', {
        detail: {
          requestedLocale: storedValue,
          activeLocale
        }
      }));
    }

    return activeLocale;
  }

  function updateDocumentLanguage(locale = '') {
    if (typeof document === 'undefined') {
      return;
    }
    const root = document.documentElement;
    if (!root) {
      return;
    }
    root.lang = locale.replace('_', '-');
    root.dir = getTextDirection(locale);
  }

  function dispatchLanguageChanged(requestedLocale, locale) {
    if (typeof window === 'undefined') {
      return;
    }
    window.dispatchEvent(new CustomEvent('runtime-language-changed', {
      detail: {
        requestedLocale,
        activeLocale: locale
      }
    }));
  }

  async function syncLocaleFromStorage(nextStoredValue) {
    const normalizedStored = normalizeLocale(nextStoredValue) || AUTO_VALUE;
    const nextLocale = normalizedStored === AUTO_VALUE ? getBrowserLocale() : normalizedStored;
    if (initialized && nextLocale === activeLocale) {
      return activeLocale;
    }

    activeLocale = nextLocale || DEFAULT_LOCALE;
    activeMessages = await loadLocaleMessages(activeLocale);
    initialized = true;
    updateDocumentLanguage(activeLocale);
    dispatchLanguageChanged(normalizedStored, activeLocale);
    return activeLocale;
  }

  function bindStorageListener() {
    if (storageListenerBound || !chrome?.storage?.onChanged?.addListener) {
      return;
    }
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'sync' || !Object.prototype.hasOwnProperty.call(changes || {}, STORAGE_KEY)) {
        return;
      }
      void syncLocaleFromStorage(changes[STORAGE_KEY]?.newValue);
    });
    storageListenerBound = true;
  }

  function substituteMessage(template = '', substitutions = undefined) {
    if (!Array.isArray(substitutions)) {
      if (typeof substitutions === 'string' || typeof substitutions === 'number') {
        substitutions = [String(substitutions)];
      } else {
        substitutions = [];
      }
    }
    return substitutions.reduce((result, value, index) => (
      result.replaceAll(`$${index + 1}`, String(value))
    ), template);
  }

  function getMessage(key, substitutions = undefined, fallback = '') {
    const message = activeMessages?.[key]?.message;
    if (message) {
      return substituteMessage(message, substitutions);
    }
    const chromeMessage = chrome?.i18n?.getMessage?.(key, substitutions);
    if (chromeMessage) {
      return chromeMessage;
    }
    return fallback || '';
  }

  function getCurrentLocale() {
    return activeLocale || getBrowserLocale();
  }

  function getRequestedLocale() {
    return initialized ? activeLocale : '';
  }

  function getLanguageOptions() {
    return [
      { value: AUTO_VALUE, labelKey: 'languageOptionAuto', fallback: 'Follow browser language' },
      { value: 'ar', labelKey: 'languageOptionAr', fallback: 'العربية' },
      { value: 'am', labelKey: 'languageOptionAm', fallback: 'አማርኛ' },
      { value: 'bg', labelKey: 'languageOptionBg', fallback: 'Български' },
      { value: 'bn', labelKey: 'languageOptionBn', fallback: 'বাংলা' },
      { value: 'ca', labelKey: 'languageOptionCa', fallback: 'Català' },
      { value: 'cs', labelKey: 'languageOptionCs', fallback: 'Čeština' },
      { value: 'da', labelKey: 'languageOptionDa', fallback: 'Dansk' },
      { value: 'de', labelKey: 'languageOptionDe', fallback: 'Deutsch' },
      { value: 'el', labelKey: 'languageOptionEl', fallback: 'Ελληνικά' },
      { value: 'en', labelKey: 'languageOptionEn', fallback: 'English' },
      { value: 'en_AU', labelKey: 'languageOptionEnAu', fallback: 'English (Australia)' },
      { value: 'en_GB', labelKey: 'languageOptionEnGb', fallback: 'English (United Kingdom)' },
      { value: 'en_US', labelKey: 'languageOptionEnUs', fallback: 'English (United States)' },
      { value: 'es', labelKey: 'languageOptionEs', fallback: 'Español' },
      { value: 'es_419', labelKey: 'languageOptionEs419', fallback: 'Español (Latinoamérica)' },
      { value: 'et', labelKey: 'languageOptionEt', fallback: 'Eesti' },
      { value: 'fa', labelKey: 'languageOptionFa', fallback: 'فارسی' },
      { value: 'fi', labelKey: 'languageOptionFi', fallback: 'Suomi' },
      { value: 'fil', labelKey: 'languageOptionFil', fallback: 'Filipino' },
      { value: 'fr', labelKey: 'languageOptionFr', fallback: 'Français' },
      { value: 'gu', labelKey: 'languageOptionGu', fallback: 'ગુજરાતી' },
      { value: 'he', labelKey: 'languageOptionHe', fallback: 'עברית' },
      { value: 'hi', labelKey: 'languageOptionHi', fallback: 'हिन्दी' },
      { value: 'hr', labelKey: 'languageOptionHr', fallback: 'Hrvatski' },
      { value: 'hu', labelKey: 'languageOptionHu', fallback: 'Magyar' },
      { value: 'id', labelKey: 'languageOptionId', fallback: 'Bahasa Indonesia' },
      { value: 'it', labelKey: 'languageOptionIt', fallback: 'Italiano' },
      { value: 'ja', labelKey: 'languageOptionJa', fallback: '日本語' },
      { value: 'kn', labelKey: 'languageOptionKn', fallback: 'ಕನ್ನಡ' },
      { value: 'ko', labelKey: 'languageOptionKo', fallback: '한국어' },
      { value: 'lt', labelKey: 'languageOptionLt', fallback: 'Lietuvių' },
      { value: 'lv', labelKey: 'languageOptionLv', fallback: 'Latviešu' },
      { value: 'ml', labelKey: 'languageOptionMl', fallback: 'മലയാളം' },
      { value: 'mr', labelKey: 'languageOptionMr', fallback: 'मराठी' },
      { value: 'ms', labelKey: 'languageOptionMs', fallback: 'Bahasa Melayu' },
      { value: 'nl', labelKey: 'languageOptionNl', fallback: 'Nederlands' },
      { value: 'no', labelKey: 'languageOptionNo', fallback: 'Norsk' },
      { value: 'pl', labelKey: 'languageOptionPl', fallback: 'Polski' },
      { value: 'pt_BR', labelKey: 'languageOptionPtBr', fallback: 'Português (Brasil)' },
      { value: 'pt_PT', labelKey: 'languageOptionPtPt', fallback: 'Português (Portugal)' },
      { value: 'ro', labelKey: 'languageOptionRo', fallback: 'Română' },
      { value: 'ru', labelKey: 'languageOptionRu', fallback: 'Русский' },
      { value: 'sk', labelKey: 'languageOptionSk', fallback: 'Slovenčina' },
      { value: 'sl', labelKey: 'languageOptionSl', fallback: 'Slovenščina' },
      { value: 'sr', labelKey: 'languageOptionSr', fallback: 'Српски' },
      { value: 'sv', labelKey: 'languageOptionSv', fallback: 'Svenska' },
      { value: 'sw', labelKey: 'languageOptionSw', fallback: 'Kiswahili' },
      { value: 'ta', labelKey: 'languageOptionTa', fallback: 'தமிழ்' },
      { value: 'te', labelKey: 'languageOptionTe', fallback: 'తెలుగు' },
      { value: 'th', labelKey: 'languageOptionTh', fallback: 'ไทย' },
      { value: 'tr', labelKey: 'languageOptionTr', fallback: 'Türkçe' },
      { value: 'uk', labelKey: 'languageOptionUk', fallback: 'Українська' },
      { value: 'vi', labelKey: 'languageOptionVi', fallback: 'Tiếng Việt' },
      { value: 'zh_CN', labelKey: 'languageOptionZhCn', fallback: '简体中文' },
      { value: 'zh_TW', labelKey: 'languageOptionZhTw', fallback: '繁體中文' }
    ];
  }

  const api = {
    STORAGE_KEY,
    AUTO_VALUE,
    DEFAULT_LOCALE,
    normalizeLocale,
    initializeRuntimeI18n,
    setLocalePreference,
    getStoredLocalePreference,
    getCurrentLocale,
    getRequestedLocale,
    getMessage,
    getLanguageOptions
  };

  if (typeof window !== 'undefined') {
    window.RuntimeI18n = api;
  }
})();
