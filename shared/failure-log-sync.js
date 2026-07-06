(function initFailureLogSyncModule(global) {
  'use strict';

  const DEFAULT_BATCH_SIZE = 50;
  const DEFAULT_RETRY_AFTER_MS = 15 * 60 * 1000;
  const SYNC_ENABLED_KEY = 'failureLogSyncEnabled';
  const SENSITIVE_FIELD_PATTERN = /(token|key|auth|code|secret|password|session|credential|access|refresh)/i;
  const PRIORITY_METADATA_KEYS = [
    'timeoutReason',
    'runtimePhase',
    'stepIndex',
    'totalSteps',
    'action',
    'description',
    'firstSelector',
    'matchedSelector',
    'selectorMatchCount',
    'visibleSelectorMatchCount',
    'selectorSummary',
    'waitForElement',
    'retryOnDisabled',
    'maxAttempts',
    'retryInterval',
    'extractionMethod',
    'extractionStatus',
    'extractionSelectorSummary',
    'messageContainerCount',
    'contentSelectorHitCount',
    'fallbackSelectorHitCount',
    'lastContentLength',
    'lastContentPreview',
    'stableRounds',
    'attempts',
    'timeoutMs',
    'searchId',
    'currentUrl',
    'lastUrl',
    'pageTitle',
    'activeElement'
  ];
  const SAFE_LOG_FIELDS = [
    'id',
    'dateKey',
    'createdAt',
    'lastSeenAt',
    'category',
    'source',
    'siteName',
    'apiKind',
    'phase',
    'status',
    'errorCode',
    'errorMessage',
    'pageUrl',
    'runtimeUrl',
    'model',
    'locale',
    'queryPreview',
    'queryHash',
    'repeatCount',
    'metadata'
  ];

  function getChromeStorage() {
    try {
      return global.chrome?.storage?.local || null;
    } catch (_) {
      return null;
    }
  }

  async function isSyncEnabled() {
    const storage = getChromeStorage();
    if (!storage) return true;
    const stored = await storage.get(SYNC_ENABLED_KEY);
    return stored?.[SYNC_ENABLED_KEY] !== false;
  }

  function safeString(value, limit = 500) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return limit > 0 && text.length > limit ? `${text.slice(0, limit)}...` : text;
  }

  function sanitizeMetadataUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const parsed = new URL(raw, raw.startsWith('http') ? undefined : 'https://example.invalid');
      Array.from(parsed.searchParams.keys()).forEach((key) => {
        if (SENSITIVE_FIELD_PATTERN.test(key)) {
          parsed.searchParams.set(key, '[redacted]');
        }
      });
      if (!/^https?:\/\//i.test(raw)) {
        return `${parsed.pathname}${parsed.search}${parsed.hash}`;
      }
      return parsed.toString();
    } catch (_) {
      return raw.replace(/([?&][^=]*(?:token|key|auth|code|secret|password|session|credential|access|refresh)[^=]*=)[^&#]*/ig, '$1[redacted]');
    }
  }

  function safeMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object') return {};
    const result = {};
    const entries = Object.entries(metadata);
    const priorityEntries = PRIORITY_METADATA_KEYS
      .filter((key) => Object.prototype.hasOwnProperty.call(metadata, key))
      .map((key) => [key, metadata[key]]);
    const restEntries = entries.filter(([key]) => !PRIORITY_METADATA_KEYS.includes(key));
    [...priorityEntries, ...restEntries].slice(0, 40).forEach(([key, value]) => {
      if (SENSITIVE_FIELD_PATTERN.test(key)) {
        result[safeString(key, 80)] = '[redacted]';
        return;
      }
      if (/url/i.test(key) && typeof value === 'string') {
        result[safeString(key, 80)] = safeString(sanitizeMetadataUrl(value), 300);
        return;
      }
      if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) {
        result[safeString(key, 80)] = typeof value === 'string' ? safeString(value, 300) : value;
      }
    });
    return result;
  }

  function sanitizeLogForUpload(record = {}) {
    const safe = {};
    SAFE_LOG_FIELDS.forEach((field) => {
      if (!Object.prototype.hasOwnProperty.call(record, field)) return;
      safe[field] = record[field];
    });
    safe.id = safeString(safe.id, 120);
    safe.dateKey = safeString(safe.dateKey, 20);
    safe.createdAt = safeString(safe.createdAt, 40);
    safe.lastSeenAt = safeString(safe.lastSeenAt, 40);
    safe.category = safe.category === 'api' ? 'api' : 'site';
    safe.source = safeString(safe.source, 40);
    safe.siteName = safeString(safe.siteName, 120);
    safe.apiKind = safeString(safe.apiKind, 40);
    safe.phase = safeString(safe.phase, 60);
    safe.status = Number(safe.status) || 0;
    safe.errorCode = safeString(safe.errorCode, 120);
    safe.errorMessage = safeString(safe.errorMessage, 800);
    safe.pageUrl = safeString(safe.pageUrl, 600);
    safe.runtimeUrl = safeString(safe.runtimeUrl, 600);
    safe.model = safeString(safe.model, 120);
    safe.locale = safeString(safe.locale, 40);
    safe.queryPreview = safeString(safe.queryPreview, 120);
    safe.queryHash = safeString(safe.queryHash, 100);
    safe.repeatCount = Math.max(1, Number(safe.repeatCount) || 1);
    safe.metadata = safeMetadata(safe.metadata);
    return safe;
  }

  function getManifestVersion() {
    try {
      return global.chrome?.runtime?.getManifest?.()?.version || '';
    } catch (_) {
      return '';
    }
  }

  function getUiLocale() {
    try {
      return global.chrome?.i18n?.getUILanguage?.() || '';
    } catch (_) {
      return '';
    }
  }

  async function syncFailureLogs(options = {}) {
    const failureLog = options.failureLog || global.AIFailureLog;
    if (!failureLog || typeof failureLog.getPendingSyncLogs !== 'function') {
      return { ok: false, uploaded: 0, skipped: true, error: 'Failure log module is unavailable' };
    }
    if (!options.force && typeof options.isSyncEnabled === 'function') {
      if (!await options.isSyncEnabled()) {
        return { ok: true, uploaded: 0, skipped: true, reason: 'disabled' };
      }
    } else if (!options.force && !await isSyncEnabled()) {
      return { ok: true, uploaded: 0, skipped: true, reason: 'disabled' };
    }

    const batchSize = Math.min(DEFAULT_BATCH_SIZE, Math.max(1, Number(options.batchSize) || DEFAULT_BATCH_SIZE));
    const records = await failureLog.getPendingSyncLogs({
      limit: batchSize,
      force: options.force === true,
      retryAfterMs: Number(options.retryAfterMs) || DEFAULT_RETRY_AFTER_MS
    });
    if (!records.length) {
      return { ok: true, uploaded: 0, skipped: true, reason: 'empty' };
    }

    const ids = records.map((record) => String(record.id || '')).filter(Boolean);
    const attemptedAt = new Date().toISOString();
    const baseUrl = String(await options.getBaseUrl?.() || '').trim().replace(/\/+$/, '');
    if (!baseUrl) {
      await failureLog.markLogsSyncFailed(ids, 'Failure log sync endpoint is not configured', attemptedAt);
      return { ok: false, uploaded: 0, error: 'Failure log sync endpoint is not configured' };
    }

    const [idToken, anonymousClientId] = await Promise.all([
      options.getIdToken ? options.getIdToken() : '',
      options.getAnonymousClientId ? options.getAnonymousClientId() : ''
    ]);
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };
    if (idToken) {
      headers.Authorization = `Bearer ${idToken}`;
    }
    if (anonymousClientId) {
      headers['X-AI-Compare-Client-Id'] = anonymousClientId;
    }

    const fetchImpl = options.fetchImpl || global.fetch;
    if (typeof fetchImpl !== 'function') {
      await failureLog.markLogsSyncFailed(ids, 'Fetch is unavailable', attemptedAt);
      return { ok: false, uploaded: 0, error: 'Fetch is unavailable' };
    }

    try {
      const response = await fetchImpl(`${baseUrl}/api/failure-logs/batch`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          logs: records.map(sanitizeLogForUpload),
          extensionVersion: String(options.extensionVersion || getManifestVersion() || ''),
          locale: String(options.locale || getUiLocale() || '')
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      const uploadedIds = Array.isArray(payload.acceptedIds) && payload.acceptedIds.length
        ? payload.acceptedIds
        : ids;
      await failureLog.markLogsSynced(uploadedIds, new Date().toISOString());
      return { ok: true, uploaded: uploadedIds.length, payload };
    } catch (error) {
      await failureLog.markLogsSyncFailed(ids, error?.message || String(error), attemptedAt);
      return { ok: false, uploaded: 0, error: error?.message || String(error) };
    }
  }

  const api = {
    DEFAULT_BATCH_SIZE,
    DEFAULT_RETRY_AFTER_MS,
    SYNC_ENABLED_KEY,
    SAFE_LOG_FIELDS,
    PRIORITY_METADATA_KEYS,
    sanitizeLogForUpload,
    syncFailureLogs,
    isSyncEnabled
  };

  global.AIFailureLogSync = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
