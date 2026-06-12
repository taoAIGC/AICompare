const EXTERNAL_STATUS_PATTERNS = [
  { status: 'login_required', pattern: /sign in|log in|login|登录|请先登录|continue with google/i },
  { status: 'rate_limited', pattern: /rate limit|usage limit|quota|credits?|pricing|消息限制|额度|限流/i },
  { status: 'blocked', pattern: /captcha|verify you are human|access denied|blocked|temporarily unavailable|访问受限/i }
];

const FLOW_VALID_STATUSES = new Set([
  'ok',
  'login_required',
  'rate_limited',
  'blocked',
  'landing_page',
  'not_submitted'
]);

function trimPreview(value, maxLength = 300) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function classifyExternalStatus(value) {
  const text = String(value || '');
  for (const item of EXTERNAL_STATUS_PATTERNS) {
    if (item.pattern.test(text)) {
      return item.status;
    }
  }
  return '';
}

function buildAssessment(status, configValid = true) {
  const normalizedStatus = String(status || 'error').trim() || 'error';
  return {
    config_valid: !!configValid,
    flow_valid: FLOW_VALID_STATUSES.has(normalizedStatus),
    service_available: normalizedStatus === 'ok'
  };
}

function createUnifiedResult(options) {
  const status = String(options.status || 'error').trim() || 'error';
  const evidence = options.evidence && typeof options.evidence === 'object'
    ? options.evidence
    : {};

  return {
    siteName: String(options.siteName || '').trim(),
    mode: String(options.mode || 'live_direct').trim() || 'live_direct',
    ok: options.ok === true,
    status,
    query: String(options.query || '').trim(),
    pageUrl: String(options.pageUrl || '').trim(),
    runtimeUrl: String(options.runtimeUrl || options.pageUrl || '').trim(),
    contentPreview: trimPreview(options.contentPreview || evidence.contentPreview || ''),
    evidence,
    assessment: buildAssessment(status, options.configValid !== false),
    checkedAt: options.checkedAt || new Date().toISOString()
  };
}

function buildExternalResult(options) {
  const inferredStatus = classifyExternalStatus(
    options.reason || options.contentPreview || JSON.stringify(options.evidence || {})
  ) || 'error';

  return createUnifiedResult({
    ...options,
    ok: inferredStatus === 'ok',
    status: inferredStatus
  });
}

function printResultAndExit(payload) {
  const output = `${JSON.stringify(payload, null, 2)}\n`;
  if (payload.ok) {
    process.stdout.write(output);
    process.exit(0);
  }
  process.stderr.write(output);
  process.exit(1);
}

module.exports = {
  EXTERNAL_STATUS_PATTERNS,
  classifyExternalStatus,
  createUnifiedResult,
  buildExternalResult,
  printResultAndExit,
  trimPreview
};
