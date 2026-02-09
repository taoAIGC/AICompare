// 跟踪输入法组合输入状态（用于中文输入法）
let isComposing = false;

function trackEvent(name, params = {}) {
    const analytics = window.AIShortcutsAnalytics;
    if (analytics && typeof analytics.logEvent === 'function') {
        analytics.logEvent(name, params);
    }
}

// 页面加载完成后的初始化
document.addEventListener('DOMContentLoaded', async function() {
    // 初始化自动调整高度的输入框
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        // 自动调整输入框高度
        function autoResizeTextarea() {
            searchInput.style.height = 'auto';
            const scrollHeight = searchInput.scrollHeight;
            const minHeight = 36; // 最小高度
            const maxHeight = 200; // 最大高度
            
            if (scrollHeight <= minHeight) {
                searchInput.style.height = minHeight + 'px';
            } else {
                const newHeight = Math.min(scrollHeight, maxHeight);
                searchInput.style.height = newHeight + 'px';
            }
        }
        
        // 监听输入事件
        searchInput.addEventListener('input', autoResizeTextarea);
        
        // 监听粘贴事件
        searchInput.addEventListener('paste', () => {
            setTimeout(autoResizeTextarea, 10);
        });
        
        // 监听聚焦事件
        searchInput.addEventListener('focus', autoResizeTextarea);
        
        // 初始调整
        autoResizeTextarea();
    }
    
    // 检查 URL 参数，判断是否有预填充的查询和是否在侧边栏中
    const urlParams = new URLSearchParams(window.location.search);
    const isSidePanel = urlParams.get('side_panel') === 'true';
    const hasQueryParam = urlParams.has('query');
    
    // 延迟设置焦点，防止页面自动滚动
    // 使用 setTimeout 确保页面完全加载后再聚焦
    if (searchInput) {
        setTimeout(() => {
            if (isSidePanel) {
                // 在侧边栏中：更积极的防止滚动
                // 1. 立即滚动到顶部
                window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
                document.documentElement.scrollTop = 0;
                document.body.scrollTop = 0;
                
                // 2. 等待一下，确保滚动完成
                setTimeout(() => {
                    // 3. 再次确保在顶部
                    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
                    // 4. 使用 preventScroll 设置焦点
                    searchInput.focus({ preventScroll: true });
                    
                    // 5. 设置焦点后再次确保滚动位置
                    setTimeout(() => {
                        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
                        document.documentElement.scrollTop = 0;
                        document.body.scrollTop = 0;
                    }, 50);
                }, 50);
            } else {
                // 在新标签页中：正常处理
                window.scrollTo(0, 0);
                searchInput.focus({ preventScroll: true });
            }
        }, isSidePanel ? 200 : 100); // 侧边栏需要更长的延迟
    }
    
    if (hasQueryParam) {
        // 从 URL 参数中获取查询内容并填入搜索框
        const query = urlParams.get('query');
        if (query && query !== 'true') {
            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                searchInput.value = query;
                // 触发自动调整高度
                searchInput.dispatchEvent(new Event('input'));
            }
        }
    }
    
    // 初始化国际化
    initializeI18n();
    
    // 检查是否需要显示 pin 引导提示（仅首次安装时）
    await checkAndShowPinGuide();
    
    // 加载提示词模板建议
    await initializeQuerySuggestions();
    
    // 初始化站点列表
    await initializeSitesList();
    
    // 初始化保存按钮（确保即使站点列表加载失败也能初始化）
    initializeSaveSitesButton();
    
    // 初始化操作链接
    initializeActionLinks();
    // 底部同步栏：未登录点击「开启同步」则打开谷歌登录并同步；已登录显示邮箱，点击无跳转
    await updateSyncBar();
    const syncBar = document.getElementById('syncBar');
    if (syncBar) {
        syncBar.addEventListener('click', async () => {
            trackEvent('homepage_sync_bar_click');
            const loggedIn = window.firebaseIsLoggedIn ? await window.firebaseIsLoggedIn() : false;
            if (loggedIn) {
                return; // 已登录仅展示账号，不跳转
            }
            if (!window.firebaseSignInWithGoogle || !window.firebaseSyncMergeAndUpload) {
                return;
            }
            const textEl = document.getElementById('syncBarText');
            try {
                if (textEl) textEl.textContent = chrome.i18n.getUILanguage().toLowerCase().startsWith('zh') ? '正在打开谷歌登录…' : 'Opening Google sign-in…';
                await window.firebaseSignInWithGoogle();
                await window.firebaseSyncMergeAndUpload();
                await updateSyncBar();
            } catch (e) {
                if (textEl) textEl.textContent = chrome.i18n.getMessage('enableSync') || '开启同步';
                console.warn('Sync sign-in failed', e);
            }
        });
    }
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local' && changes.pkHistory) loadSidebarFavorites();
        if (areaName === 'local' && (changes.firebase_email || changes.firebase_uid)) updateSyncBar();
    });
    // 加载收藏下方全部收藏历史记录
    await loadSidebarFavorites();
    // 已登录时拉取云端并合并，保证换电脑后打开首页能拿到最新历史与收藏
    const loggedIn = window.firebaseIsLoggedIn ? await window.firebaseIsLoggedIn() : false;
    if (loggedIn && typeof window.firebaseSyncMergeAndUpload === 'function') {
        const { firebase_lastSyncAt } = await chrome.storage.local.get('firebase_lastSyncAt');
        const throttleMs = 2 * 60 * 1000;
        if (!firebase_lastSyncAt || Date.now() - firebase_lastSyncAt > throttleMs) {
            window.firebaseSyncMergeAndUpload().then(() => loadSidebarFavorites()).catch(() => {});
        }
    }
});

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
            } else if (element.tagName.toLowerCase() === 'img') {
                // 对于图片，设置 alt
                element.alt = message;
            } else {
                // 对于其他元素，设置文本内容
                element.textContent = message;
            }
        }
    });
    
    // 处理 data-i18n-title：设置元素的 title 属性
    document.querySelectorAll('[data-i18n-title]').forEach(element => {
        const key = element.getAttribute('data-i18n-title');
        const message = chrome.i18n.getMessage(key);
        if (message) {
            element.title = message;
        }
    });
    
    // 处理 data-i18n-alt：设置 img 的 alt 属性（若未在 data-i18n 中处理）
    document.querySelectorAll('[data-i18n-alt]').forEach(element => {
        const key = element.getAttribute('data-i18n-alt');
        const message = chrome.i18n.getMessage(key);
        if (message) {
            element.alt = message;
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

// 初始化查询建议
async function initializeQuerySuggestions() {
    const searchInput = document.getElementById('searchInput');
    if (!searchInput) return;
    
    // 添加输入监听器，当searchInput有内容时显示建议
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        showQuerySuggestions(query);
    });
    
    // 添加焦点事件监听器
    searchInput.addEventListener('focus', (e) => {
        const query = e.target.value.trim();
        if (query) {
            showQuerySuggestions(query);
        }
    });
    
    // 失焦时隐藏建议
    searchInput.addEventListener('blur', () => {
        setTimeout(() => {
            const querySuggestions = document.getElementById('querySuggestions');
            if (querySuggestions) {
                querySuggestions.style.display = 'none';
            }
        }, 200);
    });
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
                // 触发自动调整高度
                document.getElementById('searchInput').dispatchEvent(new Event('input'));
            });
            querySuggestions.appendChild(suggestionItem);
        });
        
        // 添加设置图标到 querySuggestions 区域
        const settingsIcon = document.createElement('img');
        settingsIcon.src = '../icons/edit.svg';
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
            // 埋点：从首页提示词建议区域打开模板设置
            trackEvent('homepage_prompt_templates_settings_click');
            window.open(chrome.runtime.getURL('options/options.html#prompt-templates'), '_blank');
        });

        // 将设置图标添加到 querySuggestions 区域
        querySuggestions.appendChild(settingsIcon);

        // 显示建议
        querySuggestions.style.display = 'flex';
        
    } catch (error) {
        console.error('加载提示词模板失败:', error);
        querySuggestions.style.display = 'none';
    }
}

