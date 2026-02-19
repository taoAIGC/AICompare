/**
 * Unified favorite folder picker modal.
 *
 * Public API (attached to window):
 *   showFavoriteFolderModal(options)  -> Promise<{ folderId: string } | null>
 *   getFavoriteFolders()              -> Promise<Array>
 *   ensureDefaultFolder()             -> Promise<void>
 *   migrateLegacyFavorites()          -> Promise<void>
 */

const FAV_FOLDERS_KEY = 'favoriteFolders';
const DEFAULT_FOLDER_ID = 'default';

function i18n(key, fallback) {
    try {
        const msg = chrome.i18n.getMessage(key);
        return msg || fallback;
    } catch (_) {
        return fallback;
    }
}

async function getFavoriteFolders() {
    const data = await chrome.storage.local.get(FAV_FOLDERS_KEY);
    return data[FAV_FOLDERS_KEY] || [];
}

async function saveFavoriteFolders(folders) {
    await chrome.storage.local.set({ [FAV_FOLDERS_KEY]: folders });
}

async function ensureDefaultFolder() {
    let folders = await getFavoriteFolders();
    if (!folders.find(f => f.id === DEFAULT_FOLDER_ID)) {
        folders.unshift({
            id: DEFAULT_FOLDER_ID,
            name: i18n('favFolderDefault', '默认收藏'),
            createdAt: Date.now(),
            order: 0,
        });
        await saveFavoriteFolders(folders);
    }
    return folders;
}

async function migrateLegacyFavorites() {
    await ensureDefaultFolder();
    const { pkHistory = [] } = await chrome.storage.local.get('pkHistory');
    let changed = false;
    pkHistory.forEach(item => {
        if (!item.sites) return;
        item.sites.forEach(site => {
            if (site.isFavorite && !site.favoriteFolder) {
                site.favoriteFolder = DEFAULT_FOLDER_ID;
                changed = true;
            }
        });
    });
    if (changed) {
        await chrome.storage.local.set({ pkHistory });
    }
}

async function getFolderCounts() {
    const { pkHistory = [] } = await chrome.storage.local.get('pkHistory');
    const counts = {};
    pkHistory.forEach(item => {
        if (!item.sites) return;
        const seen = new Set();
        item.sites.forEach(site => {
            if (site.isFavorite) {
                const fid = site.favoriteFolder || DEFAULT_FOLDER_ID;
                if (!seen.has(fid)) {
                    counts[fid] = (counts[fid] || 0) + 1;
                    seen.add(fid);
                }
            }
        });
    });
    return counts;
}

function createFolderItemEl(folder, count, isSelected, onSelect) {
    const item = document.createElement('div');
    item.className = 'fav-folder-item' + (isSelected ? ' selected' : '');
    item.dataset.folderId = folder.id;

    const radio = document.createElement('div');
    radio.className = 'fav-folder-radio';
    const inner = document.createElement('div');
    inner.className = 'fav-folder-radio-inner';
    radio.appendChild(inner);

    const nameEl = document.createElement('span');
    nameEl.className = 'fav-folder-name';
    nameEl.textContent = folder.name;

    const countEl = document.createElement('span');
    countEl.className = 'fav-folder-count';
    countEl.textContent = count > 0 ? `${count}` : '';

    item.appendChild(radio);
    item.appendChild(nameEl);
    item.appendChild(countEl);

    item.addEventListener('click', () => onSelect(folder.id));
    return item;
}

