import { useState, useCallback } from 'react';
import { useSessions, useSessionDetails, useAgents, useStartSession, useCancelSession } from '../hooks/useSessions';
import { useClients } from '../hooks/useClients';
import SessionList from '../components/sessions/SessionList';
import StartSessionModal from '../components/sessions/StartSessionModal';
import SessionProgress from '../components/sessions/SessionProgress';
import './Sessions.css';

export default function Sessions() {
  const { sessions, isLoading, isError, error, refetch } = useSessions();
  const { clients } = useClients();
  const { agents, isLoading: agentsLoading } = useAgents();
  const startSessionMutation = useStartSession();
  const cancelSessionMutation = useCancelSession();

  const [showStartModal, setShowStartModal] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  
  const { session: selectedSession } = useSessionDetails(selectedSessionId);

  // Handlers
  const handleOpenStartModal = useCallback(() => {
    setShowStartModal(true);
  }, []);

  const handleCloseStartModal = useCallback(() => {
    if (!startSessionMutation.isPending) {
      setShowStartModal(false);
    }
  }, [startSessionMutation.isPending]);

  const handleStartSession = useCallback(
    (clientId: string, agentName: string, prompt: string) => {
      startSessionMutation.mutate(
        { clientId, agentName, prompt },
        {
          onSuccess: (newSession) => {
            setShowStartModal(false);
            setSelectedSessionId(newSession.sessionId);
          },
        }
      );
    },
    [startSessionMutation]
  );

  const handleSessionClick = useCallback((sessionId: string) => {
    setSelectedSessionId(sessionId);
  }, []);

  const handleCloseProgress = useCallback(() => {
    setSelectedSessionId(null);
  }, []);

  const handleCancelSession = useCallback(
    (sessionId: string) => {
      cancelSessionMutation.mutate(sessionId);
    },
    [cancelSessionMutation]
  );

  // Check if any clients are online
  const hasOnlineClients = clients.some((c) => c.isOnline);
  const activeSessions = sessions.filter(
    (s) => s.status === 'running' || s.status === 'pending'
  );

  return (
    <div className="page sessions">
      <header className="page-header">
        <div className="page-header-content">
          <h1 className="page-title">Sessions</h1>
          <p className="page-subtitle">Start and monitor agent sessions</p>
        </div>
        <button
          className="start-session-btn"
          onClick={handleOpenStartModal}
          disabled={!hasOnlineClients}
          title={hasOnlineClients ? 'Start new session' : 'Connect a VS Code client first'}
        >
          <PlusIcon />
          <span>New</span>
        </button>
      </header>

      {activeSessions.length > 0 && (
        <section className="sessions-section active-sessions">
          <h2 className="section-title">
            <span className="pulse-dot" />
            Active Sessions ({activeSessions.length})
          </h2>
          <div className="active-sessions-list">
            {activeSessions.map((session) => (
              <button
                key={session.sessionId}
                className="active-session-card"
                onClick={() => handleSessionClick(session.sessionId)}
              >
                <span className="active-session-agent">@{session.agentName}</span>
                <span className={`status-badge ${session.status}`}>
                  <span className="status-dot pulse" />
                  {session.status}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {!hasOnlineClients && sessions.length === 0 && (
        <section className="sessions-section">
          <h2 className="section-title">Quick Start</h2>
          <div className="agent-grid">
            <button className="agent-button" disabled>
              <span className="agent-icon">🔧</span>
              <span className="agent-name">@debugger</span>
            </button>
            <button className="agent-button" disabled>
              <span className="agent-icon">📋</span>
              <span className="agent-name">@executive2</span>
            </button>
            <button className="agent-button" disabled>
              <span className="agent-icon">🔍</span>
              <span className="agent-name">@code-reviewer</span>
            </button>
            <button className="agent-button" disabled>
              <span className="agent-icon">✨</span>
              <span className="agent-name">@feature-creator</span>
            </button>
          </div>
          <p className="hint">Connect a VS Code client to start sessions</p>
        </section>
      )}

      <section className="sessions-section">
        <SessionList
          sessions={sessions}
          isLoading={isLoading}
          isError={isError}
          error={error}
          onSessionClick={handleSessionClick}
          onRetry={refetch}
        />
      </section>

      <StartSessionModal
        isOpen={showStartModal}
        onClose={handleCloseStartModal}
        onStart={handleStartSession}
        isStarting={startSessionMutation.isPending}
        clients={clients}
        agents={agents}
        clientsLoading={false}
        agentsLoading={agentsLoading}
      />

      {selectedSession && (
        <SessionProgress
          session={selectedSession}
          isOpen={!!selectedSessionId}
          onClose={handleCloseProgress}
          onCancel={handleCancelSession}
          isCancelling={cancelSessionMutation.isPending}
        />
      )}

      {hasOnlineClients && (
        <button
          className="fab-button"
          onClick={handleOpenStartModal}
          aria-label="Start new session"
        >
          <PlusIcon />
        </button>
      )}
    </div>
  );
}

function PlusIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
