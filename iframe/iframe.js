// 全局文件粘贴检测和处理
let filePasteHandlerAdded = false;

// ========== 品牌色配置 ==========
// 各 AI 站点的品牌颜色
const SITE_BRAND_COLORS = {
  'ChatGPT': '#10a37f',
  'Claude': '#cc785c',
  'Gemini': '#4285f4',
  'Grok': '#000000',
  'DeepSeek': '#4f46e5',
  '豆包': '#ff6b35',
  'Kimi': '#6366f1',
  'POE': '#5865f2',
  'Perplexity': '#20b2aa',
  '通义千问': '#ff6a00',
  '文心一言': '#2932e1',
  '秘塔AI': '#00d4aa',
  '问小白': '#ff9500',
  'Copilot': '#0078d4'
};


// 站点图标映射 (文件名需与 icons 目录一致)
// 站点图标映射 (文件名需与 icons 目录一致)
const SITE_ICONS = {
  'ChatGPT': 'chatgpt.png',
  'Claude': 'claude.png',
  'Gemini': 'gemini.png',
  'Grok': 'grok.png',
  'DeepSeek': 'deepseek.png',
  '豆包': 'doubao.png',
  'Kimi': 'kimi.webp',
  'POE': 'poe.webp',
  'Perplexity': 'perplexity.webp',
  '通义千问': 'qwenlm.webp',
  '文心一言': 'baidu-ai.png',
  '秘塔AI': 'metaso.webp',
  '问小白': 'wanzhi.jpg',
  'Copilot': 'github-copilot.webp',
  '讯飞星火': 'sparkdesk.webp',
  '智谱清言': 'qingyan.png',
  '海螺AI': 'hailuo.png',
  '天工': 'tiangong.png',
  '百川': 'baichuan.png',
  'Minimax': 'minimax.png',
  'Devv': 'devv.png',
  'Felo': 'felo.png',
  'You': 'you.jpg',
  'Genspark': 'genspark.jpg',
  'LeChat': 'lechat.png',
  'HuggingChat': 'huggingchat.svg',
  'DuckDuckGo': 'duckduckgo.webp',
  '腾讯元宝': 'yuanbao.webp'
};

// 获取站点品牌颜色
function getSiteBrandColor(siteName) {
  return SITE_BRAND_COLORS[siteName] || '#9e9e9e';
}

// 获取站点图标首字母 (Fallback)
function getSiteIconLetter(siteName) {
  if (!siteName) return '?';
  const specialIcons = {
    '豆包': '豆', '通义千问': '通', '文心一言': '文', '秘塔AI': '秘', '问小白': '问',
    '讯飞星火': '讯', '智谱清言': '智', '海螺AI': '螺', '天工': '天', '百川': '百'
  };
  if (specialIcons[siteName]) return specialIcons[siteName];
  return siteName.charAt(0).toUpperCase();
}

// 渲染站点图标 HTML
// 渲染站点图标 HTML (支持本地映射和动态获取)
function renderSiteIcon(siteOrName) {
  let siteName, siteUrl;

  // 处理参数重载：可以是字符串(兼容旧代码)或site对象
  if (typeof siteOrName === 'object' && siteOrName !== null) {
    siteName = siteOrName.name;
    siteUrl = siteOrName.url;
  } else {
    siteName = siteOrName;
    siteUrl = null;
  }

  const iconFile = SITE_ICONS[siteName];
  const brandColor = getSiteBrandColor(siteName);
  const letter = getSiteIconLetter(siteName);

  // 1. 优先使用本地精选图标 (Cherry Studio 风格)
  if (iconFile) {
    return `
      <div class="site-icon-wrapper">
        <img src="../icons/${iconFile}" class="site-icon-img" alt="${siteName}" 
             onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'">
        <div class="site-icon-fallback" style="display: none; background: ${brandColor}">${letter}</div>
      </div>
    `;
  }

  // 2. 如果本地没有，且有 URL，尝试动态获取 Favicon
  if (siteUrl) {
    try {
      // 尝试提取主域名
      let hostname;
      try {
        hostname = new URL(siteUrl).hostname;
      } catch (e) {
        hostname = siteUrl; // 可能是直接的域名
      }

      const faviconUrl = `https://www.google.com/s2/favicons?domain=${hostname}&sz=128`;
      return `
          <div class="site-icon-wrapper">
            <img src="${faviconUrl}" class="site-icon-img" alt="${siteName}" 
                 onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'">
            <div class="site-icon-fallback" style="display: none; background: ${brandColor}">${letter}</div>
          </div>
        `;
    } catch (e) {
      console.warn('获取 Favicon 失败:', siteName, e);
    }
  }

  // 3. 最后回退到首字母图标
  return `<div class="site-icon-fallback" style="background: ${brandColor}">${letter}</div>`;
}
// ========== 品牌色配置结束 ==========



// 统一的文件扩展名检测 (已统一移动到上方)

// 检测是否具有有效的文件扩展名
function hasValidFileExtension(text) {
  if (!text || typeof text !== 'string') {
    return false;
  }

  const firstLine = text.trim().split('\n')[0];

  // 排除URL（包含http/https协议的内容）
  if (firstLine.includes('http://') || firstLine.includes('https://')) {
    return false;
  }

  // 排除包含域名模式的内容（如www.xxx.com）
  if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}\//i.test(firstLine) || /www\./i.test(firstLine)) {
    return false;
  }

  const fileExtensionRegex = new RegExp(`\\.(${SUPPORTED_FILE_EXTENSIONS.join('|')})$`, 'i');
  return fileExtensionRegex.test(firstLine) && firstLine.length < 100;
}

// 请求剪贴板权限的函数
async function requestClipboardPermission() {
  try {
    console.log('🔍 开始请求剪贴板权限...');

    // 检查权限状态
    const permissionStatus = await navigator.permissions.query({ name: 'clipboard-read' });
    console.log('当前剪贴板权限状态:', permissionStatus.state);
    console.log('权限对象详情:', permissionStatus);

    if (permissionStatus.state === 'granted') {
      console.log('✅ 剪贴板权限已授予');
      return true;
    } else if (permissionStatus.state === 'prompt') {
      console.log('🔄 需要用户授权剪贴板权限');
      console.log('📋 尝试读取剪贴板来触发权限请求...');

      // 尝试读取剪贴板来触发权限请求
      try {
        const clipboardData = await navigator.clipboard.read();
        console.log('✅ 剪贴板权限请求成功');
        console.log('剪贴板内容:', clipboardData);
        return true;
      } catch (error) {
        console.log('❌ 剪贴板权限请求失败:', error);
        console.log('错误名称:', error.name);
        console.log('错误消息:', error.message);
        console.log('错误堆栈:', error.stack);
        return false;
      }
    } else {
      console.log('❌ 剪贴板权限被拒绝');
      console.log('💡 建议: 请检查浏览器设置中的剪贴板权限');
      return false;
    }
  } catch (error) {
    console.log('❌ 检查剪贴板权限失败:', error);
    console.log('错误详情:', error);
    return false;
  }
}

// 页面加载完成后的初始化
document.addEventListener('DOMContentLoaded', async function () {
  // 初始化自动调整高度的输入框
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    // 自动调整输入框高度
    function autoResizeTextarea() {
      searchInput.style.height = 'auto';
      const scrollHeight = searchInput.scrollHeight;
      const minHeight = 36; // 最小高度
      const maxHeight = 200; // 最大高度

      // 如果内容高度小于等于最小高度，保持最小高度不变
      if (scrollHeight <= minHeight) {
        searchInput.style.height = minHeight + 'px';
      } else {
        // 只有当内容真正需要更多空间时才调整高度
        const newHeight = Math.min(scrollHeight, maxHeight);
        searchInput.style.height = newHeight + 'px';
      }
    }

    // 监听输入事件
    searchInput.addEventListener('input', autoResizeTextarea);

    // 监听粘贴事件
    searchInput.addEventListener('paste', () => {
      // 延迟执行，等待粘贴内容处理完成
      setTimeout(autoResizeTextarea, 10);
    });

    // 监听聚焦事件，自动调整高度
    searchInput.addEventListener('focus', () => {
      // 聚焦时总是调用自动调整函数
      autoResizeTextarea();
    });

    // 监听失焦事件，自动收回高度并隐藏建议
    searchInput.addEventListener('blur', (e) => {
      // 失焦后始终收回到底部（单行高度）
      searchInput.style.height = '36px';

      // 延迟隐藏查询建议，以便用户能够点击建议项
      setTimeout(() => {
        const querySuggestions = document.getElementById('querySuggestions');
        if (querySuggestions) {
          querySuggestions.style.display = 'none';
        }
      }, 200);
    });

    // 初始调整
    autoResizeTextarea();
  }

  // 初始化列数选择
  const columnCurrentBtn = document.getElementById('columnCurrentBtn');
  const columnDropdown = document.getElementById('columnDropdown');
  const columnOptionBtns = document.querySelectorAll('.column-option-btn');
  const iframesContainer = document.getElementById('iframes-container');

  // 从存储中获取列数设置
  let { preferredColumns = '3' } = await chrome.storage.sync.get('preferredColumns');
  if (window.innerWidth < 500) {
    preferredColumns = '1';
  }

  // 设置默认激活状态和当前显示
  setActiveColumnOption(preferredColumns);
  updateCurrentDisplay(preferredColumns);
  updateColumns(preferredColumns);

  // 检查 URL 参数，判断打开方式
  const urlParams = new URLSearchParams(window.location.search);
  const hasQueryParam = urlParams.has('query');

  if (hasQueryParam) {
    // 从 URL 参数中获取查询内容
    const query = urlParams.get('query');
    console.log('从 URL 参数获取查询内容:', query);

    if (query && query !== 'true') {
      // 将查询内容填入搜索框
      const searchInput = document.getElementById('searchInput');
      if (searchInput) {
        searchInput.value = query;
      }

      // 获取站点配置并创建 iframes
      getDefaultSites().then((sites) => {
        if (sites && sites.length > 0) {
          const availableSites = sites.filter(site =>
            site.enabled &&
            site.supportIframe !== false &&
            !site.hidden
          );

          if (availableSites.length > 0) {
            console.log('使用查询内容创建 iframes:', query, availableSites);
            createIframes(query, availableSites);
          } else {
            console.log('没有可用的站点');
          }
        }
      });
    } else {
      // 如果查询参数是 'true' 或空，按直接打开处理
      console.log('URL 参数 query=true，按直接打开处理');
      getDefaultSites().then((sites) => {
        if (sites && sites.length > 0) {
          const availableSites = sites.filter(site =>
            site.enabled &&
            site.supportIframe !== false &&
            !site.hidden
          );

          if (availableSites.length > 0) {
            console.log('初始化可用站点:', availableSites);
            createIframes('', availableSites);
          } else {
            console.log('没有可用的站点');
          }
        }
      });
    }
  } else {
    // 直接打开（方式1）
    getDefaultSites().then((sites) => {
      if (sites && sites.length > 0) {
        const availableSites = sites.filter(site =>
          site.enabled &&
          site.supportIframe !== false &&
          !site.hidden
        );

        if (availableSites.length > 0) {
          console.log('初始化可用站点:', availableSites);
          createIframes('', availableSites);
        } else {
          console.log('没有可用的站点');
        }
      }
    });
  }

  // 当前按钮点击监听器 - 展开/收起下拉菜单
  columnCurrentBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    toggleDropdown();
  });

  // 下拉选项点击监听器
  columnOptionBtns.forEach(btn => {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      const columns = e.currentTarget.getAttribute('data-columns');
      selectColumnOption(columns);
    });
  });

  // 点击其他地方关闭下拉菜单
  document.addEventListener('click', function (e) {
    if (!columnDropdown.contains(e.target) && !columnCurrentBtn.contains(e.target)) {
      closeDropdown();
    }
  });

  // 统一的文件粘贴处理 - 只添加一次监听器
  if (!filePasteHandlerAdded) {
    document.addEventListener('paste', handleUnifiedFilePaste);
    filePasteHandlerAdded = true;
    console.log('🎯 统一文件粘贴监听器已添加');
  }

  // 添加文件上传功能的事件监听器
  initializeFileUpload();

  // 添加导出回答功能的事件监听器
  initializeExportResponses();

});

