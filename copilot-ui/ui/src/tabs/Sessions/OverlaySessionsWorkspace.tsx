import { useEffect, useMemo } from 'react';
import { Button } from '../../components';
import { formatTimestampLabel } from '../../lib/stateDiagnostics';
import { useStoreValue } from '../../lib/store';
import type { UiRuntimeOverlaySession } from '../../lib/types';
import { navigationStore } from '../../stores/navigation';
import { uiRuntimeOverlayStore } from '../Executor/uiRuntimeOverlayStore';

function formatOptionalTimestamp(value: string | null | undefined): string {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? formatTimestampLabel(parsed) : '(unknown time)';
}

function resolveOverlayRuntimeOrigin(runtimeUrl: string, runtimeOrigin?: string | null): string {
  const normalizedOrigin = String(runtimeOrigin || '').trim();
  if (normalizedOrigin) {
    return normalizedOrigin;
  }

  try {
    return new URL(runtimeUrl).origin;
  } catch {
    return runtimeUrl;
  }
}

function resolveOverlaySessionLabel(session: UiRuntimeOverlaySession): string {
  return session.repoLabel || session.repoId || session.id;
}

function isOverlaySessionClosed(session: UiRuntimeOverlaySession): boolean {
  return session.status.trim().toLowerCase() === 'closed';
}

function pickSelectedSession(
  sessions: UiRuntimeOverlaySession[],
  selectedSessionId: string | null,
): UiRuntimeOverlaySession | null {
  return sessions.find((session) => session.id === selectedSessionId) ?? sessions[0] ?? null;
}

