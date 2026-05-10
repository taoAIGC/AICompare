#!/usr/bin/env node

const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const WebSocket = require('../remote-relay/node_modules/ws');

const remoteCommon = require('../remote/common.js');
const remoteCrypto = require('../remote/crypto.js');
const { createRelayServer } = require('../remote-relay/src/server.js');

const REPO_ROOT = path.join(__dirname, '..');
const EXTENSION_ID = process.env.EXTENSION_ID || 'hhkhgpadepocnmjfpohcmjdcgkmfnadi';
const VERIFY_QUERY = process.env.REMOTE_VERIFY_QUERY || '你好世界';
const USER_DATA_DIR = process.env.PLAYWRIGHT_PROFILE_DIR
  || path.join(os.tmpdir(), 'aishortcuts-remote-search-playwright');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createFrameTracker(ws) {
  const frames = [];
  const listeners = new Set();

  ws.on('message', (data) => {
    const frame = JSON.parse(String(data));
    frames.push(frame);
    for (const listener of [...listeners]) {
      try {
        listener(frame);
      } catch (_) {
        // Ignore listener failures in the verifier.
      }
    }
  });

  return {
    frames,
    async waitFor(predicate, timeoutMs = 30000) {
      const existing = frames.find(predicate);
      if (existing) {
        return existing;
      }

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          listeners.delete(onFrame);
          reject(new Error('Timed out waiting for websocket frame'));
        }, timeoutMs);

        const onFrame = (frame) => {
          if (!predicate(frame)) {
            return;
          }
          clearTimeout(timer);
          listeners.delete(onFrame);
          resolve(frame);
        };

        listeners.add(onFrame);
      });
    },
    async waitForType(type, timeoutMs = 30000) {
      return this.waitFor((frame) => frame.type === type, timeoutMs);
    }
  };
}

async function sendRuntime(page, action, payload = {}) {
  const response = await page.evaluate(async ({ action, payload }) => {
    return await chrome.runtime.sendMessage({ action, ...payload });
  }, { action, payload });

  if (!response?.success) {
    throw new Error(response?.error || `Remote action failed: ${action}`);
  }

  return response.result;
}

