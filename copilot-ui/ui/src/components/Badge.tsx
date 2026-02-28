import { ReactNode } from 'react';

type BadgeTone = 'neutral' | 'brand' | 'accent' | 'success' | 'danger';

interface BadgeProps {
  tone?: BadgeTone;
  testId?: string;
  children?: ReactNode;
}

export default function Badge({ tone = 'neutral', testId = 'ui-badge', children }: BadgeProps) {
  return (
    <span className={`badge badge-${tone}`} data-testid={testId}>
      {children}
    </span>
  );
}
