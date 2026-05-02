function t(key, fallback = '') {
  return chrome?.i18n?.getMessage?.(key) || fallback;
}

function getBrandIconUrl(size = 48) {
  if (window.ExtensionEnvironment && typeof window.ExtensionEnvironment.getBrandIconUrl === 'function') {
    return window.ExtensionEnvironment.getBrandIconUrl(size);
  }

  return chrome.runtime.getURL(`icons/icon${size}.png`);
}

// 创建浮动按钮和对话框
async function createFloatButton() {
  console.log('脚本开始加载');
  
  // 获取当前语言的翻译
  const i18n = {
    inputPlaceholder: t('inputPlaceholder', 'Enter content to search...'),
    startCompare: t('startCompare', 'PK'),
    shortcutMac: t('floatButtonShortcutMac', '⌘+M Open side panel'),
    shortcutWindows: t('floatButtonShortcutWindows', 'Ctrl+M Open side panel'),
    settingsTitle: t('settingsLink', 'Settings'),
    feedbackTitle: t('userFeedback', 'Feedback')
  };
  
  // 创建整体容器
  const container = document.createElement('div');
  container.className = 'multi-ai-container';

  // 创建浮动按钮
  const button = document.createElement('div');
  button.className = 'multi-ai-float-button';
  
  // 添加主按钮图标
  const img = document.createElement('img');
  img.src = getBrandIconUrl(48);
  button.appendChild(img);

  // 创建对话框
  const dialog = document.createElement('div');
  dialog.className = 'multi-ai-dialog';
  dialog.innerHTML = `
    <input 
      type="text" 
      placeholder="${i18n.inputPlaceholder}" 
      id="multiAiInput"
      autocomplete="off"
    >
    <div class="site-list"></div>
    <div class="buttons">
      <button class="search-button">
        ${i18n.startCompare}
      </button>
      <img src="${chrome.runtime.getURL('icons/more_32.png')}" class="more-icon">
    </div>
  `;

  // 创建关闭按钮
  const closeBtn = document.createElement('div');
  closeBtn.className = 'close-button';
  closeBtn.innerHTML = '×';

  // 修改关闭按钮的点击事件处理
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();  // 阻止事件冒泡
    e.preventDefault();   // 阻止默认行为
    showCloseOptionsDialog(container, e);
    return false;        // 确保事件不会继续传播
  });

  // 将关闭按钮添加到按钮中
  button.appendChild(closeBtn);

  // 按钮的点击事件 - 直接打开侧边栏
  button.addEventListener('click', (e) => {
    e.stopPropagation(); // 阻止事件冒泡，避免触发页面的选择事件
    e.preventDefault();  // 阻止默认行为
    
    if (!hasMoved) {  // 只有在没有拖动的情况下才触发点击事件
      console.log('浮动按钮点击，发送TOGGLE_SIDE_PANEL消息');
      chrome.runtime.sendMessage({ type: 'TOGGLE_SIDE_PANEL' }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('发送消息失败:', chrome.runtime.lastError);
        } else {
          console.log('收到响应:', response);
        }
      });
    } else {
      console.log('按钮被拖拽，不触发点击事件，hasMoved:', hasMoved);
    }
  });

  // 检测操作系统类型
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

  // 设置提示文本
  const shortcutText = isMac ? i18n.shortcutMac : i18n.shortcutWindows;
  // 添加提示框
  button.addEventListener('mouseenter', () => {
    const tooltip = document.createElement('div');
    tooltip.className = 'multi-ai-tooltip';
    tooltip.textContent = shortcutText;
    button.appendChild(tooltip);
    setTimeout(() => {
      if (tooltip && tooltip.parentNode === button) {
        tooltip.remove();
      }
    }, 500);
  });

  // 创建图标容器
  const iconContainer = document.createElement('div');
  iconContainer.className = 'icon-container';


  // 创建设置图标
  const settingIcon = document.createElement('img');
  settingIcon.src = chrome.runtime.getURL('icons/extension-setting.svg');
  settingIcon.className = 'bottom-icon setting-icon';
  settingIcon.title = i18n.settingsTitle;

  // 通过发送消息来打开设置页面
  settingIcon.addEventListener('click', (e) => {
    e.stopPropagation();
    chrome.runtime.sendMessage({ action: 'openOptionsPage' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Error:', chrome.runtime.lastError);
      }
    });
  });

  // 创建反馈图标
  const feedbackIcon = document.createElement('img');
  feedbackIcon.src = chrome.runtime.getURL('icons/feedback.svg');
  feedbackIcon.className = 'bottom-icon feedback-icon';
  feedbackIcon.title = i18n.feedbackTitle;

  // 添加点击事件，打开反馈表单
  feedbackIcon.addEventListener('click', async (e) => {
    e.stopPropagation();
    const externalLinks = await window.AppConfigManager.getExternalLinks();
    window.open(externalLinks.feedbackSurvey, '_blank');
  });

  // 添加图标到容器
  iconContainer.appendChild(settingIcon);
  iconContainer.appendChild(feedbackIcon);

  // 将按钮和图标容器添加到整体容器中
  container.appendChild(button);
  container.appendChild(iconContainer);

  // 阻止容器上的事件冒泡
  container.addEventListener('mousedown', (e) => {
    e.stopPropagation();
  });
  container.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  // 添加到页面
  document.body.appendChild(container);
  document.body.appendChild(dialog);

 
  
  // 初始化时就设置具体的 top 值，而不是用 transform
  const initialTop = window.innerHeight / 2 - container.offsetHeight / 2;
  container.style.top = `${initialTop}px`;
  container.style.transform = 'none';  // 移除 transform

  // 添加拖动功能
  let isDragging = false;
  let startY = 0;
  let startTop = 0;
  let hasMoved = false;
  const DRAG_THRESHOLD = 10; // 拖动阈值，超过这个距离才算拖动

  // 鼠标按下
  button.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation(); // 阻止事件冒泡，避免触发页面的选择事件
    isDragging = true;
    hasMoved = false;  // 重置移动标记
    startY = e.clientY;
    const rect = container.getBoundingClientRect();
    startTop = rect.top;
    container.classList.add('dragging');
  });

  // 鼠标移动
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    
    const deltaY = e.clientY - startY;
    const moveDistance = Math.abs(deltaY);
    
    // 只有拖动距离超过阈值时才标记为移动
    if (moveDistance > DRAG_THRESHOLD) {
      hasMoved = true;
    }
    
    // 只有当标记为移动时才更新位置
    if (hasMoved) {
      const newTop = startTop + deltaY;
      const maxTop = window.innerHeight - container.offsetHeight;
      const boundedTop = Math.max(0, Math.min(newTop, maxTop));
      container.style.top = `${boundedTop}px`;
      container.style.transform = 'none';
    }
  });

  // 鼠标松开
  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      container.classList.remove('dragging');
    }
  });

  // 防止拖动时选中文本
  button.addEventListener('selectstart', (e) => e.preventDefault());

  // 添加快捷键监听 - 直接打开侧边栏
  document.addEventListener('keydown', (e) => {
    // 检查是否按下 Ctrl+M (Windows) 或 Command+M (Mac)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'm') {
      e.preventDefault(); // 阻止默认行为
      chrome.runtime.sendMessage({ type: 'TOGGLE_SIDE_PANEL' });
    }
  });

  // 点击 more-icon 打开设置页面
  const moreIcon = dialog.querySelector('.more-icon');
  moreIcon.addEventListener('click', (e) => {
    e.stopPropagation();
    chrome.runtime.sendMessage({ action: 'openOptionsPage' });
  });
  
  // 点击外部关闭对话框
  document.addEventListener('click', (e) => {
    if (!dialog.contains(e.target) && !button.contains(e.target)) {
      dialog.classList.remove('show');
    }
  });
  
  // 绑定按钮事件
  const searchButton = dialog.querySelector('.search-button');
  const input = dialog.querySelector('#multiAiInput');
  
  searchButton.addEventListener('click', () => {
    console.log('searchButton clicked');
    const query = input.value.trim();
    if (!query) {
      input.classList.add('shake');
      setTimeout(() => {
        input.classList.remove('shake');
      }, 500);  // 500ms 后移除闪烁效果
      return;
    }
    console.log('query:', query);
    const selectedSites = getSelectedSites();
    console.log('selectedSites:', selectedSites);
    if (selectedSites.length === 0) return;
    
    chrome.runtime.sendMessage({
      action: 'processQuery',
      query: query,
      sites: selectedSites
    });
  });
}




