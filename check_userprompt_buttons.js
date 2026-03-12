const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitVisible(locator, timeout = 15000) {
  try {
    await locator.first().waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

async function testSite(context, extensionId, site) {
  const page = await context.newPage();
  const testMessage = `自动化按钮测试 ${Date.now()}`;
  const result = {
    site: site.name,
    url: site.url,
    extensionId,
    promptContainersBefore: 0,
    usedHistoryPrompt: false,
    attemptedRealPrompt: false,
    realPromptSent: false,
    injectedMockPrompt: false,
    compareButtonCount: 0,
    favoriteButtonCount: 0,
    compareButtonVisible: false,
    favoriteButtonVisible: false,
    compareClicked: false,
    compareOpened: false,
    compareUrl: '',
    detectedButtonExtensionId: '',
    favoriteClicked: false,
    favoriteModalOpened: false,
    favoriteStateBefore: null,
    favoriteStateAfter: null,
    favoriteStateChanged: false,
    screenshot: ''
  };

  try {
    await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(5000);

    result.promptContainersBefore = await page.locator(site.containerSelector).count();
    result.usedHistoryPrompt = result.promptContainersBefore > 0;

    if (result.promptContainersBefore === 0 && site.inputSelector) {
      result.attemptedRealPrompt = true;
      const input = page.locator(site.inputSelector).first();
      if (await waitVisible(input, 15000)) {
        if (site.inputType === 'contenteditable') {
          await input.click({ timeout: 5000 });
          await input.fill(testMessage);
        } else {
          await input.fill(testMessage);
        }

        if (site.sendSelector) {
          const sendBtn = page.locator(site.sendSelector).first();
          if (await waitVisible(sendBtn, 5000)) {
            await sendBtn.click({ timeout: 5000 });
          } else {
            await page.keyboard.press('Enter');
          }
        } else {
          await page.keyboard.press('Enter');
        }

        try {
          await page.waitForFunction((selector) => {
            return document.querySelectorAll(selector).length > 0;
          }, site.containerSelector, { timeout: 25000 });
          result.realPromptSent = true;
        } catch {
          result.realPromptSent = false;
        }
      }
    }

    if (!result.usedHistoryPrompt && !result.realPromptSent && result.promptContainersBefore === 0) {
      await page.evaluate(site.injectMockPrompt);
      result.injectedMockPrompt = true;
      await page.waitForTimeout(2000);
    }

    const compareBtn = page.locator('.ai-compare-userprompt-btn');
    const favBtn = page.locator('.ai-compare-userprompt-fav-btn');

    result.compareButtonVisible = await waitVisible(compareBtn, 20000);
    result.favoriteButtonVisible = await waitVisible(favBtn, 20000);

    result.compareButtonCount = await compareBtn.count();
    result.favoriteButtonCount = await favBtn.count();
    result.wrapDebug = await page.evaluate(() => {
      const wraps = Array.from(document.querySelectorAll('.ai-compare-userprompt-btn-wrap'));
      return wraps.map((wrap, index) => {
        const rect = wrap.getBoundingClientRect();
        const style = window.getComputedStyle(wrap);
        const compare = wrap.querySelector('.ai-compare-userprompt-btn');
        const fav = wrap.querySelector('.ai-compare-userprompt-fav-btn');
        return {
          index,
          messageKey: wrap.getAttribute('data-message-key') || '',
          compareText: (compare?.textContent || '').replace(/\s+/g, ' ').trim(),
          favText: (fav?.textContent || '').replace(/\s+/g, ' ').trim(),
          visible: style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0',
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        };
      });
    });

    if (result.compareButtonCount > 0) {
      result.detectedButtonExtensionId = await page.evaluate(() => {
        const icon = document.querySelector('.ai-compare-userprompt-btn img');
        if (!icon) return '';
        const src = icon.getAttribute('src') || '';
        const match = src.match(/^chrome-extension:\/\/([^/]+)\//);
        return match ? match[1] : '';
      });

      const popupPromise = context.waitForEvent('page', { timeout: 12000 }).catch(() => null);
      result.compareClicked = await page.evaluate((selector) => {
        const buttons = Array.from(document.querySelectorAll(selector));
        const target = buttons.find((el) => {
          const st = window.getComputedStyle(el);
          return st.display !== 'none' && st.visibility !== 'hidden' && st.opacity !== '0';
        }) || buttons[0];
        if (!target) return false;
        target.click();
        return true;
      }, '.ai-compare-userprompt-btn');

      const popup = await popupPromise;
      if (popup) {
        try {
          await popup.waitForLoadState('domcontentloaded', { timeout: 10000 });
        } catch {}
        result.compareOpened = true;
        result.compareUrl = popup.url();
        await popup.close().catch(() => {});
      }
    }

    if (result.favoriteButtonCount > 0) {
      result.favoriteStateBefore = await page.evaluate(() => {
        const btn = document.querySelector('.ai-compare-userprompt-fav-btn');
        return btn ? btn.getAttribute('data-favorited') : null;
      });

      result.favoriteClicked = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('.ai-compare-userprompt-fav-btn'));
        const target = buttons.find((el) => {
          const st = window.getComputedStyle(el);
          return st.display !== 'none' && st.visibility !== 'hidden' && st.opacity !== '0';
        }) || buttons[0];
        if (!target) return false;
        target.click();
        return true;
      });

      const modal = page.locator('.ai-fav-modal-overlay');
      result.favoriteModalOpened = await waitVisible(modal, 10000);

      if (result.favoriteModalOpened) {
        const saveBtn = page.locator('.ai-fav-modal-save-btn');
        if (await waitVisible(saveBtn, 5000)) {
          await saveBtn.first().click({ timeout: 5000 });
          await page.waitForTimeout(800);
        }
      }

      result.favoriteStateAfter = await page.evaluate(() => {
        const btn = document.querySelector('.ai-compare-userprompt-fav-btn');
        return btn ? btn.getAttribute('data-favorited') : null;
      });
      result.favoriteStateChanged = result.favoriteStateBefore !== result.favoriteStateAfter;
    }
  } catch (error) {
    result.error = String(error && error.stack ? error.stack : error);
  } finally {
    try {
      const screenshotName = `userprompt-buttons-${site.name}-${Date.now()}.png`;
      const screenshotPath = path.join(process.cwd(), screenshotName);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      result.screenshot = screenshotPath;
    } catch {}
    await page.close().catch(() => {});
  }

  return result;
}

