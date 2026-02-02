/**
 * Simple markdown renderer for chat messages.
 * Handles basic formatting without external dependencies.
 */
import { useMemo } from 'react';
import './MarkdownContent.css';

interface MarkdownContentProps {
  content: string;
}

interface ParsedBlock {
  type: 'text' | 'code' | 'inline-code';
  content: string;
  language?: string;
}

function parseMarkdown(content: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  const lines = content.split('\n');
  let currentBlock: ParsedBlock | null = null;
  let inCodeBlock = false;
  let codeLanguage = '';

  for (const line of lines) {
    // Check for code block start/end
    const codeBlockMatch = line.match(/^```(\w*)?$/);
    
    if (codeBlockMatch) {
      if (inCodeBlock) {
        // End of code block
        if (currentBlock) {
          blocks.push(currentBlock);
          currentBlock = null;
        }
        inCodeBlock = false;
        codeLanguage = '';
      } else {
        // Start of code block
        if (currentBlock) {
          blocks.push(currentBlock);
          currentBlock = null;
        }
        inCodeBlock = true;
        codeLanguage = codeBlockMatch[1] || '';
        currentBlock = {
          type: 'code',
          content: '',
          language: codeLanguage,
        };
      }
      continue;
    }

    if (inCodeBlock && currentBlock) {
      currentBlock.content += (currentBlock.content ? '\n' : '') + line;
    } else {
      if (!currentBlock || currentBlock.type !== 'text') {
        if (currentBlock) {
          blocks.push(currentBlock);
        }
        currentBlock = { type: 'text', content: '' };
      }
      currentBlock.content += (currentBlock.content ? '\n' : '') + line;
    }
  }

  if (currentBlock) {
    blocks.push(currentBlock);
  }

  return blocks;
}

function formatTextContent(text: string): React.ReactNode[] {
  const elements: React.ReactNode[] = [];
  let key = 0;

  // Process line by line for headers and lists
  const lines = text.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    
    // Headers
    const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headerMatch && headerMatch[1] && headerMatch[2]) {
      const level = headerMatch[1].length;
      const content = formatInlineContent(headerMatch[2]);
      const Tag = `h${level}` as keyof JSX.IntrinsicElements;
      elements.push(<Tag key={key++}>{content}</Tag>);
      continue;
    }

    // Unordered list
    const ulMatch = line.match(/^[-*]\s+(.+)$/);
    if (ulMatch && ulMatch[1]) {
      elements.push(
        <li key={key++} className="md-li">{formatInlineContent(ulMatch[1])}</li>
      );
      continue;
    }

    // Ordered list
    const olMatch = line.match(/^\d+\.\s+(.+)$/);
    if (olMatch && olMatch[1]) {
      elements.push(
        <li key={key++} className="md-li ordered">{formatInlineContent(olMatch[1])}</li>
      );
      continue;
    }

    // Blockquote
    const bqMatch = line.match(/^>\s?(.*)$/);
    if (bqMatch && bqMatch[1] !== undefined) {
      elements.push(
        <blockquote key={key++} className="md-blockquote">
          {formatInlineContent(bqMatch[1])}
        </blockquote>
      );
      continue;
    }

    // Empty line = paragraph break
    if (line.trim() === '') {
      elements.push(<br key={key++} />);
      continue;
    }

    // Regular text
    elements.push(
      <span key={key++} className="md-text">
        {formatInlineContent(line)}
        {i < lines.length - 1 && <br />}
      </span>
    );
  }

  return elements;
}

function formatInlineContent(text: string): React.ReactNode[] {
  let key = 0;

  let remaining = text;

  // Simple sequential processing (not perfect but works for most cases)
  // Process bold
  remaining = remaining.replace(/\*\*(.+?)\*\*/g, '___BOLD_START___$1___BOLD_END___');
  // Process italic
  remaining = remaining.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '___ITALIC_START___$1___ITALIC_END___');
  // Process inline code
  remaining = remaining.replace(/`([^`]+)`/g, '___CODE_START___$1___CODE_END___');
  // Process links
  remaining = remaining.replace(/\[(.+?)\]\((.+?)\)/g, '___LINK_START___$1___LINK_URL___$2___LINK_END___');

  // Split and render
  const parts = remaining.split(/(___(?:BOLD|ITALIC|CODE|LINK)_(?:START|END|URL)___)/);
  let i = 0;
  const result: React.ReactNode[] = [];
  
  while (i < parts.length) {
    const part = parts[i] ?? '';
    
    if (part === '___BOLD_START___') {
      const content = parts[i + 1];
      result.push(<strong key={key++}>{content}</strong>);
      i += 3; // Skip content and END
    } else if (part === '___ITALIC_START___') {
      const content = parts[i + 1];
      result.push(<em key={key++}>{content}</em>);
      i += 3;
    } else if (part === '___CODE_START___') {
      const content = parts[i + 1];
      result.push(<code key={key++} className="md-inline-code">{content}</code>);
      i += 3;
    } else if (part === '___LINK_START___') {
      const textContent = parts[i + 1];
      const url = parts[i + 3]; // Skip LINK_URL marker
      result.push(
        <a key={key++} href={url} target="_blank" rel="noopener noreferrer" className="md-link">
          {textContent}
        </a>
      );
      i += 6; // Skip text, URL marker, URL, and END
    } else if (!part.startsWith('___')) {
      if (part) result.push(part);
      i++;
    } else {
      i++;
    }
  }

  return result;
}

export default function MarkdownContent({ content }: MarkdownContentProps) {
  const rendered = useMemo(() => {
    const blocks = parseMarkdown(content);
    
    return blocks.map((block, idx) => {
      if (block.type === 'code') {
        return (
          <pre key={idx} className="md-code-block">
            {block.language && (
              <div className="md-code-language">{block.language}</div>
            )}
            <code>{block.content}</code>
          </pre>
        );
      }
      
      return (
        <div key={idx} className="md-text-block">
          {formatTextContent(block.content)}
        </div>
      );
    });
  }, [content]);

  return <div className="markdown-content">{rendered}</div>;
}
