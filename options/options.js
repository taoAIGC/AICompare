let currentButtonConfig = null;
// 系统默认站点设置将通过 getDefaultSites() 动态获取


// 加载保存的配置
async function loadConfig() {
  const defaultButtonConfig = await window.AppConfigManager.getButtonConfig();
  chrome.storage.sync.get('buttonConfig', function(data) {
    currentButtonConfig = {
      ...defaultButtonConfig,
      ...(data.buttonConfig || {})
    };
    console.log('加载的buttonConfig:', currentButtonConfig);
    initializeButtonConfigs();
  });
}

// 获取翻译文本
function getMessage(key, substitutions = null) {
  return chrome.i18n.getMessage(key, substitutions);
}

// 显示吐司提示
function showToast(message, duration = 2000) {
  const toast = document.getElementById('toast');
  if (!toast) return;

  toast.classList.remove('show');
  void toast.offsetWidth;
  
  toast.textContent = message;
  toast.classList.add('show');
  
  if (toast.timeoutId) {
    clearTimeout(toast.timeoutId);
  }
  
  toast.timeoutId = setTimeout(() => {
    toast.classList.remove('show');
  }, duration);
}

// 初始化页面文本
function initializeI18n() {
  // 更新页面标题
  document.title = chrome.i18n.getMessage("appName");

  // 更新所有带有 data-i18n 属性的元素
  document.querySelectorAll('[data-i18n]').forEach(element => {
    const key = element.getAttribute('data-i18n');
    const message = chrome.i18n.getMessage(key);
    if (message) {
      element.textContent = message;
    }
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
    const key = element.getAttribute('data-i18n-placeholder');
    const message = chrome.i18n.getMessage(key);
    if (message) {
      element.placeholder = message;
    }
  });

  document.querySelectorAll('[data-i18n-title]').forEach(element => {
    const key = element.getAttribute('data-i18n-title');
    const message = chrome.i18n.getMessage(key);
    if (message) {
      element.title = message;
    }
  });

  document.querySelectorAll('[data-i18n-aria-label]').forEach(element => {
    const key = element.getAttribute('data-i18n-aria-label');
    const message = chrome.i18n.getMessage(key);
    if (message) {
      element.setAttribute('aria-label', message);
    }
  });
}

// 等待 DOM 加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM 加载完成');
  initializeI18n();
  initializeRuleInfo();
  initializePromptTemplates();
});

// 显示消息
function showMessage(message, isError = false) {
  const messageElement = document.createElement('div');
  messageElement.className = `message ${isError ? 'error' : 'success'}`;
  messageElement.textContent = message;
  
  document.body.appendChild(messageElement);
  
  setTimeout(() => {
    messageElement.remove();
  }, 3000);
}


// 初始化快捷入口配置
async function initializeButtonConfigs() {
  try {
    // 获取存储的按钮配置
    let { buttonConfig } = await chrome.storage.sync.get(['buttonConfig']);
    
    // 从 appConfig.json 获取默认配置
    const defaultButtonConfig = await window.AppConfigManager.getButtonConfig();
    
    let currentConfig = {
      ...defaultButtonConfig,
      ...(buttonConfig || {})
    };

    console.log('初始配置:', currentConfig);

    // 配置项定义
    const configItems = [
      { id: 'floatButtonSwitch', configKey: 'floatButton', name: chrome.i18n.getMessage("floatButton") },
      { id: 'selectionQuickSearchSwitch', configKey: 'selectionQuickSearch', name: chrome.i18n.getMessage("selectionQuickSearch") },
      { id: 'selectionCompareButtonSwitch', configKey: 'selectionCompareButton', name: chrome.i18n.getMessage("selectionCompareButton") },
      { id: 'contextMenuSwitch', configKey: 'contextMenu', name: chrome.i18n.getMessage("contextMenu") },
      { id: 'searchEngineSwitch', configKey: 'searchEngine', name: chrome.i18n.getMessage("searchEngine") }
    ];

    const buttonContainer = document.getElementById('buttonSiteConfigs');
    if (!buttonContainer) return;
    
    buttonContainer.innerHTML = '';

    configItems.forEach(item => {
      const configDiv = document.createElement('div');
      configDiv.className = 'site-config';
      configDiv.innerHTML = `
        <div class="site-header">
          <label class="switch">
            <input type="checkbox" id="${item.id}"
              ${currentConfig[item.configKey] ? 'checked' : ''}>
            <span class="slider round"></span>
          </label>
          <span class="site-name-display">${item.name}</span>
        </div>
      `;
      buttonContainer.appendChild(configDiv);

      const switchElement = configDiv.querySelector(`#${item.id}`);
      switchElement.addEventListener('change', async (e) => {
        // 每次更改前先获取最新的配置
        const { buttonConfig: latestConfig } = await chrome.storage.sync.get(['buttonConfig']);
        const updatedConfig = {
          ...defaultButtonConfig,
          ...(latestConfig || currentConfig),  // 使用最新的配置作为基础
          [item.configKey]: e.target.checked
        };
        
        await chrome.storage.sync.set({ buttonConfig: updatedConfig });
        // 更新当前配置
        currentConfig = updatedConfig;
        console.log(`已更新${item.name}配置:`, updatedConfig);
        if (chrome.runtime.lastError) {
          showToast(chrome.i18n.getMessage("saveFailed", [chrome.runtime.lastError.message]));
          return;
        }
        showToast(chrome.i18n.getMessage("saveSuccess"));
        
      });
    });

  } catch (error) {
    console.error('初始化按钮配置失败:', error);
  }
}

