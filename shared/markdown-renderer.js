(function(root, factory) {
  const api = factory(root);

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (root && typeof root === 'object') {
    root.AICompareMarkdownRenderer = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function(root) {
  let markdownItInstance = null;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => {
      switch (char) {
        case '&': return '&amp;';
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '"': return '&quot;';
        case '\'': return '&#39;';
        default: return char;
      }
    });
  }

  function escapeHtmlAttribute(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }

  function normalizeMarkdownLineBreaks(value) {
    return String(value ?? '')
      .replace(/\r\n?/g, '\n')
      .replace(/<br\s*\/?>/gi, '\n');
  }

  function sanitizeUrl(rawUrl) {
    const value = String(rawUrl || '').trim();
    if (!value) return '';
    if (/^(https?:|mailto:)/i.test(value)) {
      return value;
    }
    return '';
  }

  function splitMarkdownTableRow(line) {
    const rawLine = String(line ?? '').trim();
    if (!rawLine.includes('|')) {
      return [];
    }

    let content = rawLine;
    if (content.startsWith('|')) {
      content = content.slice(1);
    }
    if (content.endsWith('|')) {
      content = content.slice(0, -1);
    }

    const cells = [];
    let current = '';
    let inCode = false;

    for (let index = 0; index < content.length; index += 1) {
      const char = content[index];
      const nextChar = content[index + 1] || '';

      if (char === '\\' && (nextChar === '|' || nextChar === '\\')) {
        current += nextChar;
        index += 1;
        continue;
      }

      if (char === '`') {
        inCode = !inCode;
        current += char;
        continue;
      }

      if (char === '|' && !inCode) {
        cells.push(current.trim());
        current = '';
        continue;
      }

      current += char;
    }

    cells.push(current.trim());
    return cells;
  }

  function isMarkdownTableDelimiterCell(cell) {
    return /^:?-{2,}:?$/.test(String(cell || '').trim());
  }

  function isMarkdownTableStart(headerLine, delimiterLine) {
    const headerCells = splitMarkdownTableRow(headerLine);
    const delimiterCells = splitMarkdownTableRow(delimiterLine);
    if (!headerCells.length || !delimiterCells.length) {
      return false;
    }
    if (headerCells.length !== delimiterCells.length) {
      return false;
    }
    return delimiterCells.every(isMarkdownTableDelimiterCell);
  }

  function looksLikeMarkdownTableRow(line) {
    const trimmed = String(line || '').trim();
    return Boolean(trimmed) && trimmed.includes('|');
  }

  function hasMeaningfulMarkdownTableCells(cells) {
    return (Array.isArray(cells) ? cells : []).some((cell) => String(cell || '').trim());
  }

  function compactMarkdownTables(markdown) {
    const source = normalizeMarkdownLineBreaks(markdown);
    if (!String(source || '').trim()) {
      return '';
    }

    const lines = source.split('\n');
    const compactedLines = [];

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const nextLine = lines[index + 1] || '';

      if (!isMarkdownTableStart(line, nextLine)) {
        compactedLines.push(line);
        continue;
      }

      const headerLine = line;
      const delimiterLine = nextLine;
      const headerCells = splitMarkdownTableRow(headerLine);
      const keptBodyRows = [];
      index += 2;

      while (index < lines.length) {
        const rowLine = lines[index];
        if (!looksLikeMarkdownTableRow(rowLine)) {
          index -= 1;
          break;
        }

        const rowCells = splitMarkdownTableRow(rowLine);
        if (hasMeaningfulMarkdownTableCells(rowCells)) {
          keptBodyRows.push(rowLine);
        }
        index += 1;
      }

      if (hasMeaningfulMarkdownTableCells(headerCells) || keptBodyRows.length > 0) {
        compactedLines.push(headerLine, delimiterLine, ...keptBodyRows);
      }
    }

    return compactedLines.join('\n');
  }

  function resolveMarkdownItFactory() {
    if (root && typeof root.markdownit === 'function') {
      return root.markdownit;
    }

    if (typeof module !== 'undefined' && module.exports) {
      try {
        const required = require('../vendor/markdown-it/markdown-it.min.js');
        return required?.default || required;
      } catch (error) {
        return null;
      }
    }

    return null;
  }

  function createMarkdownItRenderer() {
    const markdownItFactory = resolveMarkdownItFactory();
    if (typeof markdownItFactory !== 'function') {
      return null;
    }

    const renderer = markdownItFactory({
      html: false,
      breaks: true,
      linkify: false,
      typographer: false
    });

    renderer.validateLink = (url) => Boolean(sanitizeUrl(url));

    const defaultLinkOpen = renderer.renderer.rules.link_open
      || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

    renderer.renderer.rules.link_open = (tokens, idx, options, env, self) => {
      const hrefIndex = tokens[idx].attrIndex('href');
      const hrefValue = hrefIndex >= 0 ? tokens[idx].attrs[hrefIndex][1] : '';
      const safeUrl = sanitizeUrl(hrefValue);

      if (!safeUrl) {
        return '';
      }

      tokens[idx].attrs[hrefIndex][1] = safeUrl;
      tokens[idx].attrSet('target', '_blank');
      tokens[idx].attrSet('rel', 'noopener noreferrer');
      return defaultLinkOpen(tokens, idx, options, env, self);
    };

    const defaultImage = renderer.renderer.rules.image
      || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

    renderer.renderer.rules.image = (tokens, idx, options, env, self) => {
      const srcIndex = tokens[idx].attrIndex('src');
      const srcValue = srcIndex >= 0 ? tokens[idx].attrs[srcIndex][1] : '';
      const safeUrl = sanitizeUrl(srcValue);

      if (!safeUrl) {
        return escapeHtml(tokens[idx].content || '');
      }

      tokens[idx].attrs[srcIndex][1] = safeUrl;
      return defaultImage(tokens, idx, options, env, self);
    };

    return renderer;
  }

  function getMarkdownItRenderer() {
    if (markdownItInstance) {
      return markdownItInstance;
    }

    markdownItInstance = createMarkdownItRenderer();
    return markdownItInstance;
  }

  function renderMarkdownToHtml(markdown) {
    const normalizedSource = compactMarkdownTables(markdown).trim();
    if (!normalizedSource) {
      return '';
    }

    const renderer = getMarkdownItRenderer();
    if (!renderer || typeof renderer.render !== 'function') {
      return '';
    }

    return String(renderer.render(normalizedSource) || '').trim();
  }

  return {
    escapeHtml,
    renderMarkdownToHtml,
    sanitizeUrl
  };
});
