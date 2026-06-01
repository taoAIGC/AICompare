(function(root, factory) {
  const api = factory();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (root && typeof root === 'object') {
    root.AICompareMarkdownRenderer = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
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

  function escapeRegExp(value) {
    return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function sanitizeUrl(rawUrl) {
    const value = String(rawUrl || '').trim();
    if (!value) return '';
    if (/^(https?:|mailto:)/i.test(value)) {
      return value;
    }
    return '';
  }

  function renderInlineMarkdown(text) {
    const source = String(text ?? '');
    const codeTokens = [];
    let html = escapeHtml(source);

    html = html.replace(/`([^`\n]+)`/g, (_, code) => {
      const token = `__AI_COMPARE_CODE_${codeTokens.length}__`;
      codeTokens.push(`<code>${code}</code>`);
      return token;
    });

    html = html.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, alt, url, title) => {
      const safeUrl = sanitizeUrl(url);
      if (!safeUrl) {
        return escapeHtml(`![${alt}](${url})`);
      }
      const titleAttr = title ? ` title="${escapeHtmlAttribute(title)}"` : '';
      return `<img src="${escapeHtmlAttribute(safeUrl)}" alt="${escapeHtmlAttribute(alt)}"${titleAttr}>`;
    });

    html = html.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, label, url, title) => {
      const safeUrl = sanitizeUrl(url);
      if (!safeUrl) {
        return `[${label}](${url})`;
      }
      const titleAttr = title ? ` title="${escapeHtmlAttribute(title)}"` : '';
      return `<a href="${escapeHtmlAttribute(safeUrl)}" target="_blank" rel="noopener noreferrer"${titleAttr}>${label}</a>`;
    });

    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    html = html.replace(/(^|[^\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>');
    html = html.replace(/(^|[^\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');
    html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');

    codeTokens.forEach((markup, index) => {
      html = html.replace(new RegExp(escapeRegExp(`__AI_COMPARE_CODE_${index}__`), 'g'), markup);
    });

    return html;
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

  function normalizeMarkdownTableCells(cells, columnCount) {
    const normalizedCells = Array.isArray(cells) ? cells.slice(0, columnCount) : [];
    while (normalizedCells.length < columnCount) {
      normalizedCells.push('');
    }
    return normalizedCells;
  }

  function getMarkdownTableAlignments(delimiterCells) {
    return delimiterCells.map((cell) => {
      const normalizedCell = String(cell || '').trim();
      if (/^:-+:$/.test(normalizedCell)) {
        return 'center';
      }
      if (/^-+:$/.test(normalizedCell)) {
        return 'right';
      }
      if (/^:-+$/.test(normalizedCell)) {
        return 'left';
      }
      return '';
    });
  }

  function looksLikeMarkdownTableRow(line) {
    const trimmed = String(line || '').trim();
    return Boolean(trimmed) && trimmed.includes('|');
  }

  function buildMarkdownTableCellHtml(tagName, cell, align = '') {
    const styleAttr = align ? ` style="text-align:${escapeHtmlAttribute(align)};"` : '';
    return `<${tagName}${styleAttr}>${renderInlineMarkdown(cell)}</${tagName}>`;
  }

  function renderMarkdownTable(headerCells, alignments, bodyRows = []) {
    const columnCount = Math.max(
      Array.isArray(headerCells) ? headerCells.length : 0,
      Array.isArray(alignments) ? alignments.length : 0,
      ...(Array.isArray(bodyRows) ? bodyRows.map((row) => Array.isArray(row) ? row.length : 0) : [0])
    );

    if (!columnCount) {
      return '';
    }

    const normalizedHeaderCells = normalizeMarkdownTableCells(headerCells, columnCount);
    const normalizedAlignments = normalizeMarkdownTableCells(alignments, columnCount);
    const normalizedBodyRows = (Array.isArray(bodyRows) ? bodyRows : [])
      .map((row) => normalizeMarkdownTableCells(row, columnCount));

    const headerHtml = normalizedHeaderCells
      .map((cell, index) => buildMarkdownTableCellHtml('th', cell, normalizedAlignments[index] || ''))
      .join('');
    const bodyHtml = normalizedBodyRows.length
      ? `<tbody>${normalizedBodyRows.map((row) => (
          `<tr>${row.map((cell, index) => buildMarkdownTableCellHtml('td', cell, normalizedAlignments[index] || '')).join('')}</tr>`
        )).join('')}</tbody>`
      : '';

    return `<table><thead><tr>${headerHtml}</tr></thead>${bodyHtml}</table>`;
  }

  function renderMarkdownToHtml(markdown) {
    const source = normalizeMarkdownLineBreaks(markdown).trim();
    if (!source) {
      return '';
    }

    const lines = source.split('\n');
    const blocks = [];
    let paragraphLines = [];
    let listType = null;
    let listItems = [];
    let inCodeBlock = false;
    let codeFence = '';
    let codeLang = '';
    let codeLines = [];
    let blockquoteLines = [];

    function flushParagraph() {
      if (!paragraphLines.length) return;
      const renderedParagraph = renderInlineMarkdown(paragraphLines.join('\n')).replace(/\n/g, '<br>');
      blocks.push(`<p>${renderedParagraph}</p>`);
      paragraphLines = [];
    }

    function flushList() {
      if (!listType || !listItems.length) {
        listType = null;
        listItems = [];
        return;
      }
      const tag = listType === 'ol' ? 'ol' : 'ul';
      const itemsHtml = listItems.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join('');
      blocks.push(`<${tag}>${itemsHtml}</${tag}>`);
      listType = null;
      listItems = [];
    }

    function flushBlockquote() {
      if (!blockquoteLines.length) return;
      const content = renderMarkdownToHtml(blockquoteLines.join('\n'));
      blocks.push(`<blockquote>${content}</blockquote>`);
      blockquoteLines = [];
    }

    function flushCodeBlock() {
      if (!inCodeBlock) return;
      const languageClass = codeLang ? ` class="language-${escapeHtmlAttribute(codeLang)}"` : '';
      blocks.push(`<pre><code${languageClass}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
      inCodeBlock = false;
      codeFence = '';
      codeLang = '';
      codeLines = [];
    }

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (inCodeBlock) {
        if (line.startsWith(codeFence)) {
          flushCodeBlock();
        } else {
          codeLines.push(line);
        }
        continue;
      }

      const fenceMatch = line.match(/^(```+|~~~+)\s*([\w-]+)?\s*$/);
      if (fenceMatch) {
        flushParagraph();
        flushList();
        flushBlockquote();
        inCodeBlock = true;
        codeFence = fenceMatch[1];
        codeLang = String(fenceMatch[2] || '').trim();
        codeLines = [];
        continue;
      }

      const trimmed = line.trim();
      if (!trimmed) {
        flushParagraph();
        flushList();
        flushBlockquote();
        continue;
      }

      if (isMarkdownTableStart(line, lines[index + 1] || '')) {
        flushParagraph();
        flushList();
        flushBlockquote();

        const headerCells = splitMarkdownTableRow(line);
        const delimiterCells = splitMarkdownTableRow(lines[index + 1] || '');
        const alignments = getMarkdownTableAlignments(delimiterCells);
        const bodyRows = [];
        index += 2;

        while (index < lines.length) {
          const rowLine = lines[index];
          if (!looksLikeMarkdownTableRow(rowLine)) {
            index -= 1;
            break;
          }
          bodyRows.push(splitMarkdownTableRow(rowLine));
          index += 1;
        }

        blocks.push(renderMarkdownTable(headerCells, alignments, bodyRows));
        continue;
      }

      const blockquoteMatch = line.match(/^\s*>\s?(.*)$/);
      if (blockquoteMatch) {
        flushParagraph();
        flushList();
        blockquoteLines.push(blockquoteMatch[1]);
        continue;
      }
      flushBlockquote();

      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        flushParagraph();
        flushList();
        const level = headingMatch[1].length;
        blocks.push(`<h${level}>${renderInlineMarkdown(headingMatch[2].trim())}</h${level}>`);
        continue;
      }

      if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
        flushParagraph();
        flushList();
        blocks.push('<hr>');
        continue;
      }

      const orderedListMatch = line.match(/^\s*\d+\.\s+(.+)$/);
      if (orderedListMatch) {
        flushParagraph();
        if (listType && listType !== 'ol') {
          flushList();
        }
        listType = 'ol';
        listItems.push(orderedListMatch[1].trim());
        continue;
      }

      const unorderedListMatch = line.match(/^\s*[-*+]\s+(.+)$/);
      if (unorderedListMatch) {
        flushParagraph();
        if (listType && listType !== 'ul') {
          flushList();
        }
        listType = 'ul';
        listItems.push(unorderedListMatch[1].trim());
        continue;
      }

      flushList();
      paragraphLines.push(trimmed);
    }

    flushBlockquote();
    flushParagraph();
    flushList();
    flushCodeBlock();

    return blocks.join('');
  }

  return {
    escapeHtml,
    renderMarkdownToHtml
  };
});
