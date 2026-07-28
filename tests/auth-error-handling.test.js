const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

test('unknown authentication errors use the localized generic message', async () => {
  const context = {
    console,
    URL,
    URLSearchParams,
    window: {
      RuntimeI18n: {
        getMessage(key) {
          return key === 'membershipEmailAuthFailed' ? 'Friendly authentication failure' : '';
        }
      }
    },
    chrome: { i18n: { getMessage() { return ''; } } }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('firebase/firebase-auth.js', 'utf8'), context);

  const message = await vm.runInContext(
    `normalizeFirebaseAuthError(new Error('Unexpected authentication response'), 'Authentication failed').then(error => error.message)`,
    context
  );

  assert.equal(message, 'Friendly authentication failure');
});

test('backend authentication requests time out with the localized network message', async () => {
  class AbortControllerMock {
    constructor() {
      this.signal = { listeners: [] };
      this.signal.addEventListener = (_type, listener) => this.signal.listeners.push(listener);
    }
    abort() {
      for (const listener of this.signal.listeners) listener();
    }
  }
  const context = {
    console,
    URL,
    URLSearchParams,
    AbortController: AbortControllerMock,
    clearTimeout() {},
    setTimeout(callback) { queueMicrotask(callback); return 1; },
    fetch(_url, options) {
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new TypeError('Failed to fetch')));
      });
    },
    window: {
      FirebaseConfig: { cloudFunctionsBaseUrl: 'https://example.test' },
      RuntimeI18n: {
        getMessage(key) {
          return key === 'aiErrorNetworkFailed' ? 'Network connection failed' : '';
        }
      }
    },
    chrome: { i18n: { getMessage() { return ''; } } }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('firebase/firebase-auth.js', 'utf8'), context);

  const message = await vm.runInContext(
    `fetchFirebaseAuthBackendJson('/auth/test').catch(error => error.message)`,
    context
  );

  assert.equal(message, 'Network connection failed');
});