async function createDevice(prefix, deviceName, platform) {
  const deviceSecret = await remoteCrypto.createDeviceSecret();
  const deviceAuthKey = await remoteCrypto.createDeviceAuthKey(deviceSecret);
  const keyPair = await remoteCrypto.generateLongTermKeyPair();
  const fingerprint = await remoteCrypto.fingerprintPublicKey(keyPair.publicKey);

  return {
    deviceId: `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    deviceSecret,
    deviceAuthKey,
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
    fingerprint,
    deviceName,
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

async function main() {
  const relayServer = createRelayServer({
    logger: console,
    useFirestore: false
  });
  await relayServer.start(0, '127.0.0.1');

  const relayBaseUrl = relayServer.getAddress();
  const extensionUrl = `chrome-extension://${EXTENSION_ID}`;
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    args: [
      `--disable-extensions-except=${REPO_ROOT}`,
      `--load-extension=${REPO_ROOT}`
    ]
  });

  let phoneWs = null;
  let homepage = null;
  let optionsPage = null;

  try {
    homepage = await context.newPage();
    await homepage.goto(`${extensionUrl}/homepage/homepage.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    await homepage.waitForTimeout(1500);

    await sendRuntime(homepage, 'remoteUpdateSettings', {
      settings: {
        enabled: true,
        relayBaseUrl,
        desktopName: 'Verifier Desktop'
      }
    });

    await sendRuntime(homepage, 'remoteCreatePairingTicket');
    const stateAfterTicket = await sendRuntime(homepage, 'remoteGetState');
    if (!stateAfterTicket?.pairingTicket?.qrPayload) {
      throw new Error('Pairing ticket did not include a QR payload.');
    }

    optionsPage = await context.newPage();
    await optionsPage.goto(`${extensionUrl}/options/options.html#remote-search`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    await optionsPage.waitForTimeout(2000);
    const qrInfo = await optionsPage.evaluate(() => {
      const img = document.getElementById('remoteSearchQrImage');
      const placeholder = document.getElementById('remoteSearchQrPlaceholder');
      return {
        imgHidden: img?.hidden ?? null,
        imgSrc: img?.src || '',
        placeholderHidden: placeholder?.hidden ?? null,
        placeholderText: placeholder?.textContent || ''
      };
    });

    if (!qrInfo.imgSrc.startsWith('data:image/svg+xml')) {
      throw new Error(`QR image failed to load: ${qrInfo.placeholderText || 'missing image source'}`);
    }

    const phone = await createDevice('phone', 'Verifier Phone', 'ios');
    const claimResponse = await fetch(`${relayBaseUrl}/pairing-tickets/${encodeURIComponent(stateAfterTicket.pairingTicket.ticketId)}/claim`, {
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

    if (!claimResponse.ok) {
      throw new Error(`Failed to claim pairing ticket: HTTP ${claimResponse.status}`);
    }

    phoneWs = new WebSocket(`${relayBaseUrl.replace(/^http:/, 'ws:')}/ws`);
    await new Promise((resolve, reject) => {
      phoneWs.once('open', resolve);
      phoneWs.once('error', reject);
    });

    let tracker = createFrameTracker(phoneWs);
    const helloFrame = await buildAuthedFrame(phone, remoteCommon.FRAME_TYPES.PRESENCE_HELLO, {
      role: 'phone',
      pairId: '',
      fingerprint: phone.fingerprint,
      deviceName: phone.deviceName
    });
    phoneWs.send(JSON.stringify(helloFrame));
    await tracker.waitForType(remoteCommon.FRAME_TYPES.PRESENCE_PING, 10000);

    const pairRequestCipher = await remoteCrypto.encryptJsonPayload({
      privateKeyJwk: phone.privateKey,
      peerPublicKeyJwk: stateAfterTicket.pairingTicket.qrPayload.desktopPublicKey,
      payload: {
        phoneName: phone.deviceName,
        phonePlatform: phone.platform
      },
      aad: {
        type: remoteCommon.FRAME_TYPES.PAIR_REQUEST,
        pairId: '',
        ticketId: stateAfterTicket.pairingTicket.ticketId
      }
    });

    const pairRequestFrame = await buildAuthedFrame(phone, remoteCommon.FRAME_TYPES.PAIR_REQUEST, {
      ticketId: stateAfterTicket.pairingTicket.ticketId,
      desktopDeviceId: stateAfterTicket.pairingTicket.qrPayload.desktopDeviceId,
      phoneDeviceId: phone.deviceId,
      phoneName: phone.deviceName,
      phonePlatform: phone.platform,
      phoneFingerprint: phone.fingerprint,
      phonePublicKey: phone.publicKey,
      ciphertext: pairRequestCipher.ciphertext,
      iv: pairRequestCipher.iv,
      createdAt: remoteCommon.nowIso()
    });
    phoneWs.send(JSON.stringify(pairRequestFrame));

    const pendingState = await sendRuntime(homepage, 'remoteGetState');
    if (!pendingState?.pendingPairRequest?.phoneDeviceId) {
      await sleep(1000);
    }
    await sendRuntime(homepage, 'remoteApprovePendingPair');

    const approvalFrame = await tracker.waitForType(remoteCommon.FRAME_TYPES.PAIR_APPROVE, 20000);
    const approvalPayload = await remoteCrypto.decryptJsonPayload({
      privateKeyJwk: phone.privateKey,
      peerPublicKeyJwk: stateAfterTicket.pairingTicket.qrPayload.desktopPublicKey,
      ciphertext: approvalFrame.ciphertext,
      iv: approvalFrame.iv,
      aad: {
        type: remoteCommon.FRAME_TYPES.PAIR_APPROVE,
        pairId: approvalFrame.pairId
      }
    });

    const requestId = remoteCommon.createId('verify-request');
    const searchCipher = await remoteCrypto.encryptJsonPayload({
      privateKeyJwk: phone.privateKey,
      peerPublicKeyJwk: stateAfterTicket.pairingTicket.qrPayload.desktopPublicKey,
      payload: {
        query: VERIFY_QUERY
      },
      aad: {
        type: remoteCommon.FRAME_TYPES.SEARCH_START,
        pairId: approvalPayload.pairId,
        requestId
      }
    });

    const searchFrame = await buildAuthedFrame(phone, remoteCommon.FRAME_TYPES.SEARCH_START, {
      pairId: approvalPayload.pairId,
      requestId,
      desktopDeviceId: stateAfterTicket.pairingTicket.qrPayload.desktopDeviceId,
      phoneDeviceId: phone.deviceId,
      ciphertext: searchCipher.ciphertext,
      iv: searchCipher.iv
    });
    phoneWs.send(JSON.stringify(searchFrame));

    const comparePage = await context.waitForEvent('page', {
      predicate: (page) => page.url().includes('/iframe/iframe.html') && page.url().includes(`remote_request_id=${encodeURIComponent(requestId)}`),
      timeout: 30000
    });

    const firstProgressFrame = await tracker.waitForType(remoteCommon.FRAME_TYPES.SEARCH_PROGRESS, 120000);
    const firstProgressPayload = await remoteCrypto.decryptJsonPayload({
      privateKeyJwk: phone.privateKey,
      peerPublicKeyJwk: stateAfterTicket.pairingTicket.qrPayload.desktopPublicKey,
      ciphertext: firstProgressFrame.ciphertext,
      iv: firstProgressFrame.iv,
      aad: {
        type: remoteCommon.FRAME_TYPES.SEARCH_PROGRESS,
        pairId: approvalPayload.pairId,
        requestId
      }
    });

    const phoneFramesBeforeReconnect = tracker.frames.map((frame) => frame.type);
    const progressState = await sendRuntime(homepage, 'remoteGetState');
    if (!progressState?.lastSnapshot?.requestId) {
      throw new Error('Progress snapshot was not stored on the desktop state.');
    }

    await phoneWs.close();
    await sleep(1000);

    phoneWs = new WebSocket(`${relayBaseUrl.replace(/^http:/, 'ws:')}/ws`);
    await new Promise((resolve, reject) => {
      phoneWs.once('open', resolve);
      phoneWs.once('error', reject);
    });
    tracker = createFrameTracker(phoneWs);

    const reconnectHelloFrame = await buildAuthedFrame(phone, remoteCommon.FRAME_TYPES.PRESENCE_HELLO, {
      role: 'phone',
      pairId: approvalPayload.pairId,
      fingerprint: phone.fingerprint,
      deviceName: phone.deviceName
    });
    phoneWs.send(JSON.stringify(reconnectHelloFrame));
    await tracker.waitForType(remoteCommon.FRAME_TYPES.PRESENCE_PING, 10000);

    const resumeFrame = await buildAuthedFrame(phone, remoteCommon.FRAME_TYPES.SESSION_RESUME, {
      pairId: approvalPayload.pairId,
      requestId,
      desktopDeviceId: stateAfterTicket.pairingTicket.qrPayload.desktopDeviceId,
      phoneDeviceId: phone.deviceId
    });
    phoneWs.send(JSON.stringify(resumeFrame));

    const resumedFrame = await tracker.waitFor(
      (frame) => frame.type === remoteCommon.FRAME_TYPES.SEARCH_PROGRESS || frame.type === remoteCommon.FRAME_TYPES.SEARCH_COMPLETE,
      20000
    );
    const resumedPayload = await remoteCrypto.decryptJsonPayload({
      privateKeyJwk: phone.privateKey,
      peerPublicKeyJwk: stateAfterTicket.pairingTicket.qrPayload.desktopPublicKey,
      ciphertext: resumedFrame.ciphertext,
      iv: resumedFrame.iv,
      aad: {
        type: resumedFrame.type,
        pairId: approvalPayload.pairId,
        requestId
      }
    });

    const finalFrame = resumedFrame.type === remoteCommon.FRAME_TYPES.SEARCH_COMPLETE
      ? resumedFrame
      : await tracker.waitFor(
        (frame) => frame.type === remoteCommon.FRAME_TYPES.SEARCH_COMPLETE || frame.type === remoteCommon.FRAME_TYPES.SEARCH_ERROR,
        240000
      );
    const finalPayload = await remoteCrypto.decryptJsonPayload({
      privateKeyJwk: phone.privateKey,
      peerPublicKeyJwk: stateAfterTicket.pairingTicket.qrPayload.desktopPublicKey,
      ciphertext: finalFrame.ciphertext,
      iv: finalFrame.iv,
      aad: {
        type: finalFrame.type,
        pairId: approvalPayload.pairId,
        requestId
      }
    });

    const compareSummary = await comparePage.evaluate(() => {
      const lastResult = window.__OPENCLAW_LAST_RESULT__ || null;
      const runtime = window.__AI_COMPARE_SITE_RUNTIME__ || null;
      return {
        href: location.href,
        debugPhase: document.getElementById('openclaw-debug-panel')?.dataset?.phase || null,
        openedSites: window.aiCompareOpenClaw?.getOpenedSites?.() || [],
        lastResultPhase: lastResult?.phase || null,
        lastResultSites: Array.isArray(lastResult?.results)
          ? lastResult.results.map((item) => ({
              siteName: item.siteName,
              status: item.status
            }))
          : [],
        runtimeSiteNames: runtime ? Object.keys(runtime.sites || {}) : []
      };
    });

    console.log(JSON.stringify({
      ok: true,
      checkedAt: new Date().toISOString(),
      relayBaseUrl,
      extensionId: EXTENSION_ID,
      query: VERIFY_QUERY,
      qrLoaded: true,
      pairId: approvalPayload.pairId,
      requestId,
      compareSummary,
      firstProgressPhase: firstProgressPayload.result?.phase || null,
      resumedType: resumedFrame.type,
      resumedPhase: resumedPayload.result?.phase || null,
      finalType: finalFrame.type,
      finalPhase: finalPayload.result?.phase || null,
      finalStatuses: Array.isArray(finalPayload.result?.results)
        ? finalPayload.result.results.map((item) => ({
            siteName: item.siteName,
            status: item.status
          }))
        : [],
      phoneFramesBeforeReconnect,
      phoneFramesAfterReconnect: tracker.frames.map((frame) => frame.type)
    }, null, 2));
  } finally {
    if (phoneWs && phoneWs.readyState === WebSocket.OPEN) {
      try {
        phoneWs.close();
      } catch (_) {}
    }
    await context.close().catch(() => {});
    await relayServer.stop().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