// 在页面加载时初始化
document.addEventListener('DOMContentLoaded', function() {
  initializeI18n();
  loadConfig();
  initializeNavigation();
  initializeDisabledSites();
});

// 初始化导航功能
function initializeNavigation() {
  const navLinks = document.querySelectorAll('.nav-link');
  
  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      
      const targetSection = link.getAttribute('data-section');
      const targetElement = document.getElementById(targetSection);
      
      if (targetElement) {
        // 移除所有激活状态
        navLinks.forEach(navLink => {
          navLink.classList.remove('active');
        });
        
        // 添加当前激活状态
        link.classList.add('active');
        
        // 平滑滚动到目标区域
        targetElement.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }
    });
  });
  
  // 监听页面滚动，自动更新导航激活状态
  window.addEventListener('scroll', updateActiveNavigation);
}

// 更新导航激活状态
function updateActiveNavigation() {
  const sections = document.querySelectorAll('.settings-section');
  const navLinks = document.querySelectorAll('.nav-link');
  
  let currentSection = '';
  
  sections.forEach(section => {
    const rect = section.getBoundingClientRect();
    // 当section顶部距离视口顶部小于100px时，认为该section是当前激活的
    if (rect.top <= 100 && rect.bottom > 100) {
      currentSection = section.id;
    }
  });
  
  // 更新导航链接的激活状态
  navLinks.forEach(link => {
    link.classList.remove('active');
    if (link.getAttribute('data-section') === currentSection) {
      link.classList.add('active');
    }
  });
}

// 初始化规则信息
async function initializeRuleInfo() {
  try {
    let timeDisplay = chrome.i18n.getMessage('ruleUpdateTimePrefix');
    
    // 获取存储中的版本时间
    let storageTime = null;
    const { siteConfigVersion } = await chrome.storage.local.get('siteConfigVersion');
    if (siteConfigVersion) {
      try {
        const timestamp = parseInt(siteConfigVersion);
        if (!isNaN(timestamp)) {
          storageTime = new Date(timestamp);
          console.log('存储中的时间:', storageTime);
        }
      } catch (error) {
        console.error('解析存储时间失败:', error);
      }
    }
    
    // 获取本地配置文件的时间
    let localTime = null;
    try {
      const response = await fetch(chrome.runtime.getURL('config/siteHandlers.json'));
      const localConfig = await response.json();
      if (localConfig.lastUpdated) {
        localTime = new Date(localConfig.lastUpdated);
        console.log('本地配置文件时间:', localTime);
      }
    } catch (error) {
      console.error('读取本地配置文件失败:', error);
    }
    
    // 比较两个时间，取较大值
    let latestTime = null;
    if (storageTime && localTime) {
      latestTime = storageTime > localTime ? storageTime : localTime;
      console.log('取较大时间:', latestTime);
    } else if (storageTime) {
      latestTime = storageTime;
      console.log('使用存储时间:', latestTime);
    } else if (localTime) {
      latestTime = localTime;
      console.log('使用本地时间:', latestTime);
    }
    
    // 格式化显示
    if (latestTime) {
      const year = latestTime.getFullYear();
      const month = String(latestTime.getMonth() + 1).padStart(2, '0');
      const day = String(latestTime.getDate()).padStart(2, '0');
      const hours = String(latestTime.getHours()).padStart(2, '0');
      const minutes = String(latestTime.getMinutes()).padStart(2, '0');
      const seconds = String(latestTime.getSeconds()).padStart(2, '0');
      timeDisplay = `${chrome.i18n.getMessage('ruleUpdateTimePrefix')}${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    } else {
      timeDisplay = chrome.i18n.getMessage('ruleUpdateTimeNotAvailable');
    }
    
    // 更新显示
    const timeElement = document.getElementById('ruleUpdateTime');
    if (timeElement) {
      timeElement.textContent = timeDisplay;
    }
    
    // 添加参与规则开发按钮的点击事件
    const devButton = document.getElementById('participateRuleDev');
    if (devButton) {
      devButton.addEventListener('click', () => {
        chrome.tabs.create({
          url: 'https://github.com/taoAIGC/AI-Shortcuts/blob/main/config/siteHandlers.json'
        });
      });
    }
    
  } catch (error) {
    console.error('初始化规则信息失败:', error);
    
    // 显示错误信息
    const timeElement = document.getElementById('ruleUpdateTime');
    if (timeElement) {
      timeElement.textContent = chrome.i18n.getMessage('ruleUpdateTimeError');
    }
  }
}

// 初始化禁用网站管理
async function initializeDisabledSites() {
  const container = document.getElementById('disabledSitesList');
  if (!container) return;

  try {
    const { disabledSites = [] } = await chrome.storage.sync.get('disabledSites');
    
    if (disabledSites.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="text-align: center; color: #999; padding: 40px;">
          <p>${chrome.i18n.getMessage('noDisabledSites')}</p>
        </div>
      `;
      return;
    }

    container.innerHTML = disabledSites.map(site => `
      <div class="disabled-site-item" style="display: flex; justify-content: space-between; align-items: center; padding: 12px; border: 1px solid #e0e0e0; border-radius: 6px; margin-bottom: 8px;">
        <div class="site-info">
          <span class="site-domain" style="font-weight: 500; color: #333;">${site}</span>
          <span class="site-note" style="color: #666; font-size: 12px; margin-left: 8px;">悬浮球已禁用</span>
        </div>
        <div class="site-actions">
          <button class="enable-btn" data-domain="${site}" style="padding: 6px 12px; background: #4caf50; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">
            重新启用
          </button>
        </div>
      </div>
    `).join('');

    // 添加事件监听器
    container.addEventListener('click', handleDisabledSiteAction);
    
  } catch (error) {
    console.error('加载禁用网站列表失败:', error);
    container.innerHTML = `
      <div class="error-state" style="text-align: center; color: #f44336; padding: 40px;">
        <p>加载失败，请刷新页面重试</p>
      </div>
    `;
  }
}

