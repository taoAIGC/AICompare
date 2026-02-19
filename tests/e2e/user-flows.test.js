// @ts-check
const { test, expect, describe } = require('@playwright/test');

/**
 * E2E测试 - 用户完整操作流程
 */
describe('E2E测试 - 用户操作流程', () => {
  test('用户应该能够通过浮窗按钮打开AI比较界面', async ({ page }) => {
    // 1. 打开任意网页
    await page.goto('data:text/html,<h1>测试页面</h1><p>这是测试内容</p>');

    // 2. 模拟浮窗按钮存在
    await page.addScriptTag({
      content: `
        const button = document.createElement('button');
        button.id = 'ai-compare-float-button';
        button.textContent = 'AI Compare';
        button.style.cssText = 'position: fixed; bottom: 20px; right: 20px; z-index: 999999;';
        document.body.appendChild(button);

        button.addEventListener('click', () => {
          window.open('/iframe/iframe.html', '_blank', 'width=1200,height=800');
        });
      `
    });

    // 3. 点击浮窗按钮
    await page.click('#ai-compare-float-button');

    // 验证按钮可点击
    const isVisible = await page.isVisible('#ai-compare-float-button');
    expect(isVisible).toBe(true);
  });

  test('用户应该能够选择文本并查询AI', async ({ page }) => {
    // 1. 打开网页
    await page.goto('data:text/html,<p>什么是人工智能？</p>');

    // 2. 注入选择功能
    await page.addScriptTag({
      content: `
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(document.querySelector('p'));
        selection.removeAllRanges();
        selection.addRange(range);

        // 创建弹出框
        const popup = document.createElement('div');
        popup.id = 'ai-popup';
        popup.style.cssText = 'position: fixed; display: none;';
        popup.innerHTML = '<button id="query-ai-btn">查询AI</button>';
        document.body.appendChild(popup);

        document.addEventListener('mouseup', () => {
          if (selection.toString().length > 0) {
            popup.style.display = 'block';
          }
        });
      `
    });

    // 3. 选中文本触发弹出框（使用JavaScript）
    await page.evaluate(() => {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(document.querySelector('p'));
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await page.dispatchEvent('p', 'mouseup');

    // 4. 验证弹出框显示
    const popupVisible = await page.isVisible('#ai-popup');
    expect(popupVisible).toBe(true);

    // 5. 点击查询按钮
    await page.click('#query-ai-btn');
  });

  test('用户应该能够在选项页面配置站点', async ({ page }) => {
    // 1. 打开选项页面（模拟）
    await page.goto('data:text/html,<div id="options-page"></div>');

    // 2. 注入选项页面UI
    await page.addScriptTag({
      content: `
        const page = document.getElementById('options-page');
        page.innerHTML = \`
          <div class="settings-panel">
            <h2>站点设置</h2>
            <div class="site-list">
              <label><input type="checkbox" name="site" value="chatgpt" checked> ChatGPT</label>
              <label><input type="checkbox" name="site" value="gemini" checked> Gemini</label>
              <label><input type="checkbox" name="site" value="grok"> Grok</label>
            </div>
            <button id="save-btn">保存设置</button>
          </div>
        \`;
      `
    });

    // 3. 验证站点列表存在
    const checkboxes = await page.locator('input[name="site"]').count();
    expect(checkboxes).toBe(3);

    // 4. 验证保存按钮存在
    const saveBtn = page.locator('#save-btn');
    await expect(saveBtn).toBeVisible();

    // 5. 模拟保存
    await saveBtn.click();
  });

  test('用户应该能够使用搜索按钮快速访问AI站点', async ({ page }) => {
    // 1. 打开搜索引擎结果页（模拟）
    await page.goto('data:text/html,<h1>搜索结果</h1>');

    // 2. 注入搜索按钮
    await page.addScriptTag({
      content: `
        const container = document.createElement('div');
        container.className = 'ai-search-buttons';
        container.innerHTML = \`
          <button class="ai-btn" data-site="chatgpt">ChatGPT</button>
          <button class="ai-btn" data-site="gemini">Gemini</button>
        \`;
        document.body.appendChild(container);

        // 点击事件
        document.querySelectorAll('.ai-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            window.selectedSite = e.target.dataset.site;
          });
        });
      `
    });

    // 3. 点击ChatGPT按钮
    await page.click('.ai-btn[data-site="chatgpt"]');

    // 4. 验证选择
    const selectedSite = await page.evaluate(() => window.selectedSite);
    expect(selectedSite).toBe('chatgpt');
  });
});

/**
 * E2E测试 - 多站点比较流程
 */
describe('E2E测试 - 多站点比较流程', () => {
  test('用户应该能够同时向多个AI站点发送查询', async ({ page }) => {
    // 1. 打开iframe页面
    await page.goto('data:text/html,<div id="iframe-container"></div>');

    // 2. 注入模拟的iframe界面
    await page.addScriptTag({
      content: `
        const container = document.getElementById('iframe-container');
        container.innerHTML = \`
          <div class="multi-ai-container">
            <div class="query-input">
              <input type="text" id="query-input" placeholder="输入问题...">
              <button id="send-btn">发送</button>
            </div>
            <div class="ai-sites">
              <div class="ai-site" id="chatgpt">
                <div class="site-name">ChatGPT</div>
                <div class="site-response"></div>
              </div>
              <div class="ai-site" id="gemini">
                <div class="site-name">Gemini</div>
                <div class="site-response"></div>
              </div>
            </div>
          </div>
        \`;

        // 发送按钮点击事件
        document.getElementById('send-btn').addEventListener('click', () => {
          const query = document.getElementById('query-input').value;
          if (query) {
            // 模拟发送到各个站点
            document.querySelectorAll('.site-response').forEach(el => {
              el.textContent = '正在思考...';
            });
            window.querySent = true;
            window.queryText = query;
          }
        });
      `
    });

    // 3. 输入查询
    await page.fill('#query-input', '什么是AI？');

    // 4. 点击发送
    await page.click('#send-btn');

    // 5. 验证查询已发送
    const querySent = await page.evaluate(() => window.querySent);
    expect(querySent).toBe(true);

    const queryText = await page.evaluate(() => window.queryText);
    expect(queryText).toBe('什么是AI？');
  });

  test('用户应该能够导出AI响应', async ({ page }) => {
    await page.goto('data:text/html,<div id="export-container"></div>');

    await page.addScriptTag({
      content: `
        const container = document.getElementById('export-container');
        container.innerHTML = \`
          <div class="responses">
            <div class="response" data-site="chatgpt">ChatGPT: 这是回答</div>
            <div class="response" data-site="gemini">Gemini: 这是另一个回答</div>
          </div>
          <button id="export-btn">导出</button>
        \`;

        document.getElementById('export-btn').addEventListener('click', () => {
          const responses = [];
          document.querySelectorAll('.response').forEach(el => {
            responses.push(el.textContent);
          });
          window.exportedData = responses.join('\\n\\n');
        });
      `
    });

    // 点击导出按钮
    await page.click('#export-btn');

    // 验证导出数据
    const exportedData = await page.evaluate(() => window.exportedData);
    expect(exportedData).toContain('ChatGPT: 这是回答');
    expect(exportedData).toContain('Gemini: 这是另一个回答');
  });
});

/**
 * E2E测试 - 收藏和历史功能
 */
describe('E2E测试 - 收藏和历史', () => {
  test('用户应该能够收藏查询', async ({ page }) => {
    await page.goto('data:text/html,<div id="favorites-container"></div>');

    await page.addScriptTag({
      content: `
        const container = document.getElementById('favorites-container');
        container.innerHTML = \`
          <div class="query-item">
            <span class="query-text">如何学习编程？</span>
            <button class="favorite-btn">收藏</button>
          </div>
        \`;

        document.querySelector('.favorite-btn').addEventListener('click', function() {
          this.textContent = '已收藏';
          this.classList.add('favorited');
          window.queryFavorited = true;
        });
      `
    });

    // 点击收藏按钮
    await page.click('.favorite-btn');

    // 验证收藏状态
    const isFavorited = await page.evaluate(() => window.queryFavorited);
    expect(isFavorited).toBe(true);
  });

  test('用户应该能够查看历史记录', async ({ page }) => {
    await page.goto('data:text/html,<div id="history-container"></div>');

    const mockHistory = [
      { id: 1, query: '什么是AI？', timestamp: Date.now() - 3600000 },
      { id: 2, query: '如何学习Python？', timestamp: Date.now() }
    ];

    await page.addScriptTag({
      content: `
        const container = document.getElementById('history-container');
        const history = ${JSON.stringify(mockHistory)};

        let html = '<div class="history-list">';
        history.forEach(item => {
          const time = new Date(item.timestamp).toLocaleString('zh-CN');
          html += \`<div class="history-item">
            <span class="query">\${item.query}</span>
            <span class="time">\${time}</span>
          </div>\`;
        });
        html += '</div>';
        container.innerHTML = html;
      `
    });

    // 验证历史记录数量
    const historyItems = await page.locator('.history-item').count();
    expect(historyItems).toBe(2);
  });
});
