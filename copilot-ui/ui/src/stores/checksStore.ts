import { createStore } from '../lib/store';
import {
  discoverGitChecks,
  getGitCheckState,
  getGitCiSync,
  getRepoQualityStatus,
  runGitChecksWithProfile,
} from '../lib/api/git';
import type {
  GitCheckResults,
  GitCheckStateResponse,
  GitChecksDiscoverResponse,
  GitCiSyncResponse,
  RepoQualityStatus,
} from '../lib/api/git';

export type RunOutcome = 'running' | 'pass' | 'fail' | 'error';

export interface RunSession {
  id: string;
  repoPath: string;
  profile: string;
  label: string;
  startedAt: string;
  endedAt: string | null;
  targetLanes: string[];
  outcome: RunOutcome;
  error: string | null;
  results: GitCheckResults | null;
}

export interface ChecksStoreState {
  repoPath: string | null;
  /** Active run session — persists across tab switches */
  runSession: RunSession | null;
  /** Whether checks are currently executing */
  runningChecks: boolean;
  /** Results from the most recent completed run */
  checkResults: GitCheckResults | null;
  /** Persisted check state from backend */
  checkState: GitCheckStateResponse | null;
  /** CI sync data */
  ciSync: GitCiSyncResponse | null;
  /** Discovered checks for the repo */
  discoveredChecks: GitChecksDiscoverResponse | null;
  /** Consolidated local hook/check and GitHub readiness. */
  qualityStatus: RepoQualityStatus | null;
  /** Initial load in progress */
  loading: boolean;
}

const INITIAL_STATE: ChecksStoreState = {
  repoPath: null,
  runSession: null,
  runningChecks: false,
  checkResults: null,
  checkState: null,
  ciSync: null,
  discoveredChecks: null,
  qualityStatus: null,
  loading: false,
};

function createChecksStore() {
  const store = createStore<ChecksStoreState>(INITIAL_STATE);
  let loadVersion = 0;

  /** Load persisted state, discovery, and CI sync for a repo. */
  async function load(repoPath: string): Promise<void> {
    const version = ++loadVersion;
    store.setState((s) => ({ ...s, repoPath, loading: true }));
    try {
      const [stateResult, ciSyncResult, discoveryResult, qualityStatus] = await Promise.all([
        getGitCheckState(repoPath),
        getGitCiSync(repoPath),
        discoverGitChecks(repoPath),
        getRepoQualityStatus(repoPath),
      ]);
      if (version !== loadVersion) return;
      store.setState((s) => ({
        ...s,
        checkState: stateResult,
        ciSync: ciSyncResult,
        discoveredChecks: discoveryResult,
        qualityStatus,
        loading: false,
        // Seed checkResults from persisted state if a prior run exists
        checkResults: s.checkResults ?? (stateResult.lastRun?.overallPass !== undefined
          ? {
              repoRoot: stateResult.repoPath,
              source: 'commit-check',
              checkedAt: stateResult.lastRun?.timestamp || '',
              checksAvailable: Object.keys(stateResult.lastRun?.lanes ?? {}).length,
              checksRun: Object.keys(stateResult.lastRun?.lanes ?? {}).length,
              checksPassed: 0,
              checksFailed: 0,
              allPassed: stateResult.lastRun?.overallPass ?? false,
              results: [],
              message: stateResult.lastRun?.overallPass ? 'All checks passed' : 'Some checks failed',
            }
          : null),
      }));
    } catch {
      if (version !== loadVersion) return;
      store.setState((s) => ({ ...s, loading: false }));
    }
  }

  /** Refresh persisted state, discovery, and CI sync without resetting run session. */
  async function refresh(repoPath: string): Promise<void> {
    const version = ++loadVersion;
    store.setState((s) => ({ ...s, loading: true }));
    try {
      const [stateResult, ciSyncResult, discoveryResult, qualityStatus] = await Promise.all([
        getGitCheckState(repoPath),
        getGitCiSync(repoPath),
        discoverGitChecks(repoPath),
        getRepoQualityStatus(repoPath),
      ]);
      if (version !== loadVersion) return;
      store.setState((s) => ({
        ...s,
        checkState: stateResult,
        ciSync: ciSyncResult,
        discoveredChecks: discoveryResult,
        qualityStatus,
        loading: false,
      }));
    } catch {
      if (version !== loadVersion) return;
      store.setState((s) => ({ ...s, loading: false }));
    }
  }

  /**
   * Start a check run. Returns a run ID that can be used to track progress.
   * The run executes in the background — the HTTP request completes when
   * all checks finish, but the store tracks the session independently.
   */
  async function startRun(
    repoPath: string,
    profile: string,
    label: string,
    targetLanes: string[],
  ): Promise<void> {
    const runId = `${Date.now()}-${profile}`;
    const session: RunSession = {
      id: runId,
      repoPath,
      profile,
      label,
      startedAt: new Date().toISOString(),
      endedAt: null,
      targetLanes,
      outcome: 'running',
      error: null,
      results: null,
    };

    store.setState((s) => ({
      ...s,
      runSession: session,
      runningChecks: true,
      checkResults: null,
    }));

    try {
      const results = await runGitChecksWithProfile(repoPath, {
        profile: profile === 'all' ? undefined : profile,
      });

      store.setState((s) => ({
        ...s,
        checkResults: results,
        runSession: s.runSession?.id === runId
          ? {
              ...s.runSession,
              endedAt: new Date().toISOString(),
              outcome: results.allPassed ? 'pass' : 'fail',
              results,
            }
          : s.runSession,
      }));

      // Refresh persisted state in background
      void refresh(repoPath);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      store.setState((s) => ({
        ...s,
        runSession: s.runSession?.id === runId
          ? {
              ...s.runSession,
              endedAt: new Date().toISOString(),
              outcome: 'error',
              error: message,
              results: null,
            }
          : s.runSession,
      }));
    } finally {
      store.setState((s) => ({ ...s, runningChecks: false }));
    }
  }

  /** Clear the current run session (e.g. after user acknowledges results). */
  function clearRunSession(): void {
    store.setState((s) => ({ ...s, runSession: null }));
  }

  /** Reset all state for a new repo. */
  function reset(): void {
    loadVersion++;
    store.setState(INITIAL_STATE);
  }

  return {
    store,
    load,
    refresh,
    startRun,
    clearRunSession,
    reset,
  };
}

export const checksStore = createChecksStore();
export const checksStoreSubscribe = checksStore.store.subscribe;
export const getChecksStoreState = checksStore.store.getState;
