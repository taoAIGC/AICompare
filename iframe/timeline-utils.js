(function(root, factory) {
  const api = factory();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (root && typeof root === 'object') {
    root.IframeTimelineUtils = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const TIMELINE_QUOTE_WRAPPER_PAIRS = [
    ['"', '"'],
    ["'", "'"],
    ['“', '”'],
    ['‘', '’'],
    ['「', '」'],
    ['『', '』'],
    ['《', '》'],
    ['«', '»'],
    ['‹', '›']
  ];

  function stripTimelineOuterQuoteWrappers(text) {
    let normalizedText = String(text || '').trim();
    if (!normalizedText) {
      return '';
    }

    let changed = true;
    while (changed) {
      changed = false;

      for (const [openQuote, closeQuote] of TIMELINE_QUOTE_WRAPPER_PAIRS) {
        if (!normalizedText.startsWith(openQuote) || !normalizedText.endsWith(closeQuote)) {
          continue;
        }

        const innerText = normalizedText
          .slice(openQuote.length, normalizedText.length - closeQuote.length)
          .trim();
        if (!innerText) {
          continue;
        }

        const hasNestedQuote = innerText.includes(openQuote) || innerText.includes(closeQuote);
        const looksLikeLongPrompt = innerText.length >= 24;
        const hasSentencePunctuation = /[。！？!?；;：:,，、\n]/.test(innerText);
        if (!hasNestedQuote && !looksLikeLongPrompt && !hasSentencePunctuation) {
          continue;
        }

        normalizedText = innerText;
        changed = true;
        break;
      }
    }

    return normalizedText;
  }

  function normalizeTimelineQuery(query) {
    const normalizedText = String(query || '')
      .replace(/\s+/g, ' ')
      .trim();
    return stripTimelineOuterQuoteWrappers(normalizedText);
  }

  function normalizeTimelineMultilineText(text) {
    return String(text || '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.replace(/[ \t]+/g, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function buildTimelineEntry(entry, existingEntries = []) {
    const normalizedQuery = normalizeTimelineQuery(entry?.query);
    const explicitOccurrenceIndex = Number.isFinite(Number(entry?.occurrenceIndex))
      ? Math.max(0, Number(entry.occurrenceIndex) || 0)
      : null;
    const occurrenceIndex = explicitOccurrenceIndex !== null
      ? explicitOccurrenceIndex
      : (Array.isArray(existingEntries) ? existingEntries : []).filter((item) => {
          return item && item.normalizedQuery === normalizedQuery;
        }).length;

    return {
      timelineId: String(
        entry?.historyId ||
        entry?.timelineId ||
        `timeline-${Date.now()}-${occurrenceIndex}`
      ),
      historyId: entry?.historyId || null,
      query: normalizedQuery,
      normalizedQuery,
      occurrenceIndex,
      timestamp: Number(entry?.timestamp) || Date.now(),
      dateLabel: entry?.dateLabel || ''
    };
  }

  function buildTimelineEntryKey(entry) {
    const normalizedQuery = normalizeTimelineQuery(entry?.normalizedQuery || entry?.query);
    const occurrenceIndex = Math.max(0, Number(entry?.occurrenceIndex) || 0);
    return normalizedQuery ? `${normalizedQuery}::${occurrenceIndex}` : '';
  }

  function findTimelineEntryByQuery(entries = [], query = '') {
    const normalizedQuery = normalizeTimelineQuery(query);
    if (!normalizedQuery) {
      return null;
    }
    return (Array.isArray(entries) ? entries : []).find((entry) => entry?.normalizedQuery === normalizedQuery) || null;
  }

  function findTimelineEntryByKey(entries = [], entryKey = '') {
    const normalizedEntryKey = String(entryKey || '').trim();
    if (!normalizedEntryKey) {
      return null;
    }
    return (Array.isArray(entries) ? entries : []).find((entry) => buildTimelineEntryKey(entry) === normalizedEntryKey) || null;
  }

  function findTimelineEntryByTimelineId(entries = [], timelineId = '') {
    const normalizedTimelineId = String(timelineId || '').trim();
    if (!normalizedTimelineId) {
      return null;
    }
    return (Array.isArray(entries) ? entries : []).find((entry) => String(entry?.timelineId || '').trim() === normalizedTimelineId) || null;
  }

  function buildTimelineCopyText(entry, responses = []) {
    const lines = [];
    const query = normalizeTimelineQuery(entry?.query);
    const dateLabel = String(entry?.dateLabel || '').trim();

    lines.push(`问题：${query || '未命名提问'}`);
    if (dateLabel) {
      lines.push(`时间：${dateLabel}`);
    }

    for (const response of Array.isArray(responses) ? responses : []) {
      const siteName = String(response?.siteName || 'Unknown');
      const answers = (Array.isArray(response?.answers) ? response.answers : [])
        .map((answer) => normalizeTimelineMultilineText(answer))
        .filter(Boolean);
      const content = normalizeTimelineMultilineText(response?.content);
      const error = normalizeTimelineMultilineText(response?.error);
      let bodyText = '未提取到回答';

      if (error) {
        bodyText = `提取失败：${error}`;
      } else if (content) {
        bodyText = content;
      } else if (answers.length) {
        bodyText = answers.join('\n\n');
      }

      lines.push('');
      lines.push(`【${siteName}】`);
      lines.push(bodyText);
    }

    return lines.join('\n').trim();
  }

  return {
    buildTimelineCopyText,
    buildTimelineEntry,
    buildTimelineEntryKey,
    findTimelineEntryByKey,
    findTimelineEntryByTimelineId,
    findTimelineEntryByQuery,
    normalizeTimelineQuery
  };
});
