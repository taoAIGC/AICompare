// @ts-check
const { test, expect, describe } = require('@playwright/test');

/**
 * AI站点注入脚本测试 - 逐个测试各站点的注入功能
 * 使用日常Chrome配置文件运行
 */
describe('AI站点注入脚本测试', () => {

  /**
   * 测试ChatGPT站点的注入功能
   */
  test('ChatGPT - 注入脚本和User Prompt测试', async ({ page }) => {
    console.log('\n=== 测试 ChatGPT ===');

    // 1. 打开ChatGPT
    await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded' });
    console.log('✓ 已打开 ChatGPT');

    // 2. 等待登录状态检查
    await page.waitForTimeout(2000);

    // 3. 检查是否存在输入框
    const inputExists = await page.locator('#prompt-textarea').count() > 0;
    console.log(`✓ 输入框存在: ${inputExists}`);

    if (inputExists) {
      // 4. 获取输入框并输入测试文本
      await page.fill('#prompt-textarea', '测试注入脚本 - 这是一个测试问题');
      console.log('✓ 已输入测试文本');

      // 5. 验证输入框内容 (ChatGPT输入框是contenteditable)
      const inputValue = await page.locator('#prompt-textarea').textContent();
      expect(inputValue).toContain('测试注入脚本');
      console.log('✓ 输入内容验证通过');

      // 6. 测试userPrompt选择器
      await page.waitForTimeout(1000);

      // 注入测试脚本，检查userPrompt选择器
      const userPromptTest = await page.evaluate(() => {
        // 测试 ChatGPT 的 userPrompt 选择器
        const containerSelector = 'div[class*="user-message-bubble-color"]';
        const textSelector = 'div.whitespace-pre-wrap';

        const container = document.querySelector(containerSelector);
        const textElement = container ? container.querySelector(textSelector) : null;

        return {
          containerFound: !!container,
          textFound: !!textElement,
          containerHTML: container ? container.outerHTML.substring(0, 200) : 'N/A',
          textContent: textElement ? textElement.textContent : 'N/A'
        };
      });

      console.log('✓ User Prompt选择器测试结果:', userPromptTest);
    }
  });

  /**
   * 测试Gemini站点的注入功能
   */
  test('Gemini - 注入脚本和User Prompt测试', async ({ page }) => {
    console.log('\n=== 测试 Gemini ===');

    // 1. 打开Gemini
    await page.goto('https://gemini.google.com/', { waitUntil: 'domcontentloaded' });
    console.log('✓ 已打开 Gemini');

    // 2. 等待页面加载
    await page.waitForTimeout(2000);

    // 3. 检查是否存在可编辑输入框
    const inputExists = await page.locator('[contenteditable="true"]').count() > 0;
    console.log(`✓ 输入框存在: ${inputExists}`);

    if (inputExists) {
      // 4. 获取输入框并输入测试文本
      await page.fill('[contenteditable="true"]', '测试注入脚本 - 这是一个测试问题');
      console.log('✓ 已输入测试文本');

      // 5. 验证输入框内容
      const inputValue = await page.locator('[contenteditable="true"]').textContent();
      expect(inputValue).toContain('测试注入脚本');
      console.log('✓ 输入内容验证通过');

      // 6. 测试userPrompt选择器
      const userPromptTest = await page.evaluate(() => {
        const containerSelector = 'div.query-text';
        const textSelector = 'p.query-text-line';

        const container = document.querySelector(containerSelector);
        const textElement = container ? container.querySelector(textSelector) : null;

        return {
          containerFound: !!container,
          textFound: !!textElement,
          containerHTML: container ? container.outerHTML.substring(0, 200) : 'N/A',
          textContent: textElement ? textElement.textContent : 'N/A'
        };
      });

      console.log('✓ User Prompt选择器测试结果:', userPromptTest);
    }
  });

  /**
   * 测试Grok站点的注入功能
   */
  test('Grok - 注入脚本和User Prompt测试', async ({ page }) => {
    console.log('\n=== 测试 Grok ===');

    // 1. 打开Grok
    await page.goto('https://grok.com/', { waitUntil: 'domcontentloaded' });
    console.log('✓ 已打开 Grok');

    // 2. 等待页面加载
    await page.waitForTimeout(2000);

    // 3. 检查是否存在输入框
    const inputExists = await page.locator('div[contenteditable="true"].tiptap').count() > 0;
    console.log(`✓ 输入框存在: ${inputExists}`);

    if (inputExists) {
      // 4. 获取输入框并输入测试文本
      await page.fill('div[contenteditable="true"].tiptap', '测试注入脚本 - 这是一个测试问题');
      console.log('✓ 已输入测试文本');

      // 5. 验证输入框内容
      const inputValue = await page.locator('div[contenteditable="true"].tiptap').textContent();
      expect(inputValue).toContain('测试注入脚本');
      console.log('✓ 输入内容验证通过');

      // 6. 测试userPrompt选择器
      const userPromptTest = await page.evaluate(() => {
        const containerSelector = '[id^="response-"][class*="items-end"]';
        const textSelector = 'div[class*="message-bubble"]';

        const container = document.querySelector(containerSelector);
        const textElement = container ? container.querySelector(textSelector) : null;

        return {
          containerFound: !!container,
          textFound: !!textElement,
          containerHTML: container ? container.outerHTML.substring(0, 200) : 'N/A',
          textContent: textElement ? textElement.textContent : 'N/A'
        };
      });

      console.log('✓ User Prompt选择器测试结果:', userPromptTest);
    }
  });

  /**
   * 测试Claude站点的注入功能
   */
  test('Claude - 注入脚本和User Prompt测试', async ({ page }) => {
    console.log('\n=== 测试 Claude ===');

    // 1. 打开Claude
    await page.goto('https://claude.ai/chat', { waitUntil: 'domcontentloaded' });
    console.log('✓ 已打开 Claude');

    // 2. 等待页面加载
    await page.waitForTimeout(2000);

    // 3. 检查是否存在可编辑输入框
    const inputExists = await page.locator('[contenteditable="true"]').count() > 0;
    console.log(`✓ 输入框存在: ${inputExists}`);

    if (inputExists) {
      // 4. 获取输入框并输入测试文本
      await page.fill('[contenteditable="true"]', '测试注入脚本 - 这是一个测试问题');
      console.log('✓ 已输入测试文本');

      // 5. 验证输入框内容
      const inputValue = await page.locator('[contenteditable="true"]').textContent();
      expect(inputValue).toContain('测试注入脚本');
      console.log('✓ 输入内容验证通过');

      // 6. 测试userPrompt选择器
      const userPromptTest = await page.evaluate(() => {
        const containerSelector = '[data-testid="user-message"]';
        const textSelector = 'p.whitespace-pre-wrap.break-words';

        const container = document.querySelector(containerSelector);
        const textElement = container ? container.querySelector(textSelector) : null;

        return {
          containerFound: !!container,
          textFound: !!textElement,
          containerHTML: container ? container.outerHTML.substring(0, 200) : 'N/A',
          textContent: textElement ? textElement.textContent : 'N/A'
        };
      });

      console.log('✓ User Prompt选择器测试结果:', userPromptTest);
    }
  });

  /**
   * 测试DeepSeek站点的注入功能
   */
  test('DeepSeek - 注入脚本和User Prompt测试', async ({ page }) => {
    console.log('\n=== 测试 DeepSeek ===');

    // 1. 打开DeepSeek
    await page.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded' });
    console.log('✓ 已打开 DeepSeek');

    // 2. 等待页面加载
    await page.waitForTimeout(2000);

    // 3. 检查是否存在textarea输入框
    const inputExists = await page.locator('textarea').count() > 0;
    console.log(`✓ 输入框存在: ${inputExists}`);

    if (inputExists) {
      // 4. 获取输入框并输入测试文本
      await page.fill('textarea', '测试注入脚本 - 这是一个测试问题');
      console.log('✓ 已输入测试文本');

      // 5. 验证输入框内容
      const inputValue = await page.locator('textarea').inputValue();
      expect(inputValue).toContain('测试注入脚本');
      console.log('✓ 输入内容验证通过');

      // 6. 测试userPrompt选择器
      const userPromptTest = await page.evaluate(() => {
        const containerSelector = 'div.ds-message';
        const textSelector = 'div.ds-message > div';

        const container = document.querySelector(containerSelector);
        const textElement = container ? container.querySelector(textSelector) : null;

        return {
          containerFound: !!container,
          textFound: !!textElement,
          containerHTML: container ? container.outerHTML.substring(0, 200) : 'N/A',
          textContent: textElement ? textElement.textContent : 'N/A'
        };
      });

      console.log('✓ User Prompt选择器测试结果:', userPromptTest);
    }
  });

  /**
   * 测试Kimi站点的注入功能
   */
  test('Kimi - 注入脚本和User Prompt测试', async ({ page }) => {
    console.log('\n=== 测试 Kimi ===');

    // 1. 打开Kimi
    await page.goto('https://kimi.ai/', { waitUntil: 'domcontentloaded' });
    console.log('✓ 已打开 Kimi');

    // 2. 等待页面加载
    await page.waitForTimeout(2000);

    // 3. 检查是否存在Lexical编辑器
    const inputExists = await page.locator('div.chat-input-editor[contenteditable="true"]').count() > 0;
    console.log(`✓ Lexical编辑器存在: ${inputExists}`);

    if (inputExists) {
      // 4. 获取输入框并输入测试文本
      await page.fill('div.chat-input-editor[contenteditable="true"]', '测试注入脚本 - 这是一个测试问题');
      console.log('✓ 已输入测试文本');

      // 5. 验证输入框内容
      const inputValue = await page.locator('div.chat-input-editor[contenteditable="true"]').textContent();
      expect(inputValue).toContain('测试注入脚本');
      console.log('✓ 输入内容验证通过');

      // 6. 测试userPrompt选择器
      const userPromptTest = await page.evaluate(() => {
        const containerSelector = 'div.segment-content-box';
        const textSelector = 'div.segment-content-box .user-content';

        const container = document.querySelector(containerSelector);
        const textElement = container ? container.querySelector(textSelector) : null;

        return {
          containerFound: !!container,
          textFound: !!textElement,
          containerHTML: container ? container.outerHTML.substring(0, 200) : 'N/A',
          textContent: textElement ? textElement.textContent : 'N/A'
        };
      });

      console.log('✓ User Prompt选择器测试结果:', userPromptTest);
    }
  });

  /**
   * 测试豆包站点的注入功能
   */
  test('豆包 - 注入脚本和User Prompt测试', async ({ page }) => {
    console.log('\n=== 测试 豆包 ===');

    // 1. 打开豆包
    await page.goto('https://doubao.com/chat', { waitUntil: 'domcontentloaded' });
    console.log('✓ 已打开 豆包');

    // 2. 等待页面加载
    await page.waitForTimeout(2000);

    // 3. 检查是否存在输入框
    const inputExists = await page.locator('textarea[data-testid="chat_input_input"]').count() > 0;
    console.log(`✓ 输入框存在: ${inputExists}`);

    if (inputExists) {
      // 4. 获取输入框并输入测试文本
      await page.fill('textarea[data-testid="chat_input_input"]', '测试注入脚本 - 这是一个测试问题');
      console.log('✓ 已输入测试文本');

      // 5. 验证输入框内容
      const inputValue = await page.locator('textarea[data-testid="chat_input_input"]').inputValue();
      expect(inputValue).toContain('测试注入脚本');
      console.log('✓ 输入内容验证通过');

      // 6. 测试userPrompt选择器
      const userPromptTest = await page.evaluate(() => {
        const containerSelector = '[data-plugin-identifier*="send-message-box"] [data-testid="message_text_content"]';
        const textSelector = '[data-testid="message_text_content"]';

        const container = document.querySelector(containerSelector);
        const textElement = container ? container.querySelector(textSelector) : null;

        return {
          containerFound: !!container,
          textFound: !!textElement,
          containerHTML: container ? container.outerHTML.substring(0, 200) : 'N/A',
          textContent: textElement ? textElement.textContent : 'N/A'
        };
      });

      console.log('✓ User Prompt选择器测试结果:', userPromptTest);
    }
  });

  /**
   * 测试千问站点的注入功能
   */
  test('千问 - 注入脚本和User Prompt测试', async ({ page }) => {
    console.log('\n=== 测试 千问 ===');

    // 1. 打开千问
    await page.goto('https://www.qianwen.com/', { waitUntil: 'domcontentloaded' });
    console.log('✓ 已打开 千问');

    // 2. 等待页面加载
    await page.waitForTimeout(2000);

    // 3. 检查是否存在Slate编辑器
    const inputExists = await page.locator('[data-slate-editor="true"]').count() > 0;
    console.log(`✓ Slate编辑器存在: ${inputExists}`);

    if (inputExists) {
      // 4. 获取输入框并输入测试文本
      await page.fill('[data-slate-editor="true"]', '测试注入脚本 - 这是一个测试问题');
      console.log('✓ 已输入测试文本');

      // 5. 验证输入框内容
      const inputValue = await page.locator('[data-slate-editor="true"]').textContent();
      expect(inputValue).toContain('测试注入脚本');
      console.log('✓ 输入内容验证通过');

      // 6. 测试userPrompt选择器
      const userPromptTest = await page.evaluate(() => {
        const containerSelector = '[class*="questionItem"]';
        const textSelector = '[class*="bubble"]';

        const container = document.querySelector(containerSelector);
        const textElement = container ? container.querySelector(textSelector) : null;

        return {
          containerFound: !!container,
          textFound: !!textElement,
          containerHTML: container ? container.outerHTML.substring(0, 200) : 'N/A',
          textContent: textElement ? textElement.textContent : 'N/A'
        };
      });

      console.log('✓ User Prompt选择器测试结果:', userPromptTest);
    }
  });

  /**
   * 测试Qwen站点的注入功能
   */
  test('Qwen - 注入脚本和User Prompt测试', async ({ page }) => {
    console.log('\n=== 测试 Qwen ===');

    // 1. 打开Qwen
    await page.goto('https://chat.qwen.ai/', { waitUntil: 'domcontentloaded' });
    console.log('✓ 已打开 Qwen');

    // 2. 等待页面加载
    await page.waitForTimeout(2000);

    // 3. 检查是否存在textarea输入框
    const inputExists = await page.locator('textarea').count() > 0;
    console.log(`✓ 输入框存在: ${inputExists}`);

    if (inputExists) {
      // 4. 获取输入框并输入测试文本
      await page.fill('textarea', '测试注入脚本 - 这是一个测试问题');
      console.log('✓ 已输入测试文本');

      // 5. 验证输入框内容
      const inputValue = await page.locator('textarea').inputValue();
      expect(inputValue).toContain('测试注入脚本');
      console.log('✓ 输入内容验证通过');

      // 6. 测试userPrompt选择器
      const userPromptTest = await page.evaluate(() => {
        const containerSelector = '[data-message-author-role="user"]';
        const textSelector = '[data-message-author-role="user"]';

        const container = document.querySelector(containerSelector);
        const textElement = container ? container.querySelector(textSelector) : null;

        return {
          containerFound: !!container,
          textFound: !!textElement,
          containerHTML: container ? container.outerHTML.substring(0, 200) : 'N/A',
          textContent: textElement ? textElement.textContent : 'N/A'
        };
      });

      console.log('✓ User Prompt选择器测试结果:', userPromptTest);
    }
  });

  /**
   * 测试元宝站点的注入功能
   */
  test('元宝 - 注入脚本和User Prompt测试', async ({ page }) => {
    console.log('\n=== 测试 元宝 ===');

    // 1. 打开元宝
    await page.goto('https://yuanbao.tencent.com/chat/', { waitUntil: 'domcontentloaded' });
    console.log('✓ 已打开 元宝');

    // 2. 等待页面加载
    await page.waitForTimeout(2000);

    // 3. 检查是否存在可编辑输入框
    const inputExists = await page.locator('[contenteditable="true"]').count() > 0;
    console.log(`✓ 输入框存在: ${inputExists}`);

    if (inputExists) {
      // 4. 获取输入框并输入测试文本
      await page.fill('[contenteditable="true"]', '测试注入脚本 - 这是一个测试问题');
      console.log('✓ 已输入测试文本');

      // 5. 验证输入框内容
      const inputValue = await page.locator('[contenteditable="true"]').textContent();
      expect(inputValue).toContain('测试注入脚本');
      console.log('✓ 输入内容验证通过');

      // 6. 测试userPrompt选择器
      const userPromptTest = await page.evaluate(() => {
        const containerSelector = 'div.agent-chat__list__item--human';
        const textSelector = 'div.agent-chat__bubble--human';

        const container = document.querySelector(containerSelector);
        const textElement = container ? container.querySelector(textSelector) : null;

        return {
          containerFound: !!container,
          textFound: !!textElement,
          containerHTML: container ? container.outerHTML.substring(0, 200) : 'N/A',
          textContent: textElement ? textElement.textContent : 'N/A'
        };
      });

      console.log('✓ User Prompt选择器测试结果:', userPromptTest);
    }
  });

});
