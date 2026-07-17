const SIDEBAR_MARKUP = `
<nav class="sidebar-nav" data-i18n-aria-label="sidebarPrimaryAriaLabel" aria-label="">
    <div class="sidebar-nav-body">
        <div class="sidebar-nav-header">
            <a class="app-icon-link" href="../homepage/homepage.html" data-i18n-title="openHomepageLabel" data-i18n-aria-label="openHomepageLabel" title="" aria-label="">
                <img class="app-icon" src="../icons/icon48.png" alt="" aria-hidden="true">
            </a>
        </div>
        <div class="action-links">
            <a id="settingsLink" class="action-link" href="#">
                <img class="action-link-icon" src="../icons/extension-setting.svg" alt="" aria-hidden="true">
                <span data-i18n="settingsLink"></span>
            </a>
            <a id="historyLink" class="action-link" href="#">
                <img class="action-link-icon" src="../icons/history.svg" alt="" aria-hidden="true">
                <span data-i18n="historyLink"></span>
            </a>
            <a id="contactLink" class="action-link" href="#">
                <img class="action-link-icon" src="../icons/feedback.svg" alt="" aria-hidden="true">
                <span data-i18n="contactLink"></span>
            </a>
            <a id="reviewLink" class="action-link" href="#">
                <img class="action-link-icon action-link-icon-grayscale" src="../icons/thumbs-up.svg" alt="" aria-hidden="true">
                <span data-i18n="reviewLink"></span>
            </a>
            <a id="coffeeLink" class="action-link" href="#">
                <img class="action-link-icon" src="../icons/coffee.svg" alt="" aria-hidden="true">
                <span data-i18n="coffeeLink"></span>
            </a>
        </div>
        <div class="sidebar-favorites-list-wrap">
            <a id="favoritesLink" class="action-link" href="#">
                <img class="action-link-icon" src="../icons/star_unsaved.svg" alt="" aria-hidden="true">
                <span data-i18n="favoritesLink"></span>
            </a>
            <div id="sidebarFavoritesList" class="sidebar-favorites-list"></div>
        </div>
    </div>
    <div class="sync-bar-wrap">
        <div id="syncBar" class="sync-bar" role="button" tabindex="0">
            <img class="sync-bar-icon" src="../icons/user.svg" alt="" aria-hidden="true">
            <span id="syncBarText" class="sync-bar-text" data-i18n="logIn"></span>
        </div>
    </div>
</nav>

<div id="wechatModal" class="wechat-modal" style="display: none;">
    <div class="wechat-modal-overlay"></div>
    <div class="wechat-modal-content">
        <div class="wechat-modal-title" data-i18n="wechatModalTitle"></div>
        <div class="wechat-modal-id">aipmgpt</div>
    </div>
</div>

<div id="coffeeModal" class="coffee-modal" style="display: none;">
    <div class="coffee-modal-overlay"></div>
    <div class="coffee-modal-content">
        <p class="coffee-modal-text" data-i18n="coffeeModalText"></p>
        <div class="coffee-modal-body">
            <img id="coffeeModalImage" class="coffee-modal-image" src="" alt="">
            <div class="coffee-modal-bmc">
                <a class="bmc-button" href="https://buymeacoffee.com/aicompare" target="_blank" rel="noopener noreferrer">
                    <img class="bmc-button-icon" src="../icons/buymecoffee.gif" data-i18n-alt="coffeeButtonAlt" alt="">
                </a>
            </div>
        </div>
    </div>
</div>
`;

function renderSidebarMarkup() {
    const mount = document.getElementById('appSidebarMount');
    if (!mount) return null;
    const urlParams = new URLSearchParams(window.location.search);
    const isSidePanel = urlParams.get('side_panel') === 'true';
    if (isSidePanel) {
        mount.remove();
        return null;
    }

    mount.innerHTML = SIDEBAR_MARKUP;
    return mount;
}

function safeTrackEvent(name, params = {}) {
    const insightPayload = window.AICompareBehaviorInsights?.buildAnalyticsPayload?.({
        eventName: name,
        source: 'sidebar',
        surface: params?.surface || 'sidebar',
        trigger: params?.trigger || '',
        kind: params?.kind || '',
        hasQuery: Boolean(params?.has_query || params?.query_length),
        queryLength: Math.max(0, Number(params?.query_length) || 0),
        metadata: params
    }) || {
        eventName: name,
        source: 'sidebar',
        metadata: params
    };
    try {
        chrome.runtime.sendMessage({
            action: 'recordAnalyticsEvent',
            payload: insightPayload
        }, () => {
            if (chrome.runtime.lastError) {
                // Analytics must never block navigation.
            }
        });
    } catch (_) {
        // Ignore analytics upload failures.
    }
    const analytics = window.AIShortcutsAnalytics;
    if (analytics && typeof analytics.logEvent === 'function') {
        analytics.logEvent(name, params);
    }
}

