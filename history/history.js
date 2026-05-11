// 存储所有历史记录数据
let allHistoryItems = [];

function t(key, fallback = '') {
    return chrome?.i18n?.getMessage?.(key) || fallback;
}

function initializeI18n() {
    document.title = t('historyLink', 'History');

    document.querySelectorAll('[data-i18n]').forEach((element) => {
        const key = element.getAttribute('data-i18n');
        const message = t(key);
        if (message) {
            element.textContent = message;
        }
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
        const key = element.getAttribute('data-i18n-placeholder');
        const message = t(key);
        if (message) {
            element.placeholder = message;
        }
    });
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', async () => {
    initializeI18n();
    if (typeof window.migrateLegacyFavorites === 'function') await window.migrateLegacyFavorites();
    const historyList = document.getElementById('historyList');
    if (historyList && window.SiteUrlTooltip?.attachUrlTooltip) {
        window.SiteUrlTooltip.attachUrlTooltip(historyList);
    }
    await loadHistory();
    
    // 绑定清空历史按钮事件
    const clearBtn = document.getElementById('clearHistoryBtn');
    clearBtn.addEventListener('click', async () => {
        if (confirm(t('clearHistoryConfirm', 'Are you sure you want to clear all history records?'))) {
            await clearHistory();
            await loadHistory();
        }
    });
    
    // 绑定搜索输入框事件
    const searchInput = document.getElementById('searchInput');
    searchInput.addEventListener('input', (e) => {
        filterHistory(e.target.value);
    });
});

// 加载历史记录
async function loadHistory() {
    try {
        const { pkHistory = [] } = await chrome.storage.local.get('pkHistory');
        
        // 保存所有历史记录
        allHistoryItems = pkHistory;
        
        const historyList = document.getElementById('historyList');
        const emptyState = document.getElementById('emptyState');
        const noResultsState = document.getElementById('noResultsState');
        const searchInput = document.getElementById('searchInput');
        
        // 获取当前搜索关键词
        const searchTerm = searchInput ? searchInput.value.trim().toLowerCase() : '';
        
        // 根据搜索关键词过滤
        const filteredItems = filterItemsBySearch(pkHistory, searchTerm);
        
        if (pkHistory.length === 0) {
            historyList.style.display = 'none';
            emptyState.style.display = 'block';
            noResultsState.style.display = 'none';
            return;
        }
        
        if (filteredItems.length === 0 && searchTerm) {
            historyList.style.display = 'none';
            emptyState.style.display = 'none';
            noResultsState.style.display = 'block';
            return;
        }
        
        historyList.style.display = 'flex';
        emptyState.style.display = 'none';
        noResultsState.style.display = 'none';
        
        // 清空现有内容
        historyList.innerHTML = '';
        
        // 渲染历史记录
        filteredItems.forEach(item => {
            const historyItem = createHistoryItem(item);
            historyList.appendChild(historyItem);
        });
        
    } catch (error) {
        console.error('加载历史记录失败:', error);
    }
}

// 根据搜索关键词过滤历史记录
function filterItemsBySearch(items, searchTerm) {
    if (!searchTerm) {
        return items;
    }
    
    return items.filter(item => {
        // 搜索查询关键词
        const queryMatch = item.query && item.query.toLowerCase().includes(searchTerm);
        
        // 搜索站点名称
        const siteMatch = item.sites && item.sites.some(site => 
            site.name && site.name.toLowerCase().includes(searchTerm)
        );
        
        return queryMatch || siteMatch;
    });
}

// 过滤历史记录
function filterHistory(searchTerm) {
    const filteredItems = filterItemsBySearch(allHistoryItems, searchTerm.toLowerCase());
    
    const historyList = document.getElementById('historyList');
    const emptyState = document.getElementById('emptyState');
    const noResultsState = document.getElementById('noResultsState');
    
    if (allHistoryItems.length === 0) {
        historyList.style.display = 'none';
        emptyState.style.display = 'block';
        noResultsState.style.display = 'none';
        return;
    }
    
    if (filteredItems.length === 0 && searchTerm.trim()) {
        historyList.style.display = 'none';
        emptyState.style.display = 'none';
        noResultsState.style.display = 'block';
        return;
    }
    
    historyList.style.display = 'flex';
    emptyState.style.display = 'none';
    noResultsState.style.display = 'none';
    
    // 清空现有内容
    historyList.innerHTML = '';
    
    // 渲染过滤后的历史记录
    filteredItems.forEach(item => {
        const historyItem = createHistoryItem(item);
        historyList.appendChild(historyItem);
    });
}

