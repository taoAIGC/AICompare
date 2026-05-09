const test = require('node:test');
const assert = require('node:assert/strict');

const remoteState = require('../remote/state.js');

test('normalizePersistence keeps compareTabId and trims relay settings', () => {
  const normalized = remoteState.normalizePersistence({
    settings: {
      enabled: true,
      relayBaseUrl: 'http://127.0.0.1:8787/',
      desktopName: '  Office Chrome  '
    },
    compareTabId: '42'
  });

  assert.equal(normalized.settings.enabled, true);
  assert.equal(normalized.settings.relayBaseUrl, 'http://127.0.0.1:8787');
  assert.equal(normalized.settings.desktopName, 'Office Chrome');
  assert.equal(normalized.compareTabId, 42);
});

test('normalizeSnapshotResult coerces unknown per-site statuses to error', () => {
  const normalized = remoteState.normalizeSnapshotResult({
    results: [
      { siteName: 'Qwen', status: 'streaming' },
      { siteName: 'Unknown', status: 'mystery-status' }
    ]
  });

  assert.deepEqual(normalized.results.map((item) => item.status), [
    'streaming',
    'error'
  ]);
});

test('buildUiState exposes only public device fields and current request snapshot', () => {
  const uiState = remoteState.buildUiState({
    settings: {
      enabled: true,
      relayBaseUrl: 'http://127.0.0.1:8787',
      desktopName: 'Desk'
    },
    deviceIdentity: {
      deviceId: 'desktop-1',
      deviceSecret: 'secret',
      deviceAuthKey: 'auth-key',
      publicKey: { kty: 'EC' },
      privateKey: { d: 'hidden' },
      fingerprint: 'ABCDEF-123456-7890AB-CDEF12',
      deviceName: 'Desk',
      createdAt: '2026-05-08T00:00:00.000Z'
    },
    activeSession: {
      requestId: 'req-1',
      pairId: 'pair-1',
      query: 'hello',
      tabId: 99,
      startedAt: '2026-05-08T00:00:00.000Z',
      status: 'running'
    },
    lastSnapshots: {
      'req-1': {
        requestId: 'req-1',
        pairId: 'pair-1',
        type: 'search.progress',
        completed: false,
        result: {
          results: [{ siteName: 'Qwen', status: 'streaming' }]
        },
        updatedAt: '2026-05-08T00:00:01.000Z'
      }
    },
    compareTabId: 99
  }, {
    connectionStatus: 'online',
    activeRequestId: 'req-1'
  });

  assert.deepEqual(uiState.deviceIdentity, {
    deviceId: 'desktop-1',
    fingerprint: 'ABCDEF-123456-7890AB-CDEF12',
    deviceName: 'Desk'
  });
  assert.equal(uiState.connectionStatus, 'online');
  assert.equal(uiState.compareTabId, 99);
  assert.equal(uiState.lastSnapshot.requestId, 'req-1');
  assert.equal(uiState.lastSnapshot.result.results[0].status, 'streaming');
});
