(function initializeAccountLoginVerifyPage() {
  const RuntimeI18n = window.RuntimeI18n || null;
  const DEFAULT_RETURN_TO = `${chrome.runtime.getURL('options/options.html')}#membership`;

  const backLink = document.getElementById('accountLoginVerifyBackLink');
  const codeInput = document.getElementById('accountLoginCodeInput');
  const verifyButton = document.getElementById('accountLoginVerifyBtn');
  const resendButton = document.getElementById('accountLoginResendBtn');
  const toast = document.getElementById('toast');

  let returnToUrl = DEFAULT_RETURN_TO;
  let currentEmail = '';
  let closeOnSuccess = false;

  function getMessage(key, substitutions = null, fallback = '') {
    return RuntimeI18n?.getMessage?.(key, substitutions)
      || chrome.i18n.getMessage(key, substitutions)
      || fallback;
  }

  function initializeI18n() {
    document.title = getMessage('membershipEmailVerifyTitle', null, document.title);

    document.querySelectorAll('[data-i18n]').forEach((element) => {
      const key = element.getAttribute('data-i18n');
      const message = getMessage(key);
      if (message) {
        element.textContent = message;
      }
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
      const key = element.getAttribute('data-i18n-placeholder');
      const message = getMessage(key);
      if (message) {
        element.placeholder = message;
      }
    });
  }

  function showToast(message, duration = 2600) {
    if (!toast || !message) return;
    toast.classList.remove('show');
    void toast.offsetWidth;
    toast.textContent = message;
    toast.classList.add('show');

    if (toast.timeoutId) {
      clearTimeout(toast.timeoutId);
    }
    toast.timeoutId = setTimeout(() => {
      toast.classList.remove('show');
    }, duration);
  }

  function getSafeReturnToUrl(candidate = '') {
    const raw = String(candidate || '').trim();
    if (!raw) {
      return DEFAULT_RETURN_TO;
    }

    try {
      const url = new URL(raw, DEFAULT_RETURN_TO);
      if (url.protocol !== 'chrome-extension:' || url.host !== chrome.runtime.id) {
        return DEFAULT_RETURN_TO;
      }
      return url.toString();
    } catch (_) {
      return DEFAULT_RETURN_TO;
    }
  }

  function isValidEmail(email = '') {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
  }

  function getRequestedParams() {
    try {
      const params = new URLSearchParams(window.location.search);
      return {
        email: String(params.get('email') || '').trim(),
        returnTo: getSafeReturnToUrl(params.get('returnTo') || ''),
        closeOnSuccess: params.get('closeOnSuccess') === '1'
      };
    } catch (_) {
      return {
        email: '',
        returnTo: DEFAULT_RETURN_TO,
        closeOnSuccess: false
      };
    }
  }

  function getEntryPageUrl() {
    const url = new URL(chrome.runtime.getURL('options/account-login.html'));
    url.searchParams.set('returnTo', returnToUrl);
    if (closeOnSuccess) {
      url.searchParams.set('closeOnSuccess', '1');
    }
    if (currentEmail && isValidEmail(currentEmail)) {
      url.searchParams.set('email', currentEmail);
    }
    return url.toString();
  }

  async function isEmailLinkSignInEnabled() {
    if (typeof window.firebaseGetEmailSignInStatus === 'function') {
      const status = await window.firebaseGetEmailSignInStatus().catch(() => ({ enabled: false }));
      return Boolean(status?.enabled);
    }
    return typeof window.firebaseIsEmailLinkSignInEnabled === 'function'
      ? Boolean(window.firebaseIsEmailLinkSignInEnabled())
      : false;
  }

  function redirectToReturnTo(useReplace = true) {
    if (useReplace) {
      window.location.replace(returnToUrl);
      return;
    }
    window.location.href = returnToUrl;
  }

  function finishSuccessfulLogin() {
    if (closeOnSuccess) {
      window.close();
      return;
    }
    redirectToReturnTo(true);
  }

  function getCodeValue() {
    const value = String(codeInput?.value || '').trim();
    if (!value) {
      throw new Error(getMessage('membershipEmailCodeInvalidFormat', null, 'Please enter the 6-digit verification code.'));
    }
    return value;
  }

  async function getStoredAuth() {
    const hydrated = typeof window.firebaseHydrateStoredProfile === 'function'
      ? await window.firebaseHydrateStoredProfile().catch(() => null)
      : null;
    if (hydrated?.uid) {
      return hydrated;
    }
    if (typeof window.firebaseGetStoredAuth === 'function') {
      return window.firebaseGetStoredAuth().catch(() => null);
    }
    return null;
  }

  async function runAuthAction(button, action, successMessage = '') {
    if (button) {
      button.disabled = true;
    }
    try {
      const result = await action();
      if (successMessage) {
        showToast(successMessage);
      }
      return result;
    } catch (error) {
      showToast(
        error?.message
          || getMessage('membershipEmailAuthFailed', null, 'Authentication failed. Please try again.'),
        4000
      );
      return null;
    } finally {
      if (button) {
        button.disabled = false;
      }
    }
  }

  async function resendEmailVerification() {
    const result = await runAuthAction(
      resendButton,
      async () => {
        if (typeof window.firebaseSendEmailSignInLink !== 'function') {
          throw new Error(getMessage('membershipEmailLoginUnavailable', null, 'Email verification sign-in is unavailable right now.'));
        }
        await window.firebaseSendEmailSignInLink(currentEmail);
        return true;
      },
      getMessage('membershipEmailLoginSuccess', null, 'Verification email sent. Please check your inbox.')
    );

    return Boolean(result);
  }

  async function completeEmailVerification() {
    const codeOrLink = getCodeValue();
    const result = await runAuthAction(
      verifyButton,
      async () => {
        if (typeof window.firebaseSignInWithEmailLink !== 'function') {
          throw new Error(getMessage('membershipEmailLoginUnavailable', null, 'Email verification sign-in is unavailable right now.'));
        }
        await window.firebaseSignInWithEmailLink(currentEmail, codeOrLink);
        return true;
      },
      getMessage('membershipEmailSignupSuccess', null, 'Signed in successfully.')
    );

    if (!result) {
      return;
    }

    finishSuccessfulLogin();
  }

  function bindEvents() {
    if (backLink) {
      backLink.href = getEntryPageUrl();
    }

    verifyButton?.addEventListener('click', () => {
      void completeEmailVerification();
    });

    resendButton?.addEventListener('click', () => {
      void resendEmailVerification();
    });

    codeInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void completeEmailVerification();
      }
    });

    window.addEventListener('runtime-language-changed', () => {
      initializeI18n();
      if (backLink) {
        backLink.href = getEntryPageUrl();
      }
    });
  }

  async function bootstrap() {
    const requested = getRequestedParams();
    currentEmail = requested.email;
    returnToUrl = requested.returnTo;
    closeOnSuccess = requested.closeOnSuccess === true;

    if (!await isEmailLinkSignInEnabled()) {
      window.location.replace(getEntryPageUrl());
      return;
    }

    if (!isValidEmail(currentEmail)) {
      window.location.replace(getEntryPageUrl());
      return;
    }

    if (typeof RuntimeI18n?.initializeRuntimeI18n === 'function') {
      await RuntimeI18n.initializeRuntimeI18n();
    }
    initializeI18n();
    bindEvents();

    const auth = await getStoredAuth();
    if (auth?.uid) {
      finishSuccessfulLogin();
      return;
    }

    codeInput?.focus();
  }

  void bootstrap();
})();
