require('dotenv').config();

const express = require('express');
const admin = require('firebase-admin');
const Stripe = require('stripe');
const crypto = require('crypto');

const app = express();
const port = Number(process.env.PORT || 8790);
const dailyFreeLimit = Math.max(0, Number(process.env.OFFICIAL_API_DAILY_FREE_LIMIT || 100) || 100);
const billingMode = String(process.env.BILLING_MODE || 'test').trim() || 'test';
const adminSessionOrigin = String(process.env.ADMIN_SESSION_ORIGIN || '').trim();
const adminSessionSecret = String(process.env.ADMIN_SESSION_SECRET || process.env.STRIPE_WEBHOOK_SECRET || '').trim();
const adminSessionCookieName = 'ai_compare_admin_session';
const adminSessionTtlSeconds = Math.max(300, Number(process.env.ADMIN_SESSION_TTL_SECONDS || 12 * 60 * 60) || (12 * 60 * 60));
const adminUsername = String(process.env.ADMIN_USERNAME || '').trim();
const adminPasswordHash = String(process.env.ADMIN_PASSWORD_HASH || '').trim();
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
const officialAgentCostCurrency = String(process.env.OFFICIAL_AGENT_COST_CURRENCY || 'usd').trim().toLowerCase() || 'usd';

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
  const estimatedCost = (
    (tokenUsage.promptTokens / 1000000) * officialAgentInputTokenPricePerMillion
    + (tokenUsage.completionTokens / 1000000) * officialAgentOutputTokenPricePerMillion
  );
  return {
    ...tokenUsage,
    estimatedCost: Number(estimatedCost.toFixed(8)),
    currency: officialAgentCostCurrency
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

function formatMetadataValue(value) {
  if (value == null) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  return String(value);
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
    .slice(0, 8)
    .map(([key, value]) => renderPill(key, formatMetadataValue(value)))
    .join('');
  const url = item.runtimeUrl || item.pageUrl || '';
  const urlLink = url
    ? '<a class="log-link" href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(url) + '</a>'
    : '-';
  return (
    '<div class="log-detail-grid">'
      + '<div><span class="detail-label">Query</span><div class="query-preview">' + escapeHtml(formatCompactText(item.queryPreview, '无 query 摘要')) + '</div></div>'
      + '<div><span class="detail-label">URL</span><div class="url-cell">' + urlLink + '</div></div>'
      + '<div><span class="detail-label">模型 / 语言 / 版本</span><div class="pill-row">'
        + renderPill('model', item.model || '-')
        + renderPill('locale', item.locale || item.requestLocale || '-')
        + renderPill('version', item.extensionVersion || '-')
      + '</div></div>'
      + '<div><span class="detail-label">诊断字段</span><div class="pill-row">'
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
    return (
      '<tr class="log-row">'
        + '<td><div class="strong-cell">' + escapeHtml(formatDate(item.lastSeenAt || item.createdAt || item.uploadedAt)) + '</div><div class="muted-cell">上传 ' + escapeHtml(formatDate(item.uploadedAt)) + '</div></td>'
        + '<td><span class="type-tag ' + severityClass + '">' + escapeHtml(item.category === 'api' ? 'API' : '站点') + '</span></td>'
        + '<td><div class="strong-cell">' + escapeHtml(target) + '</div><div class="muted-cell">' + escapeHtml(item.source || '-') + '</div></td>'
        + '<td><div class="strong-cell">' + escapeHtml(item.phase || '-') + '</div><div class="muted-cell">' + escapeHtml(item.status ? ('HTTP ' + item.status) : '无状态码') + '</div></td>'
        + '<td><div class="error-cell">' + escapeHtml(formatCompactText(item.errorMessage)) + '</div></td>'
        + '<td><div class="strong-cell">' + escapeHtml(formatNumber(item.repeatCount || 1)) + '</div><div class="muted-cell">' + escapeHtml(item.uploaderType === 'anonymous' ? '匿名' : '登录用户') + '</div></td>'
      + '</tr>'
      + '<tr class="log-detail-row"><td colspan="6">' + renderFailureContext(item) + '</td></tr>'
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
  const [summary, trendPayload, topTargetsPayload, recentPayload] = await Promise.all([
    fetchAdminJson('/api/admin/usage/summary'),
    fetchAdminJson('/api/admin/usage/trend?days=7'),
    fetchAdminJson('/api/admin/usage/top-targets?days=7&limit=30'),
    fetchAdminJson('/api/admin/usage/recent?days=7&limit=100')
  ]);
  document.getElementById('apiCards').innerHTML = renderCards([
    { label: '今日 API 请求', value: formatNumber(summary.today.apiRequests), note: formatNumber(summary.today.totalTokens) + ' tokens' },
    { label: '今日站点对比', value: formatNumber(summary.today.siteEvents), note: summary.today.topSite || '暂无站点数据' },
    { label: '今日活跃登录用户', value: formatNumber(summary.today.activeUsers) },
    { label: '今日活跃匿名设备', value: formatNumber(summary.today.activeAnonymousClients) },
    { label: '近 7 天 API 请求', value: formatNumber(summary.last7Days.apiRequests), note: formatCost(summary.last7Days.estimatedCost, summary.last7Days.currency) },
    { label: '近 7 天站点对比', value: formatNumber(summary.last7Days.siteEvents), note: '站点打开 ' + formatNumber(summary.last7Days.siteLaunches) }
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

  const recent = Array.isArray(recentPayload.events) ? recentPayload.events : [];
  document.getElementById('usageRecentBody').innerHTML = recent.length
    ? recent.map((item) => (
      '<tr>'
        + '<td>' + escapeHtml(formatDate(item.createdAt)) + '</td>'
        + '<td>' + escapeHtml(item.kind === 'api' ? 'API' : '站点') + '</td>'
        + '<td>' + escapeHtml(item.target || '-') + '</td>'
        + '<td>' + escapeHtml(item.userType || '-') + '</td>'
        + '<td>' + escapeHtml(item.detail || '-') + '</td>'
        + '<td>' + escapeHtml(item.extensionVersion || '-') + '</td>'
      + '</tr>'
    )).join('')
    : renderEmptyRow('暂无最近使用记录', 6);
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

async function loadFailureLogsPage() {
  const filters = getFailureFilters();
  const [summary, trendPayload, topTargetsPayload, listPayload] = await Promise.all([
    fetchAdminJson('/api/admin/failure-logs/summary'),
    fetchAdminJson('/api/admin/failure-logs/trend?days=30'),
    fetchAdminJson('/api/admin/failure-logs/top-targets?' + filters.toString() + '&limit=20'),
    fetchAdminJson('/api/admin/failure-logs/list?' + filters.toString() + '&limit=100')
  ]);
  document.getElementById('failureCards').innerHTML = renderCards([
    { label: '今日失败总数', value: formatNumber(summary.today.totalFailures) },
    { label: '今日失败站点数', value: formatNumber(summary.today.failedSites) },
    { label: '今日 API 失败', value: formatNumber(summary.today.apiFailures) },
    { label: '近 7 天失败', value: formatNumber(summary.last7Days.totalFailures) },
    { label: '近 30 天失败', value: formatNumber(summary.last30Days.totalFailures) },
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

  const topTargets = Array.isArray(topTargetsPayload.targets) ? topTargetsPayload.targets : [];
  document.getElementById('failureTopTargetsBody').innerHTML = topTargets.length
    ? topTargets.map((item) => (
      '<tr>'
        + '<td>' + escapeHtml(item.category === 'api' ? 'API' : '站点') + '</td>'
        + '<td>' + escapeHtml(item.target || '-') + '</td>'
        + '<td>' + escapeHtml(formatNumber(item.failures)) + '</td>'
        + '<td><div class="strong-cell">' + escapeHtml(formatCompactText(item.topPhase)) + '</div><div class="muted-cell">' + escapeHtml(formatCompactText(item.latestError)) + '</div></td>'
        + '<td>' + escapeHtml(formatNumber(item.records)) + '</td>'
      + '</tr>'
    )).join('')
    : renderEmptyRow('暂无高频失败目标', 5);

  const logs = Array.isArray(listPayload.logs) ? listPayload.logs : [];
  document.getElementById('failureLogsBody').innerHTML = logs.length
    ? renderFailureLogRows(logs)
    : renderEmptyRow('暂无失败日志', 6);
}

async function bootAdminPage(pageName) {
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
      statusEl.textContent = '管理员会话已清空。';
    } catch (error) {
      statusEl.textContent = error.message || String(error);
    }
    usernameInput.value = '';
    passwordInput.value = '';
    rememberInput.checked = false;
    clearRememberedAdminCredentials();
  });

  try {
    if (pageName === 'overview') await loadOverview();
    if (pageName === 'orders') await loadOrdersPage();
    if (pageName === 'apiUsage') await loadApiUsagePage();
    if (pageName === 'siteUsage') await loadSiteUsagePage();
    if (pageName === 'failureLogs') {
      document.getElementById('failureSearchButton')?.addEventListener('click', () => {
        loadFailureLogsPage().catch((error) => {
          statusEl.textContent = error.message || String(error);
        });
      });
      await loadFailureLogsPage();
    }
    statusEl.textContent = '数据已刷新，管理员会话有效。';
  } catch (error) {
    statusEl.textContent = error.message || String(error);
  }
}

async function bootAdminLoginPage() {
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
  textarea, input[type="text"], input[type="password"], input[type="search"], select {
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
    max-width: 420px;
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
  return {
    plan: isActive ? 'pro' : 'free',
    planExpiresAt: data.planExpiresAt || null,
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

async function recordOfficialApiEvent({
  uid = '',
  clientHash = '',
  userType = 'free',
  locale = '',
  model = '',
  upstreamModel = '',
  tokenUsage = {},
  upstreamStatus = 0
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
    promptTokens: tokenCost.promptTokens,
    completionTokens: tokenCost.completionTokens,
    totalTokens: tokenCost.totalTokens,
    estimatedCost: tokenCost.estimatedCost,
    currency: tokenCost.currency,
    hasTokenUsage: tokenCost.totalTokens > 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

function safeLogString(value, limit = 500) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return limit > 0 && text.length > limit ? `${text.slice(0, limit)}...` : text;
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
  if (!siteNames.length && !agentIds.length) {
    const error = new Error('siteNames or agentIds is required');
    error.status = 400;
    throw error;
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
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
    hasQuery: req.body?.hasQuery === true,
    queryLength: Math.max(0, Math.min(20000, Math.round(Number(req.body?.queryLength) || 0))),
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
    yearly: String(process.env.STRIPE_PRICE_YEARLY || '').trim()
  };
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
  return new Set(Object.values(getStripePrices()).filter(Boolean));
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

async function createCheckoutSessionForFirebaseUser({
  firebaseUser,
  priceId,
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
    ...(smokeTest ? { smokeTest: 'true' } : {})
  };

  return stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: getCheckoutSuccessUrl(),
    cancel_url: getCancelUrl(),
    metadata,
    subscription_data: {
      metadata
    }
  });
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
    .actions[hidden],
    .fine-print[hidden] {
      display: none;
    }
    .result {
      display: grid;
      gap: 8px;
      margin-top: 22px;
      padding: 16px 18px;
      border-radius: 18px;
      background: rgba(24, 24, 24, 0.04);
      color: var(--muted);
      font-size: 14px;
      line-height: 1.5;
    }
    .result-row {
      display: flex;
      justify-content: space-between;
      gap: 18px;
    }
    .result-row strong {
      color: var(--text);
      font-weight: 800;
      text-align: right;
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
      .result-row {
        display: grid;
        gap: 2px;
      }
      .result-row strong {
        text-align: left;
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

      <div class="result" id="paymentResult" aria-live="polite">
        <div class="result-row"><span>Checkout status</span><strong id="checkoutStatus">Checking</strong></div>
        <div class="result-row"><span>Payment status</span><strong id="paymentStatus">Waiting</strong></div>
        <div class="result-row"><span>Membership sync</span><strong id="membershipStatus">Waiting</strong></div>
      </div>

      <div class="panel" id="nextPanel" hidden>
        <h2 class="panel-title">What to do next</h2>
        <ol class="steps">
          <li>Return to the extension Pro page.</li>
          <li>Check whether your <code>Chat Plan</code> status has changed to active.</li>
          <li>If it still looks unchanged, wait a few seconds and reopen the page once.</li>
        </ol>
      </div>

      <div class="actions" id="successActions" hidden>
        <a class="button button-primary" href="${membershipUrl}" id="membershipLink">Open Pro Membership</a>
        <a class="button button-secondary" href="/">Back to AICompare site</a>
      </div>

      <p class="fine-print" id="successNote" hidden>If you closed the extension earlier, reopening it and visiting the Pro page again is enough. Membership status is confirmed by the backend after Stripe finishes the subscription event sync.</p>
    </section>
  </main>
  <script>
    const sessionId = new URLSearchParams(window.location.search).get('session_id') || '';
    const statusBadge = document.getElementById('statusBadge');
    const statusIcon = document.getElementById('statusIcon');
    const statusLabel = document.getElementById('statusLabel');
    const pageTitle = document.getElementById('pageTitle');
    const pageLead = document.getElementById('pageLead');
    const checkoutStatus = document.getElementById('checkoutStatus');
    const paymentStatus = document.getElementById('paymentStatus');
    const membershipStatus = document.getElementById('membershipStatus');
    const nextPanel = document.getElementById('nextPanel');
    const successActions = document.getElementById('successActions');
    const successNote = document.getElementById('successNote');
    const membershipLink = document.getElementById('membershipLink');

    function updateResult(data) {
      checkoutStatus.textContent = data.checkoutStatus || 'Checking';
      paymentStatus.textContent = data.paymentStatus || 'Waiting';
      membershipStatus.textContent = data.subscriptionStatus || data.membershipStatus || 'Waiting';
    }

    function setPending(data) {
      updateResult(data || {});
      statusBadge.className = 'badge is-pending';
      statusIcon.className = 'badge-spinner';
      statusLabel.textContent = 'Waiting for payment result';
      pageTitle.textContent = 'Waiting for your payment result.';
      pageLead.textContent = 'We are confirming the final Stripe payment status. This usually takes a few seconds, so please keep this page open.';
      nextPanel.hidden = true;
      successActions.hidden = true;
      successNote.hidden = true;
    }

    function setSuccess(data) {
      updateResult(data || {});
      statusBadge.className = 'badge';
      statusIcon.className = 'badge-dot';
      statusLabel.textContent = 'Payment successful';
      pageTitle.textContent = 'Your Pro payment is complete.';
      pageLead.textContent = 'Stripe confirmed the payment successfully. You can now open AICompare and check your Pro membership status.';
      nextPanel.hidden = false;
      successActions.hidden = false;
      successNote.hidden = false;
    }

    function setFailed(data) {
      updateResult(data || {});
      statusBadge.className = 'badge is-failed';
      statusIcon.className = 'badge-dot';
      statusLabel.textContent = 'Payment not completed';
      pageTitle.textContent = 'We could not confirm this payment.';
      pageLead.textContent = 'The checkout session did not finish with a successful payment. You can return to AICompare and start a new checkout if needed.';
      nextPanel.hidden = true;
      successActions.hidden = true;
      successNote.hidden = true;
    }

    async function pollPaymentStatus() {
      if (!sessionId) {
        setPending({ checkoutStatus: 'Waiting for session', paymentStatus: 'Waiting', membershipStatus: 'Waiting' });
        window.setTimeout(pollPaymentStatus, 3000);
        return;
      }

      try {
        const response = await fetch('/payment-status?session_id=' + encodeURIComponent(sessionId), {
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

    membershipLink.addEventListener('click', (event) => {
      event.preventDefault();
      window.location.href = membershipLink.href;
    });

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
    apiUsage: pageName === 'apiUsage' ? 'active' : '',
    failureLogs: pageName === 'failureLogs' ? 'active' : ''
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
          <a class="nav-link ${active.apiUsage}" href="/admin/api-usage">使用统计</a>
          <a class="nav-link ${active.failureLogs}" href="/admin/failure-logs">失败日志</a>
        </nav>
      </article>
      <aside class="token-panel">
        <h2>管理员登录</h2>
        <p>使用独立后台账号密码登录。登录成功后，服务端会在当前浏览器写入一个 HttpOnly 管理员会话 Cookie。</p>
        <input id="usernameInput" type="text" autocomplete="username" placeholder="管理员账号" />
        <input id="passwordInput" type="password" autocomplete="current-password" placeholder="管理员密码" />
        <label class="remember-password-row">
          <input id="rememberPasswordInput" type="checkbox" />
          <span>保存账号密码（仅在可信设备使用）</span>
        </label>
        <div class="token-actions">
          <button id="saveTokenButton" type="button">登录</button>
          <button id="clearTokenButton" type="button">退出/清空</button>
        </div>
        <div class="status" id="tokenStatus"></div>
      </aside>
    </section>
    ${content}
    <p class="footer-note">说明：会员订单统计优先使用 Stripe 发票/订阅数据；API 统计只覆盖官方代理接口 <code>/officialAgentChat</code>。失败日志只保存脱敏后的错误摘要、queryPreview 和 queryHash。</p>
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
  const paymentSucceeded = checkoutStatus === 'complete' && paymentStatus === 'paid';
  const paymentFailed = checkoutStatus === 'expired'
    || ['canceled', 'failed'].includes(paymentStatus)
    || (checkoutStatus === 'complete' && paymentStatus === 'unpaid');

  if (paymentSucceeded && subscription) {
    await updateUserFromSubscription(subscription);
  }

  return {
    state: paymentSucceeded ? 'success' : (paymentFailed ? 'failed' : 'pending'),
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
    title: '使用统计后台',
    description: '合并查看官方 API 使用和站点对比使用，默认只展示最近 7 天数据。',
    content: `
      <h2 class="section-title">核心指标</h2>
      <section id="apiCards" class="grid"></section>
      <section class="card panel">
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
      <section class="card panel">
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
      <section class="card panel">
        <h3>最近使用记录</h3>
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>类型</th>
              <th>目标</th>
              <th>用户类型</th>
              <th>摘要</th>
              <th>版本</th>
            </tr>
          </thead>
          <tbody id="usageRecentBody">
            <tr><td colspan="6" class="empty-cell">等待加载...</td></tr>
          </tbody>
        </table>
      </section>
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
    description: '查看扩展同步到 VPS 的站点执行失败和 API 请求失败，默认按最新失败时间倒序。',
    content: `
      <h2 class="section-title">核心指标</h2>
      <section id="failureCards" class="grid"></section>
      <section class="card panel">
        <h3>筛选</h3>
        <div class="filter-row">
          <label>天数 <select id="failureDays"><option value="1">今天</option><option value="7" selected>近 7 天</option><option value="30">近 30 天</option></select></label>
          <label>类型 <select id="failureCategory"><option value="all">全部</option><option value="site">站点失败</option><option value="api">API 失败</option></select></label>
          <label>搜索 <input id="failureQuery" type="search" placeholder="站点、API、阶段、错误、URL、query、版本" /></label>
          <button id="failureSearchButton" type="button">刷新</button>
        </div>
      </section>
      <section class="card panel">
        <h3>近 30 天趋势</h3>
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
      <section class="card panel">
        <h3>高频失败站点 / API</h3>
        <table>
          <thead>
            <tr>
              <th>类型</th>
              <th>目标</th>
              <th>失败次数</th>
              <th>主要问题</th>
              <th>记录数</th>
            </tr>
          </thead>
          <tbody id="failureTopTargetsBody">
            <tr><td colspan="5" class="empty-cell">等待加载...</td></tr>
          </tbody>
        </table>
      </section>
      <section class="card panel">
        <h3>最近失败日志</h3>
        <table>
          <thead>
            <tr>
              <th>时间 / 上传</th>
              <th>类型</th>
              <th>目标 / 来源</th>
              <th>阶段 / 状态</th>
              <th>错误信息</th>
              <th>次数 / 用户</th>
            </tr>
          </thead>
          <tbody id="failureLogsBody">
            <tr><td colspan="6" class="empty-cell">等待加载...</td></tr>
          </tbody>
        </table>
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
    const estimatedCost = Math.max(0, Number(data.estimatedCost) || 0);
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
    rows.push({
      id: doc.id,
      dateKey,
      uid: String(data.uid || ''),
      clientHash: String(data.clientHash || ''),
      userType: String(data.userType || '').trim() || 'free',
      locale: String(data.locale || ''),
      model: String(data.upstreamModel || data.model || ''),
      upstreamStatus: Math.max(0, Number(data.upstreamStatus) || 0),
      promptTokens: Math.max(0, Number(data.promptTokens) || 0),
      completionTokens: Math.max(0, Number(data.completionTokens) || 0),
      totalTokens: Math.max(0, Number(data.totalTokens) || 0),
      estimatedCost: Math.max(0, Number(data.estimatedCost) || 0),
      currency: String(data.currency || officialAgentCostCurrency || 'usd'),
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
    hasQuery: data.hasQuery === true,
    queryLength: Math.max(0, Number(data.queryLength) || 0),
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
    last30Days: summarizeSiteUsageRows(rows)
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
  const rows = await listSiteCompareEvents(getRecentDateKeys(days));
  const bySite = new Map();
  rows.forEach((row) => {
    const allNames = [...row.siteNames, ...row.agentIds.map((agentId) => `Agent: ${agentId}`)];
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
  const [apiTrend, siteRows] = await Promise.all([
    buildUsageTrend(7),
    listSiteCompareEvents(dateKeys)
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
    }
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

async function getCombinedUsageRecentData(req) {
  const days = clamp(parseInteger(req.query?.days, 7), 1, 7);
  const limit = clamp(parseInteger(req.query?.limit, 100), 1, 200);
  const dateKeys = getRecentDateKeys(days);
  const [apiRows, siteRows] = await Promise.all([
    listOfficialApiEvents(dateKeys),
    listSiteCompareEvents(dateKeys)
  ]);
  const events = [
    ...apiRows.map((row) => ({
      kind: 'api',
      createdAt: row.createdAt,
      target: row.model || 'official API',
      userType: row.userType === 'anonymous' ? '匿名' : (row.userType === 'pro' ? 'Pro' : '免费'),
      detail: [
        row.upstreamStatus ? `HTTP ${row.upstreamStatus}` : '',
        row.totalTokens ? `${Math.round(row.totalTokens)} tokens` : '',
        row.locale || ''
      ].filter(Boolean).join(' · '),
      extensionVersion: ''
    })),
    ...siteRows.map((row) => ({
      kind: 'site',
      createdAt: row.createdAt || row.updatedAt,
      target: [...row.siteNames, ...row.agentIds.map((agentId) => `Agent: ${agentId}`)].join(', ') || '站点对比',
      userType: row.uploaderType === 'anonymous' ? '匿名' : '登录用户',
      detail: [
        `${row.siteCount + row.agentCount} 个目标`,
        row.hasQuery ? '带 query' : '仅打开',
        row.locale || ''
      ].filter(Boolean).join(' · '),
      extensionVersion: row.extensionVersion || ''
    }))
  ].sort((left, right) => {
    const rightTs = Date.parse(right.createdAt || 0) || 0;
    const leftTs = Date.parse(left.createdAt || 0) || 0;
    return rightTs - leftTs;
  });
  return {
    events: events.slice(0, limit)
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

app.get('/billingConfig', (_req, res) => {
  res.json({
    mode: billingMode,
    prices: getStripePrices()
  });
});

app.post('/createCheckoutSession', asyncRoute(async (req, res) => {
  const user = await requireUser(req);
  const priceId = String(req.body?.priceId || '').trim();
  if (!priceId) {
    res.status(400).json({ error: 'priceId is required' });
    return;
  }
  assertCheckoutPriceAllowed(priceId);

  const session = await createCheckoutSessionForFirebaseUser({
    firebaseUser: user,
    priceId
  });

  res.json({ url: session.url });
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
    [getStripeCustomerIdField()]: String(subscription.customer || ''),
    stripeSubscriptionId: subscription.id,
    [getStripeSubscriptionIdField()]: subscription.id,
    subscriptionStatus: subscription.status,
    billingMode,
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
      userType: usageResult?.plan === 'pro' ? 'pro' : 'free',
      locale,
      model: effectiveModel
    };
  } else {
    const anonymousClientId = getAnonymousClientId(req);
    usageResult = await consumeAnonymousOfficialApiUsage(anonymousClientId, locale);
    eventPayload = {
      uid: '',
      clientHash: getAnonymousUsageDocId(anonymousClientId),
      userType: 'anonymous',
      locale,
      model: effectiveModel
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
});
