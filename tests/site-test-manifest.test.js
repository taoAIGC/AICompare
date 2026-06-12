const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { SITE_CHECKS } = require('../debug/site-test-manifest.js');

test('extension-url site checks do not require direct verifier scripts', () => {
  const repoRoot = path.join(__dirname, '..');
  const extensionChecks = SITE_CHECKS.filter((check) => check.mode === 'extension_url');

  assert.ok(extensionChecks.length > 0);
  for (const check of extensionChecks) {
    if (!check.script) continue;
    assert.ok(fs.existsSync(path.join(repoRoot, check.script)), `${check.id} script should exist when declared`);
  }
});

test('core scheduled sites stay on extension_url mode', () => {
  const coreChecks = SITE_CHECKS.filter((check) => check.groups.includes('core'));

  assert.ok(coreChecks.length > 0);
  for (const check of coreChecks) {
    assert.equal(check.mode, 'extension_url');
  }
});
