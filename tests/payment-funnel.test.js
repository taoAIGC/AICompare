const assert = require('node:assert/strict');
const test = require('node:test');

let paymentFunnel = {};
try {
  paymentFunnel = require('../shared/payment-funnel.js');
} catch (_) {
  // The first TDD run intentionally exercises the missing implementation.
}

test('normalizeFunnelId accepts opaque funnel ids and rejects unsafe values', () => {
  assert.equal(
    paymentFunnel.normalizeFunnelId('funnel_20260731_abCD-1234'),
    'funnel_20260731_abCD-1234'
  );
  assert.equal(paymentFunnel.normalizeFunnelId('contains spaces'), '');
  assert.equal(paymentFunnel.normalizeFunnelId('x'.repeat(121)), '');
});

test('buildApiPlanUpgradeUrl carries one funnel id and the quota source', () => {
  assert.equal(
    paymentFunnel.buildApiPlanUpgradeUrl(
      'https://aicompare.club',
      'funnel_20260731_abCD-1234',
      'official_api_quota_error'
    ),
    'https://aicompare.club/membership-pricing?planType=api&source=official_api_quota_error&funnelId=funnel_20260731_abCD-1234'
  );
});

test('business invoices exclude test identities, unpaid rows, and zero amounts', () => {
  assert.deepEqual(
    paymentFunnel.getBusinessInvoiceExclusionReasons({
      invoice: { paid: true, amount_paid: 0, metadata: {} },
      identity: { email: 'buyer@example.com', uid: 'user-1' }
    }),
    ['test_identity', 'zero_amount']
  );
  assert.deepEqual(
    paymentFunnel.getBusinessInvoiceExclusionReasons({
      invoice: { paid: false, amount_paid: 3900, metadata: {} },
      identity: { email: 'real@company.com', uid: 'user-2' }
    }),
    ['unpaid']
  );
  assert.deepEqual(
    paymentFunnel.getBusinessInvoiceExclusionReasons({
      invoice: { paid: true, amount_paid: 3900, metadata: {} },
      identity: { email: 'real@company.com', uid: 'user-2' }
    }),
    []
  );
});

test('business checkout requires plan, identity, funnel, and verified selection', () => {
  assert.deepEqual(
    paymentFunnel.getBusinessCheckoutExclusionReasons({
      eventName: 'chat_checkout_started',
      uid: '',
      clientHash: '',
      metadata: { planType: 'chat' }
    }),
    ['missing_identity', 'missing_funnel', 'missing_selection', 'unverified_selection']
  );
  assert.deepEqual(
    paymentFunnel.getBusinessCheckoutExclusionReasons({
      eventName: 'api_checkout_started',
      uid: 'user-3',
      clientHash: '',
      metadata: {
        planType: 'api',
        funnelId: 'funnel_20260731_abCD-1234',
        selectionEventId: 'selection_123',
        selectionVerified: true
      }
    }),
    []
  );
});
