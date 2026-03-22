const path = require('path');
const fs = require('fs');

function getRepoRoot() {
  return path.join(__dirname, '..', '..');
}

function getExtensionPath() {
  return getRepoRoot();
}

function getSiteHandlersPath() {
  return path.join(getRepoRoot(), 'config', 'siteHandlers.json');
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function loadFixture(fixtureName) {
  const fixturePath = path.join(getRepoRoot(), 'tests', 'fixtures', fixtureName);
  if (!fs.existsSync(fixturePath)) {
    throw new Error(`Fixture not found: ${fixtureName}`);
  }
  return loadJson(fixturePath);
}

function loadSiteHandlersConfig() {
  return loadJson(getSiteHandlersPath());
}

function getUserPromptConfig(site) {
  return site?.userPrompt || site?.userPromptButton || null;
}

function parseSiteNames(siteNames) {
  if (Array.isArray(siteNames)) {
    return siteNames.map((name) => String(name).trim()).filter(Boolean);
  }

  if (typeof siteNames !== 'string') {
    return [];
  }

  return siteNames
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

function getDirectSiteSmokeTargets(siteNames = process.env.PLAYWRIGHT_EXTENSION_SITE_NAMES || '') {
  const defaultSmokeSites = ['ChatGPT', 'Gemini', 'Qwen', '元宝'];
  const wantedNames = parseSiteNames(siteNames);
  const targetNames = wantedNames.length > 0 ? wantedNames : defaultSmokeSites;
  const config = loadSiteHandlersConfig();
  const sites = (config.sites || []).filter((site) => site.url && getUserPromptConfig(site));
  const siteByName = new Map(sites.map((site) => [site.name, site]));

  return targetNames.map((name) => {
    const site = siteByName.get(name);
    if (!site) {
      throw new Error(`Site not found in siteHandlers.json: ${name}`);
    }
    return site;
  });
}

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
          addListener: () => {}
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
          addListener: () => {}
        }
      }
    },
    tabs: {
      query: () => Promise.resolve([{ id: 1, url: 'about:blank', title: 'Test' }]),
      create: (createProperties) => Promise.resolve({ id: 2, ...createProperties }),
      update: (tabId, updateProperties) => Promise.resolve({ id: tabId, ...updateProperties })
    }
  };
}

function mockAIResponse(siteId, query) {
  const responses = {
    chatgpt: `这是ChatGPT对"${query}"的回答。ChatGPT是一个由OpenAI开发的大型语言模型。`,
    gemini: `这是Gemini对"${query}"的回答。Gemini是Google开发的AI模型。`,
    grok: `这是Grok对"${query}"的回答。Grok是xAI开发的AI助手。`
  };

  return responses[siteId] || '未知站点的响应';
}

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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

async function waitForVisible(locator, timeout = 15000) {
  try {
    await locator.first().waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

async function getVisibleCount(page, selector) {
  try {
    return await page.evaluate((targetSelector) => {
      const isVisible = (element) => {
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
          return false;
        }
        const rect = element.getBoundingClientRect();
        return rect.width > 2 && rect.height > 2;
      };

      return Array.from(document.querySelectorAll(targetSelector)).filter(isVisible).length;
    }, selector);
  } catch {
    return 0;
  }
}

function getFirstSelector(selectorText) {
  if (!selectorText) return '';
  return selectorText
    .split(',')
    .map((selector) => selector.trim())
    .filter(Boolean)[0] || '';
}

function getRenderableSelector(selectorText) {
  const firstSelector = getFirstSelector(selectorText);
  if (!firstSelector) return 'div';

  return firstSelector
    .replace(/:has\([^)]*\)/g, '')
    .replace(/::?[a-zA-Z-]+\([^)]*\)/g, '')
    .replace(/::?[a-zA-Z-]+/g, '')
    .trim()
    .split(/\s*[>+~ ]\s*/)
    .filter(Boolean)
    .pop() || 'div';
}

function sanitizePathSegment(value) {
  return String(value || 'value')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120) || 'value';
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

async function copyDirectory(sourceDir, targetDir) {
  ensureDirectory(path.dirname(targetDir));
  await fs.promises.rm(targetDir, { recursive: true, force: true });

  if (sourceDir && fs.existsSync(sourceDir)) {
    await fs.promises.cp(sourceDir, targetDir, { recursive: true });
  } else {
    await fs.promises.mkdir(targetDir, { recursive: true });
  }

  return targetDir;
}

async function removeDirectory(targetDir) {
  await fs.promises.rm(targetDir, { recursive: true, force: true });
}

