
// 避免重复声明的检查
if ((typeof window !== 'undefined' && window.BaseConfigLoaded) || 
    (typeof self !== 'undefined' && self.BaseConfigLoaded)) {
  console.log('baseConfig.js 已经加载，跳过重复声明');
} else {

// 开发环境配置
const DEV_CONFIG = {
  IS_PRODUCTION: true,  // 开发时设为 false，发布时设为 true
  SKIP_REMOTE_CONFIG: false,  // 需要时可切回本地配置优先
  ENABLE_CONFIG_CACHE: false, // 开发时禁用配置缓存，确保修改立即生效
  FORCE_LOCAL_CONFIG: false,   // 需要时可强制使用本地配置文件
  ENABLE_SITE_BUTTON: false  // site-button 是否生效的开关

};

const REMOTE_SITE_HANDLERS_URL = 'https://raw.githubusercontent.com/taoAIGC/AI-Shortcuts/main/config/siteHandlers.json';

const DEV_BRANDING_ENABLED = DEV_CONFIG.IS_PRODUCTION === false;
const DEFAULT_BRAND_ICON_PATHS = Object.freeze({
  16: 'icons/icon16.png',
  48: 'icons/icon48.png',
  128: 'icons/icon128.png'
});
const DEV_BRAND_ACTION_ICON_PATHS = Object.freeze({
  16: 'icons/dev-icon16.png',
  32: 'icons/dev-icon32.png',
  48: 'icons/dev-icon48.png',
  128: 'icons/dev-icon128.png'
});

function getCurrentExtensionId() {
  try {
    return chrome?.runtime?.id || '';
  } catch (_) {
    return '';
  }
}

function isDevelopmentExtensionId(extensionId = getCurrentExtensionId()) {
  return DEV_BRANDING_ENABLED;
}

function getBrandIconAssetPath(size = 48) {
  if (isDevelopmentExtensionId()) {
    return 'icons/paw-print.svg';
  }

  return DEFAULT_BRAND_ICON_PATHS[size] || DEFAULT_BRAND_ICON_PATHS[48];
}

function getBrandIconUrl(size = 48) {
  return chrome.runtime.getURL(getBrandIconAssetPath(size));
}

function applyBrandIconToImage(img, size = 48) {
  if (!img) {
    return;
  }

  img.src = getBrandIconUrl(size);
}

function getActionIconPaths() {
  if (isDevelopmentExtensionId()) {
    return DEV_BRAND_ACTION_ICON_PATHS;
  }

  return DEFAULT_BRAND_ICON_PATHS;
}

const ExtensionEnvironment = {
  getCurrentExtensionId,
  isDevelopmentExtensionId,
  isDevelopmentExtension() {
    return isDevelopmentExtensionId();
  },
  getBrandIconAssetPath,
  getBrandIconUrl,
  applyBrandIconToImage,
  getActionIconPaths
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

  // 获取可用站点类型配置
  async getSiteTypes() {
    const config = await this.loadConfig();
    return Array.isArray(config.siteTypes) && config.siteTypes.length > 0
      ? config.siteTypes
      : ['information'];
  },

  // 获取外部链接配置
  async getExternalLinks() {
    const config = await this.loadConfig();
    return config.externalLinks || {};
  },

  // 获取联系信息
  async getContactInfo() {
    const config = await this.loadConfig();
    return config.contact || {};
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

async function loadLocalSitesConfig() {
  const response = await fetch(chrome.runtime.getURL('config/siteHandlers.json'));
  if (!response.ok) {
    throw new Error(`加载本地站点配置失败: HTTP ${response.status}`);
  }
  const localConfig = await response.json();
  return Array.isArray(localConfig?.sites) ? localConfig.sites : [];
}

function getSiteLaunchUtils() {
  if (typeof self !== 'undefined' && self.SiteLaunchUtils) {
    return self.SiteLaunchUtils;
  }
  if (typeof window !== 'undefined' && window.SiteLaunchUtils) {
    return window.SiteLaunchUtils;
  }
  return null;
}

function normalizeEntryUrlValue(value) {
  const utils = getSiteLaunchUtils();
  if (utils && typeof utils.normalizeEntryUrl === 'function') {
    return utils.normalizeEntryUrl(value);
  }
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeCustomSiteUrlValue(value) {
  const utils = getSiteLaunchUtils();
  if (utils && typeof utils.normalizeCustomSiteUrl === 'function') {
    return utils.normalizeCustomSiteUrl(value);
  }

  const normalizedUrl = typeof value === 'string' ? value.trim() : '';
  if (!normalizedUrl) {
    return '';
  }

  try {
    new URL(normalizedUrl);
    return normalizedUrl;
  } catch (_) {
    // Add a default protocol for bare hostnames.
  }

  if (normalizedUrl.startsWith('//')) {
    return `https:${normalizedUrl}`;
  }

  return `https://${normalizedUrl}`;
}

function normalizeCustomSitesValue(customSites) {
  const utils = getSiteLaunchUtils();
  if (utils && typeof utils.normalizeCustomSites === 'function') {
    return utils.normalizeCustomSites(customSites);
  }

  return Array.isArray(customSites)
    ? customSites
        .map((site, index) => {
          if (!site || typeof site !== 'object' || Array.isArray(site)) {
            return null;
          }
          const name = typeof site.name === 'string' ? site.name.trim() : '';
          const url = typeof site.url === 'string' ? site.url.trim() : '';
          if (!name || !url) {
            return null;
          }
          return {
            id: typeof site.id === 'string' ? site.id.trim() : `custom-site-${index}-${Date.now()}`,
            name,
            url: normalizeCustomSiteUrlValue(url),
            enabled: site.enabled !== false,
            supportIframe: true,
            icon: typeof site.icon === 'string' ? site.icon.trim() : '',
            note: typeof site.note === 'string' ? site.note.trim() : '',
            order: Number.isFinite(Number(site.order)) ? Number(site.order) : index
          };
        })
        .filter(Boolean)
        .sort((a, b) => (a.order || 0) - (b.order || 0))
    : [];
}

async function loadCustomSitesConfig() {
  try {
    const { customSites = [] } = await chrome.storage.sync.get('customSites');
    return normalizeCustomSitesValue(customSites);
  } catch (error) {
    console.error('读取 customSites 失败:', error);
    return [];
  }
}

function mergeSitesWithUserSettings(baseSites, userSettings = {}) {
  const mergedSites = (baseSites || []).map(site => {
    const userSiteData = userSettings[site.name] || {};
    const hasEntryUrlOverride = Object.prototype.hasOwnProperty.call(userSiteData, 'entryUrl');
    return {
      ...site,
      order: userSiteData.order !== undefined ? userSiteData.order : site.order,
      enabled: userSiteData.enabled !== undefined ? userSiteData.enabled : site.enabled,
      entryUrl: hasEntryUrlOverride
        ? normalizeEntryUrlValue(userSiteData.entryUrl)
        : normalizeEntryUrlValue(site.entryUrl)
    };
  });

  mergedSites.sort((a, b) => {
    const orderA = a.order !== undefined ? a.order : 999;
    const orderB = b.order !== undefined ? b.order : 999;
    return orderA - orderB;
  });

  return mergedSites;
}

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

// 站点配置同步功能（远程 JSON 配置 + 本地缓存回退）
const RemoteConfigManager = {
  // 远程配置来源，失败时仍会回退到扩展包内的本地文件
  get configUrl() {
    return REMOTE_SITE_HANDLERS_URL;
  },
  
  // 检查并同步本地配置
  async checkAndUpdateConfig() {
    try {
      const response = await fetch(this.configUrl, { cache: 'no-store' });
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
  
  // 更新本地配置快照
  async updateLocalConfig(remoteConfig) {
    try {
      const currentTime = Date.now();
      
      // 获取现有的更新历史
      const { updateHistory = [], remoteSiteHandlers: oldConfig } = await chrome.storage.local.get(['updateHistory', 'remoteSiteHandlers']);
      
      // 计算站点变化
      let newSites = 0;
      let updatedSites = 0;
      let newSiteNames = [];
      let updatedSiteNames = [];
      
      if (oldConfig && oldConfig.sites && remoteConfig.sites) {
        const oldSites = oldConfig.sites;
        const newSitesList = remoteConfig.sites;
        
        // 计算新增站点
        newSiteNames = newSitesList.filter(newSite =>
          !oldSites.some(oldSite => oldSite.name === newSite.name)
        ).map(site => site.name).filter(Boolean);
        newSites = newSiteNames.length;
        
        // 计算更新站点（URL或配置有变化的站点）
        updatedSiteNames = newSitesList.filter(newSite => {
          const oldSite = oldSites.find(oldSite => oldSite.name === newSite.name);
          if (!oldSite) return false;
          
          // 比较关键配置字段
          return oldSite.url !== newSite.url ||
                 oldSite.supportIframe !== newSite.supportIframe ||
                 oldSite.supportUrlQuery !== newSite.supportUrlQuery ||
                 JSON.stringify(oldSite.handler) !== JSON.stringify(newSite.handler);
        }).map(site => site.name).filter(Boolean);
        updatedSites = updatedSiteNames.length;
      } else if (remoteConfig.sites) {
        // 首次安装或没有旧配置
        newSiteNames = remoteConfig.sites.map(site => site.name).filter(Boolean);
        newSites = newSiteNames.length;
      }

      const changedSiteNames = Array.from(new Set([
        ...newSiteNames,
        ...updatedSiteNames
      ]));
      
      // 创建更新记录
      const updateRecord = {
        timestamp: currentTime,
        version: remoteConfig.version || currentTime,
        newSites: newSites,
        updatedSites: updatedSites,
        newSiteNames,
        updatedSiteNames,
        changedSiteNames,
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
      let userSettings = {};
      try {
        const { sites: userSiteSettings = {} } = await chrome.storage.sync.get('sites');
        userSettings = userSiteSettings;
        console.log('从 chrome.storage.sync 加载用户设置成功');
        console.log('chrome.storage.sync 加载的用户设置:', Object.keys(userSettings).map(name => ({ name, enabled: userSettings[name]?.enabled })));
      } catch (error) {
        console.error('从 chrome.storage.sync 读取用户设置失败:', error);
      }

      if (DEV_CONFIG.FORCE_LOCAL_CONFIG || DEV_CONFIG.SKIP_REMOTE_CONFIG) {
        console.log('开发模式：强制优先使用本地站点配置');
        const localSites = await loadLocalSitesConfig();
        return mergeSitesWithUserSettings(localSites, userSettings);
      }

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

      if (baseSites && baseSites.length > 0) {
        const mergedSites = mergeSitesWithUserSettings(baseSites, userSettings);
        console.log('合并配置成功，站点数量:', mergedSites.length);
        console.log('合并配置成功，站点配置:', mergedSites.map(site => ({ name: site.name, enabled: site.enabled })));
        return mergedSites;
      }
      
      // 4. 如果本地缓存不可用，尝试从扩展包内文件加载
      console.log('remoteSiteHandlers 中无数据，尝试从本地文件加载...');
      try {
        const localSites = await loadLocalSitesConfig();
        if (localSites.length > 0) {
          console.log('从本地文件加载站点配置成功');
          return mergeSitesWithUserSettings(localSites, userSettings);
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

  self.getCustomSites = async function() {
    return loadCustomSitesConfig();
  };

  self.AppConfigManager = AppConfigManager;
  self.RemoteConfigManager = RemoteConfigManager;
  self.ExtensionEnvironment = ExtensionEnvironment;
  
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

  self.BaseConfigLoaded = true;
}
// 浏览器环境
else {
  const language = navigator.language.toLowerCase();
  console.log('当前语言:', language);

  function markHomepagePerf(name) {
    if (typeof performance === 'undefined' || typeof performance.mark !== 'function') {
      return;
    }
    try {
      performance.mark(`homepage_${name}`);
    } catch (_) {}
  }

  function measureHomepagePerf(name, startMark, endMark) {
    if (typeof performance === 'undefined' || typeof performance.measure !== 'function') {
      return;
    }
    try {
      performance.measure(
        `homepage_${name}`,
        `homepage_${startMark}`,
        `homepage_${endMark}`
      );
    } catch (_) {}
  }
  
  // 动态获取站点配置
  window.getDefaultSites = async function() {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.runtime) {
        console.warn('⚠️ chrome API 不可用，返回空站点列表');
        return [];
      }

      markHomepagePerf('get_default_sites_total_start');
      
      let userSettings = {};
      try {
        if (chrome.storage?.sync) {
          markHomepagePerf('get_default_sites_sync_storage_start');
          const { sites: userSiteSettings = {} } = await chrome.storage.sync.get('sites');
          markHomepagePerf('get_default_sites_sync_storage_end');
          measureHomepagePerf(
            'get_default_sites_sync_storage_duration',
            'get_default_sites_sync_storage_start',
            'get_default_sites_sync_storage_end'
          );
          userSettings = userSiteSettings;
          console.log('从 chrome.storage.sync 加载用户设置成功');
        }
      } catch (error) {
        console.error('从 chrome.storage.sync 读取用户设置失败:', error);
      }

      if (DEV_CONFIG.FORCE_LOCAL_CONFIG || DEV_CONFIG.SKIP_REMOTE_CONFIG) {
        markHomepagePerf('get_default_sites_fallback_fetch_start');
        const localSites = await loadLocalSitesConfig();
        markHomepagePerf('get_default_sites_fallback_fetch_end');
        measureHomepagePerf(
          'get_default_sites_fallback_fetch_duration',
          'get_default_sites_fallback_fetch_start',
          'get_default_sites_fallback_fetch_end'
        );
        const mergedSites = mergeSitesWithUserSettings(localSites, userSettings);
        markHomepagePerf('get_default_sites_total_end');
        measureHomepagePerf(
          'get_default_sites_total_duration',
          'get_default_sites_total_start',
          'get_default_sites_total_end'
        );
        return mergedSites;
      }

      // 生产环境：从 remoteSiteHandlers 读取基础配置
      let baseSites = [];
      try {
        if (chrome.storage?.local) {
          markHomepagePerf('get_default_sites_local_storage_start');
          const result = await chrome.storage.local.get('remoteSiteHandlers');
          markHomepagePerf('get_default_sites_local_storage_end');
          measureHomepagePerf(
            'get_default_sites_local_storage_duration',
            'get_default_sites_local_storage_start',
            'get_default_sites_local_storage_end'
          );
          if (result.remoteSiteHandlers && result.remoteSiteHandlers.sites && result.remoteSiteHandlers.sites.length > 0) {
            baseSites = result.remoteSiteHandlers.sites;
            console.log('从 remoteSiteHandlers 加载站点配置成功');
          }
        }
      } catch (error) {
        console.error('从 remoteSiteHandlers 读取配置失败:', error);
      }

      if (baseSites && baseSites.length > 0) {
        markHomepagePerf('get_default_sites_merge_start');
        const mergedSites = mergeSitesWithUserSettings(baseSites, userSettings);
        markHomepagePerf('get_default_sites_merge_end');
        measureHomepagePerf(
          'get_default_sites_merge_duration',
          'get_default_sites_merge_start',
          'get_default_sites_merge_end'
        );
        
        console.log('合并配置成功，站点数量:', mergedSites.length);
        markHomepagePerf('get_default_sites_total_end');
        measureHomepagePerf(
          'get_default_sites_total_duration',
          'get_default_sites_total_start',
          'get_default_sites_total_end'
        );
        return mergedSites;
      }
      
      // 4. 如果本地缓存不可用，尝试从扩展包内文件加载
      try {
        if (chrome.runtime?.getURL) {
          markHomepagePerf('get_default_sites_fallback_fetch_start');
          const localSites = await loadLocalSitesConfig();
          if (localSites.length > 0) {
            console.log('从本地文件加载站点配置成功');
            markHomepagePerf('get_default_sites_fallback_fetch_end');
            measureHomepagePerf(
              'get_default_sites_fallback_fetch_duration',
              'get_default_sites_fallback_fetch_start',
              'get_default_sites_fallback_fetch_end'
            );
            markHomepagePerf('get_default_sites_total_end');
            measureHomepagePerf(
              'get_default_sites_total_duration',
              'get_default_sites_total_start',
              'get_default_sites_total_end'
            );
            return mergeSitesWithUserSettings(localSites, userSettings);
          }
          markHomepagePerf('get_default_sites_fallback_fetch_end');
          measureHomepagePerf(
            'get_default_sites_fallback_fetch_duration',
            'get_default_sites_fallback_fetch_start',
            'get_default_sites_fallback_fetch_end'
          );
        }
      } catch (error) {
        console.error('从本地文件加载配置失败:', error);
      }
      
      markHomepagePerf('get_default_sites_total_end');
      measureHomepagePerf(
        'get_default_sites_total_duration',
        'get_default_sites_total_start',
        'get_default_sites_total_end'
      );
      return [];
    } catch (error) {
      console.error('获取默认站点配置失败:', error);
      markHomepagePerf('get_default_sites_total_end');
      measureHomepagePerf(
        'get_default_sites_total_duration',
        'get_default_sites_total_start',
        'get_default_sites_total_end'
      );
      return [];
    }
  };

  window.getCustomSites = async function() {
    return loadCustomSitesConfig();
  };

  window.AppConfigManager = AppConfigManager;
  window.RemoteConfigManager = RemoteConfigManager;
  window.ExtensionEnvironment = ExtensionEnvironment;
  
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

  /**
   * 获取当前用户的订阅计划（代理到 stripe-payment.js 的 getUserPlan）
   * 若 stripe-payment.js 尚未加载则返回缓存或 free
   * @returns {Promise<{ plan: 'free'|'pro', planExpiresAt: string|null }>}
   */
  window.getUserPlan = async function() {
    if (typeof window._getUserPlanImpl === 'function') {
      return window._getUserPlanImpl();
    }
    // stripe-payment.js 加载后会覆盖 window.getUserPlan；这里作为兜底
    try {
      const stored = await chrome.storage.local.get(['_planCache', '_planCacheAt']);
      const cacheAge = Date.now() - (stored._planCacheAt || 0);
      if (stored._planCache && cacheAge < 5 * 60 * 1000) {
        return JSON.parse(stored._planCache);
      }
    } catch (_) {}
    return { plan: 'free', planExpiresAt: null };
  };

  /**
   * 检查当前用户是否为 Pro 会员（快速同步版，使用缓存）
   * 适合在内容脚本中判断功能门控
   * @returns {Promise<boolean>}
   */
  window.isProUser = async function() {
    const { plan } = await window.getUserPlan();
    return plan === 'pro';
  };
  
  // 标记配置已加载，避免重复声明
  if (typeof self !== 'undefined') {
    self.ExtensionEnvironment = ExtensionEnvironment;
  }
  if (typeof window !== 'undefined') {
    window.BaseConfigLoaded = true;
  } else if (typeof self !== 'undefined') {
    self.BaseConfigLoaded = true;
  }
}

} // 结束重复声明检查的 else 块
