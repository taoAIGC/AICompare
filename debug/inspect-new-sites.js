const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const DEFAULT_SITES = [
  'DeepL',
  'Google Translate',
  'NotebookLM',
  'Lovable',
  'Gamma',
  'Canva',
  'Suno',
  'ElevenLabs',
  'SeaArt',
  'Midjourney',
  'Dreamina',
  'GenSpark',
  'Manus',
  'Flowith',
  'Character AI'
];

function parseNames(raw) {
  if (!raw) return DEFAULT_SITES;
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

function loadSitesByName(repoRoot, names) {
  const configPath = path.join(repoRoot, 'config', 'siteHandlers.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const wanted = new Set(names);
  return (config.sites || []).filter((site) => wanted.has(site.name));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function sanitize(value) {
  return String(value || 'value')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100) || 'value';
}

async function collectCandidates(page) {
  return page.evaluate(() => {
    function isVisible(element) {
      if (!element) return false;
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 6 && rect.height > 6;
    }

    function quoteAttr(value) {
      return String(value).replace(/"/g, '\\"');
    }

    function buildSelector(element) {
      if (!element || !element.tagName) return '';
      if (element.id) return `#${CSS.escape(element.id)}`;

      const parts = [element.tagName.toLowerCase()];
      const attrs = ['name', 'placeholder', 'role', 'aria-label', 'data-testid', 'data-test-id'];
      for (const attr of attrs) {
        const value = element.getAttribute(attr);
        if (value) {
          parts.push(`[${attr}="${quoteAttr(value)}"]`);
          return parts.join('');
        }
      }

      const classes = Array.from(element.classList || []).filter(Boolean).slice(0, 3);
      if (classes.length) {
        return parts.concat(classes.map((cls) => `.${CSS.escape(cls)}`)).join('');
      }

      return parts.join('');
    }

    function summarize(element) {
      const text = (element.innerText || element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120);
      return {
        selector: buildSelector(element),
        tag: element.tagName.toLowerCase(),
        type: element.getAttribute('type') || '',
        role: element.getAttribute('role') || '',
        placeholder: element.getAttribute('placeholder') || '',
        ariaLabel: element.getAttribute('aria-label') || '',
        name: element.getAttribute('name') || '',
        text,
        contenteditable: element.getAttribute('contenteditable') || '',
        rect: (() => {
          const rect = element.getBoundingClientRect();
          return {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          };
        })()
      };
    }

    const inputSelector = [
      'textarea',
      'input[type="text"]',
      'input:not([type])',
      '[contenteditable="true"]',
      '[role="textbox"]',
      '.ProseMirror'
    ].join(',');

    const buttonSelector = [
      'button',
      '[role="button"]',
      'input[type="submit"]',
      '[aria-label*="send" i]',
      '[aria-label*="submit" i]',
      '[aria-label*="生成" i]',
      '[aria-label*="发送" i]',
      '[data-testid*="send" i]',
      '[data-testid*="submit" i]'
    ].join(',');

    const inputs = Array.from(document.querySelectorAll(inputSelector))
      .filter(isVisible)
      .slice(0, 20)
      .map(summarize);

    const buttons = Array.from(document.querySelectorAll(buttonSelector))
      .filter(isVisible)
      .slice(0, 40)
      .map(summarize);

    return {
      title: document.title,
      url: location.href,
      inputs,
      buttons
    };
  });
}

async function run() {
  const repoRoot = path.resolve(__dirname, '..');
  const targetNames = parseNames(process.env.SITE_NAMES);
  const targets = loadSitesByName(repoRoot, targetNames);
  const outDir = ensureDir(path.join(repoRoot, 'debug', 'output', 'site-inspection'));
  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome'
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 }
  });
  const results = [];

  try {
    for (const site of targets) {
      const page = await context.newPage();
      const record = {
        site: site.name,
        targetUrl: site.url,
        finalUrl: '',
        title: '',
        inputs: [],
        buttons: [],
        screenshot: '',
        error: ''
      };

      try {
        await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await page.waitForTimeout(10000);
        const snapshot = await collectCandidates(page);
        record.finalUrl = snapshot.url;
        record.title = snapshot.title;
        record.inputs = snapshot.inputs;
        record.buttons = snapshot.buttons;
      } catch (error) {
        record.error = String(error && error.stack ? error.stack : error);
      } finally {
        try {
          const screenshotPath = path.join(outDir, `${sanitize(site.name)}.png`);
          await page.screenshot({ path: screenshotPath, fullPage: true });
          record.screenshot = screenshotPath;
        } catch (_) {}
        await page.close().catch(() => {});
      }

      results.push(record);
      console.log(`\n=== ${site.name} ===`);
      console.log(JSON.stringify(record, null, 2));
    }
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  const outPath = path.join(outDir, `results-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nSaved results to ${outPath}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
