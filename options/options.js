let currentButtonConfig = null;
// 系统默认站点设置将通过 getDefaultSites() 动态获取
const TEMPLATE_TYPE_LABELS = {
  information: 'homepageTypeInformation',
  agents: 'homepageTypeAgents',
  translate: 'homepageTypeTranslate'
};
let configuredTemplateTypes = ['information'];


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

function getMessageWithFallback(key, fallback = '', substitutions = null) {
  return getMessage(key, substitutions) || fallback;
}

function getPromptTemplateUtils() {
  return window.PromptTemplateUtils || null;
}

async function loadConfiguredTemplateTypes() {
  try {
    const siteTypes = await window.AppConfigManager.getSiteTypes();
    configuredTemplateTypes = getPromptTemplateUtils()?.normalizePromptTemplateTypes?.(siteTypes) || ['information'];
  } catch (error) {
    configuredTemplateTypes = ['information'];
  }
  return configuredTemplateTypes;
}

function normalizeTemplateType(type) {
  return getPromptTemplateUtils()?.normalizePromptTemplateType?.(
    type,
    'information',
    configuredTemplateTypes
  ) || 'information';
}

function getPromptTemplateTypeLabel(type) {
  const normalizedType = normalizeTemplateType(type);
  const messageKey = TEMPLATE_TYPE_LABELS[normalizedType];
  return messageKey ? getMessage(messageKey) || normalizedType : normalizedType;
}

function populateTemplateTypeOptions(selectedType) {
  const typeSelect = document.getElementById('templateType');
  const availableTypes = configuredTemplateTypes;

  if (!typeSelect) return;

  typeSelect.innerHTML = availableTypes.map(type => `
    <option value="${type}">${getPromptTemplateTypeLabel(type)}</option>
  `).join('');
  typeSelect.value = normalizeTemplateType(selectedType);
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
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM 加载完成');
    initializeI18n();
    initializeRuleInfo();
    initializePromptTemplates();
    initializeAnalysisPromptTemplates();
  });
}

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

function getLaunchSettingsUtils() {
  return window.SiteLaunchUtils || null;
}

function normalizeCustomSiteUrlValue(value) {
  const utils = getLaunchSettingsUtils();
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

function getLaunchMessage(key, fallback = '') {
  return chrome.i18n.getMessage(key) || fallback;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case '\'':
        return '&#39;';
      default:
        return char;
    }
  });
}

async function initializeLaunchSettings() {
  try {
    await Promise.allSettled([
      renderOfficialEntryUrlConfigs(),
      loadCustomSitesManager()
    ]);
    bindCustomSiteManagerEvents();
  } catch (error) {
    console.error('初始化 launch settings 失败:', error);
  }
}

async function saveOfficialEntryUrl(siteName, entryUrl) {
  try {
    const normalizedEntryUrl = typeof entryUrl === 'string' ? entryUrl.trim() : '';
    const { sites: existingUserSettings = {} } = await chrome.storage.sync.get('sites');
    const updatedUserSettings = { ...existingUserSettings };
    if (!updatedUserSettings[siteName]) {
      updatedUserSettings[siteName] = {};
    }

    if (normalizedEntryUrl) {
      updatedUserSettings[siteName].entryUrl = normalizedEntryUrl;
    } else {
      delete updatedUserSettings[siteName].entryUrl;
    }

    await chrome.storage.sync.set({ sites: updatedUserSettings });
    showToast(getLaunchMessage('saveSuccess', 'Configuration saved'));
    await renderOfficialEntryUrlConfigs();
  } catch (error) {
    console.error('保存 entryUrl 失败:', error);
    showToast(getLaunchMessage('saveFailed', 'Save failed'), true);
  }
}

async function renderOfficialEntryUrlConfigs() {
  const container = document.getElementById('officialEntryUrlConfigs');
  if (!container) {
    return;
  }

  try {
    const [sites, syncData] = await Promise.all([
      window.getDefaultSites?.() || [],
      chrome.storage.sync.get('sites')
    ]);
    const userSites = syncData?.sites || {};

    container.innerHTML = '';

    if (!Array.isArray(sites) || sites.length === 0) {
      container.innerHTML = `
        <div class="site-list-empty" style="grid-column: 1 / -1;">
          ${getLaunchMessage('officialEntryUrlEmpty', 'No official sites found')}
        </div>
      `;
      return;
    }

    const fragment = document.createDocumentFragment();
    sites.forEach((site, index) => {
      const siteName = site?.name || '';
      if (!siteName) {
        return;
      }

      const storedEntryUrl = typeof userSites[siteName]?.entryUrl === 'string'
        ? userSites[siteName].entryUrl
        : '';
      const currentEntryUrl = storedEntryUrl || site.entryUrl || '';
      const safeId = `entry-url-${index}-${String(siteName).replace(/[^a-zA-Z0-9_-]/g, '_')}`;

      const card = document.createElement('div');
      card.className = 'site-config';
      card.dataset.siteName = siteName;
      card.innerHTML = `
        <div class="site-header site-setting-row">
          <span class="site-name-display">${siteName}</span>
          <div class="site-setting-actions">
            <button type="button" class="btn-secondary reset-entry-url-btn" data-site-name="${siteName}">
              ${getLaunchMessage('entryUrlResetButton', 'Reset')}
            </button>
            <button type="button" class="btn-primary save-entry-url-btn" data-site-name="${siteName}">
              ${getLaunchMessage('saveButton', 'Save')}
            </button>
          </div>
        </div>
        <div class="site-setting-field">
          <label for="${safeId}" class="site-setting-label">
            ${getLaunchMessage('entryUrlLabel', 'Entry URL')}
          </label>
          <input
            type="url"
            id="${safeId}"
            class="entry-url-input"
            value="${currentEntryUrl.replace(/"/g, '&quot;')}"
            placeholder="${getLaunchMessage('entryUrlPlaceholder', 'Enter a launch URL or use {query}')}"
          >
        </div>
      `;

      const input = card.querySelector('.entry-url-input');
      const saveBtn = card.querySelector('.save-entry-url-btn');
      const resetBtn = card.querySelector('.reset-entry-url-btn');

      saveBtn?.addEventListener('click', async () => {
        await saveOfficialEntryUrl(siteName, input?.value || '');
      });
      resetBtn?.addEventListener('click', async () => {
        if (input) {
          input.value = '';
        }
        await saveOfficialEntryUrl(siteName, '');
      });

      fragment.appendChild(card);
    });

    container.appendChild(fragment);
  } catch (error) {
    console.error('渲染 entryUrl 配置失败:', error);
    container.innerHTML = `
      <div class="site-list-empty" style="grid-column: 1 / -1;">
        ${getLaunchMessage('officialEntryUrlLoadFailed', 'Failed to load official site settings')}
      </div>
    `;
  }
}

async function loadCustomSitesManager() {
  const container = document.getElementById('customSitesAdminList');
  if (!container) {
    return;
  }

  try {
    const customSites = await window.getCustomSites?.() || [];
    renderCustomSitesManager(customSites);
  } catch (error) {
    console.error('加载 customSites 管理列表失败:', error);
    container.innerHTML = `
      <div class="site-list-empty" style="grid-column: 1 / -1;">
        ${getLaunchMessage('customSiteListLoadFailed', 'Failed to load custom sites.')}
      </div>
    `;
  }
}

