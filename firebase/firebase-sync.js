/**
 * 将历史记录（pkHistory）与收藏（favoritePrompts、favoriteSites）同步到 Firestore
 * 依赖 firebase-auth.js 提供 getIdToken / getCurrentUid，以及 Firebase 配置
 */
// 每个用户一个文档：users/{uid}，字段 pkHistoryJson、favoritePromptsJson、favoriteSitesJson、updatedAt

async function getSyncConfig() {
  // 统一使用扩展内置的云端配置（firebaseConfig.js）
  if (typeof window !== 'undefined' && window.FirebaseConfig && window.FirebaseConfig.projectId) {
    return window.FirebaseConfig;
  }
  if (typeof FirebaseConfig !== 'undefined' && FirebaseConfig.projectId) {
    return FirebaseConfig;
  }
  return null;
}

/**
 * 获取当前页或 background 的 getIdToken（兼容 options 与 iframe 等）
 */
async function getIdTokenForSync() {
  if (typeof window !== 'undefined' && window.firebaseGetIdToken) {
    return window.firebaseGetIdToken();
  }
  const auth = await chrome.storage.local.get(['firebase_idToken', 'firebase_expiresAt', 'firebase_refreshToken', 'firebase_uid']);
  if (!auth.firebase_uid || !auth.firebase_refreshToken) return null;
  const expiresAt = auth.firebase_expiresAt || 0;
  if (auth.firebase_idToken && expiresAt > Date.now() + 60000) {
    return auth.firebase_idToken;
  }
  return null;
}

/**
 * 在非 options 页面刷新 token（通过 options 或 background 注入的脚本无法直接调 fetch 到 securetoken）
 * 这里统一用 storage 里已有的 idToken；若过期则同步会失败，用户需在 options 重新打开以刷新 token
 */
async function getToken() {
  const token = await getIdTokenForSync();
  if (token) return token;
  const auth = await chrome.storage.local.get(['firebase_idToken', 'firebase_expiresAt']);
  if (auth.firebase_idToken && (auth.firebase_expiresAt || 0) > Date.now() + 60000) {
    return auth.firebase_idToken;
  }
  return null;
}

function firestoreDocPath(projectId, uid) {
  if (!projectId || !uid) return null;
  return `projects/${projectId}/databases/(default)/documents/users/${uid}`;
}

/**
 * 上传 favoriteFolders 到 Firestore
 */
async function uploadFavoriteFolders(favoriteFolders) {
  const uid = await (typeof window !== 'undefined' && window.firebaseGetCurrentUid ? window.firebaseGetCurrentUid() : (async () => {
    const r = await chrome.storage.local.get('firebase_uid');
    return r.firebase_uid || null;
  })());
  if (!uid) return { success: false, reason: 'not_logged_in' };

  const config = await getSyncConfig();
  const projectId = config ? config.projectId : null;
  if (!projectId) return { success: false, reason: 'no_config' };

  const idToken = await getToken();
  if (!idToken) return { success: false, reason: 'token_expired' };

  const path = firestoreDocPath(projectId, uid);
  const url = `https://firestore.googleapis.com/v1/${path}?updateMask.fieldPaths=favoriteFoldersJson&updateMask.fieldPaths=updatedAt`;

  const payload = {
    fields: {
      favoriteFoldersJson: { stringValue: JSON.stringify(favoriteFolders || []) },
      updatedAt: { integerValue: String(Date.now()) },
    },
  };

  let res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (res.status === 404) {
    const createUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/users?documentId=${encodeURIComponent(uid)}`;
    res = await fetch(createUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`,
      },
      body: JSON.stringify({ fields: payload.fields }),
    });
  }

  if (!res.ok) {
    console.warn('Firebase sync upload favoriteFolders failed', res.status);
    return { success: false, reason: 'upload_failed', status: res.status };
  }
  return { success: true };
}

/**
 * 合并收藏文件夹：按 id 去重，保留云端优先
 */
function mergeFavoriteFolders(localList, cloudList) {
  const byId = new Map();
  for (const item of localList || []) {
    if (item && item.id) byId.set(item.id, item);
  }
  for (const item of cloudList || []) {
    if (item && item.id) byId.set(item.id, item);
  }
  return Array.from(byId.values()).sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
}

/**
 * 上传 pkHistory 到 Firestore
 */
async function uploadPkHistory(pkHistory) {
  const uid = await (typeof window !== 'undefined' && window.firebaseGetCurrentUid ? window.firebaseGetCurrentUid() : (async () => {
    const r = await chrome.storage.local.get('firebase_uid');
    return r.firebase_uid || null;
  })());
  if (!uid) return { success: false, reason: 'not_logged_in' };

  const config = await getSyncConfig();
  const projectId = config ? config.projectId : null;
  if (!projectId) return { success: false, reason: 'no_config' };

  const idToken = await getToken();
  if (!idToken) return { success: false, reason: 'token_expired' };

  const path = firestoreDocPath(projectId, uid);
  const url = `https://firestore.googleapis.com/v1/${path}?updateMask.fieldPaths=pkHistoryJson&updateMask.fieldPaths=updatedAt`;

  const payload = {
    fields: {
      pkHistoryJson: { stringValue: JSON.stringify(pkHistory || []) },
      updatedAt: { integerValue: String(Date.now()) },
    },
  };

  let res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (res.status === 404) {
    const createUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/users?documentId=${encodeURIComponent(uid)}`;
    res = await fetch(createUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`,
      },
      body: JSON.stringify({ fields: payload.fields }),
    });
  }

  if (!res.ok) {
    const err = await res.text();
    console.warn('Firebase sync upload failed', res.status, err);
    return { success: false, reason: 'upload_failed', status: res.status };
  }
  await chrome.storage.local.set({ firebase_lastSyncAt: Date.now() });
  return { success: true };
}

