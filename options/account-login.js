(function initializeAccountLoginPage() {
  const RuntimeI18n = window.RuntimeI18n || null;
  const DEFAULT_RETURN_TO = `${chrome.runtime.getURL('options/options.html')}#membership`;

  const backLink = document.getElementById('accountLoginBackLink');
  const googleButton = document.getElementById('accountLoginGoogleBtn');
  const authDivider = document.getElementById('accountLoginAuthDivider');
  const emailEntry = document.getElementById('accountLoginEmailEntry');
  const emailInput = document.getElementById('accountLoginEmailInput');
  const sendCodeButton = document.getElementById('accountLoginSendCodeBtn');
  const toast = document.getElementById('toast');

  let returnToUrl = DEFAULT_RETURN_TO;
  let closeOnSuccess = false;

  function getMessage(key, substitutions = null, fallback = '') {
    return RuntimeI18n?.getMessage?.(key, substitutions)
      || chrome.i18n.getMessage(key, substitutions)
      || fallback;
  }

  function initializeI18n() {
    document.title = getMessage('membershipAuthTitle', null, document.title);

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

  function getRequestedReturnToUrl() {
    try {
      const params = new URLSearchParams(window.location.search);
      return getSafeReturnToUrl(params.get('returnTo') || '');
    } catch (_) {
      return DEFAULT_RETURN_TO;
    }
  }

  function shouldCloseOnSuccess() {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get('closeOnSuccess') === '1';
    } catch (_) {
      return false;
    }
  }

  function isEmailLinkSignInEnabled() {
    return typeof window.firebaseIsEmailLinkSignInEnabled === 'function'
      ? Boolean(window.firebaseIsEmailLinkSignInEnabled())
      : false;
  }

  function syncEmailLoginAvailability() {
    const enabled = isEmailLinkSignInEnabled();
    if (authDivider) {
      authDivider.hidden = !enabled;
    }
    if (emailEntry) {
      emailEntry.hidden = !enabled;
    }
    return enabled;
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

  function getVerifyPageUrl(email) {
    const url = new URL(chrome.runtime.getURL('options/account-login-verify.html'));
    url.searchParams.set('email', email);
    url.searchParams.set('returnTo', returnToUrl);
    if (closeOnSuccess) {
      url.searchParams.set('closeOnSuccess', '1');
    }
    return url.toString();
  }

  function getPrefilledEmail() {
    try {
      return String(new URLSearchParams(window.location.search).get('email') || '').trim();
    } catch (_) {
      return '';
    }
  }

  function isValidEmail(email = '') {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
  }

  function getValidatedEmail() {
    const email = String(emailInput?.value || '').trim();
    if (!email) {
      throw new Error(getMessage('membershipEmailRequired', null, 'Please enter your email address.'));
    }
    if (!isValidEmail(email)) {
      emailInput?.focus();
      throw new Error(getMessage('firebaseAuthInvalidEmail', null, 'Please enter a valid email address.'));
    }
    return email;
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

  async function runAuthAction(button, action) {
    if (button) {
      button.disabled = true;
    }
    try {
      return await action();
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

  async function sendEmailVerification() {
    if (!isEmailLinkSignInEnabled()) {
      showToast(getMessage('membershipEmailLoginUnavailable', null, 'Email verification sign-in is unavailable right now.'), 4000);
      return;
    }
    const email = getValidatedEmail();
    const result = await runAuthAction(sendCodeButton, async () => {
      if (typeof window.firebaseSendEmailSignInLink !== 'function') {
        throw new Error(getMessage('membershipEmailLoginUnavailable', null, 'Email verification sign-in is unavailable right now.'));
      }
      await window.firebaseSendEmailSignInLink(email);
      return { email };
    });

    if (!result?.email) {
      return;
    }

    window.location.href = getVerifyPageUrl(result.email);
  }

  async function signInWithGoogle() {
    const result = await runAuthAction(googleButton, async () => {
      if (typeof window.firebaseSignInWithGoogle !== 'function') {
        throw new Error(getMessage('membershipGoogleLoginUnavailable', null, 'Google sign-in is unavailable right now.'));
      }
      await window.firebaseSignInWithGoogle();
      return true;
    });

    if (!result) {
      return;
    }

    finishSuccessfulLogin();
  }

  function bindEvents() {
    if (backLink) {
      backLink.href = returnToUrl;
    }

    googleButton?.addEventListener('click', () => {
      void signInWithGoogle();
    });

    sendCodeButton?.addEventListener('click', () => {
      void sendEmailVerification();
    });

    emailInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void sendEmailVerification();
      }
    });

    window.addEventListener('runtime-language-changed', () => {
      initializeI18n();
    });
  }

  async function bootstrap() {
    returnToUrl = getRequestedReturnToUrl();
    closeOnSuccess = shouldCloseOnSuccess();
    if (typeof RuntimeI18n?.initializeRuntimeI18n === 'function') {
      await RuntimeI18n.initializeRuntimeI18n();
    }
    initializeI18n();
    const emailLinkEnabled = syncEmailLoginAvailability();
    bindEvents();

    const prefilledEmail = getPrefilledEmail();
    if (prefilledEmail && emailInput) {
      emailInput.value = prefilledEmail;
    }

    const auth = await getStoredAuth();
    if (auth?.uid) {
      finishSuccessfulLogin();
      return;
    }

    if (emailLinkEnabled) {
      emailInput?.focus();
    } else {
      googleButton?.focus();
    }
  }

  void bootstrap();
})();
