(function(root, factory) {
  const common = typeof module !== 'undefined' && module.exports
    ? require('./common.js')
    : (root && root.AIRemoteCommon);
  const api = factory(common);

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (root && typeof root === 'object') {
    root.AIRemoteState = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function(common) {
  const DEFAULT_RELAY_BASE_URL = 'http://127.0.0.1:8787';

  function createDefaultSettings() {
    return {
      enabled: false,
      relayBaseUrl: DEFAULT_RELAY_BASE_URL,
      desktopName: ''
    };
  }

  function createDefaultPersistence() {
    return {
      settings: createDefaultSettings(),
      deviceIdentity: null,
      pairRecord: null,
      pendingPairRequest: null,
      pairingTicket: null,
      activeSession: null,
      lastSnapshots: {},
      lastError: '',
      compareTabId: null
    };
  }

  function createDefaultUiState() {
    return {
      settings: createDefaultSettings(),
      connectionStatus: common.CONNECTION_STATUSES.DISABLED,
      paired: false,
      deviceIdentity: null,
      pairRecord: null,
      pendingPairRequest: null,
      pairingTicket: null,
      activeSession: null,
      lastSnapshot: null,
      lastError: '',
      updatedAt: common.nowIso()
    };
  }

  function toTrimmedString(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function normalizeConnectionStatus(value) {
    const candidate = toTrimmedString(value);
    return Object.values(common.CONNECTION_STATUSES).includes(candidate)
      ? candidate
      : common.CONNECTION_STATUSES.OFFLINE;
  }

  function normalizeSettings(settings = {}) {
    const defaults = createDefaultSettings();
    return {
      enabled: settings.enabled === true,
      relayBaseUrl: common.normalizeRelayBaseUrl(settings.relayBaseUrl || defaults.relayBaseUrl) || defaults.relayBaseUrl,
      desktopName: toTrimmedString(settings.desktopName)
    };
  }

  function normalizeDeviceIdentity(identity = null) {
    if (!identity || typeof identity !== 'object') {
      return null;
    }

    const deviceId = toTrimmedString(identity.deviceId);
    if (!deviceId) {
      return null;
    }

    return {
      deviceId,
      deviceSecret: toTrimmedString(identity.deviceSecret),
      deviceAuthKey: toTrimmedString(identity.deviceAuthKey),
      publicKey: identity.publicKey || null,
      privateKey: identity.privateKey || null,
      fingerprint: toTrimmedString(identity.fingerprint),
      deviceName: toTrimmedString(identity.deviceName),
      createdAt: toTrimmedString(identity.createdAt)
    };
  }

  function normalizePairingTicket(ticket = null) {
    if (!ticket || typeof ticket !== 'object') {
      return null;
    }

    const ticketId = toTrimmedString(ticket.ticketId);
    if (!ticketId) {
      return null;
    }

    return {
      ticketId,
      relayBaseUrl: common.normalizeRelayBaseUrl(ticket.relayBaseUrl),
      qrPayload: ticket.qrPayload && typeof ticket.qrPayload === 'object' ? ticket.qrPayload : null,
      expiresAt: toTrimmedString(ticket.expiresAt),
      createdAt: toTrimmedString(ticket.createdAt)
    };
  }

  function normalizeActiveSession(session = null) {
    if (!session || typeof session !== 'object') {
      return null;
    }

    const requestId = toTrimmedString(session.requestId);
    if (!requestId) {
      return null;
    }
    const tabId = Number(session.tabId);

    return {
      requestId,
      pairId: toTrimmedString(session.pairId),
      query: toTrimmedString(session.query),
      tabId: Number.isFinite(tabId) ? tabId : null,
      startedAt: toTrimmedString(session.startedAt),
      status: toTrimmedString(session.status) || 'running'
    };
  }

  function normalizeSnapshotMap(value = null) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return Object.keys(value).reduce((acc, key) => {
      const normalized = common.normalizeSnapshotEnvelope(value[key]);
      if (normalized) {
        acc[key] = normalized;
      }
      return acc;
    }, {});
  }

  function normalizePersistence(value = {}) {
    const defaults = createDefaultPersistence();
    return {
      settings: normalizeSettings(value.settings || defaults.settings),
      deviceIdentity: normalizeDeviceIdentity(value.deviceIdentity),
      pairRecord: common.normalizePairRecord(value.pairRecord),
      pendingPairRequest: common.normalizePendingPairRequest(value.pendingPairRequest),
      pairingTicket: normalizePairingTicket(value.pairingTicket),
      activeSession: normalizeActiveSession(value.activeSession),
      lastSnapshots: normalizeSnapshotMap(value.lastSnapshots),
      lastError: toTrimmedString(value.lastError),
      compareTabId: Number.isFinite(Number(value.compareTabId)) ? Number(value.compareTabId) : null
    };
  }

  function buildUiState(persistence = {}, runtime = {}) {
    const normalizedPersistence = normalizePersistence(persistence);
    const uiState = createDefaultUiState();
    const normalizedConnectionStatus = normalizeConnectionStatus(runtime.connectionStatus);
    const activeRequestId = runtime.activeRequestId || normalizedPersistence.activeSession?.requestId || '';
    const lastSnapshot = activeRequestId
      ? normalizedPersistence.lastSnapshots[activeRequestId] || null
      : null;

    return {
      ...uiState,
      settings: normalizedPersistence.settings,
      deviceIdentity: normalizedPersistence.deviceIdentity
        ? {
            deviceId: normalizedPersistence.deviceIdentity.deviceId,
            fingerprint: normalizedPersistence.deviceIdentity.fingerprint,
            deviceName: normalizedPersistence.deviceIdentity.deviceName
          }
        : null,
      connectionStatus: normalizedConnectionStatus,
      paired: Boolean(normalizedPersistence.pairRecord && normalizedPersistence.pairRecord.status !== 'revoked'),
      pairRecord: normalizedPersistence.pairRecord,
      pendingPairRequest: normalizedPersistence.pendingPairRequest,
      pairingTicket: normalizedPersistence.pairingTicket,
      activeSession: normalizedPersistence.activeSession,
      lastSnapshot,
      lastError: runtime.lastError ? toTrimmedString(runtime.lastError) : normalizedPersistence.lastError,
      compareTabId: normalizedPersistence.compareTabId,
      updatedAt: common.nowIso()
    };
  }

  function normalizeSnapshotResult(result = null) {
    if (!result || typeof result !== 'object') {
      return null;
    }

    const cloned = {
      ...result
    };

    if (Array.isArray(cloned.results)) {
      cloned.results = cloned.results.map((item) => ({
        ...item,
        status: common.normalizeResultStatus(item?.status)
      }));
    }

    return cloned;
  }

  return {
    DEFAULT_RELAY_BASE_URL,
    createDefaultSettings,
    createDefaultPersistence,
    createDefaultUiState,
    normalizeConnectionStatus,
    normalizeSettings,
    normalizeDeviceIdentity,
    normalizePairingTicket,
    normalizeActiveSession,
    normalizePersistence,
    normalizeSnapshotResult,
    buildUiState
  };
});
