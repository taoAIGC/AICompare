require('dotenv').config();

const express = require('express');
const admin = require('firebase-admin');
const Stripe = require('stripe');
const crypto = require('crypto');

const app = express();
const port = Number(process.env.PORT || 8790);
const dailyFreeLimit = Math.max(0, Number(process.env.OFFICIAL_API_DAILY_FREE_LIMIT || 100) || 100);
const adminSessionOrigin = String(process.env.ADMIN_SESSION_ORIGIN || '').trim();
const adminSessionSecret = String(process.env.ADMIN_SESSION_SECRET || process.env.STRIPE_WEBHOOK_SECRET || '').trim();
const adminSessionCookieName = 'ai_compare_admin_session';
const adminSessionTtlSeconds = Math.max(300, Number(process.env.ADMIN_SESSION_TTL_SECONDS || 12 * 60 * 60) || (12 * 60 * 60));
const adminUsername = String(process.env.ADMIN_USERNAME || '').trim();
const adminPasswordHash = String(process.env.ADMIN_PASSWORD_HASH || '').trim();
const ADMIN_CLIENT_SCRIPT = String.raw`
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return char;
    }
  });
}

async function fetchAdminJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json'
    }
  });
  if (response.status === 401) {
    throw new Error('请先用管理员账号密码登录。');
  }
  if (response.status === 403) {
    throw new Error('当前管理员会话没有访问权限。');
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || ('请求失败: HTTP ' + response.status));
  }
  return response.json();
}

async function createAdminSession(username, password) {
  const response = await fetch('/api/admin/session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({ username, password })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || ('登录失败: HTTP ' + response.status));
  }
  return payload;
}

async function destroyAdminSession() {
  const response = await fetch('/api/admin/session', {
    method: 'DELETE',
    headers: { Accept: 'application/json' }
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || ('退出失败: HTTP ' + response.status));
  }
}

function getNextPath() {
  const next = new URLSearchParams(window.location.search).get('next') || '/admin';
  return next.startsWith('/admin') ? next : '/admin';
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('zh-CN');
}

function formatAmount(value, currency = 'usd') {
  const amount = Number(value || 0) / 100;
  const normalizedCurrency = String(currency || 'usd').toUpperCase();
  return normalizedCurrency + ' ' + amount.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('zh-CN', { hour12: false });
}

function renderCards(items) {
  return items.map((item) => (
    '<section class="card stat-card">'
      + '<div class="label">' + escapeHtml(item.label) + '</div>'
      + '<div class="value">' + escapeHtml(item.value) + '</div>'
      + (item.note ? '<div class="note">' + escapeHtml(item.note) + '</div>' : '')
    + '</section>'
  )).join('');
}

function renderEmptyRow(message, colSpan) {
  return '<tr><td colspan="' + colSpan + '" class="empty-cell">' + escapeHtml(message) + '</td></tr>';
}

async function loadOverview() {
  const [orderSummary, apiSummary] = await Promise.all([
    fetchAdminJson('/api/admin/orders/summary'),
    fetchAdminJson('/api/admin/api-usage/summary')
  ]);
  const cards = [
    { label: '当前有效 Pro', value: formatNumber(orderSummary.activeProUsers), note: '含 trialing / active' },
    { label: '近 30 天付费订单', value: formatNumber(orderSummary.thirtyDayPaidOrders), note: '按已支付发票统计' },
    { label: '今日 API 请求', value: formatNumber(apiSummary.today.totalRequests), note: 'free + pro + anonymous' },
    { label: '近 30 天 API 请求', value: formatNumber(apiSummary.last30Days.totalRequests), note: '事件聚合结果' }
  ];
  document.getElementById('overviewCards').innerHTML = renderCards(cards);
  document.getElementById('overviewJson').textContent = JSON.stringify({ orderSummary, apiSummary }, null, 2);
}

async function loadOrdersPage() {
  const [summary, listPayload, trendPayload] = await Promise.all([
    fetchAdminJson('/api/admin/orders/summary'),
    fetchAdminJson('/api/admin/orders/list?limit=20'),
    fetchAdminJson('/api/admin/orders/trend?days=30')
  ]);
  document.getElementById('ordersCards').innerHTML = renderCards([
    { label: '总会员档案', value: formatNumber(summary.totalMembers) },
    { label: '有效 Pro', value: formatNumber(summary.activeProUsers) },
    { label: '已取消未到期', value: formatNumber(summary.cancelingUsers) },
    { label: '已过期', value: formatNumber(summary.expiredUsers) },
    { label: '近 7 天收入', value: formatAmount(summary.revenue7d, summary.currency) },
    { label: '近 30 天收入', value: formatAmount(summary.revenue30d, summary.currency) }
  ]);

  const orders = Array.isArray(listPayload.orders) ? listPayload.orders : [];
  document.getElementById('ordersTableBody').innerHTML = orders.length
    ? orders.map((item) => (
      '<tr>'
        + '<td>' + escapeHtml(item.uid || '-') + '</td>'
        + '<td>' + escapeHtml(item.email || '-') + '</td>'
        + '<td>' + escapeHtml(item.plan || '-') + '</td>'
        + '<td>' + escapeHtml(item.subscriptionStatus || '-') + '</td>'
        + '<td>' + escapeHtml(item.invoiceStatus || '-') + '</td>'
        + '<td>' + escapeHtml(item.invoicePaid ? '是' : '否') + '</td>'
        + '<td>' + escapeHtml(formatAmount(item.amountPaid, item.currency)) + '</td>'
        + '<td>' + escapeHtml(formatDate(item.invoiceCreatedAt || item.planExpiresAt)) + '</td>'
      + '</tr>'
    )).join('')
    : renderEmptyRow('暂无订单数据', 8);

  const trend = Array.isArray(trendPayload.days) ? trendPayload.days : [];
  document.getElementById('ordersTrendBody').innerHTML = trend.length
    ? trend.map((item) => (
      '<tr>'
        + '<td>' + escapeHtml(item.date) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.newSubscriptions)) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.renewedSubscriptions)) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.canceledSubscriptions)) + '</td>'
        + '<td>' + escapeHtml(formatAmount(item.revenueAmount, trendPayload.currency)) + '</td>'
      + '</tr>'
    )).join('')
    : renderEmptyRow('近 30 天没有 Stripe 趋势数据', 5);
}

async function loadApiUsagePage() {
  const [summary, trendPayload, topDaysPayload] = await Promise.all([
    fetchAdminJson('/api/admin/api-usage/summary'),
    fetchAdminJson('/api/admin/api-usage/trend?days=30'),
    fetchAdminJson('/api/admin/api-usage/top-days?limit=10')
  ]);
  document.getElementById('apiCards').innerHTML = renderCards([
    { label: '今日总请求', value: formatNumber(summary.today.totalRequests) },
    { label: '今日活跃登录用户', value: formatNumber(summary.today.activeUsers) },
    { label: '今日活跃匿名设备', value: formatNumber(summary.today.activeAnonymousClients) },
    { label: '近 30 天总请求', value: formatNumber(summary.last30Days.totalRequests) }
  ]);

  const trend = Array.isArray(trendPayload.days) ? trendPayload.days : [];
  document.getElementById('apiTrendBody').innerHTML = trend.length
    ? trend.map((item) => (
      '<tr>'
        + '<td>' + escapeHtml(item.date) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.free.requests)) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.pro.requests)) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.anonymous.requests)) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.totalRequests)) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.activeUsers)) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.activeAnonymousClients)) + '</td>'
      + '</tr>'
    )).join('')
    : renderEmptyRow('暂无 API 趋势数据', 7);

  const topDays = Array.isArray(topDaysPayload.days) ? topDaysPayload.days : [];
  document.getElementById('apiTopDaysBody').innerHTML = topDays.length
    ? topDays.map((item) => (
      '<tr>'
        + '<td>' + escapeHtml(item.date) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.totalRequests)) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.free.requests)) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.pro.requests)) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.anonymous.requests)) + '</td>'
      + '</tr>'
    )).join('')
    : renderEmptyRow('暂无峰值日数据', 5);
}

async function bootAdminPage(pageName) {
  const usernameInput = document.getElementById('usernameInput');
  const passwordInput = document.getElementById('passwordInput');
  const saveButton = document.getElementById('saveTokenButton');
  const clearButton = document.getElementById('clearTokenButton');
  const statusEl = document.getElementById('tokenStatus');

  saveButton.addEventListener('click', async () => {
    try {
      statusEl.textContent = '正在登录...';
      await createAdminSession(usernameInput.value.trim(), passwordInput.value);
      statusEl.textContent = '管理员登录成功，正在刷新页面。';
      window.location.reload();
    } catch (error) {
      statusEl.textContent = error.message || String(error);
    }
  });
  clearButton.addEventListener('click', async () => {
    try {
      statusEl.textContent = '正在退出...';
      await destroyAdminSession();
      statusEl.textContent = '管理员会话已清空。';
    } catch (error) {
      statusEl.textContent = error.message || String(error);
    }
    usernameInput.value = '';
    passwordInput.value = '';
  });

  try {
    if (pageName === 'overview') await loadOverview();
    if (pageName === 'orders') await loadOrdersPage();
    if (pageName === 'apiUsage') await loadApiUsagePage();
    statusEl.textContent = '数据已刷新，管理员会话有效。';
  } catch (error) {
    statusEl.textContent = error.message || String(error);
  }
}

async function bootAdminLoginPage() {
  const usernameInput = document.getElementById('usernameInput');
  const passwordInput = document.getElementById('passwordInput');
  const saveButton = document.getElementById('saveTokenButton');
  const clearButton = document.getElementById('clearTokenButton');
  const statusEl = document.getElementById('tokenStatus');

  saveButton.addEventListener('click', async () => {
    try {
      statusEl.textContent = '正在登录...';
      await createAdminSession(usernameInput.value.trim(), passwordInput.value);
      statusEl.textContent = '管理员登录成功，正在跳转。';
      window.location.href = getNextPath();
    } catch (error) {
      statusEl.textContent = error.message || String(error);
    }
  });

  clearButton.addEventListener('click', async () => {
    usernameInput.value = '';
    passwordInput.value = '';
    try {
      await destroyAdminSession();
    } catch (_) {
      // Ignore logout errors on login screen.
    }
    statusEl.textContent = '已清空输入，并尝试退出旧会话。';
  });
}
`;

