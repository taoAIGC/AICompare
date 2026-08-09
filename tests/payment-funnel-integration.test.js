const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const backgroundSource = fs.readFileSync('background.js', 'utf8');
const iframeHtml = fs.readFileSync('iframe/iframe.html', 'utf8');
const iframeSource = fs.readFileSync('iframe/iframe.js', 'utf8');
const agentPanelHtml = fs.readFileSync('iframe/agent-panel.html', 'utf8');
const agentPanelSource = fs.readFileSync('iframe/agent-panel.js', 'utf8');
const serverSource = fs.readFileSync('backend/server.js', 'utf8');

test('extension surfaces load the shared payment funnel module', () => {
  assert.match(backgroundSource, /importScripts\([\s\S]*\.\/shared\/payment-funnel\.js/);
  assert.match(iframeHtml, /<script src="\.\.\/shared\/payment-funnel\.js"><\/script>/);
  assert.match(agentPanelHtml, /<script src="\.\.\/shared\/payment-funnel\.js"><\/script>/);
});

test('quota errors retain the localized backend message', () => {
  assert.match(iframeSource, /function trackOfficialApiQuotaReached[\s\S]{0,900}funnelId/);
  assert.match(iframeSource, /if \(normalizedError\) \{\s*return renderUserFacingErrorHtml\(normalizedError\);/);
  assert.match(agentPanelSource, /if \(message\.isError\) \{\s*return `<div class="agent-message-content">\$\{renderUserFacingErrorHtml\(content\)\}<\/div>`;/);
});

test('pricing selection carries funnel, selection, source, and client identity into checkout', () => {
  assert.match(serverSource, /const funnelId = PaymentFunnel\.normalizeFunnelId/);
  assert.match(serverSource, /PaymentFunnel\.normalizeFunnelId\(req\.query\?\.funnelId \|\| ''\)\s*\|\| PaymentFunnel\.createFunnelId/);
  assert.match(serverSource, /selectionEventId/);
  assert.match(serverSource, /X-AI-Compare-Client-Id/);
  assert.match(serverSource, /verifyPricingSelectionForCheckout/);
  assert.match(serverSource, /selectionVerified/);
});

test('business summaries apply checkout and invoice exclusion rules', () => {
  assert.match(serverSource, /PaymentFunnel\.getBusinessCheckoutExclusionReasons/);
  assert.match(serverSource, /PaymentFunnel\.getBusinessInvoiceExclusionReasons/);
  assert.match(serverSource, /excludedCheckoutStarted/);
  assert.match(serverSource, /excludedPaidOrders/);
});
