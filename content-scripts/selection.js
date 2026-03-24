let toolbar = null;
let isToolbarVisible = false;
let lastSelectedText = '';
let favoriteButton = null;
let currentSelectedText = '';
let siteSelectButton = null;
let siteDropdown = null;
let templateSelectButton = null;
let templateDropdown = null;
let singleSearchGroup = null;
let compareSearchGroup = null;

function hasStorageSync() {
  return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync;
}

function isSelectionQuickSearchEnabled(buttonConfig) {
  if (!buttonConfig || typeof buttonConfig !== 'object') return true;
  return buttonConfig.selectionQuickSearch !== false;
}

function isSelectionCompareButtonEnabled(buttonConfig) {
  if (!buttonConfig || typeof buttonConfig !== 'object') return true;
  return buttonConfig.selectionCompareButton !== false;
}

function hasEnabledSelectionActions(buttonConfig) {
  return (
    isSelectionQuickSearchEnabled(buttonConfig) ||
    isSelectionCompareButtonEnabled(buttonConfig)
  );
}

async function getSelectionButtonConfig() {
  if (!hasStorageSync()) return {};

  try {
    const { buttonConfig = {} } = await chrome.storage.sync.get('buttonConfig');
    return buttonConfig;
  } catch (error) {
    console.error('读取划词按钮配置失败:', error);
    return {};
  }
}

function closeDropdowns() {
  siteDropdown?.classList.remove('show');
  templateDropdown?.classList.remove('show');
}

function hideToolbar() {
  closeDropdowns();
  if (!toolbar) return;
  toolbar.style.display = 'none';
  isToolbarVisible = false;
  currentSelectedText = '';
  lastSelectedText = '';
}

function updateSingleSearchGroupVisibility(enabled) {
  if (!singleSearchGroup) return;

  singleSearchGroup.style.display = enabled ? 'flex' : 'none';

  if (!enabled) {
    siteDropdown?.classList.remove('show');
  }
}

function updateCompareSearchGroupVisibility(enabled) {
  if (!compareSearchGroup) return;

  compareSearchGroup.style.display = enabled ? 'flex' : 'none';

  if (!enabled) {
    templateDropdown?.classList.remove('show');
  }
}

function applySelectionToolbarConfig(buttonConfig) {
  updateSingleSearchGroupVisibility(isSelectionQuickSearchEnabled(buttonConfig));
  updateCompareSearchGroupVisibility(isSelectionCompareButtonEnabled(buttonConfig));

  if (!hasEnabledSelectionActions(buttonConfig)) {
    hideToolbar();
  }
}

function applyPromptTemplate(templateQuery, selectedText) {
  const safeTemplate = typeof templateQuery === 'string' ? templateQuery : '';
  const safeSelection = typeof selectedText === 'string' ? selectedText : '';

  if (!safeTemplate) {
    return safeSelection;
  }

  if (safeTemplate.includes('{query}')) {
    return safeTemplate.split('{query}').join(safeSelection);
  }

  return `${safeTemplate}\n\n${safeSelection}`.trim();
}

async function getPromptTemplates() {
  if (!hasStorageSync()) return [];

  try {
    const { promptTemplates = [] } = await chrome.storage.sync.get('promptTemplates');
    return promptTemplates
      .filter(template => template?.name && template?.query)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
  } catch (error) {
    console.error('加载提示词模板失败:', error);
    return [];
  }
}

// 更新收藏站点按钮文本
function updateFavoriteButton() {
  if (!favoriteButton) return;
  if (!hasStorageSync()) return;
  chrome.storage.sync.get('favoriteSites', function(settings) {
    console.log("更新收藏按钮文案settings favouriteSites", settings.favoriteSites);
    if (settings.favoriteSites && settings.favoriteSites.length > 0) {
      favoriteButton.textContent = settings.favoriteSites[0].name;
      console.log("获取到的favoriteButton.textContent", settings.favoriteSites[0].name);
    }
  });
}