// 检查并显示 pin 引导提示（仅首次安装时）
async function checkAndShowPinGuide() {
    try {
        // 检查是否已经显示过引导
        const { pinGuideShown } = await chrome.storage.local.get(['pinGuideShown']);
        
        // 如果已经显示过，不显示
        if (pinGuideShown === true) {
            return;
        }
        
        // 如果是首次安装（pinGuideShown 为 false 或 undefined），显示引导
        showPinGuide();
    } catch (error) {
        console.error('检查 pin 引导失败:', error);
    }
}

// 显示 pin 引导提示
function showPinGuide() {
    const pinGuideBanner = document.getElementById('pinGuideBanner');
    if (!pinGuideBanner) {
        return;
    }
    
    pinGuideBanner.style.display = 'block';
    
    // 设置 pin 图片路径
    const pinGuideImage = document.getElementById('pinGuideImage');
    if (pinGuideImage) {
        pinGuideImage.src = chrome.runtime.getURL('icons/pin.png');
    }
    
    // 绑定关闭按钮事件
    const closeButton = document.getElementById('pinGuideClose');
    if (closeButton) {
        closeButton.addEventListener('click', async () => {
            pinGuideBanner.style.display = 'none';
            // 标记为已显示，以后不再显示
            await chrome.storage.local.set({ pinGuideShown: true });
        });
    }
}