// 处理禁用网站操作
async function handleDisabledSiteAction(event) {
  const target = event.target;
  if (!target.matches('.enable-btn')) return;
  
  const domain = target.getAttribute('data-domain');
  if (!domain) return;

  try {
    const { disabledSites = [] } = await chrome.storage.sync.get('disabledSites');
    
    // 重新启用网站 - 从禁用列表中移除
    const updatedSites = disabledSites.filter(site => site !== domain);
    await chrome.storage.sync.set({ disabledSites: updatedSites });
    
    showToast(`已重新启用 ${domain} 的悬浮球`);

    // 重新加载列表
    initializeDisabledSites();
    
  } catch (error) {
    console.error('操作失败:', error);
    showToast('操作失败，请重试');
  }
}

// ============================
// 提示词模板管理功能
// ============================

// 当前编辑的模板ID
let currentEditingTemplateId = null;

// 初始化提示词模板管理
async function initializePromptTemplates() {
  try {
    // 确保有默认模板
    await ensureDefaultTemplates();
    
    // 加载并显示模板列表
    await loadTemplatesList();
    
    // 绑定事件监听器
    bindTemplateEvents();
    
    console.log('提示词模板管理初始化完成');
  } catch (error) {
    console.error('初始化提示词模板失败:', error);
  }
}

// 确保存在默认模板
async function ensureDefaultTemplates() {
  try {
    const { promptTemplates = [] } = await chrome.storage.sync.get('promptTemplates');
    
    // 如果没有模板，提醒用户模板将由系统自动初始化
    if (promptTemplates.length === 0) {
      console.log('提示词模板为空，将依赖系统自动初始化');
      
      // 触发 background.js 的初始化（如果还没有运行）
      try {
        await chrome.runtime.sendMessage({ action: 'initializeDefaultTemplates' });
      } catch (error) {
        console.log('无法发送初始化消息，background 可能已处理:', error);
      }
    }
  } catch (error) {
    console.error('检查默认模板失败:', error);
  }
}

