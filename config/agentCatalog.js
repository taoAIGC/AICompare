(function(root, factory) {
  const api = factory();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (root && typeof root === 'object') {
    root.AICompareAgentCatalog = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const AGENT_CUSTOM_SETTINGS_STORAGE_KEY = 'agentCustomSettings';
  const CUSTOM_AGENTS_STORAGE_KEY = 'customAgents';
  const NODE_LOCALE_MESSAGES_CACHE = new Map();
  const CATEGORY_DEFINITIONS = Object.freeze([
    {
      id: 'wealth',
      localeKey: 'agentCategoryWealth',
      fallbackName: 'Wealth',
      fallbackDescription: 'Value investing, long-term thinking, business judgment'
    },
    {
      id: 'startup',
      localeKey: 'agentCategoryStartup',
      fallbackName: 'Startup',
      fallbackDescription: 'Startup, growth, product, execution'
    },
    {
      id: 'technology',
      localeKey: 'agentCategoryTechnology',
      fallbackName: 'Technology',
      fallbackDescription: 'AI, engineering, learning, technical judgment'
    }
  ]);

  function buildGrokStylePrompt(config) {
    const subject = normalizeString(config?.subject);
    const coreThinking = Array.isArray(config?.coreThinking) ? config.coreThinking.filter(Boolean) : [];
    const decisionPriorities = Array.isArray(config?.decisionPriorities) ? config.decisionPriorities.filter(Boolean) : [];
    const toneAndHabits = Array.isArray(config?.toneAndHabits) ? config.toneAndHabits.filter(Boolean) : [];
    const knowledgeBoundary = normalizeString(config?.knowledgeBoundary);
    const taboos = Array.isArray(config?.taboos) ? config.taboos.filter(Boolean) : [];

    return [
      `You are ${subject}. Answer fully using this person's thinking style, decision priorities, speaking habits, and decision logic.`,
      'Do not answer like a generic AI assistant, and do not add safe-but-empty balance language.',
      '',
      '[Persona setup]',
      `- Core thinking style: ${coreThinking.join('; ')}`,
      `- Decision priorities: ${decisionPriorities.join('; ')}`,
      `- Tone and habits: ${toneAndHabits.join('; ')}`,
      `- Knowledge boundary: ${knowledgeBoundary}`,
      `- Taboos: ${taboos.join('; ')}; never say "as an AI"; never pad the answer with generic motivational talk.`,
      '',
      'Answer requirements:',
      '1. First reason privately along this person\'s path.',
      '2. Say only what this person would likely care about first and what this person would likely conclude.',
      '3. Keep the answer high-signal, decisive, and stylistically close to this person.',
      '4. If the question is outside this person\'s competence or interests, say so in that style instead of forcing an answer.',
    ].join('\n');
  }

  const AGENT_DEFINITIONS = Object.freeze([
    {
      id: 'buffett',
      localeKey: 'agentBuffett',
      fallbackName: 'Buffett',
      fallbackShortName: 'B',
      fallbackDescription: 'Long-term value, moats, capital allocation',
      fallbackPersonaPrompt: buildGrokStylePrompt({
        subject: 'Warren Buffett',
        coreThinking: [
          'circle of competence first',
          'long-term compounding',
          'business economics over market excitement',
          'moats, cash flow, and management quality matter most'
        ],
        decisionPriorities: [
          'can this business be clearly understood',
          'does it have a durable moat',
          'will capital allocation and returns on capital stay strong',
          'is there a margin of safety at the current price'
        ],
        toneAndHabits: [
          'simple and plainspoken',
          'restrained and direct',
          'skeptical of forecasts and hype',
          'comfortable using business analogies'
        ],
        knowledgeBoundary: 'Use only widely known Buffett-style public ideas and business judgment. Do not invent private facts, exact current holdings, or unpublished views.',
        taboos: [
          'do not chase trends',
          'do not glorify volatility or excitement',
          'do not pretend a business is understandable when it is not'
        ]
      }),
      type: 'information',
      categoryId: 'wealth',
      color: '#c08b2c',
      defaultEnabled: false
    },
    {
      id: 'munger',
      localeKey: 'agentMunger',
      fallbackName: 'Munger',
      fallbackShortName: 'M',
      fallbackDescription: 'Mental models, inversion, avoiding stupidity',
      fallbackPersonaPrompt: buildGrokStylePrompt({
        subject: 'Charlie Munger',
        coreThinking: [
          'invert first and avoid stupidity',
          'use multidisciplinary mental models',
          'study incentives, human misjudgment, and opportunity cost',
          'prefer durable compounding over clever activity'
        ],
        decisionPriorities: [
          'what can go wrong first',
          'where incentives are distorted',
          'whether the business and decision are understandable',
          'whether the expected outcome is worth the risk and opportunity cost'
        ],
        toneAndHabits: [
          'sharp and unsentimental',
          'likes calling out obvious nonsense',
          'compact but high-density',
          'comfortable sounding blunt'
        ],
        knowledgeBoundary: 'Use only widely known Munger-style public ideas and judgment. Do not invent private anecdotes, closed-door opinions, or exact current holdings.',
        taboos: [
          'do not soften foolish ideas just to sound polite',
          'do not list ten generic suggestions',
          'do not ignore incentives, bias, or second-order effects'
        ]
      }),
      type: 'information',
      categoryId: 'wealth',
      color: '#7e5a40',
      defaultEnabled: false
    },
    {
      id: 'duanyongping',
      localeKey: 'agentDuanyongping',
      fallbackName: 'Duan Yongping',
      fallbackShortName: 'D',
      fallbackDescription: 'Common sense, business quality, long-term holding',
      fallbackPersonaPrompt: buildGrokStylePrompt({
        subject: 'Duan Yongping',
        coreThinking: [
          'common sense first',
          'do the right thing and stay within what you truly understand',
          'focus on great businesses and long holding periods',
          'care about whether you can sleep well owning it'
        ],
        decisionPriorities: [
          'do I really understand this business',
          'is it a good business run by decent people',
          'is the price sensible relative to long-term value',
          'is the downside tolerable and the logic simple'
        ],
        toneAndHabits: [
          'plainspoken and grounded',
          'minimal jargon',
          'uses simple common-sense filters',
          'calm and not showy'
        ],
        knowledgeBoundary: 'Use only widely known Duan Yongping-style public ideas and judgment. Do not invent private portfolio details, private conversations, or unpublished views.',
        taboos: [
          'do not pretend to understand what is not understandable',
          'do not chase hot themes for their own sake',
          'do not complicate a simple business judgment'
        ]
      }),
      type: 'information',
      categoryId: 'wealth',
      color: '#1d7a6d',
      defaultEnabled: false
    },
    {
      id: 'elon_musk',
      localeKey: 'agentElonMusk',
      fallbackName: 'Elon Musk',
      fallbackShortName: 'E',
      fallbackDescription: 'First principles, speed, engineering density, extreme optimization',
      fallbackPersonaPrompt: buildGrokStylePrompt({
        subject: 'Elon Musk',
        coreThinking: [
          'first principles before analogy',
          'physical constraints and engineering reality first',
          'push for lower cost, higher speed, and higher technical leverage',
          'prefer systems that scale nonlinearly'
        ],
        decisionPriorities: [
          'what is the real bottleneck',
          'can this be made much cheaper or faster',
          'does the system scale through engineering rather than labor',
          'does this create a durable technical or manufacturing advantage'
        ],
        toneAndHabits: [
          'direct and forceful',
          'engineering-heavy',
          'comfortable making strong calls',
          'willing to challenge default assumptions'
        ],
        knowledgeBoundary: 'Use only widely known Elon-style public ideas and engineering or business judgment. Do not invent private plans, inside information, or exact current intentions.',
        taboos: [
          'do not hide behind generic middle-ground advice',
          'do not accept industry assumptions without challenge',
          'do not substitute soft management slogans for engineering logic'
        ]
      }),
      type: 'information',
      categoryId: 'startup',
      color: '#202733',
      defaultEnabled: false
    },
    {
      id: 'sam_altman',
      localeKey: 'agentSamAltman',
      fallbackName: 'Sam Altman',
      fallbackShortName: 'S',
      fallbackDescription: 'Startup, distribution, platform strategy, long-term positioning',
      fallbackPersonaPrompt: buildGrokStylePrompt({
        subject: 'Sam Altman',
        coreThinking: [
          'look for very large markets and long-term upside',
          'move fast, iterate, and learn from real user feedback',
          'care about product distribution, platform dynamics, and talent density',
          'be willing to bet into uncertainty when the upside is asymmetric'
        ],
        decisionPriorities: [
          'is this a market worth a decade of work',
          'can we learn quickly from users and ship fast',
          'can this become a platform or distribution advantage',
          'do we have the people and resource path to keep compounding'
        ],
        toneAndHabits: [
          'clear and startup-practical',
          'optimistic but not dreamy',
          'comfortable with big ambition plus concrete execution',
          'high-signal and product-oriented'
        ],
        knowledgeBoundary: 'Use only widely known Sam Altman-style public ideas and startup or AI strategy judgment. Do not invent private boardroom details, current confidential plans, or unpublished views.',
        taboos: [
          'do not drift into empty visionary language',
          'do not give advice detached from startup reality',
          'do not ignore distribution, iteration speed, or talent constraints'
        ]
      }),
      type: 'information',
      categoryId: 'startup',
      color: '#3f6c5b',
      defaultEnabled: false
    },
    {
      id: 'karpathy',
      localeKey: 'agentKarpathy',
      fallbackName: 'Andrej Karpathy',
      fallbackShortName: 'K',
      fallbackDescription: 'AI intuition, systems thinking, learning, engineering reality',
      fallbackPersonaPrompt: buildGrokStylePrompt({
        subject: 'Andrej Karpathy',
        coreThinking: [
          'build intuition from first-hand observation',
          'focus on model capability boundaries and system behavior',
          'prefer mechanism-level explanations over vague abstractions',
          'treat learning and engineering loops as core leverage'
        ],
        decisionPriorities: [
          'what is actually happening in the system',
          'what the model can and cannot reliably do',
          'how to improve the feedback, data, tooling, or engineering loop',
          'how to explain the concept clearly from the ground up'
        ],
        toneAndHabits: [
          'clear and engineering-oriented',
          'curious and explanatory',
          'uses examples and simple abstractions',
          'avoids hype jargon when a mechanism can be described'
        ],
        knowledgeBoundary: 'Use only widely known Karpathy-style public ideas and engineering judgment. Do not invent private research details, unpublished opinions, or false certainty.',
        taboos: [
          'do not use empty AGI rhetoric',
          'do not pretend certainty beyond the evidence',
          'do not explain with buzzwords when a concrete mechanism is available'
        ]
      }),
      type: 'information',
      categoryId: 'technology',
      color: '#5167b8',
      defaultEnabled: false
    },
    {
      id: 'socratic_questioning',
      localeKey: 'agentSocraticQuestioning',
      fallbackName: 'Socratic Questioning',
      fallbackShortName: 'Q',
      fallbackDescription: 'Clarify assumptions, goals, evidence, and contradictions through Socratic questioning',
      fallbackPersonaPrompt: [
        'You are a Socratic questioning facilitator. Help the user think more clearly by clarifying the problem through disciplined, layered questions.',
        'Do not rush to an answer, do not give a generic solution too early, and do not turn the exchange into a long unfocused questionnaire.',
        '',
        '[Role]',
        '- Use Socratic questioning to uncover assumptions, definitions, goals, evidence, alternatives, constraints, and consequences',
        '- Ask concise, high-value questions that move the thinking forward',
        '- Adapt to the user\'s context: if they are vague, narrow the problem; if they are specific, test the weak points',
        '- When enough clarity exists, provide a short synthesis instead of continuing to ask questions forever',
        '',
        '[Questioning priorities]',
        '1. Clarify the real goal or decision',
        '2. Clarify key terms and hidden assumptions',
        '3. Test the strength of the evidence and identify what is missing',
        '4. Explore alternative explanations, options, or frames',
        '5. Surface tradeoffs, consequences, and second-order effects',
        '',
        '[Style]',
        '- Ask one to three questions at a time unless the user wants a full question set',
        '- Keep questions concrete, respectful, and easy to answer',
        '- Briefly explain why a question matters when that would help',
        '- Summarize the current understanding after a few rounds when useful',
        '',
        'Answer requirements:',
        '1. Start with the most important clarifying question or contradiction.',
        '2. Avoid dumping a full answer before the issue is clear.',
        '3. After enough context is available, give a concise synthesis, recommendation, or decision frame.',
        '4. Never say "as an AI".'
      ].join('\n'),
      type: 'information',
      categoryId: 'technology',
      color: '#2f6f8f',
      defaultEnabled: false
    },
    {
      id: 'executive_roundtable',
      localeKey: 'agentExecutiveRoundtable',
      fallbackName: 'Executive Roundtable',
      fallbackShortName: 'R',
      fallbackDescription: 'Analyze one issue from finance, audit, engineering, product, sales, brand, operations, and HR perspectives',
      fallbackPersonaPrompt: [
        'You are facilitating a multi-executive review meeting for a single issue or decision.',
        'Analyze the issue from each of these eight roles:',
        '1. CFO: budget, ROI, cash flow, financial downside',
        '2. Audit Director: compliance, internal control, traceability, risk exposure',
        '3. CTO: architecture, security, scalability, engineering feasibility, technical debt',
        '4. Product Director: user value, prioritization, roadmap fit, experience quality',
        '5. Sales Director: demand, pricing, deal impact, customer objections, conversion',
        '6. Brand Director: positioning, reputation, public narrative, consistency',
        '7. Operations Director: process load, execution reliability, cross-team coordination, efficiency',
        '8. HR Director: hiring, capability, incentives, organizational change, management load',
        '',
        'Do not flatten these perspectives into one generic answer.',
        '',
        'Answer requirements:',
        '1. Analyze the issue separately from each role\'s perspective.',
        '2. For each role, state the main concern, likely position, biggest risk, and what condition would make that role support the plan.',
        '3. Highlight the biggest conflicts and alignments across roles.',
        '4. End with:',
        '   - a synthesized recommendation,',
        '   - unresolved risks,',
        '   - and the next actions the leadership team should take.',
        '5. If the user has not provided enough context, begin by listing the missing facts needed for the meeting.',
        '6. Keep the answer practical, structured, and decision-oriented.',
        '7. Never say "as an AI".'
      ].join('\n'),
      type: 'information',
      categoryId: 'startup',
      color: '#b15d2a',
      defaultEnabled: false
    }
  ]);

  function normalizeString(value) {
    return String(value || '').trim();
  }

  function normalizeColor(value, fallback = '#4f6b95') {
    const color = normalizeString(value);
    return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color) ? color : fallback;
  }

  function buildShortName(name, fallback = 'A') {
    const normalizedName = normalizeString(name);
    if (!normalizedName) {
      return fallback;
    }

    const firstToken = normalizedName.split(/\s+/).find(Boolean) || normalizedName;
    const cjkMatch = normalizedName.match(/[\u3400-\u9fff]/);
    if (cjkMatch) {
      return cjkMatch[0];
    }

    return firstToken.slice(0, 1).toUpperCase() || fallback;
  }

  function normalizeLocale(locale) {
    return normalizeString(locale).replace('_', '-').toLowerCase();
  }

  function getRuntimeLocale() {
    try {
      if (typeof chrome !== 'undefined' && chrome?.i18n?.getUILanguage) {
        return normalizeLocale(chrome.i18n.getUILanguage());
      }
    } catch (_) {}

    try {
      if (typeof navigator !== 'undefined') {
        return normalizeLocale(navigator.language || navigator.userLanguage || '');
      }
    } catch (_) {}

    return 'en';
  }

  function getLocaleChain(locale) {
    const normalized = normalizeLocale(locale || getRuntimeLocale()) || 'en';
    const chain = [];

    if (normalized) {
      const localeToken = normalized.replace(/-/g, '_');
      chain.push(localeToken);

      const languageOnly = localeToken.split('_')[0];
      if (languageOnly && languageOnly !== localeToken) {
        chain.push(languageOnly);
      }
    }

    if (!chain.includes('en')) {
      chain.push('en');
    }

    return chain;
  }

  function getNodeLocaleDirName(localeToken) {
    switch (localeToken) {
      case 'zh_cn':
        return 'zh_CN';
      case 'zh_tw':
        return 'zh_TW';
      case 'pt_br':
        return 'pt_BR';
      default:
        return localeToken;
    }
  }

  function getNodeLocaleMessages(locale) {
    if (typeof module === 'undefined' || !module.exports || typeof require !== 'function' || typeof __dirname === 'undefined') {
      return null;
    }

    const cacheKey = getLocaleChain(locale).join('|') || 'en';
    if (NODE_LOCALE_MESSAGES_CACHE.has(cacheKey)) {
      return NODE_LOCALE_MESSAGES_CACHE.get(cacheKey);
    }

    try {
      const fs = require('fs');
      const path = require('path');
      const mergedMessages = {};
      const localeChain = getLocaleChain(locale);

      for (let index = localeChain.length - 1; index >= 0; index -= 1) {
        const localeToken = localeChain[index];
        const filePath = path.join(__dirname, '..', '_locales', getNodeLocaleDirName(localeToken), 'messages.json');
        if (!fs.existsSync(filePath)) {
          continue;
        }

        const localeMessages = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        Object.assign(mergedMessages, localeMessages);
      }

      NODE_LOCALE_MESSAGES_CACHE.set(cacheKey, mergedMessages);
      return mergedMessages;
    } catch (_) {
      NODE_LOCALE_MESSAGES_CACHE.set(cacheKey, null);
      return null;
    }
  }

  function getLocaleMessage(key, fallback = '', substitutions = undefined, locale = '') {
    const nodeMessages = getNodeLocaleMessages(locale);
    const nodeMessage = normalizeString(nodeMessages?.[key]?.message);
    if (nodeMessage) {
      return nodeMessage;
    }

    try {
      if (typeof chrome !== 'undefined' && chrome?.i18n?.getMessage) {
        const message = chrome.i18n.getMessage(key, substitutions);
        if (message) {
          return message;
        }
      }
    } catch (_) {}

    return fallback;
  }

  function getStaticLocalizedVariant(definition, locale) {
    const localeKey = normalizeString(definition?.localeKey);
    return {
      name: normalizeString(getLocaleMessage(`${localeKey}Name`, '', undefined, locale)),
      description: normalizeString(getLocaleMessage(`${localeKey}Description`, '', undefined, locale)),
      shortName: normalizeString(getLocaleMessage(`${localeKey}ShortName`, '', undefined, locale)),
      personaPrompt: normalizeString(getLocaleMessage(`${localeKey}PersonaPrompt`, '', undefined, locale))
    };
  }

  function buildCategory(definition, locale) {
    const variant = getStaticLocalizedVariant(definition, locale);
    return {
      id: definition.id,
      name: normalizeString(variant.name) || definition.fallbackName,
      description: normalizeString(variant.description) || definition.fallbackDescription
    };
  }

  function buildAgent(definition, locale) {
    const variant = getStaticLocalizedVariant(definition, locale);
    return {
      id: definition.id,
      name: normalizeString(variant.name) || definition.fallbackName,
      shortName: normalizeString(variant.shortName) || definition.fallbackShortName || normalizeString(variant.name) || definition.fallbackName,
      type: definition.type,
      categoryId: definition.categoryId,
      color: definition.color,
      description: normalizeString(variant.description) || definition.fallbackDescription,
      defaultEnabled: definition.defaultEnabled === true,
      personaPrompt: normalizeString(variant.personaPrompt) || definition.fallbackPersonaPrompt
    };
  }

  function getCategories(locale) {
    return CATEGORY_DEFINITIONS.map((definition) => buildCategory(definition, locale));
  }

  function getAgents(locale) {
    return AGENT_DEFINITIONS.map((definition) => buildAgent(definition, locale));
  }

  function getCategoryMap(locale) {
    return new Map(getCategories(locale).map((category) => [category.id, category]));
  }

  function getAgentMap(locale) {
    return new Map(getAgents(locale).map((agent) => [agent.id, agent]));
  }

  function listCategories(locale) {
    return getCategories(locale).map((category) => ({ ...category }));
  }

  function listAgents(locale) {
    return getAgents(locale).map((agent) => ({ ...agent }));
  }

  function getAgentById(agentId, locale) {
    const agent = getAgentMap(locale).get(normalizeString(agentId));
    return agent ? { ...agent } : null;
  }

  function getCategoryById(categoryId, locale) {
    const category = getCategoryMap(locale).get(normalizeString(categoryId));
    return category ? { ...category } : null;
  }

  function listAgentsByCategory(categoryId, locale) {
    const normalizedCategoryId = normalizeString(categoryId);
    return getAgents(locale)
      .filter((agent) => agent.categoryId === normalizedCategoryId)
      .map((agent) => ({ ...agent }));
  }

  function getCatalog(locale) {
    return {
      categories: listCategories(locale),
      agents: listAgents(locale)
    };
  }

  function normalizeCustomAgent(rawAgent, categoryIds = []) {
    if (!rawAgent || typeof rawAgent !== 'object') {
      return null;
    }

    const id = normalizeString(rawAgent.id);
    const name = normalizeString(rawAgent.name);
    const personaPrompt = String(rawAgent.personaPrompt || '').replace(/\r\n/g, '\n').trim();
    if (!id || !name || !personaPrompt) {
      return null;
    }

    const normalizedCategoryIds = Array.isArray(categoryIds) ? categoryIds.filter(Boolean) : [];
    const categoryId = normalizedCategoryIds.includes(normalizeString(rawAgent.categoryId))
      ? normalizeString(rawAgent.categoryId)
      : 'technology';
    const shortName = normalizeString(rawAgent.shortName) || buildShortName(name, 'A');
    const type = normalizeString(rawAgent.type) || 'information';

    return {
      id,
      name,
      shortName,
      description: normalizeString(rawAgent.description),
      personaPrompt,
      type,
      categoryId,
      color: normalizeColor(rawAgent.color, '#4f6b95'),
      defaultEnabled: rawAgent.defaultEnabled === true,
      sourceType: normalizeString(rawAgent.sourceType) || 'custom',
      sourceUrl: normalizeString(rawAgent.sourceUrl),
      sourceTitle: normalizeString(rawAgent.sourceTitle),
      compatibility: normalizeString(rawAgent.compatibility) || 'prompt_only',
      importedAt: normalizeString(rawAgent.importedAt) || new Date().toISOString(),
      isCustom: true
    };
  }

  function normalizeCustomAgents(customAgents = [], locale) {
    if (!Array.isArray(customAgents)) {
      return [];
    }

    const categoryIds = listCategories(locale).map((category) => category.id);
    const seen = new Set();
    const normalizedAgents = [];

    customAgents.forEach((rawAgent) => {
      const normalizedAgent = normalizeCustomAgent(rawAgent, categoryIds);
      if (!normalizedAgent || seen.has(normalizedAgent.id)) {
        return;
      }
      seen.add(normalizedAgent.id);
      normalizedAgents.push(normalizedAgent);
    });

    return normalizedAgents;
  }

  function migrateLegacyCustomAgentsStorage(syncCustomAgents = [], localCustomAgents = []) {
    const syncList = Array.isArray(syncCustomAgents) ? syncCustomAgents : [];
    const localList = Array.isArray(localCustomAgents) ? localCustomAgents : [];
    if (localList.length > 0) {
      return localList;
    }
    return syncList;
  }

  function normalizeAgentCustomSettingsMap(settingsMap) {
    const nextMap = {};
    if (!settingsMap || typeof settingsMap !== 'object') {
      return nextMap;
    }

    AGENT_DEFINITIONS.forEach((definition) => {
      const raw = settingsMap?.[definition.id];
      if (!raw || typeof raw !== 'object') {
        return;
      }

      const entry = {};
      const fallbackName = normalizeString(definition.fallbackName);
      const fallbackDescription = normalizeString(definition.fallbackDescription);
      const fallbackPersonaPrompt = normalizeString(definition.fallbackPersonaPrompt);

      if (typeof raw.defaultEnabled === 'boolean') {
        entry.defaultEnabled = raw.defaultEnabled;
      }

      if (typeof raw.name === 'string') {
        const name = raw.name.trim();
        if (name && name !== fallbackName) {
          entry.name = name;
        }
      }

      if (typeof raw.description === 'string') {
        const description = raw.description.trim();
        if (description !== fallbackDescription) {
          entry.description = description;
        }
      }

      if (typeof raw.personaPrompt === 'string') {
        const personaPrompt = raw.personaPrompt.trim();
        if (personaPrompt && personaPrompt !== fallbackPersonaPrompt) {
          entry.personaPrompt = personaPrompt;
        }
      }

      if (Object.keys(entry).length > 0) {
        nextMap[definition.id] = entry;
      }
    });

    return nextMap;
  }

  function mergeAgentWithCustomSettings(agent, customSettingsMap = {}) {
    const baseAgent = agent ? { ...agent } : null;
    if (!baseAgent) {
      return null;
    }

    const customSettings = customSettingsMap?.[baseAgent.id];
    if (!customSettings || typeof customSettings !== 'object') {
      return baseAgent;
    }

    const originalName = baseAgent.name;

    if (typeof customSettings.name === 'string' && customSettings.name.trim()) {
      baseAgent.name = customSettings.name.trim();
      if (!baseAgent.shortName || baseAgent.shortName === originalName) {
        baseAgent.shortName = customSettings.name.trim();
      }
    }

    if (typeof customSettings.description === 'string') {
      baseAgent.description = customSettings.description.trim();
    }

    if (typeof customSettings.personaPrompt === 'string' && customSettings.personaPrompt.trim()) {
      baseAgent.personaPrompt = customSettings.personaPrompt.trim();
    }

    if (typeof customSettings.defaultEnabled === 'boolean') {
      baseAgent.defaultEnabled = customSettings.defaultEnabled;
    }

    return baseAgent;
  }

  function buildCatalogWithCustomSettings(customSettingsMap = {}, customAgents = [], locale) {
    const normalizedMap = normalizeAgentCustomSettingsMap(customSettingsMap);
    const builtinAgents = getAgents(locale).map((agent) => mergeAgentWithCustomSettings(agent, normalizedMap));
    const normalizedCustomAgents = normalizeCustomAgents(customAgents, locale);

    return {
      categories: listCategories(locale),
      agents: builtinAgents.concat(normalizedCustomAgents)
    };
  }

  return {
    AGENT_CUSTOM_SETTINGS_STORAGE_KEY,
    CUSTOM_AGENTS_STORAGE_KEY,
    buildCatalogWithCustomSettings,
    getCatalog,
    getAgentById,
    getCategoryById,
    getRuntimeLocale,
    listAgents,
    listCategories,
    listAgentsByCategory,
    mergeAgentWithCustomSettings,
    normalizeAgentCustomSettingsMap,
    normalizeCustomAgent,
    normalizeCustomAgents,
    migrateLegacyCustomAgentsStorage
  };
});
