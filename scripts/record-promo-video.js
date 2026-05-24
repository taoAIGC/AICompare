const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'generated', 'promo');
const PROFILE_DIR = path.join(ROOT, '.tmp-promo-profile');
const EXTENSION_PATH = ROOT;

const DEMO_QUERY = '一个标签同时对比多个AI，哪家回答最好？';
const PROMO_SCRIPT = [
  { t: 0.0, line: '还在把同一个问题复制给一个又一个 AI 吗？' },
  { t: 2.6, line: 'AI Compare 让你在一个标签页里，同时打开多个 AI。' },
  { t: 6.2, line: '输入一次问题，ChatGPT、Claude、Gemini 并排给你答案。' },
  { t: 10.8, line: '不用来回切网页，不用手动复制粘贴。' },
  { t: 14.2, line: '谁回答更清楚，谁更适合当前任务，一眼就能看出来。' },
  { t: 18.8, line: '这就是 AI Compare，把多 AI 对比变成一个动作。' }
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findExtensionId(context) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const worker = context.serviceWorkers()[0];
    if (worker) {
      const match = worker.url().match(/chrome-extension:\/\/([a-z]{32})\//);
      if (match) return match[1];
    }
    await sleep(500);
  }
  throw new Error('Extension service worker not found');
}

async function waitForStableUi(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => {
    const body = document.body;
    return Boolean(body && body.innerText && body.innerText.includes('PK'));
  }, { timeout: 15000 });
}

async function recordPromo() {
  ensureDir(OUTPUT_DIR);
  fs.rmSync(PROFILE_DIR, { recursive: true, force: true });

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1440, height: 900 },
    recordVideo: {
      dir: OUTPUT_DIR,
      size: { width: 1440, height: 900 }
    },
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`
    ]
  });

  try {
    const extensionId = await findExtensionId(context);
    const page = context.pages()[0] || await context.newPage();

    await page.goto(`chrome-extension://${extensionId}/homepage/homepage.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    await waitForStableUi(page);
    await page.waitForTimeout(1200);

    await page.locator('#searchInput').fill(DEMO_QUERY);
    await page.waitForTimeout(800);

    for (const siteName of ['ChatGPT', 'Claude', 'Gemini']) {
      const siteItem = page.locator('#sitesList .site-item', {
        hasText: siteName
      }).first();
      await siteItem.scrollIntoViewIfNeeded().catch(() => {});
      const checkbox = siteItem.locator('input[type="checkbox"]').first();
      if (!(await checkbox.isChecked().catch(() => false))) {
        await checkbox.click({ force: true });
        await page.waitForTimeout(350);
      }
    }

    await page.waitForTimeout(600);
    await page.locator('#searchButton').click();
    await page.waitForTimeout(4000);

    const targetUrl = `chrome-extension://${extensionId}/iframe/iframe.html?sites=ChatGPT,Claude,Gemini&type=information&query=${encodeURIComponent(DEMO_QUERY)}`;
    if (!page.url().includes('/iframe/iframe.html')) {
      await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });
      await page.waitForTimeout(3000);
    }

    await page.waitForTimeout(10000);

    await context.close();

    const files = fs.readdirSync(OUTPUT_DIR)
      .filter((file) => file.endsWith('.webm'))
      .map((file) => path.join(OUTPUT_DIR, file))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

    if (!files.length) {
      throw new Error('No recorded video file found');
    }

    const metadata = {
      extensionId,
      query: DEMO_QUERY,
      script: PROMO_SCRIPT,
      rawVideo: files[0]
    };
    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'promo-metadata.json'),
      JSON.stringify(metadata, null, 2)
    );

    console.log(JSON.stringify(metadata, null, 2));
  } catch (error) {
    await context.close().catch(() => {});
    throw error;
  }
}

recordPromo().catch((error) => {
  console.error(error);
  process.exit(1);
});