/**
 * 从 Firestore 下载 pkHistory
 */
async function downloadPkHistory() {
  const uid = await (typeof window !== 'undefined' && window.firebaseGetCurrentUid ? window.firebaseGetCurrentUid() : (async () => {
    const r = await chrome.storage.local.get('firebase_uid');
    return r.firebase_uid || null;
  })());
  if (!uid) return null;

  const config = await getSyncConfig();
  const projectId = config ? config.projectId : null;
  if (!projectId) return null;

  const idToken = await getToken();
  if (!idToken) return null;

  const path = firestoreDocPath(projectId, uid);
  const url = `https://firestore.googleapis.com/v1/${path}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${idToken}` },
  });

  if (res.status === 404) return [];
  if (!res.ok) {
    console.warn('Firebase sync download failed', res.status);
    return null;
  }

  const data = await res.json();
  const fields = data.fields || {};
  const jsonField = fields.pkHistoryJson;
  if (!jsonField || !jsonField.stringValue) return [];
  try {
    return JSON.parse(jsonField.stringValue);
  } catch (e) {
    return [];
  }
}

/**
 * 从 Firestore 下载整份用户文档（历史 + 收藏提示词 + 收藏站点），一次请求
 */
async function downloadUserData() {
  const uid = await (typeof window !== 'undefined' && window.firebaseGetCurrentUid ? window.firebaseGetCurrentUid() : (async () => {
    const r = await chrome.storage.local.get('firebase_uid');
    return r.firebase_uid || null;
  })());
  if (!uid) return null;

  const config = await getSyncConfig();
  const projectId = config ? config.projectId : null;
  if (!projectId) return null;

  const idToken = await getToken();
  if (!idToken) return null;

  const path = firestoreDocPath(projectId, uid);
  const res = await fetch(`https://firestore.googleapis.com/v1/${path}`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${idToken}` },
  });

  if (res.status === 404) {
    return { pkHistory: [], favoritePrompts: [], favoriteSites: [], favoriteFolders: [] };
  }
  if (!res.ok) {
    console.warn('Firebase sync download user data failed', res.status);
    return null;
  }

  const data = await res.json();
  const fields = data.fields || {};
  const parseJson = (field) => {
    if (!field || !field.stringValue) return [];
    try {
      return JSON.parse(field.stringValue);
    } catch (e) {
      return [];
    }
  };
  return {
    pkHistory: parseJson(fields.pkHistoryJson),
    favoritePrompts: parseJson(fields.favoritePromptsJson),
    favoriteSites: parseJson(fields.favoriteSitesJson),
    favoriteFolders: parseJson(fields.favoriteFoldersJson),
  };
}

/**
 * 合并收藏提示词：两边取并集去重（按字符串）
 */
function mergeFavoritePrompts(localList, cloudList) {
  const set = new Set([...(localList || []), ...(cloudList || [])].filter((s) => typeof s === 'string' && s.trim()));
  return Array.from(set);
}

/**
 * 合并收藏站点：按 name 去重，保留云端优先（便于换电脑后以云端为准）
 */
function mergeFavoriteSites(localList, cloudList) {
  const byName = new Map();
  for (const item of localList || []) {
    if (item && item.name) byName.set(item.name, item);
  }
  for (const item of cloudList || []) {
    if (item && item.name) byName.set(item.name, item);
  }
  return Array.from(byName.values());
}

/**
 * 上传收藏（favoritePrompts、favoriteSites）到 Firestore
 */
async function uploadFavorites(favoritePrompts, favoriteSites) {
  const uid = await (typeof window !== 'undefined' && window.firebaseGetCurrentUid ? window.firebaseGetCurrentUid() : (async () => {
    const r = await chrome.storage.local.get('firebase_uid');
    return r.firebase_uid || null;
  })());
  if (!uid) return { success: false, reason: 'not_logged_in' };

  const config = await getSyncConfig();
  const projectId = config ? config.projectId : null;
  if (!projectId) return { success: false, reason: 'no_config' };

  const idToken = await getToken();
  if (!idToken) return { success: false, reason: 'token_expired' };

  const path = firestoreDocPath(projectId, uid);
  const url = `https://firestore.googleapis.com/v1/${path}?updateMask.fieldPaths=favoritePromptsJson&updateMask.fieldPaths=favoriteSitesJson&updateMask.fieldPaths=updatedAt`;

  const payload = {
    fields: {
      favoritePromptsJson: { stringValue: JSON.stringify(favoritePrompts || []) },
      favoriteSitesJson: { stringValue: JSON.stringify(favoriteSites || []) },
      updatedAt: { integerValue: String(Date.now()) },
    },
  };

  let res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (res.status === 404) {
    const createUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/users?documentId=${encodeURIComponent(uid)}`;
    res = await fetch(createUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`,
      },
      body: JSON.stringify({ fields: { ...payload.fields, pkHistoryJson: { stringValue: '[]' } } }),
    });
  }

  if (!res.ok) {
    console.warn('Firebase sync upload favorites failed', res.status);
    return { success: false, reason: 'upload_failed', status: res.status };
  }
  return { success: true };
}

