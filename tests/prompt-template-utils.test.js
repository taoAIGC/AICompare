const test = require('node:test');
const assert = require('node:assert/strict');

const promptTemplateUtils = require('../shared/prompt-template-utils.js');

test('sortPromptTemplates hides deleted templates but keeps disabled ones for management', () => {
  const templates = [
    { id: 'hidden', name: 'Hidden', query: 'Hidden {query}', order: 1, hidden: true },
    { id: 'disabled', name: 'Disabled', query: 'Disabled {query}', order: 2, enabled: false },
    { id: 'enabled', name: 'Enabled', query: 'Enabled {query}', order: 3, enabled: true }
  ];

  const sorted = promptTemplateUtils.sortPromptTemplates(templates, ['information']);

  assert.deepEqual(
    sorted.map((template) => ({ id: template.id, enabled: template.enabled })),
    [
      { id: 'disabled', enabled: false },
      { id: 'enabled', enabled: true }
    ]
  );
});

test('buildPromptTemplateSuggestions ignores disabled templates', () => {
  const templates = [
    { id: 'disabled', name: 'Disabled', query: 'Disabled {query}', type: 'information', order: 1, enabled: false },
    { id: 'enabled', name: 'Enabled', query: 'Enabled {query}', type: 'information', order: 2, enabled: true }
  ];

  const suggestions = promptTemplateUtils.buildPromptTemplateSuggestions(
    templates,
    'hello',
    'information',
    ['information']
  );

  assert.deepEqual(
    suggestions.map((template) => ({ id: template.id, query: template.query })),
    [
      { id: 'enabled', query: 'Enabled hello' }
    ]
  );
});

test('normalizePromptTemplate defaults enabled to true and hidden to false', () => {
  const template = promptTemplateUtils.normalizePromptTemplate({
    id: 'example',
    name: 'Example',
    query: '{query}',
    type: 'chat'
  }, ['information']);

  assert.equal(template.enabled, true);
  assert.equal(template.hidden, false);
  assert.equal(template.type, 'information');
});
