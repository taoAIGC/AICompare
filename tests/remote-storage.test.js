const test = require('node:test');
const assert = require('node:assert/strict');

const remoteStorage = require('../remote/storage.js');

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

test('writePersistence and readPersistence round-trip compare tab id and snapshots', async () => {
  const storageArea = createMemoryStorageArea();
  const persistence = {
    settings: {
      enabled: true,
      relayBaseUrl: 'http://127.0.0.1:8787',
      desktopName: 'Desk'
    },
    compareTabId: 17,
    lastSnapshots: {
      'req-1': {
        requestId: 'req-1',
        pairId: 'pair-1',
        type: 'search.complete',
        completed: true,
        result: {
          results: [{ siteName: 'Qwen', status: 'ok' }]
        },
        updatedAt: '2026-05-08T00:00:00.000Z'
      }
    }
  };

  await remoteStorage.writePersistence(storageArea, persistence);
  const roundTrip = await remoteStorage.readPersistence(storageArea);

  assert.equal(roundTrip.compareTabId, 17);
  assert.equal(roundTrip.settings.enabled, true);
  assert.equal(roundTrip.lastSnapshots['req-1'].completed, true);
});

test('patchPersistence merges updates onto stored records', async () => {
  const storageArea = createMemoryStorageArea();

  await remoteStorage.patchPersistence(storageArea, {
    settings: {
      enabled: true,
      relayBaseUrl: 'http://127.0.0.1:8787',
      desktopName: 'Desk'
    },
    compareTabId: 7
  });

  const persisted = storageArea.dump();
  assert.equal(persisted.remoteSearchCompareTabId, 7);

  const next = await remoteStorage.patchPersistence(storageArea, {
    lastError: 'relay_unavailable'
  });

  assert.equal(next.compareTabId, 7);
  assert.equal(next.lastError, 'relay_unavailable');
});
