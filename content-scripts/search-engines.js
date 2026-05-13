// 搜索引擎配置
const SEARCH_ENGINE_CONFIGS = {
  'www.google.com': {
    containerSelector: 'textarea[name="q"], textarea#APjFqb, textarea.gLFyf',
    position: 'afterend'
  },
  'www.baidu.com': {
    containerSelector: '#form',
    position: 'beforeend'
  },
  'www.bing.com': {
    containerSelector: '#sb_form_q',
    position: 'beforeend'
  },
  'cn.bing.com': {
    containerSelector: '#sb_form_q',
    position: 'beforeend'
  }
};

function getSearchToolbarIconUrl() {
  return chrome.runtime.getURL('icons/search-toolbar-icon.svg');
}

let searchEngineToolbarActive = false;
let searchEngineObserver = null;

function removeSearchEngineToolbar() {
  searchEngineToolbarActive = false;
  searchEngineObserver?.disconnect();
  searchEngineObserver = null;
  document.querySelector('.multi-ai-toolbar-float')?.remove();
}

// 从 URL 获取搜索词
function getQueryFromUrl() {
  const url = new URL(window.location.href);
  const hostname = window.location.hostname;
  
  // 不同搜索引擎的查询参数名
  const queryParams = {
    'www.google.com': 'q',    // Google 使用 q 参数
    'www.baidu.com': 'wd',    // 百度使用 wd 参数
    'www.bing.com': 'q',      // Bing 使用 q 参数
    'cn.bing.com': 'q'        // Bing 中文版也使用 q 参数
  };
  
  const queryParam = queryParams[hostname];
  if (!queryParam) return '';
  
  // 获取并解码查询参数
  const query = url.searchParams.get(queryParam);
  return query ? decodeURIComponent(query) : '';
}

