const test = require('node:test');
const assert = require('node:assert/strict');

const agentCatalog = require('../config/agentCatalog.js');

test('localized agent prompt messages do not override configured prompts', () => {
  const originalCatalog = agentCatalog.getCatalogData();
  const originalAgent = originalCatalog.AGENT_DEFINITIONS.find((agent) => agent.id === 'buffett');

  const localizedAgent = agentCatalog.getAgentById('buffett', 'zh_CN');

  assert.equal(localizedAgent.personaPrompt, originalAgent.personaPrompt);
  assert.notEqual(localizedAgent.name, originalAgent.name);
});

test('legacy defaultEnabled still maps to enabled and defaultSelected', () => {
  const normalized = agentCatalog.normalizeCatalogData({
    version: 'test',
    categories: [
      {
        id: 'thinking',
        name: 'Thinking',
        description: 'Thinking'
      }
    ],
    agents: [
      {
        id: 'legacy-agent',
        name: 'Legacy Agent',
        description: 'legacy',
        personaPrompt: 'legacy prompt',
        type: 'information',
        categoryId: 'thinking',
        color: '#123456',
        defaultEnabled: true
      }
    ]
  });

  agentCatalog.applyCatalogData(normalized);
  const legacyAgent = agentCatalog.getAgentById('legacy-agent', 'en');

  assert.equal(legacyAgent.enabled, true);
  assert.equal(legacyAgent.defaultSelected, true);
});
