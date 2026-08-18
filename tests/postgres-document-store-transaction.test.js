const test = require('node:test');
const assert = require('node:assert/strict');

const { PostgresDocumentStore } = require('../backend/postgres-document-store.js');

function createFakePool({ failFirstWrite = false } = {}) {
  const events = [];
  let connectionCount = 0;
  let failedWrite = false;

  return {
    events,
    get connectionCount() {
      return connectionCount;
    },
    async connect() {
      connectionCount += 1;
      const connectionId = connectionCount;
      return {
        async query(sql) {
          const operation = String(sql).trim().split(/\s+/).slice(0, 2).join(' ').toUpperCase();
          events.push(`${connectionId}:${operation}:start`);
          if (operation === 'SELECT DATA') {
            events.push(`${connectionId}:${operation}:end`);
            return { rows: [] };
          }
          if (operation === 'INSERT INTO') {
            await new Promise((resolve) => setTimeout(resolve, 5));
            if (failFirstWrite && !failedWrite) {
              failedWrite = true;
              const error = new Error('could not serialize access due to concurrent update');
              error.code = '40001';
              events.push(`${connectionId}:${operation}:error`);
              throw error;
            }
          }
          events.push(`${connectionId}:${operation}:end`);
          return { rows: [] };
        },
        release() {
          events.push(`${connectionId}:RELEASE`);
        }
      };
    }
  };
}

test('transaction queues unawaited writes before commit', async () => {
  const pool = createFakePool();
  const store = new PostgresDocumentStore('', pool);

  await store.runTransaction(async (transaction) => {
    transaction.set(store.collection('users').doc('one'), { plan: 'pro' });
  });

  const writeFinishedAt = pool.events.indexOf('1:INSERT INTO:end');
  const commitStartedAt = pool.events.indexOf('1:COMMIT:start');
  assert.ok(writeFinishedAt >= 0, 'queued write should finish');
  assert.ok(commitStartedAt > writeFinishedAt, 'commit should happen after queued writes');
});

test('transaction retries PostgreSQL serialization conflicts', async () => {
  const pool = createFakePool({ failFirstWrite: true });
  const store = new PostgresDocumentStore('', pool);
  let callbackRuns = 0;

  await store.runTransaction(async (transaction) => {
    callbackRuns += 1;
    transaction.set(store.collection('users').doc('one'), { plan: 'pro' });
  });

  assert.equal(callbackRuns, 2);
  assert.equal(pool.connectionCount, 2);
  assert.ok(pool.events.includes('1:ROLLBACK:start'));
  assert.ok(pool.events.includes('2:COMMIT:end'));
});

test('document snapshots expose child collection references', async () => {
  const pool = {
    async query() {
      return { rows: [{ path: 'users/user-one', data: { plan: 'free' } }] };
    }
  };
  const store = new PostgresDocumentStore('', pool);
  const snapshot = await store.collection('users').get();
  const userDoc = snapshot.docs[0];

  assert.equal(userDoc.ref.path, 'users/user-one');
  assert.equal(userDoc.ref.collection('usage').path, 'users/user-one/usage');
});
