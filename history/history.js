// 存储所有历史记录数据
let allHistoryItems = [];

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', async () => {
    await loadHistory();
    
    // 绑定清空历史按钮事件
    const clearBtn = document.getElementById('clearHistoryBtn');
    clearBtn.addEventListener('click', async () => {
        if (confirm('确定要清空所有历史记录吗？')) {
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
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm('确定要删除这条历史记录吗？')) {
            await deleteHistoryItem(item.id);
            await loadHistory();
        }
    });
    
    actionsDiv.appendChild(deleteBtn);
    
    header.appendChild(queryDiv);
    header.appendChild(dateDiv);
    header.appendChild(actionsDiv);
    
    // 创建站点标签
    const sitesDiv = document.createElement('div');
    sitesDiv.className = 'history-sites';
    
    item.sites.forEach(site => {
        const tag = document.createElement('span');
        tag.className = 'site-tag';
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
        
        // 构建 iframe.html 的 URL
        const iframeUrl = chrome.runtime.getURL(`iframe/iframe.html?${params.toString()}`);
        
        // 打开新标签页
        await chrome.tabs.create({
            url: iframeUrl,
            active: true
        });
        
        // 等待标签页加载完成后，需要设置每个 iframe 的 URL
        // 由于 iframe.html 会根据 sites 参数创建 iframe，但我们需要使用历史记录中的具体 URL
        // 所以我们需要通过消息传递来设置每个 iframe 的 URL
        setTimeout(async () => {
            // 获取当前窗口的所有标签页
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tabs.length > 0) {
                const currentTab = tabs[0];
                if (currentTab.url && currentTab.url.includes('iframe.html')) {
                    // 发送消息到 iframe.html，设置每个 iframe 的 URL
                    try {
                        await chrome.tabs.sendMessage(currentTab.id, {
                            type: 'loadHistoryIframes',
                            sites: item.sites,
                            historyId: item.id  // 传递历史记录 ID
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
