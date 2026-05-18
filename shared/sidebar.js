async function loadSidebarMarkup() {
    const mount = document.getElementById('appSidebarMount');
    if (!mount) return null;
    const urlParams = new URLSearchParams(window.location.search);
    const isSidePanel = urlParams.get('side_panel') === 'true';
    if (isSidePanel) {
        mount.remove();
        return null;
    }
    try {
        const sidebarUrl = chrome.runtime.getURL('shared/sidebar.html');
        const response = await fetch(sidebarUrl);
        if (!response.ok) {
            console.warn('Failed to load sidebar HTML:', response.status);
            return null;
        }
        const html = await response.text();
        mount.innerHTML = html;
        return mount;
    } catch (error) {
        console.error('Failed to load sidebar HTML', error);
        return null;
    }
}

function safeTrackEvent(name, params = {}) {
    const analytics = window.AIShortcutsAnalytics;
    if (analytics && typeof analytics.logEvent === 'function') {
        analytics.logEvent(name, params);
    }
}

function applySidebarI18n(root) {
    if (!root || !chrome?.i18n) return;
    root.querySelectorAll('[data-i18n]').forEach((element) => {
        const key = element.getAttribute('data-i18n');
        const message = chrome.i18n.getMessage(key);
        if (message) {
            element.textContent = message;
        }
    });
    root.querySelectorAll('[data-i18n-title]').forEach((element) => {
        const key = element.getAttribute('data-i18n-title');
        const message = chrome.i18n.getMessage(key);
        if (message) {
            element.title = message;
        }
    });
    root.querySelectorAll('[data-i18n-alt]').forEach((element) => {
        const key = element.getAttribute('data-i18n-alt');
        const message = chrome.i18n.getMessage(key);
        if (message) {
            element.alt = message;
        }
    });
    root.querySelectorAll('[data-i18n-aria-label]').forEach((element) => {
        const key = element.getAttribute('data-i18n-aria-label');
        const message = chrome.i18n.getMessage(key);
        if (message) {
            element.setAttribute('aria-label', message);
        }
    });
}

function applySidebarBranding(root) {
    if (!root) return;
    const appIcon = root.querySelector('.app-icon');
    if (!appIcon) return;

    if (window.ExtensionEnvironment && typeof window.ExtensionEnvironment.applyBrandIconToImage === 'function') {
        window.ExtensionEnvironment.applyBrandIconToImage(appIcon, 48);
    }
}

function getSidebarReviewUrl(externalLinks = {}) {
    const configuredUrl = String(externalLinks.reviewLink || '').trim();
    if (configuredUrl) {
        return configuredUrl;
    }
    return `https://chromewebstore.google.com/detail/${chrome.runtime.id}/reviews`;
}

