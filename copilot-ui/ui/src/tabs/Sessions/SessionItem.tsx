import StatusBadge from '../../components/StatusBadge';
import type { SessionSummary } from '../../lib/types';

interface SessionItemProps {
  session: SessionSummary;
  selected?: boolean;
  onSelect?: (id: string) => void;
}

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

function resolveUpdatedAt(input: SessionSummary): number | null {
  return toTimestamp(input.updatedAtMs) ?? toTimestamp(input.lastEventTime) ?? null;
}

function formatTimestamp(timestamp: number | null): string {
  if (!timestamp) {
    return 'Unknown';
  }

  return new Date(timestamp).toLocaleString();
}

function resolveStatus(input: SessionSummary): string {
  if (typeof input.resolvedStatus === 'string' && input.resolvedStatus.trim()) {
    return input.resolvedStatus;
  }

  if (typeof input.status === 'string' && input.status.trim()) {
    return input.status;
  }

  if (typeof input.active === 'boolean') {
    return input.active ? 'active' : 'inactive';
  }

  return 'unknown';
}

function resolveActive(input: SessionSummary): string {
  if (typeof input.active === 'boolean') {
    return input.active ? 'true' : 'false';
  }

  const status = resolveStatus(input).toLowerCase();
  if (status === 'active') return 'true';
  if (status === 'idle' || status === 'inactive') return 'false';
  return 'unknown';
}

export default function SessionItem({ session, selected = false, onSelect }: SessionItemProps) {
  return (
    <li className="session-item" data-testid="session-item">
      <button
        aria-label={`Select session ${session.id}`}
        aria-pressed={selected}
        className={selected ? 'selected' : ''}
        onClick={() => onSelect?.(session.id)}
        type="button"
      >
        <div className="session-item-header">
          <p className="session-id">{session.id}</p>
          <StatusBadge status={resolveStatus(session)} testId="session-item-status" />
        </div>

        <dl className="session-item-meta">
          <div>
            <dt>Source</dt>
            <dd>{String(session.source ?? 'unknown')}</dd>
          </div>
          <div>
            <dt>Active</dt>
            <dd>{resolveActive(session)}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{formatTimestamp(resolveUpdatedAt(session))}</dd>
          </div>
        </dl>
      </button>
    </li>
  );
}