function handleQuery(query) {
    // 解析输入文本（如果有前缀，去掉前缀）
    const processedQuery = query.replace(/^ai\s+/, '').trim();
    
    // 获取选中的站点列表
    const selectedSites = getSelectedSites();
    
    // 检查当前页面是否在侧边栏中
    const urlParams = new URLSearchParams(window.location.search);
    const isSidePanel = urlParams.get('side_panel') === 'true';
    
    // 构建 URL 参数
    const params = new URLSearchParams();
    if (processedQuery) {
        params.set('query', processedQuery);
    }
    if (selectedSites.length > 0) {
        // 传递选中的站点名称列表
        params.set('sites', selectedSites.join(','));
    }
    // 如果当前页面在侧边栏中，也传递 side_panel 参数
    if (isSidePanel) {
        params.set('side_panel', 'true');
    }

    trackEvent('homepage_search_submit', {
        query_length: processedQuery.length,
        selected_sites_count: selectedSites.length,
        selected_sites: selectedSites,
        side_panel: isSidePanel,
        has_query: Boolean(processedQuery)
    });
    
    // 构建 URL（使用相对路径，在当前页面跳转）
    let searchUrl = chrome.runtime.getURL('iframe/iframe.html');
    if (params.toString()) {
        searchUrl += '?' + params.toString();
    }
    
    // 在当前页面跳转，而不是打开新标签页
    window.location.href = searchUrl;
}

// 获取选中的站点名称列表
function getSelectedSites() {
    const checkboxes = document.querySelectorAll('#sitesList .site-checkbox:checked');
    return Array.from(checkboxes).map(checkbox => checkbox.id.replace('site-', ''));
}

// 常用站点优先排序（enabled=true 在前，再按 order 排序）
function sortSitesFavoriteFirst(sites) {
    return [...sites].sort((a, b) => {
        const aFav = a.enabled ? 0 : 1;
        const bFav = b.enabled ? 0 : 1;
        if (aFav !== bFav) return aFav - bFav;
        const orderA = a.order !== undefined ? a.order : 999;
        const orderB = b.order !== undefined ? b.order : 999;
        if (orderA !== orderB) return orderA - orderB;
        return String(a.name || '').localeCompare(String(b.name || ''));
    });
}

