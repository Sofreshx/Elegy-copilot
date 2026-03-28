import { useEffect, useMemo, useState } from 'react';
import { Button, FormInput, LogViewer, Panel, Toolbar } from '../../components';
import {
  formatTimestampLabel,
  resolveSessionSourceLabel,
  resolveSessionStartedAt,
  resolveSessionStatus,
  resolveSessionUpdatedAt,
  summarizeSdkHealth,
} from '../../lib/stateDiagnostics';
import { useStoreValue } from '../../lib/store';
import type { CreateExecutorJobPayload } from '../../lib/types';
import { navigationStore } from '../../stores/navigation';
import { sdkHealthStore } from '../../stores/sdkHealthStore';
import SandboxesView from '../Sandboxes/SandboxesView';
import { sessionsStore } from '../Sessions/sessionsStore';
import { sdkSessionsStore } from '../Sessions/sdkSessionsStore';
import { executorStore } from './executorStore';
import { uiRuntimeOverlayStore } from './uiRuntimeOverlayStore';

function promptPreview(prompt: string): string {
  const normalized = prompt.trim().replace(/\s+/g, ' ');
  if (normalized.length <= 120) {
    return normalized;
  }
  return `${normalized.slice(0, 117)}...`;
}

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

export default function ExecutorView() {
  const executorState = useStoreValue(executorStore);
  const sdkHealthState = useStoreValue(sdkHealthStore);
  const uiRuntimeOverlayState = useStoreValue(uiRuntimeOverlayStore);

  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [targetType, setTargetType] = useState<'create-session' | 'existing-session'>('create-session');
  const [existingSessionId, setExistingSessionId] = useState('');
  const [model, setModel] = useState('');
  const [contextType, setContextType] = useState('regular');
  const [sandboxId, setSandboxId] = useState('');
  const [scheduleAt, setScheduleAt] = useState('');
  const [retryEnabled, setRetryEnabled] = useState(true);
  const [maxAttempts, setMaxAttempts] = useState('3');
  const [baseDelayMs, setBaseDelayMs] = useState('30000');
  const [maxDelayMs, setMaxDelayMs] = useState('300000');
  const [backoffMultiplier, setBackoffMultiplier] = useState('2');
  const [runtimeUrl, setRuntimeUrl] = useState('');
  const [packageRoot, setPackageRoot] = useState('');

  useEffect(() => {
    void executorStore.load();
    executorStore.startPolling();
    void sdkHealthStore.refresh();
    void uiRuntimeOverlayStore.load();

    return () => {
      executorStore.stopPolling();
    };
  }, []);

  const selectedJob = useMemo(
    () => executorState.jobs.find((job) => job.id === executorState.selectedJobId) ?? null,
    [executorState.jobs, executorState.selectedJobId]
  );

  const selectedRun = useMemo(
    () => executorState.runs.find((run) => run.id === executorState.selectedRunId) ?? null,
    [executorState.runs, executorState.selectedRunId]
  );

  const latestSelectedJobRun = selectedJob?.lastRunId
    ? executorState.runs.find((run) => run.id === selectedJob.lastRunId) ?? null
    : null;
  const activeRuns = executorState.runs.filter((run) => ['starting', 'running', 'retrying'].includes(run.status));
  const openedSessions = Array.from(new Set(executorState.runs.map((run) => run.sessionId).filter(Boolean))) as string[];
  const observedExternalSessions = executorState.observedExternalSessions;
  const sdkSummary = summarizeSdkHealth(sdkHealthState.health, sdkHealthState.error);
  const executorRuntimeStatus = executorState.health.enabled ? executorState.health.state : 'Managed Off';
  const executorRuntimeDetail = executorState.health.enabled
    ? `${executorState.health.jobCount} jobs, ${executorState.health.runCount} runs, ${executorState.health.scheduledJobCount} scheduled`
    : 'Managed execution is off. External CLI and VS Code session observation still works below; set COPILOT_SDK_BRIDGE=1 to enable queued and SDK-backed runs.';
  const sdkBridgeStatus = sdkSummary.status === 'Disabled' ? 'Managed Off' : sdkSummary.status;
  const sdkBridgeDetail = sdkSummary.status === 'Disabled'
    ? 'Managed SDK sessions and streaming are off. External CLI and VS Code session observation still works; set COPILOT_SDK_BRIDGE=1 to enable SDK-backed execution.'
    : sdkSummary.detail;
  const selectedCatalogRepo = uiRuntimeOverlayState.selectedRepo;
  const hasCatalogRepos = uiRuntimeOverlayState.catalogRepos.length > 0;
  const selectedCatalogRepoLabel = selectedCatalogRepo?.repoLabel || selectedCatalogRepo?.repoId || selectedCatalogRepo?.repoPath || '';

  const handleSubmit = async () => {
    const payload: CreateExecutorJobPayload = {
      title: title.trim() || undefined,
      prompt,
      targetType,
      existingSessionId: targetType === 'existing-session' ? existingSessionId.trim() || undefined : undefined,
      model: targetType === 'create-session' ? model.trim() || undefined : undefined,
      contextType: targetType === 'create-session' ? contextType.trim() || undefined : undefined,
      sandboxId: targetType === 'create-session' ? sandboxId.trim() || undefined : undefined,
      scheduleAt: scheduleAt ? new Date(scheduleAt).toISOString() : undefined,
      retryPolicy: {
        enabled: retryEnabled,
        maxAttempts: Number(maxAttempts) || 3,
        baseDelayMs: Number(baseDelayMs) || 30_000,
        maxDelayMs: Number(maxDelayMs) || 300_000,
        backoffMultiplier: Number(backoffMultiplier) || 2,
      },
    };

    await executorStore.submitJob(payload);
    if (!scheduleAt) {
      setTitle('');
      setPrompt('');
    }
  };

  const handleOpenSession = (sessionId: string | null | undefined) => {
    const normalizedSessionId = String(sessionId || '').trim();
    if (!normalizedSessionId) {
      return;
    }

    void sdkSessionsStore.loadSessions({ selectSessionId: normalizedSessionId }).then(() => {
      sdkSessionsStore.selectSession(normalizedSessionId);
      navigationStore.goToRuntime('sessions', { sessionsMode: 'sdk' });
    });
  };

  const handleFollowSandboxSession = (sessionId: string) => {
    void (async () => {
      try {
        await sessionsStore.loadSessions();
        sessionsStore.selectSession(sessionId);
      } finally {
        navigationStore.goToRuntime('sessions', { sessionsMode: 'local' });
      }
    })();
  };

  const handleCreateOverlaySession = async () => {
    const session = await uiRuntimeOverlayStore.createSession({
      runtimeUrl: runtimeUrl.trim(),
      packageRoot: packageRoot.trim() || undefined,
    });

    if (session) {
      setRuntimeUrl('');
      setPackageRoot('');
    }
  };

  const refreshExecutorSurface = () => {
    void Promise.all([
      executorStore.load(),
      sdkHealthStore.refresh(),
      uiRuntimeOverlayStore.load(),
    ]);
  };

  return (
    <section className="sessions-view executor-view" data-testid="executor-view">
      <Toolbar testId="executor-view-toolbar">
        <div className="sessions-summary">
          <p className="sessions-title">Executor</p>
          <p className="sessions-copy">
            {executorState.health.jobCount} job(s), {executorState.health.activeRunCount} active run(s)
          </p>
        </div>

        <div className="showcase-toolbar-group">
          <Button
            disabled={executorState.loading}
            onClick={refreshExecutorSurface}
            testId="executor-refresh"
            variant="secondary"
          >
            {executorState.loading ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>
      </Toolbar>

      <div className="sessions-connection-grid" data-testid="executor-connection-grid">
        <article className="sessions-connection-card">
          <p className="sessions-connection-title">Executor Runtime</p>
          <p className="sessions-connection-status">{executorRuntimeStatus}</p>
          <p className="sessions-connection-copy">{executorRuntimeDetail}</p>
        </article>

        <article className="sessions-connection-card">
          <p className="sessions-connection-title">SDK Bridge</p>
          <p className="sessions-connection-status">{sdkBridgeStatus}</p>
          <p className="sessions-connection-copy">{sdkBridgeDetail}</p>
        </article>

        <article className="sessions-connection-card">
          <p className="sessions-connection-title">Opened Sessions</p>
          <p className="sessions-connection-status">{openedSessions.length}</p>
          <p className="sessions-connection-copy">
            {openedSessions.length > 0 ? openedSessions.join(', ') : 'No executor-linked SDK sessions yet.'}
          </p>
        </article>

        <article className="sessions-connection-card">
          <p className="sessions-connection-title">Observed External Sessions</p>
          <p className="sessions-connection-status">{observedExternalSessions.length}</p>
          <p className="sessions-connection-copy">
            {executorState.observationError
              ? executorState.observationError
              : observedExternalSessions.length > 0
                ? 'Watching recent CLI and VS Code sessions discovered outside executor-managed runs.'
                : 'No recent CLI or VS Code sessions observed yet.'}
          </p>
        </article>
      </div>

      {executorState.error ? (
        <p className="sessions-error" role="alert">
          {executorState.error}
        </p>
      ) : null}

      <div className="sessions-grid">
        <Panel
          subtitle="Attach-first, runtime-linked foundation for the selected Catalog repo. This prototype registers sessions only; browser observation and overlay canvas behavior come later."
          testId="executor-ui-runtime-overlay-panel"
          title="Attach Mode Foundation"
        >
          <div className="sessions-controls executor-form-grid">
            <div className="session-detail">
              <p className="session-detail-suggestion">
                <span>Selected Catalog repo:</span>{' '}
                {selectedCatalogRepoLabel || 'No Catalog repo selected yet.'}
              </p>
              <p className="tracker-item-copy">
                {selectedCatalogRepo
                  ? `${selectedCatalogRepo.repoId || '(no repo id)'} | ${selectedCatalogRepo.repoPath || '(no repo path)'}`
                  : hasCatalogRepos
                    ? 'Choose the visible Catalog repo in the existing Catalog or Planning flow, then come back here to attach a runtime-linked session.'
                    : 'No Catalog repos are available yet. Register or select one in the existing Catalog flow before attaching a runtime.'}
              </p>
              <p className="tracker-item-copy">
                Attach Mode foundation keeps the repo context server-side and only records a runtime-linked session for the selected Catalog repo.
              </p>
            </div>

            <FormInput
              id="executor-ui-runtime-overlay-runtime-url"
              label="Runtime URL"
              onValueChange={setRuntimeUrl}
              placeholder="http://127.0.0.1:4173"
              testId="executor-ui-runtime-overlay-runtime-url-input"
              value={runtimeUrl}
            />

            <FormInput
              id="executor-ui-runtime-overlay-package-root"
              label="Package Root (optional)"
              onValueChange={setPackageRoot}
              placeholder="packages/web"
              testId="executor-ui-runtime-overlay-package-root-input"
              value={packageRoot}
            />

            <div className="sessions-actions">
              <Button
                onClick={() => navigationStore.goToCatalog('assets')}
                testId="executor-ui-runtime-overlay-open-catalog"
                variant="secondary"
              >
                Open Catalog Assets
              </Button>
              <Button
                disabled={uiRuntimeOverlayState.loading}
                onClick={() => {
                  void uiRuntimeOverlayStore.load();
                }}
                testId="executor-ui-runtime-overlay-refresh"
                variant="ghost"
              >
                {uiRuntimeOverlayState.loading ? 'Refreshing...' : 'Refresh Attach Mode'}
              </Button>
              <Button
                disabled={uiRuntimeOverlayState.creating || runtimeUrl.trim().length === 0 || !selectedCatalogRepo}
                onClick={() => {
                  void handleCreateOverlaySession();
                }}
                testId="executor-ui-runtime-overlay-create"
              >
                {uiRuntimeOverlayState.creating ? 'Attaching...' : 'Create Attached Session'}
              </Button>
            </div>
          </div>

          {uiRuntimeOverlayState.error ? (
            <p className="sessions-error" role="alert">
              {uiRuntimeOverlayState.error}
            </p>
          ) : null}

          {uiRuntimeOverlayState.sessions.length === 0 ? (
            <p className="state-message">No runtime-linked attach sessions have been recorded yet.</p>
          ) : (
            <ul className="tracker-session-list executor-job-list">
              {uiRuntimeOverlayState.sessions.map((session) => {
                const isAttachedSession = session.status === 'attached';
                const runtimeOrigin = resolveOverlayRuntimeOrigin(session.runtimeUrl, session.runtimeOrigin);

                return (
                  <li key={session.id}>
                    <div>
                      <p className="tracker-item-title">{session.repoLabel || session.repoId}</p>
                      <p className="tracker-item-copy">
                        {session.status}
                        {' | '}
                        {runtimeOrigin}
                        {' | updated '}
                        {formatOptionalTimestamp(session.updatedAt)}
                      </p>
                      <p className="tracker-item-copy">Runtime URL: {session.runtimeUrl}</p>
                      <p className="tracker-item-copy">
                        Repo: {session.repoLabel || session.repoId} | Package root: {session.packageRoot}
                      </p>
                      <p className="tracker-item-copy">Session ID: {session.id}</p>
                      {session.closedAt ? (
                        <p className="tracker-item-copy">Closed: {formatOptionalTimestamp(session.closedAt)}</p>
                      ) : null}
                    </div>
                    <div className="tracker-item-actions">
                      {isAttachedSession ? (
                        <Button
                          disabled={uiRuntimeOverlayState.closing && uiRuntimeOverlayState.closingSessionId === session.id}
                          onClick={() => {
                            void uiRuntimeOverlayStore.closeSession(session.id);
                          }}
                          size="sm"
                          testId={`executor-ui-runtime-overlay-close-${session.id}`}
                          variant="ghost"
                        >
                          {uiRuntimeOverlayState.closing && uiRuntimeOverlayState.closingSessionId === session.id
                            ? 'Closing...'
                            : 'Close Session'}
                        </Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel
          subtitle="Create a run-now or schedule-later prompt with per-job retry settings."
          testId="executor-create-panel"
          title="New Executor Job"
        >
          <div className="sessions-controls executor-form-grid">
            <FormInput
              id="executor-title"
              label="Title (optional)"
              onValueChange={setTitle}
              placeholder="plan-next-slice"
              testId="executor-title-input"
              value={title}
            />

            <label className="form-input" htmlFor="executor-prompt">
              <span className="form-label">Prompt</span>
              <textarea
                data-testid="executor-prompt-input"
                id="executor-prompt"
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Describe the plan or implementation task to run later."
                rows={6}
                value={prompt}
              />
            </label>

            <div className="sessions-actions">
              <Button
                onClick={() => setTargetType('create-session')}
                testId="executor-target-create"
                variant={targetType === 'create-session' ? 'primary' : 'ghost'}
              >
                Create Session At Run Time
              </Button>
              <Button
                onClick={() => setTargetType('existing-session')}
                testId="executor-target-existing"
                variant={targetType === 'existing-session' ? 'primary' : 'ghost'}
              >
                Existing Session
              </Button>
            </div>

            {targetType === 'existing-session' ? (
              <FormInput
                id="executor-existing-session"
                label="Existing Session ID"
                onValueChange={setExistingSessionId}
                placeholder="sdk-session-..."
                testId="executor-existing-session-input"
                value={existingSessionId}
              />
            ) : (
              <>
                <FormInput
                  id="executor-model"
                  label="Model (optional)"
                  onValueChange={setModel}
                  placeholder="gpt-5.4"
                  testId="executor-model-input"
                  value={model}
                />

                <label className="form-input" htmlFor="executor-context-type">
                  <span className="form-label">Context Type</span>
                  <select
                    data-testid="executor-context-type-input"
                    id="executor-context-type"
                    onChange={(event) => setContextType(event.target.value)}
                    value={contextType}
                  >
                    <option value="regular">regular</option>
                    <option value="sandbox">sandbox</option>
                  </select>
                </label>

                {contextType === 'sandbox' ? (
                  <FormInput
                    id="executor-sandbox-id"
                    label="Sandbox ID"
                    onValueChange={setSandboxId}
                    placeholder="sb-..."
                    testId="executor-sandbox-id-input"
                    value={sandboxId}
                  />
                ) : null}
              </>
            )}

            <label className="form-input" htmlFor="executor-schedule-at">
              <span className="form-label">Schedule For Later (optional)</span>
              <input
                data-testid="executor-schedule-at-input"
                id="executor-schedule-at"
                onChange={(event) => setScheduleAt(event.target.value)}
                type="datetime-local"
                value={scheduleAt}
              />
            </label>

            <div className="executor-retry-grid">
              <label className="form-input executor-checkbox" htmlFor="executor-retry-enabled">
                <span className="form-label">Retry On Rate Limit</span>
                <input
                  checked={retryEnabled}
                  data-testid="executor-retry-enabled-input"
                  id="executor-retry-enabled"
                  onChange={(event) => setRetryEnabled(event.target.checked)}
                  type="checkbox"
                />
              </label>

              <FormInput
                id="executor-max-attempts"
                label="Max Attempts"
                onValueChange={setMaxAttempts}
                testId="executor-max-attempts-input"
                type="number"
                value={maxAttempts}
              />

              <FormInput
                id="executor-base-delay"
                label="Base Delay (ms)"
                onValueChange={setBaseDelayMs}
                testId="executor-base-delay-input"
                type="number"
                value={baseDelayMs}
              />

              <FormInput
                id="executor-max-delay"
                label="Max Delay (ms)"
                onValueChange={setMaxDelayMs}
                testId="executor-max-delay-input"
                type="number"
                value={maxDelayMs}
              />

              <FormInput
                id="executor-backoff"
                label="Backoff Multiplier"
                onValueChange={setBackoffMultiplier}
                testId="executor-backoff-input"
                type="number"
                value={backoffMultiplier}
              />
            </div>

            <div className="sessions-actions">
              <Button
                disabled={executorState.creating || prompt.trim().length === 0}
                onClick={() => {
                  void handleSubmit();
                }}
                testId="executor-submit"
              >
                {executorState.creating
                  ? 'Submitting...'
                  : (scheduleAt ? 'Create Scheduled Job' : 'Run Now')}
              </Button>
            </div>
          </div>
        </Panel>

        <Panel
          subtitle="Shows queued, scheduled, active, and completed jobs with direct actions."
          testId="executor-jobs-panel"
          title="Jobs"
        >
          {executorState.jobs.length === 0 ? (
            <p className="state-message">No executor jobs created yet.</p>
          ) : (
            <ul className="tracker-session-list executor-job-list">
              {executorState.jobs.map((job) => {
                const isSelected = executorState.selectedJobId === job.id;
                const latestRun = job.lastRunId
                  ? executorState.runs.find((run) => run.id === job.lastRunId) ?? null
                  : null;

                return (
                  <li className={isSelected ? 'is-selected' : ''} key={job.id}>
                    <div>
                      <p className="tracker-item-title">{job.title}</p>
                      <p className="tracker-item-copy">
                        {job.status}
                        {' | '}
                        {job.targetType === 'existing-session'
                          ? `session:${job.existingSessionId}`
                          : `${job.contextType || 'regular'}${job.model ? `:${job.model}` : ''}`}
                        {job.scheduleAt ? ` | scheduled ${formatTimestampLabel(Date.parse(job.scheduleAt))}` : ''}
                      </p>
                      <p className="tracker-item-copy">{promptPreview(job.prompt)}</p>
                      {latestRun ? (
                        <p className="tracker-item-copy">
                          latest run: {latestRun.status} @ {formatTimestampLabel(Date.parse(latestRun.updatedAt))}
                        </p>
                      ) : null}
                    </div>
                    <div className="tracker-item-actions">
                      <Button
                        onClick={() => executorStore.selectJob(job.id)}
                        size="sm"
                        testId={`executor-job-select-${job.id}`}
                        variant={isSelected ? 'primary' : 'ghost'}
                      >
                        {isSelected ? 'Selected' : 'Select'}
                      </Button>
                      <Button
                        disabled={executorState.triggering || Boolean(job.activeRunId)}
                        onClick={() => {
                          void executorStore.runNow(job.id);
                        }}
                        size="sm"
                        testId={`executor-job-run-${job.id}`}
                        variant="secondary"
                      >
                        Run Now
                      </Button>
                      <Button
                        disabled={executorState.cancelling}
                        onClick={() => {
                          void executorStore.cancel(job.id);
                        }}
                        size="sm"
                        testId={`executor-job-cancel-${job.id}`}
                        variant="danger"
                      >
                        Cancel
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel
          subtitle="Read-only view of recent CLI and VS Code sessions discovered outside executor-managed runs."
          testId="executor-observed-sessions-panel"
          title="Observed External Sessions"
        >
          {executorState.observationError ? (
            <p className="sessions-error" role="alert">
              {executorState.observationError}
            </p>
          ) : null}

          {observedExternalSessions.length === 0 ? (
            <p className="state-message">No recent CLI or VS Code sessions observed yet.</p>
          ) : (
            <ul className="tracker-session-list executor-job-list">
              {observedExternalSessions.map((session) => {
                const startedAt = resolveSessionStartedAt(session);
                const updatedAt = resolveSessionUpdatedAt(session);
                const cwd = typeof session.cwd === 'string' && session.cwd.trim() ? session.cwd.trim() : null;

                return (
                  <li key={session.id}>
                    <div>
                      <p className="tracker-item-title">{session.id}</p>
                      <p className="tracker-item-copy">
                        {resolveSessionSourceLabel(session)}
                        {' | '}
                        {resolveSessionStatus(session)}
                        {startedAt ? ` | started ${formatTimestampLabel(startedAt)}` : ''}
                        {updatedAt ? ` | updated ${formatTimestampLabel(updatedAt)}` : ''}
                      </p>
                      {cwd ? <p className="tracker-item-copy">{cwd}</p> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <div className="workspace-stack" data-testid="executor-sandbox-mode-section">
          <p className="workspace-section-label">Executor / Sandbox Mode</p>
          <SandboxesView onFollowSessions={handleFollowSandboxSession} />
        </div>

        <Panel
          subtitle="Shows the selected run, linked session, retry state, and captured executor events."
          testId="executor-run-detail-panel"
          title="Run Detail"
        >
          {selectedRun ? (
            <div className="session-detail executor-run-detail">
              <dl className="detail-grid">
                <div>
                  <dt>Run</dt>
                  <dd>{selectedRun.id}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{selectedRun.status}</dd>
                </div>
                <div>
                  <dt>Attempts</dt>
                  <dd>{selectedRun.attemptCount} / {selectedRun.maxAttempts}</dd>
                </div>
                <div>
                  <dt>Session</dt>
                  <dd>{selectedRun.sessionId || '(none)'}</dd>
                </div>
                <div>
                  <dt>Updated</dt>
                  <dd>{formatTimestampLabel(Date.parse(selectedRun.updatedAt))}</dd>
                </div>
                <div>
                  <dt>Next Retry</dt>
                  <dd>{selectedRun.nextRetryAt ? formatTimestampLabel(Date.parse(selectedRun.nextRetryAt)) : '(none)'}</dd>
                </div>
              </dl>

              {selectedRun.error ? <p className="sessions-error">{selectedRun.error}</p> : null}
              {selectedRun.summary ? <p className="session-detail-suggestion"><span>Summary:</span> {selectedRun.summary}</p> : null}

              <div className="sessions-actions">
                <Button
                  disabled={!selectedRun.sessionId}
                  onClick={() => handleOpenSession(selectedRun.sessionId)}
                  testId="executor-open-linked-session"
                  variant="secondary"
                >
                  Open Linked Session
                </Button>
                {selectedJob ? (
                  <Button
                    disabled={executorState.triggering || Boolean(selectedJob.activeRunId)}
                    onClick={() => {
                      void executorStore.runNow(selectedJob.id);
                    }}
                    testId="executor-rerun-selected"
                    variant="ghost"
                  >
                    Rerun Job
                  </Button>
                ) : null}
              </div>

              <LogViewer
                lines={selectedRun.events.map((event) => ({
                  level: event.level === 'warn' || event.level === 'error' || event.level === 'success'
                    ? event.level
                    : 'info',
                  timestamp: event.at,
                  message: `${event.type}: ${event.message}`,
                }))}
                testId="executor-run-log"
              />
            </div>
          ) : selectedJob ? (
            <div className="session-detail">
              <p className="session-detail-suggestion"><span>Job:</span> {selectedJob.title}</p>
              <p className="tracker-item-copy">{promptPreview(selectedJob.prompt)}</p>
              {latestSelectedJobRun ? (
                <Button
                  onClick={() => executorStore.selectRun(latestSelectedJobRun.id)}
                  testId="executor-select-latest-run"
                  variant="secondary"
                >
                  Open Latest Run
                </Button>
              ) : (
                <p className="state-message">This job has not produced a run yet.</p>
              )}
            </div>
          ) : (
            <p className="state-message">Select a job or run to inspect details.</p>
          )}

          {activeRuns.length > 0 ? (
            <div className="session-detail-artifacts">
              <h4>Active Runs</h4>
              <ul className="session-plan-list">
                {activeRuns.map((run) => (
                  <li key={run.id}>
                    <p className="session-plan-item-title">{run.id}</p>
                    <p className="session-plan-item-copy">
                      {run.status}
                      {run.sessionId ? ` | session:${run.sessionId}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Panel>
      </div>
    </section>
  );
}