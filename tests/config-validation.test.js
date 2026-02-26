/**
 * Configuration file validation tests.
 * Validates JSON syntax, schema, and data integrity of all config files.
 */

const fs = require('fs');
const path = require('path');

describe('Configuration Files Validation', () => {
  describe('manifest.json', () => {
    let manifest;

    beforeAll(() => {
      const raw = fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8');
      manifest = JSON.parse(raw);
    });

    test('is valid JSON', () => {
      expect(manifest).toBeDefined();
      expect(typeof manifest).toBe('object');
    });

    test('has manifest_version 3', () => {
      expect(manifest.manifest_version).toBe(3);
    });

    test('has required fields', () => {
      expect(manifest.name).toBeDefined();
      expect(manifest.version).toBeDefined();
      expect(manifest.permissions).toBeDefined();
      expect(manifest.background).toBeDefined();
    });

    test('version matches semver format', () => {
      expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    test('has required permissions', () => {
      const requiredPerms = ['storage', 'activeTab', 'tabs'];
      for (const perm of requiredPerms) {
        expect(manifest.permissions).toContain(perm);
      }
    });

    test('has background service worker', () => {
      expect(manifest.background.service_worker).toBe('background.js');
    });

    test('has content scripts defined', () => {
      expect(manifest.content_scripts).toBeDefined();
      expect(Array.isArray(manifest.content_scripts)).toBe(true);
      expect(manifest.content_scripts.length).toBeGreaterThan(0);
    });

    test('has default_locale', () => {
      expect(manifest.default_locale).toBe('en');
    });

    test('has icons defined', () => {
      expect(manifest.icons).toBeDefined();
      expect(manifest.icons['16']).toBeDefined();
      expect(manifest.icons['48']).toBeDefined();
      expect(manifest.icons['128']).toBeDefined();
    });

    test('icon files exist', () => {
      for (const [, iconPath] of Object.entries(manifest.icons)) {
        const fullPath = path.join(__dirname, '..', iconPath);
        expect(fs.existsSync(fullPath)).toBe(true);
      }
    });

    test('content script files exist', () => {
      for (const cs of manifest.content_scripts) {
        for (const jsFile of cs.js) {
          const fullPath = path.join(__dirname, '..', jsFile);
          expect(fs.existsSync(fullPath)).toBe(true);
        }
        if (cs.css) {
          for (const cssFile of cs.css) {
            const fullPath = path.join(__dirname, '..', cssFile);
            expect(fs.existsSync(fullPath)).toBe(true);
          }
        }
      }
    });

    test('side panel path exists', () => {
      if (manifest.side_panel && manifest.side_panel.default_path) {
        const fullPath = path.join(__dirname, '..', manifest.side_panel.default_path);
        expect(fs.existsSync(fullPath)).toBe(true);
      }
    });

    test('options page exists', () => {
      if (manifest.options_page) {
        const fullPath = path.join(__dirname, '..', manifest.options_page);
        expect(fs.existsSync(fullPath)).toBe(true);
      }
    });
  });

  describe('siteHandlers.json', () => {
    let config;

    beforeAll(() => {
      const raw = fs.readFileSync(
        path.join(__dirname, '..', 'config', 'siteHandlers.json'),
        'utf8'
      );
      config = JSON.parse(raw);
    });

    test('is valid JSON', () => {
      expect(config).toBeDefined();
      expect(typeof config).toBe('object');
    });

    test('has version field', () => {
      expect(config.version).toBeDefined();
      expect(typeof config.version).toBe('string');
    });

    test('has sites array', () => {
      expect(config.sites).toBeDefined();
      expect(Array.isArray(config.sites)).toBe(true);
      expect(config.sites.length).toBeGreaterThan(0);
    });

    test('each site has required fields', () => {
      for (const site of config.sites) {
        expect(site.name).toBeDefined();
        expect(typeof site.name).toBe('string');
        expect(site.name.length).toBeGreaterThan(0);

        expect(site.url).toBeDefined();
        expect(typeof site.url).toBe('string');
        expect(site.url).toMatch(/^https?:\/\//);

        expect(typeof site.enabled).toBe('boolean');
        expect(typeof site.supportIframe).toBe('boolean');
      }
    });

    test('each site has valid region', () => {
      const validRegions = ['US', 'China', 'Global', 'CN'];
      for (const site of config.sites) {
        if (site.region) {
          expect(validRegions).toContain(site.region);
        }
      }
    });

    test('site names are unique', () => {
      const names = config.sites.map((s) => s.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });

    test('site URLs are valid', () => {
      for (const site of config.sites) {
        expect(() => new URL(site.url)).not.toThrow();
      }
    });

    test('searchHandler steps have valid action types', () => {
      const validActions = [
        'click',
        'focus',
        'setValue',
        'triggerEvents',
        'sendKeys',
        'replace',
        'wait',
        'custom',
        'paste',
      ];

      for (const site of config.sites) {
        if (site.searchHandler && site.searchHandler.steps) {
          for (const step of site.searchHandler.steps) {
            expect(validActions).toContain(step.action);
          }
        }
      }
    });

    test('wait steps have positive duration', () => {
      for (const site of config.sites) {
        if (site.searchHandler && site.searchHandler.steps) {
          for (const step of site.searchHandler.steps) {
            if (step.action === 'wait') {
              expect(step.duration).toBeDefined();
              expect(typeof step.duration).toBe('number');
              expect(step.duration).toBeGreaterThan(0);
            }
          }
        }
      }
    });

    test('click/setValue/focus steps have selectors', () => {
      const actionsNeedingSelector = ['click', 'setValue', 'focus', 'triggerEvents', 'sendKeys'];

      for (const site of config.sites) {
        if (site.searchHandler && site.searchHandler.steps) {
          for (const step of site.searchHandler.steps) {
            if (actionsNeedingSelector.includes(step.action)) {
              expect(step.selector).toBeDefined();
            }
          }
        }
      }
    });

    test('has well-known AI sites configured', () => {
      const expectedSites = ['ChatGPT', 'Gemini', 'Grok'];
      const siteNames = config.sites.map((s) => s.name);
      for (const expected of expectedSites) {
        expect(siteNames).toContain(expected);
      }
    });

    test('enabled sites with supportIframe have searchHandler', () => {
      for (const site of config.sites) {
        if (site.enabled && site.supportIframe && !site.hidden) {
          if (!site.supportUrlQuery) {
            expect(site.searchHandler).toBeDefined();
            expect(site.searchHandler.steps).toBeDefined();
            expect(site.searchHandler.steps.length).toBeGreaterThan(0);
          }
        }
      }
    });
  });

  describe('rules.json', () => {
    let rules;

    beforeAll(() => {
      const raw = fs.readFileSync(
        path.join(__dirname, '..', 'config', 'rules.json'),
        'utf8'
      );
      rules = JSON.parse(raw);
    });

    test('is valid JSON', () => {
      expect(rules).toBeDefined();
      expect(Array.isArray(rules)).toBe(true);
    });

    test('each rule has required fields', () => {
      for (const rule of rules) {
        expect(rule.id).toBeDefined();
        expect(typeof rule.id).toBe('number');
        expect(rule.action).toBeDefined();
        expect(rule.condition).toBeDefined();
      }
    });

    test('rule IDs are unique', () => {
      const ids = rules.map((r) => r.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });
  });

  describe('appConfig.json', () => {
    let appConfig;

    beforeAll(() => {
      const raw = fs.readFileSync(
        path.join(__dirname, '..', 'config', 'appConfig.json'),
        'utf8'
      );
      appConfig = JSON.parse(raw);
    });

    test('is valid JSON', () => {
      expect(appConfig).toBeDefined();
      expect(typeof appConfig).toBe('object');
    });

    test('has defaultFavoriteSites', () => {
      expect(appConfig.defaultFavoriteSites).toBeDefined();
      expect(Array.isArray(appConfig.defaultFavoriteSites)).toBe(true);
    });

    test('has buttonConfig', () => {
      expect(appConfig.buttonConfig).toBeDefined();
      expect(typeof appConfig.buttonConfig.floatButton).toBe('boolean');
      expect(typeof appConfig.buttonConfig.selectionSearch).toBe('boolean');
      expect(typeof appConfig.buttonConfig.contextMenu).toBe('boolean');
      expect(typeof appConfig.buttonConfig.searchEngine).toBe('boolean');
    });

    test('has supportedFileTypes with categories', () => {
      expect(appConfig.supportedFileTypes).toBeDefined();
      expect(appConfig.supportedFileTypes.categories).toBeDefined();
      expect(Object.keys(appConfig.supportedFileTypes.categories).length).toBeGreaterThan(0);
    });

    test('each file type category has types array', () => {
      for (const [, category] of Object.entries(appConfig.supportedFileTypes.categories)) {
        expect(category.types).toBeDefined();
        expect(Array.isArray(category.types)).toBe(true);
        expect(category.types.length).toBeGreaterThan(0);
      }
    });

    test('mimeToExtension mappings cover all category types', () => {
      const mappings = appConfig.supportedFileTypes.mimeToExtension.mappings;
      for (const [, category] of Object.entries(appConfig.supportedFileTypes.categories)) {
        for (const type of category.types) {
          expect(mappings[type]).toBeDefined();
        }
      }
    });

    test('has history config', () => {
      expect(appConfig.history).toBeDefined();
      expect(typeof appConfig.history.maxCount).toBe('number');
      expect(appConfig.history.maxCount).toBeGreaterThan(0);
    });
  });

  describe('Locale files', () => {
    test('English locale exists and is valid', () => {
      const raw = fs.readFileSync(
        path.join(__dirname, '..', '_locales', 'en', 'messages.json'),
        'utf8'
      );
      const messages = JSON.parse(raw);
      expect(messages).toBeDefined();
      expect(messages.appName).toBeDefined();
      expect(messages.appName.message).toBeDefined();
    });

    test('Chinese locale exists and is valid', () => {
      const raw = fs.readFileSync(
        path.join(__dirname, '..', '_locales', 'zh_CN', 'messages.json'),
        'utf8'
      );
      const messages = JSON.parse(raw);
      expect(messages).toBeDefined();
      expect(messages.appName).toBeDefined();
      expect(messages.appName.message).toBeDefined();
    });

    test('both locales have the same keys', () => {
      const enRaw = fs.readFileSync(
        path.join(__dirname, '..', '_locales', 'en', 'messages.json'),
        'utf8'
      );
      const zhRaw = fs.readFileSync(
        path.join(__dirname, '..', '_locales', 'zh_CN', 'messages.json'),
        'utf8'
      );
      const enKeys = Object.keys(JSON.parse(enRaw)).sort();
      const zhKeys = Object.keys(JSON.parse(zhRaw)).sort();
      expect(enKeys).toEqual(zhKeys);
    });
  });
});
