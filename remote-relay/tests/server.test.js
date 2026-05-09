const test = require('node:test');
const assert = require('node:assert/strict');

const WebSocket = require('ws');

const remoteCommon = require('../../remote/common.js');
const remoteCrypto = require('../../remote/crypto.js');
const { createRelayServer } = require('../src/server.js');

function createLogger() {
  return {
    info() {},
    warn() {},
    error() {},
    log() {}
  };
}

async function createDevice(prefix, platform) {
  const deviceSecret = await remoteCrypto.createDeviceSecret();
  const deviceAuthKey = await remoteCrypto.createDeviceAuthKey(deviceSecret);
  const keyPair = await remoteCrypto.generateLongTermKeyPair();
  const fingerprint = await remoteCrypto.fingerprintPublicKey(keyPair.publicKey);
  return {
    deviceId: `${prefix}-${Math.random().toString(36).slice(2, 8)}`,
    deviceSecret,
    deviceAuthKey,
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
    fingerprint,
    deviceName: `${prefix} device`,
    platform
  };
}

async function buildAuthedFrame(device, type, extra = {}) {
  const challenge = remoteCommon.createId('challenge');
  const timestamp = remoteCommon.nowIso();
  const proof = await remoteCrypto.computeDeviceProof({
    authKey: device.deviceAuthKey,
    deviceId: device.deviceId,
    route: type,
    challenge,
    timestamp
  });

  return {
    v: remoteCommon.REMOTE_PROTOCOL_VERSION,
    type,
    deviceId: device.deviceId,
    challenge,
    timestamp,
    proof,
    ...extra
  };
}

function waitForJsonMessage(ws, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for websocket message'));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      ws.off('message', onMessage);
      ws.off('error', onError);
    };

    const onError = (error) => {
      cleanup();
      reject(error);
    };

    const onMessage = (value) => {
      cleanup();
      resolve(JSON.parse(String(value)));
    };

    ws.on('message', onMessage);
    ws.on('error', onError);
  });
}

async function connectPresence(server, device, role, pairId = '') {
  const wsUrl = `${server.getAddress().replace(/^http:/, 'ws:')}/ws`;
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });

  const helloFrame = await buildAuthedFrame(device, remoteCommon.FRAME_TYPES.PRESENCE_HELLO, {
    role,
    pairId,
    fingerprint: device.fingerprint,
    deviceName: device.deviceName
  });
  ws.send(JSON.stringify(helloFrame));
  await waitForJsonMessage(ws);
  return ws;
}

async function withRelayServer(fn) {
  const relayServer = createRelayServer({
    logger: createLogger(),
    useFirestore: false
  });
  await relayServer.start(0, '127.0.0.1');
  try {
    return await fn(relayServer);
  } finally {
    await relayServer.stop();
  }
}

test('pairing ticket lifecycle supports create and claim', async () => {
  await withRelayServer(async (relayServer) => {
    const desktop = await createDevice('desktop', 'chrome-extension');
    const phone = await createDevice('phone', 'ios');

    const createResponse = await fetch(`${relayServer.getAddress()}/pairing-tickets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        deviceId: desktop.deviceId,
        deviceName: desktop.deviceName,
        platform: desktop.platform,
        deviceSecretHash: desktop.deviceAuthKey,
        publicKey: desktop.publicKey,
        fingerprint: desktop.fingerprint
      })
    });

    assert.equal(createResponse.status, 201);
    const createPayload = await createResponse.json();
    assert.equal(createPayload.ok, true);

    const claimResponse = await fetch(`${relayServer.getAddress()}/pairing-tickets/${encodeURIComponent(createPayload.ticketId)}/claim`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        deviceId: phone.deviceId,
        deviceName: phone.deviceName,
        platform: phone.platform,
        deviceSecretHash: phone.deviceAuthKey,
        publicKey: phone.publicKey,
        fingerprint: phone.fingerprint
      })
    });

    assert.equal(claimResponse.status, 200);
    const storedTicket = await relayServer.store.getPairingTicket(createPayload.ticketId);
    assert.equal(storedTicket.claimedByDeviceId, phone.deviceId);
  });
});

test('websocket device auth rejects frames with invalid proof', async () => {
  await withRelayServer(async (relayServer) => {
    const desktop = await createDevice('desktop', 'chrome-extension');
    await relayServer.store.upsertDevice({
      deviceId: desktop.deviceId,
      deviceName: desktop.deviceName,
      platform: desktop.platform,
      deviceSecretHash: desktop.deviceAuthKey,
      publicKey: desktop.publicKey,
      fingerprint: desktop.fingerprint
    });

    const ws = new WebSocket(`${relayServer.getAddress().replace(/^http:/, 'ws:')}/ws`);
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });

    const invalidFrame = await buildAuthedFrame(desktop, remoteCommon.FRAME_TYPES.PRESENCE_HELLO, {
      role: 'desktop',
      pairId: '',
      fingerprint: desktop.fingerprint,
      deviceName: desktop.deviceName
    });
    invalidFrame.proof = 'invalid-proof';
    ws.send(JSON.stringify(invalidFrame));

    const message = await waitForJsonMessage(ws);
    assert.equal(message.type, remoteCommon.FRAME_TYPES.INTERNAL_AUTH_ERROR);
    assert.equal(message.error, 'invalid_proof');

    ws.close();
  });
});

test('pair revoke endpoint marks the pair as revoked', async () => {
  await withRelayServer(async (relayServer) => {
    const desktop = await createDevice('desktop', 'chrome-extension');
    const phone = await createDevice('phone', 'ios');

    await relayServer.store.createPairRecord({
      pairId: 'pair-revoke-1',
      status: 'active',
      desktopDeviceId: desktop.deviceId,
      phoneDeviceId: phone.deviceId,
      createdAt: remoteCommon.nowIso()
    });

    const response = await fetch(`${relayServer.getAddress()}/pairings/pair-revoke-1/revoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        deviceId: desktop.deviceId
      })
    });

    assert.equal(response.status, 200);
    const pairRecord = await relayServer.store.getPairRecord('pair-revoke-1');
    assert.equal(pairRecord.status, 'revoked');
    assert.equal(pairRecord.revokedByDeviceId, desktop.deviceId);
  });
});

