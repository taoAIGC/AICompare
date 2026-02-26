/**
 * Tests for SiteDetector class from config/siteDetector.js.
 *
 * Tests pure methods that don't require Chrome APIs, and tests async methods
 * with Chrome API mocks.
 */

// Load siteDetector.js; it exports via module.exports at the bottom
const { SiteDetector } = require('../config/siteDetector');

describe('SiteDetector', () => {
  let detector;

  beforeEach(() => {
    detector = new SiteDetector();
  });

  describe('normalizeDomain', () => {
    test('removes www. prefix', () => {
      expect(detector.normalizeDomain('www.example.com')).toBe('example.com');
    });

    test('converts to lowercase', () => {
      expect(detector.normalizeDomain('EXAMPLE.COM')).toBe('example.com');
    });

    test('removes www. and lowercases', () => {
      expect(detector.normalizeDomain('www.ChatGPT.COM')).toBe('chatgpt.com');
    });

    test('returns empty string for empty input', () => {
      expect(detector.normalizeDomain('')).toBe('');
    });

    test('returns empty string for null/undefined', () => {
      expect(detector.normalizeDomain(null)).toBe('');
      expect(detector.normalizeDomain(undefined)).toBe('');
    });

    test('preserves subdomains other than www', () => {
      expect(detector.normalizeDomain('api.example.com')).toBe('api.example.com');
    });

    test('handles gemini.google.com', () => {
      expect(detector.normalizeDomain('gemini.google.com')).toBe('gemini.google.com');
    });
  });

  describe('isDomainMatch', () => {
    test('exact match returns true with type "exact"', () => {
      const result = detector.isDomainMatch('chatgpt.com', 'chatgpt.com');
      expect(result.match).toBe(true);
      expect(result.type).toBe('exact');
    });

    test('www prefix is normalized for exact match', () => {
      const result = detector.isDomainMatch('www.chatgpt.com', 'chatgpt.com');
      expect(result.match).toBe(true);
      expect(result.type).toBe('exact');
    });

    test('case insensitive match', () => {
      const result = detector.isDomainMatch('ChatGPT.com', 'chatgpt.com');
      expect(result.match).toBe(true);
      expect(result.type).toBe('exact');
    });

    test('contains match for subdomains', () => {
      const result = detector.isDomainMatch('gemini.google.com', 'google.com');
      expect(result.match).toBe(true);
      expect(result.type).toBe('contains');
    });

    test('no match for unrelated domains', () => {
      const result = detector.isDomainMatch('example.com', 'chatgpt.com');
      expect(result.match).toBe(false);
      expect(result.type).toBe('none');
    });

    test('short domain does not match via contains', () => {
      const result = detector.isDomainMatch('example.com', 'co');
      expect(result.match).toBe(false);
      expect(result.type).toBe('none');
    });

    test('length threshold prevents false positives', () => {
      const result = detector.isDomainMatch('google.com', 'gle');
      expect(result.match).toBe(false);
    });
  });

  describe('performance stats', () => {
    test('initializes with zero stats', () => {
      const stats = detector.getPerformanceStats();
      expect(stats.totalRequests).toBe(0);
      expect(stats.cacheHits).toBe(0);
      expect(stats.cacheMisses).toBe(0);
      expect(stats.cacheHitRate).toBe('0%');
    });

    test('updateAverageResponseTime sets initial value', () => {
      detector.performanceStats.totalRequests = 1;
      detector.updateAverageResponseTime(10);
      expect(detector.performanceStats.averageResponseTime).toBe(10);
    });

    test('updateAverageResponseTime calculates running average', () => {
      detector.performanceStats.totalRequests = 1;
      detector.updateAverageResponseTime(10);
      detector.performanceStats.totalRequests = 2;
      detector.updateAverageResponseTime(20);
      expect(detector.performanceStats.averageResponseTime).toBe(15);
    });

    test('resetPerformanceStats resets all counters', () => {
      detector.performanceStats.totalRequests = 100;
      detector.performanceStats.cacheHits = 80;
      detector.resetPerformanceStats();
      expect(detector.performanceStats.totalRequests).toBe(0);
      expect(detector.performanceStats.cacheHits).toBe(0);
    });
  });

  describe('cache management', () => {
    test('getCacheStatus returns empty state initially', () => {
      const status = detector.getCacheStatus();
      expect(status.hasCache).toBe(false);
      expect(status.isExpired).toBe(true);
    });

    test('clearCache resets all cache state', () => {
      detector.sitesCache = [{ name: 'test' }];
      detector.cacheTimestamp = Date.now();
      detector.domainMappingsCache = { 'test.com': 'Test' };

      detector.clearCache();

      expect(detector.sitesCache).toBeNull();
      expect(detector.domainMappingsCache).toBeNull();
      expect(detector.cacheTimestamp).toBe(0);
    });

    test('getCacheStatus reflects populated cache', () => {
      detector.sitesCache = [{ name: 'test' }];
      detector.cacheTimestamp = Date.now();

      const status = detector.getCacheStatus();
      expect(status.hasCache).toBe(true);
      expect(status.isExpired).toBe(false);
    });
  });

  describe('adjustCacheTimeout', () => {
    test('increases timeout when hit rate is high', () => {
      detector.performanceStats.cacheHits = 90;
      detector.performanceStats.totalRequests = 100;
      const originalTimeout = detector.adaptiveCacheTimeout;
      detector.adjustCacheTimeout();
      expect(detector.adaptiveCacheTimeout).toBeGreaterThan(originalTimeout);
    });

    test('decreases timeout when hit rate is low', () => {
      detector.performanceStats.cacheHits = 10;
      detector.performanceStats.totalRequests = 100;
      const originalTimeout = detector.adaptiveCacheTimeout;
      detector.adjustCacheTimeout();
      expect(detector.adaptiveCacheTimeout).toBeLessThan(originalTimeout);
    });

    test('caps maximum timeout at 30 minutes', () => {
      detector.performanceStats.cacheHits = 99;
      detector.performanceStats.totalRequests = 100;
      detector.adaptiveCacheTimeout = 25 * 60 * 1000;
      detector.adjustCacheTimeout();
      expect(detector.adaptiveCacheTimeout).toBeLessThanOrEqual(30 * 60 * 1000);
    });

    test('caps minimum timeout at 1 minute', () => {
      detector.performanceStats.cacheHits = 1;
      detector.performanceStats.totalRequests = 100;
      detector.adaptiveCacheTimeout = 2 * 60 * 1000;
      detector.adjustCacheTimeout();
      expect(detector.adaptiveCacheTimeout).toBeGreaterThanOrEqual(1 * 60 * 1000);
    });
  });

  describe('getSites with mocked Chrome storage', () => {
    const mockSites = [
      { name: 'ChatGPT', url: 'https://chatgpt.com/', enabled: true },
      { name: 'Gemini', url: 'https://gemini.google.com/', enabled: true },
    ];

    beforeEach(() => {
      detector.clearCache();
      chrome.storage.local.get.mockClear();
      chrome.storage.local.get.mockResolvedValue({
        remoteSiteHandlers: { sites: mockSites },
      });
    });

    test('returns sites from storage', async () => {
      const sites = await detector.getSites();
      expect(sites).toEqual(mockSites);
    });

    test('caches results after first call', async () => {
      await detector.getSites();
      await detector.getSites();
      expect(chrome.storage.local.get).toHaveBeenCalledTimes(1);
    });

    test('increments performance counters', async () => {
      await detector.getSites();
      expect(detector.performanceStats.totalRequests).toBe(1);
      expect(detector.performanceStats.cacheMisses).toBe(1);

      await detector.getSites();
      expect(detector.performanceStats.totalRequests).toBe(2);
      expect(detector.performanceStats.cacheHits).toBe(1);
    });
  });

  describe('findSiteByDomain with mocked storage', () => {
    const mockSites = [
      { name: 'ChatGPT', url: 'https://chatgpt.com/', enabled: true, supportIframe: true },
      { name: 'Gemini', url: 'https://gemini.google.com/', enabled: true, supportIframe: true },
      { name: 'DeepSeek', url: 'https://chat.deepseek.com/', enabled: true, supportIframe: true },
      { name: 'HiddenSite', url: 'https://hidden.example.com/', enabled: false, hidden: true },
    ];

    beforeEach(() => {
      detector.clearCache();
      chrome.storage.local.get.mockResolvedValue({
        remoteSiteHandlers: { sites: mockSites },
      });
    });

    test('finds site by exact domain', async () => {
      const site = await detector.findSiteByDomain('chatgpt.com');
      expect(site).not.toBeNull();
      expect(site.name).toBe('ChatGPT');
      expect(site.matchType).toBe('exact');
    });

    test('finds site by subdomain match', async () => {
      const site = await detector.findSiteByDomain('chat.deepseek.com');
      expect(site).not.toBeNull();
      expect(site.name).toBe('DeepSeek');
    });

    test('returns null for unknown domain', async () => {
      const site = await detector.findSiteByDomain('unknown-site.com');
      expect(site).toBeNull();
    });

    test('skips hidden sites', async () => {
      const site = await detector.findSiteByDomain('hidden.example.com');
      expect(site).toBeNull();
    });
  });

  describe('buildDomainMappings', () => {
    const mockSites = [
      { name: 'ChatGPT', url: 'https://chatgpt.com/', enabled: true },
      { name: 'Gemini', url: 'https://gemini.google.com/', enabled: true },
    ];

    beforeEach(() => {
      detector.clearCache();
      chrome.storage.local.get.mockResolvedValue({
        remoteSiteHandlers: { sites: mockSites },
      });
    });

    test('builds mapping from site URLs', async () => {
      const mappings = await detector.buildDomainMappings();
      expect(mappings['chatgpt.com']).toBe('ChatGPT');
      expect(mappings['gemini.google.com']).toBe('Gemini');
    });

    test('caches domain mappings', async () => {
      await detector.buildDomainMappings();
      const cached = await detector.buildDomainMappings();
      expect(cached).toBeDefined();
      expect(Object.keys(cached).length).toBe(2);
    });
  });

  describe('getSiteHandler', () => {
    const mockSites = [
      {
        name: 'ChatGPT',
        url: 'https://chatgpt.com/',
        enabled: true,
        searchHandler: { steps: [{ action: 'click', selector: '#btn' }] },
        fileUploadHandler: { steps: [{ action: 'paste' }] },
        contentExtractor: { contentSelectors: ['.markdown'] },
      },
    ];

    beforeEach(() => {
      detector.clearCache();
      chrome.storage.local.get.mockResolvedValue({
        remoteSiteHandlers: { sites: mockSites },
      });
    });

    test('returns handler with all fields', async () => {
      const handler = await detector.getSiteHandler('chatgpt.com');
      expect(handler).not.toBeNull();
      expect(handler.name).toBe('ChatGPT');
      expect(handler.searchHandler).toBeDefined();
      expect(handler.fileUploadHandler).toBeDefined();
      expect(handler.contentExtractor).toBeDefined();
    });

    test('returns null for unknown domain', async () => {
      const handler = await detector.getSiteHandler('unknown.com');
      expect(handler).toBeNull();
    });
  });
});
