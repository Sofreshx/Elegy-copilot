import { createStore } from '../../lib/store';
import {
  analyzeRepoOperations,
  approveRepoOperationsAgentRun,
  cancelRepoOperationsAgentRun,
  cleanupRepoOperationEntities,
  cleanupRepoOperations,
  fetchRepoOperations,
  getRepoOperationsAgentRun,
  getRepoOperationsOverview,
  startRepoOperationsAgentRun,
  syncRepoOperations,
  type RepoOperationsActionResult,
  type RepoOperationsAgentRun,
  type RepoOperationsCleanupCandidate,
  type RepoOperationsCleanupResult,
  type RepoOperationsOverview,
  type RepoOperationsSyncResult,
} from '../../lib/api/repoOperations';

export type RepoOperationsFilter = 'all' | 'attention' | 'sync-eligible' | 'pr-action' | 'branches' | 'pull-requests';
export type RepoOperationsTab = 'repositories' | 'entities' | 'pull-requests' | 'agent-runs';

export interface RepoOperationsState {
  overview: RepoOperationsOverview | null;
  loading: boolean;
  refreshing: boolean;
  authorizationFresh: boolean;
  error: string | null;
  searchQuery: string;
  filter: RepoOperationsFilter;
  activeTab: RepoOperationsTab;
  selectedEntityKeys: string[];
  syncing: boolean;
  syncResult: RepoOperationsSyncResult | null;
  cleaning: boolean;
  cleanupResult: RepoOperationsCleanupResult | null;
  actionResult: RepoOperationsActionResult | null;
  actionError: string | null;
  agentRuns: Record<string, RepoOperationsAgentRun>;
}

const INITIAL_STATE: RepoOperationsState = {
  overview: null, loading: false, refreshing: false, authorizationFresh: false, error: null, searchQuery: '', filter: 'all', activeTab: 'repositories', selectedEntityKeys: [],
  syncing: false, syncResult: null, cleaning: false, cleanupResult: null, actionResult: null, actionError: null, agentRuns: {},
};