// 加载模板列表
async function loadTemplatesList() {
  try {
    const { promptTemplates = [] } = await chrome.storage.sync.get('promptTemplates');
    const container = document.getElementById('templatesList');
    
    if (!container) return;
    
    // 按order排序
    const sortedTemplates = promptTemplates.sort((a, b) => (a.order || 0) - (b.order || 0));
    
    if (sortedTemplates.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; color: #666; padding: 40px;">
          <p>暂无提示词模板</p>
          <p style="font-size: 14px;">点击上方"添加新模板"按钮开始创建</p>
        </div>
      `;
      return;
    }
    
    container.innerHTML = sortedTemplates.map(template => `
      <div class="template-item" data-template-id="${template.id}" style="
        background: white;
        border: 1px solid #e0e0e0;
        border-radius: 8px;
        padding: 16px;
        margin-bottom: 12px;
        transition: box-shadow 0.2s ease;
      ">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
          <div style="flex: 1;">
            <h4 style="margin: 0 0 4px 0; font-size: 16px; color: #333;">${template.name}</h4>
            <div style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: #666;">
              <span>${chrome.i18n.getMessage('templateOrderLabel') || 'Order'}: ${template.order}</span>
            </div>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="edit-template-btn" data-template-id="${template.id}" title="${chrome.i18n.getMessage('editButton')}" aria-label="${chrome.i18n.getMessage('editButton')}" style="
              background: transparent;
              border: none;
              border-radius: 4px;
              padding: 6px;
              width: 30px;
              height: 30px;
              cursor: pointer;
              display: flex;
              align-items: center;
              justify-content: center;
            ">
              <img src="../icons/edit.svg" alt="" style="width: 16px; height: 16px; opacity: 0.8;">
            </button>
            ${!template.isDefault ? `<button class="delete-template-btn" data-template-id="${template.id}" style="
              background: #ffebee;
              border: 1px solid #ffcdd2;
              border-radius: 4px;
              padding: 6px 12px;
              cursor: pointer;
              font-size: 12px;
              color: #d32f2f;
            " data-i18n="deleteButton">删除</button>` : ''}
          </div>
        </div>
        <div style="
          background: #f8f9fa;
          border: 1px solid #e9ecef;
          border-radius: 4px;
          padding: 12px;
          font-family: 'Monaco', 'Menlo', 'Courier New', monospace;
          font-size: 13px;
          color: #495057;
          word-break: break-word;
        ">${template.query}</div>
      </div>
    `).join('');
    
    // 添加hover效果
    container.querySelectorAll('.template-item').forEach(item => {
      item.addEventListener('mouseenter', () => {
        item.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
      });
      item.addEventListener('mouseleave', () => {
        item.style.boxShadow = 'none';
      });
    });
    
  } catch (error) {
    console.error('加载模板列表失败:', error);
  }
}

// 绑定模板相关事件
function bindTemplateEvents() {
  // 添加模板按钮
  const addBtn = document.getElementById('addTemplateBtn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      currentEditingTemplateId = null;
      showTemplateDialog();
    });
  }
  
  // 对话框关闭按钮
  const dialogClose = document.getElementById('dialogClose');
  const cancelBtn = document.getElementById('cancelTemplate');
  const overlay = document.getElementById('dialogOverlay');
  
  [dialogClose, cancelBtn, overlay].forEach(el => {
    if (el) {
      el.addEventListener('click', hideTemplateDialog);
    }
  });
  
  // 保存按钮
  const saveBtn = document.getElementById('saveTemplate');
  if (saveBtn) {
    saveBtn.addEventListener('click', saveTemplate);
  }
  
  // 模板列表事件委托
  const templatesList = document.getElementById('templatesList');
  if (templatesList) {
    templatesList.addEventListener('click', handleTemplateListClick);
  }
}

// 处理模板列表点击事件
async function handleTemplateListClick(event) {
  const editBtn = event.target.closest('.edit-template-btn');
  const deleteBtn = event.target.closest('.delete-template-btn');

  if (editBtn) {
    const templateId = editBtn.getAttribute('data-template-id');
    if (templateId) await editTemplate(templateId);
  } else if (deleteBtn) {
    const templateId = deleteBtn.getAttribute('data-template-id');
    if (templateId) await deleteTemplate(templateId);
  }
}

// 显示模板对话框
function showTemplateDialog(template = null) {
  const dialog = document.getElementById('templateDialog');
  const title = document.getElementById('dialogTitle');
  const nameInput = document.getElementById('templateName');
  const queryInput = document.getElementById('templateQuery');
  const orderInput = document.getElementById('templateOrder');
  
  if (!dialog) return;
  
  if (template) {
    // 编辑模式
    title.textContent = chrome.i18n.getMessage('editTemplateTitle');
    nameInput.value = template.name;
    queryInput.value = template.query;
    orderInput.value = template.order || 1;
  } else {
    // 添加模式
    title.textContent = chrome.i18n.getMessage('addTemplateTitle');
    nameInput.value = '';
    queryInput.value = '';
    orderInput.value = getNextOrder();
  }
  
  dialog.style.display = 'block';
  nameInput.focus();
}

// 隐藏模板对话框
function hideTemplateDialog() {
  const dialog = document.getElementById('templateDialog');
  if (dialog) {
    dialog.style.display = 'none';
  }
  currentEditingTemplateId = null;
}

// 获取下一个排序值
async function getNextOrder() {
  try {
    const { promptTemplates = [] } = await chrome.storage.sync.get('promptTemplates');
    const maxOrder = promptTemplates.reduce((max, template) => 
      Math.max(max, template.order || 0), 0);
    return maxOrder + 1;
  } catch (error) {
    return 1;
  }
}

// 保存模板
async function saveTemplate() {
  const nameInput = document.getElementById('templateName');
  const queryInput = document.getElementById('templateQuery');
  const orderInput = document.getElementById('templateOrder');
  
  const name = nameInput.value.trim();
  const query = queryInput.value.trim();
  const order = parseInt(orderInput.value) || 1;
  
  // 验证
  if (!name) {
    showToast(chrome.i18n.getMessage('templateNameRequired'));
    nameInput.focus();
    return;
  }
  
  if (!query) {
    showToast(chrome.i18n.getMessage('templateQueryRequired'));
    queryInput.focus();
    return;
  }
  
  try {
    const { promptTemplates = [] } = await chrome.storage.sync.get('promptTemplates');
    
    if (currentEditingTemplateId) {
      // 编辑现有模板
      const index = promptTemplates.findIndex(t => t.id === currentEditingTemplateId);
      if (index !== -1) {
        promptTemplates[index] = {
          ...promptTemplates[index],
          name,
          query,
          order
        };
      }
    } else {
      // 添加新模板
      const newTemplate = {
        id: generateTemplateId(),
        name,
        query,
        order,
        isDefault: false
      };
      promptTemplates.push(newTemplate);
    }
    
    await chrome.storage.sync.set({ promptTemplates });
    hideTemplateDialog();
    await loadTemplatesList();
    showToast(chrome.i18n.getMessage('templateSavedSuccess'));
    
  } catch (error) {
    console.error('保存模板失败:', error);
    showToast('保存失败，请重试');
  }
}

// 编辑模板
async function editTemplate(templateId) {
  try {
    const { promptTemplates = [] } = await chrome.storage.sync.get('promptTemplates');
    const template = promptTemplates.find(t => t.id === templateId);
    
    if (template) {
      currentEditingTemplateId = templateId;
      showTemplateDialog(template);
    }
  } catch (error) {
    console.error('编辑模板失败:', error);
  }
}

// 删除模板
async function deleteTemplate(templateId) {
  const confirmMessage = chrome.i18n.getMessage('confirmDeleteTemplate');
  if (!confirm(confirmMessage)) {
    return;
  }
  
  try {
    const { promptTemplates = [] } = await chrome.storage.sync.get('promptTemplates');
    const filteredTemplates = promptTemplates.filter(t => t.id !== templateId);
    
    await chrome.storage.sync.set({ promptTemplates: filteredTemplates });
    await loadTemplatesList();
    showToast(chrome.i18n.getMessage('templateDeletedSuccess'));
    
  } catch (error) {
    console.error('删除模板失败:', error);
    showToast('删除失败，请重试');
  }
}

// 生成唯一模板ID
function generateTemplateId() {
  return 'template_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// 处理锚点跳转
function handleHashNavigation() {
  const hash = window.location.hash;
  if (hash) {
    // 移除 # 号
    const targetId = hash.substring(1);
    const targetElement = document.getElementById(targetId);
    
    if (targetElement) {
      // 延迟滚动，确保页面完全加载
      setTimeout(() => {
        targetElement.scrollIntoView({ behavior: 'smooth' });
        
        // 更新导航状态
        updateNavigationState(targetId);
      }, 100);
    }
  }
}

// 更新导航状态
function updateNavigationState(activeSection) {
  // 移除所有导航项的 active 类
  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.remove('active');
  });
  
  // 添加 active 类到当前导航项
  const activeLink = document.querySelector(`[data-section="${activeSection}"]`);
  if (activeLink) {
    activeLink.classList.add('active');
  }
}

// 初始化导航事件
function initializeNavigation() {
  // 处理导航链接点击
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const section = link.getAttribute('data-section');
      if (section) {
        const targetElement = document.getElementById(section);
        if (targetElement) {
          targetElement.scrollIntoView({ behavior: 'smooth' });
          updateNavigationState(section);
          
          // 更新 URL hash
          window.history.pushState(null, null, `#${section}`);
        }
      }
    });
  });
}

