(function(root, factory) {
  const api = factory();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (root && typeof root === 'object') {
    root.AICompareAgentEngineConfig = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const KEY_MASK = 'AICompare::AgentEngine::2026';
  const PROVIDER_TYPES = Object.freeze({
    OFFICIAL: 'official',
    CUSTOM: 'custom'
  });
  const DEFAULT_DAILY_FREE_LIMIT = 100;
  const DEFAULT_CHECKOUT_PLAN = 'yearly';

  function xorTransform(input, key) {
    const normalizedInput = String(input || '');
    const normalizedKey = String(key || '');
    if (!normalizedInput || !normalizedKey) {
      return normalizedInput;
    }

    let output = '';
    for (let index = 0; index < normalizedInput.length; index += 1) {
      output += String.fromCharCode(
        normalizedInput.charCodeAt(index) ^ normalizedKey.charCodeAt(index % normalizedKey.length)
      );
    }
    return output;
  }

  function encodeBase64(input) {
    if (typeof btoa === 'function') {
      return btoa(input);
    }
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(input, 'latin1').toString('base64');
    }
    throw new Error('Base64 encoder is unavailable');
  }

  function decodeBase64(input) {
    if (typeof atob === 'function') {
      return atob(input);
    }
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(String(input || ''), 'base64').toString('latin1');
    }
    throw new Error('Base64 decoder is unavailable');
  }

  function encryptApiKey(apiKey) {
    const normalizedApiKey = String(apiKey || '');
    if (!normalizedApiKey) {
      return '';
    }
    return encodeBase64(xorTransform(normalizedApiKey, KEY_MASK));
  }

  function decryptApiKey(cipherText) {
    const normalizedCipherText = String(cipherText || '').trim();
    if (!normalizedCipherText) {
      return '';
    }

    try {
      return xorTransform(decodeBase64(normalizedCipherText), KEY_MASK);
    } catch (_) {
      return '';
    }
  }

  function normalizeLocale(locale = '') {
    const value = String(locale || '').trim().replace('-', '_');
    if (!value) return '';
    const lower = value.toLowerCase();
    if (lower === 'zh_cn' || lower === 'zh_hans') return 'zh_CN';
    if (lower === 'zh_tw' || lower === 'zh_hk' || lower === 'zh_mo' || lower === 'zh_hant') return 'zh_TW';
    if (lower === 'pt_br') return 'pt_BR';
    const [lang, region] = value.split('_');
    if (!region) return lang.toLowerCase();
    return `${lang.toLowerCase()}_${region.toUpperCase()}`;
  }

  function isChineseLocale(locale = '') {
    return normalizeLocale(locale).toLowerCase().startsWith('zh');
  }

  function shouldEnableBillingForLocale(locale = '') {
    return !isChineseLocale(locale);
  }

  const DEFAULTS = Object.freeze({
    providerType: PROVIDER_TYPES.OFFICIAL,
    baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
    encryptedApiKey: '',
    model: 'glm-5.1',
    concurrency: 10,
    systemPrompt: '',
    defaultCheckoutPlan: DEFAULT_CHECKOUT_PLAN
  });

  const CUSTOM_DEFAULTS = Object.freeze({
    baseUrl: '',
    apiKey: '',
    model: '',
    concurrency: 10,
    systemPrompt: ''
  });

  function getOfficialDefaults() {
    return {
      providerType: PROVIDER_TYPES.OFFICIAL,
      baseUrl: DEFAULTS.baseUrl,
      apiKey: decryptApiKey(DEFAULTS.encryptedApiKey),
      model: DEFAULTS.model,
      concurrency: DEFAULTS.concurrency,
      systemPrompt: DEFAULTS.systemPrompt,
      defaultCheckoutPlan: DEFAULTS.defaultCheckoutPlan
    };
  }

  function getDefaults() {
    const official = getOfficialDefaults();
    return {
      providerType: PROVIDER_TYPES.OFFICIAL,
      official,
      custom: {
        ...CUSTOM_DEFAULTS
      },
      defaultCheckoutPlan: DEFAULTS.defaultCheckoutPlan,
      baseUrl: official.baseUrl,
      apiKey: official.apiKey,
      model: official.model,
      concurrency: official.concurrency,
      systemPrompt: official.systemPrompt
    };
  }

  return {
    DEFAULTS,
    CUSTOM_DEFAULTS,
    PROVIDER_TYPES,
    DEFAULT_DAILY_FREE_LIMIT,
    DEFAULT_CHECKOUT_PLAN,
    decryptApiKey,
    encryptApiKey,
    getOfficialDefaults,
    getDefaults,
    isChineseLocale,
    normalizeLocale,
    shouldEnableBillingForLocale
  };
});
