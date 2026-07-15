/**
 * Firebase 认证（REST API），用于 Chrome 扩展，无需放宽 CSP
 */
const FIREBASE_AUTH_STORAGE_KEYS = {
  uid: 'firebase_uid',
  email: 'firebase_email',
  displayName: 'firebase_displayName',
  photoURL: 'firebase_photoURL',
  idToken: 'firebase_idToken',
  refreshToken: 'firebase_refreshToken',
  expiresAt: 'firebase_expiresAt',
  updatedAt: 'firebase_auth_updated_at',
};
const FIREBASE_AUTH_RATE_LIMIT_PATTERNS = [
  /rate exceeded/i,
  /too many requests/i,
  /too many attempts/i,
  /too_many_attempts_try_later/i,
  /resource[_\s-]*exhausted/i,
  /quota exceeded/i,
];

async function ensureFirebaseAuthI18nReady() {
  try {
    if (typeof window !== 'undefined' && typeof window.RuntimeI18n?.initializeRuntimeI18n === 'function') {
      await window.RuntimeI18n.initializeRuntimeI18n();
    }
  } catch (_) {
    // Ignore i18n initialization failures and fall back to browser locale text below.
  }
}

function getFirebaseAuthMessage(key, fallback = '', substitutions = undefined) {
  try {
    if (typeof window !== 'undefined' && typeof window.RuntimeI18n?.getMessage === 'function') {
      return window.RuntimeI18n.getMessage(key, substitutions) || fallback;
    }
    if (typeof chrome !== 'undefined' && chrome.i18n?.getMessage) {
      return chrome.i18n.getMessage(key, substitutions) || fallback;
    }
  } catch (_) {
    // Ignore i18n lookup failures and fall back to the provided text.
  }
  return fallback;
}

function isFirebaseAuthRateLimited(message = '') {
  const text = String(message || '').trim();
  if (!text) {
    return false;
  }
  return FIREBASE_AUTH_RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(text));
}

async function normalizeFirebaseAuthError(error, fallback = 'Authentication failed') {
  const rawMessage = String(error?.message || error || '').trim();
  const rawCode = String(error?.code || '').trim();
  if (rawCode) {
    await ensureFirebaseAuthI18nReady();
    const codeMessages = {
      INVALID_EMAIL: getFirebaseAuthMessage('firebaseAuthInvalidEmail', 'Please enter a valid email address.'),
      EMAIL_CODE_COOLDOWN: getFirebaseAuthMessage('membershipEmailCodeCooldown', 'Please wait before requesting another code.'),
      EMAIL_CODE_EXPIRED: getFirebaseAuthMessage('membershipEmailCodeExpired', 'Verification code expired. Please request a new code.'),
      EMAIL_CODE_TOO_MANY_ATTEMPTS: getFirebaseAuthMessage('membershipEmailCodeTooManyAttempts', 'Too many verification attempts. Please request a new code.'),
      EMAIL_CODE_INVALID: getFirebaseAuthMessage('membershipEmailCodeInvalid', 'Incorrect verification code.'),
      EMAIL_CODE_INVALID_FORMAT: getFirebaseAuthMessage('membershipEmailCodeInvalidFormat', 'Please enter the 6-digit verification code.'),
      EMAIL_SENDER_NOT_CONFIGURED: getFirebaseAuthMessage('membershipEmailLoginUnavailable', 'Email verification sign-in is unavailable right now.'),
      EMAIL_AUTH_SECRET_NOT_CONFIGURED: getFirebaseAuthMessage('membershipEmailLoginUnavailable', 'Email verification sign-in is unavailable right now.'),
    };
    if (codeMessages[rawCode]) {
      return new Error(codeMessages[rawCode]);
    }
  }
  if (isFirebaseAuthRateLimited(rawMessage)) {
    await ensureFirebaseAuthI18nReady();
    return new Error(
      getFirebaseAuthMessage(
        'firebaseAuthRateLimited',
        'Sign-in requests are temporarily rate limited. Please wait a few minutes and try again.'
      )
    );
  }
  if (error instanceof Error) {
    return error;
  }
  return new Error(rawMessage || fallback);
}

