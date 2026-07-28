const assert = require('node:assert/strict');
const test = require('node:test');

const { dismissForToday, isDismissedToday } = require('../shared/daily-dismissal.js');

function createStorage() {
  const values = {};
  return {
    values,
    async get(key) { return { [key]: values[key] }; },
    async set(update) { Object.assign(values, update); }
  };
}

test('daily dismissal remains active on the same local day', async () => {
  const storage = createStorage();
  const now = new Date(2026, 6, 28, 10, 0, 0);
  await dismissForToday('overlay', storage, now);
  assert.equal(await isDismissedToday('overlay', storage, new Date(2026, 6, 28, 23, 59, 0)), true);
});

test('daily dismissal expires on the next local day', async () => {
  const storage = createStorage();
  await dismissForToday('overlay', storage, new Date(2026, 6, 28, 23, 59, 0));
  assert.equal(await isDismissedToday('overlay', storage, new Date(2026, 6, 29, 0, 1, 0)), false);
});
