const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const backgroundSource = fs.readFileSync('background.js', 'utf8');
const serverSource = fs.readFileSync('backend/server.js', 'utf8');

test('background refreshes Firebase sessions through the VPS auth endpoint', () => {
  const refreshFunction = backgroundSource.match(
    /async function refreshBackgroundFirebaseIdToken[\s\S]*?\n}\n\nasync function getFirebaseIdTokenIfAvailable/
  )?.[0] || '';

  assert.match(refreshFunction, /\$\{getCloudFunctionsBaseUrl\(\)\}\/auth\/firebase-token\/refresh/);
  assert.doesNotMatch(refreshFunction, /securetoken\.googleapis\.com/);
  assert.match(refreshFunction, /refreshToken:\s*auth\.refreshToken/);
});

test('a signed-in user without a refreshed token cannot be billed as anonymous', () => {
  const quotaFunction = backgroundSource.match(
    /async function consumeChatPlanUsageQuota[\s\S]*?\n}\n\nasync function consumeOfficialUsageQuota/
  )?.[0] || '';

  assert.match(quotaFunction, /const auth = await getBackgroundFirebaseAuth\(\);/);
  assert.match(quotaFunction, /if \(auth\.uid && !idToken\)/);
  assert.match(quotaFunction, /error\.code = 'AUTH_SESSION_EXPIRED';/);
  assert.match(quotaFunction, /const anonymousClientId = idToken \? '' : await getOrCreateAnonymousClientId\(\);/);
});

test('Chat Plan usage is metered for every locale', () => {
  const signedInUsageFunction = serverSource.match(
    /async function consumeChatPlanUsage[\s\S]*?\n}\n\nasync function consumeAnonymousChatPlanUsage/
  )?.[0] || '';
  const anonymousUsageFunction = serverSource.match(
    /async function consumeAnonymousChatPlanUsage[\s\S]*?\n}\n\nasync function consumeChatPlanUsageForRequest/
  )?.[0] || '';

  assert.doesNotMatch(signedInUsageFunction, /shouldMeterLocale/);
  assert.doesNotMatch(anonymousUsageFunction, /shouldMeterLocale/);
});
