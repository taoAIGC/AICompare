/**
 * Chrome Extension API mocks for testing.
 * Sets up global mocks for chrome.* APIs used throughout the codebase.
 */

const chromeMock = {
  runtime: {
    getURL: jest.fn((path) => `chrome-extension://test-extension-id/${path}`),
    onInstalled: { addListener: jest.fn() },
    onMessage: { addListener: jest.fn() },
    sendMessage: jest.fn(),
    id: 'test-extension-id',
  },
  storage: {
    local: {
      get: jest.fn().mockResolvedValue({}),
      set: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
    },
    sync: {
      get: jest.fn().mockResolvedValue({}),
      set: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
    },
  },
  tabs: {
    query: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue({}),
    sendMessage: jest.fn().mockResolvedValue(undefined),
  },
  contextMenus: {
    create: jest.fn(),
    removeAll: jest.fn(),
    onClicked: { addListener: jest.fn() },
  },
  action: {
    onClicked: { addListener: jest.fn() },
  },
  sidePanel: {
    open: jest.fn().mockResolvedValue(undefined),
    setOptions: jest.fn().mockResolvedValue(undefined),
  },
  scripting: {
    executeScript: jest.fn().mockResolvedValue([]),
  },
  omnibox: {
    onInputEntered: { addListener: jest.fn() },
    onInputChanged: { addListener: jest.fn() },
  },
  declarativeNetRequest: {
    updateDynamicRules: jest.fn().mockResolvedValue(undefined),
  },
};

global.chrome = chromeMock;

module.exports = { chromeMock };
