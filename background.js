importScripts('./config/baseConfig.js');     // 加载基础配置（包含开发环境配置）

// 开发环境：输出当前扩展ID供search_url使用
function logExtensionIdForDevelopment() {
  const extensionId = chrome.runtime.id;
  console.log('='.repeat(60));
  console.log('🔧 开发调试信息');
  console.log('当前扩展ID:', extensionId);
  console.log('search_url应该设置为:');
  console.log(`chrome-extension://${extensionId}/iframe/iframe.html?query={searchTerms}`);
  console.log('='.repeat(60));
  
  // 可选：将正确的URL复制到剪贴板（需要clipboardWrite权限）
  try {
    const searchUrl = `chrome-extension://${extensionId}/iframe/iframe.html?query={searchTerms}`;
    // 存储到local storage供手动获取
    chrome.storage.local.set({ 
      developmentSearchUrl: searchUrl,
      currentExtensionId: extensionId 
    });
  } catch (error) {
    console.log('无法自动复制URL，请手动复制上面的search_url');
  }
}

// 从本地文件初始化配置到 Chrome Storage Local
async function initializeLocalConfig() {
  try {
    console.log('开始从本地文件初始化配置...');
    
    // 检查是否已经有 remoteSiteHandlers 数据
    const existingData = await chrome.storage.local.get('remoteSiteHandlers');
    if (existingData.remoteSiteHandlers && existingData.remoteSiteHandlers.sites) {
      console.log('remoteSiteHandlers 已存在，跳过本地初始化');
      return;
    }
    
    // 从本地文件读取配置
    const response = await fetch(chrome.runtime.getURL('config/siteHandlers.json'));
    if (!response.ok) {
      throw new Error(`无法读取本地配置文件: ${response.status}`);
    }
    
    const localConfig = await response.json();
    if (!localConfig.sites || localConfig.sites.length === 0) {
      throw new Error('本地配置文件中没有站点数据');
    }
    
    // 将本地配置存储到 chrome.storage.local
    await chrome.storage.local.set({
      siteConfigVersion: localConfig.version || Date.now(),
      remoteSiteHandlers: localConfig
    });
    
    console.log('本地配置初始化成功，站点数量:', localConfig.sites.length);
    console.log('配置版本:', localConfig.version || Date.now());
    
  } catch (error) {
    console.error('本地配置初始化失败:', error);
  }
}

// 初始化默认提示词模板
async function initializeDefaultPromptTemplates() {
  try {
    const { promptTemplates } = await chrome.storage.sync.get('promptTemplates');
    
    // 如果还没有提示词模板，设置默认模板
    if (!promptTemplates || promptTemplates.length === 0) {
      const defaultTemplates = [

        {
          id: 'risk_analysis',
          name: 'RiskAnalysis',
          query: 'Root cause of the failure:「{query}」',
          order: 1,
          isDefault: true
        },

        {
          id: 'best_practice',
          name: 'BestPractice',
          query: 'Write a success retrospective report on this project:「{query}」',
          order: 2,
          isDefault: true
        }
      ];
      
      await chrome.storage.sync.set({ promptTemplates: defaultTemplates });
      console.log('已初始化默认提示词模板');
    } else {
      console.log('提示词模板已存在，跳过初始化');
    }
  } catch (error) {
    console.error('初始化默认提示词模板失败:', error);
  }
}

// 扩展启动时检查配置更新
chrome.runtime.onStartup.addListener(async () => {
  try {
    // 开发环境调试：显示当前扩展ID
    logExtensionIdForDevelopment();
    
    console.log('扩展启动，检查站点配置更新...');
    if (self.RemoteConfigManager) {
      const updateInfo = await self.RemoteConfigManager.autoCheckUpdate();
      console.log('启动时站点配置检查结果:', updateInfo);
      if (updateInfo && updateInfo.hasUpdate) {
        console.log('发现新版本站点配置，自动更新');
        // 自动更新配置
        await self.RemoteConfigManager.updateLocalConfig(updateInfo.config);
        console.log('启动时站点配置更新完成');
      } else {
        console.log('启动时站点配置无需更新，原因:', updateInfo?.reason || 'unknown');
      }
    } else {
      console.error('RemoteConfigManager 未加载');
    }
  } catch (error) {
    console.error('启动时检查更新失败:', error);
  }
});

