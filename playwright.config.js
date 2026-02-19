// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  // 测试目录
  testDir: './tests',

  // 测试匹配模式
  testMatch: '**/*.test.js',

  // 全局超时
  timeout: 30000,

  // 全局期望超时
  expect: {
    timeout: 5000
  },

  // 完全并行运行
  fullyParallel: true,

  // CI环境禁止fork
  forbidOnly: !!process.env.CI,

  // 重试次数
  retries: process.env.CI ? 2 : 0,

  // 并行工作数
  workers: process.env.CI ? 1 : undefined,

  // 报告器
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'playwright-report/test-results.json' }],
    ['list']
  ],

  // 共享设置
  use: {
    // 基础URL
    baseURL: 'data:text/html',

    // 收集失败测试的追踪
    trace: 'on-first-retry',

    // 截图模式
    screenshot: 'only-on-failure',

    // 视频模式
    video: 'retain-on-failure'
  },

  // 项目配置
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome'
      }
    }
  ]
});