// ── 数据同步（WebDAV）──────────────────────────────────────────

const SYNC_STORAGE_KEY = 'webdavSyncConfig';
const SYNC_DATA_FILENAME = 'multiAI-settings.json';

// 需要同步的 chrome.storage.sync 数据键
const SYNC_KEYS = [
  'buttonConfig',
  'sites',
  'siteSettings',
  'disabledSites',
  'promptTemplates',
  'favoritePrompts',
  'favoriteSites',
];

function showSyncStatus(message, type = 'info') {
  const el = document.getElementById('syncStatus');
  if (!el) return;
  el.textContent = message;
  el.className = `sync-status ${type}`;
  el.style.display = 'block';
  if (type === 'success') {
    setTimeout(() => { el.style.display = 'none'; }, 4000);
  }
}

async function loadSyncConfig() {
  const { [SYNC_STORAGE_KEY]: cfg = {} } = await chrome.storage.local.get(SYNC_STORAGE_KEY);
  const enabled  = document.getElementById('syncEnabled');
  const url      = document.getElementById('syncUrl');
  const username = document.getElementById('syncUsername');
  const password = document.getElementById('syncPassword');
  const authType = document.getElementById('syncAuthType');

  if (enabled)  enabled.checked  = !!cfg.enabled;
  if (url)      url.value        = cfg.url      || '';
  if (username) username.value   = cfg.username || '';
  if (password) password.value   = cfg.password || '';
  if (authType) authType.value   = cfg.authType || 'password';

  updateConnectionTableState(!!cfg.enabled);
  updateAuthTypeUI(cfg.authType || 'password');
}