// 初始化站点列表
async function initializeSitesList() {
    const sitesList = document.getElementById('sitesList');
    if (!sitesList) {
        console.error('站点列表容器未找到');
        return;
    }
    
    try {
        // 使用 getDefaultSites 获取合并后的站点配置
        const sites = await getDefaultSites();
        
        // 过滤支持 iframe 的站点
        const supportedSites = sites.filter(site => 
            site.supportIframe === true && !site.hidden
        );
        const sortedSites = sortSitesFavoriteFirst(supportedSites);
        
        console.log('从getDefaultSites() 获取的可以使用的站点:', sortedSites.map(site => ({ name: site.name, enabled: site.enabled })));
        // 清空列表
        sitesList.innerHTML = '';
        
        // 创建站点项
        const fragment = document.createDocumentFragment();
        
        sortedSites.forEach(site => {
            const div = document.createElement('div');
            div.className = 'site-item';
            div.draggable = true;
            div.dataset.siteName = site.name;

            const dragHandle = document.createElement('span');
            dragHandle.className = 'site-drag-handle';
            dragHandle.setAttribute('aria-hidden', 'true');
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'site-checkbox';
            checkbox.id = `site-${site.name}`;
            
            // 直接使用 getDefaultSites() 返回的 site.enabled 值（已合并用户设置和基础配置）
            checkbox.checked = site.enabled === true;
            // 调试日志
            if (site.name === 'ChatGPT') {
                console.log('ChatGPT enabled 值:', site.enabled, '类型:', typeof site.enabled, '严格等于true:', site.enabled === true, 'checkbox.checked:', checkbox.checked);
            }

            checkbox.addEventListener('change', () => {
                trackEvent('homepage_site_toggle', {
                    site_name: site.name,
                    enabled: checkbox.checked
                });
            });
            
            const nameLabel = document.createElement('label');
            nameLabel.textContent = site.name;
            nameLabel.htmlFor = `site-${site.name}`;
            
            // 点击整个 item 也能切换复选框
            div.addEventListener('click', (e) => {
                if (sitesList.classList.contains('drag-active')) {
                    return;
                }
                if (e.target !== checkbox && e.target !== nameLabel && e.target !== dragHandle) {
                    checkbox.click();
                }
            });
            
            div.appendChild(dragHandle);
            div.appendChild(checkbox);
            div.appendChild(nameLabel);
            fragment.appendChild(div);
        });
        
        sitesList.appendChild(fragment);
        
        // 添加拖拽排序功能
        addDragAndDropToSitesList(sitesList, sortedSites);
        
    } catch (error) {
        console.error('获取站点配置失败:', error);
        if (sitesList) {
            sitesList.innerHTML = '<div style="padding: 20px; color: #666; text-align: center;">加载站点配置失败，请刷新页面重试</div>';
        }
    }
}

// 为站点列表添加拖拽排序功能
function addDragAndDropToSitesList(listEl, supportedSites) {
    let draggedElement = null;
    let draggedIndex = null;
    
    listEl.addEventListener('dragstart', (e) => {
        const item = e.target.closest('.site-item');
        if (!item) return;
        draggedElement = item;
        draggedIndex = Array.from(listEl.children).indexOf(item);
        item.classList.add('dragging');
        listEl.classList.add('drag-active');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/html', item.outerHTML);
    });
    
    listEl.addEventListener('dragend', (e) => {
        const item = e.target.closest('.site-item');
        if (!item) return;
        item.classList.remove('dragging');
        listEl.classList.remove('drag-active');
        listEl.querySelectorAll('.site-item').forEach(el => el.classList.remove('drag-over'));
        draggedElement = null;
        draggedIndex = null;
    });
    
    listEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const afterElement = getSitesDragAfterElement(listEl, e.clientY);
        const dragging = listEl.querySelector('.dragging');
        if (!dragging) return;
        if (afterElement == null) {
            listEl.appendChild(dragging);
        } else {
            listEl.insertBefore(dragging, afterElement);
        }
    });
    
    listEl.addEventListener('dragenter', (e) => {
        const item = e.target.closest('.site-item');
        if (item && item !== draggedElement) {
            item.classList.add('drag-over');
        }
    });
    
    listEl.addEventListener('dragleave', (e) => {
        const item = e.target.closest('.site-item');
        if (item) {
            item.classList.remove('drag-over');
        }
    });
    
    listEl.addEventListener('drop', async (e) => {
        e.preventDefault();
        if (!draggedElement) return;
        const newIndex = Array.from(listEl.children).indexOf(draggedElement);
        if (newIndex !== draggedIndex) {
            await updateHomepageSitesOrder(listEl, supportedSites);
            console.log('主页站点顺序已更新并保存');
        }
    });
}

// 获取拖拽后的插入位置
function getSitesDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.site-item:not(.dragging)')];
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        }
        return closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