// 显示本地文件限制警告
function showLocalFileWarning(fileName, fileExtension) {
  const warning = document.createElement('div');
  warning.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: linear-gradient(135deg, #ff6b6b, #ee5a24);
    color: white;
    padding: 24px;
    border-radius: 16px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.3);
    z-index: 10001;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    max-width: 480px;
    width: 90%;
    text-align: left;
    line-height: 1.6;
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255,255,255,0.2);
    animation: slideInScale 0.3s ease-out;
  `;

  // 使用通用的文件图标
  const icon = '📁';

  // 获取国际化消息
  const localFileDetected = chrome.i18n.getMessage('localFileDetected');
  const browserSecurityRestriction = chrome.i18n.getMessage('browserSecurityRestriction');
  const localFileSecurityMessage = chrome.i18n.getMessage('localFileSecurityMessage');
  const suggestedActions = chrome.i18n.getMessage('suggestedActions');
  const uploadFileAction = chrome.i18n.getMessage('uploadFileAction');
  const dismissWarning = chrome.i18n.getMessage('dismissWarning');

  warning.innerHTML = `
    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
      <span style="font-size: 32px;">${icon}</span>
      <div>
        <div style="font-weight: 600; font-size: 16px;">${localFileDetected}</div>
        <div style="font-size: 12px; opacity: 0.9;">${fileName}</div>
      </div>
    </div>
    
    <div style="background: rgba(238, 199, 199, 0.1); padding: 12px; border-radius: 8px; margin-bottom: 16px;">
      <div style="font-size: 13px; margin-bottom: 8px;">🚫 <strong>${browserSecurityRestriction}</strong></div>
      <div style="font-size: 12px; opacity: 0.9;">
        ${localFileSecurityMessage}
      </div>
    </div>
    
    <div style="font-size: 13px; margin-bottom: 16px;">
      <div style="font-weight: 600; margin-bottom: 8px;">💡 ${suggestedActions}</div>
      <div style="margin-left: 16px;">
        <div style="margin-bottom: 4px;">• ${uploadFileAction}</div>
      </div>
    </div>
    
    <div style="display: flex; gap: 12px; justify-content: flex-end;">
      <button id="dismissWarning" style="
        background: rgba(255,255,255,0.2);
        border: 1px solid rgba(255,255,255,0.3);
        color: white;
        padding: 8px 16px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 12px;
        transition: all 0.2s;
      ">${dismissWarning}</button>
    </div>
  `;

  // 添加 CSS 动画
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideInScale {
      from { 
        transform: translate(-50%, -50%) scale(0.8); 
        opacity: 0; 
      }
      to { 
        transform: translate(-50%, -50%) scale(1); 
        opacity: 1; 
      }
    }
    #dismissWarning:hover {
      background: rgba(255,255,255,0.3) !important;
      transform: translateY(-1px);
    }
  `;
  document.head.appendChild(style);

  document.body.appendChild(warning);

  // 点击关闭
  const dismissBtn = warning.querySelector('#dismissWarning');
  dismissBtn.addEventListener('click', () => {
    warning.style.animation = 'slideInScale 0.3s ease-out reverse';
    setTimeout(() => {
      if (warning.parentElement) {
        warning.remove();
        style.remove();
      }
    }, 300);
  });

  // 8秒后自动关闭
  setTimeout(() => {
    if (warning.parentElement) {
      dismissBtn.click();
    }
  }, 8000);
}