function renderCustomSitesManager(customSites = []) {
  const container = document.getElementById('customSitesAdminList');
  if (!container) {
    return;
  }

  container.innerHTML = '';
  const list = Array.isArray(customSites) ? customSites : [];

  if (list.length === 0) {
    container.innerHTML = `
      <div class="site-list-empty" style="grid-column: 1 / -1;">
        ${getLaunchMessage('customSiteListEmpty', 'No custom sites yet')}
      </div>
    `;
    return;
  }

  const fragment = document.createDocumentFragment();
  list.forEach(site => {
    const siteId = escapeHtml(site?.id || '');
    const siteName = escapeHtml(site?.name || '');
    const siteUrl = escapeHtml(site?.url || '');
    const siteNote = typeof site?.note === 'string' ? site.note.trim() : '';
    const siteIcon = typeof site?.icon === 'string' ? site.icon.trim() : '';
    const displayNote = siteNote
      ? `
        <div class="custom-site-detail">
          ${getLaunchMessage('customSiteNoteLabel', 'Note')}: ${escapeHtml(siteNote)}
        </div>
      `
      : '';
    const displayIcon = siteIcon
      ? `
        <div class="custom-site-detail">
          ${getLaunchMessage('customSiteIconLabel', 'Icon')}: ${escapeHtml(siteIcon)}
        </div>
      `
      : '';
    const card = document.createElement('div');
    card.className = 'template-item custom-site-card';
    card.dataset.siteId = site?.id || '';
    card.title = [siteNote, siteIcon, site?.url || '']
      .filter(Boolean)
      .join(' · ');
    card.innerHTML = `
      <div class="template-item-head">
        <div class="template-item-body">
          <h4 class="template-item-title">${siteName}</h4>
          <div class="custom-site-url">${siteUrl}</div>
          ${displayNote}
          ${displayIcon}
          <div class="custom-site-summary">
            ${site.enabled ? getLaunchMessage('customSiteEnabledBadge', 'Enabled') : getLaunchMessage('customSiteDisabledBadge', 'Disabled')}
            ${site.order !== undefined ? ` · #${site.order}` : ''}
          </div>
        </div>
        <div class="template-actions">
          <button type="button" class="btn-secondary edit-custom-site-btn" data-site-id="${siteId}">${getLaunchMessage('editButton', 'Edit')}</button>
          <button type="button" class="btn-secondary delete-custom-site-btn" data-site-id="${siteId}">${getLaunchMessage('deleteButton', 'Delete')}</button>
        </div>
      </div>
    `;
    fragment.appendChild(card);
  });

  container.appendChild(fragment);
}

function bindCustomSiteManagerEvents() {
  document.getElementById('addCustomSiteBtn')?.addEventListener('click', () => {
    openCustomSiteDialog();
  });

  document.getElementById('customSitesAdminList')?.addEventListener('click', handleCustomSiteListClick);

  document.getElementById('customSiteDialogClose')?.addEventListener('click', closeCustomSiteDialog);
  document.getElementById('cancelCustomSite')?.addEventListener('click', closeCustomSiteDialog);
  document.getElementById('saveCustomSite')?.addEventListener('click', saveCustomSiteFromDialog);
  document.getElementById('customSiteDialogOverlay')?.addEventListener('click', closeCustomSiteDialog);
}

function openCustomSiteDialog(site = null) {
  currentEditingCustomSiteId = site?.id || null;

  const dialog = document.getElementById('customSiteDialog');
  const title = document.getElementById('customSiteDialogTitle');
  const idInput = document.getElementById('customSiteId');
  const nameInput = document.getElementById('customSiteName');
  const urlInput = document.getElementById('customSiteUrl');
  const enabledInput = document.getElementById('customSiteEnabled');
  const orderInput = document.getElementById('customSiteOrder');

  if (!dialog) {
    return;
  }

  if (title) {
    title.textContent = site
      ? getLaunchMessage('customSiteEditTitle', 'Edit custom site')
      : getLaunchMessage('customSiteAddTitle', 'Add custom site');
  }

  if (idInput) idInput.value = site?.id || '';
  if (nameInput) nameInput.value = site?.name || '';
  if (urlInput) urlInput.value = site?.url || '';
  if (enabledInput) enabledInput.checked = site?.enabled !== false;
  if (orderInput) orderInput.value = Number.isFinite(Number(site?.order)) ? String(site.order) : '0';

  dialog.style.display = 'block';
}

function closeCustomSiteDialog() {
  const dialog = document.getElementById('customSiteDialog');
  if (dialog) {
    dialog.style.display = 'none';
  }
  currentEditingCustomSiteId = null;
}

function readCustomSiteDialogValue() {
  const idInput = document.getElementById('customSiteId');
  const nameInput = document.getElementById('customSiteName');
  const urlInput = document.getElementById('customSiteUrl');
  const enabledInput = document.getElementById('customSiteEnabled');
  const orderInput = document.getElementById('customSiteOrder');

  const rawSite = {
    id: idInput?.value || currentEditingCustomSiteId || '',
    name: nameInput?.value.trim() || '',
    url: urlInput?.value.trim() || '',
    enabled: enabledInput?.checked !== false,
    order: Number.isFinite(Number(orderInput?.value)) ? Number(orderInput.value) : 0
  };

  const utils = getLaunchSettingsUtils();
  if (utils && typeof utils.normalizeCustomSite === 'function') {
    const normalizedSite = utils.normalizeCustomSite(rawSite, rawSite.order);
    if (!normalizedSite) {
      return null;
    }
    const { note, icon, ...siteWithoutDialogOnlyFields } = normalizedSite;
    return siteWithoutDialogOnlyFields;
  }

  if (!rawSite.name || !rawSite.url) {
    return null;
  }

  return {
    ...rawSite,
    id: rawSite.id || `custom-site-${Date.now()}`,
    url: normalizeCustomSiteUrlValue(rawSite.url),
    supportIframe: true,
    order: rawSite.order || 0
  };
}

async function saveCustomSiteFromDialog() {
  try {
    const nextSite = readCustomSiteDialogValue();
    if (!nextSite) {
      showToast(getLaunchMessage('customSiteValidationFailed', 'Please fill in name and URL'), true);
      return;
    }

    const { customSites: existingCustomSites = [] } = await chrome.storage.sync.get('customSites');
    const currentList = Array.isArray(existingCustomSites) ? existingCustomSites : [];
    const nextId = currentEditingCustomSiteId || nextSite.id;
    const replaced = currentList.some(site => site.id === nextId)
      ? currentList.map(site => (site.id === nextId ? { ...site, ...nextSite, id: nextId } : site))
      : [...currentList, { ...nextSite, id: nextId }];

    const utils = getLaunchSettingsUtils();
    const normalized = utils && typeof utils.normalizeCustomSites === 'function'
      ? utils.normalizeCustomSites(replaced)
      : replaced;

    await chrome.storage.sync.set({ customSites: normalized });
    showToast(getLaunchMessage('saveSuccess', 'Configuration saved'));
    await loadCustomSitesManager();
    closeCustomSiteDialog();
  } catch (error) {
    console.error('保存 customSite 失败:', error);
    showToast(getLaunchMessage('saveFailed', 'Save failed'), true);
  }
}

async function deleteCustomSite(siteId) {
  try {
    const confirmMessage = getLaunchMessage('customSiteDeleteConfirm', 'Delete this custom site?');
    if (!window.confirm(confirmMessage)) {
      return;
    }

    const { customSites: existingCustomSites = [] } = await chrome.storage.sync.get('customSites');
    const nextList = (Array.isArray(existingCustomSites) ? existingCustomSites : []).filter(site => site.id !== siteId);
    const utils = getLaunchSettingsUtils();
    const normalized = utils && typeof utils.normalizeCustomSites === 'function'
      ? utils.normalizeCustomSites(nextList)
      : nextList;

    await chrome.storage.sync.set({ customSites: normalized });
    showToast(getLaunchMessage('saveSuccess', 'Configuration saved'));
    await loadCustomSitesManager();
  } catch (error) {
    console.error('删除 customSite 失败:', error);
    showToast(getLaunchMessage('saveFailed', 'Save failed'), true);
  }
}

function handleCustomSiteListClick(event) {
  const editBtn = event.target.closest('.edit-custom-site-btn');
  const deleteBtn = event.target.closest('.delete-custom-site-btn');
  if (!editBtn && !deleteBtn) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const siteId = editBtn?.dataset.siteId || deleteBtn?.dataset.siteId;
  if (!siteId) {
    return;
  }

  (async () => {
    const { customSites: existingCustomSites = [] } = await chrome.storage.sync.get('customSites');
    const site = (Array.isArray(existingCustomSites) ? existingCustomSites : []).find(item => item.id === siteId);
    if (!site) {
      return;
    }

    if (editBtn) {
      openCustomSiteDialog(site);
      return;
    }

    if (deleteBtn) {
      await deleteCustomSite(siteId);
    }
  })();
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
      { id: 'aiSiteUserPromptButtonsSwitch', configKey: 'aiSiteUserPromptButtons', name: chrome.i18n.getMessage("aiSiteUserPromptButtons") || 'AI site buttons (compare/favorite)' },
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

    const sendShortcutContainer = document.getElementById('sendShortcutConfig');
    if (sendShortcutContainer) {
      const enterLabel = chrome.i18n.getMessage('sendShortcutOptionEnter') || 'Send with Enter';
      const modifierLabel = chrome.i18n.getMessage('sendShortcutOptionModifierEnter') || 'Send with Ctrl+Enter / ⌘+Enter';

      sendShortcutContainer.innerHTML = `
        <div class="site-config">
          <div class="site-header site-setting-row">
            <div class="site-setting-meta">
              <span class="site-setting-title">${chrome.i18n.getMessage('sendShortcutTitle') || 'Submit Shortcut'}</span>
              <div class="site-config-help">${chrome.i18n.getMessage('sendShortcutHelp') || 'Shift+Enter always inserts a newline.'}</div>
            </div>
            <select id="sendShortcutSelect" class="site-setting-select">
              <option value="enter">${enterLabel}</option>
              <option value="modifierEnter">${modifierLabel}</option>
            </select>
          </div>
        </div>
      `;

      const sendShortcutSelect = sendShortcutContainer.querySelector('#sendShortcutSelect');
      if (sendShortcutSelect) {
        sendShortcutSelect.value = currentConfig.sendShortcut || 'enter';
        sendShortcutSelect.addEventListener('change', async (e) => {
          const { buttonConfig: latestConfig } = await chrome.storage.sync.get(['buttonConfig']);
          const updatedConfig = {
            ...defaultButtonConfig,
            ...(latestConfig || currentConfig),
            sendShortcut: e.target.value
          };

          await chrome.storage.sync.set({ buttonConfig: updatedConfig });
          currentConfig = updatedConfig;
          if (chrome.runtime.lastError) {
            showToast(chrome.i18n.getMessage("saveFailed", [chrome.runtime.lastError.message]));
            return;
          }
          showToast(chrome.i18n.getMessage("saveSuccess"));
        });
      }
    }

  } catch (error) {
    console.error('初始化按钮配置失败:', error);
  }
}

// 在页面加载时初始化
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('DOMContentLoaded', function() {
    initializeI18n();
    loadConfig();
    initializeLaunchSettings();
    initializeNavigation();
    initializeDisabledSites();
  });
}

const DEFAULT_SETTINGS_SECTION = 'quick-entry';
const SETTINGS_SCROLL_TARGET_PARAM = 'scrollTarget';

function getSettingsSections() {
  return Array.from(document.querySelectorAll('.settings-section'))
    .map(section => section?.id)
    .filter(Boolean);
}

function getSafeSettingsSection(sectionId) {
  const sections = getSettingsSections();
  if (sectionId && sections.includes(sectionId)) {
    return sectionId;
  }
  return sections.includes(DEFAULT_SETTINGS_SECTION)
    ? DEFAULT_SETTINGS_SECTION
    : (sections[0] || '');
}

function showSettingsSection(sectionId, options = {}) {
  const { updateHash = false, scrollToTop = true } = options;
  const activeSection = getSafeSettingsSection(sectionId);
  if (!activeSection) {
    return;
  }

  document.querySelectorAll('.settings-section').forEach(section => {
    const isActive = section.id === activeSection;
    section.classList.toggle('is-active', isActive);
    section.hidden = !isActive;
    section.setAttribute('aria-hidden', String(!isActive));
  });

  document.querySelectorAll('.nav-link').forEach(link => {
    const isActive = link.getAttribute('data-section') === activeSection;
    link.classList.toggle('active', isActive);
    if (isActive) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });

  if (updateHash) {
    const nextHash = `#${activeSection}`;
    if (window.location.hash !== nextHash) {
      window.history.pushState(null, '', nextHash);
    }
  }

  if (scrollToTop) {
    const mainContent = document.querySelector('.main-content');
    if (mainContent) {
      mainContent.scrollTop = 0;
    }
    window.scrollTo(0, 0);
  }
}

function getRequestedSettingsScrollTarget() {
  try {
    return new URLSearchParams(window.location.search).get(SETTINGS_SCROLL_TARGET_PARAM) || '';
  } catch (_) {
    return '';
  }
}

function clearRequestedSettingsScrollTarget() {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(SETTINGS_SCROLL_TARGET_PARAM)) {
      return;
    }
    url.searchParams.delete(SETTINGS_SCROLL_TARGET_PARAM);
    window.history.replaceState(null, '', url.toString());
  } catch (_) {}
}