// 保存主页站点排序到 storage
async function updateHomepageSitesOrder(listEl, supportedSites) {
    try {
        const orderedNames = Array.from(listEl.children)
            .map(el => el.dataset.siteName)
            .filter(Boolean);
        
        const { sites: existingUserSettings = {} } = await chrome.storage.sync.get('sites');
        const updatedUserSettings = { ...existingUserSettings };
        
        orderedNames.forEach((name, index) => {
            if (!updatedUserSettings[name]) {
                updatedUserSettings[name] = {};
            }
            updatedUserSettings[name].order = index;
        });
        
        await chrome.storage.sync.set({ sites: updatedUserSettings });
        
        // 同步内存中的顺序，防止后续逻辑依赖旧顺序
        if (supportedSites && Array.isArray(supportedSites)) {
            supportedSites.sort((a, b) => {
                const orderA = orderedNames.indexOf(a.name);
                const orderB = orderedNames.indexOf(b.name);
                return orderA - orderB;
            });
        }

        showToast(chrome.i18n.getMessage('saveSuccess') || '配置已保存');
    } catch (error) {
        console.error('保存主页站点顺序失败:', error);
    }
}

// 初始化保存站点按钮
function initializeSaveSitesButton() {
    const saveBtn = document.getElementById('saveSitesBtn');
    
    if (!saveBtn) {
        console.error('保存按钮未找到: saveSitesBtn');
        return;
    }
    
    console.log('保存按钮已找到，开始绑定事件');
    
    // 使用自定义 tooltip（快速显示），仅设置 aria-label 供无障碍
    const saveTitle = chrome.i18n.getMessage('saveFavoriteSitesTitle') || 
        chrome.i18n.getMessage('saveFavoriteSites') || 
        '保存当前选中的站点为常用站点';
    saveBtn.setAttribute('aria-label', saveTitle);
    
    // 点击保存按钮
    saveBtn.addEventListener('click', async (e) => {
        console.log('保存按钮被点击');
        e.preventDefault();
        e.stopPropagation();
        
        try {
            // 获取当前选中的站点
            const selectedSites = getSelectedSites();
            console.log('选中的站点:', selectedSites);
            
            if (selectedSites.length === 0) {
                showToast(chrome.i18n.getMessage('noSitesSelected') || '请至少选择一个站点');
                return;
            }
            
            // 1. 读取现有的用户设置
            const { sites: existingUserSettings = {} } = await chrome.storage.sync.get('sites');
            console.log('现有的用户设置:', existingUserSettings);
            
            // 2. 获取所有可用站点（用于更新所有站点的 enabled 状态）
            const allSites = await getDefaultSites();
            console.log('所有可用站点数量:', allSites.length);
            
            if (!allSites || allSites.length === 0) {
                console.error('无法获取站点列表，保存失败');
                showToast(chrome.i18n.getMessage('saveFailed') || '保存失败，请重试');
                return;
            }
            
            const allSiteNames = allSites.map(site => site.name);
            console.log('所有站点名称:', allSiteNames);
            
            // 3. 更新用户设置：选中的站点 enabled=true，未选中的 enabled=false
            const updatedUserSettings = { ...existingUserSettings };
            allSiteNames.forEach(siteName => {
                if (!updatedUserSettings[siteName]) {
                    updatedUserSettings[siteName] = {};
                }
                // 根据是否在选中列表中设置 enabled 状态
                updatedUserSettings[siteName].enabled = selectedSites.includes(siteName);
            });
            
            console.log('更新后的用户设置:', updatedUserSettings);
            
            // 4. 保存到 chrome.storage.sync.sites
            await chrome.storage.sync.set({ sites: updatedUserSettings });
            console.log('已保存到 chrome.storage.sync.sites');
            
            // 记录分析事件
            trackEvent('homepage_save_favorite_sites', {
                sites_count: selectedSites.length,
                sites: selectedSites
            });
            
            // 显示成功提示
            showToast(chrome.i18n.getMessage('saveSuccess') || '配置已保存');
            
            console.log('常用站点已保存到 sites:', updatedUserSettings);
        } catch (error) {
            console.error('保存常用站点失败:', error);
            showToast(chrome.i18n.getMessage('saveFailed') || '保存失败，请重试');
        }
    });
    
    console.log('保存按钮事件绑定完成');
}