// 创建工具栏
async function createSearchToolbar(container, position) {
  if (!searchEngineToolbarActive) {
    return null;
  }

  const sites = await window.getDefaultSites();
  if (!searchEngineToolbarActive) {
    return null;
  }
    if (!sites || !sites.length) return;
  
    // 只显示非隐藏的站点
    const visibleSites = sites.filter(site => !site.hidden);
    console.log('可见的站点:', visibleSites);

  // 创建工具栏容器
  const toolbar = document.createElement('div');
  toolbar.className = 'multi-ai-toolbar multi-ai-toolbar-float';  // 添加浮动样式类
  
  // 创建收藏按钮
  const favoriteButton = document.createElement('button');
  favoriteButton.className = 'multi-ai-favorite-button';
   // 更新收藏按钮文本的函数
  const updateFavoriteButtonText = () => {
    chrome.storage.sync.get({
      favoriteSites: []
    }, (settings) => {
      favoriteButton.textContent = settings.favoriteSites[0].name;
      console.log("更新按钮文本:", favoriteButton.textContent);
    });
  };
  
  // 初始化按钮文本
  updateFavoriteButtonText();
 // 监听存储变化
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.favoriteSites) {
      console.log("收藏站点变化:", changes.favoriteSites.newValue);
      updateFavoriteButtonText();
    }
  });

  // 创建下拉选择器和列表
  const siteSelectButton = document.createElement('button');
  siteSelectButton.className = 'site-select-button';
  siteSelectButton.textContent = '▼';
  const siteDropdown = document.createElement('div');
  siteDropdown.className = 'site-dropdown';  // 修改类名

  function initializeSiteDropdown() {
    if (!siteDropdown || !siteSelectButton) return;
    console.log("初始化下拉菜单",visibleSites);
  
    // 创建站点列表
    visibleSites.forEach(site => {
      const siteItem = document.createElement('div');
      siteItem.className = 'site-item';
      siteItem.textContent = `${site.name}`;
      
      siteItem.addEventListener('click', async () => {
        // 点击后直接打开搜索
        const query = getQueryFromUrl();
        chrome.runtime.sendMessage({
          action: 'singleSiteSearch',
          query: query,
          siteName: site.name
        }, (response) => {
          console.log('Message response:', response);  // 打印消息响应
        });


        const newFavoriteSite = [{
          name: site.name
        }];
        
        // 更新存储
        await chrome.storage.sync.set({ favoriteSites: newFavoriteSite });
        
        siteDropdown.classList.remove('show');
      });
      
      siteDropdown.appendChild(siteItem);
      console.log("添加站点列表",siteDropdown);
    });
  
    // 切换下拉菜单显示状态
    siteSelectButton.addEventListener('click', (e) => {
      e.stopPropagation();
      siteDropdown.classList.toggle('show');
      console.log('下拉菜单显示状态:', siteDropdown.classList.contains('show'));
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
  initializeSiteDropdown();

   // 创建单站点搜索组（隐藏）
   const singleSearchGroup = document.createElement('div');
   singleSearchGroup.className = 'single-search-group';
   singleSearchGroup.style.display = 'none';  // 隐藏单站点搜索组
   
   // 将相关元素添加到单站点搜索组
   singleSearchGroup.appendChild(favoriteButton);
   singleSearchGroup.appendChild(siteSelectButton);
   singleSearchGroup.appendChild(siteDropdown);

  // 创建对比按钮
  const compareButton = document.createElement('button');
  compareButton.type = 'button';
  compareButton.title = chrome.i18n.getMessage('searchWithMultiAI');
  compareButton.setAttribute('aria-label', compareButton.title || '');
  compareButton.className = 'multi-ai-search-engine-compare-button';

  const compareIcon = document.createElement('img');
  compareIcon.src = getSearchToolbarIconUrl();
  compareIcon.alt = '';
  compareIcon.className = 'multi-ai-search-engine-compare-icon';
  compareButton.appendChild(compareIcon);
  
  // 添加按钮到工具栏
  toolbar.appendChild(singleSearchGroup);
  toolbar.appendChild(compareButton);
  // 直接添加到 body
  document.body.appendChild(toolbar);
  
  // 添加事件监听
  favoriteButton.addEventListener('click', () => {
    const query = getQueryFromUrl();
    console.log('Favorite button clicked, query:', query);  // 打印查询词
    
    if (query) {
      // 获取设置
      chrome.storage.sync.get({
        favoriteSites: []
      }, (settings) => {
        console.log('Settings loaded:', settings);  // 打印设置
        
        chrome.runtime.sendMessage({
          action: 'singleSiteSearch',
          query: query,
          siteName: settings.favoriteSites[0].name
        }, (response) => {
          console.log('Message response:', response);  // 打印消息响应
        });
      });
    }
  });
  
  compareButton.addEventListener('click', () => {
    const query = getQueryFromUrl();
    console.log('Compare button clicked, query:', query);  // 打印查询词
    
    if (query) {
      chrome.storage.local.get({
        sites: []
      }, (settings) => {
        console.log('Settings loaded:', settings);  // 打印设置
        
        chrome.runtime.sendMessage({
          action: 'createComparisonPage',
          query: query
        }, (response) => {
          console.log('Message response:', response);  // 打印消息响应
        });
      });
    }
  });
  
  
  
  // 设置工具栏位置
  const updatePosition = () => {
    if (!searchEngineToolbarActive) {
      return;
    }

    const containerRect = container.getBoundingClientRect();
    
    // 添加调试日志
    console.log('Container position:', containerRect);
    
    toolbar.style.position = 'fixed';
    // 根据不同搜索引擎设置不同的工具栏位置
    const hostname = window.location.hostname;
    if (hostname.includes('google')) {
      toolbar.style.top = `${containerRect.top + 5}px`;
      toolbar.style.left = `${containerRect.right - 30}px`;  // 向右移动50px
    } else if (hostname.includes('bing')) {
      toolbar.style.top = `${containerRect.top + 5}px`; 
      toolbar.style.left = `${containerRect.right - 100}px`;
    } else if (hostname.includes('baidu')) {
      toolbar.style.top = `${containerRect.top}px`;
      toolbar.style.left = `${containerRect.right - 310}px`;
    } else {
      // 默认定位
      toolbar.style.top = `${containerRect.top}px`;
      toolbar.style.left = `${containerRect.right + 10}px`;
    }
    
    
    // 添加调试日志
    console.log('Toolbar style:', {
      top: toolbar.style.top,
      left: toolbar.style.left,
      display: getComputedStyle(toolbar).display,
      visibility: getComputedStyle(toolbar).visibility,
      zIndex: getComputedStyle(toolbar).zIndex
    });
  };
  
  // 初始定位
  updatePosition();
  
  // 监听滚动事件，更新位置
  window.addEventListener('scroll', updatePosition);
  window.addEventListener('resize', updatePosition);
  
  return toolbar;
}

// 初始化搜索引擎工具栏
function initSearchEngineToolbar() {
  const hostname = window.location.hostname;
  const config = SEARCH_ENGINE_CONFIGS[hostname];
  if (!config) return;

  if (searchEngineToolbarActive || document.querySelector('.multi-ai-toolbar-float')) {
    return;
  }

  searchEngineToolbarActive = true;

  // 等待搜索框容器加载
  searchEngineObserver = new MutationObserver((mutations, obs) => {
    if (!searchEngineToolbarActive) {
      obs.disconnect();
      return;
    }

    const container = document.querySelector(config.containerSelector);
    console.log("找到搜索引擎的输入框container", container);
    if (container) {
      // 创建工具栏
      createSearchToolbar(container, config.position);
      obs.disconnect();
      searchEngineObserver = null;
    }
  });

  searchEngineObserver.observe(document.body, {
    childList: true,
    subtree: true
  });
}

// 启动初始化

chrome.storage.sync.get(['buttonConfig'], function(result) {
  const buttonConfig = result.buttonConfig || { searchEngine: true };
  if (buttonConfig.searchEngine) {
    initSearchEngineToolbar();;
  } else {
    console.log('浮动按钮已禁用');
    removeSearchEngineToolbar();
  }
});

if (chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'sync' || !changes.buttonConfig) return;

    chrome.storage.sync.get(['buttonConfig'], async (result) => {
      const defaultButtonConfig = await window.AppConfigManager.getButtonConfig();
      const buttonConfig = result.buttonConfig || defaultButtonConfig;
      if (!buttonConfig.searchEngine) {
        removeSearchEngineToolbar();
        return;
      }

      initSearchEngineToolbar();
    });
  });
}
