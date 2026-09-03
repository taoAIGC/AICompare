const test = require('node:test');
const assert = require('node:assert/strict');
const { getBeijingDate, parseUsageRows, summarizeUsageByEndpoint, summarizeActivationQuota } = require('../ark-usage.js');

test('formats the provider query date in Beijing time', () => {
  assert.equal(getBeijingDate(new Date('2026-08-27T16:30:00.000Z')), '2026-08-28');
});

test('parses GetInferenceUsage tabular responses', () => {
  const result = {
    Fields: [{ Name: 'ModelEndpoint' }, { Name: 'InputTokens' }, { Name: 'OutputTokens' }],
    Data: [['ep-a', '12', '8'], ['ep-a', '3', '7'], ['ep-b', '5', '6']]
  };
  assert.deepEqual(parseUsageRows(result)[0], { ModelEndpoint: 'ep-a', InputTokens: '12', OutputTokens: '8' });
  assert.deepEqual(summarizeUsageByEndpoint(result), {
    'ep-a': { inputTokens: 15, outputTokens: 15, totalTokens: 30 },
    'ep-b': { inputTokens: 5, outputTokens: 6, totalTokens: 11 }
  });
});

test('includes every provider resource-pack type in available quota', () => {
  assert.deepEqual(summarizeActivationQuota({
    FreeResourcePackItems: [
      { Type: 'FreeInference', Total: 500000, Consumed: 500000, Reclaimed: 0 },
      { Type: 'DataPermission', Total: 10735080, Consumed: 5275212, Reclaimed: 0 }
    ]
  }), {
    total: 11235080, consumed: 5775212, reclaimed: 0, remaining: 5459868,
    resourcePacks: [
      { type: 'FreeInference', total: 500000, consumed: 500000, reclaimed: 0, remaining: 0 },
      { type: 'DataPermission', total: 10735080, consumed: 5275212, reclaimed: 0, remaining: 5459868 }
    ]
  });
});
