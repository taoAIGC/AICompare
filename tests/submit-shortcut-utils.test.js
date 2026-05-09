const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeSendShortcutMode,
  shouldSubmitOnEnterKey
} = require('../shared/submit-shortcut-utils.js');

test('normalizeSendShortcutMode falls back to enter for unknown values', () => {
  assert.equal(normalizeSendShortcutMode('enter'), 'enter');
  assert.equal(normalizeSendShortcutMode('modifierEnter'), 'modifierEnter');
  assert.equal(normalizeSendShortcutMode('unexpected'), 'enter');
  assert.equal(normalizeSendShortcutMode(undefined), 'enter');
});

test('shouldSubmitOnEnterKey submits on plain Enter in enter mode', () => {
  assert.equal(
    shouldSubmitOnEnterKey(
      { key: 'Enter', shiftKey: false, ctrlKey: false, metaKey: false },
      { mode: 'enter', isMac: false }
    ),
    true
  );

  assert.equal(
    shouldSubmitOnEnterKey(
      { key: 'Enter', shiftKey: true, ctrlKey: false, metaKey: false },
      { mode: 'enter', isMac: false }
    ),
    false
  );
});

test('shouldSubmitOnEnterKey requires Ctrl+Enter in modifier mode on Windows/Linux', () => {
  assert.equal(
    shouldSubmitOnEnterKey(
      { key: 'Enter', shiftKey: false, ctrlKey: false, metaKey: false },
      { mode: 'modifierEnter', isMac: false }
    ),
    false
  );

  assert.equal(
    shouldSubmitOnEnterKey(
      { key: 'Enter', shiftKey: false, ctrlKey: true, metaKey: false },
      { mode: 'modifierEnter', isMac: false }
    ),
    true
  );
});

test('shouldSubmitOnEnterKey requires Command+Enter in modifier mode on macOS', () => {
  assert.equal(
    shouldSubmitOnEnterKey(
      { key: 'Enter', shiftKey: false, ctrlKey: true, metaKey: false },
      { mode: 'modifierEnter', isMac: true }
    ),
    false
  );

  assert.equal(
    shouldSubmitOnEnterKey(
      { key: 'Enter', shiftKey: false, ctrlKey: false, metaKey: true },
      { mode: 'modifierEnter', isMac: true }
    ),
    true
  );
});
