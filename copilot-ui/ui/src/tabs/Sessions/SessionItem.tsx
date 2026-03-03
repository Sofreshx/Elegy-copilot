import { useEffect, useState } from 'react';
import type { KeyboardEvent } from 'react';
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
  const [expanded, setExpanded] = useState(selected);
  const handleSelect = () => onSelect?.(session.id);

  const handleCardKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleSelect();
    }
  };

  useEffect(() => {
    if (selected) {
      setExpanded(true);
    }
  }, [selected]);

  return (
    <li className="session-item" data-testid="session-item">
      <article
        aria-label={`Select session ${session.id}`}
        aria-pressed={selected}
        className={`session-card ${selected ? 'selected' : ''}`}
        onClick={handleSelect}
        onKeyDown={handleCardKeyDown}
        role="button"
        tabIndex={0}
      >
        <div className="session-item-header">
          <p className="session-id">{session.id}</p>
          <StatusBadge status={humanizeToken(status)} testId="session-item-status" />
        </div>

        <div className="session-item-actions">
          <button
            aria-expanded={expanded}
            className="session-item-action"
            onClick={(event) => {
              event.stopPropagation();
              setExpanded((current) => !current);
            }}
            onKeyDown={(event) => event.stopPropagation()}
            type="button"
          >
            {expanded ? 'Hide details' : 'Show details'}
          </button>
        </div>

        {expanded ? (
          <>
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
          </>
        ) : null}
      </article>
    </li>
  );
}