function scrollToSettingsTarget(targetId) {
  const normalizedTargetId = String(targetId || '').trim();
  if (!normalizedTargetId) {
    return false;
  }

  const target = document.getElementById(normalizedTargetId);
  if (!target) {
    return false;
  }

  const mainContent = document.querySelector('.main-content');
  if (mainContent && typeof target.offsetTop === 'number') {
    mainContent.scrollTo({
      top: Math.max(0, target.offsetTop - 20),
      behavior: 'smooth'
    });
  } else {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  return true;
}

function handleHashNavigation() {
  const requestedSection = window.location.hash
    ? window.location.hash.substring(1)
    : DEFAULT_SETTINGS_SECTION;
  const activeSection = getSafeSettingsSection(requestedSection);
  showSettingsSection(activeSection, { updateHash: false, scrollToTop: false });

  const scrollTarget = getRequestedSettingsScrollTarget();
  if (!scrollTarget) {
    return;
  }

  requestAnimationFrame(() => {
    scrollToSettingsTarget(scrollTarget);
    clearRequestedSettingsScrollTarget();
  });
}

// 初始化导航功能
function initializeNavigation() {
  const navLinks = document.querySelectorAll('.nav-link');

  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const targetSection = link.getAttribute('data-section');
      showSettingsSection(targetSection, { updateHash: true });
    });
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
        <div class="empty-state state-panel">
          <p>${chrome.i18n.getMessage('noDisabledSites') || '暂无被禁用的网站'}</p>
        </div>
      `;
      return;
    }

    container.innerHTML = disabledSites.map(site => `
      <div class="disabled-site-item">
        <div class="site-info">
          <span class="site-domain">${site}</span>
          <span class="site-note">悬浮球已禁用</span>
        </div>
        <div class="site-actions">
          <button class="enable-btn btn-secondary" data-domain="${site}">
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
      <div class="error-state state-panel">
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
    
    showToast(getMessageWithFallback('reEnableFloatButtonSuccess', 'Re-enabled the floating button for $1', [domain]));

    // 重新加载列表
    initializeDisabledSites();
    
  } catch (error) {
    console.error('操作失败:', error);
    showToast(getMessageWithFallback('operationFailedRetry', 'Operation failed. Please try again.'));
  }
}

