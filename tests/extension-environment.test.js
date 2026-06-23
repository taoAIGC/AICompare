const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');
const baseConfigPath = path.join(repoRoot, 'config', 'baseConfig.js');
const baseConfigSource = fs.readFileSync(baseConfigPath, 'utf8');

function plainObject(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadExtensionEnvironment(extensionId, messages = {}) {
  const self = {};
  const sandbox = {
    self,
    chrome: {
      runtime: {
        id: extensionId,
        getURL: (assetPath) => `chrome-extension://${extensionId}/${assetPath}`
      },
      i18n: {
        getMessage: (key) => messages[key] || ''
      },
      storage: {
        local: {
          get: async () => ({}),
          set: async () => undefined
        },
        sync: {
          get: async () => ({}),
          set: async () => undefined
        }
      }
    },
    console: {
      log() {},
      warn() {},
      error() {},
      info() {},
      debug() {}
    },
    fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }),
    navigator: { language: 'zh-CN' },
    URL,
    setTimeout,
    clearTimeout
  };
  sandbox.globalThis = sandbox;

  vm.runInNewContext(baseConfigSource, sandbox, { filename: baseConfigPath });
  return self.ExtensionEnvironment;
}

test('extension environment treats the Chrome Web Store id as production branding', () => {
  const environment = loadExtensionEnvironment(
    'dkhpgbbhlnmjbkihoeniojpkggkabbbl',
    { appName: 'AI Compare Production' }
  );

  assert.equal(environment.isDevelopmentExtension(), false);
  assert.equal(environment.getBrandName(), 'AI Compare Production');
  assert.deepEqual(plainObject(environment.getActionIconPaths()), {
    16: 'icons/icon16.png',
    48: 'icons/icon48.png',
    128: 'icons/icon128.png'
  });
});

test('extension environment uses dev branding for non-store extension ids', () => {
  const environment = loadExtensionEnvironment(
    'hhkhgpadepocnmjfpohcmjdcgkmfnadi',
    { devAppName: 'AI 比一比测试版', appName: 'AI 比一比' }
  );

  assert.equal(environment.isDevelopmentExtension(), true);
  assert.equal(environment.getBrandName(), 'AI 比一比测试版');
  assert.equal(environment.getBrandIconAssetPath(48), 'icons/dev-icon48.png');
  assert.deepEqual(plainObject(environment.getActionIconPaths()), {
    16: 'icons/dev-icon16.png',
    32: 'icons/dev-icon32.png',
    48: 'icons/dev-icon48.png',
    128: 'icons/dev-icon128.png'
  });
});
