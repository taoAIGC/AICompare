const http = require('node:http');
const { URL } = require('node:url');

const express = require('express');
const QRCode = require('qrcode');
const { WebSocketServer } = require('ws');

const remoteCommon = require('../../remote/common.js');
const remoteCrypto = require('../../remote/crypto.js');
const { createMetadataStore } = require('./store.js');

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const TICKET_TTL_MS = 5 * 60 * 1000;
const WS_OPEN_STATE = 1;

function isFreshTimestamp(timestamp) {
  const parsed = Date.parse(String(timestamp || ''));
  if (!Number.isFinite(parsed)) {
    return false;
  }
  return Math.abs(Date.now() - parsed) <= MAX_CLOCK_SKEW_MS;
}

function sanitizeDeviceBody(body = {}) {
  return {
    deviceId: String(body.deviceId || '').trim(),
    deviceName: String(body.deviceName || '').trim(),
    platform: String(body.platform || '').trim(),
    deviceSecretHash: String(body.deviceSecretHash || '').trim(),
    publicKey: body.publicKey && typeof body.publicKey === 'object' ? body.publicKey : null,
    fingerprint: String(body.fingerprint || '').trim()
  };
}

function createRelayServer(options = {}) {
  const logger = options.logger || console;
  const store = options.store || createMetadataStore({
    logger,
    useFirestore: options.useFirestore !== false,
    projectId: options.projectId
  });

  const app = express();
  app.use(express.json({ limit: '512kb' }));

  const server = options.server || http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  const connections = new Map();

  function logFrameEvent(label, meta = {}) {
    logger.info(`[remote-relay] ${label}`, {
      ...meta,
      loggedAt: remoteCommon.nowIso()
    });
  }

  function registerConnection(deviceId, ws, meta = {}) {
    const existing = connections.get(deviceId);
    if (existing && existing.ws && existing.ws !== ws) {
      try {
        existing.ws.close();
      } catch (_) {
        // Ignore close errors for replaced connections.
      }
    }
    connections.set(deviceId, {
      ws,
      ...meta,
      connectedAt: remoteCommon.nowIso()
    });
  }

  function clearConnectionBySocket(ws) {
    for (const [deviceId, connection] of connections.entries()) {
      if (connection.ws === ws) {
        connections.delete(deviceId);
      }
    }
  }

  function sendFrame(deviceId, frame) {
    const connection = connections.get(deviceId);
    if (!connection || !connection.ws || connection.ws.readyState !== WS_OPEN_STATE) {
      return false;
    }
    connection.ws.send(JSON.stringify(frame));
    return true;
  }

  async function verifyFrameAuth(frame) {
    if (!frame || typeof frame !== 'object') {
      return {
        ok: false,
        error: 'invalid_frame'
      };
    }

    const deviceId = String(frame.deviceId || '').trim();
    if (!deviceId) {
      return {
        ok: false,
        error: 'missing_device_id'
      };
    }

    const device = await store.getDevice(deviceId);
    if (!device || !device.deviceSecretHash) {
      return {
        ok: false,
        error: 'unknown_device'
      };
    }

    if (!isFreshTimestamp(frame.timestamp)) {
      return {
        ok: false,
        error: 'stale_timestamp'
      };
    }

    const proofValid = await remoteCrypto.verifyDeviceProof({
      authKey: device.deviceSecretHash,
      deviceId,
      route: frame.type,
      challenge: frame.challenge,
      timestamp: frame.timestamp,
      proof: frame.proof
    });

    if (!proofValid) {
      return {
        ok: false,
        error: 'invalid_proof'
      };
    }

    return {
      ok: true,
      device
    };
  }

  async function routePairRequest(frame, senderDevice) {
    const pairingTicket = await store.getPairingTicket(frame.ticketId);
    if (!pairingTicket || pairingTicket.status === 'revoked') {
      return {
        ok: false,
        error: 'ticket_not_found'
      };
    }

    if (Date.parse(pairingTicket.expiresAt) <= Date.now()) {
      await store.updatePairingTicket(pairingTicket.ticketId, {
        status: 'expired'
      });
      return {
        ok: false,
        error: 'ticket_expired'
      };
    }

    if (pairingTicket.desktopDeviceId !== frame.desktopDeviceId) {
      return {
        ok: false,
        error: 'desktop_device_mismatch'
      };
    }

    const pairId = remoteCommon.createId('pair');
    const pairRecord = await store.createPairRecord({
      pairId,
      status: 'pending',
      desktopDeviceId: frame.desktopDeviceId,
      phoneDeviceId: senderDevice.deviceId,
      desktopFingerprint: pairingTicket.desktopFingerprint || '',
      phoneFingerprint: senderDevice.fingerprint || '',
      createdAt: remoteCommon.nowIso()
    });

    await store.updatePairingTicket(pairingTicket.ticketId, {
      status: 'pending',
      claimedByDeviceId: senderDevice.deviceId,
      claimedAt: remoteCommon.nowIso(),
      activePairId: pairId
    });

    const delivered = sendFrame(frame.desktopDeviceId, {
      type: remoteCommon.FRAME_TYPES.PAIR_REQUEST,
      pairId,
      ticketId: pairingTicket.ticketId,
      desktopDeviceId: frame.desktopDeviceId,
      phoneDeviceId: senderDevice.deviceId,
      phoneName: frame.phoneName,
      phonePlatform: frame.phonePlatform,
      phoneFingerprint: senderDevice.fingerprint || frame.phoneFingerprint || '',
      phonePublicKey: senderDevice.publicKey || frame.phonePublicKey || null,
      ciphertext: frame.ciphertext,
      iv: frame.iv,
      createdAt: frame.createdAt || remoteCommon.nowIso()
    });

    if (!delivered) {
      await store.revokePair(pairId, 'relay');
      return {
        ok: false,
        error: 'desktop_offline'
      };
    }

    logFrameEvent('pair.request', {
      pairId,
      desktopDeviceId: frame.desktopDeviceId,
      phoneDeviceId: senderDevice.deviceId
    });

    return {
      ok: true,
      pairRecord
    };
  }

  async function routePairDecision(frame, senderDevice, approved) {
    const pairRecord = await store.getPairRecord(frame.pairId);
    if (!pairRecord || pairRecord.desktopDeviceId !== senderDevice.deviceId) {
      return {
        ok: false,
        error: 'pair_not_found'
      };
    }

    const nextStatus = approved ? 'active' : 'rejected';
    await store.updatePairRecord(frame.pairId, {
      status: nextStatus,
      approvedAt: approved ? remoteCommon.nowIso() : '',
      rejectedAt: approved ? '' : remoteCommon.nowIso()
    });

    const delivered = sendFrame(pairRecord.phoneDeviceId, {
      type: approved ? remoteCommon.FRAME_TYPES.PAIR_APPROVE : remoteCommon.FRAME_TYPES.PAIR_REJECT,
      pairId: frame.pairId,
      desktopDeviceId: senderDevice.deviceId,
      phoneDeviceId: pairRecord.phoneDeviceId,
      ciphertext: frame.ciphertext || '',
      iv: frame.iv || '',
      createdAt: remoteCommon.nowIso()
    });

    if (!delivered) {
      return {
        ok: false,
        error: 'phone_offline'
      };
    }

    logFrameEvent(approved ? 'pair.approve' : 'pair.reject', {
      pairId: frame.pairId,
      desktopDeviceId: senderDevice.deviceId,
      phoneDeviceId: pairRecord.phoneDeviceId
    });

    return {
      ok: true
    };
  }

  async function routeSearchFrame(frame, senderDevice, expectedSenderRole) {
    const pairRecord = await store.getPairRecord(frame.pairId);
    if (!pairRecord || pairRecord.status !== 'active') {
      return {
        ok: false,
        error: 'pair_not_active'
      };
    }

    const senderMatches = expectedSenderRole === 'phone'
      ? pairRecord.phoneDeviceId === senderDevice.deviceId
      : pairRecord.desktopDeviceId === senderDevice.deviceId;

    if (!senderMatches) {
      return {
        ok: false,
        error: 'sender_mismatch'
      };
    }

    const targetDeviceId = expectedSenderRole === 'phone'
      ? pairRecord.desktopDeviceId
      : pairRecord.phoneDeviceId;
    const delivered = sendFrame(targetDeviceId, frame);
    if (!delivered) {
      return {
        ok: false,
        error: 'target_offline'
      };
    }

    logFrameEvent(frame.type, {
      pairId: frame.pairId,
      requestId: frame.requestId || '',
      senderDeviceId: senderDevice.deviceId,
      targetDeviceId,
      ciphertextSize: String(frame.ciphertext || '').length
    });

    return {
      ok: true
    };
  }

  app.get('/healthz', (req, res) => {
    res.json({
      ok: true,
      protocolVersion: remoteCommon.REMOTE_PROTOCOL_VERSION,
      connectedDevices: connections.size
    });
  });

  app.get('/qr', async (req, res, next) => {
    try {
      const qrData = String(req.query.data || '').trim();
      if (!qrData) {
        res.status(400).json({
          ok: false,
          error: 'missing_qr_data'
        });
        return;
      }

      const svg = await QRCode.toString(qrData, {
        type: 'svg',
        margin: 1,
        errorCorrectionLevel: 'M',
        color: {
          dark: '#111111',
          light: '#ffffff'
        }
      });

      res.type('image/svg+xml').send(svg);
    } catch (error) {
      next(error);
    }
  });

  app.post('/pairing-tickets', async (req, res, next) => {
    try {
      const device = sanitizeDeviceBody(req.body);
      if (!device.deviceId || !device.deviceSecretHash || !device.publicKey) {
        res.status(400).json({
          ok: false,
          error: 'missing_device_fields'
        });
        return;
      }

      await store.upsertDevice(device);
      const ticketId = remoteCommon.createId('ticket');
      const expiresAt = new Date(Date.now() + TICKET_TTL_MS).toISOString();
      await store.createPairingTicket({
        ticketId,
        desktopDeviceId: device.deviceId,
        desktopFingerprint: device.fingerprint || '',
        status: 'open',
        expiresAt
      });

      res.status(201).json({
        ok: true,
        ticketId,
        expiresAt
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/pairing-tickets/:ticketId/claim', async (req, res, next) => {
    try {
      const ticketId = String(req.params.ticketId || '').trim();
      const pairingTicket = await store.getPairingTicket(ticketId);
      if (!pairingTicket || pairingTicket.status === 'revoked') {
        res.status(404).json({
          ok: false,
          error: 'ticket_not_found'
        });
        return;
      }

      if (Date.parse(pairingTicket.expiresAt) <= Date.now()) {
        await store.updatePairingTicket(ticketId, {
          status: 'expired'
        });
        res.status(410).json({
          ok: false,
          error: 'ticket_expired'
        });
        return;
      }

      const phoneDevice = sanitizeDeviceBody(req.body);
      if (!phoneDevice.deviceId || !phoneDevice.deviceSecretHash || !phoneDevice.publicKey) {
        res.status(400).json({
          ok: false,
          error: 'missing_device_fields'
        });
        return;
      }

      await store.upsertDevice(phoneDevice);
      await store.updatePairingTicket(ticketId, {
        claimedByDeviceId: phoneDevice.deviceId,
        claimedAt: remoteCommon.nowIso()
      });

      res.json({
        ok: true,
        ticketId,
        desktopDeviceId: pairingTicket.desktopDeviceId,
        expiresAt: pairingTicket.expiresAt
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/pairings/:pairId/revoke', async (req, res, next) => {
    try {
      const pairId = String(req.params.pairId || '').trim();
      const requesterDeviceId = String(req.body?.deviceId || '').trim();
      const pairRecord = await store.getPairRecord(pairId);
      if (!pairRecord) {
        res.status(404).json({
          ok: false,
          error: 'pair_not_found'
        });
        return;
      }

      const isParticipant = requesterDeviceId
        && (pairRecord.desktopDeviceId === requesterDeviceId || pairRecord.phoneDeviceId === requesterDeviceId);
      if (!isParticipant) {
        res.status(403).json({
          ok: false,
          error: 'forbidden'
        });
        return;
      }

      const revokedPair = await store.revokePair(pairId, requesterDeviceId);
      sendFrame(pairRecord.desktopDeviceId, {
        type: remoteCommon.FRAME_TYPES.PAIR_REVOKED,
        pairId,
        revokedAt: revokedPair.revokedAt
      });
      sendFrame(pairRecord.phoneDeviceId, {
        type: remoteCommon.FRAME_TYPES.PAIR_REVOKED,
        pairId,
        revokedAt: revokedPair.revokedAt
      });

      res.json({
        ok: true,
        pairId
      });
    } catch (error) {
      next(error);
    }
  });

  app.use((error, req, res, next) => {
    logger.error('[remote-relay] request failed:', error);
    res.status(500).json({
      ok: false,
      error: 'internal_error'
    });
  });

  server.on('upgrade', (request, socket, head) => {
    try {
      const requestUrl = new URL(request.url, 'http://127.0.0.1');
      if (requestUrl.pathname !== '/ws') {
        socket.destroy();
        return;
      }
    } catch (_) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (ws) => {
    ws.on('message', async (payloadBuffer) => {
      try {
        const frame = remoteCommon.safeParseJson(String(payloadBuffer || ''), null);
        if (!frame || typeof frame !== 'object' || !frame.type) {
          return;
        }

        const verification = await verifyFrameAuth(frame);
        if (!verification.ok) {
          ws.send(JSON.stringify({
            type: remoteCommon.FRAME_TYPES.INTERNAL_AUTH_ERROR,
            error: verification.error
          }));
          return;
        }

        const senderDevice = verification.device;
        switch (frame.type) {
          case remoteCommon.FRAME_TYPES.PRESENCE_HELLO: {
            registerConnection(senderDevice.deviceId, ws, {
              role: frame.role || '',
              pairId: frame.pairId || '',
              fingerprint: senderDevice.fingerprint || frame.fingerprint || ''
            });
            await store.upsertDevice({
              ...senderDevice,
              deviceName: frame.deviceName || senderDevice.deviceName,
              lastSeenAt: remoteCommon.nowIso()
            });
            ws.send(JSON.stringify({
              type: remoteCommon.FRAME_TYPES.PRESENCE_PING,
              serverTime: remoteCommon.nowIso()
            }));
            break;
          }
          case remoteCommon.FRAME_TYPES.PRESENCE_PING:
            ws.send(JSON.stringify({
              type: remoteCommon.FRAME_TYPES.PRESENCE_PING,
              serverTime: remoteCommon.nowIso()
            }));
            break;
          case remoteCommon.FRAME_TYPES.PAIR_REQUEST: {
            const result = await routePairRequest(frame, senderDevice);
            if (!result.ok) {
              ws.send(JSON.stringify({
                type: remoteCommon.FRAME_TYPES.INTERNAL_DELIVERY_ERROR,
                error: result.error
              }));
            }
            break;
          }
          case remoteCommon.FRAME_TYPES.PAIR_APPROVE: {
            const result = await routePairDecision(frame, senderDevice, true);
            if (!result.ok) {
              ws.send(JSON.stringify({
                type: remoteCommon.FRAME_TYPES.INTERNAL_DELIVERY_ERROR,
                error: result.error
              }));
            }
            break;
          }
          case remoteCommon.FRAME_TYPES.PAIR_REJECT: {
            const result = await routePairDecision(frame, senderDevice, false);
            if (!result.ok) {
              ws.send(JSON.stringify({
                type: remoteCommon.FRAME_TYPES.INTERNAL_DELIVERY_ERROR,
                error: result.error
              }));
            }
            break;
          }
          case remoteCommon.FRAME_TYPES.SEARCH_START:
          case remoteCommon.FRAME_TYPES.SESSION_RESUME: {
            const result = await routeSearchFrame(frame, senderDevice, 'phone');
            if (!result.ok) {
              ws.send(JSON.stringify({
                type: remoteCommon.FRAME_TYPES.INTERNAL_DELIVERY_ERROR,
                error: result.error,
                requestId: frame.requestId || ''
              }));
            }
            break;
          }
          case remoteCommon.FRAME_TYPES.SEARCH_PROGRESS:
          case remoteCommon.FRAME_TYPES.SEARCH_COMPLETE:
          case remoteCommon.FRAME_TYPES.SEARCH_ERROR: {
            const result = await routeSearchFrame(frame, senderDevice, 'desktop');
            if (!result.ok) {
              ws.send(JSON.stringify({
                type: remoteCommon.FRAME_TYPES.INTERNAL_DELIVERY_ERROR,
                error: result.error,
                requestId: frame.requestId || ''
              }));
            }
            break;
          }
          default:
            break;
        }
      } catch (error) {
        logger.error('[remote-relay] websocket frame failed:', error);
        try {
          ws.send(JSON.stringify({
            type: remoteCommon.FRAME_TYPES.INTERNAL_DELIVERY_ERROR,
            error: 'internal_error'
          }));
        } catch (_) {
          // Ignore socket send failures after processing errors.
        }
      }
    });

    ws.on('close', () => {
      clearConnectionBySocket(ws);
    });
  });

  async function start(port = Number(process.env.PORT || 8787), host = process.env.HOST || '0.0.0.0') {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
    const address = server.address();
    const normalizedPort = typeof address === 'object' && address ? address.port : port;
    return {
      port: normalizedPort,
      host
    };
  }

  async function stop() {
    connections.clear();
    await new Promise((resolve) => {
      wss.close(() => {
        resolve();
      });
    });
    await new Promise((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }

  function getAddress() {
    const address = server.address();
    if (!address || typeof address === 'string') {
      return address;
    }
    return `http://127.0.0.1:${address.port}`;
  }

  return {
    app,
    server,
    store,
    connections,
    start,
    stop,
    getAddress
  };
}

module.exports = {
  createRelayServer,
  MAX_CLOCK_SKEW_MS,
  TICKET_TTL_MS
};