// 检测文本内容是否为本地文件路径（真正的路径，不是简单文件名）
function isLocalFile(text) {
  if (!text || typeof text !== 'string') {
    return false;
  }

  const firstLine = text.trim().split('\n')[0];

  // 排除URL（包含http/https协议的内容）
  if (firstLine.includes('http://') || firstLine.includes('https://')) {
    return false;
  }

  // 排除包含域名模式的内容（如www.xxx.com或domain.com）
  if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/i.test(firstLine) || /www\./i.test(firstLine)) {
    return false;
  }

  // 检测真正的文件路径模式（必须包含路径分隔符）
  const filePathPatterns = [
    // Windows 路径: C:\Users\... 或 D:\...
    /^[A-Za-z]:\\[^<>:"|?*\n]+\.[a-zA-Z0-9]+$/,
    // Unix/Linux/Mac 路径: /Users/... 或 ~/...
    /^[~\/][^<>:"|?*\n]*\.[a-zA-Z0-9]+$/,
    // UNC 路径: \\server\share\...
    /^\\\\[^<>:"|?*\n]+\\[^<>:"|?*\n]*\.[a-zA-Z0-9]+$/
  ];

  // 检查是否包含路径分隔符（真正的文件路径特征）
  const hasPathSeparator = firstLine.includes('/') || firstLine.includes('\\');
  const matchesPattern = filePathPatterns.some(pattern => pattern.test(firstLine));

  // 排除自动生成的文件名
  const isAutoGeneratedName = /^(clipboard|screenshot|download|image|file)-\d+\./i.test(firstLine);

  const isRealFilePath = (matchesPattern || hasPathSeparator) && !isAutoGeneratedName;

  if (isRealFilePath) {
    console.log('🎯 检测到真正的文件路径:', firstLine);
  }

  return isRealFilePath;
}

// 统一的文件粘贴处理函数
async function handleUnifiedFilePaste(event) {
  console.log('🎯 检测到粘贴事件，开始处理');

  try {
    // 1. 首先请求剪贴板权限
    const hasPermission = await requestClipboardPermission();
    if (!hasPermission) {
      console.log('❌ 无法访问剪贴板，权限不足，允许默认行为');
      return;
    }

    // 2. 检查剪贴板内容
    const clipboardData = await navigator.clipboard.read();
    console.log('剪贴板内容:', clipboardData);

    let hasImage = false;
    let hasText = false;

    for (const item of clipboardData) {
      console.log('剪贴板项目类型:', item.types);
      console.log('剪贴板项目详情:', item);

      // 检查是否有图片
      if (item.types.some(type => type.startsWith('image/'))) {
        hasImage = true;
        console.log('🎯 检测到图片内容');
      }

      // 检查是否有纯文字
      if (item.types.includes('text/plain')) {
        hasText = true;
        console.log('🎯 检测到纯文字内容');
      }
    }

    console.log('🎯 内容分析结果:', {
      hasText,
      hasImage
    });

    // 采用排除法：只允许纯文本和图片，其他都阻止
    // 1. 纯文字内容 - 直接粘贴（允许默认行为）
    if (hasText && !hasImage) {
      console.log('🎯 纯文字内容，允许默认粘贴行为');
      return;
    }

    // 2. 检测到图片 - 处理图片并阻止默认行为
    if (hasImage) {
      console.log('🎯 检测到图片，开始处理图片数据');

      for (const item of clipboardData) {
        if (item.types.some(type => type.startsWith('image/'))) {
          try {
            // 获取图片数据
            const imageType = item.types.find(type => type.startsWith('image/'));
            const imageData = await item.getType(imageType);

            console.log('🎯 图片数据获取成功:', {
              type: imageType,
              size: imageData.size
            });

            // 创建文件数据对象
            const fileObj = {
              name: `clipboard_image_${Date.now()}.${imageType.split('/')[1] || 'png'}`,
              type: imageType,
              size: imageData.size || 0,
              blob: imageData,
              data: imageData
            };

            // 发送到所有iframe
            await sendFileToAllIframes(fileObj);
            console.log('🎯 图片已发送到所有iframe');

          } catch (imageError) {
            console.log('🎯 处理图片失败:', imageError);
          }
        }
      }

      // 图片处理完成后，阻止默认粘贴行为
      console.log('🎯 图片处理完成，阻止默认粘贴行为');
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    // 3. 其他所有情况 - 直接阻止粘贴行为（排除法）
    console.log('🎯 非纯文本非图片内容，阻止粘贴行为');
    event.preventDefault();
    event.stopPropagation();
    return;

    // 默认情况：允许默认行为
    console.log('🎯 默认情况，允许粘贴行为');

  } catch (error) {
    console.error('🎯 粘贴处理出错:', error);
    // 出错时允许默认行为
  }
}

// 发送文件到所有iframe的简化函数
async function sendFileToAllIframes(fileObj) {
  const iframes = document.querySelectorAll('.ai-iframe');
  console.log(`🎯 开始向 ${iframes.length} 个iframe发送文件`);
  console.log('🎯 文件对象详情:', {
    name: fileObj.name,
    type: fileObj.type,
    size: fileObj.size
  });

  // 使用逐个处理的方式，确保每个iframe有足够时间处理
  await executeFileUploadSequentially(iframes, fileObj);

  console.log('🎯 所有iframe文件发送完成');
}

// 逐个执行文件上传的函数
async function executeFileUploadSequentially(iframes, fileData, fallbackMode = false) {
  const totalIframes = iframes.length;
  let successCount = 0;
  let failureCount = 0;

  console.log(`开始逐个执行文件粘贴，共 ${totalIframes} 个 iframe`);

  // 显示进度提示
  showFileUploadProgress(0, totalIframes, 'starting');

  for (let i = 0; i < iframes.length; i++) {
    const iframe = iframes[i];

    try {
      const domain = new URL(iframe.src).hostname;
      const siteName = iframe.getAttribute('data-site');

      console.log(`🎯 处理第 ${i + 1}/${totalIframes} 个 iframe: ${siteName} (${domain})`);

      // 更新进度提示
      showFileUploadProgress(i + 1, totalIframes, 'processing', siteName);

      // 给 iframe 一些时间来准备接收
      await new Promise(resolve => setTimeout(resolve, 200));

      if (fallbackMode) {
        // 降级模式：让 iframe 自己尝试读取剪贴板
        iframe.contentWindow.postMessage({
          type: 'TRIGGER_PASTE',
          domain: domain,
          source: 'iframe-parent',
          global: true,
          fallback: true,
          index: i + 1,
          total: totalIframes
        }, '*');
      } else {
        // 优先模式：使用站点特定的文件上传处理器
        iframe.contentWindow.postMessage({
          type: 'TRIGGER_PASTE',
          domain: domain,
          source: 'iframe-parent',
          global: true,
          fileData: fileData, // 传递文件数据供站点处理器使用
          useSiteHandler: true, // 标记使用站点处理器
          index: i + 1,
          total: totalIframes
        }, '*');
      }

      // 等待一段时间让 iframe 处理完成
      await new Promise(resolve => setTimeout(resolve, 1000));

      successCount++;
      console.log(`✅ 第 ${i + 1} 个 iframe 处理完成`);

    } catch (error) {
      console.error(`❌ 第 ${i + 1} 个 iframe 处理失败:`, error);
      failureCount++;
    }

    // 在处理间隔中等待，避免权限冲突
    if (i < iframes.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }

  console.log(`🎯 逐个文件粘贴执行完成: 成功 ${successCount}/${totalIframes}, 失败 ${failureCount}`);

  // 显示完成状态
  showFileUploadProgress(totalIframes, totalIframes, 'completed', null, { successCount, failureCount });

  // 3秒后隐藏进度提示
  setTimeout(() => {
    hideFileUploadProgress();
  }, 3000);
}

// 显示文件上传进度提示
function showFileUploadProgress(current, total, status, siteName = null, result = null) {
  let progressElement = document.getElementById('file-upload-progress');

  if (!progressElement) {
    progressElement = document.createElement('div');
    progressElement.id = 'file-upload-progress';
    progressElement.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 12px 16px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 10001;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      min-width: 200px;
      animation: slideInRight 0.3s ease-out;
    `;

    // 添加CSS动画
    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideInRight {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
    `;
    document.head.appendChild(style);

    document.body.appendChild(progressElement);
  }

  let message = '';
  let emoji = '';

  switch (status) {
    case 'starting':
      emoji = '🚀';
      message = '开始文件粘贴...';
      break;
    case 'processing':
      emoji = '⏳';
      message = `正在处理 ${current}/${total}`;
      if (siteName) {
        message += `<br><small style="opacity: 0.8;">${siteName}</small>`;
      }
      break;
    case 'completed':
      emoji = '✅';
      if (result) {
        if (result.failureCount === 0) {
          message = `文件粘贴完成<br><small>成功: ${result.successCount}/${total}</small>`;
        } else {
          message = `文件粘贴完成<br><small>成功: ${result.successCount}, 失败: ${result.failureCount}</small>`;
        }
      } else {
        message = '文件粘贴完成';
      }
      break;
  }

  progressElement.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px;">
      <span style="font-size: 16px;">${emoji}</span>
      <div>${message}</div>
    </div>
  `;
}

// 隐藏文件上传进度提示
function hideFileUploadProgress() {
  const progressElement = document.getElementById('file-upload-progress');
  if (progressElement) {
    progressElement.style.animation = 'slideInRight 0.3s ease-out reverse';
    setTimeout(() => {
      if (progressElement.parentElement) {
        progressElement.remove();
      }
    }, 300);
  }
}

// 切换下拉菜单显示状态
function toggleDropdown() {
  const columnDropdown = document.getElementById('columnDropdown');
  const isOpen = columnDropdown.classList.contains('show');

  if (isOpen) {
    closeDropdown();
  } else {
    openDropdown();
  }
}

// 打开下拉菜单
function openDropdown() {
  const columnDropdown = document.getElementById('columnDropdown');
  columnDropdown.classList.add('show');
}

// 关闭下拉菜单
function closeDropdown() {
  const columnDropdown = document.getElementById('columnDropdown');
  columnDropdown.classList.remove('show');
}

// 选择列数选项
function selectColumnOption(columns) {
  // 更新激活状态
  setActiveColumnOption(columns);

  // 更新当前显示
  updateCurrentDisplay(columns);

  // 更新布局
  updateColumns(columns);

  // 保存到存储
  chrome.storage.sync.set({ 'preferredColumns': columns });

  // 关闭下拉菜单
  closeDropdown();
}

// 设置激活的列数选项
function setActiveColumnOption(columns) {
  const columnOptionBtns = document.querySelectorAll('.column-option-btn');
  columnOptionBtns.forEach(btn => {
    btn.classList.remove('active');
    if (btn.getAttribute('data-columns') === columns) {
      btn.classList.add('active');
    }
  });
}

// 更新当前显示的图标
function updateCurrentDisplay(columns) {
  const columnCurrentBtn = document.getElementById('columnCurrentBtn');
  const svg = columnCurrentBtn.querySelector('svg');

  // 根据列数更新 SVG 图标
  const svgTemplates = {
    '1': `<rect x="6" y="3" width="8" height="14" rx="1" stroke="currentColor" stroke-width="2" fill="none"/>`,
    '2': `<rect x="2" y="3" width="6" height="14" rx="1" stroke="currentColor" stroke-width="2" fill="none"/>
              <rect x="12" y="3" width="6" height="14" rx="1" stroke="currentColor" stroke-width="2" fill="none"/>`,
    '3': `<rect x="1" y="3" width="4" height="14" rx="1" stroke="currentColor" stroke-width="2" fill="none"/>
              <rect x="8" y="3" width="4" height="14" rx="1" stroke="currentColor" stroke-width="2" fill="none"/>
              <rect x="15" y="3" width="4" height="14" rx="1" stroke="currentColor" stroke-width="2" fill="none"/>`,
    '4': `<rect x="1" y="3" width="3" height="14" rx="1" stroke="currentColor" stroke-width="1.8" fill="none"/>
              <rect x="6" y="3" width="3" height="14" rx="1" stroke="currentColor" stroke-width="1.8" fill="none"/>
              <rect x="11" y="3" width="3" height="14" rx="1" stroke="currentColor" stroke-width="1.8" fill="none"/>
              <rect x="16" y="3" width="3" height="14" rx="1" stroke="currentColor" stroke-width="1.8" fill="none"/>`
  };

  if (svgTemplates[columns]) {
    svg.innerHTML = svgTemplates[columns];
  }
}

// 更新列数的辅助函数
function updateColumns(columns) {
  const iframesContainer = document.getElementById('iframes-container');
  iframesContainer.dataset.columns = columns;
  document.documentElement.style.setProperty('--columns', columns);
}

// 监听来自 background 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('iframe.js 收到消息:', message);
  if (message.type === 'loadIframes') {
    console.log('开始加载 iframes, 查询词:', message.query);
    const searchInput = document.getElementById('searchInput');
    searchInput.value = message.query;
    createIframes(message.query, message.sites);
  }
});

// 处理 iframe 的创建和加载
async function createIframes(query, sites) {
  // 站点已经按order排序了，直接使用
  const enabledSites = sites;

  console.log('过滤后的站点:', enabledSites);

  // 获取容器元素
  const container = document.getElementById('iframes-container');
  if (!container) {
    console.error('未找到 iframes 容器');
    return;
  }

  // 保持原有的grid布局，但确保支持order属性
  // 不覆盖CSS中定义的display: grid

  try {
    if (query) {

      // 如果有查询词,清空容器内容
      container.innerHTML = '';
      console.log("清空iframe")

    }
    // 调整主容器样式以适应导航栏
    container.style.marginLeft = '60px';
    // 为每个启用的站点创建 iframe，传入 query 参数
    enabledSites.forEach(site => {
      // 如果 query 为空,使用 site.url 的 hostname
      let url;
      if (!query) {
        try {
          url = new URL(site.url).hostname;
          url = 'https://' + url;
        } catch (e) {
          console.error('URL解析失败:', site.url);
          url = site.url;
        }
      } else {
        url = site.supportUrlQuery
          ? site.url.replace('{query}', encodeURIComponent(query))
          : site.url;
      }

      console.log("即将开始调用创建单个 iframe", site.name, url)
      createSingleIframe(site.name, url, container, query);
    });
  } catch (error) {
    console.error('创建 iframes 失败:', error);
  }


  // 创建导航栏
  const nav = document.createElement('nav');
  nav.className = 'nav';

  // 创建导航列表
  const navList = document.createElement('ul');
  navList.className = 'nav-list';

  // 为每个站点创建导航项
  enabledSites.forEach((site, index) => {
    const navItem = document.createElement('li');
    navItem.className = 'nav-item';
    navItem.draggable = true;
    navItem.dataset.siteName = site.name;
    navItem.dataset.originalIndex = index;

    // 获取品牌颜色
    const brandColor = getSiteBrandColor(site.name);

    navItem.innerHTML = `
      ${renderSiteIcon(site)}
      <div class="nav-tooltip">${site.name}</div>
    `;

    // 监听页面滚动事件
    window.addEventListener('scroll', () => {
      // 获取所有 iframe 容器
      const iframes = container.querySelectorAll('.iframe-container');
      // 获取所有导航项
      const navItems = navList.querySelectorAll('li');

      // 遍历所有 iframe 检查哪个在视口中
      iframes.forEach((iframe, idx) => {
        const rect = iframe.getBoundingClientRect();
        // 如果 iframe 在视口中(考虑到导航栏高度60px的偏移)
        if (rect.top <= window.innerHeight / 2) {
          // 移除所有激活状态
          navItems.forEach(item => {
            item.classList.remove('active');
          });

          // 激活对应的导航项
          navItems[idx].classList.add('active');
        }
      });
    });

    // 点击导航项时滚动到对应的iframe
    navItem.addEventListener('click', () => {
      // 移除所有激活状态
      navList.querySelectorAll('li').forEach(item => {
        item.classList.remove('active');
      });

      // 激活当前点击项
      navItem.classList.add('active');

      // 滚动到对应的iframe
      const iframes = container.querySelectorAll('.iframe-container');
      if (iframes[index]) {
        iframes[index].scrollIntoView({ behavior: 'smooth' });
      }
    });

    navList.appendChild(navItem);
  });

  // 添加拖拽排序功能
  addDragAndDropToNavList(navList, enabledSites);

  // 添加顶部 logo 区域
  const navHeader = document.createElement('div');
  navHeader.className = 'nav-header';
  navHeader.innerHTML = `
    <a href="#" class="nav-logo" title="AI比一比">
      <img src="../icons/logo.png" alt="AI比一比" />
    </a>
  `;
  nav.appendChild(navHeader);
  nav.appendChild(navList);

  document.body.insertBefore(nav, container);



}



// 创建单个 iframe 时添加标识
function createSingleIframe(siteName, url, container, query) {
  const iframeContainer = document.createElement('div');
  iframeContainer.className = 'iframe-container';

  // iframe容器不需要特殊的布局设置，CSS Grid会自动处理

  const iframe = document.createElement('iframe');
  iframe.className = 'ai-iframe';
  iframe.setAttribute('data-site', siteName);

  // 临时移除 sandbox 属性以测试剪贴板权限
  // iframe.sandbox = 'allow-same-origin allow-scripts allow-popups allow-forms allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation';

  iframe.allow = 'clipboard-read; clipboard-write; microphone; camera; geolocation; autoplay; fullscreen; picture-in-picture; storage-access; web-share';

  // 记录是否已经处理过点击事件
  let clickHandlerAdded = false;

  iframe.addEventListener('load', () => {
    if (clickHandlerAdded) return; // 如果已经添加过处理器，直接返回

    try {
      // 添加点击事件监听器
      iframe.contentWindow.addEventListener('click', (e) => {
        const link = e.target.closest('a');
        if (link && link.href) {
          e.preventDefault();
          window.open(link.href, '_blank');
          console.log("iframe 内点击事件处理成功")
        }
      });


      clickHandlerAdded = true;
    } catch (error) {
      console.log('无法直接添加监听器，将通过 inject.js 处理');

      // 只在未添加处理器时注入
      if (!clickHandlerAdded) {
        iframe.contentWindow.postMessage({
          type: 'INJECT_CLICK_HANDLER',
          source: 'iframe-parent'
        }, '*');
        clickHandlerAdded = true;
      }
    }

    // 处理查询内容（如果有的话）
    if (query) {
      console.log("iframe onload 加载完成，查询内容:", query);

      // 使用异步函数处理
      (async () => {
        const sites = await window.getDefaultSites();
        const site = sites.find(s => s.url === url || url.startsWith(s.url));
        if (site && !site.supportUrlQuery) {
          // 使用动态处理函数
          const handler = await getIframeHandler(url);
          if (handler) {
            console.log('执行动态 iframe 处理函数:', site.name);
            await handler(iframe, query);
          } else {
            console.log('未找到对应的处理函数', site.name);
          }
        }
      })();
    }

    // 重新设置输入框焦点
    document.getElementById('searchInput').focus();
  });

  // 添加消息监听（确保只处理一次）
  const messageHandler = (event) => {
    if (event.data.type === 'LINK_CLICK' && event.data.href) {
      window.open(event.data.href, '_blank');
    }
  };

  window.removeEventListener('message', messageHandler); // 移除可能存在的旧监听器
  window.addEventListener('message', messageHandler);

  // 合并和优化 iframe 加载事件处理
  iframe.addEventListener('load', () => {
    const searchInput = document.getElementById('searchInput');

    // 设置 iframe 为不可聚焦
    iframe.setAttribute('tabindex', '-1');

    // 防止 iframe 内容获取焦点
    try {
      const doc = iframe.contentDocument || iframe.contentWindow.document;
      doc.documentElement.setAttribute('tabindex', '-1');
      doc.body.setAttribute('tabindex', '-1');

      // 只监听焦点事件，保持搜索框焦点
      doc.addEventListener('focus', (e) => {
        e.preventDefault();
        e.stopPropagation();
        searchInput.focus();
      }, true);
    } catch (error) {
      console.log('无法直接访问 iframe 内容，将通过消息通信处理');
      iframe.contentWindow.postMessage({
        type: 'PREVENT_FOCUS',
        source: 'iframe-parent'
      }, '*');
    }

    // 确保搜索输入框保持焦点
    setTimeout(() => {
      searchInput.focus();
    }, 100);
  });

  // 在父页面级别阻止 iframe 获取焦点
  document.addEventListener('focusin', (e) => {
    if (e.target.tagName === 'IFRAME') {
      e.preventDefault();
      document.getElementById('searchInput').focus();
    }
  }, true);
  // 如果参数为空,只使用 url 的 host 部分
  if (!query) {
    try {
      const urlObj = new URL(url);
      url = 'https://' + urlObj.hostname;
    } catch (e) {
      console.error('URL解析失败:', url);
    }
  }
  iframe.src = url;

  // 在 iframe 加载完成后，将页面滚动回顶部
  /*
  iframe.addEventListener('load', () => {
    window.scrollTo(0, 0);
  });*/

  // 创建 header
  // 创建 header
  const header = document.createElement('div');
  header.className = 'iframe-header';
  header.innerHTML = `
    <span class="site-name">
      ${renderSiteIcon({ name: siteName, url: url })}
      ${siteName}
    </span>
    <div class="iframe-controls">
      <button class="close-btn"></button>
    </div>
  `;

  // 添加 Chrome 浏览器特征
  iframe.setAttribute('user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

  // 添加其他常见的 Chrome 浏览器头部信息
  iframe.setAttribute('accept-language', 'zh-CN,zh;q=0.9,en;q=0.8');
  iframe.setAttribute('sec-ch-ua', '"Chromium";v="122", "Google Chrome";v="122"');
  iframe.setAttribute('sec-ch-ua-mobile', '?0');
  iframe.setAttribute('sec-ch-ua-platform', '"Macintosh"');


  // 组装元素
  iframeContainer.appendChild(header);
  iframeContainer.appendChild(iframe);
  container.appendChild(iframeContainer);

  // 添加按钮事件处理
  const closeBtn = header.querySelector('.close-btn');

  closeBtn.onclick = () => {
    // 1. 获取对应的 iframe
    iframeContainer.remove();
    // 在导航栏中找到对应的 nav-item 并删除
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
      if (item.textContent.trim() === siteName) {
        item.remove();
      }
    });

  };

}

// 导出函数供其他文件使用
export { createIframes };


// 根据 URL 获取处理函数
function getHandlerForUrl(url) {
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

    // 遍历所有处理函数，找到匹配的
    for (const [domain, handler] of Object.entries(siteHandlers)) {
      if (hostname.includes(domain)) {
        console.log('找到处理函数:', domain);
        console.log('处理函数:', handler);
        return handler;
      }
    }

    console.log('未找到对应的处理函数');
    return null;
  } catch (error) {
    console.error('URL 解析失败:', error, 'URL:', url);
    return null;
  }
}

// 简化的 iframe 处理函数 - 只负责消息发送
async function getIframeHandler(iframeUrl) {
  try {
    // 解析 iframe URL 获取域名
    let domain;
    try {
      const urlObj = new URL(iframeUrl);
      domain = urlObj.hostname;
    } catch (e) {
      console.error('URL解析失败:', iframeUrl);
      return null;
    }

    // 使用 getDefaultSites 获取合并后的站点配置
    let sites = [];
    try {
      sites = await getDefaultSites();
    } catch (error) {
      console.error('获取站点配置失败:', error);
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

        // 匹配域名
        if (domain === siteDomain || domain.includes(siteDomain) || siteDomain.includes(domain)) {
          // 返回简化的处理函数
          return async function (iframe, query) {
            try {
              // 等待页面加载
              await new Promise(resolve => setTimeout(resolve, 2000));

              // 向 iframe 发送统一格式的消息
              iframe.contentWindow.postMessage({
                type: 'search',
                query: query,
                domain: domain
              }, '*');

              console.log(`已向 ${domain} 发送搜索消息`);
            } catch (error) {
              console.error(`${domain} iframe 处理失败:`, error);
            }
          };
        }
      } catch (urlError) {
        continue;
      }
    }

    console.warn('未找到匹配的站点配置:', domain);
    return null;
  } catch (error) {
    console.error('获取 iframe 处理函数失败:', error);
    return null;
  }
}
// 添加搜索按钮
document.getElementById('searchButton').addEventListener('click', () => {
  const query = document.getElementById('searchInput').value.trim();
  if (query) {
    shanshuo();
    iframeFresh(query);
  }
});

// 删除重复的 createIframes 函数声明

// 添加搜索按钮
document.getElementById('searchButton').addEventListener('click', () => {
  const query = document.getElementById('searchInput').value.trim();
  if (query) {
    shanshuo();
    iframeFresh(query);
  }
});

// 处理回车键
document.getElementById('searchInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    const query = document.getElementById('searchInput').value.trim();
    if (query) {
      shanshuo();
      iframeFresh(query);

    }

  }
});

// 添加输入监听器，当searchInput有内容时显示建议
document.getElementById('searchInput').addEventListener('input', (e) => {
  const query = e.target.value.trim();
  showQuerySuggestions(query);
  updateFavoriteButtonVisibility(query);
});

// 添加焦点事件监听器
document.getElementById('searchInput').addEventListener('focus', (e) => {
  const query = e.target.value.trim();
  if (query) {
    showQuerySuggestions(query);
  }
});

// 注意：失焦事件监听器已合并到DOMContentLoaded中的自动调整高度功能中

// 在 DOMContentLoaded 时设置按钮文案
document.addEventListener('DOMContentLoaded', () => {
  // 获取按钮元素
  const searchButton = document.getElementById('searchButton');
  if (searchButton) {
    // 获取当前语言的文案
    const buttonText = chrome.i18n.getMessage('startCompare');
    searchButton.textContent = buttonText;

    // 调试日志
    console.log('按钮文案设置:', {
      当前语言: chrome.i18n.getUILanguage(),
      文案: buttonText
    });
  }
});

// 初始化站点设置的函数
async function initializeSiteSettings() {
  const siteList = document.querySelector('.site-list');
  const saveButton = document.querySelector('.save-settings-btn');

  // 设置按钮的 title 属性
  saveButton.title = chrome.i18n.getMessage('saveSettingsTitle');

  siteList.innerHTML = '';
  // 获取当前已打开的 iframe 站点 ID 数组
  const openedSites = Array.from(document.querySelectorAll('.ai-iframe'))
    .map(iframe => iframe.getAttribute('data-site'));

  try {
    // 使用 getDefaultSites 获取合并后的站点配置
    const sites = await getDefaultSites();

    // 过滤支持 iframe 的站点
    const supportedSites = sites.filter(site =>
      site.supportIframe === true && !site.hidden
    );

    const fragment = document.createDocumentFragment();

    supportedSites.forEach(site => {
      const div = document.createElement('div');
      div.className = 'site-item';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'site-checkbox';
      checkbox.id = `site-${site.name}`; // 为 label 的 for 属性添加 ID
      checkbox.checked = openedSites.includes(site.name);


      const nameLabel = document.createElement('label');
      nameLabel.textContent = site.name;
      nameLabel.htmlFor = `site-${site.name}`; // 关联到对应的 checkbox

      checkbox.addEventListener('change', (e) => {
        console.log("用户点击新建iframe", site.name, site.url);

        if (e.target.checked) {
          const container = document.getElementById('iframes-container');
          if (!container) {
            console.error('未找到 iframes 容器');
            return;
          }
          createSingleIframe(site.name, site.url, container);
          // 为新建的 iframe 创建导航项
          const nav = document.querySelector('.nav-list');
          if (nav) {
            const navItem = document.createElement('li');
            navItem.className = 'nav-item';
            navItem.dataset.siteName = site.name;

            // 使用 renderSiteIcon 渲染图标
            navItem.innerHTML = `
              ${renderSiteIcon(site)}
              <div class="nav-tooltip">${site.name}</div>
            `;

            // 点击导航项时滚动到对应的iframe
            navItem.addEventListener('click', () => {
              // 移除所有激活状态
              nav.querySelectorAll('li').forEach(item => {
                item.style.backgroundColor = '';
                item.classList.remove('active');
              });

              // 激活当前点击项
              navItem.style.backgroundColor = '#e0e0e0';
              navItem.classList.add('active');

              // 滚动到对应的iframe
              const iframeContainer = document.querySelector(`[data-site="${site.name}"]`).closest('.iframe-container');
              if (iframeContainer) {
                iframeContainer.scrollIntoView({ behavior: 'smooth' });
              }
            });

            nav.appendChild(navItem);
          }

        } else {
          const iframeToRemove = document.querySelector(`[data-site="${site.name}"]`);
          if (iframeToRemove) {
            iframeToRemove.closest('.iframe-container').remove();
            // 移除导航项
            const navItemToRemove = document.querySelector(`.nav-item[data-site-name="${site.name}"]`);
            if (navItemToRemove) {
              navItemToRemove.remove();
            }

          }
        }
      });

      div.appendChild(checkbox);
      div.appendChild(nameLabel);
      fragment.appendChild(div);
    });

    siteList.appendChild(fragment);

    // 添加保存按钮点击事件
    saveButton.addEventListener('click', async () => {
      try {
        // 获取所有复选框
        const checkboxes = document.querySelectorAll('.site-checkbox');

        // 获取当前所有站点配置
        const currentSites = await window.getDefaultSites();

        // 更新站点启用状态到用户设置中
        const userSettings = {};
        currentSites.forEach(site => {
          // 找到对应的复选框
          const checkbox = document.querySelector(`#site-${site.name}`);
          if (checkbox) {
            // 如果找到复选框，根据复选框状态设置 enabled
            userSettings[site.name] = {
              enabled: checkbox.checked
            };
          }
        });

        // 保存用户设置到 sync storage
        await chrome.storage.sync.set({ sites: userSettings });

        // 显示成功提示
        showToast('设置已保存');

        console.log('站点设置已更新:', userSettings);

      } catch (error) {
        console.error('保存站点设置失败:', error);
        showToast('保存设置失败');
      }
    });

  } catch (error) {
    console.error('获取站点配置失败:', error);
    if (siteList) {
      siteList.innerHTML = '<div class="error-message">加载站点配置失败，请刷新页面重试</div>';
    }
  }
}

