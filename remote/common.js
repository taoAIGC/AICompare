(function(root, factory) {
  const api = factory();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (root && typeof root === 'object') {
    root.AIRemoteCommon = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const REMOTE_PROTOCOL_VERSION = 1;

  const FRAME_TYPES = Object.freeze({
    PRESENCE_HELLO: 'presence.hello',
    PRESENCE_PING: 'presence.ping',
    PAIR_REQUEST: 'pair.request',
    PAIR_APPROVE: 'pair.approve',
    PAIR_REJECT: 'pair.reject',
    PAIR_REVOKED: 'pair.revoked',
    SEARCH_START: 'search.start',
    SEARCH_PROGRESS: 'search.progress',
    SEARCH_COMPLETE: 'search.complete',
    SEARCH_ERROR: 'search.error',
    SESSION_RESUME: 'session.resume',
    INTERNAL_AUTH_ERROR: 'internal.auth_error',
    INTERNAL_DELIVERY_ERROR: 'internal.delivery_error'
  });

  const RESULT_STATUSES = Object.freeze([
    'queued',
    'executing',
    'pending',
    'streaming',
    'ok',
    'timeout',
    'login_required',
    'blocked',
    'landing_page',
    'not_submitted',
    'error'
  ]);

  const TERMINAL_RESULT_STATUSES = new Set([
    'ok',
    'timeout',
    'login_required',
    'blocked',
    'landing_page',
    'not_submitted',
    'error'
  ]);

  const CONNECTION_STATUSES = Object.freeze({
    DISABLED: 'disabled',
    CONNECTING: 'connecting',
    ONLINE: 'online',
    OFFLINE: 'offline',
    ERROR: 'error'
  });

  const STORAGE_KEYS = Object.freeze({
    SETTINGS: 'remoteSearchSettings',
    DEVICE_IDENTITY: 'remoteSearchDeviceIdentity',
    PAIR_RECORD: 'remoteSearchPairRecord',
    PENDING_PAIR_REQUEST: 'remoteSearchPendingPairRequest',
    PAIRING_TICKET: 'remoteSearchPairingTicket',
    LAST_ERROR: 'remoteSearchLastError',
    ACTIVE_SESSION: 'remoteSearchActiveSession',
    LAST_SNAPSHOTS: 'remoteSearchLastSnapshots',
    COMPARE_TAB_ID: 'remoteSearchCompareTabId'
  });

  const NOTIFICATION_IDS = Object.freeze({
    PAIR_REQUEST: 'remote-search-pair-request'
  });

  const ERROR_CODES = Object.freeze({
    DISABLED: 'remote_search_disabled',
    NOT_PAIRED: 'not_paired',
    BUSY: 'busy',
    NO_COMPATIBLE_SITES: 'no_compatible_sites',
    RELAY_UNAVAILABLE: 'relay_unavailable',
    INVALID_QR_PAYLOAD: 'invalid_qr_payload'
  });

  const REQUIRED_QR_FIELDS = Object.freeze([
    'v',
    'relayBaseUrl',
    'ticketId',
    'desktopDeviceId',
    'desktopPublicKey',
    'desktopName',
    'fingerprint',
    'expiresAt'
  ]);

  function nowIso() {
    return new Date().toISOString();
  }

  function safeParseJson(value, fallback = null) {
    if (typeof value !== 'string' || !value.trim()) {
      return fallback;
    }

    try {
      return JSON.parse(value);
    } catch (_) {
      return fallback;
    }
  }

  function toTrimmedString(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function normalizeRelayBaseUrl(value) {
    return toTrimmedString(value).replace(/\/+$/, '');
  }

  function buildRelayUrl(baseUrl, pathname) {
    const normalizedBaseUrl = normalizeRelayBaseUrl(baseUrl);
    const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
    return `${normalizedBaseUrl}${normalizedPath}`;
  }

  function normalizeResultStatus(value) {
    const candidate = toTrimmedString(value);
    return RESULT_STATUSES.includes(candidate) ? candidate : 'error';
  }

  function isTerminalResultStatus(value) {
    return TERMINAL_RESULT_STATUSES.has(normalizeResultStatus(value));
  }

  function stableValue(value) {
    if (Array.isArray(value)) {
      return value.map(stableValue);
    }

    if (value && typeof value === 'object') {
      return Object.keys(value)
        .sort()
        .reduce((acc, key) => {
          acc[key] = stableValue(value[key]);
          return acc;
        }, {});
    }

    return value;
  }

  function stableStringify(value) {
    return JSON.stringify(stableValue(value));
  }

  function createId(prefix) {
    const safePrefix = toTrimmedString(prefix) || 'id';
    return `${safePrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function createQrPayload(fields) {
    return {
      v: REMOTE_PROTOCOL_VERSION,
      relayBaseUrl: normalizeRelayBaseUrl(fields?.relayBaseUrl),
      ticketId: toTrimmedString(fields?.ticketId),
      desktopDeviceId: toTrimmedString(fields?.desktopDeviceId),
      desktopPublicKey: fields?.desktopPublicKey || null,
      desktopName: toTrimmedString(fields?.desktopName),
      fingerprint: toTrimmedString(fields?.fingerprint),
      expiresAt: toTrimmedString(fields?.expiresAt)
    };
  }

  function validateQrPayload(value) {
    const payload = typeof value === 'string' ? safeParseJson(value, null) : value;
    if (!payload || typeof payload !== 'object') {
      return {
        ok: false,
        error: ERROR_CODES.INVALID_QR_PAYLOAD
      };
    }

    const missingField = REQUIRED_QR_FIELDS.find((field) => {
      if (field === 'desktopPublicKey') {
        return !payload[field] || typeof payload[field] !== 'object';
      }
      return !toTrimmedString(payload[field]);
    });

    if (missingField) {
      return {
        ok: false,
        error: `${ERROR_CODES.INVALID_QR_PAYLOAD}:${missingField}`
      };
    }

    if (Number(payload.v) !== REMOTE_PROTOCOL_VERSION) {
      return {
        ok: false,
        error: `${ERROR_CODES.INVALID_QR_PAYLOAD}:version`
      };
    }

    return {
      ok: true,
      payload: createQrPayload(payload)
    };
  }

  function parseQrPayload(value) {
    const result = validateQrPayload(value);
    if (!result.ok) {
      throw new Error(result.error);
    }
    return result.payload;
  }

  function buildAuthChallengeInput(fields = {}) {
    return stableStringify({
      route: toTrimmedString(fields.route) || FRAME_TYPES.PRESENCE_HELLO,
      deviceId: toTrimmedString(fields.deviceId),
      challenge: toTrimmedString(fields.challenge),
      timestamp: toTrimmedString(fields.timestamp)
    });
  }

  function normalizePairRecord(record = null) {
    if (!record || typeof record !== 'object') {
      return null;
    }

    const pairId = toTrimmedString(record.pairId);
    if (!pairId) {
      return null;
    }

    return {
      pairId,
      desktopDeviceId: toTrimmedString(record.desktopDeviceId),
      phoneDeviceId: toTrimmedString(record.phoneDeviceId),
      phoneName: toTrimmedString(record.phoneName),
      phonePlatform: toTrimmedString(record.phonePlatform),
      phoneFingerprint: toTrimmedString(record.phoneFingerprint),
      phonePublicKey: record.phonePublicKey || null,
      status: toTrimmedString(record.status) || 'active',
      createdAt: toTrimmedString(record.createdAt),
      approvedAt: toTrimmedString(record.approvedAt),
      revokedAt: toTrimmedString(record.revokedAt)
    };
  }

  function normalizePendingPairRequest(record = null) {
    if (!record || typeof record !== 'object') {
      return null;
    }

    const pairId = toTrimmedString(record.pairId);
    if (!pairId) {
      return null;
    }

    return {
      pairId,
      ticketId: toTrimmedString(record.ticketId),
      desktopDeviceId: toTrimmedString(record.desktopDeviceId),
      phoneDeviceId: toTrimmedString(record.phoneDeviceId),
      phoneName: toTrimmedString(record.phoneName),
      phonePlatform: toTrimmedString(record.phonePlatform),
      phoneFingerprint: toTrimmedString(record.phoneFingerprint),
      phonePublicKey: record.phonePublicKey || null,
      ciphertext: toTrimmedString(record.ciphertext),
      iv: toTrimmedString(record.iv),
      createdAt: toTrimmedString(record.createdAt),
      receivedAt: toTrimmedString(record.receivedAt)
    };
  }

  function normalizeSnapshotEnvelope(envelope = null) {
    if (!envelope || typeof envelope !== 'object') {
      return null;
    }

    const requestId = toTrimmedString(envelope.requestId);
    if (!requestId) {
      return null;
    }

    return {
      requestId,
      pairId: toTrimmedString(envelope.pairId),
      type: toTrimmedString(envelope.type) || FRAME_TYPES.SEARCH_PROGRESS,
      completed: envelope.completed === true,
      result: envelope.result && typeof envelope.result === 'object'
        ? envelope.result
        : null,
      updatedAt: toTrimmedString(envelope.updatedAt) || nowIso()
    };
  }

  return {
    REMOTE_PROTOCOL_VERSION,
    FRAME_TYPES,
    RESULT_STATUSES,
    CONNECTION_STATUSES,
    STORAGE_KEYS,
    NOTIFICATION_IDS,
    ERROR_CODES,
    REQUIRED_QR_FIELDS,
    nowIso,
    safeParseJson,
    stableStringify,
    normalizeRelayBaseUrl,
    buildRelayUrl,
    normalizeResultStatus,
    isTerminalResultStatus,
    createId,
    createQrPayload,
    validateQrPayload,
    parseQrPayload,
    buildAuthChallengeInput,
    normalizePairRecord,
    normalizePendingPairRequest,
    normalizeSnapshotEnvelope
  };
});
