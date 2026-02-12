/**
 * 站点按钮脚本
 * 在支持的站点上，在发送按钮右侧显示插件图标
 * 点击图标后，获取输入框中的 query 并打开 iframe.html 进行搜索
 */

(async function() {
  'use strict';

  // 只在主窗口中运行，不在 iframe 中运行
  if (window.self !== window.top) {
    return;
  }

  // 等待 baseConfig 加载完成
  function waitForBaseConfig(maxAttempts = 10, interval = 200) {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const checkConfig = () => {
        if (typeof window.getDefaultSites !== 'undefined') {
          resolve();
        } else if (attempts < maxAttempts) {
          attempts++;
          setTimeout(checkConfig, interval);
        } else {
          reject(new Error('等待 baseConfig 加载超时'));
        }
      };
      checkConfig();
    });
  }

  try {
    await waitForBaseConfig();
    initSiteButton();
  } catch (error) {
    console.error('初始化站点按钮失败:', error);
  }

  async function initSiteButton() {
    try {
      // 检查 ENABLE_SITE_BUTTON 配置，只有为 true 时才创建按钮
      if (typeof window.ENABLE_SITE_BUTTON !== 'undefined' && !window.ENABLE_SITE_BUTTON) {
        console.log('站点按钮功能已禁用 (ENABLE_SITE_BUTTON = false)');
        return;
      }

      // 获取站点配置
      const sites = await window.getDefaultSites();
      if (!sites || sites.length === 0) {
        console.log('未找到站点配置');
        return;
      }

      // 检测当前站点
      const currentSite = detectCurrentSite(sites);
      if (!currentSite) {
        console.log('当前站点不在支持列表中');
        return;
      }

      // 不检查站点是否启用，只要站点存在就显示按钮
      // 检查站点是否支持 iframe
      if (!currentSite.supportIframe) {
        console.log('当前站点不支持 iframe');
        return;
      }

      // 等待页面加载完成
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
          createSiteButton(currentSite);
          // 如果配置了 userPrompt，创建 userprompt 按钮
          if (currentSite.userPrompt) {
            createUserPromptButtons(currentSite);
          }
        });
      } else {
        createSiteButton(currentSite);
        // 如果配置了 userPrompt，创建 userprompt 按钮
        if (currentSite.userPrompt) {
          createUserPromptButtons(currentSite);
        }
      }
    } catch (error) {
      console.error('初始化站点按钮失败:', error);
    }
  }

  /**
   * 检测当前站点
   */
  function detectCurrentSite(sites) {
    const currentUrl = window.location.href;
    const currentHostname = window.location.hostname;

    // 匹配站点
    for (const site of sites) {
      try {
        const siteUrl = new URL(site.url);
        const siteHostname = siteUrl.hostname;

        // 检查 hostname 是否匹配
        if (currentHostname === siteHostname || 
            currentHostname.includes(siteHostname) || 
            siteHostname.includes(currentHostname)) {
          // 检查路径是否匹配（如果站点 URL 包含路径）
          const sitePath = siteUrl.pathname;
          if (sitePath && sitePath !== '/') {
            if (currentUrl.includes(sitePath)) {
              return site;
            }
          } else {
            return site;
          }
        }
      } catch (e) {
        // URL 解析失败，尝试字符串匹配
        if (currentUrl.includes(site.url) || site.url.includes(currentHostname)) {
          return site;
        }
      }
    }

    return null;
  }

  /**
   * 查找输入框附近的发送按钮（用于使用 sendKeys 的站点）
   */
  function findSendButtonNearInput(inputElement) {
    if (!inputElement) return null;

    // 常见的发送按钮选择器
    const commonSendButtonSelectors = [
      'button[type="submit"]',
      'button[aria-label*="Send" i]',
      'button[aria-label*="发送" i]',
      'button[title*="Send" i]',
      'button[title*="发送" i]',
      'button:has(svg)',
      '[role="button"][aria-label*="Send" i]'
    ];

    // 在输入框的父容器中查找
    let container = inputElement.parentElement;
    let depth = 0;
    const maxDepth = 5; // 最多向上查找5层

    while (container && depth < maxDepth) {
      for (const selector of commonSendButtonSelectors) {
        try {
          const button = container.querySelector(selector);
          if (button && button !== inputElement) {
            // 确保按钮是可见的
            const rect = button.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              return button;
            }
          }
        } catch (e) {
          // 忽略选择器错误
        }
      }
      container = container.parentElement;
      depth++;
    }

    return null;
  }

  /**
   * 创建站点按钮
   */
  function createSiteButton(site) {
    // 获取发送按钮和输入框的 selector
    const sendButtonSelector = getSendButtonSelector(site);
    const inputSelector = getInputSelector(site);

    if (!inputSelector) {
      console.log('无法找到输入框的 selector');
      return;
    }

    // 使用 MutationObserver 等待元素出现
    const observer = new MutationObserver((mutations, obs) => {
      const inputElement = findElement(inputSelector);
      if (!inputElement) return;

      // 如果有发送按钮 selector，使用它；否则尝试在输入框附近查找
      let sendButton = null;
      if (sendButtonSelector) {
        sendButton = findElement(sendButtonSelector);
      } else {
        // 对于使用 sendKeys 的站点，尝试查找输入框附近的发送按钮
        sendButton = findSendButtonNearInput(inputElement);
        // 如果找不到发送按钮，使用输入框本身作为参考点
        if (!sendButton) {
          sendButton = inputElement;
        }
      }

      if (sendButton && inputElement) {
        obs.disconnect();
        
        // 检查是否已经添加过按钮
        const existingButton = sendButton.parentElement?.querySelector('.multi-ai-site-button') ||
                               document.querySelector('.multi-ai-site-button');
        if (existingButton) {
          return;
        }

        // 创建并插入按钮
        insertButton(sendButton, inputElement, site);
      }
    });

    // 开始观察
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // 立即检查一次
    const inputElement = findElement(inputSelector);
    if (!inputElement) return;

    // 如果有发送按钮 selector，使用它；否则尝试在输入框附近查找
    let sendButton = null;
    if (sendButtonSelector) {
      sendButton = findElement(sendButtonSelector);
    } else {
      // 对于使用 sendKeys 的站点，尝试查找输入框附近的发送按钮
      sendButton = findSendButtonNearInput(inputElement);
      // 如果找不到发送按钮，使用输入框本身作为参考点
      if (!sendButton) {
        sendButton = inputElement;
      }
    }

    if (sendButton && inputElement) {
      observer.disconnect();
      
      // 检查是否已经添加过按钮
      const existingButton = sendButton.parentElement?.querySelector('.multi-ai-site-button') ||
                             document.querySelector('.multi-ai-site-button');
      if (existingButton) {
        return;
      }

      insertButton(sendButton, inputElement, site);
    }
  }

  /**
   * 获取发送按钮的 selector
   */
  function getSendButtonSelector(site) {
    if (!site.searchHandler || !site.searchHandler.steps) {
      return null;
    }

    // 查找 click 操作的 selector
    for (const step of site.searchHandler.steps) {
      if (step.action === 'click') {
        if (typeof step.selector === 'string') {
          return step.selector;
        } else if (Array.isArray(step.selector)) {
          // 返回第一个 selector
          return step.selector[0];
        }
      }
    }

    // 如果没有找到 click 操作，返回 null（表示使用 sendKeys，需要特殊处理）
    return null;
  }

  /**
   * 获取输入框的 selector
   */
  function getInputSelector(site) {
    if (!site.searchHandler || !site.searchHandler.steps) {
      return null;
    }

    // 查找 focus 或 setValue 操作的 selector
    for (const step of site.searchHandler.steps) {
      if (step.action === 'focus' || step.action === 'setValue') {
        if (typeof step.selector === 'string') {
          return step.selector;
        } else if (Array.isArray(step.selector)) {
          // 返回第一个 selector
          return step.selector[0];
        }
      }
    }

    return null;
  }

  /**
   * 查找元素（支持多种 selector 格式）
   */
  function findElement(selector) {
    if (!selector) return null;

    try {
      // 如果是数组，尝试每个 selector
      if (Array.isArray(selector)) {
        for (const sel of selector) {
          const element = document.querySelector(sel);
          if (element) return element;
        }
        return null;
      }

      // 单个 selector
      return document.querySelector(selector);
    } catch (e) {
      console.error('查找元素失败:', e);
      return null;
    }
  }

  /**
   * 获取输入框的内容
   */
  function getInputValue(element) {
    if (!element) return '';

    // 如果是 textarea 或 input
    if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
      return element.value || '';
    }

    // 如果是 contenteditable
    if (element.contentEditable === 'true') {
      return element.innerText || element.textContent || '';
    }

    return '';
  }

  /**
   * 插入按钮
   */
  function insertButton(sendButton, inputElement, site) {
    // 创建按钮容器
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'multi-ai-site-button-container';

    // 创建按钮
    const button = document.createElement('button');
    button.className = 'multi-ai-site-button';
    button.title = '使用 Multi-AI 搜索';
    button.setAttribute('aria-label', '使用 Multi-AI 搜索');

    // 创建图标
    const icon = document.createElement('img');
    icon.src = chrome.runtime.getURL('icons/icon48.png');
    icon.className = 'multi-ai-site-button-icon';
    button.appendChild(icon);

    // 添加点击事件
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const query = getInputValue(inputElement).trim();
      if (!query) {
        console.log('输入框为空');
        return;
      }

      // 参考 search-engines.js 的方式，通过 background.js 打开 iframe.html
      chrome.runtime.sendMessage({
        action: 'createComparisonPage',
        query: query
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('打开 iframe 页面失败:', chrome.runtime.lastError);
        } else {
          console.log('Message response:', response);
        }
      });
    });

    buttonContainer.appendChild(button);

    // 判断 sendButton 是否是输入框（用于使用 sendKeys 的站点）
    const isInputElement = sendButton === inputElement || 
                          sendButton.tagName === 'TEXTAREA' || 
                          sendButton.tagName === 'INPUT' ||
                          sendButton.contentEditable === 'true';

    // 将按钮插入到合适的位置
    if (isInputElement) {
      // 如果是输入框，尝试在输入框的父容器中查找合适的位置
      // 通常输入框和发送按钮会在同一个容器中
      const inputParent = inputElement.parentElement;
      if (inputParent) {
        // 尝试在输入框的父容器末尾添加按钮
        // 或者查找输入框的兄弟元素（可能是发送按钮的容器）
        const inputSiblings = Array.from(inputParent.children);
        const inputIndex = inputSiblings.indexOf(inputElement);
        
        // 查找输入框后面的按钮元素
        let insertAfterElement = inputElement;
        for (let i = inputIndex + 1; i < inputSiblings.length; i++) {
          const sibling = inputSiblings[i];
          if (sibling.tagName === 'BUTTON' || 
              sibling.querySelector('button') ||
              sibling.getAttribute('role') === 'button') {
            insertAfterElement = sibling;
            break;
          }
        }
        
        try {
          insertAfterElement.insertAdjacentElement('afterend', buttonContainer);
        } catch (e) {
          // 如果失败，在父容器末尾添加
          inputParent.appendChild(buttonContainer);
        }
      } else {
        // 如果找不到父元素，在输入框后插入
        inputElement.after(buttonContainer);
      }
    } else {
      // 如果是真正的发送按钮，在按钮右侧插入
      try {
        sendButton.insertAdjacentElement('afterend', buttonContainer);
      } catch (e) {
        // 如果 insertAdjacentElement 失败，尝试其他方法
        const sendButtonParent = sendButton.parentElement;
        if (sendButtonParent) {
          // 检查发送按钮是否有下一个兄弟元素
          const nextSibling = sendButton.nextSibling;
          if (nextSibling && nextSibling.nodeType === Node.ELEMENT_NODE) {
            sendButtonParent.insertBefore(buttonContainer, nextSibling);
          } else {
            sendButtonParent.appendChild(buttonContainer);
          }
        } else {
          // 如果找不到父元素，在发送按钮后插入
          sendButton.after(buttonContainer);
        }
      }
    }
  }

  /**
   * 创建 userprompt 按钮
   * 在每个用户消息旁边显示"多AI 对比"按钮
   */
  function createUserPromptButtons(site) {
    const userPromptConfig = site.userPrompt;
    if (!userPromptConfig || !userPromptConfig.containerSelector) {
      console.log('未配置 userPrompt');
      return;
    }

    const containerSelector = userPromptConfig.containerSelector;
    const textSelector = userPromptConfig.textSelector || containerSelector;

    // 用于跟踪已经添加过按钮的容器
    const processedContainers = new WeakSet();

    /**
     * 从 userprompt 容器中提取文本
     */
    function extractUserPromptText(container) {
      if (!container) return '';

      // 如果配置了 textSelector，使用它
      if (textSelector) {
        try {
          const textElement = container.querySelector(textSelector);
          if (textElement) {
            return textElement.innerText || textElement.textContent || '';
          }
        } catch (e) {
          console.error('提取 userprompt 文本失败:', e);
        }
      }

      // 回退：直接使用容器的文本
      return container.innerText || container.textContent || '';
    }

    /**
     * 在 userprompt 容器旁边插入按钮
     */
    function insertUserPromptButton(container) {
      // 检查是否已经添加过按钮
      if (processedContainers.has(container)) {
        return;
      }

      // 检查容器中是否已经有按钮
      const existingButton = container.querySelector('.multi-ai-userprompt-button');
      if (existingButton) {
        processedContainers.add(container);
        return;
      }

      // 创建按钮容器
      const buttonContainer = document.createElement('div');
      buttonContainer.className = 'multi-ai-userprompt-button-container';
      buttonContainer.style.cssText = 'display: inline-flex; align-items: center; margin-left: 23px; vertical-align: middle;';

      // 创建按钮
      const button = document.createElement('button');
      button.className = 'multi-ai-userprompt-button';
      button.textContent = '多AI 对比';
      button.title = '使用多AI对比搜索';
      button.setAttribute('aria-label', '使用多AI对比搜索');
      button.style.cssText = `
        display: inline-flex;
        align-items: center;
        padding: 4px 8px;
        font-size: 12px;
        border: 1px solid #ccc;
        border-radius: 4px;
        background: #fff;
        cursor: pointer;
        color: #333;
        transition: all 0.2s;
      `;

      // 添加悬停效果
      button.addEventListener('mouseenter', () => {
        button.style.background = '#f0f0f0';
        button.style.borderColor = '#999';
      });
      button.addEventListener('mouseleave', () => {
        button.style.background = '#fff';
        button.style.borderColor = '#ccc';
      });

      // 添加点击事件
      button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const query = extractUserPromptText(container).trim();
        if (!query) {
          console.log('userprompt 文本为空');
          return;
        }

        // 通过 background.js 打开 iframe.html
        chrome.runtime.sendMessage({
          action: 'createComparisonPage',
          query: query
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.error('打开 iframe 页面失败:', chrome.runtime.lastError);
          } else {
            console.log('Message response:', response);
          }
        });
      });

      buttonContainer.appendChild(button);

      // 尝试在容器旁边插入按钮
      // 优先尝试在容器后面插入
      try {
        container.insertAdjacentElement('afterend', buttonContainer);
      } catch (e) {
        // 如果失败，尝试在容器内部插入（在文本内容后面）
        try {
          // 查找文本元素，在它后面插入
          if (textSelector && textSelector !== containerSelector) {
            const textElement = container.querySelector(textSelector);
            if (textElement) {
              textElement.insertAdjacentElement('afterend', buttonContainer);
            } else {
              container.appendChild(buttonContainer);
            }
          } else {
            // 如果没有单独的文本选择器，直接在容器末尾插入
            container.appendChild(buttonContainer);
          }
        } catch (e2) {
          // 如果还是失败，尝试在父容器中插入
          const parent = container.parentElement;
          if (parent) {
            try {
              const nextSibling = container.nextSibling;
              if (nextSibling) {
                parent.insertBefore(buttonContainer, nextSibling);
              } else {
                parent.appendChild(buttonContainer);
              }
            } catch (e3) {
              console.error('插入 userprompt 按钮失败:', e3);
            }
          }
        }
      }

      processedContainers.add(container);
    }

    /**
     * 处理所有现有的 userprompt 容器
     */
    function processExistingContainers() {
      try {
        const containers = document.querySelectorAll(containerSelector);
        containers.forEach(container => {
          if (container && !processedContainers.has(container)) {
            insertUserPromptButton(container);
          }
        });
      } catch (e) {
        console.error('处理现有 userprompt 容器失败:', e);
      }
    }

    /**
     * 使用 MutationObserver 监听新的 userprompt 出现
     */
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // 检查新添加的节点是否是 userprompt 容器
            try {
              if (node.matches && node.matches(containerSelector)) {
                insertUserPromptButton(node);
              }
              // 检查新添加的节点内部是否包含 userprompt 容器
              const containers = node.querySelectorAll ? node.querySelectorAll(containerSelector) : [];
              containers.forEach(container => {
                if (!processedContainers.has(container)) {
                  insertUserPromptButton(container);
                }
              });
            } catch (e) {
              // 忽略选择器错误
            }
          }
        });
      });
    });

    // 开始观察
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // 立即处理现有的容器
    processExistingContainers();

    // 定期检查（处理动态加载的内容）
    setInterval(() => {
      processExistingContainers();
    }, 1000);
  }
})();