const ADMIN_STYLES = `
  :root {
    --bg: #f5efe3;
    --panel: rgba(255, 252, 247, 0.9);
    --panel-strong: #fffaf2;
    --text: #24190f;
    --muted: #7f6853;
    --accent: #b65a2d;
    --accent-soft: rgba(182, 90, 45, 0.14);
    --border: rgba(85, 58, 36, 0.12);
    --shadow: 0 18px 50px rgba(77, 50, 31, 0.10);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "Avenir Next", "PingFang SC", "Helvetica Neue", sans-serif;
    background:
      radial-gradient(circle at top left, rgba(255, 201, 153, 0.28), transparent 32%),
      radial-gradient(circle at top right, rgba(246, 170, 116, 0.24), transparent 24%),
      linear-gradient(180deg, #f8f2e8 0%, #f2eadc 100%);
    color: var(--text);
    min-height: 100vh;
  }
  a { color: inherit; text-decoration: none; }
  .shell {
    width: min(1200px, calc(100vw - 40px));
    margin: 0 auto;
    padding: 32px 0 48px;
  }
  .hero {
    display: grid;
    grid-template-columns: 1.3fr 1fr;
    gap: 20px;
    align-items: stretch;
    margin-bottom: 22px;
  }
  .hero-panel, .token-panel, .card {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 24px;
    box-shadow: var(--shadow);
    backdrop-filter: blur(16px);
  }
  .hero-panel {
    padding: 28px;
    position: relative;
    overflow: hidden;
  }
  .hero-panel::after {
    content: "";
    position: absolute;
    inset: auto -40px -40px auto;
    width: 180px;
    height: 180px;
    border-radius: 999px;
    background: radial-gradient(circle, rgba(182, 90, 45, 0.22), transparent 70%);
  }
  .eyebrow {
    display: inline-flex;
    align-items: center;
    padding: 6px 12px;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 12px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  h1 {
    margin: 16px 0 10px;
    font-size: 40px;
    line-height: 1.02;
    letter-spacing: -0.04em;
  }
  .hero-copy {
    margin: 0;
    font-size: 15px;
    line-height: 1.7;
    color: var(--muted);
    max-width: 54ch;
  }
  .hero-links {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 22px;
  }
  .nav-link, button {
    border: 0;
    cursor: pointer;
    border-radius: 999px;
    padding: 12px 18px;
    font-size: 14px;
    transition: transform 180ms ease, box-shadow 180ms ease, background-color 180ms ease;
  }
  .nav-link {
    background: #fff;
    border: 1px solid var(--border);
  }
  .nav-link.active {
    background: var(--accent);
    color: #fff;
    box-shadow: 0 12px 24px rgba(182, 90, 45, 0.22);
  }
  .nav-link:hover, button:hover {
    transform: translateY(-1px);
  }
  .token-panel {
    padding: 22px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .token-panel h2 {
    margin: 0;
    font-size: 18px;
  }
  .token-panel p {
    margin: 0;
    color: var(--muted);
    line-height: 1.6;
    font-size: 14px;
  }
  .token-panel code {
    background: rgba(36, 25, 15, 0.06);
    padding: 2px 6px;
    border-radius: 6px;
  }
  textarea, input[type="text"], input[type="password"] {
    width: 100%;
    border-radius: 20px;
    border: 1px solid var(--border);
    padding: 16px;
    font: inherit;
    background: var(--panel-strong);
    color: var(--text);
  }
  textarea {
    min-height: 128px;
    resize: vertical;
  }
  .token-actions {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }
  .token-actions button:first-child {
    background: var(--accent);
    color: #fff;
  }
  .token-actions button:last-child {
    background: #fff;
    color: var(--text);
    border: 1px solid var(--border);
  }
  .status {
    min-height: 22px;
    font-size: 13px;
    color: var(--muted);
  }
  .section-title {
    margin: 28px 0 14px;
    font-size: 18px;
    letter-spacing: -0.02em;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 14px;
  }
  .stat-card {
    padding: 18px 18px 16px;
  }
  .stat-card .label {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
  }
  .stat-card .value {
    margin-top: 10px;
    font-size: 30px;
    font-weight: 700;
    letter-spacing: -0.04em;
  }
  .stat-card .note {
    margin-top: 8px;
    color: var(--muted);
    font-size: 13px;
  }
  .panel {
    padding: 20px;
    margin-top: 14px;
  }
  .panel h3 {
    margin: 0 0 14px;
    font-size: 17px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
  }
  th, td {
    text-align: left;
    padding: 12px 10px;
    border-bottom: 1px solid var(--border);
    vertical-align: top;
  }
  th {
    color: var(--muted);
    font-weight: 600;
    font-size: 13px;
  }
  .empty-cell {
    color: var(--muted);
    text-align: center;
    padding: 24px;
  }
  pre {
    margin: 0;
    background: #20150d;
    color: #f6efe6;
    border-radius: 20px;
    padding: 18px;
    font-size: 12px;
    overflow: auto;
  }
  .footer-note {
    margin-top: 18px;
    color: var(--muted);
    font-size: 13px;
    line-height: 1.6;
  }
  @media (max-width: 900px) {
    .hero {
      grid-template-columns: 1fr;
    }
    .shell {
      width: min(100vw - 24px, 1200px);
      padding-top: 18px;
    }
    h1 {
      font-size: 32px;
    }
  }
`;

let adminInitialized = false;
let db = null;

function parseCsvEnv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function initializeFirebaseAdmin() {
  if (adminInitialized) return true;

  const serviceAccountJson = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  const serviceAccountPath = String(process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '').trim();
  try {
    if (serviceAccountPath) {
      admin.initializeApp({
        credential: admin.credential.cert(require(serviceAccountPath))
      });
    } else if (serviceAccountJson) {
      admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(serviceAccountJson))
      });
    } else {
      admin.initializeApp({
        projectId: process.env.FIREBASE_PROJECT_ID || 'aicompare-12989'
      });
    }
    db = admin.firestore();
    adminInitialized = true;
    return true;
  } catch (error) {
    console.warn('[ai-compare-backend] Firebase Admin is not configured:', error.message);
    return false;
  }
}

function requireFirebaseAdmin() {
  if (!initializeFirebaseAdmin() || !db) {
    const error = new Error('Firebase Admin is not configured');
    error.status = 500;
    throw error;
  }
}

function getStripe() {
  const secretKey = String(process.env.STRIPE_SECRET_KEY || '').trim();
  if (!secretKey) {
    const error = new Error('STRIPE_SECRET_KEY is not configured');
    error.status = 500;
    throw error;
  }
  return new Stripe(secretKey, { apiVersion: '2024-06-20' });
}

function getCorsOrigin(req) {
  const origin = String(req.headers.origin || '').trim();
  if (!origin) return '*';
  return origin;
}

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', getCorsOrigin(req));
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-AI-Compare-Locale, X-AI-Compare-Client-Id');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (adminSessionOrigin) {
    res.setHeader('Content-Security-Policy', `frame-ancestors 'self' ${adminSessionOrigin}`);
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

app.use('/stripeWebhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '2mb' }));

function asyncRoute(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      const status = Number(error.status || error.statusCode || 500) || 500;
      if (status >= 500) {
        console.error(error);
      }
      res.status(status).json({ error: error.message || String(error) });
    }
  };
}

function parseCookieHeader(cookieHeader = '') {
  return String(cookieHeader || '')
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce((acc, item) => {
      const separatorIndex = item.indexOf('=');
      if (separatorIndex <= 0) return acc;
      const key = item.slice(0, separatorIndex).trim();
      const value = item.slice(separatorIndex + 1).trim();
      acc[key] = decodeURIComponent(value);
      return acc;
    }, {});
}

function toBase64Url(value) {
  return Buffer.from(String(value || ''), 'utf8').toString('base64url');
}

function fromBase64Url(value) {
  return Buffer.from(String(value || ''), 'base64url').toString('utf8');
}

function signAdminSessionPayload(payload) {
  if (!adminSessionSecret) {
    const error = new Error('ADMIN_SESSION_SECRET is not configured');
    error.status = 500;
    throw error;
  }
  return crypto
    .createHmac('sha256', adminSessionSecret)
    .update(String(payload || ''))
    .digest('base64url');
}

