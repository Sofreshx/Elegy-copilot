import { useState, useMemo } from 'react';
import type { Session } from '../../services/relayApi';
import SessionCard from './SessionCard';
import './SessionList.css';

type FilterStatus = 'all' | 'active' | 'completed';

interface SessionListProps {
  sessions: Session[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  onSessionClick: (sessionId: string) => void;
  onRetry: () => void;
}

export default function SessionList({
  sessions,
  isLoading,
  isError,
  error,
  onSessionClick,
  onRetry,
}: SessionListProps) {
  const [filter, setFilter] = useState<FilterStatus>('all');

  // Filter and sort sessions
  const filteredSessions = useMemo(() => {
    let filtered = sessions;
    
    if (filter === 'active') {
      filtered = sessions.filter(
        (s) => s.status === 'running' || s.status === 'pending'
      );
    } else if (filter === 'completed') {
      filtered = sessions.filter(
        (s) => s.status === 'completed' || s.status === 'failed' || s.status === 'cancelled'
      );
    }

    // Sort: active first (by startedAt desc), then completed (by completedAt desc)
    return [...filtered].sort((a, b) => {
      const aActive = a.status === 'running' || a.status === 'pending';
      const bActive = b.status === 'running' || b.status === 'pending';
      
      if (aActive && !bActive) return -1;
      if (!aActive && bActive) return 1;
      
      const aTime = a.completedAt || a.startedAt;
      const bTime = b.completedAt || b.startedAt;
      return new Date(bTime).getTime() - new Date(aTime).getTime();
    });
  }, [sessions, filter]);

  // Count by status
  const counts = useMemo(() => {
    const active = sessions.filter(
      (s) => s.status === 'running' || s.status === 'pending'
    ).length;
    const completed = sessions.filter(
      (s) => s.status === 'completed' || s.status === 'failed' || s.status === 'cancelled'
    ).length;
    return { all: sessions.length, active, completed };
  }, [sessions]);

  // Loading state
  if (isLoading && sessions.length === 0) {
    return (
      <div className="session-list-state">
        <div className="spinner" />
        <p className="state-text">Loading sessions...</p>
      </div>
    );
  }

  // Error state
  if (isError) {
    return (
      <div className="session-list-state error">
        <ErrorIcon />
        <p className="state-title">Failed to load sessions</p>
        <p className="state-text">{error?.message || 'An unexpected error occurred'}</p>
        <button className="btn btn-primary" onClick={onRetry}>
          Try Again
        </button>
      </div>
    );
  }

  // Empty state
  if (sessions.length === 0) {
    return (
      <div className="session-list-state empty">
        <NoSessionsIcon />
        <p className="state-title">No sessions yet</p>
        <p className="state-text">
          Start a new session to run an agent on your connected VS Code client.
        </p>
      </div>
    );
  }

  return (
    <div className="session-list">
      <div className="filter-tabs">
        <button
          className={`filter-tab ${filter === 'all' ? 'active' : ''}`}
          onClick={() => setFilter('all')}
        >
          All <span className="count">{counts.all}</span>
        </button>
        <button
          className={`filter-tab ${filter === 'active' ? 'active' : ''}`}
          onClick={() => setFilter('active')}
        >
          Active <span className="count">{counts.active}</span>
        </button>
        <button
          className={`filter-tab ${filter === 'completed' ? 'active' : ''}`}
          onClick={() => setFilter('completed')}
        >
          History <span className="count">{counts.completed}</span>
        </button>
      </div>

      {filteredSessions.length === 0 ? (
        <div className="session-list-empty-filter">
          <p>No {filter === 'active' ? 'active' : 'completed'} sessions</p>
        </div>
      ) : (
        <div className="session-list-items">
          {filteredSessions.map((session) => (
            <SessionCard
              key={session.sessionId}
              session={session}
              onClick={() => onSessionClick(session.sessionId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function NoSessionsIcon() {
  return (
    <svg
      width="64"
      height="64"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="state-icon"
    >
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg
      width="64"
      height="64"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="state-icon error"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}
