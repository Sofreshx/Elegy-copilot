import type { SessionSummary } from '../../lib/types';

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
]);

function toTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function formatTimestamp(value: number | null): string {
  if (!value) {
    return 'Unknown';
  }

  return new Date(value).toLocaleString();
}

function resolveStartedAt(input: SessionSummary): number | null {
  return toTimestamp(input.startedAtMs) ?? toTimestamp(input.startTime) ?? toTimestamp(input.startedAt) ?? null;
}

function resolveUpdatedAt(input: SessionSummary): number | null {
  return (
    toTimestamp(input.updatedAtMs) ??
    toTimestamp(input.lastEventTime) ??
    toTimestamp(input.updatedAt) ??
    toTimestamp(input.lastUpdatedAt) ??
    null
  );
}

function resolveActive(input: SessionSummary): string {
  if (typeof input.active === 'boolean') {
    return input.active ? 'true' : 'false';
  }

  const resolvedStatus = typeof input.resolvedStatus === 'string' ? input.resolvedStatus.toLowerCase() : '';
  const status = typeof input.status === 'string' ? input.status.toLowerCase() : '';
  const mergedStatus = resolvedStatus || status;

  if (mergedStatus === 'active') return 'true';
  if (mergedStatus === 'idle' || mergedStatus === 'inactive') return 'false';

  return 'unknown';
}

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
              <dd>{String(session.source ?? 'unknown')}</dd>
            </div>
            <div>
              <dt>Active</dt>
              <dd>{resolveActive(session)}</dd>
            </div>
            <div>
              <dt>Started</dt>
              <dd>{formatTimestamp(resolveStartedAt(session))}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{formatTimestamp(resolveUpdatedAt(session))}</dd>
            </div>
          </dl>

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
