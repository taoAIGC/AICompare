const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildRemoteSearchQrImageSource,
  shouldEnableRemoteSearchGenerateButton
} = require('../options/options.js');

test('remote search generate button stays enabled when the draft checkbox is checked', () => {
  assert.equal(
    shouldEnableRemoteSearchGenerateButton(
      { settings: { enabled: false } },
      { enabled: true }
    ),
    true
  );
});

test('remote search generate button remains disabled when both saved and draft states are off', () => {
  assert.equal(
    shouldEnableRemoteSearchGenerateButton(
      { settings: { enabled: false } },
      { enabled: false }
    ),
    false
  );
});

test('remote search QR preview uses a data URL svg source', () => {
  const source = buildRemoteSearchQrImageSource('<svg><text>ok</text></svg>');

  assert.ok(source.startsWith('data:image/svg+xml;charset=utf-8,'));
  assert.ok(source.includes('%3Csvg%3E'));
  assert.ok(source.includes('%3Ctext%3Eok%3C%2Ftext%3E'));
});
