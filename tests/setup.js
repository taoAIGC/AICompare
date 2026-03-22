const path = require('path');
const fs = require('fs');
const base = require('@playwright/test');
const { chromium } = require('playwright');
const {
  getExtensionPath,
  validateExtensionStructure,
  sanitizePathSegment,
  ensureDirectory,
  copyDirectory,
  removeDirectory
} = require('./utils/test-utils');

const EXTENSION_PATH = getExtensionPath();
const USER_DATA_ROOT = path.join(EXTENSION_PATH, '.playwright-user-data');
const DEFAULT_SEED_PROFILE_DIR = process.env.PLAYWRIGHT_EXTENSION_SEED_PROFILE_DIR ||
  process.env.PLAYWRIGHT_USER_DATA_DIR ||
  path.join(USER_DATA_ROOT, 'automation-profile');
const RUN_PROFILE_ROOT = path.join(USER_DATA_ROOT, 'extension-runs');

function resolveHeadless() {
  if (process.env.PLAYWRIGHT_EXTENSION_HEADLESS != null) {
    return process.env.PLAYWRIGHT_EXTENSION_HEADLESS === '1';
  }
  return process.env.CI === 'true';
}

function resolveChannel() {
  const channel = process.env.CHROME_CHANNEL || 'chromium';
  return channel === 'chromium' ? undefined : channel;
}

function getExtensionLaunchArgs() {
  return [
    `--disable-extensions-except=${EXTENSION_PATH}`,
    `--load-extension=${EXTENSION_PATH}`,
    '--no-first-run',
    '--no-default-browser-check'
  ];
}

async function waitForExtensionServiceWorker(context, timeout = 20000) {
  const existingWorker = context
    .serviceWorkers()
    .find((worker) => worker.url().startsWith('chrome-extension://'));

  if (existingWorker) {
    return existingWorker;
  }

  const warmupPage = await context.newPage();
  try {
    await warmupPage.goto('about:blank');
    await warmupPage.waitForTimeout(1000);
  } finally {
    await warmupPage.close().catch(() => {});
  }

  const workerAfterWarmup = context
    .serviceWorkers()
    .find((worker) => worker.url().startsWith('chrome-extension://'));

  if (workerAfterWarmup) {
    return workerAfterWarmup;
  }

  return context.waitForEvent('serviceworker', {
    timeout,
    predicate: (worker) => worker.url().startsWith('chrome-extension://')
  });
}

function getExtensionIdFromWorker(worker) {
  return new URL(worker.url()).host;
}

function getSeedProfileDir() {
  return DEFAULT_SEED_PROFILE_DIR;
}

async function prepareRunProfile(testInfo) {
  ensureDirectory(RUN_PROFILE_ROOT);

  const runId = sanitizePathSegment([
    testInfo.project.name,
    testInfo.title,
    testInfo.retry,
    Date.now()
  ].join('-'));

  const userDataDir = path.join(RUN_PROFILE_ROOT, runId);
  const seedProfileDir = getSeedProfileDir();
  if (!fs.existsSync(seedProfileDir)) {
    throw new Error(
      `Missing extension seed profile: ${seedProfileDir}. Set PLAYWRIGHT_EXTENSION_SEED_PROFILE_DIR to a logged-in Chrome profile copy before running extension-direct-sites tests.`
    );
  }

  await copyDirectory(seedProfileDir, userDataDir);

  return {
    seedProfileDir,
    userDataDir
  };
}

async function launchExtensionContext(testInfo) {
  const structure = validateExtensionStructure(EXTENSION_PATH);
  if (!structure.valid) {
    throw new Error(`Extension structure invalid: ${structure.missingFiles.join(', ')}`);
  }

  const profile = await prepareRunProfile(testInfo);
  const context = await chromium.launchPersistentContext(profile.userDataDir, {
    channel: resolveChannel(),
    headless: resolveHeadless(),
    viewport: { width: 1440, height: 960 },
    args: getExtensionLaunchArgs(),
    ignoreDefaultArgs: ['--disable-extensions'],
    chromiumSandbox: false
  });

  const worker = await waitForExtensionServiceWorker(context);
  const extensionId = getExtensionIdFromWorker(worker);

  return {
    ...profile,
    context,
    extensionId,
    serviceWorkerUrl: worker.url(),
    async newPage() {
      return context.newPage();
    },
    async openExtensionPage(relativePath = 'iframe/iframe.html') {
      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/${relativePath}`);
      return page;
    },
    async cleanup() {
      await context.close();
    }
  };
}

const test = base.test.extend({
  extensionContextInfo: async ({}, use, testInfo) => {
    const info = await launchExtensionContext(testInfo);

    await testInfo.attach('extension-context.json', {
      body: Buffer.from(JSON.stringify({
        extensionId: info.extensionId,
        serviceWorkerUrl: info.serviceWorkerUrl,
        seedProfileDir: info.seedProfileDir,
        userDataDir: info.userDataDir
      }, null, 2)),
      contentType: 'application/json'
    });

    try {
      await use(info);
    } finally {
      await info.cleanup().catch(() => {});

      const shouldKeepProfile = process.env.PLAYWRIGHT_KEEP_EXTENSION_PROFILE === '1' ||
        (testInfo.status && testInfo.status !== 'passed');

      if (!shouldKeepProfile) {
        await removeDirectory(info.userDataDir).catch(() => {});
      }
    }
  },

  context: async ({ extensionContextInfo }, use) => {
    await use(extensionContextInfo.context);
  },

  extensionId: async ({ extensionContextInfo }, use) => {
    await use(extensionContextInfo.extensionId);
  },

  serviceWorkerUrl: async ({ extensionContextInfo }, use) => {
    await use(extensionContextInfo.serviceWorkerUrl);
  },

  newExtensionPage: async ({ extensionContextInfo }, use) => {
    await use(extensionContextInfo.newPage);
  },

  openExtensionPage: async ({ extensionContextInfo }, use) => {
    await use(extensionContextInfo.openExtensionPage);
  },

  page: async ({ context }, use) => {
    const page = await context.newPage();
    try {
      await use(page);
    } finally {
      await page.close().catch(() => {});
    }
  }
});

module.exports = {
  test,
  expect: base.expect,
  chromium,
  EXTENSION_PATH,
  USER_DATA_ROOT,
  RUN_PROFILE_ROOT,
  getSeedProfileDir,
  getExtensionLaunchArgs,
  waitForExtensionServiceWorker,
  getExtensionIdFromWorker,
  launchExtensionContext
};
