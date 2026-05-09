const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculateTextareaLayout
} = require('../shared/textarea-resize-utils.js');

test('calculateTextareaLayout keeps empty input compact and hidden overflow', () => {
  const layout = calculateTextareaLayout({
    hasValue: false,
    compactContentHeight: 36,
    expandedContentHeight: 36,
    minHeight: 36,
    defaultHeight: 36,
    maxHeight: 200
  });

  assert.deepEqual(layout, {
    height: 36,
    overflowY: 'hidden',
    avoidOverlap: false,
    compact: true,
    isScrollable: false
  });
});

test('calculateTextareaLayout expands wrapped content below max height', () => {
  const layout = calculateTextareaLayout({
    hasValue: true,
    compactContentHeight: 78,
    expandedContentHeight: 102,
    minHeight: 36,
    defaultHeight: 36,
    maxHeight: 200
  });

  assert.deepEqual(layout, {
    height: 102,
    overflowY: 'hidden',
    avoidOverlap: true,
    compact: false,
    isScrollable: false
  });
});

test('calculateTextareaLayout enables scrolling when content exceeds max height', () => {
  const layout = calculateTextareaLayout({
    hasValue: true,
    compactContentHeight: 260,
    expandedContentHeight: 348,
    minHeight: 36,
    defaultHeight: 36,
    maxHeight: 200
  });

  assert.deepEqual(layout, {
    height: 200,
    overflowY: 'auto',
    avoidOverlap: true,
    compact: false,
    isScrollable: true
  });
});

test('calculateTextareaLayout keeps single-line content compact', () => {
  const layout = calculateTextareaLayout({
    hasValue: true,
    compactContentHeight: 36,
    expandedContentHeight: 36,
    minHeight: 36,
    defaultHeight: 36,
    maxHeight: 200
  });

  assert.deepEqual(layout, {
    height: 36,
    overflowY: 'hidden',
    avoidOverlap: false,
    compact: true,
    isScrollable: false
  });
});
