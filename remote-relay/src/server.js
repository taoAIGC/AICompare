const http = require('node:http');
const { URL } = require('node:url');

const express = require('express');
const MarkdownIt = require('markdown-it');
const QRCode = require('qrcode');
const { WebSocketServer } = require('ws');

const remoteCommon = require('../../remote/common.js');
const remoteCrypto = require('../../remote/crypto.js');
const { createMetadataStore } = require('./store.js');

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const TICKET_TTL_MS = 5 * 60 * 1000;
const SHARE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const WS_OPEN_STATE = 1;
const shareMarkdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true
});

function isFreshTimestamp(timestamp) {
  const parsed = Date.parse(String(timestamp || ''));
  if (!Number.isFinite(parsed)) {
    return false;
  }
  return Math.abs(Date.now() - parsed) <= MAX_CLOCK_SKEW_MS;
}

function sanitizeDeviceBody(body = {}) {
  return {
    deviceId: String(body.deviceId || '').trim(),
    deviceName: String(body.deviceName || '').trim(),
    platform: String(body.platform || '').trim(),
    deviceSecretHash: String(body.deviceSecretHash || '').trim(),
    publicKey: body.publicKey && typeof body.publicKey === 'object' ? body.publicKey : null,
    fingerprint: String(body.fingerprint || '').trim()
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

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeShareResponse(response) {
  if (!response || typeof response !== 'object') {
    return {
      siteName: '',
      answers: [],
      content: '',
      error: ''
    };
  }

  return {
    siteName: normalizeString(response.siteName),
    answers: normalizeArray(response.answers)
      .map((item) => normalizeString(item))
      .filter(Boolean),
    content: normalizeString(response.content),
    error: normalizeString(response.error)
  };
}

function normalizeShareResponses(responses) {
  return normalizeArray(responses).map(normalizeShareResponse);
}

function renderMarkdownToHtml(markdownText) {
  const source = normalizeBrokenMarkdownCodeFences(String(markdownText || '').replace(/\r\n?/g, '\n'));
  if (!source.trim()) {
    return '<p class="share-empty">暂无内容</p>';
  }
  return repairBrokenMarkdownArtifacts(shareMarkdown.render(source));
}

function looksLikeBrokenCodeFenceContent(text) {
  const normalized = String(text || '').trim();
  if (!normalized) {
    return false;
  }
  const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) {
    return false;
  }
  const shortLineCount = lines.filter((line) => line.length <= 48).length;
  const arrowLikeCount = lines.filter((line) => /^[↓↘↙→←↑\-|>]+$/.test(line)).length;
  const labelLikeCount = lines.filter((line) => /[:：]|（.*）|\(.*\)/.test(line)).length;
  return shortLineCount >= Math.max(2, Math.ceil(lines.length * 0.75))
    && (arrowLikeCount >= 1 || labelLikeCount >= 1 || lines.length >= 4);
}

function normalizeBrokenMarkdownCodeFences(markdownText) {
  const source = String(markdownText || '');
  if (!source.trim()) {
    return source;
  }

  const emptyFencePattern = /```[^\n]*\n\s*```/g;
  const emptyFenceMatchCount = source.match(emptyFencePattern)?.length || 0;
  if (emptyFenceMatchCount < 2) {
    return source;
  }

  return source.replace(
    /```[^\n]*\n\s*```(?:\n+)([\s\S]*?)(?:\n+)```[^\n]*\n\s*```/g,
    (match, bodyText) => {
      const normalizedBody = String(bodyText || '').replace(/\n{3,}/g, '\n\n').trim();
      if (!looksLikeBrokenCodeFenceContent(normalizedBody)) {
        return match;
      }
      return `\`\`\`\n${normalizedBody}\n\`\`\``;
    }
  );
}

function decodeSimpleHtmlEntities(text) {
  return String(text || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<\/?p>/gi, '');
}

function looksLikeBrokenDiagramBlock(text) {
  const normalized = String(text || '').trim();
  if (!normalized) {
    return false;
  }
  const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length < 3) {
    return false;
  }
  const arrowOnlyCount = lines.filter((line) => /^[↓↘↙→←↑\-|>]+$/.test(line)).length;
  const shortLineCount = lines.filter((line) => line.length <= 24).length;
  return arrowOnlyCount >= 1 && shortLineCount >= Math.max(3, lines.length - 1);
}

function repairBrokenMarkdownArtifacts(html) {
  const source = String(html || '');
  if (!source) {
    return source;
  }

  return source.replace(
    /<pre><code><\/code><\/pre>\s*<p>([\s\S]*?)<\/p>\s*<pre><code><\/code><\/pre>/gi,
    (match, paragraphHtml) => {
      const decoded = decodeSimpleHtmlEntities(paragraphHtml);
      if (!looksLikeBrokenDiagramBlock(decoded)) {
        return match;
      }
      return `<pre><code>${escapeHtml(decoded.trim())}</code></pre>`;
    }
  );
}

