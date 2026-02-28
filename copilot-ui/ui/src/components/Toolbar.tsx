import { ReactNode } from 'react';

type ToolbarJustify = 'start' | 'between' | 'end';

interface ToolbarProps {
  justify?: ToolbarJustify;
  wrap?: boolean;
  testId?: string;
  children?: ReactNode;
}

export default function Toolbar({
  justify = 'between',
  wrap = true,
  testId = 'ui-toolbar',
  children,
}: ToolbarProps) {
  return (
    <div
      className={`toolbar toolbar-${justify} ${wrap ? 'toolbar-wrap' : ''}`.trim()}
      data-testid={testId}
      role="toolbar"
    >
      {children}
    </div>
  );
}