function createAdminSessionToken(claims) {
  const payload = toBase64Url(JSON.stringify(claims));
  const signature = signAdminSessionPayload(payload);
  return `${payload}.${signature}`;
}

function parseAdminSessionToken(token) {
  const normalizedToken = String(token || '').trim();
  if (!normalizedToken || !normalizedToken.includes('.')) {
    return null;
  }
  const [payload, signature] = normalizedToken.split('.');
  if (!payload || !signature) {
    return null;
  }
  const expectedSignature = signAdminSessionPayload(payload);
  if (signature !== expectedSignature) {
    return null;
  }
  try {
    const claims = JSON.parse(fromBase64Url(payload));
    if (!claims || typeof claims !== 'object') {
      return null;
    }
    if (Number(claims.exp || 0) <= Math.floor(Date.now() / 1000)) {
      return null;
    }
    return claims;
  } catch (_) {
    return null;
  }
}

function setAdminSessionCookie(res, token) {
  const maxAge = Math.max(300, Math.floor(adminSessionTtlSeconds));
  const cookieParts = [
    `${adminSessionCookieName}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`
  ];
  if (process.env.NODE_ENV === 'production') {
    cookieParts.push('Secure');
  }
  res.setHeader('Set-Cookie', cookieParts.join('; '));
}

function clearAdminSessionCookie(res) {
  const cookieParts = [
    `${adminSessionCookieName}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0'
  ];
  if (process.env.NODE_ENV === 'production') {
    cookieParts.push('Secure');
  }
  res.setHeader('Set-Cookie', cookieParts.join('; '));
}

async function requireUser(req) {
  requireFirebaseAdmin();
  const authorization = String(req.headers.authorization || '').trim();
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    const error = new Error('Authentication required');
    error.status = 401;
    throw error;
  }
  try {
    return await admin.auth().verifyIdToken(match[1]);
  } catch (error) {
    error.status = 401;
    throw error;
  }
}

async function getOptionalUser(req) {
  const authorization = String(req.headers.authorization || '').trim();
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return null;
  }

  requireFirebaseAdmin();
  try {
    return await admin.auth().verifyIdToken(match[1]);
  } catch (error) {
    error.status = 401;
    throw error;
  }
}

function safeCompare(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function hashAdminPassword(password) {
  return crypto.createHash('sha256').update(String(password || ''), 'utf8').digest('hex');
}

function assertAdminCredentialsConfigured() {
  if (!adminUsername || !adminPasswordHash) {
    const error = new Error('Admin username/password is not configured');
    error.status = 500;
    throw error;
  }
}

function verifyAdminCredentials(username, password) {
  assertAdminCredentialsConfigured();
  const normalizedUsername = String(username || '').trim();
  const passwordHash = hashAdminPassword(password);
  if (!safeCompare(normalizedUsername, adminUsername) || !safeCompare(passwordHash, adminPasswordHash)) {
    const error = new Error('Invalid admin username or password');
    error.status = 401;
    throw error;
  }
  return { username: normalizedUsername };
}

async function requireAdmin(req) {
  const cookies = parseCookieHeader(req.headers.cookie || '');
  const sessionClaims = parseAdminSessionToken(cookies[adminSessionCookieName] || '');
  if (sessionClaims) {
    if (!safeCompare(String(sessionClaims.username || ''), adminUsername)) {
      const error = new Error('Admin access required');
      error.status = 403;
      throw error;
    }
    return sessionClaims;
  }
  const error = new Error('Authentication required');
  error.status = 401;
  throw error;
}

function getAnonymousClientId(req) {
  return String(req.headers['x-ai-compare-client-id'] || req.body?.anonymousClientId || '').trim();
}

function getAnonymousUsageDocId(clientId) {
  return crypto
    .createHash('sha256')
    .update(String(clientId || ''))
    .digest('hex');
}

function normalizeLocale(locale = '') {
  return String(locale || '').trim().replace('-', '_').toLowerCase();
}

function shouldMeterLocale(locale = '') {
  return !normalizeLocale(locale).startsWith('zh');
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function getDateKey(date = new Date()) {
  return new Date(date).toISOString().slice(0, 10);
}

function getRecentDateKeys(days, endDate = new Date()) {
  const safeDays = Math.max(1, Number(days) || 1);
  const end = new Date(endDate);
  end.setUTCHours(0, 0, 0, 0);
  const result = [];
  for (let index = safeDays - 1; index >= 0; index -= 1) {
    const current = new Date(end);
    current.setUTCDate(current.getUTCDate() - index);
    result.push(getDateKey(current));
  }
  return result;
}

function getTimestampSeconds(value) {
  if (!value) return 0;
  if (typeof value.toDate === 'function') return Math.floor(value.toDate().getTime() / 1000);
  if (typeof value.seconds === 'number') return value.seconds;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

function timestampToIso(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (typeof value.seconds === 'number') return new Date(value.seconds * 1000).toISOString();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function toUnixSeconds(value) {
  if (!value) return 0;
  if (typeof value === 'number') return Math.floor(value);
  if (typeof value.toDate === 'function') return Math.floor(value.toDate().getTime() / 1000);
  if (typeof value.seconds === 'number') return value.seconds;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

function startOfDayUnix(dateKey) {
  return Math.floor(new Date(`${dateKey}T00:00:00.000Z`).getTime() / 1000);
}

function endOfDayUnix(dateKey) {
  return Math.floor(new Date(`${dateKey}T23:59:59.999Z`).getTime() / 1000);
}

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function parseDateRange(req, defaultDays = 30) {
  const dateTo = String(req.query?.dateTo || '').trim() || getTodayKey();
  const dateFrom = String(req.query?.dateFrom || '').trim()
    || getDateKey(Date.now() - (Math.max(1, defaultDays) - 1) * 24 * 60 * 60 * 1000);
  return { dateFrom, dateTo };
}

function isDateKeyInRange(dateKey, dateFrom, dateTo) {
  return String(dateKey || '') >= String(dateFrom || '') && String(dateKey || '') <= String(dateTo || '');
}

async function getUserPlan(uid) {
  requireFirebaseAdmin();
  const snap = await db.collection('users').doc(uid).get();
  const data = snap.exists ? snap.data() || {} : {};
  const expiresAtSeconds = getTimestampSeconds(data.planExpiresAt);
  const isActive = data.plan === 'pro' && (!expiresAtSeconds || expiresAtSeconds > Math.floor(Date.now() / 1000));
  return {
    plan: isActive ? 'pro' : 'free',
    planExpiresAt: data.planExpiresAt || null,
    stripeCustomerId: data.stripeCustomerId || ''
  };
}

async function consumeOfficialApiUsage(uid, locale) {
  if (!shouldMeterLocale(locale)) {
    return { billingEnabled: false, plan: 'free', limit: dailyFreeLimit, used: 0, remaining: Number.POSITIVE_INFINITY };
  }

  const plan = await getUserPlan(uid);
  if (plan.plan === 'pro') {
    return { billingEnabled: true, plan: 'pro', limit: dailyFreeLimit, used: 0, remaining: Number.POSITIVE_INFINITY };
  }

  const dateKey = getTodayKey();
  const usageRef = db.collection('users').doc(uid).collection('usage').doc(dateKey);
  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(usageRef);
    const used = snap.exists ? Math.max(0, Number(snap.data().officialApiCount) || 0) : 0;
    if (used >= dailyFreeLimit) {
      const error = new Error(`You've used today's ${dailyFreeLimit} free official API requests. Upgrade to PRO or switch to your own API.`);
      error.status = 402;
      throw error;
    }
    const nextUsed = used + 1;
    transaction.set(usageRef, {
      officialApiCount: nextUsed,
      date: dateKey,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return {
      billingEnabled: true,
      plan: 'free',
      limit: dailyFreeLimit,
      used: nextUsed,
      remaining: Math.max(0, dailyFreeLimit - nextUsed)
    };
  });
}

async function consumeAnonymousOfficialApiUsage(clientId, locale) {
  if (!shouldMeterLocale(locale)) {
    return { billingEnabled: false, plan: 'anonymous', limit: dailyFreeLimit, used: 0, remaining: Number.POSITIVE_INFINITY };
  }

  const normalizedClientId = String(clientId || '').trim();
  if (!normalizedClientId) {
    const error = new Error('Anonymous client id is required');
    error.status = 400;
    throw error;
  }

  requireFirebaseAdmin();
  const dateKey = getTodayKey();
  const clientHash = getAnonymousUsageDocId(normalizedClientId);
  const usageRef = db.collection('anonymousUsage').doc(clientHash).collection('usage').doc(dateKey);
  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(usageRef);
    const used = snap.exists ? Math.max(0, Number(snap.data().officialApiCount) || 0) : 0;
    if (used >= dailyFreeLimit) {
      const error = new Error(`You've used today's ${dailyFreeLimit} free official API requests. Upgrade to PRO or switch to your own API.`);
      error.status = 402;
      throw error;
    }
    const nextUsed = used + 1;
    transaction.set(usageRef, {
      officialApiCount: nextUsed,
      date: dateKey,
      clientHash,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return {
      billingEnabled: true,
      plan: 'anonymous',
      limit: dailyFreeLimit,
      used: nextUsed,
      remaining: Math.max(0, dailyFreeLimit - nextUsed)
    };
  });
}

async function recordOfficialApiEvent({ uid = '', clientHash = '', userType = 'free', locale = '', model = '' } = {}) {
  requireFirebaseAdmin();
  const normalizedUserType = ['free', 'pro', 'anonymous'].includes(userType) ? userType : 'free';
  await db.collection('officialApiEvents').add({
    dateKey: getTodayKey(),
    uid: String(uid || ''),
    clientHash: String(clientHash || ''),
    userType: normalizedUserType,
    locale: String(locale || '').trim(),
    model: String(model || '').trim(),
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

function getSuccessUrl() {
  return process.env.STRIPE_SUCCESS_URL || 'https://example.com/payment-success';
}

function getCancelUrl() {
  return process.env.STRIPE_CANCEL_URL || 'https://example.com/payment-cancel';
}

function getExtensionMembershipUrl() {
  const extensionId = String(process.env.AI_COMPARE_EXTENSION_ID || 'hhkhgpadepocnmjfpohcmjdcgkmfnadi').trim();
  return `chrome-extension://${extensionId}/options/options.html#membership`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return char;
    }
  });
}