// ============================
// 提示词模板管理功能
// ============================

// 当前编辑的模板ID
let currentEditingTemplateId = null;
let currentEditingAnalysisTemplateId = null;
let currentEditingCustomSiteId = null;

// 初始化提示词模板管理
async function initializePromptTemplates() {
  try {
    await loadConfiguredTemplateTypes();

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

async function initializeAnalysisPromptTemplates() {
  try {
    await ensureDefaultAnalysisTemplates();
    await loadAnalysisTemplatesList();
    bindAnalysisTemplateEvents();
    console.log('分析提示词模板管理初始化完成');
  } catch (error) {
    console.error('初始化分析提示词模板失败:', error);
  }
}

// 确保存在默认模板
async function ensureDefaultTemplates() {
  try {
    try {
      await chrome.runtime.sendMessage({ action: 'initializeDefaultTemplates' });
    } catch (error) {
      console.log('无法发送初始化消息，background 可能已处理:', error);
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
    
    const sortedTemplates = getPromptTemplateUtils()?.sortPromptTemplates
      ? getPromptTemplateUtils().sortPromptTemplates(promptTemplates, configuredTemplateTypes)
      : promptTemplates.sort((a, b) => (a.order || 0) - (b.order || 0));
    
    if (sortedTemplates.length === 0) {
      container.innerHTML = `
        <div class="state-panel">
          <p>暂无提示词模板</p>
          <p class="state-message">点击上方"添加新模板"按钮开始创建</p>
        </div>
      `;
      return;
    }
    
    container.innerHTML = sortedTemplates.map(template => `
      <div class="template-item" data-template-id="${template.id}">
        <div class="template-item-head">
          <div class="template-item-body">
            <h4 class="template-item-title">${template.name}</h4>
            <div class="template-meta">
              <span>${chrome.i18n.getMessage('templateOrderLabel') || 'Order'}: ${template.order}</span>
              <span class="template-badge">${getPromptTemplateTypeLabel(template.type)}</span>
            </div>
          </div>
          <div class="template-actions">
            <button class="edit-template-btn icon-action-btn" data-template-id="${template.id}" title="${chrome.i18n.getMessage('editButton')}" aria-label="${chrome.i18n.getMessage('editButton')}">
              <img src="../icons/edit.svg" alt="">
            </button>
            ${!template.isDefault ? `<button class="delete-template-btn danger-btn" data-template-id="${template.id}" data-i18n="deleteButton">删除</button>` : ''}
          </div>
        </div>
        <div class="template-code">${template.query}</div>
      </div>
    `).join('');
    
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
      void showTemplateDialog();
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
async function showTemplateDialog(template = null) {
  const dialog = document.getElementById('templateDialog');
  const title = document.getElementById('dialogTitle');
  const nameInput = document.getElementById('templateName');
  const queryInput = document.getElementById('templateQuery');
  const typeInput = document.getElementById('templateType');
  const orderInput = document.getElementById('templateOrder');
  
  if (!dialog) return;
  await loadConfiguredTemplateTypes();
  
  if (template) {
    // 编辑模式
    title.textContent = chrome.i18n.getMessage('editTemplateTitle');
    nameInput.value = template.name;
    queryInput.value = template.query;
    populateTemplateTypeOptions(template.type);
    orderInput.value = template.order || 1;
  } else {
    // 添加模式
    title.textContent = chrome.i18n.getMessage('addTemplateTitle');
    nameInput.value = '';
    queryInput.value = '';
    populateTemplateTypeOptions('information');
    orderInput.value = 1;
    void getNextOrder().then(nextOrder => {
      orderInput.value = nextOrder;
    });
  }
  
  dialog.style.display = 'block';
  typeInput?.blur();
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
  const typeInput = document.getElementById('templateType');
  const orderInput = document.getElementById('templateOrder');
  
  const name = nameInput.value.trim();
  const query = queryInput.value.trim();
  const type = normalizeTemplateType(typeInput?.value);
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
          type,
          order
        };
      }
    } else {
      // 添加新模板
      const newTemplate = {
        id: generateTemplateId(),
        name,
        query,
        type,
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
    showToast(getMessageWithFallback('saveFailedGeneric', 'Save failed. Please try again.'));
  }
}

// 编辑模板
async function editTemplate(templateId) {
  try {
    const { promptTemplates = [] } = await chrome.storage.sync.get('promptTemplates');
    const template = promptTemplates.find(t => t.id === templateId);
    
    if (template) {
      currentEditingTemplateId = templateId;
      await showTemplateDialog(template);
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

async function ensureDefaultAnalysisTemplates() {
  try {
    await chrome.runtime.sendMessage({ action: 'initializeDefaultTemplates' });
  } catch (error) {
    console.log('无法发送分析模板初始化消息，background 可能已处理:', error);
  }
}

function generateAnalysisTemplateId() {
  return 'analysis_template_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

async function getNextAnalysisOrder() {
  try {
    const { analysisPromptTemplates = [] } = await chrome.storage.sync.get('analysisPromptTemplates');
    const maxOrder = analysisPromptTemplates.reduce((max, template) =>
      Math.max(max, template.order || 0), 0);
    return maxOrder + 1;
  } catch (error) {
    return 1;
  }
}

async function loadAnalysisTemplatesList() {
  try {
    const { analysisPromptTemplates = [] } = await chrome.storage.sync.get('analysisPromptTemplates');
    const container = document.getElementById('analysisTemplatesList');
    if (!container) return;

    const sortedTemplates = (Array.isArray(analysisPromptTemplates) ? analysisPromptTemplates : [])
      .filter(template => template?.name && template?.query)
      .sort((a, b) => (a.order || 0) - (b.order || 0));

    if (sortedTemplates.length === 0) {
      container.innerHTML = `
        <div class="state-panel">
          <p>${chrome.i18n.getMessage('analysisTemplateListEmpty') || '暂无分析提示词模板'}</p>
          <p class="state-message">${chrome.i18n.getMessage('analysisTemplateListHint') || '点击上方“添加分析提示词”按钮开始创建'}</p>
        </div>
      `;
      return;
    }

    container.innerHTML = sortedTemplates.map(template => `
      <div class="template-item" data-template-id="${template.id}">
        <div class="template-item-head">
          <div class="template-item-body">
            <h4 class="template-item-title">${template.name}</h4>
            <div class="template-meta">
              <span>${chrome.i18n.getMessage('templateOrderLabel') || 'Order'}: ${template.order}</span>
              <span class="template-badge">${chrome.i18n.getMessage('analysisPromptTemplateBadge') || 'Analysis'}</span>
            </div>
          </div>
          <div class="template-actions">
            <button class="edit-analysis-template-btn icon-action-btn" data-template-id="${template.id}" title="${chrome.i18n.getMessage('editButton')}" aria-label="${chrome.i18n.getMessage('editButton')}">
              <img src="../icons/edit.svg" alt="">
            </button>
            ${!template.isDefault ? `<button class="delete-analysis-template-btn danger-btn" data-template-id="${template.id}">${chrome.i18n.getMessage('deleteButton') || 'Delete'}</button>` : ''}
          </div>
        </div>
        <div class="template-code preserve-lines">${template.query}</div>
      </div>
    `).join('');
  } catch (error) {
    console.error('加载分析提示词模板列表失败:', error);
  }
}

function bindAnalysisTemplateEvents() {
  const addBtn = document.getElementById('addAnalysisTemplateBtn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      currentEditingAnalysisTemplateId = null;
      void showAnalysisTemplateDialog();
    });
  }

  const dialogClose = document.getElementById('analysisDialogClose');
  const cancelBtn = document.getElementById('cancelAnalysisTemplate');
  const overlay = document.getElementById('analysisDialogOverlay');

  [dialogClose, cancelBtn, overlay].forEach(el => {
    if (el) {
      el.addEventListener('click', hideAnalysisTemplateDialog);
    }
  });

  document.getElementById('saveAnalysisTemplate')?.addEventListener('click', saveAnalysisTemplate);
  document.getElementById('analysisTemplatesList')?.addEventListener('click', handleAnalysisTemplateListClick);
}

async function showAnalysisTemplateDialog(template = null) {
  const dialog = document.getElementById('analysisTemplateDialog');
  const title = document.getElementById('analysisDialogTitle');
  const nameInput = document.getElementById('analysisTemplateName');
  const queryInput = document.getElementById('analysisTemplateQuery');
  const orderInput = document.getElementById('analysisTemplateOrder');

  if (!dialog) return;

  if (template) {
    title.textContent = chrome.i18n.getMessage('editAnalysisTemplateTitle') || 'Edit analysis prompt';
    nameInput.value = template.name;
    queryInput.value = template.query;
    orderInput.value = template.order || 1;
  } else {
    title.textContent = chrome.i18n.getMessage('addAnalysisTemplateTitle') || 'Add analysis prompt';
    nameInput.value = '';
    queryInput.value = '';
    orderInput.value = 1;
    void getNextAnalysisOrder().then(nextOrder => {
      orderInput.value = nextOrder;
    });
  }

  dialog.style.display = 'block';
  nameInput.focus();
}

function hideAnalysisTemplateDialog() {
  const dialog = document.getElementById('analysisTemplateDialog');
  if (dialog) {
    dialog.style.display = 'none';
  }
  currentEditingAnalysisTemplateId = null;
}

async function saveAnalysisTemplate() {
  const nameInput = document.getElementById('analysisTemplateName');
  const queryInput = document.getElementById('analysisTemplateQuery');
  const orderInput = document.getElementById('analysisTemplateOrder');

  const name = nameInput.value.trim();
  const query = queryInput.value.trim();
  const order = parseInt(orderInput.value) || 1;

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
    const { analysisPromptTemplates = [] } = await chrome.storage.sync.get('analysisPromptTemplates');

    if (currentEditingAnalysisTemplateId) {
      const index = analysisPromptTemplates.findIndex(t => t.id === currentEditingAnalysisTemplateId);
      if (index !== -1) {
        analysisPromptTemplates[index] = {
          ...analysisPromptTemplates[index],
          name,
          query,
          order
        };
      }
    } else {
      analysisPromptTemplates.push({
        id: generateAnalysisTemplateId(),
        name,
        query,
        order,
        isDefault: false
      });
    }

    await chrome.storage.sync.set({ analysisPromptTemplates });
    hideAnalysisTemplateDialog();
    await loadAnalysisTemplatesList();
    showToast(chrome.i18n.getMessage('templateSavedSuccess'));
  } catch (error) {
    console.error('保存分析提示词失败:', error);
    showToast(getMessageWithFallback('saveFailedGeneric', 'Save failed. Please try again.'));
  }
}

async function editAnalysisTemplate(templateId) {
  try {
    const { analysisPromptTemplates = [] } = await chrome.storage.sync.get('analysisPromptTemplates');
    const template = analysisPromptTemplates.find(t => t.id === templateId);
    if (template) {
      currentEditingAnalysisTemplateId = templateId;
      await showAnalysisTemplateDialog(template);
    }
  } catch (error) {
    console.error('编辑分析提示词失败:', error);
  }
}

async function deleteAnalysisTemplate(templateId) {
  const confirmMessage = chrome.i18n.getMessage('confirmDeleteTemplate');
  if (!confirm(confirmMessage)) {
    return;
  }

  try {
    const { analysisPromptTemplates = [] } = await chrome.storage.sync.get('analysisPromptTemplates');
    const filteredTemplates = analysisPromptTemplates.filter(t => t.id !== templateId);
    await chrome.storage.sync.set({ analysisPromptTemplates: filteredTemplates });
    await loadAnalysisTemplatesList();
    showToast(chrome.i18n.getMessage('templateDeletedSuccess'));
  } catch (error) {
    console.error('删除分析提示词失败:', error);
    showToast(getMessageWithFallback('deleteFailed', 'Delete failed. Please try again.'));
  }
}

async function handleAnalysisTemplateListClick(event) {
  const editBtn = event.target.closest('.edit-analysis-template-btn');
  const deleteBtn = event.target.closest('.delete-analysis-template-btn');

  if (editBtn) {
    const templateId = editBtn.getAttribute('data-template-id');
    if (templateId) await editAnalysisTemplate(templateId);
  } else if (deleteBtn) {
    const templateId = deleteBtn.getAttribute('data-template-id');
    if (templateId) await deleteAnalysisTemplate(templateId);
  }
}

// ── 数据同步（WebDAV）──────────────────────────────────────────

const SYNC_STORAGE_KEY = 'webdavSyncConfig';
const SYNC_DATA_FILENAME = 'multiAI-settings.json';
const LOCAL_SYNC_KEYS = ['pkHistory', 'favoriteFolders'];
const LOCAL_SYNC_FILE_PREFIX = 'multiAI-settings-backup';

// 需要同步的 chrome.storage.sync 数据键
const SYNC_KEYS = [
  'buttonConfig',
  'sites',
  'customSites',
  'siteSettings',
  'disabledSites',
  'promptTemplates',
  'analysisPromptTemplates',
  'favoritePrompts',
  'favoriteSites',
];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pickSyncPayload(source = {}, keys = []) {
  const payload = {};

  keys.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(source, key) && typeof source[key] !== 'undefined') {
      payload[key] = source[key];
    }
  });

  return payload;
}

function createLocalSyncFileName() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${LOCAL_SYNC_FILE_PREFIX}-${stamp}.json`;
}

function downloadJsonFile(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function getLocalSyncImportSource(rawPayload) {
  if (!isPlainObject(rawPayload)) {
    return null;
  }

  const hasTopLevelSyncKeys = [...SYNC_KEYS, ...LOCAL_SYNC_KEYS].some((key) =>
    Object.prototype.hasOwnProperty.call(rawPayload, key)
  );

  if (hasTopLevelSyncKeys) {
    return rawPayload;
  }

  const nestedSync = isPlainObject(rawPayload.sync) ? rawPayload.sync : null;
  const nestedLocal = isPlainObject(rawPayload.local) ? rawPayload.local : null;

  if (nestedSync || nestedLocal) {
    return {
      ...(nestedSync || {}),
      ...(nestedLocal || {})
    };
  }

  return null;
}

function getLocalSyncImportPayload(rawPayload) {
  const source = getLocalSyncImportSource(rawPayload);
  if (!source) {
    throw new Error(chrome.i18n.getMessage('localSyncInvalidFile') || 'Invalid backup file');
  }

  const syncPatch = pickSyncPayload(source, SYNC_KEYS);
  const localPatch = pickSyncPayload(source, LOCAL_SYNC_KEYS);

  if (!Object.keys(syncPatch).length && !Object.keys(localPatch).length) {
    throw new Error(chrome.i18n.getMessage('localSyncInvalidFile') || 'Invalid backup file');
  }

  return { syncPatch, localPatch };
}

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
  const localData = await chrome.storage.local.get(LOCAL_SYNC_KEYS);
  return {
    ...syncData,
    pkHistory: (localData.pkHistory || []).slice(0, 500),
    favoriteFolders: localData.favoriteFolders || [],
    _syncVersion: 1,
    _exportedAt: new Date().toISOString(),
  };
}

async function exportLocalSyncBackup() {
  try {
    const payload = await exportAllSettings();
    downloadJsonFile(createLocalSyncFileName(), payload);
    showSyncStatus(chrome.i18n.getMessage('localSyncExportSuccess') || '备份已下载', 'success');
  } catch (error) {
    console.error('导出本地备份失败:', error);
    showSyncStatus(
      `${chrome.i18n.getMessage('localSyncExportFailed') || '导出失败'}: ${error.message}`,
      'error'
    );
  }
}

async function importLocalSyncBackupFromFile(file) {
  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    const rawPayload = JSON.parse(text.replace(/^\uFEFF/, '').trim());
    const confirmMessage = chrome.i18n.getMessage('localSyncImportConfirm')
      || 'Import this backup and overwrite the current sync data?';

    if (!window.confirm(confirmMessage)) {
      return;
    }

    const { syncPatch, localPatch } = getLocalSyncImportPayload(rawPayload);

    showSyncStatus(chrome.i18n.getMessage('localSyncImporting') || '正在恢复本地备份…', 'loading');

    const writeTasks = [];
    if (Object.keys(syncPatch).length > 0) {
      writeTasks.push(chrome.storage.sync.set(syncPatch));
    }
    if (Object.keys(localPatch).length > 0) {
      writeTasks.push(chrome.storage.local.set(localPatch));
    }

    await Promise.all(writeTasks);

    showSyncStatus(
      chrome.i18n.getMessage('localSyncImportSuccess') || '本地备份已恢复，请刷新页面生效',
      'success'
    );
  } catch (error) {
    console.error('导入本地备份失败:', error);
    const invalidMessage = chrome.i18n.getMessage('localSyncInvalidFile') || 'This file is not a valid AI Compare backup';
    const detail = error instanceof SyntaxError ? invalidMessage : (error.message || invalidMessage);
    showSyncStatus(
      `${chrome.i18n.getMessage('localSyncImportFailed') || '恢复失败'}: ${detail}`,
      'error'
    );
  } finally {
    const input = document.getElementById('localSyncFileInput');
    if (input) {
      input.value = '';
    }
  }
}

function handleLocalSyncImportClick() {
  const input = document.getElementById('localSyncFileInput');
  if (input) {
    input.click();
  }
}

async function handleLocalSyncFileSelection(event) {
  const file = event?.target?.files?.[0];
  if (!file) {
    return;
  }
  await importLocalSyncBackupFromFile(file);
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
  document.getElementById('exportLocalSync')?.addEventListener('click', exportLocalSyncBackup);
  document.getElementById('importLocalSync')?.addEventListener('click', handleLocalSyncImportClick);
  document.getElementById('localSyncFileInput')?.addEventListener('change', handleLocalSyncFileSelection);

  document.getElementById('togglePassword')?.addEventListener('click', () => {
    const input = document.getElementById('syncPassword');
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
  });
}

let remoteSearchUiInitialized = false;
let remoteSearchMessageListenerBound = false;
let remoteSearchState = null;
let remoteSearchStateUpdatedAt = 0;
let remoteSearchQrLoadToken = 0;

function getRemoteSearchStatusMessage(status) {
  const normalizedStatus = String(status || '').trim();
  switch (normalizedStatus) {
    case 'online':
      return getMessage('remoteSearchStatusOnline') || 'Online';
    case 'connecting':
      return getMessage('remoteSearchStatusConnecting') || 'Connecting';
    case 'offline':
      return getMessage('remoteSearchStatusOffline') || 'Offline';
    case 'error':
      return getMessage('remoteSearchStatusError') || 'Error';
    case 'disabled':
    default:
      return getMessage('remoteSearchStatusDisabled') || 'Disabled';
  }
}

function formatRemoteSearchTime(value) {
  const rawValue = String(value || '').trim();
  if (!rawValue) {
    return '-';
  }

  const parsed = new Date(rawValue);
  if (Number.isNaN(parsed.getTime())) {
    return rawValue;
  }

  try {
    return parsed.toLocaleString();
  } catch (_) {
    return rawValue;
  }
}

function getRemoteSearchStateUpdatedAt(state) {
  const rawValue = String(state?.updatedAt || '').trim();
  if (!rawValue) {
    return 0;
  }

  const parsedValue = Date.parse(rawValue);
  return Number.isFinite(parsedValue) ? parsedValue : 0;
}

function shouldIgnoreRemoteSearchStateUpdate(nextState) {
  if (!remoteSearchState || !remoteSearchStateUpdatedAt) {
    return false;
  }

  const nextUpdatedAt = getRemoteSearchStateUpdatedAt(nextState);
  if (!nextUpdatedAt) {
    return true;
  }

  return nextUpdatedAt < remoteSearchStateUpdatedAt;
}

function clearRemoteSearchQrImage(qrImage) {
  if (!qrImage) {
    return;
  }

  qrImage.hidden = true;
  qrImage.removeAttribute('src');
}

function buildRemoteSearchQrImageSource(svgText) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(String(svgText || ''))}`;
}

