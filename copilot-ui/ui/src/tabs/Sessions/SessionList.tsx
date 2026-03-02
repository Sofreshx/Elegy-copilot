import type { SessionSummary } from '../../lib/types';
import SessionItem from './SessionItem';

interface SessionListProps {
  sessions?: SessionSummary[];
  selectedSessionId?: string | null;
  loading?: boolean;
  error?: string | null;
  onSelect?: (id: string) => void;
}

export default function SessionList({
  sessions = [],
  selectedSessionId = null,
  loading = false,
  error = null,
  onSelect,
}: SessionListProps) {
  return (
    <section className="session-list" data-testid="session-list">
      {loading && sessions.length === 0 ? <p className="state-message">Loading sessions...</p> : null}
      {!loading && error && sessions.length === 0 ? (
        <p className="state-message state-error" role="alert">
          {error}
        </p>
      ) : null}
      {!loading && !error && sessions.length === 0 ? <p className="state-message">No sessions available.</p> : null}

      {sessions.length > 0 ? (
        <ul className="session-list-items">
          {sessions.map((session) => (
            <SessionItem
              key={session.id}
              onSelect={onSelect}
              selected={session.id === selectedSessionId}
              session={session}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
