import { useEffect } from 'react';
import { Button, StatusBadge, Toolbar } from '../../components';
import { useStoreValue } from '../../lib/store';
import { resolveSessionStatus, humanizeToken } from '../../lib/stateDiagnostics';
import { navigationStore } from '../../stores/navigation';
import type { SessionDetailTab } from '../../stores/navigation';
import { workflowStore } from '../Workflows/workflowStore';
import { sessionDetailStore } from './sessionDetailStore';
import SessionActivityStream from './SessionActivityStream';
import SessionTaskBoard from './SessionTaskBoard';
import SessionArtifactsPanel from './SessionArtifactsPanel';
import SessionConfigPanel from './SessionConfigPanel';
import SessionGitPanel from './SessionGitPanel';
import SessionSkillUsagePanel from './SessionSkillUsagePanel';

function findWorkflowForSession(sessionId: string): { templateName: string; stepLabel: string; runId: string } | null {
  const state = workflowStore.getState();
  for (const run of state.runs) {
    for (const step of run.steps) {
      if (step.sessionId === sessionId) {
        const template = state.templates.find((t) => t.templateId === run.templateId);
        return {
          templateName: template?.name ?? 'Workflow',
          stepLabel: step.label,
          runId: run.workflowRunId,
        };
      }
    }
  }
  return null;
}

const TABS: { id: SessionDetailTab; label: string }[] = [
  { id: 'activity', label: 'Activity' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'artifacts', label: 'Artifacts' },
  { id: 'usage', label: 'Usage' },
  { id: 'config', label: 'Config' },
  { id: 'git', label: 'Git' },
];

export default function SessionDetailView() {
  const nav = useStoreValue(navigationStore);
  const state = useStoreValue(sessionDetailStore);

  const sessionId = nav.selectedSessionId;
  const activeTab = nav.sessionDetailTab;

  useEffect(() => {
    if (!sessionId) return;

    let cancelled = false;

    // Load historical data first, then attach live SSE
    sessionDetailStore.loadSession(sessionId).then(() => {
      if (!cancelled) {
        sessionDetailStore.attachStream(sessionId);
      }
    });

    return () => {
      cancelled = true;
      sessionDetailStore.detachStream();
    };
  }, [sessionId]);

  if (!sessionId) {
    return (
      <div className="session-detail-view" data-testid="session-detail-view">
        <div className="session-empty-state">No session selected</div>
      </div>
    );
  }

  const title = state.orchestration?.objective
    ? state.orchestration.objective
    : sessionId;

  const sessionSummary = state.structuredState
    ? { ...state.structuredState, id: sessionId, source: state.sessionSource ?? undefined }
    : { id: sessionId, source: state.sessionSource ?? undefined };

  const status = resolveSessionStatus(sessionSummary);

  function handleTabClick(tab: SessionDetailTab) {
    navigationStore.selectSession(sessionId, tab);
  }

  function handleBack() {
    navigationStore.selectSession(null);
  }

  function handleStop() {
    if (window.confirm('Stop this session? This will cancel the running task and cannot be undone.')) {
      sessionDetailStore.stopSession();
    }
  }

  return (
    <div className="session-detail-view" data-testid="session-detail-view">
      <header className="session-detail-header">
        <Toolbar justify="between" testId="session-detail-toolbar">
          <div className="session-detail-title-group">
            <Button
              variant="ghost"
              size="sm"
              testId="session-detail-back-button"
              onClick={handleBack}
            >
              ← Back
            </Button>
            <h2 className="session-detail-title" data-testid="session-detail-title">
              {title}
            </h2>
            <StatusBadge
              status={humanizeToken(status)}
              testId="session-detail-status-badge"
            />
            {(() => {
              const wf = findWorkflowForSession(sessionId);
              if (!wf) return null;
              return (
                <button
                  className="session-workflow-link"
                  onClick={() => navigationStore.selectWorkflowRun(wf.runId)}
                  data-testid="session-workflow-link"
                  title={`Part of: ${wf.templateName}`}
                >
                  ⚙ {wf.templateName} → {wf.stepLabel}
                </button>
              );
            })()}
          </div>
          <div className="session-detail-actions">
            <Button
              variant="ghost"
              size="sm"
              testId="session-refresh-button"
              onClick={() => sessionDetailStore.refreshSession()}
              disabled={state.refreshing}
            >
              {state.refreshing ? '↻ Refreshing…' : '↻ Refresh'}
            </Button>
            {(state.sdkStreamStatus === 'connected' || state.sdkStreamStatus === 'connecting' || state.sdkStreamStatus === 'reconnecting' || status === 'active' || status === 'running') && (
              <Button
                variant="danger"
                size="sm"
                testId="session-stop-button"
                onClick={handleStop}
                disabled={state.stopping}
              >
                {state.stopping ? '⏹ Stopping…' : '⏹ Stop'}
              </Button>
            )}
          </div>
        </Toolbar>
      </header>

      <nav className="session-detail-tabs" data-testid="session-detail-tabs" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`session-tab-button${activeTab === tab.id ? ' session-tab-active' : ''}`}
            data-testid={`session-tab-${tab.id}`}
            role="tab"
            aria-selected={activeTab === tab.id}
            type="button"
            onClick={() => handleTabClick(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="session-detail-content" data-testid="session-detail-content">
        {state.loading && (
          <div className="session-loading-state" data-testid="session-loading">
            Loading session…
          </div>
        )}

        {state.error && (
          <div className="session-error-state" data-testid="session-error">
            {state.error}
          </div>
        )}

        {!state.loading && activeTab === 'activity' && (
          <SessionActivityStream
            state={state}
            onSend={(prompt) => sessionDetailStore.sendMessage(prompt)}
            onComposerChange={(value) => sessionDetailStore.setComposerPrompt(value)}
          />
        )}

        {!state.loading && activeTab === 'tasks' && (
          <SessionTaskBoard orchestration={state.orchestration} />
        )}

        {!state.loading && activeTab === 'artifacts' && (
          <SessionArtifactsPanel state={state} />
        )}

        {!state.loading && activeTab === 'config' && (
          <SessionConfigPanel
            session={sessionSummary}
            orchestration={state.orchestration}
          />
        )}

        {!state.loading && activeTab === 'usage' && (
          <SessionSkillUsagePanel agentUsage={state.agentUsage} />
        )}

        {!state.loading && activeTab === 'git' && (
          <SessionGitPanel
            repoPath={state.orchestration?.repo?.repoPath ?? null}
          />
        )}
      </div>
    </div>
  );
}
