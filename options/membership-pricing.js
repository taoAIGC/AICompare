const RuntimeI18n = window.RuntimeI18n || null;

function getPricingMessage(key, fallback = '', substitutions = null) {
  try {
    return RuntimeI18n?.getMessage?.(key, substitutions) || chrome.i18n.getMessage(key, substitutions) || fallback;
  } catch (_) {
    return fallback;
  }
}

function applyPricingI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((element) => {
    const key = element.getAttribute('data-i18n');
    const message = getPricingMessage(key, element.textContent || '');
    if (message) {
      element.textContent = message;
    }
  });

  root.querySelectorAll('[data-i18n-aria-label]').forEach((element) => {
    const key = element.getAttribute('data-i18n-aria-label');
    const message = getPricingMessage(key, element.getAttribute('aria-label') || '');
    if (message) {
      element.setAttribute('aria-label', message);
    }
  });
}

function showPricingToast(message, duration = 3000) {
  const toast = document.getElementById('toast');
  if (!toast) return;
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

async function ensurePricingCheckoutReady() {
  if (typeof window.firebaseGetIdToken === 'function') {
    const idToken = await window.firebaseGetIdToken();
    if (idToken) {
      return true;
    }
  }

  if (typeof window.firebaseSignInWithGoogle !== 'function') {
    throw new Error(getPricingMessage('membershipGoogleLoginUnavailable', 'Google sign-in is unavailable right now.'));
  }

  await window.firebaseSignInWithGoogle();
  if (typeof window.firebaseGetIdToken === 'function') {
    const idToken = await window.firebaseGetIdToken();
    if (idToken) {
      return true;
    }
  }
  throw new Error(getPricingMessage('membershipLoginHint', 'Please sign in with Google to view your membership status.'));
}

async function getPriceIdForPlan(planName) {
  const normalizedPlan = String(planName || '').trim();
  const prices = typeof window.getStripePrices === 'function'
    ? await window.getStripePrices()
    : {};
  return String(prices?.[normalizedPlan] || '').trim();
}

async function startPricingCheckout(planName, button) {
  if (button) {
    button.disabled = true;
    button.dataset.originalText = button.textContent || '';
    button.textContent = getPricingMessage('membershipLoading', 'Loading…');
  }

  try {
    const priceId = await getPriceIdForPlan(planName);
    if (!priceId || priceId.startsWith('price_REPLACE')) {
      showPricingToast(getPricingMessage('membershipPriceNotConfigured', 'Stripe Price ID not configured. Please set it first.'));
      return;
    }
    await ensurePricingCheckoutReady();
    if (typeof window.startCheckout !== 'function') {
      throw new Error(getPricingMessage('stripePaymentScriptNotLoaded', 'stripe-payment.js is not loaded.'));
    }
    await window.startCheckout(priceId);
  } catch (error) {
    showPricingToast(error?.message || getPricingMessage('stripeCheckoutOpenFailed', 'Failed to open the checkout page.'));
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = button.dataset.originalText || getPricingMessage(
        planName === 'yearly' ? 'btnUpgradeYearly' : 'btnUpgradeMonthly',
        planName === 'yearly' ? 'Subscribe Yearly' : 'Subscribe Monthly'
      );
      delete button.dataset.originalText;
    }
  }
}

async function initializePricingPage() {
  if (RuntimeI18n?.initializeRuntimeI18n) {
    await RuntimeI18n.initializeRuntimeI18n();
  }
  applyPricingI18n();

  const backLink = document.getElementById('pricingBackLink');
  if (backLink) {
    backLink.href = chrome.runtime.getURL('options/options.html#membership');
  }

  document.querySelectorAll('[data-plan]').forEach((button) => {
    if (button.dataset.bound === 'true') {
      return;
    }
    button.dataset.bound = 'true';
    button.addEventListener('click', () => {
      startPricingCheckout(button.dataset.plan, button);
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initializePricingPage().catch((error) => {
    console.error('Failed to initialize pricing page:', error);
    showPricingToast(error?.message || getPricingMessage('stripeCheckoutOpenFailed', 'Failed to open the checkout page.'));
  });
});
