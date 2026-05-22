const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createBaseNode(ownerDocument, text = '') {
  return {
    ownerDocument,
    textContent: text,
    innerText: text,
    innerHTML: '',
    dataset: {},
    childElementCount: 0,
    classList: {
      contains() {
        return false;
      }
    },
    getAttribute() {
      return null;
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    matches() {
      return false;
    },
    contains(other) {
      return this === other;
    },
    closest() {
      return null;
    },
    compareDocumentPosition(other) {
      const selfOrder = Number.isFinite(this.__order) ? this.__order : 0;
      const otherOrder = Number.isFinite(other?.__order) ? other.__order : 0;
      if (selfOrder < otherOrder) {
        return 4;
      }
      if (selfOrder > otherOrder) {
        return 2;
      }
      return 0;
    },
    getBoundingClientRect() {
      return { width: 120, height: 24, top: 420 };
    },
    cloneNode() {
      return {
        innerHTML: '',
        querySelectorAll() {
          return [];
        }
      };
    }
  };
}

function createElement(ownerDocument, text = '', selectorMap = {}) {
  const node = createBaseNode(ownerDocument, text);
  node.tagName = 'DIV';
  node.querySelectorAll = (selector) => selectorMap[selector] || [];
  node.querySelector = (selector) => {
    const matches = selectorMap[selector] || [];
    return matches[0] || null;
  };
  return node;
}

function createDocument(selectorMap = new Map()) {
  const doc = {
    body: {
      textContent: '',
      innerText: ''
    },
    location: {
      href: 'https://example.com/chat/123'
    },
    querySelectorAll(selector) {
      return selectorMap.get(selector) || [];
    },
    querySelector(selector) {
      const matches = selectorMap.get(selector) || [];
      return matches[0] || null;
    },
    createElement() {
      return {
        innerHTML: '',
        textContent: '',
        innerText: '',
        querySelectorAll() {
          return [];
        }
      };
    },
    createTreeWalker(root) {
      const textNodes = Array.isArray(root.__textNodes) ? root.__textNodes : [];
      let index = 0;
      return {
        nextNode() {
          return textNodes[index++] || null;
        }
      };
    }
  };

  return doc;
}

function loadExtractionCore(document) {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'shared', 'extraction-core.js'),
    'utf8'
  );
  const context = {
    console,
    setTimeout,
    clearTimeout,
    URL,
    NodeFilter: {
      SHOW_TEXT: 4
    },
    Node: {
      DOCUMENT_POSITION_FOLLOWING: 4
    },
    document
  };
  context.window = {
    document,
    location: document.location
  };
  context.window.window = context.window;
  context.window.parent = context.window;
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.window.AICompareExtraction;
}

test('extractDocumentContent falls back when latestVisibleResponse is pending and empty', async () => {
  const selectorMap = new Map();
  const doc = createDocument(selectorMap);
  const assistantMessage = createElement(doc, '');
  assistantMessage.__textNodes = [];
  const contentNode = createElement(doc, 'Real answer from container');
  const messageContainer = createElement(doc, '', {
    '.content': [contentNode]
  });

  selectorMap.set('.assistant', [assistantMessage]);
  selectorMap.set('.message', [messageContainer]);

  const extraction = loadExtractionCore(doc);
  const result = await extraction.extractDocumentContent(
    doc,
    'ChatGPT',
    {
      contentExtractor: {
        latestVisibleResponse: {
          messageSelector: '.assistant'
        },
        messageContainer: '.message',
        contentSelectors: ['.content']
      }
    },
    {
      includePageTextFallback: false,
      waitTimeoutMs: 0
    }
  );

  assert.equal(result.content, 'Real answer from container');
  assert.equal(result.extractionMethod, 'messageContainer');
});

test('extractDocumentContent ignores shell-like latestVisibleResponse content and keeps searching', async () => {
  const selectorMap = new Map();
  const doc = createDocument(selectorMap);
  const assistantParent = createElement(doc, '');
  const assistantMessage = createElement(doc, '');
  assistantMessage.__textNodes = [
    {
      textContent: 'window.__reactRouterRouteModules',
      parentElement: assistantParent
    }
  ];
  const contentNode = createElement(doc, 'Answer recovered from message container');
  const messageContainer = createElement(doc, '', {
    '.content': [contentNode]
  });

  selectorMap.set('.assistant', [assistantMessage]);
  selectorMap.set('.message', [messageContainer]);

  const extraction = loadExtractionCore(doc);
  const result = await extraction.extractDocumentContent(
    doc,
    'ChatGPT',
    {
      contentExtractor: {
        latestVisibleResponse: {
          messageSelector: '.assistant',
          shellPatterns: ['window\\.__reactRouterRouteModules']
        },
        messageContainer: '.message',
        contentSelectors: ['.content']
      }
    },
    {
      includePageTextFallback: false,
      waitTimeoutMs: 0
    }
  );

  assert.equal(result.content, 'Answer recovered from message container');
  assert.equal(result.extractionMethod, 'messageContainer');
});