function shouldEnableRemoteSearchGenerateButton(state, draftSettings = null) {
  return state?.settings?.enabled === true || draftSettings?.enabled === true;
}

function getRemoteSearchDraftSettings() {
  return {
    enabled: document.getElementById('remoteSearchEnabled')?.checked === true,
    relayBaseUrl: document.getElementById('remoteSearchRelayUrl')?.value?.trim() || '',
    desktopName: document.getElementById('remoteSearchDesktopName')?.value?.trim() || ''
  };
}

function updateRemoteSearchGenerateButtonState(state = remoteSearchState) {
  const generateQrButton = document.getElementById('generateRemoteSearchQr');
  if (!generateQrButton) {
    return;
  }

  generateQrButton.disabled = !shouldEnableRemoteSearchGenerateButton(
    state,
    getRemoteSearchDraftSettings()
  );
}

async function sendRemoteSearchRuntimeMessage(action, payload = {}) {
  const response = await chrome.runtime.sendMessage({
    action,
    ...payload
  });

  if (!response?.success) {
    throw new Error(response?.error || 'Remote Search request failed');
  }

  return response.result;
}

function readRemoteSearchSettingsFromForm() {
  return getRemoteSearchDraftSettings();
}

function setRemoteSearchQrPlaceholderText(message) {
  const placeholder = document.getElementById('remoteSearchQrPlaceholder');
  if (placeholder) {
    placeholder.textContent = message || (getMessage('remoteSearchQrEmpty') || 'Enable remote search to generate a pairing QR code.');
  }
}

