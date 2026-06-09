/**
 * 前端 Stripe 订阅工具
 *
 * 使用前需在 firebaseConfig.js 中配置 cloudFunctionsBaseUrl（Cloud Functions 部署后的 URL 前缀）
 * 格式如：https://us-central1-aicompare-12989.cloudfunctions.net
 *
 * 对外暴露（挂载到 window）：
 *   window.getUserPlan()          → 返回 { plan: 'free'|'pro', planExpiresAt: string|null }
 *   window.startCheckout(priceId) → 打开 Stripe 付款页（新 Tab）
 *   window.STRIPE_PRICES          → 月付/年付 Price ID 常量
 */

// ─────────────────────────────────────────────────────────────────────────────
// 配置常量（请替换为你在 Stripe Dashboard 创建的真实 Price ID）
// ─────────────────────────────────────────────────────────────────────────────
const STRIPE_PRICES = {
  monthly: 'price_1SzxyyEKxBtGZOjfNr23r21W',
  yearly:  'price_1SzyXqEKxBtGZOjfLUxTMV3q',
};
const STRIPE_REQUEST_TIMEOUT_MS = 15000;
const STRIPE_RETRYABLE_STATUS_CODES = new Set([502, 503, 504]);
const STRIPE_RATE_LIMIT_PATTERNS = [
  /rate exceeded/i,
  /too many requests/i,
  /too many attempts/i,
  /too_many_attempts_try_later/i,
  /resource[_\s-]*exhausted/i,
  /quota exceeded/i,
];

async function ensureStripeI18nReady() {
  try {
    if (typeof window !== 'undefined' && typeof window.RuntimeI18n?.initializeRuntimeI18n === 'function') {
      await window.RuntimeI18n.initializeRuntimeI18n();
    }
  } catch (_) {
    // Ignore i18n initialization failures and fall back to browser locale text below.
  }
}

function getStripeMessage(key, fallback = '', substitutions = undefined) {
  try {
    if (typeof window !== 'undefined' && typeof window.RuntimeI18n?.getMessage === 'function') {
      return window.RuntimeI18n.getMessage(key, substitutions) || fallback;
    }
    if (typeof chrome !== 'undefined' && chrome.i18n?.getMessage) {
      return chrome.i18n.getMessage(key, substitutions) || fallback;
    }
  } catch (_) {
    // Ignore lookup errors and fall back to the provided text.
  }
  return fallback;
}

/**
 * 从 firebaseConfig.js 获取 Cloud Functions base URL
 * 默认格式：https://<region>-<projectId>.cloudfunctions.net
 */
function getCloudFunctionsBaseUrl() {
  if (typeof window !== 'undefined' && window.FirebaseConfig && window.FirebaseConfig.cloudFunctionsBaseUrl) {
    return window.FirebaseConfig.cloudFunctionsBaseUrl.replace(/\/$/, '');
  }
  if (typeof FirebaseConfig !== 'undefined' && FirebaseConfig.cloudFunctionsBaseUrl) {
    return FirebaseConfig.cloudFunctionsBaseUrl.replace(/\/$/, '');
  }
  // 默认 us-central1
  const projectId = (typeof window !== 'undefined' && window.FirebaseConfig?.projectId)
    || (typeof FirebaseConfig !== 'undefined' && FirebaseConfig.projectId)
    || 'aicompare-12989';
  return `https://us-central1-${projectId}.cloudfunctions.net`;
}

/**
 * 获取当前存储的 Firebase ID Token（复用 firebase-auth.js 中的逻辑）
 */
async function getFirebaseIdToken() {
  if (typeof window !== 'undefined' && typeof window.firebaseGetIdToken === 'function') {
    return window.firebaseGetIdToken();
  }
  const stored = await chrome.storage.local.get(['firebase_idToken', 'firebase_expiresAt']);
  if (stored.firebase_idToken && (stored.firebase_expiresAt || 0) > Date.now() + 60000) {
    return stored.firebase_idToken;
  }
  return null;
}

/**
 * 获取当前 Firebase UID
 */
async function getFirebaseUid() {
  if (typeof window !== 'undefined' && typeof window.firebaseGetCurrentUid === 'function') {
    return window.firebaseGetCurrentUid();
  }
  const stored = await chrome.storage.local.get('firebase_uid');
  return stored.firebase_uid || null;
}

