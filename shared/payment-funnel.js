(function initPaymentFunnel(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.AIComparePaymentFunnel = api;
  }
})(typeof self !== 'undefined' ? self : globalThis, function createPaymentFunnelApi() {
  const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{8,120}$/;
  const TEST_IDENTITY_PATTERN = /(?:@example\.com$|(?:^|[+_.-])(e2e|smoke|test)(?:[+_.-]|@|$))/i;

  function normalizeFunnelId(value = '') {
    const normalized = String(value || '').trim();
    return SAFE_ID_PATTERN.test(normalized) ? normalized : '';
  }

  function createFunnelId(randomValue = '') {
    const randomPart = String(randomValue || '')
      .replace(/[^A-Za-z0-9_-]/g, '')
      .slice(0, 48);
    const fallback = Math.random().toString(36).slice(2, 14);
    return `funnel_${Date.now()}_${randomPart || fallback}`.slice(0, 120);
  }

  function buildApiPlanUpgradeUrl(baseUrl, funnelId, source = 'official_api_quota_error') {
    const normalizedBase = String(baseUrl || 'https://aicompare.club').trim().replace(/\/+$/, '');
    const url = new URL(`${normalizedBase}/membership-pricing`);
    url.searchParams.set('planType', 'api');
    url.searchParams.set('source', String(source || 'official_api_quota_error').slice(0, 80));
    const normalizedFunnelId = normalizeFunnelId(funnelId);
    if (normalizedFunnelId) url.searchParams.set('funnelId', normalizedFunnelId);
    return url.toString();
  }

  function isTestIdentity(identity = {}, metadata = {}) {
    const values = [identity.email, identity.uid, metadata.testName, metadata.environment]
      .map((value) => String(value || '').trim())
      .filter(Boolean);
    return metadata.smokeTest === true
      || String(metadata.smokeTest || '').toLowerCase() === 'true'
      || values.some((value) => TEST_IDENTITY_PATTERN.test(value));
  }

  function getBusinessInvoiceExclusionReasons({ invoice = {}, identity = {} } = {}) {
    const reasons = [];
    if (isTestIdentity(identity, invoice.metadata || {})) reasons.push('test_identity');
    if (invoice.paid !== true) reasons.push('unpaid');
    if (Number(invoice.amount_paid || 0) <= 0) reasons.push('zero_amount');
    return reasons;
  }

  function getBusinessCheckoutExclusionReasons(row = {}) {
    const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
    const planType = String(metadata.planType || metadata.plan_type || '').trim().toLowerCase();
    const reasons = [];
    if (!row.uid && !row.clientHash) reasons.push('missing_identity');
    if (!normalizeFunnelId(metadata.funnelId)) reasons.push('missing_funnel');
    if (!String(metadata.selectionEventId || '').trim()) reasons.push('missing_selection');
    if (metadata.selectionVerified !== true && String(metadata.selectionVerified || '').toLowerCase() !== 'true') {
      reasons.push('unverified_selection');
    }
    if (planType !== 'chat' && planType !== 'api') reasons.push('unsupported_plan');
    if (isTestIdentity({ uid: row.uid, email: row.email }, metadata)) reasons.push('test_identity');
    return reasons;
  }

  return {
    buildApiPlanUpgradeUrl,
    createFunnelId,
    getBusinessCheckoutExclusionReasons,
    getBusinessInvoiceExclusionReasons,
    isTestIdentity,
    normalizeFunnelId
  };
});