async function renderRemoteSearchQr(ticket, relayBaseUrl) {
  const qrImage = document.getElementById('remoteSearchQrImage');
  const placeholder = document.getElementById('remoteSearchQrPlaceholder');
  const expiresAt = document.getElementById('remoteSearchTicketExpiresAt');
  const loadToken = ++remoteSearchQrLoadToken;

  if (expiresAt) {
    expiresAt.textContent = formatRemoteSearchTime(ticket?.expiresAt);
  }

  if (!qrImage) {
    return;
  }

  if (!ticket?.qrPayload) {
    clearRemoteSearchQrImage(qrImage);
    if (placeholder) {
      placeholder.hidden = false;
    }
    return;
  }

  const effectiveRelayUrl = String(ticket.relayBaseUrl || relayBaseUrl || '').trim();
  if (!effectiveRelayUrl) {
    clearRemoteSearchQrImage(qrImage);
    if (placeholder) {
      placeholder.hidden = false;
    }
    setRemoteSearchQrPlaceholderText(getMessage('remoteSearchQrEmpty') || 'Enable remote search to generate a pairing QR code.');
    return;
  }

  setRemoteSearchQrPlaceholderText(getMessage('remoteSearchQrLoading') || 'Generating QR code...');
  if (placeholder) {
    placeholder.hidden = false;
  }
  clearRemoteSearchQrImage(qrImage);

  try {
    const qrResponse = await fetch(`${effectiveRelayUrl.replace(/\/+$/, '')}/qr?data=${encodeURIComponent(JSON.stringify(ticket.qrPayload))}`);
    if (!qrResponse.ok) {
      throw new Error(`HTTP ${qrResponse.status}`);
    }

    const svgText = await qrResponse.text();
    if (loadToken !== remoteSearchQrLoadToken) {
      return;
    }

    qrImage.src = buildRemoteSearchQrImageSource(svgText);
    qrImage.hidden = false;
    if (placeholder) {
      placeholder.hidden = true;
    }
  } catch (error) {
    console.error('加载远程搜索二维码失败:', error);
    clearRemoteSearchQrImage(qrImage);
    if (placeholder) {
      placeholder.hidden = false;
    }
    setRemoteSearchQrPlaceholderText(
      `${getMessage('remoteSearchQrLoadFailed') || 'Failed to load QR code'}: ${error.message || error}`
    );
  }
}