function getPaymentSuccessPageHtml() {
  const membershipUrl = escapeHtml(getExtensionMembershipUrl());
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment successful | AICompare</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f4ee;
      --surface: rgba(255, 255, 255, 0.92);
      --surface-strong: #ffffff;
      --text: #201814;
      --muted: #6d6157;
      --border: rgba(32, 24, 20, 0.08);
      --accent: #181818;
      --accent-contrast: #ffffff;
      --accent-soft: rgba(24, 24, 24, 0.06);
      --success: #17803d;
      --success-soft: rgba(23, 128, 61, 0.10);
      --shadow: 0 24px 70px rgba(38, 24, 12, 0.10);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: Inter, "Avenir Next", "PingFang SC", "Helvetica Neue", sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at top left, rgba(255, 214, 143, 0.24), transparent 28%),
        radial-gradient(circle at 88% 12%, rgba(138, 180, 255, 0.14), transparent 24%),
        linear-gradient(180deg, #fbf8f2 0%, #f3ede2 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 28px;
    }
    .shell {
      width: min(760px, 100%);
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 28px;
      box-shadow: var(--shadow);
      backdrop-filter: blur(14px);
      padding: 30px;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 32px;
      padding: 0 14px;
      border-radius: 999px;
      background: var(--success-soft);
      color: var(--success);
      font-size: 13px;
      font-weight: 800;
      letter-spacing: 0.02em;
    }
    .badge-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: currentColor;
    }
    h1 {
      margin: 18px 0 12px;
      font-size: clamp(34px, 6vw, 56px);
      line-height: 0.96;
      letter-spacing: -0.05em;
    }
    .lead {
      margin: 0;
      color: var(--muted);
      font-size: 18px;
      line-height: 1.7;
      max-width: 34em;
    }
    .panel {
      margin-top: 24px;
      padding: 18px 20px;
      border-radius: 22px;
      background: var(--surface-strong);
      border: 1px solid var(--border);
    }
    .panel-title {
      margin: 0 0 10px;
      font-size: 16px;
      font-weight: 800;
    }
    .steps {
      margin: 0;
      padding-left: 18px;
      color: var(--muted);
      font-size: 15px;
      line-height: 1.8;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 24px;
    }
    .button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 52px;
      padding: 0 20px;
      border-radius: 999px;
      text-decoration: none;
      font-size: 15px;
      font-weight: 800;
      transition: transform 180ms ease, box-shadow 180ms ease, background-color 180ms ease;
    }
    .button:hover {
      transform: translateY(-1px);
    }
    .button-primary {
      background: var(--accent);
      color: var(--accent-contrast);
      box-shadow: 0 12px 24px rgba(24, 24, 24, 0.18);
    }
    .button-secondary {
      border: 1px solid var(--border);
      background: var(--surface-strong);
      color: var(--text);
    }
    .fine-print {
      margin: 18px 2px 0;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.7;
    }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.92em;
      background: var(--accent-soft);
      padding: 2px 6px;
      border-radius: 8px;
    }
    @media (max-width: 640px) {
      body {
        padding: 18px;
      }
      .card {
        padding: 22px;
        border-radius: 22px;
      }
      .lead {
        font-size: 16px;
      }
      .actions {
        flex-direction: column;
      }
      .button {
        width: 100%;
      }
    }
  </style>
</head>
<body>
  <main class="shell">
    <section class="card">
      <div class="badge"><span class="badge-dot"></span>Payment successful</div>
      <h1>Your Pro subscription is on the way.</h1>
      <p class="lead">Your payment was completed successfully. AICompare will activate your Pro membership as soon as Stripe webhook sync finishes, which usually takes just a few seconds.</p>

      <div class="panel">
        <h2 class="panel-title">What to do next</h2>
        <ol class="steps">
          <li>Return to the extension Pro page.</li>
          <li>Check whether your <code>Chat Plan</code> status has changed to active.</li>
          <li>If it still looks unchanged, wait a few seconds and reopen the page once.</li>
        </ol>
      </div>

      <div class="actions">
        <a class="button button-primary" href="${membershipUrl}">Open Pro Membership</a>
        <a class="button button-secondary" href="/">Back to AICompare site</a>
      </div>

      <p class="fine-print">If you closed the extension earlier, reopening it and visiting the Pro page again is enough. Membership status is confirmed by the backend after Stripe finishes the subscription event sync.</p>
    </section>
  </main>
</body>
</html>`;
}

function getPaymentCancelPageHtml() {
  const membershipUrl = escapeHtml(getExtensionMembershipUrl());
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment canceled | AICompare</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f4ee;
      --surface: rgba(255, 255, 255, 0.92);
      --surface-strong: #ffffff;
      --text: #201814;
      --muted: #6d6157;
      --border: rgba(32, 24, 20, 0.08);
      --accent: #181818;
      --accent-contrast: #ffffff;
      --accent-soft: rgba(24, 24, 24, 0.06);
      --warning: #b65a2d;
      --warning-soft: rgba(182, 90, 45, 0.12);
      --shadow: 0 24px 70px rgba(38, 24, 12, 0.10);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: Inter, "Avenir Next", "PingFang SC", "Helvetica Neue", sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at top left, rgba(255, 214, 143, 0.24), transparent 28%),
        radial-gradient(circle at 88% 12%, rgba(138, 180, 255, 0.14), transparent 24%),
        linear-gradient(180deg, #fbf8f2 0%, #f3ede2 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 28px;
    }
    .shell {
      width: min(760px, 100%);
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 28px;
      box-shadow: var(--shadow);
      backdrop-filter: blur(14px);
      padding: 30px;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 32px;
      padding: 0 14px;
      border-radius: 999px;
      background: var(--warning-soft);
      color: var(--warning);
      font-size: 13px;
      font-weight: 800;
      letter-spacing: 0.02em;
    }
    .badge-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: currentColor;
    }
    h1 {
      margin: 18px 0 12px;
      font-size: clamp(34px, 6vw, 56px);
      line-height: 0.96;
      letter-spacing: -0.05em;
    }
    .lead {
      margin: 0;
      color: var(--muted);
      font-size: 18px;
      line-height: 1.7;
      max-width: 34em;
    }
    .panel {
      margin-top: 24px;
      padding: 18px 20px;
      border-radius: 22px;
      background: var(--surface-strong);
      border: 1px solid var(--border);
    }
    .panel-title {
      margin: 0 0 10px;
      font-size: 16px;
      font-weight: 800;
    }
    .steps {
      margin: 0;
      padding-left: 18px;
      color: var(--muted);
      font-size: 15px;
      line-height: 1.8;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 24px;
    }
    .button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 52px;
      padding: 0 20px;
      border-radius: 999px;
      text-decoration: none;
      font-size: 15px;
      font-weight: 800;
      transition: transform 180ms ease, box-shadow 180ms ease, background-color 180ms ease;
    }
    .button:hover {
      transform: translateY(-1px);
    }
    .button-primary {
      background: var(--accent);
      color: var(--accent-contrast);
      box-shadow: 0 12px 24px rgba(24, 24, 24, 0.18);
    }
    .button-secondary {
      border: 1px solid var(--border);
      background: var(--surface-strong);
      color: var(--text);
    }
    .fine-print {
      margin: 18px 2px 0;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.7;
    }
    @media (max-width: 640px) {
      body {
        padding: 18px;
      }
      .card {
        padding: 22px;
        border-radius: 22px;
      }
      .lead {
        font-size: 16px;
      }
      .actions {
        flex-direction: column;
      }
      .button {
        width: 100%;
      }
    }
  </style>
</head>
<body>
  <main class="shell">
    <section class="card">
      <div class="badge"><span class="badge-dot"></span>Payment not completed</div>
      <h1>Your subscription has not been activated yet.</h1>
      <p class="lead">No payment was completed for this checkout session. You can return to AICompare and subscribe again whenever you're ready.</p>

      <div class="panel">
        <h2 class="panel-title">What you can do next</h2>
        <ol class="steps">
          <li>Return to the extension Pro page.</li>
          <li>Review the current <code>Chat Plan</code> status.</li>
          <li>Start a new checkout when you want to continue.</li>
        </ol>
      </div>

      <div class="actions">
        <a class="button button-primary" href="${membershipUrl}">Back to Pro Membership</a>
        <a class="button button-secondary" href="/">Back to AICompare site</a>
      </div>

      <p class="fine-print">If you closed Stripe intentionally, nothing has changed on your account. You can reopen the Pro page in the extension and subscribe again at any time.</p>
    </section>
  </main>
</body>
</html>`;
}

