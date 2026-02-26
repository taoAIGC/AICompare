/**
 * Tests for pure functions extracted from iframe/inject.js.
 *
 * These functions are re-implemented here for testing since inject.js
 * uses globals extensively and runs in a content-script context.
 */

// --- Extracted pure functions ---

function cleanExtractedText(text) {
  if (!text) return '';

  text = text.replace(/\s+/g, ' ').trim();

  const unwantedPatterns = [
    /^Loading\.\.\.$/i,
    /^Please wait\.\.\.$/i,
    /^Generating\.\.\.$/i,
    /^Thinking\.\.\.$/i,
    /^Processing\.\.\.$/i,
  ];

  for (const pattern of unwantedPatterns) {
    text = text.replace(pattern, '');
  }

  return text.trim();
}

function convertHtmlToMarkdown(html) {
  try {
    let markdown = html
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
      .replace(/<pre[^>]*><code[^>]*>(.*?)<\/code><\/pre>/gi, '```\n$1\n```')
      .replace(/<ul[^>]*>(.*?)<\/ul>/gis, (match, content) => {
        return content.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n') + '\n';
      })
      .replace(/<ol[^>]*>(.*?)<\/ol>/gis, (_match, content) => {
        let counter = 1;
        return content.replace(/<li[^>]*>(.*?)<\/li>/gi, (_m, liContent) => `${counter++}. ${liContent}\n`) + '\n';
      })
      .replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n')
      .replace(/<br[^>]*>/gi, '\n')
      .replace(/<table[^>]*>(.*?)<\/table>/gis, (match, content) => {
        const headerMatch = content.match(/<thead[^>]*>(.*?)<\/thead>/is);
        const bodyMatch = content.match(/<tbody[^>]*>(.*?)<\/tbody>/is);
        if (headerMatch && bodyMatch) {
          const headers = headerMatch[1].match(/<th[^>]*>(.*?)<\/th>/gi) || [];
          const headerRow = headers.map((h) => h.replace(/<[^>]*>/g, '').trim()).join(' | ');
          const rows = bodyMatch[1].match(/<tr[^>]*>(.*?)<\/tr>/gi) || [];
          const dataRows = rows.map((row) => {
            const cells = row.match(/<td[^>]*>(.*?)<\/td>/gi) || [];
            return cells.map((cell) => cell.replace(/<[^>]*>/g, '').trim()).join(' | ');
          });
          return `\n${headerRow}\n${headers.map(() => '---').join(' | ')}\n${dataRows.join('\n')}\n\n`;
        }
        return match;
      })
      .replace(/<[^>]*>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return markdown;
  } catch (error) {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    return tempDiv.textContent || tempDiv.innerText || '';
  }
}

function createElementFromConfig(config, query) {
  const element = document.createElement(config.tag);

  if (config.attributes) {
    Object.entries(config.attributes).forEach(([key, value]) => {
      element.setAttribute(key, value);
    });
  }

  if (config.text) {
    const text = config.text.replace(/\$query/g, query);
    element.textContent = text;
  }

  if (config.html) {
    const html = config.html.replace(/\$query/g, query);
    element.innerHTML = html;
  }

  if (config.children && Array.isArray(config.children)) {
    config.children.forEach((childConfig) => {
      const childElement = createElementFromConfig(childConfig, query);
      element.appendChild(childElement);
    });
  }

  return element;
}

function getFileExtensionFromMimeTypeSync(mimeType) {
  const basicMappings = {
    'application/pdf': 'pdf',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'text/plain': 'txt',
    Files: 'file',
  };
  return basicMappings[mimeType] || 'bin';
}

// --- Tests ---

describe('cleanExtractedText', () => {
  test('returns empty string for null', () => {
    expect(cleanExtractedText(null)).toBe('');
  });

  test('returns empty string for undefined', () => {
    expect(cleanExtractedText(undefined)).toBe('');
  });

  test('returns empty string for empty string', () => {
    expect(cleanExtractedText('')).toBe('');
  });

  test('trims whitespace', () => {
    expect(cleanExtractedText('  hello world  ')).toBe('hello world');
  });

  test('collapses multiple spaces', () => {
    expect(cleanExtractedText('hello    world')).toBe('hello world');
  });

  test('collapses newlines to spaces', () => {
    expect(cleanExtractedText('hello\n\nworld')).toBe('hello world');
  });

  test('removes "Loading..." text', () => {
    expect(cleanExtractedText('Loading...')).toBe('');
  });

  test('removes "Please wait..." text', () => {
    expect(cleanExtractedText('Please wait...')).toBe('');
  });

  test('removes "Generating..." text', () => {
    expect(cleanExtractedText('Generating...')).toBe('');
  });

  test('removes "Thinking..." text', () => {
    expect(cleanExtractedText('Thinking...')).toBe('');
  });

  test('removes "Processing..." text', () => {
    expect(cleanExtractedText('Processing...')).toBe('');
  });

  test('case-insensitive pattern removal', () => {
    expect(cleanExtractedText('LOADING...')).toBe('');
    expect(cleanExtractedText('loading...')).toBe('');
  });

  test('preserves meaningful content', () => {
    expect(cleanExtractedText('Hello, I am an AI assistant.')).toBe(
      'Hello, I am an AI assistant.'
    );
  });

  test('preserves Loading inside longer text', () => {
    expect(cleanExtractedText('The model is Loading... please wait')).toBe(
      'The model is Loading... please wait'
    );
  });
});

describe('convertHtmlToMarkdown', () => {
  test('converts h1 to markdown heading', () => {
    expect(convertHtmlToMarkdown('<h1>Title</h1>')).toBe('# Title');
  });

  test('converts h2 to markdown heading', () => {
    expect(convertHtmlToMarkdown('<h2>Subtitle</h2>')).toBe('## Subtitle');
  });

  test('converts h3 to markdown heading', () => {
    expect(convertHtmlToMarkdown('<h3>Section</h3>')).toBe('### Section');
  });

  test('converts strong to bold', () => {
    expect(convertHtmlToMarkdown('<strong>bold text</strong>')).toBe('**bold text**');
  });

  test('converts b to bold', () => {
    expect(convertHtmlToMarkdown('<b>bold text</b>')).toBe('**bold text**');
  });

  test('converts em to italic', () => {
    expect(convertHtmlToMarkdown('<em>italic text</em>')).toBe('*italic text*');
  });

  test('converts links', () => {
    expect(convertHtmlToMarkdown('<a href="https://example.com">link</a>')).toBe(
      '[link](https://example.com)'
    );
  });

  test('converts inline code', () => {
    expect(convertHtmlToMarkdown('<code>const x = 1</code>')).toBe('`const x = 1`');
  });

  test('converts paragraphs', () => {
    const result = convertHtmlToMarkdown('<p>First paragraph</p><p>Second paragraph</p>');
    expect(result).toContain('First paragraph');
    expect(result).toContain('Second paragraph');
  });

  test('converts br to newline', () => {
    expect(convertHtmlToMarkdown('line1<br>line2')).toBe('line1\nline2');
  });

  test('converts unordered list', () => {
    const result = convertHtmlToMarkdown('<ul><li>item 1</li><li>item 2</li></ul>');
    expect(result).toContain('- item 1');
    expect(result).toContain('- item 2');
  });

  test('converts ordered list', () => {
    const result = convertHtmlToMarkdown('<ol><li>first</li><li>second</li></ol>');
    expect(result).toContain('1. first');
    expect(result).toContain('2. second');
  });

  test('strips unknown HTML tags', () => {
    expect(convertHtmlToMarkdown('<div><span>text</span></div>')).toBe('text');
  });

  test('collapses excessive newlines', () => {
    const result = convertHtmlToMarkdown('<p>a</p><p>b</p><p>c</p>');
    expect(result).not.toMatch(/\n{3,}/);
  });

  test('handles empty HTML', () => {
    expect(convertHtmlToMarkdown('')).toBe('');
  });
});

describe('createElementFromConfig', () => {
  test('creates element with tag', () => {
    const el = createElementFromConfig({ tag: 'div' }, 'test');
    expect(el.tagName).toBe('DIV');
  });

  test('creates element with attributes', () => {
    const el = createElementFromConfig(
      {
        tag: 'span',
        attributes: { 'data-lexical-text': 'true', class: 'my-class' },
      },
      'test'
    );
    expect(el.getAttribute('data-lexical-text')).toBe('true');
    expect(el.getAttribute('class')).toBe('my-class');
  });

  test('sets text content with $query replacement', () => {
    const el = createElementFromConfig({ tag: 'p', text: '$query' }, 'Hello World');
    expect(el.textContent).toBe('Hello World');
  });

  test('replaces multiple $query in text', () => {
    const el = createElementFromConfig(
      { tag: 'p', text: 'Q: $query A: $query' },
      'test'
    );
    expect(el.textContent).toBe('Q: test A: test');
  });

  test('sets HTML content with $query replacement', () => {
    const el = createElementFromConfig(
      { tag: 'div', html: '<b>$query</b>' },
      'test'
    );
    expect(el.innerHTML).toBe('<b>test</b>');
  });

  test('creates nested children', () => {
    const el = createElementFromConfig(
      {
        tag: 'div',
        children: [
          { tag: 'span', text: 'child1' },
          { tag: 'span', text: 'child2' },
        ],
      },
      ''
    );
    expect(el.children.length).toBe(2);
    expect(el.children[0].tagName).toBe('SPAN');
    expect(el.children[0].textContent).toBe('child1');
    expect(el.children[1].textContent).toBe('child2');
  });

  test('creates deeply nested structure', () => {
    const el = createElementFromConfig(
      {
        tag: 'div',
        children: [
          {
            tag: 'p',
            children: [
              { tag: 'span', text: '$query', attributes: { 'data-lexical-text': 'true' } },
            ],
          },
        ],
      },
      'deep query'
    );
    const span = el.querySelector('span');
    expect(span).not.toBeNull();
    expect(span.textContent).toBe('deep query');
    expect(span.getAttribute('data-lexical-text')).toBe('true');
  });
});

describe('getFileExtensionFromMimeType (sync fallback)', () => {
  test('returns pdf for application/pdf', () => {
    expect(getFileExtensionFromMimeTypeSync('application/pdf')).toBe('pdf');
  });

  test('returns png for image/png', () => {
    expect(getFileExtensionFromMimeTypeSync('image/png')).toBe('png');
  });

  test('returns jpg for image/jpeg', () => {
    expect(getFileExtensionFromMimeTypeSync('image/jpeg')).toBe('jpg');
  });

  test('returns txt for text/plain', () => {
    expect(getFileExtensionFromMimeTypeSync('text/plain')).toBe('txt');
  });

  test('returns file for Files type', () => {
    expect(getFileExtensionFromMimeTypeSync('Files')).toBe('file');
  });

  test('returns bin for unknown MIME type', () => {
    expect(getFileExtensionFromMimeTypeSync('application/x-unknown')).toBe('bin');
  });
});
