import { useEffect } from 'react';
import { Button, Panel, Toolbar } from '../../components';
import { useStoreValue } from '../../lib/store';
import type { SessionSummary } from '../../lib/types';
import SessionDetail from './SessionDetail';
import SessionList from './SessionList';
import { sessionsStore } from './sessionsStore';

function isSessionActive(session: SessionSummary): boolean {
  if (typeof session.active === 'boolean') {
    return session.active;
  }

  const status = typeof session.resolvedStatus === 'string' ? session.resolvedStatus : session.status;
  return status === 'active';
}

export default function SessionsView() {
  const sessionState = useStoreValue(sessionsStore);

  useEffect(() => {
    void sessionsStore.loadSessions();
  }, []);

  const selectedSession =
    sessionState.sessions.find((session) => session.id === sessionState.selectedSessionId) ?? null;
  const activeCount = sessionState.sessions.filter((session) => isSessionActive(session)).length;

  const handleRefresh = async () => {
    await sessionsStore.refresh();
  };

  return (
    <section className="sessions-view" data-testid="sessions-view">
      <Toolbar testId="sessions-view-toolbar">
        <div className="sessions-summary">
          <p className="sessions-title">Active Sessions</p>
          <p className="sessions-copy">
            {sessionState.sessions.length} total, {activeCount} active
          </p>
        </div>
        <Button
          disabled={sessionState.loading}
          onClick={handleRefresh}
          testId="sessions-view-refresh"
          variant="secondary"
        >
          {sessionState.loading ? 'Refreshing...' : 'Refresh'}
        </Button>
      </Toolbar>

      {sessionState.error ? (
        <p className="sessions-error" role="alert">
          {sessionState.error}
        </p>
      ) : null}

      <div className="sessions-grid">
        <Panel
          subtitle="Select a session to inspect details."
          testId="sessions-list-panel"
          title="Session List"
        >
          <SessionList
            error={sessionState.error}
            loading={sessionState.loading}
            onSelect={(id) => sessionsStore.selectSession(id)}
            selectedSessionId={sessionState.selectedSessionId}
            sessions={sessionState.sessions}
          />
        </Panel>

        <Panel
          subtitle="Core fields with metadata fallback."
          testId="session-detail-panel"
          title="Session Details"
        >
          <SessionDetail session={selectedSession} />
        </Panel>
      </div>
    </section>
  );
}