test('relay routes encrypted search frames end-to-end without reading payloads', async () => {
  await withRelayServer(async (relayServer) => {
    const desktop = await createDevice('desktop', 'chrome-extension');
    const phone = await createDevice('phone', 'ios');

    await relayServer.store.upsertDevice({
      deviceId: desktop.deviceId,
      deviceName: desktop.deviceName,
      platform: desktop.platform,
      deviceSecretHash: desktop.deviceAuthKey,
      publicKey: desktop.publicKey,
      fingerprint: desktop.fingerprint
    });
    await relayServer.store.upsertDevice({
      deviceId: phone.deviceId,
      deviceName: phone.deviceName,
      platform: phone.platform,
      deviceSecretHash: phone.deviceAuthKey,
      publicKey: phone.publicKey,
      fingerprint: phone.fingerprint
    });
    await relayServer.store.createPairRecord({
      pairId: 'pair-route-1',
      status: 'active',
      desktopDeviceId: desktop.deviceId,
      phoneDeviceId: phone.deviceId,
      createdAt: remoteCommon.nowIso()
    });

    const desktopWs = await connectPresence(relayServer, desktop, 'desktop', 'pair-route-1');
    const phoneWs = await connectPresence(relayServer, phone, 'phone', 'pair-route-1');

    const encryptedPayload = await remoteCrypto.encryptJsonPayload({
      privateKeyJwk: phone.privateKey,
      peerPublicKeyJwk: desktop.publicKey,
      payload: {
        query: 'hello world'
      },
      aad: {
        type: remoteCommon.FRAME_TYPES.SEARCH_START,
        pairId: 'pair-route-1',
        requestId: 'req-route-1'
      }
    });

    const searchFrame = await buildAuthedFrame(phone, remoteCommon.FRAME_TYPES.SEARCH_START, {
      pairId: 'pair-route-1',
      requestId: 'req-route-1',
      desktopDeviceId: desktop.deviceId,
      phoneDeviceId: phone.deviceId,
      ciphertext: encryptedPayload.ciphertext,
      iv: encryptedPayload.iv
    });
    phoneWs.send(JSON.stringify(searchFrame));

    const forwardedFrame = await waitForJsonMessage(desktopWs);
    assert.equal(forwardedFrame.type, remoteCommon.FRAME_TYPES.SEARCH_START);
    assert.equal(forwardedFrame.requestId, 'req-route-1');

    const decrypted = await remoteCrypto.decryptJsonPayload({
      privateKeyJwk: desktop.privateKey,
      peerPublicKeyJwk: phone.publicKey,
      ciphertext: forwardedFrame.ciphertext,
      iv: forwardedFrame.iv,
      aad: {
        type: remoteCommon.FRAME_TYPES.SEARCH_START,
        pairId: 'pair-route-1',
        requestId: 'req-route-1'
      }
    });

    assert.deepEqual(decrypted, { query: 'hello world' });

    desktopWs.close();
    phoneWs.close();
  });
});