// 添加上传附件按钮点击事件
document.getElementById('fileUploadButton').addEventListener('click', () => {
    // 打开 iframe.html 页面，并传递 upload=true 参数来触发文件上传
    const urlParams = new URLSearchParams();
    urlParams.set('upload', 'true');
    
    // 获取选中的站点列表
    const selectedSites = getSelectedSites();
    if (selectedSites.length > 0) {
        urlParams.set('sites', selectedSites.join(','));
    }
    
    // 检查当前页面是否在侧边栏中
    const currentUrlParams = new URLSearchParams(window.location.search);
    const isSidePanel = currentUrlParams.get('side_panel') === 'true';
    if (isSidePanel) {
        urlParams.set('side_panel', 'true');
    }

    trackEvent('homepage_upload_click', {
        selected_sites_count: selectedSites.length,
        side_panel: isSidePanel
    });
    
    // 构建 URL
    const iframeUrl = chrome.runtime.getURL(`iframe/iframe.html?${urlParams.toString()}`);
    
    // 在当前页面跳转，而不是打开新标签页
    window.location.href = iframeUrl;
});

// 添加搜索按钮点击事件
document.getElementById('searchButton').addEventListener('click', () => {
    const query = document.getElementById('searchInput').value.trim();
    handleQuery(query);
});

// 监听输入法组合输入事件
document.getElementById('searchInput').addEventListener('compositionstart', () => {
    isComposing = true;
});

document.getElementById('searchInput').addEventListener('compositionend', () => {
    isComposing = false;
});

// 处理回车键
document.getElementById('searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        // 如果正在使用输入法组合输入，不触发查询操作
        if (isComposing) {
            return;
        }
        
        e.preventDefault();
        const query = document.getElementById('searchInput').value.trim();
        handleQuery(query);
    }
});

// 底部同步栏（双语 i18n）：未登录显示 enableSync（开启同步/Enable Sync），登录后显示账号邮箱
async function updateSyncBar() {
    const syncBar = document.getElementById('syncBar');
    const syncBarText = document.getElementById('syncBarText');
    const syncBarIcon = syncBar?.querySelector('.sync-bar-icon');
    if (!syncBar || !syncBarText) return;
    try {
        const { firebase_uid, firebase_email, firebase_refreshToken } = await chrome.storage.local.get([
            'firebase_uid', 'firebase_email', 'firebase_refreshToken'
        ]);
        const loggedIn = !!(firebase_uid && firebase_refreshToken);
        if (loggedIn) {
            syncBar.classList.add('sync-bar--logged-in');
            syncBarText.textContent = firebase_email || firebase_uid || '';
            if (syncBarIcon) syncBarIcon.textContent = '\u{1F464}'; // 👤
        } else {
            syncBar.classList.remove('sync-bar--logged-in');
            syncBarText.textContent = chrome.i18n.getMessage('enableSync') || (chrome.i18n.getUILanguage().toLowerCase().startsWith('zh') ? '开启同步' : 'Enable Sync');
            if (syncBarIcon) syncBarIcon.textContent = '';
        }
    } catch (e) {
        syncBar.classList.remove('sync-bar--logged-in');
        syncBarText.textContent = chrome.i18n.getMessage('enableSync') || (chrome.i18n.getUILanguage().toLowerCase().startsWith('zh') ? '开启同步' : 'Enable Sync');
        if (syncBarIcon) syncBarIcon.textContent = '';
    }
}

// 收藏下方：加载全部收藏历史记录（与 favorites.js 同源：从 pkHistory 筛选含收藏站点的记录）
async function loadSidebarFavorites() {
    const listEl = document.getElementById('sidebarFavoritesList');
    if (!listEl) return;
    try {
        const { pkHistory = [] } = await chrome.storage.local.get('pkHistory');
        const favoriteItems = pkHistory
            .filter(item => item.sites && item.sites.some(site => site.isFavorite === true))
            .map(item => ({
                ...item,
                sites: item.sites.filter(site => site.isFavorite === true)
            }));
        // pkHistory 为最新在前，收藏列表直接使用该顺序，最新收藏在最上面
        listEl.innerHTML = '';
        if (favoriteItems.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'sidebar-favorites-empty';
            empty.textContent = chrome.i18n.getMessage('noFavorites') || '暂无收藏';
            listEl.appendChild(empty);
            return;
        }
        favoriteItems.forEach(item => {
            const el = document.createElement('div');
            el.className = 'sidebar-favorite-item';
            el.textContent = item.query || '';
            el.title = item.query || '';
            el.addEventListener('click', (e) => {
                e.preventDefault();
                openSidebarFavoriteItem(item);
            });
            listEl.appendChild(el);
        });
    } catch (error) {
        console.error('加载侧边栏收藏失败:', error);
        if (listEl) listEl.innerHTML = '';
    }
}

