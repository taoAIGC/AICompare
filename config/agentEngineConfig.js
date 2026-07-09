(function(root, factory) {
  const api = factory();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (root && typeof root === 'object') {
    root.AICompareAgentEngineConfig = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const PROVIDER_TYPES = Object.freeze({
    OFFICIAL: 'official',
    CUSTOM: 'custom'
  });
  const DEFAULT_DAILY_FREE_LIMIT = 10;
  const DEFAULT_CHECKOUT_PLAN = 'yearly';

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
    return true;
  }

  const DEFAULTS = Object.freeze({
    providerType: PROVIDER_TYPES.OFFICIAL,
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
    getOfficialDefaults,
    getDefaults,
    isChineseLocale,
    normalizeLocale,
    shouldEnableBillingForLocale
  };
});
