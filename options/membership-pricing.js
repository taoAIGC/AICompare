(function redirectToHostedPricingPage() {
  try {
    const params = new URLSearchParams(window.location.search);
    const planType = String(params.get('planType') || params.get('plan') || '').trim().toLowerCase() === 'api' ? 'api' : 'chat';
    const prefillEmail = String(params.get('prefillEmail') || params.get('email') || '').trim();
    const baseUrl = typeof window.FirebaseConfig?.getCloudFunctionsBaseUrl === 'function'
      ? window.FirebaseConfig.getCloudFunctionsBaseUrl().replace(/\/+$/, '')
      : 'https://aicompare.club';
    const url = new URL(`${baseUrl}/membership-pricing`);
    if (planType === 'api') {
      url.searchParams.set('planType', 'api');
    }
    if (prefillEmail) {
      url.searchParams.set('prefillEmail', prefillEmail);
    }
    window.location.replace(url.toString());
  } catch (_) {
    window.location.href = 'https://aicompare.club/membership-pricing';
  }
})();