function updateAuthTypeUI(authType) {
  const table          = document.getElementById('syncConnectionConfig');
  const passwordHeader = document.getElementById('syncPasswordHeader');
  const passwordInput  = document.getElementById('syncPassword');

  if (authType === 'token') {
    table?.classList.add('token-mode');
    if (passwordHeader) passwordHeader.textContent  = chrome.i18n.getMessage('syncAuthToken') || 'Token';
    if (passwordInput) {
      passwordInput.placeholder  = chrome.i18n.getMessage('syncTokenPlaceholder') || '输入 Token';
      passwordInput.autocomplete = 'off';
    }
  } else {
    table?.classList.remove('token-mode');
    if (passwordHeader) passwordHeader.textContent  = chrome.i18n.getMessage('syncPassword') || '密码';
    if (passwordInput) {
      passwordInput.placeholder  = '••••••••';
      passwordInput.autocomplete = 'current-password';
    }
  }
}

function updateConnectionTableState(enabled) {
  const table = document.getElementById('syncConnectionConfig');
  if (!table) return;
  if (enabled) {
    table.classList.remove('disabled');
  } else {
    table.classList.add('disabled');
  }
}

async function saveSyncConfig() {
  const cfg = {
    enabled:  document.getElementById('syncEnabled')?.checked  || false,
    authType: document.getElementById('syncAuthType')?.value   || 'password',
    url:      (document.getElementById('syncUrl')?.value       || '').trim(),
    username: (document.getElementById('syncUsername')?.value  || '').trim(),
    password: document.getElementById('syncPassword')?.value   || '',
  };

  if (!cfg.url) {
    showSyncStatus(chrome.i18n.getMessage('syncErrorNoUrl') || '请填写 WebDAV 地址', 'error');
    document.getElementById('syncUrl')?.focus();
    return;
  }
  if (cfg.authType !== 'token' && !cfg.username) {
    showSyncStatus(chrome.i18n.getMessage('syncErrorNoUsername') || '请填写用户名', 'error');
    document.getElementById('syncUsername')?.focus();
    return;
  }
  if (!cfg.password) {
    showSyncStatus(
      cfg.authType === 'token'
        ? (chrome.i18n.getMessage('syncErrorNoToken') || '请填写 Token')
        : (chrome.i18n.getMessage('syncErrorNoPassword') || '请填写密码'),
      'error'
    );
    document.getElementById('syncPassword')?.focus();
    return;
  }

  await chrome.storage.local.set({ [SYNC_STORAGE_KEY]: cfg });
  showSyncStatus(chrome.i18n.getMessage('saveSuccess') || '已保存', 'success');
  updateConnectionTableState(cfg.enabled);
}

function buildWebDAVHeaders(cfg) {
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.authType === 'token') {
    headers['Authorization'] = `Bearer ${cfg.password}`;
  } else {
    headers['Authorization'] = 'Basic ' + btoa(`${cfg.username}:${cfg.password}`);
  }
  return headers;
}

function getWebDAVFileURL(cfg) {
  let base = cfg.url.trim();
  if (!base.endsWith('/')) base += '/';
  return base + SYNC_DATA_FILENAME;
}

