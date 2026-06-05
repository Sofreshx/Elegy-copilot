import { createStore } from '../../lib/store';
import type {
  CatalogRepoInventoryEntry,
  CatalogRepoInventoryWorkspaceScan,
  CatalogReposListResponse,
  CatalogRepoScanRootsMutationResponse,
} from '../../lib/types';
import { apiRequest } from '../../lib/api/core';

export interface RepositoriesState {
  repos: CatalogRepoInventoryEntry[];
  selectedRepo: CatalogRepoInventoryEntry | null;
  workspaceScan: CatalogRepoInventoryWorkspaceScan | null;
  loading: boolean;
  error: string | null;
  searchQuery: string;
  githubAuthenticated: boolean;
  githubAuthChecking: boolean;
}

const INITIAL_STATE: RepositoriesState = {
  repos: [],
  selectedRepo: null,
  workspaceScan: null,
  loading: false,
  error: null,
  searchQuery: '',
  githubAuthenticated: false,
  githubAuthChecking: false,
};

function createRepositoriesStore() {
  const store = createStore<RepositoriesState>(INITIAL_STATE);

  async function loadInventory(): Promise<void> {
    store.setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await apiRequest<CatalogReposListResponse>('/api/catalog/repos');
      store.setState((s) => ({
        ...s,
        repos: data.repos || [],
        selectedRepo: data.selectedRepo || null,
        workspaceScan: data.workspaceScan || null,
        loading: false,
      }));
    } catch (err) {
      store.setState((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }

  async function selectRepo(repoPath: string, repoId?: string | null): Promise<void> {
    store.setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const body: Record<string, string> = {};
      if (repoPath) body.repoPath = repoPath;
      if (repoId) body.repoId = repoId;
      const data = await apiRequest<CatalogReposListResponse>('/api/catalog/repos/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const selected = data.selectedRepo || null;
      store.setState((s) => ({
        ...s,
        selectedRepo: selected,
        repos: data.repos || s.repos,
        loading: false,
      }));
    } catch (err) {
      store.setState((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }

  async function saveScanRoots(customScanRoots: string[]): Promise<void> {
    store.setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await apiRequest<CatalogRepoScanRootsMutationResponse>('/api/catalog/repos/scan-roots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customScanRoots }),
      });
      store.setState((s) => ({
        ...s,
        repos: data.repos || s.repos,
        selectedRepo: data.selectedRepo || s.selectedRepo,
        workspaceScan: data.workspaceScan || s.workspaceScan,
        loading: false,
      }));
    } catch (err) {
      store.setState((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }

  async function checkGitHubAuth(repoPath: string): Promise<void> {
    store.setState((s) => ({ ...s, githubAuthChecking: true }));
    try {
      const res = await fetch(`/api/git/pull-request?repoPath=${encodeURIComponent(repoPath)}`);
      if (res.ok) {
        const data = await res.json();
        store.setState((s) => ({
          ...s,
          githubAuthenticated: data.authenticated === true,
          githubAuthChecking: false,
        }));
      } else {
        store.setState((s) => ({ ...s, githubAuthenticated: false, githubAuthChecking: false }));
      }
    } catch {
      store.setState((s) => ({ ...s, githubAuthenticated: false, githubAuthChecking: false }));
    }
  }

  async function loginGitHub(): Promise<void> {
    store.setState((s) => ({ ...s, githubAuthChecking: true }));
    try {
      const res = await fetch('/api/git/auth/login', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        store.setState((s) => ({
          ...s,
          githubAuthenticated: data.authenticated === true,
          githubAuthChecking: false,
        }));
      } else {
        store.setState((s) => ({ ...s, githubAuthChecking: false }));
      }
    } catch {
      store.setState((s) => ({ ...s, githubAuthChecking: false }));
    }
  }

  function setSearchQuery(searchQuery: string): void {
    store.setState((s) => ({ ...s, searchQuery }));
  }

  function clearSelection(): void {
    store.setState((s) => ({ ...s, selectedRepo: null }));
  }

  function reset(): void {
    store.setState(INITIAL_STATE);
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    loadInventory,
    selectRepo,
    saveScanRoots,
    checkGitHubAuth,
    loginGitHub,
    setSearchQuery,
    clearSelection,
    reset,
  };
}

export const repositoriesStore = createRepositoriesStore();