// 创建历史记录项
function createHistoryItem(item) {
    const div = document.createElement('div');
    div.className = 'history-item';

    // 兼容旧数据：确保 isFavorite 字段存在
    if (item.sites) {
        item.sites.forEach(site => {
            if (site.isFavorite === undefined) {
                site.isFavorite = false;
            }
        });
    }
    
    // 创建头部
    const header = document.createElement('div');
    header.className = 'history-item-header';
    
    const queryDiv = document.createElement('div');
    queryDiv.className = 'history-query';
    queryDiv.textContent = item.query;
    
    const dateDiv = document.createElement('div');
    dateDiv.className = 'history-date';
    dateDiv.textContent = item.date || formatDate(item.timestamp);
    
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'history-item-actions';
    
    const favoriteBtn = document.createElement('button');
    favoriteBtn.className = 'favorite-btn';
    favoriteBtn.type = 'button';
    favoriteBtn.setAttribute('aria-label', t('addToFavorites', 'Favorite'));
    const favoriteIcon = document.createElement('img');
    favoriteIcon.alt = '';
    favoriteBtn.appendChild(favoriteIcon);
    setFavoriteButtonState(favoriteBtn, isItemFavorited(item));
    favoriteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (typeof window.showFavoriteFolderModal !== 'function') return;
        const result = await window.showFavoriteFolderModal();
        if (!result) return;
        const shouldFavorite = result.action !== 'remove';
        const folderId = result.folderId || null;
        const updatedItem = await toggleHistoryItemFavorite(item.id, shouldFavorite, folderId);
        if (updatedItem) {
            item.sites = updatedItem.sites;
            setFavoriteButtonState(favoriteBtn, isItemFavorited(updatedItem));
        }
    });
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.type = 'button';
    const deleteLabel = t('deleteButton', 'Delete');
    deleteBtn.setAttribute('aria-label', deleteLabel);
    deleteBtn.title = deleteLabel;
    const deleteIcon = document.createElement('img');
    deleteIcon.alt = '';
    deleteIcon.src = '../icons/trash.svg';
    deleteBtn.appendChild(deleteIcon);
    deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm(t('deleteHistoryConfirm', 'Are you sure you want to delete this history record?'))) {
            await deleteHistoryItem(item.id);
            await loadHistory();
        }
    });
    
    actionsDiv.appendChild(deleteBtn);
    actionsDiv.appendChild(favoriteBtn);
    
    header.appendChild(queryDiv);
    header.appendChild(dateDiv);
    header.appendChild(actionsDiv);
    
    // 创建站点标签
    const sitesDiv = document.createElement('div');
    sitesDiv.className = 'history-sites';
    
    item.sites.forEach(site => {
        const tag = document.createElement('span');
        tag.className = 'site-tag';
        const siteUrl = String(site.url || '').trim();
        if (siteUrl) {
            tag.dataset.url = siteUrl;
            tag.title = siteUrl;
        }
        if (site.isFavorite === true) {
            tag.classList.add('favorite-tag');
        }
        tag.textContent = site.name;
        sitesDiv.appendChild(tag);
    });
    
    // 组装元素
    div.appendChild(header);
    div.appendChild(sitesDiv);
    
    // 点击历史记录项时打开对应的站点
    div.addEventListener('click', (e) => {
        // 如果点击的是删除按钮，不触发打开操作
        if (e.target === deleteBtn || deleteBtn.contains(e.target)) {
            return;
        }
        
        openHistoryItem(item);
    });
    
    return div;
}

// 判断历史记录是否已全部收藏
function isItemFavorited(item) {
    if (!item.sites || item.sites.length === 0) {
        return false;
    }
    return item.sites.every(site => site.isFavorite === true);
}