function showFavoriteFolderModal(options = {}) {
    return new Promise(async (resolve) => {
        const folders = await ensureDefaultFolder();
        const counts = await getFolderCounts();

        let selectedId = options.defaultFolderId || DEFAULT_FOLDER_ID;
        let resolved = false;

        function finish(result) {
            if (resolved) return;
            resolved = true;
            overlay.remove();
            resolve(result);
        }

        const overlay = document.createElement('div');
        overlay.className = 'fav-folder-modal-overlay';
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) finish(null);
        });

        const modal = document.createElement('div');
        modal.className = 'fav-folder-modal';

        // Header
        const header = document.createElement('div');
        header.className = 'fav-folder-modal-header';
        const title = document.createElement('h3');
        title.textContent = options.title || i18n('favFolderSaveToFolder', '保存到收藏夹');
        const closeBtn = document.createElement('button');
        closeBtn.className = 'fav-folder-modal-close';
        closeBtn.innerHTML = '&#x2715;';
        closeBtn.addEventListener('click', () => finish(null));
        header.appendChild(title);
        header.appendChild(closeBtn);

        // Body
        const body = document.createElement('div');
        body.className = 'fav-folder-modal-body';

        const listEl = document.createElement('div');
        listEl.className = 'fav-folder-list';

        function renderList() {
            listEl.innerHTML = '';
            folders.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
            folders.forEach(folder => {
                const el = createFolderItemEl(folder, counts[folder.id] || 0, folder.id === selectedId, (id) => {
                    selectedId = id;
                    renderList();
                });
                listEl.appendChild(el);
            });
        }
        renderList();
        body.appendChild(listEl);

        // New folder section
        const newRow = document.createElement('div');
        newRow.className = 'fav-folder-new-row';

        const newBtn = document.createElement('button');
        newBtn.className = 'fav-folder-new-btn';
        newBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> <span>${i18n('favFolderNewFolder', '新建文件夹')}</span>`;

        const inputRow = document.createElement('div');
        inputRow.className = 'fav-folder-new-input-row';
        inputRow.style.display = 'none';

        const newInput = document.createElement('input');
        newInput.className = 'fav-folder-new-input';
        newInput.type = 'text';
        newInput.placeholder = i18n('favFolderNamePlaceholder', '输入文件夹名称');
        newInput.maxLength = 30;

        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'fav-folder-new-confirm';
        confirmBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7l4 4 6-8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

        const cancelNewBtn = document.createElement('button');
        cancelNewBtn.className = 'fav-folder-new-cancel';
        cancelNewBtn.innerHTML = '&#x2715;';

        inputRow.appendChild(newInput);
        inputRow.appendChild(confirmBtn);
        inputRow.appendChild(cancelNewBtn);

        newBtn.addEventListener('click', () => {
            newBtn.style.display = 'none';
            inputRow.style.display = 'flex';
            newInput.value = '';
            newInput.focus();
        });

        cancelNewBtn.addEventListener('click', () => {
            inputRow.style.display = 'none';
            newBtn.style.display = 'flex';
        });

        async function createFolder() {
            const name = newInput.value.trim();
            if (!name) return;
            const id = 'folder_' + Date.now();
            const newFolder = { id, name, createdAt: Date.now(), order: folders.length };
            folders.push(newFolder);
            await saveFavoriteFolders(folders);
            selectedId = id;
            renderList();
            inputRow.style.display = 'none';
            newBtn.style.display = 'flex';
        }

        confirmBtn.addEventListener('click', createFolder);
        newInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); createFolder(); }
            if (e.key === 'Escape') { inputRow.style.display = 'none'; newBtn.style.display = 'flex'; }
        });

        newRow.appendChild(newBtn);
        newRow.appendChild(inputRow);
        body.appendChild(newRow);

        // Footer
        const footer = document.createElement('div');
        footer.className = 'fav-folder-modal-footer';

        const removeBtn = document.createElement('button');
        removeBtn.className = 'fav-folder-remove-btn';
        removeBtn.textContent = i18n('favFolderRemove', '移除收藏');
        removeBtn.addEventListener('click', () => finish({ action: 'remove' }));

        const saveBtn = document.createElement('button');
        saveBtn.className = 'fav-folder-save-btn';
        saveBtn.textContent = i18n('saveButton', '保存');
        saveBtn.addEventListener('click', () => finish({ folderId: selectedId }));

        footer.appendChild(removeBtn);
        footer.appendChild(saveBtn);

        modal.appendChild(header);
        modal.appendChild(body);
        modal.appendChild(footer);
        overlay.appendChild(modal);

        document.body.appendChild(overlay);

        // ESC to close
        function onKeydown(e) {
            if (e.key === 'Escape') {
                finish(null);
                document.removeEventListener('keydown', onKeydown);
            }
        }
        document.addEventListener('keydown', onKeydown);
    });
}

if (typeof window !== 'undefined') {
    window.showFavoriteFolderModal = showFavoriteFolderModal;
    window.getFavoriteFolders = getFavoriteFolders;
    window.saveFavoriteFolders = saveFavoriteFolders;
    window.ensureDefaultFolder = ensureDefaultFolder;
    window.migrateLegacyFavorites = migrateLegacyFavorites;
    window.FAV_FOLDERS_KEY = FAV_FOLDERS_KEY;
    window.DEFAULT_FOLDER_ID = DEFAULT_FOLDER_ID;
}