async function getStripeSupportEmail() {
  try {
    if (typeof window !== 'undefined' && typeof window.AppConfigManager?.getContactInfo === 'function') {
      const contactInfo = await window.AppConfigManager.getContactInfo();
      const email = String(contactInfo?.email || '').trim();
      if (email) {
        return email;
      }
    }
  } catch (_) {
    // Ignore config lookup failures and fall back to the bundled address below.
  }
  return 'AIShortcuts@outlook.com';
}

async function parseFetchResponse(response) {
  const rawText = await response.text().catch(() => '');
  if (!rawText) {
    return { rawText: '', data: null };
  }

  try {
    return {
      rawText,
      data: JSON.parse(rawText)
    };
  } catch (_) {
    return {
      rawText,
      data: null
    };
  }
}

function getResponseErrorMessage(payload = {}) {
  const data = payload?.data;
  return String(
    data?.error?.message
    || data?.error
    || data?.message
    || data?.detail
    || payload?.rawText
    || ''
  ).trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createStripeHttpError(status, message = '') {
  const error = new Error(message || `HTTP ${status}`);
  error.status = Number(status) || 0;
  return error;
}

function shouldRetryStripeError(error) {
  const status = Number(error?.status || 0);
  return STRIPE_RETRYABLE_STATUS_CODES.has(status) || error?.name === 'AbortError';
}

function isStripeRateLimited(error) {
  const status = Number(error?.status || 0);
  const message = String(error?.message || error || '').trim();
  if (status === 429) {
    return true;
  }
  return STRIPE_RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(message));
}

async function normalizeStripeRequestError(error) {
  const supportEmail = await getStripeSupportEmail();
  const status = Number(error?.status || 0);
  await ensureStripeI18nReady();

  if (error?.name === 'AbortError') {
    return new Error(
      getStripeMessage(
        'stripeServiceTimeout',
        `Payment service timed out. Please try again in a moment. If it keeps failing, contact ${supportEmail}.`,
        [supportEmail]
      )
    );
  }

  if (isStripeRateLimited(error)) {
    return new Error(
      getStripeMessage(
        'stripeServiceRateLimited',
        `Payment requests are temporarily rate limited. Please wait a moment and try again. If it keeps failing, contact ${supportEmail}.`,
        [supportEmail]
      )
    );
  }

  if (status >= 500) {
    return new Error(
      getStripeMessage(
        'stripeServiceUnavailable',
        `Payment service is temporarily unavailable (HTTP ${status}). Please try again later. If it keeps failing, contact ${supportEmail}.`,
        [String(status), supportEmail]
      )
    );
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error || 'Unknown error'));
}

async function fetchStripeFunctionJson(path, {
  method = 'GET',
  idToken = '',
  body = undefined,
  timeoutMs = STRIPE_REQUEST_TIMEOUT_MS,
  retries = 1
} = {}) {
  const baseUrl = getCloudFunctionsBaseUrl();
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {})
        },
        body,
        signal: controller?.signal
      });

      const payload = await parseFetchResponse(response);
      if (response.ok) {
        return payload.data || {};
      }

      const error = createStripeHttpError(
        response.status,
        getResponseErrorMessage(payload) || `HTTP ${response.status}`
      );
      lastError = error;
      if (attempt < retries && shouldRetryStripeError(error)) {
        await sleep(400 * (attempt + 1));
        continue;
      }
      throw error;
    } catch (error) {
      lastError = error;
      if (attempt < retries && shouldRetryStripeError(error)) {
        await sleep(400 * (attempt + 1));
        continue;
      }
      throw error;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  throw lastError || new Error('Unknown checkout error');
}

// ─────────────────────────────────────────────────────────────────────────────
// 核心：从 Firestore 读取用户 plan（直接使用 REST API，无需 SDK）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 从 Firestore 读取当前用户的订阅计划
 * @returns {{ plan: 'free'|'pro', planExpiresAt: string|null }}
 */
