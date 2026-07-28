const assert = require('node:assert/strict');
const test = require('node:test');

const { raceWithTimeout } = require('../shared/async-timeout.js');

test('raceWithTimeout rejects when the operation does not settle', async () => {
  await assert.rejects(
    raceWithTimeout(new Promise(() => {}), 5, () => new Error('network timeout')),
    /network timeout/
  );
});

test('raceWithTimeout returns an operation result before the deadline', async () => {
  const result = await raceWithTimeout(Promise.resolve({ plan: 'pro' }), 50);
  assert.deepEqual(result, { plan: 'pro' });
});