// 扩展安装和更新时的统一处理
chrome.runtime.onInstalled.addListener(async (details) => {
  try {
    console.log('扩展事件触发:', details.reason, '版本:', details.previousVersion, '->', chrome.runtime.getManifest().version);
    
    // 开发环境调试：显示当前扩展ID
    logExtensionIdForDevelopment();
    
    // 初始化默认提示词模板
    await initializeDefaultPromptTemplates();
    
    // 检查配置更新
    if (self.RemoteConfigManager) {
      // 首次安装时，先从本地文件初始化配置
      if (details.reason === 'install') {
        console.log('首次安装，从本地文件初始化配置');
        await initializeLocalConfig();
      }
      
      // 然后检查远程配置更新
      console.log('开始检查站点配置更新...');
      const updateInfo = await self.RemoteConfigManager.autoCheckUpdate();
      console.log('站点配置检查结果:', updateInfo);
      
      if (updateInfo && updateInfo.hasUpdate) {
        if (details.reason === 'install') {
          console.log('首次安装，获取远程最新配置');
        } else if (details.reason === 'update') {
          console.log('扩展更新，自动更新站点配置');
        }
        console.log('开始更新站点配置...');
        await self.RemoteConfigManager.updateLocalConfig(updateInfo.config);
        console.log('站点配置更新完成');
      } else {
        if (details.reason === 'install') {
          console.log('首次安装，配置已是最新');
        } else if (details.reason === 'update') {
          console.log('扩展更新，配置无需更新，原因:', updateInfo?.reason || 'unknown');
        }
      }
    }
    
    // 获取当前存储的数据
    const { favoriteSites, buttonConfig } = await chrome.storage.sync.get(['favoriteSites', 'buttonConfig']);
    const { siteSettings } = await chrome.storage.sync.get(['siteSettings']);
    
    // 处理 sites 数据 - 将完整配置存储到 local，用户设置存储到 sync
    console.log('开始初始化站点配置');
    const defaultSites = await self.getDefaultSites();
    console.log('获取到的默认站点:', defaultSites);
    
    if (defaultSites && defaultSites.length > 0) {
      console.log('站点配置已加载，数量:', defaultSites.length);
      
      // 处理用户设置（enabled 状态）
      if (siteSettings && Object.keys(siteSettings).length > 0) {
        console.log('已加载用户设置');
      }
    } else {
      console.error('无法获取默认站点配置');
    }
    
    // 只在首次安装时初始化用户设置
    if (details.reason === 'install') {
      console.log('首次安装，初始化用户设置');
      
      // 标记为新用户（用于显示 pin 引导）
      await chrome.storage.local.set({ 
        pinGuideShown: false 
      });
      console.log('已标记为新用户（pinGuideShown: false）');
      
      // 处理 favoriteSites 数据
      if (!favoriteSites || !favoriteSites.length) {
        const defaultFavoriteSites = await self.AppConfigManager.getDefaultFavoriteSites();
        await chrome.storage.sync.set({ 
          favoriteSites: defaultFavoriteSites 
        });
        console.log('已初始化 favoriteSites:', defaultFavoriteSites);
      }

      // 处理 buttonConfig 数据
      if (!buttonConfig) {
        const defaultButtonConfig = await self.AppConfigManager.getButtonConfig();
        await chrome.storage.sync.set({ buttonConfig: defaultButtonConfig });
        console.log('已初始化 buttonConfig:', defaultButtonConfig);
      }

      // 首次安装后自动打开首页
      chrome.tabs.create({
        url: chrome.runtime.getURL('homepage/homepage.html')
      });
    } else if (details.reason === 'update') {
      console.log('扩展更新，保持用户设置不变');
      
      // 扩展更新时，只在必要时合并新配置
      if (buttonConfig) {
        const defaultButtonConfig = await self.AppConfigManager.getButtonConfig();
        // 检查是否有新的配置项需要添加
        const hasNewConfig = Object.keys(defaultButtonConfig).some(key => !(key in buttonConfig));
        if (hasNewConfig) {
          const mergedButtonConfig = {
            ...defaultButtonConfig,  // 使用默认配置作为基础
            ...buttonConfig          // 保持用户的现有设置
          };
          await chrome.storage.sync.set({ buttonConfig: mergedButtonConfig });
          console.log('已合并新配置项到 buttonConfig:', mergedButtonConfig);
        }
      }
    }
    
    // 创建右键菜单
    createContextMenu();
    
    console.log('Extension installed');
  } catch (error) {
    console.error('初始化失败:', error);
  }
});

