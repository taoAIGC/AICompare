(function(root, factory) {
  const common = typeof module !== 'undefined' && module.exports
    ? require('./common.js')
    : (root && root.AIRemoteCommon);
  const api = factory(common);

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (root && typeof root === 'object') {
    root.AIRemoteCrypto = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function(common) {
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();

  function getCryptoApi() {
    if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle) {
      return globalThis.crypto;
    }

    if (typeof require === 'function') {
      const nodeCrypto = require('node:crypto').webcrypto;
      if (nodeCrypto && nodeCrypto.subtle) {
        return nodeCrypto;
      }
    }

    throw new Error('Web Crypto API is not available in this environment.');
  }

  function bytesToBase64Url(bytes) {
    const uint8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(uint8)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
    }

    let binary = '';
    uint8.forEach((value) => {
      binary += String.fromCharCode(value);
    });

    return btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }

  function base64UrlToBytes(value) {
    const normalized = String(value || '')
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));

    if (typeof Buffer !== 'undefined') {
      return new Uint8Array(Buffer.from(normalized + padding, 'base64'));
    }

    const binary = atob(normalized + padding);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  function utf8ToBytes(value) {
    return textEncoder.encode(String(value || ''));
  }

  function bytesToUtf8(value) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value || []);
    return textDecoder.decode(bytes);
  }

  function bytesToHex(value) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value || []);
    return Array.from(bytes)
      .map((item) => item.toString(16).padStart(2, '0'))
      .join('');
  }

  function randomBytes(length) {
    const cryptoApi = getCryptoApi();
    const bytes = new Uint8Array(Math.max(1, Number(length) || 16));
    cryptoApi.getRandomValues(bytes);
    return bytes;
  }

  function randomToken(length) {
    return bytesToBase64Url(randomBytes(length));
  }

  async function sha256Bytes(value) {
    const cryptoApi = getCryptoApi();
    const input = value instanceof Uint8Array ? value : utf8ToBytes(value);
    const digest = await cryptoApi.subtle.digest('SHA-256', input);
    return new Uint8Array(digest);
  }

  async function sha256Base64Url(value) {
    return bytesToBase64Url(await sha256Bytes(value));
  }

  async function createDeviceSecret() {
    return randomToken(32);
  }

  async function createDeviceAuthKey(secret) {
    return sha256Base64Url(secret);
  }

  async function createHmacSignature(keyBase64Url, message) {
    const cryptoApi = getCryptoApi();
    const keyBytes = base64UrlToBytes(keyBase64Url);
    const cryptoKey = await cryptoApi.subtle.importKey(
      'raw',
      keyBytes,
      {
        name: 'HMAC',
        hash: 'SHA-256'
      },
      false,
      ['sign']
    );
    const signature = await cryptoApi.subtle.sign('HMAC', cryptoKey, utf8ToBytes(message));
    return bytesToBase64Url(new Uint8Array(signature));
  }

  async function computeDeviceProof(options = {}) {
    const challengeInput = common.buildAuthChallengeInput(options);
    const authKey = String(options.authKey || '').trim();
    if (!authKey) {
      throw new Error('Missing authKey for device proof.');
    }
    return createHmacSignature(authKey, challengeInput);
  }

  async function verifyDeviceProof(options = {}) {
    const expected = await computeDeviceProof(options);
    return expected === String(options.proof || '').trim();
  }

  async function generateLongTermKeyPair() {
    const cryptoApi = getCryptoApi();
    const keyPair = await cryptoApi.subtle.generateKey(
      {
        name: 'ECDH',
        namedCurve: 'P-256'
      },
      true,
      ['deriveBits']
    );

    const publicKey = await cryptoApi.subtle.exportKey('jwk', keyPair.publicKey);
    const privateKey = await cryptoApi.subtle.exportKey('jwk', keyPair.privateKey);

    return {
      publicKey,
      privateKey
    };
  }

  async function importPrivateKey(privateKeyJwk) {
    const cryptoApi = getCryptoApi();
    return cryptoApi.subtle.importKey(
      'jwk',
      privateKeyJwk,
      {
        name: 'ECDH',
        namedCurve: 'P-256'
      },
      false,
      ['deriveBits']
    );
  }

  async function importPublicKey(publicKeyJwk) {
    const cryptoApi = getCryptoApi();
    return cryptoApi.subtle.importKey(
      'jwk',
      publicKeyJwk,
      {
        name: 'ECDH',
        namedCurve: 'P-256'
      },
      false,
      []
    );
  }

  async function deriveSharedSecretBytes(privateKeyJwk, peerPublicKeyJwk) {
    const cryptoApi = getCryptoApi();
    const privateKey = await importPrivateKey(privateKeyJwk);
    const publicKey = await importPublicKey(peerPublicKeyJwk);
    const sharedBits = await cryptoApi.subtle.deriveBits(
      {
        name: 'ECDH',
        public: publicKey
      },
      privateKey,
      256
    );
    return new Uint8Array(sharedBits);
  }

  async function importAesKey(privateKeyJwk, peerPublicKeyJwk) {
    const cryptoApi = getCryptoApi();
    const keyBytes = await deriveSharedSecretBytes(privateKeyJwk, peerPublicKeyJwk);
    return cryptoApi.subtle.importKey(
      'raw',
      keyBytes,
      {
        name: 'AES-GCM'
      },
      false,
      ['encrypt', 'decrypt']
    );
  }

  function buildAadBytes(aad) {
    if (!aad || (typeof aad === 'object' && Object.keys(aad).length === 0)) {
      return undefined;
    }
    return utf8ToBytes(common.stableStringify(aad));
  }

  async function encryptJsonPayload(options = {}) {
    const cryptoApi = getCryptoApi();
    const aesKey = await importAesKey(options.privateKeyJwk, options.peerPublicKeyJwk);
    const iv = randomBytes(12);
    const ciphertext = await cryptoApi.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv,
        additionalData: buildAadBytes(options.aad),
        tagLength: 128
      },
      aesKey,
      utf8ToBytes(common.stableStringify(options.payload || {}))
    );

    return {
      iv: bytesToBase64Url(iv),
      ciphertext: bytesToBase64Url(new Uint8Array(ciphertext))
    };
  }

  async function decryptJsonPayload(options = {}) {
    const cryptoApi = getCryptoApi();
    const aesKey = await importAesKey(options.privateKeyJwk, options.peerPublicKeyJwk);
    const plaintext = await cryptoApi.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: base64UrlToBytes(options.iv),
        additionalData: buildAadBytes(options.aad),
        tagLength: 128
      },
      aesKey,
      base64UrlToBytes(options.ciphertext)
    );

    return JSON.parse(bytesToUtf8(new Uint8Array(plaintext)));
  }

  async function fingerprintPublicKey(publicKeyJwk) {
    const digest = await sha256Bytes(common.stableStringify(publicKeyJwk || {}));
    const hex = bytesToHex(digest).toUpperCase().slice(0, 24);
    return `${hex.slice(0, 6)}-${hex.slice(6, 12)}-${hex.slice(12, 18)}-${hex.slice(18, 24)}`;
  }

  return {
    getCryptoApi,
    bytesToBase64Url,
    base64UrlToBytes,
    utf8ToBytes,
    bytesToUtf8,
    bytesToHex,
    randomBytes,
    randomToken,
    sha256Bytes,
    sha256Base64Url,
    createDeviceSecret,
    createDeviceAuthKey,
    computeDeviceProof,
    verifyDeviceProof,
    generateLongTermKeyPair,
    deriveSharedSecretBytes,
    encryptJsonPayload,
    decryptJsonPayload,
    fingerprintPublicKey
  };
});
