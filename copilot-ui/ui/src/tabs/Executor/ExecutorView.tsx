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
import type {
  CreateExecutorJobPayload,
  ExecutorJob,
  ExecutorRun,
  SessionOrchestrationProjection,
  UiRuntimeOverlayAnnotation,
  UiRuntimeOverlayAnnotationStatus,
  UiRuntimeOverlayChangeRequest,
  UiRuntimeOverlayChangeRequestStatus,
  UiRuntimeOverlayObservation,
  UiRuntimeOverlayObservationKind,
  UiRuntimeOverlayQualitySignal,
  UiRuntimeOverlaySession,
} from '../../lib/types';
import { navigationStore } from '../../stores/navigation';
import { sdkHealthStore } from '../../stores/sdkHealthStore';
import SandboxesView from '../Sandboxes/SandboxesView';
import { sessionsStore } from '../Sessions/sessionsStore';
import { sdkSessionsStore } from '../Sessions/sdkSessionsStore';
import { executorStore } from './executorStore';
import { uiRuntimeOverlayStore } from './uiRuntimeOverlayStore';

interface OverlayObservationDraft {
  kind: UiRuntimeOverlayObservationKind;
  summary: string;
  snapshotSummary: string;
  locatorSelector: string;
  locatorRole: string;
  locatorLabel: string;
  locatorText: string;
  locatorTestId: string;
  locatorComponentName: string;
  interactionAction: string;
  interactionOutcome: string;
  interactionLatencyMs: string;
  stateKind: string;
  stateDetail: string;
}

interface OverlayAnnotationDraft {
  observationId: string;
  title: string;
  message: string;
  status: UiRuntimeOverlayAnnotationStatus;
}

interface OverlayChangeRequestDraft {
  observationId: string;
  annotationId: string;
  title: string;
  request: string;
  prompt: string;
  status: UiRuntimeOverlayChangeRequestStatus;
}

const OBSERVATION_KIND_OPTIONS: UiRuntimeOverlayObservationKind[] = [
  'interaction',
  'snapshot',
  'state',
  'locator',
  'note',
];

const ANNOTATION_STATUS_OPTIONS: UiRuntimeOverlayAnnotationStatus[] = ['open', 'resolved', 'dismissed'];

const CHANGE_REQUEST_STATUS_OPTIONS: UiRuntimeOverlayChangeRequestStatus[] = ['draft'];

const OBSERVATION_STATE_KIND_OPTIONS = ['', 'ready', 'loading', 'blocked', 'disabled', 'error', 'empty'];

function createInitialObservationDraft(): OverlayObservationDraft {
  return {
    kind: 'interaction',
    summary: '',
    snapshotSummary: '',
    locatorSelector: '',
    locatorRole: '',
    locatorLabel: '',
    locatorText: '',
    locatorTestId: '',
    locatorComponentName: '',
    interactionAction: '',
    interactionOutcome: '',
    interactionLatencyMs: '',
    stateKind: '',
    stateDetail: '',
  };
}

function createInitialAnnotationDraft(): OverlayAnnotationDraft {
  return {
    observationId: '',
    title: '',
    message: '',
    status: 'open',
  };
}

function createInitialChangeRequestDraft(): OverlayChangeRequestDraft {
  return {
    observationId: '',
    annotationId: '',
    title: '',
    request: '',
    prompt: '',
    status: 'draft',
  };
}

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

function normalizeOptionalText(value: string): string | undefined {
  const normalized = value.trim();
  return normalized || undefined;
}

function formatOptionalText(value: string | null | undefined, fallback = '(none)'): string {
  const normalized = String(value || '').trim();
  return normalized || fallback;
}

function joinSummaryParts(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' | ');
}

