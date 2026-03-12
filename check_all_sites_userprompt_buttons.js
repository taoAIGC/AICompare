const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitVisible(locator, timeout = 10000) {
  try {
    await locator.first().waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

async function getVisibleCount(page, selector) {
  try {
    return await page.evaluate((sel) => {
      const nodes = Array.from(document.querySelectorAll(sel));
      return nodes.filter((el) => {
        const st = window.getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return false;
        const r = el.getBoundingClientRect();
        return r.width > 2 && r.height > 2;
      }).length;
    }, selector);
  } catch {
    return 0;
  }
}

function getUserPromptConfig(site) {
  return site.userPrompt || site.userPromptButton || null;
}

async function injectMockPrompt(page, site, config) {
  const message = `自动化全站按钮测试 ${Date.now()}`;
  return await page.evaluate(({ message, config, host }) => {
    function firstSelector(selectorText) {
      if (!selectorText) return '';
      return selectorText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)[0] || '';
    }

    function createFromSelector(selector) {
      if (!selector) return document.createElement('div');
      const cleaned = selector.replace(/:has\([^)]*\)/g, '').trim();
      const tagMatch = cleaned.match(/^[a-zA-Z][\w-]*/);
      const tag = tagMatch ? tagMatch[0] : 'div';
      const el = document.createElement(tag);

      const classMatches = [...cleaned.matchAll(/\.([a-zA-Z0-9_-]+)/g)].map((m) => m[1]);
      if (classMatches.length) {
        el.className = Array.from(new Set(classMatches)).join(' ');
      }

      const eqAttrPatterns = [
        /\[([^\]=~^*$\s]+)\s*=\s*"([^"]*)"\]/g,
        /\[([^\]=~^*$\s]+)\s*=\s*'([^']*)'\]/g
      ];
      for (const pattern of eqAttrPatterns) {
        for (const m of cleaned.matchAll(pattern)) {
          const attr = m[1];
          const val = m[2];
          if (attr && val != null) {
            el.setAttribute(attr, val);
          }
        }
      }

      for (const m of cleaned.matchAll(/\[id\^=\"([^\"]+)\"\]/g)) {
        const prefix = (m[1] || 'mock').replace(/[^a-zA-Z0-9_-]/g, '');
        el.id = `${prefix || 'mock'}-${Date.now()}`;
      }
      for (const m of cleaned.matchAll(/\[id\^='([^']+)'\]/g)) {
        const prefix = (m[1] || 'mock').replace(/[^a-zA-Z0-9_-]/g, '');
        el.id = `${prefix || 'mock'}-${Date.now()}`;
      }

      for (const m of cleaned.matchAll(/\[class\*=\"([^\"]+)\"\]/g)) {
        const c = (m[1] || '').replace(/[^a-zA-Z0-9_-]/g, '-');
        if (c) el.classList.add(c);
      }
      for (const m of cleaned.matchAll(/\[class\*='([^']+)'\]/g)) {
        const c = (m[1] || '').replace(/[^a-zA-Z0-9_-]/g, '-');
        if (c) el.classList.add(c);
      }

      return el;
    }

    const body = document.body;
    if (!body) return { injected: false, reason: 'no-body' };

    let container;
    if (host.includes('chat.qwen.ai')) {
      const block = document.createElement('div');
      block.setAttribute('data-testid', 'message-block-container');
      block.setAttribute('data-message-id', `mock-qwen-${Date.now()}`);
      block.style.cssText = 'position:absolute;top:260px;left:120px;z-index:9996;padding:8px;';
      container = document.createElement('div');
      container.setAttribute('data-message-author-role', 'user');
      container.style.cssText = 'display:inline-block;';
      const text = document.createElement('div');
      text.textContent = message;
      text.style.cssText = 'max-width:520px;padding:10px;border:1px solid #ccc;border-radius:8px;background:#fff;';
      container.appendChild(text);
      block.appendChild(container);
      body.appendChild(block);
      return { injected: true, reason: 'qwen-special' };
    }

    if (host.includes('yuanbao.tencent.com')) {
      const block = document.createElement('div');
      block.className = 'agent-chat__list__item--human';
      block.style.cssText = 'position:absolute;top:140px;left:120px;z-index:9996;padding:8px;';
      const text = document.createElement('div');
      text.className = 'agent-chat__bubble--human';
      text.textContent = message;
      text.style.cssText = 'max-width:520px;padding:10px;border:1px solid #ccc;border-radius:8px;background:#fff;';
      block.appendChild(text);
      body.appendChild(block);
      return { injected: true, reason: 'yuanbao-special' };
    }

    const firstContainerSelector = firstSelector(config?.containerSelector || config?.textSelector || 'div');
    container = createFromSelector(firstContainerSelector);
    container.style.cssText += ';position:absolute;top:180px;left:120px;z-index:9996;padding:8px;';

    const textSelector = firstSelector(config?.textSelector || '');
    if (textSelector && textSelector !== firstContainerSelector) {
      const textNode = createFromSelector(textSelector);
      textNode.textContent = message;
      container.appendChild(textNode);
    } else {
      container.textContent = message;
    }

    if (!(container.textContent || '').trim()) {
      container.textContent = message;
    }

    body.appendChild(container);
    return { injected: true, reason: 'generic', selector: firstContainerSelector };
  }, { message, config, host: new URL(site.url).hostname });
}

