/**
 * 扩展测试工具库
 *
 * 提供Chrome扩展测试所需的实用函数
 */

const path = require('path');
const fs = require('fs');

/**
 * 获取扩展路径
 */
function getExtensionPath() {
  return path.join(__dirname, '..');
}

/**
 * 加载测试fixture数据
 */
function loadFixture(fixtureName) {
  const fixturePath = path.join(__dirname, 'fixtures', fixtureName);
  if (!fs.existsSync(fixturePath)) {
    throw new Error(`Fixture not found: ${fixtureName}`);
  }
  return JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
}

/**
 * 验证扩展文件结构
 */
function validateExtensionStructure(extensionPath) {
  const requiredFiles = [
    'manifest.json',
    'background.js',
    'iframe/iframe.html',
    'options/options.html',
    'homepage/homepage.html'
  ];

  const missingFiles = [];

  for (const file of requiredFiles) {
    const filePath = path.join(extensionPath, file);
    if (!fs.existsSync(filePath)) {
      missingFiles.push(file);
    }
  }

  return {
    valid: missingFiles.length === 0,
    missingFiles
  };
}

/**
 * 创建模拟的chrome API
 */
function createMockChromeAPI() {
  const storage = {
    local: {},
    sync: {}
  };

  return {
    runtime: {
      id: 'mock-extension-id',
      getManifest: () => ({ version: '1.0.0', name: 'AI Compare' }),
      sendMessage: (message, callback) => {
        if (callback) callback({ success: true });
      },
      onMessage: {
        addListener: () => {}
      }
    },
    storage: {
      local: {
        get: (keys) => Promise.resolve(keys ? storage.local[keys] : storage.local),
        set: (data) => {
          Object.assign(storage.local, data);
          return Promise.resolve();
        },
        remove: (keys) => {
          delete storage.local[keys];
          return Promise.resolve();
        },
        clear: () => {
          storage.local = {};
          return Promise.resolve();
        },
        onChanged: {
          addListener: (callback) => {}
        }
      },
      sync: {
        get: (keys) => Promise.resolve(keys ? storage.sync[keys] : storage.sync),
        set: (data) => {
          Object.assign(storage.sync, data);
          return Promise.resolve();
        },
        remove: (keys) => {
          delete storage.sync[keys];
          return Promise.resolve();
        },
        clear: () => {
          storage.sync = {};
          return Promise.resolve();
        },
        onChanged: {
          addListener: (callback) => {}
        }
      }
    },
    tabs: {
      query: (queryInfo) => Promise.resolve([{ id: 1, url: 'about:blank', title: 'Test' }]),
      create: (createProperties) => Promise.resolve({ id: 2, ...createProperties }),
      update: (tabId, updateProperties) => Promise.resolve({ id: tabId, ...updateProperties })
    }
  };
}

/**
 * 模拟AI站点响应
 */
function mockAIResponse(siteId, query) {
  const responses = {
    chatgpt: `这是ChatGPT对"${query}"的回答。ChatGPT是一个由OpenAI开发的大型语言模型。`,
    gemini: `这是Gemini对"${query}"的回答。Gemini是Google开发的AI模型。`,
    grok: `这是Grok对"${query}"的回答。Grok是xAI开发的AI助手。`
  };

  return responses[siteId] || '未知站点的响应';
}

/**
 * 生成随机测试数据
 */
function generateRandomTestData() {
  const sites = ['chatgpt', 'gemini', 'grok', 'claude', '文心一言', '通义千问'];
  const queries = [
    '什么是机器学习？',
    '如何优化代码性能？',
    '解释一下什么是深度学习',
    '写一个Python排序算法',
    '如何学习新技术？'
  ];

  return {
    site: sites[Math.floor(Math.random() * sites.length)],
    query: queries[Math.floor(Math.random() * queries.length)],
    timestamp: Date.now()
  };
}

/**
 * 等待指定时间
 */
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 等待元素出现
 */
async function waitForElement(page, selector, timeout = 5000) {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const element = await page.$(selector);
    if (element) {
      return element;
    }
    await wait(100);
  }

  throw new Error(`Element ${selector} not found within ${timeout}ms`);
}

module.exports = {
  getExtensionPath,
  loadFixture,
  validateExtensionStructure,
  createMockChromeAPI,
  mockAIResponse,
  generateRandomTestData,
  wait,
  waitForElement
};
