const test = require('node:test');
const assert = require('node:assert/strict');

const agentPromptUtils = require('../shared/agent-prompt-utils.js');

test('buildMessageContent keeps plain text when there are no attachments', () => {
  const result = agentPromptUtils.buildMessageContent({
    content: 'hello world'
  });

  assert.equal(result, 'hello world');
});

test('buildMessageContent describes raw non-image attachments without embedding contents', () => {
  const result = agentPromptUtils.buildMessageContent({
    content: 'Please check the attachment.',
    attachments: [
      {
        id: 'a-1',
        name: 'notes.txt',
        type: 'text/plain',
        size: 24,
        mediaCategory: 'binary',
        textContent: 'alpha\nbeta\ngamma',
        extractedAsText: true
      }
    ]
  });

  assert.equal(typeof result, 'string');
  assert.match(result, /Please check the attachment\./);
  assert.match(result, /User attached the following files:/);
  assert.match(result, /Name: notes\.txt/);
  assert.match(result, /Raw file attached\./);
  assert.doesNotMatch(result, /alpha\nbeta\ngamma/);
});

test('buildMessageContent emits multimodal content for image attachments', () => {
  const result = agentPromptUtils.buildMessageContent({
    content: 'What is shown in the image?',
    attachments: [
      {
        id: 'img-1',
        name: 'diagram.png',
        type: 'image/png',
        size: 128,
        dataUrl: 'data:image/png;base64,AAA=',
        mediaCategory: 'image'
      }
    ]
  });

  assert.ok(Array.isArray(result));
  assert.equal(result[0].type, 'text');
  assert.match(result[0].text, /What is shown in the image\?/);
  assert.match(result[0].text, /Name: diagram\.png/);
  assert.match(result[0].text, /Raw image attached\./);
  assert.equal(result[1].type, 'image_url');
  assert.equal(result[1].image_url.url, 'data:image/png;base64,AAA=');
});

test('buildChatMessages preserves attachment-aware user turns', () => {
  const messages = agentPromptUtils.buildChatMessages(
    {
      personaPrompt: 'You are a skill.'
    },
    [
      {
        role: 'user',
        content: 'Read both files',
        attachments: [
          {
            id: 'f-1',
            name: 'a.txt',
            type: 'text/plain',
            size: 4,
            mediaCategory: 'binary'
          },
          {
            id: 'f-2',
            name: 'b.txt',
            type: 'text/plain',
            size: 4,
            mediaCategory: 'binary'
          }
        ]
      },
      {
        role: 'assistant',
        content: 'done'
      }
    ],
    {}
  );

  assert.equal(messages[0].role, 'system');
  assert.equal(messages[1].role, 'user');
  assert.match(messages[1].content, /Name: a\.txt/);
  assert.match(messages[1].content, /Name: b\.txt/);
  assert.doesNotMatch(messages[1].content, /\nA\n|\nB\n/);
  assert.equal(messages[2].role, 'assistant');
  assert.equal(messages[2].content, 'done');
});

test('buildAttachmentPayloadFromSource keeps metadata only for pptx files', async () => {
  const attachment = await agentPromptUtils.buildAttachmentPayloadFromSource({
    name: 'deck.pptx',
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    size: 4096,
    arrayBuffer: async () => new ArrayBuffer(8)
  });

  assert.equal(attachment.name, 'deck.pptx');
  assert.equal(attachment.type, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  assert.equal(attachment.size, 4096);
  assert.equal(attachment.mediaCategory, 'binary');
  assert.equal(attachment.textContent, '');
  assert.equal(attachment.textPreview, '');
  assert.equal(attachment.extractedAsText, false);
});

test('readSourceAsDataUrl converts binary sources without parsing semantic contents', async () => {
  const result = await agentPromptUtils.readSourceAsDataUrl({
    arrayBuffer: async () => Uint8Array.from([0x48, 0x69]).buffer
  }, 'image/png');

  assert.equal(result, 'data:image/png;base64,SGk=');
});

test('resolveAgentEngineSettings keeps custom api key when local secret uses legacy string format', () => {
  const result = agentPromptUtils.resolveAgentEngineSettings(
    {
      selectedSource: 'custom',
      customConfig: {
        baseUrl: 'http://localhost:8642/v1',
        model: 'hermes-agent',
        concurrency: 2
      }
    },
    'legacy-secret-key'
  );

  assert.equal(result.selectedSource, 'custom');
  assert.equal(result.customConfig.baseUrl, 'http://localhost:8642/v1');
  assert.equal(result.customConfig.model, 'hermes-agent');
  assert.equal(result.customConfig.apiKey, 'legacy-secret-key');
  assert.equal(result.effectiveConfig.apiKey, 'legacy-secret-key');
});