// 更新收藏按钮状态
function setFavoriteButtonState(btn, isFavorited) {
    const icon = btn.querySelector('img');
    if (icon) {
        icon.src = isFavorited ? '../icons/star_saved.svg' : '../icons/star_unsaved.svg';
    }
    btn.dataset.favorite = isFavorited ? 'true' : 'false';
    const favoriteLabel = isFavorited
        ? t('removeFromFavorites', 'Unfavorite')
        : t('addToFavorites', 'Favorite');
    btn.title = favoriteLabel;
    btn.setAttribute('aria-label', favoriteLabel);
    btn.setAttribute('aria-pressed', isFavorited ? 'true' : 'false');
}

// 打开历史记录项
async function openHistoryItem(item) {
    try {
        // 构建 URL 参数
        const params = new URLSearchParams();
        params.set('query', item.query);
        
        // 构建站点名称列表
        const siteNames = item.sites.map(site => site.name);
        if (siteNames.length > 0) {
            params.set('sites', siteNames.join(','));
        }
        if (item.id) params.set('historyId', item.id);
        
        // 构建 iframe.html 的 URL
        const iframeUrl = chrome.runtime.getURL(`iframe/iframe.html?${params.toString()}`);
        
        // 打开新标签页
        const newTab = await chrome.tabs.create({
            url: iframeUrl,
            active: true
        });

        // 现代记录会在 iframe.html 首屏直接根据 historyId 自恢复。
        // 仅对缺少 historyId 的旧记录保留消息兜底，并使用目标 tabId + onUpdated 避免发错标签页。
        if (!item.id && newTab?.id) {
            chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
                if (tabId !== newTab.id || changeInfo.status !== 'complete') {
                    return;
                }

                chrome.tabs.onUpdated.removeListener(listener);
                chrome.tabs.sendMessage(newTab.id, {
                    type: 'loadHistoryIframes',
                    sites: item.sites,
                    historyId: item.id || null
                }).catch((error) => {
                    console.error('发送历史记录恢复消息失败:', error);
                });
            });
        }
        
    } catch (error) {
        console.error('打开历史记录失败:', error);
        alert('打开历史记录失败，请重试');
    }
}

// 删除单条历史记录
async function deleteHistoryItem(id) {
    try {
        const { pkHistory = [] } = await chrome.storage.local.get('pkHistory');
        const updatedHistory = pkHistory.filter(item => item.id !== id);
        await chrome.storage.local.set({ pkHistory: updatedHistory });
        if (typeof window.firebaseSyncUploadIfLoggedIn === 'function') window.firebaseSyncUploadIfLoggedIn();
        // 更新存储的所有历史记录
        allHistoryItems = updatedHistory;
    } catch (error) {
        console.error('删除历史记录失败:', error);
    }
}

// 收藏或取消收藏单条历史记录（对该记录中所有站点生效）
async function toggleHistoryItemFavorite(id, shouldFavorite, folderId) {
    try {
        const { pkHistory = [] } = await chrome.storage.local.get('pkHistory');
        const historyIndex = pkHistory.findIndex(item => item.id === id);
        if (historyIndex === -1) {
            console.warn('未找到历史记录');
            return null;
        }
        const historyItem = pkHistory[historyIndex];
        if (historyItem.sites) {
            historyItem.sites.forEach(site => {
                site.isFavorite = shouldFavorite;
                if (shouldFavorite && folderId) {
                    site.favoriteFolder = folderId;
                } else if (!shouldFavorite) {
                    delete site.favoriteFolder;
                }
            });
        }
        await chrome.storage.local.set({ pkHistory: pkHistory });
        if (typeof window.firebaseSyncUploadIfLoggedIn === 'function') window.firebaseSyncUploadIfLoggedIn();
        const localIndex = allHistoryItems.findIndex(item => item.id === id);
        if (localIndex !== -1) {
            allHistoryItems[localIndex] = historyItem;
        }
        return historyItem;
    } catch (error) {
        console.error('更新收藏状态失败:', error);
        return null;
    }
}

// 清空所有历史记录
async function clearHistory() {
    try {
        await chrome.storage.local.set({ pkHistory: [] });
        if (typeof window.firebaseSyncUploadIfLoggedIn === 'function') window.firebaseSyncUploadIfLoggedIn();
    } catch (error) {
        console.error('清空历史记录失败:', error);
    }
}

// 格式化日期
function formatDate(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}