async function readVisiblePromptText(page, config, pick = 'last') {
  return page.evaluate(({ config: promptConfig, pickMode }) => {
    const selector = promptConfig?.containerSelector || promptConfig?.textSelector;
    if (!selector) return '';

    const isVisible = (element) => {
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 2 && rect.height > 2;
    };

    const rawNodes = Array.from(document.querySelectorAll(selector));
    const containers = rawNodes.filter((node) => !rawNodes.some((other) => other !== node && other.contains(node)));
    const visibleContainers = containers.filter(isVisible);
    const target = pickMode === 'first'
      ? visibleContainers[0] || containers[0]
      : visibleContainers[visibleContainers.length - 1] || containers[containers.length - 1];

    if (!target) return '';

    const textNode = promptConfig?.containerSelector && promptConfig?.textSelector
      ? target.querySelector(promptConfig.textSelector)
      : target;

    return ((textNode || target).textContent || '').replace(/\s+/g, ' ').trim();
  }, { config, pickMode: pick });
}

async function injectMockUserPrompt(page, site, config, promptText) {
  const containerSelector = getRenderableSelector(config?.containerSelector || config?.textSelector || 'div');
  const textSelector = getRenderableSelector(config?.textSelector || '');

  return page.evaluate(({ host, text, containerSelector: resolvedContainerSelector, textSelector: resolvedTextSelector }) => {
    function createFromSelector(selector) {
      if (!selector) return document.createElement('div');

      const tagMatch = selector.match(/^[a-zA-Z][\w-]*/);
      const element = document.createElement(tagMatch ? tagMatch[0] : 'div');

      const classMatches = [...selector.matchAll(/\.([a-zA-Z0-9_-]+)/g)].map((match) => match[1]);
      if (classMatches.length > 0) {
        element.className = Array.from(new Set(classMatches)).join(' ');
      }

      const attributePatterns = [
        /\[([^\]=~^*$\s]+)\s*=\s*"([^"]*)"\]/g,
        /\[([^\]=~^*$\s]+)\s*=\s*'([^']*)'\]/g
      ];

      for (const pattern of attributePatterns) {
        for (const match of selector.matchAll(pattern)) {
          element.setAttribute(match[1], match[2]);
        }
      }

      for (const match of selector.matchAll(/\[id\^=\"([^\"]+)\"\]/g)) {
        const prefix = (match[1] || 'mock').replace(/[^a-zA-Z0-9_-]/g, '');
        element.id = `${prefix || 'mock'}-${Date.now()}`;
      }

      for (const match of selector.matchAll(/\[id\^='([^']+)'\]/g)) {
        const prefix = (match[1] || 'mock').replace(/[^a-zA-Z0-9_-]/g, '');
        element.id = `${prefix || 'mock'}-${Date.now()}`;
      }

      for (const match of selector.matchAll(/\[class\*=\"([^\"]+)\"\]/g)) {
        const partialClass = (match[1] || '').replace(/[^a-zA-Z0-9_-]/g, '-');
        if (partialClass) {
          element.classList.add(partialClass);
        }
      }

      for (const match of selector.matchAll(/\[class\*='([^']+)'\]/g)) {
        const partialClass = (match[1] || '').replace(/[^a-zA-Z0-9_-]/g, '-');
        if (partialClass) {
          element.classList.add(partialClass);
        }
      }

      return element;
    }

    const body = document.body;
    if (!body) {
      return { injected: false, reason: 'missing-body' };
    }

    if (host.includes('chat.qwen.ai')) {
      const block = document.createElement('div');
      block.setAttribute('data-testid', 'message-block-container');
      block.setAttribute('data-message-id', `mock-qwen-${Date.now()}`);
      block.style.cssText = 'position:absolute;top:260px;left:120px;z-index:9996;padding:8px;';

      const container = document.createElement('div');
      container.setAttribute('data-message-author-role', 'user');
      container.style.cssText = 'display:inline-block;';

      const textNode = document.createElement('div');
      textNode.textContent = text;
      textNode.style.cssText = 'max-width:520px;padding:10px;border:1px solid #ccc;border-radius:8px;background:#fff;';

      container.appendChild(textNode);
      block.appendChild(container);
      body.appendChild(block);
      return { injected: true, reason: 'qwen-special' };
    }

    if (host.includes('yuanbao.tencent.com')) {
      const block = document.createElement('div');
      block.className = 'agent-chat__list__item--human';
      block.style.cssText = 'position:absolute;top:140px;left:120px;z-index:9996;padding:8px;';

      const textNode = document.createElement('div');
      textNode.className = 'agent-chat__bubble--human';
      textNode.textContent = text;
      textNode.style.cssText = 'max-width:520px;padding:10px;border:1px solid #ccc;border-radius:8px;background:#fff;';

      block.appendChild(textNode);
      body.appendChild(block);
      return { injected: true, reason: 'yuanbao-special' };
    }

    const container = createFromSelector(resolvedContainerSelector);
    container.style.cssText += ';position:absolute;top:180px;left:120px;z-index:9996;padding:8px;';

    if (resolvedTextSelector && resolvedTextSelector !== resolvedContainerSelector) {
      const textNode = createFromSelector(resolvedTextSelector);
      textNode.textContent = text;
      textNode.style.cssText += ';max-width:520px;padding:10px;border:1px solid #ccc;border-radius:8px;background:#fff;display:block;';
      container.appendChild(textNode);
    } else {
      container.textContent = text;
      container.style.cssText += ';max-width:520px;padding:10px;border:1px solid #ccc;border-radius:8px;background:#fff;display:block;';
    }

    if (!(container.textContent || '').trim()) {
      container.textContent = text;
    }

    body.appendChild(container);
    return {
      injected: true,
      reason: 'generic',
      containerSelector: resolvedContainerSelector,
      textSelector: resolvedTextSelector
    };
  }, {
    host: new URL(site.url).hostname,
    text: promptText,
    containerSelector,
    textSelector
  });
}

