const test = require('node:test');
const assert = require('node:assert/strict');

const remoteCommon = require('../remote/common.js');
const remoteCrypto = require('../remote/crypto.js');
const remoteStorage = require('../remote/storage.js');
const { createRemoteRuntime } = require('../remote/sw-runtime.js');

function createMemoryStorageArea(initial = {}) {
  const store = { ...initial };

  return {
    async get(keys) {
      if (Array.isArray(keys)) {
        return keys.reduce((acc, key) => {
          acc[key] = store[key];
          return acc;
        }, {});
      }

      if (typeof keys === 'string') {
        return { [keys]: store[keys] };
      }

      return { ...store };
    },
    async set(values) {
      Object.assign(store, values);
    },
    dump() {
      return { ...store };
    }
  };
}

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.sent = [];
    this.listeners = new Map();
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type).add(listener);
  }

  emit(type, payload) {
    const handlers = this.listeners.get(type);
    if (!handlers) {
      return;
    }
    for (const handler of handlers) {
      handler(payload);
    }
  }

  emitOpen() {
    this.readyState = FakeWebSocket.OPEN;
    this.emit('open');
  }

  emitMessage(frame) {
    this.emit('message', {
      data: JSON.stringify(frame)
    });
  }

  send(value) {
    this.sent.push(JSON.parse(value));
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit('close');
  }
}

function createChromeApiMock() {
  const tabs = new Map();
  const runtimeMessages = [];
  const createdTabs = [];
  let nextTabId = 1;

  return {
    runtimeMessages,
    createdTabs,
    chromeApi: {
      runtime: {
        async sendMessage(payload) {
          runtimeMessages.push(payload);
          return {};
        },
        getURL(pathname) {
          return `chrome-extension://test-extension/${pathname}`;
        },
        i18n: {
          getMessage() {
            return '';
          }
        }
      },
      tabs: {
        async get(tabId) {
          if (!tabs.has(tabId)) {
            throw new Error(`Tab ${tabId} not found`);
          }
          return tabs.get(tabId);
        },
        async update(tabId, patch) {
          const nextTab = {
            ...(tabs.get(tabId) || { id: tabId }),
            ...patch,
            id: tabId
          };
          tabs.set(tabId, nextTab);
          return nextTab;
        },
        async create({ url, active }) {
          const tab = {
            id: nextTabId++,
            url,
            active
          };
          tabs.set(tab.id, tab);
          createdTabs.push(tab);
          return tab;
        }
      },
      notifications: {
        async create() {},
        async clear() {
          return true;
        }
      }
    }
  };
}

