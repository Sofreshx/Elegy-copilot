import { createStore } from '../lib/store';
import {
  discoverGitChecks,
  getGitCheckPlan,
  getGitCheckState,
  getGitCiSync,
  getGitHubCheckHistory,
  getRepoQualityStatus,
  runGitChecksWithProfile,
} from '../lib/api/git';
import type {
  GitCheckResults,
  GitCheckPlanResponse,
  GitCheckStateResponse,
  GitChecksDiscoverResponse,
  GitCiSyncResponse,
  GitHubCheckHistoryResponse,
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
  /** Read-only AI-selected proof plan for the current change. */
  checkPlan: GitCheckPlanResponse | null;
  /** Read-only GitHub run history; never merged into local evidence. */
  githubHistory: GitHubCheckHistoryResponse | null;
  /** Last load/refresh failure, kept visible to the Checks surface. */
  error: string | null;
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
  checkPlan: null,
  githubHistory: null,
  error: null,
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
      const [stateResult, ciSyncResult, discoveryResult, qualityStatus, checkPlan, githubHistory] = await Promise.all([
        getGitCheckState(repoPath),
        getGitCiSync(repoPath),
        discoverGitChecks(repoPath),
        getRepoQualityStatus(repoPath),
        getGitCheckPlan(repoPath, 'commit'),
        getGitHubCheckHistory(repoPath, { branch: null }),
      ]);
      if (version !== loadVersion) return;
      store.setState((s) => ({
        ...s,
        checkState: stateResult,
        ciSync: ciSyncResult,
        discoveredChecks: discoveryResult,
        qualityStatus,
        checkPlan,
        githubHistory,
        error: null,
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
    } catch (error) {
      if (version !== loadVersion) return;
      store.setState((s) => ({
        ...s,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  /** Refresh persisted state, discovery, and CI sync without resetting run session. */
  async function refresh(repoPath: string): Promise<void> {
    const version = ++loadVersion;
    store.setState((s) => ({ ...s, loading: true }));
    try {
      const [stateResult, ciSyncResult, discoveryResult, qualityStatus, checkPlan, githubHistory] = await Promise.all([
        getGitCheckState(repoPath),
        getGitCiSync(repoPath),
        discoverGitChecks(repoPath),
        getRepoQualityStatus(repoPath),
        getGitCheckPlan(repoPath, 'commit'),
        getGitHubCheckHistory(repoPath, { branch: null }),
      ]);
      if (version !== loadVersion) return;
      store.setState((s) => ({
        ...s,
        checkState: stateResult,
        ciSync: ciSyncResult,
        discoveredChecks: discoveryResult,
        qualityStatus,
        checkPlan,
        githubHistory,
        error: null,
        loading: false,
      }));
    } catch (error) {
      if (version !== loadVersion) return;
      store.setState((s) => ({
        ...s,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
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
    runOptions: {
      selectionMode?: string;
      action?: 'commit' | 'push' | 'ci-local' | 'release';
      selectedLanes?: string[];
    } = {},
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
      const currentPlan = store.getState().checkPlan;
      const action: 'commit' | 'push' | 'ci-local' | 'release' = runOptions.action
        || (profile === 'commit'
          ? 'commit'
          : profile === 'push'
            ? 'push'
            : profile === 'release'
              ? 'release'
              : 'ci-local');
      const selectionMode = runOptions.selectionMode || (profile === 'all' ? 'explicit-all' : 'profile');
      const runPlan = await getGitCheckPlan(repoPath, action, undefined, selectionMode).catch(() => currentPlan);
      const selectedLanes = selectionMode === 'recommended'
        ? (runPlan?.recommendedChecks ?? []).map((check) => check.id)
        : runOptions.selectedLanes;
      const results = await runGitChecksWithProfile(repoPath, {
        profile: profile === 'all' ? undefined : profile,
        runAll: profile === 'all',
        action,
        selectedLanes,
        planHash: runPlan?.planHash || currentPlan?.planHash || null,
        selectionMode,
        background: true,
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