async function canReadFirestore() {
  try {
    requireFirebaseAdmin();
    await Promise.race([
      db.collection('users').limit(1).get(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Firestore check timed out')), 2500);
      })
    ]);
    return true;
  } catch (_) {
    return false;
  }
}

function getBasicHealth() {
  const firebaseAdminConfigured = initializeFirebaseAdmin();
  return {
    ok: true,
    firebaseAdminConfigured,
    stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
    officialApiConfigured: Boolean(process.env.OFFICIAL_AGENT_API_BASE_URL && process.env.OFFICIAL_AGENT_API_KEY),
    adminConfigured: Boolean(adminUsername && adminPasswordHash)
  };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case '\'': return '&#39;';
      default: return char;
    }
  });
}

function createAdminPage({ pageName, title, description, content }) {
  const active = {
    overview: pageName === 'overview' ? 'active' : '',
    orders: pageName === 'orders' ? 'active' : '',
    apiUsage: pageName === 'apiUsage' ? 'active' : ''
  };
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} · AI Compare Admin</title>
  <style>${ADMIN_STYLES}</style>
</head>
<body>
  <main class="shell">
    <section class="hero">
      <article class="hero-panel">
        <div class="eyebrow">AI Compare Admin</div>
        <h1>${escapeHtml(title)}</h1>
        <p class="hero-copy">${escapeHtml(description)}</p>
        <nav class="hero-links">
          <a class="nav-link ${active.overview}" href="/admin">总览</a>
          <a class="nav-link ${active.orders}" href="/admin/orders">会员订单</a>
          <a class="nav-link ${active.apiUsage}" href="/admin/api-usage">API 使用</a>
        </nav>
      </article>
      <aside class="token-panel">
        <h2>管理员登录</h2>
        <p>使用独立后台账号密码登录。登录成功后，服务端会在当前浏览器写入一个 HttpOnly 管理员会话 Cookie。</p>
        <input id="usernameInput" type="text" autocomplete="username" placeholder="管理员账号" />
        <input id="passwordInput" type="password" autocomplete="current-password" placeholder="管理员密码" />
        <div class="token-actions">
          <button id="saveTokenButton" type="button">登录</button>
          <button id="clearTokenButton" type="button">退出/清空</button>
        </div>
        <div class="status" id="tokenStatus"></div>
      </aside>
    </section>
    ${content}
    <p class="footer-note">说明：会员订单统计优先使用 Stripe 发票/订阅数据；API 统计只覆盖官方代理接口 <code>/officialAgentChat</code>。历史 Pro 数据从事件埋点上线日开始完整。</p>
  </main>
  <script>${ADMIN_CLIENT_SCRIPT}</script>
  <script>bootAdminPage(${JSON.stringify(pageName)});</script>