async function openSidebarFavoriteItem(item) {
    try {
        const params = new URLSearchParams();
        params.set('query', item.query || '');
        const siteNames = (item.sites || []).map(site => site.name).filter(Boolean);
        if (siteNames.length > 0) params.set('sites', siteNames.join(','));
        const iframeUrl = chrome.runtime.getURL(`iframe/iframe.html?${params.toString()}`);
        await chrome.tabs.create({ url: iframeUrl, active: true });
        setTimeout(async () => {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tabs.length > 0 && tabs[0].url && tabs[0].url.includes('iframe.html')) {
                try {
                    await chrome.tabs.sendMessage(tabs[0].id, {
                        type: 'loadHistoryIframes',
                        sites: item.sites || []
                    });
                } catch (err) {}
            }
        }, 1000);
    } catch (error) {
        console.error('打开收藏记录失败:', error);
    }
}

// 初始化操作链接
async function initializeActionLinks() {
    try {
        // 加载配置
        const config = await AppConfigManager.loadConfig();
        const externalLinks = config.externalLinks || {};
        
        // 历史记录链接
        const historyLink = document.getElementById('historyLink');
        if (historyLink) {
            historyLink.addEventListener('click', (e) => {
                e.preventDefault();
                trackEvent('homepage_history_click');
                chrome.tabs.create({ 
                    url: chrome.runtime.getURL('history/history.html')
                });
            });
        }
        
        // 收藏记录链接
        const favoritesLink = document.getElementById('favoritesLink');
        if (favoritesLink) {
            favoritesLink.addEventListener('click', (e) => {
                e.preventDefault();
                trackEvent('homepage_favorites_click');
                chrome.tabs.create({ 
                    url: chrome.runtime.getURL('favorites/favorites.html')
                });
            });
        }
        
        // 设置链接
        const settingsLink = document.getElementById('settingsLink');
        if (settingsLink) {
            settingsLink.addEventListener('click', (e) => {
                e.preventDefault();
                trackEvent('homepage_settings_click');
                // 在当前页面跳转到设置页面
                window.location.href = chrome.runtime.getURL('options/options.html');
            });
        }
        
        // 用户反馈链接：悬停立即显示邮箱，点击打开本地邮件客户端
        const feedbackLink = document.getElementById('feedbackLink');
        const feedbackEmailTooltip = document.getElementById('feedbackEmailTooltip');
        if (feedbackLink && feedbackEmailTooltip) {
            const feedbackEmail = externalLinks.feedbackEmail || 'AIShortcuts@outlook.com';
            feedbackLink.href = 'mailto:' + feedbackEmail;
            feedbackEmailTooltip.textContent = feedbackEmail;
            feedbackLink.addEventListener('click', () => {
                trackEvent('homepage_feedback_click', { feedback_email: feedbackEmail });
            });
        }
        
        // 五星好评链接
        const reviewLink = document.getElementById('reviewLink');
        if (reviewLink) {
            reviewLink.addEventListener('click', (e) => {
                e.preventDefault();
                // 从配置中获取评价链接
                const reviewUrl = externalLinks.reviewLink || 
                    'https://chromewebstore.google.com/detail/ai-compare-oneclick-to-co/dkhpgbbhlnmjbkihoeniojpkggkabbbl/reviews';
                trackEvent('homepage_review_click', {
                    has_review_link: Boolean(externalLinks.reviewLink)
                });
                chrome.tabs.create({ url: reviewUrl });
            });
        }
        
        // 微信链接：点击弹窗显示微信号
        bindWechatLink();
        // 请我喝咖啡链接：点击弹窗显示图片
        bindCoffeeLink();
    } catch (error) {
        console.error('加载配置失败:', error);
        // 如果配置加载失败，使用默认链接
        const historyLink = document.getElementById('historyLink');
        if (historyLink) {
            historyLink.addEventListener('click', (e) => {
                e.preventDefault();
                chrome.tabs.create({ 
                    url: chrome.runtime.getURL('history/history.html')
                });
            });
        }
        
        const favoritesLink = document.getElementById('favoritesLink');
        if (favoritesLink) {
            favoritesLink.addEventListener('click', (e) => {
                e.preventDefault();
                chrome.tabs.create({ 
                    url: chrome.runtime.getURL('favorites/favorites.html')
                });
            });
        }
        
        const settingsLink = document.getElementById('settingsLink');
        if (settingsLink) {
            settingsLink.addEventListener('click', (e) => {
                e.preventDefault();
                // 在当前页面跳转到设置页面
                window.location.href = chrome.runtime.getURL('options/options.html');
            });
        }
        
        const feedbackLink = document.getElementById('feedbackLink');
        const feedbackEmailTooltip = document.getElementById('feedbackEmailTooltip');
        if (feedbackLink && feedbackEmailTooltip) {
            const feedbackEmail = 'AIShortcuts@outlook.com';
            feedbackLink.href = 'mailto:' + feedbackEmail;
            feedbackEmailTooltip.textContent = feedbackEmail;
        }
        
        const reviewLink = document.getElementById('reviewLink');
        if (reviewLink) {
            reviewLink.addEventListener('click', (e) => {
                e.preventDefault();
                chrome.tabs.create({ 
                    url: 'https://chromewebstore.google.com/detail/ai-compare-oneclick-to-co/dkhpgbbhlnmjbkihoeniojpkggkabbbl/reviews'
                });
            });
        }
        
        bindWechatLink();
        bindCoffeeLink();
    }
}