// 在扩展启动时检查规则
chrome.declarativeNetRequest.getSessionRules().then(rules => {
  console.log('当前生效的规则:', rules);
});


// 如果规则为空，尝试动态添加规则
chrome.declarativeNetRequest.updateSessionRules({
  removeRuleIds: [999], // 先清除可能存在的规则 999
  addRules: [{
    "id": 999,
    "priority": 1,
    "action": {
      "type": "modifyHeaders",
      "responseHeaders": [
        {
          "header": "Sec-Fetch-Dest",
          "operation": "set",
          "value": "document"
        },
        {
          "header": "Sec-Fetch-Site",
          "operation": "set",
          "value": "same-origin"
        },
        {
          "header": "Sec-Fetch-Mode",
          "operation": "set",
          "value": "navigate"
        },
        {
          "header": "Sec-Fetch-User",
          "operation": "set",
          "value": "?1"
        },
        {
          "header": "content-security-policy",
          "operation": "remove"
        },
        {
          "header": "x-frame-options",
          "operation": "remove"
        }
      ]
    },
    "condition": {
      "urlFilter": "*://*/*",
      "resourceTypes": ["main_frame", "sub_frame"]
    }
  }]
}).then(() => {
  // 再次检查规则
  return chrome.declarativeNetRequest.getSessionRules();
}).then(rules => {
  console.log('更新后的规则:', rules);
});





// 处理右键菜单点击和消息
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "searchWithMultiAI" && info.selectionText) {
    openSearchTabs(info.selectionText);
  } else if (info.menuItemId === "openOptions") {
    // 打开选项页面
    chrome.tabs.create({
      url: chrome.runtime.getURL('options/options.html')
    });
  } else if (info.menuItemId === "openHistory") {
    // 打开历史记录页面
    chrome.tabs.create({
      url: chrome.runtime.getURL('history/history.html')
    });
  } else if (info.menuItemId === "openFavorites") {
    // 打开收藏记录页面
    chrome.tabs.create({
      url: chrome.runtime.getURL('favorites/favorites.html')
    });
  }
});