test('extractMessagesWithContainer skips shell-like container fallback content', async () => {
  const selectorMap = new Map();
  const doc = createDocument(selectorMap);
  const shellContainer = createElement(
    doc,
    '展开菜单\n设置和帮助\nUntitled notebook\n使用麦克风'
  );
  const realContainer = createElement(
    doc,
    'A real answer\nwith details'
  );

  selectorMap.set('.message', [shellContainer, realContainer]);

  const extraction = loadExtractionCore(doc);
  const result = await extraction.extractMessagesWithContainer(
    doc,
    {
      openclawRuntime: {
        pendingShell: {
          signals: ['展开菜单', '设置和帮助', 'Untitled notebook', '使用麦克风'],
          minMatches: 3,
          fallbackMinMatches: 2,
          likelyTitleListMinLines: 4,
          likelyTitleListMaxLineLength: 24
        }
      },
      contentExtractor: {
        messageContainer: '.message',
        contentSelectors: ['.content']
      }
    },
    'Gemini',
    {
      waitTimeoutMs: 0
    }
  );

  assert.equal(result.content, 'A real answer\nwith details');
  assert.equal(result.messageCount, 1);
});

test('extractElementContent preserves bullet prefixes for list items', async () => {
  const doc = createDocument();
  const listItem = createElement(doc, '写内容');
  listItem.tagName = 'LI';
  listItem.parentElement = {
    tagName: 'UL',
    children: [listItem]
  };

  const extraction = loadExtractionCore(doc);
  const result = await extraction.extractElementContent(listItem);

  assert.equal(result, '• 写内容');
});

test('resolveDocumentUrl keeps alternate link when history feature differs only by trailing slash', () => {
  const alternateLink = {
    getAttribute(name) {
      if (name === 'href') {
        return 'https://example.com/chat/123';
      }
      return null;
    }
  };

  const selectorMap = new Map();
  selectorMap.set('a[data-ignore]', []);
  const doc = createDocument(selectorMap);
  doc.location.href = 'https://example.com/chat';
  doc.querySelectorAll = (selector) => {
    if (selector === 'link[rel="alternate"]') return [];
    if (selector === 'a[data-history-link]') return [alternateLink];
    return selectorMap.get(selector) || [];
  };

  const extraction = loadExtractionCore(doc);
  const resolved = extraction.resolveDocumentUrl(
    doc,
    'https://example.com/chat',
    {
      historyHandler: {
        urlFeature: '/chat/'
      },
      contentExtractor: {
        urlExtractor: {
          alternateLinkSelector: 'a[data-history-link]'
        }
      }
    }
  );

  assert.equal(resolved, 'https://example.com/chat/123');
});

test('extractPromptResponseForTimeline falls back to latest visible response for last prompt when scoped answers are empty', async () => {
  const selectorMap = new Map();
  const doc = createDocument(selectorMap);

  const userText = createElement(doc, '测试问题');
  const userMessage = createElement(doc, '', {
    '.user-text': [userText]
  });
  userMessage.__order = 1;
  userMessage.closest = (selector) => {
    if (selector === '.user-message') return userMessage;
    return null;
  };

  const emptyAnswerNode = createElement(doc, '');
  emptyAnswerNode.__order = 2;
  const latestVisibleParent = createElement(doc, '');
  const latestVisibleMessage = createElement(doc, '');
  latestVisibleMessage.__textNodes = [
    {
      textContent: 'DeepSeek 的最新回答',
      parentElement: latestVisibleParent
    }
  ];

  selectorMap.set('.user-message', [userMessage]);
  selectorMap.set('.answer', [emptyAnswerNode]);
  selectorMap.set('.assistant-latest', [latestVisibleMessage]);

  const extraction = loadExtractionCore(doc);
  const result = await extraction.extractPromptResponseForTimeline(
    doc,
    {
      userPrompt: {
        containerSelector: '.user-message',
        textSelector: '.user-text'
      },
      contentExtractor: {
        selectors: ['.answer'],
        latestVisibleResponse: {
          messageSelector: '.assistant-latest'
        }
      }
    },
    '测试问题',
    0
  );

  assert.equal(result.found, true);
  assert.equal(result.content, 'DeepSeek 的最新回答');
  assert.equal(JSON.stringify(result.answers), JSON.stringify(['DeepSeek 的最新回答']));
  assert.equal(result.fallbackUsed, 'latestVisibleResponse');
});