function renderRemoteSearchState(state) {
  if (state && shouldIgnoreRemoteSearchStateUpdate(state)) {
    return remoteSearchState;
  }

  remoteSearchState = state || null;
  remoteSearchStateUpdatedAt = getRemoteSearchStateUpdatedAt(remoteSearchState);

  const status = String(state?.connectionStatus || 'disabled').trim() || 'disabled';
  const statusText = getRemoteSearchStatusMessage(status);
  const enabledInput = document.getElementById('remoteSearchEnabled');
  const relayInput = document.getElementById('remoteSearchRelayUrl');
  const desktopNameInput = document.getElementById('remoteSearchDesktopName');
  const connectionBadge = document.getElementById('remoteSearchConnectionBadge');
  const statusLabel = document.getElementById('remoteSearchStatusText');
  const pendingCard = document.getElementById('remoteSearchPendingPairCard');
  const pairedEmpty = document.getElementById('remoteSearchPairedEmpty');
  const pairedDetails = document.getElementById('remoteSearchPairedDetails');
  const lastError = document.getElementById('remoteSearchLastError');
  const generateQrButton = document.getElementById('generateRemoteSearchQr');

  if (enabledInput) {
    enabledInput.checked = state?.settings?.enabled === true;
  }
  if (relayInput) {
    relayInput.value = state?.settings?.relayBaseUrl || relayInput.value || '';
  }
  if (desktopNameInput) {
    desktopNameInput.value = state?.settings?.desktopName || state?.deviceIdentity?.deviceName || desktopNameInput.value || '';
  }

  if (connectionBadge) {
    connectionBadge.textContent = statusText;
    connectionBadge.dataset.status = status;
  }
  if (statusLabel) {
    statusLabel.textContent = statusText;
  }
  if (generateQrButton) {
    updateRemoteSearchGenerateButtonState(state);
  }

  const pendingPair = state?.pendingPairRequest || null;
  if (pendingCard) {
    pendingCard.hidden = !pendingPair;
  }
  const pendingPhoneName = document.getElementById('remoteSearchPendingPhoneName');
  const pendingPhonePlatform = document.getElementById('remoteSearchPendingPhonePlatform');
  const pendingFingerprint = document.getElementById('remoteSearchPendingFingerprint');
  if (pendingPhoneName) {
    pendingPhoneName.textContent = pendingPair?.phoneName || pendingPair?.phoneDeviceId || '-';
  }
  if (pendingPhonePlatform) {
    pendingPhonePlatform.textContent = pendingPair?.phonePlatform || '-';
  }
  if (pendingFingerprint) {
    pendingFingerprint.textContent = pendingPair?.phoneFingerprint || '-';
  }

  const pairRecord = state?.pairRecord || null;
  if (pairedEmpty) {
    pairedEmpty.hidden = Boolean(pairRecord);
  }
  if (pairedDetails) {
    pairedDetails.hidden = !pairRecord;
  }
  const pairedPhoneName = document.getElementById('remoteSearchPairedPhoneName');
  const pairedPhonePlatform = document.getElementById('remoteSearchPairedPhonePlatform');
  const pairedFingerprint = document.getElementById('remoteSearchPairedFingerprint');
  if (pairedPhoneName) {
    pairedPhoneName.textContent = pairRecord?.phoneName || pairRecord?.phoneDeviceId || '-';
  }
  if (pairedPhonePlatform) {
    pairedPhonePlatform.textContent = pairRecord?.phonePlatform || '-';
  }
  if (pairedFingerprint) {
    pairedFingerprint.textContent = pairRecord?.phoneFingerprint || '-';
  }

  if (lastError) {
    lastError.textContent = state?.lastError || getMessage('remoteSearchNoLastError') || 'No recent errors.';
  }

  void renderRemoteSearchQr(state?.pairingTicket || null, state?.settings?.relayBaseUrl || '');
}