export default function OverlaySessionsWorkspace() {
  const overlayState = useStoreValue(uiRuntimeOverlayStore);

  useEffect(() => {
    void uiRuntimeOverlayStore.load();
  }, []);

  const selectedSession = useMemo(
    () => pickSelectedSession(overlayState.sessions, overlayState.selectedSessionId),
    [overlayState.selectedSessionId, overlayState.sessions],
  );
  const selectedSessionClosed = selectedSession ? isOverlaySessionClosed(selectedSession) : false;

  const handleSelectSession = (sessionId: string) => {
    uiRuntimeOverlayStore.selectSession(sessionId);
  };

  const handleResumeSession = (sessionId: string) => {
    uiRuntimeOverlayStore.selectSession(sessionId);
    navigationStore.goToRuntime('executor');
  };

  return (
    <div className="sessions-controls" data-testid="runtime-overlay-sessions-workspace">
      <div className="sessions-actions">
        <Button
          disabled={overlayState.loading}
          onClick={() => {
            void uiRuntimeOverlayStore.load();
          }}
          testId="runtime-overlay-sessions-refresh"
          variant="secondary"
        >
          {overlayState.loading ? 'Refreshing...' : 'Refresh Overlay Sessions'}
        </Button>
        {selectedSession && !selectedSessionClosed ? (
          <Button
            onClick={() => handleResumeSession(selectedSession.id)}
            testId="runtime-overlay-open-selected-executor"
            variant="ghost"
          >
            Open Selected in Executor
          </Button>
        ) : null}
      </div>

      {overlayState.error ? (
        <p className="sessions-error" role="alert">
          {overlayState.error}
        </p>
      ) : null}

      {overlayState.sessions.length === 0 ? (
        <p className="state-message">
          {overlayState.loading
            ? 'Loading overlay sessions...'
            : 'No attach-first overlay sessions have been recorded yet. Create and mutate them in Executor, then resume them here.'}
        </p>
      ) : (
        <>
          <ul className="tracker-session-list" data-testid="runtime-overlay-sessions-list">
            {overlayState.sessions.map((session) => {
              const isSelected = selectedSession?.id === session.id;
              const isClosed = isOverlaySessionClosed(session);
              const runtimeOrigin = resolveOverlayRuntimeOrigin(session.runtimeUrl, session.runtimeOrigin);

              return (
                <li className={isSelected ? 'is-selected' : ''} key={session.id}>
                  <div>
                    <p className="tracker-item-title">{resolveOverlaySessionLabel(session)}</p>
                    <p className="tracker-item-copy">
                      {session.status} | {runtimeOrigin} | repo {session.repoLabel || session.repoId}
                    </p>
                    <p className="tracker-item-copy">
                      App session {session.linkedSessionId || '(not linked yet)'} | overlay runtime only | {session.observations.length} observation(s) | {session.annotations.length} annotation(s) | {session.changeRequests.length} change request(s)
                    </p>
                    <p className="tracker-item-copy">
                      Worktree isolation {session.worktree?.worktreeId || session.worktree?.path || session.worktree?.mode || '(shared / unspecified)'} | Updated {formatOptionalTimestamp(session.updatedAt)}
                      {session.lastAnalyzedAt ? ` | analyzed ${formatOptionalTimestamp(session.lastAnalyzedAt)}` : ''}
                    </p>
                  </div>

                  <div className="tracker-item-actions">
                    {!isClosed ? (
                      <Button
                        onClick={() => handleResumeSession(session.id)}
                        size="sm"
                        testId={`runtime-overlay-session-open-executor-${session.id}`}
                        variant="secondary"
                      >
                        Resume
                      </Button>
                    ) : null}
                    <Button
                      onClick={() => handleSelectSession(session.id)}
                      size="sm"
                      testId={`runtime-overlay-session-select-${session.id}`}
                      variant={isSelected ? 'primary' : 'ghost'}
                    >
                      {isClosed ? (isSelected ? 'Reviewing' : 'Review') : isSelected ? 'Reviewing' : 'Review'}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>

          {selectedSession ? (
            <section className="session-detail" data-testid="runtime-overlay-selected-session-summary">
              <p className="session-detail-suggestion">
                <span>Selected overlay session:</span> {resolveOverlaySessionLabel(selectedSession)}
              </p>
              <dl className="detail-grid">
                <div>
                  <dt>Status</dt>
                  <dd>{selectedSession.status}</dd>
                </div>
                <div>
                  <dt>App Session</dt>
                  <dd>{selectedSession.linkedSessionId || '(overlay only)'}</dd>
                </div>
                <div>
                  <dt>Runtime</dt>
                  <dd>{resolveOverlayRuntimeOrigin(selectedSession.runtimeUrl, selectedSession.runtimeOrigin)}</dd>
                </div>
                <div>
                  <dt>Repo</dt>
                  <dd>{selectedSession.repoLabel || selectedSession.repoId}</dd>
                </div>
                <div>
                  <dt>Package Root</dt>
                  <dd>{selectedSession.packageRoot || '(repo root)'}</dd>
                </div>
                <div>
                  <dt>Worktree Isolation</dt>
                  <dd>{selectedSession.worktree?.worktreeId || selectedSession.worktree?.path || selectedSession.worktree?.mode || '(shared / unspecified)'}</dd>
                </div>
                <div>
                  <dt>Observations</dt>
                  <dd>{selectedSession.observations.length}</dd>
                </div>
                <div>
                  <dt>Annotations</dt>
                  <dd>{selectedSession.annotations.length}</dd>
                </div>
                <div>
                  <dt>Change Requests</dt>
                  <dd>{selectedSession.changeRequests.length}</dd>
                </div>
                <div>
                  <dt>Quality Signals</dt>
                  <dd>{selectedSession.qualitySignals.length}</dd>
                </div>
              </dl>
              <p className="tracker-item-copy">Runtime URL: {selectedSession.runtimeUrl}</p>
              <p className="tracker-item-copy">
                {selectedSessionClosed
                  ? 'Closed overlay sessions stay reviewable here without reopening Executor handoff.'
                  : 'Use Executor for attach, close, annotation, change-request, and queue actions; this Sessions workspace stays read-light with one-click handoff.'}
              </p>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
