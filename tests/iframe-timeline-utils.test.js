const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildTimelineEntry,
  buildTimelineCopyText,
  extractTimelinePromptsFromMessages,
  mergeTimelinePromptSnapshots,
  normalizeTimelineQuery
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

test('mergeTimelinePromptSnapshots preserves previous prompt order when one snapshot temporarily misses a middle prompt', () => {
  const previousEntries = [
    buildTimelineEntry({ query: 'FDE 转型', occurrenceIndex: 0 }, []),
    buildTimelineEntry({ query: 'FDE 工程师是什么', occurrenceIndex: 0 }, []),
    buildTimelineEntry({ query: 'FDE 工资怎么样', occurrenceIndex: 0 }, [])
  ];

  const entries = mergeTimelinePromptSnapshots(
    [
      {
        siteName: 'ChatGPT',
        prompts: [
          { text: 'FDE 转型' },
          { text: 'FDE 工资怎么样' }
        ]
      },
      {
        siteName: 'Gemini',
        prompts: [
          { text: 'FDE 转型' },
          { text: 'FDE 工程师是什么' },
          { text: 'FDE 工资怎么样' }
        ]
      }
    ],
    previousEntries
  );

  assert.deepEqual(
    entries.map((item) => item.query),
    ['FDE 转型', 'FDE 工程师是什么', 'FDE 工资怎么样']
  );
  assert.deepEqual(entries[1].sourceSites, ['Gemini']);
});

test('extractTimelinePromptsFromMessages keeps agent user turns in order', () => {
  const prompts = extractTimelinePromptsFromMessages([
    { role: 'assistant', content: '先给一个结论' },
    { role: 'user', content: '  第一轮问题  ' },
    { role: 'assistant', content: '第一轮回答' },
    { role: 'user', content: '第二轮   跟进' },
    { role: 'user', content: '   ' }
  ]);

  assert.deepEqual(prompts, [
    { text: '第一轮问题' },
    { text: '第二轮 跟进' }
  ]);
});

test('normalizeTimelineQuery strips wrapper quotes added around long prompts', () => {
  const basePrompt = '招聘这样的岗位，怎么考察面试者「非传统产品经理实习生，也非传统技术实习生【岗位职责】负责办公提效工具的build 工作。需要自己通过AI 完成需求设计、用户调研、vibecoding代码实现。独自完成 需求分析、需求设计、产品开发、部署上线、收集用户反馈的全过程。【能力要求】1、要求善于沟通、可以与业务方顺畅的沟通需求，介绍自己开发的产品。2、熟练掌握 vibe coding。3、可以在产品经理、开发工程师两种思维 间自由换转。」';
  const wrappedPrompt = `「${basePrompt}\n\n」`;

  assert.equal(normalizeTimelineQuery(basePrompt), normalizeTimelineQuery(wrappedPrompt));
});

test('mergeTimelinePromptSnapshots keeps existing canonical query text for the same entry key', () => {
  const basePrompt = '招聘这样的岗位，怎么考察面试者「非传统产品经理实习生，也非传统技术实习生【岗位职责】负责办公提效工具的build 工作。需要自己通过AI 完成需求设计、用户调研、vibecoding代码实现。独自完成 需求分析、需求设计、产品开发、部署上线、收集用户反馈的全过程。【能力要求】1、要求善于沟通、可以与业务方顺畅的沟通需求，介绍自己开发的产品。2、熟练掌握 vibe coding。3、可以在产品经理、开发工程师两种思维 间自由换转。」';
  const wrappedPrompt = `「${basePrompt}\n\n」`;
  const previousEntries = [
    buildTimelineEntry({ query: basePrompt, occurrenceIndex: 0 }, [])
  ];

  const entries = mergeTimelinePromptSnapshots(
    [
      {
        siteName: 'ChatGPT',
        prompts: [{ text: wrappedPrompt }]
      },
      {
        siteName: 'Claude',
        prompts: [{ text: basePrompt }]
      }
    ],
    previousEntries
  );

  assert.equal(entries.length, 1);
  assert.equal(entries[0].query, normalizeTimelineQuery(basePrompt));
  assert.deepEqual(entries[0].sourceSites, ['ChatGPT', 'Claude']);
});