// 绑定请我喝咖啡链接：点击弹窗显示 icons/wechatMoney.jpg
function bindCoffeeLink() {
    const coffeeLink = document.getElementById('coffeeLink');
    const coffeeModal = document.getElementById('coffeeModal');
    const coffeeModalImage = document.getElementById('coffeeModalImage');
    const coffeeModalClose = document.getElementById('coffeeModalClose');
    const coffeeModalOverlay = coffeeModal?.querySelector('.coffee-modal-overlay');
    
    if (!coffeeLink || !coffeeModal || !coffeeModalImage) return;
    
    coffeeModalImage.src = chrome.runtime.getURL('icons/weichatMoney.jpg');
    
    coffeeLink.addEventListener('click', (e) => {
        e.preventDefault();
        coffeeModal.style.display = 'flex';
    });
    
    function closeCoffeeModal() {
        coffeeModal.style.display = 'none';
    }
    
    if (coffeeModalClose) {
        coffeeModalClose.addEventListener('click', closeCoffeeModal);
    }
    if (coffeeModalOverlay) {
        coffeeModalOverlay.addEventListener('click', closeCoffeeModal);
    }
}

// 绑定微信链接：点击弹窗显示微信号 aipmgpt
function bindWechatLink() {
    const wechatLink = document.getElementById('wechatLink');
    const wechatModal = document.getElementById('wechatModal');
    const wechatModalClose = document.getElementById('wechatModalClose');
    const wechatModalOverlay = wechatModal?.querySelector('.wechat-modal-overlay');
    
    if (!wechatLink || !wechatModal) return;
    
    wechatLink.addEventListener('click', (e) => {
        e.preventDefault();
        wechatModal.style.display = 'flex';
    });
    
    function closeWechatModal() {
        wechatModal.style.display = 'none';
    }
    
    if (wechatModalClose) {
        wechatModalClose.addEventListener('click', closeWechatModal);
    }
    if (wechatModalOverlay) {
        wechatModalOverlay.addEventListener('click', closeWechatModal);
    }
}

// Toast 提示函数
function showToast(message, duration = 2000) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 12px 24px;
        border-radius: 8px;
        z-index: 10000;
        font-size: 14px;
        animation: slideInUp 0.3s ease-out;
    `;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideInUp 0.3s ease-out reverse';
        setTimeout(() => {
            if (toast.parentElement) {
                toast.remove();
            }
        }, 300);
    }, duration);
}
