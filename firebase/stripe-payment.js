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

  const baseUrl = getCloudFunctionsBaseUrl();
  const res = await fetch(`${baseUrl}/createCheckoutSession`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ priceId }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  const { url } = await res.json();
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

  const baseUrl = getCloudFunctionsBaseUrl();
  const res = await fetch(`${baseUrl}/createPortalSession`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  const { url } = await res.json();
  if (typeof chrome !== 'undefined' && chrome.tabs) {
    chrome.tabs.create({ url });
  } else {
    window.open(url, '_blank');
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
}
