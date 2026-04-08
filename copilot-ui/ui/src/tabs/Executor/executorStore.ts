import {
  cancelExecutorJob,
  createExecutorJob,
  getExecutorHealth,
  listSessions,
  listExecutorJobs,
  listExecutorRuns,
  triggerExecutorJob,
} from '../../lib/api';
import { resolveSessionStartedAt, resolveSessionUpdatedAt } from '../../lib/stateDiagnostics';
import { createStore } from '../../lib/store';
import type {
  CreateExecutorJobPayload,
  ExecutorHealthResponse,
  ExecutorJob,
  ExecutorRun,
  SessionSummary,
} from '../../lib/types';

export interface ExecutorState {
  health: ExecutorHealthResponse;
  jobs: ExecutorJob[];
  runs: ExecutorRun[];
  observedExternalSessions: SessionSummary[];
  selectedJobId: string | null;
  selectedRunId: string | null;
  loading: boolean;
  creating: boolean;
  triggering: boolean;
  cancelling: boolean;
  error: string | null;
  observationError: string | null;
}

const INITIAL_HEALTH: ExecutorHealthResponse = {
  enabled: false,
  state: 'unknown',
  jobCount: 0,
  runCount: 0,
  activeRunCount: 0,
  scheduledJobCount: 0,
  openedSessionCount: 0,
  lastError: null,
};

const INITIAL_STATE: ExecutorState = {
  health: INITIAL_HEALTH,
  jobs: [],
  runs: [],
  observedExternalSessions: [],
  selectedJobId: null,
  selectedRunId: null,
  loading: false,
  creating: false,
  triggering: false,
  cancelling: false,
  error: null,
  observationError: null,
};

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

function toSourceSet(session: SessionSummary): string[] {
  const sourceCandidates = [session.resolvedSourceSet, session.sources, session.source];
  const collected = new Set<string>();

  for (const candidate of sourceCandidates) {
    if (Array.isArray(candidate)) {
      for (const entry of candidate) {
        const normalized = typeof entry === 'string' ? entry.trim().toLowerCase() : '';
        if (normalized) {
          collected.add(normalized);
        }
      }
      continue;
    }

    const normalized = typeof candidate === 'string' ? candidate.trim().toLowerCase() : '';
    if (normalized) {
      collected.add(normalized);
    }
  }

  return Array.from(collected);
}

function isObservedExternalSession(session: SessionSummary): boolean {
  const sourceSet = toSourceSet(session);
  return sourceSet.includes('cli') || sourceSet.includes('vscode');
}

function sortObservedExternalSessions(left: SessionSummary, right: SessionSummary): number {
  const rightUpdatedAt = resolveSessionUpdatedAt(right) ?? resolveSessionStartedAt(right) ?? 0;
  const leftUpdatedAt = resolveSessionUpdatedAt(left) ?? resolveSessionStartedAt(left) ?? 0;
  if (rightUpdatedAt !== leftUpdatedAt) {
    return rightUpdatedAt - leftUpdatedAt;
  }

  return String(left.id || '').localeCompare(String(right.id || ''));
}

function normalizeObservedExternalSessions(sessions: SessionSummary[]): SessionSummary[] {
  return sessions.filter(isObservedExternalSession).sort(sortObservedExternalSessions).slice(0, 8);
}

