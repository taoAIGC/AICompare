/**
 * Firebase 认证（REST API），用于 Chrome 扩展，无需放宽 CSP
 */
const FIREBASE_AUTH_STORAGE_KEYS = {
  uid: 'firebase_uid',
  email: 'firebase_email',
  idToken: 'firebase_idToken',
  refreshToken: 'firebase_refreshToken',
  expiresAt: 'firebase_expiresAt',
};

async function getStoredAuth() {
  const result = await chrome.storage.local.get([
    FIREBASE_AUTH_STORAGE_KEYS.uid,
    FIREBASE_AUTH_STORAGE_KEYS.email,
    FIREBASE_AUTH_STORAGE_KEYS.idToken,
    FIREBASE_AUTH_STORAGE_KEYS.refreshToken,
    FIREBASE_AUTH_STORAGE_KEYS.expiresAt,
  ]);
  return {
    uid: result[FIREBASE_AUTH_STORAGE_KEYS.uid] || null,
    email: result[FIREBASE_AUTH_STORAGE_KEYS.email] || null,
    idToken: result[FIREBASE_AUTH_STORAGE_KEYS.idToken] || null,
    refreshToken: result[FIREBASE_AUTH_STORAGE_KEYS.refreshToken] || null,
    expiresAt: result[FIREBASE_AUTH_STORAGE_KEYS.expiresAt] || 0,
  };
}

async function setStoredAuth(uid, idToken, refreshToken, expiresInSeconds, email) {
  const expiresAt = Date.now() + (expiresInSeconds || 3600) * 1000;
  await chrome.storage.local.set({
    [FIREBASE_AUTH_STORAGE_KEYS.uid]: uid || null,
    [FIREBASE_AUTH_STORAGE_KEYS.email]: email || null,
    [FIREBASE_AUTH_STORAGE_KEYS.idToken]: idToken || null,
    [FIREBASE_AUTH_STORAGE_KEYS.refreshToken]: refreshToken || null,
    [FIREBASE_AUTH_STORAGE_KEYS.expiresAt]: expiresInSeconds ? expiresAt : 0,
  });
}

async function clearStoredAuth() {
  await chrome.storage.local.remove(Object.values(FIREBASE_AUTH_STORAGE_KEYS));
}

async function getAuthConfigAsync() {
  // 统一使用扩展内置的云端配置（由维护者填写 firebaseConfig.js），用户无需单独配置
  if (typeof window !== 'undefined' && window.FirebaseConfig && window.FirebaseConfig.apiKey) {
    return window.FirebaseConfig;
  }
  if (typeof FirebaseConfig !== 'undefined' && FirebaseConfig.apiKey) {
    return FirebaseConfig;
  }
  return null;
}

/**
 * 获取当前可用的 idToken（若过期则尝试刷新）
 */