// Toast 提示函数
function showToast(message, duration = 2000) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  // 添加显示类名触发动画
  setTimeout(() => toast.classList.add('show'), 10);

  // 定时移除
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// 设置图标和对话框的事件处理
const settingsIcon = document.querySelector('.settings-icon');
const settingsDialog = document.querySelector('.settings-dialog');

if (settingsIcon && settingsDialog) {
  // 点击设置图标时初始化并显示对话框
  settingsIcon.addEventListener('click', async () => {
    try {
      await initializeSiteSettings();
      settingsDialog.style.display = 'block';
    } catch (error) {
      console.error('初始化站点设置失败:', error);
    }
  });

  // 点击其他地方关闭对话框
  document.addEventListener('click', (event) => {
    if (!settingsDialog.contains(event.target) &&
      !settingsIcon.contains(event.target)) {
      settingsDialog.style.display = 'none';
    }
  });
}

// 初始化国际化
function initializeI18n() {
  // 处理所有带有 data-i18n 属性的元素
  document.querySelectorAll('[data-i18n]').forEach(element => {
    const key = element.getAttribute('data-i18n');
    const message = chrome.i18n.getMessage(key);
    if (message) {
      if ((element.tagName.toLowerCase() === 'input' &&
        element.type === 'text') ||
        element.tagName.toLowerCase() === 'textarea') {
        // 对于输入框和文本域，设置 placeholder
        element.placeholder = message;
      } else if (element.tagName.toLowerCase() === 'button') {
        // 对于按钮，设置 title 属性
        element.title = message;
      } else {
        // 对于其他元素，设置文本内容
        element.textContent = message;
      }
    }
  });

  // 手动设置输入框的占位符
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    const placeholderMessage = chrome.i18n.getMessage('inputPlaceholder');
    if (placeholderMessage) {
      searchInput.placeholder = placeholderMessage;
    }
  }
}



