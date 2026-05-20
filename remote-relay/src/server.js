const http = require('node:http');
const { URL } = require('node:url');

const express = require('express');
const QRCode = require('qrcode');
const { WebSocketServer } = require('ws');

const remoteCommon = require('../../remote/common.js');
const remoteCrypto = require('../../remote/crypto.js');
const { createMetadataStore } = require('./store.js');

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const TICKET_TTL_MS = 5 * 60 * 1000;
const SHARE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const WS_OPEN_STATE = 1;

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

function renderInlineMarkdown(text) {
  return String(text || '')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*]+)\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_([^_]+)_(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

function renderMarkdownToHtml(markdownText) {
  const source = String(markdownText || '').replace(/\r\n?/g, '\n');
  if (!source.trim()) {
    return '<p class="share-empty">暂无内容</p>';
  }

  const lines = source.split('\n');
  const blocks = [];
  let paragraphLines = [];
  let listItems = [];
  let listType = '';
  let inCodeBlock = false;
  let codeLines = [];

  const flushParagraph = () => {
    if (!paragraphLines.length) return;
    const paragraph = paragraphLines.join('<br>');
    blocks.push(`<p>${paragraph}</p>`);
    paragraphLines = [];
  };

  const flushList = () => {
    if (!listItems.length) return;
    const tag = listType === 'ol' ? 'ol' : 'ul';
    blocks.push(`<${tag}>${listItems.join('')}</${tag}>`);
    listItems = [];
    listType = '';
  };

  const flushCodeBlock = () => {
    if (!inCodeBlock) return;
    blocks.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
    inCodeBlock = false;
    codeLines = [];
  };

  for (const rawLine of lines) {
    const escapedLine = escapeHtml(rawLine);
    const trimmed = rawLine.trim();

    if (trimmed.startsWith('```')) {
      flushParagraph();
      flushList();
      if (inCodeBlock) {
        flushCodeBlock();
      } else {
        inCodeBlock = true;
        codeLines = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(rawLine);
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = Math.min(6, Math.max(2, headingMatch[1].length + 1));
      blocks.push(`<h${level}>${renderInlineMarkdown(escapeHtml(headingMatch[2]))}</h${level}>`);
      continue;
    }

    const blockquoteMatch = trimmed.match(/^>\s?(.*)$/);
    if (blockquoteMatch) {
      flushParagraph();
      flushList();
      blocks.push(`<blockquote>${renderInlineMarkdown(escapeHtml(blockquoteMatch[1]))}</blockquote>`);
      continue;
    }

    const orderedMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
    if (orderedMatch) {
      flushParagraph();
      if (listType && listType !== 'ol') {
        flushList();
      }
      listType = 'ol';
      listItems.push(`<li>${renderInlineMarkdown(escapeHtml(orderedMatch[2]))}</li>`);
      continue;
    }

    const unorderedMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (unorderedMatch) {
      flushParagraph();
      if (listType && listType !== 'ul') {
        flushList();
      }
      listType = 'ul';
      listItems.push(`<li>${renderInlineMarkdown(escapeHtml(unorderedMatch[1]))}</li>`);
      continue;
    }

    flushList();
    paragraphLines.push(renderInlineMarkdown(escapedLine));
  }

  flushParagraph();
  flushList();
  flushCodeBlock();

  return blocks.join('\n');
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

  function renderSharePage(shareId, shareRecord = null) {
    const title = shareRecord?.payload?.question ? `${shareRecord.payload.question} - AI Compare` : 'AI Compare Share';
    const responses = normalizeShareResponses(shareRecord?.payload?.responses);
    const siteNavItems = responses.length
      ? responses.map((response, index) => {
        const siteName = escapeHtml(response.siteName || `Site ${index + 1}`);
        const anchorId = `site-${index + 1}`;
        return `<a class="site-nav-link" href="#${anchorId}">${siteName}</a>`;
      }).join('\n')
      : '';
    const responseCards = responses.length
      ? responses.map((response, index) => {
        const siteName = escapeHtml(response.siteName || 'Unknown');
        const anchorId = `site-${index + 1}`;
        const bodyText = getShareResponseBody(response);
        const bodyHtml = renderMarkdownToHtml(bodyText);
        return `<section class="response-item" id="${anchorId}">
          <div class="response-site">${siteName}</div>
          <div class="response-body">${bodyHtml}</div>
        </section>`;
      }).join('\n')
      : '<p class="share-empty">暂无可展示的回答</p>';
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root{
      color-scheme: light;
      --apple-bg-0:#eef1f5;
      --apple-bg-1:#f7f8fa;
      --apple-card:rgba(255,255,255,.72);
      --apple-card-strong:rgba(255,255,255,.86);
      --apple-border:rgba(255,255,255,.62);
      --apple-shadow:0 18px 48px rgba(15,23,42,.08),0 2px 10px rgba(15,23,42,.04);
      --apple-text:#101214;
      --apple-subtle:#6b7280;
      --apple-accent:#0071e3;
      --apple-code-bg:rgba(245,247,250,.95);
    }
    *{box-sizing:border-box}
    html{scroll-behavior:smooth}
    html,body{min-height:100%}
    body{
      font-family:"SF Pro Text","SF Pro Display","Helvetica Neue",Helvetica,Arial,sans-serif;
      margin:0;
      color:var(--apple-text);
      background:
        radial-gradient(circle at top left, rgba(255,255,255,.92), rgba(255,255,255,0) 32%),
        radial-gradient(circle at top right, rgba(255,255,255,.8), rgba(255,255,255,0) 28%),
        linear-gradient(180deg, var(--apple-bg-0) 0%, var(--apple-bg-1) 100%);
      -webkit-font-smoothing:antialiased;
      text-rendering:optimizeLegibility;
    }
    .page-shell{
      width:min(1240px, calc(100% - 40px));
      margin:0 auto;
      padding:40px 0 72px;
      display:grid;
      grid-template-columns:180px minmax(0, 1fr);
      grid-template-rows:auto auto;
      column-gap:28px;
      row-gap:18px;
      align-items:start;
    }
    .question-spacer{
      grid-column:1;
      grid-row:1;
    }
    .question-wrap{
      grid-column:2;
      grid-row:1;
      min-width:0;
    }
    .site-nav{
      grid-column:1;
      grid-row:2;
      position:sticky;
      top:32px;
      align-self:start;
      height:fit-content;
    }
    .site-nav-card{
      background:rgba(255,255,255,.58);
      border:1px solid rgba(255,255,255,.62);
      border-radius:22px;
      padding:12px;
      box-shadow:var(--apple-shadow);
      backdrop-filter:blur(22px) saturate(170%);
      -webkit-backdrop-filter:blur(22px) saturate(170%);
    }
    .site-nav-list{
      display:flex;
      flex-direction:column;
      gap:8px;
    }
    .site-nav-link{
      display:block;
      padding:10px 12px;
      border-radius:14px;
      color:var(--apple-subtle);
      text-decoration:none;
      font-size:14px;
      line-height:1.35;
      font-weight:600;
      word-break:break-word;
      transition:background-color .18s ease,color .18s ease,transform .18s ease;
    }
    .site-nav-link:hover{
      background:rgba(0,113,227,.08);
      color:var(--apple-accent);
      transform:translateX(2px);
    }
    .response-wrap{
      min-width:0;
      grid-column:2;
      grid-row:2;
    }
    .card{
      position:relative;
      overflow:hidden;
      background:var(--apple-card);
      border:1px solid var(--apple-border);
      border-radius:28px;
      padding:24px 24px 22px;
      box-shadow:var(--apple-shadow);
      backdrop-filter:blur(24px) saturate(170%);
      -webkit-backdrop-filter:blur(24px) saturate(170%);
      margin-bottom:18px;
    }
    h2{
      margin:0 0 14px;
      font-size:14px;
      line-height:1.2;
      font-weight:700;
      letter-spacing:.01em;
      color:var(--apple-subtle);
      text-transform:uppercase;
    }
    .question-card .markdown{
      font-size:32px;
      line-height:1.26;
      font-weight:700;
      letter-spacing:-.03em;
      color:var(--apple-text);
    }
    .question-card .markdown p{
      margin:0;
    }
    .question-card{
      background:transparent;
      border:none;
      box-shadow:none;
      backdrop-filter:none;
      -webkit-backdrop-filter:none;
      padding:8px 6px 12px;
      margin-bottom:18px;
    }
    .markdown{
      font-size:17px;
      line-height:1.82;
      color:var(--apple-text);
    }
    .markdown p,.markdown ul,.markdown ol,.markdown blockquote,.markdown pre{margin:0 0 14px}
    .markdown ul,.markdown ol{padding-left:24px}
    .markdown li + li{margin-top:6px}
    .markdown blockquote{
      border-left:3px solid rgba(0,113,227,.24);
      padding:2px 0 2px 14px;
      color:#4b5563;
    }
    .markdown pre{
      white-space:pre-wrap;
      word-break:break-word;
      font:13px/1.75 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;
      background:var(--apple-code-bg);
      border:1px solid rgba(15,23,42,.06);
      border-radius:18px;
      padding:16px 18px;
      box-shadow:inset 0 1px 0 rgba(255,255,255,.75);
    }
    .markdown code{
      font:13px ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;
      background:rgba(15,23,42,.055);
      border-radius:8px;
      padding:2px 7px;
    }
    .markdown pre code{background:transparent;padding:0;border-radius:0}
    .markdown h2,.markdown h3,.markdown h4,.markdown h5,.markdown h6{
      margin:0 0 12px;
      font-size:22px;
      line-height:1.35;
      font-weight:700;
      letter-spacing:-.02em;
      color:var(--apple-text);
      text-transform:none;
    }
    .markdown a{color:var(--apple-accent);text-decoration:none}
    .markdown a:hover{text-decoration:underline}
    .response-list{display:flex;flex-direction:column;gap:14px}
    .response-item{
      border:1px solid rgba(255,255,255,.72);
      border-radius:24px;
      padding:18px 18px 6px;
      background:var(--apple-card-strong);
      box-shadow:inset 0 1px 0 rgba(255,255,255,.85);
      scroll-margin-top:32px;
    }
    .response-site{
      display:flex;
      align-items:center;
      gap:10px;
      font-size:17px;
      line-height:1.3;
      font-weight:700;
      letter-spacing:-.01em;
      margin:0 0 14px;
    }
    .response-site::before{
      content:"";
      width:10px;
      height:10px;
      border-radius:999px;
      background:linear-gradient(180deg, #5ac8fa 0%, #007aff 100%);
      box-shadow:0 0 0 6px rgba(0,122,255,.12);
      flex-shrink:0;
    }
    .share-empty{
      color:var(--apple-subtle);
      margin:0;
      font-size:15px;
      line-height:1.7;
    }
    @media (max-width: 900px){
      .page-shell{
        width:min(100%, calc(100% - 28px));
        padding:24px 0 40px;
        grid-template-columns:minmax(0, 1fr);
        grid-template-rows:auto auto auto;
        row-gap:18px;
      }
      .question-spacer{display:none}
      .question-wrap{
        grid-column:1;
        grid-row:1;
      }
      .site-nav{
        grid-column:1;
        grid-row:2;
        top:12px;
        z-index:5;
      }
      .site-nav-card{
        padding:10px;
      }
      .response-wrap{
        grid-column:1;
        grid-row:3;
      }
      .site-nav-list{
        flex-direction:row;
        gap:8px;
        overflow:auto;
        padding-bottom:2px;
      }
      .site-nav-link{
        white-space:nowrap;
      }
    }
    @media (max-width: 640px){
      .card{border-radius:24px;padding:20px 18px}
      .question-card{padding:6px 4px 10px}
      .question-card .markdown{font-size:26px}
      .markdown{font-size:16px}
      .response-item{border-radius:20px}
    }
  </style>
</head>
<body>
  <div class="page-shell">
    <div class="question-spacer" aria-hidden="true"></div>
    <div class="question-wrap">
      <div class="card question-card">
        <div class="markdown">${renderMarkdownToHtml(shareRecord?.payload?.question || '')}</div>
      </div>
    </div>
    ${siteNavItems ? `<aside class="site-nav">
      <div class="site-nav-card">
        <nav class="site-nav-list" aria-label="Response sites">
          ${siteNavItems}
        </nav>
      </div>
    </aside>` : ''}
    <div class="response-wrap">
      <div class="card">
        <div class="response-list">${responseCards}</div>
      </div>
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
      res.type('text/html').send(renderSharePage(shareId, shareRecord));
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