async function getVisibleElementAttribute(page, selector, attributeName, pick = 'last') {
  return page.evaluate(({ selector: targetSelector, attributeName: targetAttribute, pickMode }) => {
    const isVisible = (element) => {
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 2 && rect.height > 2;
    };

    const nodes = Array.from(document.querySelectorAll(targetSelector)).filter(isVisible);
    const target = pickMode === 'first' ? nodes[0] : nodes[nodes.length - 1];
    return target ? target.getAttribute(targetAttribute) : null;
  }, { selector, attributeName, pickMode: pick });
}

async function clickVisibleElement(page, selector, pick = 'last') {
  return page.evaluate(({ selector: targetSelector, pickMode }) => {
    const isVisible = (element) => {
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 2 && rect.height > 2;
    };

    const nodes = Array.from(document.querySelectorAll(targetSelector)).filter(isVisible);
    const target = pickMode === 'first' ? nodes[0] : nodes[nodes.length - 1];
    if (!target) {
      return false;
    }

    target.click();
    return true;
  }, { selector, pickMode: pick });
}

async function collectPromptButtonDiagnostics(page) {
  const compareButtonCount = await page.locator('.ai-compare-userprompt-btn').count();
  const favoriteButtonCount = await page.locator('.ai-compare-userprompt-fav-btn').count();

  return {
    pageUrl: page.url(),
    compareButtonCount,
    favoriteButtonCount,
    compareVisibleCount: await getVisibleCount(page, '.ai-compare-userprompt-btn'),
    favoriteVisibleCount: await getVisibleCount(page, '.ai-compare-userprompt-fav-btn'),
    wrapVisibleCount: await getVisibleCount(page, '.ai-compare-userprompt-btn-wrap'),
    detectedButtonExtensionId: await page.evaluate(() => {
      const isVisible = (element) => {
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
          return false;
        }
        const rect = element.getBoundingClientRect();
        return rect.width > 2 && rect.height > 2;
      };

      const compareButton = Array.from(document.querySelectorAll('.ai-compare-userprompt-btn')).filter(isVisible).pop();
      const icon = compareButton ? compareButton.querySelector('img') : null;
      const src = icon ? icon.getAttribute('src') || '' : '';
      const match = src.match(/^chrome-extension:\/\/([^/]+)\//);
      return match ? match[1] : '';
    }),
    wrapDebug: await page.evaluate(() => {
      const isVisible = (element) => {
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
          return false;
        }
        const rect = element.getBoundingClientRect();
        return rect.width > 2 && rect.height > 2;
      };

      return Array.from(document.querySelectorAll('.ai-compare-userprompt-btn-wrap')).map((wrap, index) => {
        const rect = wrap.getBoundingClientRect();
        const compare = wrap.querySelector('.ai-compare-userprompt-btn');
        const favorite = wrap.querySelector('.ai-compare-userprompt-fav-btn');

        return {
          index,
          messageKey: wrap.getAttribute('data-message-key') || '',
          visible: isVisible(wrap),
          compareText: (compare?.textContent || '').replace(/\s+/g, ' ').trim(),
          favoriteText: (favorite?.textContent || '').replace(/\s+/g, ' ').trim(),
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        };
      });
    })
  };
}

module.exports = {
  getRepoRoot,
  getExtensionPath,
  getSiteHandlersPath,
  loadFixture,
  loadSiteHandlersConfig,
  getUserPromptConfig,
  getDirectSiteSmokeTargets,
  validateExtensionStructure,
  createMockChromeAPI,
  mockAIResponse,
  generateRandomTestData,
  wait,
  waitForElement,
  waitForVisible,
  getVisibleCount,
  getFirstSelector,
  getRenderableSelector,
  sanitizePathSegment,
  ensureDirectory,
  copyDirectory,
  removeDirectory,
  readVisiblePromptText,
  injectMockUserPrompt,
  getVisibleElementAttribute,
  clickVisibleElement,
  collectPromptButtonDiagnostics
};
