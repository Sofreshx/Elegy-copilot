import { useEffect } from 'react';
import { Button, LogViewer, Panel, StatusBadge, Toolbar } from '../../components';
import { useStoreValue } from '../../lib/store';
import type { TrackerPermission, TrackerSession } from '../../lib/types';
import { trackerStore } from './trackerStore';

function getPermissionSummary(permission: TrackerPermission): string {
  if (typeof permission.summary === 'string' && permission.summary.trim()) {
    return permission.summary;
  }

  if (typeof permission.description === 'string' && permission.description.trim()) {
    return permission.description;
  }

  if (typeof permission.title === 'string' && permission.title.trim()) {
    return permission.title;
  }

  return '(no summary)';
}

function getSessionLabel(session: TrackerSession): string {
  if (typeof session.id === 'string' && session.id.trim()) {
    return session.id;
  }

  if (typeof session.sessionId === 'string' && session.sessionId.trim()) {
    return session.sessionId;
  }

  return '(unknown session)';
}

export default function TrackerView() {
  const trackerState = useStoreValue(trackerStore);

  useEffect(() => {
    void trackerStore.loadTracker();
    trackerStore.startLiveEvents();

    return () => {
      trackerStore.stopLiveEvents();
    };
  }, []);

  const handleRefresh = async () => {
    await trackerStore.refresh();
  };

  const handleApprove = async (permission: TrackerPermission) => {
    try {
      await trackerStore.approvePermission(permission);
    } catch {
      // Error state is surfaced in the store.
    }
  };

  const handleDeny = async (permission: TrackerPermission) => {
    try {
      await trackerStore.denyPermission(permission);
    } catch {
      // Error state is surfaced in the store.
    }
  };

  const permissionCount = trackerState.permissions.length;
  const sessionCount = trackerState.sessions.length;

  const logLines = trackerState.events.map((eventItem) => {
    const level: 'error' | 'info' = eventItem.type === 'error' ? 'error' : 'info';

    return {
      level,
      timestamp: eventItem.timestamp,
      message: JSON.stringify({ type: eventItem.type, ...eventItem.payload }, null, 2),
    };
  });

  return (
    <section className="tracker-view" data-testid="tracker-view">
      <Toolbar testId="tracker-view-toolbar">
        <div className="tracker-summary">
          <p className="tracker-title">Tracker Diagnostics</p>
          <p className="tracker-copy">
            {permissionCount} pending permissions, {sessionCount} live sessions
          </p>
        </div>

        <div className="tracker-toolbar-actions">
          <StatusBadge status={trackerState.sseStatus} testId="tracker-sse-status" />
          <Button
            disabled={trackerState.loading || trackerState.permissionsLoading || trackerState.sessionsLoading}
            onClick={handleRefresh}
            testId="tracker-view-refresh"
            variant="secondary"
          >
            {trackerState.loading ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>
      </Toolbar>

      {trackerState.error ? (
        <p className="tracker-error" role="alert">
          {trackerState.error}
        </p>
      ) : null}

      {trackerState.statusMessage ? <p className="tracker-status">{trackerState.statusMessage}</p> : null}

      <div className="tracker-grid">
        <Panel
          subtitle="Approve or deny pending tracker permissions."
          testId="tracker-permissions-panel"
          title="Pending Permissions"
        >
          {trackerState.permissionsLoading && trackerState.permissions.length === 0 ? (
            <p className="state-message">Loading pending permissions...</p>
          ) : null}

          {!trackerState.permissionsLoading && trackerState.permissions.length === 0 ? (
            <p className="state-message">No pending permissions.</p>
          ) : null}

          {trackerState.permissions.length > 0 ? (
            <ul className="tracker-permission-list">
              {trackerState.permissions.map((permission) => {
                const permissionId = trackerStore.readPermissionId(permission);

                return (
                  <li key={permissionId || JSON.stringify(permission)}>
                    <div>
                      <p className="tracker-item-title">{getPermissionSummary(permission)}</p>
                      <p className="tracker-item-copy">
                        ID: <code>{permissionId || '(missing id)'}</code>
                      </p>
                    </div>
                    <div className="tracker-item-actions">
                      <Button
                        disabled={!permissionId || trackerState.actionLoading}
                        onClick={() => {
                          void handleApprove(permission);
                        }}
                        size="sm"
                        testId="tracker-approve-button"
                        variant="secondary"
                      >
                        Approve
                      </Button>
                      <Button
                        disabled={!permissionId || trackerState.actionLoading}
                        onClick={() => {
                          void handleDeny(permission);
                        }}
                        size="sm"
                        testId="tracker-deny-button"
                        variant="danger"
                      >
                        Deny
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </Panel>

        <Panel
          subtitle="Current sessions reported by /api/tracker/sessions."
          testId="tracker-sessions-panel"
          title="Live Sessions"
        >
          {trackerState.sessionsLoading && trackerState.sessions.length === 0 ? (
            <p className="state-message">Loading tracker sessions...</p>
          ) : null}

          {!trackerState.sessionsLoading && trackerState.sessions.length === 0 ? (
            <p className="state-message">No live sessions.</p>
          ) : null}

          {trackerState.sessions.length > 0 ? (
            <ul className="tracker-session-list">
              {trackerState.sessions.map((session) => {
                const status = typeof session.status === 'string' ? session.status : 'unknown';
                return (
                  <li key={`${getSessionLabel(session)}-${status}`}>
                    <p className="tracker-item-title">{getSessionLabel(session)}</p>
                    <StatusBadge status={status} testId="tracker-session-status" />
                  </li>
                );
              })}
            </ul>
          ) : null}
        </Panel>

        <Panel
          subtitle="SSE /api/tracker/events stream with a 50-event cap."
          testId="tracker-events-panel"
          title="Event Stream"
        >
          <LogViewer lines={logLines} testId="tracker-events-log" />
        </Panel>
      </div>
    </section>
  );
}
