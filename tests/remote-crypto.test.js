const test = require('node:test');
const assert = require('node:assert/strict');

const remoteCommon = require('../remote/common.js');
const remoteCrypto = require('../remote/crypto.js');

test('computeDeviceProof verifies challenge-response signatures', async () => {
  const deviceSecret = await remoteCrypto.createDeviceSecret();
  const authKey = await remoteCrypto.createDeviceAuthKey(deviceSecret);
  const proof = await remoteCrypto.computeDeviceProof({
    authKey,
    deviceId: 'desktop-1',
    route: remoteCommon.FRAME_TYPES.PRESENCE_HELLO,
    challenge: 'challenge-1',
    timestamp: '2026-05-08T00:00:00.000Z'
  });

  const verified = await remoteCrypto.verifyDeviceProof({
    authKey,
    deviceId: 'desktop-1',
    route: remoteCommon.FRAME_TYPES.PRESENCE_HELLO,
    challenge: 'challenge-1',
    timestamp: '2026-05-08T00:00:00.000Z',
    proof
  });

  assert.equal(verified, true);
});

test('encryptJsonPayload performs an end-to-end encrypted round trip', async () => {
  const desktopKeys = await remoteCrypto.generateLongTermKeyPair();
  const phoneKeys = await remoteCrypto.generateLongTermKeyPair();
  const payload = {
    query: 'hello world',
    requestId: 'req-1'
  };

  const encrypted = await remoteCrypto.encryptJsonPayload({
    privateKeyJwk: desktopKeys.privateKey,
    peerPublicKeyJwk: phoneKeys.publicKey,
    payload,
    aad: {
      type: remoteCommon.FRAME_TYPES.SEARCH_START,
      pairId: 'pair-1',
      requestId: 'req-1'
    }
  });

  const decrypted = await remoteCrypto.decryptJsonPayload({
    privateKeyJwk: phoneKeys.privateKey,
    peerPublicKeyJwk: desktopKeys.publicKey,
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    aad: {
      type: remoteCommon.FRAME_TYPES.SEARCH_START,
      pairId: 'pair-1',
      requestId: 'req-1'
    }
  });

  assert.deepEqual(decrypted, payload);
});