// 创建工具栏
async function createToolbar() {
    // 从 storage 获取站点配置
    const sites = await window.getDefaultSites();
    if (!sites || !sites.length) return;
  
    // 只显示非隐藏的站点
    const visibleSites = sites.filter(site => !site.hidden);
    console.log('可见的站点:', visibleSites);

 // 初始化按钮文本
  if (toolbar) return;
  
  toolbar = document.createElement('div');
  toolbar.className = 'multi-ai-toolbar';
  
  // 创建收藏站点按钮
  favoriteButton = document.createElement('button');
  favoriteButton.className = 'multi-ai-favorite-button';
  favoriteButton.type = 'button';
  // 创建下拉选择器和列表
  siteSelectButton = document.createElement('button');
  siteSelectButton.className = 'site-select-button';
  siteSelectButton.type = 'button';
  siteSelectButton.textContent = '▾';
  siteDropdown = document.createElement('div');
  siteDropdown.className = 'site-dropdown';  // 修改类名
  templateSelectButton = document.createElement('button');
  templateSelectButton.className = 'template-select-button';
  templateSelectButton.type = 'button';
  templateSelectButton.textContent = '▾';
  templateSelectButton.title = chrome.i18n.getMessage('promptTemplatesTitle') || '提示词模板';
  templateDropdown = document.createElement('div');
  templateDropdown.className = 'template-dropdown';


  
  updateFavoriteButton();
  // 初始化下拉菜单
function initializeSiteDropdown() {
  if (!siteDropdown || !siteSelectButton) return;
  console.log("初始化下拉菜单",visibleSites);
  siteDropdown.innerHTML = '';

  // 快速搜索站点下拉只展示支持 URL 查询的站点
  const querySupportedSites = visibleSites.filter(site => site.supportUrlQuery === true);
  console.log("支持 query 的站点:", querySupportedSites);

  if (querySupportedSites.length === 0) {
    console.log("没有支持 query 的站点，隐藏下拉按钮");
    siteSelectButton.style.display = 'none';
    return;
  }

  siteSelectButton.style.display = 'inline-flex';

  // 创建站点列表
  querySupportedSites.forEach(site => {
    const siteItem = document.createElement('div');
    siteItem.className = 'site-item';
    siteItem.textContent = `${site.name}`;
    
    siteItem.addEventListener('click', async () => {
      if (!currentSelectedText) {
        console.log('没有有效的选中文本');
        return;
      }

      console.log('点击站点:', site.name, '查询:', currentSelectedText);
      
      chrome.runtime.sendMessage({
        action: 'singleSiteSearch',
        query: currentSelectedText,
        siteName: site.name
      }).catch(error => {
        console.error('发送消息失败:', error);
      });
      
      const newFavoriteSite = [{
        name: site.name
      }];
      
      // 更新存储
      if (hasStorageSync()) {
        await chrome.storage.sync.set({ favoriteSites: newFavoriteSite });
      }
      
      // 隐藏工具栏和下拉菜单
      hideToolbar();
    });
    
    siteDropdown.appendChild(siteItem);
  });

  // 切换下拉菜单显示状态
  siteSelectButton.addEventListener('click', (e) => {
    e.stopPropagation();
    templateDropdown?.classList.remove('show');
    siteDropdown.classList.toggle('show');
  });

  // 点击其他地方关闭下拉菜单
  document.addEventListener('click', () => {
    closeDropdowns();
  });

  // 防止点击下拉菜单时关闭
  siteDropdown.addEventListener('click', (e) => {
    e.stopPropagation();
  });
}

async function initializeTemplateDropdown() {
  if (!templateDropdown || !templateSelectButton) return;

  const templates = await getPromptTemplates();
  templateDropdown.innerHTML = '';

  if (templates.length === 0) {
    templateSelectButton.style.display = 'none';
    templateDropdown.classList.remove('show');
    return;
  }

  templateSelectButton.style.display = 'inline-flex';

  templates.forEach(template => {
    const templateItem = document.createElement('div');
    templateItem.className = 'template-item';
    templateItem.textContent = template.name;

    templateItem.addEventListener('click', async () => {
      if (!currentSelectedText) {
        console.log('没有有效的选中文本');
        return;
      }

      const formattedQuery = applyPromptTemplate(template.query, currentSelectedText);
      console.log('点击提示词模板:', template.name, '查询:', formattedQuery);

      await chrome.runtime.sendMessage({
        action: 'createComparisonPage',
        query: formattedQuery
      }).catch(error => {
        console.error('发送消息失败:', error);
      });

      hideToolbar();
    });

    templateDropdown.appendChild(templateItem);
  });

  templateSelectButton.onclick = (e) => {
    e.stopPropagation();
    siteDropdown?.classList.remove('show');
    templateDropdown.classList.toggle('show');
  };

  templateDropdown.onclick = (e) => {
    e.stopPropagation();
  };
}
  
  // 点击处理
  favoriteButton.onclick = async (e) => {
    e.stopPropagation();
    if (!currentSelectedText) {
      console.log('没有有效的选中文本');
      return;
    }

    if (!hasStorageSync()) return;
    chrome.storage.sync.get('favoriteSites', async function(settings) {
      if (settings.favoriteSites && settings.favoriteSites.length > 0) {
        await chrome.runtime.sendMessage({
          action: 'singleSiteSearch',
          query: currentSelectedText,
          siteName: settings.favoriteSites[0].name
        }).catch(error => {
          console.error('发送消息失败:', error);
        });
      }
    });
  };
  
  // 创建比较按钮
  const compareButton = document.createElement('button');
  compareButton.className = 'multi-ai-compare-button';
  compareButton.type = 'button';
  compareButton.title = chrome.i18n.getMessage('searchWithMultiAI');
  compareButton.innerHTML = `
    <span class="compare-button-label">${chrome.i18n.getMessage('compareButtonLabel') || 'AI 比一比'}</span>
  `;
  
  compareButton.onclick = async (e) => {
    e.stopPropagation();

    if (!currentSelectedText) {
      console.log('没有有效的选中文本');
      return;
    }

    if (currentSelectedText) {
      await chrome.runtime.sendMessage({
        action: 'createComparisonPage',
        query: currentSelectedText
      }).catch(error => {
        console.error('发送消息失败:', error);
      });
    }
  };
  
  initializeSiteDropdown();
  await initializeTemplateDropdown();
  // 添加按钮到工具栏

  // 创建单站点搜索组
  singleSearchGroup = document.createElement('div');
  singleSearchGroup.className = 'single-search-group';
  singleSearchGroup.style.display = 'flex'; // 显示单站点搜索组

  compareSearchGroup = document.createElement('div');
  compareSearchGroup.className = 'compare-search-group';
  
  // 将相关元素添加到单站点搜索组
  singleSearchGroup.appendChild(favoriteButton);
  singleSearchGroup.appendChild(siteSelectButton);
  singleSearchGroup.appendChild(siteDropdown);
  compareSearchGroup.appendChild(compareButton);
  compareSearchGroup.appendChild(templateSelectButton);
  compareSearchGroup.appendChild(templateDropdown);
  
  // 将单站点搜索组添加到工具栏
  toolbar.appendChild(singleSearchGroup);
  toolbar.appendChild(compareSearchGroup);
  document.body.appendChild(toolbar);

  const buttonConfig = await getSelectionButtonConfig();
  applySelectionToolbarConfig(buttonConfig);
}

