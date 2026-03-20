import {
  cancelExecutorJob,
  createExecutorJob,
  getExecutorHealth,
  listExecutorJobs,
  listExecutorRuns,
  triggerExecutorJob,
} from '../../lib/api';
import { createStore } from '../../lib/store';
import type {
  CreateExecutorJobPayload,
  ExecutorHealthResponse,
  ExecutorJob,
  ExecutorRun,
} from '../../lib/types';

export interface ExecutorState {
  health: ExecutorHealthResponse;
  jobs: ExecutorJob[];
  runs: ExecutorRun[];
  selectedJobId: string | null;
  selectedRunId: string | null;
  loading: boolean;
  creating: boolean;
  triggering: boolean;
  cancelling: boolean;
  error: string | null;
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
  selectedJobId: null,
  selectedRunId: null,
  loading: false,
  creating: false,
  triggering: false,
  cancelling: false,
  error: null,
};

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

function createExecutorStore() {
  const store = createStore<ExecutorState>(INITIAL_STATE);
  let loadVersion = 0;
  let pollHandle: ReturnType<typeof setInterval> | null = null;

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
    store.setState((state) => ({ ...state, loading: true, error: null }));

    try {
      const [health, jobsResponse, runsResponse] = await Promise.all([
        getExecutorHealth(),
        listExecutorJobs(),
        listExecutorRuns(),
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
        selectedJobId: selection.selectedJobId,
        selectedRunId: selection.selectedRunId,
        loading: false,
        error: null,
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
    }
  }

  function startPolling(intervalMs = 3000): void {
    if (pollHandle) {
      return;
    }

    pollHandle = setInterval(() => {
      void load();
    }, intervalMs);
  }

  function stopPolling(): void {
    if (!pollHandle) {
      return;
    }

    clearInterval(pollHandle);
    pollHandle = null;
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