const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_PROMPT_TEMPLATE_TYPE,
  DEFAULT_PROMPT_TEMPLATE_TYPES,
  filterPromptTemplatesByType,
  normalizePromptTemplateType,
  normalizePromptTemplateTypes,
  sortPromptTemplates
} = require('../shared/prompt-template-utils.js');

test('normalizePromptTemplateType maps aliases and falls back to information', () => {
  assert.equal(normalizePromptTemplateType('translate'), 'translate');
  assert.equal(normalizePromptTemplateType('translation'), 'translate');
  assert.equal(normalizePromptTemplateType('chat'), 'information');
  assert.equal(normalizePromptTemplateType(''), DEFAULT_PROMPT_TEMPLATE_TYPE);
  assert.equal(normalizePromptTemplateType('unknown-kind'), DEFAULT_PROMPT_TEMPLATE_TYPE);
});

test('normalizePromptTemplateTypes defaults to the configured fallback list', () => {
  assert.deepEqual(normalizePromptTemplateTypes(), DEFAULT_PROMPT_TEMPLATE_TYPES);
  assert.deepEqual(normalizePromptTemplateTypes(['information', 'agents', 'information']), ['information', 'agents']);
});

test('filterPromptTemplatesByType keeps only templates matching requested type', () => {
  const templates = [
    { id: '1', name: 'Explain', query: 'Explain {query}', type: 'information', order: 2 },
    { id: '2', name: 'Translate', query: 'Translate {query}', type: 'translate', order: 1 },
    { id: '3', name: 'Legacy', query: 'Legacy {query}', order: 3 }
  ];

  assert.deepEqual(
    filterPromptTemplatesByType(templates, 'translate').map(template => template.id),
    ['2']
  );

  assert.deepEqual(
    filterPromptTemplatesByType(templates, 'information').map(template => template.id),
    ['1', '3']
  );
});

test('sortPromptTemplates ignores invalid templates and sorts by order', () => {
  const templates = [
    { id: '3', name: 'Third', query: 'Third {query}', order: 3, type: 'image' },
    { id: '1', name: 'First', query: 'First {query}', order: 1, type: 'image' },
    { id: 'x', name: '', query: 'Broken', order: 0, type: 'image' }
  ];

  assert.deepEqual(
    sortPromptTemplates(templates).map(template => template.id),
    ['1', '3']
  );
});

test('sortPromptTemplates remaps unsupported types to information under allowed type config', () => {
  const templates = [
    { id: 'image-template', name: 'Image', query: 'Draw {query}', type: 'image', order: 1 }
  ];

  assert.equal(
    sortPromptTemplates(templates, ['information', 'agents', 'translate'])[0].type,
    'information'
  );
});
