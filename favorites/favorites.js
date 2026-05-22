let allFavoriteItems = [];
let currentFolderId = null; // null = all
let siteUrlFallbackMap = new Map();
const HybridFavorites = window.AICompareHybridFavorites || {};

function t(key, fallback = '') {
    return window.RuntimeI18n?.getMessage?.(key) || chrome?.i18n?.getMessage?.(key) || fallback;
}

function initializeI18n() {
    document.title = t('favoritesLink', 'Favorites');

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

document.addEventListener('DOMContentLoaded', async () => {
    if (window.RuntimeI18n?.initializeRuntimeI18n) {
        await window.RuntimeI18n.initializeRuntimeI18n();
    }

    initializeI18n();
    if (typeof window.migrateLegacyFavorites === 'function') await window.migrateLegacyFavorites();
    siteUrlFallbackMap = await loadSiteUrlFallbackMap();
    const favoritesList = document.getElementById('favoritesList');
    if (favoritesList && window.SiteUrlTooltip?.attachUrlTooltip) {
        window.SiteUrlTooltip.attachUrlTooltip(favoritesList);
    }
    await renderFolderTabs();
    await loadFavorites();

    document.getElementById('clearFavoritesBtn').addEventListener('click', async () => {
        if (confirm(t('clearFavoritesConfirm', 'Are you sure you want to clear all favorite records?'))) {
            await clearAllFavorites();
            await loadFavorites();
        }
    });

    document.getElementById('searchInput').addEventListener('input', (e) => {
        filterFavorites(e.target.value);
    });
});

async function loadSiteUrlFallbackMap() {
    try {
        if (typeof window.getDefaultSites !== 'function') {
            return new Map();
        }

        const sites = await window.getDefaultSites();
        const map = new Map();
        (Array.isArray(sites) ? sites : []).forEach((site) => {
            const name = String(site?.name || '').trim();
            const url = String(site?.url || '').trim();
            if (name && url && !map.has(name)) {
                map.set(name, url);
            }
        });
        return map;
    } catch (error) {
        console.warn('加载站点 URL 兜底映射失败:', error);
        return new Map();
    }
}

// ─── Folder tabs ───

async function renderFolderTabs() {
    const container = document.getElementById('folderTabsContainer');
    if (!container) return;

    const folders = typeof window.ensureDefaultFolder === 'function'
        ? await window.ensureDefaultFolder()
        : [];
    const counts = await getFolderCounts();
    let totalCount = 0;
    Object.values(counts).forEach(c => totalCount += c);

    container.innerHTML = '';

    // "All" tab
    const allTab = createTabEl(null, t('favFolderAll', '全部'), totalCount);
    container.appendChild(allTab);

    // Per-folder tabs
    folders.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
    folders.forEach(f => {
        const tab = createTabEl(f.id, f.name, counts[f.id] || 0);
        container.appendChild(tab);
    });

    // Manage button
    const manageBtn = document.createElement('button');
    manageBtn.className = 'folder-manage-btn';
    manageBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5.8 1.3l-.6 1.2-.3.1-1.2-.4-.9.9.4 1.2-.1.3-1.2.6v1.3l1.2.6.1.3-.4 1.2.9.9 1.2-.4.3.1.6 1.2h1.3l.6-1.2.3-.1 1.2.4.9-.9-.4-1.2.1-.3 1.2-.6V5.5l-1.2-.6-.1-.3.4-1.2-.9-.9-1.2.4-.3-.1-.6-1.2H5.8z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/><circle cx="6.5" cy="6.2" r="1.5" stroke="currentColor" stroke-width="1.1"/></svg> ${t('favFolderManage', '管理文件夹')}`;
    manageBtn.addEventListener('click', () => showFolderManageModal());
    container.appendChild(manageBtn);
}

function createTabEl(folderId, name, count) {
    const tab = document.createElement('button');
    tab.className = 'folder-tab' + ((folderId === currentFolderId) ? ' active' : '');
    const nameSpan = document.createElement('span');
    nameSpan.textContent = name;
    tab.appendChild(nameSpan);
    if (count > 0) {
        const countSpan = document.createElement('span');
        countSpan.className = 'folder-tab-count';
        countSpan.textContent = count;
        tab.appendChild(countSpan);
    }
    tab.addEventListener('click', async () => {
        currentFolderId = folderId;
        await renderFolderTabs();
        await loadFavorites();
    });
    return tab;
}

async function getFolderCounts() {
    const { pkHistory = [] } = await chrome.storage.local.get('pkHistory');
    const counts = {};
    pkHistory.forEach(item => {
        if (!item.sites) return;
        const seen = new Set();
        item.sites.forEach(site => {
            if (site.isFavorite) {
                const fid = site.favoriteFolder || 'default';
                if (!seen.has(fid)) {
                    counts[fid] = (counts[fid] || 0) + 1;
                    seen.add(fid);
                }
            }
        });
    });
    const hybridCounts = typeof HybridFavorites.getFavoriteFolderCounts === 'function'
        ? await HybridFavorites.getFavoriteFolderCounts()
        : {};
    Object.entries(hybridCounts).forEach(([folderId, count]) => {
        counts[folderId] = (counts[folderId] || 0) + (Number(count) || 0);
    });
    return counts;
}

// ─── Load & display favorites ───

async function loadFavorites() {
    try {
        const { pkHistory = [] } = await chrome.storage.local.get('pkHistory');
        const folders = typeof window.getFavoriteFolders === 'function'
            ? await window.getFavoriteFolders() : [];
        const folderMap = {};
        folders.forEach(f => folderMap[f.id] = f.name);

        let favoriteItems = pkHistory
            .filter(item => item.sites && item.sites.some(s => s.isFavorite))
            .map(item => ({
                ...item,
                sites: item.sites.filter(s => s.isFavorite)
            }));
        const hybridFavoriteItems = typeof HybridFavorites.listFavoritedHybridSessions === 'function'
            ? await HybridFavorites.listFavoritedHybridSessions({ limit: 500 })
            : [];
        favoriteItems = [...hybridFavoriteItems, ...favoriteItems]
            .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));

        // Filter by current folder
        if (currentFolderId !== null) {
            favoriteItems = favoriteItems
                .map(item => ({
                    ...item,
                    sites: item.sites.filter(s => (s.favoriteFolder || 'default') === currentFolderId)
                }))
                .filter(item => item.sites.length > 0);
        }

        allFavoriteItems = favoriteItems;

        const favoritesList = document.getElementById('favoritesList');
        const emptyState = document.getElementById('emptyState');
        const noResultsState = document.getElementById('noResultsState');
        const searchInput = document.getElementById('searchInput');
        const searchTerm = searchInput ? searchInput.value.trim().toLowerCase() : '';
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
        favoritesList.innerHTML = '';

        filteredItems.forEach(item => {
            favoritesList.appendChild(createFavoriteItem(item, folderMap));
        });
    } catch (error) {
        console.error('加载收藏记录失败:', error);
    }
}

function filterItemsBySearch(items, searchTerm) {
    if (!searchTerm) return items;
    return items.filter(item => {
        const queryMatch = item.query && item.query.toLowerCase().includes(searchTerm);
        const siteMatch = item.sites && item.sites.some(s =>
            s.name && s.name.toLowerCase().includes(searchTerm)
        );
        return queryMatch || siteMatch;
    });
}

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
    favoritesList.innerHTML = '';

    const folders = {};
    filteredItems.forEach(item => {
        favoritesList.appendChild(createFavoriteItem(item, folders));
    });
}

function createFavoriteItem(item, folderMap) {
    const div = document.createElement('div');
    div.className = 'favorite-item';

    const header = document.createElement('div');
    header.className = 'favorite-item-header';

    const queryDiv = document.createElement('div');
    queryDiv.className = 'favorite-query';
    queryDiv.textContent = item.query;

    // Show folder badge (use the first site's folder when in "All" view)
    if (currentFolderId === null && item.sites.length > 0) {
        const fid = item.sites[0].favoriteFolder || 'default';
        const fname = folderMap[fid] || fid;
        if (fname) {
            const badge = document.createElement('span');
            badge.className = 'favorite-folder-badge';
            badge.textContent = fname;
            queryDiv.appendChild(badge);
        }
    }

    const dateDiv = document.createElement('div');
    dateDiv.className = 'favorite-date';
    dateDiv.textContent = item.date || formatDate(item.timestamp);

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'favorite-item-actions';

    const favoriteBtn = document.createElement('button');
    favoriteBtn.className = 'favorite-btn';
    favoriteBtn.type = 'button';
    const manageFavoriteLabel = t('manageFavoriteItem', 'Manage favorite');
    favoriteBtn.setAttribute('aria-label', manageFavoriteLabel);
    favoriteBtn.title = manageFavoriteLabel;
    const favoriteIcon = document.createElement('img');
    favoriteIcon.alt = '';
    favoriteIcon.src = '../icons/star_saved.svg';
    favoriteBtn.appendChild(favoriteIcon);
    favoriteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (typeof window.showFavoriteFolderModal !== 'function') return;
        const currentFolder = item.sites[0]?.favoriteFolder || 'default';
        const result = await window.showFavoriteFolderModal({ defaultFolderId: currentFolder });
        if (!result) return;
        if (result.action === 'remove') {
            await deleteFavoriteItem(item.id);
        } else {
            await moveFavoriteItemToFolder(item.id, result.folderId);
        }
        await renderFolderTabs();
        await loadFavorites();
    });

    actionsDiv.appendChild(favoriteBtn);

    header.appendChild(queryDiv);
    header.appendChild(dateDiv);
    header.appendChild(actionsDiv);

    const sitesDiv = document.createElement('div');
    sitesDiv.className = 'favorite-sites';
    item.sites.forEach(site => {
        const tag = document.createElement('span');
        tag.className = 'site-tag favorite-tag';
        const siteUrl = String(site.url || siteUrlFallbackMap.get(site.name) || '').trim();
        if (siteUrl) {
            tag.dataset.url = siteUrl;
            tag.title = siteUrl;
        }
        tag.textContent = site.name;
        sitesDiv.appendChild(tag);
    });

    div.appendChild(header);
    div.appendChild(sitesDiv);

    div.addEventListener('click', (e) => {
        if (e.target === favoriteBtn || favoriteBtn.contains(e.target)) return;
        openFavoriteItem(item);
    });

    return div;
}

// ─── Actions ───

async function openFavoriteItem(item) {
    try {
        const params = new URLSearchParams();
        params.set('query', item.query);
        const isHybridItem = item.source === 'hybrid';
        if (!isHybridItem) {
            const siteNames = item.sites.map(s => s.name);
            if (siteNames.length > 0) params.set('sites', siteNames.join(','));
        }
        if (item.id) params.set('historyId', item.id);
        const iframeUrl = chrome.runtime.getURL(`iframe/iframe.html?${params.toString()}`);
        await chrome.tabs.create({ url: iframeUrl, active: true });

        if (!isHybridItem) {
            setTimeout(async () => {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tabs.length > 0 && tabs[0].url && tabs[0].url.includes('iframe.html')) {
                try {
                    await chrome.tabs.sendMessage(tabs[0].id, {
                        type: 'loadHistoryIframes',
                        sites: item.sites,
                        historyId: item.id
                    });
                } catch (_) {}
            }
            }, 1000);
        }
    } catch (error) {
        console.error('打开收藏记录失败:', error);
        alert('打开收藏记录失败，请重试');
    }
}

async function deleteFavoriteItem(id) {
    try {
        const hybridSession = typeof HybridFavorites.getHybridSessionById === 'function'
            ? await HybridFavorites.getHybridSessionById(id)
            : null;
        if (hybridSession) {
            if (typeof HybridFavorites.updateHybridSessionFavorite === 'function') {
                await HybridFavorites.updateHybridSessionFavorite(id, {
                    isFavorite: false,
                    favoriteFolder: '',
                    preserveUpdatedAt: true
                });
            }
            return;
        }

        const { pkHistory = [] } = await chrome.storage.local.get('pkHistory');
        const historyIndex = pkHistory.findIndex(item => item.id === id);
        if (historyIndex === -1) return;

        const historyItem = pkHistory[historyIndex];
        if (historyItem.sites) {
            if (currentFolderId !== null) {
                historyItem.sites.forEach(site => {
                    if ((site.favoriteFolder || 'default') === currentFolderId) {
                        site.isFavorite = false;
                        delete site.favoriteFolder;
                    }
                });
            } else {
                historyItem.sites.forEach(site => {
                    site.isFavorite = false;
                    delete site.favoriteFolder;
                });
            }
        }

        await chrome.storage.local.set({ pkHistory });
    } catch (error) {
        console.error('删除收藏记录失败:', error);
    }
}

async function moveFavoriteItemToFolder(id, folderId) {
    try {
        const hybridSession = typeof HybridFavorites.getHybridSessionById === 'function'
            ? await HybridFavorites.getHybridSessionById(id)
            : null;
        if (hybridSession) {
            if (typeof HybridFavorites.updateHybridSessionFavorite === 'function') {
                await HybridFavorites.updateHybridSessionFavorite(id, {
                    isFavorite: true,
                    favoriteFolder: folderId || 'default',
                    preserveUpdatedAt: true
                });
            }
            return;
        }

        const { pkHistory = [] } = await chrome.storage.local.get('pkHistory');
        const historyItem = pkHistory.find(item => item.id === id);
        if (!historyItem || !historyItem.sites) return;
        historyItem.sites.forEach(site => {
            if (site.isFavorite) {
                site.favoriteFolder = folderId || 'default';
            }
        });
        await chrome.storage.local.set({ pkHistory });
    } catch (error) {
        console.error('移动收藏记录失败:', error);
    }
}

async function clearAllFavorites() {
    try {
        if (typeof HybridFavorites.clearHybridFavorites === 'function') {
            await HybridFavorites.clearHybridFavorites(currentFolderId);
        }
        const { pkHistory = [] } = await chrome.storage.local.get('pkHistory');
        pkHistory.forEach(item => {
            if (!item.sites) return;
            item.sites.forEach(site => {
                if (currentFolderId !== null) {
                    if ((site.favoriteFolder || 'default') === currentFolderId) {
                        site.isFavorite = false;
                        delete site.favoriteFolder;
                    }
                } else {
                    site.isFavorite = false;
                    delete site.favoriteFolder;
                }
            });
        });
        await chrome.storage.local.set({ pkHistory });
        await renderFolderTabs();
    } catch (error) {
        console.error('清空收藏记录失败:', error);
    }
}

// ─── Folder management modal ───

async function showFolderManageModal() {
    let folders = typeof window.getFavoriteFolders === 'function'
        ? await window.getFavoriteFolders() : [];

    const overlay = document.createElement('div');
    overlay.className = 'folder-manage-overlay';
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    const modal = document.createElement('div');
    modal.className = 'folder-manage-modal';

    const header = document.createElement('div');
    header.className = 'folder-manage-header';
    const title = document.createElement('h3');
    title.textContent = t('favFolderManage', '管理文件夹');
    const closeBtn = document.createElement('button');
    closeBtn.className = 'folder-manage-close';
    closeBtn.innerHTML = '&#x2715;';
    closeBtn.addEventListener('click', close);
    header.appendChild(title);
    header.appendChild(closeBtn);

    const body = document.createElement('div');
    body.className = 'folder-manage-body';

    function render() {
        body.innerHTML = '';
        folders.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
        folders.forEach(folder => {
            const row = document.createElement('div');
            row.className = 'folder-manage-item';

            const nameEl = document.createElement('span');
            nameEl.className = 'folder-manage-name';
            nameEl.textContent = folder.name;

            const actions = document.createElement('div');
            actions.className = 'folder-manage-actions';

            // Rename (all folders including default)
            const renameBtn = document.createElement('button');
            renameBtn.title = t('editButton', '编辑');
            renameBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M8.5 2.5l3 3M1.5 9.5l6-6 3 3-6 6H1.5v-3z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
            renameBtn.addEventListener('click', () => startRename(row, folder));
            actions.appendChild(renameBtn);

            if (folder.id === 'default') {
                const badge = document.createElement('span');
                badge.className = 'folder-manage-default-badge';
                badge.textContent = t('favFolderDefaultLabel', '默认');
                actions.appendChild(badge);
            } else {
                // Delete (non-default only)
                const delBtn = document.createElement('button');
                delBtn.className = 'danger';
                delBtn.title = t('deleteButton', '删除');
                delBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 4h10M5 4V2.5h4V4M3.5 4v7.5a1 1 0 001 1h5a1 1 0 001-1V4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
                delBtn.addEventListener('click', async () => {
                    if (!confirm((t('favFolderDeleteConfirm', '删除此文件夹？其中的收藏将移至默认文件夹。')))) return;
                    await deleteFolder(folder.id);
                    folders = await window.getFavoriteFolders();
                    render();
                });
                actions.appendChild(delBtn);
            }

            row.appendChild(nameEl);
            row.appendChild(actions);
            body.appendChild(row);
        });
    }

    function startRename(row, folder) {
        row.innerHTML = '';
        const input = document.createElement('input');
        input.className = 'folder-manage-name-input';
        input.value = folder.name;
        input.maxLength = 30;

        const actions = document.createElement('div');
        actions.className = 'folder-manage-actions';

        const saveBtn = document.createElement('button');
        saveBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7l4 4 6-8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        saveBtn.addEventListener('click', async () => {
            const newName = input.value.trim();
            if (!newName) return;
            folder.name = newName;
            await window.saveFavoriteFolders(folders);
            render();
        });

        const cancelBtn = document.createElement('button');
        cancelBtn.innerHTML = '&#x2715;';
        cancelBtn.addEventListener('click', () => render());

        actions.appendChild(saveBtn);
        actions.appendChild(cancelBtn);
        row.appendChild(input);
        row.appendChild(actions);
        input.focus();
        input.select();

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') saveBtn.click();
            if (e.key === 'Escape') render();
        });
    }

    render();
    modal.appendChild(header);
    modal.appendChild(body);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    function close() {
        overlay.remove();
        renderFolderTabs();
        loadFavorites();
    }

    document.addEventListener('keydown', function onKey(e) {
        if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
    });
}

async function deleteFolder(folderId) {
    if (typeof HybridFavorites.moveHybridFavoritesToFolder === 'function') {
        await HybridFavorites.moveHybridFavoritesToFolder(folderId);
    }

    // Move all favorites in this folder to default
    const { pkHistory = [] } = await chrome.storage.local.get('pkHistory');
    pkHistory.forEach(item => {
        if (!item.sites) return;
        item.sites.forEach(site => {
            if (site.favoriteFolder === folderId) {
                site.favoriteFolder = 'default';
            }
        });
    });
    await chrome.storage.local.set({ pkHistory });

    // Remove folder
    let folders = await window.getFavoriteFolders();
    folders = folders.filter(f => f.id !== folderId);
    await window.saveFavoriteFolders(folders);

    if (currentFolderId === folderId) currentFolderId = null;
}

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

if (typeof window !== 'undefined') {
    window.addEventListener('runtime-language-changed', async () => {
        initializeI18n();
        await renderFolderTabs();
        await loadFavorites();
    });
}
