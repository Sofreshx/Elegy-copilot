import { useState, useEffect, useCallback } from 'react';
import { Button, Panel, Toolbar, Badge, StatusBadge } from '../../components';
import { navigationStore } from '../../stores/navigation';

// ── Data types ──

interface WorkflowRunStep {
  id: string;
  label: string;
  type: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'awaiting-approval' | 'skipped';
  startedAt?: string;
  completedAt?: string;
  outcome?: string;
}

interface WorkflowRun {
  id: string;
  templateId: string;
  templateName: string;
  projectId?: string;
  status: 'running' | 'completed' | 'failed' | 'paused' | 'cancelled';
  currentStepIndex: number;
  steps: WorkflowRunStep[];
  createdAt: string;
  updatedAt: string;
}

// ── Props ──

interface WorkflowExecutionViewProps {
  runId: string;
}

// ── Helpers ──

const POLL_INTERVAL_MS = 5000;

const STEP_STATUS_ICONS: Record<WorkflowRunStep['status'], string> = {
  pending: '○',
  running: '◉',
  completed: '✓',
  failed: '✗',
  'awaiting-approval': '⚠',
  skipped: '—',
};

function formatTimestamp(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function stepStatusClass(status: WorkflowRunStep['status']): string {
  switch (status) {
    case 'pending':
      return 'step-pending';
    case 'running':
      return 'step-running';
    case 'completed':
      return 'step-completed';
    case 'failed':
      return 'step-failed';
    case 'awaiting-approval':
      return 'step-awaiting-approval';
    case 'skipped':
      return 'step-skipped';
    default:
      return '';
  }
}

// ── Component ──

export default function WorkflowExecutionView({ runId }: WorkflowExecutionViewProps) {
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionInFlight, setActionInFlight] = useState(false);

  const fetchRun = useCallback(async () => {
    try {
      const res = await fetch(`/api/workflows/runs/${runId}`);
      if (!res.ok) throw new Error(`Failed to load run (${res.status})`);
      const data: WorkflowRun = await res.json();
      setRun(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [runId]);

  // Initial load + polling
  useEffect(() => {
    fetchRun();

    const id = setInterval(() => {
      // Poll only while the run is active
      setRun((current) => {
        if (current && (current.status === 'running' || current.status === 'paused')) {
          fetchRun();
        }
        return current;
      });
    }, POLL_INTERVAL_MS);

    return () => clearInterval(id);
  }, [fetchRun]);

  // ── Actions ──

  async function handleApprove(outcome?: string) {
    setActionInFlight(true);
    try {
      const res = await fetch(`/api/workflows/runs/${runId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome }),
      });
      if (!res.ok) throw new Error(`Approve failed (${res.status})`);
      await fetchRun();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approve failed');
    } finally {
      setActionInFlight(false);
    }
  }

  async function handleResume() {
    setActionInFlight(true);
    try {
      const res = await fetch(`/api/workflows/runs/${runId}/resume`, { method: 'POST' });
      if (!res.ok) throw new Error(`Resume failed (${res.status})`);
      await fetchRun();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Resume failed');
    } finally {
      setActionInFlight(false);
    }
  }

  async function handleCancel() {
    setActionInFlight(true);
    try {
      const res = await fetch(`/api/workflows/runs/${runId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Cancel failed (${res.status})`);
      await fetchRun();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cancel failed');
    } finally {
      setActionInFlight(false);
    }
  }

  function handleBack() {
    navigationStore.selectWorkflowRun(null);
  }

  // ── Render helpers ──

  if (loading) {
    return (
      <div className="workflow-execution-view" data-testid="workflow-execution-view">
        <div className="workflow-loading-state" data-testid="workflow-execution-loading">
          Loading workflow run…
        </div>
      </div>
    );
  }

  if (error && !run) {
    return (
      <div className="workflow-execution-view" data-testid="workflow-execution-view">
        <Toolbar testId="workflow-execution-toolbar">
          <Button variant="ghost" size="sm" testId="workflow-execution-back" onClick={handleBack}>
            ← Back
          </Button>
        </Toolbar>
        <div className="workflow-error-state" data-testid="workflow-execution-error">
          {error}
        </div>
      </div>
    );
  }

  if (!run) return null;

  const currentStep: WorkflowRunStep | undefined = run.steps[run.currentStepIndex];
  const canResume = run.status === 'paused' || run.status === 'failed';
  const canCancel = run.status === 'running' || run.status === 'paused';

  return (
    <div className="workflow-execution-view" data-testid="workflow-execution-view">
      {/* ── Header toolbar ── */}
      <Toolbar testId="workflow-execution-toolbar">
        <div className="workflow-execution-title-group">
          <Button variant="ghost" size="sm" testId="workflow-execution-back" onClick={handleBack}>
            ← Back
          </Button>
          <h2 className="workflow-execution-title" data-testid="workflow-execution-title">
            {run.templateName}
          </h2>
          <Badge tone="neutral" testId="workflow-execution-run-id">{run.id}</Badge>
          <StatusBadge status={run.status} testId="workflow-execution-status" />
        </div>

        <div className="workflow-execution-actions">
          {canResume && (
            <Button
              variant="primary"
              size="sm"
              testId="workflow-execution-resume"
              disabled={actionInFlight}
              onClick={handleResume}
            >
              Resume
            </Button>
          )}
          {canCancel && (
            <Button
              variant="danger"
              size="sm"
              testId="workflow-execution-cancel"
              disabled={actionInFlight}
              onClick={handleCancel}
            >
              Cancel
            </Button>
          )}
        </div>
      </Toolbar>

      {error && (
        <div className="workflow-inline-error" data-testid="workflow-execution-inline-error">
          {error}
        </div>
      )}

      {/* ── Step progress indicator ── */}
      <Panel title="Steps" testId="workflow-execution-steps-panel">
        <ol className="workflow-step-list" data-testid="workflow-step-list">
          {run.steps.map((step, idx) => {
            const isCurrent = idx === run.currentStepIndex;
            return (
              <li
                key={step.id}
                className={`workflow-step-item ${stepStatusClass(step.status)}${isCurrent ? ' step-current' : ''}`}
                data-testid={`workflow-step-${step.id}`}
              >
                {idx > 0 && <span className="workflow-step-connector" aria-hidden="true" />}
                <span className="workflow-step-icon" data-testid={`workflow-step-icon-${step.id}`}>
                  {STEP_STATUS_ICONS[step.status]}
                </span>
                <span className={`workflow-step-label${step.status === 'skipped' ? ' step-label-skipped' : ''}`}>
                  {step.label}
                </span>
                <Badge tone="neutral" testId={`workflow-step-type-${step.id}`}>{step.type}</Badge>
                <StatusBadge status={step.status} testId={`workflow-step-status-${step.id}`} />
                <span className="workflow-step-timing" data-testid={`workflow-step-timing-${step.id}`}>
                  {step.startedAt ? `Started: ${formatTimestamp(step.startedAt)}` : ''}
                  {step.completedAt ? ` · Completed: ${formatTimestamp(step.completedAt)}` : ''}
                </span>
              </li>
            );
          })}
        </ol>
      </Panel>

      {/* ── Current step detail panel ── */}
      {currentStep && (
        <Panel title="Current Step" subtitle={currentStep.label} testId="workflow-current-step-panel">
          {currentStep.status === 'awaiting-approval' && (
            <div className="workflow-step-approval" data-testid="workflow-step-approval">
              <p>This step requires approval to proceed.</p>
              <div className="workflow-step-approval-actions">
                <Button
                  variant="primary"
                  size="sm"
                  testId="workflow-step-approve"
                  disabled={actionInFlight}
                  onClick={() => handleApprove('approved')}
                >
                  Approve
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  testId="workflow-step-reject"
                  disabled={actionInFlight}
                  onClick={() => handleApprove('rejected')}
                >
                  Reject
                </Button>
              </div>
            </div>
          )}

          {currentStep.status === 'running' && (
            <div className="workflow-step-running" data-testid="workflow-step-running">
              <span className="workflow-spinner" aria-hidden="true">⟳</span> In progress…
            </div>
          )}

          {currentStep.status === 'completed' && (
            <div className="workflow-step-outcome" data-testid="workflow-step-outcome">
              {currentStep.outcome ? (
                <p>Outcome: {currentStep.outcome}</p>
              ) : (
                <p>Step completed successfully.</p>
              )}
            </div>
          )}

          {currentStep.status === 'failed' && (
            <div className="workflow-step-failed-detail" data-testid="workflow-step-failed-detail">
              {currentStep.outcome && <p className="workflow-step-error-message">{currentStep.outcome}</p>}
              <Button
                variant="primary"
                size="sm"
                testId="workflow-step-resume"
                disabled={actionInFlight}
                onClick={handleResume}
              >
                Resume
              </Button>
            </div>
          )}
        </Panel>
      )}

      {/* ── Run metadata footer ── */}
      <Panel title="Run Details" testId="workflow-run-metadata-panel">
        <dl className="workflow-run-metadata" data-testid="workflow-run-metadata">
          <div className="workflow-metadata-item">
            <dt>Created</dt>
            <dd data-testid="workflow-meta-created">{formatTimestamp(run.createdAt)}</dd>
          </div>
          <div className="workflow-metadata-item">
            <dt>Updated</dt>
            <dd data-testid="workflow-meta-updated">{formatTimestamp(run.updatedAt)}</dd>
          </div>
          {run.projectId && (
            <div className="workflow-metadata-item">
              <dt>Project</dt>
              <dd data-testid="workflow-meta-project">{run.projectId}</dd>
            </div>
          )}
        </dl>
      </Panel>
    </div>
  );
}