async function createFirebaseApiError(data, fallback = 'Authentication failed') {
  const rawMessage = String(data?.error?.message || data?.error || '').trim();
  await ensureFirebaseAuthI18nReady();
  const code = rawMessage.split(/\s|:/)[0] || '';
  const mappedMessages = {
    EMAIL_EXISTS: getFirebaseAuthMessage('firebaseAuthEmailExists', 'This email is already registered. Please sign in or reset your password.'),
    EMAIL_NOT_FOUND: getFirebaseAuthMessage('firebaseAuthEmailNotFound', 'No account was found for this email. Please create an account or check the email you used at checkout.'),
    INVALID_LOGIN_CREDENTIALS: getFirebaseAuthMessage('firebaseAuthInvalidCredentials', 'Email or password is incorrect.'),
    INVALID_PASSWORD: getFirebaseAuthMessage('firebaseAuthInvalidCredentials', 'Email or password is incorrect.'),
    USER_DISABLED: getFirebaseAuthMessage('firebaseAuthUserDisabled', 'This account has been disabled. Please contact support.'),
    WEAK_PASSWORD: getFirebaseAuthMessage('firebaseAuthWeakPassword', 'Please use a password with at least 6 characters.'),
    INVALID_EMAIL: getFirebaseAuthMessage('firebaseAuthInvalidEmail', 'Please enter a valid email address.'),
    MISSING_PASSWORD: getFirebaseAuthMessage('firebaseAuthMissingPassword', 'Please enter a password.'),
    OPERATION_NOT_ALLOWED: getFirebaseAuthMessage('firebaseAuthEmailPasswordDisabled', 'Email/password sign-in is not enabled yet. Please contact support.'),
  };
  const message = mappedMessages[code] || rawMessage || fallback;
  return normalizeFirebaseAuthError(new Error(message), fallback);
}

async function getStoredAuth() {
  const result = await chrome.storage.local.get([
    FIREBASE_AUTH_STORAGE_KEYS.uid,
    FIREBASE_AUTH_STORAGE_KEYS.email,
    FIREBASE_AUTH_STORAGE_KEYS.displayName,
    FIREBASE_AUTH_STORAGE_KEYS.photoURL,
    FIREBASE_AUTH_STORAGE_KEYS.idToken,
    FIREBASE_AUTH_STORAGE_KEYS.refreshToken,
    FIREBASE_AUTH_STORAGE_KEYS.expiresAt,
  ]);
  return {
    uid: result[FIREBASE_AUTH_STORAGE_KEYS.uid] || null,
    email: result[FIREBASE_AUTH_STORAGE_KEYS.email] || null,
    displayName: result[FIREBASE_AUTH_STORAGE_KEYS.displayName] || null,
    photoURL: result[FIREBASE_AUTH_STORAGE_KEYS.photoURL] || null,
    idToken: result[FIREBASE_AUTH_STORAGE_KEYS.idToken] || null,
    refreshToken: result[FIREBASE_AUTH_STORAGE_KEYS.refreshToken] || null,
    expiresAt: result[FIREBASE_AUTH_STORAGE_KEYS.expiresAt] || 0,
  };
}

async function setStoredAuth(uid, idToken, refreshToken, expiresInSeconds, email, displayName = undefined, photoURL = undefined) {
  const expiresAt = Date.now() + (expiresInSeconds || 3600) * 1000;
  const existingProfile = await chrome.storage.local.get([
    FIREBASE_AUTH_STORAGE_KEYS.displayName,
    FIREBASE_AUTH_STORAGE_KEYS.photoURL,
  ]);
  await chrome.storage.local.set({
    [FIREBASE_AUTH_STORAGE_KEYS.uid]: uid || null,
    [FIREBASE_AUTH_STORAGE_KEYS.email]: email || null,
    [FIREBASE_AUTH_STORAGE_KEYS.displayName]: displayName === undefined
      ? (existingProfile[FIREBASE_AUTH_STORAGE_KEYS.displayName] || null)
      : (displayName || null),
    [FIREBASE_AUTH_STORAGE_KEYS.photoURL]: photoURL === undefined
      ? (existingProfile[FIREBASE_AUTH_STORAGE_KEYS.photoURL] || null)
      : (photoURL || null),
    [FIREBASE_AUTH_STORAGE_KEYS.idToken]: idToken || null,
    [FIREBASE_AUTH_STORAGE_KEYS.refreshToken]: refreshToken || null,
    [FIREBASE_AUTH_STORAGE_KEYS.expiresAt]: expiresInSeconds ? expiresAt : 0,
    [FIREBASE_AUTH_STORAGE_KEYS.updatedAt]: Date.now(),
  });
}

