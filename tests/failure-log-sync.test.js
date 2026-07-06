const assert = require('node:assert/strict');
const test = require('node:test');

const failureLogSync = require('../shared/failure-log-sync.js');

function createFailureLogStub(records) {
  const state = {
    records: records.map((record) => ({ ...record })),
    syncedIds: [],
    failedIds: [],
    failureMessage: ''
  };
  return {
    state,
    async getPendingSyncLogs(options = {}) {
      return state.records
        .filter((record) => ['pending', 'failed', undefined].includes(record.syncStatus))
        .slice(0, options.limit || 50);
    },
    async markLogsSynced(ids) {
      state.syncedIds.push(...ids);
      state.records.forEach((record) => {
        if (ids.includes(record.id)) record.syncStatus = 'synced';
      });
    },
    async markLogsSyncFailed(ids, message) {
      state.failedIds.push(...ids);
      state.failureMessage = message;
      state.records.forEach((record) => {
        if (ids.includes(record.id)) record.syncStatus = 'failed';
      });
    }
  };
}

test('sanitizeLogForUpload keeps only safe fields and truncates prompt preview', () => {
  const safe = failureLogSync.sanitizeLogForUpload({
    id: 'abc',
    category: 'api',
    apiKind: 'official',
    queryPreview: 'x'.repeat(200),
    errorMessage: 'failed',
    apiKey: 'secret-key',
    fullPrompt: 'do not upload',
    metadata: {
      status: 500,
      apiKey: 'also-secret'
    }
  });

  assert.equal(safe.id, 'abc');
  assert.equal(safe.queryPreview.length, 123);
  assert.equal(Object.hasOwn(safe, 'apiKey'), false);
  assert.equal(Object.hasOwn(safe, 'fullPrompt'), false);
  assert.equal(Object.hasOwn(safe.metadata, 'apiKey'), true);
  assert.equal(safe.metadata.apiKey, '[redacted]');
});

test('sanitizeLogForUpload keeps priority diagnostic metadata before extras', () => {
  const extras = Object.fromEntries(Array.from({ length: 45 }, (_, index) => [`extra${index}`, `value${index}`]));
  const safe = failureLogSync.sanitizeLogForUpload({
    id: 'timeout-1',
    category: 'site',
    siteName: 'ChatGPT',
    errorMessage: 'Timed out',
    metadata: {
      ...extras,
      timeoutReason: 'submitted_without_extractable_content',
      selectorSummary: '#prompt-textarea=>0/0',
      extractionSelectorSummary: '[data-message-author-role="assistant"]=>0/0',
      currentUrl: 'https://chatgpt.com/c/abc?code=secret&safe=yes'
    }
  });

  assert.equal(safe.metadata.timeoutReason, 'submitted_without_extractable_content');
  assert.equal(safe.metadata.selectorSummary, '#prompt-textarea=>0/0');
  assert.equal(safe.metadata.extractionSelectorSummary, '[data-message-author-role="assistant"]=>0/0');
  assert.equal(safe.metadata.currentUrl, 'https://chatgpt.com/c/abc?code=%5Bredacted%5D&safe=yes');
});

test('syncFailureLogs uploads one batch and marks records synced', async () => {
  const failureLog = createFailureLogStub(Array.from({ length: 55 }, (_, index) => ({
    id: `log-${index}`,
    category: 'site',
    siteName: 'Example',
    errorMessage: 'failed',
    syncStatus: 'pending'
  })));
  let uploadedPayload = null;
  const result = await failureLogSync.syncFailureLogs({
    failureLog,
    getBaseUrl: () => 'https://aicompare.club',
    getIdToken: () => 'id-token',
    getAnonymousClientId: () => 'anon-id',
    fetchImpl: async (_url, options) => {
      uploadedPayload = JSON.parse(options.body);
      return {
        ok: true,
        async json() {
          return {
            acceptedIds: uploadedPayload.logs.map((item) => item.id)
          };
        }
      };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(uploadedPayload.logs.length, failureLogSync.DEFAULT_BATCH_SIZE);
  assert.equal(failureLog.state.syncedIds.length, failureLogSync.DEFAULT_BATCH_SIZE);
});

test('syncFailureLogs marks records failed when upload fails', async () => {
  const failureLog = createFailureLogStub([{
    id: 'log-1',
    category: 'api',
    apiKind: 'custom',
    errorMessage: 'failed',
    syncStatus: 'pending'
  }]);

  const result = await failureLogSync.syncFailureLogs({
    failureLog,
    getBaseUrl: () => 'https://aicompare.club',
    getIdToken: () => '',
    getAnonymousClientId: () => 'anon-id',
    fetchImpl: async () => ({
      ok: false,
      status: 429,
      async json() {
        return { error: 'too many logs' };
      }
    })
  });

  assert.equal(result.ok, false);
  assert.deepEqual(failureLog.state.failedIds, ['log-1']);
  assert.equal(failureLog.state.failureMessage, 'too many logs');
});
