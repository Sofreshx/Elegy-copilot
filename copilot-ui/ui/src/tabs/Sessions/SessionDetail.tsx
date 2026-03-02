import type { SessionSummary } from '../../lib/types';
import {
  formatTimestampLabel,
  humanizeToken,
  resolveSessionActiveLabel,
  resolveSessionReason,
  resolveSessionSourceLabel,
  resolveSessionStartedAt,
  resolveSessionStatus,
  resolveSessionUpdatedAt,
} from '../../lib/stateDiagnostics';

interface SessionDetailProps {
  session?: SessionSummary | null;
}

const KNOWN_METADATA_KEYS = new Set([
  'id',
  'source',
  'active',
  'startedAtMs',
  'updatedAtMs',
  'startTime',
  'lastEventTime',
  'startedAt',
  'updatedAt',
  'lastUpdatedAt',
  'status',
  'resolvedStatus',
  'reconciliationReason',
  'resolvedSourceSet',
  'sources',
  'authority',
  'reconciliation',
]);

function getExtraMetadata(input: SessionSummary): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};

  Object.entries(input).forEach(([key, value]) => {
    if (KNOWN_METADATA_KEYS.has(key)) {
      return;
    }
    metadata[key] = value;
  });

  return metadata;
}

export default function SessionDetail({ session = null }: SessionDetailProps) {
  const extraMetadata = session ? getExtraMetadata(session) : {};
  const extraMetadataJson = Object.keys(extraMetadata).length > 0 ? JSON.stringify(extraMetadata, null, 2) : null;
  const sessionReason = session ? resolveSessionReason(session) : null;

  return (
    <section className="session-detail" data-testid="session-detail">
      {session ? (
        <>
          <dl className="detail-grid">
            <div>
              <dt>ID</dt>
              <dd>{session.id}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>{resolveSessionSourceLabel(session)}</dd>
            </div>
            <div>
              <dt>Active</dt>
              <dd>{resolveSessionActiveLabel(session)}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{humanizeToken(resolveSessionStatus(session))}</dd>
            </div>
            <div>
              <dt>Reason</dt>
              <dd>{sessionReason?.label || 'Unknown'}</dd>
            </div>
            <div>
              <dt>Started</dt>
              <dd>{formatTimestampLabel(resolveSessionStartedAt(session))}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{formatTimestampLabel(resolveSessionUpdatedAt(session))}</dd>
            </div>
          </dl>

          <p className="session-detail-reason-copy">
            {sessionReason?.message || 'No explicit reason provided by reconciliation metadata.'}
          </p>

          {extraMetadataJson ? (
            <div className="metadata-block">
              <p>Additional Metadata</p>
              <pre>{extraMetadataJson}</pre>
            </div>
          ) : null}
        </>
      ) : (
        <p className="empty-message">Select a session from the list to inspect its details.</p>
      )}
    </section>
  );
}