export function createExecutorStore() {
  const store = createStore<ExecutorState>(INITIAL_STATE);
  let loadVersion = 0;
  let pollHandle: ReturnType<typeof setTimeout> | null = null;
  let polling = false;
  let pollIntervalMs = 3000;
  let loadInFlight = false;

  function reconcileSelection(jobs: ExecutorJob[], runs: ExecutorRun[]) {
    const state = store.getState();
    return {
      selectedJobId: jobs.some((job) => job.id === state.selectedJobId)
        ? state.selectedJobId
        : (jobs[0]?.id ?? null),
      selectedRunId: runs.some((run) => run.id === state.selectedRunId)
        ? state.selectedRunId
        : (runs[0]?.id ?? null),
    };
  }

  async function load(): Promise<void> {
    const requestVersion = loadVersion + 1;
    loadVersion = requestVersion;
    loadInFlight = true;
    store.setState((state) => ({ ...state, loading: true, error: null }));

    try {
      const [health, jobsResponse, runsResponse, sessionsResult] = await Promise.all([
        getExecutorHealth(),
        listExecutorJobs(),
        listExecutorRuns(),
        listSessions(undefined, { source: 'all', dedupe: 'on' })
          .then((response) => ({
            sessions: normalizeObservedExternalSessions(response.sessions),
            error: null,
          }))
          .catch((error) => ({
            sessions: [],
            error: toErrorMessage(error, 'Unable to observe external sessions.'),
          })),
      ]);

      if (requestVersion !== loadVersion) {
        return;
      }

      const selection = reconcileSelection(jobsResponse.jobs, runsResponse.runs);
      store.setState((state) => ({
        ...state,
        health,
        jobs: jobsResponse.jobs,
        runs: runsResponse.runs,
        observedExternalSessions: sessionsResult.sessions,
        selectedJobId: selection.selectedJobId,
        selectedRunId: selection.selectedRunId,
        loading: false,
        error: null,
        observationError: sessionsResult.error,
      }));
    } catch (error) {
      if (requestVersion !== loadVersion) {
        return;
      }

      store.setState((state) => ({
        ...state,
        loading: false,
        error: toErrorMessage(error, 'Unable to load executor state.'),
      }));
    } finally {
      loadInFlight = false;
    }
  }

  function scheduleNextPoll(): void {
    if (!polling) {
      return;
    }

    pollHandle = setTimeout(() => {
      pollHandle = null;
      void pollOnce();
    }, pollIntervalMs);
  }

  async function pollOnce(): Promise<void> {
    if (!polling) {
      return;
    }

    if (loadInFlight) {
      scheduleNextPoll();
      return;
    }

    try {
      await load();
    } finally {
      scheduleNextPoll();
    }
  }

  function startPolling(intervalMs = 3000): void {
    if (polling) {
      return;
    }

    polling = true;
    pollIntervalMs = intervalMs;
    scheduleNextPoll();
  }

  function stopPolling(): void {
    polling = false;

    if (pollHandle) {
      clearTimeout(pollHandle);
      pollHandle = null;
    }
  }

  function selectJob(jobId: string | null): void {
    store.setState((state) => ({
      ...state,
      selectedJobId: jobId,
    }));
  }

  function selectRun(runId: string | null): void {
    store.setState((state) => ({
      ...state,
      selectedRunId: runId,
    }));
  }

  async function submitJob(payload: CreateExecutorJobPayload): Promise<void> {
    store.setState((state) => ({ ...state, creating: true, error: null }));
    try {
      const response = await createExecutorJob(payload);
      await load();
      store.setState((state) => ({
        ...state,
        creating: false,
        selectedJobId: response.job.id,
        selectedRunId: response.run?.id || state.selectedRunId,
      }));
    } catch (error) {
      store.setState((state) => ({
        ...state,
        creating: false,
        error: toErrorMessage(error, 'Unable to create executor job.'),
      }));
    }
  }

  async function runNow(jobId: string): Promise<void> {
    store.setState((state) => ({ ...state, triggering: true, error: null }));
    try {
      const response = await triggerExecutorJob(jobId);
      await load();
      store.setState((state) => ({
        ...state,
        triggering: false,
        selectedJobId: response.run.jobId,
        selectedRunId: response.run.id,
      }));
    } catch (error) {
      store.setState((state) => ({
        ...state,
        triggering: false,
        error: toErrorMessage(error, 'Unable to trigger executor job.'),
      }));
    }
  }

  async function cancel(jobId: string): Promise<void> {
    store.setState((state) => ({ ...state, cancelling: true, error: null }));
    try {
      const response = await cancelExecutorJob(jobId);
      await load();
      store.setState((state) => ({
        ...state,
        cancelling: false,
        selectedJobId: response.job.id,
        selectedRunId: response.run?.id || state.selectedRunId,
      }));
    } catch (error) {
      store.setState((state) => ({
        ...state,
        cancelling: false,
        error: toErrorMessage(error, 'Unable to cancel executor job.'),
      }));
    }
  }

  function dispose(): void {
    stopPolling();
    store.setState(INITIAL_STATE);
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    load,
    startPolling,
    stopPolling,
    selectJob,
    selectRun,
    submitJob,
    runNow,
    cancel,
    dispose,
  };
}

export const executorStore = createExecutorStore();