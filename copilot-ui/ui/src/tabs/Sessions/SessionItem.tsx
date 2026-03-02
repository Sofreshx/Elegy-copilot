import StatusBadge from '../../components/StatusBadge';
import {
  formatTimestampLabel,
  humanizeToken,
  resolveSessionActiveLabel,
  resolveSessionReason,
  resolveSessionSourceLabel,
  resolveSessionStatus,
  resolveSessionUpdatedAt,
} from '../../lib/stateDiagnostics';
import type { SessionSummary } from '../../lib/types';

interface SessionItemProps {
  session: SessionSummary;
  selected?: boolean;
  onSelect?: (id: string) => void;
}

export default function SessionItem({ session, selected = false, onSelect }: SessionItemProps) {
  const status = resolveSessionStatus(session);
  const reason = resolveSessionReason(session);

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
          <StatusBadge status={humanizeToken(status)} testId="session-item-status" />
        </div>

        <dl className="session-item-meta">
          <div>
            <dt>Source</dt>
            <dd>{resolveSessionSourceLabel(session)}</dd>
          </div>
          <div>
            <dt>Active</dt>
            <dd>{resolveSessionActiveLabel(session)}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{formatTimestampLabel(resolveSessionUpdatedAt(session))}</dd>
          </div>
        </dl>

        <p className="session-item-reason">
          <span>Why:</span> {reason.message}
        </p>
      </button>
    </li>
  );
}