(async () => {
  const extensionPath = path.resolve(process.cwd());
  const playwrightUserDataDir = process.env.PLAYWRIGHT_USER_DATA_DIR ||
    path.join(process.cwd(), '.playwright-user-data', 'automation-profile');
  const chromeChannel = process.env.CHROME_CHANNEL || 'chrome';
  const launchArgs = [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    '--no-first-run',
    '--no-default-browser-check'
  ];
  fs.mkdirSync(playwrightUserDataDir, { recursive: true });
  // 固定使用专属 profile 目录，Cookie 和站点登录态会保留在该目录中
  const browser = await chromium.launchPersistentContext(playwrightUserDataDir, {
    channel: chromeChannel === 'chromium' ? undefined : chromeChannel,
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: launchArgs,
    // 仅加载当前项目的扩展，避免和系统 Chrome 默认扩展配置互相影响
    ignoreDefaultArgs: ['--disable-extensions'],
    chromiumSandbox: false
  });

  let extensionId = '';
  try {
    let sw = browser.serviceWorkers()[0];
    if (!sw) {
      sw = await browser.waitForEvent('serviceworker', { timeout: 15000 });
    }
    extensionId = sw ? new URL(sw.url()).host : '';
  } catch {
    extensionId = '';
  }

  const sites = [
    {
      name: 'yuanbao',
      url: 'https://yuanbao.tencent.com/chat/',
      containerSelector: 'div.agent-chat__list__item--human, [class*="agent-dialogue"][class*="human"], [class*="chat-item"][class*="human"]',
      inputSelector: '[contenteditable="true"]',
      inputType: 'contenteditable',
      sendSelector: null,
      injectMockPrompt: () => {
        const root = document.body;
        const block = document.createElement('div');
        block.className = 'agent-chat__list__item--human';
        block.style.cssText = 'position:fixed;top:140px;left:120px;z-index:9996;padding:8px;';

        const text = document.createElement('div');
        text.className = 'agent-chat__bubble--human';
        text.textContent = `自动化测试元宝 user prompt ${Date.now()}`;
        text.style.cssText = 'max-width:520px;padding:10px;border:1px solid #ccc;border-radius:8px;background:#fff;';

        block.appendChild(text);
        root.appendChild(block);
      }
    },
    {
      name: 'qwen',
      url: 'https://chat.qwen.ai/',
      containerSelector: '[data-message-author-role="user"]',
      inputSelector: 'textarea',
      inputType: 'textarea',
      sendSelector: null,
      injectMockPrompt: () => {
        const root = document.body;
        const messageBlock = document.createElement('div');
        messageBlock.setAttribute('data-testid', 'message-block-container');
        messageBlock.setAttribute('data-message-id', `mock-qwen-${Date.now()}`);
        messageBlock.style.cssText = 'position:absolute;top:260px;left:120px;z-index:9996;padding:8px;';

        const block = document.createElement('div');
        block.setAttribute('data-message-author-role', 'user');
        block.style.cssText = 'display:inline-block;';

        const text = document.createElement('div');
        text.textContent = `自动化测试Qwen user prompt ${Date.now()}`;
        text.style.cssText = 'max-width:520px;padding:10px;border:1px solid #ccc;border-radius:8px;background:#fff;';

        block.appendChild(text);
        messageBlock.appendChild(block);
        root.appendChild(messageBlock);
      }
    }
  ];

  const allResults = [];

  for (const site of sites) {
    const siteResult = await testSite(browser, extensionId, site);
    allResults.push(siteResult);
    await sleep(1000);
  }

  const output = {
    ranAt: new Date().toISOString(),
    extensionPath,
    playwrightUserDataDir,
    chromeChannel,
    extensionId,
    results: allResults
  };

  console.log(JSON.stringify(output, null, 2));

  await browser.close();
})();
