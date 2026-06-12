const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyExternalStatus,
  createUnifiedResult
} = require('../debug/live-verifier-common.js');

test('classifyExternalStatus recognizes common login and quota failures', () => {
  assert.equal(classifyExternalStatus('Please sign in to continue'), 'login_required');
  assert.equal(classifyExternalStatus('Usage limit reached for this account'), 'rate_limited');
  assert.equal(classifyExternalStatus('Access denied by captcha gate'), 'blocked');
  assert.equal(classifyExternalStatus('plain success text'), '');
});

test('createUnifiedResult derives assessment from status', () => {
  const okResult = createUnifiedResult({
    siteName: 'ChatGPT',
    mode: 'extension_url',
    ok: true,
    status: 'ok',
    query: '你好世界'
  });
  const loginResult = createUnifiedResult({
    siteName: 'Perplexity',
    mode: 'live_direct',
    ok: false,
    status: 'login_required',
    query: '你好世界'
  });

  assert.deepEqual(okResult.assessment, {
    config_valid: true,
    flow_valid: true,
    service_available: true
  });
  assert.deepEqual(loginResult.assessment, {
    config_valid: true,
    flow_valid: true,
    service_available: false
  });
});
