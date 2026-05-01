const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildTimelineEntry,
  buildTimelineCopyText,
  mergeTimelinePromptSnapshots
} = require('../iframe/timeline-utils.js');

test('buildTimelineEntry tracks duplicate prompt occurrence in page order', () => {
  const first = buildTimelineEntry(
    {
      query: '  Hello   world  ',
      historyId: 'h1',
      timestamp: 1714461000000
    },
    []
  );
  const second = buildTimelineEntry(
    {
      query: 'Hello world',
      historyId: 'h2',
      timestamp: 1714461060000
    },
    [first]
  );
  const third = buildTimelineEntry(
    {
      query: 'Another prompt',
      historyId: 'h3',
      timestamp: 1714461120000
    },
    [first, second]
  );

  assert.equal(first.normalizedQuery, 'Hello world');
  assert.equal(first.occurrenceIndex, 0);
  assert.equal(second.occurrenceIndex, 1);
  assert.equal(third.occurrenceIndex, 0);
});

test('buildTimelineCopyText groups responses by site and preserves fallback text', () => {
  const text = buildTimelineCopyText(
    {
      query: 'Summarize this article',
      dateLabel: '2026-04-30 14:20'
    },
    [
      {
        siteName: 'ChatGPT',
        content: 'A concise answer'
      },
      {
        siteName: 'Gemini',
        content: '  '
      },
      {
        siteName: 'Claude',
        error: 'Prompt not found'
      }
    ]
  );

  assert.match(text, /问题：Summarize this article/);
  assert.match(text, /时间：2026-04-30 14:20/);
  assert.match(text, /【ChatGPT】\nA concise answer/);
  assert.match(text, /【Gemini】\n未提取到回答/);
  assert.match(text, /【Claude】\n提取失败：Prompt not found/);
});

test('mergeTimelinePromptSnapshots uses iframe prompts as source and deduplicates them', () => {
  const entries = mergeTimelinePromptSnapshots([
    {
      siteName: 'ChatGPT',
      prompts: [
        { text: ' 你好世界 ' },
        { text: '总结成三点' }
      ]
    },
    {
      siteName: 'Gemini',
      prompts: [
        { text: '你好世界' },
        { text: '总结成三点' },
        { text: '你好世界' }
      ]
    },
    {
      siteName: 'Claude',
      prompts: [
        { text: '你好世界' }
      ]
    }
  ]);

  assert.deepEqual(
    entries.map((item) => item.query),
    ['你好世界', '总结成三点']
  );
  assert.deepEqual(entries[0].sourceSites, ['ChatGPT', 'Gemini', 'Claude']);
  assert.deepEqual(entries[1].sourceSites, ['ChatGPT', 'Gemini']);
});