async function getUserPlan() {
  try {
    const uid = await getFirebaseUid();
    if (!uid) return { plan: 'free', planExpiresAt: null };

    const config = (typeof window !== 'undefined' && window.FirebaseConfig)
      || (typeof FirebaseConfig !== 'undefined' && FirebaseConfig)
      || null;
    if (!config?.projectId || !config?.apiKey) return { plan: 'free', planExpiresAt: null };

    const idToken = await getFirebaseIdToken();
    if (!idToken) return { plan: 'free', planExpiresAt: null };

    const url = `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/(default)/documents/users/${uid}?key=${config.apiKey}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${idToken}` },
    });

    if (!res.ok) return { plan: 'free', planExpiresAt: null };

    const doc = await res.json();
    const fields = doc.fields || {};
    const plan = fields.plan?.stringValue || 'free';

    let planExpiresAt = null;
    if (fields.planExpiresAt?.timestampValue) {
      planExpiresAt = fields.planExpiresAt.timestampValue;
    }

    // 本地验证到期
    const isExpired = planExpiresAt && new Date(planExpiresAt) < new Date();
    const effectivePlan = (plan === 'pro' && !isExpired) ? 'pro' : 'free';

    // 缓存到 local storage（5 分钟有效）
    await chrome.storage.local.set({
      _planCache: JSON.stringify({ plan: effectivePlan, planExpiresAt }),
      _planCacheAt: Date.now(),
    });

    return { plan: effectivePlan, planExpiresAt };
  } catch (e) {
    console.warn('[stripe-payment] getUserPlan error:', e);
    // 读取缓存兜底
    return getCachedPlan();
  }
}

/**
 * 读取本地缓存的 plan（缓存 5 分钟有效，离线或出错时使用）
 */
async function getCachedPlan() {
  try {
    const stored = await chrome.storage.local.get(['_planCache', '_planCacheAt']);
    const cacheAge = Date.now() - (stored._planCacheAt || 0);
    if (stored._planCache && cacheAge < 5 * 60 * 1000) {
      return JSON.parse(stored._planCache);
    }
  } catch (_) {}
  return { plan: 'free', planExpiresAt: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// 核心：发起 Stripe Checkout
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 调用 Cloud Function 创建 Checkout Session，并在新 Tab 中打开付款页
 * @param {string} priceId  Stripe Price ID（月付或年付）
 */
async function startCheckout(priceId) {
  const idToken = await getFirebaseIdToken();
  if (!idToken) {
    throw new Error('请先登录谷歌账号后再升级 Pro');
  }

  let response = null;
  try {
    response = await fetchStripeFunctionJson('/createCheckoutSession', {
      method: 'POST',
      idToken,
      body: JSON.stringify({ priceId }),
      retries: 1
    });
  } catch (error) {
    throw await normalizeStripeRequestError(error);
  }

  const url = String(response?.url || '').trim();
  if (!url) throw new Error('No checkout URL returned from server');

  // Chrome 扩展中用 chrome.tabs.create 打开付款页
  if (typeof chrome !== 'undefined' && chrome.tabs) {
    chrome.tabs.create({ url });
  } else {
    window.open(url, '_blank');
  }
}

/**
 * 打开 Stripe 客户门户（管理订阅、更改付款方式、取消等）
 * 需要在 Cloud Functions 中额外实现 createPortalSession（可选）
 */
async function openCustomerPortal() {
  const idToken = await getFirebaseIdToken();
  if (!idToken) throw new Error('请先登录');

  let response = null;
  try {
    response = await fetchStripeFunctionJson('/createPortalSession', {
      method: 'POST',
      idToken,
      retries: 1
    });
  } catch (error) {
    throw await normalizeStripeRequestError(error);
  }

  const url = String(response?.url || '').trim();
  if (typeof chrome !== 'undefined' && chrome.tabs) {
    chrome.tabs.create({ url });
  } else {
    window.open(url, '_blank');
  }
}

async function listInvoices() {
  const idToken = await getFirebaseIdToken();
  if (!idToken) {
    throw new Error('Please sign in first');
  }

  try {
    return await fetchStripeFunctionJson('/listInvoices', {
      method: 'GET',
      idToken,
      retries: 1
    });
  } catch (error) {
    throw await normalizeStripeRequestError(error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 挂载到 window
// ─────────────────────────────────────────────────────────────────────────────
if (typeof window !== 'undefined') {
  window.STRIPE_PRICES = STRIPE_PRICES;
  // 覆盖 baseConfig.js 中定义的代理，直接使用真实实现
  window.getUserPlan = getUserPlan;
  window._getUserPlanImpl = getUserPlan;
  window.getCachedPlan = getCachedPlan;
  window.startCheckout = startCheckout;
  window.openCustomerPortal = openCustomerPortal;
  window.listInvoices = listInvoices;
}