function createRepoOperationsStore() {
  const store = createStore<RepoOperationsState>(INITIAL_STATE);
  const setError = (error: unknown) => store.setState((state) => ({ ...state, actionError: error instanceof Error ? error.message : String(error) }));

  async function loadOverview(options: { cachedFirst?: boolean } = {}): Promise<void> {
    const cachedFirst = options.cachedFirst ?? store.getState().overview === null;
    const initialOverview = store.getState().overview;
    store.setState((state) => ({
      ...state,
      loading: initialOverview === null,
      refreshing: initialOverview !== null,
      error: null,
    }));

    if (cachedFirst) {
      try {
        const cachedOverview = await getRepoOperationsOverview('cached');
        const cacheHit = cachedOverview.cache?.mode === 'cached';
        store.setState((state) => ({
          ...state,
          overview: cachedOverview,
          loading: false,
          refreshing: cacheHit,
          authorizationFresh: !cacheHit,
          error: null,
        }));
        if (!cacheHit) return;
      } catch {
        // A missing or unreadable presentation cache must not prevent the canonical fresh scan.
      }
    }

    store.setState((state) => ({
      ...state,
      loading: state.overview === null,
      refreshing: state.overview !== null,
    }));
    try {
      const overview = await getRepoOperationsOverview('fresh');
      store.setState((state) => ({ ...state, overview, loading: false, refreshing: false, authorizationFresh: true, error: null }));
    } catch (error) {
      store.setState((state) => ({ ...state, loading: false, refreshing: false, error: error instanceof Error ? error.message : String(error) }));
    }
  }

  async function syncEligibleRepositories(repoIds?: string[]): Promise<void> {
    store.setState((state) => ({ ...state, syncing: true, actionError: null, syncResult: null }));
    try {
      const syncResult = await syncRepoOperations({ confirmed: true, ...(repoIds?.length ? { repoIds } : {}) });
      store.setState((state) => ({ ...state, syncing: false, syncResult }));
      await loadOverview();
    } catch (error) { store.setState((state) => ({ ...state, syncing: false })); setError(error); }
  }

  async function fetchRemotes(repoIds?: string[]): Promise<void> {
    store.setState((state) => ({ ...state, actionError: null, actionResult: null }));
    try {
      const actionResult = await fetchRepoOperations({ confirmed: true, ...(repoIds?.length ? { repoIds } : {}) });
      store.setState((state) => ({ ...state, actionResult }));
      await loadOverview();
    } catch (error) { setError(error); }
  }

  async function analyzeSelected(entities: Array<{ repoId: string; entityId: string }>): Promise<void> {
    if (entities.length === 0) return;
    store.setState((state) => ({ ...state, actionError: null, actionResult: null }));
    try {
      const actionResult = await analyzeRepoOperations({ entities });
      const evidenceByEntity = new Map((actionResult.entities || []).map((entry) => [`${entry.repoId}\u0000${entry.entityId}`, entry]));
      store.setState((state) => ({
        ...state,
        actionResult,
        overview: state.overview ? {
          ...state.overview,
          repositories: state.overview.repositories.map((repository) => ({
            ...repository,
            entities: repository.entities?.map((entity) => {
              const result = evidenceByEntity.get(`${repository.repoId}\u0000${entity.id}`);
              if (!result?.evidence) return entity;
              return {
                ...entity,
                analysis: result.evidence,
                safety: result.evidence.classification,
                blockerCodes: result.blockerCodes,
              };
            }),
          })),
        } : null,
      }));
    } catch (error) { setError(error); }
  }

  async function cleanupSelectedEntities(mode: 'strict' | 'analyzed', entities: Array<{ repoId: string; entityId: string; observedSha: string | null }>): Promise<void> {
    if (entities.length === 0) return;
    store.setState((state) => ({ ...state, cleaning: true, actionError: null, actionResult: null }));
    try {
      const actionResult = await cleanupRepoOperationEntities({ confirmed: true, mode, entities });
      store.setState((state) => ({ ...state, cleaning: false, actionResult, selectedEntityKeys: [] }));
      await loadOverview();
    } catch (error) { store.setState((state) => ({ ...state, cleaning: false })); setError(error); }
  }

  async function cleanupMergedWorktrees(candidates: RepoOperationsCleanupCandidate[]): Promise<void> {
    store.setState((state) => ({ ...state, cleaning: true, actionError: null, cleanupResult: null }));
    try {
      const cleanupResult = await cleanupRepoOperations({ confirmed: true, candidates: candidates.map((candidate) => ({ repoId: candidate.repoId, worktreePath: candidate.worktreePath, branch: candidate.branch, observedBranchSha: candidate.observedBranchSha, observedDefaultSha: candidate.observedDefaultSha })) });
      store.setState((state) => ({ ...state, cleaning: false, cleanupResult }));
      await loadOverview();
    } catch (error) { store.setState((state) => ({ ...state, cleaning: false })); setError(error); }
  }

  async function prepareAgentRun(input: Parameters<typeof startRepoOperationsAgentRun>[0]): Promise<void> {
    try {
      const result = await startRepoOperationsAgentRun(input);
      if (result.run?.id) store.setState((state) => ({ ...state, actionError: null, agentRuns: { ...state.agentRuns, [result.run.id]: result.run } }));
    } catch (error) { setError(error); }
  }
  async function refreshAgentRun(runId: string): Promise<void> { try { const run = await getRepoOperationsAgentRun(runId); store.setState((state) => ({ ...state, agentRuns: { ...state.agentRuns, [run.id]: run }, actionError: null })); } catch (error) { setError(error); } }
  async function approveAgentRun(runId: string): Promise<void> { try { const run = await approveRepoOperationsAgentRun(runId); store.setState((state) => ({ ...state, agentRuns: { ...state.agentRuns, [run.id]: run }, actionError: null })); if (run.status === 'completed') await loadOverview(); } catch (error) { setError(error); } }
  async function cancelAgentRun(runId: string): Promise<void> { try { const run = await cancelRepoOperationsAgentRun(runId); store.setState((state) => ({ ...state, agentRuns: { ...state.agentRuns, [run.id]: run }, actionError: null })); } catch (error) { setError(error); } }
  function setSearchQuery(searchQuery: string): void { store.setState((state) => ({ ...state, searchQuery })); }
  function setFilter(filter: RepoOperationsFilter): void {
    store.setState((state) => ({
      ...state,
      filter,
      activeTab: filter === 'branches' ? 'entities' : filter === 'pull-requests' || filter === 'pr-action' ? 'pull-requests' : state.activeTab,
    }));
  }
  function setActiveTab(activeTab: RepoOperationsTab): void { store.setState((state) => ({ ...state, activeTab })); }
  function toggleEntitySelection(key: string): void { store.setState((state) => ({ ...state, selectedEntityKeys: state.selectedEntityKeys.includes(key) ? state.selectedEntityKeys.filter((entry) => entry !== key) : [...state.selectedEntityKeys, key] })); }
  function clearEntitySelection(): void { store.setState((state) => ({ ...state, selectedEntityKeys: [] })); }
  function setEntitySelection(selectedEntityKeys: string[]): void { store.setState((state) => ({ ...state, selectedEntityKeys })); }
  function reset(): void { store.setState(INITIAL_STATE); }
  return { getState: store.getState, subscribe: store.subscribe, setState: store.setState, loadOverview, setSearchQuery, setFilter, setActiveTab, toggleEntitySelection, clearEntitySelection, setEntitySelection, syncEligibleRepositories, fetchRemotes, analyzeSelected, cleanupSelectedEntities, cleanupMergedWorktrees, prepareAgentRun, refreshAgentRun, approveAgentRun, cancelAgentRun, reset };
}

export const repoOperationsStore = createRepoOperationsStore();