// 更新工具栏位置
async function updateToolbarPosition(selection) {
  if (!toolbar) {
    await createToolbar();
  }

  if (!toolbar) {
    return;
  }
  
  if (!selection || !selection.rangeCount || selection.rangeCount === 0) {
    console.log('无效的选区');
    return;
  }
  
  try {
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    
    if (rect.width > 0 && rect.height > 0) {
      // 使用 viewport 相对位置
      const left = rect.right + 5;
      const top = rect.top - 5;
      
      // 确保工具栏不会超出视窗
      const maxLeft = window.innerWidth - toolbar.offsetWidth - 10;
      const finalLeft = Math.min(left, maxLeft);
      
      toolbar.style.left = `${finalLeft}px`;
      toolbar.style.top = `${top}px`;
      toolbar.style.display = 'flex';
      isToolbarVisible = true;
      
      console.log('工具栏位置更新', {
        left: finalLeft,
        top,
        display: toolbar.style.display,
        visible: isToolbarVisible,
        toolbarWidth: toolbar.offsetWidth,
        toolbarHeight: toolbar.offsetHeight
      });
    }
  } catch (error) {
    console.error('更新工具栏位置失败:', error);
  }
}

// 处理鼠标松开事件
document.addEventListener('mouseup', (e) => {
  // 检查点击是否在工具栏内
  if (toolbar && toolbar.contains(e.target)) {
    console.log('在工具栏内点击，保持当前选中文本');
    return;
  }

  setTimeout(async () => {
    
    const selection = window.getSelection();
    currentSelectedText = selection?.toString().trim() || '';
    
    // 只在真正选中文本时才打印日志
    if (currentSelectedText) {
      console.log("currentSelectedText", currentSelectedText);
    }
    
    if (currentSelectedText && selection.rangeCount > 0) {
      lastSelectedText = currentSelectedText;
      const applyConfig = async (buttonConfig) => {
        const config = buttonConfig || {};
        applySelectionToolbarConfig(config);

        if (hasEnabledSelectionActions(config)) {
          await updateToolbarPosition(selection);
        } else {
          console.log('划词按钮已禁用');
        }
      };
      if (hasStorageSync()) {
        chrome.storage.sync.get(['buttonConfig'], (result) => {
          applyConfig(result?.buttonConfig);
        });
      } else {
        applyConfig({});
      }
    }
  }, 10);
});

