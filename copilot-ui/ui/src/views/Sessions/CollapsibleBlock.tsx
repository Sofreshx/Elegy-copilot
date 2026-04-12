import { useState } from 'react';

interface CollapsibleBlockProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  variant?: 'tool' | 'reasoning' | 'message' | 'question' | 'error';
  timestamp?: string;
  status?: string;
  testId?: string;
}

const VARIANT_ICONS: Record<string, string> = {
  tool: '🔧',
  reasoning: '💭',
  message: '💬',
  question: '❓',
  error: '⚠️',
};

export default function CollapsibleBlock({
  title,
  children,
  defaultOpen = false,
  variant = 'message',
  timestamp,
  status,
  testId,
}: CollapsibleBlockProps) {
  const [open, setOpen] = useState(defaultOpen);

  const icon = VARIANT_ICONS[variant] ?? '💬';
  const chevron = open ? '▾' : '▸';

  return (
    <div
      className={`collapsible-block collapsible-block-${variant}`}
      data-testid={testId ?? 'collapsible-block'}
    >
      <button
        type="button"
        className="collapsible-block-header"
        data-testid={testId ? `${testId}-header` : 'collapsible-block-header'}
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        <span className="collapsible-block-chevron" data-testid="collapsible-block-chevron">
          {chevron}
        </span>
        <span className="collapsible-block-icon" data-testid="collapsible-block-icon">
          {icon}
        </span>
        <span className="collapsible-block-title" data-testid="collapsible-block-title">
          {title}
        </span>
        {timestamp && (
          <span className="collapsible-block-timestamp" data-testid="collapsible-block-timestamp">
            {timestamp}
          </span>
        )}
        {status && (
          <span className="collapsible-block-status" data-testid="collapsible-block-status">
            {status}
          </span>
        )}
      </button>
      <div
        className="collapsible-block-body"
        data-testid={testId ? `${testId}-body` : 'collapsible-block-body'}
        style={{ display: open ? 'block' : 'none' }}
      >
        {children}
      </div>
    </div>
  );
}