async function refreshRemoteSearchState() {
  const state = await sendRemoteSearchRuntimeMessage('remoteGetState');
  renderRemoteSearchState(state);
  return state;
}

async function saveRemoteSearchSettings(options = {}) {
  const nextState = await sendRemoteSearchRuntimeMessage('remoteUpdateSettings', {
    settings: readRemoteSearchSettingsFromForm()
  });
  renderRemoteSearchState(nextState);
  if (options.silent !== true) {
    showToast(getMessage('saveSuccess') || 'Configuration saved');
  }
  return nextState;
}

async function createRemoteSearchPairingTicket() {
  await saveRemoteSearchSettings({ silent: true });
  await sendRemoteSearchRuntimeMessage('remoteCreatePairingTicket');
  await refreshRemoteSearchState();
  showToast(getMessage('remoteSearchQrReadyToast') || 'Pairing QR code is ready');
}

function handleRemoteSearchRuntimeUpdateMessage(message) {
  if (message?.type !== 'remoteStateChanged' || !message.state) {
    return;
  }

  renderRemoteSearchState(message.state);
}

function initializeRemoteSearchSettings() {
  if (remoteSearchUiInitialized) {
    return;
  }

  remoteSearchUiInitialized = true;

  const syncGenerateButtonState = () => {
    updateRemoteSearchGenerateButtonState(remoteSearchState);
  };

  document.getElementById('saveRemoteSearchSettings')?.addEventListener('click', async () => {
    try {
      await saveRemoteSearchSettings();
    } catch (error) {
      console.error('保存远程搜索设置失败:', error);
      showToast(`${getMessage('saveFailed', [error.message || String(error)]) || `Save failed: ${error.message || error}`}`);
    }
  });

  document.getElementById('generateRemoteSearchQr')?.addEventListener('click', async () => {
    try {
      await createRemoteSearchPairingTicket();
    } catch (error) {
      console.error('生成远程搜索二维码失败:', error);
      showToast(`${getMessage('saveFailed', [error.message || String(error)]) || `Save failed: ${error.message || error}`}`);
    }
  });

  document.getElementById('remoteSearchEnabled')?.addEventListener('change', syncGenerateButtonState);
  document.getElementById('remoteSearchRelayUrl')?.addEventListener('input', syncGenerateButtonState);
  document.getElementById('remoteSearchDesktopName')?.addEventListener('input', syncGenerateButtonState);

  document.getElementById('remoteSearchApprovePair')?.addEventListener('click', async () => {
    try {
      await sendRemoteSearchRuntimeMessage('remoteApprovePendingPair');
      await refreshRemoteSearchState();
      showToast(getMessage('saveSuccess') || 'Configuration saved');
    } catch (error) {
      console.error('批准远程搜索配对失败:', error);
      showToast(`${getMessage('saveFailed', [error.message || String(error)]) || `Save failed: ${error.message || error}`}`);
    }
  });

  document.getElementById('remoteSearchRejectPair')?.addEventListener('click', async () => {
    try {
      await sendRemoteSearchRuntimeMessage('remoteRejectPendingPair');
      await refreshRemoteSearchState();
    } catch (error) {
      console.error('拒绝远程搜索配对失败:', error);
      showToast(`${getMessage('saveFailed', [error.message || String(error)]) || `Save failed: ${error.message || error}`}`);
    }
  });

  document.getElementById('remoteSearchUnpair')?.addEventListener('click', async () => {
    try {
      await sendRemoteSearchRuntimeMessage('remoteRevokePairing');
      await refreshRemoteSearchState();
    } catch (error) {
      console.error('解除远程搜索绑定失败:', error);
      showToast(`${getMessage('saveFailed', [error.message || String(error)]) || `Save failed: ${error.message || error}`}`);
    }
  });

  if (!remoteSearchMessageListenerBound) {
    chrome.runtime.onMessage.addListener(handleRemoteSearchRuntimeUpdateMessage);
    remoteSearchMessageListenerBound = true;
  }

  refreshRemoteSearchState().catch((error) => {
    console.error('加载远程搜索状态失败:', error);
    showToast(`${getMessage('saveFailed', [error.message || String(error)]) || `Save failed: ${error.message || error}`}`);
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
      showToast(chrome.i18n.getMessage('membershipPriceNotConfigured') || 'Stripe Price ID not configured. Please set it first.', 3000);
      return;
    }
    if (btn) btn.disabled = true;
    try {
      if (typeof window.startCheckout === 'function') {
        await window.startCheckout(priceId);
      } else {
        showToast(getMessageWithFallback('stripePaymentScriptNotLoaded', 'stripe-payment.js is not loaded.'), 3000);
      }
    } catch (e) {
      showToast(e.message || getMessageWithFallback('stripeCheckoutOpenFailed', 'Failed to open the checkout page.'), 3000);
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
          showToast(getMessageWithFallback('stripePaymentScriptNotLoaded', 'stripe-payment.js is not loaded.'), 3000);
        }
      } catch (e) {
        showToast(e.message || getMessageWithFallback('stripePortalOpenFailed', 'Failed to open the subscription management page.'), 3000);
      } finally {
        btnManage.disabled = false;
      }
    });
  }
}

// 页面初始化
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
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

    // 初始化远程搜索
    initializeRemoteSearchSettings();

    // Pro 会员功能暂时隐藏，下版本恢复后再启用
    // initializeMembership();
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildRemoteSearchQrImageSource,
    shouldEnableRemoteSearchGenerateButton,
    getRemoteSearchDraftSettings
  };
}