async function clearStoredAuth() {
  await chrome.storage.local.remove(Object.values(FIREBASE_AUTH_STORAGE_KEYS));
  await chrome.storage.local.set({
    [FIREBASE_AUTH_STORAGE_KEYS.updatedAt]: Date.now(),
  });
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

function isFirebaseEmailLinkSignInEnabled() {
  try {
    if (typeof window !== 'undefined' && window.FirebaseConfig) {
      return Boolean(window.FirebaseConfig.emailLinkAuthEnabled);
    }
    if (typeof FirebaseConfig !== 'undefined') {
      return Boolean(FirebaseConfig.emailLinkAuthEnabled);
    }
  } catch (_) {
    // Fall through to the disabled default.
  }
  return false;
}

function getFirebaseEmailLinkContinueUrl(config) {
  const authDomain = String(config?.authDomain || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (!authDomain) {
    return 'https://example.com/';
  }
  return `https://${authDomain}/`;
}

function getFirebaseAuthBackendBaseUrl() {
  if (typeof window !== 'undefined' && typeof window.FirebaseConfig?.getCloudFunctionsBaseUrl === 'function') {
    return String(window.FirebaseConfig.getCloudFunctionsBaseUrl() || '').trim().replace(/\/+$/, '');
  }
  if (typeof FirebaseConfig !== 'undefined' && typeof FirebaseConfig.getCloudFunctionsBaseUrl === 'function') {
    return String(FirebaseConfig.getCloudFunctionsBaseUrl() || '').trim().replace(/\/+$/, '');
  }
  if (typeof window !== 'undefined' && window.FirebaseConfig?.cloudFunctionsBaseUrl) {
    return String(window.FirebaseConfig.cloudFunctionsBaseUrl || '').trim().replace(/\/+$/, '');
  }
  if (typeof FirebaseConfig !== 'undefined' && FirebaseConfig.cloudFunctionsBaseUrl) {
    return String(FirebaseConfig.cloudFunctionsBaseUrl || '').trim().replace(/\/+$/, '');
  }
  return '';
}

async function fetchFirebaseAuthBackendJson(path, body = {}) {
  const baseUrl = getFirebaseAuthBackendBaseUrl();
  if (!baseUrl) {
    throw new Error(
      getFirebaseAuthMessage(
        'membershipEmailLoginUnavailable',
        'Email verification sign-in is unavailable right now.'
      )
    );
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  const rawText = await response.text().catch(() => '');
  let data = null;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch (_) {
    data = null;
  }
  if (!response.ok) {
    const message = String(data?.error?.message || data?.error || rawText || '').trim();
    const error = new Error(message || `HTTP ${response.status}`);
    if (data?.code) {
      error.code = String(data.code);
    }
    throw await normalizeFirebaseAuthError(error, 'Authentication failed');
  }
  return data || {};
}

async function fetchFirebaseAuthBackendStatus(path) {
  const baseUrl = getFirebaseAuthBackendBaseUrl();
  if (!baseUrl) {
    return { enabled: false };
  }
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      cache: 'no-store'
    });
    if (!response.ok) {
      return { enabled: false, status: response.status };
    }
    const data = await response.json().catch(() => ({}));
    return {
      ...data,
      enabled: Boolean(data?.enabled)
    };
  } catch (error) {
    return {
      enabled: false,
      error: error?.message || String(error)
    };
  }
}

let firebaseEmailSignInStatusPromise = null;

async function getFirebaseEmailSignInStatus(options = {}) {
  const configEnabled = isFirebaseEmailLinkSignInEnabled();
  if (!configEnabled) {
    return { enabled: false, configEnabled: false };
  }
  if (!options.forceRefresh && firebaseEmailSignInStatusPromise) {
    return firebaseEmailSignInStatusPromise;
  }
  firebaseEmailSignInStatusPromise = fetchFirebaseAuthBackendStatus('/auth/email-code/status')
    .then((status) => ({
      ...status,
      configEnabled,
      enabled: Boolean(configEnabled && status?.enabled)
    }));
  return firebaseEmailSignInStatusPromise;
}

