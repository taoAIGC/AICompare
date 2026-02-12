
// 避免重复声明的检查
if ((typeof window !== 'undefined' && window.BaseConfigLoaded) || 
    (typeof self !== 'undefined' && self.BaseConfigLoaded)) {
  console.log('baseConfig.js 已经加载，跳过重复声明');
} else {

// 开发环境配置
const DEV_CONFIG = {
  IS_PRODUCTION: true,  // 开发时设为 false，发布时设为 true
  SKIP_REMOTE_CONFIG: true,  // 开发时跳过远程配置，直接使用本地文件
  ENABLE_CONFIG_CACHE: false, // 开发时禁用配置缓存，确保修改立即生效
  FORCE_LOCAL_CONFIG: true,   // 开发时强制使用本地配置文件
  ENABLE_SITE_BUTTON: false  // site-button 是否生效的开关

};

// 生产环境 console 重写（仅在 production 模式下）
if (DEV_CONFIG.IS_PRODUCTION) {
  console.log = function() { return undefined; };
  console.warn = function() { return undefined; };
  console.error = function() { return undefined; };
  console.info = function() { return undefined; };
  console.debug = function() { return undefined; };
}

// 应用配置管理器
const AppConfigManager = {
  _config: null,
  
  // 加载配置文件
  async loadConfig() {
    if (this._config) {
      return this._config;
    }
    
    try {
      const response = await fetch(chrome.runtime.getURL('config/appConfig.json'));
      if (!response.ok) {
        throw new Error(`加载配置文件失败: HTTP ${response.status}`);
      }
      this._config = await response.json();
      console.log('应用配置加载成功');
      return this._config;
    } catch (error) {
      console.error('加载应用配置失败:', error);
      throw new Error(`无法加载应用配置文件: ${error.message}`);
    }
  },
  
  // 获取默认收藏站点
  async getDefaultFavoriteSites() {
    const config = await this.loadConfig();
    return config.defaultFavoriteSites || [];
  },
  
  // 获取默认模式设置
  async getDefaultModes() {
    const config = await this.loadConfig();
    return config.defaultModes || {};
  },
  
  // 获取按钮配置
  async getButtonConfig() {
    const config = await this.loadConfig();
    return config.buttonConfig || {};
  },
  
  // 获取外部链接配置
  async getExternalLinks() {
    const config = await this.loadConfig();
    return config.externalLinks || {};
  },
  
  // 获取支持的文件类型
  async getSupportedFileTypes() {
    const config = await this.loadConfig();
    return config.supportedFileTypes || {};
  },
  
  // 获取所有支持的文件类型（扁平数组）
  async getAllSupportedFileTypes() {
    const config = await this.loadConfig();
    const supportedFileTypes = config.supportedFileTypes;
    
    if (!supportedFileTypes || !supportedFileTypes.categories) {
      return ['Files', 'application/octet-stream', 'image/png', 'image/jpeg', 'text/plain'];
    }
    
    // 将所有分类中的文件类型合并为一个数组
    const allTypes = [];
    Object.values(supportedFileTypes.categories).forEach(category => {
      if (category.types && Array.isArray(category.types)) {
        allTypes.push(...category.types);
      }
    });
    
    // 去重并返回
    return [...new Set(allTypes)];
  },
  
  // 获取 MIME 类型到文件扩展名的映射
  async getMimeToExtensionMappings() {
    const config = await this.loadConfig();
    const supportedFileTypes = config.supportedFileTypes;
    
    return supportedFileTypes?.mimeToExtension?.mappings || {};
  },
  
  // 根据 MIME 类型获取文件扩展名
  async getFileExtensionByMimeType(mimeType) {
    const mappings = await this.getMimeToExtensionMappings();
    return mappings[mimeType] || 'unknown';
  },
  
  // 智能生成文件名
  async generateFileName(originalName, mimeType, fallbackPrefix = 'clipboard') {
    // 如果有原始文件名且包含扩展名，直接使用
    if (originalName && originalName.includes('.')) {
      return originalName;
    }
    
    // 获取正确的文件扩展名
    const extension = await this.getFileExtensionByMimeType(mimeType);
    
    // 使用原始文件名（如果有）或生成时间戳名称
    const baseName = originalName || `${fallbackPrefix}-${Date.now()}`;
    
    // 确保有正确的扩展名
    if (extension === 'unknown') {
      return baseName;
    }
    
    return `${baseName}.${extension}`;
  }
};

// 版本号比较函数
function compareVersions(version1, version2) {
  // 如果版本号相同，返回 0
  if (version1 === version2) {
    return 0;
  }
  
  // 处理时间戳格式的版本号
  if (typeof version1 === 'number' && typeof version2 === 'number') {
    return version1 > version2 ? 1 : -1;
  }
  
  // 处理语义化版本号 (如 "1.2.3", "2.0.0")
  const parseVersion = (version) => {
    if (typeof version === 'string') {
      // 移除 'v' 前缀
      const cleanVersion = version.replace(/^v/, '');
      // 分割版本号
      const parts = cleanVersion.split('.').map(part => {
        // 处理预发布版本 (如 "1.0.0-beta")
        const match = part.match(/^(\d+)(.*)$/);
        return {
          number: parseInt(match ? match[1] : part, 10) || 0,
          suffix: match ? match[2] : ''
        };
      });
      return parts;
    }
    // 如果不是字符串，转换为数组格式
    return [{ number: parseInt(version, 10) || 0, suffix: '' }];
  };
  
  const v1Parts = parseVersion(version1);
  const v2Parts = parseVersion(version2);
  
  // 比较版本号部分
  const maxLength = Math.max(v1Parts.length, v2Parts.length);
  
  for (let i = 0; i < maxLength; i++) {
    const v1Part = v1Parts[i] || { number: 0, suffix: '' };
    const v2Part = v2Parts[i] || { number: 0, suffix: '' };
    
    // 比较数字部分
    if (v1Part.number !== v2Part.number) {
      return v1Part.number > v2Part.number ? 1 : -1;
    }
    
    // 比较后缀部分（如果有）
    if (v1Part.suffix !== v2Part.suffix) {
      // 预发布版本 < 正式版本
      if (v1Part.suffix === '' && v2Part.suffix !== '') {
        return 1;
      }
      if (v1Part.suffix !== '' && v2Part.suffix === '') {
        return -1;
      }
      // 都是预发布版本，按字符串比较
      return v1Part.suffix > v2Part.suffix ? 1 : -1;
    }
  }
  
  return 0;
}

// 远程配置更新功能（仅更新配置数据，不更新代码）
const RemoteConfigManager = {
  // 远程配置服务器 - 根据环境选择不同的URL
  get configUrl() {
    // 如果 DEV_CONFIG 对象存在，使用环境配置
    if (typeof DEV_CONFIG !== 'undefined' && DEV_CONFIG.REMOTE_CONFIG_URL) {
      return DEV_CONFIG.IS_PRODUCTION 
        ? 'https://raw.githubusercontent.com/taoAIGC/AI-Shortcuts/main/config/siteHandlers.json'
        : DEV_CONFIG.REMOTE_CONFIG_URL;
    }
    // 否则使用默认的生产环境URL
    return 'https://raw.githubusercontent.com/taoAIGC/AI-Shortcuts/main/config/siteHandlers.json';
  },
  
  // 检查并更新配置
  async checkAndUpdateConfig() {
    try {
      const response = await fetch(this.configUrl);
      if (!response.ok) {
        throw new Error(`配置服务器错误: ${response.status}`);
      }
      
      const remoteConfig = await response.json();
      const remoteVersion = remoteConfig.version || Date.now();
      
      // 获取本地版本
      const localVersion = await this.getLocalVersion();
      
      
      // 使用版本号比较函数
      const versionComparison = compareVersions(remoteVersion, localVersion);
      
      if (versionComparison > 0) {
        console.log(`发现新版本的站点配置 (${localVersion} -> ${remoteVersion})，准备更新...`);
        
        // 更新本地存储的配置
        await this.updateLocalConfig(remoteConfig);
        
        return {
          hasUpdate: true,
          config: remoteConfig,
          version: remoteVersion,
          oldVersion: localVersion,
          versionComparison: versionComparison
        };
      } else if (versionComparison < 0) {
        console.log(`远程版本 (${remoteVersion}) 比本地版本 (${localVersion}) 旧，跳过更新`);
        return { 
          hasUpdate: false, 
          reason: 'remote_older',
          remoteVersion: remoteVersion,
          localVersion: localVersion
        };
      } else {
        console.log(`版本号相同 (${remoteVersion})，无需更新`);
        return { 
          hasUpdate: false, 
          reason: 'same_version',
          version: remoteVersion
        };
      }
    } catch (error) {
      console.error('检查配置更新失败:', error);
      return { hasUpdate: false, error: error.message };
    }
  },
  
  // 获取本地版本
  async getLocalVersion() {
    try {
      // 1. 优先从存储中获取版本
      const result = await chrome.storage.local.get('siteConfigVersion');
      if (result.siteConfigVersion) {
        return result.siteConfigVersion;
      }
      
      // 2. 如果存储中没有版本，尝试从本地文件获取
      console.log('存储中无版本信息，尝试从本地文件获取版本...');
      try {
        const response = await fetch(chrome.runtime.getURL('config/siteHandlers.json'));
        if (response.ok) {
          const localConfig = await response.json();
          if (localConfig.version) {
            console.log('从本地文件获取版本:', localConfig.version);
            return localConfig.version;
          }
        }
      } catch (error) {
        console.error('从本地文件获取版本失败:', error);
      }
      
      return 0;
    } catch (error) {
      console.error('获取本地版本失败:', error);
      return 0;
    }
  },
  
  // 更新本地配置
  async updateLocalConfig(remoteConfig) {
    try {
      const currentTime = Date.now();
      
      // 获取现有的更新历史
      const { updateHistory = [], remoteSiteHandlers: oldConfig } = await chrome.storage.local.get(['updateHistory', 'remoteSiteHandlers']);
      
      // 计算站点变化
      let newSites = 0;
      let updatedSites = 0;
      
      if (oldConfig && oldConfig.sites && remoteConfig.sites) {
        const oldSites = oldConfig.sites;
        const newSitesList = remoteConfig.sites;
        
        // 计算新增站点
        newSites = newSitesList.filter(newSite => 
          !oldSites.some(oldSite => oldSite.name === newSite.name)
        ).length;
        
        // 计算更新站点（URL或配置有变化的站点）
        updatedSites = newSitesList.filter(newSite => {
          const oldSite = oldSites.find(oldSite => oldSite.name === newSite.name);
          if (!oldSite) return false;
          
          // 比较关键配置字段
          return oldSite.url !== newSite.url ||
                 oldSite.supportIframe !== newSite.supportIframe ||
                 oldSite.supportUrlQuery !== newSite.supportUrlQuery ||
                 JSON.stringify(oldSite.handler) !== JSON.stringify(newSite.handler);
        }).length;
      } else if (remoteConfig.sites) {
        // 首次安装或没有旧配置
        newSites = remoteConfig.sites.length;
      }
      
      // 创建更新记录
      const updateRecord = {
        timestamp: currentTime,
        version: remoteConfig.version || currentTime,
        newSites: newSites,
        updatedSites: updatedSites,
        totalSites: remoteConfig.sites ? remoteConfig.sites.length : 0,
        oldVersion: oldConfig ? (oldConfig.version || 'unknown') : 'unknown'
      };
      
      // 添加到更新历史（保留最近10次更新记录）
      const newUpdateHistory = [...updateHistory, updateRecord].slice(-10);
      
      await chrome.storage.local.set({
        siteConfigVersion: remoteConfig.version || currentTime,
        remoteSiteHandlers: remoteConfig,
        lastUpdateTime: currentTime,  // 记录更新时间，供 iframe 页面检测
        updateNotificationShown: false,  // 重置通知显示状态，允许显示新的更新提示
        updateHistory: newUpdateHistory  // 保存更新历史
      });
      
      console.log('本地配置已更新，最新版本号:', remoteConfig.version || currentTime);
      console.log('站点数量:', remoteConfig.sites ? remoteConfig.sites.length : 0);
      console.log('更新统计:', {
        新增站点: newSites,
        更新站点: updatedSites,
        总站点数: remoteConfig.sites ? remoteConfig.sites.length : 0
      });
    } catch (error) {
      console.error('更新本地配置失败:', error);
    }
  },
  
  // 获取当前站点处理器
  async getCurrentSiteHandlers() {
    try {
      const result = await chrome.storage.local.get('remoteSiteHandlers');
      if (result.remoteSiteHandlers && result.remoteSiteHandlers.siteHandlers) {
        return result.remoteSiteHandlers.siteHandlers;
      }
      console.warn('未找到远程站点处理器配置');
      return {};
    } catch (error) {
      console.error('获取当前站点处理器失败:', error);
      return {};
    }
  },
  
  // 获取当前站点列表
  async getCurrentSites() {
    try {
      const result = await chrome.storage.local.get('remoteSiteHandlers');
      if (result.remoteSiteHandlers && result.remoteSiteHandlers.sites) {
        return result.remoteSiteHandlers.sites;
      }
      console.warn('未找到远程站点配置');
      return [];
    } catch (error) {
      console.error('获取当前站点列表失败:', error);
      return [];
    }
  },
  
  // 自动检查更新
  async autoCheckUpdate() {
    return await this.checkAndUpdateConfig();
  }
};

// Service Worker环境
if (typeof window === 'undefined') {
  const language = navigator.language.toLowerCase();
  console.log('当前语言:', language);
  // 站点配置现在通过 getDefaultSites() 动态获取
   
  // 动态获取站点配置
  self.getDefaultSites = async function() {
    try {
      
      //1 从 remoteSiteHandlers 读取基础配置
      console.log('尝试从 remoteSiteHandlers 读取站点配置...');
      let baseSites = [];
      try {
        const result = await chrome.storage.local.get('remoteSiteHandlers');
        if (result.remoteSiteHandlers && result.remoteSiteHandlers.sites && result.remoteSiteHandlers.sites.length > 0) {
          baseSites = result.remoteSiteHandlers.sites;
          console.log('从 remoteSiteHandlers 加载站点配置成功');
          console.log('remoteSiteHandlers 加载的站点配置:', baseSites.map(site => ({ name: site.name, enabled: site.enabled })));
        }
      } catch (error) {
        console.error('从 remoteSiteHandlers 读取配置失败:', error);
      }
      
      // 2. 从 chrome.storage.sync 读取用户设置（顺序、启用状态等）
      let userSettings = {};
      try {
        const { sites: userSiteSettings = {} } = await chrome.storage.sync.get('sites');
        userSettings = userSiteSettings;
        console.log('从 chrome.storage.sync 加载用户设置成功');
        console.log('chrome.storage.sync 加载的用户设置:', Object.keys(userSettings).map(name => ({ name, enabled: userSettings[name]?.enabled })));
      } catch (error) {
        console.error('从 chrome.storage.sync 读取用户设置失败:', error);
      }
      
      // 3. 合并配置：基础配置 + 用户设置
      if (baseSites && baseSites.length > 0) {
        const mergedSites = baseSites.map(site => {
          const userSiteData = userSettings[site.name] || {};
          return {
            ...site,
            order: userSiteData.order !== undefined ? userSiteData.order : site.order,
            enabled: userSiteData.enabled !== undefined ? userSiteData.enabled : site.enabled
          };
        });
        
        // 按用户设置的顺序排序
        mergedSites.sort((a, b) => {
          const orderA = a.order !== undefined ? a.order : 999;
          const orderB = b.order !== undefined ? b.order : 999;
          return orderA - orderB;
        });
        
        console.log('合并配置成功，站点数量:', mergedSites.length);
        console.log('合并配置成功，站点配置:', mergedSites.map(site => ({ name: site.name, enabled: site.enabled })));
        return mergedSites;
      }
      
      // 4. 如果远程配置不可用，尝试从本地文件加载
      console.log('remoteSiteHandlers 中无数据，尝试从本地文件加载...');
      try {
        const response = await fetch(chrome.runtime.getURL('config/siteHandlers.json'));
        if (response.ok) {
          const localConfig = await response.json();
          if (localConfig.sites && localConfig.sites.length > 0) {
            console.log('从本地文件加载站点配置成功');
            return localConfig.sites;
          }
        }
      } catch (error) {
        console.error('从本地文件加载配置失败:', error);
      }
      
      console.warn('无法获取站点配置，返回空数组');
      return [];
    } catch (error) {
      console.error('获取默认站点配置失败:', error);
      return [];
    }
  };

  self.AppConfigManager = AppConfigManager;
  self.RemoteConfigManager = RemoteConfigManager;
  
  // 开发环境配置切换函数
  self.toggleDevMode = function() {
    DEV_CONFIG.SKIP_REMOTE_CONFIG = !DEV_CONFIG.SKIP_REMOTE_CONFIG;
    console.log(`🔄 开发模式切换: ${DEV_CONFIG.SKIP_REMOTE_CONFIG ? '启用' : '禁用'}本地配置优先`);
    return DEV_CONFIG.SKIP_REMOTE_CONFIG;
  };
  
  // 获取当前开发环境状态
  self.getDevModeStatus = function() {
    return {
      isProduction: DEV_CONFIG.IS_PRODUCTION,
      skipRemoteConfig: DEV_CONFIG.SKIP_REMOTE_CONFIG,
      enableConfigCache: DEV_CONFIG.ENABLE_CONFIG_CACHE,
      forceLocalConfig: DEV_CONFIG.FORCE_LOCAL_CONFIG
    };
  };
}
// 浏览器环境
else {
  const language = navigator.language.toLowerCase();
  console.log('当前语言:', language);
  
  // 动态获取站点配置
  window.getDefaultSites = async function() {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.runtime) {
        console.warn('⚠️ chrome API 不可用，返回空站点列表');
        return [];
      }
      
      // 生产环境：从 remoteSiteHandlers 读取基础配置
      let baseSites = [];
      try {
        if (chrome.storage?.local) {
          const result = await chrome.storage.local.get('remoteSiteHandlers');
          if (result.remoteSiteHandlers && result.remoteSiteHandlers.sites && result.remoteSiteHandlers.sites.length > 0) {
            baseSites = result.remoteSiteHandlers.sites;
            console.log('从 remoteSiteHandlers 加载站点配置成功');
          }
        }
      } catch (error) {
        console.error('从 remoteSiteHandlers 读取配置失败:', error);
      }
      
      // 2. 从 chrome.storage.sync 读取用户设置（顺序、启用状态等）
      let userSettings = {};
      try {
        if (chrome.storage?.sync) {
          const { sites: userSiteSettings = {} } = await chrome.storage.sync.get('sites');
          userSettings = userSiteSettings;
          console.log('从 chrome.storage.sync 加载用户设置成功');
        }
      } catch (error) {
        console.error('从 chrome.storage.sync 读取用户设置失败:', error);
      }
      
      // 3. 合并配置：基础配置 + 用户设置
      if (baseSites && baseSites.length > 0) {
        const mergedSites = baseSites.map(site => {
          const userSiteData = userSettings[site.name] || {};
          return {
            ...site,
            order: userSiteData.order !== undefined ? userSiteData.order : site.order,
            enabled: userSiteData.enabled !== undefined ? userSiteData.enabled : site.enabled
          };
        });
        
        // 按用户设置的顺序排序
        mergedSites.sort((a, b) => {
          const orderA = a.order !== undefined ? a.order : 999;
          const orderB = b.order !== undefined ? b.order : 999;
          return orderA - orderB;
        });
        
        console.log('合并配置成功，站点数量:', mergedSites.length);
        return mergedSites;
      }
      
      // 4. 如果远程配置不可用，尝试从本地文件加载
      try {
        if (chrome.runtime?.getURL) {
          const response = await fetch(chrome.runtime.getURL('config/siteHandlers.json'));
          if (response.ok) {
            const localConfig = await response.json();
            if (localConfig.sites && localConfig.sites.length > 0) {
              console.log('从本地文件加载站点配置成功');
              return localConfig.sites;
            }
          }
        }
      } catch (error) {
        console.error('从本地文件加载配置失败:', error);
      }
      
      return [];
    } catch (error) {
      console.error('获取默认站点配置失败:', error);
      return [];
    }
  };
  
  window.AppConfigManager = AppConfigManager;
  window.RemoteConfigManager = RemoteConfigManager;
  
  // 开发环境配置切换函数
  window.toggleDevMode = function() {
    DEV_CONFIG.SKIP_REMOTE_CONFIG = !DEV_CONFIG.SKIP_REMOTE_CONFIG;
    console.log(`🔄 开发模式切换: ${DEV_CONFIG.SKIP_REMOTE_CONFIG ? '启用' : '禁用'}本地配置优先`);
    return DEV_CONFIG.SKIP_REMOTE_CONFIG;
  };
  
  // 获取当前开发环境状态
  window.getDevModeStatus = function() {
    return {
      isProduction: DEV_CONFIG.IS_PRODUCTION,
      skipRemoteConfig: DEV_CONFIG.SKIP_REMOTE_CONFIG,
      enableConfigCache: DEV_CONFIG.ENABLE_CONFIG_CACHE,
      forceLocalConfig: DEV_CONFIG.FORCE_LOCAL_CONFIG,
      enableSiteButton: DEV_CONFIG.ENABLE_SITE_BUTTON
    };
  };
  
  // 暴露 ENABLE_SITE_BUTTON 配置到 window 对象
  window.ENABLE_SITE_BUTTON = DEV_CONFIG.ENABLE_SITE_BUTTON;
  
  // 标记配置已加载，避免重复声明
  if (typeof window !== 'undefined') {
    window.BaseConfigLoaded = true;
  } else if (typeof self !== 'undefined') {
    self.BaseConfigLoaded = true;
  }
}

} // 结束重复声明检查的 else 块
