import { ReactNode } from 'react';

export interface UsageCreditMetric {
  label: string;
  current: number | string;
  limit?: number | string;
  remaining?: number | string;
  /** Value 0-1 representing progress toward limit */
  progress?: number;
  status?: 'ok' | 'warning' | 'exhausted';
  updatedAt?: string;
}

export type UsageCreditSummaryStatus = 'loading' | 'available' | 'unavailable' | 'empty';

export interface UsageCreditSummaryProps {
  /** Overall data status */
  status: UsageCreditSummaryStatus;
  /** Normalized metrics array */
  metrics?: UsageCreditMetric[];
  /** Provider display name (for labeling, not fetching) */
  providerLabel?: string;
  /** Optional error message when status is 'unavailable' */
  errorMessage?: string;
  testId?: string;
  children?: ReactNode;
}

function formatNumber(value: number | string): string {
  if (typeof value === 'number') return value.toLocaleString();
  return value;
}

function formatTimestamp(isoStr?: string): string {
  if (!isoStr) return '';
  try {
    return new Date(isoStr).toLocaleString();
  } catch {
    return isoStr;
  }
}

export default function UsageCreditSummary({
  status,
  metrics = [],
  providerLabel,
  errorMessage,
  testId = 'usage-credit-summary',
  children,
}: UsageCreditSummaryProps) {
  if (status === 'loading') {
    return (
      <div className="usage-credit-summary" data-testid={testId}>
        <div className="usage-credit-loading">Loading usage data…</div>
      </div>
    );
  }

  if (status === 'unavailable') {
    return (
      <div className="usage-credit-summary" data-testid={testId}>
        <div className="usage-credit-unavailable">
          {errorMessage || 'Usage data is unavailable.'}
        </div>
      </div>
    );
  }

  if (status === 'empty' || metrics.length === 0) {
    return null; // Do not render when no data
  }

  return (
    <div className="usage-credit-summary" data-testid={testId}>
      {providerLabel && (
        <div className="usage-credit-provider-label">{providerLabel}</div>
      )}
      <div className="usage-credit-metrics">
        {metrics.map((metric, idx) => {
          const hasLimit = metric.limit !== undefined;
          const hasRemaining = metric.remaining !== undefined;
          const progressPercent = metric.progress !== undefined
            ? Math.max(0, Math.min(100, Math.round(metric.progress * 100)))
            : null;

          let statusClass = '';
          if (metric.status === 'ok') statusClass = 'usage-credit-metric-ok';
          else if (metric.status === 'warning') statusClass = 'usage-credit-metric-warning';
          else if (metric.status === 'exhausted') statusClass = 'usage-credit-metric-exhausted';

          return (
            <div key={idx} className={`usage-credit-metric ${statusClass}`}>
              <div className="usage-credit-metric-header">
                <span className="usage-credit-metric-label">{metric.label}</span>
                {metric.updatedAt && (
                  <span className="usage-credit-metric-timestamp">
                    Updated {formatTimestamp(metric.updatedAt)}
                  </span>
                )}
              </div>
              <div className="usage-credit-metric-values">
                <span className="usage-credit-metric-current">
                  {formatNumber(metric.current)}
                </span>
                {hasLimit && (
                  <>
                    <span className="usage-credit-metric-separator">/</span>
                    <span className="usage-credit-metric-limit">
                      {formatNumber(metric.limit!)}
                    </span>
                  </>
                )}
                {hasRemaining && (
                  <span className="usage-credit-metric-remaining">
                    ({formatNumber(metric.remaining!)} remaining)
                  </span>
                )}
              </div>
              {progressPercent !== null && (
                <div className="usage-credit-progress-track" role="progressbar" aria-valuenow={progressPercent} aria-valuemin={0} aria-valuemax={100} aria-label={`${metric.label} usage`}>
                  <div
                    className={`usage-credit-progress-fill ${progressPercent >= 90 ? 'usage-credit-progress-high' : ''}`}
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {children}
    </div>
  );
}
