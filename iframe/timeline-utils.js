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

  function buildTimelineEntry(entry, existingEntries = []) {
    const normalizedQuery = normalizeTimelineQuery(entry?.query);
    const occurrenceIndex = (Array.isArray(existingEntries) ? existingEntries : []).filter((item) => {
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
        .map((answer) => normalizeTimelineQuery(answer))
        .filter(Boolean);
      const content = normalizeTimelineQuery(response?.content);
      const error = normalizeTimelineQuery(response?.error);
      let bodyText = '未提取到回答';

      if (error) {
        bodyText = `提取失败：${error}`;
      } else if (content) {
        // Keep a single site-level answer block; paragraph breaks stay inside content.
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

  function mergeTimelinePromptSnapshots(snapshots = []) {
    const mergedEntries = [];
    const entryByQuery = new Map();

    for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
      const siteName = String(snapshot?.siteName || '').trim();
      const prompts = Array.isArray(snapshot?.prompts) ? snapshot.prompts : [];

      for (const prompt of prompts) {
        const query = normalizeTimelineQuery(prompt?.text);
        if (!query) continue;

        let entry = entryByQuery.get(query);
        if (!entry) {
          entry = {
            query,
            normalizedQuery: query,
            sourceSites: []
          };
          entryByQuery.set(query, entry);
          mergedEntries.push(entry);
        }

        if (siteName && !entry.sourceSites.includes(siteName)) {
          entry.sourceSites.push(siteName);
        }
      }
    }

    return mergedEntries;
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
    extractTimelinePromptsFromMessages,
    mergeTimelinePromptSnapshots,
    normalizeTimelineQuery
  };
});
