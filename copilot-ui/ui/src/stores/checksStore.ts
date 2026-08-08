import { createStore } from '../lib/store';
import {
  discoverGitChecks,
  getGitCheckPlan,
  getGitCheckState,
  getGitCiSync,
  getGitHubCheckHistory,
  getRepoQualityLocalStatus,
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
  /** Remote GitHub status/history refresh in progress. */
  remoteLoading: boolean;
  /** Remote-only refresh failure; local evidence remains usable. */
  remoteError: string | null;
  /** Independent read state so one failed section does not hide successful siblings. */
  sections: Record<ChecksReadSection, ChecksReadSectionState>;
}

export type ChecksReadSection =
  | 'checkState'
  | 'ciSync'
  | 'discoveredChecks'
  | 'localQuality'
  | 'checkPlan'
  | 'githubStatus'
  | 'githubHistory';

export interface ChecksReadSectionState {
  loading: boolean;
  error: string | null;
  updatedAt: string | null;
}

const LOCAL_SECTIONS: ChecksReadSection[] = ['checkState', 'ciSync', 'discoveredChecks', 'localQuality', 'checkPlan'];
const REMOTE_SECTIONS: ChecksReadSection[] = ['githubStatus', 'githubHistory'];

function createReadSections(): ChecksStoreState['sections'] {
  return Object.fromEntries(
    [...LOCAL_SECTIONS, ...REMOTE_SECTIONS].map((section) => [section, { loading: false, error: null, updatedAt: null }]),
  ) as ChecksStoreState['sections'];
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
  remoteLoading: false,
  remoteError: null,
  sections: createReadSections(),
};

function createChecksStore() {
  const store = createStore<ChecksStoreState>(INITIAL_STATE);
  let loadVersion = 0;
  let remoteVersion = 0;

  function beginSections(repoPath: string, sectionNames: ChecksReadSection[], remote: boolean): void {
    store.setState((s) => {
      const repoChanged = s.repoPath !== repoPath;
      const sections = repoChanged ? createReadSections() : { ...s.sections };
      for (const section of sectionNames) {
        sections[section] = { ...sections[section], loading: true, error: null };
      }
      return {
        ...s,
        repoPath,
        runSession: repoChanged ? null : s.runSession,
        checkResults: repoChanged ? null : s.checkResults,
        checkState: repoChanged ? null : s.checkState,
        ciSync: repoChanged ? null : s.ciSync,
        discoveredChecks: repoChanged ? null : s.discoveredChecks,
        qualityStatus: repoChanged ? null : s.qualityStatus,
        checkPlan: repoChanged ? null : s.checkPlan,
        githubHistory: repoChanged ? null : s.githubHistory,
        error: remote ? s.error : null,
        loading: remote ? s.loading : true,
        remoteError: remote ? null : repoChanged ? null : s.remoteError,
        remoteLoading: remote ? true : repoChanged ? false : s.remoteLoading,
        sections,
      };
    });
  }

  function publishSection<T>(
    version: number,
    remote: boolean,
    section: ChecksReadSection,
    loadSection: () => Promise<T>,
    apply: (state: ChecksStoreState, value: T) => ChecksStoreState,
  ): Promise<void> {
    return loadSection().then((value) => {
      if (version !== (remote ? remoteVersion : loadVersion)) return;
      store.setState((s) => {
        const next = apply(s, value);
        return {
          ...next,
          sections: {
            ...next.sections,
            [section]: { loading: false, error: null, updatedAt: new Date().toISOString() },
          },
        };
      });
    }).catch((reason) => {
      if (version !== (remote ? remoteVersion : loadVersion)) return;
      const message = reason instanceof Error ? reason.message : String(reason);
      store.setState((s) => ({
        ...s,
        sections: {
          ...s.sections,
          [section]: { ...s.sections[section], loading: false, error: message },
        },
      }));
      throw reason;
    });
  }

  function finishSections(version: number, remote: boolean): void {
    if (version !== (remote ? remoteVersion : loadVersion)) return;
    const names = remote ? REMOTE_SECTIONS : LOCAL_SECTIONS;
    store.setState((s) => {
      const error = names.map((section) => s.sections[section].error).filter(Boolean).join('; ') || null;
      return remote
        ? { ...s, remoteLoading: false, remoteError: error }
        : { ...s, loading: false, error };
    });
  }

  /** Load persisted state, discovery, and CI sync for a repo. */
  async function load(repoPath: string): Promise<void> {
    const version = ++loadVersion;
    if (store.getState().repoPath !== repoPath) remoteVersion++;
    beginSections(repoPath, LOCAL_SECTIONS, false);
    const requests = [
      publishSection(version, false, 'checkState', () => getGitCheckState(repoPath), (s, stateResult) => ({
        ...s,
        checkState: stateResult,
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
      })),
      publishSection(version, false, 'ciSync', () => getGitCiSync(repoPath), (s, ciSync) => ({ ...s, ciSync })),
      publishSection(version, false, 'discoveredChecks', () => discoverGitChecks(repoPath), (s, discoveredChecks) => ({ ...s, discoveredChecks })),
      publishSection(version, false, 'localQuality', () => getRepoQualityLocalStatus(repoPath), (s, qualityStatus) => ({
        ...s,
        qualityStatus: s.qualityStatus && !s.qualityStatus.remote.deferred
          ? {
              ...qualityStatus,
              remote: s.qualityStatus.remote,
              remoteStatus: s.qualityStatus.remoteStatus,
            }
          : qualityStatus,
      })),
      publishSection(version, false, 'checkPlan', () => getGitCheckPlan(repoPath, 'commit'), (s, checkPlan) => ({ ...s, checkPlan })),
    ];
    await Promise.allSettled(requests);
    finishSections(version, false);
  }

  /** Refresh persisted state, discovery, and CI sync without resetting run session. */
  async function refresh(repoPath: string): Promise<void> {
    await load(repoPath);
  }

  /** Load GitHub-only readiness and history. Call from the Checks view or explicit background work. */
  async function loadRemote(repoPath: string, options: { allBranches?: boolean } = {}): Promise<void> {
    const version = ++remoteVersion;
    if (store.getState().repoPath !== repoPath) loadVersion++;
    beginSections(repoPath, REMOTE_SECTIONS, true);
    const requests = [
      publishSection(version, true, 'githubStatus', () => getRepoQualityStatus(repoPath), (s, remoteQuality) => ({
        ...s,
        qualityStatus: s.qualityStatus
          ? {
              ...s.qualityStatus,
              remote: remoteQuality.remote,
              remoteStatus: remoteQuality.remoteStatus,
            }
          : remoteQuality,
      })),
      publishSection(
        version,
        true,
        'githubHistory',
        () => getGitHubCheckHistory(repoPath, { branch: options.allBranches ? null : undefined }),
        (s, githubHistory) => ({ ...s, githubHistory }),
      ),
    ];
    await Promise.allSettled(requests);
    finishSections(version, true);
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
    remoteVersion++;
    store.setState(INITIAL_STATE);
  }

  return {
    store,
    load,
    refresh,
    loadRemote,
    startRun,
    clearRunSession,
    reset,
  };
}

export const checksStore = createChecksStore();
export const checksStoreSubscribe = checksStore.store.subscribe;
export const getChecksStoreState = checksStore.store.getState;
