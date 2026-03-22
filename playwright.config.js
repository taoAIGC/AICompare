// @ts-check
const { defineConfig, devices } = require('@playwright/test');
const path = require('path');

const defaultPersistentProfileDir = path.join(__dirname, '.playwright-user-data', 'automation-profile');
if (!process.env.PLAYWRIGHT_EXTENSION_SEED_PROFILE_DIR) {
  process.env.PLAYWRIGHT_EXTENSION_SEED_PROFILE_DIR = process.env.PLAYWRIGHT_USER_DATA_DIR || defaultPersistentProfileDir;
}
if (!process.env.PLAYWRIGHT_USER_DATA_DIR) {
  process.env.PLAYWRIGHT_USER_DATA_DIR = process.env.PLAYWRIGHT_EXTENSION_SEED_PROFILE_DIR;
}

const extensionDirectSitesSpec = /tests\/e2e\/ai-sites-inject\.test\.js/;

module.exports = defineConfig({
  testDir: './tests',
  testMatch: '**/*.test.js',
  timeout: 120000,
  expect: {
    timeout: 10000
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.PLAYWRIGHT_EXTENSION_E2E === '1'
    ? 1
    : (process.env.CI ? 1 : undefined),
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'playwright-report/test-results.json' }],
    ['list']
  ],
  use: {
    baseURL: 'data:text/html',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: [extensionDirectSitesSpec],
      use: {
        ...devices['Desktop Chrome']
      }
    },
    {
      name: 'extension-direct-sites',
      testMatch: [extensionDirectSitesSpec],
      fullyParallel: false,
      retries: 0,
      use: {
        ...devices['Desktop Chrome']
      }
    }
  ]
});