async function testSyncConnection() {
  const cfg = await getSyncConfig();
  if (!cfg || !cfg.url) {
    showSyncStatus(chrome.i18n.getMessage('syncErrorNoUrl') || '请先填写 WebDAV 地址', 'error');
    return;
  }
  showSyncStatus(chrome.i18n.getMessage('syncTesting') || '正在测试连接…', 'loading');
  try {
    const res = await fetch(cfg.url, {
      method: 'PROPFIND',
      headers: { ...buildWebDAVHeaders(cfg), 'Depth': '0' },
    });
    if (res.ok || res.status === 207) {
      showSyncStatus(chrome.i18n.getMessage('syncTestSuccess') || '连接成功！', 'success');
    } else {
      showSyncStatus(
        (chrome.i18n.getMessage('syncTestFailed') || '连接失败') + `: HTTP ${res.status}`,
        'error'
      );
    }
  } catch (e) {
    showSyncStatus(
      (chrome.i18n.getMessage('syncTestFailed') || '连接失败') + `: ${e.message}`,
      'error'
    );
  }
}

async function getSyncConfig() {
  const { [SYNC_STORAGE_KEY]: cfg = {} } = await chrome.storage.local.get(SYNC_STORAGE_KEY);
  return cfg;
}

async function exportAllSettings() {
  const syncData  = await chrome.storage.sync.get(SYNC_KEYS);
  const localData = await chrome.storage.local.get(['pkHistory', 'favoriteFolders']);
  return {
    ...syncData,
    pkHistory: (localData.pkHistory || []).slice(0, 500),
    favoriteFolders: localData.favoriteFolders || [],
    _syncVersion: 1,
    _exportedAt: new Date().toISOString(),
  };
}

async function syncNow() {
  const cfg = await getSyncConfig();
  if (!cfg.enabled || !cfg.url) {
    showSyncStatus(chrome.i18n.getMessage('syncErrorNotConfigured') || '请先启用同步并填写 WebDAV 配置', 'error');
    return;
  }
  showSyncStatus(chrome.i18n.getMessage('syncUploading') || '正在上传数据…', 'loading');
  try {
    const payload = await exportAllSettings();
    const fileURL  = getWebDAVFileURL(cfg);
    const res = await fetch(fileURL, {
      method: 'PUT',
      headers: buildWebDAVHeaders(cfg),
      body: JSON.stringify(payload, null, 2),
    });
    if (res.ok || res.status === 201 || res.status === 204) {
      const timeStr = new Date().toLocaleTimeString();
      showSyncStatus(
        (chrome.i18n.getMessage('syncSuccess') || '同步成功') + ' · ' + timeStr,
        'success'
      );
    } else {
      showSyncStatus(
        (chrome.i18n.getMessage('syncFailed') || '同步失败') + `: HTTP ${res.status}`,
        'error'
      );
    }
  } catch (e) {
    showSyncStatus(
      (chrome.i18n.getMessage('syncFailed') || '同步失败') + `: ${e.message}`,
      'error'
    );
  }
}

async function importFromSync() {
  const cfg = await getSyncConfig();
  if (!cfg.enabled || !cfg.url) {
    showSyncStatus(chrome.i18n.getMessage('syncErrorNotConfigured') || '请先启用同步并填写 WebDAV 配置', 'error');
    return;
  }
  showSyncStatus(chrome.i18n.getMessage('syncDownloading') || '正在从云端下载数据…', 'loading');
  try {
    // 委托 background service worker 执行 fetch，避免 options 页面跨域/CORS 限制
    const resp = await chrome.runtime.sendMessage({ action: 'webdavImport' });
    if (resp && resp.success) {
      showSyncStatus(
        (chrome.i18n.getMessage('syncImportSuccess') || '云端数据已恢复，请刷新页面生效'),
        'success'
      );
    } else {
      const errMsg = (chrome.i18n.getMessage('syncImportFailed') || '恢复失败') +
        (resp?.error ? `: ${resp.error}` : '');
      showSyncStatus(errMsg, 'error');
    }
  } catch (e) {
    showSyncStatus(
      (chrome.i18n.getMessage('syncImportFailed') || '恢复失败') + `: ${e.message}`,
      'error'
    );
  }
}

