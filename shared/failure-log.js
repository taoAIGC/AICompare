(function initFailureLogModule(global) {
  'use strict';

  const STORAGE_KEY = 'aiCompareFailureLogs';
  const MAX_RECORDS = 2000;
  const RETENTION_DAYS = 30;
  const DEDUPE_WINDOW_MS = 10000;
  const QUERY_PREVIEW_LIMIT = 120;
  const SYNC_STATUS_PENDING = 'pending';
  const SYNC_STATUS_SYNCED = 'synced';
  const SYNC_STATUS_FAILED = 'failed';
  const SENSITIVE_URL_PARAM_PATTERN = /(token|key|auth|code|secret|password|session|credential|access|refresh)/i;
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

  function getChromeStorage() {
    try {
      return global.chrome?.storage?.local || null;
    } catch (_) {
      return null;
    }
  }

  function storageGet(key) {
    const storage = getChromeStorage();
    if (!storage) {
      return Promise.resolve({});
    }
    try {
      const result = storage.get(key);
      if (result && typeof result.then === 'function') {
        return result;
      }
      return new Promise((resolve) => {
        storage.get(key, (value) => resolve(value || {}));
      });
    } catch (_) {
      return new Promise((resolve) => {
        storage.get(key, (value) => resolve(value || {}));
      });
    }
  }

  function storageSet(value) {
    const storage = getChromeStorage();
    if (!storage) {
      return Promise.resolve();
    }
    try {
      const result = storage.set(value);
      if (result && typeof result.then === 'function') {
        return result;
      }
      return new Promise((resolve) => {
        storage.set(value, resolve);
      });
    } catch (_) {
      return new Promise((resolve) => {
        storage.set(value, resolve);
      });
    }
  }

  function toDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function safeString(value, limit = 500) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return limit > 0 && text.length > limit ? `${text.slice(0, limit)}...` : text;
  }

  function sanitizeUrl(url) {
    const raw = String(url || '').trim();
    if (!raw) return '';
    try {
      const parsed = new URL(raw, raw.startsWith('http') ? undefined : 'https://example.invalid');
      Array.from(parsed.searchParams.keys()).forEach((key) => {
        if (SENSITIVE_URL_PARAM_PATTERN.test(key)) {
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

  function normalizeMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object') {
      return {};
    }
    const safe = {};
    const entries = Object.entries(metadata);
    const priorityEntries = PRIORITY_METADATA_KEYS
      .filter((key) => Object.prototype.hasOwnProperty.call(metadata, key))
      .map((key) => [key, metadata[key]]);
    const restEntries = entries.filter(([key]) => !PRIORITY_METADATA_KEYS.includes(key));
    [...priorityEntries, ...restEntries].slice(0, 40).forEach(([key, value]) => {
      if (SENSITIVE_URL_PARAM_PATTERN.test(key)) {
        safe[key] = '[redacted]';
        return;
      }
      if (/url/i.test(key) && typeof value === 'string') {
        safe[key] = safeString(sanitizeUrl(value), 300);
        return;
      }
      if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) {
        safe[key] = typeof value === 'string' ? safeString(value, 300) : value;
      }
    });
    return safe;
  }

  function extractQueryText(event = {}) {
    if (typeof event.query === 'string') return event.query;
    if (typeof event.prompt === 'string') return event.prompt;
    if (typeof event.queryPreview === 'string') return event.queryPreview;
    if (Array.isArray(event.messages)) {
      const lastUser = [...event.messages].reverse().find((message) => message?.role === 'user');
      const content = lastUser?.content;
      if (typeof content === 'string') return content;
      if (Array.isArray(content)) {
        return content
          .map((part) => typeof part?.text === 'string' ? part.text : '')
          .filter(Boolean)
          .join('\n');
      }
    }
    return '';
  }

  async function hashText(text) {
    const normalized = String(text || '');
    if (!normalized) return '';
    try {
      if (global.crypto?.subtle && global.TextEncoder) {
        const encoded = new TextEncoder().encode(normalized);
        const digest = await global.crypto.subtle.digest('SHA-256', encoded);
        return Array.from(new Uint8Array(digest))
          .map((byte) => byte.toString(16).padStart(2, '0'))
          .join('');
      }
    } catch (_) {
      // Fall through to the small deterministic fallback below.
    }
    let hash = 0;
    for (let i = 0; i < normalized.length; i += 1) {
      hash = ((hash << 5) - hash + normalized.charCodeAt(i)) | 0;
    }
    return `fallback-${Math.abs(hash)}`;
  }

  async function normalizeFailureEvent(event = {}) {
    const now = new Date();
    const queryText = extractQueryText(event);
    const createdAt = event.createdAt || now.toISOString();
    const record = {
      id: String(event.id || `failure_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`),
      dateKey: safeString(event.dateKey || toDateKey(now), 20),
      createdAt,
      lastSeenAt: event.lastSeenAt || createdAt,
      category: event.category === 'api' ? 'api' : 'site',
      source: safeString(event.source || '', 40),
      siteName: safeString(event.siteName || '', 120),
      apiKind: safeString(event.apiKind || '', 40),
      phase: safeString(event.phase || '', 60),
      status: Number(event.status) || 0,
      errorCode: safeString(event.errorCode || '', 120),
      errorMessage: safeString(event.errorMessage || event.message || event.error || 'Unknown failure', 800),
      pageUrl: sanitizeUrl(event.pageUrl || ''),
      runtimeUrl: sanitizeUrl(event.runtimeUrl || ''),
      model: safeString(event.model || '', 120),
      locale: safeString(event.locale || '', 40),
      queryPreview: safeString(event.queryPreview || queryText, QUERY_PREVIEW_LIMIT),
      queryHash: safeString(event.queryHash || await hashText(queryText), 100),
      repeatCount: Math.max(1, Number(event.repeatCount) || 1),
      syncStatus: [SYNC_STATUS_PENDING, SYNC_STATUS_SYNCED, SYNC_STATUS_FAILED].includes(event.syncStatus)
        ? event.syncStatus
        : SYNC_STATUS_PENDING,
      syncedAt: safeString(event.syncedAt || '', 40),
      syncError: safeString(event.syncError || '', 300),
      lastSyncAttemptAt: safeString(event.lastSyncAttemptAt || '', 40),
      metadata: normalizeMetadata(event.metadata)
    };
    if (!record.source) record.source = 'unknown';
    if (!record.phase) record.phase = record.category === 'api' ? 'http' : 'submit';
    return record;
  }

  function buildDedupeKey(record) {
    const detailCode = record.errorCode || record.metadata?.timeoutReason || '';
    return [
      record.category,
      record.siteName || record.apiKind || '',
      record.phase || '',
      detailCode,
      record.errorMessage || '',
      record.dateKey || ''
    ].join('|');
  }

  function pruneRecordList(records, now = new Date()) {
    const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    return (Array.isArray(records) ? records : [])
      .filter((record) => {
        const createdAt = new Date(record.createdAt || record.lastSeenAt || 0);
        return Number.isFinite(createdAt.getTime()) && createdAt >= cutoff;
      })
      .sort((a, b) => {
        const aTime = new Date(a.lastSeenAt || a.createdAt || 0).getTime();
        const bTime = new Date(b.lastSeenAt || b.createdAt || 0).getTime();
        return bTime - aTime;
      })
      .slice(0, MAX_RECORDS);
  }

  async function readAllLogs() {
    const stored = await storageGet(STORAGE_KEY);
    const records = stored?.[STORAGE_KEY];
    return Array.isArray(records) ? records : [];
  }

  async function writeAllLogs(records) {
    await storageSet({ [STORAGE_KEY]: pruneRecordList(records) });
  }

  async function logFailure(event = {}) {
    const record = await normalizeFailureEvent(event);
    const records = await readAllLogs();
    const dedupeKey = buildDedupeKey(record);
    const recordTime = new Date(record.createdAt).getTime();
    const duplicate = records.find((item) => {
      if (buildDedupeKey(item) !== dedupeKey) return false;
      const lastSeen = new Date(item.lastSeenAt || item.createdAt || 0).getTime();
      return Number.isFinite(lastSeen) && Number.isFinite(recordTime) && Math.abs(recordTime - lastSeen) <= DEDUPE_WINDOW_MS;
    });

    if (duplicate) {
      duplicate.repeatCount = Math.max(1, Number(duplicate.repeatCount) || 1) + 1;
      duplicate.lastSeenAt = record.createdAt;
      duplicate.status = record.status || duplicate.status || 0;
      duplicate.errorCode = record.errorCode || duplicate.errorCode || '';
      duplicate.runtimeUrl = record.runtimeUrl || duplicate.runtimeUrl || '';
      duplicate.pageUrl = record.pageUrl || duplicate.pageUrl || '';
      duplicate.metadata = { ...(duplicate.metadata || {}), ...(record.metadata || {}) };
      duplicate.syncStatus = SYNC_STATUS_PENDING;
      duplicate.syncError = '';
      duplicate.syncedAt = '';
      await writeAllLogs(records);
      return duplicate;
    }

    records.unshift(record);
    await writeAllLogs(records);
    return record;
  }

  async function getLogs(options = {}) {
    const days = Number(options.days) || RETENTION_DAYS;
    const category = String(options.category || 'all');
    const query = String(options.query || '').trim().toLowerCase();
    const cutoff = new Date(Date.now() - Math.max(0, days - 1) * 24 * 60 * 60 * 1000);
    cutoff.setHours(0, 0, 0, 0);

    return pruneRecordList(await readAllLogs())
      .filter((record) => {
        const createdAt = new Date(record.lastSeenAt || record.createdAt || 0);
        if (!Number.isFinite(createdAt.getTime()) || createdAt < cutoff) return false;
        if (category !== 'all' && record.category !== category) return false;
        if (!query) return true;
        const haystack = [
          record.siteName,
          record.apiKind,
          record.phase,
          record.status,
          record.errorCode,
          record.errorMessage,
          record.model,
          record.locale,
          record.metadata?.timeoutReason,
          record.metadata?.runtimePhase
        ].join(' ').toLowerCase();
        return haystack.includes(query);
      });
  }

  async function clearLogs() {
    await storageSet({ [STORAGE_KEY]: [] });
  }

  async function pruneLogs() {
    const records = pruneRecordList(await readAllLogs());
    await storageSet({ [STORAGE_KEY]: records });
    return records;
  }

  function shouldUploadRecord(record, options = {}) {
    const status = String(record?.syncStatus || SYNC_STATUS_PENDING);
    if (![SYNC_STATUS_PENDING, SYNC_STATUS_FAILED].includes(status)) {
      return false;
    }
    if (options.force) {
      return true;
    }
    if (status !== SYNC_STATUS_FAILED) {
      return true;
    }
    const lastAttempt = Date.parse(record.lastSyncAttemptAt || '');
    if (!Number.isFinite(lastAttempt)) {
      return true;
    }
    const retryAfterMs = Math.max(60000, Number(options.retryAfterMs) || 15 * 60 * 1000);
    return Date.now() - lastAttempt >= retryAfterMs;
  }

  async function getPendingSyncLogs(options = {}) {
    const limit = Math.max(1, Number(options.limit) || 50);
    const records = pruneRecordList(await readAllLogs());
    return records
      .filter((record) => shouldUploadRecord(record, options))
      .slice(0, limit);
  }

  async function markLogsSynced(ids = [], syncedAt = new Date().toISOString()) {
    const idSet = new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || '')).filter(Boolean));
    if (!idSet.size) return [];
    const records = await readAllLogs();
    records.forEach((record) => {
      if (!idSet.has(String(record.id || ''))) return;
      record.syncStatus = SYNC_STATUS_SYNCED;
      record.syncedAt = syncedAt;
      record.lastSyncAttemptAt = syncedAt;
      record.syncError = '';
    });
    await writeAllLogs(records);
    return records.filter((record) => idSet.has(String(record.id || '')));
  }

  async function markLogsSyncFailed(ids = [], errorMessage = '', attemptedAt = new Date().toISOString()) {
    const idSet = new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || '')).filter(Boolean));
    if (!idSet.size) return [];
    const records = await readAllLogs();
    records.forEach((record) => {
      if (!idSet.has(String(record.id || ''))) return;
      record.syncStatus = SYNC_STATUS_FAILED;
      record.lastSyncAttemptAt = attemptedAt;
      record.syncError = safeString(errorMessage || 'Sync failed', 300);
    });
    await writeAllLogs(records);
    return records.filter((record) => idSet.has(String(record.id || '')));
  }

  async function getSyncSummary() {
    const records = await getLogs({ days: RETENTION_DAYS, category: 'all' });
    return records.reduce((summary, record) => {
      const status = String(record.syncStatus || SYNC_STATUS_PENDING);
      if (status === SYNC_STATUS_SYNCED) summary.synced += 1;
      else if (status === SYNC_STATUS_FAILED) summary.failed += 1;
      else summary.pending += 1;
      summary.total += 1;
      return summary;
    }, { total: 0, pending: 0, synced: 0, failed: 0 });
  }

  const api = {
    STORAGE_KEY,
    MAX_RECORDS,
    RETENTION_DAYS,
    DEDUPE_WINDOW_MS,
    QUERY_PREVIEW_LIMIT,
    SYNC_STATUS_PENDING,
    SYNC_STATUS_SYNCED,
    SYNC_STATUS_FAILED,
    toDateKey,
    sanitizeUrl,
    hashText,
    normalizeFailureEvent,
    pruneRecordList,
    logFailure,
    getLogs,
    getPendingSyncLogs,
    markLogsSynced,
    markLogsSyncFailed,
    getSyncSummary,
    clearLogs,
    pruneLogs
  };

  global.AIFailureLog = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
