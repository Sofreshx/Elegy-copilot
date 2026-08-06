import type { ReactNode } from 'react';

export function formatCompactNumber(value: number | null | undefined): string {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return '0';
  return new Intl.NumberFormat(undefined, {
    notation: Math.abs(number) >= 1000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(number);
}

export function MetricValue({ value }: { value: number | null | undefined }) {
  const number = Number(value ?? 0);
  const normalized = Number.isFinite(number) ? number : 0;
  const exact = new Intl.NumberFormat().format(normalized);
  return <strong className="provider-metric-value" title={exact} aria-label={exact}>{formatCompactNumber(normalized)}</strong>;
}

export interface ProviderDefinitionItem {
  label: string;
  value: ReactNode;
}

export function ProviderDefinitionGrid({ items, className = '', testId }: { items: ProviderDefinitionItem[]; className?: string; testId?: string }) {
  return (
    <dl className={`provider-definition-grid ${className}`.trim()} data-testid={testId}>
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ProviderPath({ value, fallback = 'Path unavailable' }: { value: string | null | undefined; fallback?: string }) {
  const text = value || fallback;
  return <code className="provider-path" title={text} tabIndex={0} aria-label={text}>{text}</code>;
}
