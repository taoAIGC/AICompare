// @ts-check
const { test, expect, describe } = require('@playwright/test');

/**
 * 单元测试 - 配置解析和工具函数
 */
describe('单元测试 - 配置解析', () => {
  test('应该正确解析siteHandlers.json配置', async () => {
    // 读取并解析配置文件
    const config = require('../../config/siteHandlers.json');

    // 验证配置结构
    expect(config).toHaveProperty('version');
    expect(config).toHaveProperty('sites');
    expect(Array.isArray(config.sites)).toBe(true);

    // 验证至少有一个站点配置
    expect(config.sites.length).toBeGreaterThan(0);

    // 验证站点配置结构
    const firstSite = config.sites[0];
    expect(firstSite).toHaveProperty('name');
    expect(firstSite).toHaveProperty('url');
    expect(firstSite).toHaveProperty('enabled');
    expect(firstSite).toHaveProperty('supportIframe');
  });

  test('应该正确验证站点URL格式', async () => {
    const config = require('../../config/siteHandlers.json');

    for (const site of config.sites) {
      // 验证URL格式
      expect(site.url).toMatch(/^https?:\/\/.+/);

      // 验证enabled是布尔值
      expect(typeof site.enabled).toBe('boolean');

      // 验证supportIframe是布尔值
      expect(typeof site.supportIframe).toBe('boolean');
    }
  });

  test('应该正确识别支持的站点', async () => {
    const config = require('../../config/siteHandlers.json');

    const enabledSites = config.sites.filter(s => s.enabled);
    const iframeSupportedSites = config.sites.filter(s => s.supportIframe);

    // 验证有启用的站点
    expect(enabledSites.length).toBeGreaterThan(0);

    // 验证有支持iframe的站点
    expect(iframeSupportedSites.length).toBeGreaterThan(0);
  });
});

/**
 * 单元测试 - baseConfig.js
 */
describe('单元测试 - 基础配置', () => {
  test('应该包含必要的默认配置项', async () => {
    // 由于baseConfig是扩展内部模块，我们通过检查其导出来验证
    const fs = require('fs');
    const path = require('path');
    const configPath = path.join(__dirname, '../../config/baseConfig.js');

    // 验证文件存在
    expect(fs.existsSync(configPath)).toBe(true);

    // 读取文件内容验证基本结构
    const content = fs.readFileSync(configPath, 'utf-8');
    // baseConfig.js 实际包含的内容
    expect(content).toContain('DEV_CONFIG');
    expect(content).toContain('AppConfigManager');
  });
});

/**
 * 单元测试 - 工具函数
 */
describe('单元测试 - 工具函数', () => {
  test('URL验证函数应该正确识别有效和无效URL', async () => {
    const isValidUrl = (url) => {
      try {
        const urlObj = new URL(url);
        // 检查是否为http或https协议
        return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
      } catch {
        return false;
      }
    };

    // 有效URL
    expect(isValidUrl('https://chatgpt.com/')).toBe(true);
    expect(isValidUrl('https://gemini.google.com/')).toBe(true);
    expect(isValidUrl('http://localhost:3000')).toBe(true);

    // 无效URL
    expect(isValidUrl('not-a-url')).toBe(false);
    expect(isValidUrl('')).toBe(false);
    expect(isValidUrl('htp://invalid')).toBe(false); // 错误协议
    expect(isValidUrl('ftp://example.com')).toBe(false); // 非http协议
  });

  test('时间格式化函数应该正确格式化时间戳', async () => {
    const formatTime = (timestamp) => {
      const date = new Date(timestamp);
      return date.toLocaleString('zh-CN');
    };

    const now = Date.now();
    const formatted = formatTime(now);
    const formattedDate = new Date(now);

    expect(formatted).toContain(String(formattedDate.getFullYear()));
  });

  test('搜索参数解析函数应该正确提取查询参数', async () => {
    const parseQuery = (url) => {
      try {
        const urlObj = new URL(url);
        return urlObj.searchParams.get('query') || urlObj.searchParams.get('q');
      } catch {
        return null;
      }
    };

    expect(parseQuery('https://example.com?query=test')).toBe('test');
    expect(parseQuery('https://example.com?q=hello')).toBe('hello');
    expect(parseQuery('https://example.com')).toBeNull();
  });

  test('站点匹配函数应该正确识别AI站点', async () => {
    const isAISite = (url, siteConfigs) => {
      try {
        const urlObj = new URL(url);
        const hostname = urlObj.hostname.replace('www.', '');
        return siteConfigs.some(config => {
          const configHost = new URL(config.url).hostname.replace('www.', '');
          return hostname.includes(configHost);
        });
      } catch {
        return false;
      }
    };

    const mockConfigs = [
      { url: 'https://chatgpt.com/' },
      { url: 'https://gemini.google.com/' }
    ];

    expect(isAISite('https://chatgpt.com/', mockConfigs)).toBe(true);
    expect(isAISite('https://gemini.google.com/app', mockConfigs)).toBe(true);
    expect(isAISite('https://google.com/', mockConfigs)).toBe(false);
  });
});
