import React, { useMemo } from 'react';
import DOMPurify from 'dompurify';
import CopyButton from './CopyButton';

interface MarkdownMessageProps {
  content: string;
  testId?: string;
  onNavigateDoc?: (docPath: string) => void;
  onCommandAction?: (action: 'run' | 'pin' | 'copy', command: string, blockId: string) => void;
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

  // Extract YAML frontmatter (if present at the start)
  let frontmatterHtml = '';
  if (source.startsWith('---\n')) {
    const endIdx = source.indexOf('\n---\n', 4);
    if (endIdx !== -1) {
      const fmLines = source.slice(4, endIdx).split('\n');
      const fmPairs: string[] = [];
      for (const fmLine of fmLines) {
        const sepIdx = fmLine.indexOf(':');
        if (sepIdx !== -1) {
          const key = escapeHtml(fmLine.slice(0, sepIdx).trim());
          const val = escapeHtml(fmLine.slice(sepIdx + 1).trim());
          fmPairs.push(`<dt>${key}</dt><dd>${val}</dd>`);
        }
      }
      if (fmPairs.length > 0) {
        frontmatterHtml = `<div class="markdown-frontmatter"><dl>${fmPairs.join('')}</dl></div>`;
      }
      // Remove frontmatter from source (including the closing ---)
      source = source.slice(endIdx + 5);
    }
  }

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
  let inTaskList = false;
  let inTable: 'none' | 'header' | 'body' = 'none';

  function closeList() {
    if (inList) {
      out.push(inList === 'ul' ? '</ul>' : '</ol>');
      inList = null;
    }
    if (inTaskList) {
      out.push('</ul>');
      inTaskList = false;
    }
  }

  function closeBlockquote() {
    if (inBlockquote) {
      out.push('</blockquote>');
      inBlockquote = false;
    }
  }

  function closeTable() {
    if (inTable !== 'none') {
      if (inTable === 'body') out.push('</tbody>');
      out.push('</table></div>');
      inTable = 'none';
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code block placeholder
    if (line.trim() === BLOCK_PLACEHOLDER) {
      closeList();
      closeBlockquote();
      closeTable();
      out.push(BLOCK_PLACEHOLDER);
      continue;
    }

    // Close table if current line is not a table row
    if (inTable !== 'none' && !line.match(/^\|.+\|$/)) {
      closeTable();
    }

    // Table row detection
    const tableRowMatch = line.match(/^\|(.+)\|$/);
    if (tableRowMatch) {
      const cells = tableRowMatch[1].split('|').map(c => c.trim());
      const isSeparator = cells.length > 0 && cells.every(c => /^-+\s*$/.test(c));

      if (inTable === 'none') {
        closeList();
        closeBlockquote();
        if (isSeparator) {
          // Separator without header — treat as regular text, fall through
        } else {
          out.push('<div class="markdown-table-wrapper"><table><thead><tr>');
          for (const cell of cells) {
            out.push(`<th>${escapeHtml(cell)}</th>`);
          }
          out.push('</tr></thead>');
          inTable = 'header';
          continue;
        }
      } else if (inTable === 'header') {
        if (isSeparator) {
          // Skip separator row, move to body
          inTable = 'body';
          continue;
        } else {
          // Transition to body (no separator row)
          out.push('<tbody><tr>');
          for (const cell of cells) {
            out.push(`<td>${escapeHtml(cell)}</td>`);
          }
          out.push('</tr>');
          inTable = 'body';
          continue;
        }
      } else {
        // inTable === 'body'
        out.push('<tr>');
        for (const cell of cells) {
          out.push(`<td>${escapeHtml(cell)}</td>`);
        }
        out.push('</tr>');
        continue;
      }
    }

    // Horizontal rule
    if (/^---+\s*$/.test(line)) {
      closeList();
      closeBlockquote();
      out.push('<hr>');
      continue;
    }

    // Headers (h1-h4)
    const headerMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headerMatch) {
      closeList();
      closeBlockquote();
      closeTable();
      const level = headerMatch[1].length; // 1→h1, 2→h2, 3→h3, 4→h4
      out.push(`<h${level}>${escapeHtml(headerMatch[2])}</h${level}>`);
      continue;
    }

    // Blockquote (with callout support)
    const bqMatch = line.match(/^>\s?(.*)$/);
    if (bqMatch) {
      closeList();
      const bqContent = bqMatch[1];
      if (!inBlockquote) {
        inBlockquote = true;
        // Check for callout marker at start of content
        const calloutMatch = bqContent.match(/^\[!(NOTE|WARNING|TIP|IMPORTANT|CAUTION|INFO)\]\s*/i);
        if (calloutMatch) {
          const calloutType = calloutMatch[1].toLowerCase();
          const calloutIcons: Record<string, string> = {
            note: '\u2139\uFE0F',
            warning: '\u26A0\uFE0F',
            tip: '\uD83D\uDCA1',
            important: '\u2757',
            caution: '\uD83D\uDD25',
            info: '\u2139\uFE0F',
          };
          const icon = calloutIcons[calloutType] || '';
          out.push(`<blockquote class="markdown-callout markdown-callout-${calloutType}">`);
          out.push(`<span class="markdown-callout-label">${icon} ${calloutMatch[1]}</span>`);
          // Strip the callout marker from the content
          const rest = bqContent.replace(calloutMatch[0], '').trim();
          if (rest) {
            out.push(escapeHtml(rest));
          }
        } else {
          out.push('<blockquote>');
          out.push(escapeHtml(bqContent));
        }
      } else {
        out.push(escapeHtml(bqContent));
      }
      continue;
    } else if (inBlockquote) {
      closeBlockquote();
    }

    // Task list items
    const taskMatch = line.match(/^(\s*)[-*]\s+\[([ xX])\]\s+(.+)$/);
    if (taskMatch) {
      const checked = taskMatch[2].toLowerCase() === 'x';
      const text = taskMatch[3];
      closeBlockquote();
      if (!inTaskList) {
        closeList();
        inTaskList = true;
        out.push('<ul class="task-list">');
      }
      out.push(`<li class="task-list-item"><input type="checkbox" disabled${checked ? ' checked' : ''}><label>${escapeHtml(text)}</label></li>`);
      continue;
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

    // Not a list item — close any open list or table
    closeList();
    closeTable();

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
  closeTable();

  // 3. Apply inline formatting to the assembled HTML
  let html = out.join('\n');

  // Inline code (must come before bold/italic to avoid conflicts)
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italic (* or _)
  html = html.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<em>$1</em>');
  html = html.replace(/(?<!_)_([^_]+?)_(?!_)/g, '<em>$1</em>');

  // Links [text](url) — with data-doc-link for relative .md links
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_match: string, text: string, url: string) => {
      const isDocLink = /\.md$/i.test(url) && !/^https?:\/\//i.test(url);
      const docLinkAttr = isDocLink ? ' data-doc-link="true"' : '';
      return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener"${docLinkAttr}>${escapeHtml(text)}</a>`;
    },
  );