test('Google OAuth timeout uses the localized network message', async () => {
  let configuredTimeoutMs = 0;
  const context = {
    console,
    URL,
    URLSearchParams,
    clearTimeout() {},
    setTimeout(callback, timeoutMs) { configuredTimeoutMs = timeoutMs; queueMicrotask(callback); return 1; },
    window: {
      FirebaseConfig: { apiKey: 'key', googleClientId: 'client-id' },
      RuntimeI18n: {
        getMessage(key) {
          return key === 'aiErrorNetworkFailed' ? 'Network connection failed' : '';
        }
      }
    },
    chrome: {
      runtime: { id: 'test-extension', lastError: null },
      identity: { launchWebAuthFlow() {} },
      i18n: { getMessage() { return ''; } }
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('firebase/firebase-auth.js', 'utf8'), context);

  const message = await vm.runInContext(
    `firebaseSignInWithGoogle().catch(error => error.message)`,
    context
  );

  assert.equal(message, 'Network connection failed');
  assert.equal(configuredTimeoutMs, 8000);
});

test('Google Firebase exchange network errors use the localized network message', async () => {
  const context = {
    console,
    URL,
    URLSearchParams,
    AbortController,
    clearTimeout,
    setTimeout,
    fetch: async () => { throw new TypeError('Failed to fetch'); },
    window: {
      FirebaseConfig: { apiKey: 'key', googleClientId: 'client-id' },
      RuntimeI18n: {
        getMessage(key) {
          return key === 'aiErrorNetworkFailed' ? 'Network connection failed' : '';
        }
      }
    },
    chrome: {
      runtime: { id: 'test-extension', lastError: null },
      identity: {
        launchWebAuthFlow(_options, callback) {
          callback('https://test-extension.chromiumapp.org/#access_token=token');
        }
      },
      i18n: { getMessage() { return ''; } }
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('firebase/firebase-auth.js', 'utf8'), context);

  const message = await vm.runInContext(
    `firebaseSignInWithGoogle().catch(error => error.message)`,
    context
  );

  assert.equal(message, 'Network connection failed');
});

test('empty verification code is shown in the page toast', async () => {
  class Element {
    constructor() {
      this.value = '';
      this.listeners = {};
      this.classList = { add() {}, remove() {} };
    }
    addEventListener(type, listener) {
      (this.listeners[type] ||= []).push(listener);
    }
    click() {
      for (const listener of this.listeners.click || []) listener({ preventDefault() {} });
    }
    getAttribute() { return ''; }
    focus() {}
  }

  const ids = Object.fromEntries([
    'accountLoginVerifyBackLink',
    'accountLoginCodeInput',
    'accountLoginVerifyBtn',
    'accountLoginResendBtn',
    'toast'
  ].map((id) => [id, new Element()]));
  const context = {
    console,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    document: {
      title: '',
      getElementById(id) { return ids[id]; },
      querySelectorAll() { return []; }
    },
    chrome: {
      runtime: { id: 'test', getURL(path) { return `chrome-extension://test/${path}`; } },
      i18n: { getMessage(key) { return key === 'membershipEmailCodeInvalidFormat' ? 'Enter six digits' : ''; } }
    },
    window: {
      location: { search: '?email=test%40qq.com', replace() {} },
      firebaseGetEmailSignInStatus: async () => ({ enabled: true }),
      addEventListener() {},
      close() {}
    }
  };
  context.window.window = context.window;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('options/account-login-verify.js', 'utf8'), context);

  await new Promise((resolve) => setImmediate(resolve));
  ids.accountLoginVerifyBtn.click();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(ids.toast.textContent, 'Enter six digits');
});

test('Google login button exposes and clears its busy state', async () => {
  class Element {
    constructor() {
      this.listeners = {};
      this.attributes = {};
      this.classList = { add() {}, remove() {} };
      this.disabled = false;
      this.hidden = false;
    }
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
    click() { for (const listener of this.listeners.click || []) listener({ preventDefault() {} }); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    removeAttribute(name) { delete this.attributes[name]; }
    getAttribute(name) { return this.attributes[name] || ''; }
    focus() {}
  }
  const ids = Object.fromEntries([
    'accountLoginBackLink', 'accountLoginGoogleBtn', 'accountLoginAuthDivider',
    'accountLoginEmailEntry', 'accountLoginEmailInput', 'accountLoginSendCodeBtn', 'toast'
  ].map((id) => [id, new Element()]));
  let finishGoogle;
  const googlePromise = new Promise((resolve) => { finishGoogle = resolve; });
  const context = {
    console,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    document: {
      title: '',
      getElementById(id) { return ids[id]; },
      querySelectorAll() { return []; }
    },
    chrome: {
      runtime: { id: 'test', getURL(path) { return `chrome-extension://test/${path}`; } },
      i18n: { getMessage() { return ''; } }
    },
    window: {
      location: { search: '', replace() {} },
      firebaseGetEmailSignInStatus: async () => ({ enabled: true }),
      firebaseSignInWithGoogle: () => googlePromise,
      addEventListener() {},
      close() {}
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('options/account-login.js', 'utf8'), context);

  ids.accountLoginGoogleBtn.click();
  assert.equal(ids.accountLoginGoogleBtn.attributes['aria-busy'], 'true');
  finishGoogle();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ids.accountLoginGoogleBtn.attributes['aria-busy'], undefined);
});

test('expired Firebase sessions refresh through the backend instead of Google', async () => {
  const requests = [];
  const stored = {
    firebase_uid: 'user-1',
    firebase_email: 'user@example.com',
    firebase_idToken: 'expired-token',
    firebase_refreshToken: 'refresh-token',
    firebase_expiresAt: 0
  };
  const context = {
    console,
    URL,
    URLSearchParams,
    AbortController,
    setTimeout,
    clearTimeout,
    fetch: async (url) => {
      requests.push(String(url));
      return {
        ok: true,
        async text() {
          return JSON.stringify({ idToken: 'fresh-token', refreshToken: 'fresh-refresh', expiresIn: '3600' });
        }
      };
    },
    window: { FirebaseConfig: { apiKey: 'key', cloudFunctionsBaseUrl: 'https://aicompare.example' } },
    chrome: {
      storage: {
        local: {
          async get(keys) {
            if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, stored[key]]));
            return { [keys]: stored[keys] };
          },
          async set(values) { Object.assign(stored, values); }
        }
      },
      i18n: { getMessage() { return ''; } }
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('firebase/firebase-auth.js', 'utf8'), context);

  const token = await vm.runInContext('getIdToken()', context);

  assert.equal(token, 'fresh-token');
  assert.deepEqual(requests, ['https://aicompare.example/auth/firebase-token/refresh']);
});
