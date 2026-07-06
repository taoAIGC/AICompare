(function(root, factory) {
  const api = factory();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (root && typeof root === 'object') {
    root.PromptTemplateUtils = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const DEFAULT_PROMPT_TEMPLATE_TYPE = 'information';
  const DEFAULT_PROMPT_TEMPLATE_TYPES = [
    'information',
    'agents',
    'translate'
  ];
  const PROMPT_TEMPLATE_TYPE_ALIASES = {
    chat: 'information',
    agent: 'agents',
    translation: 'translate'
  };

  function normalizePromptTemplateTypes(types) {
    const rawTypes = Array.isArray(types) && types.length > 0
      ? types
      : DEFAULT_PROMPT_TEMPLATE_TYPES;
    const normalizedTypes = rawTypes
      .map(type => String(type || '').trim().toLowerCase())
      .filter(Boolean);

    return Array.from(new Set(normalizedTypes));
  }

  function normalizePromptTemplateType(
    rawValue,
    fallbackType = DEFAULT_PROMPT_TEMPLATE_TYPE,
    allowedTypes = DEFAULT_PROMPT_TEMPLATE_TYPES
  ) {
    const normalizedAllowedTypes = normalizePromptTemplateTypes(allowedTypes);
    const allowedTypeSet = new Set(normalizedAllowedTypes);
    const normalizedValue = String(rawValue || '').trim().toLowerCase();
    if (!normalizedValue) {
      return fallbackType;
    }

    const aliasedValue = PROMPT_TEMPLATE_TYPE_ALIASES[normalizedValue] || normalizedValue;
    if (allowedTypeSet.has(aliasedValue)) {
      return aliasedValue;
    }

    return fallbackType;
  }

  function normalizePromptTemplate(template, allowedTypes = DEFAULT_PROMPT_TEMPLATE_TYPES) {
    if (!template || typeof template !== 'object') {
      return null;
    }

    return {
      ...template,
      enabled: template.enabled !== false,
      hidden: template.hidden === true,
      type: normalizePromptTemplateType(template.type, DEFAULT_PROMPT_TEMPLATE_TYPE, allowedTypes)
    };
  }

  function isPromptTemplateVisible(template) {
    return Boolean(
      template
      && template.name
      && template.query
      && template.hidden !== true
    );
  }

  function isPromptTemplateEnabled(template) {
    return isPromptTemplateVisible(template) && template.enabled !== false;
  }

  function sortPromptTemplates(templates, allowedTypes = DEFAULT_PROMPT_TEMPLATE_TYPES) {
    return (Array.isArray(templates) ? templates : [])
      .map(template => normalizePromptTemplate(template, allowedTypes))
      .filter(template => isPromptTemplateVisible(template))
      .sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  function filterPromptTemplatesByType(
    templates,
    requestedType,
    allowedTypes = DEFAULT_PROMPT_TEMPLATE_TYPES
  ) {
    const normalizedRequestedType = normalizePromptTemplateType(requestedType, '', allowedTypes);
    const sortedTemplates = sortPromptTemplates(templates, allowedTypes);

    if (!normalizedRequestedType) {
      return sortedTemplates;
    }

    return sortedTemplates.filter(template => template.type === normalizedRequestedType);
  }

  function buildPromptTemplateSuggestions(
    templates,
    query,
    requestedType,
    allowedTypes = DEFAULT_PROMPT_TEMPLATE_TYPES
  ) {
    return filterPromptTemplatesByType(templates, requestedType, allowedTypes)
      .filter(template => isPromptTemplateEnabled(template))
      .map(template => ({
        ...template,
        query: String(template.query).replace('{query}', query)
      }));
  }

  return {
    DEFAULT_PROMPT_TEMPLATE_TYPE,
    DEFAULT_PROMPT_TEMPLATE_TYPES,
    buildPromptTemplateSuggestions,
    filterPromptTemplatesByType,
    isPromptTemplateEnabled,
    isPromptTemplateVisible,
    normalizePromptTemplate,
    normalizePromptTemplateType,
    normalizePromptTemplateTypes,
    sortPromptTemplates
  };
});