function extractFirebaseEmailLinkCode(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }

  try {
    const url = new URL(raw);
    return url.searchParams.get('oobCode') || url.searchParams.get('code') || raw;
  } catch (_) {
    const match = raw.match(/[?&#]oobCode=([^&#]+)/i) || raw.match(/[?&#]code=([^&#]+)/i);
    if (match && match[1]) {
      try {
        return decodeURIComponent(match[1]);
      } catch (_) {
        return match[1];
      }
    }
  }

  return raw;
}

function extractFirebaseEmailVerificationCode(value) {
  const extracted = extractFirebaseEmailLinkCode(value);
  const match = String(extracted || '').match(/\b\d{6}\b/);
  return match ? match[0] : String(extracted || '').trim();
}

async function createFirebaseEmailLinkError(data, fallback = 'Authentication failed') {
  const rawMessage = String(data?.error?.message || data?.error || '').trim();
  const code = rawMessage.split(/\s|:/)[0] || '';
  if (code === 'OPERATION_NOT_ALLOWED') {
    await ensureFirebaseAuthI18nReady();
    return new Error(
      getFirebaseAuthMessage(
        'membershipEmailLoginUnavailable',
        'Email verification sign-in is unavailable right now.'
      )
    );
  }
  return createFirebaseApiError(data, fallback);
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

async function hydrateStoredProfile() {
  const config = await getAuthConfigAsync();
  if (!config || !config.apiKey) {
    return getStoredAuth();
  }

  const auth = await getStoredAuth();
  if (!auth.uid || (auth.displayName && auth.photoURL)) {
    return auth;
  }

  const idToken = await getIdToken();
  if (!idToken) {
    return auth;
  }

  try {
    const url = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(config.apiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });
    if (!res.ok) {
      return auth;
    }
    const data = await res.json();
    const user = Array.isArray(data?.users) ? data.users[0] : null;
    if (!user) {
      return auth;
    }
    const nextAuth = {
      ...auth,
      email: user.email || auth.email || null,
      displayName: user.displayName || auth.displayName || null,
      photoURL: user.photoUrl || user.photoURL || auth.photoURL || null,
      idToken,
    };
    await chrome.storage.local.set({
      [FIREBASE_AUTH_STORAGE_KEYS.email]: nextAuth.email,
      [FIREBASE_AUTH_STORAGE_KEYS.displayName]: nextAuth.displayName,
      [FIREBASE_AUTH_STORAGE_KEYS.photoURL]: nextAuth.photoURL,
      [FIREBASE_AUTH_STORAGE_KEYS.idToken]: nextAuth.idToken,
    });
    return nextAuth;
  } catch (_) {
    return auth;
  }
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
    throw await createFirebaseApiError(data, '注册失败');
  }
  await setStoredAuth(
    data.localId,
    data.idToken,
    data.refreshToken,
    parseInt(data.expiresIn, 10) || 3600,
    data.email || null,
    data.displayName || null,
    data.photoUrl || null
  );
  return { uid: data.localId, email: data.email, displayName: data.displayName || null, photoURL: data.photoUrl || null };
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
    throw await createFirebaseApiError(data, '登录失败');
  }
  await setStoredAuth(
    data.localId,
    data.idToken,
    data.refreshToken,
    parseInt(data.expiresIn, 10) || 3600,
    data.email || null,
    data.displayName || null,
    data.photoUrl || null
  );
  return { uid: data.localId, email: data.email, displayName: data.displayName || null, photoURL: data.photoUrl || null };
}

/**
 * 发送设置/重置密码邮件。用于 Stripe 先创建 Firebase 用户、用户稍后用同邮箱设置密码的场景。
 */
async function firebaseSendPasswordResetEmail(email) {
  const config = await getAuthConfigAsync();
  if (!config || !config.apiKey) {
    throw new Error('云端同步暂未开放，请联系扩展维护者');
  }
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(config.apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestType: 'PASSWORD_RESET',
      email: email.trim(),
    }),
  });
  const data = await res.json();
  if (data.error) {
    throw await createFirebaseApiError(data, '发送密码设置邮件失败');
  }
  return { email: data.email || email.trim() };
}

/**
 * 发送邮箱免密登录链接。用户可将邮件中的链接或 oobCode 粘贴回扩展完成登录。
 */
async function firebaseSendEmailSignInLink(email) {
  const config = await getAuthConfigAsync();
  if (!config || !config.apiKey) {
    throw new Error('云端同步暂未开放，请联系扩展维护者');
  }
  if (!isFirebaseEmailLinkSignInEnabled()) {
    throw new Error(
      getFirebaseAuthMessage(
        'membershipEmailLoginUnavailable',
        'Email verification sign-in is unavailable right now.'
      )
    );
  }
  const normalizedEmail = String(email || '').trim();
  if (!normalizedEmail) {
    throw new Error(getFirebaseAuthMessage('membershipEmailRequired', 'Please enter your email address.'));
  }
  const data = await fetchFirebaseAuthBackendJson('/auth/email-code/send', {
    email: normalizedEmail
  });
  return { email: data.email || normalizedEmail };
}

