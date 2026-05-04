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
        mainContent = await extractElementContent(container);
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
        if (visibleResponseResult && (visibleResponseResult.content || visibleResponseResult.pending)) {
          return visibleResponseResult;
        }
      }

      if (contentExtractor.messageContainer) {
        const result = await extractMessagesWithContainer(doc, fullConfig, siteName, settings);
        if (result.content) {
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
        if (result.content) {
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
        if (result.content) {
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
      if (fallbackResult.content) {
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
          if (content) {
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
          const currentHasRequiredFeature = currentUrl && currentUrl.pathname.includes(requiredUrlFeature);
          const nextHasRequiredFeature = nextUrl.pathname.includes(requiredUrlFeature);
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
    extractDocumentContent,
    resolveDocumentUrl,
    getSiteConfigByName
  };
})(window);