async function flushAsyncWork() {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

async function createDeviceIdentity(deviceId, deviceName) {
  const deviceSecret = await remoteCrypto.createDeviceSecret();
  const deviceAuthKey = await remoteCrypto.createDeviceAuthKey(deviceSecret);
  const keyPair = await remoteCrypto.generateLongTermKeyPair();
  const fingerprint = await remoteCrypto.fingerprintPublicKey(keyPair.publicKey);
  return {
    deviceId,
    deviceSecret,
    deviceAuthKey,
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
    fingerprint,
    deviceName,
    createdAt: remoteCommon.nowIso()
  };
}

async function createRuntimeHarness(initialPatch = {}, options = {}) {
  FakeWebSocket.instances.length = 0;
  const desktopIdentity = await createDeviceIdentity('desktop-1', 'Desk');
  const phoneIdentity = await createDeviceIdentity('phone-1', 'Phone');
  const storageArea = createMemoryStorageArea();
  const { chromeApi, createdTabs } = createChromeApiMock();
  const fetchImpl = options.fetchImpl || (async () => ({
    ok: true,
    status: 200,
    async json() {
      return {};
    }
  }));

  await remoteStorage.writePersistence(storageArea, {
    settings: {
      enabled: true,
      relayBaseUrl: 'http://127.0.0.1:8787',
      desktopName: 'Desk'
    },
    deviceIdentity: desktopIdentity,
    pairRecord: {
      pairId: 'pair-1',
      desktopDeviceId: desktopIdentity.deviceId,
      phoneDeviceId: phoneIdentity.deviceId,
      phoneName: 'Phone',
      phonePlatform: 'ios',
      phoneFingerprint: phoneIdentity.fingerprint,
      phonePublicKey: phoneIdentity.publicKey,
      status: 'active',
      createdAt: remoteCommon.nowIso(),
      approvedAt: remoteCommon.nowIso()
    },
    ...initialPatch
  });

  const previousSelf = global.self;
  global.self = {
    getDefaultSites: async () => [
      { name: 'Qwen', enabled: true, hidden: false, supportIframe: true }
    ]
  };

  const runtime = createRemoteRuntime({
    chromeApi,
    storageArea,
    fetchImpl,
    WebSocketImpl: FakeWebSocket,
    logger: {
      warn() {},
      error() {},
      info() {},
      log() {}
    }
  });

  await runtime.initialize();
  const socket = FakeWebSocket.instances[0];
  if (socket) {
    socket.emitOpen();
  }

  return {
    runtime,
    socket,
    storageArea,
    desktopIdentity,
    phoneIdentity,
    createdTabs,
    restore() {
      if (previousSelf === undefined) {
        delete global.self;
      } else {
        global.self = previousSelf;
      }
      FakeWebSocket.instances.length = 0;
    }
  };
}

function getLastSentFrame(socket, type) {
  const frames = socket.sent.filter((frame) => frame.type === type);
  return frames[frames.length - 1] || null;
}

test('remote runtime rejects a second search when one request is already active', async () => {
  const harness = await createRuntimeHarness();

  try {
    const firstRequestPayload = await remoteCrypto.encryptJsonPayload({
      privateKeyJwk: harness.phoneIdentity.privateKey,
      peerPublicKeyJwk: harness.desktopIdentity.publicKey,
      payload: { query: 'first query' },
      aad: {
        type: remoteCommon.FRAME_TYPES.SEARCH_START,
        pairId: 'pair-1',
        requestId: 'req-1'
      }
    });

    harness.socket.emitMessage({
      type: remoteCommon.FRAME_TYPES.SEARCH_START,
      pairId: 'pair-1',
      requestId: 'req-1',
      ciphertext: firstRequestPayload.ciphertext,
      iv: firstRequestPayload.iv
    });
    await flushAsyncWork();

    const stateAfterFirstRequest = harness.runtime.getUiState();
    assert.equal(stateAfterFirstRequest.activeSession?.requestId, 'req-1');
    assert.equal(harness.createdTabs.length, 1);

    const secondRequestPayload = await remoteCrypto.encryptJsonPayload({
      privateKeyJwk: harness.phoneIdentity.privateKey,
      peerPublicKeyJwk: harness.desktopIdentity.publicKey,
      payload: { query: 'second query' },
      aad: {
        type: remoteCommon.FRAME_TYPES.SEARCH_START,
        pairId: 'pair-1',
        requestId: 'req-2'
      }
    });

    harness.socket.emitMessage({
      type: remoteCommon.FRAME_TYPES.SEARCH_START,
      pairId: 'pair-1',
      requestId: 'req-2',
      ciphertext: secondRequestPayload.ciphertext,
      iv: secondRequestPayload.iv
    });
    await flushAsyncWork();

    const busyFrame = getLastSentFrame(harness.socket, remoteCommon.FRAME_TYPES.SEARCH_ERROR);
    assert.ok(busyFrame, 'expected a search.error frame to be sent');

    const busyPayload = await remoteCrypto.decryptJsonPayload({
      privateKeyJwk: harness.phoneIdentity.privateKey,
      peerPublicKeyJwk: harness.desktopIdentity.publicKey,
      ciphertext: busyFrame.ciphertext,
      iv: busyFrame.iv,
      aad: {
        type: remoteCommon.FRAME_TYPES.SEARCH_ERROR,
        pairId: 'pair-1',
        requestId: 'req-2'
      }
    });

    assert.equal(busyPayload.error, remoteCommon.ERROR_CODES.BUSY);
  } finally {
    await harness.runtime.disconnect();
    harness.restore();
  }
});

test('remote runtime stays offline when the relay health check fails', async () => {
  let healthProbeCount = 0;
  const harness = await createRuntimeHarness({}, {
    fetchImpl: async (url) => {
      healthProbeCount += 1;
      if (String(url).includes('/healthz')) {
        return {
          ok: false,
          status: 503,
          async json() {
            return {};
          }
        };
      }

      return {
        ok: true,
        status: 200,
        async json() {
          return {};
        }
      };
    }
  });

  try {
    const state = harness.runtime.getUiState();
    assert.equal(healthProbeCount, 1);
    assert.equal(FakeWebSocket.instances.length, 0);
    assert.equal(state.connectionStatus, remoteCommon.CONNECTION_STATUSES.OFFLINE);
    assert.equal(state.lastError, 'Remote relay is offline.');
  } finally {
    await harness.runtime.disconnect();
    harness.restore();
  }
});

test('remote runtime resumes the latest stored snapshot for reconnecting phones', async () => {
  const harness = await createRuntimeHarness({
    lastSnapshots: {
      'req-9': {
        requestId: 'req-9',
        pairId: 'pair-1',
        type: remoteCommon.FRAME_TYPES.SEARCH_COMPLETE,
        completed: true,
        result: {
          results: [{ siteName: 'Qwen', status: 'ok', content: 'done' }]
        },
        updatedAt: remoteCommon.nowIso()
      }
    }
  });

  try {
    const resumeSocket = harness.socket;
    resumeSocket.emitMessage({
      type: remoteCommon.FRAME_TYPES.SESSION_RESUME,
      pairId: 'pair-1',
      requestId: 'req-9'
    });
    await flushAsyncWork();

    const completeFrame = getLastSentFrame(resumeSocket, remoteCommon.FRAME_TYPES.SEARCH_COMPLETE);
    assert.ok(completeFrame, 'expected a search.complete frame to be sent');

    const resumePayload = await remoteCrypto.decryptJsonPayload({
      privateKeyJwk: harness.phoneIdentity.privateKey,
      peerPublicKeyJwk: harness.desktopIdentity.publicKey,
      ciphertext: completeFrame.ciphertext,
      iv: completeFrame.iv,
      aad: {
        type: remoteCommon.FRAME_TYPES.SEARCH_COMPLETE,
        pairId: 'pair-1',
        requestId: 'req-9'
      }
    });

    assert.equal(resumePayload.completed, true);
    assert.equal(resumePayload.result.results[0].status, 'ok');
    assert.equal(resumePayload.result.results[0].content, 'done');
  } finally {
    await harness.runtime.disconnect();
    harness.restore();
  }
});
