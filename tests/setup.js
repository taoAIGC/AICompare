/**
 * AI Compare Chrome Extension - Playwright Test Suite
 *
 * 测试架构说明：
 * 1. Unit Tests: 测试配置解析、工具函数等
 * 2. Integration Tests: 测试Chrome Storage、消息通信等
 * 3. E2E Tests: 测试用户完整操作流程
 * 4. UI Tests: 测试各页面的UI渲染和交互
 *
 * 运行命令：
 *   npm test           // 运行所有测试
 *   npm run test:unit  // 运行单元测试
 *   npm run test:e2e   // 运行E2E测试
 *   npm run test:ui    // 运行UI测试
 *   npm run test:report // 生成测试报告
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// 配置常量
const EXTENSION_PATH = path.join(__dirname, '..');
const TEST_DATA_PATH = path.join(__dirname, 'fixtures');
const REPORT_PATH = path.join(__dirname, 'reports');
const PERSISTENT_PROFILE_DIR = process.env.PLAYWRIGHT_USER_DATA_DIR ||
  path.join(EXTENSION_PATH, '.playwright-user-data', 'automation-profile');

// 测试配置
const TEST_CONFIG = {
  headless: process.env.CI === 'true',
  timeout: 30000,
  viewport: { width: 1280, height: 800 },
  permissions: ['storage', 'clipboardRead', 'contextMenus'],
  launchOptions: {
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      // 禁用CSP以支持测试环境
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process'
    ]
  }
};

/**
 * 扩展上下文工具类
 */
class ExtensionContext {
  constructor() {
    this.browser = null;
    this.context = null;
    this.extensionId = null;
    this.pages = {};
  }

  /**
   * 初始化浏览器和扩展
   */
  async init() {
    this.browser = await chromium.launch(TEST_CONFIG);
    this.context = await this.browser.newContext(TEST_CONFIG);

    // 加载扩展
    const extensionPath = path.join(EXTENSION_PATH);
    this.extensionId = await this.loadExtension(extensionPath);

    return this;
  }

  /**
   * 加载扩展并获取ID
   */
  async loadExtension(extensionPath) {
    const extPath = path.join(extensionPath);
    fs.mkdirSync(PERSISTENT_PROFILE_DIR, { recursive: true });
    const context = await chromium.launchPersistentContext(PERSISTENT_PROFILE_DIR, {
      headless: TEST_CONFIG.headless,
      ignoreDefaultArgs: ['--disable-extensions'],
      args: [
        ...TEST_CONFIG.launchOptions.args,
        `--disable-extensions-except=${extPath}`,
        `--load-extension=${extPath}`
      ]
    });

    // 获取扩展页面
    const extPage = await context.newPage();
    await extPage.goto(`chrome-extension://${this.getExtensionIdFromPath(extPath)}/`);

    return this.getExtensionIdFromPath(extPath);
  }

  /**
   * 从路径获取扩展ID
   */
  getExtensionIdFromPath(extensionPath) {
    // 实际测试时动态获取
    return 'temporary-extension-id';
  }

  /**
   * 打开侧边栏
   */
  async openSidePanel() {
    const page = await this.context.newPage();
    await page.goto(`chrome-extension://${this.extensionId}/iframe/iframe.html`);
    this.pages.sidePanel = page;
    return page;
  }

  /**
   * 打开选项页面
   */
  async openOptionsPage() {
    const page = await this.context.newPage();
    await page.goto(`chrome-extension://${this.extensionId}/options/options.html`);
    this.pages.options = page;
    return page;
  }

  /**
   * 打开首页
   */
  async openHomepage() {
    const page = await this.context.newPage();
    await page.goto(`chrome-extension://${this.extensionId}/homepage/homepage.html`);
    this.pages.homepage = page;
    return page;
  }

  /**
   * 打开历史记录页面
   */
  async openHistoryPage() {
    const page = await this.context.newPage();
    await page.goto(`chrome-extension://${this.extensionId}/history/history.html`);
    this.pages.history = page;
    return page;
  }

  /**
   * 打开收藏页面
   */
  async openFavoritesPage() {
    const page = await this.context.newPage();
    await page.goto(`chrome-extension://${this.extensionId}/favorites/favorites.html`);
    this.pages.favorites = page;
    return page;
  }

  /**
   * 清理资源
   */
  async cleanup() {
    if (this.pages.sidePanel) await this.pages.sidePanel.close();
    if (this.pages.options) await this.pages.options.close();
    if (this.pages.homepage) await this.pages.homepage.close();
    if (this.pages.history) await this.pages.history.close();
    if (this.pages.favorites) await this.pages.favorites.close();
    if (this.context) await this.context.close();
    if (this.browser) await this.browser.close();
  }
}

// 工具函数
const utils = {
  /**
   * 等待元素出现
   */
  async waitForSelector(page, selector, timeout = 5000) {
    await page.waitForSelector(selector, { timeout, state: 'attached' });
  },

  /**
   * 点击并等待
   */
  async clickAndWait(page, selector, waitForSelector = null) {
    await page.click(selector);
    if (waitForSelector) {
      await this.waitForSelector(page, waitForSelector);
    }
  },

  /**
   * 填写表单
   */
  async fillForm(page, data) {
    for (const [selector, value] of Object.entries(data)) {
      await page.fill(selector, value);
    }
  },

  /**
   * 模拟发送消息
   */
  async sendMessage(page, message) {
    return await page.evaluate((msg) => {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage(msg, resolve);
      });
    }, message);
  },

  /**
   * 等待存储数据
   */
  async waitForStorage(keys, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const check = async () => {
        const result = await chrome.storage.local.get(keys);
        if (keys.every(key => result[key] !== undefined)) {
          resolve(result);
        } else {
          setTimeout(check, 100);
        }
      };
      setTimeout(() => reject(new Error('Storage wait timeout')), timeout);
      check();
    });
  },

  /**
   * 清除所有存储数据
   */
  async clearStorage() {
    await chrome.storage.local.clear();
    await chrome.storage.sync.clear();
  },

  /**
   * 设置存储数据
   */
  async setStorage(data) {
    return await chrome.storage.local.set(data);
  },

  /**
   * 生成测试数据
   */
  generateTestData() {
    return {
      sites: [
        { id: 'chatgpt', name: 'ChatGPT', enabled: true },
        { id: 'gemini', name: 'Gemini', enabled: true },
        { id: 'grok', name: 'Grok', enabled: false }
      ],
      history: [
        { id: '1', query: '什么是AI？', timestamp: Date.now(), responses: [] },
        { id: '2', query: '如何学习编程？', timestamp: Date.now(), responses: [] }
      ],
      favorites: [
        { id: '1', query: '常用提示词', folderId: null },
        { id: '2', query: '代码生成', folderId: 'folder1' }
      ]
    };
  },

  /**
   * 模拟AI站点响应
   */
  mockAIResponse(page, siteId, response) {
    return page.evaluate(({ siteId, response }) => {
      // 模拟AI站点回答
      window.mockResponses = window.mockResponses || {};
      window.mockResponses[siteId] = response;
    }, { siteId, response });
  }
};

// 测试基类
class BaseTest {
  constructor() {
    this.ctx = null;
    this.currentPage = null;
  }

  async setup() {
    this.ctx = new ExtensionContext();
    await this.ctx.init();
  }

  async teardown() {
    await this.ctx.cleanup();
  }
}

module.exports = {
  TEST_CONFIG,
  ExtensionContext,
  BaseTest,
  utils
};