// 显示关闭选项对话框
function showCloseOptionsDialog(container, event) {
  // 检查是否已存在对话框，如果存在则移除
  const existingDialog = document.querySelector('.close-options-dialog');
  if (existingDialog) {
    existingDialog.remove();
  }

  // 获取鼠标位置
  const mouseX = event ? event.clientX : window.innerWidth / 2;
  const mouseY = event ? event.clientY : window.innerHeight / 2;

  // 创建遮罩层
  const overlay = document.createElement('div');
  overlay.className = 'close-options-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.5);
    z-index: 2147483646;
    display: flex;
    justify-content: center;
    align-items: center;
  `;

  // 创建对话框
  const dialog = document.createElement('div');
  dialog.className = 'close-options-dialog';
  
  // 计算对话框位置 - 在鼠标左侧偏移一些距离
  const dialogWidth = 350; // 预估对话框宽度
  const dialogHeight = 220; // 预估对话框高度
  const offsetX = -40; // 向左偏移40px
  const offsetY = -dialogHeight / 2; // 垂直居中
  
  // 计算最终位置，确保不会超出屏幕边界
  let finalLeft = mouseX + offsetX - dialogWidth;
  let finalTop = mouseY + offsetY;
  
  // 边界检查
  finalLeft = Math.max(20, Math.min(finalLeft, window.innerWidth - dialogWidth - 20));
  finalTop = Math.max(20, Math.min(finalTop, window.innerHeight - dialogHeight - 20));
  
  dialog.style.cssText = `
    background: white;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
    padding: 24px;
    min-width: 300px;
    max-width: 400px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    animation: closeDialogSlideIn 0.3s ease-out;
    position: fixed;
    left: ${finalLeft}px;
    top: ${finalTop}px;
    z-index: 2147483647;
  `;

  // 移除原来overlay的flex布局，因为我们现在使用绝对定位
  overlay.style.justifyContent = 'unset';
  overlay.style.alignItems = 'unset';

  const dialogText = {
    title: t('floatButtonCloseDialogTitle', 'Hide floating button'),
    temporary: t('floatButtonCloseTemporary', 'Hide for this visit'),
    currentSite: t('floatButtonCloseCurrentSite', 'Disable on this website'),
    permanent: t('floatButtonClosePermanent', 'Disable permanently'),
    hint: t('floatButtonEnableInSettingsHint', '(Can be re-enabled in Settings)'),
    cancel: t('cancelButton', 'Cancel'),
    confirm: t('confirmButton', 'Confirm')
  };

  dialog.innerHTML = `
    <style>
      @keyframes closeDialogSlideIn {
        from {
          opacity: 0;
          transform: scale(0.9) translateY(-20px);
        }
        to {
          opacity: 1;
          transform: scale(1) translateY(0);
        }
      }
    </style>
    <div class="dialog-header" style="margin-bottom: 20px;">
      <h3 style="margin: 0; font-size: 18px; font-weight: 600; color: #333;">${dialogText.title}</h3>
      <div style="position: absolute; top: 16px; right: 16px; cursor: pointer; font-size: 24px; color: #999; line-height: 1;" onclick="this.closest('.close-options-overlay').remove()">×</div>
    </div>
    <div class="dialog-options" style="margin-bottom: 24px;">
      <label class="option-item" style="display: block; margin-bottom: 16px; cursor: pointer;">
        <input type="radio" name="closeOption" value="temporary" checked style="margin-right: 12px;">
        <span style="color: #333; font-size: 14px;">${dialogText.temporary}</span>
      </label>
      <label class="option-item" style="display: block; margin-bottom: 16px; cursor: pointer;">
        <input type="radio" name="closeOption" value="currentSite" style="margin-right: 12px;">
        <span style="color: #333; font-size: 14px;">${dialogText.currentSite}</span>
        <span style="color: #999; font-size: 12px; margin-left: 24px;">${dialogText.hint}</span>
      </label>
      <label class="option-item" style="display: block; margin-bottom: 0; cursor: pointer;">
        <input type="radio" name="closeOption" value="permanent" style="margin-right: 12px;">
        <span style="color: #333; font-size: 14px;">${dialogText.permanent}</span>
        <span style="color: #999; font-size: 12px; margin-left: 24px;">${dialogText.hint}</span>
      </label>
    </div>
    <div class="dialog-buttons" style="display: flex; justify-content: flex-end; gap: 12px;">
      <button class="cancel-btn" style="padding: 8px 16px; background: transparent; border: 1px solid #ddd; border-radius: 6px; cursor: pointer; font-size: 14px; color: #666;">${dialogText.cancel}</button>
      <button class="confirm-btn" style="padding: 8px 16px; background: #e91e63; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px;">${dialogText.confirm}</button>
    </div>
  `;

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  // 添加事件处理
  const cancelBtn = dialog.querySelector('.cancel-btn');
  const confirmBtn = dialog.querySelector('.confirm-btn');

  // 取消按钮
  cancelBtn.addEventListener('click', () => {
    overlay.remove();
  });

  // 确定按钮
  confirmBtn.addEventListener('click', () => {
    const selectedOption = dialog.querySelector('input[name="closeOption"]:checked').value;
    handleCloseOption(selectedOption, container);
    overlay.remove();
  });

  // 点击遮罩层关闭
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.remove();
    }
  });

  // ESC 键关闭
  document.addEventListener('keydown', function escHandler(e) {
    if (e.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', escHandler);
    }
  });
}

// 处理关闭选项
function handleCloseOption(option, container) {
  const currentDomain = window.location.hostname;
  
  switch (option) {
    case 'temporary':
      // 临时关闭 - 直接移除容器
      container.remove();
      console.log('悬浮球已临时关闭');
      break;
      
    case 'currentSite':
      // 当前网站禁用 - 保存到存储并移除容器
      chrome.storage.sync.get(['disabledSites'], (result) => {
        const disabledSites = result.disabledSites || [];
        if (!disabledSites.includes(currentDomain)) {
          disabledSites.push(currentDomain);
          chrome.storage.sync.set({ disabledSites }, () => {
            console.log(`已禁用 ${currentDomain} 的悬浮球`);
            container.remove();
          });
        } else {
          container.remove();
        }
      });
      break;
      
    case 'permanent':
      // 永久禁用 - 只更新悬浮球配置，不影响其他快捷入口
      chrome.storage.sync.get(['buttonConfig'], (result) => {
        const currentButtonConfig = result.buttonConfig || {};
        const updatedButtonConfig = {
          ...currentButtonConfig,
          floatButton: false
        };
        
        chrome.storage.sync.set({ 
          buttonConfig: updatedButtonConfig 
        }, () => {
          console.log('悬浮球已永久禁用，其他快捷入口不受影响');
          container.remove();
        });
      });
      break;
  }
}

// 初始化
// 获取按钮配置
chrome.storage.sync.get(['buttonConfig', 'disabledSites'], async function(result) {
  // 从 appConfig.json 获取默认配置
  const defaultButtonConfig = await window.AppConfigManager.getButtonConfig();
  const buttonConfig = result.buttonConfig || defaultButtonConfig;
  const disabledSites = result.disabledSites || [];
  const currentDomain = window.location.hostname;
  
  // 检查是否全局禁用或当前网站被禁用
  if (!buttonConfig.floatButton) {
    console.log('浮动按钮已全局禁用');
    return;
  }
  
  if (disabledSites.includes(currentDomain)) {
    console.log(`当前网站 ${currentDomain} 的悬浮球已被禁用`);
    return;
  }
  
  // 创建浮动按钮
  createFloatButton();
});
