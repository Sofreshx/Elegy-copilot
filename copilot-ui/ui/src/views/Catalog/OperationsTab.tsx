import type { CatalogSnapshotEnvelope } from '../../lib/types';
import { Panel } from '../../components';

interface OperationsTabProps {
  summary: CatalogSnapshotEnvelope | null;
}

function formatTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return 'never';
  const trimmed = value.trim();
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : trimmed;
}

export default function OperationsTab({ summary }: OperationsTabProps) {
  const freshness = summary?.freshness;
  const rebuild = summary?.rebuild;

  return (
    <div data-testid="assets-tools-operations" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', overflow: 'auto' }}>
      {/* Freshness */}
      <Panel title="Catalog Freshness" subtitle="When the catalog was last updated">
        <table>
          <tbody>
            <tr><td>Status</td><td>{freshness?.status || 'unknown'}</td></tr>
            <tr><td>Latest Input</td><td>{formatTimestamp(freshness?.latestInputAt)}</td></tr>
            {freshness?.ageMs != null && (
              <tr><td>Age</td><td>{Math.round(freshness.ageMs / 1000)}s ago</td></tr>
            )}
            {freshness?.reasons && freshness.reasons.length > 0 && (
              <tr><td>Reasons</td><td>{freshness.reasons.join(', ')}</td></tr>
            )}
          </tbody>
        </table>
      </Panel>

      {/* Rebuild state */}
      {rebuild && (
        <Panel title="Rebuild History" subtitle="Catalog rebuild operations">
          <table>
            <tbody>
              <tr><td>Status</td><td>{rebuild.status}</td></tr>
              <tr><td>Refresh Count</td><td>{rebuild.refreshCount}</td></tr>
              <tr><td>Last Requested</td><td>{formatTimestamp(rebuild.lastRequestedAt)}</td></tr>
              <tr><td>Last Completed</td><td>{formatTimestamp(rebuild.lastCompletedAt)}</td></tr>
              <tr><td>Last Successful</td><td>{formatTimestamp(rebuild.lastSuccessfulAt)}</td></tr>
              {rebuild.lastDurationMs != null && (
                <tr><td>Last Duration</td><td>{rebuild.lastDurationMs}ms</td></tr>
              )}
              {rebuild.lastReason && <tr><td>Last Reason</td><td>{rebuild.lastReason}</td></tr>}
              {rebuild.lastError && (
                <tr><td style={{ color: 'var(--color-danger-500)' }}>Last Error</td>
                  <td style={{ color: 'var(--color-danger-500)' }}>{rebuild.lastError}</td></tr>
              )}
            </tbody>
          </table>
        </Panel>
      )}

      {/* Warnings */}
      {summary?.warnings && summary.warnings.count > 0 && (
        <Panel title={`Warnings (${summary.warnings.count})`} subtitle="Issues detected during catalog generation">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
            {(summary.warnings.items as any[]).map((w: any, i: number) => (
              <div key={i} className="assets-tools-item-attention catalog-inline-note">
                {typeof w === 'string' ? w : JSON.stringify(w)}
              </div>
            ))}
          </div>
        </Panel>
      )}

      {!freshness && !rebuild && (
        <p className="assets-tools-empty">No operations data available.</p>
      )}
    </div>
  );
}
