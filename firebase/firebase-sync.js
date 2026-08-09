// Cloud sync is served by the AI Compare VPS. Firebase Authentication remains
// the identity provider, but extension code never contacts Firestore directly.

const SYNC_DEBOUNCE_MS = 15000;
let syncTimer = null;
let syncInitialized = false;
let syncSuppressed = false;

function getSyncBaseUrl() {
  const config = globalThis.FirebaseConfig;
  if (config && typeof config.getCloudFunctionsBaseUrl === 'function') return config.getCloudFunctionsBaseUrl().replace(/\/+$/, '');
  return String(config?.cloudFunctionsBaseUrl || '').replace(/\/+$/, '');
}

async function getSyncToken() {
  if (typeof globalThis.firebaseGetIdToken === 'function') return globalThis.firebaseGetIdToken();
  const auth = await chrome.storage.local.get(['firebase_idToken', 'firebase_expiresAt']);
  return auth.firebase_idToken && auth.firebase_expiresAt > Date.now() + 60000 ? auth.firebase_idToken : null;
}

async function requestSync(path, options = {}) {
  const token = await getSyncToken();
  if (!token) return { ok: false, status: 401, reason: 'token_expired' };
  const response = await fetch(`${getSyncBaseUrl()}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) }
  });
  if (!response.ok) return { ok: false, status: response.status, reason: 'request_failed' };
  return { ok: true, data: await response.json().catch(() => ({})) };
}

async function currentSyncData() {
  const local = await chrome.storage.local.get(['pkHistory', 'favoriteFolders']);
  const sync = await chrome.storage.sync.get(['favoritePrompts', 'favoriteSites', 'promptTemplates', 'sites', 'customSites', 'buttonConfig', 'disabledSites', 'siteSettings']);
  return {
    pkHistory: local.pkHistory || [], favoriteFolders: local.favoriteFolders || [],
    favoritePrompts: sync.favoritePrompts || [], favoriteSites: sync.favoriteSites || [],
    promptTemplates: sync.promptTemplates || [], sites: sync.sites || {}, customSites: sync.customSites || [],
    buttonConfig: sync.buttonConfig || {}, disabledSites: sync.disabledSites || [], siteSettings: sync.siteSettings || {}
  };
}

async function uploadSyncData(data) {
  const result = await requestSync('/sync/user-data', { method: 'POST', body: JSON.stringify({ data }) });
  if (result.ok) await chrome.storage.local.set({ firebase_lastSyncAt: Date.now() });
  return result.ok ? { success: true } : { success: false, reason: result.reason, status: result.status };
}

async function uploadFavoriteFolders(favoriteFolders) { return uploadSyncData({ favoriteFolders: favoriteFolders || [] }); }
async function uploadPkHistory(pkHistory) { return uploadSyncData({ pkHistory: pkHistory || [] }); }
async function uploadFavorites() { return uploadSyncData(await currentSyncData()); }

function mergeById(local, cloud, key = 'id') {
  const values = new Map();
  [...(local || []), ...(cloud || [])].forEach((item) => { const id = item?.[key]; if (id) values.set(id, item); });
  return [...values.values()];
}

async function downloadUserData() {
  const result = await requestSync('/sync/user-data');
  return result.ok ? result.data : null;
}

async function downloadPkHistory() {
  const data = await downloadUserData();
  return data ? data.pkHistory || [] : null;
}

async function mergeFromCloudAndUpload() {
  syncSuppressed = true;
  try {
    const cloud = await downloadUserData();
    if (!cloud) throw new Error(chrome.i18n?.getMessage('syncDownloadFailed') || 'Unable to download cloud data');
    const local = await currentSyncData();
    const merged = {
      pkHistory: mergeById(local.pkHistory, cloud.pkHistory).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, 500),
      favoriteFolders: mergeById(local.favoriteFolders, cloud.favoriteFolders),
      favoritePrompts: [...new Set([...(local.favoritePrompts || []), ...(cloud.favoritePrompts || [])])],
      favoriteSites: mergeById(local.favoriteSites, cloud.favoriteSites, 'name'),
      promptTemplates: mergeById(local.promptTemplates, cloud.promptTemplates),
      customSites: mergeById(local.customSites, cloud.customSites),
      sites: { ...local.sites, ...cloud.sites }, buttonConfig: { ...local.buttonConfig, ...cloud.buttonConfig },
      disabledSites: [...new Set([...(local.disabledSites || []), ...(cloud.disabledSites || [])])],
      siteSettings: { ...local.siteSettings, ...cloud.siteSettings }
    };
    await chrome.storage.local.set({ pkHistory: merged.pkHistory, favoriteFolders: merged.favoriteFolders });
    await chrome.storage.sync.set({ favoritePrompts: merged.favoritePrompts, favoriteSites: merged.favoriteSites, promptTemplates: merged.promptTemplates, sites: merged.sites, customSites: merged.customSites, buttonConfig: merged.buttonConfig, disabledSites: merged.disabledSites, siteSettings: merged.siteSettings });
    return uploadSyncData(merged);
  } finally { syncSuppressed = false; }
}

async function uploadPkHistoryIfLoggedIn() { return uploadSyncData(await currentSyncData()); }
async function uploadFavoritesIfLoggedIn() { return uploadSyncData(await currentSyncData()); }

function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => uploadSyncData(currentSyncData()).catch((error) => console.warn('Cloud sync failed', error)), SYNC_DEBOUNCE_MS);
}

function initializeFirebaseAutoSync() {
  if (syncInitialized || !chrome?.storage?.onChanged) return;
  syncInitialized = true;
  const keys = new Set(['pkHistory', 'favoriteFolders', 'favoritePrompts', 'favoriteSites', 'promptTemplates', 'sites', 'customSites', 'buttonConfig', 'disabledSites', 'siteSettings']);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (!syncSuppressed && (area === 'local' || area === 'sync') && Object.keys(changes).some((key) => keys.has(key))) scheduleSync();
  });
}

if (typeof window !== 'undefined') {
  initializeFirebaseAutoSync();
  window.firebaseSyncUpload = uploadPkHistory;
  window.firebaseSyncDownload = downloadPkHistory;
  window.firebaseSyncMergeAndUpload = mergeFromCloudAndUpload;
  window.firebaseSyncUploadIfLoggedIn = uploadPkHistoryIfLoggedIn;
  window.firebaseSyncUploadFavoritesIfLoggedIn = uploadFavoritesIfLoggedIn;
  window.firebaseSyncUploadFavoriteFolders = uploadFavoriteFolders;
}
