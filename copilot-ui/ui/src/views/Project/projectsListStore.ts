import { createStore } from '../../lib/store';

// ── Types ──

export interface ProjectListItem {
  key: string;
  repoPath: string;
  label: string;
  pinned: boolean;
  lastActivityMs: number | null;
  canonicalRemote: string | null;
  activeSessionCount: number;
  totalSessionCount: number;
}

export type ProjectSortField = 'name' | 'activity' | 'sessions';

export interface ProjectsListState {
  projects: ProjectListItem[];
  loading: boolean;
  error: string | null;
  searchQuery: string;
  sortField: ProjectSortField;
  showPinnedFirst: boolean;
}

// ── Filtering + sorting (pure computation) ──

export function getFilteredProjects(state: ProjectsListState): ProjectListItem[] {
  let result = state.projects;

  // Filter by search query
  if (state.searchQuery.trim()) {
    const q = state.searchQuery.trim().toLowerCase();
    result = result.filter(
      (p) =>
        p.label.toLowerCase().includes(q) ||
        p.repoPath.toLowerCase().includes(q),
    );
  }

  // Sort
  result = [...result].sort((a, b) => {
    // Pinned first when enabled
    if (state.showPinnedFirst) {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
    }

    switch (state.sortField) {
      case 'name':
        return a.label.toLowerCase().localeCompare(b.label.toLowerCase());
      case 'activity':
        return (b.lastActivityMs ?? 0) - (a.lastActivityMs ?? 0);
      case 'sessions':
        return b.activeSessionCount - a.activeSessionCount;
    }
  });

  return result;
}

// ── API response shapes ──

interface CatalogRepo {
  key: string;
  repoPath: string;
  label: string;
  pinned?: boolean;
  canonicalRemote?: string | null;
  lastActivityMs?: number | null;
}

interface CatalogReposResponse {
  repos: CatalogRepo[];
  totalCount?: number;
}

interface UnifiedSession {
  id: string;
  projectId?: string | null;
  status?: string;
}

// ── Store creation ──

const INITIAL_STATE: ProjectsListState = {
  projects: [],
  loading: false,
  error: null,
  searchQuery: '',
  sortField: 'name',
  showPinnedFirst: true,
};

// Local pin state (fallback when PATCH endpoint is unavailable)
const localPins = new Map<string, boolean>();

function createProjectsListStore() {
  const store = createStore<ProjectsListState>(INITIAL_STATE);

  async function loadProjects(): Promise<void> {
    store.setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [reposRes, sessionsRes] = await Promise.all([
        fetch('/api/catalog/repos'),
        fetch('/api/sessions/unified?limit=200'),
      ]);

      if (!reposRes.ok) throw new Error(`Failed to load projects (${reposRes.status})`);

      const catalog: CatalogReposResponse = await reposRes.json();

      // Build per-project session counts
      let sessions: UnifiedSession[] = [];
      if (sessionsRes.ok) {
        sessions = await sessionsRes.json();
      }

      const activeCountMap = new Map<string, number>();
      const totalCountMap = new Map<string, number>();
      const lastActivityMap = new Map<string, number>();

      for (const s of sessions) {
        const pid = s.projectId;
        if (!pid) continue;
        totalCountMap.set(pid, (totalCountMap.get(pid) ?? 0) + 1);
        const isActive = (s.status ?? '').toLowerCase() === 'active' || (s.status ?? '').toLowerCase() === 'running';
        if (isActive) {
          activeCountMap.set(pid, (activeCountMap.get(pid) ?? 0) + 1);
        }
      }

      const projects: ProjectListItem[] = catalog.repos.map((repo) => ({
        key: repo.key,
        repoPath: repo.repoPath,
        label: repo.label,
        pinned: localPins.get(repo.key) ?? repo.pinned ?? false,
        lastActivityMs: repo.lastActivityMs ?? lastActivityMap.get(repo.key) ?? null,
        canonicalRemote: repo.canonicalRemote ?? null,
        activeSessionCount: activeCountMap.get(repo.key) ?? 0,
        totalSessionCount: totalCountMap.get(repo.key) ?? 0,
      }));

      store.setState((s) => ({ ...s, projects, loading: false }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      store.setState((s) => ({ ...s, error: message, loading: false }));
    }
  }

  function refresh(): void {
    void loadProjects();
  }

  function setSearchQuery(searchQuery: string): void {
    store.setState((s) => ({ ...s, searchQuery }));
  }

  function setSortField(sortField: ProjectSortField): void {
    store.setState((s) => ({ ...s, sortField }));
  }

  function togglePin(projectKey: string): void {
    // Try PATCH first; fall back to local pin state
    const current = store.getState();
    const project = current.projects.find((p) => p.key === projectKey);
    if (!project) return;

    const newPinned = !project.pinned;
    localPins.set(projectKey, newPinned);

    // Optimistic update
    store.setState((s) => ({
      ...s,
      projects: s.projects.map((p) =>
        p.key === projectKey ? { ...p, pinned: newPinned } : p,
      ),
    }));

    // Fire-and-forget PATCH attempt
    fetch(`/api/catalog/repos/${encodeURIComponent(projectKey)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: newPinned }),
    }).catch(() => {
      // PATCH not available — pin state persisted locally
    });
  }

  function reset(): void {
    store.setState(INITIAL_STATE);
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    loadProjects,
    refresh,
    setSearchQuery,
    setSortField,
    togglePin,
    reset,
  };
}

export const projectsListStore = createProjectsListStore();
