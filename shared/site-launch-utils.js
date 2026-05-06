(function(root, factory) {
  const api = factory();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    module.exports.SiteLaunchUtils = api;
  }

  if (root && typeof root === 'object') {
    root.SiteLaunchUtils = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function normalizeEntryUrl(value) {
    return normalizeString(value);
  }

  function normalizeBoolean(value, fallback = false) {
    if (typeof value === 'boolean') {
      return value;
    }

    if (value === 1 || value === '1' || value === 'true') {
      return true;
    }

    if (value === 0 || value === '0' || value === 'false') {
      return false;
    }

    return fallback;
  }

  function normalizeNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function normalizeQueryTokenValue(query) {
    return encodeURIComponent(normalizeString(query));
  }

  function replaceQueryToken(url, query) {
    const normalizedUrl = normalizeEntryUrl(url);
    if (!normalizedUrl) {
      return '';
    }

    const encodedQuery = normalizeQueryTokenValue(query);
    return normalizedUrl.includes('{query}')
      ? normalizedUrl.split('{query}').join(encodedQuery)
      : normalizedUrl;
  }

  function hasQueryToken(url) {
    return normalizeEntryUrl(url).includes('{query}');
  }

  function isLikelyPlaceholderHistoryUrl(url, siteName = '') {
    const normalizedUrl = normalizeEntryUrl(url);
    if (!normalizedUrl) {
      return true;
    }

    try {
      const parsed = new URL(normalizedUrl);
      const pathname = parsed.pathname || '';
      const normalizedSiteName = normalizeString(siteName).toLowerCase();

      if (/(^|\/)new-chat\/?$/.test(pathname)) {
        return true;
      }

      if (normalizedSiteName.includes('qwen') && /\/c\/new-chat\/?$/.test(pathname)) {
        return true;
      }

      return false;
    } catch (_) {
      return false;
    }
  }

  function getRootLaunchUrl(url) {
    const normalizedUrl = normalizeEntryUrl(url);
    if (!normalizedUrl) {
      return '';
    }

    try {
      const parsed = new URL(normalizedUrl);
      return `${parsed.origin}/`;
    } catch (_) {
      return normalizedUrl;
    }
  }

  function createCustomSiteId(name, index = 0) {
    const slug = normalizeString(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    return `custom-${slug || 'site'}-${normalizeNumber(index, 0)}-${suffix}`;
  }

  function normalizeCustomSite(site, index = 0) {
    if (!site || typeof site !== 'object' || Array.isArray(site)) {
      return null;
    }

    const name = normalizeString(site.name);
    const url = normalizeEntryUrl(site.url);
    if (!name || !url) {
      return null;
    }

    return {
      id: normalizeString(site.id) || createCustomSiteId(name, index),
      name,
      url,
      enabled: normalizeBoolean(site.enabled, true),
      supportIframe: true,
      icon: normalizeEntryUrl(site.icon),
      note: normalizeEntryUrl(site.note),
      order: normalizeNumber(site.order, index)
    };
  }

  function normalizeCustomSites(customSites) {
    const list = Array.isArray(customSites) ? customSites : [];
    return list
      .map((site, index) => normalizeCustomSite(site, index))
      .filter(Boolean)
      .sort((a, b) => {
        const orderA = Number.isFinite(a.order) ? a.order : 0;
        const orderB = Number.isFinite(b.order) ? b.order : 0;
        if (orderA !== orderB) {
          return orderA - orderB;
        }
        return String(a.name || '').localeCompare(String(b.name || ''));
      });
  }

  async function loadCustomSites(storageArea = null) {
    const storage = storageArea || (typeof chrome !== 'undefined' ? chrome.storage : null);
    if (!storage || !storage.sync || typeof storage.sync.get !== 'function') {
      return [];
    }

    try {
      const result = await storage.sync.get('customSites');
      return normalizeCustomSites(result?.customSites);
    } catch (error) {
      console.error('加载 customSites 失败:', error);
      return [];
    }
  }

  function resolveOfficialLaunchTarget(site, query = '') {
    const normalizedSite = site && typeof site === 'object' ? site : {};
    const normalizedQuery = normalizeString(query);
    const entryUrl = normalizeEntryUrl(normalizedSite.entryUrl);
    const siteUrl = normalizeEntryUrl(normalizedSite.url);
    const hasEntryUrl = Boolean(entryUrl);
    const baseUrl = hasEntryUrl ? entryUrl : siteUrl;
    const queryInUrl = Boolean(normalizedQuery) && (
      hasQueryToken(baseUrl) || (!hasEntryUrl && normalizeBoolean(normalizedSite.supportUrlQuery, false))
    );

    if (!normalizedQuery) {
      return {
        url: hasEntryUrl
          ? (hasQueryToken(entryUrl) ? getRootLaunchUrl(entryUrl) : entryUrl)
          : getRootLaunchUrl(siteUrl || baseUrl),
        entryUrl,
        siteUrl,
        queryInUrl: false,
        shouldAutoRun: false,
        source: hasEntryUrl ? 'entryUrl' : 'siteUrl',
        name: normalizeString(normalizedSite.name)
      };
    }

    return {
      url: queryInUrl ? replaceQueryToken(baseUrl, normalizedQuery) : baseUrl,
      entryUrl,
      siteUrl,
      queryInUrl,
      shouldAutoRun: Boolean(normalizedQuery) && !queryInUrl,
      source: hasEntryUrl ? 'entryUrl' : 'siteUrl',
      name: normalizeString(normalizedSite.name)
    };
  }

  function resolveCustomLaunchTarget(site, query = '') {
    const normalizedSite = site && typeof site === 'object' ? site : {};
    return {
      url: normalizeEntryUrl(normalizedSite.url),
      queryInUrl: false,
      shouldAutoRun: false,
      source: 'customSite',
      name: normalizeString(normalizedSite.name),
      id: normalizeString(normalizedSite.id),
      supportIframe: true,
      queryIgnored: Boolean(normalizeString(query))
    };
  }

  return {
    createCustomSiteId,
    hasQueryToken,
    isLikelyPlaceholderHistoryUrl,
    loadCustomSites,
    normalizeBoolean,
    normalizeCustomSite,
    normalizeCustomSites,
    normalizeEntryUrl,
    normalizeNumber,
    resolveCustomLaunchTarget,
    resolveOfficialLaunchTarget,
    replaceQueryToken
  };
});