// 处理来自 float-button 和 popup 和 content-scripts 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('收到消息:', message);
  
  if (message.action === 'createComparisonPage') {
    console.log('createComparisonPage-opensearchtab:', message.query);
    openSearchTabs(message.query).then(() => {
      sendResponse({ success: true });
    }).catch(error => {
      console.error('创建对比页面失败:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true; // 保持消息通道开放
  } 
  else if (message.action === 'processQuery') {
    // 添加对 processQuery 消息的处理
    console.log('processQuery:', message.query, message.sites);
    openSearchTabs(message.query, message.sites).then(() => {
      sendResponse({ success: true });
    }).catch(error => {
      console.error('处理查询失败:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true; // 保持消息通道开放
  }
  else if (message.action === 'singleSiteSearch') {
    console.log('singleSiteSearch:', message.query, message.siteName);
    handleSingleSiteSearch(message.query, message.siteName).then(() => {
      sendResponse({ success: true });
    }).catch(error => {
      console.error('单站点搜索失败:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true; // 保持消息通道开放
  }
  else if (message.action === 'openOptionsPage') {
    // 立即打开设置页面
    chrome.tabs.create({
      url: chrome.runtime.getURL('options/options.html')
    });
    sendResponse({ success: true });
  }
  else if (message.action === 'initializeDefaultTemplates') {
    // 手动触发默认提示词模板初始化
    initializeDefaultPromptTemplates().then(() => {
      sendResponse({ success: true });
    }).catch(error => {
      console.error('手动初始化默认模板失败:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true; // 保持消息通道开放
  }
  else if (message.type === 'TOGGLE_SIDE_PANEL') {
    // 处理侧边栏切换消息
    const windowId = sender.tab.windowId;
    console.log('🔍 收到TOGGLE_SIDE_PANEL消息，windowId:', windowId);
    
    // 在打开侧边栏之前，设置路径并添加 side_panel 参数
    // 注意：setOptions 必须在用户手势响应中同步调用，且不能包含 windowId
    if (chrome.sidePanel && chrome.sidePanel.setOptions) {
      try {
        chrome.sidePanel.setOptions({
          path: 'homepage/homepage.html?side_panel=true',
          enabled: true
        });
        console.log('✅ 已设置侧边栏路径（带 side_panel 参数）');
      } catch (setOptionsError) {
        console.warn('⚠️ 设置侧边栏路径失败，使用默认路径:', setOptionsError);
      }
    }
    
    // 同步调用 sidePanel.open()，保持用户手势上下文
    if (chrome.sidePanel && chrome.sidePanel.open) {
      chrome.sidePanel.open({ windowId }).then(() => {
        sidePanelOpenState.set(windowId, true);
        console.log('✅ 侧边栏已打开');
      }).catch((error) => {
        console.error('❌ 打开侧边栏失败:', error);
        sidePanelOpenState.set(windowId, false);
      });
    } else {
      console.error('❌ 当前浏览器不支持 sidePanel API');
    }
    
    // 立即返回成功响应
    sendResponse({ success: true });
    return true; // 保持消息通道开放
  }
});

// 处理来自 iframe 的消息
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.action === 'executeHandler') {
    const siteHandler = await getHandlerForUrl(message.url);
    if (siteHandler && siteHandler.searchHandler) {
      executeSiteHandler(sender.tab.id, message.query, siteHandler).catch(error => {
        console.error('站点处理失败:', error);
      });
    }
  }
});





// 站点处理函数集合
// 站点处理函数已迁移到 siteHandlers.json 中的 searchHandler 字段

// 执行站点处理函数 - 使用配置化处理器
async function executeSiteHandler(tabId, query, siteHandler) {
  try {
    console.log(`开始处理 ${siteHandler.name} 站点, tabId:`, tabId);
    console.log('待发送的查询:', query);
    
    // 先激活标签页
    await chrome.tabs.update(tabId, { active: true });
    const tab = await chrome.tabs.get(tabId);
    console.log('标签页状态:', {
      id: tab.id,
      url: tab.url,
      status: tab.status,
      active: tab.active
    });

    try {
      // 给页面一点加载时间
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // 使用配置化处理器 - 发送消息到页面的 inject.js
      await chrome.tabs.sendMessage(tabId, {
        type: 'search',
        query: query,
        domain: new URL(tab.url).hostname
      });
      
      console.log('已发送配置化处理消息到页面');
    } catch (scriptError) {
      console.error('发送配置化处理消息失败:', scriptError);
      throw scriptError;
    }
  } catch (error) {
    console.error(`${siteHandler.name} 处理过程出错:`, error);
    throw error;
  }
}

// 根据 URL 获取处理函数
async function getHandlerForUrl(url) {
  try {
    // 确保 URL 是有效的
    if (!url) {
      console.error('URL 为空');
      return null;
    }

    // 如果 URL 不包含协议，添加 https://
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    console.log('处理URL:', url);
    const hostname = new URL(url).hostname;
    console.log('当前网站:', hostname);
    
    // 优先使用新的统一站点检测器
    if (self.siteDetector) {
      const siteHandler = await self.siteDetector.getSiteHandler(hostname);
      if (siteHandler) {
        console.log(`✅ 使用新检测器找到站点配置: ${siteHandler.name}`);
        return {
          name: siteHandler.name,
          searchHandler: siteHandler.searchHandler,
          supportUrlQuery: siteHandler.supportUrlQuery
        };
      }
    }
    
    // 降级到原有逻辑
    let sites = [];
    try {
      const result = await chrome.storage.local.get('remoteSiteHandlers');
      sites = result.remoteSiteHandlers?.sites || [];
    } catch (error) {
      console.error('从 remoteSiteHandlers 读取配置失败:', error);
    }
    
    // 如果存储中没有数据，尝试从远程配置获取
    if (!sites || sites.length === 0) {
      console.log('remoteSiteHandlers 中无数据，尝试从远程配置获取...');
      if (self.RemoteConfigManager) {
        sites = await self.RemoteConfigManager.getCurrentSites();
      }
    }
    
    if (!sites || sites.length === 0) {
      console.warn('没有找到站点配置');
      return null;
    }
    
    // 查找匹配的站点
    for (const site of sites) {
      if (!site.url) continue;
      
      try {
        const siteUrl = new URL(site.url);
        const siteDomain = siteUrl.hostname;
        
        // 直接匹配域名
        if (hostname === siteDomain) {
          console.log('找到匹配站点:', site.name);
          return {
            name: site.name,
            searchHandler: site.searchHandler,
            supportUrlQuery: site.supportUrlQuery
          };
        }
        
        // 模糊匹配域名
        if (hostname.includes(siteDomain) || siteDomain.includes(hostname)) {
          console.log('找到匹配站点:', site.name);
          return {
            name: site.name,
            searchHandler: site.searchHandler,
            supportUrlQuery: site.supportUrlQuery
          };
        }
      } catch (urlError) {
        // 如果URL解析失败，跳过这个站点
        continue;
      }
    }
    
    console.log('未找到对应的处理函数');
    return null;
  } catch (error) {
    console.error('URL 解析失败:', error, 'URL:', url);
    return null;
  }
}

  // 处理单站点搜索
  async function handleSingleSiteSearch(query, siteName) {
    console.log('开始处理单站点搜索:', query, siteName);

  try {
    console.log('handleSingleSiteSearch处理单站点搜索:', query, siteName);
    const sites = await self.getDefaultSites();
    if (!sites || !sites.length) {
      console.error('未找到站点配置');
      return;
    }
    const siteConfig = sites.find(site => site.name === siteName);
    if (!siteConfig) {
      console.error('未找到站点配置:', siteName);
      return;
    }
    
    // 检查站点是否被隐藏
    if (siteConfig.hidden) {
      console.error('站点已被隐藏，无法使用:', siteName);
      return;
    }

      // 判断是否支持URL拼接查询
      if (siteConfig.supportUrlQuery) {
        // URL 拼接方式的站点,直接打开新标签页
      const url = siteConfig.url.replace('{query}', encodeURIComponent(query));
        console.log('使用URL拼接方式打开:', url);
      await chrome.tabs.create({ url, active: true });
      } else {
        // 需要脚本控制的站点
        console.log('使用脚本控制方式打开:', siteConfig.url);
        const tab = await chrome.tabs.create({ url: siteConfig.url, active: true });
        
        // 等待标签页加载完成
        await new Promise((resolve) => {
          const listener = (tabId, info) => {
            if (tabId === tab.id && info.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
        });
        
        // 执行对应站点的处理函数
        await executeSiteHandler(tab.id, query, {
          name: siteConfig.name,
          searchHandler: siteConfig.searchHandler,
          supportUrlQuery: siteConfig.supportUrlQuery
        });
      }
  } catch (error) {
    console.error('单站点搜索失败:', error);
  }
}

// 修改后的 openSearchTabs 函数
async function openSearchTabs(query, checkedSites = null) {
  console.log('开始执行多AI查询 查询词:', query);
  const sites = await self.getDefaultSites();
  
  if (!sites || !sites.length) {
    console.error('未找到AI站点配置');
    return;
  }
  
  // 首先检查是否有符合条件的站点

  const result = checkedSites 
    ? sites.filter(site => checkedSites.includes(site.name) && !site.hidden)
    : sites.filter(site => site.enabled && !site.hidden);
    
  console.log('符合条件的站点:', result);

  // 过滤出支持 iframe 的站点
  const iframeSites = result.filter(site => 
      site.supportIframe === true
  );

  if (iframeSites.length > 0) {
      console.log('找到支持 iframe 的启用站点:', iframeSites);
      
      const newTab = await chrome.tabs.create({
          url: chrome.runtime.getURL(`iframe/iframe.html?query=${encodeURIComponent(query)}`),
          active: true
      });

      // 等待新标签页加载完成
      chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
          if (tabId === newTab.id && info.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              
              // 向新标签页发送消息,传递查询词和需要加载的站点信息
              chrome.tabs.sendMessage(newTab.id, {
                  type: 'loadIframes',
                  query: query,
                  sites: iframeSites
              });
          }
      });
  }
}

// 获取网站的基本域名
function getBaseDomain(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return hostname;
  //  const parts = hostname.split('.');
  //  return parts.slice(-2).join('.');
  } catch (e) {
    console.error('URL解析失败:', url);
    return url;
  }
}

// 查找已存在的标签页
function findExistingTab(tabs, targetDomain) {
  return tabs.find(tab => {
    try {
      return getBaseDomain(tab.url) === targetDomain;
    } catch (e) {
      return false;
    }
  });
} 

// 处理扩展图标点击事件
chrome.action.onClicked.addListener((tab) => {
  // 打开新标签页显示精简首页 homepage.html
  chrome.tabs.create({
    url: chrome.runtime.getURL('homepage/homepage.html')
  });
});


// 错误处理监听器已移除，避免干扰其他消息处理

// 添加基本的生命周期处理
self.addEventListener('install', (event) => {
    console.log('Service Worker 安装');
});

self.addEventListener('activate', (event) => {
    console.log('Service Worker 激活');
});

// 添加错误处理
self.addEventListener('error', (error) => {
    console.error('Service Worker 错误:', error);
});

// 捕获未处理的 Promise rejection
self.addEventListener('unhandledrejection', (event) => {
    // 忽略 "No SW" 错误，这是 Chrome 扩展的正常行为
    if (event.reason && event.reason.message && event.reason.message.includes('No SW')) {
        // 静默处理，不输出错误
        event.preventDefault();
        return;
    }
    console.error('未处理的 Promise rejection:', event.reason);
    event.preventDefault(); // 防止错误显示在控制台
});


// 防抖变量，避免短时间内多次调用
let contextMenuTimeout = null;

// 创建右键菜单
async function createContextMenu() {
  // 清除之前的定时器
  if (contextMenuTimeout) {
    clearTimeout(contextMenuTimeout);
  }
  
  // 设置防抖延迟
  contextMenuTimeout = setTimeout(async () => {
    try {
      // 先移除所有现有菜单，然后创建新菜单
      // 这样可以避免重复创建的问题
      await chrome.contextMenus.removeAll();
      
      // 创建扩展图标上的右键菜单（选项、历史记录、收藏记录）
      chrome.contextMenus.create({
        id: "openOptions",
        title: chrome.i18n.getMessage("settingsLink") || "选项",
        contexts: ["action"]  // 在扩展图标上右键时显示
      });
      
      chrome.contextMenus.create({
        id: "openHistory",
        title: chrome.i18n.getMessage("historyLink") || "历史记录",
        contexts: ["action"]  // 在扩展图标上右键时显示
      });
      
      chrome.contextMenus.create({
        id: "openFavorites",
        title: chrome.i18n.getMessage("favoritesLink") || "收藏记录",
        contexts: ["action"]  // 在扩展图标上右键时显示
      });
      
      // 获取配置
      const { buttonConfig } = await chrome.storage.sync.get('buttonConfig');
      
      // 检查是否启用页面右键菜单（选中文本时的菜单）
      if (buttonConfig && buttonConfig.contextMenu) {
        // 创建页面上的右键菜单（选中文本时显示）
        chrome.contextMenus.create({
          id: "searchWithMultiAI",
          title: chrome.i18n.getMessage("searchWithMultiAI"),
          contexts: ["selection"]  // 只在选中文本时显示
        });
        console.log('页面右键菜单已创建');
      }
      
      console.log('扩展图标右键菜单已创建');
    } catch (error) {
      console.error('创建右键菜单失败:', error);
    }
  }, 100); // 100ms 防抖延迟
}

// 监听存储变化，当配置更改时更新右键菜单
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync' && changes.buttonConfig) {
    createContextMenu();
  }
});



// 监听扩展卸载事件
chrome.runtime.setUninstallURL(self.externalLinks?.uninstallSurvey || '', () => {
  if (chrome.runtime.lastError) {
    console.error('设置卸载 URL 失败:', chrome.runtime.lastError);
  }
});

// 跟踪侧边栏状态
let sidePanelOpenState = new Map();

// 重置侧边栏状态的函数
function resetSidePanelState(windowId) {
  console.log('重置侧边栏状态，windowId:', windowId);
  sidePanelOpenState.set(windowId, false);
}



// Omnibox 事件处理
chrome.omnibox.onInputChanged.addListener((text, suggest) => {
  console.log('Omnibox 输入变化:', text);
  
  // 提供搜索建议
  const suggestions = [
    {
      content: `ai ${text}`,
      description: `🔍 使用AI快捷键搜索: ${text}`
    }
  ];
  
  suggest(suggestions);
});

chrome.omnibox.onInputEntered.addListener((text, disposition) => {
  console.log('Omnibox 输入确认:', text, disposition);
  
  // 解析输入文本
  const query = text.replace(/^ai\s+/, '').trim();
  
  if (query) {
    // 打开AI快捷键搜索页面
    const searchUrl = chrome.runtime.getURL(`iframe/iframe.html?query=${encodeURIComponent(query)}`);
    
    if (disposition === 'currentTab') {
      // 在当前标签页打开
      chrome.tabs.update({ url: searchUrl });
    } else {
      // 在新标签页打开
      chrome.tabs.create({ url: searchUrl });
    }
  } else {
    // 如果没有查询内容，直接打开AI快捷键页面
    const defaultUrl = chrome.runtime.getURL('iframe/iframe.html');
    
    if (disposition === 'currentTab') {
      chrome.tabs.update({ url: defaultUrl });
    } else {
      chrome.tabs.create({ url: defaultUrl });
    }
  }
});