async function initializeSidebarActionLinks() {
    try {
        const config = await AppConfigManager.loadConfig();
        const externalLinks = config.externalLinks || {};

        const historyLink = document.getElementById('historyLink');
        if (historyLink) {
            historyLink.addEventListener('click', (e) => {
                e.preventDefault();
                safeTrackEvent('sidebar_history_click');
                chrome.tabs.create({
                    url: chrome.runtime.getURL('history/history.html')
                });
            });
        }

        const favoritesLink = document.getElementById('favoritesLink');
        if (favoritesLink) {
            favoritesLink.addEventListener('click', (e) => {
                e.preventDefault();
                safeTrackEvent('sidebar_favorites_click');
                chrome.tabs.create({
                    url: chrome.runtime.getURL('favorites/favorites.html')
                });
            });
        }

        const settingsLink = document.getElementById('settingsLink');
        if (settingsLink) {
            settingsLink.addEventListener('click', (e) => {
                e.preventDefault();
                safeTrackEvent('sidebar_settings_click');
                window.location.href = chrome.runtime.getURL('options/options.html');
            });
        }

        const contactLink = document.getElementById('contactLink');
        if (contactLink) {
            contactLink.addEventListener('click', (e) => {
                e.preventDefault();
                safeTrackEvent('sidebar_contact_click', {
                    has_contact_config: Boolean(config.contact)
                });
                window.location.href = chrome.runtime.getURL('contact/contact.html');
            });
        }

        const reviewLink = document.getElementById('reviewLink');
        if (reviewLink) {
            reviewLink.addEventListener('click', (e) => {
                e.preventDefault();
                const reviewUrl = getSidebarReviewUrl(externalLinks);
                safeTrackEvent('sidebar_review_click', {
                    has_review_link: Boolean(externalLinks.reviewLink)
                });
                chrome.tabs.create({ url: reviewUrl });
            });
        }

        bindWechatLink();
        bindCoffeeLink();
    } catch (error) {
        console.error('加载配置失败:', error);

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
                window.location.href = chrome.runtime.getURL('options/options.html');
            });
        }

        const contactLink = document.getElementById('contactLink');
        if (contactLink) {
            contactLink.addEventListener('click', (e) => {
                e.preventDefault();
                window.location.href = chrome.runtime.getURL('contact/contact.html');
            });
        }

        const reviewLink = document.getElementById('reviewLink');
        if (reviewLink) {
            reviewLink.addEventListener('click', (e) => {
                e.preventDefault();
                chrome.tabs.create({
                    url: getSidebarReviewUrl()
                });
            });
        }

        bindWechatLink();
        bindCoffeeLink();
    }
}

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
            if (syncBarIcon) syncBarIcon.textContent = '\u{1F464}';
        } else {
            syncBar.classList.remove('sync-bar--logged-in');
            syncBarText.textContent = chrome.i18n.getMessage('enableSync') ||
                (chrome.i18n.getUILanguage().toLowerCase().startsWith('zh') ? '开启同步' : 'Enable Sync');
            if (syncBarIcon) syncBarIcon.textContent = '';
        }
    } catch (e) {
        syncBar.classList.remove('sync-bar--logged-in');
        syncBarText.textContent = chrome.i18n.getMessage('enableSync') ||
            (chrome.i18n.getUILanguage().toLowerCase().startsWith('zh') ? '开启同步' : 'Enable Sync');
        if (syncBarIcon) syncBarIcon.textContent = '';
    }
}

function bindSyncBar() {
    const syncBar = document.getElementById('syncBar');
    const dropdown = document.getElementById('syncAccountDropdown');
    const logoutBtn = document.getElementById('syncLogoutBtn');
    if (!syncBar) return;

    function closeAccountDropdown() {
        if (dropdown) {
            dropdown.classList.remove('is-open');
            dropdown.setAttribute('aria-hidden', 'true');
        }
    }

    function openAccountDropdown() {
        if (dropdown) {
            dropdown.classList.add('is-open');
            dropdown.setAttribute('aria-hidden', 'false');
        }
    }

    syncBar.addEventListener('click', async (e) => {
        e.stopPropagation();
        safeTrackEvent('sidebar_sync_bar_click');
        const loggedIn = window.firebaseIsLoggedIn ? await window.firebaseIsLoggedIn() : false;
        if (loggedIn) {
            const isOpen = dropdown && dropdown.classList.contains('is-open');
            if (isOpen) {
                closeAccountDropdown();
            } else {
                openAccountDropdown();
            }
            return;
        }
        closeAccountDropdown();
        if (!window.firebaseSignInWithGoogle || !window.firebaseSyncMergeAndUpload) {
            return;
        }
        const textEl = document.getElementById('syncBarText');
        try {
            if (textEl) {
                textEl.textContent = chrome.i18n.getMessage('syncOpeningGoogleSignIn') || 'Opening Google sign-in…';
            }
            await window.firebaseSignInWithGoogle();
            if (textEl) {
                textEl.textContent = chrome.i18n.getMessage('syncSyncingFromCloud') || 'Syncing from cloud…';
            }
            await window.firebaseSyncMergeAndUpload();
            await updateSyncBar();
            if (typeof loadSidebarFavorites === 'function') await loadSidebarFavorites();
        } catch (e) {
            if (textEl) {
                textEl.textContent = (e && e.message) || (chrome.i18n.getMessage('syncDownloadFailed') || '同步失败，请重试');
            }
            console.warn('Sync sign-in or merge failed', e);
        }
    });

    if (logoutBtn) {
        logoutBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeAccountDropdown();
            if (window.firebaseSignOut) {
                try {
                    await window.firebaseSignOut();
                    await updateSyncBar();
                } catch (err) {
                    console.warn('Logout failed', err);
                }
            }
        });
    }

    document.addEventListener('click', (e) => {
        if (dropdown && dropdown.classList.contains('is-open')) {
            const wrap = syncBar?.closest('.sync-bar-wrap');
            if (wrap && !wrap.contains(e.target)) {
                closeAccountDropdown();
            }
        }
    });
}

