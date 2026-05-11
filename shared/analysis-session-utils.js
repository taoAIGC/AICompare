(function(root, factory) {
  const api = factory();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    module.exports.IframeAnalysisUtils = api;
  }

  if (root && typeof root === 'object') {
    root.IframeAnalysisUtils = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const STORAGE_KEY_PREFIX = 'aicompare-analysis-payload:';
  const DEFAULT_TITLE = 'AI Compare';

  function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function normalizeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function normalizeResponse(response) {
    if (!response || typeof response !== 'object') {
      return {
        siteName: '',
        answers: [],
        content: '',
        error: ''
      };
    }

    const answers = normalizeArray(response.answers)
      .map((answer) => normalizeString(answer))
      .filter(Boolean);

    return {
      siteName: normalizeString(response.siteName),
      answers,
      content: normalizeString(response.content),
      error: normalizeString(response.error)
    };
  }

  function normalizeResponses(responses) {
    return normalizeArray(responses).map(normalizeResponse);
  }

  function createAnalysisToken() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }

    return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  }

  function getAnalysisStorageKey(token) {
    const normalizedToken = normalizeString(token);
    return normalizedToken ? `${STORAGE_KEY_PREFIX}${normalizedToken}` : '';
  }

  function buildAnalysisEntry(entry) {
    if (!entry || typeof entry !== 'object') {
      return null;
    }

    return {
      timelineId: normalizeString(entry.timelineId),
      historyId: normalizeString(entry.historyId),
      query: normalizeString(entry.query),
      normalizedQuery: normalizeString(entry.normalizedQuery || entry.query),
      occurrenceIndex: Math.max(0, Number(entry.occurrenceIndex) || 0),
      timestamp: Number(entry.timestamp) || Date.now(),
      dateLabel: normalizeString(entry.dateLabel)
    };
  }

  function buildAnalysisPrompt(payload = {}) {
    const question = normalizeString(payload.question || payload.entry?.query);
    const summaryText = normalizeString(payload.summaryText || payload.copyText);
    const responses = normalizeResponses(payload.responses);
    const sections = [];

    if (question) {
      sections.push(`问题:\n${question}`);
    }

    if (summaryText) {
      sections.push(`汇总结果:\n${summaryText}`);
    }

    if (responses.length) {
      const rawBlocks = responses.map((response) => {
        const siteName = response.siteName || 'Unknown';
        let bodyText = '未提取到回答';

        if (response.error) {
          bodyText = `提取失败：${response.error}`;
        } else if (response.content) {
          bodyText = response.content;
        } else if (response.answers.length) {
          bodyText = response.answers.join('\n\n');
        }

        return `【${siteName}】\n${bodyText}`;
      });

      sections.push(`各站原始答案:\n${rawBlocks.join('\n\n')}`);
    }

    return [
      '请基于下面资料进行综合分析。',
      '要求：',
      '1. 先给出结论。',
      '2. 再说明理由、差异点和不一致之处。',
      '3. 如果各站答案冲突，请指出哪个站点更可信以及原因。',
      '',
      ...sections
    ].join('\n');
  }

  function buildAnalysisDisplayText(payload = {}) {
    const question = normalizeString(payload.question || payload.entry?.query);
    const summaryText = normalizeString(payload.summaryText || payload.copyText);
    const responses = normalizeResponses(payload.responses);
    const lines = [];

    if (question) {
      lines.push(`问题：${question}`);
    }
    if (summaryText) {
      lines.push(`汇总结果：\n${summaryText}`);
    }
    if (responses.length) {
      const responseLines = responses.map((response) => {
        const siteName = response.siteName || 'Unknown';
        let bodyText = '未提取到回答';
        if (response.error) {
          bodyText = `提取失败：${response.error}`;
        } else if (response.content) {
          bodyText = response.content;
        } else if (response.answers.length) {
          bodyText = response.answers.join('\n\n');
        }
        return `【${siteName}】\n${bodyText}`;
      });
      lines.push(`各站原始答案：\n${responseLines.join('\n\n')}`);
    }

    return lines.join('\n\n').trim();
  }

  function deriveCompareSites(payload = {}) {
    const responseSites = normalizeResponses(payload.responses)
      .map((response) => response.siteName)
      .filter(Boolean);
    const payloadSites = normalizeArray(payload.compareSites)
      .map((siteName) => normalizeString(siteName))
      .filter(Boolean);
    return Array.from(new Set([...payloadSites, ...responseSites]));
  }

  function buildTimelineAnalysisPayload({
    entry = null,
    summaryText = '',
    responses = [],
    question = '',
    successCount = 0,
    totalCount = 0
  } = {}) {
    const normalizedEntry = buildAnalysisEntry(entry);
    const normalizedResponses = normalizeResponses(responses);
    const payload = {
      version: 1,
      token: '',
      createdAt: new Date().toISOString(),
      entry: normalizedEntry,
      question: normalizeString(question || normalizedEntry?.query),
      summaryText: normalizeString(summaryText),
      responses: normalizedResponses,
      compareSites: deriveCompareSites({ responses: normalizedResponses }),
      successCount: Math.max(0, Number(successCount) || 0),
      totalCount: Math.max(0, Number(totalCount) || 0)
    };
    return payload;
  }

  async function saveTimelineAnalysisPayload(payload, token = '') {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid analysis payload');
    }

    const normalizedToken = normalizeString(token) || createAnalysisToken();
    const storageKey = getAnalysisStorageKey(normalizedToken);
    if (!storageKey) {
      throw new Error('Failed to create analysis storage key');
    }

    const storedPayload = {
      ...payload,
      token: normalizedToken
    };

    await chrome.storage.session.set({
      [storageKey]: storedPayload
    });

    return {
      token: normalizedToken,
      storageKey,
      payload: storedPayload
    };
  }

  async function loadTimelineAnalysisPayload(token) {
    const storageKey = getAnalysisStorageKey(token);
    if (!storageKey) return null;

    const result = await chrome.storage.session.get(storageKey);
    return result?.[storageKey] || null;
  }

  function buildTimelineAnalysisPageUrl(token) {
    return buildTimelineAnalysisCompareUrl(token);
  }

  function buildTimelineAnalysisCompareUrl(token) {
    const normalizedToken = normalizeString(token);
    if (!normalizedToken || !chrome?.runtime?.getURL) {
      return '';
    }

    return chrome.runtime.getURL(`iframe/iframe.html?analysisToken=${encodeURIComponent(normalizedToken)}&analysisMode=1`);
  }

  return {
    DEFAULT_TITLE,
    buildAnalysisDisplayText,
    buildAnalysisPrompt,
    buildTimelineAnalysisCompareUrl,
    buildTimelineAnalysisPageUrl,
    buildTimelineAnalysisPayload,
    createAnalysisToken,
    deriveCompareSites,
    getAnalysisStorageKey,
    loadTimelineAnalysisPayload,
    normalizeResponses,
    saveTimelineAnalysisPayload
  };
});
