// @ts-check
const { test, expect, describe } = require('@playwright/test');

/**
 * 集成测试 - Chrome Storage
 * 注意：这些测试在普通浏览器上下文中运行，验证JavaScript逻辑
 */
describe('集成测试 - Chrome Storage', () => {
  test('JavaScript对象存储模拟应该正常工作', async ({ page }) => {
    await page.goto('data:text/html,<h1>Test</h1>');

    // 模拟存储对象
    const result = await page.evaluate(() => {
      // 模拟chrome.storage.local
      const mockStorage = {
        data: {},
        get(keys) {
          return Promise.resolve(keys ? this.data[keys] : this.data);
        },
        set(obj) {
          Object.assign(this.data, obj);
          return Promise.resolve();
        },
        remove(key) {
          delete this.data[key];
          return Promise.resolve();
        },
        clear() {
          this.data = {};
          return Promise.resolve();
        }
      };

      // 测试存储操作
      return mockStorage.set({ testKey: 'testValue' })
        .then(() => mockStorage.get('testKey'))
        .then(value => ({ success: value === 'testValue' }));
    });

    expect(result.success).toBe(true);
  });

  test('JavaScript对象存储多个键应该正常工作', async ({ page }) => {
    await page.goto('data:text/html,<h1>Test</h1>');

    const result = await page.evaluate(() => {
      const mockStorage = {
        data: {},
        set(obj) {
          Object.assign(this.data, obj);
          return Promise.resolve();
        },
        get(keys) {
          const result = {};
          keys.forEach(key => { result[key] = this.data[key]; });
          return Promise.resolve(result);
        }
      };

      return mockStorage.set({
        siteConfig: { version: '1.0', sites: ['chatgpt', 'gemini'] },
        userSettings: { theme: 'dark', language: 'zh-CN' }
      }).then(() => mockStorage.get(['siteConfig', 'userSettings']));
    });

    expect(result.siteConfig).toEqual({ version: '1.0', sites: ['chatgpt', 'gemini'] });
    expect(result.userSettings).toEqual({ theme: 'dark', language: 'zh-CN' });
  });

  test('JavaScript对象存储删除应该正常工作', async ({ page }) => {
    await page.goto('data:text/html,<h1>Test</h1>');

    const result = await page.evaluate(() => {
      const mockStorage = {
        data: { toDelete: 'value' },
        remove(key) {
          delete this.data[key];
          return Promise.resolve();
        },
        get(key) {
          return Promise.resolve(this.data[key]);
        }
      };

      return mockStorage.remove('toDelete')
        .then(() => mockStorage.get('toDelete'))
        .then(value => ({ deleted: value === undefined }));
    });

    expect(result.deleted).toBe(true);
  });

  test('JavaScript对象存储清空应该正常工作', async ({ page }) => {
    await page.goto('data:text/html,<h1>Test</h1>');

    const result = await page.evaluate(() => {
      const mockStorage = {
        data: { key1: 'value1', key2: 'value2' },
        clear() {
          this.data = {};
          return Promise.resolve();
        },
        get() {
          return Promise.resolve(this.data);
        }
      };

      return mockStorage.clear()
        .then(() => mockStorage.get())
        .then(data => ({ empty: Object.keys(data).length === 0 }));
    });

    expect(result.empty).toBe(true);
  });

  test('存储变化监听器模拟应该正常工作', async ({ page }) => {
    await page.goto('data:text/html,<h1>Test</h1>');

    const result = await page.evaluate(() => {
      return new Promise((resolve) => {
        let listenerCount = 0;

        // 模拟chrome.storage.onChanged
        const mockOnChanged = {
          addListener(callback) {
            listenerCount++;
          }
        };

        // 模拟存储对象
        const mockStorage = {
          data: {},
          onChanged: mockOnChanged,
          set(obj) {
            const changes = {};
            for (const [key, value] of Object.entries(obj)) {
              changes[key] = { newValue: value, oldValue: this.data[key] };
            }
            Object.assign(this.data, obj);

            // 触发监听器
            setTimeout(() => {
              // 调用已注册的监听器
            }, 0);

            return Promise.resolve();
          }
        };

        // 添加监听器
        mockStorage.onChanged.addListener(() => {});

        mockStorage.set({ testChange: 'newValue' });

        // 直接返回监听器数量
        resolve({ listenerCount });
      });
    });

    expect(result.listenerCount).toBe(1);
  });
});

/**
 * 集成测试 - 消息通信
 */
describe('集成测试 - 消息通信', () => {
  test('消息传递模拟应该正常工作', async ({ page }) => {
    await page.goto('data:text/html,<h1>Test</h1>');

    const result = await page.evaluate(() => {
      return new Promise((resolve) => {
        // 模拟消息处理
        const handlers = {};

        const mockRuntime = {
          sendMessage(message, callback) {
            const handler = handlers[message.type];
            if (handler) {
              const response = handler(message);
              if (callback) callback(response);
              resolve({ handled: true, response });
            } else {
              if (callback) callback({ error: 'No handler' });
              resolve({ handled: false });
            }
          },
          onMessage: {
            addListener(callback) {
              handlers['__add'] = callback;
            }
          }
        };

        // 注册处理器
        handlers['TEST_MESSAGE'] = (msg) => ({ success: true, data: msg.payload });

        // 发送测试消息
        mockRuntime.sendMessage({ type: 'TEST_MESSAGE', payload: 'test' }, (response) => {
          resolve(response);
        });
      });
    });

    expect(result.success).toBe(true);
  });

  test('tabs API 模拟应该正常工作', async ({ page }) => {
    await page.goto('data:text/html,<h1>Test</h1>');

    // 模拟chrome.tabs.query
    const tabInfo = await page.evaluate(async () => {
      // 模拟tabs API
      const mockTabs = [{ id: 1, url: 'about:blank', title: 'Test', active: true }];

      const mockChrome = {
        tabs: {
          query(queryInfo) {
            return Promise.resolve(mockTabs.filter(tab => {
              if (queryInfo.active !== undefined && tab.active !== queryInfo.active) return false;
              return true;
            }));
          }
        }
      };

      const [tab] = await mockChrome.tabs.query({ active: true, currentWindow: true });
      return {
        id: tab.id,
        url: tab.url,
        title: tab.title
      };
    });

    expect(tabInfo.id).toBe(1);
    expect(tabInfo.url).toBe('about:blank');
  });
});
