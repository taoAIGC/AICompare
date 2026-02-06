let toolbar = null;
let isToolbarVisible = false;
let lastSelectedText = '';
let favoriteButton = null;
let currentSelectedText = '';
let siteSelectButton = null;
let siteDropdown = null;

function hasStorageSync() {
  return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync;
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
  // 创建下拉选择器和列表
  siteSelectButton = document.createElement('button');
  siteSelectButton.className = 'site-select-button';
  siteSelectButton.textContent = '▼';
  siteDropdown = document.createElement('div');
  siteDropdown.className = 'site-dropdown';  // 修改类名


  
  updateFavoriteButton();
  // 初始化下拉菜单
function initializeSiteDropdown() {
  if (!siteDropdown || !siteSelectButton) return;
  console.log("初始化下拉菜单",visibleSites);

  // 筛选支持 query 的站点
  const querySupportedSites = visibleSites.filter(site => 
    site.supportUrlQuery === true && site.enabled === true
  );
  
  console.log("支持query的站点:", querySupportedSites);

  // 如果没有支持 query 的站点，隐藏下拉按钮
  if (querySupportedSites.length === 0) {
    console.log("没有支持query的站点，隐藏下拉按钮");
    siteSelectButton.style.display = 'none';
    return;
  }

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
      siteDropdown.classList.remove('show');
      if (toolbar) {
        toolbar.style.display = 'none';
        isToolbarVisible = false;
        currentSelectedText = '';
        lastSelectedText = '';
      }
    });
    
    siteDropdown.appendChild(siteItem);
  });

  // 切换下拉菜单显示状态
  siteSelectButton.addEventListener('click', (e) => {
    e.stopPropagation();
    siteDropdown.classList.toggle('show');
  });

  // 点击其他地方关闭下拉菜单
  document.addEventListener('click', () => {
    siteDropdown.classList.remove('show');
  });

  // 防止点击下拉菜单时关闭
  siteDropdown.addEventListener('click', (e) => {
    e.stopPropagation();
  });
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
  const compareButton = document.createElement('img');
  compareButton.src = chrome.runtime.getURL('icons/icon48.png');
  compareButton.title = chrome.i18n.getMessage('searchWithMultiAI');
  compareButton.className = 'multi-ai-compare-button';
  
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
  // 添加按钮到工具栏

  // 创建单站点搜索组
  const singleSearchGroup = document.createElement('div');
  singleSearchGroup.className = 'single-search-group';
  singleSearchGroup.style.display = 'flex'; // 显示单站点搜索组
  
  // 将相关元素添加到单站点搜索组
  singleSearchGroup.appendChild(favoriteButton);
  singleSearchGroup.appendChild(siteSelectButton);
  singleSearchGroup.appendChild(siteDropdown);
  
  // 将单站点搜索组添加到工具栏
  toolbar.appendChild(singleSearchGroup);
  toolbar.appendChild(compareButton);
  document.body.appendChild(toolbar);
}

// 更新工具栏位置
function updateToolbarPosition(selection) {
  if (!toolbar) createToolbar();
  
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
      toolbar.style.display = 'block';
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

  setTimeout(() => {
    
    const selection = window.getSelection();
    currentSelectedText = selection?.toString().trim() || '';
    
    // 只在真正选中文本时才打印日志
    if (currentSelectedText) {
      console.log("currentSelectedText", currentSelectedText);
    }
    
    if (currentSelectedText && selection.rangeCount > 0) {
      lastSelectedText = currentSelectedText;
      const applyConfig = (buttonConfig) => {
        const config = buttonConfig || { selectionSearch: true };
        if (config.selectionSearch) {
          updateToolbarPosition(selection);
        } else {
          console.log('滑词已禁用');
        }
      };
      if (hasStorageSync()) {
        chrome.storage.sync.get(['buttonConfig'], (result) => applyConfig(result?.buttonConfig));
      } else {
        applyConfig({ selectionSearch: true });
      }
    }
  }, 10);
});

// 处理点击事件
document.addEventListener('mousedown', (e) => {
  if (toolbar && !toolbar.contains(e.target)) {
    console.log("鼠标点击toolbar消失", toolbar.contains(e.target));
    toolbar.style.display = 'none';
    isToolbarVisible = false;
    lastSelectedText = '';
    currentSelectedText = '';
    console.log("清空currentSelectedText");
  }
});

// 监听页面滚动事件
window.addEventListener('scroll', () => {
  // 如果工具栏可见，直接隐藏
  console.log("页面滚动 isToolbarVisible", isToolbarVisible);
  if (isToolbarVisible) {
    toolbar.style.display = 'none';
    isToolbarVisible = false;
    lastSelectedText = '';
  }
}, { passive: true });

// 监听键盘按键事件
document.addEventListener('keydown', (e) => {
  // 如果工具栏可见，隐藏工具栏
  if (isToolbarVisible) {
    console.log("键盘按键 isToolbarVisible", isToolbarVisible, "按键:", e.key);
    toolbar.style.display = 'none';
    isToolbarVisible = false;
    lastSelectedText = '';
    currentSelectedText = '';
    console.log("键盘按键导致工具栏消失");
  }
});

// 初始化
if (hasStorageSync()) {
  chrome.storage.sync.get(['buttonConfig'], function(result) {
    const buttonConfig = result?.buttonConfig || { selectionSearch: true };
    if (buttonConfig.selectionSearch) {
      createToolbar();
    } else {
      console.log('滑词已禁用');
    }
  });
} else {
  createToolbar();
}



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
    if (namespace === 'sync' && changes.favoriteSites) {
      updateFavoriteButton();
    }
  });
}

