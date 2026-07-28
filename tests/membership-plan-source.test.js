const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

test('getUserPlan falls back to local cache without a direct Firestore request', async () => {
  const requests = [];
  const context = {
    console,
    setTimeout,
    clearTimeout,
    AbortController,
    window: {
      FirebaseConfig: { cloudFunctionsBaseUrl: 'https://aicompare.example', projectId: 'project', apiKey: 'key' },
      firebaseGetCurrentUid: async () => 'user-1',
      firebaseGetIdToken: async () => 'id-token'
    },
    chrome: {
      storage: {
        local: {
          async get() {
            return {
              _planCache: JSON.stringify({ plan: 'pro', apiPlan: 'free', planExpiresAt: null, apiPlanExpiresAt: null }),
              _planCacheAt: Date.now()
            };
          },
          async set() {}
        }
      }
    },
    fetch: async (url) => {
      requests.push(String(url));
      throw new TypeError('Failed to fetch');
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('firebase/stripe-payment.js', 'utf8'), context);

  const plan = await vm.runInContext('getUserPlan()', context);

  assert.equal(plan.plan, 'pro');
  assert.deepEqual(requests, ['https://aicompare.example/userPlan']);
});
