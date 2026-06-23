const test = require('node:test');
const assert = require('node:assert/strict');

const agentEngineConfig = require('../config/agentEngineConfig.js');

test('official API daily free limit is 100', () => {
  assert.equal(agentEngineConfig.DEFAULT_DAILY_FREE_LIMIT, 100);
});

test('official defaults do not expose local upstream API fields', () => {
  const defaults = agentEngineConfig.getDefaults();

  assert.equal(defaults.baseUrl, undefined);
  assert.equal(defaults.model, undefined);
  assert.equal(defaults.apiKey, undefined);
  assert.equal(defaults.official.baseUrl, undefined);
  assert.equal(defaults.official.model, undefined);
  assert.equal(defaults.official.apiKey, undefined);
});

test('billing is disabled for Chinese UI locales', () => {
  ['zh', 'zh_CN', 'zh-CN', 'zh_TW', 'zh-Hant', 'zh_HK'].forEach((locale) => {
    assert.equal(agentEngineConfig.isChineseLocale(locale), true);
    assert.equal(agentEngineConfig.shouldEnableBillingForLocale(locale), false);
  });
});

test('billing is enabled for non-Chinese UI locales', () => {
  ['en', 'en-US', 'fr', 'de_DE', 'ja', 'ko', 'pt-BR'].forEach((locale) => {
    assert.equal(agentEngineConfig.isChineseLocale(locale), false);
    assert.equal(agentEngineConfig.shouldEnableBillingForLocale(locale), true);
  });
});
