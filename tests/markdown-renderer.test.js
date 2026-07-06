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

test('renderMarkdownToHtml preserves multiple inline code spans in summary prose', () => {
  const html = renderMarkdownToHtml('在这类泛需求问答里，`Gemini`拿到最稳定的第一心智，`ChatGPT`、`Grok`、`Claude`各自占据细分优势。');

  assert.match(html, /<code>Gemini<\/code>/);
  assert.match(html, /<code>ChatGPT<\/code>/);
  assert.match(html, /<code>Grok<\/code>/);
  assert.match(html, /<code>Claude<\/code>/);
  assert.doesNotMatch(html, /AI_COMPARE_CODE|AICOMPARECODETOKEN/);
});

test('renderMarkdownToHtml preserves inline code nested inside bold text', () => {
  const html = renderMarkdownToHtml('**`Gemini`** and `ChatGPT`');

  assert.match(html, /<strong><code>Gemini<\/code><\/strong>/);
  assert.match(html, /<code>ChatGPT<\/code>/);
  assert.doesNotMatch(html, /AI_COMPARE_CODE|AICOMPARECODETOKEN/);
});
