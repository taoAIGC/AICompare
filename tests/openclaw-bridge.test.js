const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createIframeNode(siteName) {
  return {
    contentWindow: {},
    getAttribute(name) {
      return name === 'data-site' ? siteName : null;
    }
  };
}

function createDocument({ queryValue, iframes }) {
  const nodesById = new Map();
  const body = {
    children: [],
    appendChild(node) {
      this.children.push(node);
      if (node && node.id) {
        nodesById.set(node.id, node);
      }
      return node;
    }
  };

  const document = {
    body,
    location: {
      href: 'chrome-extension://test/iframe/iframe.html',
      search: ''
    },
    querySelectorAll(selector) {
      if (selector === '.ai-iframe[data-site]') {
        return iframes;
      }
      return [];
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
    getElementById(id) {
      if (id === 'searchInput') {
        return { value: queryValue };
      }
      return nodesById.get(id) || null;
    },
    createElement(tagName) {
      return {
        tagName: String(tagName || '').toUpperCase(),
        id: '',
        style: {},
        dataset: {},
        textContent: '',
        innerHTML: '',
        children: [],
        appendChild(child) {
          this.children.push(child);
          return child;
        },
        querySelector() {
          return null;
        },
        querySelectorAll() {
          return [];
        }
      };
    }
  };

  return { document, nodesById };
}

function loadOpenClawBridge({
  queryValue,
  siteName,
  siteContent,
  siteConfigOverrides = {},
  siteRuntimeUrl = null
}) {
  const iframes = [createIframeNode(siteName)];
  const { document, nodesById } = createDocument({ queryValue, iframes });
  const siteConfig = {
    name: siteName,
    supportIframe: true,
    url: 'https://example.com/chat',
    historyHandler: {
      urlFeature: '/chat'
    },
    openclawRuntime: {},
    ...siteConfigOverrides
  };

  const eventListeners = new Map();
  const windowObject = {
    document,
    location: document.location,
    parent: null,
    self: null,
    window: null,
    addEventListener(type, handler) {
      if (!eventListeners.has(type)) {
        eventListeners.set(type, new Set());
      }
      eventListeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      const listeners = eventListeners.get(type);
      if (listeners) {
        listeners.delete(handler);
      }
    },
    dispatchEvent() {
      return true;
    }
  };

  windowObject.parent = windowObject;
  windowObject.self = windowObject;
  windowObject.window = windowObject;

  const context = {
    console,
    document,
    window: windowObject,
    location: document.location,
    URL,
    URLSearchParams,
    Promise,
    Math,
    Date,
    setTimeout,
    clearTimeout,
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    }
  };

  windowObject.console = console;
  windowObject.URL = URL;
  windowObject.URLSearchParams = URLSearchParams;
  windowObject.Promise = Promise;
  windowObject.Math = Math;
  windowObject.Date = Date;
  windowObject.setTimeout = setTimeout;
  windowObject.clearTimeout = clearTimeout;
  windowObject.CustomEvent = context.CustomEvent;
  windowObject.fetch = async () => ({
    ok: true,
    text: async () => ''
  });
  windowObject.chrome = {
    runtime: {
      sendMessage: async () => ({})
    },
    i18n: {
      getMessage() {
        return '';
      }
    }
  };
  windowObject.AICompareExtraction = {
    getSiteConfigByName: async (name) => (name === siteName ? siteConfig : null),
    looksLikePlaceholderAnswerContent: () => false
  };
  windowObject.aiCompareSiteRuntime = {
    eventName: 'aicompare:site-runtime-update',
    getSnapshot(siteNames) {
      return {
        bySite: Object.fromEntries((siteNames || []).map((name) => [
          name,
          {
            siteName: name,
            content: siteContent,
            url: siteRuntimeUrl || ('https://example.com/chat/' + encodeURIComponent(name)),
            phase: 'ready',
            final: true,
            updatedAt: new Date().toISOString()
          }
        ]))
      };
    }
  };

  context.globalThis = windowObject;

  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '..', 'iframe', 'openclaw-bridge.js'), 'utf8');
  vm.runInContext(source, context);

  return {
    document,
    nodesById,
    window: windowObject
  };
}

test('openclaw waits for the full timeout before returning stabilized results', async () => {
  const siteName = 'Alpha';
  const query = 'hello world';
  const siteContent = 'This is a stable answer that should be preserved until the timeout fires.';
  const bridge = loadOpenClawBridge({
    queryValue: query,
    siteName,
    siteContent
  });

  const startedAt = Date.now();
  const runPromise = bridge.window.aiCompareOpenClaw.run({
    query,
    sites: [siteName],
    timeoutMs: 1000,
    pollIntervalMs: 50,
    minChars: 1,
    stableRounds: 0,
    waitForIframesMs: 0
  });

  await delay(400);
  assert.ok(bridge.window.__OPENCLAW_LAST_RESULT__ == null, 'result should not be finalized early');

  const result = await Promise.race([
    runPromise,
    delay(5000).then(() => {
      throw new Error('openclaw comparison did not finish in time');
    })
  ]);

  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed >= 900, `expected the comparison to wait for timeout, only took ${elapsed}ms`);
  assert.strictEqual(result.phase, 'timed_out');
  assert.strictEqual(result.timedOut, true);
  assert.strictEqual(result.results[0].status, 'ok');
  assert.strictEqual(result.results[0].content, siteContent);
  assert.strictEqual(bridge.window.__OPENCLAW_LAST_RESULT__, result);
  assert.ok(bridge.nodesById.has('openclaw-result-json'));
});

test('openclaw marks Doubao home shell as not submitted when root page tips are still visible', async () => {
  const siteName = '豆包';
  const query = '你好世界';
  const siteContent = [
    'AI 生成可能有误 请核实',
    '有什么我能帮你的吗？',
    '给我一些简单易行的健康饮食建议',
    '制定一份健康早餐食谱'
  ].join('\n');
  const bridge = loadOpenClawBridge({
    queryValue: query,
    siteName,
    siteContent,
    siteRuntimeUrl: 'https://www.doubao.com/chat',
    siteConfigOverrides: {
      url: 'https://www.doubao.com/chat',
      openclawRuntime: {
        landingPage: {
          requireRootLikeUrl: true,
          contentPatterns: [
            '^有什么我能帮你的吗？$',
            '^有什么我能帮你的吗\\?$'
          ]
        },
        notSubmitted: {
          requireRootLikeUrl: true,
          urlPatterns: [
            '^https://(?:www\\.)?doubao\\.com/chat/?$'
          ],
          contentPatterns: [
            '有什么我能帮你的吗',
            '给我一些简单易行的健康饮食建议',
            '制定一份健康早餐食谱'
          ]
        }
      }
    }
  });

  const result = await Promise.race([
    bridge.window.aiCompareOpenClaw.run({
      query,
      sites: [siteName],
      timeoutMs: 200,
      pollIntervalMs: 20,
      minChars: 1,
      stableRounds: 0,
      waitForIframesMs: 0
    }),
    delay(5000).then(() => {
      throw new Error('openclaw Doubao shell classification did not finish in time');
    })
  ]);

  assert.ok(['not_submitted', 'landing_page', 'timeout', 'ok'].includes(result.results[0].status));
  assert.notStrictEqual(result.results[0].status, 'error');
});
