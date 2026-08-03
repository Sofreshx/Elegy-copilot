import { createStore } from '../../lib/store';
import {
  approveRepoOperationsAgentRun,
  cancelRepoOperationsAgentRun,
  getRepoOperationsOverview,
  getRepoOperationsAgentRun,
  startRepoOperationsAgentRun,
  syncRepoOperations,
  type RepoOperationsAgentRun,
  type RepoOperationsSyncResult,
  type RepoOperationsOverview,
} from '../../lib/api/repoOperations';

export type RepoOperationsFilter = 'all' | 'attention' | 'sync-eligible' | 'pr-action' | 'branches' | 'pull-requests';

export interface RepoOperationsState {
  overview: RepoOperationsOverview | null;
  loading: boolean;
  error: string | null;
  searchQuery: string;
  filter: RepoOperationsFilter;
  syncing: boolean;
  syncResult: RepoOperationsSyncResult | null;
  actionError: string | null;
  agentRuns: Record<string, RepoOperationsAgentRun>;
}

const INITIAL_STATE: RepoOperationsState = {
  overview: null,
  loading: false,
  error: null,
  searchQuery: '',
  filter: 'all',
  syncing: false,
  syncResult: null,
  actionError: null,
  agentRuns: {},
};

function createRepoOperationsStore() {
  const store = createStore<RepoOperationsState>(INITIAL_STATE);

  async function loadOverview(): Promise<void> {
    store.setState((state) => ({ ...state, loading: true, error: null, actionError: null }));
    try {
      const overview = await getRepoOperationsOverview();
      store.setState((state) => ({ ...state, overview, loading: false }));
    } catch (error) {
      store.setState((state) => ({
        ...state,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async function syncEligibleRepositories(): Promise<void> {
    store.setState((state) => ({ ...state, syncing: true, actionError: null, syncResult: null }));
    try {
      const result = await syncRepoOperations({ confirmed: true });
      store.setState((state) => ({ ...state, syncing: false, syncResult: result }));
      await loadOverview();
    } catch (error) {
      store.setState((state) => ({
        ...state,
        syncing: false,
        actionError: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async function prepareAgentRun(input: Parameters<typeof startRepoOperationsAgentRun>[0]): Promise<void> {
    store.setState((state) => ({ ...state, actionError: null }));
    try {
      const result = await startRepoOperationsAgentRun(input);
      if (result.run?.id) {
        store.setState((state) => ({
          ...state,
          agentRuns: { ...state.agentRuns, [result.run.id]: result.run },
        }));
      }
    } catch (error) {
      store.setState((state) => ({
        ...state,
        actionError: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async function refreshAgentRun(runId: string): Promise<void> {
    try {
      const run = await getRepoOperationsAgentRun(runId);
      store.setState((state) => ({ ...state, agentRuns: { ...state.agentRuns, [run.id]: run }, actionError: null }));
    } catch (error) {
      store.setState((state) => ({ ...state, actionError: error instanceof Error ? error.message : String(error) }));
    }
  }

  async function approveAgentRun(runId: string): Promise<void> {
    try {
      const run = await approveRepoOperationsAgentRun(runId);
      store.setState((state) => ({ ...state, agentRuns: { ...state.agentRuns, [run.id]: run }, actionError: null }));
      if (run.status === 'completed') await loadOverview();
    } catch (error) {
      store.setState((state) => ({ ...state, actionError: error instanceof Error ? error.message : String(error) }));
    }
  }

  async function cancelAgentRun(runId: string): Promise<void> {
    try {
      const run = await cancelRepoOperationsAgentRun(runId);
      store.setState((state) => ({ ...state, agentRuns: { ...state.agentRuns, [run.id]: run }, actionError: null }));
    } catch (error) {
      store.setState((state) => ({ ...state, actionError: error instanceof Error ? error.message : String(error) }));
    }
  }

  function setSearchQuery(searchQuery: string): void {
    store.setState((state) => ({ ...state, searchQuery }));
  }

  function setFilter(filter: RepoOperationsFilter): void {
    store.setState((state) => ({ ...state, filter }));
  }

  function reset(): void {
    store.setState(INITIAL_STATE);
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    setState: store.setState,
    loadOverview,
    setSearchQuery,
    setFilter,
    syncEligibleRepositories,
    prepareAgentRun,
    refreshAgentRun,
    approveAgentRun,
    cancelAgentRun,
    reset,
  };
}

export const repoOperationsStore = createRepoOperationsStore();