async function loadSidebarFavorites() {
    const listEl = document.getElementById('sidebarFavoritesList');
    if (!listEl) return;
    const tooltipEl = getSidebarFavoritesTooltip();
    try {
        const storageData = await chrome.storage.local.get(['pkHistory', 'favoriteFolders']);
        const pkHistory = storageData.pkHistory || [];
        const folders = storageData.favoriteFolders || [];

        const favoriteItems = pkHistory
            .filter(item => item.sites && item.sites.some(site => site.isFavorite === true))
            .map(item => ({
                ...item,
                sites: item.sites.filter(site => site.isFavorite === true)
            }));
        const hybridFavorites = getHybridFavoritesApi();
        const hybridFavoriteItems = typeof hybridFavorites.listFavoritedHybridSessions === 'function'
            ? await hybridFavorites.listFavoritedHybridSessions({ limit: 200 })
            : [];
        const mergedFavoriteItems = [...hybridFavoriteItems, ...favoriteItems]
            .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
        listEl.innerHTML = '';
        if (mergedFavoriteItems.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'sidebar-favorites-empty';
            empty.textContent = chrome.i18n.getMessage('noFavorites') || '暂无收藏';
            listEl.appendChild(empty);
            hideSidebarFavoritesTooltip(tooltipEl);
            return;
        }

        // Group by folder
        const folderMap = {};
        folders.forEach(f => { folderMap[f.id] = f.name; });
        const grouped = {};
        mergedFavoriteItems.forEach(item => {
            const fid = item.favoriteFolder || (item.sites[0] && item.sites[0].favoriteFolder) || 'default';
            if (!grouped[fid]) grouped[fid] = [];
            grouped[fid].push(item);
        });

        const folderOrder = folders.map(f => f.id);
        Object.keys(grouped).forEach(fid => {
            if (!folderOrder.includes(fid)) folderOrder.push(fid);
        });

        const hasMultipleFolders = Object.keys(grouped).length > 1;

        folderOrder.forEach(fid => {
            const items = grouped[fid];
            if (!items || items.length === 0) return;

            let container = listEl;

            if (hasMultipleFolders) {
                const group = document.createElement('div');
                group.className = 'sidebar-folder-group';
                const header = document.createElement('div');
                header.className = 'sidebar-folder-header';
                header.innerHTML = `<svg class="sidebar-folder-arrow" viewBox="0 0 12 12" fill="none"><path d="M3 2l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
                const nameSpan = document.createElement('span');
                nameSpan.className = 'sidebar-folder-name';
                nameSpan.textContent = folderMap[fid] || fid;
                header.appendChild(nameSpan);

                const itemsContainer = document.createElement('div');
                itemsContainer.className = 'sidebar-folder-items';

                header.addEventListener('click', () => {
                    header.classList.toggle('collapsed');
                    itemsContainer.classList.toggle('collapsed');
                });

                group.appendChild(header);
                group.appendChild(itemsContainer);
                listEl.appendChild(group);
                container = itemsContainer;
            }

            items.forEach(item => {
                const el = document.createElement('div');
                el.className = 'sidebar-favorite-item';
                const queryText = item.query || '';
                const textSpan = document.createElement('span');
                textSpan.className = 'sidebar-favorite-text';
                textSpan.textContent = queryText;
                el.appendChild(textSpan);
                if (queryText) el.setAttribute('aria-label', queryText);
                el.addEventListener('click', (e) => {
                    e.preventDefault();
                    openSidebarFavoriteItem(item);
                });
                el.addEventListener('mouseenter', () => {
                    showSidebarFavoritesTooltip(tooltipEl, el, queryText);
                });
                el.addEventListener('mouseleave', () => {
                    hideSidebarFavoritesTooltip(tooltipEl);
                });
                container.appendChild(el);
            });
        });
        listEl.addEventListener('scroll', () => hideSidebarFavoritesTooltip(tooltipEl), { passive: true });
    } catch (error) {
        console.error('加载侧边栏收藏失败:', error);
        if (listEl) listEl.innerHTML = '';
        hideSidebarFavoritesTooltip(tooltipEl);
    }
}

function getSidebarFavoritesTooltip() {
    let tooltip = document.getElementById('sidebarFavoritesTooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'sidebarFavoritesTooltip';
        tooltip.className = 'sidebar-favorite-tooltip-floating';
        tooltip.setAttribute('role', 'tooltip');
        tooltip.style.display = 'none';
        document.body.appendChild(tooltip);
    }
    return tooltip;
}

function showSidebarFavoritesTooltip(tooltipEl, anchorEl, text) {
    if (!tooltipEl || !anchorEl || !text) return;
    tooltipEl.textContent = text;
    const rect = anchorEl.getBoundingClientRect();
    tooltipEl.style.left = `${Math.round(rect.right + 8)}px`;
    tooltipEl.style.top = `${Math.round(rect.top + rect.height / 2)}px`;
    tooltipEl.style.display = 'block';
}

function hideSidebarFavoritesTooltip(tooltipEl) {
    if (!tooltipEl) return;
    tooltipEl.style.display = 'none';
}

async function openSidebarFavoriteItem(item) {
    try {
        const params = new URLSearchParams();
        params.set('query', item.query || '');
        const isHybridItem = item.source === 'hybrid';
        if (!isHybridItem) {
            const siteNames = (item.sites || []).map(site => site.name).filter(Boolean);
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
                            sites: item.sites || [],
                            historyId: item.id
                        });
                    } catch (err) {}
                }
            }, 1000);
        }
    } catch (error) {
        console.error('打开收藏记录失败:', error);
    }
}

function bindSidebarStorageListeners() {
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local' && (changes.pkHistory || changes.favoriteFolders)) loadSidebarFavorites();
        if (areaName === 'local' && (changes.firebase_email || changes.firebase_uid)) updateSyncBar();
    });
    window.addEventListener('focus', () => {
        loadSidebarFavorites();
    });
}

function markActiveSidebarLink() {
    const page = document.body?.dataset?.page;
    if (!page) return;
    const linkMap = {
        contact: 'contactLink',
        favorites: 'favoritesLink',
        history: 'historyLink',
        settings: 'settingsLink'
    };
    const linkId = linkMap[page];
    if (!linkId) return;
    const link = document.getElementById(linkId);
    if (link) {
        link.setAttribute('aria-current', 'page');
    }
}

async function initSharedSidebar() {
    const mount = await loadSidebarMarkup();
    if (!mount) return;
    applySidebarI18n(mount);
    applySidebarBranding(mount);
    markActiveSidebarLink();
    bindSyncBar();
    bindSidebarStorageListeners();
    await Promise.allSettled([
        initializeSidebarActionLinks(),
        updateSyncBar(),
        loadSidebarFavorites()
    ]);

    const loggedIn = window.firebaseIsLoggedIn ? await window.firebaseIsLoggedIn() : false;
    if (loggedIn && typeof window.firebaseSyncMergeAndUpload === 'function') {
        const { firebase_lastSyncAt } = await chrome.storage.local.get('firebase_lastSyncAt');
        const throttleMs = 2 * 60 * 1000;
        if (!firebase_lastSyncAt || Date.now() - firebase_lastSyncAt > throttleMs) {
            window.firebaseSyncMergeAndUpload().then(() => loadSidebarFavorites()).catch(() => {});
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initSharedSidebar();
});
function getHybridFavoritesApi() {
    return window.AICompareHybridFavorites || {};
}