async function testOneSite(context, extensionId, site, idx, total) {
  const config = getUserPromptConfig(site);
  const result = {
    index: idx + 1,
    total,
    site: site.name,
    url: site.url,
    hidden: !!site.hidden,
    enabled: site.enabled !== false,
    hasConfig: !!config,
    containerSelector: config?.containerSelector || '',
    textSelector: config?.textSelector || '',
    pageOpened: false,
    promptContainersBefore: 0,
    injectedMockPrompt: false,
    injectReason: '',
    compareButtonCount: 0,
    favoriteButtonCount: 0,
    compareVisibleCount: 0,
    favoriteVisibleCount: 0,
    compareOpened: false,
    favoriteModalOpened: false,
    screenshot: '',
    error: ''
  };

  let page;
  try {
    page = await context.newPage();
    await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    result.pageOpened = true;
    await page.waitForTimeout(7000);

    if (config?.containerSelector) {
      try {
        result.promptContainersBefore = await page.locator(config.containerSelector).count();
      } catch {
        result.promptContainersBefore = 0;
      }
    }

    if (result.promptContainersBefore === 0) {
      const injectRet = await injectMockPrompt(page, site, config || {});
      result.injectedMockPrompt = !!injectRet?.injected;
      result.injectReason = injectRet?.reason || '';
      await page.waitForTimeout(3000);
    }

    const compare = page.locator('.ai-compare-userprompt-btn');
    const favorite = page.locator('.ai-compare-userprompt-fav-btn');

    await waitVisible(compare, 10000);
    await waitVisible(favorite, 10000);

    result.compareButtonCount = await compare.count();
    result.favoriteButtonCount = await favorite.count();
    result.compareVisibleCount = await getVisibleCount(page, '.ai-compare-userprompt-btn');
    result.favoriteVisibleCount = await getVisibleCount(page, '.ai-compare-userprompt-fav-btn');

    if (result.compareButtonCount > 0) {
      const popupPromise = context.waitForEvent('page', { timeout: 5000 }).catch(() => null);
      await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('.ai-compare-userprompt-btn')).find((el) => {
          const st = getComputedStyle(el);
          if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return false;
          const r = el.getBoundingClientRect();
          return r.width > 2 && r.height > 2;
        }) || document.querySelector('.ai-compare-userprompt-btn');
        if (btn) btn.click();
      });
      const popup = await popupPromise;
      if (popup) {
        result.compareOpened = true;
        await popup.close().catch(() => {});
      }
    }

    if (result.favoriteButtonCount > 0) {
      await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('.ai-compare-userprompt-fav-btn')).find((el) => {
          const st = getComputedStyle(el);
          if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return false;
          const r = el.getBoundingClientRect();
          return r.width > 2 && r.height > 2;
        }) || document.querySelector('.ai-compare-userprompt-fav-btn');
        if (btn) btn.click();
      });
      const modal = page.locator('.ai-fav-modal-overlay');
      result.favoriteModalOpened = await waitVisible(modal, 5000);
    }
  } catch (error) {
    result.error = String(error && error.message ? error.message : error);
  } finally {
    if (page) {
      try {
        const shot = `all-sites-userprompt-${idx + 1}-${Date.now()}.png`;
        const shotPath = path.join(process.cwd(), shot);
        await page.screenshot({ path: shotPath, fullPage: true });
        result.screenshot = shotPath;
      } catch {}
      await page.close().catch(() => {});
    }
  }

  return result;
}

(async () => {
  const root = process.cwd();
  const extensionPath = path.resolve(root);
  const configPath = path.join(root, 'config', 'siteHandlers.json');
  const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const allSites = (configData.sites || [])
    .filter((s) => s.url && getUserPromptConfig(s))
    .map((s) => ({
      name: s.name,
      url: s.url,
      hidden: !!s.hidden,
      enabled: s.enabled !== false,
      userPrompt: s.userPrompt || s.userPromptButton
    }));

  const playwrightUserDataDir = process.env.PLAYWRIGHT_USER_DATA_DIR ||
    path.join(root, '.playwright-user-data', 'automation-profile');
  const chromeChannel = process.env.CHROME_CHANNEL || 'chromium';
  fs.mkdirSync(playwrightUserDataDir, { recursive: true });

  const browser = await chromium.launchPersistentContext(playwrightUserDataDir, {
    channel: chromeChannel === 'chromium' ? undefined : chromeChannel,
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-first-run',
      '--no-default-browser-check'
    ],
    ignoreDefaultArgs: ['--disable-extensions'],
    chromiumSandbox: false
  });

  let extensionId = '';
  try {
    let sw = browser.serviceWorkers()[0];
    if (!sw) sw = await browser.waitForEvent('serviceworker', { timeout: 15000 });
    extensionId = sw ? new URL(sw.url()).host : '';
  } catch {
    extensionId = '';
  }

  const results = [];
  for (let i = 0; i < allSites.length; i++) {
    const one = await testOneSite(browser, extensionId, allSites[i], i, allSites.length);
    results.push(one);
    await sleep(800);
  }

  const summary = {
    total: results.length,
    opened: results.filter((r) => r.pageOpened).length,
    withButtons: results.filter((r) => r.compareButtonCount > 0 && r.favoriteButtonCount > 0).length,
    compareClickable: results.filter((r) => r.compareOpened).length,
    favoriteClickable: results.filter((r) => r.favoriteModalOpened).length,
    hasError: results.filter((r) => r.error).length
  };

  const output = {
    ranAt: new Date().toISOString(),
    extensionPath,
    playwrightUserDataDir,
    chromeChannel,
    extensionId,
    summary,
    results
  };

  console.log(JSON.stringify(output, null, 2));
  await browser.close();
})();
