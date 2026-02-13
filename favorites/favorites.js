// 存储所有收藏记录数据
let allFavoriteItems = [];

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', async () => {
    await loadFavorites();
    
    // 绑定清空收藏按钮事件
    const clearBtn = document.getElementById('clearFavoritesBtn');
    clearBtn.addEventListener('click', async () => {
        if (confirm('确定要清空所有收藏记录吗？')) {
            await clearAllFavorites();
            await loadFavorites();
        }
    });
    
    // 绑定搜索输入框事件
    const searchInput = document.getElementById('searchInput');
    searchInput.addEventListener('input', (e) => {
        filterFavorites(e.target.value);
    });
});

// 加载收藏记录（从历史记录中筛选包含收藏站点的记录）
async function loadFavorites() {
    try {
        const { pkHistory = [] } = await chrome.storage.local.get('pkHistory');
        
        // 筛选包含收藏站点的历史记录，且每条记录的 sites 仅保留 isFavorite === true 的站点
        const favoriteItems = pkHistory
            .filter(item => item.sites && item.sites.some(site => site.isFavorite === true))
            .map(item => ({
                ...item,
                sites: item.sites.filter(site => site.isFavorite === true)
            }));
        
        // 保存所有收藏记录
        allFavoriteItems = favoriteItems;
        
        const favoritesList = document.getElementById('favoritesList');
        const emptyState = document.getElementById('emptyState');
        const noResultsState = document.getElementById('noResultsState');
        const searchInput = document.getElementById('searchInput');
        
        // 获取当前搜索关键词
        const searchTerm = searchInput ? searchInput.value.trim().toLowerCase() : '';
        
        // 根据搜索关键词过滤
        const filteredItems = filterItemsBySearch(favoriteItems, searchTerm);
        
        if (favoriteItems.length === 0) {
            favoritesList.style.display = 'none';
            emptyState.style.display = 'block';
            noResultsState.style.display = 'none';
            return;
        }
        
        if (filteredItems.length === 0 && searchTerm) {
            favoritesList.style.display = 'none';
            emptyState.style.display = 'none';
            noResultsState.style.display = 'block';
            return;
        }
        
        favoritesList.style.display = 'flex';
        emptyState.style.display = 'none';
        noResultsState.style.display = 'none';
        
        // 清空现有内容
        favoritesList.innerHTML = '';
        
        // 渲染收藏记录
        filteredItems.forEach(item => {
            const favoriteItem = createFavoriteItem(item);
            favoritesList.appendChild(favoriteItem);
        });
        
    } catch (error) {
        console.error('加载收藏记录失败:', error);
    }
}

// 根据搜索关键词过滤收藏记录
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

// 过滤收藏记录
function filterFavorites(searchTerm) {
    const filteredItems = filterItemsBySearch(allFavoriteItems, searchTerm.toLowerCase());
    
    const favoritesList = document.getElementById('favoritesList');
    const emptyState = document.getElementById('emptyState');
    const noResultsState = document.getElementById('noResultsState');
    
    if (allFavoriteItems.length === 0) {
        favoritesList.style.display = 'none';
        emptyState.style.display = 'block';
        noResultsState.style.display = 'none';
        return;
    }
    
    if (filteredItems.length === 0 && searchTerm.trim()) {
        favoritesList.style.display = 'none';
        emptyState.style.display = 'none';
        noResultsState.style.display = 'block';
        return;
    }
    
    favoritesList.style.display = 'flex';
    emptyState.style.display = 'none';
    noResultsState.style.display = 'none';
    
    // 清空现有内容
    favoritesList.innerHTML = '';
    
    // 渲染过滤后的收藏记录
    filteredItems.forEach(item => {
        const favoriteItem = createFavoriteItem(item);
        favoritesList.appendChild(favoriteItem);
    });
}

