const assert = require('node:assert/strict');
const test = require('node:test');

const insights = require('../shared/behavior-insights.js');

test('safeMetadata removes sensitive keys and keeps scalar safe metadata', () => {
  const safe = insights.safeMetadata({
    surface: 'homepage',
    trigger: 'button',
    apiKey: 'secret',
    promptText: 'do not upload',
    responseBody: 'do not upload',
    selected_sites_count: 3,
    side_panel: true,
    nested: { ignored: true }
  });

  assert.deepEqual(safe, {
    surface: 'homepage',
    trigger: 'button',
    selected_sites_count: 3,
    side_panel: true
  });
});

test('buildAnalyticsPayload infers kind and query fields', () => {
  const activation = insights.buildAnalyticsPayload({
    eventName: 'activation_first_query_submitted',
    source: 'homepage',
    queryLength: 12,
    metadata: { surface: 'homepage' }
  });
  const subscription = insights.buildAnalyticsPayload({
    eventName: 'upgrade_entry_clicked',
    source: 'homepage'
  });

  assert.equal(activation.kind, 'activation');
  assert.equal(activation.hasQuery, true);
  assert.equal(activation.queryLength, 12);
  assert.equal(subscription.kind, 'subscription');
});

test('buildSiteUsagePayload creates deterministic combination and workflow mode', () => {
  const payload = insights.buildSiteUsagePayload({
    officialSiteNames: ['Gemini', 'ChatGPT', 'gemini'],
    customSiteNames: ['Internal Search'],
    agentIds: ['writer'],
    source: 'iframe-query',
    resultState: 'submitted'
  });

  assert.deepEqual(payload.officialSiteNames, ['Gemini', 'ChatGPT']);
  assert.equal(payload.workflowMode, 'hybrid');
  assert.equal(payload.resultState, 'submitted');
  assert.equal(
    payload.siteCombinationKey,
    'agent:writer|site:chatgpt|site:gemini|site:internal search'
  );
});

test('inferUserMaturity classifies workflow and pro behavior', () => {
  assert.equal(insights.inferUserMaturity({ activationEvents: 1 }), 'activated');
  assert.equal(insights.inferUserMaturity({ siteEvents: 3 }), 'workflow');
  assert.equal(insights.inferUserMaturity({ featureEvents: 6, hasWorkflowFeature: true }), 'power');
  assert.equal(insights.inferUserMaturity({ subscriptionEvents: 1 }), 'pro');
});