function sidebarMessage(key, fallback = '', substitutions = undefined) {
    return window.RuntimeI18n?.getMessage?.(key, substitutions) || chrome?.i18n?.getMessage?.(key, substitutions) || fallback;
}

function getSidebarLoginLabel() {
    return sidebarMessage('logIn', 'login');
}

function getSidebarAccountPageUrl() {
    return chrome.runtime.getURL('options/options.html#membership');
}

function getSidebarLoginPageUrl() {
    const loginUrl = new URL(chrome.runtime.getURL('options/account-login.html'));
    loginUrl.searchParams.set('returnTo', getSidebarAccountPageUrl());
    return loginUrl.toString();
}

function applySidebarI18n(root) {
    if (!root) return;
    root.querySelectorAll('[data-i18n]').forEach((element) => {
        const key = element.getAttribute('data-i18n');
        const message = sidebarMessage(key);
        if (message) {
            element.textContent = message;
        }
    });
    root.querySelectorAll('[data-i18n-title]').forEach((element) => {
        const key = element.getAttribute('data-i18n-title');
        const message = sidebarMessage(key);
        if (message) {
            element.title = message;
        }
    });
    root.querySelectorAll('[data-i18n-alt]').forEach((element) => {
        const key = element.getAttribute('data-i18n-alt');
        const message = sidebarMessage(key);
        if (message) {
            element.alt = message;
        }
    });
    root.querySelectorAll('[data-i18n-aria-label]').forEach((element) => {
        const key = element.getAttribute('data-i18n-aria-label');
        const message = sidebarMessage(key);
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
    if (window.ExtensionEnvironment && typeof window.ExtensionEnvironment.getChromeWebStoreReviewUrl === 'function') {
        return window.ExtensionEnvironment.getChromeWebStoreReviewUrl(externalLinks);
    }
    const configuredUrl = String(externalLinks.reviewLink || '').trim();
    if (configuredUrl) {
        return configuredUrl;
    }
    return 'https://chromewebstore.google.com/detail/dkhpgbbhlnmjbkihoeniojpkggkabbbl/reviews';
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
    if (!syncBar || !syncBarText) return;
    try {
        const stored = await chrome.storage.local.get(['firebase_uid', 'firebase_email']);
        const email = String(stored?.firebase_email || '').trim();
        const isLoggedIn = Boolean(stored?.firebase_uid);
        syncBar.classList.toggle('sync-bar--logged-in', isLoggedIn);
        syncBarText.textContent = isLoggedIn
            ? (email || sidebarMessage('membershipPlanPro', 'Account'))
            : getSidebarLoginLabel();
        syncBar.title = isLoggedIn ? (email || '') : sidebarMessage('membershipGoogleLoginButton', 'Sign in with Google');
    } catch (_) {
        syncBar.classList.remove('sync-bar--logged-in');
        syncBarText.textContent = getSidebarLoginLabel();
        syncBar.title = sidebarMessage('membershipGoogleLoginButton', 'Sign in with Google');
    }
}

function bindSyncBar() {
    const syncBar = document.getElementById('syncBar');
    if (!syncBar) return;

    async function handleSyncBarActivate(e) {
        e.stopPropagation();
        if (syncBar.dataset.loading === 'true') {
            return;
        }
        syncBar.dataset.loading = 'true';
        try {
            const stored = await chrome.storage.local.get(['firebase_uid']);
            if (stored?.firebase_uid) {
                safeTrackEvent('sidebar_account_click');
                window.location.href = getSidebarAccountPageUrl();
                return;
            }
            safeTrackEvent('sidebar_login_click');
            window.location.href = getSidebarLoginPageUrl();
        } catch (error) {
            console.warn('Sidebar account navigation failed', error);
            window.location.href = getSidebarLoginPageUrl();
        } finally {
            syncBar.dataset.loading = 'false';
        }
    }

    syncBar.addEventListener('click', handleSyncBarActivate);
    syncBar.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') {
            return;
        }
        e.preventDefault();
        handleSyncBarActivate(e);
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
            empty.textContent = sidebarMessage('noFavorites', '暂无收藏');
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
        if (areaName === 'local' && (changes.firebase_uid || changes.firebase_email)) updateSyncBar();
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
    const mount = renderSidebarMarkup();
    if (!mount) return;
    if (window.RuntimeI18n?.initializeRuntimeI18n) {
        await window.RuntimeI18n.initializeRuntimeI18n();
    }
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
}

function scheduleSharedSidebarInit() {
    if (document.getElementById('appSidebarMount')) {
        void initSharedSidebar();
        return;
    }

    document.addEventListener('DOMContentLoaded', () => {
        void initSharedSidebar();
    }, { once: true });
}

scheduleSharedSidebarInit();
if (typeof window !== 'undefined') {
    window.addEventListener('runtime-language-changed', () => {
        const mount = document.getElementById('appSidebarMount');
        if (mount) {
            applySidebarI18n(mount);
        }
        updateSyncBar();
        loadSidebarFavorites();
    });
}
function getHybridFavoritesApi() {
    return window.AICompareHybridFavorites || {};
}
