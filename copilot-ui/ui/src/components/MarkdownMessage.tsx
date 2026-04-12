import React, { useMemo } from 'react';
import DOMPurify from 'dompurify';
import CopyButton from './CopyButton';

interface MarkdownMessageProps {
  content: string;
  testId?: string;
}

interface CodeBlock {
  id: string;
  lang: string;
  code: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Converts markdown text to HTML. Fenced code blocks are extracted into
 * a separate list so React can render CopyButton components for each.
 */
function markdownToHtml(source: string): { html: string; codeBlocks: CodeBlock[] } {
  source = source.replace(/\r\n?/g, '\n');
  const codeBlocks: CodeBlock[] = [];
  const BLOCK_PLACEHOLDER = '___CODE_BLOCK___';

  // 1. Extract fenced code blocks first so inner content is not processed
  let text = source.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang: string, code: string) => {
    const id = `cb-${codeBlocks.length}`;
    codeBlocks.push({ id, lang: lang || '', code: code.replace(/\n$/, '') });
    return `\n${BLOCK_PLACEHOLDER}\n`;
  });

  // 2. Process block-level constructs line by line
  const lines = text.split('\n');
  const out: string[] = [];
  let inList: 'ul' | 'ol' | null = null;
  let inBlockquote = false;

  function closeList() {
    if (inList) {
      out.push(inList === 'ul' ? '</ul>' : '</ol>');
      inList = null;
    }
  }

  function closeBlockquote() {
    if (inBlockquote) {
      out.push('</blockquote>');
      inBlockquote = false;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code block placeholder
    if (line.trim() === BLOCK_PLACEHOLDER) {
      closeList();
      closeBlockquote();
      out.push(BLOCK_PLACEHOLDER);
      continue;
    }

    // Horizontal rule
    if (/^---+\s*$/.test(line)) {
      closeList();
      closeBlockquote();
      out.push('<hr>');
      continue;
    }

    // Headers (# → h3, ## → h4, ### → h5)
    const headerMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headerMatch) {
      closeList();
      closeBlockquote();
      const level = headerMatch[1].length + 2; // 1→h3, 2→h4, 3→h5
      out.push(`<h${level}>${escapeHtml(headerMatch[2])}</h${level}>`);
      continue;
    }

    // Blockquote
    const bqMatch = line.match(/^>\s?(.*)$/);
    if (bqMatch) {
      closeList();
      if (!inBlockquote) {
        inBlockquote = true;
        out.push('<blockquote>');
      }
      out.push(escapeHtml(bqMatch[1]));
      continue;
    } else if (inBlockquote) {
      closeBlockquote();
    }

    // Unordered list
    const ulMatch = line.match(/^[-*]\s+(.+)$/);
    if (ulMatch) {
      if (inList !== 'ul') {
        closeList();
        inList = 'ul';
        out.push('<ul>');
      }
      out.push(`<li>${escapeHtml(ulMatch[1])}</li>`);
      continue;
    }

    // Ordered list
    const olMatch = line.match(/^\d+\.\s+(.+)$/);
    if (olMatch) {
      if (inList !== 'ol') {
        closeList();
        inList = 'ol';
        out.push('<ol>');
      }
      out.push(`<li>${escapeHtml(olMatch[1])}</li>`);
      continue;
    }

    // Not a list item — close any open list
    closeList();

    // Blank line → paragraph break
    if (line.trim() === '') {
      out.push('<br>');
      continue;
    }

    // Regular text line
    out.push(`<p>${escapeHtml(line)}</p>`);
  }

  closeList();
  closeBlockquote();

  // 3. Apply inline formatting to the assembled HTML
  let html = out.join('\n');

  // Inline code (must come before bold/italic to avoid conflicts)
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italic (* or _)
  html = html.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<em>$1</em>');
  html = html.replace(/(?<!_)_([^_]+?)_(?!_)/g, '<em>$1</em>');

  // Links [text](url)
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>',
  );

  return { html, codeBlocks };
}

export default function MarkdownMessage({
  content,
  testId = 'markdown-message',
}: MarkdownMessageProps) {
  const { html, codeBlocks } = useMemo(() => markdownToHtml(content), [content]);

  // Split HTML on code-block placeholders so we can interleave React nodes
  const parts = html.split('___CODE_BLOCK___');

  const sanitize = (dirty: string) =>
    DOMPurify.sanitize(dirty, {
      ALLOWED_TAGS: [
        'p', 'br', 'strong', 'em', 'code', 'pre',
        'h3', 'h4', 'h5',
        'ul', 'ol', 'li',
        'blockquote', 'a', 'hr',
      ],
      ALLOWED_ATTR: ['href', 'target', 'rel'],
    });

  return (
    <div className="markdown-message" data-testid={testId}>
      {parts.map((segment, idx) => (
        <React.Fragment key={idx}>
          {/* Render the HTML segment */}
          <div dangerouslySetInnerHTML={{ __html: sanitize(segment) }} />

          {/* Render the code block that follows this segment (if any) */}
          {idx < codeBlocks.length && (
            <div className="markdown-code-block" data-testid="markdown-code-block">
              <div className="markdown-code-block-header">
                <span className="markdown-code-block-lang">
                  {codeBlocks[idx].lang || 'code'}
                </span>
                <CopyButton text={codeBlocks[idx].code} testId="code-block-copy" />
              </div>
              <pre>
                <code>{codeBlocks[idx].code}</code>
              </pre>
            </div>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}
