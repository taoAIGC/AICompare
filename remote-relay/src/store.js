const fs = require('node:fs');
const path = require('node:path');

const { nowIso } = require('../../remote/common.js');

const DEFAULT_SHARE_STORE_FILE = path.join(process.cwd(), 'data', 'shares.json');

function createMapBackedSnapshot(collection) {
  return Array.from(collection.values()).map((item) => ({
    ...item
  }));
}

class FirestoreMirror {
  constructor(options = {}) {
    this.enabled = Boolean(options.enabled);
    this.logger = options.logger || console;
    this.firestore = null;
    this.projectId = options.projectId || process.env.GOOGLE_CLOUD_PROJECT || '';

    if (!this.enabled || !this.projectId) {
      this.enabled = false;
      return;
    }

    try {
      const { Firestore } = require('@google-cloud/firestore');
      this.firestore = new Firestore({
        projectId: this.projectId
      });
    } catch (error) {
      this.enabled = false;
      this.logger.warn('Firestore mirror is unavailable, falling back to in-memory metadata only:', error.message);
    }
  }

  async set(collection, documentId, payload) {
    if (!this.enabled || !this.firestore) {
      return;
    }
    await this.firestore.collection(collection).doc(documentId).set(payload, { merge: true });
  }
}

class MetadataStore {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.devices = new Map();
    this.pairingTickets = new Map();
    this.pairRecords = new Map();
    this.shareRecords = new Map();
    this.persistShares = options.persistShares !== false;
    this.shareStoreFile = String(options.shareStoreFile || process.env.SHARE_STORE_FILE || DEFAULT_SHARE_STORE_FILE).trim() || DEFAULT_SHARE_STORE_FILE;
    this.firestore = new FirestoreMirror({
      enabled: options.useFirestore !== false,
      logger: this.logger,
      projectId: options.projectId
    });
    this.loadShareRecordsFromDisk();
  }

  loadShareRecordsFromDisk() {
    if (!this.persistShares) {
      return;
    }

    try {
      if (!fs.existsSync(this.shareStoreFile)) {
        return;
      }

      const parsed = JSON.parse(fs.readFileSync(this.shareStoreFile, 'utf8'));
      const records = Array.isArray(parsed?.shareRecords)
        ? parsed.shareRecords
        : (Array.isArray(parsed) ? parsed : []);

      for (const record of records) {
        const shareId = String(record?.shareId || '').trim();
        if (!shareId) {
          continue;
        }
        this.shareRecords.set(shareId, {
          ...record
        });
      }
    } catch (error) {
      this.logger.warn('Failed to load persisted share records, continuing with empty share store:', error.message);
    }
  }

  async persistShareRecordsToDisk() {
    if (!this.persistShares) {
      return;
    }

    const directory = path.dirname(this.shareStoreFile);
    const tempFile = `${this.shareStoreFile}.tmp`;
    const payload = JSON.stringify({
      shareRecords: Array.from(this.shareRecords.values())
    }, null, 2);

    await fs.promises.mkdir(directory, { recursive: true });
    await fs.promises.writeFile(tempFile, payload, 'utf8');
    await fs.promises.rename(tempFile, this.shareStoreFile);
  }

  async upsertDevice(device) {
    const nextDevice = {
      ...this.devices.get(device.deviceId),
      ...device,
      updatedAt: nowIso()
    };
    this.devices.set(device.deviceId, nextDevice);
    await this.firestore.set('remoteDevices', device.deviceId, nextDevice);
    return {
      ...nextDevice
    };
  }

  async getDevice(deviceId) {
    const device = this.devices.get(deviceId);
    return device ? { ...device } : null;
  }

  async createPairingTicket(ticket) {
    const nextTicket = {
      ...ticket,
      createdAt: ticket.createdAt || nowIso(),
      updatedAt: nowIso()
    };
    this.pairingTickets.set(ticket.ticketId, nextTicket);
    await this.firestore.set('remotePairingTickets', ticket.ticketId, nextTicket);
    return {
      ...nextTicket
    };
  }

  async getPairingTicket(ticketId) {
    const ticket = this.pairingTickets.get(ticketId);
    return ticket ? { ...ticket } : null;
  }

  async updatePairingTicket(ticketId, patch = {}) {
    const existing = this.pairingTickets.get(ticketId);
    if (!existing) {
      return null;
    }
    const nextTicket = {
      ...existing,
      ...patch,
      updatedAt: nowIso()
    };
    this.pairingTickets.set(ticketId, nextTicket);
    await this.firestore.set('remotePairingTickets', ticketId, nextTicket);
    return {
      ...nextTicket
    };
  }

  async createPairRecord(record) {
    const nextRecord = {
      ...record,
      createdAt: record.createdAt || nowIso(),
      updatedAt: nowIso()
    };
    this.pairRecords.set(record.pairId, nextRecord);
    await this.firestore.set('remotePairs', record.pairId, nextRecord);
    return {
      ...nextRecord
    };
  }

  async getPairRecord(pairId) {
    const record = this.pairRecords.get(pairId);
    return record ? { ...record } : null;
  }

  async updatePairRecord(pairId, patch = {}) {
    const existing = this.pairRecords.get(pairId);
    if (!existing) {
      return null;
    }
    const nextRecord = {
      ...existing,
      ...patch,
      updatedAt: nowIso()
    };
    this.pairRecords.set(pairId, nextRecord);
    await this.firestore.set('remotePairs', pairId, nextRecord);
    return {
      ...nextRecord
    };
  }

  async revokePair(pairId, revokedByDeviceId) {
    return this.updatePairRecord(pairId, {
      status: 'revoked',
      revokedByDeviceId,
      revokedAt: nowIso()
    });
  }

  async createShareRecord(record) {
    const nextRecord = {
      ...record,
      createdAt: record.createdAt || nowIso(),
      updatedAt: nowIso()
    };
    this.shareRecords.set(record.shareId, nextRecord);
    await this.persistShareRecordsToDisk();
    await this.firestore.set('remoteShares', record.shareId, nextRecord);
    return {
      ...nextRecord
    };
  }

  async getShareRecord(shareId) {
    const record = this.shareRecords.get(shareId);
    return record ? { ...record } : null;
  }

  async updateShareRecord(shareId, patch = {}) {
    const existing = this.shareRecords.get(shareId);
    if (!existing) {
      return null;
    }
    const nextRecord = {
      ...existing,
      ...patch,
      updatedAt: nowIso()
    };
    this.shareRecords.set(shareId, nextRecord);
    await this.persistShareRecordsToDisk();
    await this.firestore.set('remoteShares', shareId, nextRecord);
    return {
      ...nextRecord
    };
  }

  async listShareRecords(limit = 100) {
    return Array.from(this.shareRecords.values())
      .slice(-Math.max(1, Number(limit) || 100))
      .map((item) => ({ ...item }));
  }

  getDebugSnapshot() {
    return {
      devices: createMapBackedSnapshot(this.devices),
      pairingTickets: createMapBackedSnapshot(this.pairingTickets),
      pairRecords: createMapBackedSnapshot(this.pairRecords),
      shareRecords: createMapBackedSnapshot(this.shareRecords)
    };
  }
}

function createMetadataStore(options = {}) {
  return new MetadataStore(options);
}

module.exports = {
  FirestoreMirror,
  MetadataStore,
  createMetadataStore
};