// 显示查询建议
async function showQuerySuggestions(query) {
  const querySuggestions = document.getElementById('querySuggestions');

  if (!query || query.trim() === '') {
    querySuggestions.style.display = 'none';
    return;
  }

  try {
    // 从存储中获取提示词模板
    const { promptTemplates = [] } = await chrome.storage.sync.get('promptTemplates');

    // 按order排序并过滤出有效的模板
    const sortedTemplates = promptTemplates
      .filter(template => template.name && template.query)
      .sort((a, b) => (a.order || 0) - (b.order || 0));


    // 使用用户自定义模板生成建议
    const recommendedQueries = sortedTemplates.map(template => ({
      name: template.name,
      query: template.query.replace('{query}', query)
    }));

    // 清空之前的内容
    querySuggestions.innerHTML = '';

    // 创建建议项
    recommendedQueries.forEach(recommendedQuery => {
      const suggestionItem = document.createElement('div');
      suggestionItem.textContent = recommendedQuery.name;
      suggestionItem.classList.add('query-suggestion-item');
      suggestionItem.addEventListener('click', () => {
        document.getElementById('searchInput').value = recommendedQuery.query;
        querySuggestions.style.display = 'none';
      });
      querySuggestions.appendChild(suggestionItem);
    });
    // 添加设置图标到 querySuggestions 区域
    const settingsIcon = document.createElement('img');
    settingsIcon.src = '../icons/edit.png';
    settingsIcon.alt = '设置模板';
    settingsIcon.title = '编辑提示词模板';
    settingsIcon.classList.add('query-suggestion-settings-icon');
    settingsIcon.style.cursor = 'pointer';
    settingsIcon.style.width = '20px';
    settingsIcon.style.height = '20px';
    settingsIcon.style.marginLeft = '8px';
    settingsIcon.style.verticalAlign = 'middle';

    // 点击后在新标签页打开设置页面并跳转到模板编辑区域
    settingsIcon.addEventListener('click', (e) => {
      e.stopPropagation();
      // 跳转到 options.html 的提示词模板设置区域
      window.open(chrome.runtime.getURL('options/options.html#prompt-templates'), '_blank');
    });

    // 将设置图标添加到 querySuggestions 区域
    querySuggestions.appendChild(settingsIcon);

    // 显示建议
    querySuggestions.style.display = 'flex';

  } catch (error) {
    console.error('加载提示词模板失败:', error);
    // 如果加载失败，隐藏建议
    querySuggestions.style.display = 'none';
  }
}


// 切换图标晃动动画函数
function shakeToggleIcon() {
  const toggleIcon = document.getElementById('toggleIcon');
  if (toggleIcon) {
    // 添加晃动动画类
    toggleIcon.classList.add('toggle-icon-shake');

    // 动画结束后移除类名
    setTimeout(() => {
      toggleIcon.classList.remove('toggle-icon-shake');
    }, 500); // 与CSS动画持续时间一致
  }
}

