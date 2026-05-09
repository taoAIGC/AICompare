const { nowIso } = require('../../remote/common.js');

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
    this.firestore = new FirestoreMirror({
      enabled: options.useFirestore !== false,
      logger: this.logger,
      projectId: options.projectId
    });
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

  getDebugSnapshot() {
    return {
      devices: createMapBackedSnapshot(this.devices),
      pairingTickets: createMapBackedSnapshot(this.pairingTickets),
      pairRecords: createMapBackedSnapshot(this.pairRecords)
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