/**
 * 合并云端与本地 pkHistory：按 id 去重，保留较新的一条（按 timestamp）
 */
function mergePkHistory(localList, cloudList) {
  const byId = new Map();
  for (const item of localList) {
    if (item && item.id) byId.set(item.id, item);
  }
  for (const item of cloudList) {
    if (!item || !item.id) continue;
    const existing = byId.get(item.id);
    if (!existing || (item.timestamp && (existing.timestamp || 0) < item.timestamp)) {
      byId.set(item.id, item);
    }
  }
  return Array.from(byId.values()).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

/**
 * 登录后：拉取云端数据与本地合并，再写回本地并上传（历史 + 收藏提示词 + 收藏站点）
 */
async function mergeFromCloudAndUpload() {
  const cloud = await downloadUserData();
  if (cloud === null) return { success: false, reason: 'download_failed' };

  const localHistory = (await chrome.storage.local.get('pkHistory')).pkHistory || [];
  const mergedHistory = mergePkHistory(localHistory, cloud.pkHistory);
  const maxHistory = 500;
  const limitedHistory = mergedHistory.slice(0, maxHistory);
  await chrome.storage.local.set({ pkHistory: limitedHistory });

  const syncData = await chrome.storage.sync.get(['favoritePrompts', 'favoriteSites']);
  const localPrompts = syncData.favoritePrompts || [];
  const localSites = syncData.favoriteSites || [];
  const mergedPrompts = mergeFavoritePrompts(localPrompts, cloud.favoritePrompts);
  const mergedSites = mergeFavoriteSites(localSites, cloud.favoriteSites);
  await chrome.storage.sync.set({ favoritePrompts: mergedPrompts, favoriteSites: mergedSites });

  // Merge favorite folders
  const localFolders = (await chrome.storage.local.get('favoriteFolders')).favoriteFolders || [];
  const mergedFolders = mergeFavoriteFolders(localFolders, cloud.favoriteFolders || []);
  await chrome.storage.local.set({ favoriteFolders: mergedFolders });

  const upHistory = await uploadPkHistory(limitedHistory);
  const upFavorites = await uploadFavorites(mergedPrompts, mergedSites);
  const upFolders = await uploadFavoriteFolders(mergedFolders);
  await chrome.storage.local.set({ firebase_lastSyncAt: Date.now() });
  return upHistory.success ? upHistory : (upFavorites.success ? upFavorites : upFolders);
}

/**
 * 在本地写入 pkHistory 后调用：若已登录则上传到云端
 */
async function uploadPkHistoryIfLoggedIn() {
  const uid = await (typeof window !== 'undefined' && window.firebaseGetCurrentUid ? window.firebaseGetCurrentUid() : (async () => {
    const r = await chrome.storage.local.get('firebase_uid');
    return r.firebase_uid || null;
  })());
  if (!uid) return;

  const config = await getSyncConfig();
  if (!config || !config.projectId) return;

  const data = await chrome.storage.local.get(['pkHistory', 'favoriteFolders']);
  await uploadPkHistory(data.pkHistory || []);
  await uploadFavoriteFolders(data.favoriteFolders || []);
}

/**
 * 在本地修改收藏（提示词或站点）后调用：若已登录则上传到云端
 */
async function uploadFavoritesIfLoggedIn() {
  const uid = await (typeof window !== 'undefined' && window.firebaseGetCurrentUid ? window.firebaseGetCurrentUid() : (async () => {
    const r = await chrome.storage.local.get('firebase_uid');
    return r.firebase_uid || null;
  })());
  if (!uid) return;

  const config = await getSyncConfig();
  if (!config || !config.projectId) return;

  const { favoritePrompts = [], favoriteSites = [] } = await chrome.storage.sync.get(['favoritePrompts', 'favoriteSites']);
  await uploadFavorites(favoritePrompts, favoriteSites);
}

if (typeof window !== 'undefined') {
  window.firebaseSyncUpload = uploadPkHistory;
  window.firebaseSyncDownload = downloadPkHistory;
  window.firebaseSyncMergeAndUpload = mergeFromCloudAndUpload;
  window.firebaseSyncUploadIfLoggedIn = uploadPkHistoryIfLoggedIn;
  window.firebaseSyncUploadFavoritesIfLoggedIn = uploadFavoritesIfLoggedIn;
  window.firebaseSyncMergePkHistory = mergePkHistory;
  window.firebaseSyncUploadFavoriteFolders = uploadFavoriteFolders;
}