// 添加收藏按钮点击事件
document.getElementById('favoriteButton').addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  toggleFavorite();
  // 触发切换图标晃动动画
  shakeToggleIcon();
});

// 添加图标点击事件
document.getElementById('toggleIcon').addEventListener('click', () => {
  const queryList = document.getElementById('queryList');
  if (queryList.style.display === 'none') {
    // 切换图标
    const toggleIcon = document.getElementById('toggleIcon');
    toggleIcon.src = '../icons/up.png'; // 切换为 up.png
    queryList.style.display = 'block'; // 显示收藏的query列表

    // 显示收藏夹
    showFavorites();
  } else {
    queryList.style.display = 'none'; // 隐藏查询列表
    document.getElementById('toggleIcon').src = '../icons/down.png'; // 切换回 down.png
  }
});

// 点击收藏夹以外区域隐藏收藏夹
document.addEventListener('click', (e) => {
  const queryList = document.getElementById('queryList');
  const toggleIcon = document.getElementById('toggleIcon');

  // 如果收藏夹是显示的
  if (queryList && queryList.style.display === 'block') {
    // 检查点击的元素是否在收藏夹或切换图标内
    const isClickInsideFavorites = queryList.contains(e.target);
    const isClickOnToggleIcon = toggleIcon && toggleIcon.contains(e.target);

    // 如果点击在收藏夹和切换图标以外
    if (!isClickInsideFavorites && !isClickOnToggleIcon) {
      // 隐藏收藏夹
      queryList.style.display = 'none';
      // 切换图标回 down.png
      if (toggleIcon) {
        toggleIcon.src = '../icons/down.png';
      }
    }
  }
});


// 创建闪烁效果函数
function shanshuo() {
  // 获取搜索按钮元素
  const searchButton = document.getElementById('searchButton');
  searchButton.classList.add('active');

  // 200ms后移除active效果
  setTimeout(() => {
    searchButton.classList.remove('active');
  }, 200);
}



async function iframeFresh(query) {

  // 获取所有 iframe
  const iframes = document.querySelectorAll('iframe');
  // 使用 getDefaultSites 获取合并后的站点配置

  const sites = await getDefaultSites();

  // 遍历每个 iframe
  iframes.forEach(iframe => {
    try {
      // 从 src 中提取域名
      const url = new URL(iframe.src);
      const domain = url.hostname;
      console.log('当前iframe网站hostname:', domain);
      // 通过 data-site 属性获取站点名
      const siteName = iframe.getAttribute('data-site');

      const siteConfig = sites.find(site => site.name === siteName);
      // 如果站点配置存在并且支持 URL 查询
      if (siteConfig && siteConfig.supportUrlQuery) {
        // 获取 URL
        const url = siteConfig.url;
        // 根据 URL 和 query 拼接新的 URL
        const newUrl = url.replace('{query}', encodeURIComponent(query));
        console.log(`为 ${siteName} iframe 生成新的 URL: ${newUrl}`);
        // 让 iframe 访问新的 URL
        iframe.src = newUrl;
      }
      else {
        // 使用动态处理函数
        getIframeHandler(iframe.src).then(handler => {
          if (handler) {
            console.log(`重新处理 ${domain} iframe`, {
              时间: new Date().toISOString(),
              query: query
            });
            // 调用处理函数
            handler(iframe, query);
          } else {
            console.log('没有找到处理函数');
          }
        }).catch(error => {
          console.error('获取处理函数失败:', error);
        });
      }
    } catch (error) {
      console.error('处理 iframe 失败:', error);
    }
  });







}



// 在页面加载时调用
document.addEventListener('DOMContentLoaded', async () => {
  initializeI18n();
  await initializeFavorites();
  checkForSiteConfigUpdates();

  // 检查剪贴板权限状态
  checkClipboardPermissionStatus();

  // 注意：粘贴事件监听器已在主 DOMContentLoaded 中统一处理，无需重复添加
});


// 检查剪贴板权限状态
async function checkClipboardPermissionStatus() {
  try {
    // 检查是否支持剪贴板API
    if (!navigator.clipboard) {
      console.log('❌ 浏览器不支持剪贴板API');
      return;
    }

    const permissionStatus = await navigator.permissions.query({ name: 'clipboard-read' });
    console.log('剪贴板权限状态:', permissionStatus.state);

    // 只在权限被拒绝时显示提示，避免在页面加载时打扰用户
    if (permissionStatus.state === 'denied') {
      console.log('❌ 剪贴板权限被拒绝，文件粘贴功能将不可用');
      // 延迟显示提示，避免在页面加载时立即弹出
      setTimeout(() => {
        showClipboardDeniedMessage();
      }, 3000);
    } else if (permissionStatus.state === 'granted') {
      console.log('✅ 剪贴板权限已授予');
    } else {
      console.log('🔄 剪贴板权限状态: prompt，将在用户粘贴时请求');
    }
  } catch (error) {
    console.log('❌ 检查剪贴板权限失败:', error);
  }
}

// 显示剪贴板权限被拒绝的消息
function showClipboardDeniedMessage() {
  const message = document.createElement('div');
  message.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: #f44336;
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    z-index: 10000;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    max-width: 400px;
    text-align: center;
  `;

  message.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
      <span>🚫</span>
      <span style="font-weight: 600;">剪贴板权限被拒绝</span>
    </div>
    <div style="font-size: 12px; opacity: 0.9;">
      请在浏览器设置中允许剪贴板访问权限，或点击地址栏左侧的锁图标进行设置
    </div>
  `;

  document.body.appendChild(message);

  // 5秒后自动关闭
  setTimeout(() => {
    if (message.parentNode) {
      message.remove();
    }
  }, 5000);
}


// 检查站点配置更新
async function checkForSiteConfigUpdates() {
  try {
    if (window.RemoteConfigManager) {
      // 首先检查是否有未显示的更新
      const { siteConfigVersion, lastUpdateTime, updateNotificationShown } = await chrome.storage.local.get(['siteConfigVersion', 'lastUpdateTime', 'updateNotificationShown']);

      // 如果有更新记录且还没有显示过通知，则显示提示
      if (lastUpdateTime && !updateNotificationShown) {
        console.log('检测到配置更新，显示提示');
        showUpdateNotification();
        // 标记已显示通知，避免重复显示
        await chrome.storage.local.set({ updateNotificationShown: true });
        return;
      }

      // 然后检查是否有新的远程更新
      const updateInfo = await window.RemoteConfigManager.autoCheckUpdate();
      if (updateInfo && updateInfo.hasUpdate) {
        console.log('发现新版本站点配置，自动更新');
        // 自动更新配置
        await window.RemoteConfigManager.updateLocalConfig(updateInfo.config);
        // 显示更新成功提示
        showUpdateNotification();
      }
    }
  } catch (error) {
    console.error('检查站点配置更新失败:', error);
  }
}