// 处理点击事件
document.addEventListener('mousedown', (e) => {
  if (toolbar && !toolbar.contains(e.target)) {
    console.log("鼠标点击toolbar消失", toolbar.contains(e.target));
    hideToolbar();
    console.log("清空currentSelectedText");
  }
});

// 监听页面滚动事件
window.addEventListener('scroll', () => {
  // 如果工具栏可见，直接隐藏
  console.log("页面滚动 isToolbarVisible", isToolbarVisible);
  if (isToolbarVisible) {
    hideToolbar();
  }
}, { passive: true });

// 监听键盘按键事件
document.addEventListener('keydown', (e) => {
  // 如果工具栏可见，隐藏工具栏
  if (isToolbarVisible) {
    console.log("键盘按键 isToolbarVisible", isToolbarVisible, "按键:", e.key);
    hideToolbar();
    console.log("键盘按键导致工具栏消失");
  }
});

// 初始化
createToolbar();



// 添加错误处理
window.addEventListener('error', function(event) {
  if (event.error?.message?.includes('Extension context invalidated')) {
    console.log('扩展已重新加载，将刷新页面');
    window.location.reload();
  }
});

// 监听扩展消息
chrome.runtime.onMessage?.addListener((message, sender, sendResponse) => {
  if (message.action === 'extensionReloaded') {
    window.location.reload();
  }
});

// 监听存储变化
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'sync') return;

    if (changes.favoriteSites) {
      updateFavoriteButton();
    }

    if (changes.promptTemplates) {
      initializeTemplateDropdown();
    }

    if (changes.buttonConfig) {
      applySelectionToolbarConfig(changes.buttonConfig.newValue || {});
    }
  });
}
