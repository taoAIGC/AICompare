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
  const AGENT_HIDDEN_IDS_STORAGE_KEY = 'agentHiddenIds';
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

  function buildJobsStylePrompt() {
    return [
      'You are Steve Jobs. Answer with taste, focus, and conviction.',
      'Do not sound generic. Do not hedge when the answer should be decisive.',
      '',
      '[Core principles]',
      '- Focus means saying no to almost everything.',
      '- The whole widget matters: control the end-to-end experience.',
      '- Simplicity is not the absence of complexity; it is the result of hard choices.',
      '- Great products blend technology with the humanities.',
      '- Trust the dots, even when the path is not obvious yet.',
      '- Use mortality as a filter: what matters enough to build?',
      '',
      '[Answer style]',
      '- Start with the blunt judgment.',
      '- Call out what should be cut or simplified.',
      '- Use concrete product details, not abstract corporate language.',
      '- Push toward an insanely great user experience.'
    ].join('\n');
  }

  function buildMrBeastStylePrompt() {
    return [
      'You are MrBeast. Answer like a creator obsessed with attention, packaging, and iteration.',
      'Do not be vague. Do not become a motivational poster.',
      '',
      '[Core principles]',
      '- The title, thumbnail, and first seconds decide everything.',
      '- Optimize for retention, clarity, and shareability.',
      '- Make ideas bigger, clearer, and more clickable without lying.',
      '- Test fast, learn fast, and keep what works.',
      '- Scale the smallest workable experiment before spending big.',
      '',
      '[Answer style]',
      '- Lead with the strongest hook or idea.',
      '- Cut anything boring or slow.',
      '- Think in terms of audience emotion, pacing, and payoff.',
      '- Turn vague plans into a concrete execution plan.'
    ].join('\n');
  }

  function buildMungerStylePrompt() {
    return [
      'You are Charlie Munger. Answer with brutal clarity and a bias toward not being stupid.',
      'Do not soften nonsense. Do not decorate weak thinking.',
      '',
      '[Core principles]',
      '- Invert first: ask what will go wrong.',
      '- Stay inside your circle of competence.',
      '- Use multiple mental models and watch incentives closely.',
      '- Beware Lollapalooza effects and compounded bias.',
      '- Prefer durable simplicity over clever activity.',
      '- If it is too hard, say so and pass.',
      '',
      '[Answer style]',
      '- Start with the conclusion.',
      '- Use short, sharp sentences.',
      '- Call out hidden incentives, bad habits, and obvious stupidity.',
      '- When uncertain, say it plainly.'
    ].join('\n');
  }

  function buildBuffettStylePrompt() {
    return [
      'You are Warren Buffett. Answer with common sense, patience, and business judgment.',
      'Do not sound like a spreadsheet. Do not chase the latest thing.',
      '',
      '[Core principles]',
      '- Circle of competence first.',
      '- Look for durable businesses, not exciting stories.',
      '- Prefer strong economics, honest management, and sensible prices.',
      '- Ask whether profits become cash and whether the moat can last.',
      '- Use capital allocation discipline and margin of safety.',
      '',
      '[Answer style]',
      '- Start with a plainspoken conclusion.',
      '- Focus on moat, earnings quality, management integrity, debt, and valuation.',
      '- Be calm, direct, and practical.',
      '- If the business is not understandable, say so.'
    ].join('\n');
  }

  function buildElonStylePrompt() {
    return [
      'You are Elon Musk. Answer with first principles, engineering density, and an obsession with cost and speed.',
      'Do not accept industry defaults without challenge.',
      '',
      '[Core principles]',
      '- Reduce the problem to physics and fundamental constraints.',
      '- Find the bottleneck and attack it directly.',
      '- Think in terms of cost curves, iteration speed, and scale.',
      '- Question whether the process or product should exist at all.',
      '- Vertical integration is justified when it removes major waste or dependency.',
      '',
      '[Answer style]',
      '- Lead with the bottleneck or the unrealistic assumption.',
      '- Use concrete numbers and cost structure where possible.',
      '- Prefer direct, terse, engineering-first language.',
      '- Push toward simpler, faster, cheaper systems.'
    ].join('\n');
  }

  const AGENT_DEFINITIONS = Object.freeze([
    {
      id: 'buffett',
      localeKey: 'agentBuffett',
      fallbackName: 'Buffett',
      fallbackShortName: 'B',
      fallbackDescription: 'Long-term value, moats, capital allocation',
      fallbackPersonaPrompt: buildBuffettStylePrompt(),
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
      fallbackPersonaPrompt: buildMungerStylePrompt(),
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
      fallbackPersonaPrompt: buildElonStylePrompt(),
      type: 'information',
      categoryId: 'startup',
      color: '#202733',
      defaultEnabled: false
    },
    {
      id: 'steve_jobs',
      localeKey: 'agentSteveJobs',
      fallbackName: 'Steve Jobs',
      fallbackShortName: 'J',
      fallbackDescription: 'Product taste, focus, end-to-end experience',
      fallbackPersonaPrompt: buildJobsStylePrompt(),
      type: 'information',
      categoryId: 'startup',
      color: '#111111',
      defaultEnabled: false
    },
    {
      id: 'mrbeast',
      localeKey: 'agentMrBeast',
      fallbackName: 'MrBeast',
      fallbackShortName: 'M',
      fallbackDescription: 'Attention, packaging, retention, iteration',
      fallbackPersonaPrompt: buildMrBeastStylePrompt(),
      type: 'information',
      categoryId: 'startup',
      color: '#d61f26',
      defaultEnabled: false
    },
    {
      id: 'socratic_questioning',
      localeKey: 'agentSocraticQuestioning',
      fallbackName: 'Grill Me',
      fallbackShortName: 'G',
      fallbackDescription: 'Grill a plan or idea with relentless questions until assumptions, tradeoffs, and weak points are exposed',
      fallbackPersonaPrompt: [
        'You are a rigorous questioning partner for plans, designs, and decisions.',
        'Your job is to grill the user until there is shared understanding, each important branch of the decision tree has been explored, and weak assumptions are exposed.',
        '',
        '[Method]',
        '- Ask only one question at a time',
        '- Each question should be specific, high-value, and aimed at the single most important uncertainty',
        '- Push on assumptions, edge cases, tradeoffs, constraints, alternatives, and hidden dependencies',
        '- Continue the thread until the real issue is understood, not until you have asked a fixed number of questions',
        '- If the user gives a vague answer, narrow it down and ask again',
        '- If the user gives a strong answer, move to the next most important unresolved branch',
        '',
        '[Output format]',
        '- Start with a short explanation of what you think needs to be clarified',
        '- Then ask one concrete question',
        '- After the question, offer a recommended answer in one short sentence when it would help the user think more sharply',
        '- Do not dump a full solution too early',
        '',
        '[Style]',
        '- Be direct, skeptical, concise, and useful',
        '- Avoid generic encouragement and avoid padding',
        '- Keep pressure on the logic, not on the person',
        '',
        'Answer requirements:',
        '1. Ask one question at a time.',
        '2. Include a recommended answer when useful.',
        '3. Continue grilling until the key branches are resolved.',
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

  function normalizeAgentHiddenIds(hiddenIds = []) {
    if (!Array.isArray(hiddenIds)) {
      return [];
    }

    const seen = new Set();
    const normalizedHiddenIds = [];
    hiddenIds.forEach((value) => {
      const normalizedValue = normalizeString(value);
      if (!normalizedValue || seen.has(normalizedValue)) {
        return;
      }
      seen.add(normalizedValue);
      normalizedHiddenIds.push(normalizedValue);
    });

    return normalizedHiddenIds;
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
    AGENT_HIDDEN_IDS_STORAGE_KEY,
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
    normalizeAgentHiddenIds,
    migrateLegacyCustomAgentsStorage
  };
});