// 显示更新通知
async function showUpdateNotification() {
  try {
    // 获取更新信息
    const { siteConfigVersion, lastUpdateTime, updateHistory } = await chrome.storage.local.get(['siteConfigVersion', 'lastUpdateTime', 'updateHistory']);

    const notification = document.createElement('div');
    notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
      background: linear-gradient(135deg, #4CAF50, #45a049);
    color: white;
      padding: 20px;
      border-radius: 12px;
      box-shadow: 0 6px 20px rgba(0,0,0,0.3);
    z-index: 10000;
      max-width: 350px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
      line-height: 1.5;
    cursor: pointer;
      border: 1px solid rgba(255,255,255,0.2);
      backdrop-filter: blur(10px);
      animation: slideInRight 0.3s ease-out;
    `;

    // 格式化更新时间
    const formatUpdateTime = (timestamp) => {
      if (!timestamp) return '刚刚';
      const now = Date.now();
      const diff = now - timestamp;
      const minutes = Math.floor(diff / 60000);
      const hours = Math.floor(diff / 3600000);
      const days = Math.floor(diff / 86400000);

      if (minutes < 1) return '刚刚';
      if (minutes < 60) return `${minutes}分钟前`;
      if (hours < 24) return `${hours}小时前`;
      return `${days}天前`;
    };

    // 获取更新历史信息
    let updateInfo = '';
    if (updateHistory && updateHistory.length > 0) {
      const latestUpdate = updateHistory[updateHistory.length - 1];
      updateInfo = `
        <div style="font-size: 12px; opacity: 0.9; margin-top: 8px;">
          <div>V ${latestUpdate.version || siteConfigVersion || '未知'}</div>
          <div>${formatUpdateTime(latestUpdate.timestamp || lastUpdateTime)}</div>
          ${latestUpdate.newSites ? `<div>新增站点: ${latestUpdate.newSites}个</div>` : ''}
          ${latestUpdate.updatedSites ? `<div>更新站点: ${latestUpdate.updatedSites}个</div>` : ''}
        </div>
      `;
    } else {
      updateInfo = `
        <div style="font-size: 12px; opacity: 0.9; margin-top: 8px;">
          <div>V ${siteConfigVersion || '未知'}</div>
          <div>${formatUpdateTime(lastUpdateTime)}</div>
        </div>
      `;
    }

    notification.innerHTML = `
     
      <div style="font-size: 13px; opacity: 0.95; margin-bottom: 8px;">
        🆕AI站点处理规则已自动更新到最新版本
      </div>
      ${updateInfo}
      <div style="font-size: 11px; opacity: 0.8; margin-top: 12px; text-align: center; border-top: 1px solid rgba(255,255,255,0.2); padding-top: 8px;">
        🔎
      </div>
    `;

    // 添加CSS动画
    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideInRight {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }
    `;
    document.head.appendChild(style);

    // 点击通知显示详细更新信息
    notification.addEventListener('click', () => {
      showDetailedUpdateInfo();
      notification.remove();
      style.remove();
    });

    // 添加悬停效果
    notification.addEventListener('mouseenter', () => {
      notification.style.transform = 'translateY(-2px)';
      notification.style.boxShadow = '0 8px 25px rgba(0,0,0,0.4)';
    });

    notification.addEventListener('mouseleave', () => {
      notification.style.transform = 'translateY(0)';
      notification.style.boxShadow = '0 6px 20px rgba(0,0,0,0.3)';
    });

    document.body.appendChild(notification);

    // 10秒后自动消失
    setTimeout(() => {
      if (notification.parentElement) {
        notification.style.animation = 'slideInRight 0.3s ease-out reverse';
        setTimeout(() => {
          if (notification.parentElement) {
            notification.remove();
            style.remove();
          }
        }, 300);
      }
    }, 10000);

  } catch (error) {
    console.error('显示更新通知失败:', error);
    // 显示简单的 toast 提示
    showToast('配置已更新，但无法显示详细信息');
  }
}

// 显示详细更新信息
async function showDetailedUpdateInfo() {
  try {
    const { updateHistory, siteConfigVersion, lastUpdateTime } = await chrome.storage.local.get(['updateHistory', 'siteConfigVersion', 'lastUpdateTime']);

    // 创建模态框背景
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.5);
      z-index: 20000;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: fadeIn 0.3s ease-out;
    `;

    // 创建模态框内容
    const modal = document.createElement('div');
    modal.style.cssText = `
      background: white;
      border-radius: 16px;
      padding: 24px;
      max-width: 500px;
      width: 90%;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      animation: slideInUp 0.3s ease-out;
    `;

    // 格式化时间
    const formatTime = (timestamp) => {
      if (!timestamp) return chrome.i18n.getMessage('unknownTime');
      const date = new Date(timestamp);
      return date.toLocaleString(chrome.i18n.getUILanguage(), {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    };

    // 生成更新历史内容
    let historyContent = '';
    if (updateHistory && updateHistory.length > 0) {
      // 去重：只显示历史记录，不重复显示当前更新信息
      const uniqueHistory = updateHistory.filter((update, index, arr) => {
        // 如果是最后一个记录且与当前版本相同，则跳过（避免重复显示）
        if (index === arr.length - 1 && update.version === siteConfigVersion) {
          return false;
        }
        return true;
      });

      historyContent = uniqueHistory.slice(-5).reverse().map((update, index) => `
        <div style="padding: 12px; border-left: 3px solid #4CAF50; margin-bottom: 12px; background: #f8f9fa; border-radius: 0 8px 8px 0;">
          <div style="font-weight: 600; color: #333; margin-bottom: 4px;">
            V${update.version} - ${formatTime(update.timestamp)}
          </div>
          <div style="font-size: 13px; color: #666;">
            ${(() => {
          const parts = [];
          if (update.newSites > 0) {
            parts.push(chrome.i18n.getMessage('newSitesCount', [update.newSites]));
          }
          if (update.updatedSites > 0) {
            parts.push(chrome.i18n.getMessage('updatedSitesCount', [update.updatedSites]));
          }
          if (update.totalSites > 0) {
            parts.push(chrome.i18n.getMessage('totalSitesCount', [update.totalSites]));
          }
          return parts.join('，');
        })()}
          </div>
        </div>
      `).join('');

      // 如果没有历史记录可显示，显示空状态
      if (historyContent === '') {
        historyContent = `
          <div style="padding: 20px; text-align: center; color: #666;">
            <div style="font-size: 48px; margin-bottom: 16px;">📋</div>
            <div>${chrome.i18n.getMessage('noUpdateHistory')}</div>
          </div>
        `;
      }
    } else {
      historyContent = `
        <div style="padding: 20px; text-align: center; color: #666;">
          <div style="font-size: 48px; margin-bottom: 16px;">📋</div>
          <div>${chrome.i18n.getMessage('noUpdateHistory')}</div>
        </div>
      `;
    }

    modal.innerHTML = `
      <div style="margin-bottom: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
          <h3 style="margin: 0; color: #333; font-size: 16px; font-weight: 600;">📈 ${chrome.i18n.getMessage('recentUpdateRecords')}</h3>
          <button id="closeModal" style="background: none; border: none; font-size: 20px; cursor: pointer; color: #999; padding: 0; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border-radius: 50%; transition: all 0.2s;">
            ×
          </button>
        </div>
        <div style="max-height: 300px; overflow-y: auto;">
          ${historyContent}
        </div>
      </div>
      
      <div style="display: flex; gap: 12px; justify-content: flex-end;">
        <button id="viewGitHub" style="background: #f5f5f5; border: 1px solid #ddd; padding: 8px 16px; border-radius: 8px; cursor: pointer; font-size: 14px; color: #333; transition: all 0.2s;">
          📖 ${chrome.i18n.getMessage('participateAISiteRuleDev')}
        </button>
        <button id="refreshConfig" style="background: #f5f5f5; border: 1px solid #ddd; padding: 8px 16px; border-radius: 8px; cursor: pointer; font-size: 14px; color: #333; transition: all 0.2s;">
          🔄 ${chrome.i18n.getMessage('checkUpdates')}
        </button>
      </div>
    `;

    // 添加CSS动画
    const style = document.createElement('style');
    style.textContent = `
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes slideInUp {
        from { transform: translateY(30px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
    `;
    document.head.appendChild(style);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // 事件处理
    const closeModal = () => {
      overlay.style.animation = 'fadeIn 0.3s ease-out reverse';
      setTimeout(() => {
        if (overlay.parentElement) {
          overlay.remove();
          style.remove();
        }
      }, 300);
    };

    // 关闭按钮
    modal.querySelector('#closeModal').addEventListener('click', closeModal);

    // 点击背景关闭
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeModal();
      }
    });

    // 查看GitHub
    modal.querySelector('#viewGitHub').addEventListener('click', () => {
      window.open('https://github.com/taoAIGC/AI-Shortcuts/blob/main/config/siteHandlers.json', '_blank');
    });

    // 检查更新
    modal.querySelector('#refreshConfig').addEventListener('click', async () => {
      const button = modal.querySelector('#refreshConfig');
      const originalText = button.textContent;
      button.textContent = '🔄 检查中...';
      button.disabled = true;

      try {
        if (window.RemoteConfigManager) {
          const updateInfo = await window.RemoteConfigManager.autoCheckUpdate();
          if (updateInfo && updateInfo.hasUpdate) {
            await window.RemoteConfigManager.updateLocalConfig(updateInfo.config);
            showToast('配置已更新到最新版本！');
            closeModal();
            // 显示新的更新通知
            setTimeout(() => showUpdateNotification(), 500);
          } else {
            showToast('已是最新版本');
          }
        } else {
          showToast('更新检查功能不可用');
        }
      } catch (error) {
        console.error('检查更新失败:', error);
        showToast('检查更新失败');
      } finally {
        button.textContent = originalText;
        button.disabled = false;
      }
    });

    // ESC键关闭
    const handleEsc = (e) => {
      if (e.key === 'Escape') {
        closeModal();
        document.removeEventListener('keydown', handleEsc);
      }
    };
    document.addEventListener('keydown', handleEsc);

  } catch (error) {
    console.error('显示详细更新信息失败:', error);
    showToast('显示更新信息失败');
  }
}


// 收藏功能实现
let favoritePrompts = [];

// 初始化收藏功能
async function initializeFavorites() {
  try {
    const { favoritePrompts: savedFavorites = [] } = await chrome.storage.sync.get('favoritePrompts');
    favoritePrompts = savedFavorites;
    console.log('加载的收藏提示词:', favoritePrompts);
  } catch (error) {
    console.error('加载收藏提示词失败:', error);
  }
}

// 更新收藏按钮的显示状态
function updateFavoriteButtonVisibility(query) {
  const favoriteButton = document.getElementById('favoriteButton');
  const favoriteIcon = document.getElementById('favoriteIcon');

  if (query) {
    favoriteButton.style.display = 'block';
    // 检查当前文本是否已收藏
    const isFavorited = favoritePrompts.includes(query);
    favoriteIcon.src = isFavorited ? '../icons/star_saved.png' : '../icons/star_unsaved.png';
  } else {
    favoriteButton.style.display = 'none';
  }
}

// 切换收藏状态
async function toggleFavorite() {
  const searchInput = document.getElementById('searchInput');
  const query = searchInput.value.trim();
  const favoriteIcon = document.getElementById('favoriteIcon');

  if (!query) return;

  try {
    const index = favoritePrompts.indexOf(query);

    if (index > -1) {
      // 取消收藏
      favoritePrompts.splice(index, 1);
      favoriteIcon.src = '../icons/star_unsaved.png';
      console.log('取消收藏:', query);
    } else {
      // 添加收藏
      favoritePrompts.push(query);
      favoriteIcon.src = '../icons/star_saved.png';
      console.log('添加收藏:', query);
    }

    // 保存到存储
    await chrome.storage.sync.set({ favoritePrompts: favoritePrompts });
    console.log('收藏列表已更新:', favoritePrompts);

  } catch (error) {
    console.error('保存收藏失败:', error);
  }
}

// 显示收藏夹
function showFavorites() {
  const queryList = document.getElementById('queryList');

  if (favoritePrompts.length === 0) {
    const favoritesTitle = chrome.i18n.getMessage('favoritesTitle');
    const noFavoritesMessage = chrome.i18n.getMessage('noFavorites');
    queryList.innerHTML = `<div class="favorites-section"><div class="favorites-title">${favoritesTitle}</div><div style="padding: 10px; color: #666; text-align: center;">${noFavoritesMessage}</div></div>`;
  } else {
    const favoritesTitle = chrome.i18n.getMessage('favoritesTitle');
    let html = `<div class="favorites-section"><div class="favorites-title">${favoritesTitle}</div>`;

    favoritePrompts.forEach((prompt, index) => {
      html += `
        <div class="favorite-item" data-prompt="${prompt.replace(/"/g, '&quot;')}" data-index="${index}">
          <div class="favorite-item-content">${prompt}</div>
          <div class="favorite-item-actions">
          
           <!--
            <button class="favorite-item-edit" title="编辑">
              <img src="../icons/edit.png" alt="编辑">
            </button>
            -->

            <button class="favorite-item-delete" title="删除">
              <img src="../icons/close.png" alt="删除">
            </button>
           
          </div>
        </div>
      `;
    });

    html += '</div>';
    queryList.innerHTML = html;

    // 添加点击事件
    queryList.querySelectorAll('.favorite-item').forEach(item => {
      const content = item.querySelector('.favorite-item-content');
      const editBtn = item.querySelector('.favorite-item-edit');
      const deleteBtn = item.querySelector('.favorite-item-delete');

      // 点击内容区域选择提示词
      content.addEventListener('click', (e) => {
        e.stopPropagation();
        const prompt = item.getAttribute('data-prompt');
        document.getElementById('searchInput').value = prompt;
        queryList.style.display = 'none';
        document.getElementById('toggleIcon').src = '../icons/down.png';

        // 更新收藏按钮状态
        updateFavoriteButtonVisibility(prompt);
      });

      // 编辑按钮点击事件（如果存在）
      if (editBtn) {
        editBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          editFavoriteItem(item);
        });
      }

      // 删除按钮点击事件
      if (deleteBtn) {
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          console.log('删除按钮被点击');
          deleteFavoriteItem(item);
        });
      }
    });
  }

  queryList.style.display = 'block';
}

// 编辑收藏项
function editFavoriteItem(item) {
  console.log('进入编辑收藏项');
  showToast('coming soon');
}

// 删除收藏项
async function deleteFavoriteItem(item) {
  console.log('deleteFavoriteItem 函数被调用');
  const index = parseInt(item.getAttribute('data-index'));
  const prompt = item.getAttribute('data-prompt');
  console.log('删除索引:', index, '提示词:', prompt);

  const deleteConfirmMessage = chrome.i18n.getMessage('deleteConfirm');
  if (confirm(deleteConfirmMessage)) {
    try {
      // 从数组中删除
      favoritePrompts.splice(index, 1);

      // 保存到存储
      await chrome.storage.sync.set({ favoritePrompts: favoritePrompts });

      // 重新显示收藏夹
      showFavorites();

      console.log('删除收藏提示词:', prompt);
    } catch (error) {
      console.error('删除收藏失败:', error);
    }
  }
}

// 添加拖拽排序功能到导航列表
function addDragAndDropToNavList(navList, enabledSites) {
  let draggedElement = null;
  let draggedIndex = null;

  // 拖拽开始
  navList.addEventListener('dragstart', (e) => {
    if (e.target.classList.contains('nav-item')) {
      draggedElement = e.target;
      draggedIndex = Array.from(navList.children).indexOf(e.target);
      e.target.classList.add('dragging');
      navList.classList.add('drag-active');

      // 设置拖拽数据
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/html', e.target.outerHTML);
    }
  });

  // 拖拽结束
  navList.addEventListener('dragend', (e) => {
    if (e.target.classList.contains('nav-item')) {
      e.target.classList.remove('dragging');
      navList.classList.remove('drag-active');

      // 移除所有拖拽悬停效果
      navList.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('drag-over');
      });

      draggedElement = null;
      draggedIndex = null;
    }
  });

  // 拖拽悬停
  navList.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const afterElement = getDragAfterElement(navList, e.clientY);
    const dragging = navList.querySelector('.dragging');

    if (afterElement == null) {
      navList.appendChild(dragging);
    } else {
      navList.insertBefore(dragging, afterElement);
    }
  });

  // 拖拽进入
  navList.addEventListener('dragenter', (e) => {
    e.preventDefault();
    if (e.target.classList.contains('nav-item') && e.target !== draggedElement) {
      e.target.classList.add('drag-over');
    }
  });

  // 拖拽离开
  navList.addEventListener('dragleave', (e) => {
    if (e.target.classList.contains('nav-item')) {
      e.target.classList.remove('drag-over');
    }
  });

  // 拖拽放置
  navList.addEventListener('drop', async (e) => {
    e.preventDefault();

    if (draggedElement) {
      const newIndex = Array.from(navList.children).indexOf(draggedElement);

      if (newIndex !== draggedIndex) {
        // 更新站点顺序
        await updateSitesOrder(enabledSites, draggedIndex, newIndex);

        // 重新排列iframe
        await reorderIframes(draggedIndex, newIndex);

        console.log('导航项顺序已更新');
      }
    }
  });
}

// 获取拖拽后的元素位置
function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll('.nav-item:not(.dragging)')];

  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;

    if (offset < 0 && offset > closest.offset) {
      return { offset: offset, element: child };
    } else {
      return closest;
    }
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

// 更新站点顺序
async function updateSitesOrder(enabledSites, fromIndex, toIndex) {
  // 移动数组中的元素
  const movedSite = enabledSites.splice(fromIndex, 1)[0];
  enabledSites.splice(toIndex, 0, movedSite);

  try {
    // 从 chrome.storage.sync 读取现有的用户设置
    const { sites: existingUserSettings = {} } = await chrome.storage.sync.get('sites');

    // 更新拖拽后站点的order字段
    const updatedUserSettings = { ...existingUserSettings };
    enabledSites.forEach((site, index) => {
      if (!updatedUserSettings[site.name]) {
        updatedUserSettings[site.name] = {};
      }
      updatedUserSettings[site.name].order = index;
    });

    // 保存用户设置到 chrome.storage.sync
    await chrome.storage.sync.set({ sites: updatedUserSettings });

    console.log('iframe侧边栏站点顺序已保存到 sync 存储');
  } catch (error) {
    console.error('保存站点顺序失败:', error);
  }
}

// 重新排列iframe
async function reorderIframes(fromIndex, toIndex) {
  const container = document.getElementById('iframes-container');
  const iframeContainers = Array.from(container.querySelectorAll('.iframe-container'));

  if (iframeContainers.length > 0) {
    // 获取导航项的新顺序
    const navList = document.querySelector('.nav-list');
    const navItems = Array.from(navList.children);

    // 为每个iframe容器设置CSS order属性，避免移动DOM元素
    navItems.forEach((navItem, index) => {
      const siteName = navItem.textContent;
      const iframeContainer = iframeContainers.find(container => {
        const iframe = container.querySelector('iframe');
        return iframe && iframe.getAttribute('data-site') === siteName;
      });

      if (iframeContainer) {
        // 使用CSS order属性来控制显示顺序，不移动DOM元素
        iframeContainer.style.order = index;
      }
    });

    // CSS Grid布局已经支持order属性，无需额外设置

    console.log('iframe顺序已更新，使用CSS order属性');
  }
}

// 初始化文件上传功能
function initializeFileUpload() {
  const fileUploadButton = document.getElementById('fileUploadButton');
  const fileInput = document.getElementById('fileInput');

  if (!fileUploadButton || !fileInput) {
    console.warn('文件上传元素未找到');
    return;
  }

  // 点击上传按钮触发文件选择
  fileUploadButton.addEventListener('click', () => {
    fileInput.click();
  });

  // 文件选择变化时处理
  fileInput.addEventListener('change', handleFileSelection);

  console.log('🎯 文件上传功能已初始化');
}

// 初始化导出回答功能
function initializeExportResponses() {
  const exportButton = document.getElementById('exportResponsesButton');

  if (!exportButton) {
    console.warn('导出回答按钮未找到');
    return;
  }

  // 点击导出按钮显示导出模态框
  exportButton.addEventListener('click', () => {
    console.log('🎯 导出按钮被点击');
    showExportModal();
  });

  console.log('🎯 导出回答功能已初始化');
}

// 处理文件选择
async function handleFileSelection(event) {
  const files = event.target.files;

  if (!files || files.length === 0) {
    console.log('未选择文件');
    return;
  }

  console.log('🎯 用户选择了文件:', files.length, '个');

  // 处理第一个文件（暂时只支持单文件）
  const file = files[0];
  await processUploadedFile(file);

  // 清空input，允许重复选择同一文件
  event.target.value = '';
}

// 处理上传的文件
async function processUploadedFile(file) {
  console.log('🎯 开始处理上传的文件:', {
    name: file.name,
    type: file.type,
    size: file.size,
    lastModified: file.lastModified
  });

  // 文件大小检查（限制50MB）
  const maxSize = 50 * 1024 * 1024; // 50MB
  if (file.size > maxSize) {
    showFileUploadError(`文件大小超过限制（${Math.round(maxSize / 1024 / 1024)}MB）`);
    return;
  }

  try {
    // 读取文件内容
    const arrayBuffer = await file.arrayBuffer();
    const blob = new Blob([arrayBuffer], { type: file.type });

    // 创建文件数据对象
    const fileData = {
      type: file.type,
      blob: blob,
      fileName: file.name,
      originalName: file.name,
      size: file.size,
      lastModified: file.lastModified
    };

    console.log('🎯 文件数据准备完成:', fileData);

    // 调用现有的多iframe文件处理流程
    await processFileToAllIframes(fileData);

  } catch (error) {
    console.error('❌ 文件处理失败:', error);
    showFileUploadError('文件处理失败: ' + error.message);
  }
}

// 向所有iframe发送文件
async function processFileToAllIframes(fileData) {
  console.log('🎯 开始向所有iframe发送文件');

  // 获取所有 iframe 元素
  const iframes = document.querySelectorAll('.ai-iframe');
  console.log(`找到 ${iframes.length} 个 iframe`);

  if (iframes.length === 0) {
    showFileUploadError('没有找到可用的AI站点');
    return;
  }

  // 调用现有的文件上传处理流程
  await executeFileUploadSequentially(iframes, fileData);
}

// 显示文件上传错误
function showFileUploadError(message) {
  const error = document.createElement('div');
  error.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: linear-gradient(135deg, #ff6b6b, #ee5a24);
    color: white;
    padding: 16px 24px;
    border-radius: 12px;
    box-shadow: 0 8px 25px rgba(0,0,0,0.3);
    z-index: 10001;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    max-width: 400px;
    text-align: center;
    animation: slideInScale 0.3s ease-out;
  `;

  error.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
      <span style="font-size: 18px;">❌</span>
      <span style="font-weight: 600;">文件上传失败</span>
    </div>
    <div style="font-size: 13px; opacity: 0.9;">${message}</div>
  `;

  document.body.appendChild(error);

  // 3秒后自动关闭
  setTimeout(() => {
    if (error.parentElement) {
      error.remove();
    }
  }, 3000);
}



