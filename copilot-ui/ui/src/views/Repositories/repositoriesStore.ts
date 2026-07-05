import { createStore } from '../../lib/store';
import type {
  CatalogRepoInventoryEntry,
  CatalogRepoInventoryWorkspaceScan,
  CatalogReposListResponse,
  CatalogRepoScanRootsMutationResponse,
  LocalRepoReaderAccessState,
} from '../../lib/types';
import { apiRequest } from '../../lib/api/core';
import {
  disableLocalRepoReaderRepo,
  enableLocalRepoReaderRepo,
  getLocalRepoReaderAccess,
} from '../../lib/api/catalog';

export interface RepositoriesState {
  repos: CatalogRepoInventoryEntry[];
  selectedRepo: CatalogRepoInventoryEntry | null;
  workspaceScan: CatalogRepoInventoryWorkspaceScan | null;
  loading: boolean;
  error: string | null;
  searchQuery: string;
  githubAuthenticated: boolean;
  githubAuthChecking: boolean;
  localRepoReaderAccess: LocalRepoReaderAccessState | null;
  localRepoReaderMutating: boolean;
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
  localRepoReaderAccess: null,
  localRepoReaderMutating: false,
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
      void loadLocalRepoReaderAccess();
    } catch (err) {
      store.setState((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }

  async function loadLocalRepoReaderAccess(): Promise<void> {
    try {
      const data = await getLocalRepoReaderAccess();
      store.setState((s) => ({
        ...s,
        localRepoReaderAccess: data.access || null,
      }));
    } catch (err) {
      store.setState((s) => ({
        ...s,
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

  async function registerRepo(repoPath: string, repoLabel?: string): Promise<void> {
    store.setState((s) => ({ ...s, error: null }));
    try {
      await apiRequest<{ success: boolean }>('/api/catalog/repos/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoPath, repoLabel }),
      });
      await loadInventory();
    } catch (err) {
      store.setState((s) => ({
        ...s,
        error: err instanceof Error ? err.message : String(err),
      }));
      throw err;
    }
  }

  async function setLocalRepoReaderEnabled(repo: CatalogRepoInventoryEntry, enabled: boolean): Promise<void> {
    const repoPath = String(repo.repoPath || '').trim();
    const repoId = typeof repo.repoId === 'string' ? repo.repoId : undefined;
    if (!repoPath && !repoId) return;
    store.setState((s) => ({ ...s, localRepoReaderMutating: true, error: null }));
    try {
      const payload = {
        repoPath: repoPath || undefined,
        repoId,
        alias: String(repo.repoLabel || repo.repoId || '').trim() || undefined,
      };
      const data = enabled
        ? await enableLocalRepoReaderRepo(payload)
        : await disableLocalRepoReaderRepo(payload);
      store.setState((s) => ({
        ...s,
        localRepoReaderAccess: data.access || s.localRepoReaderAccess,
        localRepoReaderMutating: false,
      }));
    } catch (err) {
      store.setState((s) => ({
        ...s,
        localRepoReaderMutating: false,
        error: err instanceof Error ? err.message : String(err),
      }));
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
    loadLocalRepoReaderAccess,
    selectRepo,
    saveScanRoots,
    registerRepo,
    setLocalRepoReaderEnabled,
    checkGitHubAuth,
    loginGitHub,
    setSearchQuery,
    clearSelection,
    reset,
  };
}

export const repositoriesStore = createRepositoriesStore();
