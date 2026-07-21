(function(root, factory) {
  const api = factory();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    module.exports.BehaviorInsights = api;
  }

  if (root && typeof root === 'object') {
    root.AICompareBehaviorInsights = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const SENSITIVE_KEY_PATTERN = /(token|key|auth|code|secret|password|session|credential|access|refresh|prompt|response|content|body|clipboard|apikey|api_key)/i;
  const SUBSCRIPTION_EVENT_PATTERN = /(membership|pricing|checkout|subscribe|subscription|payment|limit|upgrade|pro)/i;
  const ACTIVATION_EVENT_PATTERN = /(^app_first_open$|^activation_|first_|first_result|first_query)/i;
  const RESULT_STATES = new Set(['submitted', 'loaded', 'partial', 'failed', 'blocked', 'empty']);

  function normalizeString(value, limit = 160) {
    if (value == null) return '';
    return String(value).replace(/\s+/g, ' ').trim().slice(0, Math.max(0, Number(limit) || 160));
  }

  function normalizeNumber(value, min = 0, max = 20000) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return min;
    return Math.max(min, Math.min(max, parsed));
  }

  function normalizeBoolean(value) {
    return value === true || value === 'true' || value === 1 || value === '1';
  }

  function normalizeNameList(items = [], limit = 40) {
    const seen = new Set();
    return (Array.isArray(items) ? items : [])
      .map((item) => normalizeString(item, 120))
      .filter(Boolean)
      .filter((item) => {
        const key = item.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, Math.max(0, Number(limit) || 40));
  }

  function inferEventKind(eventName = '', explicitKind = '') {
    const kind = normalizeString(explicitKind, 40).toLowerCase();
    if (['feature', 'activation', 'subscription'].includes(kind)) return kind;
    const name = normalizeString(eventName, 120).toLowerCase();
    if (SUBSCRIPTION_EVENT_PATTERN.test(name)) return 'subscription';
    if (ACTIVATION_EVENT_PATTERN.test(name)) return 'activation';
    return 'feature';
  }

  function inferWorkflowMode({
    siteNames = [],
    officialSiteNames = [],
    customSiteNames = [],
    agentIds = [],
    source = '',
    metadata = {}
  } = {}) {
    const sourceValue = normalizeString(source, 80).toLowerCase();
    const explicitMode = normalizeString(metadata.workflow_mode || metadata.workflowMode || '', 40).toLowerCase();
    if (['single_site', 'multi_site', 'agent', 'hybrid', 'batch', 'remote'].includes(explicitMode)) {
      return explicitMode;
    }
    if (sourceValue.includes('remote')) return 'remote';
    if (sourceValue.includes('batch')) return 'batch';
    const sites = normalizeNameList(siteNames.length ? siteNames : [...officialSiteNames, ...customSiteNames]);
    const agents = normalizeNameList(agentIds);
    if (sites.length && agents.length) return 'hybrid';
    if (agents.length) return 'agent';
    if (sites.length > 1) return 'multi_site';
    if (sites.length === 1) return 'single_site';
    return '';
  }

  function createSiteCombinationKey({ siteNames = [], officialSiteNames = [], customSiteNames = [], agentIds = [] } = {}) {
    const sites = normalizeNameList(siteNames.length ? siteNames : [...officialSiteNames, ...customSiteNames], 60)
      .map((name) => `site:${name.toLowerCase()}`);
    const agents = normalizeNameList(agentIds, 40)
      .map((name) => `agent:${name.toLowerCase()}`);
    return [...sites, ...agents].sort().join('|').slice(0, 1000);
  }

  function normalizeResultState(value = '') {
    const state = normalizeString(value, 40).toLowerCase();
    return RESULT_STATES.has(state) ? state : '';
  }

  function normalizeAnalyticsPlanType(value = '') {
    const planType = normalizeString(value, 40).toLowerCase();
    if (planType === 'api') return 'api';
    if (planType === 'chat') return 'chat';
    return '';
  }

  function getPlanScopedSubscriptionEventName(row = {}) {
    const eventName = normalizeString(row.eventName, 120);
    const planType = normalizeAnalyticsPlanType(row.metadata?.planType || row.metadata?.plan_type || '');
    if (!eventName || !planType) return eventName;
    const scopedEvents = new Set([
      'checkout_started',
      'checkout_success',
      'pricing_page_opened',
      'pricing_plan_selected',
      'plan_upgrade_entry_clicked',
      'checkout_open_failed',
      'subscription_canceled',
      'customer_subscription_updated',
      'invoice_payment_succeeded'
    ]);
    return scopedEvents.has(eventName) ? `${planType}_${eventName}` : eventName;
  }

  function safeMetadata(metadata = {}, limit = 30) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
    const result = {};
    Object.entries(metadata).slice(0, Math.max(0, Number(limit) || 30)).forEach(([key, value]) => {
      const safeKey = normalizeString(key, 80);
      if (!safeKey || SENSITIVE_KEY_PATTERN.test(safeKey)) return;
      if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) {
        result[safeKey] = typeof value === 'string' ? normalizeString(value, 160) : value;
      }
    });
    return result;
  }

  function buildAnalyticsPayload({
    eventName = '',
    kind = '',
    source = '',
    surface = '',
    trigger = '',
    hasQuery = false,
    queryLength = 0,
    metadata = {},
    clientEventId = ''
  } = {}) {
    const safe = safeMetadata({
      ...metadata,
      surface,
      trigger
    });
    const resultState = normalizeResultState(metadata.result_state || metadata.resultState);
    if (resultState) safe.result_state = resultState;
    const workflowMode = inferWorkflowMode({ source, metadata: safe });
    if (workflowMode) safe.workflow_mode = workflowMode;
    return {
      clientEventId: normalizeString(clientEventId, 120),
      eventName: normalizeString(eventName, 120),
      kind: inferEventKind(eventName, kind),
      source: normalizeString(source || 'extension', 60),
      hasQuery: normalizeBoolean(hasQuery) || normalizeNumber(queryLength, 0, 20000) > 0,
      queryLength: Math.round(normalizeNumber(queryLength, 0, 20000)),
      metadata: safe
    };
  }

  function buildSiteUsagePayload(payload = {}) {
    const officialSiteNames = normalizeNameList(payload.officialSiteNames, 40);
    const customSiteNames = normalizeNameList(payload.customSiteNames, 40);
    const siteNames = normalizeNameList(
      payload.siteNames && payload.siteNames.length ? payload.siteNames : [...officialSiteNames, ...customSiteNames],
      60
    );
    const agentIds = normalizeNameList(payload.agentIds, 40);
    const metadata = safeMetadata(payload.metadata || {});
    const workflowMode = inferWorkflowMode({
      siteNames,
      officialSiteNames,
      customSiteNames,
      agentIds,
      source: payload.source,
      metadata
    });
    const siteCombinationKey = createSiteCombinationKey({ siteNames, officialSiteNames, customSiteNames, agentIds });
    return {
      ...payload,
      source: normalizeString(payload.source || 'iframe', 60),
      siteNames,
      officialSiteNames,
      customSiteNames,
      agentIds,
      siteCombinationKey,
      workflowMode,
      resultState: normalizeResultState(payload.resultState || payload.result_state),
      successCount: Math.round(normalizeNumber(payload.successCount, 0, 1000)),
      failureCount: Math.round(normalizeNumber(payload.failureCount, 0, 1000)),
      extractableCount: Math.round(normalizeNumber(payload.extractableCount, 0, 1000)),
      latencyMs: Math.round(normalizeNumber(payload.latencyMs, 0, 24 * 60 * 60 * 1000)),
      failurePhase: normalizeString(payload.failurePhase, 80),
      failureTarget: normalizeString(payload.failureTarget, 120),
      metadata
    };
  }

  function getIdentityKey(row = {}) {
    if (row.uid) return `user:${row.uid}`;
    if (row.clientHash) return `anonymous:${row.clientHash}`;
    return '';
  }

  function inferUserMaturity({ featureEvents = 0, activationEvents = 0, siteEvents = 0, subscriptionEvents = 0, hasWorkflowFeature = false } = {}) {
    if (subscriptionEvents > 0) return 'pro';
    if (hasWorkflowFeature || siteEvents >= 10 || featureEvents >= 20) return 'power';
    if (featureEvents >= 5 || siteEvents >= 3) return 'workflow';
    if (siteEvents >= 2 || featureEvents >= 2) return 'retained';
    if (activationEvents > 0 || siteEvents > 0 || featureEvents > 0) return 'activated';
    return 'new';
  }

  return {
    buildAnalyticsPayload,
    buildSiteUsagePayload,
    createSiteCombinationKey,
    getIdentityKey,
    getPlanScopedSubscriptionEventName,
    inferEventKind,
    inferUserMaturity,
    inferWorkflowMode,
    normalizeAnalyticsPlanType,
    normalizeNameList,
    normalizeResultState,
    normalizeString,
    safeMetadata
  };
});
