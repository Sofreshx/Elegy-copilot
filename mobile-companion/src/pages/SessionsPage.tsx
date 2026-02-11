import React, { useState } from 'react';
import { getApiClient } from '../services/apiClient';

interface Session {
  id: string;
  user_id: string;
  client_id: string | null;
  agent_name: string | null;
  prompt: string | null;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  metadata: string | null;
  created_at: string;
}

interface SessionsResponse {
  sessions: Session[];
  total: number;
  page: number;
  limit: number;
}

const STATUS_FILTERS = ['all', 'active', 'completed', 'failed'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

function truncateId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) + '…' : id;
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function truncatePrompt(prompt: string | null, max = 100): string {
  if (!prompt) return '—';
  return prompt.length > max ? prompt.slice(0, max) + '…' : prompt;
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchSessions = async (status: StatusFilter) => {
    try {
      setLoading(true);
      setError(null);
      const api = getApiClient();
      const params = status !== 'all' ? `?status=${status}` : '';
      const data = await api.get<SessionsResponse>(`/api/sessions${params}`);
      setSessions(data.sessions);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load sessions';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    fetchSessions(filter);
  }, [filter]);

  const handleFilterChange = (status: StatusFilter) => {
    setFilter(status);
    setExpandedId(null);
  };

  const handleToggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="sessions-page">
      <header className="page-header">
        <h1>Session History</h1>
      </header>

      <div className="filter-bar">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => handleFilterChange(s)}
            className={`filter-btn ${filter === s ? 'active' : ''}`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <div className="loading">Loading sessions...</div>
      ) : sessions.length === 0 ? (
        <div className="empty-state">No sessions found</div>
      ) : (
        <ul className="session-list">
          {sessions.map((session) => (
            <li key={session.id} className="session-item">
              <button
                className="session-card"
                onClick={() => handleToggleExpand(session.id)}
                aria-expanded={expandedId === session.id}
              >
                <div className="session-card-header">
                  <span className="session-id">{truncateId(session.id)}</span>
                  <span className={`status-badge status-${session.status}`}>
                    {session.status}
                  </span>
                </div>
                <div className="session-card-body">
                  <span className="session-agent">
                    {session.agent_name ?? 'Unknown agent'}
                  </span>
                  <span className="session-prompt">
                    {truncatePrompt(session.prompt)}
                  </span>
                </div>
                <time className="session-time">
                  {formatTime(session.started_at ?? session.created_at)}
                </time>
              </button>

              {expandedId === session.id && (
                <div className="session-detail">
                  <dl>
                    <dt>Session ID</dt>
                    <dd>{session.id}</dd>

                    <dt>Agent</dt>
                    <dd>{session.agent_name ?? '—'}</dd>

                    <dt>Status</dt>
                    <dd>{session.status}</dd>

                    <dt>Prompt</dt>
                    <dd className="session-detail-prompt">
                      {session.prompt ?? '—'}
                    </dd>

                    {session.error && (
                      <>
                        <dt>Error</dt>
                        <dd className="session-detail-error">{session.error}</dd>
                      </>
                    )}

                    {session.metadata && (
                      <>
                        <dt>Metadata</dt>
                        <dd className="session-detail-metadata">
                          <pre>{session.metadata}</pre>
                        </dd>
                      </>
                    )}

                    <dt>Started</dt>
                    <dd>{formatTime(session.started_at)}</dd>

                    <dt>Completed</dt>
                    <dd>{formatTime(session.completed_at)}</dd>

                    <dt>Created</dt>
                    <dd>{formatTime(session.created_at)}</dd>
                  </dl>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