function initializeDataSync() {
  loadSyncConfig();

  document.getElementById('syncEnabled')?.addEventListener('change', (e) => {
    updateConnectionTableState(e.target.checked);
  });

  document.getElementById('syncAuthType')?.addEventListener('change', (e) => {
    updateAuthTypeUI(e.target.value);
  });

  document.getElementById('saveSyncConfig')?.addEventListener('click', saveSyncConfig);
  document.getElementById('importFromSync')?.addEventListener('click', importFromSync);

  document.getElementById('togglePassword')?.addEventListener('click', () => {
    const input = document.getElementById('syncPassword');
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Pro 会员 UI
// ─────────────────────────────────────────────────────────────────────────────

async function initializeMembership() {
  const loadingEl = document.getElementById('membershipLoadingMsg');
  const loginHintEl = document.getElementById('membershipLoginHint');
  const plansEl = document.getElementById('membershipPlans');
  const proActionsEl = document.getElementById('membershipProActions');
  const badgeEl = document.getElementById('membershipBadge');
  const planLabelEl = document.getElementById('membershipPlanLabel');
  const emailEl = document.getElementById('membershipEmail');
  const expiryEl = document.getElementById('membershipExpiry');

  function setLoading(show) {
    if (loadingEl) loadingEl.style.display = show ? 'block' : 'none';
  }

  setLoading(true);

  // 检查是否已登录
  const stored = await chrome.storage.local.get(['firebase_uid', 'firebase_email']);
  const uid = stored.firebase_uid;
  const email = stored.firebase_email || '';

  if (!uid) {
    setLoading(false);
    if (loginHintEl) loginHintEl.style.display = 'block';
    return;
  }

  if (emailEl) emailEl.textContent = email;

  // 读取 plan
  let planInfo = { plan: 'free', planExpiresAt: null };
  try {
    if (typeof window.getUserPlan === 'function') {
      planInfo = await window.getUserPlan();
    }
  } catch (e) {
    console.warn('Failed to load plan:', e);
  }

  setLoading(false);

  const isPro = planInfo.plan === 'pro';

  if (badgeEl) {
    badgeEl.className = 'membership-badge' + (isPro ? ' pro' : '');
  }
  if (planLabelEl) {
    planLabelEl.textContent = isPro
      ? (chrome.i18n.getMessage('membershipPlanPro') || 'Pro')
      : (chrome.i18n.getMessage('membershipPlanFree') || 'Free');
  }

  if (isPro && planInfo.planExpiresAt && expiryEl) {
    const expiryDate = new Date(planInfo.planExpiresAt);
    const dateStr = expiryDate.toLocaleDateString();
    const expiryLabel = chrome.i18n.getMessage('membershipExpiresOn') || '到期时间：';
    expiryEl.textContent = `${expiryLabel}${dateStr}`;
    expiryEl.style.display = 'block';
  }

  if (isPro) {
    if (plansEl) plansEl.style.display = 'none';
    if (proActionsEl) proActionsEl.style.display = 'block';
  } else {
    if (plansEl) plansEl.style.display = 'flex';
    if (proActionsEl) proActionsEl.style.display = 'none';
  }

  // 升级按钮事件
  const btnMonthly = document.getElementById('btnUpgradeMonthly');
  const btnYearly = document.getElementById('btnUpgradeYearly');

  async function handleUpgrade(priceId, btn) {
    if (!priceId || priceId.startsWith('price_REPLACE')) {
      showToast(chrome.i18n.getMessage('membershipPriceNotConfigured') || '请先配置 Stripe Price ID', 3000);
      return;
    }
    if (btn) btn.disabled = true;
    try {
      if (typeof window.startCheckout === 'function') {
        await window.startCheckout(priceId);
      } else {
        showToast('stripe-payment.js 未加载', 3000);
      }
    } catch (e) {
      showToast(e.message || '跳转付款页失败', 3000);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  if (btnMonthly) {
    btnMonthly.addEventListener('click', () => {
      const priceId = (window.STRIPE_PRICES && window.STRIPE_PRICES.monthly) || '';
      handleUpgrade(priceId, btnMonthly);
    });
  }

  if (btnYearly) {
    btnYearly.addEventListener('click', () => {
      const priceId = (window.STRIPE_PRICES && window.STRIPE_PRICES.yearly) || '';
      handleUpgrade(priceId, btnYearly);
    });
  }

  // 管理订阅按钮
  const btnManage = document.getElementById('btnManageSubscription');
  if (btnManage) {
    btnManage.addEventListener('click', async () => {
      btnManage.disabled = true;
      try {
        if (typeof window.openCustomerPortal === 'function') {
          await window.openCustomerPortal();
        } else {
          showToast('stripe-payment.js 未加载', 3000);
        }
      } catch (e) {
        showToast(e.message || '无法打开订阅管理页', 3000);
      } finally {
        btnManage.disabled = false;
      }
    });
  }
}

// 页面初始化
document.addEventListener('DOMContentLoaded', () => {
  console.log('Options page loaded');
  
  // 初始化国际化
  initializeI18n();
  
  // 加载配置
  loadConfig();
  
  // 初始化导航
  initializeNavigation();
  
  // 处理锚点跳转
  handleHashNavigation();
  
  // 监听 hash 变化
  window.addEventListener('hashchange', handleHashNavigation);

  // 初始化数据同步
  initializeDataSync();

  // Pro 会员功能暂时隐藏，下版本恢复后再启用
  // initializeMembership();
});
