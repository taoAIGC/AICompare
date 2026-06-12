const test = require('node:test');
const assert = require('node:assert/strict');

const {
  renderMarkdownToHtml
} = require('../shared/markdown-renderer.js');

test('renderMarkdownToHtml skips empty markdown table body rows', () => {
  const html = renderMarkdownToHtml([
    '| Site | Summary |',
    '| --- | --- |',
    '| ChatGPT | Stable |',
    '|  |  |',
    '| Gemini | Ready |'
  ].join('\n'));

  assert.match(html, /<table>/);
  assert.equal((html.match(/<tr>/g) || []).length, 3);
  assert.doesNotMatch(html, /<td><\/td><td><\/td>/);
});

test('renderMarkdownToHtml omits fully empty markdown tables', () => {
  const html = renderMarkdownToHtml([
    '|  |  |',
    '| --- | --- |',
    '|  |  |'
  ].join('\n'));

  assert.equal(html, '');
});