  // Wiki links [[link]] and [[link|alias]]
  html = html.replace(
    /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
    (_match: string, target: string, alias: string) => {
      const label = alias || target;
      const href = target;
      return `<a href="${escapeHtml(href)}" class="wiki-link" data-wiki-link="true">${escapeHtml(label)}</a>`;
    },
  );

  // 4. Inline tags (#tag) and status words outside code/pre elements
  // Protect existing code/pre elements so we don't modify their contents
  const protectedHtml: string[] = [];
  html = html.replace(/(<code[^>]*>[\s\S]*?<\/code>|<pre[^>]*>[\s\S]*?<\/pre>)/g, (match) => {
    protectedHtml.push(match);
    return `___PROTECTED_${protectedHtml.length - 1}___`;
  });

  // Inline tags: #tagName (word starting with #)
  html = html.replace(/(?<!\w)(#\w+)/g, '<span class="markdown-tag">$1</span>');

  // Status words at start of paragraph content
  html = html.replace(
    /(<p>)\s*(Status|Priority|Type):\s*(.+?)(<\/p>)/gi,
    (_match: string, openP: string, label: string, value: string, closeP: string) => {
      // Avoid double-wrapping
      if (value.includes('markdown-status')) return _match;
      return `${openP}${label}: <span class="markdown-status">${value}</span>${closeP}`;
    },
  );

  // Restore protected code/pre elements
  html = html.replace(/___PROTECTED_(\d+)___/g, (_match: string, index: string) => {
    return protectedHtml[parseInt(index, 10)];
  });

  return { html: frontmatterHtml + html, codeBlocks };
}

export default function MarkdownMessage({
  content,
  testId = 'markdown-message',
  onNavigateDoc,
  onCommandAction,
}: MarkdownMessageProps) {
  const { html, codeBlocks } = useMemo(() => markdownToHtml(content), [content]);

  // Split HTML on code-block placeholders so we can interleave React nodes
  const parts = html.split('___CODE_BLOCK___');

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    const anchor = target.closest('a');
    if (!anchor) return;

    const href = anchor.getAttribute('href');
    if (!href) return;

    // Handle wiki links
    if (anchor.hasAttribute('data-wiki-link')) {
      e.preventDefault();
      onNavigateDoc?.(href + '.md');
      return;
    }

    // Handle relative doc links
    if (anchor.hasAttribute('data-doc-link')) {
      e.preventDefault();
      onNavigateDoc?.(href);
      return;
    }
  }

  const sanitize = (dirty: string) =>
    DOMPurify.sanitize(dirty, {
      ALLOWED_TAGS: [
        'p', 'br', 'strong', 'em', 'code', 'pre',
        'h1', 'h2', 'h3', 'h4', 'h5',
        'ul', 'ol', 'li',
        'blockquote', 'a', 'hr',
        'table', 'thead', 'tbody', 'tr', 'th', 'td',
        'dl', 'dt', 'dd',
        'input', 'label', 'span', 'div',
      ],
      ALLOWED_ATTR: [
        'href', 'target', 'rel', 'data-doc-link', 'data-wiki-link', 'class',
        'type', 'disabled', 'checked',
      ],
    });

  return (
    <div className="markdown-message" data-testid={testId} onClick={handleClick}>
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
