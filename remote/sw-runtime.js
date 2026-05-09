(function(root, factory) {
  const common = typeof module !== 'undefined' && module.exports
    ? require('./common.js')
    : (root && root.AIRemoteCommon);
  const remoteCrypto = typeof module !== 'undefined' && module.exports
    ? require('./crypto.js')
    : (root && root.AIRemoteCrypto);
  const remoteState = typeof module !== 'undefined' && module.exports
    ? require('./state.js')
    : (root && root.AIRemoteState);
  const remoteStorage = typeof module !== 'undefined' && module.exports
    ? require('./storage.js')
    : (root && root.AIRemoteStorage);
  const api = factory(common, remoteCrypto, remoteState, remoteStorage);

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (root && typeof root === 'object') {
    root.AIRemoteRuntimeFactory = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function(common, remoteCrypto, remoteState, remoteStorage) {
  const HEARTBEAT_INTERVAL_MS = 20000;
  const RECONNECT_DELAY_MS = 5000;
  const CONNECT_WAIT_TIMEOUT_MS = 5000;

  function createRemoteRuntime(options = {}) {
    const logger = options.logger || console;
    const storageArea = options.storageArea || (typeof chrome !== 'undefined' ? chrome.storage.local : null);
    const chromeApi = options.chromeApi || (typeof chrome !== 'undefined' ? chrome : null);
    const fetchImpl = options.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    const WebSocketImpl = options.WebSocketImpl || (typeof WebSocket !== 'undefined' ? WebSocket : null);

    if (!storageArea || !chromeApi || !fetchImpl || !WebSocketImpl) {
      throw new Error('Remote runtime requires chrome, storage, fetch, and WebSocket support.');
    }

    let persistence = remoteState.createDefaultPersistence();
    let connectionStatus = common.CONNECTION_STATUSES.DISABLED;
    let socket = null;
    let heartbeatTimer = null;
    let reconnectTimer = null;
    let reconnectEnabled = true;
    let isInitialized = false;

    async function initialize() {
      persistence = await remoteStorage.readPersistence(storageArea);
      if (!persistence.deviceIdentity) {
        persistence = await ensureDeviceIdentity();
      }
      if (persistence.settings.enabled) {
        await connect();
      } else {
        connectionStatus = common.CONNECTION_STATUSES.DISABLED;
      }
      isInitialized = true;
      broadcastState().catch(() => {});
      return getUiState();
    }

    function getUiState() {
      return remoteState.buildUiState(persistence, {
        connectionStatus,
        lastError: persistence.lastError,
        activeRequestId: persistence.activeSession?.requestId || ''
      });
    }

    async function setLastError(message) {
      const nextError = typeof message === 'string' ? message.trim() : '';
      if (persistence.lastError === nextError) {
        return;
      }
      persistence = await remoteStorage.patchPersistence(storageArea, {
        lastError: nextError
      });
      broadcastState().catch(() => {});
    }

    async function clearLastError() {
      if (!persistence.lastError) {
        return;
      }
      await setLastError('');
    }

    async function setRelayUnavailableState(message) {
      connectionStatus = common.CONNECTION_STATUSES.OFFLINE;
      await setLastError(message);
      await broadcastState();
      scheduleReconnect();
      return false;
    }

    async function probeRelayHealth() {
      const healthzUrl = common.buildRelayUrl(persistence.settings.relayBaseUrl, '/healthz');
      const abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timeoutId = abortController
        ? setTimeout(() => {
            try {
              abortController.abort();
            } catch (_) {
              // Ignore abort failures.
            }
          }, 3000)
        : null;

      try {
        const response = await fetchImpl(healthzUrl, {
          method: 'GET',
          cache: 'no-store',
          signal: abortController?.signal
        });
        return Boolean(response && response.ok);
      } catch (_) {
        return false;
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      }
    }

    async function ensureDeviceIdentity() {
      if (persistence.deviceIdentity?.deviceId && persistence.deviceIdentity?.deviceSecret) {
        return persistence;
      }

      const deviceSecret = await remoteCrypto.createDeviceSecret();
      const deviceAuthKey = await remoteCrypto.createDeviceAuthKey(deviceSecret);
      const keyPair = await remoteCrypto.generateLongTermKeyPair();
      const fingerprint = await remoteCrypto.fingerprintPublicKey(keyPair.publicKey);
      const deviceId = common.createId('desktop');
      const defaultDesktopName = persistence.settings.desktopName
        || `AI Compare ${deviceId.slice(-6)}`;

      persistence = await remoteStorage.patchPersistence(storageArea, {
        deviceIdentity: {
          deviceId,
          deviceSecret,
          deviceAuthKey,
          publicKey: keyPair.publicKey,
          privateKey: keyPair.privateKey,
          fingerprint,
          deviceName: defaultDesktopName,
          createdAt: common.nowIso()
        }
      });

      return persistence;
    }

    async function updateCompareTabId(compareTabId) {
      persistence = await remoteStorage.patchPersistence(storageArea, {
        compareTabId: Number.isFinite(compareTabId) ? compareTabId : null
      });
      return persistence.compareTabId;
    }

    function scheduleHeartbeat() {
      clearTimeout(heartbeatTimer);
      heartbeatTimer = setTimeout(async () => {
        try {
          if (socket && socket.readyState === WebSocketImpl.OPEN) {
            await sendAuthenticatedFrame({
              type: common.FRAME_TYPES.PRESENCE_PING,
              connectionStatus
            });
          }
        } catch (error) {
          logger.warn('Remote heartbeat failed:', error);
        } finally {
          scheduleHeartbeat();
        }
      }, HEARTBEAT_INTERVAL_MS);
    }

    function cancelReconnect() {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    }

    function scheduleReconnect() {
      if (!reconnectEnabled || !persistence.settings.enabled) {
        return;
      }
      cancelReconnect();
      reconnectTimer = setTimeout(() => {
        connect().catch((error) => {
          logger.warn('Remote reconnect failed:', error);
        });
      }, RECONNECT_DELAY_MS);
    }

    async function waitForConnectionStatus(targetStatus, timeoutMs = CONNECT_WAIT_TIMEOUT_MS) {
      const expectedStatus = String(targetStatus || '').trim();
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        if (connectionStatus === expectedStatus) {
          return true;
        }
        if (
          connectionStatus === common.CONNECTION_STATUSES.ERROR
          || connectionStatus === common.CONNECTION_STATUSES.DISABLED
          || connectionStatus === common.CONNECTION_STATUSES.OFFLINE
        ) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return connectionStatus === expectedStatus;
    }

    async function broadcastState() {
      const state = getUiState();
      try {
        await chromeApi.runtime.sendMessage({
          type: 'remoteStateChanged',
          state
        });
      } catch (_) {
        // Ignore "no receiving end" errors for pages that are not currently open.
      }
      return state;
    }

    async function connect() {
      if (!persistence.settings.enabled) {
        connectionStatus = common.CONNECTION_STATUSES.DISABLED;
        await broadcastState();
        return;
      }

      if (socket && (socket.readyState === WebSocketImpl.OPEN || socket.readyState === WebSocketImpl.CONNECTING)) {
        return;
      }

      cancelReconnect();
      await ensureDeviceIdentity();

      connectionStatus = common.CONNECTION_STATUSES.CONNECTING;
      await broadcastState();

      const relayAvailable = await probeRelayHealth();
      if (!relayAvailable) {
        const message = chromeApi.i18n?.getMessage('remoteSearchRelayUnavailable') || 'Remote relay is offline.';
        socket = null;
        await setRelayUnavailableState(message);
        return;
      }

      const wsUrl = common.buildRelayUrl(persistence.settings.relayBaseUrl, '/ws')
        .replace(/^http:/i, 'ws:')
        .replace(/^https:/i, 'wss:');
      try {
        socket = new WebSocketImpl(wsUrl);
      } catch (_) {
        const message = chromeApi.i18n?.getMessage('remoteSearchRelayUnavailable') || 'Remote relay is offline.';
        socket = null;
        await setRelayUnavailableState(message);
        return;
      }

      socket.addEventListener('open', async () => {
        connectionStatus = common.CONNECTION_STATUSES.ONLINE;
        await sendAuthenticatedFrame({
          type: common.FRAME_TYPES.PRESENCE_HELLO,
          role: 'desktop',
          pairId: persistence.pairRecord?.pairId || '',
          fingerprint: persistence.deviceIdentity?.fingerprint || '',
          deviceName: persistence.settings.desktopName || persistence.deviceIdentity?.deviceName || ''
        });
        await clearLastError();
        scheduleHeartbeat();
        await broadcastState();
      });

      socket.addEventListener('message', (event) => {
        handleSocketMessage(event.data).catch((error) => {
          logger.error('Failed to process remote relay frame:', error);
        });
      });

      socket.addEventListener('close', async () => {
        connectionStatus = persistence.settings.enabled
          ? common.CONNECTION_STATUSES.OFFLINE
          : common.CONNECTION_STATUSES.DISABLED;
        clearTimeout(heartbeatTimer);
        socket = null;
        await broadcastState();
        scheduleReconnect();
      });

      socket.addEventListener('error', async () => {
        connectionStatus = common.CONNECTION_STATUSES.ERROR;
        await setLastError('Unable to connect to the remote relay.');
        await broadcastState();
      });
    }

    async function disconnect(options = {}) {
      const disableReconnect = options.disableReconnect !== false;
      if (disableReconnect) {
        reconnectEnabled = false;
      }
      cancelReconnect();
      clearTimeout(heartbeatTimer);
      if (socket) {
        try {
          socket.close();
        } catch (_) {
          // Ignore close failures.
        }
      }
      socket = null;
      connectionStatus = persistence.settings.enabled
        ? common.CONNECTION_STATUSES.OFFLINE
        : common.CONNECTION_STATUSES.DISABLED;
      await broadcastState();
    }

    async function reconnect() {
      reconnectEnabled = true;
      await disconnect({ disableReconnect: false });
      reconnectEnabled = true;
      if (persistence.settings.enabled) {
        await connect();
      }
    }

    async function sendAuthenticatedFrame(payload = {}) {
      if (!socket || socket.readyState !== WebSocketImpl.OPEN) {
        throw new Error('Remote relay socket is not open.');
      }

      const deviceIdentity = persistence.deviceIdentity;
      const timestamp = common.nowIso();
      const challenge = common.createId('challenge');
      const proof = await remoteCrypto.computeDeviceProof({
        authKey: deviceIdentity.deviceAuthKey,
        deviceId: deviceIdentity.deviceId,
        route: payload.type || common.FRAME_TYPES.PRESENCE_HELLO,
        challenge,
        timestamp
      });

      socket.send(JSON.stringify({
        ...payload,
        v: common.REMOTE_PROTOCOL_VERSION,
        deviceId: deviceIdentity.deviceId,
        challenge,
        timestamp,
        proof
      }));
    }

    async function upsertSettings(nextSettings = {}) {
      const nextDesktopName = typeof nextSettings.desktopName === 'string'
        ? nextSettings.desktopName.trim()
        : '';
      persistence = await remoteStorage.patchPersistence(storageArea, {
        settings: {
          ...persistence.settings,
          ...nextSettings
        },
        deviceIdentity: persistence.deviceIdentity
          ? {
              ...persistence.deviceIdentity,
              deviceName: nextDesktopName || persistence.deviceIdentity.deviceName
            }
          : persistence.deviceIdentity
      });

      const nextConnectionStatus = persistence.settings.enabled
        ? common.CONNECTION_STATUSES.OFFLINE
        : common.CONNECTION_STATUSES.DISABLED;
      connectionStatus = nextConnectionStatus;

      if (persistence.settings.enabled) {
        reconnectEnabled = true;
        await reconnect();
      } else {
        await disconnect();
      }

      return getUiState();
    }

    async function createPairingTicket() {
      await ensureDeviceIdentity();
      await clearLastError();

      if (!persistence.settings.enabled) {
        throw new Error(common.ERROR_CODES.DISABLED);
      }

      if (connectionStatus !== common.CONNECTION_STATUSES.ONLINE) {
        await reconnect();
        await waitForConnectionStatus(common.CONNECTION_STATUSES.ONLINE);
      }

      if (connectionStatus !== common.CONNECTION_STATUSES.ONLINE) {
        throw new Error(common.ERROR_CODES.RELAY_UNAVAILABLE);
      }

      const response = await fetchImpl(common.buildRelayUrl(persistence.settings.relayBaseUrl, '/pairing-tickets'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          deviceId: persistence.deviceIdentity.deviceId,
          deviceName: persistence.settings.desktopName || persistence.deviceIdentity.deviceName,
          platform: 'chrome-extension',
          deviceSecretHash: persistence.deviceIdentity.deviceAuthKey,
          publicKey: persistence.deviceIdentity.publicKey,
          fingerprint: persistence.deviceIdentity.fingerprint
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to create pairing ticket: HTTP ${response.status}`);
      }

      const data = await response.json();
      if (socket && socket.readyState === WebSocketImpl.OPEN) {
        await sendAuthenticatedFrame({
          type: common.FRAME_TYPES.PRESENCE_HELLO,
          role: 'desktop',
          pairId: persistence.pairRecord?.pairId || '',
          fingerprint: persistence.deviceIdentity?.fingerprint || '',
          deviceName: persistence.settings.desktopName || persistence.deviceIdentity?.deviceName || ''
        });
      }

      const qrPayload = common.createQrPayload({
        relayBaseUrl: persistence.settings.relayBaseUrl,
        ticketId: data.ticketId,
        desktopDeviceId: persistence.deviceIdentity.deviceId,
        desktopPublicKey: persistence.deviceIdentity.publicKey,
        desktopName: persistence.settings.desktopName || persistence.deviceIdentity.deviceName,
        fingerprint: persistence.deviceIdentity.fingerprint,
        expiresAt: data.expiresAt
      });

      persistence = await remoteStorage.patchPersistence(storageArea, {
        pairingTicket: {
          ticketId: data.ticketId,
          relayBaseUrl: persistence.settings.relayBaseUrl,
          qrPayload,
          expiresAt: data.expiresAt,
          createdAt: common.nowIso()
        }
      });

      await broadcastState();
      return persistence.pairingTicket;
    }

    async function revokePairing() {
      if (!persistence.pairRecord?.pairId) {
        persistence = await remoteStorage.patchPersistence(storageArea, {
          pairRecord: null,
          pendingPairRequest: null,
          activeSession: null,
          compareTabId: null
        });
        await broadcastState();
        return;
      }

      try {
        await fetchImpl(common.buildRelayUrl(persistence.settings.relayBaseUrl, `/pairings/${encodeURIComponent(persistence.pairRecord.pairId)}/revoke`), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            deviceId: persistence.deviceIdentity.deviceId
          })
        });
      } catch (error) {
        logger.warn('Failed to revoke remote pair on relay:', error);
      }

      persistence = await remoteStorage.patchPersistence(storageArea, {
        pairRecord: null,
        pendingPairRequest: null,
        activeSession: null,
        compareTabId: null
      });
      await broadcastState();
    }

    async function approvePendingPair() {
      const pendingPairRequest = persistence.pendingPairRequest;
      if (!pendingPairRequest || !pendingPairRequest.pairId) {
        throw new Error('No pending pair request is available.');
      }

      if (persistence.pairRecord?.pairId && persistence.pairRecord.pairId !== pendingPairRequest.pairId) {
        await revokePairing();
      }

      const approvalPayload = await remoteCrypto.encryptJsonPayload({
        privateKeyJwk: persistence.deviceIdentity.privateKey,
        peerPublicKeyJwk: pendingPairRequest.phonePublicKey,
        payload: {
          pairId: pendingPairRequest.pairId,
          desktopDeviceId: persistence.deviceIdentity.deviceId,
          desktopName: persistence.settings.desktopName || persistence.deviceIdentity.deviceName,
          fingerprint: persistence.deviceIdentity.fingerprint,
          approvedAt: common.nowIso()
        },
        aad: {
          type: common.FRAME_TYPES.PAIR_APPROVE,
          pairId: pendingPairRequest.pairId
        }
      });

      await sendAuthenticatedFrame({
        type: common.FRAME_TYPES.PAIR_APPROVE,
        pairId: pendingPairRequest.pairId,
        desktopDeviceId: persistence.deviceIdentity.deviceId,
        phoneDeviceId: pendingPairRequest.phoneDeviceId,
        ciphertext: approvalPayload.ciphertext,
        iv: approvalPayload.iv
      });

      persistence = await remoteStorage.patchPersistence(storageArea, {
        pairRecord: {
          pairId: pendingPairRequest.pairId,
          desktopDeviceId: persistence.deviceIdentity.deviceId,
          phoneDeviceId: pendingPairRequest.phoneDeviceId,
          phoneName: pendingPairRequest.phoneName,
          phonePlatform: pendingPairRequest.phonePlatform,
          phoneFingerprint: pendingPairRequest.phoneFingerprint,
          phonePublicKey: pendingPairRequest.phonePublicKey,
          status: 'active',
          createdAt: pendingPairRequest.createdAt || common.nowIso(),
          approvedAt: common.nowIso()
        },
        pendingPairRequest: null,
        pairingTicket: null
      });

      try {
        await chromeApi.notifications.clear(common.NOTIFICATION_IDS.PAIR_REQUEST);
      } catch (_) {
        // Ignore notification cleanup errors.
      }

      await broadcastState();
      return persistence.pairRecord;
    }

    async function rejectPendingPair() {
      const pendingPairRequest = persistence.pendingPairRequest;
      if (!pendingPairRequest || !pendingPairRequest.pairId) {
        return;
      }

      await sendAuthenticatedFrame({
        type: common.FRAME_TYPES.PAIR_REJECT,
        pairId: pendingPairRequest.pairId,
        desktopDeviceId: persistence.deviceIdentity.deviceId,
        phoneDeviceId: pendingPairRequest.phoneDeviceId
      });

      persistence = await remoteStorage.patchPersistence(storageArea, {
        pendingPairRequest: null
      });

      try {
        await chromeApi.notifications.clear(common.NOTIFICATION_IDS.PAIR_REQUEST);
      } catch (_) {
        // Ignore notification cleanup errors.
      }

      await broadcastState();
    }

    async function showPairRequestNotification(request) {
      try {
        await chromeApi.notifications.create(common.NOTIFICATION_IDS.PAIR_REQUEST, {
          type: 'basic',
          iconUrl: chromeApi.runtime.getURL('icons/icon128.png'),
          title: chromeApi.i18n?.getMessage('remoteSearchNotificationTitle') || 'Remote Search',
          message: chromeApi.i18n?.getMessage('remoteSearchPairRequestBody', [request.phoneName || request.phoneDeviceId || 'New device'])
            || `Pair request from ${request.phoneName || request.phoneDeviceId || 'a new device'}`,
          priority: 2,
          buttons: [
            {
              title: chromeApi.i18n?.getMessage('remoteSearchApproveButton') || 'Approve'
            },
            {
              title: chromeApi.i18n?.getMessage('remoteSearchRejectButton') || 'Reject'
            }
          ]
        });
      } catch (error) {
        logger.warn('Failed to show remote pair request notification:', error);
      }
    }

    async function openRemoteSearchTab({ query, pairId, requestId }) {
      const compatibleSites = await (typeof self !== 'undefined' && typeof self.getDefaultSites === 'function'
        ? self.getDefaultSites()
        : Promise.resolve([]));

      const supportedSites = (compatibleSites || []).filter((site) => (
        site
        && site.enabled === true
        && !site.hidden
        && site.supportIframe !== false
      ));

      if (supportedSites.length === 0) {
        throw new Error(common.ERROR_CODES.NO_COMPATIBLE_SITES);
      }

      const params = new URLSearchParams();
      params.set('openclaw', '1');
      params.set('remote_mode', '1');
      params.set('remote_pair_id', pairId);
      params.set('remote_request_id', requestId);
      params.set('query', query);
      const targetUrl = `${chromeApi.runtime.getURL('iframe/iframe.html')}?${params.toString()}`;

      const existingTabId = persistence.activeSession?.tabId;
      const reusableTabId = Number.isFinite(existingTabId) ? existingTabId : persistence.compareTabId;
      let tab = null;

      if (Number.isFinite(reusableTabId)) {
        try {
          tab = await chromeApi.tabs.get(reusableTabId);
        } catch (_) {
          tab = null;
        }
      }

      if (tab && tab.id) {
        await updateCompareTabId(tab.id);
        await chromeApi.tabs.update(tab.id, {
          url: targetUrl,
          active: false
        });
        return tab.id;
      }

      const created = await chromeApi.tabs.create({
        url: targetUrl,
        active: false
      });
      await updateCompareTabId(created.id);
      return created.id;
    }

    async function handleSearchStart(frame) {
      if (!persistence.pairRecord || persistence.pairRecord.pairId !== frame.pairId) {
        await sendEncryptedFrame(common.FRAME_TYPES.SEARCH_ERROR, {
          pairId: frame.pairId,
          requestId: frame.requestId,
          error: common.ERROR_CODES.NOT_PAIRED
        });
        return;
      }

      if (persistence.activeSession?.requestId) {
        await sendEncryptedFrame(common.FRAME_TYPES.SEARCH_ERROR, {
          pairId: frame.pairId,
          requestId: frame.requestId,
          error: common.ERROR_CODES.BUSY
        });
        return;
      }

      const payload = await remoteCrypto.decryptJsonPayload({
        privateKeyJwk: persistence.deviceIdentity.privateKey,
        peerPublicKeyJwk: persistence.pairRecord.phonePublicKey,
        ciphertext: frame.ciphertext,
        iv: frame.iv,
        aad: {
          type: common.FRAME_TYPES.SEARCH_START,
          requestId: frame.requestId,
          pairId: frame.pairId
        }
      });

      const query = typeof payload?.query === 'string' ? payload.query.trim() : '';
      if (!query) {
        await sendEncryptedFrame(common.FRAME_TYPES.SEARCH_ERROR, {
          pairId: frame.pairId,
          requestId: frame.requestId,
          error: 'missing_query'
        });
        return;
      }

      persistence = await remoteStorage.patchPersistence(storageArea, {
        activeSession: {
          requestId: frame.requestId,
          pairId: frame.pairId,
          query,
          tabId: null,
          startedAt: common.nowIso(),
          status: 'running'
        }
      });
      await broadcastState();

      try {
        const tabId = await openRemoteSearchTab({
          query,
          pairId: frame.pairId,
          requestId: frame.requestId
        });

        persistence = await remoteStorage.patchPersistence(storageArea, {
          activeSession: {
            ...persistence.activeSession,
            tabId,
            status: 'running'
          },
          compareTabId: tabId
        });

        await broadcastState();
      } catch (error) {
        persistence = await remoteStorage.patchPersistence(storageArea, {
          activeSession: null
        });
        await sendEncryptedFrame(common.FRAME_TYPES.SEARCH_ERROR, {
          pairId: frame.pairId,
          requestId: frame.requestId,
          error: error && error.message ? error.message : String(error)
        });
      }
    }

    async function handleSessionResume(frame) {
      const snapshot = persistence.lastSnapshots[frame.requestId];
      if (!snapshot) {
        await sendEncryptedFrame(common.FRAME_TYPES.SEARCH_ERROR, {
          pairId: frame.pairId,
          requestId: frame.requestId,
          error: 'snapshot_not_found'
        });
        return;
      }

      await sendEncryptedFrame(snapshot.completed === true
        ? common.FRAME_TYPES.SEARCH_COMPLETE
        : common.FRAME_TYPES.SEARCH_PROGRESS, {
        pairId: frame.pairId,
        requestId: frame.requestId,
        result: snapshot.result,
        completed: snapshot.completed === true
      });
    }

    async function sendEncryptedFrame(type, payload = {}) {
      if (!persistence.pairRecord?.phonePublicKey) {
        throw new Error('No paired phone is available for encrypted relay delivery.');
      }

      const encrypted = await remoteCrypto.encryptJsonPayload({
        privateKeyJwk: persistence.deviceIdentity.privateKey,
        peerPublicKeyJwk: persistence.pairRecord.phonePublicKey,
        payload,
        aad: {
          type,
          pairId: payload.pairId,
          requestId: payload.requestId || ''
        }
      });

      await sendAuthenticatedFrame({
        type,
        pairId: payload.pairId,
        requestId: payload.requestId || '',
        desktopDeviceId: persistence.deviceIdentity.deviceId,
        phoneDeviceId: persistence.pairRecord.phoneDeviceId,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv
      });
    }

    async function handleSearchProgressMessage(message) {
      const requestId = typeof message.requestId === 'string' ? message.requestId.trim() : '';
      if (!requestId || !persistence.activeSession || persistence.activeSession.requestId !== requestId) {
        return;
      }

      const snapshot = common.normalizeSnapshotEnvelope({
        requestId,
        pairId: persistence.activeSession.pairId,
        type: message.completed === true ? common.FRAME_TYPES.SEARCH_COMPLETE : common.FRAME_TYPES.SEARCH_PROGRESS,
        completed: message.completed === true,
        result: remoteState.normalizeSnapshotResult(message.result),
        updatedAt: common.nowIso()
      });

      if (!snapshot) {
        return;
      }

      persistence = await remoteStorage.patchPersistence(storageArea, {
        lastSnapshots: {
          ...persistence.lastSnapshots,
          [requestId]: snapshot
        }
      });

      await sendEncryptedFrame(snapshot.completed === true
        ? common.FRAME_TYPES.SEARCH_COMPLETE
        : common.FRAME_TYPES.SEARCH_PROGRESS, {
        pairId: persistence.activeSession.pairId,
        requestId,
        result: snapshot.result,
        completed: snapshot.completed
      });

      if (snapshot.completed === true) {
        persistence = await remoteStorage.patchPersistence(storageArea, {
          activeSession: null
        });
      }

      await broadcastState();
    }

    async function handleSocketMessage(rawValue) {
      const frame = common.safeParseJson(rawValue, null);
      if (!frame || typeof frame !== 'object') {
        return;
      }

      switch (frame.type) {
        case common.FRAME_TYPES.PAIR_REQUEST: {
          const request = common.normalizePendingPairRequest({
            pairId: frame.pairId,
            ticketId: frame.ticketId,
            desktopDeviceId: frame.desktopDeviceId,
            phoneDeviceId: frame.phoneDeviceId,
            phoneName: frame.phoneName,
            phonePlatform: frame.phonePlatform,
            phoneFingerprint: frame.phoneFingerprint,
            phonePublicKey: frame.phonePublicKey,
            ciphertext: frame.ciphertext,
            iv: frame.iv,
            createdAt: frame.createdAt,
            receivedAt: common.nowIso()
          });

          persistence = await remoteStorage.patchPersistence(storageArea, {
            pendingPairRequest: request
          });

          await showPairRequestNotification(request);
          await broadcastState();
          break;
        }
        case common.FRAME_TYPES.PAIR_REVOKED: {
          persistence = await remoteStorage.patchPersistence(storageArea, {
            pairRecord: null,
            pendingPairRequest: null,
            activeSession: null,
            compareTabId: null
          });
          await setLastError('The remote pair was revoked.');
          await broadcastState();
          break;
        }
        case common.FRAME_TYPES.PRESENCE_PING: {
          await clearLastError();
          await broadcastState();
          break;
        }
        case common.FRAME_TYPES.SEARCH_START:
          await handleSearchStart(frame);
          break;
        case common.FRAME_TYPES.SESSION_RESUME:
          await handleSessionResume(frame);
          break;
        case common.FRAME_TYPES.SEARCH_ERROR:
        case common.FRAME_TYPES.INTERNAL_AUTH_ERROR:
        case common.FRAME_TYPES.INTERNAL_DELIVERY_ERROR:
          await setLastError(frame.error || 'Remote relay returned an error.');
          break;
        default:
          break;
      }
    }

    function handleNotificationClick(notificationId, buttonIndex) {
      if (notificationId !== common.NOTIFICATION_IDS.PAIR_REQUEST) {
        return false;
      }

      if (buttonIndex === 0) {
        approvePendingPair().catch((error) => {
          logger.error('Failed to approve pending pair request:', error);
        });
        return true;
      }

      if (buttonIndex === 1) {
        rejectPendingPair().catch((error) => {
          logger.error('Failed to reject pending pair request:', error);
        });
        return true;
      }

      return false;
    }

    async function openOptionsRemoteSearch() {
      const targetUrl = `${chromeApi.runtime.getURL('options/options.html')}#remote-search`;
      await chromeApi.tabs.create({ url: targetUrl });
    }

    async function handleMessage(message) {
      switch (message?.action) {
        case 'remoteGetState':
          return getUiState();
        case 'remoteUpdateSettings':
          return upsertSettings(message.settings || {});
        case 'remoteCreatePairingTicket':
          return createPairingTicket();
        case 'remoteApprovePendingPair':
          return approvePendingPair();
        case 'remoteRejectPendingPair':
          return rejectPendingPair();
        case 'remoteRevokePairing':
          await revokePairing();
          return getUiState();
        case 'remoteSearchProgress':
          await handleSearchProgressMessage(message);
          return { ok: true };
        default:
          return null;
      }
    }

    async function handleTabRemoved(tabId) {
      if (persistence.compareTabId === tabId) {
        persistence = await remoteStorage.patchPersistence(storageArea, {
          compareTabId: null
        });
      }

      if (!persistence.activeSession || persistence.activeSession.tabId !== tabId) {
        return;
      }

      const requestId = persistence.activeSession.requestId;
      const pairId = persistence.activeSession.pairId;
      persistence = await remoteStorage.patchPersistence(storageArea, {
        activeSession: null,
        compareTabId: null
      });

      await sendEncryptedFrame(common.FRAME_TYPES.SEARCH_ERROR, {
        pairId,
        requestId,
        error: 'remote_tab_closed'
      });
      await broadcastState();
    }

    async function ensureConnection() {
      if (!isInitialized) {
        await initialize();
        return;
      }

      if (persistence.settings.enabled && (!socket || socket.readyState !== WebSocketImpl.OPEN)) {
        reconnectEnabled = true;
        await connect();
      }
    }

    return {
      initialize,
      getUiState,
      handleMessage,
      handleNotificationClick,
      openOptionsRemoteSearch,
      handleTabRemoved,
      ensureConnection,
      connect,
      disconnect
    };
  }

  return {
    HEARTBEAT_INTERVAL_MS,
    RECONNECT_DELAY_MS,
    createRemoteRuntime
  };
});
