(function(root, factory) {
  const api = factory();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (root && typeof root === 'object') {
    root.IframeTimelineUtils = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  function normalizeTimelineQuery(query) {
    return String(query || '')
      .replace(/\s+/g, ' ')
      .trim();
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

  function mergeTimelinePromptSnapshots(snapshots = [], previousEntries = []) {
    const mergedEntries = [];
    const entryByPromptKey = new Map();

    for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
      const siteName = String(snapshot?.siteName || '').trim();
      const prompts = Array.isArray(snapshot?.prompts) ? snapshot.prompts : [];
      const occurrenceByQuery = new Map();

      for (const prompt of prompts) {
        const query = normalizeTimelineQuery(prompt?.text);
        if (!query) continue;

        const occurrenceIndex = occurrenceByQuery.get(query) || 0;
        occurrenceByQuery.set(query, occurrenceIndex + 1);
        const promptKey = `${query}::${occurrenceIndex}`;

        let entry = entryByPromptKey.get(promptKey);
        if (!entry) {
          entry = {
            query,
            normalizedQuery: query,
            occurrenceIndex,
            sourceSites: []
          };
          entryByPromptKey.set(promptKey, entry);
          mergedEntries.push(entry);
        }

        if (siteName && !entry.sourceSites.includes(siteName)) {
          entry.sourceSites.push(siteName);
        }
      }
    }

    const previousEntryKeySet = new Set(
      (Array.isArray(previousEntries) ? previousEntries : [])
        .map((entry) => buildTimelineEntryKey(entry))
        .filter(Boolean)
    );
    const previousOrderByKey = new Map(
      (Array.isArray(previousEntries) ? previousEntries : [])
        .map((entry, index) => [buildTimelineEntryKey(entry), index])
        .filter(([entryKey]) => entryKey)
    );

    return mergedEntries
      .filter((entry) => {
        const occurrenceIndex = Math.max(0, Number(entry?.occurrenceIndex) || 0);
        if (occurrenceIndex === 0) {
          return true;
        }
        const entryKey = buildTimelineEntryKey(entry);
        if (entryKey && previousEntryKeySet.has(entryKey)) {
          return true;
        }
        return false;
      })
      .map((entry, index) => ({ entry, index }))
      .sort((left, right) => {
        const leftOrder = previousOrderByKey.has(buildTimelineEntryKey(left.entry))
          ? previousOrderByKey.get(buildTimelineEntryKey(left.entry))
          : Number.POSITIVE_INFINITY;
        const rightOrder = previousOrderByKey.has(buildTimelineEntryKey(right.entry))
          ? previousOrderByKey.get(buildTimelineEntryKey(right.entry))
          : Number.POSITIVE_INFINITY;

        if (leftOrder !== rightOrder) {
          return leftOrder - rightOrder;
        }
        return left.index - right.index;
      })
      .map(({ entry }) => entry);
  }

  function extractTimelinePromptsFromMessages(messages = []) {
    const prompts = [];

    for (const message of Array.isArray(messages) ? messages : []) {
      if (message?.role !== 'user') continue;
      const text = normalizeTimelineQuery(message?.content);
      if (!text) continue;
      prompts.push({ text });
    }

    return prompts;
  }

  return {
    buildTimelineCopyText,
    buildTimelineEntry,
    buildTimelineEntryKey,
    extractTimelinePromptsFromMessages,
    findTimelineEntryByKey,
    findTimelineEntryByTimelineId,
    findTimelineEntryByQuery,
    mergeTimelinePromptSnapshots,
    normalizeTimelineQuery
  };
});
