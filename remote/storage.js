(function(root, factory) {
  const common = typeof module !== 'undefined' && module.exports
    ? require('./common.js')
    : (root && root.AIRemoteCommon);
  const remoteState = typeof module !== 'undefined' && module.exports
    ? require('./state.js')
    : (root && root.AIRemoteState);
  const api = factory(common, remoteState);

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (root && typeof root === 'object') {
    root.AIRemoteStorage = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function(common, remoteState) {
  function createPersistedRecordBundle() {
    const defaults = remoteState.createDefaultPersistence();
    return {
      [common.STORAGE_KEYS.SETTINGS]: defaults.settings,
      [common.STORAGE_KEYS.DEVICE_IDENTITY]: defaults.deviceIdentity,
      [common.STORAGE_KEYS.PAIR_RECORD]: defaults.pairRecord,
      [common.STORAGE_KEYS.PENDING_PAIR_REQUEST]: defaults.pendingPairRequest,
      [common.STORAGE_KEYS.PAIRING_TICKET]: defaults.pairingTicket,
      [common.STORAGE_KEYS.ACTIVE_SESSION]: defaults.activeSession,
      [common.STORAGE_KEYS.LAST_SNAPSHOTS]: defaults.lastSnapshots,
      [common.STORAGE_KEYS.LAST_ERROR]: defaults.lastError,
      [common.STORAGE_KEYS.COMPARE_TAB_ID]: defaults.compareTabId
    };
  }

  function mergeRecordsIntoPersistence(records = {}) {
    return remoteState.normalizePersistence({
      settings: records[common.STORAGE_KEYS.SETTINGS],
      deviceIdentity: records[common.STORAGE_KEYS.DEVICE_IDENTITY],
      pairRecord: records[common.STORAGE_KEYS.PAIR_RECORD],
      pendingPairRequest: records[common.STORAGE_KEYS.PENDING_PAIR_REQUEST],
      pairingTicket: records[common.STORAGE_KEYS.PAIRING_TICKET],
      activeSession: records[common.STORAGE_KEYS.ACTIVE_SESSION],
      lastSnapshots: records[common.STORAGE_KEYS.LAST_SNAPSHOTS],
      lastError: records[common.STORAGE_KEYS.LAST_ERROR],
      compareTabId: records[common.STORAGE_KEYS.COMPARE_TAB_ID]
    });
  }

  function persistenceToRecords(persistence = {}) {
    const normalized = remoteState.normalizePersistence(persistence);
    return {
      [common.STORAGE_KEYS.SETTINGS]: normalized.settings,
      [common.STORAGE_KEYS.DEVICE_IDENTITY]: normalized.deviceIdentity,
      [common.STORAGE_KEYS.PAIR_RECORD]: normalized.pairRecord,
      [common.STORAGE_KEYS.PENDING_PAIR_REQUEST]: normalized.pendingPairRequest,
      [common.STORAGE_KEYS.PAIRING_TICKET]: normalized.pairingTicket,
      [common.STORAGE_KEYS.ACTIVE_SESSION]: normalized.activeSession,
      [common.STORAGE_KEYS.LAST_SNAPSHOTS]: normalized.lastSnapshots,
      [common.STORAGE_KEYS.LAST_ERROR]: normalized.lastError,
      [common.STORAGE_KEYS.COMPARE_TAB_ID]: normalized.compareTabId
    };
  }

  async function readPersistence(storageArea) {
    const area = storageArea || chrome.storage.local;
    const records = await area.get(Object.values(common.STORAGE_KEYS));
    return mergeRecordsIntoPersistence(records);
  }

  async function writePersistence(storageArea, persistence = {}) {
    const area = storageArea || chrome.storage.local;
    await area.set(persistenceToRecords(persistence));
  }

  async function patchPersistence(storageArea, patch = {}) {
    const current = await readPersistence(storageArea);
    const next = remoteState.normalizePersistence({
      ...current,
      ...patch
    });
    await writePersistence(storageArea, next);
    return next;
  }

  return {
    createPersistedRecordBundle,
    mergeRecordsIntoPersistence,
    persistenceToRecords,
    readPersistence,
    writePersistence,
    patchPersistence
  };
});