function resolveOverlaySessionLabel(session: UiRuntimeOverlaySession): string {
  return session.repoLabel || session.repoId || session.id;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function buildExecutorTaskBoardProjection(
  selectedRun: ExecutorRun | null,
  selectedJob: ExecutorJob | null,
  linkedSessionProjection: SessionOrchestrationProjection | null,
): SessionOrchestrationProjection | null {
  if (linkedSessionProjection) {
    return linkedSessionProjection;
  }

  const source = selectedRun ?? selectedJob;
  if (!source) {
    return null;
  }

  const orchestration = asRecord(source.orchestration);
  const repo = asRecord(orchestration.repo);
  const isolation = asRecord(orchestration.isolation);
  const workflow = asRecord(orchestration.workflow);
  const taskRefs = Array.isArray(orchestration.taskRefs) ? orchestration.taskRefs : [];
  const actors = Array.isArray(orchestration.actors) ? orchestration.actors : [];

  return {
    sessionId: selectedRun?.sessionId || selectedJob?.existingSessionId || null,
    objective: typeof orchestration.objective === 'string' ? orchestration.objective : null,
    repo: {
      repoId: typeof source.repoId === 'string' ? source.repoId : (typeof repo.repoId === 'string' ? repo.repoId : null),
      repoPath: typeof source.repoPath === 'string' ? source.repoPath : (typeof repo.repoPath === 'string' ? repo.repoPath : null),
      repoLabel: typeof repo.repoLabel === 'string' ? repo.repoLabel : null,
      branch: typeof repo.branch === 'string' ? repo.branch : null,
      source: typeof repo.source === 'string' ? repo.source : 'executor',
    },
    isolation: {
      mode: typeof isolation.mode === 'string' ? isolation.mode : (source.worktree?.mode || null),
      contextType: 'contextType' in source && typeof source.contextType === 'string' ? source.contextType : (typeof isolation.contextType === 'string' ? isolation.contextType : null),
      sandboxId: 'sandboxId' in source && typeof source.sandboxId === 'string' ? source.sandboxId : (typeof isolation.sandboxId === 'string' ? isolation.sandboxId : null),
      worktreeId: source.worktree?.worktreeId || (typeof isolation.worktreeId === 'string' ? isolation.worktreeId : null),
      worktreePath: source.worktree?.path || source.worktree?.worktreePath || (typeof isolation.worktreePath === 'string' ? isolation.worktreePath : null),
      worktreeStatus: source.worktree?.status || (typeof isolation.worktreeStatus === 'string' ? isolation.worktreeStatus : null),
      launchBlocked: source.worktree?.launch?.blocked === true || isolation.launchBlocked === true,
      launchBlockedReason: source.worktree?.launch?.reason || (typeof isolation.launchBlockedReason === 'string' ? isolation.launchBlockedReason : null),
      worktree: source.worktree || null,
    },
    actors: {
      items: actors as NonNullable<SessionOrchestrationProjection['actors']>['items'],
      activeActorId: typeof orchestration.activeActorId === 'string' ? orchestration.activeActorId : null,
    },
    taskBoard: {
      durableStore: 'repo-state',
      repoId: typeof source.repoId === 'string' ? source.repoId : (typeof repo.repoId === 'string' ? repo.repoId : null),
      items: taskRefs.map((entry) => {
        const task = asRecord(entry);
        return {
          taskId: typeof task.taskId === 'string' ? task.taskId : '',
          title: typeof task.title === 'string' ? task.title : null,
          status: typeof task.status === 'string'
            ? task.status
            : (typeof workflow.status === 'string' ? workflow.status : source.status),
          ownerSessionId: typeof task.ownerSessionId === 'string' ? task.ownerSessionId : (selectedRun?.sessionId || selectedJob?.existingSessionId || null),
          activeActorId: typeof task.activeActorId === 'string' ? task.activeActorId : null,
          activeActorLabel: typeof task.activeActorLabel === 'string' ? task.activeActorLabel : null,
          workflow: {
            latestRunId: selectedRun?.id || selectedJob?.lastRunId || null,
            status: typeof workflow.status === 'string' ? workflow.status : source.status,
            mode: typeof workflow.mode === 'string' ? workflow.mode : null,
          },
          worktree: source.worktree || null,
        };
      }).filter((task) => task.taskId),
    },
    workflow: {
      workflowKind: typeof workflow.workflowKind === 'string' ? workflow.workflowKind : 'task-execution',
      trigger: typeof workflow.trigger === 'string' ? workflow.trigger : 'manual',
      mode: typeof workflow.mode === 'string' ? workflow.mode : null,
      runId: selectedRun?.id || (typeof workflow.runId === 'string' ? workflow.runId : null),
      jobId: source.id,
      status: typeof workflow.status === 'string' ? workflow.status : source.status,
      runs: selectedRun ? [{
        runId: selectedRun.id,
        jobId: selectedRun.jobId,
        repoId: selectedRun.repoId,
        sessionId: selectedRun.sessionId,
        status: selectedRun.status,
        createdAt: selectedRun.createdAt,
        updatedAt: selectedRun.updatedAt,
        startedAt: selectedRun.startedAt,
        finishedAt: selectedRun.finishedAt,
        nextRetryAt: selectedRun.nextRetryAt,
        summary: selectedRun.summary,
        error: selectedRun.error,
      }] : [],
    },
  };
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
  const [observationDraft, setObservationDraft] = useState<OverlayObservationDraft>(createInitialObservationDraft);
  const [annotationDraft, setAnnotationDraft] = useState<OverlayAnnotationDraft>(createInitialAnnotationDraft);
  const [changeRequestDraft, setChangeRequestDraft] = useState<OverlayChangeRequestDraft>(createInitialChangeRequestDraft);

  useEffect(() => {
    void executorStore.load();
    executorStore.startPolling();
    void sdkHealthStore.refresh();
    void uiRuntimeOverlayStore.load();

    return () => {
      executorStore.stopPolling();
    };
  }, []);

  const selectedOverlaySession = useMemo(
    () => uiRuntimeOverlayState.sessions.find((session) => session.id === uiRuntimeOverlayState.selectedSessionId) ?? null,
    [uiRuntimeOverlayState.sessions, uiRuntimeOverlayState.selectedSessionId]
  );

  useEffect(() => {
    setAnnotationDraft((current) => (
      current.observationId
        ? { ...current, observationId: '' }
        : current
    ));
    setChangeRequestDraft((current) => (
      current.observationId || current.annotationId
        ? { ...current, observationId: '', annotationId: '' }
        : current
    ));
  }, [selectedOverlaySession?.id]);

  const selectedJob = useMemo(
    () => executorState.jobs.find((job) => job.id === executorState.selectedJobId) ?? null,
    [executorState.jobs, executorState.selectedJobId]
  );

  const selectedRun = useMemo(
    () => executorState.runs.find((run) => run.id === executorState.selectedRunId) ?? null,
    [executorState.runs, executorState.selectedRunId]
  );
  const linkedSessionProjection = selectedRun?.sessionId
    ? (executorState.sessionOrchestrationById[selectedRun.sessionId] ?? null)
    : null;
  const selectedTaskBoardProjection = useMemo(
    () => buildExecutorTaskBoardProjection(selectedRun, selectedJob, linkedSessionProjection),
    [linkedSessionProjection, selectedJob, selectedRun],
  );
  const selectedProjectionTasks = Array.isArray(selectedTaskBoardProjection?.taskBoard?.items)
    ? selectedTaskBoardProjection.taskBoard.items
    : [];

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
  const selectedOverlayObservations = selectedOverlaySession?.observations ?? [];
  const selectedOverlayAnnotations = selectedOverlaySession?.annotations ?? [];
  const selectedOverlayChangeRequests = selectedOverlaySession?.changeRequests ?? [];
  const selectedOverlayQualitySignals = selectedOverlaySession?.qualitySignals ?? [];
  const canMutateSelectedOverlaySession = selectedOverlaySession?.status === 'attached';
  const queueableAnnotations = useMemo(
    () => selectedOverlayAnnotations.filter((annotation) => (
      !changeRequestDraft.observationId
      || !annotation.observationId
      || annotation.observationId === changeRequestDraft.observationId
    )),
    [changeRequestDraft.observationId, selectedOverlayAnnotations]
  );

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
      navigationStore.navigate('dashboard');
    });
  };

  const handleFollowSandboxSession = (sessionId: string) => {
    void (async () => {
      try {
        await sessionsStore.loadSessions();
        sessionsStore.selectSession(sessionId);
      } finally {
        navigationStore.navigate('dashboard');
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

  const handleSelectOverlaySession = (sessionId: string) => {
    uiRuntimeOverlayStore.selectSession(sessionId.trim() || null);
  };

  const handleChangeRequestObservationSelection = (observationId: string) => {
    const normalizedObservationId = observationId.trim();
    setChangeRequestDraft((current) => ({
      ...current,
      observationId: normalizedObservationId,
      annotationId: current.annotationId && selectedOverlayAnnotations.some((annotation) => (
        annotation.id === current.annotationId
        && (!normalizedObservationId || !annotation.observationId || annotation.observationId === normalizedObservationId)
      ))
        ? current.annotationId
        : '',
    }));
  };

  const handleChangeRequestAnnotationSelection = (annotationId: string) => {
    const normalizedAnnotationId = annotationId.trim();
    const selectedAnnotation = selectedOverlayAnnotations.find((annotation) => annotation.id === normalizedAnnotationId) ?? null;

    setChangeRequestDraft((current) => ({
      ...current,
      annotationId: normalizedAnnotationId,
      observationId: selectedAnnotation?.observationId || current.observationId,
    }));
  };

  const handleAddObservation = async () => {
    if (!selectedOverlaySession) {
      return;
    }

    const interactionLatencyMs = observationDraft.interactionLatencyMs.trim()
      ? Number(observationDraft.interactionLatencyMs)
      : Number.NaN;
    const response = await uiRuntimeOverlayStore.addObservation(selectedOverlaySession.id, {
      kind: observationDraft.kind,
      summary: observationDraft.summary,
      snapshotSummary: normalizeOptionalText(observationDraft.snapshotSummary),
      locator: {
        selector: normalizeOptionalText(observationDraft.locatorSelector),
        role: normalizeOptionalText(observationDraft.locatorRole),
        label: normalizeOptionalText(observationDraft.locatorLabel),
        text: normalizeOptionalText(observationDraft.locatorText),
        testId: normalizeOptionalText(observationDraft.locatorTestId),
        componentName: normalizeOptionalText(observationDraft.locatorComponentName),
      },
      interaction: {
        action: normalizeOptionalText(observationDraft.interactionAction),
        outcome: normalizeOptionalText(observationDraft.interactionOutcome),
        latencyMs: Number.isFinite(interactionLatencyMs)
          ? Math.max(0, Math.round(interactionLatencyMs))
          : undefined,
      },
      state: {
        kind: normalizeOptionalText(observationDraft.stateKind),
        detail: normalizeOptionalText(observationDraft.stateDetail),
      },
    });

    if (response) {
      setObservationDraft(createInitialObservationDraft());
    }
  };

  const handleAddAnnotation = async () => {
    if (!selectedOverlaySession) {
      return;
    }

    const response = await uiRuntimeOverlayStore.addAnnotation(selectedOverlaySession.id, {
      observationId: normalizeOptionalText(annotationDraft.observationId),
      title: normalizeOptionalText(annotationDraft.title),
      message: annotationDraft.message,
      status: annotationDraft.status,
    });

    if (response) {
      setAnnotationDraft(createInitialAnnotationDraft());
    }
  };

  const handleAddChangeRequest = async () => {
    if (!selectedOverlaySession) {
      return;
    }

    const response = await uiRuntimeOverlayStore.addChangeRequest(selectedOverlaySession.id, {
      observationId: normalizeOptionalText(changeRequestDraft.observationId),
      annotationId: normalizeOptionalText(changeRequestDraft.annotationId),
      title: normalizeOptionalText(changeRequestDraft.title),
      request: changeRequestDraft.request,
      prompt: normalizeOptionalText(changeRequestDraft.prompt),
      status: changeRequestDraft.status,
    });

    if (response) {
      setChangeRequestDraft(createInitialChangeRequestDraft());
    }
  };

  const handleQueueChangeRequest = async (changeRequestId: string) => {
    if (!selectedOverlaySession) {
      return;
    }

    const response = await uiRuntimeOverlayStore.queueChangeRequest(selectedOverlaySession.id, changeRequestId);
    if (!response) {
      return;
    }

    await executorStore.load();
    if (response.job?.id) {
      executorStore.selectJob(response.job.id);
    }
    if (response.run?.id) {
      executorStore.selectRun(response.run.id);
    }
  };

  const handleReleaseChangeRequest = async (changeRequestId: string) => {
    if (!selectedOverlaySession) {
      return;
    }

    await uiRuntimeOverlayStore.releaseChangeRequest(selectedOverlaySession.id, changeRequestId);
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

      <Panel
        subtitle="Planning owns the primary durable task board. Executor stays focused on workflow runs, queued work, overlays, and links back into that Planning surface."
        testId="executor-task-board-link-panel"
        title="Planning Task Board Link"
      >
        <div className="session-detail">
          <p className="session-detail-suggestion">
            <span>Selected workflow context:</span> {selectedRun?.id || selectedJob?.id || 'No run or job selected.'}
          </p>
          <p className="tracker-item-copy">
            {selectedProjectionTasks.length > 0
              ? `${selectedProjectionTasks.length} durable repo-state task(s) are linked to the selected executor workflow context. Open Planning for the primary board view.`
              : 'No durable task links were derived for the selected executor context yet.'}
          </p>
          <p className="tracker-item-copy">
            Executor keeps workflow-run authority, retry state, queue control, and overlay diagnostics. It does not become the primary task-board destination.
          </p>
        </div>
        {executorState.orchestrationError ? (
          <p className="sessions-error" role="alert">{executorState.orchestrationError}</p>
        ) : null}
        {selectedProjectionTasks.length > 0 ? (
          <ul className="tracker-session-list executor-job-list">
            {selectedProjectionTasks.slice(0, 5).map((task) => {
              const taskId = typeof task?.taskId === 'string' ? task.taskId : '(unknown task)';
              return (
                <li key={taskId}>
                  <div>
                    <p className="tracker-item-title">{typeof task?.title === 'string' && task.title.trim() ? task.title : taskId}</p>
                    <p className="tracker-item-copy">
                      {[
                        taskId,
                        humanizeToken(typeof task?.status === 'string' ? task.status : 'unknown'),
                        typeof task?.ownerSessionId === 'string' && task.ownerSessionId.trim() ? `owner ${task.ownerSessionId}` : '',
                      ].filter(Boolean).join(' | ')}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="state-message">Planning will keep showing repo-state tasks even when executor-specific additive metadata is currently empty.</p>
        )}
        <div className="sessions-actions">
          <Button
            onClick={() => navigationStore.navigate('planning')}
            testId="executor-open-planning-task-board"
            variant="secondary"
          >
            Open Planning Task Board
          </Button>
        </div>
      </Panel>

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
                onClick={() => navigationStore.setCatalogSectionId('repository')}
                testId="executor-ui-runtime-overlay-open-catalog"
                variant="secondary"
              >
                Open Repository Catalog
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
            <>
              <ul className="tracker-session-list executor-job-list">
                {uiRuntimeOverlayState.sessions.map((session) => {
                  const isAttachedSession = session.status === 'attached';
                  const isSelectedSession = selectedOverlaySession?.id === session.id;
                  const runtimeOrigin = resolveOverlayRuntimeOrigin(session.runtimeUrl, session.runtimeOrigin);

                  return (
                    <li className={isSelectedSession ? 'is-selected' : ''} key={session.id}>
                      <div>
                        <p className="tracker-item-title">{resolveOverlaySessionLabel(session)}</p>
                        <p className="tracker-item-copy">
                          {joinSummaryParts([
                            session.status,
                            runtimeOrigin,
                            `updated ${formatOptionalTimestamp(session.updatedAt)}`,
                          ])}
                        </p>
                        <p className="tracker-item-copy">Runtime URL: {session.runtimeUrl}</p>
                        <p className="tracker-item-copy">
                          Repo: {session.repoLabel || session.repoId} | Package root: {session.packageRoot}
                        </p>
                        <p className="tracker-item-copy">
                          {session.observations.length} observation(s) | {session.annotations.length} annotation(s) | {session.changeRequests.length} change request(s)
                        </p>
                        <p className="tracker-item-copy">Session ID: {session.id}</p>
                        {session.lastAnalyzedAt ? (
                          <p className="tracker-item-copy">Last analyzed: {formatOptionalTimestamp(session.lastAnalyzedAt)}</p>
                        ) : null}
                        {session.closedAt ? (
                          <p className="tracker-item-copy">Closed: {formatOptionalTimestamp(session.closedAt)}</p>
                        ) : null}
                      </div>
                      <div className="tracker-item-actions">
                        <Button
                          onClick={() => handleSelectOverlaySession(session.id)}
                          size="sm"
                          testId={`executor-ui-runtime-overlay-select-${session.id}`}
                          variant={isSelectedSession ? 'primary' : 'ghost'}
                        >
                          {isSelectedSession ? 'Selected' : 'Select'}
                        </Button>
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

              <section className="session-detail-artifacts" data-testid="executor-ui-runtime-overlay-workspace">
                <h4>Selected Session Workspace</h4>
                <div className="sessions-controls executor-form-grid">
                  <label className="form-input" htmlFor="executor-ui-runtime-overlay-session-select">
                    <span className="form-label">Working Session</span>
                    <select
                      data-testid="executor-ui-runtime-overlay-session-select"
                      id="executor-ui-runtime-overlay-session-select"
                      onChange={(event) => handleSelectOverlaySession(event.target.value)}
                      value={uiRuntimeOverlayState.selectedSessionId || ''}
                    >
                      {uiRuntimeOverlayState.sessions.map((session) => (
                        <option key={session.id} value={session.id}>
                          {resolveOverlaySessionLabel(session)} | {session.status}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="session-detail">
                    {selectedOverlaySession ? (
                      <>
                        <p className="session-detail-suggestion">
                          <span>Working session:</span> {resolveOverlaySessionLabel(selectedOverlaySession)}
                        </p>
                        <dl className="detail-grid">
                          <div>
                            <dt>Status</dt>
                            <dd>{selectedOverlaySession.status}</dd>
                          </div>
                          <div>
                            <dt>Runtime</dt>
                            <dd>{resolveOverlayRuntimeOrigin(selectedOverlaySession.runtimeUrl, selectedOverlaySession.runtimeOrigin)}</dd>
                          </div>
                          <div>
                            <dt>Observed</dt>
                            <dd>{selectedOverlayObservations.length}</dd>
                          </div>
                          <div>
                            <dt>Annotations</dt>
                            <dd>{selectedOverlayAnnotations.length}</dd>
                          </div>
                          <div>
                            <dt>Change Requests</dt>
                            <dd>{selectedOverlayChangeRequests.length}</dd>
                          </div>
                          <div>
                            <dt>Quality Signals</dt>
                            <dd>{selectedOverlayQualitySignals.length}</dd>
                          </div>
                        </dl>
                        <p className="tracker-item-copy">Runtime URL: {selectedOverlaySession.runtimeUrl}</p>
                        <p className="tracker-item-copy">
                          Last analyzed: {formatOptionalTimestamp(selectedOverlaySession.lastAnalyzedAt)}
                        </p>
                        {!canMutateSelectedOverlaySession ? (
                          <p className="tracker-item-copy">
                            This session is closed. Select an attached session to add new observations, annotations, or change requests.
                          </p>
                        ) : null}
                      </>
                    ) : (
                      <p className="state-message">Select a runtime overlay session to work on.</p>
                    )}
                  </div>
                </div>
              </section>

              <section className="session-detail-artifacts">
                <h4>New Observation</h4>
                <div className="sessions-controls executor-form-grid">
                  <label className="form-input" htmlFor="executor-ui-runtime-overlay-observation-kind">
                    <span className="form-label">Kind</span>
                    <select
                      data-testid="executor-ui-runtime-overlay-observation-kind"
                      disabled={!canMutateSelectedOverlaySession || uiRuntimeOverlayState.addingObservation}
                      id="executor-ui-runtime-overlay-observation-kind"
                      onChange={(event) => setObservationDraft((current) => ({ ...current, kind: event.target.value }))}
                      value={observationDraft.kind}
                    >
                      {OBSERVATION_KIND_OPTIONS.map((kind) => (
                        <option key={kind} value={kind}>{kind}</option>
                      ))}
                    </select>
                  </label>

                  <label className="form-input" htmlFor="executor-ui-runtime-overlay-observation-summary">
                    <span className="form-label">Summary</span>
                    <textarea
                      data-testid="executor-ui-runtime-overlay-observation-summary"
                      disabled={!canMutateSelectedOverlaySession || uiRuntimeOverlayState.addingObservation}
                      id="executor-ui-runtime-overlay-observation-summary"
                      onChange={(event) => setObservationDraft((current) => ({ ...current, summary: event.target.value }))}
                      placeholder="Describe the operator-observed behavior."
                      rows={3}
                      value={observationDraft.summary}
                    />
                  </label>

                  <label className="form-input" htmlFor="executor-ui-runtime-overlay-observation-snapshot-summary">
                    <span className="form-label">Snapshot Summary (optional)</span>
                    <textarea
                      data-testid="executor-ui-runtime-overlay-observation-snapshot-summary"
                      disabled={!canMutateSelectedOverlaySession || uiRuntimeOverlayState.addingObservation}
                      id="executor-ui-runtime-overlay-observation-snapshot-summary"
                      onChange={(event) => setObservationDraft((current) => ({ ...current, snapshotSummary: event.target.value }))}
                      placeholder="Describe what the screen looked like when observed."
                      rows={2}
                      value={observationDraft.snapshotSummary}
                    />
                  </label>

                  <FormInput
                    disabled={!canMutateSelectedOverlaySession || uiRuntimeOverlayState.addingObservation}
                    id="executor-ui-runtime-overlay-locator-selector"
                    label="Locator Selector"
                    onValueChange={(value) => setObservationDraft((current) => ({ ...current, locatorSelector: value }))}
                    placeholder="#save-button"
                    testId="executor-ui-runtime-overlay-locator-selector"
                    value={observationDraft.locatorSelector}
                  />

                  <FormInput
                    disabled={!canMutateSelectedOverlaySession || uiRuntimeOverlayState.addingObservation}
                    id="executor-ui-runtime-overlay-locator-role"
                    label="Locator Role"
                    onValueChange={(value) => setObservationDraft((current) => ({ ...current, locatorRole: value }))}
                    placeholder="button"
                    testId="executor-ui-runtime-overlay-locator-role"
                    value={observationDraft.locatorRole}
                  />

                  <FormInput
                    disabled={!canMutateSelectedOverlaySession || uiRuntimeOverlayState.addingObservation}
                    id="executor-ui-runtime-overlay-locator-label"
                    label="Locator Label"
                    onValueChange={(value) => setObservationDraft((current) => ({ ...current, locatorLabel: value }))}
                    placeholder="Save"
                    testId="executor-ui-runtime-overlay-locator-label"
                    value={observationDraft.locatorLabel}
                  />

                  <FormInput
                    disabled={!canMutateSelectedOverlaySession || uiRuntimeOverlayState.addingObservation}
                    id="executor-ui-runtime-overlay-locator-text"
                    label="Locator Text"
                    onValueChange={(value) => setObservationDraft((current) => ({ ...current, locatorText: value }))}
                    placeholder="Save changes"
                    testId="executor-ui-runtime-overlay-locator-text"
                    value={observationDraft.locatorText}
                  />

                  <FormInput
                    disabled={!canMutateSelectedOverlaySession || uiRuntimeOverlayState.addingObservation}
                    id="executor-ui-runtime-overlay-locator-testid"
                    label="Locator Test ID"
                    onValueChange={(value) => setObservationDraft((current) => ({ ...current, locatorTestId: value }))}
                    placeholder="profile-save"
                    testId="executor-ui-runtime-overlay-locator-testid"
                    value={observationDraft.locatorTestId}
                  />

                  <FormInput
                    disabled={!canMutateSelectedOverlaySession || uiRuntimeOverlayState.addingObservation}
                    id="executor-ui-runtime-overlay-locator-component"
                    label="Component Name"
                    onValueChange={(value) => setObservationDraft((current) => ({ ...current, locatorComponentName: value }))}
                    placeholder="ProfileSaveButton"
                    testId="executor-ui-runtime-overlay-locator-component"
                    value={observationDraft.locatorComponentName}
                  />

                  <FormInput
                    disabled={!canMutateSelectedOverlaySession || uiRuntimeOverlayState.addingObservation}
                    id="executor-ui-runtime-overlay-interaction-action"
                    label="Interaction Action"
                    onValueChange={(value) => setObservationDraft((current) => ({ ...current, interactionAction: value }))}
                    placeholder="click"
                    testId="executor-ui-runtime-overlay-interaction-action"
                    value={observationDraft.interactionAction}
                  />

                  <FormInput
                    disabled={!canMutateSelectedOverlaySession || uiRuntimeOverlayState.addingObservation}
                    id="executor-ui-runtime-overlay-interaction-outcome"
                    label="Interaction Outcome"
                    onValueChange={(value) => setObservationDraft((current) => ({ ...current, interactionOutcome: value }))}
                    placeholder="no visible change"
                    testId="executor-ui-runtime-overlay-interaction-outcome"
                    value={observationDraft.interactionOutcome}
                  />

                  <FormInput
                    disabled={!canMutateSelectedOverlaySession || uiRuntimeOverlayState.addingObservation}
                    id="executor-ui-runtime-overlay-interaction-latency"
                    label="Interaction Latency (ms)"
                    onValueChange={(value) => setObservationDraft((current) => ({ ...current, interactionLatencyMs: value }))}
                    testId="executor-ui-runtime-overlay-interaction-latency"
                    type="number"
                    value={observationDraft.interactionLatencyMs}
                  />

                  <label className="form-input" htmlFor="executor-ui-runtime-overlay-state-kind">
                    <span className="form-label">State Kind (optional)</span>
                    <select
                      data-testid="executor-ui-runtime-overlay-state-kind"
                      disabled={!canMutateSelectedOverlaySession || uiRuntimeOverlayState.addingObservation}
                      id="executor-ui-runtime-overlay-state-kind"
                      onChange={(event) => setObservationDraft((current) => ({ ...current, stateKind: event.target.value }))}
                      value={observationDraft.stateKind}
                    >
                      {OBSERVATION_STATE_KIND_OPTIONS.map((kind) => (
                        <option key={kind || 'blank'} value={kind}>{kind || '(none)'}</option>
                      ))}
                    </select>
                  </label>

                  <FormInput
                    disabled={!canMutateSelectedOverlaySession || uiRuntimeOverlayState.addingObservation}
                    id="executor-ui-runtime-overlay-state-detail"
                    label="State Detail"
                    onValueChange={(value) => setObservationDraft((current) => ({ ...current, stateDetail: value }))}
                    placeholder="Save button stayed disabled after valid input."
                    testId="executor-ui-runtime-overlay-state-detail"
                    value={observationDraft.stateDetail}
                  />

                  <div className="sessions-actions">
                    <Button
                      disabled={!canMutateSelectedOverlaySession || uiRuntimeOverlayState.addingObservation || observationDraft.summary.trim().length === 0}
                      onClick={() => {
                        void handleAddObservation();
                      }}
                      testId="executor-ui-runtime-overlay-add-observation"
                    >
                      {uiRuntimeOverlayState.addingObservation ? 'Saving Observation...' : 'Add Observation'}
                    </Button>
                  </div>
                </div>
              </section>

              <section className="session-detail-artifacts">
                <h4>New Annotation</h4>
                <div className="sessions-controls executor-form-grid">
                  <label className="form-input" htmlFor="executor-ui-runtime-overlay-annotation-observation">
                    <span className="form-label">Observation (optional)</span>
                    <select
                      data-testid="executor-ui-runtime-overlay-annotation-observation"
                      disabled={!canMutateSelectedOverlaySession || uiRuntimeOverlayState.addingAnnotation}
                      id="executor-ui-runtime-overlay-annotation-observation"
                      onChange={(event) => setAnnotationDraft((current) => ({ ...current, observationId: event.target.value }))}
                      value={annotationDraft.observationId}
                    >
                      <option value="">(none)</option>
                      {selectedOverlayObservations.map((observation) => (
                        <option key={observation.id} value={observation.id}>
                          {observation.kind} | {promptPreview(observation.summary)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <FormInput
                    disabled={!canMutateSelectedOverlaySession || uiRuntimeOverlayState.addingAnnotation}
                    id="executor-ui-runtime-overlay-annotation-title"
                    label="Title (optional)"
                    onValueChange={(value) => setAnnotationDraft((current) => ({ ...current, title: value }))}
                    placeholder="Validation issue"
                    testId="executor-ui-runtime-overlay-annotation-title"
                    value={annotationDraft.title}
                  />

                  <label className="form-input" htmlFor="executor-ui-runtime-overlay-annotation-status">
                    <span className="form-label">Status</span>
                    <select
                      data-testid="executor-ui-runtime-overlay-annotation-status"
                      disabled={!canMutateSelectedOverlaySession || uiRuntimeOverlayState.addingAnnotation}
                      id="executor-ui-runtime-overlay-annotation-status"
                      onChange={(event) => setAnnotationDraft((current) => ({ ...current, status: event.target.value }))}
                      value={annotationDraft.status}
                    >
                      {ANNOTATION_STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status}>{status}</option>
                      ))}
                    </select>
                  </label>

                  <label className="form-input" htmlFor="executor-ui-runtime-overlay-annotation-message">
                    <span className="form-label">Message</span>
                    <textarea
                      data-testid="executor-ui-runtime-overlay-annotation-message"
                      disabled={!canMutateSelectedOverlaySession || uiRuntimeOverlayState.addingAnnotation}
                      id="executor-ui-runtime-overlay-annotation-message"
                      onChange={(event) => setAnnotationDraft((current) => ({ ...current, message: event.target.value }))}
                      placeholder="Explain the issue, impact, or operator note."
                      rows={3}
                      value={annotationDraft.message}
                    />
                  </label>

                  <div className="sessions-actions">
                    <Button
                      disabled={!canMutateSelectedOverlaySession || uiRuntimeOverlayState.addingAnnotation || annotationDraft.message.trim().length === 0}
                      onClick={() => {
                        void handleAddAnnotation();
                      }}
                      testId="executor-ui-runtime-overlay-add-annotation"
                    >
                      {uiRuntimeOverlayState.addingAnnotation ? 'Saving Annotation...' : 'Add Annotation'}
                    </Button>
                  </div>
                </div>
              </section>

              <section className="session-detail-artifacts">
                <h4>New Change Request</h4>
                <div className="sessions-controls executor-form-grid">
                  <label className="form-input" htmlFor="executor-ui-runtime-overlay-change-request-observation">
                    <span className="form-label">Observation (optional)</span>
                    <select
                      data-testid="executor-ui-runtime-overlay-change-request-observation"
                      disabled={!canMutateSelectedOverlaySession || uiRuntimeOverlayState.addingChangeRequest}
                      id="executor-ui-runtime-overlay-change-request-observation"
                      onChange={(event) => handleChangeRequestObservationSelection(event.target.value)}
                      value={changeRequestDraft.observationId}
                    >
                      <option value="">(none)</option>
                      {selectedOverlayObservations.map((observation) => (
                        <option key={observation.id} value={observation.id}>
                          {observation.kind} | {promptPreview(observation.summary)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="form-input" htmlFor="executor-ui-runtime-overlay-change-request-annotation">
                    <span className="form-label">Annotation (optional)</span>
                    <select
                      data-testid="executor-ui-runtime-overlay-change-request-annotation"
                      disabled={!canMutateSelectedOverlaySession || uiRuntimeOverlayState.addingChangeRequest}
                      id="executor-ui-runtime-overlay-change-request-annotation"
                      onChange={(event) => handleChangeRequestAnnotationSelection(event.target.value)}
                      value={changeRequestDraft.annotationId}
                    >
                      <option value="">(none)</option>
                      {queueableAnnotations.map((annotation) => (
                        <option key={annotation.id} value={annotation.id}>
                          {annotation.status} | {promptPreview(annotation.title)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <FormInput
                    disabled={!canMutateSelectedOverlaySession || uiRuntimeOverlayState.addingChangeRequest}
                    id="executor-ui-runtime-overlay-change-request-title"
                    label="Title (optional)"
                    onValueChange={(value) => setChangeRequestDraft((current) => ({ ...current, title: value }))}
                    placeholder="Enable save after valid edits"
                    testId="executor-ui-runtime-overlay-change-request-title"
                    value={changeRequestDraft.title}
                  />

                  <label className="form-input" htmlFor="executor-ui-runtime-overlay-change-request-request">
                    <span className="form-label">Requested Change</span>
                    <textarea
                      data-testid="executor-ui-runtime-overlay-change-request-request"
                      disabled={!canMutateSelectedOverlaySession || uiRuntimeOverlayState.addingChangeRequest}
                      id="executor-ui-runtime-overlay-change-request-request"
                      onChange={(event) => setChangeRequestDraft((current) => ({ ...current, request: event.target.value }))}
                      placeholder="Describe the concrete implementation change needed."
                      rows={3}
                      value={changeRequestDraft.request}
                    />
                  </label>

                  <label className="form-input" htmlFor="executor-ui-runtime-overlay-change-request-prompt">
                    <span className="form-label">Executor Prompt (optional)</span>
                    <textarea
                      data-testid="executor-ui-runtime-overlay-change-request-prompt"
                      disabled={!canMutateSelectedOverlaySession || uiRuntimeOverlayState.addingChangeRequest}
                      id="executor-ui-runtime-overlay-change-request-prompt"
                      onChange={(event) => setChangeRequestDraft((current) => ({ ...current, prompt: event.target.value }))}
                      placeholder="Override the default executor prompt when needed."
                      rows={4}
                      value={changeRequestDraft.prompt}
                    />
                  </label>

                  <label className="form-input" htmlFor="executor-ui-runtime-overlay-change-request-status">
                    <span className="form-label">Status</span>
                    <select
                      data-testid="executor-ui-runtime-overlay-change-request-status"
                      disabled={!canMutateSelectedOverlaySession || uiRuntimeOverlayState.addingChangeRequest}
                      id="executor-ui-runtime-overlay-change-request-status"
                      onChange={(event) => setChangeRequestDraft((current) => ({ ...current, status: event.target.value }))}
                      value={changeRequestDraft.status}
                    >
                      {CHANGE_REQUEST_STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status}>{status}</option>
                      ))}
                    </select>
                  </label>

                  <div className="sessions-actions">
                    <Button
                      disabled={!canMutateSelectedOverlaySession || uiRuntimeOverlayState.addingChangeRequest || changeRequestDraft.request.trim().length === 0}
                      onClick={() => {
                        void handleAddChangeRequest();
                      }}
                      testId="executor-ui-runtime-overlay-add-change-request"
                    >
                      {uiRuntimeOverlayState.addingChangeRequest ? 'Saving Change Request...' : 'Add Change Request'}
                    </Button>
                  </div>
                </div>
              </section>

              <section className="session-detail-artifacts">
                <h4>Observations</h4>
                {selectedOverlayObservations.length === 0 ? (
                  <p className="state-message">No observations recorded on this session yet.</p>
                ) : (
                  <ul className="tracker-session-list executor-job-list">
                    {selectedOverlayObservations.map((observation) => {
                      const locatorSummary = joinSummaryParts([
                        observation.locator?.selector ? `selector:${observation.locator.selector}` : null,
                        observation.locator?.role ? `role:${observation.locator.role}` : null,
                        observation.locator?.label ? `label:${observation.locator.label}` : null,
                        observation.locator?.text ? `text:${observation.locator.text}` : null,
                        observation.locator?.testId ? `testId:${observation.locator.testId}` : null,
                        observation.locator?.componentName ? `component:${observation.locator.componentName}` : null,
                      ]);
                      const interactionSummary = joinSummaryParts([
                        observation.interaction?.action ? `action:${observation.interaction.action}` : null,
                        observation.interaction?.outcome ? `outcome:${observation.interaction.outcome}` : null,
                        observation.interaction?.latencyMs !== null && observation.interaction?.latencyMs !== undefined
                          ? `${observation.interaction.latencyMs}ms`
                          : null,
                      ]);
                      const stateSummary = joinSummaryParts([
                        observation.state?.kind ? `kind:${observation.state.kind}` : null,
                        observation.state?.detail ? observation.state.detail : null,
                      ]);

                      return (
                        <li key={observation.id}>
                          <div>
                            <p className="tracker-item-title">{observation.summary}</p>
                            <p className="tracker-item-copy">
                              {joinSummaryParts([observation.kind, `updated ${formatOptionalTimestamp(observation.updatedAt)}`])}
                            </p>
                            {observation.snapshotSummary ? (
                              <p className="tracker-item-copy">Snapshot: {observation.snapshotSummary}</p>
                            ) : null}
                            {locatorSummary ? <p className="tracker-item-copy">Locator: {locatorSummary}</p> : null}
                            {interactionSummary ? <p className="tracker-item-copy">Interaction: {interactionSummary}</p> : null}
                            {stateSummary ? <p className="tracker-item-copy">State: {stateSummary}</p> : null}
                            <p className="tracker-item-copy">Observation ID: {observation.id}</p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              <section className="session-detail-artifacts">
                <h4>Annotations</h4>
                {selectedOverlayAnnotations.length === 0 ? (
                  <p className="state-message">No annotations recorded on this session yet.</p>
                ) : (
                  <ul className="tracker-session-list executor-job-list">
                    {selectedOverlayAnnotations.map((annotation) => (
                      <li key={annotation.id}>
                        <div>
                          <p className="tracker-item-title">{annotation.title}</p>
                          <p className="tracker-item-copy">
                            {joinSummaryParts([
                              annotation.status,
                              annotation.observationId ? `observation:${annotation.observationId}` : 'session-level',
                              `updated ${formatOptionalTimestamp(annotation.updatedAt)}`,
                            ])}
                          </p>
                          <p className="tracker-item-copy">{annotation.message}</p>
                          <p className="tracker-item-copy">Annotation ID: {annotation.id}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="session-detail-artifacts">
                <h4>Change Requests</h4>
                {selectedOverlayChangeRequests.length === 0 ? (
                  <p className="state-message">No change requests recorded on this session yet.</p>
                ) : (
                  <ul className="tracker-session-list executor-job-list">
                    {selectedOverlayChangeRequests.map((changeRequest) => {
                      const hasQueuedExecutorJob = Boolean(changeRequest.executorJobId);
                      const isReservedChangeRequest = changeRequest.status === 'reserved';
                      const isQueueBlocked = hasQueuedExecutorJob || changeRequest.status !== 'draft';
                      const isQueueingChangeRequest = uiRuntimeOverlayState.queueingChangeRequestId === changeRequest.id;
                      const isReleasingChangeRequest = uiRuntimeOverlayState.releasingChangeRequestId === changeRequest.id;

                      return (
                        <li key={changeRequest.id}>
                          <div>
                            <p className="tracker-item-title">{changeRequest.title}</p>
                            <p className="tracker-item-copy">
                              {joinSummaryParts([
                                changeRequest.status,
                                changeRequest.observationId ? `observation:${changeRequest.observationId}` : null,
                                changeRequest.annotationId ? `annotation:${changeRequest.annotationId}` : null,
                                `updated ${formatOptionalTimestamp(changeRequest.updatedAt)}`,
                              ])}
                            </p>
                            <p className="tracker-item-copy">Requested change: {changeRequest.request}</p>
                            {changeRequest.prompt ? (
                              <p className="tracker-item-copy">Executor prompt: {promptPreview(changeRequest.prompt)}</p>
                            ) : null}
                            <p className="tracker-item-copy">
                              {joinSummaryParts([
                                `Change request ID: ${changeRequest.id}`,
                                changeRequest.executorJobId ? `job:${changeRequest.executorJobId}` : null,
                                changeRequest.executorRunId ? `run:${changeRequest.executorRunId}` : null,
                              ])}
                            </p>
                            {changeRequest.queuedAt ? (
                              <p className="tracker-item-copy">Queued: {formatOptionalTimestamp(changeRequest.queuedAt)}</p>
                            ) : null}
                          </div>
                          <div className="tracker-item-actions">
                            <Button
                              disabled={
                                !canMutateSelectedOverlaySession
                                || isQueueBlocked
                                || isQueueingChangeRequest
                                || isReleasingChangeRequest
                              }
                              onClick={() => {
                                void handleQueueChangeRequest(changeRequest.id);
                              }}
                              size="sm"
                              testId={`executor-ui-runtime-overlay-queue-${changeRequest.id}`}
                              variant="secondary"
                            >
                              {isQueueingChangeRequest
                                ? 'Queueing...'
                                : hasQueuedExecutorJob
                                  ? 'Queued'
                                  : isReservedChangeRequest
                                    ? 'Reserved'
                                  : isQueueBlocked
                                    ? 'Unavailable'
                                  : 'Queue In Executor'}
                            </Button>
                            {isReservedChangeRequest ? (
                              <Button
                                disabled={
                                  !canMutateSelectedOverlaySession
                                  || isQueueingChangeRequest
                                  || isReleasingChangeRequest
                                }
                                onClick={() => {
                                  void handleReleaseChangeRequest(changeRequest.id);
                                }}
                                size="sm"
                                testId={`executor-ui-runtime-overlay-release-${changeRequest.id}`}
                                variant="secondary"
                              >
                                {isReleasingChangeRequest ? 'Releasing...' : 'Release Reservation'}
                              </Button>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              <section className="session-detail-artifacts">
                <h4>Derived Quality Signals</h4>
                {selectedOverlayQualitySignals.length === 0 ? (
                  <p className="state-message">No derived quality signals on this session yet.</p>
                ) : (
                  <ul className="tracker-session-list executor-job-list">
                    {selectedOverlayQualitySignals.map((signal) => (
                      <li key={signal.id}>
                        <div>
                          <p className="tracker-item-title">{signal.summary}</p>
                          <p className="tracker-item-copy">
                            {joinSummaryParts([
                              signal.severity,
                              signal.kind,
                              `observation:${signal.observationId}`,
                              `created ${formatOptionalTimestamp(signal.createdAt)}`,
                            ])}
                          </p>
                          <p className="tracker-item-copy">Signal ID: {signal.id}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
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