async function firebaseSignInWithCustomToken(customToken, fallbackEmail = '', fallbackUid = '') {
  const config = await getAuthConfigAsync();
  if (!config || !config.apiKey) {
    throw new Error('云端同步暂未开放，请联系扩展维护者');
  }
  const token = String(customToken || '').trim();
  if (!token) {
    throw new Error(getFirebaseAuthMessage('membershipEmailAuthFailed', 'Authentication failed. Please try again.'));
  }
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(config.apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token,
      returnSecureToken: true,
    }),
  });
  const data = await res.json();
  if (data.error) {
    throw await createFirebaseApiError(data, 'Email sign-in failed');
  }
  const resolvedUid = String(data.localId || fallbackUid || '').trim();
  if (!resolvedUid || !data.idToken || !data.refreshToken) {
    throw new Error(getFirebaseAuthMessage('membershipEmailAuthFailed', 'Authentication failed. Please try again.'));
  }
  await setStoredAuth(
    resolvedUid,
    data.idToken,
    data.refreshToken,
    parseInt(data.expiresIn, 10) || 3600,
    data.email || fallbackEmail || null,
    data.displayName || null,
    data.photoUrl || null
  );
  return {
    uid: resolvedUid,
    email: data.email || fallbackEmail || null,
    displayName: data.displayName || null,
    photoURL: data.photoUrl || null,
  };
}

/**
 * 使用邮件中的 oobCode / 链接完成免密登录
 */
async function firebaseSignInWithEmailLink(email, codeOrLink) {
  const config = await getAuthConfigAsync();
  if (!config || !config.apiKey) {
    throw new Error('云端同步暂未开放，请联系扩展维护者');
  }
  if (!isFirebaseEmailLinkSignInEnabled()) {
    throw new Error(
      getFirebaseAuthMessage(
        'membershipEmailLoginUnavailable',
        'Email verification sign-in is unavailable right now.'
      )
    );
  }
  const normalizedEmail = String(email || '').trim();
  if (!normalizedEmail) {
    throw new Error(getFirebaseAuthMessage('membershipEmailRequired', 'Please enter your email address.'));
  }
  const code = extractFirebaseEmailVerificationCode(codeOrLink);
  if (!code) {
    throw new Error(
      getFirebaseAuthMessage(
        'membershipEmailVerifyHelper',
        'Paste the verification link or code from the email you received.'
      )
    );
  }
  const result = await fetchFirebaseAuthBackendJson('/auth/email-code/verify', {
    email: normalizedEmail,
    code
  });
  return firebaseSignInWithCustomToken(result.customToken, result.email || normalizedEmail, result.uid || '');
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
    throw await normalizeFirebaseAuthError(e, '谷歌登录失败');
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
    throw await createFirebaseApiError(data, 'Firebase 登录失败');
  }
  const email = (data.email != null) ? data.email : (data.user?.email) || null;
  const displayName = data.displayName || data.user?.displayName || null;
  const photoURL = data.photoUrl || data.user?.photoUrl || data.user?.photoURL || null;
  await setStoredAuth(
    data.localId,
    data.idToken,
    data.refreshToken,
    parseInt(data.expiresIn, 10) || 3600,
    email,
    displayName,
    photoURL
  );
  return { uid: data.localId, email, displayName, photoURL };
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
  window.firebaseSendPasswordResetEmail = firebaseSendPasswordResetEmail;
  window.firebaseSendEmailSignInLink = firebaseSendEmailSignInLink;
  window.firebaseSignInWithEmailLink = firebaseSignInWithEmailLink;
  window.firebaseSignInWithCustomToken = firebaseSignInWithCustomToken;
  window.firebaseSignInWithGoogle = firebaseSignInWithGoogle;
  window.firebaseSignOut = firebaseSignOut;
  window.firebaseGetIdToken = getIdToken;
  window.firebaseGetCurrentUid = getCurrentUid;
  window.firebaseIsLoggedIn = isLoggedIn;
  window.firebaseGetStoredAuth = getStoredAuth;
  window.firebaseHydrateStoredProfile = hydrateStoredProfile;
  window.firebaseClearStoredAuth = clearStoredAuth;
  window.firebaseIsEmailLinkSignInEnabled = isFirebaseEmailLinkSignInEnabled;
  window.firebaseGetEmailSignInStatus = getFirebaseEmailSignInStatus;
}