// 创建收藏记录项
function createFavoriteItem(item) {
    const div = document.createElement('div');
    div.className = 'favorite-item';
    
    // 创建头部
    const header = document.createElement('div');
    header.className = 'favorite-item-header';
    
    const queryDiv = document.createElement('div');
    queryDiv.className = 'favorite-query';
    queryDiv.textContent = item.query;
    
    const dateDiv = document.createElement('div');
    dateDiv.className = 'favorite-date';
    dateDiv.textContent = item.date || formatDate(item.timestamp);
    
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'favorite-item-actions';
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.type = 'button';
    deleteBtn.setAttribute('aria-label', '删除');
    const deleteIcon = document.createElement('img');
    deleteIcon.alt = '';
    deleteIcon.src = '../icons/trash.svg';
    deleteBtn.appendChild(deleteIcon);
    deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm('确定要删除这条收藏记录吗？')) {
            await deleteFavoriteItem(item.id);
            await loadFavorites();
        }
    });
    
    actionsDiv.appendChild(deleteBtn);
    
    header.appendChild(queryDiv);
    header.appendChild(dateDiv);
    header.appendChild(actionsDiv);
    
    // 创建站点标签（item.sites 已仅含 isFavorite === true 的站点）
    const sitesDiv = document.createElement('div');
    sitesDiv.className = 'favorite-sites';
    
    item.sites.forEach(site => {
        const tag = document.createElement('span');
        tag.className = 'site-tag favorite-tag';
        tag.textContent = site.name;
        sitesDiv.appendChild(tag);
    });
    
    // 组装元素
    div.appendChild(header);
    div.appendChild(sitesDiv);
    
    // 点击收藏记录项时打开对应的站点
    div.addEventListener('click', (e) => {
        // 如果点击的是删除按钮，不触发打开操作
        if (e.target === deleteBtn || deleteBtn.contains(e.target)) {
            return;
        }
        
        openFavoriteItem(item);
    });
    
    return div;
}

// 打开收藏记录项
async function openFavoriteItem(item) {
    try {
        // 构建 URL 参数
        const params = new URLSearchParams();
        params.set('query', item.query);
        
        // item.sites 已仅含 isFavorite === true 的站点
        const siteNames = item.sites.map(site => site.name);
        if (siteNames.length > 0) {
            params.set('sites', siteNames.join(','));
        }
        
        // 构建 iframe.html 的 URL
        const iframeUrl = chrome.runtime.getURL(`iframe/iframe.html?${params.toString()}`);
        
        // 打开新标签页
        await chrome.tabs.create({
            url: iframeUrl,
            active: true
        });
        
        // 等待标签页加载完成后，需要设置每个 iframe 的 URL
        setTimeout(async () => {
            // 获取当前窗口的所有标签页
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tabs.length > 0) {
                const currentTab = tabs[0];
                if (currentTab.url && currentTab.url.includes('iframe.html')) {
                    // 发送消息到 iframe.html，设置每个 iframe 的 URL（item.sites 仅含收藏站点）
                    try {
                        await chrome.tabs.sendMessage(currentTab.id, {
                            type: 'loadHistoryIframes',
                            sites: item.sites
                        });
                    } catch (error) {
                        console.error('发送消息失败:', error);
                        // 如果消息发送失败，可能是因为页面还没有完全加载
                        // 这种情况下，iframe.html 会根据 query 和 sites 参数自动创建 iframe
                    }
                }
            }
        }, 1000);
        
    } catch (error) {
        console.error('打开收藏记录失败:', error);
        alert('打开收藏记录失败，请重试');
    }
}

// 删除单条收藏记录（取消该记录中所有站点的收藏状态）
async function deleteFavoriteItem(id) {
    try {
        const { pkHistory = [] } = await chrome.storage.local.get('pkHistory');
        const historyIndex = pkHistory.findIndex(item => item.id === id);
        
        if (historyIndex === -1) {
            console.warn('未找到历史记录');
            return;
        }
        
        // 取消该记录中所有站点的收藏状态
        const historyItem = pkHistory[historyIndex];
        if (historyItem.sites) {
            historyItem.sites.forEach(site => {
                site.isFavorite = false;
            });
        }
        
        await chrome.storage.local.set({ pkHistory: pkHistory });
        if (typeof window.firebaseSyncUploadIfLoggedIn === 'function') window.firebaseSyncUploadIfLoggedIn();
        // 重新加载收藏记录以更新 allFavoriteItems
        await loadFavorites();
    } catch (error) {
        console.error('删除收藏记录失败:', error);
    }
}

// 清空所有收藏记录（取消所有历史记录中站点的收藏状态）
async function clearAllFavorites() {
    try {
        const { pkHistory = [] } = await chrome.storage.local.get('pkHistory');
        
        // 取消所有历史记录中站点的收藏状态
        pkHistory.forEach(item => {
            if (item.sites) {
                item.sites.forEach(site => {
                    site.isFavorite = false;
                });
            }
        });
        
        await chrome.storage.local.set({ pkHistory: pkHistory });
        if (typeof window.firebaseSyncUploadIfLoggedIn === 'function') window.firebaseSyncUploadIfLoggedIn();
    } catch (error) {
        console.error('清空收藏记录失败:', error);
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