function getShareResponseBody(response) {
  if (response.error) {
    return `提取失败：${response.error}`;
  }
  if (response.content) {
    return response.content;
  }
  if (response.answers.length) {
    return response.answers.join('\n\n');
  }
  return '';
}

function truncateText(text, maxLength = 220) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function stripShareSummaryRawAnswerSection(summaryText) {
  const source = String(summaryText || '').trim();
  if (!source) {
    return '';
  }

  const cutMarkers = [
    /(?:^|\n{2,})各站原始答案汇总：/i,
    /(?:^|\n{2,})各站原始答案:/i,
    /(?:^|\n{2,})各站原始答案：/i,
    /(?:^|\n{2,})原始答案汇总：/i,
    /(?:^|\n{2,})Raw answers:/i,
    /(?:^|\n{2,})Responses summary:/i,
    /(?:^|\n{2,})【[^】]+】\n/,
    /(?:^|\n{2,})\[[^\]]+\]\n/
  ];

  let endIndex = source.length;
  for (const pattern of cutMarkers) {
    const match = source.match(pattern);
    if (match && typeof match.index === 'number' && match.index < endIndex) {
      endIndex = match.index;
    }
  }

  return source.slice(0, endIndex).trim();
}

function createRelayServer(options = {}) {
  const logger = options.logger || console;
  const publicBaseUrl = String(options.publicBaseUrl || process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  const store = options.store || createMetadataStore({
    logger,
    useFirestore: options.useFirestore !== false,
    projectId: options.projectId
  });

  const app = express();
  app.use(express.json({ limit: '512kb' }));

  const server = options.server || http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  const connections = new Map();

  function logFrameEvent(label, meta = {}) {
    logger.info(`[remote-relay] ${label}`, {
      ...meta,
      loggedAt: remoteCommon.nowIso()
    });
  }

  function registerConnection(deviceId, ws, meta = {}) {
    const existing = connections.get(deviceId);
    if (existing && existing.ws && existing.ws !== ws) {
      try {
        existing.ws.close();
      } catch (_) {
        // Ignore close errors for replaced connections.
      }
    }
    connections.set(deviceId, {
      ws,
      ...meta,
      connectedAt: remoteCommon.nowIso()
    });
  }

  function clearConnectionBySocket(ws) {
    for (const [deviceId, connection] of connections.entries()) {
      if (connection.ws === ws) {
        connections.delete(deviceId);
      }
    }
  }

  function sendFrame(deviceId, frame) {
    const connection = connections.get(deviceId);
    if (!connection || !connection.ws || connection.ws.readyState !== WS_OPEN_STATE) {
      return false;
    }
    connection.ws.send(JSON.stringify(frame));
    return true;
  }

  function sanitizeSharePayload(body = {}) {
    const payload = body && typeof body === 'object' ? body : {};
    return {
      version: Number(payload.version) || 1,
      entry: payload.entry && typeof payload.entry === 'object' ? payload.entry : null,
      question: String(payload.question || '').trim(),
      summaryText: String(payload.summaryText || '').trim(),
      responses: Array.isArray(payload.responses) ? payload.responses : [],
      compareSites: Array.isArray(payload.compareSites) ? payload.compareSites : [],
      successCount: Math.max(0, Number(payload.successCount) || 0),
      totalCount: Math.max(0, Number(payload.totalCount) || 0),
      analysisTemplateId: String(payload.analysisTemplateId || '').trim(),
      analysisTemplateName: String(payload.analysisTemplateName || '').trim(),
      analysisTemplateQuery: String(payload.analysisTemplateQuery || '').trim()
    };
  }

  function buildPublicUrl(pathname = '/') {
    const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
    return publicBaseUrl ? `${publicBaseUrl}${normalizedPath}` : normalizedPath;
  }

  function getSharePageLocale(req = null) {
    const acceptLanguage = String(req?.headers?.['accept-language'] || '').toLowerCase();
    if (acceptLanguage.startsWith('zh') || acceptLanguage.includes(',zh') || acceptLanguage.includes(';q=') && acceptLanguage.includes('zh')) {
      return 'zh-CN';
    }
    return 'en';
  }

  function getSharePageMessages(locale = 'en') {
    if (locale === 'zh-CN') {
      return {
        continueCompare: '继续 AI 对比',
        snapshotTimeLabel: '快照时间（北京时间 UTC+8）',
        compareSitesLabel: '对比站点',
        snapshotToolLabel: '快照工具',
        summaryTitle: '总结分析',
        snapshotTimeUnknown: '未知',
        snapshotToolName: 'AICompare',
        metaSeparator: '；',
        siteSeparator: '、'
      };
    }

    return {
      continueCompare: 'Continue AI Compare',
      snapshotTimeLabel: 'Snapshot time (UTC+8)',
      compareSitesLabel: 'Compared sites',
      snapshotToolLabel: 'Snapshot tool',
      summaryTitle: 'Summary analysis',
      snapshotTimeUnknown: 'Unknown',
      snapshotToolName: 'AICompare',
      metaSeparator: '; ',
      siteSeparator: ', '
    };
  }

  function uniqueNonEmptyStrings(values = []) {
    const seen = new Set();
    const result = [];

    for (const value of values) {
      const normalized = String(value || '').trim();
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      result.push(normalized);
    }

    return result;
  }

  function formatShareSnapshotTime(value, locale = 'en') {
    const timestamp = Date.parse(String(value || '').trim());
    if (!Number.isFinite(timestamp)) {
      return '';
    }

    const date = new Date(timestamp);
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    const parts = formatter.formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const year = values.year;
    const month = values.month;
    const day = values.day;
    const hour = values.hour;
    const minute = values.minute;

    if (locale === 'zh-CN') {
      return `${year}年${month}月${day}日 ${hour}:${minute}`;
    }

    return `${year}-${month}-${day} ${hour}:${minute}`;
  }

  function renderSharePage(shareId, shareRecord = null, options = {}) {
    const title = shareRecord?.payload?.question ? `${shareRecord.payload.question} - AI Compare` : 'AI Compare Share';
    const extensionInstallUrl = 'https://chromewebstore.google.com/detail/ai-compare-oneclick-to-co/dkhpgbbhlnmjbkihoeniojpkggkabbbl';
    const locale = String(options.locale || 'en');
    const messages = getSharePageMessages(locale);
    const responses = normalizeShareResponses(shareRecord?.payload?.responses);
    const questionText = String(shareRecord?.payload?.question || '').trim();
    const summaryText = stripShareSummaryRawAnswerSection(shareRecord?.payload?.summaryText || '');
    const snapshotTimeText = formatShareSnapshotTime(shareRecord?.createdAt, locale) || messages.snapshotTimeUnknown;
    const compareSiteNames = uniqueNonEmptyStrings(
      Array.isArray(shareRecord?.payload?.compareSites) && shareRecord.payload.compareSites.length
        ? shareRecord.payload.compareSites
        : responses.map((response) => response.siteName)
    );
    const compareSitesText = compareSiteNames.join(messages.siteSeparator);
    const metaItems = [
      `${messages.snapshotTimeLabel}${locale === 'zh-CN' ? '：' : ': '}${snapshotTimeText}`
    ];

    if (compareSitesText) {
      metaItems.push(`${messages.compareSitesLabel}${locale === 'zh-CN' ? '：' : ': '}${compareSitesText}`);
    }

    metaItems.push(`${messages.snapshotToolLabel}${locale === 'zh-CN' ? '：' : ': '}${messages.snapshotToolName}`);
    const snapshotMetaText = metaItems.join(messages.metaSeparator);
    const responseCards = responses.length
      ? responses.map((response, index) => {
        const siteName = escapeHtml(response.siteName || 'Unknown');
        const anchorId = `site-${index + 1}`;
        const bodyText = getShareResponseBody(response);
        const bodyHtml = renderMarkdownToHtml(bodyText);
        return `<section class="share-panel iframe-container" id="${anchorId}">
          <div class="share-panel-header iframe-header">
            <div class="site-name">${siteName}</div>
          </div>
          <div class="share-panel-body snapshot-panel markdown">${bodyHtml}</div>
        </section>`;
      }).join('\n')
      : '<p class="share-empty">暂无可展示的回答</p>';
    const summaryCard = summaryText
      ? `<section class="share-summary-card iframe-container">
          <div class="share-panel-header iframe-header">
            <div class="site-name">${escapeHtml(messages.summaryTitle)}</div>
          </div>
          <div class="share-panel-body snapshot-panel markdown">${renderMarkdownToHtml(summaryText)}</div>
        </section>`
      : '';

    return `<!doctype html>
<html lang="${escapeHtml(locale)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root{
      color-scheme: light;
      --share-bg:#f7f8fb;
      --share-surface:#ffffff;
      --share-surface-soft:#f5f7fb;
      --share-border:#dfe3eb;
      --share-border-strong:#d0d6e0;
      --share-text:#1f2328;
      --share-text-muted:#697180;
      --share-shadow:0 12px 32px rgba(15, 23, 42, 0.08);
      --share-radius:12px;
      --share-gap:16px;
    }
    *{box-sizing:border-box}
    html{scroll-behavior:smooth}
    body{
      margin:0;
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
      color:var(--share-text);
      background:var(--share-bg);
    }
    .share-page{
      max-width:1400px;
      margin:0 auto;
      padding:20px 16px 24px;
    }
    .share-sticky-header{
      position:sticky;
      top:0;
      z-index:40;
      margin:0 0 16px;
      padding:12px 0 10px;
      background:linear-gradient(180deg, rgba(247,248,251,0.98) 0%, rgba(247,248,251,0.96) 76%, rgba(247,248,251,0) 100%);
      backdrop-filter:blur(14px);
    }
    .share-query-bar{
      margin:0;
      padding:14px 18px;
      border:1px solid var(--share-border);
      border-radius:12px;
      background:var(--share-surface);
      box-shadow:var(--share-shadow);
      display:flex;
      align-items:flex-start;
      justify-content:space-between;
      gap:16px;
    }
    .share-query-actions{
      display:flex;
      align-items:center;
      gap:12px;
      flex-shrink:0;
    }
    .share-query{
      margin:0;
      display:flex;
      align-items:center;
      font-size:18px;
      line-height:1.45;
      font-weight:700;
      white-space:pre-wrap;
      word-break:break-word;
      flex:1;
      min-width:0;
    }
    .share-meta-bar{
      margin:10px 0 0;
      padding:0 6px;
      font-size:13px;
      line-height:1.5;
      color:var(--share-text-muted);
      word-break:break-word;
    }
    .share-continue-btn{
      display:inline-flex;
      align-items:center;
      justify-content:center;
      min-height:40px;
      padding:0 16px;
      border-radius:10px;
      border:1px solid #111827;
      background:#111827;
      color:#fff;
      text-decoration:none;
      font-size:14px;
      line-height:1;
      font-weight:700;
      white-space:nowrap;
      transition:background-color .18s ease,border-color .18s ease,transform .18s ease;
      flex-shrink:0;
    }
    .share-continue-btn:hover{
      background:#1f2937;
      border-color:#1f2937;
      transform:translateY(-1px);
    }
    .share-panels{
      display:grid;
      grid-template-columns:repeat(auto-fit, minmax(500px, 1fr));
      gap:var(--share-gap);
      align-items:start;
    }
    .share-summary-card{
      margin-bottom:16px;
      border-radius:18px;
      border-color:rgba(17, 17, 17, 0.08);
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(248, 248, 248, 0.98)),
        radial-gradient(circle at top right, rgba(17, 17, 17, 0.05), transparent 42%);
      box-shadow:0 12px 28px rgba(15, 23, 42, 0.06);
      backdrop-filter:blur(12px);
      overflow:hidden;
    }
    .share-summary-card .iframe-header{
      align-items:center;
      min-height:unset;
      padding:16px 18px 10px;
      background:transparent;
      border-bottom:none;
    }
    .share-summary-card .iframe-header .site-name{
      font-size:16px;
      line-height:1.2;
      font-weight:600;
      color:#111111;
    }
    .share-summary-card .snapshot-panel{
      min-height:auto;
      padding:0 18px 18px;
      background:transparent;
    }
    .share-summary-card .markdown{
      font-size:14px;
      line-height:1.76;
      color:#1f2328;
    }
    .share-summary-card .markdown > :first-child{
      margin-top:0;
    }
    .share-summary-card .markdown > :last-child{
      margin-bottom:0;
    }
    .share-summary-card .markdown h1,
    .share-summary-card .markdown h2,
    .share-summary-card .markdown h3,
    .share-summary-card .markdown h4,
    .share-summary-card .markdown h5,
    .share-summary-card .markdown h6{
      font-size:15px;
      line-height:1.45;
      font-weight:700;
      color:#111111;
    }
    .share-summary-card .markdown blockquote{
      border-left-color:rgba(17, 17, 17, 0.14);
      color:#5f5f5f;
      padding-left:14px;
    }
    .share-summary-card .markdown pre{
      background:rgba(255,255,255,0.64);
      border-color:rgba(17, 17, 17, 0.08);
      box-shadow:inset 0 1px 0 rgba(255,255,255,0.68);
    }
    .share-summary-card .markdown code{
      background:rgba(17, 17, 17, 0.05);
    }
    .share-footer-actions{
      display:flex;
      justify-content:center;
      margin-top:20px;
    }
    .iframe-container{
      background:var(--share-surface);
      border:1px solid var(--share-border);
      border-radius:12px;
      overflow:hidden;
      box-shadow:var(--share-shadow);
      min-height:320px;
    }
    .iframe-header{
      display:flex;
      justify-content:space-between;
      align-items:center;
      padding:8px 12px;
      min-height:40px;
      background:linear-gradient(180deg, #f8fafc 0%, #ffffff 100%);
      border-bottom:1px solid var(--share-border);
    }
    .iframe-header .site-name{
      font-size:13px;
      line-height:1.2;
      font-weight:700;
      color:var(--share-text);
    }
    .snapshot-panel{
      background:#ffffff;
      min-height:280px;
      padding:16px;
    }
    .markdown{
      font-size:14px;
      line-height:1.72;
      color:var(--share-text);
      word-break:break-word;
    }
    .markdown p,.markdown ul,.markdown ol,.markdown blockquote,.markdown pre{margin:0 0 14px}
    .markdown ul,.markdown ol{padding-left:22px}
    .markdown li + li{margin-top:6px}
    .markdown blockquote{
      border-left:3px solid #d0d7de;
      padding-left:12px;
      color:var(--share-text-muted);
    }
    .markdown pre{
      white-space:pre-wrap;
      word-break:break-word;
      font:13px/1.7 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;
      background:var(--share-surface-soft);
      border:1px solid var(--share-border);
      border-radius:10px;
      padding:14px 16px;
    }
    .markdown code{
      font:13px ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;
      background:var(--share-surface-soft);
      border-radius:6px;
      padding:2px 6px;
    }
    .markdown pre code{background:transparent;padding:0;border-radius:0}
    .markdown h2,.markdown h3,.markdown h4,.markdown h5,.markdown h6{
      margin:0 0 12px;
      font-size:18px;
      line-height:1.4;
      font-weight:700;
      color:var(--share-text);
      text-transform:none;
    }
    .markdown a{color:#0969da;text-decoration:none}
    .markdown a:hover{text-decoration:underline}
    .share-empty{
      margin:0;
      padding:20px;
      border:1px dashed var(--share-border-strong);
      border-radius:12px;
      background:var(--share-surface);
      color:var(--share-text-muted);
      font-size:14px;
      line-height:1.6;
    }
    @media (max-width: 640px){
      .share-page{padding:14px 12px 20px}
      .share-sticky-header{padding:10px 0 8px}
      .share-query-bar{padding:12px 14px;flex-direction:column;align-items:stretch}
      .share-query{font-size:16px}
      .share-meta-bar{margin:8px 0 0;padding:0 2px;font-size:12px}
      .share-summary-card .iframe-header{padding:14px 14px 8px}
      .share-summary-card .snapshot-panel{padding:0 14px 14px}
      .share-query-actions{flex-direction:column;align-items:stretch}
      .share-continue-btn{width:100%}
      .share-panels{grid-template-columns:1fr}
      .share-footer-actions{justify-content:center}
      .snapshot-panel{padding:14px}
    }
  </style>
</head>
<body>
  <div class="share-page">
    <div class="share-sticky-header">
      <div class="share-query-bar">
        <div class="share-query">${escapeHtml(questionText)}</div>
        <div class="share-query-actions">
          <a class="share-continue-btn" href="${escapeHtml(extensionInstallUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(messages.continueCompare)}</a>
        </div>
      </div>
      <div class="share-meta-bar">${escapeHtml(snapshotMetaText)}</div>
    </div>
    ${summaryCard}
    <div class="share-panels">
      ${responseCards}
    </div>
    <div class="share-footer-actions">
      <a class="share-continue-btn" href="${escapeHtml(extensionInstallUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(messages.continueCompare)}</a>
    </div>
  </div>
</body>
</html>`;
  }

  async function verifyFrameAuth(frame) {
    if (!frame || typeof frame !== 'object') {
      return {
        ok: false,
        error: 'invalid_frame'
      };
    }

    const deviceId = String(frame.deviceId || '').trim();
    if (!deviceId) {
      return {
        ok: false,
        error: 'missing_device_id'
      };
    }

    const device = await store.getDevice(deviceId);
    if (!device || !device.deviceSecretHash) {
      return {
        ok: false,
        error: 'unknown_device'
      };
    }

    if (!isFreshTimestamp(frame.timestamp)) {
      return {
        ok: false,
        error: 'stale_timestamp'
      };
    }

    const proofValid = await remoteCrypto.verifyDeviceProof({
      authKey: device.deviceSecretHash,
      deviceId,
      route: frame.type,
      challenge: frame.challenge,
      timestamp: frame.timestamp,
      proof: frame.proof
    });

    if (!proofValid) {
      return {
        ok: false,
        error: 'invalid_proof'
      };
    }

    return {
      ok: true,
      device
    };
  }

  async function routePairRequest(frame, senderDevice) {
    const pairingTicket = await store.getPairingTicket(frame.ticketId);
    if (!pairingTicket || pairingTicket.status === 'revoked') {
      return {
        ok: false,
        error: 'ticket_not_found'
      };
    }

    if (Date.parse(pairingTicket.expiresAt) <= Date.now()) {
      await store.updatePairingTicket(pairingTicket.ticketId, {
        status: 'expired'
      });
      return {
        ok: false,
        error: 'ticket_expired'
      };
    }

    if (pairingTicket.desktopDeviceId !== frame.desktopDeviceId) {
      return {
        ok: false,
        error: 'desktop_device_mismatch'
      };
    }

    const pairId = remoteCommon.createId('pair');
    const pairRecord = await store.createPairRecord({
      pairId,
      status: 'pending',
      desktopDeviceId: frame.desktopDeviceId,
      phoneDeviceId: senderDevice.deviceId,
      desktopFingerprint: pairingTicket.desktopFingerprint || '',
      phoneFingerprint: senderDevice.fingerprint || '',
      createdAt: remoteCommon.nowIso()
    });

    await store.updatePairingTicket(pairingTicket.ticketId, {
      status: 'pending',
      claimedByDeviceId: senderDevice.deviceId,
      claimedAt: remoteCommon.nowIso(),
      activePairId: pairId
    });

    const delivered = sendFrame(frame.desktopDeviceId, {
      type: remoteCommon.FRAME_TYPES.PAIR_REQUEST,
      pairId,
      ticketId: pairingTicket.ticketId,
      desktopDeviceId: frame.desktopDeviceId,
      phoneDeviceId: senderDevice.deviceId,
      phoneName: frame.phoneName,
      phonePlatform: frame.phonePlatform,
      phoneFingerprint: senderDevice.fingerprint || frame.phoneFingerprint || '',
      phonePublicKey: senderDevice.publicKey || frame.phonePublicKey || null,
      ciphertext: frame.ciphertext,
      iv: frame.iv,
      createdAt: frame.createdAt || remoteCommon.nowIso()
    });

    if (!delivered) {
      await store.revokePair(pairId, 'relay');
      return {
        ok: false,
        error: 'desktop_offline'
      };
    }

    logFrameEvent('pair.request', {
      pairId,
      desktopDeviceId: frame.desktopDeviceId,
      phoneDeviceId: senderDevice.deviceId
    });

    return {
      ok: true,
      pairRecord
    };
  }

  async function routePairDecision(frame, senderDevice, approved) {
    const pairRecord = await store.getPairRecord(frame.pairId);
    if (!pairRecord || pairRecord.desktopDeviceId !== senderDevice.deviceId) {
      return {
        ok: false,
        error: 'pair_not_found'
      };
    }

    const nextStatus = approved ? 'active' : 'rejected';
    await store.updatePairRecord(frame.pairId, {
      status: nextStatus,
      approvedAt: approved ? remoteCommon.nowIso() : '',
      rejectedAt: approved ? '' : remoteCommon.nowIso()
    });

    const delivered = sendFrame(pairRecord.phoneDeviceId, {
      type: approved ? remoteCommon.FRAME_TYPES.PAIR_APPROVE : remoteCommon.FRAME_TYPES.PAIR_REJECT,
      pairId: frame.pairId,
      desktopDeviceId: senderDevice.deviceId,
      phoneDeviceId: pairRecord.phoneDeviceId,
      ciphertext: frame.ciphertext || '',
      iv: frame.iv || '',
      createdAt: remoteCommon.nowIso()
    });

    if (!delivered) {
      return {
        ok: false,
        error: 'phone_offline'
      };
    }

    logFrameEvent(approved ? 'pair.approve' : 'pair.reject', {
      pairId: frame.pairId,
      desktopDeviceId: senderDevice.deviceId,
      phoneDeviceId: pairRecord.phoneDeviceId
    });

    return {
      ok: true
    };
  }

  async function routeSearchFrame(frame, senderDevice, expectedSenderRole) {
    const pairRecord = await store.getPairRecord(frame.pairId);
    if (!pairRecord || pairRecord.status !== 'active') {
      return {
        ok: false,
        error: 'pair_not_active'
      };
    }

    const senderMatches = expectedSenderRole === 'phone'
      ? pairRecord.phoneDeviceId === senderDevice.deviceId
      : pairRecord.desktopDeviceId === senderDevice.deviceId;

    if (!senderMatches) {
      return {
        ok: false,
        error: 'sender_mismatch'
      };
    }

    const targetDeviceId = expectedSenderRole === 'phone'
      ? pairRecord.desktopDeviceId
      : pairRecord.phoneDeviceId;
    const delivered = sendFrame(targetDeviceId, frame);
    if (!delivered) {
      return {
        ok: false,
        error: 'target_offline'
      };
    }

    logFrameEvent(frame.type, {
      pairId: frame.pairId,
      requestId: frame.requestId || '',
      senderDeviceId: senderDevice.deviceId,
      targetDeviceId,
      ciphertextSize: String(frame.ciphertext || '').length
    });

    return {
      ok: true
    };
  }

  app.get('/healthz', (req, res) => {
    res.json({
      ok: true,
      protocolVersion: remoteCommon.REMOTE_PROTOCOL_VERSION,
      connectedDevices: connections.size
    });
  });

  app.get('/share/healthz', (req, res) => {
    res.json({
      ok: true,
      shareTtlMs: SHARE_TTL_MS
    });
  });

  app.post('/shares', async (req, res, next) => {
    try {
      const payload = sanitizeSharePayload(req.body);
      if (!payload.question && !payload.summaryText && !payload.responses.length) {
        res.status(400).json({ ok: false, error: 'empty_share_payload' });
        return;
      }

      const shareId = remoteCommon.createId('share');
      const expiresAt = new Date(Date.now() + SHARE_TTL_MS).toISOString();
      const record = await store.createShareRecord({
        shareId,
        status: 'active',
        expiresAt,
        payload
      });

      res.status(201).json({
        ok: true,
        shareId,
        expiresAt,
        shareUrl: `/share/${encodeURIComponent(shareId)}`,
        publicUrl: buildPublicUrl(`/share/${encodeURIComponent(shareId)}`)
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/shares/:shareId', async (req, res, next) => {
    try {
      const shareId = String(req.params.shareId || '').trim();
      const shareRecord = await store.getShareRecord(shareId);
      if (!shareRecord) {
        res.status(404).json({ ok: false, error: 'share_not_found' });
        return;
      }
      if (Date.parse(shareRecord.expiresAt) <= Date.now()) {
        await store.updateShareRecord(shareId, { status: 'expired' });
        res.status(410).json({ ok: false, error: 'share_expired' });
        return;
      }
      res.json({
        ok: true,
        shareId,
        expiresAt: shareRecord.expiresAt,
        payload: shareRecord.payload
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/share/:shareId', async (req, res, next) => {
    try {
      const shareId = String(req.params.shareId || '').trim();
      const viewMode = String(req.query.view || '').trim().toLowerCase() === 'image' ? 'image' : 'web';
      const shareRecord = await store.getShareRecord(shareId);
      if (!shareRecord) {
        res.status(404).type('text/plain').send('Share not found');
        return;
      }
      if (Date.parse(shareRecord.expiresAt) <= Date.now()) {
        await store.updateShareRecord(shareId, { status: 'expired' });
        res.status(410).type('text/plain').send('Share expired');
        return;
      }
      res.type('text/html').send(renderSharePage(shareId, shareRecord, {
        locale: getSharePageLocale(req),
        viewMode
      }));
    } catch (error) {
      next(error);
    }
  });

  app.get('/qr', async (req, res, next) => {
    try {
      const qrData = String(req.query.data || '').trim();
      if (!qrData) {
        res.status(400).json({
          ok: false,
          error: 'missing_qr_data'
        });
        return;
      }

      const svg = await QRCode.toString(qrData, {
        type: 'svg',
        margin: 1,
        errorCorrectionLevel: 'M',
        color: {
          dark: '#111111',
          light: '#ffffff'
        }
      });

      res.type('image/svg+xml').send(svg);
    } catch (error) {
      next(error);
    }
  });

  app.post('/pairing-tickets', async (req, res, next) => {
    try {
      const device = sanitizeDeviceBody(req.body);
      if (!device.deviceId || !device.deviceSecretHash || !device.publicKey) {
        res.status(400).json({
          ok: false,
          error: 'missing_device_fields'
        });
        return;
      }

      await store.upsertDevice(device);
      const ticketId = remoteCommon.createId('ticket');
      const expiresAt = new Date(Date.now() + TICKET_TTL_MS).toISOString();
      await store.createPairingTicket({
        ticketId,
        desktopDeviceId: device.deviceId,
        desktopFingerprint: device.fingerprint || '',
        status: 'open',
        expiresAt
      });

      res.status(201).json({
        ok: true,
        ticketId,
        expiresAt
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/pairing-tickets/:ticketId/claim', async (req, res, next) => {
    try {
      const ticketId = String(req.params.ticketId || '').trim();
      const pairingTicket = await store.getPairingTicket(ticketId);
      if (!pairingTicket || pairingTicket.status === 'revoked') {
        res.status(404).json({
          ok: false,
          error: 'ticket_not_found'
        });
        return;
      }

      if (Date.parse(pairingTicket.expiresAt) <= Date.now()) {
        await store.updatePairingTicket(ticketId, {
          status: 'expired'
        });
        res.status(410).json({
          ok: false,
          error: 'ticket_expired'
        });
        return;
      }

      const phoneDevice = sanitizeDeviceBody(req.body);
      if (!phoneDevice.deviceId || !phoneDevice.deviceSecretHash || !phoneDevice.publicKey) {
        res.status(400).json({
          ok: false,
          error: 'missing_device_fields'
        });
        return;
      }

      await store.upsertDevice(phoneDevice);
      await store.updatePairingTicket(ticketId, {
        claimedByDeviceId: phoneDevice.deviceId,
        claimedAt: remoteCommon.nowIso()
      });

      res.json({
        ok: true,
        ticketId,
        desktopDeviceId: pairingTicket.desktopDeviceId,
        expiresAt: pairingTicket.expiresAt
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/pairings/:pairId/revoke', async (req, res, next) => {
    try {
      const pairId = String(req.params.pairId || '').trim();
      const requesterDeviceId = String(req.body?.deviceId || '').trim();
      const pairRecord = await store.getPairRecord(pairId);
      if (!pairRecord) {
        res.status(404).json({
          ok: false,
          error: 'pair_not_found'
        });
        return;
      }

      const isParticipant = requesterDeviceId
        && (pairRecord.desktopDeviceId === requesterDeviceId || pairRecord.phoneDeviceId === requesterDeviceId);
      if (!isParticipant) {
        res.status(403).json({
          ok: false,
          error: 'forbidden'
        });
        return;
      }

      const revokedPair = await store.revokePair(pairId, requesterDeviceId);
      sendFrame(pairRecord.desktopDeviceId, {
        type: remoteCommon.FRAME_TYPES.PAIR_REVOKED,
        pairId,
        revokedAt: revokedPair.revokedAt
      });
      sendFrame(pairRecord.phoneDeviceId, {
        type: remoteCommon.FRAME_TYPES.PAIR_REVOKED,
        pairId,
        revokedAt: revokedPair.revokedAt
      });

      res.json({
        ok: true,
        pairId
      });
    } catch (error) {
      next(error);
    }
  });

  app.use((error, req, res, next) => {
    logger.error('[remote-relay] request failed:', error);
    res.status(500).json({
      ok: false,
      error: 'internal_error'
    });
  });

  server.on('upgrade', (request, socket, head) => {
    try {
      const requestUrl = new URL(request.url, 'http://127.0.0.1');
      if (requestUrl.pathname !== '/ws') {
        socket.destroy();
        return;
      }
    } catch (_) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (ws) => {
    ws.on('message', async (payloadBuffer) => {
      try {
        const frame = remoteCommon.safeParseJson(String(payloadBuffer || ''), null);
        if (!frame || typeof frame !== 'object' || !frame.type) {
          return;
        }

        const verification = await verifyFrameAuth(frame);
        if (!verification.ok) {
          ws.send(JSON.stringify({
            type: remoteCommon.FRAME_TYPES.INTERNAL_AUTH_ERROR,
            error: verification.error
          }));
          return;
        }

        const senderDevice = verification.device;
        switch (frame.type) {
          case remoteCommon.FRAME_TYPES.PRESENCE_HELLO: {
            registerConnection(senderDevice.deviceId, ws, {
              role: frame.role || '',
              pairId: frame.pairId || '',
              fingerprint: senderDevice.fingerprint || frame.fingerprint || ''
            });
            await store.upsertDevice({
              ...senderDevice,
              deviceName: frame.deviceName || senderDevice.deviceName,
              lastSeenAt: remoteCommon.nowIso()
            });
            ws.send(JSON.stringify({
              type: remoteCommon.FRAME_TYPES.PRESENCE_PING,
              serverTime: remoteCommon.nowIso()
            }));
            break;
          }
          case remoteCommon.FRAME_TYPES.PRESENCE_PING:
            ws.send(JSON.stringify({
              type: remoteCommon.FRAME_TYPES.PRESENCE_PING,
              serverTime: remoteCommon.nowIso()
            }));
            break;
          case remoteCommon.FRAME_TYPES.PAIR_REQUEST: {
            const result = await routePairRequest(frame, senderDevice);
            if (!result.ok) {
              ws.send(JSON.stringify({
                type: remoteCommon.FRAME_TYPES.INTERNAL_DELIVERY_ERROR,
                error: result.error
              }));
            }
            break;
          }
          case remoteCommon.FRAME_TYPES.PAIR_APPROVE: {
            const result = await routePairDecision(frame, senderDevice, true);
            if (!result.ok) {
              ws.send(JSON.stringify({
                type: remoteCommon.FRAME_TYPES.INTERNAL_DELIVERY_ERROR,
                error: result.error
              }));
            }
            break;
          }
          case remoteCommon.FRAME_TYPES.PAIR_REJECT: {
            const result = await routePairDecision(frame, senderDevice, false);
            if (!result.ok) {
              ws.send(JSON.stringify({
                type: remoteCommon.FRAME_TYPES.INTERNAL_DELIVERY_ERROR,
                error: result.error
              }));
            }
            break;
          }
          case remoteCommon.FRAME_TYPES.SEARCH_START:
          case remoteCommon.FRAME_TYPES.SESSION_RESUME: {
            const result = await routeSearchFrame(frame, senderDevice, 'phone');
            if (!result.ok) {
              ws.send(JSON.stringify({
                type: remoteCommon.FRAME_TYPES.INTERNAL_DELIVERY_ERROR,
                error: result.error,
                requestId: frame.requestId || ''
              }));
            }
            break;
          }
          case remoteCommon.FRAME_TYPES.SEARCH_PROGRESS:
          case remoteCommon.FRAME_TYPES.SEARCH_COMPLETE:
          case remoteCommon.FRAME_TYPES.SEARCH_ERROR: {
            const result = await routeSearchFrame(frame, senderDevice, 'desktop');
            if (!result.ok) {
              ws.send(JSON.stringify({
                type: remoteCommon.FRAME_TYPES.INTERNAL_DELIVERY_ERROR,
                error: result.error,
                requestId: frame.requestId || ''
              }));
            }
            break;
          }
          default:
            break;
        }
      } catch (error) {
        logger.error('[remote-relay] websocket frame failed:', error);
        try {
          ws.send(JSON.stringify({
            type: remoteCommon.FRAME_TYPES.INTERNAL_DELIVERY_ERROR,
            error: 'internal_error'
          }));
        } catch (_) {
          // Ignore socket send failures after processing errors.
        }
      }
    });

    ws.on('close', () => {
      clearConnectionBySocket(ws);
    });
  });

  async function start(port = Number(process.env.PORT || 8787), host = process.env.HOST || '0.0.0.0') {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
    const address = server.address();
    const normalizedPort = typeof address === 'object' && address ? address.port : port;
    return {
      port: normalizedPort,
      host
    };
  }

  async function stop() {
    connections.clear();
    await new Promise((resolve) => {
      wss.close(() => {
        resolve();
      });
    });
    await new Promise((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }

  function getAddress() {
    const address = server.address();
    if (!address || typeof address === 'string') {
      return address;
    }
    return `http://127.0.0.1:${address.port}`;
  }

  return {
    app,
    server,
    store,
    connections,
    start,
    stop,
    getAddress
  };
}

module.exports = {
  createRelayServer,
  MAX_CLOCK_SKEW_MS,
  TICKET_TTL_MS
};
