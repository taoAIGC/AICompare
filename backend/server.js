const path = require('path');
require('dotenv').config();
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const admin = require('firebase-admin');
const Stripe = require('stripe');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const BehaviorInsights = require('./behavior-insights.js');
let geoip = null;
try {
  geoip = require('geoip-lite');
} catch (_) {
  geoip = null;
}

const app = express();
const port = Number(process.env.PORT || 8790);
const dailyFreeLimit = Math.max(0, Number(process.env.OFFICIAL_API_DAILY_FREE_LIMIT || 10) || 10);
const chatPlanDailyFreeLimit = Math.max(0, Number(process.env.CHAT_PLAN_DAILY_FREE_LIMIT || 3) || 3);
const billingMode = String(process.env.BILLING_MODE || 'test').trim() || 'test';
const billingMeterAllLocales = String(process.env.BILLING_METER_ALL_LOCALES || '').trim().toLowerCase() === 'true';
const adminSessionOrigin = String(process.env.ADMIN_SESSION_ORIGIN || '').trim();
const adminSessionSecret = String(process.env.ADMIN_SESSION_SECRET || process.env.STRIPE_WEBHOOK_SECRET || '').trim();
const adminSessionCookieName = 'ai_compare_admin_session';
const adminSessionTtlSeconds = Math.max(300, Number(process.env.ADMIN_SESSION_TTL_SECONDS || 12 * 60 * 60) || (12 * 60 * 60));
const adminUsername = String(process.env.ADMIN_USERNAME || '').trim();
const adminPasswordHash = String(process.env.ADMIN_PASSWORD_HASH || '').trim();
const redeemCodeCollection = 'redeemCodes';
const emailLoginCodeCollection = 'emailLoginCodes';
const emailAuthCodeTtlSeconds = Math.max(60, Number(process.env.EMAIL_AUTH_CODE_TTL_SECONDS || 10 * 60) || (10 * 60));
const emailAuthResendCooldownSeconds = Math.max(0, Number(process.env.EMAIL_AUTH_RESEND_COOLDOWN_SECONDS || 60) || 60);
const emailAuthMaxAttempts = Math.max(1, Number(process.env.EMAIL_AUTH_MAX_ATTEMPTS || 5) || 5);
const emailAuthFrom = String(process.env.EMAIL_AUTH_FROM || 'AI Compare <noreply@aicompare.club>').trim();
const emailAuthReplyTo = String(process.env.EMAIL_AUTH_REPLY_TO || '').trim();
const failureLogDailyUploadLimit = Math.max(1, Number(process.env.FAILURE_LOG_DAILY_UPLOAD_LIMIT || 2000) || 2000);
const failureLogBatchLimit = 50;
const officialAgentInputTokenPricePerMillion = Math.max(
  0,
  Number(process.env.OFFICIAL_AGENT_INPUT_TOKEN_PRICE_PER_MILLION || 0) || 0
);
const officialAgentOutputTokenPricePerMillion = Math.max(
  0,
  Number(process.env.OFFICIAL_AGENT_OUTPUT_TOKEN_PRICE_PER_MILLION || 0) || 0
);
const officialAgentCostMultiplier = Math.max(
  0,
  Number(process.env.OFFICIAL_AGENT_COST_MULTIPLIER || 0.15) || 0.15
);
const officialAgentCostCurrency = String(process.env.OFFICIAL_AGENT_COST_CURRENCY || 'usd').trim().toLowerCase() || 'usd';
const openRouterApiKey = String(process.env.OPENROUTER_API_KEY || '').trim();
const openRouterClassifierModel = String(
  process.env.OPENROUTER_CLASSIFIER_MODEL || 'openai/gpt-oss-20b:free'
).trim();
const queryInsightDefaultLimit = Math.max(1, Number(process.env.QUERY_INSIGHT_ANALYSIS_LIMIT || 80) || 80);
const queryInsightAutoEnabled = String(process.env.QUERY_INSIGHT_AUTO_ENABLED || 'true').trim().toLowerCase() !== 'false';
const queryInsightAutoIntervalMs = Math.max(60 * 1000, Number(process.env.QUERY_INSIGHT_AUTO_INTERVAL_MS || 5 * 60 * 1000) || (5 * 60 * 1000));
const queryInsightAutoLimit = Math.max(1, Number(process.env.QUERY_INSIGHT_AUTO_LIMIT || queryInsightDefaultLimit) || queryInsightDefaultLimit);
const queryInsightAutoDays = Math.max(1, Number(process.env.QUERY_INSIGHT_AUTO_DAYS || 7) || 7);
let queryInsightAutoRunning = false;

function normalizeTokenUsage(usage = {}) {
  const promptTokens = Math.max(0, Math.round(Number(
    usage.prompt_tokens ?? usage.promptTokens ?? usage.input_tokens ?? usage.inputTokens ?? 0
  ) || 0));
  const completionTokens = Math.max(0, Math.round(Number(
    usage.completion_tokens ?? usage.completionTokens ?? usage.output_tokens ?? usage.outputTokens ?? 0
  ) || 0));
  const explicitTotal = Number(usage.total_tokens ?? usage.totalTokens);
  const totalTokens = Math.max(0, Math.round(Number.isFinite(explicitTotal)
    ? explicitTotal
    : promptTokens + completionTokens));
  return {
    promptTokens,
    completionTokens,
    totalTokens
  };
}

function extractTokenUsageFromPayload(payload = {}) {
  if (!payload || typeof payload !== 'object') {
    return normalizeTokenUsage();
  }
  if (payload.usage && typeof payload.usage === 'object') {
    return normalizeTokenUsage(payload.usage);
  }
  return normalizeTokenUsage(payload);
}

function estimateOfficialApiCost(usage = {}) {
  const tokenUsage = normalizeTokenUsage(usage);
  const officialEstimatedCost = (
    (tokenUsage.promptTokens / 1000000) * officialAgentInputTokenPricePerMillion
    + (tokenUsage.completionTokens / 1000000) * officialAgentOutputTokenPricePerMillion
  );
  const estimatedCost = officialEstimatedCost * officialAgentCostMultiplier;
  return {
    ...tokenUsage,
    officialEstimatedCost: Number(officialEstimatedCost.toFixed(8)),
    estimatedCost: Number(estimatedCost.toFixed(8)),
    costMultiplier: officialAgentCostMultiplier,
    currency: officialAgentCostCurrency
  };
}

function getOfficialApiEventCost(data = {}) {
  const computed = estimateOfficialApiCost(data);
  if (computed.officialEstimatedCost > 0) {
    return computed;
  }
  const storedActualCost = Math.max(0, Number(data.estimatedCost) || 0);
  const storedOfficialCost = Math.max(0, Number(data.officialEstimatedCost) || 0);
  const storedMultiplier = Math.max(0, Number(data.costMultiplier) || 0);
  const officialEstimatedCost = storedOfficialCost
    || (storedMultiplier > 0 ? storedActualCost / storedMultiplier : storedActualCost / Math.max(officialAgentCostMultiplier, 0.000001));
  const estimatedCost = storedOfficialCost > 0
    ? storedOfficialCost * officialAgentCostMultiplier
    : (storedMultiplier > 0 ? storedActualCost : storedActualCost * officialAgentCostMultiplier);
  return {
    ...computed,
    officialEstimatedCost: Number(officialEstimatedCost.toFixed(8)),
    estimatedCost: Number(estimatedCost.toFixed(8)),
    costMultiplier: officialAgentCostMultiplier,
    currency: String(data.currency || officialAgentCostCurrency || 'usd')
  };
}

function isAnthropicOfficialApi(baseUrl = '') {
  const configuredFormat = String(process.env.OFFICIAL_AGENT_API_FORMAT || '').trim().toLowerCase();
  if (configuredFormat === 'anthropic') {
    return true;
  }
  return /\/anthropic(?:\/v\d+)?\/?$/i.test(String(baseUrl || '').trim());
}

function parseDataUrlImageSource(url = '') {
  const match = String(url || '').match(/^data:([^;,]+);base64,(.+)$/i);
  if (!match) {
    return null;
  }
  return {
    type: 'base64',
    media_type: match[1],
    data: match[2]
  };
}

function normalizeAnthropicContent(content) {
  if (Array.isArray(content)) {
    const parts = [];
    content.forEach((part) => {
      if (!part || typeof part !== 'object') return;
      if (part.type === 'text' && part.text) {
        parts.push({ type: 'text', text: String(part.text) });
        return;
      }
      if (part.type === 'image_url') {
        const source = parseDataUrlImageSource(part.image_url?.url || part.url || '');
        if (source) {
          parts.push({ type: 'image', source });
        }
      }
    });
    return parts.length ? parts : [{ type: 'text', text: '' }];
  }
  return [{ type: 'text', text: String(content || '') }];
}

function buildAnthropicMessages(openAiMessages = []) {
  const system = [];
  const messages = [];

  (Array.isArray(openAiMessages) ? openAiMessages : []).forEach((message) => {
    const role = String(message?.role || 'user').trim();
    const content = normalizeAnthropicContent(message?.content);
    if (role === 'system') {
      const text = content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n')
        .trim();
      if (text) system.push(text);
      return;
    }

    const anthropicRole = role === 'assistant' ? 'assistant' : 'user';
    const previous = messages[messages.length - 1];
    if (previous && previous.role === anthropicRole) {
      previous.content.push(...content);
      return;
    }
    messages.push({
      role: anthropicRole,
      content
    });
  });

  if (!messages.length) {
    messages.push({
      role: 'user',
      content: [{ type: 'text', text: '' }]
    });
  }

  return {
    system: system.join('\n\n'),
    messages
  };
}

function buildAnthropicRequestBody(body = {}, model = '') {
  const { system, messages } = buildAnthropicMessages(body.messages);
  const maxTokens = Math.max(
    1,
    Number(body.max_tokens || body.maxTokens || process.env.OFFICIAL_AGENT_MAX_TOKENS || 4096) || 4096
  );
  const payload = {
    model,
    max_tokens: maxTokens,
    messages,
    stream: body.stream === true
  };

  if (system) payload.system = system;
  if (body.temperature !== undefined) payload.temperature = body.temperature;
  if (body.top_p !== undefined) payload.top_p = body.top_p;
  if (body.stop !== undefined) {
    payload.stop_sequences = Array.isArray(body.stop) ? body.stop : [String(body.stop)];
  }
  return payload;
}

function anthropicResponseToOpenAiCompletion(data = {}, model = '') {
  const content = Array.isArray(data.content)
    ? data.content
        .filter((part) => part?.type === 'text' && part.text)
        .map((part) => part.text)
        .join('')
    : '';
  const inputTokens = Number(data.usage?.input_tokens) || 0;
  const outputTokens = Number(data.usage?.output_tokens) || 0;

  return {
    id: data.id || `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: data.model || model,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content
      },
      finish_reason: data.stop_reason || 'stop'
    }],
    usage: {
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens
    }
  };
}

function writeOpenAiStreamDelta(res, content = '') {
  if (!content) return;
  res.write(`data: ${JSON.stringify({
    choices: [{
      index: 0,
      delta: { content },
      finish_reason: null
    }]
  })}\n\n`);
}

async function pipeAnthropicStreamAsOpenAi(upstream, res) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');

  const reader = upstream.body?.getReader?.();
  if (!reader) {
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let doneSent = false;
  const usage = normalizeTokenUsage();

  const handleLine = (rawLine = '') => {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) return;
    const rawPayload = line.slice(5).trim();
    if (!rawPayload || rawPayload === '[DONE]') return;

    let payload = null;
    try {
      payload = JSON.parse(rawPayload);
    } catch (_) {
      return;
    }

    if (payload.type === 'content_block_delta') {
      writeOpenAiStreamDelta(res, payload.delta?.text || '');
      return;
    }
    if (payload.type === 'message_start' && payload.message?.usage) {
      const nextUsage = normalizeTokenUsage(payload.message.usage);
      usage.promptTokens = Math.max(usage.promptTokens, nextUsage.promptTokens);
      usage.completionTokens = Math.max(usage.completionTokens, nextUsage.completionTokens);
      usage.totalTokens = usage.promptTokens + usage.completionTokens;
      return;
    }
    if (payload.type === 'message_delta' && payload.usage) {
      const nextUsage = normalizeTokenUsage(payload.usage);
      usage.promptTokens = Math.max(usage.promptTokens, nextUsage.promptTokens);
      usage.completionTokens = Math.max(usage.completionTokens, nextUsage.completionTokens);
      usage.totalTokens = usage.promptTokens + usage.completionTokens;
      return;
    }
    if (payload.type === 'message_stop') {
      res.write('data: [DONE]\n\n');
      doneSent = true;
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    lines.forEach(handleLine);
  }

  if (buffer) handleLine(buffer);
  if (!doneSent) {
    res.write('data: [DONE]\n\n');
  }
  res.end();
  return usage;
}

async function proxyAnthropicOfficialAgentChat(req, res, { apiKey, baseUrl, model, recordUsageEvent }) {
  const upstream = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'x-api-key': apiKey,
      'anthropic-version': process.env.OFFICIAL_AGENT_ANTHROPIC_VERSION || '2023-06-01'
    },
    body: JSON.stringify(buildAnthropicRequestBody(req.body || {}, model))
  });

  res.status(upstream.status);
  if (!upstream.ok) {
    if (recordUsageEvent) await recordUsageEvent({ upstreamStatus: upstream.status });
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json; charset=utf-8');
    res.send(await upstream.text());
    return;
  }

  if (req.body?.stream === true) {
    const tokenUsage = await pipeAnthropicStreamAsOpenAi(upstream, res);
    if (recordUsageEvent) await recordUsageEvent({ tokenUsage, upstreamStatus: upstream.status });
    return;
  }

  const data = await upstream.json();
  const converted = anthropicResponseToOpenAiCompletion(data, model);
  if (recordUsageEvent) await recordUsageEvent({
    tokenUsage: extractTokenUsageFromPayload(converted),
    upstreamStatus: upstream.status,
    upstreamModel: data.model || model
  });
  res.json(converted);
}

function buildOfficialOpenAiRequestBody(body = {}, model = '') {
  const payload = {
    ...body,
    model
  };
  if (payload.stream === true) {
    payload.stream_options = {
      ...(payload.stream_options && typeof payload.stream_options === 'object' ? payload.stream_options : {}),
      include_usage: true
    };
  }
  return payload;
}

async function pipeOpenAiStreamAndCollectUsage(upstream, res) {
  const reader = upstream.body?.getReader?.();
  if (!reader) {
    res.write(await upstream.text());
    return normalizeTokenUsage();
  }

  const decoder = new TextDecoder('utf-8');
  const usage = normalizeTokenUsage();
  let buffer = '';

  const collectFromLine = (rawLine = '') => {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) return;
    const rawPayload = line.slice(5).trim();
    if (!rawPayload || rawPayload === '[DONE]') return;
    try {
      const payload = JSON.parse(rawPayload);
      const nextUsage = extractTokenUsageFromPayload(payload);
      usage.promptTokens = Math.max(usage.promptTokens, nextUsage.promptTokens);
      usage.completionTokens = Math.max(usage.completionTokens, nextUsage.completionTokens);
      usage.totalTokens = Math.max(usage.totalTokens, nextUsage.totalTokens, usage.promptTokens + usage.completionTokens);
    } catch (_) {
      // Preserve streaming even if a vendor emits non-JSON diagnostic lines.
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunkText = decoder.decode(value, { stream: true });
    buffer += chunkText;
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    lines.forEach(collectFromLine);
    res.write(Buffer.from(value));
  }

  if (buffer) collectFromLine(buffer);
  return usage;
}

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

async function fetchAdminJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.headers || {})
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

const ADMIN_REMEMBER_KEY = 'aiCompareAdminRememberedCredentials';

function loadRememberedAdminCredentials() {
  try {
    const raw = window.localStorage.getItem(ADMIN_REMEMBER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      username: String(parsed.username || ''),
      password: String(parsed.password || '')
    };
  } catch (_) {
    return null;
  }
}

function saveRememberedAdminCredentials(username, password) {
  try {
    window.localStorage.setItem(ADMIN_REMEMBER_KEY, JSON.stringify({
      username: String(username || ''),
      password: String(password || '')
    }));
  } catch (_) {
    // Ignore localStorage failures; login should still work.
  }
}

function clearRememberedAdminCredentials() {
  try {
    window.localStorage.removeItem(ADMIN_REMEMBER_KEY);
  } catch (_) {
    // Ignore localStorage failures.
  }
}

function hydrateRememberedAdminCredentials(usernameInput, passwordInput, rememberInput) {
  const remembered = loadRememberedAdminCredentials();
  if (!remembered) return;
  usernameInput.value = remembered.username;
  passwordInput.value = remembered.password;
  rememberInput.checked = true;
}

function persistRememberedAdminCredentials(usernameInput, passwordInput, rememberInput) {
  if (rememberInput.checked) {
    saveRememberedAdminCredentials(usernameInput.value.trim(), passwordInput.value);
    return;
  }
  clearRememberedAdminCredentials();
}

function setAdminSessionPanelState(isAuthenticated) {
  const panel = document.getElementById('adminSessionPanel');
  const hero = panel ? panel.closest('.hero') : null;
  const loginForm = document.getElementById('adminLoginForm');
  const sessionSummary = document.getElementById('adminSessionSummary');
  const loginButton = document.getElementById('saveTokenButton');
  const clearButton = document.getElementById('clearTokenButton');
  if (!panel) return;
  panel.classList.toggle('is-authenticated', isAuthenticated);
  if (hero) hero.classList.toggle('is-authenticated', isAuthenticated);
  if (loginForm) loginForm.hidden = isAuthenticated;
  if (sessionSummary) sessionSummary.hidden = !isAuthenticated;
  if (loginButton) loginButton.hidden = isAuthenticated;
  if (clearButton) clearButton.textContent = isAuthenticated ? '退出登录' : '退出/清空';
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

function formatCost(value, currency = 'usd') {
  const normalizedCurrency = String(currency || 'usd').toUpperCase();
  return normalizedCurrency + ' ' + Number(value || 0).toLocaleString('zh-CN', {
    minimumFractionDigits: 4,
    maximumFractionDigits: 6
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

function formatCompactText(value, fallback = '-') {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text || fallback;
}

function truncateText(value, maxLength = 18, fallback = '-') {
  const text = formatCompactText(value, '');
  if (!text) return fallback;
  return text.length > maxLength ? text.slice(0, maxLength) + '…' : text;
}

function formatMetadataValue(value) {
  if (value == null) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  return String(value);
}

function renderUsageDetailField(label, value) {
  return '<div class="usage-detail-field"><span class="detail-label">' + escapeHtml(label) + '</span><div>' + escapeHtml(formatCompactText(value)) + '</div></div>';
}

function renderUsageDetailLongField(label, value) {
  const text = String(value || '').trim();
  return '<div class="usage-detail-field usage-detail-wide"><span class="detail-label">' + escapeHtml(label) + '</span><pre class="usage-query-full">' + escapeHtml(text || '-') + '</pre></div>';
}

function renderUsageDetailList(label, items) {
  const values = Array.isArray(items) ? items.filter(Boolean) : [];
  return '<div class="usage-detail-field"><span class="detail-label">' + escapeHtml(label) + '</span><div class="pill-row">'
    + (values.length ? values.map((item) => '<span class="pill">' + escapeHtml(item) + '</span>').join('') : '<span class="muted-cell">-</span>')
    + '</div></div>';
}

function renderUsageDetailJson(item) {
  return escapeHtml(JSON.stringify(item || {}, null, 2));
}

function formatRepeatCountLabel(item) {
  const repeatCount = Math.max(1, Math.round(Number(item?.repeatCount) || 1));
  return repeatCount > 1 ? repeatCount + ' 次同类记录' : '1 次';
}

function openUsageDetailDrawer(index) {
  const item = window.__usageRecentRecords?.[Number(index)];
  if (!item) return;
  const drawer = document.getElementById('usageDetailDrawer');
  const backdrop = document.getElementById('usageDrawerBackdrop');
  const body = document.getElementById('usageDetailBody');
  if (!drawer || !backdrop || !body) return;
  const userLabel = item.email || item.uid || item.userType || '-';
  const target = (item.siteNames || []).join(', ') || (item.skillNames || []).join(', ') || item.target || '-';
  body.innerHTML = ''
    + renderUsageDetailField('时间', formatDate(item.createdAt))
    + renderUsageDetailField('类型', item.usageType || (item.kind === 'api' ? '官方 API' : '站点'))
    + renderUsageDetailField('同类次数', formatRepeatCountLabel(item))
    + renderUsageDetailField('用户', userLabel)
    + renderUsageDetailField('UID', item.uid || '-')
    + renderUsageDetailField('地区', item.requestRegion || '-')
    + renderUsageDetailField('设备 ID', item.deviceId || '-')
    + renderUsageDetailField('IP', item.requestIp || '-')
    + renderUsageDetailField('模型 / 站点', target)
    + renderUsageDetailList('站点', item.siteNames || [])
    + renderUsageDetailList('技能', item.skillNames || [])
    + renderUsageDetailLongField('完整 Query', item.queryText || item.queryPreview || '-')
    + renderUsageDetailField('Query 摘要', item.queryPreview || '-')
    + renderUsageDetailField('Query Hash', item.queryHash || '-')
    + renderUsageDetailField('首次出现', item.firstSeenAt ? formatDate(item.firstSeenAt) : '-')
    + renderUsageDetailField('最近出现', item.lastSeenAt ? formatDate(item.lastSeenAt) : '-')
    + renderUsageDetailField('详情', item.detail || '-')
    + renderUsageDetailField('版本', item.extensionVersion || '-')
    + '<div class="usage-detail-field usage-detail-raw"><span class="detail-label">原始记录</span><pre>' + renderUsageDetailJson(item) + '</pre></div>';
  drawer.classList.add('open');
  backdrop.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
}

function closeUsageDetailDrawer() {
  document.getElementById('usageDetailDrawer')?.classList.remove('open');
  document.getElementById('usageDrawerBackdrop')?.classList.remove('open');
  document.getElementById('usageDetailDrawer')?.setAttribute('aria-hidden', 'true');
}

function getUsageRecentSearchText(item) {
  return [
    formatDate(item.createdAt),
    item.kind,
    item.usageType,
    item.userType,
    item.email,
    item.uid,
    item.deviceId,
    item.requestRegion,
    item.locale,
    item.target,
    (item.siteNames || []).join(' '),
    (item.skillNames || []).join(' '),
    item.queryPreview,
    item.queryText,
    item.queryHash,
    item.detail,
    item.extensionVersion
  ].map((value) => String(value || '').toLowerCase()).join(' ');
}

function getUsageRecentFilterValues() {
  return {
    date: String(document.getElementById('usageRecentDateFilter')?.value || '').trim().toLowerCase(),
    type: String(document.getElementById('usageRecentTypeFilter')?.value || '').trim(),
    user: String(document.getElementById('usageRecentUserFilter')?.value || '').trim().toLowerCase(),
    device: String(document.getElementById('usageRecentLocaleFilter')?.value || '').trim().toLowerCase(),
    target: String(document.getElementById('usageRecentTargetFilter')?.value || '').trim().toLowerCase(),
    version: String(document.getElementById('usageRecentVersionFilter')?.value || '').trim().toLowerCase(),
    query: String(document.getElementById('usageRecentQueryFilter')?.value || '').trim().toLowerCase()
  };
}

function usageRecentMatchesFilters(item, filters) {
  const usageType = item.usageType || (item.kind === 'api' ? '官方 API' : '站点');
  if (filters.type === 'api' && item.kind !== 'api') return false;
  if (filters.type === 'site' && item.kind !== 'site') return false;
  if (filters.type && !['api', 'site'].includes(filters.type) && usageType !== filters.type) return false;
  if (filters.date && !formatDate(item.createdAt).toLowerCase().includes(filters.date)) return false;
  const userText = [item.email, item.uid, item.userType].map((value) => String(value || '').toLowerCase()).join(' ');
  if (filters.user && !userText.includes(filters.user)) return false;
  const deviceText = [item.requestRegion, item.locale, item.deviceId].map((value) => String(value || '').toLowerCase()).join(' ');
  if (filters.device && !deviceText.includes(filters.device)) return false;
  const targetText = [item.target, (item.siteNames || []).join(' '), (item.skillNames || []).join(' ')].map((value) => String(value || '').toLowerCase()).join(' ');
  if (filters.target && !targetText.includes(filters.target)) return false;
  if (filters.version && !String(item.extensionVersion || '').toLowerCase().includes(filters.version)) return false;
  const queryText = [item.queryPreview, item.queryText, item.queryHash, item.detail].map((value) => String(value || '').toLowerCase()).join(' ');
  if (filters.query && !queryText.includes(filters.query)) return false;
  return true;
}

function renderUsageRecentRows() {
  const recent = Array.isArray(window.__usageRecentRecords) ? window.__usageRecentRecords : [];
  const body = document.getElementById('usageRecentBody');
  if (!body) return;
  const filters = getUsageRecentFilterValues();
  const hasFilters = Object.values(filters).some(Boolean);
  const filtered = recent
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => usageRecentMatchesFilters(item, filters));
  body.innerHTML = filtered.length
    ? filtered.map(({ item, index }) => {
      const usageType = item.usageType || (item.kind === 'api' ? '官方 API' : '站点');
      const userLabel = item.email || item.uid || item.userType || '-';
      const localeLabel = item.locale || '-';
      const regionLabel = item.requestRegion || '未知地区';
      const target = (item.siteNames || []).join(', ') || (item.skillNames || []).join(', ') || item.target || '-';
      const summary = item.queryPreview || item.detail || item.queryHash || '-';
      const fullPrompt = item.queryText || item.queryPreview || item.detail || item.queryHash || '-';
      const repeatLabel = Number(item.repeatCount || 1) > 1 ? '同类 ' + formatNumber(item.repeatCount) + ' 次' : '';
      const versionLabel = item.extensionVersion || '-';
      return (
      '<tr class="usage-recent-row" data-index="' + index + '" tabindex="0" role="button" aria-label="查看使用详情">'
        + '<td>' + escapeHtml(formatDate(item.createdAt)) + '</td>'
        + '<td><div class="strong-cell clamp-cell">' + escapeHtml(truncateText(usageType, 8)) + '</div><div class="muted-cell clamp-cell">' + escapeHtml(item.kind === 'api' ? 'API' : '站点') + '</div></td>'
        + '<td><div class="strong-cell clamp-cell">' + escapeHtml(truncateText(userLabel, 14)) + '</div><div class="muted-cell clamp-cell">' + escapeHtml(truncateText(item.uid || item.userType || '-', 10)) + '</div></td>'
        + '<td><div class="strong-cell clamp-cell">' + escapeHtml(truncateText(regionLabel, 14)) + '</div><div class="muted-cell clamp-cell mono-cell">' + escapeHtml(truncateText(localeLabel, 12)) + '</div></td>'
        + '<td><div class="strong-cell clamp-cell">' + escapeHtml(truncateText(target, 18)) + '</div></td>'
        + '<td><div class="strong-cell clamp-cell mono-cell">' + escapeHtml(truncateText(versionLabel, 12)) + '</div></td>'
        + '<td title="' + escapeHtml(fullPrompt) + '"><div class="query-preview clamp-cell" title="' + escapeHtml(fullPrompt) + '">' + escapeHtml(truncateText(summary, 22)) + '</div>' + (repeatLabel ? '<div class="muted-cell clamp-cell">' + escapeHtml(repeatLabel) + '</div>' : '') + '</td>'
      + '</tr>'
      );
    }).join('')
    : renderEmptyRow(hasFilters ? '没有符合筛选条件的最近使用记录' : '暂无最近使用记录', 7);
  document.querySelectorAll('.usage-recent-row').forEach((row) => {
    row.addEventListener('click', () => openUsageDetailDrawer(row.dataset.index));
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openUsageDetailDrawer(row.dataset.index);
      }
    });
  });
}

function setupUsageRecentFilters() {
  if (window.__usageRecentFiltersBound) return;
  window.__usageRecentFiltersBound = true;
  ['usageRecentDateFilter', 'usageRecentUserFilter', 'usageRecentLocaleFilter', 'usageRecentTargetFilter', 'usageRecentVersionFilter', 'usageRecentQueryFilter'].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', renderUsageRecentRows);
  });
  document.getElementById('usageRecentTypeFilter')?.addEventListener('change', renderUsageRecentRows);
  document.getElementById('usageRecentClearFilters')?.addEventListener('click', () => {
    ['usageRecentDateFilter', 'usageRecentUserFilter', 'usageRecentLocaleFilter', 'usageRecentTargetFilter', 'usageRecentVersionFilter', 'usageRecentQueryFilter'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const typeFilter = document.getElementById('usageRecentTypeFilter');
    if (typeFilter) typeFilter.value = '';
    renderUsageRecentRows();
  });
}

function setupAdminTabs(containerId) {
  const container = document.getElementById(containerId);
  if (!container || container.dataset.bound === 'true') return;
  container.dataset.bound = 'true';
  const buttons = Array.from(container.querySelectorAll('[data-tab-target]'));
  const panels = Array.from(document.querySelectorAll('[data-tab-panel]'));
  const activate = (target) => {
    buttons.forEach((button) => {
      const active = button.dataset.tabTarget === target;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    panels.forEach((panel) => {
      panel.hidden = panel.dataset.tabPanel !== target;
    });
  };
  buttons.forEach((button) => {
    button.addEventListener('click', () => activate(button.dataset.tabTarget));
  });
  activate(buttons[0]?.dataset.tabTarget || '');
}

function renderPill(label, value) {
  const text = formatCompactText(value, '');
  if (!text) return '';
  return '<span class="pill"><strong>' + escapeHtml(label) + '</strong>' + escapeHtml(text) + '</span>';
}

function renderFailureContext(item) {
  const metadata = item.metadata && typeof item.metadata === 'object' ? item.metadata : {};
  const metadataPills = Object.entries(metadata)
    .filter((entry) => formatMetadataValue(entry[1]))
    .slice(0, 16)
    .map(([key, value]) => renderPill(key, formatMetadataValue(value)))
    .join('');
  const runtimeUrl = item.runtimeUrl || '';
  const pageUrl = item.pageUrl || '';
  const runtimeUrlLink = runtimeUrl
    ? '<a class="log-link" href="' + escapeHtml(runtimeUrl) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(runtimeUrl) + '</a>'
    : '-';
  const pageUrlLink = pageUrl
    ? '<a class="log-link" href="' + escapeHtml(pageUrl) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(pageUrl) + '</a>'
    : '-';
  return (
    '<div class="log-detail-grid">'
      + '<div><span class="detail-label">Query</span><div class="query-preview">' + escapeHtml(formatCompactText(item.queryPreview, '无 query 摘要')) + '</div></div>'
      + '<div><span class="detail-label">Runtime URL</span><div class="url-cell">' + runtimeUrlLink + '</div></div>'
      + '<div><span class="detail-label">Page URL</span><div class="url-cell">' + pageUrlLink + '</div></div>'
      + '<div><span class="detail-label">模型 / 语言 / 版本</span><div class="pill-row">'
        + renderPill('model', item.model || '-')
        + renderPill('locale', item.locale || item.requestLocale || '-')
        + renderPill('version', item.extensionVersion || '-')
      + '</div></div>'
      + '<div><span class="detail-label">诊断字段</span><div class="pill-row">'
        + renderPill('status', item.status ? ('HTTP ' + item.status) : '-')
        + renderPill('phase', item.phase || '-')
        + renderPill('source', item.source || '-')
        + renderPill('code', item.errorCode || '-')
        + renderPill('hash', item.queryHash || '-')
        + renderPill('record', item.clientRecordId || '-')
        + metadataPills
      + '</div></div>'
    + '</div>'
  );
}

function renderFailureLogRows(logs) {
  return logs.map((item) => {
    const target = item.category === 'api' ? (item.apiKind || 'API') : (item.siteName || '未知站点');
    const severityClass = item.category === 'api' ? 'tag-api' : 'tag-site';
    const failureTime = item.lastSeenAt || item.createdAt || item.uploadedAt;
    const url = item.runtimeUrl || item.pageUrl || '';
    const urlCell = url
      ? '<a class="log-link clamp-cell" href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer" title="' + escapeHtml(url) + '">' + escapeHtml(truncateText(url, 28)) + '</a>'
      : '-';
    const queryText = item.queryPreview || item.queryHash || '-';
    const userLabel = item.uploaderType === 'anonymous' ? '匿名' : '登录用户';
    return (
      '<tr class="log-row">'
        + '<td><div class="strong-cell">' + escapeHtml(formatDate(failureTime)) + '</div><div class="muted-cell">创建 ' + escapeHtml(formatDate(item.createdAt)) + '</div></td>'
        + '<td>' + escapeHtml(formatDate(item.uploadedAt)) + '</td>'
        + '<td><span class="type-tag ' + severityClass + '">' + escapeHtml(item.category === 'api' ? 'API' : '站点') + '</span></td>'
        + '<td><div class="strong-cell clamp-cell" title="' + escapeHtml(target) + '">' + escapeHtml(truncateText(target, 18)) + '</div></td>'
        + '<td>' + escapeHtml(item.source || '-') + '</td>'
        + '<td>' + escapeHtml(item.phase || '-') + '</td>'
        + '<td>' + escapeHtml(item.status ? ('HTTP ' + item.status) : '-') + '</td>'
        + '<td><div class="clamp-cell" title="' + escapeHtml(item.errorCode || '-') + '">' + escapeHtml(truncateText(item.errorCode || '-', 18)) + '</div></td>'
        + '<td><div class="clamp-cell" title="' + escapeHtml(item.model || '-') + '">' + escapeHtml(truncateText(item.model || '-', 16)) + '</div></td>'
        + '<td><div class="clamp-cell" title="' + escapeHtml(item.extensionVersion || '-') + '">' + escapeHtml(truncateText(item.extensionVersion || '-', 12)) + '</div></td>'
        + '<td><div class="strong-cell">' + escapeHtml(userLabel) + '</div><div class="muted-cell">' + escapeHtml(item.locale || item.requestLocale || '-') + '</div></td>'
        + '<td>' + escapeHtml(formatNumber(item.repeatCount || 1)) + '</td>'
        + '<td>' + urlCell + '</td>'
        + '<td><div class="query-preview clamp-cell" title="' + escapeHtml(queryText) + '">' + escapeHtml(truncateText(queryText, 28)) + '</div></td>'
        + '<td><div class="error-cell" title="' + escapeHtml(formatCompactText(item.errorMessage)) + '">' + escapeHtml(formatCompactText(item.errorMessage)) + '</div></td>'
      + '</tr>'
      + '<tr class="log-detail-row"><td colspan="15">' + renderFailureContext(item) + '</td></tr>'
    );
  }).join('');
}

async function loadOverview() {
  const [orderSummary, usageSummary] = await Promise.all([
    fetchAdminJson('/api/admin/orders/summary'),
    fetchAdminJson('/api/admin/usage/summary')
  ]);
  const cards = [
    { label: '当前有效 Pro', value: formatNumber(orderSummary.activeProUsers), note: '含 trialing / active' },
    { label: '近 30 天付费订单', value: formatNumber(orderSummary.thirtyDayPaidOrders), note: '按已支付发票统计' },
    { label: '今日 API 请求', value: formatNumber(usageSummary.today.apiRequests), note: formatNumber(usageSummary.today.totalTokens) + ' tokens' },
    { label: '今日站点对比', value: formatNumber(usageSummary.today.siteEvents), note: usageSummary.today.topSite || '暂无站点数据' },
    { label: '近 7 天 API 请求', value: formatNumber(usageSummary.last7Days.apiRequests), note: formatCost(usageSummary.last7Days.estimatedCost, usageSummary.last7Days.currency) },
    { label: '近 7 天站点对比', value: formatNumber(usageSummary.last7Days.siteEvents), note: '站点打开 ' + formatNumber(usageSummary.last7Days.siteLaunches) }
  ];
  document.getElementById('overviewCards').innerHTML = renderCards(cards);
  document.getElementById('overviewJson').textContent = JSON.stringify({ orderSummary, usageSummary }, null, 2);
}

async function loadOrdersPage() {
  setupAdminTabs('ordersTabs');
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

async function loadUsersPage() {
  const payload = await fetchAdminJson('/api/admin/users/list?limit=500');
  const summary = payload.summary || {};
  document.getElementById('usersCards').innerHTML = renderCards([
    { label: '注册用户数', value: formatNumber(payload.total) },
    { label: 'Chat Pro', value: formatNumber(summary.chatProUsers) },
    { label: 'API Pro', value: formatNumber(summary.apiProUsers) },
    { label: '有邮箱用户', value: formatNumber(summary.usersWithEmail) },
    { label: '有提问语言数据', value: formatNumber(summary.usersWithLocale) },
    { label: '最常用提问语言', value: summary.topLocale || '暂无' }
  ]);

  const users = Array.isArray(payload.users) ? payload.users : [];
  document.getElementById('usersTableBody').innerHTML = users.length
    ? users.map((item) => (
      '<tr>'
        + '<td><div class="strong-cell clamp-cell" title="' + escapeHtml(item.email || '-') + '">' + escapeHtml(item.email || '-') + '</div><div class="muted-cell mono-cell">' + escapeHtml(truncateText(item.uid, 16)) + '</div></td>'
        + '<td><div class="strong-cell">' + escapeHtml(item.chatPlanStatus || '-') + '</div><div class="muted-cell">' + escapeHtml(item.chatSubscriptionStatus || '-') + '</div></td>'
        + '<td>' + escapeHtml(formatDate(item.chatPlanExpiresAt)) + '</td>'
        + '<td><div class="strong-cell">' + escapeHtml(item.apiPlanStatus || '-') + '</div><div class="muted-cell">' + escapeHtml(item.apiSubscriptionStatus || '-') + '</div></td>'
        + '<td>' + escapeHtml(formatDate(item.apiPlanExpiresAt)) + '</td>'
        + '<td><div class="strong-cell">' + escapeHtml(item.commonLocale || '-') + '</div><div class="muted-cell">' + escapeHtml(item.localeSource || '-') + '</div></td>'
        + '<td>' + escapeHtml(formatDate(item.createdAt || item.authCreatedAt)) + '</td>'
        + '<td>' + escapeHtml(formatDate(item.lastSeenAt || item.updatedAt || item.authLastSignInAt)) + '</td>'
      + '</tr>'
    )).join('')
    : renderEmptyRow('暂无注册用户数据', 8);
}

function renderRedeemCodeRows(codes) {
  return codes.length
    ? codes.map((item) => (
      '<tr>'
        + '<td><div class="strong-cell mono-cell">' + escapeHtml(item.prefix || '-') + '</div></td>'
        + '<td>' + escapeHtml(item.planType === 'api' ? 'API Plan' : 'Chat Plan') + '</td>'
        + '<td>' + escapeHtml(item.interval === 'yearly' ? '年度' : '月度') + '</td>'
        + '<td>' + escapeHtml(item.status || '-') + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.redemptionCount || 0)) + ' / ' + escapeHtml(formatNumber(item.maxRedemptions || 1)) + '</td>'
        + '<td>' + escapeHtml(formatDate(item.expiresAt)) + '</td>'
        + '<td><div class="strong-cell clamp-cell">' + escapeHtml(formatDate(item.lastRedeemedAt)) + '</div><div class="muted-cell clamp-cell">' + escapeHtml(item.lastRedeemedByEmail || item.lastRedeemedByUid || '-') + '</div></td>'
        + '<td><div class="clamp-cell" title="' + escapeHtml(item.note || '') + '">' + escapeHtml(truncateText(item.note || '-', 20)) + '</div></td>'
      + '</tr>'
    )).join('')
    : renderEmptyRow('暂无兑换码', 8);
}

async function refreshRedeemCodes() {
  const tableBody = document.getElementById('redeemCodesTableBody');
  if (!tableBody) return;
  tableBody.innerHTML = renderEmptyRow('正在加载...', 8);
  const payload = await fetchAdminJson('/api/admin/redeem-codes?limit=100');
  tableBody.innerHTML = renderRedeemCodeRows(Array.isArray(payload.codes) ? payload.codes : []);
}

async function generateRedeemCodes() {
  const statusEl = document.getElementById('redeemCodeStatus');
  const outputEl = document.getElementById('generatedRedeemCodes');
  const button = document.getElementById('generateRedeemCodesButton');
  if (button) button.disabled = true;
  if (statusEl) statusEl.textContent = '正在生成兑换码...';
  if (outputEl) {
    outputEl.hidden = true;
    outputEl.textContent = '';
  }

  try {
    const payload = await fetchAdminJson('/api/admin/redeem-codes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        planType: document.getElementById('redeemPlanType')?.value || 'chat',
        interval: document.getElementById('redeemInterval')?.value || 'monthly',
        quantity: Number(document.getElementById('redeemQuantity')?.value || 1),
        maxRedemptions: Number(document.getElementById('redeemMaxRedemptions')?.value || 1),
        expiresInDays: Number(document.getElementById('redeemExpiresInDays')?.value || 365),
        note: document.getElementById('redeemNote')?.value || ''
      })
    });
    const codes = Array.isArray(payload.codes) ? payload.codes : [];
    if (outputEl) {
      outputEl.textContent = codes.join('\\n');
      outputEl.hidden = codes.length === 0;
    }
    if (statusEl) statusEl.textContent = '已生成 ' + formatNumber(codes.length) + ' 个兑换码。明文码只在这里显示一次，请及时复制。';
    await refreshRedeemCodes();
  } catch (error) {
    if (statusEl) statusEl.textContent = error.message || String(error);
  } finally {
    if (button) button.disabled = false;
  }
}

async function loadRedeemCodesPage() {
  document.getElementById('generateRedeemCodesButton')?.addEventListener('click', () => {
    generateRedeemCodes().catch((error) => {
      const statusEl = document.getElementById('redeemCodeStatus');
      if (statusEl) statusEl.textContent = error.message || String(error);
    });
  });
  document.getElementById('refreshRedeemCodesButton')?.addEventListener('click', () => {
    refreshRedeemCodes().catch((error) => {
      const statusEl = document.getElementById('redeemCodeStatus');
      if (statusEl) statusEl.textContent = error.message || String(error);
    });
  });
  await refreshRedeemCodes();
}

async function loadApiUsagePage() {
  setupAdminTabs('apiUsageTabs');
  const [summary, trendPayload, topTargetsPayload, recentPayload, productPayload, topSitesPayload, queryInsightsPayload] = await Promise.all([
    fetchAdminJson('/api/admin/usage/summary'),
    fetchAdminJson('/api/admin/usage/trend?days=7'),
    fetchAdminJson('/api/admin/usage/top-targets?days=7&limit=30'),
    fetchAdminJson('/api/admin/usage/recent?days=7&limit=100'),
    fetchAdminJson('/api/admin/product-health/summary'),
    fetchAdminJson('/api/admin/site-usage/top-sites?days=7&limit=30&includeAgents=false'),
    fetchAdminJson('/api/admin/query-insights/summary?days=7')
  ]);
  document.getElementById('apiCards').innerHTML = renderCards([
    { label: '今日 API 请求', value: formatNumber(summary.today.apiRequests), note: formatNumber(summary.today.totalTokens) + ' tokens' },
    { label: '今日站点对比', value: formatNumber(summary.today.siteEvents), note: summary.today.topSite || '暂无站点数据' },
    { label: '今日活跃登录用户', value: formatNumber(summary.today.activeUsers) },
    { label: '今日活跃匿名设备', value: formatNumber(summary.today.activeAnonymousClients) },
    { label: '近 7 天 API 请求', value: formatNumber(summary.last7Days.apiRequests), note: formatCost(summary.last7Days.estimatedCost, summary.last7Days.currency) },
    { label: '近 7 天站点对比', value: formatNumber(summary.last7Days.siteEvents), note: '站点打开 ' + formatNumber(summary.last7Days.siteLaunches) },
    { label: '近 7 天功能事件', value: formatNumber(productPayload.last7Days.featureEvents), note: productPayload.last7Days.topFeature || '暂无' },
    { label: '近 7 天激活事件', value: formatNumber(productPayload.last7Days.activationEvents) }
  ]);

  const trend = Array.isArray(trendPayload.days) ? trendPayload.days : [];
  document.getElementById('apiTrendBody').innerHTML = trend.length
    ? trend.map((item) => (
      '<tr>'
        + '<td>' + escapeHtml(item.date) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.apiRequests)) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.siteEvents)) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.siteLaunches)) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.totalTokens)) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.activeUsers)) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.activeAnonymousClients)) + '</td>'
        + '<td>' + escapeHtml(item.topSite || '-') + '</td>'
      + '</tr>'
    )).join('')
    : renderEmptyRow('暂无使用趋势数据', 8);

  const topTargets = Array.isArray(topTargetsPayload.targets) ? topTargetsPayload.targets : [];
  document.getElementById('usageTopTargetsBody').innerHTML = topTargets.length
    ? topTargets.map((item) => (
      '<tr>'
        + '<td>' + escapeHtml(item.kind === 'api' ? 'API' : '站点') + '</td>'
        + '<td>' + escapeHtml(item.target || '-') + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.count)) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.activeUsers)) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.activeAnonymousClients)) + '</td>'
        + '<td>' + escapeHtml(item.kind === 'api' ? formatNumber(item.totalTokens) : formatNumber(item.withQueryEvents)) + '</td>'
      + '</tr>'
    )).join('')
    : renderEmptyRow('暂无高频使用数据', 6);

  const topSites = Array.isArray(topSitesPayload.sites) ? topSitesPayload.sites : [];
  document.getElementById('usageFavoriteSitesBody').innerHTML = topSites.length
    ? topSites.map((item, index) => (
      '<tr>'
        + '<td>' + escapeHtml(formatNumber(index + 1)) + '</td>'
        + '<td>' + escapeHtml(item.siteName || '-') + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.launches)) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.events)) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.activeUsers)) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.activeAnonymousClients)) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.withQueryEvents)) + '</td>'
      + '</tr>'
    )).join('')
    : renderEmptyRow('暂无近 7 天站点使用排行', 7);

  const recent = Array.isArray(recentPayload.events) ? recentPayload.events : [];
  window.__usageRecentRecords = recent;
  setupUsageRecentFilters();
  renderUsageRecentRows();

  document.getElementById('usageFeatureEventsBody').innerHTML = renderRankRows(Array.isArray(productPayload.topFeatures) ? productPayload.topFeatures : [], '暂无功能事件');
  renderQueryInsights(queryInsightsPayload);

  const usageVersions = Array.isArray(summary.versionDistribution) ? summary.versionDistribution : [];
  document.getElementById('usageSiteVersionsBody').innerHTML = renderVersionRows(usageVersions, '暂无站点版本数据', 'site');
  const productVersions = Array.isArray(productPayload.versionDistribution) ? productPayload.versionDistribution : [];
  document.getElementById('usageProductVersionsBody').innerHTML = renderVersionRows(productVersions, '暂无产品事件版本数据', 'product');
}

function renderQueryInsights(payload) {
  const status = document.getElementById('queryInsightStatus');
  const dailyBody = document.getElementById('queryInsightDailyBody');
  const weeklyBody = document.getElementById('queryInsightWeeklyBody');
  const typeBody = document.getElementById('queryInsightTypeBody');
  const insightBody = document.getElementById('queryInsightBody');
  if (!status || !dailyBody || !weeklyBody || !typeBody || !insightBody) return;
  status.textContent = payload.configured
    ? '已分析 ' + formatNumber(payload.analyzedEvents) + ' / ' + formatNumber(payload.totalEvents) + ' 条，未分析 ' + formatNumber(payload.unanalyzedEvents) + ' 条，模型：' + (payload.model || '-')
    : '未配置 OpenRouter Key，无法自动分析 Query 类型。';
  const topTypes = Array.isArray(payload.topTypes) ? payload.topTypes : [];
  typeBody.innerHTML = topTypes.length
    ? topTypes.map((item) => '<tr><td>' + escapeHtml(item.label) + '</td><td>' + escapeHtml(formatNumber(item.count)) + '</td></tr>').join('')
    : renderEmptyRow('暂无已分析类型数据', 2);
  const daily = Array.isArray(payload.daily) ? payload.daily : [];
  dailyBody.innerHTML = daily.length
    ? daily.map((item) => '<tr><td>' + escapeHtml(item.date) + '</td><td>' + escapeHtml(formatNumber(item.total)) + '</td><td>' + escapeHtml(Object.entries(item.types || {}).map(([key, value]) => key + ':' + value).join(' / ') || '-') + '</td></tr>').join('')
    : renderEmptyRow('暂无每日类型数据', 3);
  const weekly = Array.isArray(payload.weekly) ? payload.weekly : [];
  weeklyBody.innerHTML = weekly.length
    ? weekly.map((item) => '<tr><td>' + escapeHtml(item.weekStart) + '</td><td>' + escapeHtml(formatNumber(item.total)) + '</td><td>' + escapeHtml(Object.entries(item.types || {}).map(([key, value]) => key + ':' + value).join(' / ') || '-') + '</td></tr>').join('')
    : renderEmptyRow('暂无每周类型数据', 3);
  const insights = payload.insights || {};
  const cases = Array.isArray(insights.marketingCases) ? insights.marketingCases : [];
  insightBody.innerHTML = ''
    + '<tr><td>需求普遍性</td><td>' + escapeHtml(insights.demandUniversality || '-') + '</td></tr>'
	    + '<tr><td>画像摘要</td><td>' + escapeHtml(insights.summary || '-') + '</td></tr>'
	    + '<tr><td>真实任务</td><td>' + escapeHtml((insights.topTasks || []).map((item) => item.label + '(' + item.count + ')').join(' / ') || '-') + '</td></tr>'
	    + '<tr><td>目标人群</td><td>' + escapeHtml((insights.topAudiences || []).map((item) => item.label + '(' + item.count + ')').join(' / ') || '-') + '</td></tr>'
	    + '<tr><td>使用场景</td><td>' + escapeHtml((insights.topUseCases || []).map((item) => item.label + '(' + item.count + ')').join(' / ') || '-') + '</td></tr>'
	    + '<tr><td>高频领域</td><td>' + escapeHtml((insights.topDomains || []).map((item) => item.label + '(' + item.count + ')').join(' / ') || '-') + '</td></tr>'
    + '<tr><td>用户角色</td><td>' + escapeHtml((insights.topRoles || []).map((item) => item.label + '(' + item.count + ')').join(' / ') || '-') + '</td></tr>'
    + '<tr><td>案例候选</td><td>' + escapeHtml(cases.slice(0, 5).map((item) => item.type + '：' + (item.angle || item.queryPreview)).join(' / ') || '暂无') + '</td></tr>';
}

async function analyzeQueryInsightsNow() {
  const button = document.getElementById('queryInsightAnalyzeButton');
  const status = document.getElementById('queryInsightStatus');
  if (button) button.disabled = true;
  if (status) status.textContent = '正在调用 OpenRouter 分析最近 Query...';
  try {
    const result = await fetchAdminJson('/api/admin/query-insights/analyze?days=7&limit=80', { method: 'POST' });
    const summary = await fetchAdminJson('/api/admin/query-insights/summary?days=7');
    renderQueryInsights(summary);
    if (status) status.textContent += ' 本次新增分析 ' + formatNumber(result.analyzed) + ' 条。';
  } catch (error) {
    if (status) status.textContent = 'Query 分析失败：' + (error.message || error);
  } finally {
    if (button) button.disabled = false;
  }
}

async function loadSiteUsagePage() {
  const [summary, trendPayload, topSitesPayload, recentPayload] = await Promise.all([
    fetchAdminJson('/api/admin/site-usage/summary'),
    fetchAdminJson('/api/admin/site-usage/trend?days=30'),
    fetchAdminJson('/api/admin/site-usage/top-sites?days=30&limit=30'),
    fetchAdminJson('/api/admin/site-usage/recent?days=7&limit=50')
  ]);
  document.getElementById('siteUsageCards').innerHTML = renderCards([
    { label: '今日对比次数', value: formatNumber(summary.today.totalEvents) },
    { label: '今日使用站点数', value: formatNumber(summary.today.uniqueSites) },
    { label: '今日活跃登录用户', value: formatNumber(summary.today.activeUsers) },
    { label: '今日活跃匿名设备', value: formatNumber(summary.today.activeAnonymousClients) },
    { label: '近 30 天对比次数', value: formatNumber(summary.last30Days.totalEvents) },
    { label: '最常使用站点', value: summary.last30Days.topSite || '暂无' }
  ]);

  const trend = Array.isArray(trendPayload.days) ? trendPayload.days : [];
  document.getElementById('siteUsageTrendBody').innerHTML = trend.length
    ? trend.map((item) => (
      '<tr>'
        + '<td>' + escapeHtml(item.date) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.totalEvents)) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.totalSiteLaunches)) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.uniqueSites)) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.activeUsers)) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.activeAnonymousClients)) + '</td>'
        + '<td>' + escapeHtml(item.topSite || '-') + '</td>'
      + '</tr>'
    )).join('')
    : renderEmptyRow('暂无站点使用趋势数据', 7);

  const topSites = Array.isArray(topSitesPayload.sites) ? topSitesPayload.sites : [];
  document.getElementById('siteUsageTopSitesBody').innerHTML = topSites.length
    ? topSites.map((item) => (
      '<tr>'
        + '<td>' + escapeHtml(item.siteName || '-') + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.launches)) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.events)) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.activeUsers)) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.activeAnonymousClients)) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.withQueryEvents)) + '</td>'
      + '</tr>'
    )).join('')
    : renderEmptyRow('暂无站点排行数据', 6);

  const recent = Array.isArray(recentPayload.events) ? recentPayload.events : [];
  document.getElementById('siteUsageRecentBody').innerHTML = recent.length
    ? recent.map((item) => (
      '<tr>'
        + '<td>' + escapeHtml(formatDate(item.createdAt || item.uploadedAt)) + '</td>'
        + '<td>' + escapeHtml(item.uploaderType === 'anonymous' ? '匿名' : '登录用户') + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.siteCount)) + '</td>'
        + '<td>' + escapeHtml((item.siteNames || []).join(', ') || '-') + '</td>'
        + '<td>' + escapeHtml((item.agentIds || []).join(', ') || '-') + '</td>'
        + '<td>' + escapeHtml(item.hasQuery ? '是' : '否') + '</td>'
        + '<td>' + escapeHtml(item.extensionVersion || '-') + '</td>'
      + '</tr>'
    )).join('')
    : renderEmptyRow('暂无最近站点使用记录', 7);
}

function getFailureFilters() {
  const days = document.getElementById('failureDays')?.value || '7';
  const category = document.getElementById('failureCategory')?.value || 'all';
  const query = document.getElementById('failureQuery')?.value || '';
  return new URLSearchParams({ days, category, query });
}

function getFinalFailureFilters() {
  const days = document.getElementById('finalFailureDays')?.value || '7';
  const category = document.getElementById('finalFailureCategory')?.value || 'all';
  const query = document.getElementById('finalFailureQuery')?.value || '';
  return new URLSearchParams({ days, category, query });
}

async function loadFailureLogsPage() {
  setupAdminTabs('failureLogsTabs');
  const filters = getFailureFilters();
  const [summary, trendPayload, listPayload, experiencePayload] = await Promise.all([
    fetchAdminJson('/api/admin/failure-logs/summary'),
    fetchAdminJson('/api/admin/failure-logs/trend?days=7'),
    fetchAdminJson('/api/admin/failure-logs/list?' + filters.toString() + '&limit=100'),
    fetchAdminJson('/api/admin/experience/summary')
  ]);
  document.getElementById('failureCards').innerHTML = renderCards([
    { label: '今日失败总数', value: formatNumber(summary.today.totalFailures) },
    { label: '今日失败站点数', value: formatNumber(summary.today.failedSites) },
    { label: '今日 API 失败', value: formatNumber(summary.today.apiFailures) },
    { label: '近 7 天失败', value: formatNumber(summary.last7Days.totalFailures) },
    { label: '近 7 天失败率', value: (experiencePayload.summary.failureRate || 0) + '%', note: '使用总量 ' + formatNumber(experiencePayload.summary.totalUsage) },
    { label: '最常失败目标', value: summary.today.topTarget || '暂无' }
  ]);

  const trend = Array.isArray(trendPayload.days) ? trendPayload.days : [];
  document.getElementById('failureTrendBody').innerHTML = trend.length
    ? trend.map((item) => (
      '<tr>'
        + '<td>' + escapeHtml(item.date) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.siteFailures)) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.apiFailures)) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.totalFailures)) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.failedSites)) + '</td>'
      + '</tr>'
    )).join('')
    : renderEmptyRow('暂无失败趋势数据', 5);

  const priorityTargets = Array.isArray(experiencePayload.priorityTargets) ? experiencePayload.priorityTargets : [];
  document.getElementById('failurePriorityBody').innerHTML = priorityTargets.length
    ? priorityTargets.map((item) => (
      '<tr>'
        + '<td>' + escapeHtml(item.category === 'api' ? 'API' : '站点') + '</td>'
        + '<td>' + escapeHtml(item.target || '-') + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.failures)) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.priorityScore)) + '</td>'
        + '<td>' + escapeHtml(item.topPhase || '-') + '</td>'
        + '<td>' + escapeHtml(formatCompactText(item.latestError)) + '</td>'
      + '</tr>'
    )).join('')
    : renderEmptyRow('暂无修复优先级数据', 6);

  const phases = Array.isArray(experiencePayload.topPhases) ? experiencePayload.topPhases : [];
  document.getElementById('failurePhasesBody').innerHTML = phases.length
    ? phases.map((item) => '<tr><td>' + escapeHtml(item.phase || '-') + '</td><td>' + escapeHtml(formatNumber(item.count)) + '</td></tr>').join('')
    : renderEmptyRow('暂无失败阶段数据', 2);

  const logs = Array.isArray(listPayload.logs) ? listPayload.logs : [];
  document.getElementById('failureLogsBody').innerHTML = logs.length
    ? renderFailureLogRows(logs)
    : renderEmptyRow('暂无失败日志', 15);
}

async function loadFinalFailuresPage() {
  setupAdminTabs('finalFailuresTabs');
  const filters = getFinalFailureFilters();
  const [summary, trendPayload, listPayload] = await Promise.all([
    fetchAdminJson('/api/admin/final-failures/summary'),
    fetchAdminJson('/api/admin/final-failures/trend?days=7'),
    fetchAdminJson('/api/admin/final-failures/list?' + filters.toString() + '&limit=100')
  ]);
  document.getElementById('finalFailureCards').innerHTML = renderCards([
    { label: '今日最终失败', value: formatNumber(summary.today.totalFailures) },
    { label: '今日失败站点数', value: formatNumber(summary.today.failedSites) },
    { label: '近 7 天最终失败', value: formatNumber(summary.last7Days.totalFailures) },
    { label: '近 7 天失败站点数', value: formatNumber(summary.last7Days.failedSites) },
    { label: '今日最常失败目标', value: summary.today.topTarget || '暂无' },
    { label: '统计口径', value: '弹窗出现', note: '中间重试不计入' }
  ]);

  const trend = Array.isArray(trendPayload.days) ? trendPayload.days : [];
  document.getElementById('finalFailureTrendBody').innerHTML = trend.length
    ? trend.map((item) => (
      '<tr>'
        + '<td>' + escapeHtml(item.date) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.siteFailures)) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.apiFailures)) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.totalFailures)) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.failedSites)) + '</td>'
      + '</tr>'
    )).join('')
    : renderEmptyRow('暂无最终失败趋势数据', 5);

  const logs = Array.isArray(listPayload.logs) ? listPayload.logs : [];
  document.getElementById('finalFailureLogsBody').innerHTML = logs.length
    ? renderFailureLogRows(logs)
    : renderEmptyRow('暂无最终失败记录', 15);
}

function renderRankRows(items, emptyMessage) {
  return items.length
    ? items.map((item) => (
      '<tr>'
        + '<td>' + escapeHtml(item.eventName || '-') + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.count)) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.activeUsers)) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.activeAnonymousClients)) + '</td>'
        + '<td>' + escapeHtml(item.topSource || '-') + '</td>'
        + '<td>' + escapeHtml(item.topVersion || '-') + '</td>'
        + '<td>' + escapeHtml(formatDate(item.latestAt)) + '</td>'
      + '</tr>'
    )).join('')
    : renderEmptyRow(emptyMessage, 7);
}

function renderVersionRows(items, emptyMessage, mode) {
  return items.length
    ? items.map((item) => (
      '<tr>'
        + '<td>' + escapeHtml(item.version || '-') + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.count)) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.activeUsers)) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.activeAnonymousClients)) + '</td>'
        + '<td>' + escapeHtml(mode === 'site' ? formatNumber(item.siteLaunches) : (item.topEvent || '-')) + '</td>'
        + '<td>' + escapeHtml(mode === 'site' ? formatNumber(item.withQueryEvents) : (item.topSource || '-')) + '</td>'
      + '</tr>'
    )).join('')
    : renderEmptyRow(emptyMessage, 6);
}

async function loadGrowthPage() {
  setupAdminTabs('growthTabs');
  const payload = await fetchAdminJson('/api/admin/growth/summary');
	  document.getElementById('growthCards').innerHTML = renderCards([
	    { label: '激活事件', value: formatNumber(payload.summary.activationEvents), note: payload.summary.topActivation || '暂无' },
	    { label: '功能事件', value: formatNumber(payload.summary.featureEvents) },
	    { label: '订阅漏斗事件', value: formatNumber(payload.summary.subscriptionEvents) },
	    { label: '激活登录用户', value: formatNumber(payload.summary.activatedUsers) },
	    { label: '激活匿名设备', value: formatNumber(payload.summary.activatedAnonymousClients) },
	    { label: '站点活跃登录用户', value: formatNumber(payload.summary.activeUsers) },
	    { label: '站点活跃匿名设备', value: formatNumber(payload.summary.activeAnonymousClients) },
	    { label: 'Top 工作流组合', value: payload.summary.topSiteCombination || '暂无' }
	  ]);
	  document.getElementById('growthActivationBody').innerHTML = renderRankRows(Array.isArray(payload.activationEvents) ? payload.activationEvents : [], '暂无激活事件');
	  const growthVersions = Array.isArray(payload.versionDistribution) ? payload.versionDistribution : [];
	  document.getElementById('growthVersionsBody').innerHTML = renderVersionRows(growthVersions, '暂无版本数据', 'site');
	  const maturityStages = payload.userMaturity?.stages || {};
	  const stageLabels = { new: '新用户', activated: '已激活', retained: '回访', workflow: '工作流', power: '高阶', pro: 'Pro' };
	  document.getElementById('growthMaturityBody').innerHTML = Object.keys(stageLabels).length
	    ? Object.keys(stageLabels).map((stage) => (
	      '<tr><td>' + escapeHtml(stageLabels[stage]) + '</td><td>' + escapeHtml(formatNumber(maturityStages[stage] || 0)) + '</td></tr>'
	    )).join('')
	    : renderEmptyRow('暂无成熟度数据', 2);
	  const combinations = Array.isArray(payload.topCombinations) ? payload.topCombinations : [];
	  document.getElementById('growthCombinationsBody').innerHTML = combinations.length
	    ? combinations.map((item) => (
	      '<tr>'
	        + '<td>' + escapeHtml((item.siteNames || []).concat((item.agentIds || []).map((agentId) => 'Agent: ' + agentId)).join(' + ') || item.siteCombinationKey || '-') + '</td>'
	        + '<td>' + escapeHtml(item.workflowMode || '-') + '</td>'
	        + '<td>' + escapeHtml(formatNumber(item.count)) + '</td>'
	        + '<td>' + escapeHtml(formatNumber(item.withQueryEvents)) + '</td>'
	        + '<td>' + escapeHtml(formatNumber((item.activeUsers || 0) + (item.activeAnonymousClients || 0))) + '</td>'
	        + '<td>' + escapeHtml(item.topVersion || '-') + '</td>'
	      + '</tr>'
	    )).join('')
	    : renderEmptyRow('暂无工作流组合数据', 6);
	  const cohorts = Array.isArray(payload.cohorts) ? payload.cohorts : [];
	  document.getElementById('growthCohortsBody').innerHTML = cohorts.length
	    ? cohorts.map((item) => (
	      '<tr>'
	        + '<td>' + escapeHtml(item.dateKey || '-') + '</td>'
	        + '<td>' + escapeHtml(formatNumber(item.users)) + '</td>'
	        + '<td>' + escapeHtml(formatNumber(item.d1Retained) + ' / ' + formatNumber(item.d1RetentionRate) + '%') + '</td>'
	        + '<td>' + escapeHtml(formatNumber(item.d7Retained) + ' / ' + formatNumber(item.d7RetentionRate) + '%') + '</td>'
	      + '</tr>'
	    )).join('')
	    : renderEmptyRow('暂无 cohort 数据', 4);
	  const sources = Array.isArray(payload.sources) ? payload.sources : [];
  document.getElementById('growthSourcesBody').innerHTML = sources.length
    ? sources.map((item) => '<tr><td>' + escapeHtml(item.source || '-') + '</td><td>' + escapeHtml(formatNumber(item.count)) + '</td></tr>').join('')
    : renderEmptyRow('暂无来源数据', 2);
  document.getElementById('growthNote').textContent = payload.note || '';
}

async function loadBusinessPage() {
  setupAdminTabs('businessTabs');
  const payload = await fetchAdminJson('/api/admin/business/summary');
  document.getElementById('businessCards').innerHTML = renderCards([
    { label: '免费额度触达', value: formatNumber(payload.summary.limitReached) },
    { label: 'Checkout 发起', value: formatNumber(payload.summary.checkoutStarted) },
    { label: '支付成功', value: formatNumber(payload.summary.checkoutSuccess) },
    { label: '有效 Pro', value: formatNumber(payload.summary.activeProUsers) },
    { label: '近 7 天 API 成本', value: formatCost(payload.summary.estimatedCost, payload.summary.costCurrency), note: formatNumber(payload.summary.totalTokens) + ' tokens' },
    { label: '单活跃身份成本', value: formatCost(payload.summary.costPerActiveIdentity, payload.summary.costCurrency) }
  ]);
  document.getElementById('businessFunnelBody').innerHTML = renderRankRows(Array.isArray(payload.funnelEvents) ? payload.funnelEvents : [], '暂无订阅漏斗事件');
  document.getElementById('businessDistributionBody').innerHTML = [
    '<tr><td>Tokens</td><td>' + escapeHtml(formatNumber(payload.tokenDistribution.p50)) + '</td><td>' + escapeHtml(formatNumber(payload.tokenDistribution.p90)) + '</td><td>' + escapeHtml(formatNumber(payload.tokenDistribution.p99)) + '</td></tr>',
    '<tr><td>估算成本</td><td>' + escapeHtml(formatCost(payload.costDistribution.p50, payload.summary.costCurrency)) + '</td><td>' + escapeHtml(formatCost(payload.costDistribution.p90, payload.summary.costCurrency)) + '</td><td>' + escapeHtml(formatCost(payload.costDistribution.p99, payload.summary.costCurrency)) + '</td></tr>'
  ].join('');
}

async function loadApiCostPage() {
  setupAdminTabs('apiCostTabs');
  const [summary, trendPayload, modelsPayload] = await Promise.all([
    fetchAdminJson('/api/admin/api-cost/summary?days=30'),
    fetchAdminJson('/api/admin/api-cost/trend?days=30'),
    fetchAdminJson('/api/admin/api-cost/by-model?days=30&limit=30')
  ]);
  document.getElementById('apiCostCards').innerHTML = renderCards([
    { label: '今日实际成本', value: formatCost(summary.today.estimatedCost, summary.currency), note: formatNumber(summary.today.totalTokens) + ' tokens' },
    { label: '今日官方价估算', value: formatCost(summary.today.officialEstimatedCost, summary.currency), note: '倍率 ' + summary.costMultiplier },
    { label: '近 7 天实际成本', value: formatCost(summary.last7Days.estimatedCost, summary.currency), note: formatNumber(summary.last7Days.totalRequests) + ' 请求' },
    { label: '近 30 天实际成本', value: formatCost(summary.last30Days.estimatedCost, summary.currency), note: formatNumber(summary.last30Days.totalTokens) + ' tokens' },
    { label: '近 30 天单请求成本', value: formatCost(summary.last30Days.costPerRequest, summary.currency) },
    { label: '近 30 天每 1M tokens 成本', value: formatCost(summary.last30Days.costPerMillionTokens, summary.currency) }
  ]);

  const days = Array.isArray(trendPayload.days) ? trendPayload.days : [];
  document.getElementById('apiCostTrendBody').innerHTML = days.length
    ? days.map((item) => (
      '<tr>'
        + '<td>' + escapeHtml(item.date) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.totalRequests)) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.promptTokens)) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.completionTokens)) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.totalTokens)) + '</td>'
        + '<td>' + escapeHtml(formatCost(item.officialEstimatedCost, trendPayload.currency)) + '</td>'
        + '<td>' + escapeHtml(formatCost(item.estimatedCost, trendPayload.currency)) + '</td>'
        + '<td>' + escapeHtml(formatCost(item.costPerRequest, trendPayload.currency)) + '</td>'
      + '</tr>'
    )).join('')
    : renderEmptyRow('暂无 API 成本趋势数据', 8);

  const models = Array.isArray(modelsPayload.models) ? modelsPayload.models : [];
  document.getElementById('apiCostModelsBody').innerHTML = models.length
    ? models.map((item) => (
      '<tr>'
        + '<td>' + escapeHtml(item.model || '-') + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.totalRequests)) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.totalTokens)) + '</td>'
        + '<td>' + escapeHtml(formatCost(item.officialEstimatedCost, modelsPayload.currency)) + '</td>'
        + '<td>' + escapeHtml(formatCost(item.estimatedCost, modelsPayload.currency)) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.activeUsers)) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.activeAnonymousClients)) + '</td>'
      + '</tr>'
    )).join('')
    : renderEmptyRow('暂无模型成本数据', 7);
}

async function loadShareLinksPage() {
  setupAdminTabs('shareLinksTabs');
  const [summary, trendPayload, listPayload] = await Promise.all([
    fetchAdminJson('/api/admin/share-links/summary?days=7'),
    fetchAdminJson('/api/admin/share-links/trend?days=7'),
    fetchAdminJson('/api/admin/share-links/list?days=7&limit=100')
  ]);
  document.getElementById('shareLinkCards').innerHTML = renderCards([
    { label: '今日生成共享链接', value: formatNumber(summary.today.totalShares) },
    { label: '今日包含总结', value: formatNumber(summary.today.withSummary) },
    { label: '今日平均站点数', value: Number(summary.today.avgSites || 0).toFixed(1) },
    { label: '近 7 天生成', value: formatNumber(summary.last7Days.totalShares) },
    { label: '近 7 天包含总结', value: formatNumber(summary.last7Days.withSummary) },
    { label: '最常共享站点', value: summary.last7Days.topSite || '暂无' }
  ]);

  const trend = Array.isArray(trendPayload.days) ? trendPayload.days : [];
  document.getElementById('shareLinkTrendBody').innerHTML = trend.length
    ? trend.map((item) => (
      '<tr>'
        + '<td>' + escapeHtml(item.date) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.totalShares)) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.activeShares)) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.expiredShares)) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.withSummary)) + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.totalResponses)) + '</td>'
        + '<td>' + escapeHtml(Number(item.avgSites || 0).toFixed(1)) + '</td>'
        + '<td>' + escapeHtml(item.topSite || '-') + '</td>'
      + '</tr>'
    )).join('')
    : renderEmptyRow('暂无共享链接趋势数据', 8);

  const shares = Array.isArray(listPayload.shares) ? listPayload.shares : [];
  document.getElementById('shareLinkListBody').innerHTML = shares.length
    ? shares.map((item) => {
      const sharePath = '/share/' + encodeURIComponent(item.shareId || '');
      return (
        '<tr>'
          + '<td><div class="strong-cell">' + escapeHtml(formatDate(item.createdAt)) + '</div><div class="muted-cell">过期 ' + escapeHtml(formatDate(item.expiresAt)) + '</div></td>'
          + '<td><div class="strong-cell mono-cell clamp-cell">' + escapeHtml(truncateText(item.shareId, 18)) + '</div><div class="muted-cell">' + escapeHtml(item.status || '-') + '</div></td>'
          + '<td><div class="query-preview">' + escapeHtml(truncateText(item.question, 42, '无问题文本')) + '</div><div class="muted-cell">' + escapeHtml(item.analysisTemplateName || '-') + '</div></td>'
          + '<td><div class="strong-cell">' + escapeHtml(formatNumber(item.siteCount)) + ' 个站点</div><div class="muted-cell">' + escapeHtml(truncateText((item.compareSites || []).join(', '), 34)) + '</div></td>'
          + '<td><div class="strong-cell">' + escapeHtml(formatNumber(item.responseCount)) + ' 个回答</div><div class="muted-cell">' + escapeHtml(item.hasSummary ? '包含总结' : '无总结') + '</div></td>'
          + '<td><a class="log-link" href="' + escapeHtml(sharePath) + '" target="_blank" rel="noopener noreferrer">打开</a></td>'
        + '</tr>'
      );
    }).join('')
    : renderEmptyRow('暂无近 7 天共享链接记录', 6);
}

function normalizeCoursePromoText(value, fallback = '') {
  const text = String(value || '').trim();
  return text || fallback;
}

function normalizeCoursePromoLocalesValue(value) {
  const locales = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return locales.length ? locales.join(', ') : 'zh_CN, zh_TW, zh';
}

function readCoursePromoForm() {
  return {
    enabled: document.getElementById('coursePromoEnabled')?.value === 'true',
    imageUrl: document.getElementById('coursePromoImageUrl')?.value.trim() || '',
    targetUrl: document.getElementById('coursePromoTargetUrl')?.value.trim() || '',
    title: document.getElementById('coursePromoTitle')?.value.trim() || '',
    subtitle: document.getElementById('coursePromoSubtitle')?.value.trim() || '',
    ctaText: document.getElementById('coursePromoCtaText')?.value.trim() || '',
    textAdEnabled: document.getElementById('coursePromoTextAdEnabled')?.value === 'true',
    textAdText: document.getElementById('coursePromoTextAdText')?.value.trim() || '',
    textAdUrl: document.getElementById('coursePromoTextAdUrl')?.value.trim() || '',
    targetLocales: normalizeCoursePromoLocalesValue(document.getElementById('coursePromoTargetLocales')?.value || ''),
    dismissDays: document.getElementById('coursePromoDismissDays')?.value || '',
    maxImpressionsPerDay: document.getElementById('coursePromoMaxImpressionsPerDay')?.value || ''
  };
}

function applyCoursePromoPreview(config = {}) {
  const image = document.getElementById('coursePromoImagePreview');
  const title = document.getElementById('coursePromoPreviewTitle');
  const subtitle = document.getElementById('coursePromoPreviewSubtitle');
  const link = document.getElementById('coursePromoPreviewLink');
  const meta = document.getElementById('coursePromoMeta');
  const textAdPreview = document.getElementById('coursePromoTextAdPreview');

  if (image) {
    image.hidden = !config.imageUrl;
    image.src = config.imageUrl || '';
    image.onerror = () => {
      image.hidden = true;
      image.removeAttribute('src');
    };
  }
  if (title) title.textContent = normalizeCoursePromoText(config.title, 'Codex 编程课');
  if (subtitle) subtitle.textContent = normalizeCoursePromoText(config.subtitle, '');
  if (link) {
    link.href = config.targetUrl || '#';
    link.textContent = config.ctaText || '打开链接';
  }
  if (textAdPreview) {
    textAdPreview.hidden = !config.textAdText;
    textAdPreview.href = config.textAdUrl || '#';
    textAdPreview.textContent = config.textAdText || '';
  }
  if (meta) {
    meta.textContent = [
      config.enabled ? '已开启' : '已关闭',
      config.textAdEnabled ? '文字广告已开启' : '文字广告已关闭',
      '目标语言: ' + normalizeCoursePromoLocalesValue(config.targetLocales),
      '关闭频控: ' + String(config.dismissDays || 7) + ' 天',
      '日展示上限: ' + String(config.maxImpressionsPerDay || 3)
    ].join(' · ');
  }
}

function fillCoursePromoForm(config = {}) {
  const enabled = document.getElementById('coursePromoEnabled');
  const imageUrl = document.getElementById('coursePromoImageUrl');
  const targetUrl = document.getElementById('coursePromoTargetUrl');
  const title = document.getElementById('coursePromoTitle');
  const subtitle = document.getElementById('coursePromoSubtitle');
  const ctaText = document.getElementById('coursePromoCtaText');
  const textAdEnabled = document.getElementById('coursePromoTextAdEnabled');
  const textAdText = document.getElementById('coursePromoTextAdText');
  const textAdUrl = document.getElementById('coursePromoTextAdUrl');
  const targetLocales = document.getElementById('coursePromoTargetLocales');
  const dismissDays = document.getElementById('coursePromoDismissDays');
  const maxImpressionsPerDay = document.getElementById('coursePromoMaxImpressionsPerDay');

  if (enabled) enabled.value = config.enabled ? 'true' : 'false';
  if (imageUrl) imageUrl.value = config.imageUrl || '';
  if (targetUrl) targetUrl.value = config.targetUrl || '';
  if (title) title.value = config.title || '';
  if (subtitle) subtitle.value = config.subtitle || '';
  if (ctaText) ctaText.value = config.ctaText || '';
  if (textAdEnabled) textAdEnabled.value = config.textAdEnabled ? 'true' : 'false';
  if (textAdText) textAdText.value = config.textAdText || '';
  if (textAdUrl) textAdUrl.value = config.textAdUrl || '';
  if (targetLocales) targetLocales.value = Array.isArray(config.targetLocales) ? config.targetLocales.join(', ') : normalizeCoursePromoLocalesValue(config.targetLocales);
  if (dismissDays) dismissDays.value = String(config.dismissDays || 7);
  if (maxImpressionsPerDay) maxImpressionsPerDay.value = String(config.maxImpressionsPerDay || 3);
  applyCoursePromoPreview(config);
}

async function loadCoursePromoPage() {
  const payload = await fetchAdminJson('/api/admin/course-promo');
  fillCoursePromoForm(payload.config || {});
  const saveButton = document.getElementById('coursePromoSaveButton');
  const refreshButton = document.getElementById('coursePromoRefreshButton');
  if (saveButton && saveButton.dataset.bound !== 'true') {
    saveButton.dataset.bound = 'true';
    saveButton.addEventListener('click', async () => {
      try {
        saveButton.disabled = true;
        saveButton.textContent = '保存中...';
        const response = await fetch('/api/admin/course-promo', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json'
          },
          body: JSON.stringify(readCoursePromoForm())
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(result.error || ('保存失败: HTTP ' + response.status));
        }
        fillCoursePromoForm(result.config || {});
        const status = document.getElementById('tokenStatus');
        if (status) status.textContent = '课程广告配置已保存。';
      } catch (error) {
        const status = document.getElementById('tokenStatus');
        if (status) status.textContent = error.message || String(error);
      } finally {
        saveButton.disabled = false;
        saveButton.textContent = '保存配置';
      }
    });
  }
  if (refreshButton && refreshButton.dataset.bound !== 'true') {
    refreshButton.dataset.bound = 'true';
    refreshButton.addEventListener('click', () => {
      loadCoursePromoPage().catch((error) => {
        const status = document.getElementById('tokenStatus');
        if (status) status.textContent = error.message || String(error);
      });
    });
  }
  ['coursePromoEnabled', 'coursePromoImageUrl', 'coursePromoTargetUrl', 'coursePromoTitle', 'coursePromoSubtitle', 'coursePromoCtaText', 'coursePromoTextAdEnabled', 'coursePromoTextAdText', 'coursePromoTextAdUrl', 'coursePromoTargetLocales', 'coursePromoDismissDays', 'coursePromoMaxImpressionsPerDay']
    .forEach((id) => {
      const element = document.getElementById(id);
      if (!element || element.dataset.bound === 'true') return;
      element.dataset.bound = 'true';
      element.addEventListener('input', () => applyCoursePromoPreview(readCoursePromoForm()));
      element.addEventListener('change', () => applyCoursePromoPreview(readCoursePromoForm()));
    });
}

async function bootAdminPage(pageName) {
  setAdminSessionPanelState(true);
  const usernameInput = document.getElementById('usernameInput');
  const passwordInput = document.getElementById('passwordInput');
  const rememberInput = document.getElementById('rememberPasswordInput');
  const saveButton = document.getElementById('saveTokenButton');
  const clearButton = document.getElementById('clearTokenButton');
  const statusEl = document.getElementById('tokenStatus');
  hydrateRememberedAdminCredentials(usernameInput, passwordInput, rememberInput);

  saveButton.addEventListener('click', async () => {
    try {
      statusEl.textContent = '正在登录...';
      await createAdminSession(usernameInput.value.trim(), passwordInput.value);
      persistRememberedAdminCredentials(usernameInput, passwordInput, rememberInput);
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
      statusEl.textContent = '管理员会话已清空，正在返回登录页。';
    } catch (error) {
      statusEl.textContent = error.message || String(error);
    }
    usernameInput.value = '';
    passwordInput.value = '';
    rememberInput.checked = false;
    clearRememberedAdminCredentials();
    window.location.href = '/admin/login';
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeUsageDetailDrawer();
    }
  });

  try {
    if (pageName === 'overview') await loadOverview();
    if (pageName === 'orders') await loadOrdersPage();
    if (pageName === 'users') await loadUsersPage();
    if (pageName === 'redeemCodes') await loadRedeemCodesPage();
    if (pageName === 'apiUsage') await loadApiUsagePage();
    if (pageName === 'siteUsage') await loadSiteUsagePage();
    if (pageName === 'growth') await loadGrowthPage();
    if (pageName === 'business') await loadBusinessPage();
    if (pageName === 'apiCost') await loadApiCostPage();
    if (pageName === 'shareLinks') await loadShareLinksPage();
    if (pageName === 'coursePromo') await loadCoursePromoPage();
    if (pageName === 'failureLogs') {
      document.getElementById('failureSearchButton')?.addEventListener('click', () => {
        loadFailureLogsPage().catch((error) => {
          statusEl.textContent = error.message || String(error);
        });
      });
      await loadFailureLogsPage();
    }
    if (pageName === 'finalFailures') {
      document.getElementById('finalFailureSearchButton')?.addEventListener('click', () => {
        loadFinalFailuresPage().catch((error) => {
          statusEl.textContent = error.message || String(error);
        });
      });
      await loadFinalFailuresPage();
    }
    statusEl.textContent = '数据已刷新，管理员会话有效。';
  } catch (error) {
    statusEl.textContent = error.message || String(error);
  }
}

async function bootAdminLoginPage() {
  setAdminSessionPanelState(false);
  const usernameInput = document.getElementById('usernameInput');
  const passwordInput = document.getElementById('passwordInput');
  const rememberInput = document.getElementById('rememberPasswordInput');
  const saveButton = document.getElementById('saveTokenButton');
  const clearButton = document.getElementById('clearTokenButton');
  const statusEl = document.getElementById('tokenStatus');
  hydrateRememberedAdminCredentials(usernameInput, passwordInput, rememberInput);

  saveButton.addEventListener('click', async () => {
    try {
      statusEl.textContent = '正在登录...';
      await createAdminSession(usernameInput.value.trim(), passwordInput.value);
      persistRememberedAdminCredentials(usernameInput, passwordInput, rememberInput);
      statusEl.textContent = '管理员登录成功，正在跳转。';
      window.location.href = getNextPath();
    } catch (error) {
      statusEl.textContent = error.message || String(error);
    }
  });

  clearButton.addEventListener('click', async () => {
    usernameInput.value = '';
    passwordInput.value = '';
    rememberInput.checked = false;
    clearRememberedAdminCredentials();
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
  .hero.is-authenticated {
    grid-template-columns: 1fr;
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
  .token-panel.is-authenticated {
    display: none;
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
  .admin-session-summary {
    padding: 16px;
    border: 1px solid rgba(182, 90, 45, 0.18);
    border-radius: 20px;
    background: rgba(182, 90, 45, 0.08);
    color: var(--text);
    font-weight: 800;
    line-height: 1.55;
  }
  .admin-session-summary small {
    display: block;
    margin-top: 4px;
    color: var(--muted);
    font-weight: 650;
  }
  .admin-login-form {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .admin-login-form[hidden],
  .admin-session-summary[hidden],
  .token-actions button[hidden] {
    display: none;
  }
  textarea, input[type="text"], input[type="password"], input[type="search"], input[type="url"], input[type="number"], select {
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
  .remember-password-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    color: var(--muted);
    font-size: 13px;
    line-height: 1.5;
  }
  .remember-password-row input {
    margin-top: 2px;
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
  .course-promo-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
  }
  .field {
    display: grid;
    gap: 8px;
    color: var(--muted);
    font-size: 13px;
  }
  .course-promo-field-wide {
    grid-column: 1 / -1;
  }
  .course-promo-subsection {
    margin-top: 18px;
    padding-top: 18px;
    border-top: 1px solid var(--border);
  }
  .course-promo-subsection h3 {
    margin: 0 0 12px;
    font-size: 16px;
  }
  .course-promo-actions {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    margin-top: 16px;
  }
  .course-promo-actions button:first-child {
    background: var(--accent);
    color: #fff;
  }
  .course-promo-actions button:last-child {
    background: #fff;
    color: var(--text);
    border: 1px solid var(--border);
  }
  .redeem-code-form {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 14px;
  }
  .redeem-note-field {
    grid-column: span 2;
  }
  .redeem-code-output {
    margin: 14px 0 0;
    white-space: pre-wrap;
    user-select: all;
  }
  .course-promo-meta {
    margin-top: 12px;
    color: var(--muted);
    font-size: 13px;
  }
  .course-promo-preview {
    display: grid;
    grid-template-columns: minmax(220px, 420px) 1fr;
    gap: 18px;
    align-items: center;
  }
  .course-promo-preview img {
    width: 100%;
    max-height: 220px;
    object-fit: cover;
    border-radius: 18px;
    border: 1px solid var(--border);
    background: var(--panel-strong);
  }
  .course-promo-preview-title {
    font-size: 24px;
    font-weight: 760;
    color: var(--text);
  }
  .course-promo-preview-subtitle {
    margin-top: 8px;
    color: var(--muted);
    line-height: 1.6;
  }
  .course-promo-preview-link {
    display: inline-flex;
    margin-top: 14px;
    color: var(--accent);
    font-weight: 700;
  }
  @media (max-width: 900px) {
    .course-promo-grid,
    .course-promo-preview {
      grid-template-columns: 1fr;
    }
  }
  .filter-row {
    display: grid;
    grid-template-columns: 150px 170px 1fr auto;
    gap: 12px;
    align-items: end;
  }
  .filter-row label {
    display: grid;
    gap: 8px;
    color: var(--muted);
    font-size: 13px;
  }
  .filter-row button {
    background: var(--accent);
    color: #fff;
    height: 52px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
    table-layout: fixed;
  }
  .table-scroll {
    width: 100%;
    overflow-x: auto;
    border-radius: 18px;
  }
  .failure-detail-table {
    min-width: 1680px;
    table-layout: auto;
  }
  .failure-detail-table th,
  .failure-detail-table td {
    white-space: normal;
  }
  .failure-detail-table th:nth-child(1),
  .failure-detail-table th:nth-child(2) {
    width: 150px;
  }
  .failure-detail-table th:nth-child(14),
  .failure-detail-table th:nth-child(15) {
    width: 260px;
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
  .strong-cell {
    font-weight: 700;
    color: var(--text);
  }
  .muted-cell {
    margin-top: 4px;
    color: var(--muted);
    font-size: 12px;
    line-height: 1.4;
  }
  .error-cell {
    max-width: 520px;
    color: #5f2519;
    font-weight: 650;
    line-height: 1.45;
    overflow-wrap: anywhere;
  }
  .type-tag, .pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border-radius: 999px;
    padding: 5px 9px;
    font-size: 12px;
    line-height: 1.2;
    border: 1px solid var(--border);
    background: #fff;
    color: var(--muted);
  }
  .type-tag {
    font-weight: 800;
  }
  .tag-api {
    background: rgba(54, 102, 166, 0.12);
    color: #28507f;
  }
  .tag-site {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .log-row td {
    border-bottom: 0;
    padding-bottom: 8px;
  }
  .log-detail-row td {
    padding-top: 0;
    padding-bottom: 16px;
  }
  .log-detail-grid {
    display: grid;
    grid-template-columns: minmax(220px, 0.9fr) minmax(260px, 1.2fr);
    gap: 12px;
    padding: 14px;
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.58);
    border: 1px solid rgba(85, 58, 36, 0.09);
  }
  .detail-label {
    display: block;
    margin-bottom: 6px;
    color: var(--muted);
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .query-preview {
    color: var(--text);
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  .clamp-cell {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mono-cell {
    font-family: "SFMono-Regular", "Menlo", "Consolas", monospace;
    letter-spacing: -0.03em;
  }
  .usage-filter-row th {
    padding-top: 0;
    vertical-align: top;
  }
  .usage-filter-input {
    width: 100%;
    min-width: 0;
    border: 1px solid rgba(85, 58, 36, 0.14);
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.72);
    color: var(--text);
    font: inherit;
    font-size: 12px;
    font-weight: 700;
    padding: 8px 10px;
    outline: none;
  }
  .usage-filter-input:focus {
    border-color: rgba(182, 90, 45, 0.48);
    box-shadow: 0 0 0 3px rgba(182, 90, 45, 0.12);
  }
  .usage-filter-combo {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
  }
  .usage-filter-clear {
    border: 1px solid rgba(85, 58, 36, 0.14);
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.72);
    color: var(--muted);
    padding: 8px 10px;
    white-space: nowrap;
  }
  .admin-tabs {
    position: sticky;
    top: 0;
    z-index: 40;
    display: flex;
    gap: 10px;
    margin: 16px 0 4px;
    padding: 10px;
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: rgba(255, 250, 242, 0.86);
    box-shadow: 0 14px 34px rgba(77, 50, 31, 0.08);
    backdrop-filter: blur(14px);
  }
  .tab-button {
    flex: 0 0 auto;
    border: 1px solid transparent;
    background: transparent;
    color: var(--muted);
    padding: 10px 14px;
    font-weight: 800;
    white-space: nowrap;
  }
  .tab-button.active {
    background: var(--accent);
    color: #fff;
    box-shadow: 0 10px 24px rgba(182, 90, 45, 0.2);
  }
  .tab-button:focus-visible {
    outline: 3px solid rgba(182, 90, 45, 0.24);
    outline-offset: 2px;
  }
  [data-tab-panel][hidden] {
    display: none;
  }
  .panel-heading-row {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    align-items: flex-start;
    margin-bottom: 14px;
  }
  .panel-heading-row h3 {
    margin-bottom: 8px;
  }
  .insight-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 18px;
    margin-top: 16px;
  }
  .insight-grid h4 {
    margin: 0 0 10px;
    font-size: 15px;
    color: var(--muted);
  }
  @media (max-width: 900px) {
    .panel-heading-row,
    .insight-grid {
      grid-template-columns: 1fr;
      display: grid;
    }
  }
  .usage-recent-row {
    cursor: pointer;
  }
  .usage-recent-row:hover {
    background: rgba(182, 90, 45, 0.06);
  }
  .usage-recent-row:focus {
    outline: 2px solid rgba(182, 90, 45, 0.34);
    outline-offset: -2px;
  }
  .usage-drawer-backdrop {
    position: fixed;
    inset: 0;
    z-index: 80;
    background: rgba(36, 25, 15, 0.2);
    opacity: 0;
    pointer-events: none;
    transition: opacity 180ms ease;
  }
  .usage-drawer-backdrop.open {
    opacity: 1;
    pointer-events: auto;
  }
  .usage-detail-drawer {
    position: fixed;
    top: 0;
    right: 0;
    z-index: 90;
    width: min(760px, calc(100vw - 24px));
    height: 100vh;
    padding: 22px;
    background: #fffaf2;
    border-left: 1px solid var(--border);
    box-shadow: -24px 0 60px rgba(77, 50, 31, 0.18);
    transform: translateX(105%);
    transition: transform 220ms ease;
    overflow: auto;
  }
  .usage-detail-drawer.open {
    transform: translateX(0);
  }
  .usage-detail-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 14px;
    margin-bottom: 18px;
  }
  .usage-detail-header h3 {
    margin: 10px 0 0;
    font-size: 24px;
  }
  .drawer-close-button {
    background: var(--accent);
    color: #fff;
    padding: 10px 14px;
  }
  .usage-detail-body {
    display: grid;
    gap: 12px;
  }
  .usage-detail-field {
    padding: 13px;
    border: 1px solid rgba(85, 58, 36, 0.1);
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.72);
    overflow-wrap: anywhere;
  }
  .usage-detail-wide {
    grid-column: 1 / -1;
  }
  .usage-query-full {
    margin: 0;
    max-height: 52vh;
    overflow: auto;
    padding: 16px;
    border: 1px solid rgba(85, 58, 36, 0.14);
    border-radius: 14px;
    background: #fff;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-family: "SFMono-Regular", "Menlo", "Consolas", "Noto Sans SC", monospace;
    font-size: 14px;
    line-height: 1.72;
    color: #1f1710;
  }
  .usage-detail-raw pre {
    max-height: 260px;
  }
  .url-cell {
    font-size: 12px;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  .log-link {
    color: #28507f;
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;
  }
  .pill-row {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
  }
  .pill strong {
    color: var(--text);
    font-weight: 800;
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
    .log-detail-grid {
      grid-template-columns: 1fr;
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

let emailAuthTransporter = null;

function getEmailAuthTransporter() {
  if (emailAuthTransporter) {
    return emailAuthTransporter;
  }

  const host = String(process.env.EMAIL_AUTH_SMTP_HOST || process.env.SMTP_HOST || '').trim();
  const port = Number(process.env.EMAIL_AUTH_SMTP_PORT || process.env.SMTP_PORT || 587) || 587;
  const user = String(process.env.EMAIL_AUTH_SMTP_USER || process.env.SMTP_USER || '').trim();
  const pass = String(process.env.EMAIL_AUTH_SMTP_PASS || process.env.SMTP_PASS || '').trim();
  const secureRaw = String(process.env.EMAIL_AUTH_SMTP_SECURE || process.env.SMTP_SECURE || '').trim().toLowerCase();
  const secure = secureRaw
    ? ['1', 'true', 'yes'].includes(secureRaw)
    : port === 465;

  if (!host || !user || !pass) {
    const error = new Error('Email verification sender is not configured');
    error.status = 500;
    error.code = 'EMAIL_SENDER_NOT_CONFIGURED';
    throw error;
  }

  emailAuthTransporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass }
  });
  return emailAuthTransporter;
}

function getEmailAuthStatus() {
  const host = String(process.env.EMAIL_AUTH_SMTP_HOST || process.env.SMTP_HOST || '').trim();
  const user = String(process.env.EMAIL_AUTH_SMTP_USER || process.env.SMTP_USER || '').trim();
  const pass = String(process.env.EMAIL_AUTH_SMTP_PASS || process.env.SMTP_PASS || '').trim();
  const secret = String(
    process.env.EMAIL_AUTH_CODE_SECRET
    || adminSessionSecret
    || process.env.STRIPE_WEBHOOK_SECRET
    || ''
  ).trim();
  const firebaseAdminReady = initializeFirebaseAdmin() && Boolean(db);
  const senderConfigured = Boolean(host && user && pass);
  const secretConfigured = Boolean(secret);

  return {
    enabled: Boolean(firebaseAdminReady && senderConfigured && secretConfigured),
    firebaseAdminReady,
    senderConfigured,
    secretConfigured,
    expiresInSeconds: emailAuthCodeTtlSeconds,
    resendCooldownSeconds: emailAuthResendCooldownSeconds
  };
}

function assertEmailAuthSecret() {
  const secret = String(
    process.env.EMAIL_AUTH_CODE_SECRET
    || adminSessionSecret
    || process.env.STRIPE_WEBHOOK_SECRET
    || ''
  ).trim();
  if (!secret) {
    const error = new Error('EMAIL_AUTH_CODE_SECRET is not configured');
    error.status = 500;
    error.code = 'EMAIL_AUTH_SECRET_NOT_CONFIGURED';
    throw error;
  }
  return secret;
}

function normalizeEmailLoginAddress(email = '') {
  const normalized = normalizeBillingEmail(email);
  if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    const error = new Error('Please enter a valid email address');
    error.status = 400;
    error.code = 'INVALID_EMAIL';
    throw error;
  }
  return normalized;
}

function getEmailLoginCodeDocId(email = '') {
  return crypto.createHash('sha256').update(normalizeEmailLoginAddress(email)).digest('hex');
}

function hashEmailLoginCode(email = '', code = '', salt = '') {
  return crypto
    .createHash('sha256')
    .update([
      assertEmailAuthSecret(),
      normalizeEmailLoginAddress(email),
      String(code || '').trim(),
      String(salt || '').trim()
    ].join(':'))
    .digest('hex');
}

function createEmailLoginCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function getFirestoreMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildEmailLoginMessage({ code, ttlMinutes }) {
  const safeCode = String(code || '').trim();
  const safeTtl = Math.max(1, Math.round(Number(ttlMinutes) || 10));
  return {
    subject: 'Your temporary AI Compare verification code',
    text: [
      'Enter this temporary verification code to continue:',
      '',
      safeCode,
      '',
      `This code expires in ${safeTtl} minutes.`,
      '',
      'Please ignore this email if this was not you trying to sign in to an AI Compare account.',
      '',
      'Best,',
      'The AI Compare team'
    ].join('\n'),
    html: [
      '<div style="margin:0;padding:0;background:#ffffff;color:#2d313b;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.45">',
      '<div style="max-width:640px;margin:0 auto;padding:28px 32px 40px">',
      '<div style="margin:0 0 52px;color:#000000;font-size:40px;font-weight:800;letter-spacing:-1.8px;line-height:1">AI Compare</div>',
      '<p style="margin:0 0 28px;font-size:20px;line-height:1.45;color:#2d313b">Enter this temporary verification code to continue:</p>',
      `<div style="box-sizing:border-box;width:100%;margin:0 0 34px;padding:31px 30px;border-radius:18px;background:#f1f1f1;color:#5c5f63;font-size:32px;font-weight:700;letter-spacing:3px;line-height:1.25">${safeCode}</div>`,
      '<p style="margin:0 0 56px;font-size:20px;line-height:1.45;color:#2d313b">Please ignore this email if this was not you trying to sign in to an AI Compare account.</p>',
      '<p style="margin:0;color:#858585;font-size:20px;line-height:1.45">Best,<br>The AI Compare team</p>',
      `<p style="margin:28px 0 0;color:#a3a3a3;font-size:13px;line-height:1.45">This code expires in ${safeTtl} minutes.</p>`,
      '</div>',
      '</div>'
    ].join('')
  };
}

async function sendEmailLoginCode(req) {
  requireFirebaseAdmin();
  const email = normalizeEmailLoginAddress(req.body?.email);
  console.info('[ai-compare-backend] email login code request', JSON.stringify({
    emailHash: getEmailLoginCodeDocId(email).slice(0, 12),
    userAgent: String(req.get?.('user-agent') || '').slice(0, 120),
    origin: String(req.get?.('origin') || '').slice(0, 120)
  }));
  const docRef = db.collection(emailLoginCodeCollection).doc(getEmailLoginCodeDocId(email));
  const now = Date.now();
  const existing = await docRef.get();
  const existingData = existing.exists ? existing.data() || {} : {};
  const lastSentAtMs = getFirestoreMillis(existingData.lastSentAt);
  const cooldownMs = emailAuthResendCooldownSeconds * 1000;

  if (cooldownMs > 0 && lastSentAtMs && now - lastSentAtMs < cooldownMs) {
    const error = new Error('Please wait before requesting another code');
    error.status = 429;
    error.code = 'EMAIL_CODE_COOLDOWN';
    error.retryAfterSeconds = Math.ceil((cooldownMs - (now - lastSentAtMs)) / 1000);
    console.info('[ai-compare-backend] email login code cooldown', JSON.stringify({
      emailHash: getEmailLoginCodeDocId(email).slice(0, 12),
      retryAfterSeconds: error.retryAfterSeconds,
      userAgent: String(req.get?.('user-agent') || '').slice(0, 120),
      origin: String(req.get?.('origin') || '').slice(0, 120)
    }));
    throw error;
  }

  const code = createEmailLoginCode();
  const salt = crypto.randomBytes(16).toString('hex');
  const expiresAtMs = now + emailAuthCodeTtlSeconds * 1000;
  const ttlMinutes = Math.ceil(emailAuthCodeTtlSeconds / 60);
  const mail = buildEmailLoginMessage({ code, ttlMinutes });

  await docRef.set({
    email,
    codeHash: hashEmailLoginCode(email, code, salt),
    salt,
    attempts: 0,
    createdAt: admin.firestore.Timestamp.fromMillis(now),
    lastSentAt: admin.firestore.Timestamp.fromMillis(now),
    expiresAt: admin.firestore.Timestamp.fromMillis(expiresAtMs),
    consumedAt: null
  }, { merge: true });

  try {
    const info = await getEmailAuthTransporter().sendMail({
      from: emailAuthFrom,
      ...(emailAuthReplyTo ? { replyTo: emailAuthReplyTo } : {}),
      to: email,
      subject: mail.subject,
      text: mail.text,
      html: mail.html
    });
    console.info('[ai-compare-backend] email login code sent', JSON.stringify({
      emailHash: getEmailLoginCodeDocId(email).slice(0, 12),
      messageId: info.messageId || '',
      accepted: Array.isArray(info.accepted) ? info.accepted.length : 0,
      rejected: Array.isArray(info.rejected) ? info.rejected.length : 0,
      response: String(info.response || '').slice(0, 160),
      userAgent: String(req.get?.('user-agent') || '').slice(0, 120),
      origin: String(req.get?.('origin') || '').slice(0, 120)
    }));
  } catch (error) {
    await docRef.delete().catch(() => null);
    error.status = 502;
    throw error;
  }

  return {
    ok: true,
    email,
    expiresInSeconds: emailAuthCodeTtlSeconds
  };
}

async function getOrCreateEmailLoginUser(email = '') {
  requireFirebaseAdmin();
  const normalizedEmail = normalizeEmailLoginAddress(email);
  try {
    const user = await admin.auth().getUserByEmail(normalizedEmail);
    if (!user.emailVerified) {
      await admin.auth().updateUser(user.uid, { emailVerified: true });
      return { ...user, emailVerified: true };
    }
    return user;
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') {
      throw error;
    }
  }

  return admin.auth().createUser({
    email: normalizedEmail,
    emailVerified: true
  });
}

async function verifyEmailLoginCode(req) {
  requireFirebaseAdmin();
  const email = normalizeEmailLoginAddress(req.body?.email);
  const code = String(req.body?.code || '').trim().replace(/\s+/g, '');
  if (!/^\d{6}$/.test(code)) {
    const error = new Error('Please enter the 6-digit verification code');
    error.status = 400;
    error.code = 'EMAIL_CODE_INVALID_FORMAT';
    throw error;
  }

  const docRef = db.collection(emailLoginCodeCollection).doc(getEmailLoginCodeDocId(email));
  const snapshot = await docRef.get();
  if (!snapshot.exists) {
    const error = new Error('Verification code not found or expired');
    error.status = 400;
    error.code = 'EMAIL_CODE_EXPIRED';
    throw error;
  }

  const data = snapshot.data() || {};
  const now = Date.now();
  if (data.consumedAt || getFirestoreMillis(data.expiresAt) <= now) {
    await docRef.delete().catch(() => null);
    const error = new Error('Verification code not found or expired');
    error.status = 400;
    error.code = 'EMAIL_CODE_EXPIRED';
    throw error;
  }

  const attempts = Math.max(0, Number(data.attempts || 0) || 0);
  if (attempts >= emailAuthMaxAttempts) {
    await docRef.delete().catch(() => null);
    const error = new Error('Too many verification attempts. Please request a new code');
    error.status = 429;
    error.code = 'EMAIL_CODE_TOO_MANY_ATTEMPTS';
    throw error;
  }

  const expectedHash = String(data.codeHash || '');
  const actualHash = hashEmailLoginCode(email, code, data.salt || '');
  if (!safeCompare(expectedHash, actualHash)) {
    await docRef.set({
      attempts: attempts + 1,
      lastAttemptAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    const error = new Error('Incorrect verification code');
    error.status = 400;
    error.code = 'EMAIL_CODE_INVALID';
    throw error;
  }

  const user = await getOrCreateEmailLoginUser(email);
  await docRef.set({
    consumedAt: admin.firestore.FieldValue.serverTimestamp(),
    attempts: attempts + 1
  }, { merge: true });

  const customToken = await admin.auth().createCustomToken(user.uid, {
    signInProvider: 'email_code'
  });

  return {
    ok: true,
    customToken,
    email,
    uid: user.uid
  };
}

function getCorsOrigin(req) {
  const origin = String(req.headers.origin || '').trim();
  if (!origin) return '*';
  return origin;
}

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', getCorsOrigin(req));
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type, Authorization, X-AI-Compare-Locale, X-AI-Compare-Client-Id, X-AI-Compare-Extension-Version');
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
      res.status(status).json({
        error: error.message || String(error),
        ...(error.code ? { code: String(error.code) } : {}),
        ...(Number.isFinite(error.retryAfterSeconds) ? { retryAfterSeconds: Number(error.retryAfterSeconds) } : {}),
        ...(Number.isFinite(error.limit) ? { limit: Number(error.limit) } : {})
      });
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

function getAnonymousClientHash(value = '') {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  if (/^[a-f0-9]{64}$/i.test(normalized)) {
    return normalized.toLowerCase();
  }
  return getAnonymousUsageDocId(normalized);
}

function normalizeLocale(locale = '') {
  return String(locale || '').trim().replace('-', '_').toLowerCase();
}

function shouldMeterLocale(locale = '') {
  if (billingMeterAllLocales) return true;
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

function sortDateRowsDescending(rows = [], key = 'date') {
  return [...(Array.isArray(rows) ? rows : [])].sort((left, right) => {
    const leftValue = String(left?.[key] || '');
    const rightValue = String(right?.[key] || '');
    return rightValue.localeCompare(leftValue);
  });
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
  const apiPlanExpiresAtSeconds = getTimestampSeconds(data.apiPlanExpiresAt);
  const isApiActive = data.apiPlan === 'pro' && (!apiPlanExpiresAtSeconds || apiPlanExpiresAtSeconds > Math.floor(Date.now() / 1000));
  return {
    plan: isActive ? 'pro' : 'free',
    planExpiresAt: data.planExpiresAt || null,
    apiPlan: isApiActive ? 'pro' : 'free',
    apiPlanExpiresAt: data.apiPlanExpiresAt || null,
    stripeCustomerId: data[getStripeCustomerIdField()] || data.stripeCustomerId || '',
    stripeCustomerIdLegacy: data.stripeCustomerId || '',
    stripeCustomerIdLive: data.stripeCustomerIdLive || '',
    stripeCustomerIdTest: data.stripeCustomerIdTest || '',
    stripeSubscriptionId: data[getStripeSubscriptionIdField()] || data.stripeSubscriptionId || '',
    stripeSubscriptionIdLegacy: data.stripeSubscriptionId || '',
    stripeSubscriptionIdLive: data.stripeSubscriptionIdLive || '',
    stripeSubscriptionIdTest: data.stripeSubscriptionIdTest || ''
  };
}

async function consumeOfficialApiUsage(uid, locale) {
  if (!shouldMeterLocale(locale)) {
    return { billingEnabled: false, plan: 'free', limit: dailyFreeLimit, used: 0, remaining: Number.POSITIVE_INFINITY };
  }

  const plan = await getUserPlan(uid);
  if (plan.apiPlan === 'pro') {
    return { billingEnabled: true, plan: 'api_pro', limit: dailyFreeLimit, used: 0, remaining: Number.POSITIVE_INFINITY };
  }

  const dateKey = getTodayKey();
  const usageRef = db.collection('users').doc(uid).collection('usage').doc(dateKey);
  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(usageRef);
    const used = snap.exists ? Math.max(0, Number(snap.data().officialApiCount) || 0) : 0;
    if (used >= dailyFreeLimit) {
      recordInternalAnalyticsEvent({
        kind: 'subscription',
        eventName: 'official_api_limit_reached',
        uid,
        uploaderType: 'user',
        source: 'backend',
        locale,
        metadata: { plan: plan.apiPlan || 'free', limit: dailyFreeLimit }
      }).catch(() => null);
      const error = new Error(`You've used today's ${dailyFreeLimit} free API-powered questions. Upgrade to API Plan for unlimited summary and skill questions, or switch to your own API.`);
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
      recordInternalAnalyticsEvent({
        kind: 'subscription',
        eventName: 'anonymous_official_api_limit_reached',
        clientHash,
        uploaderType: 'anonymous',
        source: 'backend',
        locale,
        metadata: { plan: 'anonymous', limit: dailyFreeLimit }
      }).catch(() => null);
      const error = new Error(`You've used today's ${dailyFreeLimit} free API-powered questions. Upgrade to API Plan for unlimited summary and skill questions, or switch to your own API.`);
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

const CHAT_PLAN_USAGE_TOTAL_FIELD = 'chatQuestionCountTotal';

function createChatPlanLimitError(limit) {
  const error = new Error(`You've used your ${limit} free AI comparison questions. Upgrade to Chat Plan for unlimited questions.`);
  error.status = 402;
  error.code = 'CHAT_PLAN_LIMIT_REACHED';
  error.limit = Math.max(0, Number(limit) || 0);
  return error;
}

async function getHistoricalChatQuestionCount(ownerRef) {
  const snapshot = await ownerRef.collection('usage').get();
  let total = 0;
  snapshot.forEach((doc) => {
    total += Math.max(0, Number(doc.data()?.chatQuestionCount) || 0);
  });
  return total;
}

function getStoredChatQuestionTotal(data = {}) {
  const value = Number(data?.[CHAT_PLAN_USAGE_TOTAL_FIELD]);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

async function consumeChatPlanUsage(uid, locale) {
  if (!shouldMeterLocale(locale)) {
    return { billingEnabled: false, plan: 'free', limit: chatPlanDailyFreeLimit, used: 0, remaining: Number.POSITIVE_INFINITY };
  }

  const plan = await getUserPlan(uid);
  if (plan.plan === 'pro') {
    return { billingEnabled: true, plan: 'pro', limit: chatPlanDailyFreeLimit, used: 0, remaining: Number.POSITIVE_INFINITY };
  }

  const dateKey = getTodayKey();
  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  const initialUsed = getStoredChatQuestionTotal(userSnap.data() || {}) ?? await getHistoricalChatQuestionCount(userRef);
  const usageRef = userRef.collection('usage').doc(dateKey);
  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(userRef);
    const data = snap.exists ? snap.data() || {} : {};
    const used = getStoredChatQuestionTotal(data) ?? initialUsed;
    if (used >= chatPlanDailyFreeLimit) {
      recordInternalAnalyticsEvent({
        kind: 'subscription',
        eventName: 'chat_plan_limit_reached',
        uid,
        uploaderType: 'user',
        source: 'backend',
        locale,
        metadata: { plan: plan.plan || 'free', limit: chatPlanDailyFreeLimit }
      }).catch(() => null);
      throw createChatPlanLimitError(chatPlanDailyFreeLimit);
    }
    const nextUsed = used + 1;
    transaction.set(userRef, {
      [CHAT_PLAN_USAGE_TOTAL_FIELD]: nextUsed,
      chatQuestionLimit: chatPlanDailyFreeLimit,
      chatQuestionLastUsedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    transaction.set(usageRef, {
      chatQuestionCount: admin.firestore.FieldValue.increment(1),
      [CHAT_PLAN_USAGE_TOTAL_FIELD]: nextUsed,
      date: dateKey,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return {
      billingEnabled: true,
      plan: 'free',
      limit: chatPlanDailyFreeLimit,
      used: nextUsed,
      remaining: Math.max(0, chatPlanDailyFreeLimit - nextUsed)
    };
  });
}

async function consumeAnonymousChatPlanUsage(clientId, locale) {
  if (!shouldMeterLocale(locale)) {
    return { billingEnabled: false, plan: 'anonymous', limit: chatPlanDailyFreeLimit, used: 0, remaining: Number.POSITIVE_INFINITY };
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
  const clientRef = db.collection('anonymousUsage').doc(clientHash);
  const clientSnap = await clientRef.get();
  const initialUsed = getStoredChatQuestionTotal(clientSnap.data() || {}) ?? await getHistoricalChatQuestionCount(clientRef);
  const usageRef = clientRef.collection('usage').doc(dateKey);
  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(clientRef);
    const data = snap.exists ? snap.data() || {} : {};
    const used = getStoredChatQuestionTotal(data) ?? initialUsed;
    if (used >= chatPlanDailyFreeLimit) {
      recordInternalAnalyticsEvent({
        kind: 'subscription',
        eventName: 'anonymous_chat_plan_limit_reached',
        clientHash,
        uploaderType: 'anonymous',
        source: 'backend',
        locale,
        metadata: { plan: 'anonymous', limit: chatPlanDailyFreeLimit }
      }).catch(() => null);
      throw createChatPlanLimitError(chatPlanDailyFreeLimit);
    }
    const nextUsed = used + 1;
    transaction.set(clientRef, {
      [CHAT_PLAN_USAGE_TOTAL_FIELD]: nextUsed,
      chatQuestionLimit: chatPlanDailyFreeLimit,
      clientHash,
      chatQuestionLastUsedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    transaction.set(usageRef, {
      chatQuestionCount: admin.firestore.FieldValue.increment(1),
      [CHAT_PLAN_USAGE_TOTAL_FIELD]: nextUsed,
      date: dateKey,
      clientHash,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return {
      billingEnabled: true,
      plan: 'anonymous',
      limit: chatPlanDailyFreeLimit,
      used: nextUsed,
      remaining: Math.max(0, chatPlanDailyFreeLimit - nextUsed)
    };
  });
}

async function consumeChatPlanUsageForRequest(req) {
  const user = await getOptionalUser(req);
  const locale = String(req.headers['x-ai-compare-locale'] || req.body?.locale || '').trim();
  const usageResult = user?.uid
    ? await consumeChatPlanUsage(user.uid, locale)
    : await consumeAnonymousChatPlanUsage(getAnonymousClientId(req), locale);
  return {
    ok: true,
    ...usageResult
  };
}

async function recordOfficialApiEvent({
  uid = '',
  clientHash = '',
  userType = 'free',
  locale = '',
  model = '',
  upstreamModel = '',
  tokenUsage = {},
  upstreamStatus = 0,
  queryPreview = '',
  queryText = '',
  queryHash = '',
  requestIp = '',
  requestRegion = '',
  userAgent = '',
  extensionVersion = ''
} = {}) {
  requireFirebaseAdmin();
  const normalizedUserType = ['free', 'pro', 'anonymous'].includes(userType) ? userType : 'free';
  const tokenCost = estimateOfficialApiCost(tokenUsage);
  await db.collection('officialApiEvents').add({
    dateKey: getTodayKey(),
    uid: String(uid || ''),
    clientHash: String(clientHash || ''),
    userType: normalizedUserType,
    locale: String(locale || '').trim(),
    model: String(model || '').trim(),
    upstreamModel: String(upstreamModel || model || '').trim(),
    upstreamStatus: Math.max(0, Math.round(Number(upstreamStatus) || 0)),
    queryPreview: safeLogString(queryPreview, 120),
    queryText: safeLogString(queryText || queryPreview, 4000),
    queryHash: safeLogString(queryHash, 100),
    requestIp: safeLogString(requestIp, 80),
    requestRegion: safeLogString(requestRegion || getIpRegionLabel(requestIp), 120),
    userAgent: safeLogString(userAgent, 200),
    extensionVersion: safeLogString(extensionVersion, 40),
    promptTokens: tokenCost.promptTokens,
    completionTokens: tokenCost.completionTokens,
    totalTokens: tokenCost.totalTokens,
    officialEstimatedCost: tokenCost.officialEstimatedCost,
    estimatedCost: tokenCost.estimatedCost,
    costMultiplier: tokenCost.costMultiplier,
    currency: tokenCost.currency,
    hasTokenUsage: tokenCost.totalTokens > 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

function safeLogString(value, limit = 500) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return limit > 0 && text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function createSafeQueryPreview(value = '') {
  return safeLogString(value, 120);
}

function createSha256Hash(value = '') {
  const text = String(value || '');
  if (!text) return '';
  return crypto.createHash('sha256').update(text).digest('hex');
}

function extractMessageText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') return part;
      if (typeof part?.text === 'string') return part.text;
      if (typeof part?.content === 'string') return part.content;
      return '';
    }).filter(Boolean).join('\n');
  }
  if (content && typeof content === 'object' && typeof content.text === 'string') {
    return content.text;
  }
  return '';
}

function extractOfficialRequestQuery(body = {}) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const lastUserMessage = [...messages].reverse().find((message) => String(message?.role || '').trim() === 'user');
  return extractMessageText(lastUserMessage?.content);
}

function getRequestIp(req) {
  const forwardedFor = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return safeLogString(forwardedFor || req.headers['x-real-ip'] || req.ip || req.socket?.remoteAddress || '', 80);
}

function normalizeIpForGeo(ip = '') {
  const value = String(ip || '').split(',')[0].trim().replace(/^::ffff:/, '');
  if (!value || value === '::1' || value === '127.0.0.1') return '';
  return value;
}

function getCountryDisplayName(countryCode = '') {
  const code = String(countryCode || '').trim().toUpperCase();
  if (!code) return '';
  try {
    const names = new Intl.DisplayNames(['zh-CN'], { type: 'region' });
    return names.of(code) || code;
  } catch (_) {
    return code;
  }
}

function getIpRegionLabel(ip = '') {
  const normalizedIp = normalizeIpForGeo(ip);
  if (!normalizedIp || !geoip) return '';
  const info = geoip.lookup(normalizedIp);
  if (!info) return '';
  const parts = [
    getCountryDisplayName(info.country) || info.country,
    info.region,
    info.city
  ].filter(Boolean);
  return Array.from(new Set(parts)).join(' / ');
}

function getRequestRegion(req) {
  const country = req.headers['cf-ipcountry'] || req.headers['x-vercel-ip-country'] || req.headers['x-country-code'];
  const region = req.headers['cf-region'] || req.headers['x-vercel-ip-country-region'] || req.headers['x-region'];
  const city = req.headers['cf-ipcity'] || req.headers['x-vercel-ip-city'] || req.headers['x-city'];
  const headerParts = [
    getCountryDisplayName(country) || country,
    region,
    city
  ].map((item) => safeLogString(item || '', 60)).filter(Boolean);
  if (headerParts.length) return Array.from(new Set(headerParts)).join(' / ');
  return getIpRegionLabel(getRequestIp(req));
}

function getRequestUserAgent(req) {
  return safeLogString(req.headers['user-agent'] || '', 200);
}

function sanitizeFailureLogUrl(url) {
  const raw = safeLogString(url, 600);
  if (!raw) return '';
  try {
    const parsed = new URL(raw, raw.startsWith('http') ? undefined : 'https://example.invalid');
    Array.from(parsed.searchParams.keys()).forEach((key) => {
      if (/(token|key|auth|code|secret|password|session|credential|access|refresh)/i.test(key)) {
        parsed.searchParams.set(key, '[redacted]');
      }
    });
    if (!/^https?:\/\//i.test(raw)) {
      return safeLogString(`${parsed.pathname}${parsed.search}${parsed.hash}`, 600);
    }
    return safeLogString(parsed.toString(), 600);
  } catch (_) {
    return raw.replace(/([?&][^=]*(?:token|key|auth|code|secret|password|session|credential|access|refresh)[^=]*=)[^&#]*/ig, '$1[redacted]');
  }
}

function safeLogMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') return {};
  const result = {};
  Object.entries(metadata).slice(0, 30).forEach(([key, value]) => {
    if (/(token|key|auth|code|secret|password|session|credential|access|refresh)/i.test(key)) {
      result[safeLogString(key, 80)] = '[redacted]';
      return;
    }
    if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) {
      result[safeLogString(key, 80)] = typeof value === 'string' ? safeLogString(value, 300) : value;
    }
  });
  return result;
}

function normalizeFailureLogUploadItem(item = {}) {
  const clientRecordId = safeLogString(item.id || item.clientRecordId || '', 120);
  if (!clientRecordId) {
    const error = new Error('failure log id is required');
    error.status = 400;
    throw error;
  }
  const category = item.category === 'api' ? 'api' : 'site';
  const dateKey = safeLogString(item.dateKey || getTodayKey(), 20);
  return {
    clientRecordId,
    dateKey,
    createdAt: safeLogString(item.createdAt || '', 40),
    lastSeenAt: safeLogString(item.lastSeenAt || item.createdAt || '', 40),
    category,
    source: safeLogString(item.source || '', 40),
    siteName: safeLogString(item.siteName || '', 120),
    apiKind: safeLogString(item.apiKind || '', 40),
    phase: safeLogString(item.phase || (category === 'api' ? 'http' : 'submit'), 60),
    status: Number(item.status) || 0,
    errorCode: safeLogString(item.errorCode || '', 120),
    errorMessage: safeLogString(item.errorMessage || 'Unknown failure', 800),
    pageUrl: sanitizeFailureLogUrl(item.pageUrl || ''),
    runtimeUrl: sanitizeFailureLogUrl(item.runtimeUrl || ''),
    model: safeLogString(item.model || '', 120),
    locale: safeLogString(item.locale || '', 40),
    queryPreview: safeLogString(item.queryPreview || '', 120),
    queryHash: safeLogString(item.queryHash || '', 100),
    repeatCount: Math.max(1, Number(item.repeatCount) || 1),
    metadata: safeLogMetadata(item.metadata)
  };
}

function createFailureLogUploadDocId({ uploaderType, uid, clientHash, clientRecordId }) {
  return crypto
    .createHash('sha256')
    .update([
      String(uploaderType || ''),
      String(uid || clientHash || ''),
      String(clientRecordId || '')
    ].join('|'))
    .digest('hex');
}

async function getFailureLogUploader(req) {
  const user = await getOptionalUser(req);
  if (user?.uid) {
    return {
      uploaderType: 'user',
      uid: user.uid,
      clientHash: ''
    };
  }
  const anonymousClientId = getAnonymousClientId(req);
  if (!anonymousClientId) {
    const error = new Error('Authentication or anonymous client id is required');
    error.status = 401;
    throw error;
  }
  return {
    uploaderType: 'anonymous',
    uid: '',
    clientHash: getAnonymousUsageDocId(anonymousClientId)
  };
}

async function enforceFailureLogUploadLimit(uploader, dateKey, count) {
  const uploaderKey = uploader.uid || uploader.clientHash;
  const usageId = crypto
    .createHash('sha256')
    .update(`${uploader.uploaderType}|${uploaderKey}|${dateKey}`)
    .digest('hex');
  const usageRef = db.collection('failureLogUploadUsage').doc(usageId);
  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(usageRef);
    const used = snap.exists ? Math.max(0, Number(snap.data().count) || 0) : 0;
    if (used + count > failureLogDailyUploadLimit) {
      const error = new Error('Failure log daily upload limit exceeded');
      error.status = 429;
      throw error;
    }
    transaction.set(usageRef, {
      uploaderType: uploader.uploaderType,
      uid: uploader.uid,
      clientHash: uploader.clientHash,
      dateKey,
      count: used + count,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  });
}

async function recordFailureLogBatch(req) {
  requireFirebaseAdmin();
  const logs = Array.isArray(req.body?.logs) ? req.body.logs : null;
  if (!logs) {
    const error = new Error('logs must be an array');
    error.status = 400;
    throw error;
  }
  if (logs.length > failureLogBatchLimit) {
    const error = new Error(`logs must contain at most ${failureLogBatchLimit} records`);
    error.status = 400;
    throw error;
  }
  const uploader = await getFailureLogUploader(req);
  const normalizedLogs = logs.map(normalizeFailureLogUploadItem);
  const countByDate = new Map();
  normalizedLogs.forEach((item) => {
    countByDate.set(item.dateKey, (countByDate.get(item.dateKey) || 0) + 1);
  });
  for (const [dateKey, count] of countByDate.entries()) {
    await enforceFailureLogUploadLimit(uploader, dateKey, count);
  }

  const extensionVersion = safeLogString(req.body?.extensionVersion || '', 40);
  const requestLocale = safeLogString(req.body?.locale || '', 40);
  const batch = db.batch();
  const acceptedIds = [];
  normalizedLogs.forEach((item) => {
    const docId = createFailureLogUploadDocId({
      ...uploader,
      clientRecordId: item.clientRecordId
    });
    acceptedIds.push(item.clientRecordId);
    batch.set(db.collection('failureLogEvents').doc(docId), {
      ...item,
      uploaderType: uploader.uploaderType,
      uid: uploader.uid,
      clientHash: uploader.clientHash,
      extensionVersion,
      requestLocale,
      uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  });
  if (normalizedLogs.length) {
    await batch.commit();
  }
  return {
    ok: true,
    accepted: acceptedIds.length,
    acceptedIds
  };
}

function normalizeSiteUsageNames(items = [], limit = 30) {
  const seen = new Set();
  return (Array.isArray(items) ? items : [])
    .map((item) => safeLogString(item, 120))
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

function createSiteCompareEventDocId({ uploaderType, uid, clientHash, clientEventId }) {
  return crypto
    .createHash('sha256')
    .update([
      String(uploaderType || ''),
      String(uid || clientHash || ''),
      String(clientEventId || '')
    ].join('|'))
    .digest('hex');
}

async function getUsageEventUploader(req) {
  const user = await getOptionalUser(req);
  if (user?.uid) {
    return {
      uploaderType: 'user',
      uid: user.uid,
      clientHash: ''
    };
  }
  const anonymousClientId = getAnonymousClientId(req);
  if (!anonymousClientId) {
    const error = new Error('Authentication or anonymous client id is required');
    error.status = 401;
    throw error;
  }
  return {
    uploaderType: 'anonymous',
    uid: '',
    clientHash: getAnonymousUsageDocId(anonymousClientId)
  };
}

async function recordSiteCompareEvent(req) {
  requireFirebaseAdmin();
  const uploader = await getUsageEventUploader(req);
  const clientEventId = safeLogString(req.body?.clientEventId || '', 120);
  if (!clientEventId) {
    const error = new Error('clientEventId is required');
    error.status = 400;
    throw error;
  }

  const officialSiteNames = normalizeSiteUsageNames(req.body?.officialSiteNames);
  const customSiteNames = normalizeSiteUsageNames(req.body?.customSiteNames);
  const siteNames = normalizeSiteUsageNames(req.body?.siteNames?.length
    ? req.body.siteNames
    : [...officialSiteNames, ...customSiteNames]);
  const agentIds = normalizeSiteUsageNames(req.body?.agentIds, 20);
  const insightPayload = BehaviorInsights.buildSiteUsagePayload({
    ...req.body,
    officialSiteNames,
    customSiteNames,
    siteNames,
    agentIds
  });
  if (!siteNames.length && !agentIds.length) {
    const error = new Error('siteNames or agentIds is required');
    error.status = 400;
    throw error;
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const rawQueryText = String(req.body?.queryText || req.body?.queryPreview || '');
  const queryPreview = createSafeQueryPreview(req.body?.queryPreview || rawQueryText);
  const queryText = safeLogString(rawQueryText, 4000);
  const docId = createSiteCompareEventDocId({
    ...uploader,
    clientEventId
  });
  await db.collection('siteCompareEvents').doc(docId).set({
    clientEventId,
    dateKey: getTodayKey(),
    uploaderType: uploader.uploaderType,
    uid: uploader.uid,
    clientHash: uploader.clientHash,
    source: safeLogString(req.body?.source || 'iframe', 40),
    siteNames,
    officialSiteNames,
    customSiteNames,
    agentIds,
    siteCount: siteNames.length,
    officialSiteCount: officialSiteNames.length,
    customSiteCount: customSiteNames.length,
    agentCount: agentIds.length,
    siteCombinationKey: safeLogString(req.body?.siteCombinationKey || insightPayload.siteCombinationKey, 1000),
    workflowMode: safeLogString(req.body?.workflowMode || insightPayload.workflowMode, 40),
    resultState: safeLogString(req.body?.resultState || insightPayload.resultState, 40),
    successCount: Math.max(0, Math.min(1000, Math.round(Number(req.body?.successCount ?? insightPayload.successCount) || 0))),
    failureCount: Math.max(0, Math.min(1000, Math.round(Number(req.body?.failureCount ?? insightPayload.failureCount) || 0))),
    extractableCount: Math.max(0, Math.min(1000, Math.round(Number(req.body?.extractableCount ?? insightPayload.extractableCount) || 0))),
    latencyMs: Math.max(0, Math.min(24 * 60 * 60 * 1000, Math.round(Number(req.body?.latencyMs ?? insightPayload.latencyMs) || 0))),
    failurePhase: safeLogString(req.body?.failurePhase || insightPayload.failurePhase, 80),
    failureTarget: safeLogString(req.body?.failureTarget || insightPayload.failureTarget, 120),
    hasQuery: req.body?.hasQuery === true,
    queryLength: Math.max(0, Math.min(20000, Math.round(Number(req.body?.queryLength) || 0))),
    queryPreview,
    queryText,
    queryHash: safeLogString(req.body?.queryHash || createSha256Hash(rawQueryText || queryPreview), 100),
    requestIp: getRequestIp(req),
    requestRegion: getRequestRegion(req),
    userAgent: getRequestUserAgent(req),
    locale: safeLogString(req.body?.locale || '', 40),
    extensionVersion: safeLogString(req.body?.extensionVersion || '', 40),
    createdAt: now,
    updatedAt: now
  }, { merge: true });

  return {
    ok: true,
    id: docId
  };
}

function safeAnalyticsMetadata(metadata) {
  if (BehaviorInsights?.safeMetadata) {
    return BehaviorInsights.safeMetadata(metadata);
  }
  if (!metadata || typeof metadata !== 'object') return {};
  const result = {};
  Object.entries(metadata).slice(0, 30).forEach(([key, value]) => {
    const safeKey = safeLogString(key, 80);
    if (!safeKey || /(token|key|auth|code|secret|password|session|credential|access|refresh|prompt|response|content|body)/i.test(safeKey)) {
      return;
    }
    if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) {
      const stringValue = typeof value === 'string' ? safeLogString(value, 160) : value;
      result[safeKey] = stringValue;
    }
  });
  return result;
}

function getDefaultCoursePromoConfig() {
  return {
    enabled: false,
    imageUrl: '',
    targetUrl: '',
    title: 'Codex 编程课',
    subtitle: '面向中文用户的 Codex 编程课，学习如何把 AI 变成稳定可落地的开发效率工具。',
    ctaText: '查看课程',
    textAdEnabled: false,
    textAdText: '',
    textAdUrl: '',
    targetLocales: ['zh_CN', 'zh_TW', 'zh'],
    dismissDays: 7,
    maxImpressionsPerDay: 3,
    updatedAt: null,
    updatedBy: ''
  };
}

function normalizeCoursePromoText(value, limit, fallback = '') {
  const text = safeLogString(value, limit);
  return text || fallback;
}

function normalizeCoursePromoUrl(value) {
  const url = safeLogString(value, 1000);
  return /^https:\/\/\S+/i.test(url) ? url : '';
}

function normalizeCoursePromoLocales(value) {
  const defaults = ['zh_CN', 'zh_TW', 'zh'];
  const raw = Array.isArray(value)
    ? value
    : String(value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  const seen = new Set();
  const locales = raw
    .map((item) => safeLogString(item, 20))
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return locales.length ? locales.slice(0, 10) : defaults;
}

function normalizePositiveInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function normalizeCoursePromoUpdatedAt(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value?.toDate === 'function') {
    try {
      return value.toDate().toISOString();
    } catch (_) {
      return null;
    }
  }
  if (typeof value?.seconds === 'number') {
    return new Date(value.seconds * 1000).toISOString();
  }
  return safeLogString(value, 80);
}

function normalizeCoursePromoConfig(raw = {}) {
  const defaults = getDefaultCoursePromoConfig();
  return {
    enabled: raw.enabled === true,
    imageUrl: normalizeCoursePromoUrl(raw.imageUrl),
    targetUrl: normalizeCoursePromoUrl(raw.targetUrl),
    title: normalizeCoursePromoText(raw.title, 80, defaults.title),
    subtitle: normalizeCoursePromoText(raw.subtitle, 160, defaults.subtitle),
    ctaText: normalizeCoursePromoText(raw.ctaText, 24, defaults.ctaText),
    textAdEnabled: raw.textAdEnabled === true,
    textAdText: normalizeCoursePromoText(raw.textAdText, 80, ''),
    textAdUrl: normalizeCoursePromoUrl(raw.textAdUrl),
    targetLocales: normalizeCoursePromoLocales(raw.targetLocales),
    dismissDays: normalizePositiveInteger(raw.dismissDays, defaults.dismissDays, 1, 365),
    maxImpressionsPerDay: normalizePositiveInteger(raw.maxImpressionsPerDay, defaults.maxImpressionsPerDay, 1, 20),
    updatedAt: normalizeCoursePromoUpdatedAt(raw.updatedAt),
    updatedBy: safeLogString(raw.updatedBy || '', 80)
  };
}

async function getCoursePromoConfigFromStore() {
  requireFirebaseAdmin();
  const snap = await db.collection('runtimeConfigs').doc('coursePromo').get();
  if (!snap.exists) {
    return getDefaultCoursePromoConfig();
  }
  return normalizeCoursePromoConfig(snap.data() || {});
}

async function saveCoursePromoConfigToStore(config, updatedBy = '') {
  requireFirebaseAdmin();
  const payload = {
    ...normalizeCoursePromoConfig(config),
    updatedBy: safeLogString(updatedBy || '', 80),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
  await db.collection('runtimeConfigs').doc('coursePromo').set(payload, { merge: true });
  return payload;
}

function validateCoursePromoConfigInput(input = {}) {
  const errors = [];
  if (input.enabled === true) {
    if (!input.imageUrl) errors.push('图片 URL 必须以 https:// 开头');
    if (!input.targetUrl) errors.push('点击链接必须以 https:// 开头');
    if (!input.title) errors.push('标题不能为空');
    if (!input.ctaText) errors.push('按钮文案不能为空');
  }
  if (input.imageUrl && !input.imageUrl.startsWith('https://')) {
    errors.push('图片 URL 必须以 https:// 开头');
  }
  if (input.targetUrl && !input.targetUrl.startsWith('https://')) {
    errors.push('点击链接必须以 https:// 开头');
  }
  if (input.textAdEnabled === true) {
    if (!input.textAdText) errors.push('文字广告文案不能为空');
    if (!input.textAdUrl) errors.push('文字广告跳转链接必须以 https:// 开头');
  }
  if (input.textAdUrl && !input.textAdUrl.startsWith('https://')) {
    errors.push('文字广告跳转链接必须以 https:// 开头');
  }
  return errors;
}

function sanitizeCoursePromoOutput(config = {}) {
  const normalized = normalizeCoursePromoConfig(config);
  return {
    enabled: normalized.enabled === true,
    imageUrl: normalized.imageUrl,
    targetUrl: normalized.targetUrl,
    title: normalized.title,
    subtitle: normalized.subtitle,
    ctaText: normalized.ctaText,
    textAdEnabled: normalized.textAdEnabled,
    textAdText: normalized.textAdText,
    textAdUrl: normalized.textAdUrl,
    targetLocales: normalized.targetLocales,
    dismissDays: normalized.dismissDays,
    maxImpressionsPerDay: normalized.maxImpressionsPerDay,
    updatedAt: normalized.updatedAt,
    updatedBy: normalized.updatedBy
  };
}

function sanitizeCoursePromoPublicOutput(config = {}) {
  const normalized = sanitizeCoursePromoOutput(config);
  return {
    enabled: normalized.enabled,
    imageUrl: normalized.imageUrl,
    targetUrl: normalized.targetUrl,
    title: normalized.title,
    subtitle: normalized.subtitle,
    ctaText: normalized.ctaText,
    textAdEnabled: normalized.textAdEnabled,
    textAdText: normalized.textAdText,
    textAdUrl: normalized.textAdUrl,
    targetLocales: normalized.targetLocales,
    dismissDays: normalized.dismissDays,
    maxImpressionsPerDay: normalized.maxImpressionsPerDay,
    updatedAt: normalized.updatedAt
  };
}

function getAnalyticsCollectionName(kind = 'feature') {
  if (kind === 'activation') return 'activationEvents';
  if (kind === 'subscription') return 'subscriptionFunnelEvents';
  return 'productFeatureEvents';
}

async function recordAnalyticsEvent(req, kind = 'feature') {
  requireFirebaseAdmin();
  const uploader = await getUsageEventUploader(req);
  const eventName = safeLogString(req.body?.eventName || '', 120);
  if (!eventName) {
    const error = new Error('eventName is required');
    error.status = 400;
    throw error;
  }
  const clientEventId = safeLogString(req.body?.clientEventId || crypto.randomUUID?.() || `${Date.now()}_${Math.random()}`, 120);
  const metadata = safeAnalyticsMetadata(req.body?.metadata);
  const collectionName = getAnalyticsCollectionName(kind);
  const docId = crypto
    .createHash('sha256')
    .update([
      collectionName,
      uploader.uploaderType,
      uploader.uid || uploader.clientHash,
      clientEventId
    ].join('|'))
    .digest('hex');

  await db.collection(collectionName).doc(docId).set({
    clientEventId,
    dateKey: getTodayKey(),
    eventName,
    kind: getAnalyticsCollectionName(kind) === 'activationEvents'
      ? 'activation'
      : (getAnalyticsCollectionName(kind) === 'subscriptionFunnelEvents' ? 'subscription' : 'feature'),
    uploaderType: uploader.uploaderType,
    uid: uploader.uid,
    clientHash: uploader.clientHash,
    source: safeLogString(req.body?.source || '', 60),
    locale: safeLogString(req.body?.locale || '', 40),
    extensionVersion: safeLogString(req.body?.extensionVersion || '', 40),
    hasQuery: req.body?.hasQuery === true,
    queryLength: Math.max(0, Math.min(20000, Math.round(Number(req.body?.queryLength) || 0))),
    metadata,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  return {
    ok: true,
    id: docId
  };
}

async function recordInternalAnalyticsEvent({
  kind = 'feature',
  eventName = '',
  uid = '',
  clientHash = '',
  uploaderType = 'user',
  source = 'backend',
  locale = '',
  extensionVersion = '',
  metadata = {}
} = {}) {
  requireFirebaseAdmin();
  const normalizedEventName = safeLogString(eventName, 120);
  if (!normalizedEventName) return null;
  const collectionName = getAnalyticsCollectionName(kind);
  const clientEventId = crypto
    .createHash('sha256')
    .update([
      normalizedEventName,
      uid || clientHash || '',
      Date.now(),
      Math.random()
    ].join('|'))
    .digest('hex');
  const docRef = await db.collection(collectionName).add({
    clientEventId,
    dateKey: getTodayKey(),
    eventName: normalizedEventName,
    uploaderType: uploaderType === 'anonymous' ? 'anonymous' : 'user',
    uid: String(uid || ''),
    clientHash: String(clientHash || ''),
    source: safeLogString(source, 60),
    locale: safeLogString(locale, 40),
    extensionVersion: safeLogString(extensionVersion, 40),
    hasQuery: false,
    queryLength: 0,
    metadata: safeAnalyticsMetadata(metadata),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  return docRef.id;
}

function getSuccessUrl() {
  return process.env.STRIPE_SUCCESS_URL || 'https://example.com/payment-success';
}

function getCheckoutSuccessUrl() {
  const successUrl = getSuccessUrl();
  try {
    const url = new URL(successUrl);
    url.searchParams.set('session_id', '{CHECKOUT_SESSION_ID}');
    return url.toString().replace('%7BCHECKOUT_SESSION_ID%7D', '{CHECKOUT_SESSION_ID}');
  } catch (_error) {
    const separator = successUrl.includes('?') ? '&' : '?';
    return `${successUrl}${separator}session_id={CHECKOUT_SESSION_ID}`;
  }
}

function getCancelUrl() {
  return process.env.STRIPE_CANCEL_URL || 'https://example.com/payment-cancel';
}

function getStripePrices() {
  return {
    monthly: String(process.env.STRIPE_PRICE_MONTHLY || '').trim(),
    yearly: String(process.env.STRIPE_PRICE_YEARLY || '').trim(),
    chat: {
      monthly: String(process.env.STRIPE_PRICE_MONTHLY || '').trim(),
      yearly: String(process.env.STRIPE_PRICE_YEARLY || '').trim()
    },
    api: {
      monthly: String(process.env.STRIPE_API_PRICE_MONTHLY || '').trim(),
      yearly: String(process.env.STRIPE_API_PRICE_YEARLY || '').trim()
    }
  };
}

function buildStripePriceDetail(priceId, price) {
  if (!priceId || !price) {
    return null;
  }
  const product = price.product && typeof price.product === 'object' ? price.product : null;
  const recurring = price.recurring && typeof price.recurring === 'object' ? price.recurring : {};
  const unitAmount = Number.isFinite(price.unit_amount)
    ? price.unit_amount
    : (Number.isFinite(price.unit_amount_decimal) ? Number(price.unit_amount_decimal) : null);
  return {
    priceId,
    productId: product?.id || (typeof price.product === 'string' ? price.product : ''),
    productName: String(product?.name || '').trim(),
    nickname: String(price.nickname || '').trim(),
    currency: String(price.currency || '').trim().toLowerCase(),
    unitAmount,
    interval: String(recurring.interval || '').trim(),
    intervalCount: Number(recurring.interval_count || 1) || 1
  };
}

async function getStripePriceDetails() {
  const prices = getStripePrices();
  const priceGroups = {
    chat: prices.chat,
    api: prices.api
  };
  const details = { chat: {}, api: {} };
  const stripe = getStripe();

  await Promise.all(Object.entries(priceGroups).flatMap(([planType, planPrices]) => (
    Object.entries(planPrices || {}).map(async ([billingCycle, priceId]) => {
      const normalizedPriceId = String(priceId || '').trim();
      if (!normalizedPriceId) {
        return;
      }
      try {
        const price = await stripe.prices.retrieve(normalizedPriceId, { expand: ['product'] });
        details[planType][billingCycle] = buildStripePriceDetail(normalizedPriceId, price);
      } catch (error) {
        console.warn(`[ai-compare-backend] Failed to load Stripe price detail for ${planType}.${billingCycle}:`, error.message);
      }
    })
  )));

  return details;
}

function normalizeRedeemCode(value = '') {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function formatRedeemCode(normalizedCode = '') {
  const text = normalizeRedeemCode(normalizedCode);
  return text.match(/.{1,4}/g)?.join('-') || text;
}

function hashRedeemCode(value = '') {
  return crypto.createHash('sha256').update(normalizeRedeemCode(value), 'utf8').digest('hex');
}

function generateRedeemCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'AIC';
  while (code.length < 15) {
    const byte = crypto.randomBytes(1)[0];
    code += alphabet[byte % alphabet.length];
  }
  return formatRedeemCode(code);
}

function normalizeRedeemPlanType(value = '') {
  return String(value || '').trim().toLowerCase() === 'api' ? 'api' : 'chat';
}

function normalizeRedeemInterval(value = '') {
  return String(value || '').trim().toLowerCase() === 'yearly' ? 'yearly' : 'monthly';
}

function getRedeemDurationDays(interval = 'monthly') {
  return normalizeRedeemInterval(interval) === 'yearly' ? 366 : 31;
}

function addDays(date, days) {
  return new Date(date.getTime() + Math.max(1, Number(days) || 1) * 24 * 60 * 60 * 1000);
}

function getTimestampMillis(value) {
  const seconds = getTimestampSeconds(value);
  return seconds ? seconds * 1000 : 0;
}

function getRedeemCodePublicFields(doc) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    prefix: String(data.prefix || ''),
    planType: normalizeRedeemPlanType(data.planType),
    interval: normalizeRedeemInterval(data.interval),
    durationDays: Number(data.durationDays || getRedeemDurationDays(data.interval)),
    maxRedemptions: Math.max(1, Number(data.maxRedemptions || 1) || 1),
    redemptionCount: Math.max(0, Number(data.redemptionCount || 0) || 0),
    status: String(data.status || 'active'),
    note: String(data.note || ''),
    expiresAt: timestampToIso(data.expiresAt),
    createdAt: timestampToIso(data.createdAt),
    createdBy: String(data.createdBy || ''),
    lastRedeemedAt: timestampToIso(data.lastRedeemedAt),
    lastRedeemedByEmail: String(data.lastRedeemedByEmail || ''),
    lastRedeemedByUid: String(data.lastRedeemedByUid || '')
  };
}

async function createRedeemCodes(req, adminUser) {
  requireFirebaseAdmin();
  const planType = normalizeRedeemPlanType(req.body?.planType);
  const interval = normalizeRedeemInterval(req.body?.interval);
  const quantity = Math.min(100, Math.max(1, Number(req.body?.quantity || 1) || 1));
  const maxRedemptions = Math.min(1000, Math.max(1, Number(req.body?.maxRedemptions || 1) || 1));
  const expiresInDays = Math.max(1, Number(req.body?.expiresInDays || 365) || 365);
  const note = String(req.body?.note || '').trim().slice(0, 240);
  const durationDays = getRedeemDurationDays(interval);
  const expiresAt = admin.firestore.Timestamp.fromDate(addDays(new Date(), expiresInDays));
  const batch = db.batch();
  const codes = [];
  let attempts = 0;

  while (codes.length < quantity) {
    attempts += 1;
    if (attempts > quantity * 5) {
      const error = new Error('Failed to generate enough unique redeem codes');
      error.status = 500;
      throw error;
    }
    const code = generateRedeemCode();
    const normalizedCode = normalizeRedeemCode(code);
    const codeHash = hashRedeemCode(normalizedCode);
    const ref = db.collection(redeemCodeCollection).doc(codeHash);
    const existing = await ref.get();
    if (existing.exists) continue;
    batch.set(ref, {
      codeHash,
      prefix: `${formatRedeemCode(normalizedCode).slice(0, 8)}...`,
      planType,
      interval,
      durationDays,
      maxRedemptions,
      redemptionCount: 0,
      status: 'active',
      note,
      expiresAt,
      createdBy: String(adminUser?.username || ''),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    codes.push(code);
  }

  await batch.commit();
  return { codes, planType, interval, durationDays, expiresAt: expiresAt.toDate().toISOString() };
}

async function listRedeemCodes(req) {
  requireFirebaseAdmin();
  const limit = Math.min(200, Math.max(1, Number(req.query?.limit || 50) || 50));
  const snapshot = await db.collection(redeemCodeCollection)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();
  return { codes: snapshot.docs.map(getRedeemCodePublicFields) };
}

async function redeemMembershipCode(req) {
  requireFirebaseAdmin();
  const user = await requireUser(req);
  const normalizedCode = normalizeRedeemCode(req.body?.code);
  if (normalizedCode.length < 8) {
    const error = new Error('Invalid redeem code');
    error.status = 400;
    throw error;
  }

  const codeHash = hashRedeemCode(normalizedCode);
  const codeRef = db.collection(redeemCodeCollection).doc(codeHash);
  const redemptionRef = codeRef.collection('redemptions').doc(user.uid);
  const userRef = db.collection('users').doc(user.uid);
  const nowDate = new Date();
  const nowTimestamp = admin.firestore.Timestamp.fromDate(nowDate);

  return db.runTransaction(async (transaction) => {
    const [codeSnap, userSnap, redemptionSnap] = await Promise.all([
      transaction.get(codeRef),
      transaction.get(userRef),
      transaction.get(redemptionRef)
    ]);
    if (!codeSnap.exists) {
      const error = new Error('Redeem code not found');
      error.status = 404;
      throw error;
    }

    const codeData = codeSnap.data() || {};
    const status = String(codeData.status || 'active');
    const expiresAtMs = getTimestampMillis(codeData.expiresAt);
    if (status !== 'active' || (expiresAtMs && expiresAtMs <= nowDate.getTime())) {
      const error = new Error('Redeem code expired');
      error.status = 410;
      throw error;
    }

    const maxRedemptions = Math.max(1, Number(codeData.maxRedemptions || 1) || 1);
    const redemptionCount = Math.max(0, Number(codeData.redemptionCount || 0) || 0);
    if (redemptionCount >= maxRedemptions) {
      const error = new Error('Redeem code has already been used');
      error.status = 409;
      throw error;
    }
    if (redemptionSnap.exists) {
      const error = new Error('You have already redeemed this code');
      error.status = 409;
      throw error;
    }

    const planType = normalizeRedeemPlanType(codeData.planType);
    const interval = normalizeRedeemInterval(codeData.interval);
    const durationDays = Math.max(1, Number(codeData.durationDays || getRedeemDurationDays(interval)) || getRedeemDurationDays(interval));
    const userData = userSnap.exists ? userSnap.data() || {} : {};
    const currentExpiresAt = planType === 'api' ? userData.apiPlanExpiresAt : userData.planExpiresAt;
    const currentExpiresAtMs = getTimestampMillis(currentExpiresAt);
    const startMs = Math.max(nowDate.getTime(), currentExpiresAtMs || 0);
    const nextExpiresAt = admin.firestore.Timestamp.fromDate(addDays(new Date(startMs), durationDays));
    const userPatch = planType === 'api'
      ? {
        apiPlan: 'pro',
        apiPlanExpiresAt: nextExpiresAt,
        apiMembershipSource: 'redeem_code'
      }
      : {
        plan: 'pro',
        planExpiresAt: nextExpiresAt,
        membershipSource: 'redeem_code'
      };

    transaction.set(userRef, {
      ...userPatch,
      lastRedeemCodeHash: codeHash,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    transaction.update(codeRef, {
      redemptionCount: admin.firestore.FieldValue.increment(1),
      status: redemptionCount + 1 >= maxRedemptions ? 'redeemed' : 'active',
      lastRedeemedAt: nowTimestamp,
      lastRedeemedByUid: user.uid,
      lastRedeemedByEmail: String(user.email || ''),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    transaction.set(redemptionRef, {
      uid: user.uid,
      email: String(user.email || ''),
      redeemedAt: nowTimestamp
    }, { merge: true });

    return {
      ok: true,
      planType,
      interval,
      planExpiresAt: nextExpiresAt.toDate().toISOString()
    };
  });
}

function getStripePlanTypeForPrice(priceId = '') {
  const normalizedPriceId = String(priceId || '').trim();
  const prices = getStripePrices();
  if (normalizedPriceId && [prices.api.monthly, prices.api.yearly].includes(normalizedPriceId)) {
    return 'api';
  }
  return 'chat';
}

function getStripeModeSuffix() {
  return billingMode === 'live' ? 'Live' : 'Test';
}

function getStripeCustomerIdField() {
  return `stripeCustomerId${getStripeModeSuffix()}`;
}

function getStripeSubscriptionIdField() {
  return `stripeSubscriptionId${getStripeModeSuffix()}`;
}

function getStripeAllowedPriceIds() {
  const prices = getStripePrices();
  return new Set([
    prices.monthly,
    prices.yearly,
    prices.chat.monthly,
    prices.chat.yearly,
    prices.api.monthly,
    prices.api.yearly
  ].filter(Boolean));
}

function getStripeSmokeTestConfig() {
  return {
    priceId: String(process.env.STRIPE_PRICE_SMOKE_TEST || '').trim(),
    token: String(process.env.BILLING_SMOKE_TEST_TOKEN || '').trim()
  };
}

function assertCheckoutPriceAllowed(priceId) {
  if (!getStripeAllowedPriceIds().has(priceId)) {
    const error = new Error('Unsupported checkout price');
    error.status = 400;
    throw error;
  }
}

function normalizeBillingEmail(email = '') {
  return String(email || '').trim().toLowerCase();
}

function extractStripeCustomerId(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return String(value.id || '').trim();
  return '';
}

function extractStripeCustomerEmailFromObject(value) {
  if (!value || typeof value !== 'object') return '';
  return normalizeBillingEmail(value.email || value.customer_email || value.customerEmail || '');
}

async function getStripeCustomerEmail(stripe, customer) {
  const inlineEmail = extractStripeCustomerEmailFromObject(customer);
  if (inlineEmail) return inlineEmail;
  const customerId = extractStripeCustomerId(customer);
  if (!customerId) return '';
  try {
    const customerObject = await stripe.customers.retrieve(customerId);
    return extractStripeCustomerEmailFromObject(customerObject);
  } catch (error) {
    console.warn('[ai-compare-backend] failed to retrieve Stripe customer email:', error.message || error);
    return '';
  }
}

function getCheckoutSessionEmail(session = {}) {
  return normalizeBillingEmail(
    session.customer_details?.email
    || session.customer_email
    || session.metadata?.stripeCustomerEmail
    || ''
  );
}

async function getOrCreateFirebaseUserForStripeEmail(email, metadata = {}) {
  requireFirebaseAdmin();
  const normalizedEmail = normalizeBillingEmail(email);
  if (!normalizedEmail) return null;
  try {
    return await admin.auth().getUserByEmail(normalizedEmail);
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') {
      throw error;
    }
  }

  const user = await admin.auth().createUser({
    email: normalizedEmail,
    emailVerified: false,
    disabled: false
  });
  await db.collection('users').doc(user.uid).set({
    email: normalizedEmail,
    emailVerified: false,
    createdFromStripeCheckout: true,
    stripeCustomerEmail: normalizedEmail,
    ...(metadata.stripeCustomerId ? { stripeCustomerId: metadata.stripeCustomerId, [getStripeCustomerIdField()]: metadata.stripeCustomerId } : {}),
    billingMode,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  return user;
}

function assertBillingSmokeTestAccess(req) {
  const config = getStripeSmokeTestConfig();
  if (!config.priceId || !config.token) {
    const error = new Error('Not found');
    error.status = 404;
    throw error;
  }

  const requestToken = String(
    req.query?.token || req.headers['x-ai-compare-smoke-test-token'] || ''
  ).trim();
  if (!requestToken || !safeCompare(requestToken, config.token)) {
    const error = new Error('Not found');
    error.status = 404;
    throw error;
  }

  return config;
}

async function resolveBillingSmokeTestUser(req) {
  requireFirebaseAdmin();
  const uid = String(req.query?.uid || req.body?.uid || '').trim();
  const email = String(req.query?.email || req.body?.email || '').trim();

  if (uid) {
    return admin.auth().getUser(uid);
  }
  if (email) {
    return admin.auth().getUserByEmail(email);
  }

  const error = new Error('uid or email is required');
  error.status = 400;
  throw error;
}

function getStripeAdaptivePricingConfig() {
  const raw = String(process.env.STRIPE_ADAPTIVE_PRICING_ENABLED || 'true').trim().toLowerCase();
  return {
    enabled: !['0', 'false', 'off', 'no'].includes(raw)
  };
}

async function createCheckoutSessionForFirebaseUser({
  firebaseUser,
  priceId,
  planType = getStripePlanTypeForPrice(priceId),
  smokeTest = false
}) {
  const stripe = getStripe();
  const userRef = db.collection('users').doc(firebaseUser.uid);
  const plan = await getUserPlan(firebaseUser.uid);
  let customerId = plan.stripeCustomerId;

  if (customerId) {
    try {
      await stripe.customers.retrieve(customerId);
    } catch (error) {
      if (error?.code !== 'resource_missing' && error?.statusCode !== 404) {
        throw error;
      }
      customerId = '';
    }
  }

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: firebaseUser.email,
      metadata: { firebaseUid: firebaseUser.uid }
    });
    customerId = customer.id;
    await userRef.set({
      stripeCustomerId: customerId,
      [getStripeCustomerIdField()]: customerId
    }, { merge: true });
  }

  const metadata = {
    firebaseUid: firebaseUser.uid,
    planType,
    ...(smokeTest ? { smokeTest: 'true' } : {})
  };

  return stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: getCheckoutSuccessUrl(),
    cancel_url: getCancelUrl(),
    adaptive_pricing: getStripeAdaptivePricingConfig(),
    metadata,
    subscription_data: {
      metadata
    }
  });
}

async function createCheckoutSessionForAnonymousClient({
  priceId,
  planType = getStripePlanTypeForPrice(priceId),
  prefillEmail = ''
}) {
  const stripe = getStripe();
  const customerEmail = normalizeBillingEmail(prefillEmail);
  const metadata = {
    planType,
    ...(customerEmail ? { stripeCustomerEmail: customerEmail } : {})
  };

  const sessionPayload = {
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: getCheckoutSuccessUrl(),
    cancel_url: getCancelUrl(),
    adaptive_pricing: getStripeAdaptivePricingConfig(),
    metadata,
    subscription_data: {
      metadata
    }
  };

  if (customerEmail) {
    sessionPayload.customer_email = customerEmail;
  }

  return stripe.checkout.sessions.create(sessionPayload);
}

function getExtensionMembershipUrl() {
  const productionExtensionId = 'dkhpgbbhlnmjbkihoeniojpkggkabbbl';
  const configuredExtensionId = String(process.env.AI_COMPARE_EXTENSION_ID || '').trim();
  const extensionId = /^[a-p]{32}$/.test(configuredExtensionId)
    ? configuredExtensionId
    : productionExtensionId;
  return `chrome-extension://${extensionId}/options/options.html#membership`;
}

function getChromeWebStoreInstallUrl() {
  return 'https://chromewebstore.google.com/detail/dkhpgbbhlnmjbkihoeniojpkggkabbbl?utm_source=payment_success&utm_medium=success_page&utm_campaign=subscription_activation';
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

function getPublicFirebaseWebConfig() {
  return {
    apiKey: 'AIzaSyALR-U2AHvbSlxZ5gosp5zcobRb4KdYazo',
    authDomain: 'aicompare-12989.firebaseapp.com',
    projectId: 'aicompare-12989',
    storageBucket: 'aicompare-12989.firebasestorage.app',
    messagingSenderId: '741697777320',
    appId: '1:741697777320:web:88e1944c3d267c9f471c9d',
    measurementId: 'G-TGD1MD9XK4'
  };
}

function getMembershipPricingPageHtml(planType = 'chat') {
  const resolvedPlanType = String(planType || '').trim().toLowerCase() === 'api' ? 'api' : 'chat';
  const isApiPlan = resolvedPlanType === 'api';
  const firebaseConfig = JSON.stringify(getPublicFirebaseWebConfig());
  const pageCopy = JSON.stringify(isApiPlan ? {
    eyebrow: 'AI Compare Pro',
    title: 'Choose your API Plan',
    description: '',
    signIn: 'Continue to Stripe',
    signedIn: 'Stripe will collect your email securely.',
    monthlyName: 'API Plan · Monthly',
    yearlyName: 'API Plan · Yearly',
    monthlyPrice: 'Loading price…',
    yearlyPrice: 'Loading price…',
    monthlyCta: 'Subscribe Monthly',
    yearlyCta: 'Subscribe Yearly',
    monthlyDesc: 'Unlimited summary and skill questions, billed monthly.',
    yearlyDesc: 'Unlimited summary and skill questions, billed yearly.',
    feature1: 'Unlimited summary questions',
    feature2: 'Unlimited built-in skill questions',
    feature3: 'Built-in API keys stay securely on the cloud backend',
    loginHint: '',
    loading: 'Loading pricing…',
    error: 'Failed to load pricing.',
    logout: 'Switch account'
  } : {
    eyebrow: 'AI Compare Pro',
    title: 'Choose your Chat Plan',
    description: '',
    signIn: 'Continue to Stripe',
    signedIn: 'Stripe will collect your email securely.',
    monthlyName: '',
    yearlyName: '',
    monthlyPrice: 'Loading price…',
    yearlyPrice: 'Loading price…',
    monthlyCta: 'Subscribe Monthly',
    yearlyCta: 'Subscribe Yearly',
    monthlyDesc: 'Flexible monthly billing for trying Pro at your own pace.',
    yearlyDesc: 'Best value for long-term use, with one yearly payment.',
    feature1: 'Unlimited AI comparison questions',
    feature2: 'Switch between supported AI sites',
    feature3: '',
    loginHint: '',
    loading: 'Loading pricing…',
    error: 'Failed to load pricing.',
    logout: 'Switch account'
  });

  return `<!DOCTYPE html>
<html lang="${isApiPlan ? 'en' : 'en'}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${isApiPlan ? 'Choose your API Plan' : 'Choose your Chat Plan'} | AICompare</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f5f0;
      --bg-glow: radial-gradient(circle at top left, rgba(17,17,17,0.05), transparent 34%), radial-gradient(circle at 12% 8%, rgba(255,214,102,0.16), transparent 30%), radial-gradient(circle at 88% 18%, rgba(95,155,255,0.10), transparent 28%);
      --surface: rgba(255,255,255,0.82);
      --text: #181818;
      --muted: rgba(24,24,24,0.66);
      --border: rgba(17,17,17,0.08);
      --accent: #181818;
      --accent-contrast: #fff;
      --shadow: 0 26px 70px rgba(45,45,45,0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    body::before {
      content: "";
      position: fixed;
      inset: 0;
      z-index: -1;
      pointer-events: none;
      background: var(--bg-glow);
    }
    .page {
      width: min(1080px, calc(100% - 40px));
      margin: 0 auto;
      padding: 34px 0 54px;
    }
    .topbar {
      display: flex;
      justify-content: space-between;
      gap: 14px;
      align-items: center;
    }
    .back-link, .sign-in-btn, .sign-out-btn, .plan-btn {
      border: 0;
      border-radius: 999px;
      font-weight: 900;
      font-size: 14px;
      cursor: pointer;
      text-decoration: none;
    }
    .back-link {
      display: inline-flex;
      align-items: center;
      min-height: 38px;
      padding: 0 14px;
      background: rgba(255,255,255,0.72);
      color: #242424;
      border: 1px solid rgba(17,17,17,0.1);
    }
    .hero { max-width: 760px; margin-top: 42px; }
    .eyebrow {
      margin: 0 0 10px;
      color: rgba(24,24,24,0.58);
      font-size: 13px;
      font-weight: 900;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }
    h1 {
      margin: 0;
      font-size: clamp(34px, 6vw, 58px);
      font-weight: 950;
      letter-spacing: -0.06em;
      line-height: 0.98;
    }
    .lead {
      max-width: 680px;
      margin: 18px 0 0;
      color: var(--muted);
      font-size: 17px;
      font-weight: 650;
      line-height: 1.65;
    }
    .auth-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
      margin-top: 26px;
    }
    .sign-in-btn, .sign-out-btn {
      min-height: 42px;
      padding: 0 16px;
      background: #1f1f1f;
      color: #fff;
    }
    .sign-out-btn {
      background: rgba(17,17,17,0.08);
      color: #181818;
    }
    .auth-status {
      font-size: 14px;
      color: var(--muted);
      font-weight: 650;
    }
    .pricing-options {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 20px;
      margin-top: 28px;
    }
    .pricing-card {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 22px;
      min-height: 430px;
      padding: 30px;
      border: 1px solid var(--border);
      border-radius: 28px;
      background: var(--surface);
      box-shadow: var(--shadow);
      backdrop-filter: blur(14px);
    }
    .pricing-card.featured {
      overflow: hidden;
      background: linear-gradient(145deg, #181818 0%, #2b2b2b 100%);
      color: #fff;
    }
    .pricing-badge {
      align-self: flex-start;
      min-height: 28px;
      padding: 5px 11px;
      border-radius: 999px;
      background: rgba(255,255,255,0.14);
      color: #fff;
      font-size: 12px;
      font-weight: 900;
    }
    .pricing-name {
      font-size: 20px;
      font-weight: 900;
    }
    .pricing-price {
      margin-top: 10px;
      font-size: clamp(34px, 5vw, 48px);
      font-weight: 950;
      letter-spacing: -0.05em;
    }
    .pricing-desc {
      min-height: 48px;
      margin: 12px 0 0;
      color: inherit;
      font-size: 15px;
      line-height: 1.6;
      opacity: 0.68;
    }
    .feature-list {
      flex: 1;
      display: grid;
      gap: 12px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .feature-list li {
      color: inherit;
      font-size: 15px;
      line-height: 1.5;
    }
    .feature-list li::before {
      content: "✓ ";
      font-weight: 900;
    }
    .plan-btn {
      min-height: 48px;
      background: #1f1f1f;
      color: #fff;
      transition: transform 0.16s ease, opacity 0.16s ease;
    }
    .pricing-card.featured .plan-btn {
      background: #fff;
      color: #1f1f1f;
    }
    .plan-btn:hover { transform: translateY(-1px); }
    .plan-btn:disabled { opacity: 0.55; cursor: default; transform: none; }
    .note {
      margin-top: 18px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.6;
    }
    .toast {
      position: fixed;
      left: 50%;
      bottom: 26px;
      transform: translate(-50%, 12px);
      opacity: 0;
      pointer-events: none;
      max-width: min(520px, calc(100vw - 32px));
      padding: 12px 16px;
      border-radius: 999px;
      background: #1f1f1f;
      color: #fff;
      font-size: 14px;
      font-weight: 800;
      transition: opacity .2s ease, transform .2s ease;
    }
    .toast.show { opacity: 1; transform: translate(-50%, 0); }
    @media (max-width: 760px) {
      .page { width: min(100% - 28px, 1080px); padding-top: 20px; }
      .pricing-options { grid-template-columns: 1fr; }
      .topbar { align-items: stretch; flex-direction: column; }
      .pricing-card { min-height: auto; padding: 24px; }
    }
  </style>
</head>
<body>
  <main class="page">
    <header class="hero">
      <p class="eyebrow">${isApiPlan ? 'AI Compare Pro' : 'AI Compare Pro'}</p>
      <h1 id="pricingTitle">${isApiPlan ? 'Choose your API Plan' : 'Choose your Chat Plan'}</h1>
      <p class="lead" id="pricingDescription" hidden></p>
      <div class="auth-bar" id="authBar" hidden>
        <span class="auth-status" id="authStatus"></span>
      </div>
    </header>

    <section class="pricing-options" id="pricingOptions" aria-label="${isApiPlan ? 'Choose an API Plan' : 'Choose a Pro plan'}">
      <article class="pricing-card">
        <div>
          <div class="pricing-name" id="monthlyName"></div>
          <div class="pricing-price" id="monthlyPrice"></div>
          <p class="pricing-desc" id="monthlyDescription"></p>
        </div>
        <ul class="feature-list">
          <li id="monthlyFeature1"></li>
          <li id="monthlyFeature2"></li>
          <li id="monthlyFeature3"></li>
        </ul>
        <button class="plan-btn" id="monthlyButton" type="button" data-cycle="monthly"></button>
      </article>

      <article class="pricing-card featured">
        <span class="pricing-badge">${isApiPlan ? 'Most Popular' : 'Most Popular'}</span>
        <div>
          <div class="pricing-name" id="yearlyName"></div>
          <div class="pricing-price" id="yearlyPrice"></div>
          <p class="pricing-desc" id="yearlyDescription"></p>
        </div>
        <ul class="feature-list">
          <li id="yearlyFeature1"></li>
          <li id="yearlyFeature2"></li>
          <li id="yearlyFeature3"></li>
        </ul>
        <button class="plan-btn" id="yearlyButton" type="button" data-cycle="yearly"></button>
      </article>
    </section>
  </main>

  <div class="toast" id="toast"></div>

  <script>
    window.__AI_COMPARE_FIREBASE_CONFIG__ = ${firebaseConfig};
    window.__AI_COMPARE_PAGE_COPY__ = ${pageCopy};
    window.__AI_COMPARE_PLAN_TYPE__ = ${JSON.stringify(resolvedPlanType)};
  </script>
  <script>
    (function () {
      const copy = window.__AI_COMPARE_PAGE_COPY__;
      const planType = window.__AI_COMPARE_PLAN_TYPE__ || 'chat';
      const toast = document.getElementById('toast');
      const authStatus = document.getElementById('authStatus');
      const monthlyButton = document.getElementById('monthlyButton');
      const yearlyButton = document.getElementById('yearlyButton');
      const monthlyName = document.getElementById('monthlyName');
      const yearlyName = document.getElementById('yearlyName');
      const monthlyPrice = document.getElementById('monthlyPrice');
      const yearlyPrice = document.getElementById('yearlyPrice');
      const monthlyDescription = document.getElementById('monthlyDescription');
      const yearlyDescription = document.getElementById('yearlyDescription');
      const monthlyFeature1 = document.getElementById('monthlyFeature1');
      const monthlyFeature2 = document.getElementById('monthlyFeature2');
      const monthlyFeature3 = document.getElementById('monthlyFeature3');
      const yearlyFeature1 = document.getElementById('yearlyFeature1');
      const yearlyFeature2 = document.getElementById('yearlyFeature2');
      const yearlyFeature3 = document.getElementById('yearlyFeature3');
      const pricingTitle = document.getElementById('pricingTitle');
      const pricingDescription = document.getElementById('pricingDescription');
      const pricingOptions = document.getElementById('pricingOptions');
      const apiBasePath = window.location.pathname.startsWith('/test-api/')
        ? '/test-api'
        : '';
      const pageParams = new URLSearchParams(window.location.search);
      const prefillEmail = String(pageParams.get('prefillEmail') || pageParams.get('email') || '').trim();
      let billingConfig = null;

      function showToast(message) {
        toast.textContent = message;
        toast.classList.add('show');
        clearTimeout(showToast.timer);
        showToast.timer = setTimeout(() => toast.classList.remove('show'), 3200);
      }

      function formatPrice(detail, fallback) {
        if (!detail || !detail.unitAmount || !detail.currency) return fallback;
        try {
          const amount = detail.unitAmount / 100;
          return new Intl.NumberFormat(undefined, {
            style: 'currency',
            currency: String(detail.currency || 'USD').toUpperCase(),
            maximumFractionDigits: amount % 1 === 0 ? 0 : 2
          }).format(amount) + (detail.interval === 'year' ? ' / year' : ' / month');
        } catch (_) {
          return fallback;
        }
      }

      function updateCheckoutUi() {
        const authBar = document.getElementById('authBar');
        const descriptionText = String(copy.description || '').trim();
        const loginHintText = String(copy.loginHint || '').trim();
        pricingDescription.hidden = !descriptionText;
        authBar.hidden = !loginHintText;
        authStatus.textContent = loginHintText;
        monthlyButton.disabled = false;
        yearlyButton.disabled = false;
      }

      function applyBillingData() {
        const details = billingConfig?.priceDetails?.[planType] || {};
        const monthly = details.monthly || {};
        const yearly = details.yearly || {};
        const planLabel = planType === 'api' ? 'API Plan' : 'Chat Plan';

        pricingTitle.textContent = copy.title;
        pricingDescription.textContent = copy.description || '';
        monthlyName.hidden = !String(copy.monthlyName || '').trim();
        yearlyName.hidden = !String(copy.yearlyName || '').trim();
        monthlyName.textContent = copy.monthlyName;
        yearlyName.textContent = copy.yearlyName;
        monthlyPrice.textContent = formatPrice(monthly, planType === 'api' ? 'HK$10 / month' : '$4.99 / month');
        yearlyPrice.textContent = formatPrice(yearly, planType === 'api' ? 'HK$100 / year' : '$39.99 / year');
        monthlyDescription.textContent = copy.monthlyDesc;
        yearlyDescription.textContent = copy.yearlyDesc;
        monthlyFeature1.textContent = copy.feature1;
        monthlyFeature2.textContent = copy.feature2;
        monthlyFeature3.hidden = !String(copy.feature3 || '').trim();
        monthlyFeature3.textContent = copy.feature3 || '';
        yearlyFeature1.textContent = copy.feature1;
        yearlyFeature2.textContent = copy.feature2;
        yearlyFeature3.hidden = !String(copy.feature3 || '').trim();
        yearlyFeature3.textContent = copy.feature3 || '';
        monthlyButton.textContent = copy.monthlyCta;
        yearlyButton.textContent = copy.yearlyCta;
        pricingOptions.setAttribute('aria-label', planLabel);
      }

      async function loadBillingConfig() {
        try {
          const response = await fetch(apiBasePath + '/billingConfig', { cache: 'no-store' });
          billingConfig = await response.json();
          applyBillingData();
        } catch (error) {
          console.warn('Failed to load billing config:', error);
          showToast(copy.error);
        }
      }

      async function startCheckout(cycle) {
        try {
          const detail = billingConfig?.priceDetails?.[planType]?.[cycle];
          const priceId = detail?.priceId || billingConfig?.prices?.[planType]?.[cycle];
          if (!priceId) throw new Error('Price is not configured yet.');
          const button = cycle === 'yearly' ? yearlyButton : monthlyButton;
          button.disabled = true;
          button.textContent = 'Opening Stripe…';
          const response = await fetch(apiBasePath + '/createCheckoutSession', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              priceId,
              planType,
              ...(prefillEmail ? { prefillEmail } : {})
            })
          });
          const data = await response.json();
          if (!response.ok || !data.url) {
            throw new Error(data?.error || 'Failed to open checkout.');
          }
          window.location.href = data.url;
        } catch (error) {
          showToast(error?.message || 'Failed to open checkout.');
          applyBillingData();
        }
      }

      monthlyButton.addEventListener('click', () => startCheckout('monthly'));
      yearlyButton.addEventListener('click', () => startCheckout('yearly'));

      updateCheckoutUi();
      loadBillingConfig();
    })();
  </script>
</body>
</html>`;
}

function getPaymentSuccessPageHtml() {
  const membershipUrl = escapeHtml(getExtensionMembershipUrl());
  const chromeWebStoreInstallUrl = escapeHtml(getChromeWebStoreInstallUrl());
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
      --pending: #9f6a15;
      --pending-soft: rgba(159, 106, 21, 0.12);
      --danger: #b9382f;
      --danger-soft: rgba(185, 56, 47, 0.10);
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
    .badge.is-pending {
      background: var(--pending-soft);
      color: var(--pending);
    }
    .badge.is-failed {
      background: var(--danger-soft);
      color: var(--danger);
    }
    .badge-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: currentColor;
    }
    .badge-spinner {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      border: 2px solid currentColor;
      border-right-color: transparent;
      animation: spin 760ms linear infinite;
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
    .panel[hidden],
    .actions[hidden] {
      display: none;
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
    .inline-link {
      color: var(--text);
      font-weight: 800;
      text-decoration: underline;
      text-decoration-thickness: 2px;
      text-underline-offset: 3px;
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
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.92em;
      background: var(--accent-soft);
      padding: 2px 6px;
      border-radius: 8px;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
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
      <div class="badge is-pending" id="statusBadge"><span class="badge-spinner" id="statusIcon"></span><span id="statusLabel">Checking payment result</span></div>
      <h1 id="pageTitle">Waiting for your payment result.</h1>
      <p class="lead" id="pageLead">We are confirming the final Stripe payment status. This usually takes a few seconds, so please keep this page open.</p>

      <div class="panel" id="nextPanel" hidden>
        <h2 class="panel-title">What to do next</h2>
        <ol class="steps">
          <li>Install the <a class="inline-link" href="${chromeWebStoreInstallUrl}" target="_blank" rel="noopener noreferrer">AI Compare</a> extension.</li>
          <li>Enter the extension <a class="inline-link" href="${membershipUrl}">account page</a>.</li>
          <li>Check whether your <code id="planName">membership</code> status has changed to active.</li>
          <li>If it still looks unchanged, wait a few seconds and reopen the page once.</li>
        </ol>
      </div>
    </section>
  </main>
  <script>
    const sessionId = new URLSearchParams(window.location.search).get('session_id') || '';
    const apiBasePath = window.location.pathname.startsWith('/test-api/')
      ? '/test-api'
      : '';
    const statusBadge = document.getElementById('statusBadge');
    const statusIcon = document.getElementById('statusIcon');
    const statusLabel = document.getElementById('statusLabel');
    const pageTitle = document.getElementById('pageTitle');
    const pageLead = document.getElementById('pageLead');
    const nextPanel = document.getElementById('nextPanel');
    const planName = document.getElementById('planName');

    function updateResult(data) {
      const result = data || {};
      const label = result.planType === 'api' ? 'API Plan' : 'Chat Plan';
      if (planName) planName.textContent = label;
      return { ...result, planLabel: label };
    }

    function setPending(data) {
      updateResult(data || {});
      statusBadge.className = 'badge is-pending';
      statusIcon.className = 'badge-spinner';
      statusLabel.textContent = 'Waiting for payment result';
      pageTitle.textContent = 'Waiting for your payment result.';
      pageLead.hidden = false;
      pageLead.textContent = 'We are confirming the final Stripe payment status. This usually takes a few seconds, so please keep this page open.';
      nextPanel.hidden = true;
    }

    function setSuccess(data) {
      const result = updateResult(data || {});
      statusBadge.className = 'badge';
      statusIcon.className = 'badge-dot';
      statusLabel.textContent = 'Payment successful';
      pageTitle.textContent = 'Your ' + result.planLabel + ' payment is complete.';
      pageLead.hidden = true;
      pageLead.textContent = '';
      nextPanel.hidden = false;
    }

    function setFailed(data) {
      updateResult(data || {});
      statusBadge.className = 'badge is-failed';
      statusIcon.className = 'badge-dot';
      statusLabel.textContent = 'Payment not completed';
      pageTitle.textContent = 'We could not confirm this payment.';
      pageLead.hidden = false;
      pageLead.textContent = 'The checkout session did not finish with a successful payment. You can return to AICompare and start a new checkout if needed.';
      nextPanel.hidden = true;
    }

    async function pollPaymentStatus() {
      if (!sessionId) {
        setPending({ checkoutStatus: 'Waiting for session', paymentStatus: 'Waiting', membershipStatus: 'Waiting' });
        window.setTimeout(pollPaymentStatus, 3000);
        return;
      }

      try {
        const response = await fetch(apiBasePath + '/payment-status?session_id=' + encodeURIComponent(sessionId), {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          cache: 'no-store'
        });
        const data = await response.json();
        if (data.state === 'success') {
          setSuccess(data);
          return;
        }
        if (data.state === 'failed') {
          setFailed(data);
          return;
        }
        setPending(data);
      } catch (_error) {
        setPending({ checkoutStatus: 'Checking', paymentStatus: 'Waiting', membershipStatus: 'Waiting' });
      }
      window.setTimeout(pollPaymentStatus, 3000);
    }

    pollPaymentStatus();
  </script>
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
    users: pageName === 'users' ? 'active' : '',
    redeemCodes: pageName === 'redeemCodes' ? 'active' : '',
    apiUsage: pageName === 'apiUsage' ? 'active' : '',
    failureLogs: pageName === 'failureLogs' ? 'active' : '',
    finalFailures: pageName === 'finalFailures' ? 'active' : '',
    coursePromo: pageName === 'coursePromo' ? 'active' : '',
    growth: pageName === 'growth' ? 'active' : '',
    business: pageName === 'business' ? 'active' : '',
    apiCost: pageName === 'apiCost' ? 'active' : '',
    shareLinks: pageName === 'shareLinks' ? 'active' : ''
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
          <a class="nav-link ${active.users}" href="/admin/users">用户列表</a>
          <a class="nav-link ${active.redeemCodes}" href="/admin/redeem-codes">兑换码</a>
          <a class="nav-link ${active.apiUsage}" href="/admin/api-usage">使用统计</a>
          <a class="nav-link ${active.failureLogs}" href="/admin/failure-logs">失败日志</a>
          <a class="nav-link ${active.finalFailures}" href="/admin/final-failures">最终失败</a>
          <a class="nav-link ${active.coursePromo}" href="/admin/course-promo">课程广告</a>
          <a class="nav-link ${active.growth}" href="/admin/growth">增长漏斗</a>
          <a class="nav-link ${active.business}" href="/admin/business">商业化成本</a>
          <a class="nav-link ${active.apiCost}" href="/admin/api-cost">API 成本</a>
          <a class="nav-link ${active.shareLinks}" href="/admin/share-links">共享链接</a>
        </nav>
      </article>
      <aside id="adminSessionPanel" class="token-panel">
        <h2>管理员登录</h2>
        <div id="adminSessionSummary" class="admin-session-summary" hidden>
          管理员已登录
          <small>当前会话有效，可直接查看后台数据。</small>
        </div>
        <div id="adminLoginForm" class="admin-login-form">
          <p>使用独立后台账号密码登录。登录成功后，服务端会在当前浏览器写入一个 HttpOnly 管理员会话 Cookie。</p>
          <input id="usernameInput" type="text" autocomplete="username" placeholder="管理员账号" />
          <input id="passwordInput" type="password" autocomplete="current-password" placeholder="管理员密码" />
          <label class="remember-password-row">
            <input id="rememberPasswordInput" type="checkbox" />
            <span>保存账号密码（仅在可信设备使用）</span>
          </label>
        </div>
        <div class="token-actions">
          <button id="saveTokenButton" type="button">登录</button>
          <button id="clearTokenButton" type="button">退出/清空</button>
        </div>
        <div class="status" id="tokenStatus"></div>
      </aside>
    </section>
    ${content}
    <p class="footer-note">说明：会员订单统计优先使用 Stripe 发票/订阅数据；API 统计只覆盖官方代理接口 <code>/officialAgentChat</code>。最近使用记录列表只展示 query 摘要；详情抽屉可查看已记录的完整 Query。失败日志仍只展示截断后的 queryPreview / queryHash，不保存完整 prompt 或 AI 回复。</p>
  </main>
  <script>${ADMIN_CLIENT_SCRIPT}</script>
  <script>bootAdminPage(${JSON.stringify(pageName)});</script>
</body>
</html>`;
}

async function getPaymentStatusSnapshot(sessionId) {
  const normalizedSessionId = String(sessionId || '').trim();
  if (!/^cs_(test|live)_[A-Za-z0-9_]+$/.test(normalizedSessionId)) {
    return {
      state: 'pending',
      checkoutStatus: 'Waiting for session',
      paymentStatus: 'Waiting',
      membershipStatus: 'Waiting'
    };
  }

  const stripe = getStripe();
  let session = null;
  try {
    session = await stripe.checkout.sessions.retrieve(normalizedSessionId, {
      expand: ['subscription']
    });
  } catch (error) {
    if (error?.statusCode === 404 || error?.code === 'resource_missing') {
      return {
        state: 'pending',
        checkoutStatus: 'Looking up',
        paymentStatus: 'Waiting',
        membershipStatus: 'Waiting'
      };
    }
    throw error;
  }

  const checkoutStatus = String(session.status || '').trim() || 'unknown';
  const paymentStatus = String(session.payment_status || '').trim() || 'unknown';
  const subscription = session.subscription && typeof session.subscription === 'object'
    ? session.subscription
    : null;
  const subscriptionStatus = String(subscription?.status || '').trim();
  const priceId = String(
    subscription?.items?.data?.[0]?.price?.id
    || session.line_items?.data?.[0]?.price?.id
    || session.metadata?.priceId
    || ''
  ).trim();
  const planType = String(
    session.metadata?.planType
    || subscription?.metadata?.planType
    || getStripePlanTypeForPrice(priceId)
  ).trim() === 'api' ? 'api' : 'chat';
  const paymentSucceeded = checkoutStatus === 'complete' && paymentStatus === 'paid';
  const paymentFailed = checkoutStatus === 'expired'
    || ['canceled', 'failed'].includes(paymentStatus)
    || (checkoutStatus === 'complete' && paymentStatus === 'unpaid');

  if (paymentSucceeded && subscription) {
    await updateUserFromSubscription(subscription);
  }

  return {
    state: paymentSucceeded ? 'success' : (paymentFailed ? 'failed' : 'pending'),
    planType,
    checkoutStatus,
    paymentStatus,
    subscriptionStatus: subscriptionStatus || (paymentSucceeded ? 'syncing' : 'Waiting')
  };
}

function getOverviewPageHtml() {
  return createAdminPage({
    pageName: 'overview',
    title: '运营总览',
    description: '查看当前有效 Pro、订单收入，以及最近 7 天 API / 站点使用概览。',
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
      <nav id="ordersTabs" class="admin-tabs" role="tablist" aria-label="会员订单统计分类">
        <button class="tab-button active" type="button" role="tab" aria-selected="true" data-tab-target="recent">最近订单</button>
        <button class="tab-button" type="button" role="tab" aria-selected="false" data-tab-target="trend">收入趋势</button>
      </nav>
      <section class="card panel" data-tab-panel="recent">
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
      <section class="card panel" data-tab-panel="trend">
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

function getUsersPageHtml() {
  return createAdminPage({
    pageName: 'users',
    title: '用户列表',
    description: '查看所有注册用户的邮箱、Chat Plan、API Plan、到期时间和近 90 天常用提问语言。',
    content: `
      <h2 class="section-title">注册用户概览</h2>
      <section id="usersCards" class="grid"></section>
      <section class="card panel">
        <h3>所有注册用户</h3>
        <table>
          <thead>
            <tr>
              <th>邮箱 / UID</th>
              <th>Chat Plan</th>
              <th>Chat 到期时间</th>
              <th>API Plan</th>
              <th>API 到期时间</th>
              <th>常用提问语言</th>
              <th>注册时间</th>
              <th>最近活跃</th>
            </tr>
          </thead>
          <tbody id="usersTableBody">
            <tr><td colspan="8" class="empty-cell">等待加载...</td></tr>
          </tbody>
        </table>
      </section>
    `
  });
}

function getRedeemCodesPageHtml() {
  return createAdminPage({
    pageName: 'redeemCodes',
    title: '兑换码管理',
    description: '生成 Chat Plan 或 API Plan 的月度/年度兑换码，并查看最近生成和核销状态。',
    content: `
      <section class="card panel">
        <h3>生成兑换码</h3>
        <div class="redeem-code-form">
          <label class="field">
            <span>会员类型</span>
            <select id="redeemPlanType">
              <option value="chat">Chat Plan</option>
              <option value="api">API Plan</option>
            </select>
          </label>
          <label class="field">
            <span>周期</span>
            <select id="redeemInterval">
              <option value="monthly">月度</option>
              <option value="yearly">年度</option>
            </select>
          </label>
          <label class="field">
            <span>数量</span>
            <input id="redeemQuantity" type="number" min="1" max="100" value="1" />
          </label>
          <label class="field">
            <span>每个码可兑换次数</span>
            <input id="redeemMaxRedemptions" type="number" min="1" max="1000" value="1" />
          </label>
          <label class="field">
            <span>兑换码有效天数</span>
            <input id="redeemExpiresInDays" type="number" min="1" value="365" />
          </label>
          <label class="field redeem-note-field">
            <span>备注</span>
            <input id="redeemNote" type="text" maxlength="240" placeholder="例如：7 月活动 / 客服补偿" />
          </label>
        </div>
        <div class="course-promo-actions">
          <button id="generateRedeemCodesButton" type="button">生成兑换码</button>
          <button id="refreshRedeemCodesButton" type="button">刷新列表</button>
        </div>
        <div id="redeemCodeStatus" class="course-promo-meta"></div>
        <pre id="generatedRedeemCodes" class="redeem-code-output" hidden></pre>
      </section>
      <section class="card panel">
        <h3>最近兑换码</h3>
        <table>
          <thead>
            <tr>
              <th>码段</th>
              <th>会员</th>
              <th>周期</th>
              <th>状态</th>
              <th>用量</th>
              <th>过期</th>
              <th>最近兑换</th>
              <th>备注</th>
            </tr>
          </thead>
          <tbody id="redeemCodesTableBody">
            <tr><td colspan="8" class="empty-cell">等待加载...</td></tr>
          </tbody>
        </table>
      </section>
    `
  });
}

function getApiUsagePageHtml() {
  return createAdminPage({
    pageName: 'apiUsage',
    title: '使用统计后台',
    description: '合并查看官方 API、站点对比、功能事件和激活事件，默认只展示最近 7 天数据。',
    content: `
      <h2 class="section-title">核心指标</h2>
      <section id="apiCards" class="grid"></section>
      <nav id="apiUsageTabs" class="admin-tabs" role="tablist" aria-label="使用统计分类">
        <button class="tab-button active" type="button" role="tab" aria-selected="true" data-tab-target="trend">趋势</button>
        <button class="tab-button" type="button" role="tab" aria-selected="false" data-tab-target="targets">高频使用</button>
        <button class="tab-button" type="button" role="tab" aria-selected="false" data-tab-target="sites">站点排行</button>
        <button class="tab-button" type="button" role="tab" aria-selected="false" data-tab-target="features">功能与版本</button>
        <button class="tab-button" type="button" role="tab" aria-selected="false" data-tab-target="insights">Query 洞察</button>
        <button class="tab-button" type="button" role="tab" aria-selected="false" data-tab-target="recent">最近记录</button>
      </nav>
      <section class="card panel" data-tab-panel="trend">
        <h3>近 7 天趋势</h3>
        <table>
          <thead>
            <tr>
              <th>日期</th>
              <th>API 请求</th>
              <th>站点对比</th>
              <th>站点打开</th>
              <th>API Tokens</th>
              <th>活跃登录用户</th>
              <th>活跃匿名设备</th>
              <th>Top 站点</th>
            </tr>
          </thead>
          <tbody id="apiTrendBody">
            <tr><td colspan="8" class="empty-cell">等待加载...</td></tr>
          </tbody>
        </table>
      </section>
      <section class="card panel" data-tab-panel="targets">
        <h3>近 7 天高频使用</h3>
        <table>
          <thead>
            <tr>
              <th>类型</th>
              <th>目标</th>
              <th>次数</th>
              <th>活跃登录用户</th>
              <th>活跃匿名设备</th>
              <th>Tokens / 带 Query</th>
            </tr>
          </thead>
          <tbody id="usageTopTargetsBody">
            <tr><td colspan="6" class="empty-cell">等待加载...</td></tr>
          </tbody>
        </table>
      </section>
      <section class="card panel" data-tab-panel="sites">
        <h3>近 7 天使用站点次数排行</h3>
        <p class="footer-note">按站点被打开/参与对比的次数倒序，用来判断用户最喜欢或最常依赖的站点。</p>
        <table>
          <thead>
            <tr>
              <th>排名</th>
              <th>站点</th>
              <th>打开次数</th>
              <th>涉及对比次数</th>
              <th>活跃登录用户</th>
              <th>活跃匿名设备</th>
              <th>带 Query 次数</th>
            </tr>
          </thead>
          <tbody id="usageFavoriteSitesBody">
            <tr><td colspan="7" class="empty-cell">等待加载...</td></tr>
          </tbody>
        </table>
      </section>
      <section class="card panel" data-tab-panel="features">
        <h3>近 7 天功能事件排行</h3>
        <table>
          <thead>
            <tr>
              <th>事件</th>
              <th>次数</th>
              <th>活跃登录用户</th>
              <th>活跃匿名设备</th>
              <th>主要来源</th>
              <th>主版本</th>
              <th>最近时间</th>
            </tr>
          </thead>
          <tbody id="usageFeatureEventsBody">
            <tr><td colspan="7" class="empty-cell">等待加载...</td></tr>
          </tbody>
        </table>
      </section>
      <section class="card panel" data-tab-panel="features">
        <h3>近 7 天插件版本分布</h3>
        <p class="footer-note">按 extensionVersion 拆分站点对比和产品行为事件，避免新版埋点与旧版行为混在一起。</p>
        <div class="insight-grid">
          <div>
            <h4>站点对比版本</h4>
            <table>
              <thead><tr><th>版本</th><th>事件数</th><th>登录用户</th><th>匿名设备</th><th>站点打开</th><th>带 Query</th></tr></thead>
              <tbody id="usageSiteVersionsBody"><tr><td colspan="6" class="empty-cell">等待加载...</td></tr></tbody>
            </table>
          </div>
          <div>
            <h4>产品事件版本</h4>
            <table>
              <thead><tr><th>版本</th><th>事件数</th><th>登录用户</th><th>匿名设备</th><th>Top 事件</th><th>Top 来源</th></tr></thead>
              <tbody id="usageProductVersionsBody"><tr><td colspan="6" class="empty-cell">等待加载...</td></tr></tbody>
            </table>
          </div>
        </div>
      </section>
      <section class="card panel" data-tab-panel="insights">
        <div class="panel-heading-row">
          <div>
            <h3>Query 类型与用户洞察</h3>
            <p class="footer-note">使用 OpenRouter 免费模型分析已记录 Query，统计每日/每周问题类型，并判断是否适合做营销案例。点击按钮才会分析未缓存 Query。</p>
          </div>
          <button id="queryInsightAnalyzeButton" type="button" onclick="analyzeQueryInsightsNow()">分析最近 Query</button>
        </div>
        <div id="queryInsightStatus" class="status">等待加载...</div>
        <div class="insight-grid">
          <div>
            <h4>类型排行</h4>
            <table>
              <thead><tr><th>类型</th><th>数量</th></tr></thead>
              <tbody id="queryInsightTypeBody"><tr><td colspan="2" class="empty-cell">等待加载...</td></tr></tbody>
            </table>
          </div>
          <div>
            <h4>每日统计</h4>
            <table>
              <thead><tr><th>日期</th><th>总数</th><th>类型分布</th></tr></thead>
              <tbody id="queryInsightDailyBody"><tr><td colspan="3" class="empty-cell">等待加载...</td></tr></tbody>
            </table>
          </div>
          <div>
            <h4>每周统计</h4>
            <table>
              <thead><tr><th>周起始</th><th>总数</th><th>类型分布</th></tr></thead>
              <tbody id="queryInsightWeeklyBody"><tr><td colspan="3" class="empty-cell">等待加载...</td></tr></tbody>
            </table>
          </div>
          <div>
            <h4>用户画像与营销洞察</h4>
            <table>
              <thead><tr><th>维度</th><th>洞察</th></tr></thead>
              <tbody id="queryInsightBody"><tr><td colspan="2" class="empty-cell">等待加载...</td></tr></tbody>
            </table>
          </div>
        </div>
      </section>
      <section class="card panel" data-tab-panel="recent">
        <h3>最近使用记录</h3>
        <p class="footer-note">列表仅展示截断摘要；点击记录后可在右侧抽屉查看已记录的完整 Query。历史记录若上线前未保存完整 Query，则只能显示摘要。</p>
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>类型</th>
              <th>用户</th>
              <th>地区/设备语言</th>
              <th>模型 / 站点</th>
              <th>版本</th>
              <th>摘要</th>
            </tr>
            <tr class="usage-filter-row">
              <th><input id="usageRecentDateFilter" class="usage-filter-input" type="search" placeholder="日期/时间"></th>
              <th>
                <select id="usageRecentTypeFilter" class="usage-filter-input">
                  <option value="">全部</option>
                  <option value="api">API</option>
                  <option value="site">站点</option>
                  <option value="对比">对比</option>
                  <option value="总结">总结</option>
                  <option value="问答">问答</option>
                  <option value="打开">打开</option>
                  <option value="技能">技能</option>
                </select>
              </th>
              <th><input id="usageRecentUserFilter" class="usage-filter-input" type="search" placeholder="用户"></th>
              <th><input id="usageRecentLocaleFilter" class="usage-filter-input" type="search" placeholder="地区/语言"></th>
              <th><input id="usageRecentTargetFilter" class="usage-filter-input" type="search" placeholder="模型/站点"></th>
              <th><input id="usageRecentVersionFilter" class="usage-filter-input" type="search" placeholder="版本"></th>
              <th>
                <div class="usage-filter-combo">
                  <input id="usageRecentQueryFilter" class="usage-filter-input" type="search" placeholder="摘要/Query">
                  <button id="usageRecentClearFilters" class="usage-filter-clear" type="button">清空</button>
                </div>
              </th>
            </tr>
          </thead>
          <tbody id="usageRecentBody">
            <tr><td colspan="7" class="empty-cell">等待加载...</td></tr>
          </tbody>
        </table>
      </section>
      <div id="usageDrawerBackdrop" class="usage-drawer-backdrop" onclick="closeUsageDetailDrawer()"></div>
      <aside id="usageDetailDrawer" class="usage-detail-drawer" aria-hidden="true">
        <div class="usage-detail-header">
          <div>
            <div class="eyebrow">Usage Detail</div>
            <h3>使用记录详情</h3>
          </div>
          <button type="button" class="drawer-close-button" onclick="closeUsageDetailDrawer()">关闭</button>
        </div>
        <div id="usageDetailBody" class="usage-detail-body"></div>
      </aside>
    `
  });
}

function getSiteUsagePageHtml() {
  return createAdminPage({
    pageName: 'siteUsage',
    title: '站点使用后台',
    description: '统计用户打开站点对比的次数、活跃用户/匿名设备，以及最常使用的官方站点、自定义站点和 Agent。',
    content: `
      <h2 class="section-title">核心指标</h2>
      <section id="siteUsageCards" class="grid"></section>
      <section class="card panel">
        <h3>近 30 天趋势</h3>
        <table>
          <thead>
            <tr>
              <th>日期</th>
              <th>对比次数</th>
              <th>站点打开次数</th>
              <th>使用站点数</th>
              <th>活跃登录用户</th>
              <th>活跃匿名设备</th>
              <th>Top 站点</th>
            </tr>
          </thead>
          <tbody id="siteUsageTrendBody">
            <tr><td colspan="7" class="empty-cell">等待加载...</td></tr>
          </tbody>
        </table>
      </section>
      <section class="card panel">
        <h3>近 30 天站点排行</h3>
        <table>
          <thead>
            <tr>
              <th>站点</th>
              <th>打开次数</th>
              <th>涉及对比次数</th>
              <th>活跃登录用户</th>
              <th>活跃匿名设备</th>
              <th>带 query 次数</th>
            </tr>
          </thead>
          <tbody id="siteUsageTopSitesBody">
            <tr><td colspan="6" class="empty-cell">等待加载...</td></tr>
          </tbody>
        </table>
      </section>
      <section class="card panel">
        <h3>最近站点对比事件</h3>
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>用户类型</th>
              <th>站点数</th>
              <th>站点</th>
              <th>Agent</th>
              <th>带 query</th>
              <th>版本</th>
            </tr>
          </thead>
          <tbody id="siteUsageRecentBody">
            <tr><td colspan="7" class="empty-cell">等待加载...</td></tr>
          </tbody>
        </table>
      </section>
    `
  });
}

function getFailureLogsPageHtml() {
  return createAdminPage({
    pageName: 'failureLogs',
    title: '失败日志后台',
    description: '查看站点/API 失败详情、失败率、修复优先级和失败阶段，默认按最新失败时间倒序。',
    content: `
      <h2 class="section-title">核心指标</h2>
      <section id="failureCards" class="grid"></section>
      <nav id="failureLogsTabs" class="admin-tabs" role="tablist" aria-label="失败日志统计分类">
        <button class="tab-button active" type="button" role="tab" aria-selected="true" data-tab-target="filters">筛选</button>
        <button class="tab-button" type="button" role="tab" aria-selected="false" data-tab-target="trend">趋势</button>
        <button class="tab-button" type="button" role="tab" aria-selected="false" data-tab-target="priority">修复优先级</button>
        <button class="tab-button" type="button" role="tab" aria-selected="false" data-tab-target="phases">失败阶段</button>
        <button class="tab-button" type="button" role="tab" aria-selected="false" data-tab-target="details">详情记录</button>
      </nav>
      <section class="card panel" data-tab-panel="filters">
        <h3>筛选</h3>
        <div class="filter-row">
          <label>天数 <select id="failureDays"><option value="1">今天</option><option value="7" selected>近 7 天</option><option value="30">近 30 天</option></select></label>
          <label>类型 <select id="failureCategory"><option value="all">全部</option><option value="site">站点失败</option><option value="api">API 失败</option></select></label>
          <label>搜索 <input id="failureQuery" type="search" placeholder="站点、API、阶段、错误、URL、query、版本" /></label>
          <button id="failureSearchButton" type="button">刷新</button>
        </div>
      </section>
      <section class="card panel" data-tab-panel="trend">
        <h3>近 7 天趋势</h3>
        <table>
          <thead>
            <tr>
              <th>日期</th>
              <th>站点失败</th>
              <th>API 失败</th>
              <th>总失败</th>
              <th>失败站点数</th>
            </tr>
          </thead>
          <tbody id="failureTrendBody">
            <tr><td colspan="5" class="empty-cell">等待加载...</td></tr>
          </tbody>
        </table>
      </section>
      <section class="card panel" data-tab-panel="priority">
        <h3>近 7 天修复优先级</h3>
        <table>
          <thead>
            <tr>
              <th>类型</th>
              <th>目标</th>
              <th>失败次数</th>
              <th>优先级分</th>
              <th>主要阶段</th>
              <th>最近错误</th>
            </tr>
          </thead>
          <tbody id="failurePriorityBody">
            <tr><td colspan="6" class="empty-cell">等待加载...</td></tr>
          </tbody>
        </table>
      </section>
      <section class="card panel" data-tab-panel="phases">
        <h3>近 7 天失败阶段排行</h3>
        <table>
          <thead>
            <tr>
              <th>阶段</th>
              <th>失败次数</th>
            </tr>
          </thead>
          <tbody id="failurePhasesBody">
            <tr><td colspan="2" class="empty-cell">等待加载...</td></tr>
          </tbody>
        </table>
      </section>
      <section class="card panel" data-tab-panel="details">
        <h3>失败详情记录</h3>
        <p class="footer-note">尽量展开诊断字段；URL、Query、错误信息过长时会截断显示，鼠标悬停可看完整内容，下方详情行展示 metadata、record id、hash 等辅助定位信息。</p>
        <div class="table-scroll">
          <table class="failure-detail-table">
            <thead>
              <tr>
                <th>失败时间 / 创建</th>
                <th>上传时间</th>
                <th>类型</th>
                <th>目标</th>
                <th>来源</th>
                <th>阶段</th>
                <th>状态码</th>
                <th>错误码</th>
                <th>模型</th>
                <th>版本</th>
                <th>用户 / 语言</th>
                <th>次数</th>
                <th>URL</th>
                <th>Query</th>
                <th>错误信息</th>
              </tr>
            </thead>
            <tbody id="failureLogsBody">
              <tr><td colspan="15" class="empty-cell">等待加载...</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    `
  });
}

function getFinalFailuresPageHtml() {
  return createAdminPage({
    pageName: 'finalFailures',
    title: '最终失败统计',
    description: '只统计用户看到最终失败弹窗的情况；站点内部中间重试、步骤重试和普通诊断日志不计入。',
    content: `
      <h2 class="section-title">核心指标</h2>
      <section id="finalFailureCards" class="grid"></section>
      <nav id="finalFailuresTabs" class="admin-tabs" role="tablist" aria-label="最终失败统计分类">
        <button class="tab-button active" type="button" role="tab" aria-selected="true" data-tab-target="filters">筛选</button>
        <button class="tab-button" type="button" role="tab" aria-selected="false" data-tab-target="trend">趋势</button>
        <button class="tab-button" type="button" role="tab" aria-selected="false" data-tab-target="details">详情记录</button>
      </nav>
      <section class="card panel" data-tab-panel="filters">
        <h3>筛选</h3>
        <div class="filter-row">
          <label>天数 <select id="finalFailureDays"><option value="1">今天</option><option value="7" selected>近 7 天</option><option value="30">近 30 天</option></select></label>
          <label>类型 <select id="finalFailureCategory"><option value="all">全部</option><option value="site">站点失败</option><option value="api">API 失败</option></select></label>
          <label>搜索 <input id="finalFailureQuery" type="search" placeholder="站点、阶段、错误、URL、query、版本" /></label>
          <button id="finalFailureSearchButton" type="button">刷新</button>
        </div>
      </section>
      <section class="card panel" data-tab-panel="trend">
        <h3>近 7 天最终失败趋势</h3>
        <table>
          <thead>
            <tr>
              <th>日期</th>
              <th>站点失败</th>
              <th>API 失败</th>
              <th>总失败</th>
              <th>失败站点数</th>
            </tr>
          </thead>
          <tbody id="finalFailureTrendBody">
            <tr><td colspan="5" class="empty-cell">等待加载...</td></tr>
          </tbody>
        </table>
      </section>
      <section class="card panel" data-tab-panel="details">
        <h3>最终失败详情记录</h3>
        <p class="footer-note">仅展示 <code>metadata.finalFailurePopup=true</code> 的真实记录。用于判断用户真正被失败弹窗打断的站点和原因。</p>
        <div class="table-scroll">
          <table class="failure-detail-table">
            <thead>
              <tr>
                <th>失败时间 / 创建</th>
                <th>上传时间</th>
                <th>类型</th>
                <th>目标</th>
                <th>来源</th>
                <th>阶段</th>
                <th>状态码</th>
                <th>错误码</th>
                <th>模型</th>
                <th>版本</th>
                <th>用户 / 语言</th>
                <th>次数</th>
                <th>URL</th>
                <th>Query</th>
                <th>错误信息</th>
              </tr>
            </thead>
            <tbody id="finalFailureLogsBody">
              <tr><td colspan="15" class="empty-cell">等待加载...</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    `
  });
}

function getGrowthPageHtml() {
  return createAdminPage({
    pageName: 'growth',
    title: '增长漏斗看板',
    description: '查看首次对比、API 成功、入口来源等激活事件，帮助判断新用户是否理解并形成使用习惯。',
    content: `
      <h2 class="section-title">最近 7 天增长指标</h2>
      <section id="growthCards" class="grid"></section>
      <nav id="growthTabs" class="admin-tabs" role="tablist" aria-label="增长漏斗统计分类">
        <button class="tab-button active" type="button" role="tab" aria-selected="true" data-tab-target="activation">激活事件</button>
        <button class="tab-button" type="button" role="tab" aria-selected="false" data-tab-target="versions">版本分布</button>
        <button class="tab-button" type="button" role="tab" aria-selected="false" data-tab-target="maturity">用户成熟度</button>
        <button class="tab-button" type="button" role="tab" aria-selected="false" data-tab-target="workflows">工作流组合</button>
        <button class="tab-button" type="button" role="tab" aria-selected="false" data-tab-target="cohorts">Cohort</button>
        <button class="tab-button" type="button" role="tab" aria-selected="false" data-tab-target="sources">入口来源</button>
      </nav>
	      <section class="card panel" data-tab-panel="activation">
	        <h3>激活事件排行</h3>
	        <table>
	          <thead><tr><th>事件</th><th>次数</th><th>活跃登录用户</th><th>活跃匿名设备</th><th>主要来源</th><th>主版本</th><th>最近时间</th></tr></thead>
	          <tbody id="growthActivationBody"><tr><td colspan="7" class="empty-cell">等待加载...</td></tr></tbody>
	        </table>
	      </section>
	      <section class="card panel" data-tab-panel="versions">
	        <h3>插件版本分布</h3>
	        <p class="footer-note">用于判断新版激活、功能、订阅和站点事件是否已经覆盖真实用户。</p>
	        <table>
	          <thead><tr><th>版本</th><th>事件数</th><th>登录用户</th><th>匿名设备</th><th>站点打开</th><th>带 Query</th></tr></thead>
	          <tbody id="growthVersionsBody"><tr><td colspan="6" class="empty-cell">等待加载...</td></tr></tbody>
	        </table>
	      </section>
	      <section class="card panel" data-tab-panel="maturity">
	        <h3>用户成熟度</h3>
	        <table>
	          <thead><tr><th>阶段</th><th>用户/设备数</th></tr></thead>
	          <tbody id="growthMaturityBody"><tr><td colspan="2" class="empty-cell">等待加载...</td></tr></tbody>
	        </table>
	      </section>
	      <section class="card panel" data-tab-panel="workflows">
	        <h3>高频工作流组合</h3>
	        <table>
	          <thead><tr><th>组合</th><th>模式</th><th>次数</th><th>带 Query</th><th>活跃用户/设备</th><th>主版本</th></tr></thead>
	          <tbody id="growthCombinationsBody"><tr><td colspan="6" class="empty-cell">等待加载...</td></tr></tbody>
	        </table>
	      </section>
	      <section class="card panel" data-tab-panel="cohorts">
	        <h3>首次查询 Cohort</h3>
	        <table>
	          <thead><tr><th>首次查询日期</th><th>用户/设备数</th><th>D1 回访</th><th>D7 回访</th></tr></thead>
	          <tbody id="growthCohortsBody"><tr><td colspan="4" class="empty-cell">等待加载...</td></tr></tbody>
	        </table>
	      </section>
	      <section class="card panel" data-tab-panel="sources">
        <h3>入口来源</h3>
        <table>
          <thead><tr><th>来源</th><th>事件次数</th></tr></thead>
          <tbody id="growthSourcesBody"><tr><td colspan="2" class="empty-cell">等待加载...</td></tr></tbody>
        </table>
        <p class="footer-note" id="growthNote"></p>
      </section>
    `
  });
}

function getBusinessPageHtml() {
  return createAdminPage({
    pageName: 'business',
    title: '商业化与成本看板',
    description: '把免费额度触达、Stripe 漏斗、tokens、估算成本和高成本分布放在一起，用于定价和限额决策。',
    content: `
      <h2 class="section-title">最近 7 天商业化与成本</h2>
      <section id="businessCards" class="grid"></section>
      <nav id="businessTabs" class="admin-tabs" role="tablist" aria-label="商业化成本统计分类">
        <button class="tab-button active" type="button" role="tab" aria-selected="true" data-tab-target="funnel">订阅漏斗</button>
        <button class="tab-button" type="button" role="tab" aria-selected="false" data-tab-target="distribution">Tokens / 成本分布</button>
      </nav>
      <section class="card panel" data-tab-panel="funnel">
        <h3>订阅漏斗事件</h3>
        <table>
          <thead><tr><th>事件</th><th>次数</th><th>活跃登录用户</th><th>活跃匿名设备</th><th>主要来源</th><th>最近时间</th></tr></thead>
          <tbody id="businessFunnelBody"><tr><td colspan="6" class="empty-cell">等待加载...</td></tr></tbody>
        </table>
      </section>
      <section class="card panel" data-tab-panel="distribution">
        <h3>单用户 Tokens / 成本分布</h3>
        <table>
          <thead><tr><th>指标</th><th>P50</th><th>P90</th><th>P99</th></tr></thead>
          <tbody id="businessDistributionBody"><tr><td colspan="4" class="empty-cell">等待加载...</td></tr></tbody>
        </table>
      </section>
    `
  });
}

function getApiCostPageHtml() {
  return createAdminPage({
    pageName: 'apiCost',
    title: '每日 API 成本',
    description: '按天统计官方代理 API 的 tokens、官方价估算与实际云端成本；当前实际成本按 OpenAI 官方价格的 0.15 倍计算。',
    content: `
      <h2 class="section-title">API 成本核心指标</h2>
      <section id="apiCostCards" class="grid"></section>
      <nav id="apiCostTabs" class="admin-tabs" role="tablist" aria-label="API 成本统计分类">
        <button class="tab-button active" type="button" role="tab" aria-selected="true" data-tab-target="daily">每日成本</button>
        <button class="tab-button" type="button" role="tab" aria-selected="false" data-tab-target="models">模型排行</button>
      </nav>
      <section class="card panel" data-tab-panel="daily">
        <h3>近 30 天每日 API 成本</h3>
        <p class="footer-note">实际云端成本 = 官方价格估算 × 成本倍率。当前倍率默认 <code>0.15</code>，可通过 <code>OFFICIAL_AGENT_COST_MULTIPLIER</code> 覆盖。</p>
        <table>
          <thead>
            <tr>
              <th>日期</th>
              <th>请求数</th>
              <th>输入 Tokens</th>
              <th>输出 Tokens</th>
              <th>总 Tokens</th>
              <th>官方价估算</th>
              <th>实际成本</th>
              <th>单请求成本</th>
            </tr>
          </thead>
          <tbody id="apiCostTrendBody">
            <tr><td colspan="8" class="empty-cell">等待加载...</td></tr>
          </tbody>
        </table>
      </section>
      <section class="card panel" data-tab-panel="models">
        <h3>近 30 天模型成本排行</h3>
        <table>
          <thead>
            <tr>
              <th>模型</th>
              <th>请求数</th>
              <th>总 Tokens</th>
              <th>官方价估算</th>
              <th>实际成本</th>
              <th>登录用户</th>
              <th>匿名设备</th>
            </tr>
          </thead>
          <tbody id="apiCostModelsBody">
            <tr><td colspan="7" class="empty-cell">等待加载...</td></tr>
          </tbody>
        </table>
      </section>
    `
  });
}

function getShareLinksPageHtml() {
  return createAdminPage({
    pageName: 'shareLinks',
    title: '共享链接统计',
    description: '按天查看生成共享链接的数量、包含总结的比例、涉及站点与最近共享详情，数据来自 remoteShares 真实记录。',
    content: `
      <h2 class="section-title">近 7 天共享链接</h2>
      <section id="shareLinkCards" class="grid"></section>
      <nav id="shareLinksTabs" class="admin-tabs" role="tablist" aria-label="共享链接统计分类">
        <button class="tab-button active" type="button" role="tab" aria-selected="true" data-tab-target="trend">每日趋势</button>
        <button class="tab-button" type="button" role="tab" aria-selected="false" data-tab-target="details">详情列表</button>
      </nav>
      <section class="card panel" data-tab-panel="trend">
        <h3>每日生成趋势</h3>
        <table>
          <thead>
            <tr>
              <th>日期</th>
              <th>生成数</th>
              <th>有效</th>
              <th>过期</th>
              <th>包含总结</th>
              <th>回答数</th>
              <th>平均站点数</th>
              <th>Top 站点</th>
            </tr>
          </thead>
          <tbody id="shareLinkTrendBody">
            <tr><td colspan="8" class="empty-cell">等待加载...</td></tr>
          </tbody>
        </table>
      </section>
      <section class="card panel" data-tab-panel="details">
        <h3>最近共享链接详情</h3>
        <p class="footer-note">按创建时间倒序展示。当前分享记录没有保存用户身份字段，因此这里只展示分享内容相关的真实字段。</p>
        <table>
          <thead>
            <tr>
              <th>创建 / 过期</th>
              <th>Share ID / 状态</th>
              <th>问题 / 模板</th>
              <th>站点</th>
              <th>回答 / 总结</th>
              <th>链接</th>
            </tr>
          </thead>
          <tbody id="shareLinkListBody">
            <tr><td colspan="6" class="empty-cell">等待加载...</td></tr>
          </tbody>
        </table>
      </section>
    `
  });
}

function getCoursePromoPageHtml() {
  return createAdminPage({
    pageName: 'coursePromo',
    title: '课程广告配置',
    description: '控制主页课程广告的显示开关、图片、搜索框文字广告、链接和频控参数。公开页面只读取安全字段，适合随时换图换链路。',
    content: `
      <section class="card panel">
        <h2 class="section-title">广告配置</h2>
        <div class="course-promo-grid">
          <label class="field">
            <span>是否显示广告</span>
            <select id="coursePromoEnabled">
              <option value="false">关闭</option>
              <option value="true">开启</option>
            </select>
          </label>
          <label class="field">
            <span>广告图片 URL</span>
            <input id="coursePromoImageUrl" type="url" placeholder="https://..." />
          </label>
          <label class="field">
            <span>点击链接 URL</span>
            <input id="coursePromoTargetUrl" type="url" placeholder="https://..." />
          </label>
          <label class="field">
            <span>标题</span>
            <input id="coursePromoTitle" type="text" maxlength="80" />
          </label>
          <label class="field course-promo-field-wide">
            <span>副标题</span>
            <textarea id="coursePromoSubtitle" rows="3" maxlength="160"></textarea>
          </label>
          <label class="field">
            <span>按钮文案</span>
            <input id="coursePromoCtaText" type="text" maxlength="24" />
          </label>
          <label class="field">
            <span>目标语言</span>
            <input id="coursePromoTargetLocales" type="text" placeholder="zh_CN, zh_TW, zh" />
          </label>
          <label class="field">
            <span>关闭后天数</span>
            <input id="coursePromoDismissDays" type="number" min="1" max="365" step="1" />
          </label>
          <label class="field">
            <span>每日最多展示</span>
            <input id="coursePromoMaxImpressionsPerDay" type="number" min="1" max="20" step="1" />
          </label>
        </div>
        <div class="course-promo-subsection">
          <h3>搜索框文字广告</h3>
          <div class="course-promo-grid">
            <label class="field">
              <span>文字广告开关</span>
              <select id="coursePromoTextAdEnabled">
                <option value="false">关闭</option>
                <option value="true">开启</option>
              </select>
            </label>
            <label class="field">
              <span>文字广告文案</span>
              <input id="coursePromoTextAdText" type="text" maxlength="80" placeholder="例如：系统学习 Codex 编程课，点这里" />
            </label>
            <label class="field course-promo-field-wide">
              <span>文字广告跳转链接</span>
              <input id="coursePromoTextAdUrl" type="url" placeholder="https://..." />
            </label>
          </div>
        </div>
        <div class="course-promo-actions">
          <button id="coursePromoSaveButton" type="button">保存配置</button>
          <button id="coursePromoRefreshButton" type="button">重新加载</button>
        </div>
        <div class="course-promo-meta" id="coursePromoMeta"></div>
      </section>
      <section class="card panel">
        <h3>图片预览</h3>
        <div class="course-promo-preview">
          <img id="coursePromoImagePreview" alt="课程广告预览" />
          <div class="course-promo-preview-copy">
            <div id="coursePromoPreviewTitle" class="course-promo-preview-title"></div>
            <div id="coursePromoPreviewSubtitle" class="course-promo-preview-subtitle"></div>
            <a id="coursePromoPreviewLink" class="course-promo-preview-link" href="#" target="_blank" rel="noopener noreferrer">打开链接</a>
            <a id="coursePromoTextAdPreview" class="course-promo-preview-link" href="#" target="_blank" rel="noopener noreferrer" hidden></a>
          </div>
        </div>
      </section>
    `
  });
}

function createEmptyUsageDay(dateKey) {
  return {
    date: dateKey,
    free: { requests: 0, activeUsers: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0 },
    pro: { requests: 0, activeUsers: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0 },
    anonymous: { requests: 0, activeUsers: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0 },
    totalRequests: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    estimatedCost: 0,
    currency: officialAgentCostCurrency,
    activeUsers: 0,
    activeAnonymousClients: 0
  };
}

function getAuthUserIso(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

async function listFirebaseAuthUsers(maxUsers = 5000) {
  requireFirebaseAdmin();
  const safeMaxUsers = clamp(parseInteger(maxUsers, 5000), 1, 20000);
  const users = [];
  let pageToken;
  while (users.length < safeMaxUsers) {
    const result = await admin.auth().listUsers(Math.min(1000, safeMaxUsers - users.length), pageToken);
    users.push(...(Array.isArray(result.users) ? result.users : []));
    pageToken = result.pageToken;
    if (!pageToken) break;
  }
  return users;
}

function normalizePlanName(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || 'free';
}

function buildPlanStatus(planValue, expiresAtValue) {
  const plan = normalizePlanName(planValue);
  if (!plan || plan === 'free' || plan === 'none') return '免费';
  const expiresAtSeconds = getTimestampSeconds(expiresAtValue);
  if (expiresAtSeconds > 0 && expiresAtSeconds * 1000 < Date.now()) {
    return '已过期';
  }
  return `${plan} / 有效`;
}

function incrementLocaleCount(localeByUid, uid = '', locale = '') {
  const normalizedUid = String(uid || '').trim();
  const normalizedLocale = String(locale || '').trim();
  if (!normalizedUid || !normalizedLocale) return;
  if (!localeByUid.has(normalizedUid)) localeByUid.set(normalizedUid, new Map());
  const counts = localeByUid.get(normalizedUid);
  counts.set(normalizedLocale, (counts.get(normalizedLocale) || 0) + 1);
}

function getTopLocaleFromCounts(counts) {
  if (!counts || !counts.size) return '';
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0][0];
}

function detectQuestionLanguage(text = '') {
  const source = String(text || '').trim();
  if (!source) return '';
  const cjkCount = (source.match(/[\u3400-\u9fff]/g) || []).length;
  const kanaCount = (source.match(/[\u3040-\u30ff]/g) || []).length;
  const hangulCount = (source.match(/[\uac00-\ud7af]/g) || []).length;
  const latinCount = (source.match(/[a-zA-Z]/g) || []).length;
  if (kanaCount > 0 && kanaCount >= cjkCount) return '日语';
  if (hangulCount > 0) return '韩语';
  if (cjkCount > 0) return '中文简体';
  if (latinCount > 0) return '英语';
  return '';
}

function getQuestionTextForLanguage(row = {}) {
  return extractUserQueryForInsight(row.queryText || row.queryPreview || '');
}

async function getCommonQuestionLanguageByUid(days = 90) {
  const dateKeys = getRecentDateKeys(days);
  const [apiRows, siteRows] = await Promise.all([
    listOfficialApiEvents(dateKeys),
    listSiteCompareEvents(dateKeys)
  ]);
  const localeByUid = new Map();
  apiRows.forEach((row) => incrementLocaleCount(localeByUid, row.uid, detectQuestionLanguage(getQuestionTextForLanguage(row))));
  siteRows.forEach((row) => incrementLocaleCount(localeByUid, row.uid, detectQuestionLanguage(getQuestionTextForLanguage(row))));
  const result = new Map();
  localeByUid.forEach((counts, uid) => {
    result.set(uid, getTopLocaleFromCounts(counts));
  });
  return result;
}

function getLocaleFallbackLabel(locale = '') {
  const normalized = String(locale || '').trim().toLowerCase().replace('_', '-');
  if (!normalized) return '';
  if (normalized.startsWith('zh')) return '中文简体';
  if (normalized.startsWith('en')) return '英语';
  if (normalized.startsWith('ja')) return '日语';
  if (normalized.startsWith('ko')) return '韩语';
  return locale;
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
      apiPlan: String(data.apiPlan || 'free').trim() || 'free',
      apiPlanExpiresAt: data.apiPlanExpiresAt || null,
      stripeCustomerId: String(data.stripeCustomerId || '').trim(),
      stripeSubscriptionId: String(data.stripeSubscriptionId || '').trim(),
      subscriptionStatus: String(data.subscriptionStatus || '').trim(),
      apiSubscriptionStatus: String(data.apiSubscriptionStatus || '').trim(),
      locale: String(data.locale || data.lastLocale || data.language || '').trim(),
      createdAt: data.createdAt || null,
      updatedAt: data.updatedAt || null
    });
  });
  return byUid;
}

function matchesUserListQuery(user, query = '') {
  const normalizedQuery = String(query || '').trim().toLowerCase();
  if (!normalizedQuery) return true;
  return [
    user.uid,
    user.email,
    user.chatPlanStatus,
    user.chatSubscriptionStatus,
    user.apiPlanStatus,
    user.apiSubscriptionStatus,
    user.commonLocale
  ].some((value) => String(value || '').toLowerCase().includes(normalizedQuery));
}

function buildUserListItem(uid, profile = {}, authUser = null, commonLocaleByUid = new Map()) {
  const email = String(authUser?.email || profile.email || '').trim();
  const fallbackLocale = getLocaleFallbackLabel(profile.locale);
  const commonLocale = commonLocaleByUid.get(uid) || fallbackLocale || '';
  return {
    uid,
    email,
    chatPlanStatus: buildPlanStatus(profile.plan, profile.planExpiresAt),
    chatSubscriptionStatus: String(profile.subscriptionStatus || '').trim() || '-',
    chatPlanExpiresAt: timestampToIso(profile.planExpiresAt),
    apiPlanStatus: buildPlanStatus(profile.apiPlan, profile.apiPlanExpiresAt),
    apiSubscriptionStatus: String(profile.apiSubscriptionStatus || '').trim() || '-',
    apiPlanExpiresAt: timestampToIso(profile.apiPlanExpiresAt),
    commonLocale,
    localeSource: commonLocaleByUid.has(uid) ? '近 90 天 Query' : (fallbackLocale ? '设备语言' : ''),
    createdAt: timestampToIso(profile.createdAt),
    updatedAt: timestampToIso(profile.updatedAt),
    authCreatedAt: getAuthUserIso(authUser?.metadata?.creationTime),
    authLastSignInAt: getAuthUserIso(authUser?.metadata?.lastSignInTime),
    lastSeenAt: timestampToIso(profile.updatedAt) || getAuthUserIso(authUser?.metadata?.lastSignInTime)
  };
}

async function getAdminUsersListData(req) {
  const limit = clamp(parseInteger(req.query?.limit, 500), 1, 1000);
  const query = String(req.query?.query || '').trim();
  const maxAuthUsers = clamp(parseInteger(req.query?.maxAuthUsers, 5000), 1, 20000);
  const [userDirectory, authUsers, commonLocaleByUid] = await Promise.all([
    getUserDirectory(),
    listFirebaseAuthUsers(maxAuthUsers),
    getCommonQuestionLanguageByUid(90)
  ]);

  const authByUid = new Map(authUsers.map((user) => [user.uid, user]));
  const uidSet = new Set([...authByUid.keys(), ...userDirectory.keys()]);
  const allUsers = Array.from(uidSet).map((uid) => {
    const profile = userDirectory.get(uid) || { uid };
    return buildUserListItem(uid, profile, authByUid.get(uid), commonLocaleByUid);
  }).sort((left, right) => {
    const rightTime = Date.parse(right.lastSeenAt || right.updatedAt || right.authLastSignInAt || right.createdAt || right.authCreatedAt || 0) || 0;
    const leftTime = Date.parse(left.lastSeenAt || left.updatedAt || left.authLastSignInAt || left.createdAt || left.authCreatedAt || 0) || 0;
    return rightTime - leftTime || String(left.email || left.uid).localeCompare(String(right.email || right.uid));
  });

  const filteredUsers = allUsers.filter((user) => matchesUserListQuery(user, query));
  const localeCounts = new Map();
  let chatProUsers = 0;
  let apiProUsers = 0;
  let usersWithEmail = 0;
  let usersWithLocale = 0;
  allUsers.forEach((user) => {
    if (user.chatPlanStatus !== '免费' && user.chatPlanStatus !== '已过期') chatProUsers += 1;
    if (user.apiPlanStatus !== '免费' && user.apiPlanStatus !== '已过期') apiProUsers += 1;
    if (user.email) usersWithEmail += 1;
    if (user.commonLocale) {
      usersWithLocale += 1;
      localeCounts.set(user.commonLocale, (localeCounts.get(user.commonLocale) || 0) + 1);
    }
  });

  return {
    users: filteredUsers.slice(0, limit),
    total: allUsers.length,
    filteredTotal: filteredUsers.length,
    summary: {
      chatProUsers,
      apiProUsers,
      usersWithEmail,
      usersWithLocale,
      topLocale: getTopLocaleFromCounts(localeCounts)
    }
  };
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
    days: sortDateRowsDescending(dateKeys.map((dateKey) => trend.get(dateKey) || {
      date: dateKey,
      newSubscriptions: 0,
      renewedSubscriptions: 0,
      canceledSubscriptions: 0,
      revenueAmount: 0
    }))
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
  const tokenStatsByDay = new Map();

  const addTokenStats = (dateKey, userType, data) => {
    if (!tokenStatsByDay.has(dateKey)) {
      tokenStatsByDay.set(dateKey, {
        free: { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0 },
        pro: { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0 },
        anonymous: { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0 },
        total: { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0 }
      });
    }
    const stats = tokenStatsByDay.get(dateKey);
    const bucket = stats[userType] || stats.free;
    const promptTokens = Math.max(0, Number(data.promptTokens) || 0);
    const completionTokens = Math.max(0, Number(data.completionTokens) || 0);
    const totalTokens = Math.max(0, Number(data.totalTokens) || 0);
    const cost = getOfficialApiEventCost(data);
    const estimatedCost = Math.max(0, Number(cost.estimatedCost) || 0);
    bucket.promptTokens += promptTokens;
    bucket.completionTokens += completionTokens;
    bucket.totalTokens += totalTokens;
    bucket.estimatedCost += estimatedCost;
    stats.total.promptTokens += promptTokens;
    stats.total.completionTokens += completionTokens;
    stats.total.totalTokens += totalTokens;
    stats.total.estimatedCost += estimatedCost;
  };

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
      addTokenStats(dateKey, 'pro', data);
      return;
    }
    if (userType === 'free') {
      freeEventsByDay.set(dateKey, (freeEventsByDay.get(dateKey) || 0) + 1);
      if (!freeUsersByDay.has(dateKey)) freeUsersByDay.set(dateKey, new Set());
      if (uid) freeUsersByDay.get(dateKey).add(uid);
      addTokenStats(dateKey, 'free', data);
      return;
    }
    if (userType === 'anonymous') {
      anonymousEventsByDay.set(dateKey, (anonymousEventsByDay.get(dateKey) || 0) + 1);
      if (!anonymousClientsByDay.has(dateKey)) anonymousClientsByDay.set(dateKey, new Set());
      if (clientHash) anonymousClientsByDay.get(dateKey).add(clientHash);
      addTokenStats(dateKey, 'anonymous', data);
    }
  });

  return {
    proByDay,
    freeEventsByDay,
    anonymousEventsByDay,
    proUsersByDay,
    freeUsersByDay,
    anonymousClientsByDay,
    tokenStatsByDay
  };
}

async function listOfficialApiEvents(dateKeys) {
  requireFirebaseAdmin();
  const snapshot = await db.collection('officialApiEvents')
    .where('dateKey', '>=', dateKeys[0])
    .where('dateKey', '<=', dateKeys[dateKeys.length - 1])
    .get();
  const allowed = new Set(dateKeys);
  const rows = [];
  snapshot.forEach((doc) => {
    const data = doc.data() || {};
    const dateKey = String(data.dateKey || '').trim();
    if (!allowed.has(dateKey)) return;
    const cost = getOfficialApiEventCost(data);
    rows.push({
      id: doc.id,
      dateKey,
      uid: String(data.uid || ''),
      clientHash: String(data.clientHash || ''),
      userType: String(data.userType || '').trim() || 'free',
      locale: String(data.locale || ''),
      model: String(data.upstreamModel || data.model || ''),
      upstreamStatus: Math.max(0, Number(data.upstreamStatus) || 0),
      queryPreview: String(data.queryPreview || ''),
      queryText: String(data.queryText || ''),
      queryHash: String(data.queryHash || ''),
      requestIp: String(data.requestIp || ''),
      requestRegion: String(data.requestRegion || '') || getIpRegionLabel(data.requestIp),
      userAgent: String(data.userAgent || ''),
      promptTokens: Math.max(0, Number(data.promptTokens) || 0),
      completionTokens: Math.max(0, Number(data.completionTokens) || 0),
      totalTokens: Math.max(0, Number(data.totalTokens) || 0),
      officialEstimatedCost: Math.max(0, Number(cost.officialEstimatedCost) || 0),
      estimatedCost: Math.max(0, Number(cost.estimatedCost) || 0),
      costMultiplier: Math.max(0, Number(cost.costMultiplier) || officialAgentCostMultiplier),
      currency: String(data.currency || officialAgentCostCurrency || 'usd'),
      extensionVersion: String(data.extensionVersion || ''),
      createdAt: timestampToIso(data.createdAt)
    });
  });
  return rows;
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

function roundCost(value) {
  return Number((Number(value) || 0).toFixed(8));
}

function createUsageTokenBucket(stats = {}) {
  return {
    promptTokens: Math.max(0, Math.round(Number(stats.promptTokens) || 0)),
    completionTokens: Math.max(0, Math.round(Number(stats.completionTokens) || 0)),
    totalTokens: Math.max(0, Math.round(Number(stats.totalTokens) || 0)),
    estimatedCost: roundCost(stats.estimatedCost)
  };
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
    const tokenStats = events.tokenStatsByDay.get(dateKey) || {};
    const freeTokens = createUsageTokenBucket(tokenStats.free);
    const proTokens = createUsageTokenBucket(tokenStats.pro);
    const anonymousTokens = createUsageTokenBucket(tokenStats.anonymous);
    const totalTokens = createUsageTokenBucket(tokenStats.total);
    return {
      date: dateKey,
      free: { requests: freeRequests, activeUsers: freeUsers.size, userIds: Array.from(freeUsers), ...freeTokens },
      pro: { requests: proRequests, activeUsers: proUsers.size, userIds: Array.from(proUsers), ...proTokens },
      anonymous: { requests: anonymousRequests, activeUsers: anonymousClients.size, clientIds: Array.from(anonymousClients), ...anonymousTokens },
      totalRequests: freeRequests + proRequests + anonymousRequests,
      promptTokens: totalTokens.promptTokens,
      completionTokens: totalTokens.completionTokens,
      totalTokens: totalTokens.totalTokens,
      estimatedCost: totalTokens.estimatedCost,
      currency: officialAgentCostCurrency,
      activeUsers: activeUsers.size,
      activeAnonymousClients: anonymousClients.size
    };
  });
}

function summarizeUsageRange(days) {
  const summary = days.reduce((acc, item) => {
    acc.totalRequests += item.totalRequests;
    acc.promptTokens += item.promptTokens || 0;
    acc.completionTokens += item.completionTokens || 0;
    acc.totalTokens += item.totalTokens || 0;
    acc.estimatedCost += item.estimatedCost || 0;
    acc.free.requests += item.free.requests;
    acc.free.promptTokens += item.free.promptTokens || 0;
    acc.free.completionTokens += item.free.completionTokens || 0;
    acc.free.totalTokens += item.free.totalTokens || 0;
    acc.free.estimatedCost += item.free.estimatedCost || 0;
    acc.pro.requests += item.pro.requests;
    acc.pro.promptTokens += item.pro.promptTokens || 0;
    acc.pro.completionTokens += item.pro.completionTokens || 0;
    acc.pro.totalTokens += item.pro.totalTokens || 0;
    acc.pro.estimatedCost += item.pro.estimatedCost || 0;
    acc.anonymous.requests += item.anonymous.requests;
    acc.anonymous.promptTokens += item.anonymous.promptTokens || 0;
    acc.anonymous.completionTokens += item.anonymous.completionTokens || 0;
    acc.anonymous.totalTokens += item.anonymous.totalTokens || 0;
    acc.anonymous.estimatedCost += item.anonymous.estimatedCost || 0;
    for (const uid of item.free.userIds || []) acc.free.userIds.add(uid);
    for (const uid of item.pro.userIds || []) acc.pro.userIds.add(uid);
    for (const clientHash of item.anonymous.clientIds || []) acc.anonymous.clientIds.add(clientHash);
    return acc;
  }, {
    totalRequests: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    estimatedCost: 0,
    free: { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0, userIds: new Set() },
    pro: { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0, userIds: new Set() },
    anonymous: { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0, clientIds: new Set() }
  });
  const activeUsers = mergeSetValues(summary.free.userIds, summary.pro.userIds);
  return {
    totalRequests: summary.totalRequests,
    promptTokens: Math.round(summary.promptTokens),
    completionTokens: Math.round(summary.completionTokens),
    totalTokens: Math.round(summary.totalTokens),
    estimatedCost: roundCost(summary.estimatedCost),
    currency: officialAgentCostCurrency,
    free: { requests: summary.free.requests, activeUsers: summary.free.userIds.size, ...createUsageTokenBucket(summary.free) },
    pro: { requests: summary.pro.requests, activeUsers: summary.pro.userIds.size, ...createUsageTokenBucket(summary.pro) },
    anonymous: { requests: summary.anonymous.requests, activeUsers: summary.anonymous.clientIds.size, ...createUsageTokenBucket(summary.anonymous) },
    activeUsers: activeUsers.size,
    activeAnonymousClients: summary.anonymous.clientIds.size
  };
}

function createEmptyApiCostSummary() {
  return {
    totalRequests: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    officialEstimatedCost: 0,
    estimatedCost: 0,
    costPerRequest: 0,
    costPerMillionTokens: 0,
    activeUsers: 0,
    activeAnonymousClients: 0,
    userIds: new Set(),
    clientIds: new Set()
  };
}

function finalizeApiCostSummary(summary = {}) {
  const totalRequests = Math.max(0, Math.round(Number(summary.totalRequests) || 0));
  const totalTokens = Math.max(0, Math.round(Number(summary.totalTokens) || 0));
  const activeUsers = summary.userIds instanceof Set ? summary.userIds.size : Math.max(0, Number(summary.activeUsers) || 0);
  const activeAnonymousClients = summary.clientIds instanceof Set ? summary.clientIds.size : Math.max(0, Number(summary.activeAnonymousClients) || 0);
  const estimatedCost = roundCost(summary.estimatedCost);
  return {
    totalRequests,
    promptTokens: Math.max(0, Math.round(Number(summary.promptTokens) || 0)),
    completionTokens: Math.max(0, Math.round(Number(summary.completionTokens) || 0)),
    totalTokens,
    officialEstimatedCost: roundCost(summary.officialEstimatedCost),
    estimatedCost,
    costPerRequest: roundCost(estimatedCost / Math.max(1, totalRequests)),
    costPerMillionTokens: roundCost(totalTokens > 0 ? estimatedCost / (totalTokens / 1000000) : 0),
    activeUsers,
    activeAnonymousClients
  };
}

function addApiCostRow(summary, row = {}) {
  summary.totalRequests += 1;
  summary.promptTokens += Number(row.promptTokens || 0);
  summary.completionTokens += Number(row.completionTokens || 0);
  summary.totalTokens += Number(row.totalTokens || 0);
  summary.officialEstimatedCost += Number(row.officialEstimatedCost || 0);
  summary.estimatedCost += Number(row.estimatedCost || 0);
  if (row.uid) summary.userIds.add(row.uid);
  if (row.clientHash) summary.clientIds.add(row.clientHash);
}

async function getApiCostSummaryData(req) {
  const days = clamp(parseInteger(req.query?.days, 30), 1, 90);
  const dateKeys = getRecentDateKeys(days);
  const rows = await listOfficialApiEvents(dateKeys);
  const todayKey = dateKeys[dateKeys.length - 1];
  const summarizeRows = (items) => {
    const summary = createEmptyApiCostSummary();
    items.forEach((row) => addApiCostRow(summary, row));
    return finalizeApiCostSummary(summary);
  };
  return {
    currency: officialAgentCostCurrency,
    costMultiplier: officialAgentCostMultiplier,
    officialInputTokenPricePerMillion: officialAgentInputTokenPricePerMillion,
    officialOutputTokenPricePerMillion: officialAgentOutputTokenPricePerMillion,
    today: summarizeRows(rows.filter((row) => row.dateKey === todayKey)),
    last7Days: summarizeRows(rows.filter((row) => dateKeys.slice(-7).includes(row.dateKey))),
    last30Days: summarizeRows(rows)
  };
}

async function getApiCostTrendData(req) {
  const days = clamp(parseInteger(req.query?.days, 30), 1, 90);
  const dateKeys = getRecentDateKeys(days);
  const rows = await listOfficialApiEvents(dateKeys);
  const byDate = new Map(dateKeys.map((dateKey) => [dateKey, createEmptyApiCostSummary()]));
  rows.forEach((row) => {
    if (!byDate.has(row.dateKey)) return;
    addApiCostRow(byDate.get(row.dateKey), row);
  });
  return {
    currency: officialAgentCostCurrency,
    costMultiplier: officialAgentCostMultiplier,
    days: sortDateRowsDescending(dateKeys.map((dateKey) => ({
      date: dateKey,
      ...finalizeApiCostSummary(byDate.get(dateKey))
    })))
  };
}

async function getApiCostByModelData(req) {
  const days = clamp(parseInteger(req.query?.days, 30), 1, 90);
  const limit = clamp(parseInteger(req.query?.limit, 30), 1, 100);
  const rows = await listOfficialApiEvents(getRecentDateKeys(days));
  const byModel = new Map();
  rows.forEach((row) => {
    const model = row.model || 'unknown';
    if (!byModel.has(model)) byModel.set(model, createEmptyApiCostSummary());
    addApiCostRow(byModel.get(model), row);
  });
  return {
    currency: officialAgentCostCurrency,
    costMultiplier: officialAgentCostMultiplier,
    models: Array.from(byModel.entries())
      .map(([model, summary]) => ({ model, ...finalizeApiCostSummary(summary) }))
      .sort((left, right) => right.estimatedCost - left.estimatedCost)
      .slice(0, limit)
  };
}

async function getApiUsageSummaryData() {
  const trend30 = await buildUsageTrend(30);
  const today = trend30[trend30.length - 1] || createEmptyUsageDay(getTodayKey());
  const last7Days = summarizeUsageRange(trend30.slice(-7));
  const last30Days = summarizeUsageRange(trend30);
  return { today, last7Days, last30Days };
}

function serializeSiteCompareEventDoc(doc) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    clientEventId: String(data.clientEventId || ''),
    dateKey: String(data.dateKey || ''),
    uploaderType: data.uploaderType === 'anonymous' ? 'anonymous' : 'user',
    uid: String(data.uid || ''),
    clientHash: String(data.clientHash || ''),
    source: String(data.source || ''),
    siteNames: normalizeSiteUsageNames(data.siteNames),
    officialSiteNames: normalizeSiteUsageNames(data.officialSiteNames),
    customSiteNames: normalizeSiteUsageNames(data.customSiteNames),
    agentIds: normalizeSiteUsageNames(data.agentIds, 20),
    siteCount: Math.max(0, Number(data.siteCount) || 0),
    officialSiteCount: Math.max(0, Number(data.officialSiteCount) || 0),
    customSiteCount: Math.max(0, Number(data.customSiteCount) || 0),
    agentCount: Math.max(0, Number(data.agentCount) || 0),
    siteCombinationKey: String(data.siteCombinationKey || BehaviorInsights.createSiteCombinationKey({
      siteNames: data.siteNames,
      officialSiteNames: data.officialSiteNames,
      customSiteNames: data.customSiteNames,
      agentIds: data.agentIds
    }) || ''),
    workflowMode: String(data.workflowMode || ''),
    resultState: String(data.resultState || ''),
    successCount: Math.max(0, Number(data.successCount) || 0),
    failureCount: Math.max(0, Number(data.failureCount) || 0),
    extractableCount: Math.max(0, Number(data.extractableCount) || 0),
    latencyMs: Math.max(0, Number(data.latencyMs) || 0),
    failurePhase: String(data.failurePhase || ''),
    failureTarget: String(data.failureTarget || ''),
    hasQuery: data.hasQuery === true,
    queryLength: Math.max(0, Number(data.queryLength) || 0),
    queryPreview: String(data.queryPreview || ''),
    queryText: String(data.queryText || ''),
    queryHash: String(data.queryHash || ''),
    requestIp: String(data.requestIp || ''),
    requestRegion: String(data.requestRegion || '') || getIpRegionLabel(data.requestIp),
    userAgent: String(data.userAgent || ''),
    locale: String(data.locale || ''),
    extensionVersion: String(data.extensionVersion || ''),
    createdAt: timestampToIso(data.createdAt),
    updatedAt: timestampToIso(data.updatedAt)
  };
}

async function listSiteCompareEvents(dateKeys) {
  requireFirebaseAdmin();
  const snapshot = await db.collection('siteCompareEvents')
    .where('dateKey', '>=', dateKeys[0])
    .where('dateKey', '<=', dateKeys[dateKeys.length - 1])
    .get();
  const allowed = new Set(dateKeys);
  const rows = [];
  snapshot.forEach((doc) => {
    const row = serializeSiteCompareEventDoc(doc);
    if (allowed.has(row.dateKey)) rows.push(row);
  });
  return rows;
}

function summarizeSiteUsageRows(rows, dateKey = '') {
  const filtered = dateKey ? rows.filter((row) => row.dateKey === dateKey) : rows;
  const userIds = new Set();
  const anonymousClientIds = new Set();
  const siteCounts = new Map();
  let totalSiteLaunches = 0;
  let withQueryEvents = 0;
  filtered.forEach((row) => {
    if (row.uid) userIds.add(row.uid);
    if (row.clientHash) anonymousClientIds.add(row.clientHash);
    if (row.hasQuery) withQueryEvents += 1;
    row.siteNames.forEach((siteName) => {
      totalSiteLaunches += 1;
      siteCounts.set(siteName, (siteCounts.get(siteName) || 0) + 1);
    });
    row.agentIds.forEach((agentId) => {
      const agentName = `Agent: ${agentId}`;
      totalSiteLaunches += 1;
      siteCounts.set(agentName, (siteCounts.get(agentName) || 0) + 1);
    });
  });
  const topSite = Array.from(siteCounts.entries()).sort((left, right) => right[1] - left[1])[0];
  return {
    totalEvents: filtered.length,
    totalSiteLaunches,
    uniqueSites: siteCounts.size,
    activeUsers: userIds.size,
    activeAnonymousClients: anonymousClientIds.size,
    activeTotal: userIds.size + anonymousClientIds.size,
    withQueryEvents,
    topSite: topSite ? `${topSite[0]} (${topSite[1]})` : ''
  };
}

async function getSiteUsageSummaryData() {
  const dateKeys = getRecentDateKeys(30);
  const rows = await listSiteCompareEvents(dateKeys);
  const todayKey = dateKeys[dateKeys.length - 1];
  return {
    today: summarizeSiteUsageRows(rows, todayKey),
    last7Days: summarizeSiteUsageRows(rows.filter((row) => dateKeys.slice(-7).includes(row.dateKey))),
    last30Days: summarizeSiteUsageRows(rows),
    versionDistribution: summarizeVersionDistribution(rows.filter((row) => dateKeys.slice(-7).includes(row.dateKey)), 20),
    topCombinations: rankSiteCombinations(rows, 20)
  };
}

async function getSiteUsageTrendData(req) {
  const days = clamp(parseInteger(req.query?.days, 30), 1, 90);
  const dateKeys = getRecentDateKeys(days);
  const rows = await listSiteCompareEvents(dateKeys);
  return {
    days: sortDateRowsDescending(dateKeys.map((dateKey) => ({
      date: dateKey,
      ...summarizeSiteUsageRows(rows, dateKey)
    })))
  };
}

async function getSiteUsageTopSitesData(req) {
  const days = clamp(parseInteger(req.query?.days, 30), 1, 90);
  const limit = clamp(parseInteger(req.query?.limit, 30), 1, 100);
  const includeAgents = String(req.query?.includeAgents || 'true').trim() !== 'false';
  const rows = await listSiteCompareEvents(getRecentDateKeys(days));
  const bySite = new Map();
  rows.forEach((row) => {
    const allNames = includeAgents
      ? [...row.siteNames, ...row.agentIds.map((agentId) => `Agent: ${agentId}`)]
      : [...row.siteNames];
    allNames.forEach((siteName) => {
      const current = bySite.get(siteName) || {
        siteName,
        launches: 0,
        eventIds: new Set(),
        userIds: new Set(),
        clientIds: new Set(),
        withQueryEvents: 0
      };
      current.launches += 1;
      current.eventIds.add(row.id);
      if (row.uid) current.userIds.add(row.uid);
      if (row.clientHash) current.clientIds.add(row.clientHash);
      if (row.hasQuery) current.withQueryEvents += 1;
      bySite.set(siteName, current);
    });
  });
  return {
    sites: Array.from(bySite.values())
      .map((item) => ({
        siteName: item.siteName,
        launches: item.launches,
        events: item.eventIds.size,
        activeUsers: item.userIds.size,
        activeAnonymousClients: item.clientIds.size,
        withQueryEvents: item.withQueryEvents
      }))
      .sort((left, right) => right.launches - left.launches)
      .slice(0, limit)
  };
}

async function getSiteUsageRecentData(req) {
  const days = clamp(parseInteger(req.query?.days, 7), 1, 90);
  const limit = clamp(parseInteger(req.query?.limit, 50), 1, 200);
  const rows = await listSiteCompareEvents(getRecentDateKeys(days));
  rows.sort((left, right) => {
    const rightTs = Date.parse(right.createdAt || right.updatedAt || 0) || 0;
    const leftTs = Date.parse(left.createdAt || left.updatedAt || 0) || 0;
    return rightTs - leftTs;
  });
  return {
    events: rows.slice(0, limit)
  };
}

function createEmptyCombinedUsageSummary() {
  return {
    apiRequests: 0,
    siteEvents: 0,
    siteLaunches: 0,
    totalTokens: 0,
    estimatedCost: 0,
    currency: officialAgentCostCurrency,
    activeUsers: 0,
    activeAnonymousClients: 0,
    topSite: ''
  };
}

function getApiUsageIdentitySets(days = []) {
  const userIds = new Set();
  const clientIds = new Set();
  days.forEach((day) => {
    for (const uid of day.free?.userIds || []) userIds.add(uid);
    for (const uid of day.pro?.userIds || []) userIds.add(uid);
    for (const clientHash of day.anonymous?.clientIds || []) clientIds.add(clientHash);
  });
  return { userIds, clientIds };
}

function getSiteUsageIdentitySets(rows = [], dateKey = '') {
  const userIds = new Set();
  const clientIds = new Set();
  rows.forEach((row) => {
    if (dateKey && row.dateKey !== dateKey) return;
    if (row.uid) userIds.add(row.uid);
    if (row.clientHash) clientIds.add(row.clientHash);
  });
  return { userIds, clientIds };
}

async function getCombinedUsageSummaryData() {
  const dateKeys = getRecentDateKeys(7);
  const [apiTrend, siteRows, apiRows] = await Promise.all([
    buildUsageTrend(7),
    listSiteCompareEvents(dateKeys),
    listOfficialApiEvents(dateKeys)
  ]);
  const siteTrend = dateKeys.map((dateKey) => summarizeSiteUsageRows(siteRows, dateKey));
  const todayApi = apiTrend[apiTrend.length - 1] || createEmptyUsageDay(getTodayKey());
  const todaySite = siteTrend[siteTrend.length - 1] || summarizeSiteUsageRows([], getTodayKey());
  const last7Api = summarizeUsageRange(apiTrend);
  const last7Site = summarizeSiteUsageRows(siteRows);
  const todayApiIdentities = getApiUsageIdentitySets([todayApi]);
  const todaySiteIdentities = getSiteUsageIdentitySets(siteRows, dateKeys[dateKeys.length - 1]);
  const last7ApiIdentities = getApiUsageIdentitySets(apiTrend);
  const last7SiteIdentities = getSiteUsageIdentitySets(siteRows);
  return {
    today: {
      ...createEmptyCombinedUsageSummary(),
      apiRequests: todayApi.totalRequests,
      siteEvents: todaySite.totalEvents,
      siteLaunches: todaySite.totalSiteLaunches,
      totalTokens: todayApi.totalTokens,
      estimatedCost: todayApi.estimatedCost,
      currency: todayApi.currency || officialAgentCostCurrency,
      activeUsers: mergeSetValues(todayApiIdentities.userIds, todaySiteIdentities.userIds).size,
      activeAnonymousClients: mergeSetValues(todayApiIdentities.clientIds, todaySiteIdentities.clientIds).size,
      topSite: todaySite.topSite
    },
    last7Days: {
      ...createEmptyCombinedUsageSummary(),
      apiRequests: last7Api.totalRequests,
      siteEvents: last7Site.totalEvents,
      siteLaunches: last7Site.totalSiteLaunches,
      totalTokens: last7Api.totalTokens,
      estimatedCost: last7Api.estimatedCost,
      currency: last7Api.currency || officialAgentCostCurrency,
      activeUsers: mergeSetValues(last7ApiIdentities.userIds, last7SiteIdentities.userIds).size,
      activeAnonymousClients: mergeSetValues(last7ApiIdentities.clientIds, last7SiteIdentities.clientIds).size,
      topSite: last7Site.topSite
    },
    versionDistribution: summarizeVersionDistribution([...apiRows, ...siteRows], 20)
  };
}

async function getCombinedUsageTrendData(req) {
  const days = clamp(parseInteger(req.query?.days, 7), 1, 7);
  const dateKeys = getRecentDateKeys(days);
  const [apiTrend, siteRows] = await Promise.all([
    buildUsageTrend(days),
    listSiteCompareEvents(dateKeys)
  ]);
  return {
    days: sortDateRowsDescending(dateKeys.map((dateKey, index) => {
      const apiDay = apiTrend[index] || createEmptyUsageDay(dateKey);
      const siteDay = summarizeSiteUsageRows(siteRows, dateKey);
      const apiIdentities = getApiUsageIdentitySets([apiDay]);
      const siteIdentities = getSiteUsageIdentitySets(siteRows, dateKey);
      return {
        date: dateKey,
        apiRequests: apiDay.totalRequests || 0,
        siteEvents: siteDay.totalEvents || 0,
        siteLaunches: siteDay.totalSiteLaunches || 0,
        uniqueSites: siteDay.uniqueSites || 0,
        totalTokens: apiDay.totalTokens || 0,
        estimatedCost: apiDay.estimatedCost || 0,
        currency: apiDay.currency || officialAgentCostCurrency,
        activeUsers: mergeSetValues(apiIdentities.userIds, siteIdentities.userIds).size,
        activeAnonymousClients: mergeSetValues(apiIdentities.clientIds, siteIdentities.clientIds).size,
        topSite: siteDay.topSite || ''
      };
    }))
  };
}

async function getCombinedUsageTopTargetsData(req) {
  const days = clamp(parseInteger(req.query?.days, 7), 1, 7);
  const limit = clamp(parseInteger(req.query?.limit, 30), 1, 100);
  const dateKeys = getRecentDateKeys(days);
  const [apiRows, sitePayload] = await Promise.all([
    listOfficialApiEvents(dateKeys),
    getSiteUsageTopSitesData({ query: { days, limit } })
  ]);
  const apiByModel = new Map();
  apiRows.forEach((row) => {
    const target = row.model || 'official API';
    const current = apiByModel.get(target) || {
      kind: 'api',
      target,
      count: 0,
      totalTokens: 0,
      userIds: new Set(),
      clientIds: new Set()
    };
    current.count += 1;
    current.totalTokens += row.totalTokens || 0;
    if (row.uid) current.userIds.add(row.uid);
    if (row.clientHash) current.clientIds.add(row.clientHash);
    apiByModel.set(target, current);
  });
  const apiTargets = Array.from(apiByModel.values()).map((item) => ({
    kind: 'api',
    target: item.target,
    count: item.count,
    totalTokens: Math.round(item.totalTokens),
    activeUsers: item.userIds.size,
    activeAnonymousClients: item.clientIds.size,
    withQueryEvents: 0
  }));
  const siteTargets = (sitePayload.sites || []).map((item) => ({
    kind: 'site',
    target: item.siteName,
    count: item.launches,
    totalTokens: 0,
    activeUsers: item.activeUsers,
    activeAnonymousClients: item.activeAnonymousClients,
    withQueryEvents: item.withQueryEvents
  }));
  return {
    targets: [...apiTargets, ...siteTargets]
      .sort((left, right) => right.count - left.count)
      .slice(0, limit)
  };
}

function getUsageRecentIdentityKey(event = {}) {
  return String(event.uid || event.deviceId || event.userType || '').trim().toLowerCase();
}

function getUsageRecentQueryKey(event = {}) {
  return String(event.queryHash || event.queryPreview || '').trim().toLowerCase();
}

function getUsageRecentDedupeKey(event = {}) {
  return [
    event.kind || '',
    event.usageType || '',
    event.target || '',
    getUsageRecentIdentityKey(event),
    getUsageRecentQueryKey(event)
  ].join('|');
}

function dedupeRecentUsageEvents(events = []) {
  const merged = [];
  const byKey = new Map();
  const duplicateWindowMs = 2 * 60 * 1000;
  events.forEach((event) => {
    const timestamp = Date.parse(event.createdAt || 0) || 0;
    const queryKey = getUsageRecentQueryKey(event);
    const key = getUsageRecentDedupeKey(event);
    const existing = queryKey ? byKey.get(key) : null;
    const existingTimestamp = Date.parse(existing?.createdAt || 0) || 0;
    if (existing && Math.abs(existingTimestamp - timestamp) <= duplicateWindowMs) {
      existing.repeatCount = Math.max(1, Number(existing.repeatCount) || 1) + 1;
      existing.firstSeenAt = event.createdAt || existing.firstSeenAt || existing.createdAt;
      existing.lastSeenAt = existing.createdAt || event.createdAt || existing.lastSeenAt;
      const detailParts = new Set(String(existing.detail || '').split(' · ').filter(Boolean));
      String(event.detail || '').split(' · ').filter(Boolean).forEach((part) => detailParts.add(part));
      existing.detail = Array.from(detailParts).join(' · ');
      return;
    }
    const nextEvent = {
      ...event,
      repeatCount: 1,
      firstSeenAt: event.createdAt || '',
      lastSeenAt: event.createdAt || ''
    };
    merged.push(nextEvent);
    if (queryKey) byKey.set(key, nextEvent);
  });
  return merged;
}

async function getCombinedUsageRecentData(req) {
  const days = clamp(parseInteger(req.query?.days, 7), 1, 7);
  const limit = clamp(parseInteger(req.query?.limit, 100), 1, 200);
  const dateKeys = getRecentDateKeys(days);
  const [apiRows, siteRows, userDirectory] = await Promise.all([
    listOfficialApiEvents(dateKeys),
    listSiteCompareEvents(dateKeys),
    getUserDirectory()
  ]);
  const getUserInfo = (uid = '') => {
    const user = uid ? userDirectory.get(uid) : null;
    return {
      uid: String(uid || ''),
      email: String(user?.email || '')
    };
  };
  const getSiteUsageType = (row) => {
    if (row.agentCount > 0 && row.siteCount === 0) return '技能';
    if (row.siteCount + row.agentCount > 1) return '对比';
    if (row.hasQuery) return '单站查询';
    return '打开';
  };
  const inferApiUsageType = (row) => {
    const text = String(row.queryPreview || '').toLowerCase();
    if (/(总结|概括|归纳|提炼|汇总|summary|summari[sz]e|recap|brief)/i.test(text)) return '总结';
    if (/(翻译|translate|translation|译成|英译|中译)/i.test(text)) return '翻译';
    if (/(写|改写|润色|文案|邮件|标题|copywrite|rewrite|polish|email|title)/i.test(text)) return '写作';
    if (/(代码|编程|函数|脚本|bug|报错|debug|code|program|function|script)/i.test(text)) return '代码';
    if (/(分析|对比|比较|评估|analysis|compare|versus|evaluate)/i.test(text)) return '分析';
    if (/(生成|制作|创建|generate|create|make)/i.test(text)) return '生成';
    return '问答';
  };
  const events = [
    ...apiRows.map((row) => {
      const user = getUserInfo(row.uid);
      return {
        kind: 'api',
        usageType: inferApiUsageType(row),
        createdAt: row.createdAt,
        target: row.model || 'official API',
        siteNames: [],
        skillNames: [],
        userType: row.userType === 'anonymous' ? '匿名' : (row.userType === 'pro' ? 'Pro' : '免费'),
        uid: user.uid,
        email: user.email,
        deviceId: row.clientHash || '',
        requestIp: row.requestIp || '',
        requestRegion: row.requestRegion || '',
        locale: row.locale || '',
        queryPreview: row.queryPreview || '',
        queryText: row.queryText || '',
        queryHash: row.queryHash || '',
        detail: [
          row.upstreamStatus ? `HTTP ${row.upstreamStatus}` : '',
          row.totalTokens ? `${Math.round(row.totalTokens)} tokens` : '',
          row.locale || ''
        ].filter(Boolean).join(' · '),
        extensionVersion: row.extensionVersion || ''
      };
    }),
    ...siteRows.map((row) => {
      const user = getUserInfo(row.uid);
      return {
        kind: 'site',
        usageType: getSiteUsageType(row),
        createdAt: row.createdAt || row.updatedAt,
        target: [...row.siteNames, ...row.agentIds.map((agentId) => `Agent: ${agentId}`)].join(', ') || '站点对比',
        siteNames: row.siteNames,
        skillNames: row.agentIds,
        userType: row.uploaderType === 'anonymous' ? '匿名' : '登录用户',
        uid: user.uid,
        email: user.email,
        deviceId: row.clientHash || '',
        requestIp: row.requestIp || '',
        requestRegion: row.requestRegion || '',
        locale: row.locale || '',
        queryPreview: row.queryPreview || '',
        queryText: row.queryText || '',
        queryHash: row.queryHash || '',
        detail: [
          `${row.siteCount + row.agentCount} 个目标`,
          row.hasQuery ? '带 query' : '仅打开',
          row.locale || ''
        ].filter(Boolean).join(' · '),
        extensionVersion: row.extensionVersion || ''
      };
    })
  ].sort((left, right) => {
    const rightTs = Date.parse(right.createdAt || 0) || 0;
    const leftTs = Date.parse(left.createdAt || 0) || 0;
    return rightTs - leftTs;
  });
  const dedupedEvents = dedupeRecentUsageEvents(events);
  return {
    events: dedupedEvents.slice(0, limit)
  };
}

const queryInsightTypeLabels = {
  shopping_research: '选购/产品研究',
  fact_check: '事实核查',
  how_to: '操作教程',
  api_tooling: 'API/工具接入',
  writing_summary: '总结/写作',
  coding_debug: '代码/调试',
  policy_legal: '政策/合规',
  business_marketing: '商业/营销',
  learning: '学习/解释',
  life_travel: '生活/出行',
  other: '其他'
};

function normalizeQueryInsightType(value = '') {
  const key = String(value || '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_');
  return queryInsightTypeLabels[key] ? key : 'other';
}

function extractUserQueryForInsight(text = '') {
  const source = String(text || '').replace(/\s+/g, ' ').trim();
  if (!source) return '';
  const questionMatch = source.match(/问题[:：]\s*([\s\S]*?)(?:\s+汇总结果[:：]|\s+各站原始答案[:：]|$)/);
  if (questionMatch?.[1]) {
    return safeLogString(questionMatch[1], 1200);
  }
  return safeLogString(source, 1200);
}

function getInsightSourceQuery(row = {}) {
  return extractUserQueryForInsight(row.queryText || row.queryPreview || '');
}

function getInsightDocId(queryText = '') {
  return createSha256Hash(String(queryText || '').trim().toLowerCase());
}

function getWeekKey(dateKey = '') {
  const date = new Date(`${dateKey || getTodayKey()}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return String(dateKey || '');
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

function createEmptyQueryInsightAnalysis(queryHash = '', queryText = '') {
  return {
    queryHash,
    queryText: safeLogString(queryText, 1200),
    queryType: 'other',
	    queryTypeLabel: queryInsightTypeLabels.other,
	    taskCategory: 'other',
	    audience: 'unknown',
	    useCase: 'unknown',
	    domain: '未知',
    intent: '未知',
    userRole: '未知',
    needSummary: '未知',
    universality: 'medium',
    marketingCaseFit: 'maybe',
    marketingAngle: '',
    confidence: 0,
    reason: '未分析',
    tags: [],
    analyzed: false
  };
}

function normalizeQueryInsightAnalysis(queryHash, queryText, payload = {}) {
  const queryType = normalizeQueryInsightType(payload.queryType || payload.type);
  const tags = Array.isArray(payload.tags) ? payload.tags : [];
	  return {
	    queryHash,
	    queryText: safeLogString(queryText, 1200),
	    queryType,
	    queryTypeLabel: queryInsightTypeLabels[queryType],
	    taskCategory: safeLogString(payload.taskCategory || payload.task || payload.queryType || queryType, 80) || 'other',
	    audience: safeLogString(payload.audience || payload.userSegment || payload.userRole || payload.persona || '', 120) || 'unknown',
	    useCase: safeLogString(payload.useCase || payload.scenario || payload.intent || '', 160) || 'unknown',
	    domain: safeLogString(payload.domain || '', 80) || '未知',
    intent: safeLogString(payload.intent || '', 120) || '未知',
    userRole: safeLogString(payload.userRole || payload.persona || '', 120) || '未知',
    needSummary: safeLogString(payload.needSummary || payload.need || '', 180) || '未知',
    universality: ['high', 'medium', 'low'].includes(String(payload.universality || '').toLowerCase())
      ? String(payload.universality).toLowerCase()
      : 'medium',
    marketingCaseFit: ['yes', 'maybe', 'no'].includes(String(payload.marketingCaseFit || '').toLowerCase())
      ? String(payload.marketingCaseFit).toLowerCase()
      : 'maybe',
    marketingAngle: safeLogString(payload.marketingAngle || '', 220),
    confidence: Math.max(0, Math.min(1, Number(payload.confidence) || 0)),
    reason: safeLogString(payload.reason || '', 260),
    tags: tags.map((tag) => safeLogString(tag, 40)).filter(Boolean).slice(0, 8),
    analyzed: true
  };
}

function extractJsonObject(text = '') {
  const source = String(text || '').trim();
  try {
    return JSON.parse(source);
  } catch (_) {
    const match = source.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON object found in OpenRouter response');
    return JSON.parse(match[0]);
  }
}

async function classifyQueryWithOpenRouter(queryText) {
  if (!openRouterApiKey) {
    const error = new Error('OPENROUTER_API_KEY is not configured');
    error.status = 400;
    throw error;
  }
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openRouterApiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://aicompare.club',
      'X-Title': 'AI Compare Admin Query Insights'
    },
    body: JSON.stringify({
      model: openRouterClassifierModel,
      messages: [
        {
          role: 'system',
	          content: [
	            '你是一个 SaaS 产品运营分析助手。请只输出 JSON，不要输出 Markdown。',
	            '从用户 Query 判断真实任务、用户画像、使用场景、需求普遍性，以及是否适合做 AI Compare 插件营销案例。',
	            'queryType 只能从这些枚举中选择：shopping_research, fact_check, how_to, api_tooling, writing_summary, coding_debug, policy_legal, business_marketing, learning, life_travel, other。',
	            'taskCategory 尽量从这些枚举中选择：quick_answer, translation, writing, research, coding, brand_geo, image_video, content_review, purchase_decision, other。',
	            'universality 只能是 high/medium/low；marketingCaseFit 只能是 yes/maybe/no；confidence 为 0 到 1。'
	          ].join('\n')
	        },
        {
          role: 'user',
	          content: `请分析这个 Query：\n${safeLogString(queryText, 1200)}\n\n输出 JSON 字段：queryType, taskCategory, audience, useCase, domain, intent, userRole, needSummary, universality, marketingCaseFit, marketingAngle, confidence, reason, tags。`
	        }
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' }
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || `OpenRouter request failed: HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  const content = data?.choices?.[0]?.message?.content || '';
  return extractJsonObject(content);
}

async function collectQueryInsightSourceEvents(dateKeys) {
  const [apiRows, siteRows] = await Promise.all([
    listOfficialApiEvents(dateKeys),
    listSiteCompareEvents(dateKeys)
  ]);
  const rows = [
    ...apiRows.map((row) => ({ ...row, sourceKind: 'api', sourceId: row.id })),
    ...siteRows.map((row) => ({ ...row, sourceKind: 'site', sourceId: row.id }))
  ];
  return rows
    .map((row) => {
      const queryText = getInsightSourceQuery(row);
      if (!queryText || queryText.length < 4) return null;
      const queryHash = row.queryHash || getInsightDocId(queryText);
      return {
        sourceKind: row.sourceKind,
        sourceId: row.sourceId,
        dateKey: row.dateKey,
        createdAt: row.createdAt || row.updatedAt || '',
        queryHash,
        insightId: getInsightDocId(queryText),
        queryText,
        uid: row.uid || '',
        clientHash: row.clientHash || '',
        target: row.model || (row.siteNames || []).join(', ') || ''
      };
    })
    .filter(Boolean);
}

async function getQueryInsightAnalysisMap(insightIds = []) {
  const result = new Map();
  const uniqueIds = Array.from(new Set(insightIds.filter(Boolean)));
  for (let index = 0; index < uniqueIds.length; index += 300) {
    const chunk = uniqueIds.slice(index, index + 300);
    const refs = chunk.map((id) => db.collection('queryInsightAnalyses').doc(id));
    const snaps = await db.getAll(...refs);
    snaps.forEach((snap) => {
      if (snap.exists) result.set(snap.id, snap.data() || {});
    });
  }
  return result;
}

async function analyzeQueryInsights(req) {
  requireFirebaseAdmin();
  const days = clamp(parseInteger(req.query?.days, 7), 1, 30);
  const limit = clamp(parseInteger(req.query?.limit, queryInsightDefaultLimit), 1, 200);
  const sources = await collectQueryInsightSourceEvents(getRecentDateKeys(days));
  const uniqueByInsight = new Map();
  sources.sort((left, right) => (Date.parse(right.createdAt || 0) || 0) - (Date.parse(left.createdAt || 0) || 0));
  sources.forEach((source) => {
    if (!uniqueByInsight.has(source.insightId)) uniqueByInsight.set(source.insightId, source);
  });
  const uniqueSources = Array.from(uniqueByInsight.values());
  const existing = await getQueryInsightAnalysisMap(uniqueSources.map((item) => item.insightId));
  const candidates = uniqueSources.filter((item) => !existing.has(item.insightId)).slice(0, limit);
  let analyzed = 0;
  const skipped = Math.max(0, uniqueSources.length - candidates.length);
  const errors = [];
  for (const item of candidates) {
    try {
      const raw = await classifyQueryWithOpenRouter(item.queryText);
      const analysis = normalizeQueryInsightAnalysis(item.insightId, item.queryText, raw);
      await db.collection('queryInsightAnalyses').doc(item.insightId).set({
        ...analysis,
        model: openRouterClassifierModel,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      analyzed += 1;
    } catch (error) {
      errors.push(safeLogString(error.message || error, 220));
      if (errors.length >= 5) break;
    }
  }
  return {
    ok: errors.length === 0,
    analyzed,
    skipped,
    candidates: candidates.length,
    totalUniqueQueries: uniqueSources.length,
    model: openRouterClassifierModel,
    errors
  };
}

async function runQueryInsightAutoAnalysis(reason = 'timer') {
  if (!queryInsightAutoEnabled || !openRouterApiKey) return;
  if (queryInsightAutoRunning) {
    console.log('[ai-compare-backend] query insight auto analysis skipped: previous run still active');
    return;
  }
  queryInsightAutoRunning = true;
  try {
    const result = await analyzeQueryInsights({
      query: {
        days: queryInsightAutoDays,
        limit: queryInsightAutoLimit
      }
    });
    console.log('[ai-compare-backend] query insight auto analysis', JSON.stringify({
      reason,
      analyzed: result.analyzed,
      skipped: result.skipped,
      candidates: result.candidates,
      totalUniqueQueries: result.totalUniqueQueries,
      errors: result.errors?.length || 0
    }));
  } catch (error) {
    console.warn('[ai-compare-backend] query insight auto analysis failed:', error.message || error);
  } finally {
    queryInsightAutoRunning = false;
  }
}

function startQueryInsightAutoAnalysis() {
  if (!queryInsightAutoEnabled) {
    console.log('[ai-compare-backend] query insight auto analysis disabled');
    return;
  }
  if (!openRouterApiKey) {
    console.log('[ai-compare-backend] query insight auto analysis disabled: OPENROUTER_API_KEY is not configured');
    return;
  }
  setInterval(() => {
    runQueryInsightAutoAnalysis('interval').catch((error) => {
      console.warn('[ai-compare-backend] query insight auto interval failed:', error.message || error);
    });
  }, queryInsightAutoIntervalMs);
  console.log('[ai-compare-backend] query insight auto analysis scheduled', JSON.stringify({
    intervalMs: queryInsightAutoIntervalMs,
    days: queryInsightAutoDays,
    limit: queryInsightAutoLimit,
    model: openRouterClassifierModel
  }));
}

function incrementCount(map, key, amount = 1) {
  const normalizedKey = String(key || '').trim() || '未知';
  map.set(normalizedKey, (map.get(normalizedKey) || 0) + amount);
}

function topCountRows(map, limit = 10) {
  return Array.from(map.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, limit);
}

async function getQueryInsightsSummaryData(req) {
  requireFirebaseAdmin();
  const days = clamp(parseInteger(req.query?.days, 7), 1, 30);
  const dateKeys = getRecentDateKeys(days);
  const sources = await collectQueryInsightSourceEvents(dateKeys);
  const analysisMap = await getQueryInsightAnalysisMap(sources.map((source) => source.insightId));
  const dailyMap = new Map();
  const weeklyMap = new Map();
  const typeCounts = new Map();
  const domainCounts = new Map();
  const roleCounts = new Map();
  const needCounts = new Map();
  const taskCounts = new Map();
  const audienceCounts = new Map();
  const useCaseCounts = new Map();
  const tagCounts = new Map();
  const marketingCases = [];
  let analyzedEvents = 0;

  sources.forEach((source) => {
    const analysis = analysisMap.get(source.insightId) || createEmptyQueryInsightAnalysis(source.insightId, source.queryText);
    const queryType = normalizeQueryInsightType(analysis.queryType);
    const label = queryInsightTypeLabels[queryType];
    if (!dailyMap.has(source.dateKey)) dailyMap.set(source.dateKey, new Map());
    incrementCount(dailyMap.get(source.dateKey), label);
    const weekKey = getWeekKey(source.dateKey);
    if (!weeklyMap.has(weekKey)) weeklyMap.set(weekKey, new Map());
    incrementCount(weeklyMap.get(weekKey), label);
    incrementCount(typeCounts, label);
    incrementCount(domainCounts, analysis.domain || '未知');
    incrementCount(roleCounts, analysis.userRole || '未知');
    incrementCount(needCounts, analysis.needSummary || '未知');
    incrementCount(taskCounts, analysis.taskCategory || label);
    incrementCount(audienceCounts, analysis.audience || analysis.userRole || 'unknown');
    incrementCount(useCaseCounts, analysis.useCase || analysis.intent || 'unknown');
    (analysis.tags || []).forEach((tag) => incrementCount(tagCounts, tag));
    if (analysis.analyzed) analyzedEvents += 1;
    if (['yes', 'maybe'].includes(analysis.marketingCaseFit) && marketingCases.length < 12) {
      marketingCases.push({
        fit: analysis.marketingCaseFit,
        universality: analysis.universality,
        type: label,
        domain: analysis.domain,
        angle: analysis.marketingAngle || analysis.reason || '',
        queryPreview: safeLogString(source.queryText, 180),
        dateKey: source.dateKey
      });
    }
  });

  const daily = dateKeys.map((dateKey) => {
    const counts = dailyMap.get(dateKey) || new Map();
    return {
      date: dateKey,
      total: Array.from(counts.values()).reduce((sum, value) => sum + value, 0),
      types: Object.fromEntries(counts)
    };
  }).reverse();
  const weekly = Array.from(weeklyMap.entries()).map(([weekStart, counts]) => ({
    weekStart,
    total: Array.from(counts.values()).reduce((sum, value) => sum + value, 0),
    types: Object.fromEntries(counts)
  })).sort((left, right) => right.weekStart.localeCompare(left.weekStart));

  const topTypes = topCountRows(typeCounts, 10);
  const topNeeds = topCountRows(needCounts, 8);
  const topDomains = topCountRows(domainCounts, 8);
  const topRoles = topCountRows(roleCounts, 8);
  const topTasks = topCountRows(taskCounts, 10);
  const topAudiences = topCountRows(audienceCounts, 10);
  const topUseCases = topCountRows(useCaseCounts, 10);
  const topTags = topCountRows(tagCounts, 12);
  const generalNeedCount = marketingCases.filter((item) => item.universality === 'high' || item.fit === 'yes').length;

  return {
    days,
    model: openRouterClassifierModel,
    configured: Boolean(openRouterApiKey),
    totalEvents: sources.length,
    analyzedEvents,
    unanalyzedEvents: Math.max(0, sources.length - analyzedEvents),
    topTypes,
    daily,
    weekly,
    insights: {
      topDomains,
      topRoles,
      topTasks,
      topAudiences,
      topUseCases,
      topNeeds,
      topTags,
      generalNeedCount,
      demandUniversality: generalNeedCount >= 5 ? '高' : (generalNeedCount >= 2 ? '中' : '低'),
      summary: topNeeds.length
        ? `主要需求集中在「${topNeeds.slice(0, 3).map((item) => item.label).join('」「')}」。`
        : '暂无足够已分析 Query 形成画像。',
      marketingCases
    }
  };
}

function serializeAnalyticsEventDoc(doc, fallbackKind = 'feature') {
  const data = doc.data() || {};
  return {
    id: doc.id,
    clientEventId: String(data.clientEventId || ''),
    dateKey: String(data.dateKey || ''),
    eventName: String(data.eventName || ''),
    kind: String(data.kind || fallbackKind || 'feature'),
    uploaderType: data.uploaderType === 'anonymous' ? 'anonymous' : 'user',
    uid: String(data.uid || ''),
    clientHash: String(data.clientHash || ''),
    source: String(data.source || ''),
    locale: String(data.locale || ''),
    extensionVersion: String(data.extensionVersion || ''),
    hasQuery: data.hasQuery === true,
    queryLength: Math.max(0, Number(data.queryLength) || 0),
    metadata: data.metadata && typeof data.metadata === 'object' ? data.metadata : {},
    createdAt: timestampToIso(data.createdAt),
    updatedAt: timestampToIso(data.updatedAt)
  };
}

async function listAnalyticsEvents(kind, dateKeys) {
  requireFirebaseAdmin();
  const collectionName = getAnalyticsCollectionName(kind);
  const snapshot = await db.collection(collectionName)
    .where('dateKey', '>=', dateKeys[0])
    .where('dateKey', '<=', dateKeys[dateKeys.length - 1])
    .get();
  const allowed = new Set(dateKeys);
  const rows = [];
  snapshot.forEach((doc) => {
    const row = serializeAnalyticsEventDoc(doc, kind);
    if (allowed.has(row.dateKey)) rows.push(row);
  });
  return rows;
}

function summarizeAnalyticsEvents(rows = [], dateKey = '') {
  const filtered = dateKey ? rows.filter((row) => row.dateKey === dateKey) : rows;
  const userIds = new Set();
  const clientIds = new Set();
  const byEvent = new Map();
  const bySource = new Map();
  filtered.forEach((row) => {
    if (row.uid) userIds.add(row.uid);
    if (row.clientHash) clientIds.add(row.clientHash);
    byEvent.set(row.eventName || 'unknown', (byEvent.get(row.eventName || 'unknown') || 0) + 1);
    bySource.set(row.source || 'unknown', (bySource.get(row.source || 'unknown') || 0) + 1);
  });
  const topEvent = Array.from(byEvent.entries()).sort((left, right) => right[1] - left[1])[0];
  const topSource = Array.from(bySource.entries()).sort((left, right) => right[1] - left[1])[0];
  return {
    events: filtered.length,
    activeUsers: userIds.size,
    activeAnonymousClients: clientIds.size,
    topEvent: topEvent ? `${topEvent[0]} (${topEvent[1]})` : '',
    topSource: topSource ? `${topSource[0]} (${topSource[1]})` : ''
  };
}

function normalizeInsightVersion(version = '') {
  return String(version || '').trim() || 'unknown';
}

function summarizeVersionDistribution(rows = [], limit = 20) {
  const byVersion = new Map();
  rows.forEach((row) => {
    const version = normalizeInsightVersion(row.extensionVersion);
    const current = byVersion.get(version) || {
      version,
      count: 0,
      userIds: new Set(),
      clientIds: new Set(),
      events: new Map(),
      sources: new Map(),
      siteLaunches: 0,
      withQueryEvents: 0
    };
    current.count += 1;
    if (row.uid) current.userIds.add(row.uid);
    if (row.clientHash) current.clientIds.add(row.clientHash);
    if (row.eventName) current.events.set(row.eventName, (current.events.get(row.eventName) || 0) + 1);
    if (row.source) current.sources.set(row.source, (current.sources.get(row.source) || 0) + 1);
    if (Array.isArray(row.siteNames)) current.siteLaunches += row.siteNames.length;
    if (Array.isArray(row.agentIds)) current.siteLaunches += row.agentIds.length;
    if (row.hasQuery) current.withQueryEvents += 1;
    byVersion.set(version, current);
  });
  return Array.from(byVersion.values()).map((item) => {
    const topEvent = Array.from(item.events.entries()).sort((left, right) => right[1] - left[1])[0];
    const topSource = Array.from(item.sources.entries()).sort((left, right) => right[1] - left[1])[0];
    return {
      version: item.version,
      count: item.count,
      activeUsers: item.userIds.size,
      activeAnonymousClients: item.clientIds.size,
      siteLaunches: item.siteLaunches,
      withQueryEvents: item.withQueryEvents,
      topEvent: topEvent ? `${topEvent[0]} (${topEvent[1]})` : '',
      topSource: topSource ? `${topSource[0]} (${topSource[1]})` : ''
    };
  }).sort((left, right) => {
    if (right.count !== left.count) return right.count - left.count;
    return String(right.version).localeCompare(String(left.version));
  }).slice(0, limit);
}

function rankAnalyticsEvents(rows = [], limit = 20) {
  const byEvent = new Map();
  rows.forEach((row) => {
    const key = row.eventName || 'unknown';
    const current = byEvent.get(key) || {
      eventName: key,
      count: 0,
      userIds: new Set(),
      clientIds: new Set(),
      sources: new Map(),
      versions: new Map(),
      latestAt: ''
    };
    current.count += 1;
    if (row.uid) current.userIds.add(row.uid);
    if (row.clientHash) current.clientIds.add(row.clientHash);
    current.sources.set(row.source || 'unknown', (current.sources.get(row.source || 'unknown') || 0) + 1);
    current.versions.set(normalizeInsightVersion(row.extensionVersion), (current.versions.get(normalizeInsightVersion(row.extensionVersion)) || 0) + 1);
    if ((Date.parse(row.createdAt || 0) || 0) >= (Date.parse(current.latestAt || 0) || 0)) {
      current.latestAt = row.createdAt || row.updatedAt || '';
    }
    byEvent.set(key, current);
  });
  return Array.from(byEvent.values()).map((item) => {
    const topSource = Array.from(item.sources.entries()).sort((left, right) => right[1] - left[1])[0];
    const topVersion = Array.from(item.versions.entries()).sort((left, right) => right[1] - left[1])[0];
    return {
      eventName: item.eventName,
      count: item.count,
      activeUsers: item.userIds.size,
      activeAnonymousClients: item.clientIds.size,
      topSource: topSource ? `${topSource[0]} (${topSource[1]})` : '',
      topVersion: topVersion ? `${topVersion[0]} (${topVersion[1]})` : '',
      latestAt: item.latestAt
    };
  }).sort((left, right) => right.count - left.count).slice(0, limit);
}

function rankSiteCombinations(rows = [], limit = 20) {
  const byCombination = new Map();
  rows.forEach((row) => {
    const key = row.siteCombinationKey || BehaviorInsights.createSiteCombinationKey(row);
    if (!key) return;
    const current = byCombination.get(key) || {
      siteCombinationKey: key,
      siteNames: row.siteNames || [],
      agentIds: row.agentIds || [],
      workflowMode: row.workflowMode || '',
      count: 0,
      userIds: new Set(),
      clientIds: new Set(),
      versions: new Map(),
      withQueryEvents: 0
    };
    current.count += 1;
    if (row.uid) current.userIds.add(row.uid);
    if (row.clientHash) current.clientIds.add(row.clientHash);
    current.versions.set(normalizeInsightVersion(row.extensionVersion), (current.versions.get(normalizeInsightVersion(row.extensionVersion)) || 0) + 1);
    if (row.hasQuery) current.withQueryEvents += 1;
    byCombination.set(key, current);
  });
  return Array.from(byCombination.values()).map((item) => {
    const topVersion = Array.from(item.versions.entries()).sort((left, right) => right[1] - left[1])[0];
    return {
      siteCombinationKey: item.siteCombinationKey,
      siteNames: item.siteNames,
      agentIds: item.agentIds,
      workflowMode: item.workflowMode,
      count: item.count,
      activeUsers: item.userIds.size,
      activeAnonymousClients: item.clientIds.size,
      withQueryEvents: item.withQueryEvents,
      topVersion: topVersion ? `${topVersion[0]} (${topVersion[1]})` : ''
    };
  }).sort((left, right) => right.count - left.count).slice(0, limit);
}

function summarizeUserMaturity({ activationRows = [], featureRows = [], siteRows = [], subscriptionRows = [] } = {}) {
  const byIdentity = new Map();
  const ensure = (identity) => {
    if (!identity) return null;
    if (!byIdentity.has(identity)) {
      byIdentity.set(identity, {
        featureEvents: 0,
        activationEvents: 0,
        siteEvents: 0,
        subscriptionEvents: 0,
        hasWorkflowFeature: false
      });
    }
    return byIdentity.get(identity);
  };
  activationRows.forEach((row) => {
    const item = ensure(BehaviorInsights.getIdentityKey(row));
    if (item) item.activationEvents += 1;
  });
  featureRows.forEach((row) => {
    const item = ensure(BehaviorInsights.getIdentityKey(row));
    if (!item) return;
    item.featureEvents += 1;
    const eventName = String(row.eventName || '');
    if (/(favorite|history|template|batch|agent|remote|share)/i.test(eventName)) {
      item.hasWorkflowFeature = true;
    }
  });
  siteRows.forEach((row) => {
    const item = ensure(BehaviorInsights.getIdentityKey(row));
    if (item) item.siteEvents += 1;
  });
  subscriptionRows.forEach((row) => {
    const item = ensure(BehaviorInsights.getIdentityKey(row));
    if (item) item.subscriptionEvents += 1;
  });

  const stages = {
    new: 0,
    activated: 0,
    retained: 0,
    workflow: 0,
    power: 0,
    pro: 0
  };
  byIdentity.forEach((item) => {
    stages[BehaviorInsights.inferUserMaturity(item)] += 1;
  });
  return {
    totalIdentities: byIdentity.size,
    stages
  };
}

function summarizeActivationCohorts(activationRows = [], activityRows = []) {
  const firstQueryByIdentity = new Map();
  activationRows.forEach((row) => {
    if (row.eventName !== 'activation_first_query_submitted') return;
    const identity = BehaviorInsights.getIdentityKey(row);
    if (!identity || !row.dateKey) return;
    const current = firstQueryByIdentity.get(identity);
    if (!current || row.dateKey < current) firstQueryByIdentity.set(identity, row.dateKey);
  });
  const activityByIdentity = new Map();
  activityRows.forEach((row) => {
    const identity = BehaviorInsights.getIdentityKey(row);
    if (!identity || !row.dateKey) return;
    if (!activityByIdentity.has(identity)) activityByIdentity.set(identity, new Set());
    activityByIdentity.get(identity).add(row.dateKey);
  });
  const cohorts = new Map();
  firstQueryByIdentity.forEach((firstDate, identity) => {
    const dates = activityByIdentity.get(identity) || new Set();
    const firstTs = Date.parse(`${firstDate}T00:00:00.000Z`);
    const d1 = new Date(firstTs + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const d7 = new Date(firstTs + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const current = cohorts.get(firstDate) || { dateKey: firstDate, users: 0, d1Retained: 0, d7Retained: 0 };
    current.users += 1;
    if (dates.has(d1)) current.d1Retained += 1;
    if (dates.has(d7)) current.d7Retained += 1;
    cohorts.set(firstDate, current);
  });
  return Array.from(cohorts.values()).map((item) => ({
    ...item,
    d1RetentionRate: computePercent(item.d1Retained, item.users),
    d7RetentionRate: computePercent(item.d7Retained, item.users)
  })).sort((left, right) => right.dateKey.localeCompare(left.dateKey));
}

function computePercent(numerator, denominator) {
  const top = Number(numerator) || 0;
  const bottom = Number(denominator) || 0;
  if (!bottom) return 0;
  return Number(((top / bottom) * 100).toFixed(2));
}

function percentile(values = [], p = 0.9) {
  const sorted = values.map((value) => Number(value) || 0).filter((value) => value >= 0).sort((left, right) => left - right);
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index];
}

async function getProductHealthSummaryData() {
  const dateKeys = getRecentDateKeys(7);
  const todayKey = dateKeys[dateKeys.length - 1];
  const [usageSummary, siteTop, featureRows, activationRows] = await Promise.all([
    getCombinedUsageSummaryData(),
    getCombinedUsageTopTargetsData({ query: { days: 7, limit: 20 } }),
    listAnalyticsEvents('feature', dateKeys),
    listAnalyticsEvents('activation', dateKeys)
  ]);
  const todayFeatures = summarizeAnalyticsEvents(featureRows, todayKey);
  const last7Features = summarizeAnalyticsEvents(featureRows);
  const last7Activations = summarizeAnalyticsEvents(activationRows);
  return {
    today: {
      ...usageSummary.today,
      featureEvents: todayFeatures.events,
      topFeature: todayFeatures.topEvent
    },
    last7Days: {
      ...usageSummary.last7Days,
      featureEvents: last7Features.events,
      activationEvents: last7Activations.events,
      topFeature: last7Features.topEvent
    },
    versionDistribution: summarizeVersionDistribution([...featureRows, ...activationRows], 20),
    topTargets: siteTop.targets || [],
    topFeatures: rankAnalyticsEvents(featureRows, 20),
    recentFeatureEvents: featureRows.sort((left, right) => (Date.parse(right.createdAt || 0) || 0) - (Date.parse(left.createdAt || 0) || 0)).slice(0, 50)
  };
}

async function getExperienceQualitySummaryData() {
  const dateKeys = getRecentDateKeys(7);
  const [usageSummary, failures, failureTopTargets] = await Promise.all([
    getCombinedUsageSummaryData(),
    listFailureLogEvents(dateKeys),
    getFailureLogsTopTargetsData({ query: { days: 7, limit: 30, category: 'all' } })
  ]);
  const failureSummary = summarizeFailureLogs(failures);
  const totalUsage = Number(usageSummary.last7Days.apiRequests || 0) + Number(usageSummary.last7Days.siteLaunches || 0);
  const byPhase = new Map();
  failures.forEach((row) => {
    const count = Math.max(1, Number(row.repeatCount) || 1);
    byPhase.set(row.phase || 'unknown', (byPhase.get(row.phase || 'unknown') || 0) + count);
  });
  return {
    summary: {
      ...failureSummary,
      totalUsage,
      failureRate: computePercent(failureSummary.totalFailures, totalUsage)
    },
    priorityTargets: (failureTopTargets.targets || []).map((item) => ({
      ...item,
      priorityScore: Number(item.failures || 0) * Math.max(1, Number(item.records || 0))
    })).sort((left, right) => right.priorityScore - left.priorityScore),
    topPhases: Array.from(byPhase.entries()).map(([phase, count]) => ({ phase, count })).sort((left, right) => right.count - left.count).slice(0, 20),
    recentFailures: failures.sort((left, right) => {
      const rightTs = Date.parse(right.lastSeenAt || right.createdAt || right.uploadedAt || 0) || 0;
      const leftTs = Date.parse(left.lastSeenAt || left.createdAt || left.uploadedAt || 0) || 0;
      return rightTs - leftTs;
    }).slice(0, 50)
  };
}

async function getGrowthSummaryData() {
  const dateKeys = getRecentDateKeys(7);
  const [activationRows, featureRows, subscriptionRows, siteRows] = await Promise.all([
    listAnalyticsEvents('activation', dateKeys),
    listAnalyticsEvents('feature', dateKeys),
    listAnalyticsEvents('subscription', dateKeys),
    listSiteCompareEvents(dateKeys)
  ]);
  const activationSummary = summarizeAnalyticsEvents(activationRows);
  const featureSummary = summarizeAnalyticsEvents(featureRows);
  const siteIdentities = getSiteUsageIdentitySets(siteRows);
  const activationIdentities = summarizeAnalyticsEvents(activationRows);
  const sourceCounts = new Map();
  [...activationRows, ...featureRows, ...siteRows].forEach((row) => {
    const source = row.source || 'unknown';
    sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
  });
  return {
    summary: {
      activationEvents: activationSummary.events,
      featureEvents: featureSummary.events,
      subscriptionEvents: subscriptionRows.length,
      activatedUsers: activationSummary.activeUsers,
      activatedAnonymousClients: activationSummary.activeAnonymousClients,
      activeUsers: siteIdentities.userIds.size,
      activeAnonymousClients: siteIdentities.clientIds.size,
      topActivation: activationSummary.topEvent,
      topSiteCombination: rankSiteCombinations(siteRows, 1)[0]?.siteCombinationKey || ''
    },
    activationEvents: rankAnalyticsEvents(activationRows, 20),
    featureEvents: rankAnalyticsEvents(featureRows, 20),
    versionDistribution: summarizeVersionDistribution([...activationRows, ...featureRows, ...subscriptionRows, ...siteRows], 20),
    userMaturity: summarizeUserMaturity({
      activationRows,
      featureRows,
      subscriptionRows,
      siteRows
    }),
    cohorts: summarizeActivationCohorts(activationRows, [...featureRows, ...siteRows]),
    topCombinations: rankSiteCombinations(siteRows, 20),
    sources: Array.from(sourceCounts.entries()).map(([source, count]) => ({ source, count })).sort((left, right) => right.count - left.count).slice(0, 20),
    recentActivationEvents: activationRows.sort((left, right) => (Date.parse(right.createdAt || 0) || 0) - (Date.parse(left.createdAt || 0) || 0)).slice(0, 50),
    note: 'D1/D7 cohort 以 activation_first_query_submitted 为起点，并用后续 feature/site 活动判断回访；样本会随着新版事件沉淀逐步完整。'
  };
}

async function getBusinessCostSummaryData() {
  const dateKeys = getRecentDateKeys(7);
  const [subscriptionRows, apiRows, orderSummary, usageSummary] = await Promise.all([
    listAnalyticsEvents('subscription', dateKeys),
    listOfficialApiEvents(dateKeys),
    getOrderSummaryData(),
    getCombinedUsageSummaryData()
  ]);
  const tokenByIdentity = new Map();
  const costByIdentity = new Map();
  apiRows.forEach((row) => {
    const identity = row.uid ? `user:${row.uid}` : (row.clientHash ? `anonymous:${row.clientHash}` : '');
    if (!identity) return;
    tokenByIdentity.set(identity, (tokenByIdentity.get(identity) || 0) + Number(row.totalTokens || 0));
    costByIdentity.set(identity, (costByIdentity.get(identity) || 0) + Number(row.estimatedCost || 0));
  });
  const tokenValues = Array.from(tokenByIdentity.values());
  const costValues = Array.from(costByIdentity.values());
  return {
    summary: {
      limitReached: subscriptionRows.filter((row) => row.eventName.includes('limit_reached')).length,
      checkoutStarted: subscriptionRows.filter((row) => row.eventName === 'checkout_started').length,
      checkoutSuccess: subscriptionRows.filter((row) => row.eventName === 'checkout_success').length,
      activeProUsers: orderSummary.activeProUsers,
      revenue7d: orderSummary.revenue7d,
      revenue30d: orderSummary.revenue30d,
      currency: orderSummary.currency,
      apiRequests: usageSummary.last7Days.apiRequests,
      totalTokens: usageSummary.last7Days.totalTokens,
      estimatedCost: usageSummary.last7Days.estimatedCost,
      costCurrency: usageSummary.last7Days.currency,
      costPerActiveIdentity: roundCost(usageSummary.last7Days.estimatedCost / Math.max(1, usageSummary.last7Days.activeUsers + usageSummary.last7Days.activeAnonymousClients))
    },
    tokenDistribution: {
      p50: Math.round(percentile(tokenValues, 0.5)),
      p90: Math.round(percentile(tokenValues, 0.9)),
      p99: Math.round(percentile(tokenValues, 0.99))
    },
    costDistribution: {
      p50: roundCost(percentile(costValues, 0.5)),
      p90: roundCost(percentile(costValues, 0.9)),
      p99: roundCost(percentile(costValues, 0.99))
    },
    funnelEvents: rankAnalyticsEvents(subscriptionRows, 20),
    recentFunnelEvents: subscriptionRows.sort((left, right) => (Date.parse(right.createdAt || 0) || 0) - (Date.parse(left.createdAt || 0) || 0)).slice(0, 50)
  };
}

function normalizeShareSiteNames(payload = {}) {
  const compareSites = Array.isArray(payload.compareSites) ? payload.compareSites : [];
  const responseSites = Array.isArray(payload.responses)
    ? payload.responses.map((item) => item?.siteName || item?.name || '').filter(Boolean)
    : [];
  return Array.from(new Set([...compareSites, ...responseSites]
    .map((item) => safeLogString(item, 120))
    .filter(Boolean)));
}

function serializeShareLinkDoc(doc) {
  const data = doc.data() || {};
  const payload = data.payload && typeof data.payload === 'object' ? data.payload : {};
  const responses = Array.isArray(payload.responses) ? payload.responses : [];
  const compareSites = normalizeShareSiteNames(payload);
  const createdAt = timestampToIso(data.createdAt) || String(data.createdAt || '');
  const expiresAt = timestampToIso(data.expiresAt) || String(data.expiresAt || '');
  const createdDateKey = createdAt ? getDateKey(createdAt) : '';
  const expiredByTime = expiresAt ? (Date.parse(expiresAt) <= Date.now()) : false;
  const rawStatus = String(data.status || '').trim() || 'active';
  const status = rawStatus === 'active' && expiredByTime ? 'expired' : rawStatus;
  return {
    id: doc.id,
    shareId: String(data.shareId || doc.id || ''),
    dateKey: createdDateKey,
    status,
    createdAt,
    updatedAt: timestampToIso(data.updatedAt) || String(data.updatedAt || ''),
    expiresAt,
    question: safeLogString(payload.question || '', 500),
    questionPreview: safeLogString(payload.question || '', 120),
    hasSummary: Boolean(String(payload.summaryText || '').trim()),
    summaryLength: String(payload.summaryText || '').length,
    responseCount: responses.length,
    successCount: Math.max(0, Number(payload.successCount) || 0),
    totalCount: Math.max(0, Number(payload.totalCount) || responses.length || compareSites.length),
    compareSites,
    siteCount: compareSites.length,
    analysisTemplateId: safeLogString(payload.analysisTemplateId || '', 120),
    analysisTemplateName: safeLogString(payload.analysisTemplateName || '', 160),
    payloadVersion: Math.max(1, Number(payload.version) || 1)
  };
}

async function listShareLinkEvents(dateKeys) {
  requireFirebaseAdmin();
  const startIso = `${dateKeys[0]}T00:00:00.000Z`;
  const endIso = `${dateKeys[dateKeys.length - 1]}T23:59:59.999Z`;
  let snapshot;
  try {
    snapshot = await db.collection('remoteShares')
      .where('createdAt', '>=', startIso)
      .where('createdAt', '<=', endIso)
      .limit(5000)
      .get();
  } catch (error) {
    console.warn('[ai-compare-backend] remoteShares range query failed, falling back to limited scan:', error.message || error);
    snapshot = await db.collection('remoteShares').limit(5000).get();
  }
  const allowed = new Set(dateKeys);
  const rows = [];
  snapshot.forEach((doc) => {
    const row = serializeShareLinkDoc(doc);
    if (allowed.has(row.dateKey)) rows.push(row);
  });
  return rows;
}

function summarizeShareLinks(rows = [], dateKey = '') {
  const filtered = dateKey ? rows.filter((row) => row.dateKey === dateKey) : rows;
  const siteCounts = new Map();
  let activeShares = 0;
  let expiredShares = 0;
  let withSummary = 0;
  let totalResponses = 0;
  let totalSites = 0;
  filtered.forEach((row) => {
    if (row.status === 'expired') expiredShares += 1;
    if (row.status === 'active') activeShares += 1;
    if (row.hasSummary) withSummary += 1;
    totalResponses += Number(row.responseCount || 0);
    totalSites += Number(row.siteCount || 0);
    row.compareSites.forEach((siteName) => {
      siteCounts.set(siteName, (siteCounts.get(siteName) || 0) + 1);
    });
  });
  const topSite = Array.from(siteCounts.entries()).sort((left, right) => right[1] - left[1])[0];
  return {
    totalShares: filtered.length,
    activeShares,
    expiredShares,
    withSummary,
    totalResponses,
    totalSites,
    uniqueSites: siteCounts.size,
    avgSites: filtered.length ? Number((totalSites / filtered.length).toFixed(2)) : 0,
    topSite: topSite ? `${topSite[0]} (${topSite[1]})` : ''
  };
}

async function getShareLinksSummaryData(req) {
  const days = clamp(parseInteger(req.query?.days, 7), 1, 90);
  const dateKeys = getRecentDateKeys(Math.max(days, 7));
  const rows = await listShareLinkEvents(dateKeys);
  const todayKey = dateKeys[dateKeys.length - 1];
  return {
    today: summarizeShareLinks(rows, todayKey),
    last7Days: summarizeShareLinks(rows.filter((row) => dateKeys.slice(-7).includes(row.dateKey))),
    range: summarizeShareLinks(rows)
  };
}

async function getShareLinksTrendData(req) {
  const days = clamp(parseInteger(req.query?.days, 7), 1, 90);
  const dateKeys = getRecentDateKeys(days);
  const rows = await listShareLinkEvents(dateKeys);
  return {
    days: sortDateRowsDescending(dateKeys.map((dateKey) => ({
      date: dateKey,
      ...summarizeShareLinks(rows, dateKey)
    })))
  };
}

async function getShareLinksListData(req) {
  const days = clamp(parseInteger(req.query?.days, 7), 1, 90);
  const limit = clamp(parseInteger(req.query?.limit, 100), 1, 200);
  const cursor = String(req.query?.cursor || '').trim();
  const query = String(req.query?.query || '').trim().toLowerCase();
  let rows = await listShareLinkEvents(getRecentDateKeys(days));
  if (query) {
    rows = rows.filter((row) => [
      row.shareId,
      row.status,
      row.question,
      row.analysisTemplateName,
      row.analysisTemplateId,
      row.compareSites.join(' ')
    ].join(' ').toLowerCase().includes(query));
  }
  rows.sort((left, right) => {
    const rightTs = Date.parse(right.createdAt || right.updatedAt || 0) || 0;
    const leftTs = Date.parse(left.createdAt || left.updatedAt || 0) || 0;
    return rightTs - leftTs;
  });
  const startIndex = cursor ? rows.findIndex((item) => item.id === cursor || item.shareId === cursor) + 1 : 0;
  const pageItems = rows.slice(Math.max(0, startIndex), Math.max(0, startIndex) + limit);
  const nextCursor = rows.length > startIndex + limit ? pageItems[pageItems.length - 1]?.id || '' : '';
  return {
    shares: pageItems,
    nextCursor,
    total: rows.length
  };
}

async function getApiUsageTrendData(req) {
  const days = clamp(parseInteger(req.query?.days, 30), 1, 90);
  return { days: sortDateRowsDescending(await buildUsageTrend(days)) };
}

async function getApiUsageTopDaysData(req) {
  const limit = clamp(parseInteger(req.query?.limit, 10), 1, 30);
  const trend = await buildUsageTrend(90);
  const days = [...trend]
    .sort((left, right) => right.totalRequests - left.totalRequests)
    .slice(0, limit);
  return { days };
}

function serializeFailureLogDoc(doc) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    clientRecordId: String(data.clientRecordId || ''),
    dateKey: String(data.dateKey || ''),
    createdAt: data.createdAt || '',
    lastSeenAt: data.lastSeenAt || '',
    category: data.category === 'api' ? 'api' : 'site',
    source: String(data.source || ''),
    siteName: String(data.siteName || ''),
    apiKind: String(data.apiKind || ''),
    phase: String(data.phase || ''),
    status: Number(data.status) || 0,
    errorCode: String(data.errorCode || ''),
    errorMessage: String(data.errorMessage || ''),
    pageUrl: String(data.pageUrl || ''),
    runtimeUrl: String(data.runtimeUrl || ''),
    model: String(data.model || ''),
    locale: String(data.locale || ''),
    queryPreview: String(data.queryPreview || ''),
    queryHash: String(data.queryHash || ''),
    metadata: data.metadata && typeof data.metadata === 'object' ? data.metadata : {},
    repeatCount: Math.max(1, Number(data.repeatCount) || 1),
    uploaderType: data.uploaderType === 'anonymous' ? 'anonymous' : 'user',
    extensionVersion: String(data.extensionVersion || ''),
    requestLocale: String(data.requestLocale || ''),
    uploadedAt: timestampToIso(data.uploadedAt),
    updatedAt: timestampToIso(data.updatedAt)
  };
}

async function listFailureLogEvents(dateKeys) {
  requireFirebaseAdmin();
  const snapshot = await db.collection('failureLogEvents')
    .where('dateKey', '>=', dateKeys[0])
    .where('dateKey', '<=', dateKeys[dateKeys.length - 1])
    .get();
  const allowed = new Set(dateKeys);
  const rows = [];
  snapshot.forEach((doc) => {
    const row = serializeFailureLogDoc(doc);
    if (allowed.has(row.dateKey)) rows.push(row);
  });
  return rows;
}

function summarizeFailureLogs(rows, dateKey = '') {
  const filtered = dateKey ? rows.filter((row) => row.dateKey === dateKey) : rows;
  const failedSites = new Set();
  const targetCounts = new Map();
  let totalFailures = 0;
  let apiFailures = 0;
  let siteFailures = 0;
  filtered.forEach((row) => {
    const count = Math.max(1, Number(row.repeatCount) || 1);
    totalFailures += count;
    if (row.category === 'api') {
      apiFailures += count;
    } else {
      siteFailures += count;
      if (row.siteName) failedSites.add(row.siteName);
    }
    const target = row.category === 'api' ? (row.apiKind || 'API') : (row.siteName || '未知站点');
    targetCounts.set(target, (targetCounts.get(target) || 0) + count);
  });
  const topTarget = Array.from(targetCounts.entries()).sort((a, b) => b[1] - a[1])[0];
  return {
    totalFailures,
    siteFailures,
    apiFailures,
    failedSites: failedSites.size,
    topTarget: topTarget ? `${topTarget[0]} (${topTarget[1]})` : ''
  };
}

async function getFailureLogsSummaryData() {
  const dateKeys = getRecentDateKeys(30);
  const rows = await listFailureLogEvents(dateKeys);
  const todayKey = dateKeys[dateKeys.length - 1];
  return {
    today: summarizeFailureLogs(rows, todayKey),
    last7Days: summarizeFailureLogs(rows.filter((row) => dateKeys.slice(-7).includes(row.dateKey))),
    last30Days: summarizeFailureLogs(rows)
  };
}

async function getFailureLogsTrendData(req) {
  const days = clamp(parseInteger(req.query?.days, 30), 1, 90);
  const dateKeys = getRecentDateKeys(days);
  const rows = await listFailureLogEvents(dateKeys);
  const daysPayload = dateKeys.map((dateKey) => {
    const summary = summarizeFailureLogs(rows, dateKey);
    return {
      date: dateKey,
      totalFailures: summary.totalFailures,
      siteFailures: summary.siteFailures,
      apiFailures: summary.apiFailures,
      failedSites: summary.failedSites
    };
  });
  return { days: sortDateRowsDescending(daysPayload) };
}

function filterFailureRows(rows, req) {
  const category = String(req.query?.category || 'all').trim();
  const query = String(req.query?.query || '').trim().toLowerCase();
  return rows.filter((row) => {
    if (category !== 'all' && row.category !== category) return false;
    if (!query) return true;
    return [
      row.siteName,
      row.apiKind,
      row.phase,
      row.status,
      row.errorCode,
      row.errorMessage,
      row.source,
      row.model,
      row.locale,
      row.extensionVersion,
      row.queryPreview,
      row.queryHash,
      row.pageUrl,
      row.runtimeUrl,
      JSON.stringify(row.metadata || {})
    ].join(' ').toLowerCase().includes(query);
  });
}

async function getFailureLogsListData(req) {
  const days = clamp(parseInteger(req.query?.days, 7), 1, 90);
  const limit = clamp(parseInteger(req.query?.limit, 100), 1, 200);
  const cursor = String(req.query?.cursor || '').trim();
  const rows = filterFailureRows(await listFailureLogEvents(getRecentDateKeys(days)), req);
  rows.sort((left, right) => {
    const rightTs = Date.parse(right.lastSeenAt || right.createdAt || right.uploadedAt || 0) || 0;
    const leftTs = Date.parse(left.lastSeenAt || left.createdAt || left.uploadedAt || 0) || 0;
    return rightTs - leftTs;
  });
  const startIndex = cursor ? rows.findIndex((item) => item.id === cursor) + 1 : 0;
  const pageItems = rows.slice(Math.max(0, startIndex), Math.max(0, startIndex) + limit);
  const nextCursor = rows.length > startIndex + limit ? pageItems[pageItems.length - 1]?.id || '' : '';
  return {
    logs: pageItems,
    nextCursor,
    total: rows.length
  };
}

async function getFailureLogsTopTargetsData(req) {
  const days = clamp(parseInteger(req.query?.days, 7), 1, 90);
  const limit = clamp(parseInteger(req.query?.limit, 20), 1, 50);
  const rows = filterFailureRows(await listFailureLogEvents(getRecentDateKeys(days)), req);
  const byTarget = new Map();
  rows.forEach((row) => {
    const target = row.category === 'api' ? (row.apiKind || 'API') : (row.siteName || '未知站点');
    const key = `${row.category}|${target}`;
    const current = byTarget.get(key) || {
      category: row.category,
      target,
      failures: 0,
      records: 0,
      phases: new Map(),
      latestAt: '',
      latestError: ''
    };
    const count = Math.max(1, Number(row.repeatCount) || 1);
    const phase = row.phase || 'unknown';
    const rowTime = row.lastSeenAt || row.createdAt || row.uploadedAt || '';
    current.failures += count;
    current.records += 1;
    current.phases.set(phase, (current.phases.get(phase) || 0) + count);
    if ((Date.parse(rowTime) || 0) >= (Date.parse(current.latestAt) || 0)) {
      current.latestAt = rowTime;
      current.latestError = row.errorMessage || '';
    }
    byTarget.set(key, current);
  });
  return {
    targets: Array.from(byTarget.values()).map((item) => {
      const topPhase = Array.from(item.phases.entries()).sort((left, right) => right[1] - left[1])[0];
      return {
        category: item.category,
        target: item.target,
        failures: item.failures,
        records: item.records,
        topPhase: topPhase ? `${topPhase[0]} (${topPhase[1]})` : '',
        latestError: safeLogString(item.latestError, 160)
      };
    })
      .sort((left, right) => right.failures - left.failures)
      .slice(0, limit)
  };
}

function isFinalFailureRow(row = {}) {
  return row?.metadata?.finalFailurePopup === true
    || String(row?.metadata?.finalFailurePopup || '').toLowerCase() === 'true'
    || row.errorCode === 'FINAL_FAILURE_POPUP'
    || row.phase === 'final_failure_popup';
}

function filterFinalFailureRows(rows, req) {
  return filterFailureRows((Array.isArray(rows) ? rows : []).filter(isFinalFailureRow), req);
}

async function getFinalFailuresSummaryData() {
  const dateKeys = getRecentDateKeys(30);
  const rows = (await listFailureLogEvents(dateKeys)).filter(isFinalFailureRow);
  const todayKey = dateKeys[dateKeys.length - 1];
  return {
    today: summarizeFailureLogs(rows, todayKey),
    last7Days: summarizeFailureLogs(rows.filter((row) => dateKeys.slice(-7).includes(row.dateKey))),
    last30Days: summarizeFailureLogs(rows)
  };
}

async function getFinalFailuresTrendData(req) {
  const days = clamp(parseInteger(req.query?.days, 7), 1, 90);
  const dateKeys = getRecentDateKeys(days);
  const rows = (await listFailureLogEvents(dateKeys)).filter(isFinalFailureRow);
  const daysPayload = dateKeys.map((dateKey) => {
    const summary = summarizeFailureLogs(rows, dateKey);
    return {
      date: dateKey,
      totalFailures: summary.totalFailures,
      siteFailures: summary.siteFailures,
      apiFailures: summary.apiFailures,
      failedSites: summary.failedSites
    };
  });
  return { days: sortDateRowsDescending(daysPayload) };
}

async function getFinalFailuresListData(req) {
  const days = clamp(parseInteger(req.query?.days, 7), 1, 90);
  const limit = clamp(parseInteger(req.query?.limit, 100), 1, 200);
  const cursor = String(req.query?.cursor || '').trim();
  const rows = filterFinalFailureRows(await listFailureLogEvents(getRecentDateKeys(days)), req);
  rows.sort((left, right) => {
    const rightTs = Date.parse(right.lastSeenAt || right.createdAt || right.uploadedAt || 0) || 0;
    const leftTs = Date.parse(left.lastSeenAt || left.createdAt || left.uploadedAt || 0) || 0;
    return rightTs - leftTs;
  });
  const startIndex = cursor ? rows.findIndex((item) => item.id === cursor) + 1 : 0;
  const pageItems = rows.slice(Math.max(0, startIndex), Math.max(0, startIndex) + limit);
  const nextCursor = rows.length > startIndex + limit ? pageItems[pageItems.length - 1]?.id || '' : '';
  return {
    logs: pageItems,
    nextCursor,
    total: rows.length
  };
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

app.get(['/membership-pricing', '/membership-pricing.html'], (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  const requestedPlanType = String(req.query?.planType || req.query?.plan || '').trim().toLowerCase();
  const planType = requestedPlanType === 'api' ? 'api' : 'chat';
  const requestedBillingMode = String(req.query?.billingMode || req.query?.mode || '').trim().toLowerCase();
  if (requestedBillingMode === 'test' && billingMode !== 'test') {
    const redirectUrl = new URL(req.originalUrl || req.path, 'https://aicompare.club');
    redirectUrl.pathname = redirectUrl.pathname.replace(/^\/+/, '/test-api/');
    redirectUrl.searchParams.set('billingMode', 'test');
    redirectUrl.searchParams.delete('mode');
    res.redirect(302, `${redirectUrl.pathname}${redirectUrl.search}`);
    return;
  }
  if (!String(req.query?.planType || '').trim()) {
    const redirectUrl = new URL(req.originalUrl || req.path, 'https://aicompare.club');
    redirectUrl.searchParams.delete('plan');
    redirectUrl.searchParams.set('planType', planType);
    res.redirect(302, `${redirectUrl.pathname}${redirectUrl.search}`);
    return;
  }
  res.send(getMembershipPricingPageHtml(planType));
});

app.get('/payment-status', asyncRoute(async (req, res) => {
  const snapshot = await getPaymentStatusSnapshot(req.query?.session_id);
  res.setHeader('Cache-Control', 'no-store');
  res.json(snapshot);
}));

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

app.get('/admin/users', asyncRoute(async (req, res) => {
  if (!await requireAdminPage(req, res)) return;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(getUsersPageHtml());
}));

app.get('/admin/redeem-codes', asyncRoute(async (req, res) => {
  if (!await requireAdminPage(req, res)) return;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(getRedeemCodesPageHtml());
}));

app.get('/admin/api-usage', asyncRoute(async (req, res) => {
  if (!await requireAdminPage(req, res)) return;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(getApiUsagePageHtml());
}));

app.get('/admin/site-usage', asyncRoute(async (req, res) => {
  if (!await requireAdminPage(req, res)) return;
  res.redirect('/admin/api-usage');
}));

app.get('/admin/failure-logs', asyncRoute(async (req, res) => {
  if (!await requireAdminPage(req, res)) return;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(getFailureLogsPageHtml());
}));

app.get('/admin/final-failures', asyncRoute(async (req, res) => {
  if (!await requireAdminPage(req, res)) return;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(getFinalFailuresPageHtml());
}));

app.get('/admin/course-promo', asyncRoute(async (req, res) => {
  if (!await requireAdminPage(req, res)) return;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(getCoursePromoPageHtml());
}));

app.get('/admin/product-health', asyncRoute(async (req, res) => {
  if (!await requireAdminPage(req, res)) return;
  res.redirect('/admin/api-usage');
}));

app.get('/admin/experience', asyncRoute(async (req, res) => {
  if (!await requireAdminPage(req, res)) return;
  res.redirect('/admin/failure-logs');
}));

app.get('/admin/growth', asyncRoute(async (req, res) => {
  if (!await requireAdminPage(req, res)) return;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(getGrowthPageHtml());
}));

app.get('/admin/business', asyncRoute(async (req, res) => {
  if (!await requireAdminPage(req, res)) return;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(getBusinessPageHtml());
}));

app.get('/admin/api-cost', asyncRoute(async (req, res) => {
  if (!await requireAdminPage(req, res)) return;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(getApiCostPageHtml());
}));

app.get('/admin/share-links', asyncRoute(async (req, res) => {
  if (!await requireAdminPage(req, res)) return;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(getShareLinksPageHtml());
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

app.get('/api/admin/users/list', asyncRoute(async (req, res) => {
  await requireAdmin(req);
  res.json(await getAdminUsersListData(req));
}));

app.get('/api/admin/orders/trend', asyncRoute(async (req, res) => {
  await requireAdmin(req);
  res.json(await getOrderTrendData(req));
}));

app.get('/api/admin/redeem-codes', asyncRoute(async (req, res) => {
  await requireAdmin(req);
  res.setHeader('Cache-Control', 'no-store');
  res.json(await listRedeemCodes(req));
}));

app.post('/api/admin/redeem-codes', asyncRoute(async (req, res) => {
  const adminUser = await requireAdmin(req);
  res.json(await createRedeemCodes(req, adminUser));
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

app.get('/api/admin/usage/summary', asyncRoute(async (req, res) => {
  await requireAdmin(req);
  res.json(await getCombinedUsageSummaryData());
}));

app.get('/api/admin/usage/trend', asyncRoute(async (req, res) => {
  await requireAdmin(req);
  res.json(await getCombinedUsageTrendData(req));
}));

app.get('/api/admin/usage/top-targets', asyncRoute(async (req, res) => {
  await requireAdmin(req);
  res.json(await getCombinedUsageTopTargetsData(req));
}));

app.get('/api/admin/usage/recent', asyncRoute(async (req, res) => {
  await requireAdmin(req);
  res.json(await getCombinedUsageRecentData(req));
}));

app.get('/api/admin/site-usage/summary', asyncRoute(async (req, res) => {
  await requireAdmin(req);
  res.json(await getSiteUsageSummaryData());
}));

app.get('/api/admin/site-usage/trend', asyncRoute(async (req, res) => {
  await requireAdmin(req);
  res.json(await getSiteUsageTrendData(req));
}));

app.get('/api/admin/site-usage/top-sites', asyncRoute(async (req, res) => {
  await requireAdmin(req);
  res.json(await getSiteUsageTopSitesData(req));
}));

app.get('/api/admin/site-usage/recent', asyncRoute(async (req, res) => {
  await requireAdmin(req);
  res.json(await getSiteUsageRecentData(req));
}));

app.get('/api/admin/failure-logs/summary', asyncRoute(async (req, res) => {
  await requireAdmin(req);
  res.json(await getFailureLogsSummaryData());
}));

app.get('/api/admin/failure-logs/trend', asyncRoute(async (req, res) => {
  await requireAdmin(req);
  res.json(await getFailureLogsTrendData(req));
}));

app.get('/api/admin/failure-logs/list', asyncRoute(async (req, res) => {
  await requireAdmin(req);
  res.json(await getFailureLogsListData(req));
}));

app.get('/api/admin/failure-logs/top-targets', asyncRoute(async (req, res) => {
  await requireAdmin(req);
  res.json(await getFailureLogsTopTargetsData(req));
}));

app.get('/api/admin/final-failures/summary', asyncRoute(async (req, res) => {
  await requireAdmin(req);
  res.json(await getFinalFailuresSummaryData());
}));

app.get('/api/admin/final-failures/trend', asyncRoute(async (req, res) => {
  await requireAdmin(req);
  res.json(await getFinalFailuresTrendData(req));
}));

app.get('/api/admin/final-failures/list', asyncRoute(async (req, res) => {
  await requireAdmin(req);
  res.json(await getFinalFailuresListData(req));
}));

app.get('/api/admin/course-promo', asyncRoute(async (req, res) => {
  await requireAdmin(req);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ config: sanitizeCoursePromoOutput(await getCoursePromoConfigFromStore()) });
}));

app.post('/api/admin/course-promo', asyncRoute(async (req, res) => {
  const adminUser = await requireAdmin(req);
  const config = normalizeCoursePromoConfig({
    enabled: req.body?.enabled === true || req.body?.enabled === 'true',
    imageUrl: req.body?.imageUrl,
    targetUrl: req.body?.targetUrl,
    title: req.body?.title,
    subtitle: req.body?.subtitle,
    ctaText: req.body?.ctaText,
    textAdEnabled: req.body?.textAdEnabled === true || req.body?.textAdEnabled === 'true',
    textAdText: req.body?.textAdText,
    textAdUrl: req.body?.textAdUrl,
    targetLocales: req.body?.targetLocales,
    dismissDays: req.body?.dismissDays,
    maxImpressionsPerDay: req.body?.maxImpressionsPerDay
  });
  const errors = validateCoursePromoConfigInput(config);
  if (errors.length) {
    res.status(400).json({ error: errors.join('；') });
    return;
  }
  const saved = await saveCoursePromoConfigToStore(config, adminUser.username || '');
  res.json({ ok: true, config: sanitizeCoursePromoOutput(saved) });
}));

app.get('/api/public/course-promo', asyncRoute(async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  let config = getDefaultCoursePromoConfig();
  try {
    config = await getCoursePromoConfigFromStore();
  } catch (error) {
    res.json({ config: sanitizeCoursePromoPublicOutput({ ...getDefaultCoursePromoConfig(), enabled: false }) });
    return;
  }
  const output = sanitizeCoursePromoPublicOutput(config);
  if (!output.imageUrl || !output.targetUrl) {
    output.enabled = false;
  }
  res.json({ config: output });
}));

app.get('/api/admin/product-health/summary', asyncRoute(async (req, res) => {
  await requireAdmin(req);
  res.json(await getProductHealthSummaryData());
}));

app.get('/api/admin/query-insights/summary', asyncRoute(async (req, res) => {
  await requireAdmin(req);
  res.json(await getQueryInsightsSummaryData(req));
}));

app.post('/api/admin/query-insights/analyze', asyncRoute(async (req, res) => {
  await requireAdmin(req);
  res.json(await analyzeQueryInsights(req));
}));

app.get('/api/admin/experience/summary', asyncRoute(async (req, res) => {
  await requireAdmin(req);
  res.json(await getExperienceQualitySummaryData());
}));

app.get('/api/admin/growth/summary', asyncRoute(async (req, res) => {
  await requireAdmin(req);
  res.json(await getGrowthSummaryData());
}));

app.get('/api/admin/business/summary', asyncRoute(async (req, res) => {
  await requireAdmin(req);
  res.json(await getBusinessCostSummaryData());
}));

app.get('/api/admin/api-cost/summary', asyncRoute(async (req, res) => {
  await requireAdmin(req);
  res.json(await getApiCostSummaryData(req));
}));

app.get('/api/admin/api-cost/trend', asyncRoute(async (req, res) => {
  await requireAdmin(req);
  res.json(await getApiCostTrendData(req));
}));

app.get('/api/admin/api-cost/by-model', asyncRoute(async (req, res) => {
  await requireAdmin(req);
  res.json(await getApiCostByModelData(req));
}));

app.get('/api/admin/share-links/summary', asyncRoute(async (req, res) => {
  await requireAdmin(req);
  res.json(await getShareLinksSummaryData(req));
}));

app.get('/api/admin/share-links/trend', asyncRoute(async (req, res) => {
  await requireAdmin(req);
  res.json(await getShareLinksTrendData(req));
}));

app.get('/api/admin/share-links/list', asyncRoute(async (req, res) => {
  await requireAdmin(req);
  res.json(await getShareLinksListData(req));
}));

app.post('/ga/mp/collect', asyncRoute(async (req, res) => {
  const measurementId = String(req.body?.measurementId || '').trim();
  const apiSecret = String(req.body?.apiSecret || '').trim();
  const clientId = String(req.body?.client_id || req.body?.clientId || '').trim();
  const events = Array.isArray(req.body?.events) ? req.body.events : [];

  if (!measurementId || !apiSecret || !clientId || events.length === 0) {
    res.status(400).json({
      error: 'measurementId, apiSecret, client_id, and events[] are required'
    });
    return;
  }

  const endpoint = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      client_id: clientId,
      events
    })
  });

  res.status(response.status).json({ ok: response.ok, status: response.status });
}));

app.post('/api/failure-logs/batch', asyncRoute(async (req, res) => {
  res.json(await recordFailureLogBatch(req));
}));

app.post('/api/site-compare-events', asyncRoute(async (req, res) => {
  res.json(await recordSiteCompareEvent(req));
}));

app.post('/api/product-feature-events', asyncRoute(async (req, res) => {
  res.json(await recordAnalyticsEvent(req, 'feature'));
}));

app.post('/api/activation-events', asyncRoute(async (req, res) => {
  res.json(await recordAnalyticsEvent(req, 'activation'));
}));

app.post('/api/subscription-funnel-events', asyncRoute(async (req, res) => {
  res.json(await recordAnalyticsEvent(req, 'subscription'));
}));

app.post('/auth/email-code/send', asyncRoute(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await sendEmailLoginCode(req));
}));

app.post('/auth/email-code/verify', asyncRoute(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await verifyEmailLoginCode(req));
}));

app.get('/auth/email-code/status', asyncRoute(async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(getEmailAuthStatus());
}));

app.get('/billingConfig', asyncRoute(async (_req, res) => {
  res.json({
    mode: billingMode,
    limits: {
      officialApiDailyFreeLimit: dailyFreeLimit,
      chatPlanDailyFreeLimit
    },
    prices: getStripePrices(),
    priceDetails: await getStripePriceDetails()
  });
}));

app.post('/chatPlanUsage/consume', asyncRoute(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await consumeChatPlanUsageForRequest(req));
}));

app.post('/createCheckoutSession', asyncRoute(async (req, res) => {
  const user = await getOptionalUser(req);
  const priceId = String(req.body?.priceId || '').trim();
  if (!priceId) {
    res.status(400).json({ error: 'priceId is required' });
    return;
  }
  assertCheckoutPriceAllowed(priceId);
  const pricePlanType = getStripePlanTypeForPrice(priceId);
  const requestedPlanTypeRaw = String(req.body?.planType || '').trim().toLowerCase();
  const requestedPlanType = requestedPlanTypeRaw === 'api'
    ? 'api'
    : (requestedPlanTypeRaw === 'chat' ? 'chat' : '');
  if (requestedPlanTypeRaw && !requestedPlanType) {
    res.status(400).json({ error: 'Unsupported checkout plan type' });
    return;
  }
  if (requestedPlanType && requestedPlanType !== pricePlanType) {
    res.status(400).json({ error: 'Checkout plan type does not match price' });
    return;
  }
  const planType = pricePlanType;
  const prefillEmail = normalizeBillingEmail(req.body?.prefillEmail || req.body?.customerEmail || '');

  const session = user?.uid
    ? await createCheckoutSessionForFirebaseUser({
      firebaseUser: user,
      priceId,
      planType
    })
    : await createCheckoutSessionForAnonymousClient({
      priceId,
      planType,
      prefillEmail
    });
  recordInternalAnalyticsEvent({
    kind: 'subscription',
    eventName: 'checkout_started',
    uid: user?.uid || '',
    clientHash: '',
    uploaderType: user?.uid ? 'user' : 'anonymous',
    source: 'backend',
    metadata: { priceId, planType, billingMode }
  }).catch(() => null);

  res.json({ url: session.url });
}));

app.get('/anonymousMembershipStatus', asyncRoute(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    plan: 'free',
    planExpiresAt: null,
    apiPlan: 'free',
    apiPlanExpiresAt: null,
    stripeCustomerId: '',
    stripeSubscriptionId: ''
  });
}));

app.post('/redeemCode', asyncRoute(async (req, res) => {
  res.json(await redeemMembershipCode(req));
}));

app.get('/billing-smoke', asyncRoute(async (req, res) => {
  const smokeConfig = assertBillingSmokeTestAccess(req);
  const firebaseUser = await resolveBillingSmokeTestUser(req);
  const session = await createCheckoutSessionForFirebaseUser({
    firebaseUser,
    priceId: smokeConfig.priceId,
    smokeTest: true
  });

  if (String(req.query?.format || '').trim().toLowerCase() === 'json') {
    res.json({ url: session.url });
    return;
  }
  res.redirect(303, session.url);
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

async function updateUserFromSubscription(subscription, options = {}) {
  const stripe = getStripe();
  const customerId = extractStripeCustomerId(subscription.customer);
  const checkoutEmail = normalizeBillingEmail(options.checkoutEmail || '');
  const customerEmail = checkoutEmail || await getStripeCustomerEmail(stripe, subscription.customer);
  let uid = String(subscription.metadata?.firebaseUid || '').trim();
  if (!uid && customerEmail) {
    const firebaseUser = await getOrCreateFirebaseUserForStripeEmail(customerEmail, { stripeCustomerId: customerId });
    uid = String(firebaseUser?.uid || '').trim();
    if (uid) {
      try {
        await stripe.subscriptions.update(subscription.id, {
          metadata: {
            ...(subscription.metadata || {}),
            firebaseUid: uid,
            stripeCustomerEmail: customerEmail
          }
        });
      } catch (error) {
        console.warn('[ai-compare-backend] failed to backfill subscription firebaseUid:', error.message || error);
      }
    }
  }
  if (!uid) return { uid: '', customerEmail };

  const item = subscription.items?.data?.[0];
  const periodEnd = item?.current_period_end || subscription.current_period_end || 0;
  const isActive = ['active', 'trialing'].includes(subscription.status);
  const priceId = String(item?.price?.id || '').trim();
  const planType = String(subscription.metadata?.planType || getStripePlanTypeForPrice(priceId)).trim() === 'api'
    ? 'api'
    : 'chat';
  const planPatch = planType === 'api'
    ? {
      apiPlan: isActive ? 'pro' : 'free',
      apiPlanExpiresAt: periodEnd ? admin.firestore.Timestamp.fromMillis(periodEnd * 1000) : null,
      apiStripeSubscriptionId: subscription.id,
      [`apiStripeSubscriptionId${getStripeModeSuffix()}`]: subscription.id,
      apiSubscriptionStatus: subscription.status
    }
    : {
      plan: isActive ? 'pro' : 'free',
      planExpiresAt: periodEnd ? admin.firestore.Timestamp.fromMillis(periodEnd * 1000) : null,
      stripeSubscriptionId: subscription.id,
      [getStripeSubscriptionIdField()]: subscription.id,
      subscriptionStatus: subscription.status
    };

  await db.collection('users').doc(uid).set({
    ...planPatch,
    ...(customerEmail ? { email: customerEmail } : {}),
    ...(customerEmail ? { stripeCustomerEmail: customerEmail } : {}),
    stripeCustomerId: customerId,
    [getStripeCustomerIdField()]: customerId,
    billingMode,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  return { uid, customerEmail };
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
    const sessionEmail = getCheckoutSessionEmail(session);
    let uid = String(session.metadata?.firebaseUid || '').trim();
    if (!uid && sessionEmail) {
      const firebaseUser = await getOrCreateFirebaseUserForStripeEmail(sessionEmail, {
        stripeCustomerId: extractStripeCustomerId(session.customer)
      });
      uid = String(firebaseUser?.uid || '').trim();
    }
    if (uid) {
      recordInternalAnalyticsEvent({
        kind: 'subscription',
        eventName: 'checkout_success',
        uid,
        clientHash: '',
        uploaderType: 'user',
        source: 'stripe_webhook',
        metadata: {
          customer: session.customer || '',
          subscription: session.subscription || '',
          stripeCustomerEmail: sessionEmail,
          amountTotal: session.amount_total || 0,
          currency: session.currency || '',
          billingMode
        }
      }).catch(() => null);
    }
    if (session.subscription) {
      const subscription = await stripe.subscriptions.retrieve(session.subscription);
      await updateUserFromSubscription(subscription, { checkoutEmail: sessionEmail });
    }
  }

  if (
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.deleted' ||
    event.type === 'invoice.payment_succeeded'
  ) {
    const object = event.data.object;
    const subscriptionId = typeof object.subscription === 'object'
      ? String(object.subscription?.id || '')
      : String(object.subscription || object.id || '');
    if (subscriptionId) {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const updateResult = await updateUserFromSubscription(subscription);
      const uid = String(updateResult?.uid || subscription.metadata?.firebaseUid || '').trim();
      if (uid) {
        recordInternalAnalyticsEvent({
          kind: 'subscription',
          eventName: event.type === 'customer.subscription.deleted' ? 'subscription_canceled' : event.type.replace(/\./g, '_'),
          uid,
          clientHash: '',
          uploaderType: 'user',
          source: 'stripe_webhook',
          metadata: {
            subscription: subscription.id,
            status: subscription.status,
            customer: subscription.customer || '',
            stripeCustomerEmail: updateResult?.customerEmail || '',
            billingMode
          }
        }).catch(() => null);
      }
    }
  }

  res.json({ received: true });
}));

app.post('/officialAgentChat', asyncRoute(async (req, res) => {
  const user = await getOptionalUser(req);
  const locale = String(req.headers['x-ai-compare-locale'] || req.body?.locale || '').trim();
  const extensionVersion = safeLogString(req.body?.extensionVersion || req.headers['x-ai-compare-extension-version'] || '', 40);
  const requestedModel = String(req.body?.model || '').trim();
  const requestQuery = extractOfficialRequestQuery(req.body || {});
  const queryPreview = createSafeQueryPreview(requestQuery);
  const queryText = safeLogString(requestQuery, 4000);
  const queryHash = createSha256Hash(requestQuery);
  const apiKey = String(process.env.OFFICIAL_AGENT_API_KEY || '').trim();
  const baseUrl = String(process.env.OFFICIAL_AGENT_API_BASE_URL || '').trim().replace(/\/+$/, '');
  const defaultModel = String(process.env.OFFICIAL_AGENT_MODEL || '').trim();
  const effectiveModel = requestedModel || defaultModel;
  let usageResult = null;
  let eventPayload = null;

  if (user?.uid) {
    usageResult = await consumeOfficialApiUsage(user.uid, locale);
    eventPayload = {
      uid: user.uid,
      clientHash: '',
      userType: ['pro', 'api_pro'].includes(usageResult?.plan) ? 'pro' : 'free',
      locale,
      model: effectiveModel,
      queryPreview,
      queryText,
      queryHash,
      requestIp: getRequestIp(req),
      requestRegion: getRequestRegion(req),
      userAgent: getRequestUserAgent(req),
      extensionVersion
    };
  } else {
    const anonymousClientId = getAnonymousClientId(req);
    usageResult = await consumeAnonymousOfficialApiUsage(anonymousClientId, locale);
    eventPayload = {
      uid: '',
      clientHash: getAnonymousUsageDocId(anonymousClientId),
      userType: usageResult?.plan === 'api_pro' ? 'pro' : 'anonymous',
      locale,
      model: effectiveModel,
      queryPreview,
      queryText,
      queryHash,
      requestIp: getRequestIp(req),
      requestRegion: getRequestRegion(req),
      userAgent: getRequestUserAgent(req),
      extensionVersion
    };
  }

  const recordUsageEvent = async (extra = {}) => {
    try {
      await recordOfficialApiEvent({
        ...eventPayload,
        ...extra
      });
    } catch (error) {
      console.warn('[ai-compare-backend] failed to record official API event:', error.message || error);
    }
  };

  if (!apiKey || !baseUrl || !effectiveModel) {
    await recordUsageEvent({ upstreamStatus: 0 });
    res.status(500).json({ error: 'Official API proxy is not configured' });
    return;
  }

  let upstream = null;
  try {
    if (isAnthropicOfficialApi(baseUrl)) {
      await proxyAnthropicOfficialAgentChat(req, res, {
        apiKey,
        baseUrl,
        model: effectiveModel,
        recordUsageEvent
      });
      return;
    }

    upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(buildOfficialOpenAiRequestBody(req.body || {}, effectiveModel))
    });
  } catch (error) {
    await recordUsageEvent({ upstreamStatus: 0 });
    throw error;
  }

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

  if (req.body?.stream === true) {
    const tokenUsage = upstream.ok ? await pipeOpenAiStreamAndCollectUsage(upstream, res) : normalizeTokenUsage();
    if (!upstream.ok && upstream.body) {
      const errorText = await upstream.text();
      res.send(errorText);
    } else {
      res.end();
    }
    await recordUsageEvent({
      tokenUsage,
      upstreamStatus: upstream.status,
      upstreamModel: effectiveModel
    });
    return;
  }

  const responseText = await upstream.text();
  let tokenUsage = normalizeTokenUsage();
  let upstreamModel = effectiveModel;
  try {
    const payload = JSON.parse(responseText);
    tokenUsage = extractTokenUsageFromPayload(payload);
    upstreamModel = String(payload.model || effectiveModel);
  } catch (_) {
    // Non-JSON upstream responses are still proxied; they just cannot provide token usage.
  }
  await recordUsageEvent({
    tokenUsage,
    upstreamStatus: upstream.status,
    upstreamModel
  });
  res.send(responseText);
}));

app.listen(port, '0.0.0.0', () => {
  console.log(`[ai-compare-backend] listening on ${port}`);
  startQueryInsightAutoAnalysis();
});
