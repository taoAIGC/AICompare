(function (global) {
  'use strict';

  function toArray(value) {
    if (Array.isArray(value)) {
      return value.map((item) => String(item || '').trim()).filter(Boolean);
    }
    if (typeof value === 'string' && value.trim()) {
      return [value.trim()];
    }
    return [];
  }

  function safeQueryAll(root, selector) {
    if (!root || !selector) return [];
    try {
      return Array.from(root.querySelectorAll(selector));
    } catch (_) {
      return [];
    }
  }

  function shouldExcludeNode(node, excludeSelectors) {
    return toArray(excludeSelectors).some((selector) => {
      try {
        return node.matches(selector) || node.closest(selector);
      } catch (_) {
        return false;
      }
    });
  }

  function matchesOrContains(node, selector) {
    if (!node || !selector) return false;
    try {
      return node.matches(selector) || !!node.querySelector(selector);
    } catch (_) {
      return false;
    }
  }

  function matchesConfiguredPatterns(text, patternConfigs) {
    const normalizedText = String(text || '');
    return toArray(patternConfigs).some((patternConfig) => {
      try {
        return new RegExp(patternConfig, 'i').test(normalizedText);
      } catch (_) {
        return false;
      }
    });
  }

  function looksLikeConfiguredShellContent(content, siteConfig, contentExtractor) {
    const normalized = String(content || '').trim();
    if (!normalized) return false;

    const runtimeConfig = siteConfig?.openclawRuntime || {};
    const pendingShellConfig = runtimeConfig.pendingShell || {};
    const shellSignals = toArray(pendingShellConfig.signals);
    const shellPatterns = toArray(contentExtractor?.latestVisibleResponse?.shellPatterns);

    if (shellSignals.length === 0 && shellPatterns.length === 0) {
      return false;
    }

    const matchedSignals = shellSignals.filter((signal) => normalized.includes(signal));
    const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean);
    const likelyTitleList = lines.length >= (Number(pendingShellConfig.likelyTitleListMinLines) || 8)
      && lines.every((line) => line.length <= (Number(pendingShellConfig.likelyTitleListMaxLineLength) || 24));

    const shellBySignals = shellSignals.length > 0 && (
      matchedSignals.length >= (Number(pendingShellConfig.minMatches) || 3)
      || (matchedSignals.length >= (Number(pendingShellConfig.fallbackMinMatches) || 2) && likelyTitleList)
    );
    const shellByPatterns = shellPatterns.length > 0 && matchesConfiguredPatterns(normalized, shellPatterns);

    return shellBySignals || shellByPatterns;
  }

  function cleanExtractedText(text) {
    if (!text) return '';

    text = String(text).replace(/\r\n/g, '\n');
    text = text
      .split('\n')
      .map((line) => line.replace(/[ \t]+/g, ' ').trim())
      .join('\n');

    text = text.replace(/\n{3,}/g, '\n\n').trim();

    const unwantedPatterns = [
      /^Loading\.\.\.$/i,
      /^Please wait\.\.\.$/i,
      /^Generating\.\.\.$/i,
      /^Thinking\.\.\.$/i,
      /^Processing\.\.\.$/i
    ];

    for (const pattern of unwantedPatterns) {
      text = text.replace(pattern, '');
    }

    const unwantedLinePatterns = [
      /^window\.__oai_/i,
      /^requestAnimationFrame\(/i,
      /^Cookie Preferences\.?$/i,
      /^Free offer$/i,
      /^Open sidebar$/i,
      /^Show moreShow less$/i
    ];

    text = text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => {
        if (!line) return true;
        return !unwantedLinePatterns.some((pattern) => pattern.test(line));
      })
      .join('\n');

    text = text.replace(/window\.__oai_[\s\S]*?(?=\n{2,}|$)/gi, '').trim();
    text = text.replace(/^思考了\s*\d+(?:\.\d+)?\s*(?:ms|毫秒|s|秒)\s*/i, '');
    text = text.replace(/(^|\n)\d+\s*sources?\s+\d+\s*(?:ms|毫秒)\s*(?=\n|$)/gi, '$1');
    text = text.replace(/(^|\n)(?:思考了\s*)?\d+(?:\.\d+)?\s*(?:ms|毫秒|s|秒)\s*(?=\n|$)/gi, '$1');
    text = text.replace(/(^|\n)\d+\s*(?:ms|毫秒)\s*(?=\n|$)/gi, '$1');
    text = text.replace(/\n{3,}/g, '\n\n').trim();

    return text.trim();
  }

  function looksLikePlaceholderAnswerContent(content) {
    const normalized = cleanExtractedText(String(content || ''));
    if (!normalized) return true;

    const stripped = normalized
      .replace(/```[\s\S]*?```/g, '')
      .replace(/```+/g, '')
      .replace(/`+/g, '')
      .replace(/^[>\-*•\s]+/gm, '')
      .replace(/[|_~#()[\]{}:.,，。！？!?;；、-]+/g, '')
      .replace(/\s+/g, '')
      .trim();

    if (!stripped) {
      return true;
    }

    return !/[A-Za-z0-9\u4e00-\u9fff]/.test(stripped);
  }

  function convertHtmlToMarkdown(html, ownerDocument) {
    try {
      if (!html || typeof html !== 'string') return '';

      const doc = ownerDocument || global.document;
      const tempDiv = doc.createElement('div');
      tempDiv.innerHTML = html;
      tempDiv.querySelectorAll('script, style, noscript, svg, button').forEach((node) => node.remove());

      return tempDiv.innerHTML
        .replace(/<pre[^>]*><code[^>]*class="[^"]*language-([^"]*)"[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '```$1\n$2\n```\n\n')
        .replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '```\n$1\n```\n\n')
        .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '```\n$1\n```\n\n')
        .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n')
        .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n')
        .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n')
        .replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n\n')
        .replace(/<h5[^>]*>(.*?)<\/h5>/gi, '##### $1\n\n')
        .replace(/<h6[^>]*>(.*?)<\/h6>/gi, '###### $1\n\n')
        .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
        .replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**')
        .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
        .replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*')
        .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')
        .replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`')
        .replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (match, content) => content.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n') + '\n')
        .replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (match, content) => {
          let counter = 1;
          return content.replace(/<li[^>]*>(.*?)<\/li>/gi, (liMatch, itemContent) => `${counter++}. ${itemContent}\n`) + '\n';
        })
        .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (match, content) => {
          return content.split('\n').map((line) => `> ${line.trim()}`).join('\n') + '\n\n';
        })
        .replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (match, content) => {
          const rows = content.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
          if (!rows || rows.length === 0) return content;

          let tableMarkdown = '';
          let isFirstRow = true;
          for (const row of rows) {
            const cells = row.match(/<t[hd][^>]*>(.*?)<\/t[hd]>/gi);
            if (!cells) continue;
            const cellContents = cells.map((cell) => cell.replace(/<t[hd][^>]*>(.*?)<\/t[hd]>/gi, '$1').trim());
            tableMarkdown += `| ${cellContents.join(' | ')} |\n`;
            if (isFirstRow) {
              tableMarkdown += '|' + ' --- |'.repeat(cellContents.length) + '\n';
              isFirstRow = false;
            }
          }
          return tableMarkdown + '\n';
        })
        .replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n')
        .replace(/<div[^>]*>(.*?)<\/div>/gi, '$1\n')
        .replace(/<br[^>]*\/?>/gi, '\n')
        .replace(/<hr[^>]*\/?>/gi, '\n---\n\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    } catch (_) {
      try {
        const doc = ownerDocument || global.document;
        const tempDiv = doc.createElement('div');
        tempDiv.innerHTML = html;
        return tempDiv.textContent || tempDiv.innerText || '';
      } catch (_) {
        return String(html || '');
      }
    }
  }

  async function waitForContentLoad(element, timeout) {
    const maxWait = Number.isFinite(timeout) ? timeout : 1000;
    return new Promise((resolve) => {
      const startTime = Date.now();
      const initialContent = element.textContent || element.innerText || '';
      if (initialContent.trim().length > 20) {
        resolve();
        return;
      }

      const checkContent = () => {
        const currentContent = element.textContent || element.innerText || '';
        const hasContent = currentContent.trim().length > 10;
        const isTimeout = Date.now() - startTime > maxWait;

        if (hasContent || isTimeout) {
          resolve();
        } else {
          setTimeout(checkContent, 100);
        }
      };

      checkContent();
    });
  }

  async function extractElementContent(element) {
    let text = '';

    try {
      const ownerDocument = element?.ownerDocument || global.document;
      const isMarkdownContainer = element.classList?.contains('markdown') ||
        element.classList?.contains('response-content-markdown') ||
        element.classList?.contains('prose');

      if (isMarkdownContainer) {
        const sanitized = element.cloneNode(true);
        sanitized.querySelectorAll('script, style, noscript, svg, button').forEach((node) => node.remove());
        const html = sanitized.innerHTML || '';
        text = html.trim() ? convertHtmlToMarkdown(html, ownerDocument) : (element.textContent || element.innerText || '');
      } else if (element.dataset?.markdown) {
        text = element.dataset.markdown;
      } else if (element.getAttribute && element.getAttribute('data-markdown')) {
        text = element.getAttribute('data-markdown');
      } else {
        const sanitized = element.cloneNode(true);
        sanitized.querySelectorAll('script, style, noscript, svg, button').forEach((node) => node.remove());
        const html = sanitized.innerHTML || '';
        text = html.trim() ? convertHtmlToMarkdown(html, ownerDocument) : (element.textContent || element.innerText || '');
      }

      text = cleanExtractedText(text);
    } catch (_) {
      text = cleanExtractedText(element?.textContent || element?.innerText || '');
    }

    return text;
  }

  function uniqueSegments(segments) {
    const results = [];
    const seen = new Set();

    segments.forEach((segment) => {
      const normalized = cleanExtractedText(segment);
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      results.push(normalized);
    });

    return results;
  }

  async function extractWithSelectors(doc, selectors, options) {
    const settings = options || {};
    const searchRoot = settings.searchRoot || doc;
    const maxMatches = Number.isFinite(settings.maxMatches) ? settings.maxMatches : null;
    const excludeSelectors = [
      'nav',
      'header',
      'footer',
      '.sidebar',
      '.menu',
      ...toArray(settings.excludeSelectors)
    ];

    const selectorList = toArray(selectors);
    for (const selector of selectorList) {
      const elements = safeQueryAll(searchRoot, selector);
      if (!elements.length) continue;

      const targetElements = maxMatches && elements.length > maxMatches
        ? elements.slice(-maxMatches)
        : elements;

      const segments = [];
      for (const element of targetElements) {
        if (shouldExcludeNode(element, excludeSelectors)) continue;
        await waitForContentLoad(element, settings.waitTimeoutMs);
        const text = await extractElementContent(element);
        if (text) {
          segments.push(text);
        }
      }

      const deduped = uniqueSegments(segments);
      if (deduped.length > 0) {
        return {
          content: deduped.join('\n\n').trim(),
          messageCount: deduped.length
        };
      }
    }

    return {
      content: '',
      messageCount: 0
    };
  }

  async function extractMessagesWithContainer(doc, siteConfig, siteName, options) {
    const settings = options || {};
    const contentExtractor = siteConfig?.contentExtractor || siteConfig || {};
    const searchRoot = contentExtractor.containerSelector
      ? (doc.querySelector(contentExtractor.containerSelector) || doc)
      : doc;

    if (contentExtractor.editModeCheck) {
      const editElements = safeQueryAll(searchRoot, contentExtractor.editModeCheck);
      if (editElements.length > 0) {
        return {
          content: '',
          messageCount: 0,
          pending: true,
          extractionMethod: 'edit_mode'
        };
      }
    }

    let messageContainers = safeQueryAll(searchRoot, contentExtractor.messageContainer || '');
    if (messageContainers.length === 0) {
      return {
        content: '',
        messageCount: 0
      };
    }

    if (contentExtractor.exportLatestOnly && messageContainers.length > 1) {
      messageContainers = messageContainers.slice(-1);
    }

    const segments = [];
    const innerSelectors = toArray(contentExtractor.contentSelectors);
    for (const container of messageContainers) {
      if (shouldExcludeNode(container, contentExtractor.excludeSelectors)) continue;
      if (contentExtractor.userMessageSelector && matchesOrContains(container, contentExtractor.userMessageSelector)) {
        continue;
      }

      let mainContent = '';
      for (const selector of innerSelectors) {
        const innerElements = safeQueryAll(container, selector);
        if (!innerElements.length) continue;
        for (const element of innerElements) {
          const text = await extractElementContent(element);
          if (text) {
            mainContent = text;
            break;
          }
        }
        if (mainContent) break;
      }

      if (!mainContent) {
        const fallbackContent = await extractElementContent(container);
        if (!looksLikeConfiguredShellContent(fallbackContent, siteConfig, contentExtractor)) {
          mainContent = fallbackContent;
        }
      }

      if (mainContent) {
        segments.push(mainContent);
      }
    }

    const deduped = uniqueSegments(segments);
    return {
      content: deduped.join('\n\n---\n\n').trim(),
      messageCount: deduped.length,
      extractionMethod: 'messageContainer'
    };
  }

  function normalizeTimelineComparableText(text) {
    return cleanExtractedText(String(text || '').replace(/\u200B/g, '')).replace(/\s+/g, ' ').trim();
  }

  function normalizeTimelineDisplayText(text) {
    return cleanExtractedText(String(text || '').replace(/\u200B/g, '')).trim();
  }

  function normalizeTimelineMatchText(text) {
    return normalizeTimelineComparableText(text)
      .normalize('NFKC')
      .replace(/[\u00A0\u200B-\u200F\uFEFF\s]+/g, '')
      .trim();
  }

  function sortNodesByDocumentOrder(nodes) {
    return [...nodes].sort((a, b) => {
      if (a === b) return 0;
      const relation = a.compareDocumentPosition(b);
      return relation & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
  }

  function pruneNestedTimelineCandidates(nodes) {
    const orderedNodes = sortNodesByDocumentOrder(nodes || []);
    return orderedNodes.filter((node, index) => {
      return !orderedNodes.some((otherNode, otherIndex) => {
        if (index === otherIndex || !otherNode || otherNode === node) return false;
        return node.contains(otherNode);
      });
    });
  }

  function isNodeAfter(startNode, candidateNode) {
    if (!startNode || !candidateNode || startNode === candidateNode) return false;
    return Boolean(startNode.compareDocumentPosition(candidateNode) & Node.DOCUMENT_POSITION_FOLLOWING);
  }

  function isNodeBefore(candidateNode, endNode) {
    if (!candidateNode || !endNode || candidateNode === endNode) return false;
    return Boolean(candidateNode.compareDocumentPosition(endNode) & Node.DOCUMENT_POSITION_FOLLOWING);
  }

  function isPromptRelatedNode(node, promptRecords) {
    if (!node) return false;
    return (promptRecords || []).some((record) => {
      const promptNode = record?.container || record?.anchor || null;
      if (!promptNode) return false;
      return promptNode === node || promptNode.contains(node) || node.contains(promptNode);
    });
  }

  function getTimelinePromptConfig(siteConfig) {
    const fullConfig = siteConfig || {};
    const userPrompt = fullConfig.userPrompt || {};
    const contentExtractor = fullConfig.contentExtractor || {};

    return {
      containerSelectors: toArray(userPrompt.containerSelector || contentExtractor.userMessageSelector),
      textSelector: userPrompt.textSelector || '',
      messageNodeSelector: userPrompt.messageNodeSelector || '',
      requireMessageNode: userPrompt.requireMessageNode === true
    };
  }

  function resolveTimelinePromptAnchor(container, promptConfig) {
    if (!container) return null;
    if (promptConfig?.messageNodeSelector) {
      const anchoredNode = container.closest(promptConfig.messageNodeSelector);
      if (anchoredNode) return anchoredNode;
      if (promptConfig.requireMessageNode) return null;
    }
    return container;
  }

  function collectTimelinePromptRecords(doc, siteConfig) {
    const promptConfig = getTimelinePromptConfig(siteConfig);
    const seenContainers = new Set();
    const promptRecords = [];

    promptConfig.containerSelectors.forEach((selector) => {
      safeQueryAll(doc, selector).forEach((container) => {
        if (seenContainers.has(container)) return;
        seenContainers.add(container);

        const anchor = resolveTimelinePromptAnchor(container, promptConfig);
        if (!anchor) return;

        const textNode = promptConfig.textSelector ? container.querySelector(promptConfig.textSelector) : container;
        const text = normalizeTimelineComparableText(textNode?.textContent || container.textContent || '');
        if (!text) return;

        promptRecords.push({
          container,
          anchor,
          text,
          normalizedText: text
        });
      });
    });

    const sortedAnchors = sortNodesByDocumentOrder(promptRecords.map((item) => item.anchor));
    const orderedRecords = sortedAnchors.map((anchor) => {
      return promptRecords.find((record) => record.anchor === anchor) || null;
    }).filter(Boolean);

    const dedupedRecords = [];
    for (const record of orderedRecords) {
      const isDuplicate = dedupedRecords.some((existing) => {
        if (existing.normalizedText !== record.normalizedText) return false;
        return existing.anchor === record.anchor
          || existing.anchor.contains(record.anchor)
          || record.anchor.contains(existing.anchor);
      });

      if (!isDuplicate) {
        dedupedRecords.push(record);
      }
    }

    return dedupedRecords.map((item, index) => ({
      ...item,
      orderIndex: index
    }));
  }

  function findTimelinePromptRecord(promptRecords, query, occurrenceIndex) {
    const normalizedQuery = normalizeTimelineComparableText(query);
    if (!normalizedQuery) return null;

    const exactMatches = (promptRecords || []).filter((item) => item.normalizedText === normalizedQuery);
    if (exactMatches.length > 0) {
      return exactMatches[Math.min(Math.max(occurrenceIndex || 0, 0), exactMatches.length - 1)];
    }

    const fuzzyMatches = (promptRecords || []).filter((item) => {
      return item.normalizedText.includes(normalizedQuery) || normalizedQuery.includes(item.normalizedText);
    });
    if (fuzzyMatches.length > 0) {
      return fuzzyMatches[Math.min(Math.max(occurrenceIndex || 0, 0), fuzzyMatches.length - 1)];
    }

    const compactQuery = normalizeTimelineMatchText(query);
    if (!compactQuery) return null;

    const compactMatches = (promptRecords || []).filter((item) => {
      const compactText = normalizeTimelineMatchText(item.normalizedText);
      return compactText.includes(compactQuery) || compactQuery.includes(compactText);
    });
    if (compactMatches.length > 0) {
      return compactMatches[Math.min(Math.max(occurrenceIndex || 0, 0), compactMatches.length - 1)];
    }

    return null;
  }

  function collectTimelineResponseCandidates(doc, contentExtractor) {
    const selectors = [
      ...toArray(contentExtractor?.contentSelectors),
      ...toArray(contentExtractor?.fallbackSelectors),
      ...toArray(contentExtractor?.selectors)
    ];
    const excludeSelectors = [
      'nav',
      'header',
      'footer',
      '.sidebar',
      '.menu',
      ...(contentExtractor?.excludeSelectors || [])
    ];
    const seenNodes = new Set();
    const candidates = [];

    selectors.forEach((selector) => {
      safeQueryAll(doc, selector).forEach((node) => {
        if (seenNodes.has(node)) return;
        if (excludeSelectors.some((excludeSelector) => {
          try {
            return node.closest(excludeSelector);
          } catch (_) {
            return false;
          }
        })) return;
        seenNodes.add(node);
        candidates.push(node);
      });
    });

    return pruneNestedTimelineCandidates(candidates);
  }

  async function extractTimelineContentFromNodes(nodes) {
    const segments = [];
    const seenText = new Set();

    for (const node of nodes || []) {
      await waitForContentLoad(node, 300);
      const rawText = await extractElementContent(node);
      const comparableText = normalizeTimelineComparableText(rawText);
      const displayText = normalizeTimelineDisplayText(rawText);
      if (!comparableText || !displayText || seenText.has(comparableText)) continue;
      seenText.add(comparableText);
      segments.push(displayText);
    }

    return segments;
  }

  async function extractTimelineResponseFallback(doc, siteConfig) {
    const fullConfig = siteConfig || {};
    const contentExtractor = fullConfig.contentExtractor || {};

    if (contentExtractor.latestVisibleResponse) {
      const visibleResponseResult = extractLatestVisibleResponse(doc, contentExtractor);
      const visibleContent = normalizeTimelineDisplayText(visibleResponseResult?.content || '');
      if (visibleContent && visibleResponseResult?.pending !== true) {
        return {
          found: true,
          answers: [visibleContent],
          content: visibleContent,
          fallbackUsed: 'latestVisibleResponse'
        };
      }
    }

    return null;
  }

  async function extractPromptResponseForTimeline(doc, siteConfig, query, occurrenceIndex = 0) {
    const fullConfig = siteConfig || {};
    const contentExtractor = fullConfig.contentExtractor || {};
    const promptRecords = collectTimelinePromptRecords(doc, fullConfig);
    const matchedPrompt = findTimelinePromptRecord(promptRecords, query, occurrenceIndex);

    if (!matchedPrompt) {
      if (promptRecords.length === 0) {
        const fallbackResult = await extractTimelineResponseFallback(doc, fullConfig);
        if (fallbackResult) {
          return fallbackResult;
        }
      }
      return {
        found: false,
        error: 'Prompt not found'
      };
    }

    const nextPrompt = promptRecords.find((item) => item.orderIndex > matchedPrompt.orderIndex) || null;
    let responseCandidates = collectTimelineResponseCandidates(doc, contentExtractor).filter((node) => {
      if (!matchedPrompt.anchor || !node) return false;
      if (!isNodeAfter(matchedPrompt.anchor, node)) return false;
      if (nextPrompt && !isNodeBefore(node, nextPrompt.anchor)) return false;
      if (isPromptRelatedNode(node, promptRecords)) return false;
      return true;
    });

    if (responseCandidates.length === 0) {
      const fallbackNodes = [];
      toArray(contentExtractor?.messageContainer).forEach((selector) => {
        safeQueryAll(doc, selector).forEach((node) => {
          fallbackNodes.push(node);
        });
      });
      responseCandidates = sortNodesByDocumentOrder(fallbackNodes).filter((node) => {
        if (!matchedPrompt.anchor || !node) return false;
        if (!isNodeAfter(matchedPrompt.anchor, node)) return false;
        if (nextPrompt && !isNodeBefore(node, nextPrompt.anchor)) return false;
        if (isPromptRelatedNode(node, promptRecords)) return false;
        return true;
      });
    }

    if (responseCandidates.length === 0) {
      const fallbackResult = await extractTimelineResponseFallback(doc, fullConfig);
      if (fallbackResult) {
        return fallbackResult;
      }
    }

    const answers = await extractTimelineContentFromNodes(responseCandidates);
    return {
      found: true,
      answers,
      content: answers.join('\n\n').trim()
    };
  }

  function extractLatestVisibleResponse(doc, contentExtractor) {
    const visibleResponseConfig = contentExtractor?.latestVisibleResponse || {};
    const messageSelector = String(visibleResponseConfig.messageSelector || '').trim();
    if (!messageSelector) {
      return null;
    }

    const assistantMessages = safeQueryAll(doc, messageSelector);
    const lastAssistantMessage = assistantMessages.pop();
    if (!lastAssistantMessage) {
      return {
        content: '',
        messageCount: 0,
        pending: true,
        extractionMethod: 'latestVisibleResponse'
      };
    }

    const ignoredTextPatterns = toArray(visibleResponseConfig.ignoredTextPatterns).map((pattern) => {
      try {
        return new RegExp(pattern, 'i');
      } catch (_) {
        return null;
      }
    }).filter(Boolean);
    const ignoredAncestorSelectors = toArray(visibleResponseConfig.ignoredAncestorSelectors);

    const seen = new Set();
    const lines = [];
    const walker = doc.createTreeWalker(lastAssistantMessage, NodeFilter.SHOW_TEXT);
    let currentNode = walker.nextNode();

    while (currentNode) {
      const parent = currentNode.parentElement;
      const raw = currentNode.textContent || '';
      const text = raw.replace(/[ \t]+/g, ' ').trim();

      if (parent && text) {
        const rect = typeof parent.getBoundingClientRect === 'function'
          ? parent.getBoundingClientRect()
          : { width: 1, height: 1 };
        const hidden = rect.width === 0 || rect.height === 0;
        const insideIgnoredUi = ignoredAncestorSelectors.some((selector) => {
          try {
            return Boolean(parent.closest(selector));
          } catch (_) {
            return false;
          }
        });
        const looksLikeUiText = ignoredTextPatterns.some((pattern) => pattern.test(text));
        const looksLikeScript = /window\.__|__reactRouter|requestAnimationFrame|\bimport\(\"\/cdn\//.test(text);

        if (!hidden && !insideIgnoredUi && !looksLikeUiText && !looksLikeScript && !seen.has(text)) {
          seen.add(text);
          lines.push(text);
        }
      }

      currentNode = walker.nextNode();
    }

    return {
      content: cleanExtractedText(lines.join('\n\n')),
      messageCount: lines.length > 0 ? 1 : 0,
      pending: lines.length === 0,
      extractionMethod: 'latestVisibleResponse'
    };
  }

  async function extractDocumentContent(doc, siteName, siteConfig, options) {
    const settings = options || {};
    const fullConfig = siteConfig?.contentExtractor ? siteConfig : { contentExtractor: siteConfig || {} };
    const contentExtractor = fullConfig.contentExtractor || {};
    const searchRoot = contentExtractor.containerSelector ? (doc.querySelector(contentExtractor.containerSelector) || doc) : doc;
    const exportLatestOnly = contentExtractor.exportLatestOnly ? 1 : null;

    try {
      if (contentExtractor.latestVisibleResponse) {
        const visibleResponseResult = extractLatestVisibleResponse(doc, contentExtractor);
        if (visibleResponseResult?.content && !visibleResponseResult.pending && !looksLikeConfiguredShellContent(visibleResponseResult.content, fullConfig, contentExtractor) && !looksLikePlaceholderAnswerContent(visibleResponseResult.content)) {
          return visibleResponseResult;
        }
      }

      if (contentExtractor.messageContainer) {
        const result = await extractMessagesWithContainer(doc, fullConfig, siteName, settings);
        if (result.content && !looksLikePlaceholderAnswerContent(result.content)) {
          return result;
        }
      }

      if (toArray(contentExtractor.contentSelectors).length > 0) {
        const result = await extractWithSelectors(doc, contentExtractor.contentSelectors, {
          excludeSelectors: contentExtractor.excludeSelectors,
          searchRoot,
          maxMatches: exportLatestOnly,
          waitTimeoutMs: settings.waitTimeoutMs
        });
        if (result.content && !looksLikePlaceholderAnswerContent(result.content)) {
          return {
            ...result,
            extractionMethod: 'contentSelectors'
          };
        }
      }

      if (toArray(contentExtractor.selectors).length > 0) {
        const result = await extractWithSelectors(doc, contentExtractor.selectors, {
          excludeSelectors: contentExtractor.excludeSelectors,
          searchRoot,
          maxMatches: exportLatestOnly,
          waitTimeoutMs: settings.waitTimeoutMs
        });
        if (result.content && !looksLikePlaceholderAnswerContent(result.content)) {
          return {
            ...result,
            extractionMethod: 'legacy'
          };
        }
      }

      const fallbackSelectors = toArray(contentExtractor.fallbackSelectors).length > 0
        ? toArray(contentExtractor.fallbackSelectors)
        : [
            '[data-message-author-role="assistant"]',
            '.markdown',
            '.prose',
            '[class*="message"]',
            '[class*="response"]',
            '[class*="answer"]',
            '[class*="content"]',
            'main',
            'article',
            '.container'
          ];

      const fallbackResult = await extractWithSelectors(doc, fallbackSelectors, {
        excludeSelectors: contentExtractor.excludeSelectors,
        searchRoot,
        maxMatches: exportLatestOnly,
        waitTimeoutMs: settings.waitTimeoutMs
      });
      if (fallbackResult.content && !looksLikePlaceholderAnswerContent(fallbackResult.content)) {
        return {
          ...fallbackResult,
          extractionMethod: 'fallback'
        };
      }

      if (settings.includePageTextFallback !== false) {
        const pageText = doc.body ? (doc.body.textContent || doc.body.innerText || '').trim() : '';
        if (pageText) {
          const maxLength = Number.isFinite(settings.pageTextMaxLength) ? settings.pageTextMaxLength : 1000;
          const content = cleanExtractedText(pageText.slice(0, maxLength) + (pageText.length > maxLength ? '...' : ''));
          if (content && !looksLikeConfiguredShellContent(content, fullConfig, contentExtractor) && !looksLikePlaceholderAnswerContent(content)) {
            return {
              content,
              messageCount: 1,
              extractionMethod: 'page_text'
            };
          }
        }
      }

      return {
        content: '',
        messageCount: 0,
        extractionMethod: 'empty'
      };
    } catch (error) {
      return {
        content: `内容提取失败: ${error.message}`,
        messageCount: 0,
        extractionMethod: 'error',
        error
      };
    }
  }

  function safeUrl(rawUrl, baseUrl) {
    try {
      return new URL(rawUrl, baseUrl || global.location?.href || undefined);
    } catch (_) {
      return null;
    }
  }

  function resolveDocumentUrl(doc, pageUrl, siteConfig) {
    const fullConfig = siteConfig || {};
    const contentExtractor = fullConfig.contentExtractor || fullConfig || {};
    const fallbackUrl = String(pageUrl || doc?.location?.href || global.location?.href || '').trim();
    const currentUrl = safeUrl(fallbackUrl);
    const requiredUrlFeature = String(fullConfig?.historyHandler?.urlFeature || '').trim();
    const urlExtractor = contentExtractor.urlExtractor || null;

    if (urlExtractor?.alternateLinkSelector) {
      const links = safeQueryAll(doc, urlExtractor.alternateLinkSelector);
      for (const link of links) {
        const href = link.getAttribute && link.getAttribute('href');
        if (!href) continue;
        if (urlExtractor.urlPattern && !href.includes(urlExtractor.urlPattern)) continue;

        const nextUrl = safeUrl(href, fallbackUrl);
        if (!nextUrl) continue;

        const removeParams = Array.isArray(urlExtractor.removeParams) ? urlExtractor.removeParams : [];
        removeParams.forEach((param) => nextUrl.searchParams.delete(param));

        if (requiredUrlFeature) {
          const currentHasRequiredFeature = currentUrl && (
            global.SiteLaunchUtils?.urlMatchesHistoryFeature
              ? global.SiteLaunchUtils.urlMatchesHistoryFeature(currentUrl.toString(), requiredUrlFeature)
              : currentUrl.pathname.includes(requiredUrlFeature)
          );
          const nextHasRequiredFeature = global.SiteLaunchUtils?.urlMatchesHistoryFeature
            ? global.SiteLaunchUtils.urlMatchesHistoryFeature(nextUrl.toString(), requiredUrlFeature)
            : nextUrl.pathname.includes(requiredUrlFeature);
          const currentLooksMoreSpecific = currentHasRequiredFeature && currentUrl.pathname.length > nextUrl.pathname.length;
          if (!nextHasRequiredFeature || currentLooksMoreSpecific) {
            return currentUrl ? currentUrl.toString() : fallbackUrl;
          }
        }

        return nextUrl.toString();
      }
    }

    const alternateLinks = safeQueryAll(doc, 'link[rel="alternate"]');
    for (const link of alternateLinks) {
      const href = link.getAttribute && link.getAttribute('href');
      if (!href || !href.includes('chatgpt.com/c/')) continue;
      const alternateUrl = safeUrl(href, fallbackUrl);
      if (!alternateUrl) continue;
      alternateUrl.searchParams.delete('locale');
      return alternateUrl.toString();
    }

    return currentUrl ? currentUrl.toString() : fallbackUrl;
  }

  async function getSiteConfigByName(siteName) {
    const targetName = String(siteName || '').trim();
    if (!targetName) return null;

    try {
      if (global.siteDetector?.getSites) {
        const sites = await global.siteDetector.getSites();
        if (Array.isArray(sites)) {
          const matched = sites.find((site) => String(site?.name || '').trim() === targetName);
          if (matched) return matched;
        }
      }
    } catch (_) {
      // Ignore siteDetector lookup errors and fall back to getDefaultSites.
    }

    try {
      if (typeof global.getDefaultSites === 'function') {
        const sites = await global.getDefaultSites();
        if (Array.isArray(sites)) {
          return sites.find((site) => String(site?.name || '').trim() === targetName) || null;
        }
      }
    } catch (_) {
      // Ignore fallback lookup errors.
    }

    return null;
  }

  global.AICompareExtraction = {
    toArray,
    cleanExtractedText,
    convertHtmlToMarkdown,
    waitForContentLoad,
    extractElementContent,
    extractWithSelectors,
    extractMessagesWithContainer,
    matchesConfiguredPatterns,
    looksLikeConfiguredShellContent,
    looksLikePlaceholderAnswerContent,
    normalizeTimelineComparableText,
    normalizeTimelineMatchText,
    collectTimelinePromptRecords,
    findTimelinePromptRecord,
    collectTimelineResponseCandidates,
    extractTimelineContentFromNodes,
    extractPromptResponseForTimeline,
    extractDocumentContent,
    resolveDocumentUrl,
    getSiteConfigByName
  };
})(window);