</body>
</html>`;
}

function getOverviewPageHtml() {
  return createAdminPage({
    pageName: 'overview',
    title: '运营总览',
    description: '查看当前有效 Pro、近 30 天订单和官方代理 API 请求概览。',
    content: `
      <h2 class="section-title">概览卡片</h2>
      <section id="overviewCards" class="grid"></section>
      <section class="card panel">
        <h3>原始汇总 JSON</h3>
        <pre id="overviewJson">等待加载...</pre>
      </section>
    `
  });
}

function getAdminLoginPageHtml() {
  return createAdminPage({
    pageName: 'login',
    title: '管理员登录',
    description: '使用独立后台账号密码换取后台会话 Cookie，登录成功后才可访问统计后台。',
    content: `
      <section class="card panel">
        <h3>登录说明</h3>
        <p class="footer-note">请输入已配置的后台管理员账号和密码。登录成功后，服务端会在当前浏览器写入一个 HttpOnly 管理员会话 Cookie。</p>
      </section>
    `
  }).replace(
    `<script>bootAdminPage(${JSON.stringify('login')});</script>`,
    `<script>bootAdminLoginPage();</script>`
  );
}

function getOrdersPageHtml() {
  return createAdminPage({
    pageName: 'orders',
    title: '会员订单后台',
    description: '查看会员总量、订阅状态、近期订单与近 30 天收入趋势。',
    content: `
      <h2 class="section-title">核心指标</h2>
      <section id="ordersCards" class="grid"></section>
      <section class="card panel">
        <h3>最近订单 / 订阅</h3>
        <table>
          <thead>
            <tr>
              <th>UID</th>
              <th>邮箱</th>
              <th>计划</th>
              <th>订阅状态</th>
              <th>发票状态</th>
              <th>已支付</th>
              <th>金额</th>
              <th>时间</th>
            </tr>
          </thead>
          <tbody id="ordersTableBody">
            <tr><td colspan="8" class="empty-cell">等待加载...</td></tr>
          </tbody>
        </table>
      </section>
      <section class="card panel">
        <h3>近 30 天订单趋势</h3>
        <table>
          <thead>
            <tr>
              <th>日期</th>
              <th>新增订阅</th>
              <th>续费成功</th>
              <th>取消</th>
              <th>收入</th>
            </tr>
          </thead>
          <tbody id="ordersTrendBody">
            <tr><td colspan="5" class="empty-cell">等待加载...</td></tr>
          </tbody>
        </table>
      </section>
    `
  });
}

function getApiUsagePageHtml() {
  return createAdminPage({
    pageName: 'apiUsage',
    title: 'API 使用后台',
    description: '按天查看 free / pro / anonymous 三类官方代理 API 请求量与活跃数。',
    content: `
      <h2 class="section-title">核心指标</h2>
      <section id="apiCards" class="grid"></section>
      <section class="card panel">
        <h3>近 30 天趋势</h3>
        <table>
          <thead>
            <tr>
              <th>日期</th>
              <th>免费请求</th>
              <th>Pro 请求</th>
              <th>匿名请求</th>
              <th>总请求</th>
              <th>活跃登录用户</th>
              <th>活跃匿名设备</th>
            </tr>
          </thead>
          <tbody id="apiTrendBody">
            <tr><td colspan="7" class="empty-cell">等待加载...</td></tr>
          </tbody>
        </table>
      </section>
      <section class="card panel">
        <h3>峰值日期</h3>
        <table>
          <thead>
            <tr>
              <th>日期</th>
              <th>总请求</th>
              <th>免费</th>
              <th>Pro</th>
              <th>匿名</th>
            </tr>
          </thead>
          <tbody id="apiTopDaysBody">
            <tr><td colspan="5" class="empty-cell">等待加载...</td></tr>
          </tbody>
        </table>
      </section>
    `
  });
}

function createEmptyUsageDay(dateKey) {
  return {
    date: dateKey,
    free: { requests: 0, activeUsers: 0 },
    pro: { requests: 0, activeUsers: 0 },
    anonymous: { requests: 0, activeUsers: 0 },
    totalRequests: 0,
    activeUsers: 0,
    activeAnonymousClients: 0
  };
}

async function getUserDirectory() {
  requireFirebaseAdmin();
  const snapshot = await db.collection('users').get();
  const byUid = new Map();
  snapshot.forEach((doc) => {
    const data = doc.data() || {};
    byUid.set(doc.id, {
      uid: doc.id,
      email: String(data.email || data.googleEmail || data.lastLoginEmail || '').trim(),
      plan: String(data.plan || 'free').trim() || 'free',
      planExpiresAt: data.planExpiresAt || null,
      stripeCustomerId: String(data.stripeCustomerId || '').trim(),
      stripeSubscriptionId: String(data.stripeSubscriptionId || '').trim(),
      subscriptionStatus: String(data.subscriptionStatus || '').trim(),
      createdAt: data.createdAt || null,
      updatedAt: data.updatedAt || null
    });
  });
  return byUid;
}

async function listStripeInvoices(options = {}) {
  const stripe = getStripe();
  const maxPages = clamp(parseInteger(options.maxPages, 5), 1, 20);
  const pageLimit = clamp(parseInteger(options.pageLimit, 100), 1, 100);
  const invoices = [];
  let startingAfter = null;
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const response = await stripe.invoices.list({
      limit: pageLimit,
      ...(startingAfter ? { starting_after: startingAfter } : {})
    });
    const batch = Array.isArray(response?.data) ? response.data : [];
    invoices.push(...batch);
    if (!response?.has_more || !batch.length) {
      break;
    }
    startingAfter = batch[batch.length - 1].id;
  }
  return invoices;
}

async function listStripeSubscriptions(options = {}) {
  const stripe = getStripe();
  const maxPages = clamp(parseInteger(options.maxPages, 5), 1, 20);
  const pageLimit = clamp(parseInteger(options.pageLimit, 100), 1, 100);
  const subscriptions = [];
  let startingAfter = null;
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const response = await stripe.subscriptions.list({
      limit: pageLimit,
      status: 'all',
      ...(startingAfter ? { starting_after: startingAfter } : {})
    });
    const batch = Array.isArray(response?.data) ? response.data : [];
    subscriptions.push(...batch);
    if (!response?.has_more || !batch.length) {
      break;
    }
    startingAfter = batch[batch.length - 1].id;
  }
  return subscriptions;
}

function buildMembershipSnapshot(userDirectory) {
  const users = Array.from(userDirectory.values());
  const nowSeconds = Math.floor(Date.now() / 1000);
  let totalMembers = 0;
  let activeProUsers = 0;
  let cancelingUsers = 0;
  let expiredUsers = 0;
  let newMembers7d = 0;
  let newMembers30d = 0;
  const threshold7d = nowSeconds - 7 * 24 * 60 * 60;
  const threshold30d = nowSeconds - 30 * 24 * 60 * 60;

  for (const user of users) {
    if (!user.stripeCustomerId && !user.stripeSubscriptionId && user.plan !== 'pro') {
      continue;
    }
    totalMembers += 1;
    const planExpiresAtSeconds = getTimestampSeconds(user.planExpiresAt);
    const isActivePro = user.plan === 'pro' && (!planExpiresAtSeconds || planExpiresAtSeconds > nowSeconds);
    const isCanceling = ['canceled', 'unpaid', 'past_due'].includes(user.subscriptionStatus) && planExpiresAtSeconds > nowSeconds;
    const isExpired = user.plan === 'free' && planExpiresAtSeconds > 0 && planExpiresAtSeconds <= nowSeconds;
    const createdAtSeconds = getTimestampSeconds(user.createdAt || user.updatedAt);

    if (isActivePro) activeProUsers += 1;
    if (isCanceling) cancelingUsers += 1;
    if (isExpired) expiredUsers += 1;
    if (createdAtSeconds && createdAtSeconds >= threshold7d) newMembers7d += 1;
    if (createdAtSeconds && createdAtSeconds >= threshold30d) newMembers30d += 1;
  }

  return {
    totalMembers,
    activeProUsers,
    cancelingUsers,
    expiredUsers,
    newMembers7d,
    newMembers30d
  };
}

function buildStripeIndexes(userDirectory, invoices, subscriptions) {
  const usersByCustomerId = new Map();
  const usersBySubscriptionId = new Map();
  for (const user of userDirectory.values()) {
    if (user.stripeCustomerId) usersByCustomerId.set(user.stripeCustomerId, user);
    if (user.stripeSubscriptionId) usersBySubscriptionId.set(user.stripeSubscriptionId, user);
  }
  const subscriptionsById = new Map();
  const subscriptionsByCustomerId = new Map();
  for (const subscription of subscriptions) {
    subscriptionsById.set(subscription.id, subscription);
    if (subscription.customer) subscriptionsByCustomerId.set(String(subscription.customer), subscription);
  }
  const invoicesByCustomerId = new Map();
  for (const invoice of invoices) {
    const customerId = String(invoice.customer || '').trim();
    if (!customerId) continue;
    if (!invoicesByCustomerId.has(customerId)) invoicesByCustomerId.set(customerId, []);
    invoicesByCustomerId.get(customerId).push(invoice);
  }
  for (const batch of invoicesByCustomerId.values()) {
    batch.sort((left, right) => Number(right.created || 0) - Number(left.created || 0));
  }
  return { usersByCustomerId, usersBySubscriptionId, subscriptionsById, subscriptionsByCustomerId, invoicesByCustomerId };
}

function computeInvoiceRevenue(invoices) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const threshold7d = nowSeconds - 7 * 24 * 60 * 60;
  const threshold30d = nowSeconds - 30 * 24 * 60 * 60;
  let revenue7d = 0;
  let revenue30d = 0;
  let currency = 'usd';
  for (const invoice of invoices) {
    if (!invoice.paid) continue;
    const createdSeconds = Number(invoice.created || 0);
    const amountPaid = Number(invoice.amount_paid || 0);
    if (!createdSeconds || !amountPaid) continue;
    currency = String(invoice.currency || currency || 'usd');
    if (createdSeconds >= threshold30d) {
      revenue30d += amountPaid;
    }
    if (createdSeconds >= threshold7d) {
      revenue7d += amountPaid;
    }
  }
  return { revenue7d, revenue30d, currency };
}

function buildInvoiceTrend(invoices, dateKeys) {
  const trend = new Map();
  dateKeys.forEach((dateKey) => {
    trend.set(dateKey, {
      date: dateKey,
      newSubscriptions: 0,
      renewedSubscriptions: 0,
      canceledSubscriptions: 0,
      revenueAmount: 0
    });
  });

  for (const invoice of invoices) {
    const createdSeconds = Number(invoice.created || 0);
    if (!createdSeconds) continue;
    const dateKey = getDateKey(createdSeconds * 1000);
    if (!trend.has(dateKey)) continue;
    const entry = trend.get(dateKey);
    if (invoice.paid) {
      entry.revenueAmount += Number(invoice.amount_paid || 0);
      const billingReason = String(invoice.billing_reason || '').trim();
      if (billingReason === 'subscription_create') {
        entry.newSubscriptions += 1;
      } else if (billingReason === 'subscription_cycle' || billingReason === 'subscription_update') {
        entry.renewedSubscriptions += 1;
      }
    }
  }

  return trend;
}

function applyCancellationTrend(subscriptions, trend) {
  for (const subscription of subscriptions) {
    const canceledAt = Number(subscription.canceled_at || 0);
    if (!canceledAt) continue;
    const dateKey = getDateKey(canceledAt * 1000);
    if (!trend.has(dateKey)) continue;
    trend.get(dateKey).canceledSubscriptions += 1;
  }
}

async function getOrderSummaryData() {
  const [userDirectory, invoices, subscriptions] = await Promise.all([
    getUserDirectory(),
    listStripeInvoices({ maxPages: 6 }),
    listStripeSubscriptions({ maxPages: 6 })
  ]);

  const membership = buildMembershipSnapshot(userDirectory);
  const revenue = computeInvoiceRevenue(invoices);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const thirtyDayThreshold = nowSeconds - 30 * 24 * 60 * 60;
  const thirtyDayPaidOrders = invoices.filter((invoice) => invoice.paid && Number(invoice.created || 0) >= thirtyDayThreshold).length;

  return {
    ...membership,
    thirtyDayPaidOrders,
    revenue7d: revenue.revenue7d,
    revenue30d: revenue.revenue30d,
    currency: revenue.currency
  };
}

async function getOrderListData(req) {
  const limit = clamp(parseInteger(req.query?.limit, 20), 1, 100);
  const cursor = String(req.query?.cursor || '').trim();
  const statusFilter = String(req.query?.status || '').trim();
  const planFilter = String(req.query?.plan || '').trim();
  const { dateFrom, dateTo } = parseDateRange(req, 30);

  const [userDirectory, invoices, subscriptions] = await Promise.all([
    getUserDirectory(),
    listStripeInvoices({ maxPages: 8 }),
    listStripeSubscriptions({ maxPages: 8 })
  ]);
  const indexes = buildStripeIndexes(userDirectory, invoices, subscriptions);

  const rows = [];
  for (const user of userDirectory.values()) {
    const customerId = user.stripeCustomerId;
    const subscription = (user.stripeSubscriptionId && indexes.subscriptionsById.get(user.stripeSubscriptionId))
      || (customerId && indexes.subscriptionsByCustomerId.get(customerId))
      || null;
    const latestInvoice = customerId ? (indexes.invoicesByCustomerId.get(customerId) || [])[0] || null : null;
    const invoiceCreatedAt = latestInvoice?.created ? new Date(latestInvoice.created * 1000).toISOString() : null;
    const planExpiresAt = timestampToIso(user.planExpiresAt);
    const invoiceDateKey = invoiceCreatedAt ? invoiceCreatedAt.slice(0, 10) : '';
    const planDateKey = planExpiresAt ? planExpiresAt.slice(0, 10) : '';
    const dateKey = invoiceDateKey || planDateKey;

    if (planFilter && user.plan !== planFilter) continue;
    if (statusFilter) {
      const candidateStatuses = [user.subscriptionStatus, subscription?.status, latestInvoice?.status].filter(Boolean);
      if (!candidateStatuses.includes(statusFilter)) continue;
    }
    if (dateKey && !isDateKeyInRange(dateKey, dateFrom, dateTo)) continue;

    rows.push({
      uid: user.uid,
      email: user.email,
      plan: user.plan,
      planExpiresAt,
      subscriptionStatus: user.subscriptionStatus || subscription?.status || '',
      stripeCustomerId: user.stripeCustomerId,
      stripeSubscriptionId: user.stripeSubscriptionId || subscription?.id || '',
      invoiceId: latestInvoice?.id || '',
      invoiceStatus: latestInvoice?.status || '',
      invoicePaid: Boolean(latestInvoice?.paid),
      amountPaid: Number(latestInvoice?.amount_paid || 0),
      amountDue: Number(latestInvoice?.amount_due || 0),
      currency: String(latestInvoice?.currency || subscription?.items?.data?.[0]?.price?.currency || 'usd'),
      invoiceCreatedAt,
      hostedInvoiceUrl: String(latestInvoice?.hosted_invoice_url || '')
    });
  }

  rows.sort((left, right) => {
    const rightTs = Date.parse(right.invoiceCreatedAt || right.planExpiresAt || 0) || 0;
    const leftTs = Date.parse(left.invoiceCreatedAt || left.planExpiresAt || 0) || 0;
    return rightTs - leftTs;
  });

  const startIndex = cursor ? rows.findIndex((item) => item.uid === cursor) + 1 : 0;
  const pageItems = rows.slice(Math.max(0, startIndex), Math.max(0, startIndex) + limit);
  const nextCursor = rows.length > startIndex + limit ? pageItems[pageItems.length - 1]?.uid || '' : '';

  return {
    orders: pageItems,
    nextCursor,
    total: rows.length,
    dateFrom,
    dateTo
  };
}

async function getOrderTrendData(req) {
  const days = clamp(parseInteger(req.query?.days, 30), 1, 90);
  const dateKeys = getRecentDateKeys(days);
  const [invoices, subscriptions] = await Promise.all([
    listStripeInvoices({ maxPages: 10 }),
    listStripeSubscriptions({ maxPages: 10 })
  ]);
  const trend = buildInvoiceTrend(invoices, dateKeys);
  applyCancellationTrend(subscriptions, trend);
  const currency = String(invoices[0]?.currency || subscriptions[0]?.items?.data?.[0]?.price?.currency || 'usd');
  return {
    currency,
    days: dateKeys.map((dateKey) => trend.get(dateKey) || {
      date: dateKey,
      newSubscriptions: 0,
      renewedSubscriptions: 0,
      canceledSubscriptions: 0,
      revenueAmount: 0
    })
  };
}

async function collectUsageCounters(dateKeys) {
  const freeByDay = new Map();
  const anonymousByDay = new Map();
  const userActivityByDay = new Map();
  const anonymousActivityByDay = new Map();

  const usersSnapshot = await db.collection('users').get();
  for (const userDoc of usersSnapshot.docs) {
    const usageSnapshot = await userDoc.ref.collection('usage').get();
    usageSnapshot.forEach((usageDoc) => {
      const dateKey = String(usageDoc.id || '').trim();
      if (!dateKeys.includes(dateKey)) return;
      const count = Math.max(0, Number(usageDoc.data()?.officialApiCount) || 0);
      if (!count) return;
      freeByDay.set(dateKey, (freeByDay.get(dateKey) || 0) + count);
      if (!userActivityByDay.has(dateKey)) userActivityByDay.set(dateKey, new Set());
      userActivityByDay.get(dateKey).add(userDoc.id);
    });
  }

  const anonymousSnapshot = await db.collection('anonymousUsage').get();
  for (const clientDoc of anonymousSnapshot.docs) {
    const usageSnapshot = await clientDoc.ref.collection('usage').get();
    usageSnapshot.forEach((usageDoc) => {
      const dateKey = String(usageDoc.id || '').trim();
      if (!dateKeys.includes(dateKey)) return;
      const count = Math.max(0, Number(usageDoc.data()?.officialApiCount) || 0);
      if (!count) return;
      anonymousByDay.set(dateKey, (anonymousByDay.get(dateKey) || 0) + count);
      if (!anonymousActivityByDay.has(dateKey)) anonymousActivityByDay.set(dateKey, new Set());
      anonymousActivityByDay.get(dateKey).add(clientDoc.id);
    });
  }

  return { freeByDay, anonymousByDay, userActivityByDay, anonymousActivityByDay };
}

async function collectUsageEvents(dateKeys) {
  const eventSnapshot = await db.collection('officialApiEvents')
    .where('dateKey', '>=', dateKeys[0])
    .where('dateKey', '<=', dateKeys[dateKeys.length - 1])
    .get();

  const proByDay = new Map();
  const freeEventsByDay = new Map();
  const anonymousEventsByDay = new Map();
  const proUsersByDay = new Map();
  const freeUsersByDay = new Map();
  const anonymousClientsByDay = new Map();

  eventSnapshot.forEach((doc) => {
    const data = doc.data() || {};
    const dateKey = String(data.dateKey || '').trim();
    const userType = String(data.userType || '').trim();
    const uid = String(data.uid || '').trim();
    const clientHash = String(data.clientHash || '').trim();
    if (!dateKey || !dateKeys.includes(dateKey)) return;
    if (userType === 'pro') {
      proByDay.set(dateKey, (proByDay.get(dateKey) || 0) + 1);
      if (!proUsersByDay.has(dateKey)) proUsersByDay.set(dateKey, new Set());
      if (uid) proUsersByDay.get(dateKey).add(uid);
      return;
    }
    if (userType === 'free') {
      freeEventsByDay.set(dateKey, (freeEventsByDay.get(dateKey) || 0) + 1);
      if (!freeUsersByDay.has(dateKey)) freeUsersByDay.set(dateKey, new Set());
      if (uid) freeUsersByDay.get(dateKey).add(uid);
      return;
    }
    if (userType === 'anonymous') {
      anonymousEventsByDay.set(dateKey, (anonymousEventsByDay.get(dateKey) || 0) + 1);
      if (!anonymousClientsByDay.has(dateKey)) anonymousClientsByDay.set(dateKey, new Set());
      if (clientHash) anonymousClientsByDay.get(dateKey).add(clientHash);
    }
  });

  return {
    proByDay,
    freeEventsByDay,
    anonymousEventsByDay,
    proUsersByDay,
    freeUsersByDay,
    anonymousClientsByDay
  };
}

function mergeSetValues(...sets) {
  const merged = new Set();
  for (const setValue of sets) {
    if (!setValue) continue;
    for (const item of setValue) {
      merged.add(item);
    }
  }
  return merged;
}

async function buildUsageTrend(days) {
  requireFirebaseAdmin();
  const dateKeys = getRecentDateKeys(days);
  const [counters, events] = await Promise.all([
    collectUsageCounters(dateKeys),
    collectUsageEvents(dateKeys)
  ]);

  return dateKeys.map((dateKey) => {
    const freeRequests = Math.max(
      Number(counters.freeByDay.get(dateKey) || 0),
      Number(events.freeEventsByDay.get(dateKey) || 0)
    );
    const proRequests = Number(events.proByDay.get(dateKey) || 0);
    const anonymousRequests = Math.max(
      Number(counters.anonymousByDay.get(dateKey) || 0),
      Number(events.anonymousEventsByDay.get(dateKey) || 0)
    );
    const freeUsers = mergeSetValues(counters.userActivityByDay.get(dateKey), events.freeUsersByDay.get(dateKey));
    const proUsers = mergeSetValues(events.proUsersByDay.get(dateKey));
    const anonymousClients = mergeSetValues(counters.anonymousActivityByDay.get(dateKey), events.anonymousClientsByDay.get(dateKey));
    const activeUsers = mergeSetValues(freeUsers, proUsers);
    return {
      date: dateKey,
      free: { requests: freeRequests, activeUsers: freeUsers.size, userIds: Array.from(freeUsers) },
      pro: { requests: proRequests, activeUsers: proUsers.size, userIds: Array.from(proUsers) },
      anonymous: { requests: anonymousRequests, activeUsers: anonymousClients.size, clientIds: Array.from(anonymousClients) },
      totalRequests: freeRequests + proRequests + anonymousRequests,
      activeUsers: activeUsers.size,
      activeAnonymousClients: anonymousClients.size
    };
  });
}

function summarizeUsageRange(days) {
  const summary = days.reduce((acc, item) => {
    acc.totalRequests += item.totalRequests;
    acc.free.requests += item.free.requests;
    acc.pro.requests += item.pro.requests;
    acc.anonymous.requests += item.anonymous.requests;
    for (const uid of item.free.userIds || []) acc.free.userIds.add(uid);
    for (const uid of item.pro.userIds || []) acc.pro.userIds.add(uid);
    for (const clientHash of item.anonymous.clientIds || []) acc.anonymous.clientIds.add(clientHash);
    return acc;
  }, {
    totalRequests: 0,
    free: { requests: 0, userIds: new Set() },
    pro: { requests: 0, userIds: new Set() },
    anonymous: { requests: 0, clientIds: new Set() }
  });
  const activeUsers = mergeSetValues(summary.free.userIds, summary.pro.userIds);
  return {
    totalRequests: summary.totalRequests,
    free: { requests: summary.free.requests, activeUsers: summary.free.userIds.size },
    pro: { requests: summary.pro.requests, activeUsers: summary.pro.userIds.size },
    anonymous: { requests: summary.anonymous.requests, activeUsers: summary.anonymous.clientIds.size },
    activeUsers: activeUsers.size,
    activeAnonymousClients: summary.anonymous.clientIds.size
  };
}

async function getApiUsageSummaryData() {
  const trend30 = await buildUsageTrend(30);
  const today = trend30[trend30.length - 1] || createEmptyUsageDay(getTodayKey());
  const last7Days = summarizeUsageRange(trend30.slice(-7));
  const last30Days = summarizeUsageRange(trend30);
  return { today, last7Days, last30Days };
}

async function getApiUsageTrendData(req) {
  const days = clamp(parseInteger(req.query?.days, 30), 1, 90);
  return { days: await buildUsageTrend(days) };
}

async function getApiUsageTopDaysData(req) {
  const limit = clamp(parseInteger(req.query?.limit, 10), 1, 30);
  const trend = await buildUsageTrend(90);
  const days = [...trend]
    .sort((left, right) => right.totalRequests - left.totalRequests)
    .slice(0, limit);
  return { days };
}

async function requireAdminPage(req, res) {
  try {
    await requireAdmin(req);
    return true;
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      const nextPath = encodeURIComponent(`${req.path}${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`);
      res.redirect(`/admin/login?next=${nextPath}`);
      return false;
    }
    throw error;
  }
}

app.get('/health', (_req, res) => {
  res.json(getBasicHealth());
});

app.get('/health/deep', async (_req, res) => {
  const basicHealth = getBasicHealth();
  res.json({
    ...basicHealth,
    firestoreConfigured: basicHealth.firebaseAdminConfigured ? await canReadFirestore() : false
  });
});

app.get('/payment-success', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(getPaymentSuccessPageHtml());
});

app.get('/payment-cancel', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(getPaymentCancelPageHtml());
});

app.get('/admin/login', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(getAdminLoginPageHtml());
});

app.get('/admin', asyncRoute(async (req, res) => {
  if (!await requireAdminPage(req, res)) return;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(getOverviewPageHtml());
}));

app.get('/admin/orders', asyncRoute(async (req, res) => {
  if (!await requireAdminPage(req, res)) return;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(getOrdersPageHtml());
}));

app.get('/admin/api-usage', asyncRoute(async (req, res) => {
  if (!await requireAdminPage(req, res)) return;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(getApiUsagePageHtml());
}));

app.get('/api/admin/orders/summary', asyncRoute(async (req, res) => {
  await requireAdmin(req);
  res.json(await getOrderSummaryData());
}));

app.post('/api/admin/session', asyncRoute(async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!username || !password) {
    res.status(400).json({ error: 'username and password are required' });
    return;
  }
  const adminUser = verifyAdminCredentials(username, password);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const sessionToken = createAdminSessionToken({
    username: String(adminUser.username || ''),
    exp: nowSeconds + adminSessionTtlSeconds
  });
  setAdminSessionCookie(res, sessionToken);
  res.json({
    ok: true,
    expiresAt: new Date((nowSeconds + adminSessionTtlSeconds) * 1000).toISOString()
  });
}));

app.delete('/api/admin/session', asyncRoute(async (_req, res) => {
  clearAdminSessionCookie(res);
  res.json({ ok: true });
}));

app.get('/api/admin/orders/list', asyncRoute(async (req, res) => {
  await requireAdmin(req);
  res.json(await getOrderListData(req));
}));

app.get('/api/admin/orders/trend', asyncRoute(async (req, res) => {
  await requireAdmin(req);
  res.json(await getOrderTrendData(req));
}));

app.get('/api/admin/api-usage/summary', asyncRoute(async (req, res) => {
  await requireAdmin(req);
  res.json(await getApiUsageSummaryData());
}));

app.get('/api/admin/api-usage/trend', asyncRoute(async (req, res) => {
  await requireAdmin(req);
  res.json(await getApiUsageTrendData(req));
}));

app.get('/api/admin/api-usage/top-days', asyncRoute(async (req, res) => {
  await requireAdmin(req);
  res.json(await getApiUsageTopDaysData(req));
}));

app.post('/createCheckoutSession', asyncRoute(async (req, res) => {
  const user = await requireUser(req);
  const priceId = String(req.body?.priceId || '').trim();
  if (!priceId) {
    res.status(400).json({ error: 'priceId is required' });
    return;
  }

  const stripe = getStripe();
  const userRef = db.collection('users').doc(user.uid);
  const plan = await getUserPlan(user.uid);
  let customerId = plan.stripeCustomerId;

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { firebaseUid: user.uid }
    });
    customerId = customer.id;
    await userRef.set({ stripeCustomerId: customerId }, { merge: true });
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: getSuccessUrl(),
    cancel_url: getCancelUrl(),
    metadata: { firebaseUid: user.uid },
    subscription_data: {
      metadata: { firebaseUid: user.uid }
    }
  });

  res.json({ url: session.url });
}));

app.post('/createPortalSession', asyncRoute(async (req, res) => {
  const user = await requireUser(req);
  const plan = await getUserPlan(user.uid);
  if (!plan.stripeCustomerId) {
    res.status(400).json({ error: 'No Stripe customer found for this user' });
    return;
  }

  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: plan.stripeCustomerId,
    return_url: getSuccessUrl()
  });
  res.json({ url: session.url });
}));

app.get('/listInvoices', asyncRoute(async (req, res) => {
  const user = await requireUser(req);
  const plan = await getUserPlan(user.uid);
  if (!plan.stripeCustomerId) {
    res.json({ invoices: [] });
    return;
  }

  const stripe = getStripe();
  const result = await stripe.invoices.list({
    customer: plan.stripeCustomerId,
    limit: 20
  });

  const invoices = Array.isArray(result?.data) ? result.data.map((invoice) => ({
    id: String(invoice.id || ''),
    number: String(invoice.number || ''),
    status: String(invoice.status || ''),
    currency: String(invoice.currency || 'usd'),
    amountPaid: Number(invoice.amount_paid || 0),
    amountDue: Number(invoice.amount_due || 0),
    createdAt: invoice.created ? new Date(invoice.created * 1000).toISOString() : null,
    hostedInvoiceUrl: String(invoice.hosted_invoice_url || ''),
    invoicePdf: String(invoice.invoice_pdf || '')
  })) : [];

  res.json({ invoices });
}));

async function updateUserFromSubscription(subscription) {
  const uid = subscription.metadata?.firebaseUid;
  if (!uid) return;

  const item = subscription.items?.data?.[0];
  const periodEnd = item?.current_period_end || subscription.current_period_end || 0;
  const isActive = ['active', 'trialing'].includes(subscription.status);

  await db.collection('users').doc(uid).set({
    plan: isActive ? 'pro' : 'free',
    planExpiresAt: periodEnd ? admin.firestore.Timestamp.fromMillis(periodEnd * 1000) : null,
    stripeCustomerId: String(subscription.customer || ''),
    stripeSubscriptionId: subscription.id,
    subscriptionStatus: subscription.status,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

app.post('/stripeWebhook', asyncRoute(async (req, res) => {
  requireFirebaseAdmin();
  const webhookSecret = String(process.env.STRIPE_WEBHOOK_SECRET || '').trim();
  if (!webhookSecret) {
    res.status(500).send('STRIPE_WEBHOOK_SECRET is not configured');
    return;
  }

  const stripe = getStripe();
  let event = null;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], webhookSecret);
  } catch (error) {
    error.status = 400;
    throw error;
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    if (session.subscription) {
      const subscription = await stripe.subscriptions.retrieve(session.subscription);
      await updateUserFromSubscription(subscription);
    }
  }

  if (
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.deleted' ||
    event.type === 'invoice.payment_succeeded'
  ) {
    const object = event.data.object;
    const subscriptionId = object.subscription || object.id;
    if (subscriptionId) {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      await updateUserFromSubscription(subscription);
    }
  }

  res.json({ received: true });
}));

app.post('/officialAgentChat', asyncRoute(async (req, res) => {
  const user = await getOptionalUser(req);
  const locale = String(req.headers['x-ai-compare-locale'] || req.body?.locale || '').trim();
  const requestedModel = String(req.body?.model || '').trim();
  let usageResult = null;
  let eventPayload = null;

  if (user?.uid) {
    usageResult = await consumeOfficialApiUsage(user.uid, locale);
    eventPayload = {
      uid: user.uid,
      clientHash: '',
      userType: usageResult?.plan === 'pro' ? 'pro' : 'free',
      locale,
      model: requestedModel
    };
  } else {
    const anonymousClientId = getAnonymousClientId(req);
    usageResult = await consumeAnonymousOfficialApiUsage(anonymousClientId, locale);
    eventPayload = {
      uid: '',
      clientHash: getAnonymousUsageDocId(anonymousClientId),
      userType: 'anonymous',
      locale,
      model: requestedModel
    };
  }

  try {
    await recordOfficialApiEvent(eventPayload);
  } catch (error) {
    console.warn('[ai-compare-backend] failed to record official API event:', error.message || error);
  }

  const apiKey = String(process.env.OFFICIAL_AGENT_API_KEY || '').trim();
  const baseUrl = String(process.env.OFFICIAL_AGENT_API_BASE_URL || '').trim().replace(/\/+$/, '');
  const defaultModel = String(process.env.OFFICIAL_AGENT_MODEL || '').trim();
  if (!apiKey || !baseUrl) {
    res.status(500).json({ error: 'Official API proxy is not configured' });
    return;
  }

  const upstream = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      ...req.body,
      model: requestedModel || defaultModel
    })
  });

  res.status(upstream.status);
  if (usageResult?.billingEnabled) {
    res.setHeader('X-AI-Compare-Usage-Plan', String(usageResult.plan || 'free'));
    if (Number.isFinite(usageResult.limit)) {
      res.setHeader('X-AI-Compare-Usage-Limit', String(usageResult.limit));
    }
    if (Number.isFinite(usageResult.used)) {
      res.setHeader('X-AI-Compare-Usage-Used', String(usageResult.used));
    }
    if (Number.isFinite(usageResult.remaining)) {
      res.setHeader('X-AI-Compare-Usage-Remaining', String(usageResult.remaining));
    }
  }
  upstream.headers.forEach((value, key) => {
    if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(key.toLowerCase())) {
      res.setHeader(key, value);
    }
  });

  if (!upstream.body) {
    res.send(await upstream.text());
    return;
  }

  const reader = upstream.body.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    res.write(Buffer.from(value));
  }
  res.end();
}));

app.listen(port, '0.0.0.0', () => {
  console.log(`[ai-compare-backend] listening on ${port}`);
});