async function getIdToken() {
  const config = await getAuthConfigAsync();
  if (!config || !config.apiKey) return null;

  const auth = await getStoredAuth();
  if (!auth.uid || !auth.refreshToken) return null;

  if (auth.idToken && auth.expiresAt > Date.now() + 60000) {
    return auth.idToken;
  }

  const url = `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(config.apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: auth.refreshToken,
    }),
  });
  if (!res.ok) {
    await clearStoredAuth();
    return null;
  }
  const data = await res.json();
  await setStoredAuth(auth.uid, data.id_token, data.refresh_token || auth.refreshToken, 3600, auth.email);
  return data.id_token;
}

/**
 * 注册（邮箱+密码）
 */
async function firebaseSignUp(email, password) {
  const config = await getAuthConfigAsync();
  if (!config || !config.apiKey) {
    throw new Error('云端同步暂未开放，请联系扩展维护者');
  }
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(config.apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: email.trim(),
      password,
      returnSecureToken: true,
    }),
  });
  const data = await res.json();
  if (data.error) {
    throw new Error(data.error.message || '注册失败');
  }
  await setStoredAuth(data.localId, data.idToken, data.refreshToken, parseInt(data.expiresIn, 10) || 3600, data.email || null);
  return { uid: data.localId, email: data.email };
}

/**
 * 登录（邮箱+密码）
 */
async function firebaseSignIn(email, password) {
  const config = await getAuthConfigAsync();
  if (!config || !config.apiKey) {
    throw new Error('云端同步暂未开放，请联系扩展维护者');
  }
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(config.apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: email.trim(),
      password,
      returnSecureToken: true,
    }),
  });
  const data = await res.json();
  if (data.error) {
    throw new Error(data.error.message || '登录失败');
  }
  await setStoredAuth(data.localId, data.idToken, data.refreshToken, parseInt(data.expiresIn, 10) || 3600, data.email || null);
  return { uid: data.localId, email: data.email };
}

/**
 * 使用谷歌账号登录（打开谷歌登录页，获取 token 后调用 Firebase signInWithIdp）
 * 需在 manifest 中声明 "identity" 权限；OAuth 客户端需添加重定向 URI：https://<扩展ID>.chromiumapp.org/
 */
async function firebaseSignInWithGoogle() {
  const config = await getAuthConfigAsync();
  if (!config || !config.apiKey) {
    throw new Error('云端同步暂未开放，请联系扩展维护者');
  }
  const clientId = config.googleClientId;
  if (!clientId || clientId.includes('xxxxxxxxxx')) {
    throw new Error('请先在 firebaseConfig.js 中填写正确的 googleClientId（Firebase 控制台 → Google 登录 → Web 客户端 ID）');
  }
  if (typeof chrome === 'undefined' || !chrome.identity || !chrome.identity.launchWebAuthFlow) {
    throw new Error('当前环境不支持谷歌登录，请在扩展选项页中操作');
  }
  const redirectUri = `https://${chrome.runtime.id}.chromiumapp.org/`;
  const scope = encodeURIComponent('openid email profile');
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token&scope=${scope}`;
  let callbackUrl;
  try {
    callbackUrl = await new Promise((resolve, reject) => {
      chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (url) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || '用户取消或登录失败'));
          return;
        }
        resolve(url || '');
      });
    });
  } catch (e) {
    throw e;
  }
  if (!callbackUrl || !callbackUrl.startsWith(redirectUri)) {
    throw new Error('谷歌登录未返回有效结果');
  }
  const hash = callbackUrl.includes('#') ? callbackUrl.slice(callbackUrl.indexOf('#') + 1) : '';
  const params = new URLSearchParams(hash);
  const accessToken = params.get('access_token');
  if (!accessToken) {
    throw new Error('未获取到谷歌访问令牌，请重试');
  }
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${encodeURIComponent(config.apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestUri: redirectUri,
      postBody: `access_token=${encodeURIComponent(accessToken)}&providerId=google.com`,
      returnSecureToken: true,
    }),
  });
  const data = await res.json();
  if (data.error) {
    throw new Error(data.error.message || 'Firebase 登录失败');
  }
  const email = (data.email != null) ? data.email : (data.user?.email) || null;
  await setStoredAuth(data.localId, data.idToken, data.refreshToken, parseInt(data.expiresIn, 10) || 3600, email);
  return { uid: data.localId, email };
}

/**
 * 登出（清除本地存储的 token）
 */
async function firebaseSignOut() {
  await clearStoredAuth();
}

/**
 * 当前是否已登录（仅检查本地存储的 uid）
 */
async function isLoggedIn() {
  const auth = await getStoredAuth();
  return !!(auth.uid && auth.refreshToken);
}

/**
 * 获取当前用户 uid（用于同步）
 */
async function getCurrentUid() {
  const auth = await getStoredAuth();
  if (auth.uid && auth.refreshToken) return auth.uid;
  return null;
}

if (typeof window !== 'undefined') {
  window.firebaseSignUp = firebaseSignUp;
  window.firebaseSignIn = firebaseSignIn;
  window.firebaseSignInWithGoogle = firebaseSignInWithGoogle;
  window.firebaseSignOut = firebaseSignOut;
  window.firebaseGetIdToken = getIdToken;
  window.firebaseGetCurrentUid = getCurrentUid;
  window.firebaseIsLoggedIn = isLoggedIn;
  window.firebaseGetStoredAuth = getStoredAuth;
  window.firebaseClearStoredAuth = clearStoredAuth;
}
