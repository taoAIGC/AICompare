const assert = require('node:assert/strict');
const test = require('node:test');

const failureLog = require('../shared/failure-log.js');

function installMemoryChromeStorage() {
  const store = {};
  global.chrome = {
    storage: {
      local: {
        async get(key) {
          return { [key]: store[key] };
        },
        async set(value) {
          Object.assign(store, value);
        }
      }
    }
  };
  return store;
}

test('sanitizeUrl redacts sensitive query parameters', () => {
  const sanitized = failureLog.sanitizeUrl('https://example.com/callback?token=abc&code=123&safe=yes');
  assert.equal(sanitized, 'https://example.com/callback?token=%5Bredacted%5D&code=%5Bredacted%5D&safe=yes');
});

test('normalizeFailureEvent truncates prompt preview and hashes query', async () => {
  const record = await failureLog.normalizeFailureEvent({
    category: 'api',
    source: 'background',
    apiKind: 'official',
    query: 'x'.repeat(200),
    errorMessage: 'failed'
  });

  assert.equal(record.category, 'api');
  assert.equal(record.queryPreview.length, failureLog.QUERY_PREVIEW_LIMIT + 3);
  assert.ok(record.queryHash);
  assert.equal(record.syncStatus, failureLog.SYNC_STATUS_PENDING);
});

test('normalizeFailureEvent keeps priority diagnostic metadata before extras', async () => {
  const extras = Object.fromEntries(Array.from({ length: 45 }, (_, index) => [`extra${index}`, `value${index}`]));
  const record = await failureLog.normalizeFailureEvent({
    category: 'site',
    source: 'inject',
    siteName: 'ChatGPT',
    phase: 'timeout',
    errorMessage: 'Timed out',
    metadata: {
      ...extras,
      timeoutReason: 'streaming_never_stabilized',
      matchedSelector: 'button[data-testid="send-button"]',
      extractionMethod: 'latestVisibleResponse',
      selectorSummary: '#prompt-textarea=>0/0',
      currentUrl: 'https://chatgpt.com/c/abc?token=secret&safe=yes'
    }
  });

  assert.equal(record.metadata.timeoutReason, 'streaming_never_stabilized');
  assert.equal(record.metadata.matchedSelector, 'button[data-testid="send-button"]');
  assert.equal(record.metadata.extractionMethod, 'latestVisibleResponse');
  assert.equal(record.metadata.selectorSummary, '#prompt-textarea=>0/0');
  assert.equal(record.metadata.currentUrl, 'https://chatgpt.com/c/abc?token=%5Bredacted%5D&safe=yes');
});

test('logFailure deduplicates matching records inside the window', async () => {
  installMemoryChromeStorage();
  await failureLog.clearLogs();
  await failureLog.logFailure({
    category: 'site',
    source: 'inject',
    siteName: 'Example',
    phase: 'submit',
    errorMessage: 'same failure'
  });
  await failureLog.logFailure({
    category: 'site',
    source: 'inject',
    siteName: 'Example',
    phase: 'submit',
    errorMessage: 'same failure'
  });

  const logs = await failureLog.getLogs({ days: 1 });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].repeatCount, 2);
  assert.equal(logs[0].syncStatus, failureLog.SYNC_STATUS_PENDING);
});

test('logFailure keeps timeout records separate when detail codes differ', async () => {
  installMemoryChromeStorage();
  await failureLog.clearLogs();
  await failureLog.logFailure({
    category: 'site',
    source: 'inject',
    siteName: 'ChatGPT',
    phase: 'timeout',
    errorCode: 'site_timeout_submitted_without_extractable_content',
    errorMessage: 'Timed out',
    metadata: {
      timeoutReason: 'submitted_without_extractable_content'
    }
  });
  await failureLog.logFailure({
    category: 'site',
    source: 'inject',
    siteName: 'ChatGPT',
    phase: 'timeout',
    errorCode: 'site_timeout_streaming_never_stabilized',
    errorMessage: 'Timed out',
    metadata: {
      timeoutReason: 'streaming_never_stabilized'
    }
  });

  const logs = await failureLog.getLogs({ days: 1 });
  assert.equal(logs.length, 2);
  assert.deepEqual(
    logs.map((record) => record.errorCode).sort(),
    [
      'site_timeout_streaming_never_stabilized',
      'site_timeout_submitted_without_extractable_content'
    ]
  );
});

test('sync status helpers mark records as synced or failed', async () => {
  installMemoryChromeStorage();
  await failureLog.clearLogs();
  const record = await failureLog.logFailure({
    category: 'api',
    source: 'background',
    apiKind: 'custom',
    phase: 'http',
    errorMessage: 'sync me'
  });

  await failureLog.markLogsSynced([record.id], '2026-07-06T10:00:00.000Z');
  let logs = await failureLog.getLogs({ days: 1 });
  assert.equal(logs[0].syncStatus, failureLog.SYNC_STATUS_SYNCED);
  assert.equal(logs[0].syncedAt, '2026-07-06T10:00:00.000Z');

  await failureLog.markLogsSyncFailed([record.id], 'network down', '2026-07-06T10:05:00.000Z');
  logs = await failureLog.getLogs({ days: 1 });
  assert.equal(logs[0].syncStatus, failureLog.SYNC_STATUS_FAILED);
  assert.equal(logs[0].syncError, 'network down');
});

test('pruneRecordList keeps 30 days and caps at 2000 records', () => {
  const now = new Date('2026-07-06T12:00:00.000Z');
  const records = Array.from({ length: 2005 }, (_, index) => ({
    id: `recent-${index}`,
    createdAt: new Date(now.getTime() - index * 1000).toISOString(),
    lastSeenAt: new Date(now.getTime() - index * 1000).toISOString()
  }));
  records.push({
    id: 'old',
    createdAt: '2026-05-01T00:00:00.000Z',
    lastSeenAt: '2026-05-01T00:00:00.000Z'
  });

  const pruned = failureLog.pruneRecordList(records, now);
  assert.equal(pruned.length, failureLog.MAX_RECORDS);
  assert.equal(pruned.some((record) => record.id === 'old'), false);
});
