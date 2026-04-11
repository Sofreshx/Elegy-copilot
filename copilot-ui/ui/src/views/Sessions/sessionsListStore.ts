import { createStore } from '../../lib/store';

// ── Filter / sort types ──

export type SessionSourceFilter = 'all' | 'cli' | 'sdk' | 'vscode' | 'sandbox';
export type SessionStatusFilter = 'all' | 'active' | 'idle' | 'completed' | 'failed';
export type SessionSortField = 'updated' | 'created' | 'project';
export type SessionSortDirection = 'desc' | 'asc';

export interface UnifiedSessionItem {
  id: string;
  title: string;
  projectId: string | null;
  projectName: string | null;
  repoLabel: string | null;
  source: string;
  status: string;
  elapsedMs: number | null;
  startedAtMs: number | null;
  updatedAtMs: number | null;
}

export interface SessionsListState {
  sessions: UnifiedSessionItem[];
  loading: boolean;
  error: string | null;
  sourceFilter: SessionSourceFilter;
  statusFilter: SessionStatusFilter;
  sortField: SessionSortField;
  sortDirection: SessionSortDirection;
  searchQuery: string;
}

// ── Status normalisation (matches DashboardView convention) ──

export function normalizeStatus(s: string): 'active' | 'idle' | 'completed' | 'failed' | 'unknown' {
  const lower = (s || '').toLowerCase();
  if (lower === 'active' || lower === 'running') return 'active';
  if (lower === 'idle' || lower === 'paused') return 'idle';
  if (lower === 'completed' || lower === 'done') return 'completed';
  if (lower === 'failed' || lower === 'error') return 'failed';
  return 'unknown';
}

// ── Filtering + sorting (pure computation) ──

export function getFilteredSessions(state: SessionsListState): UnifiedSessionItem[] {
  let result = state.sessions;

  // Source filter
  if (state.sourceFilter !== 'all') {
    const target = state.sourceFilter.toLowerCase();
    result = result.filter((s) => (s.source || '').toLowerCase() === target);
  }

  // Status filter
  if (state.statusFilter !== 'all') {
    result = result.filter((s) => normalizeStatus(s.status) === state.statusFilter);
  }

  // Search query
  if (state.searchQuery.trim()) {
    const q = state.searchQuery.trim().toLowerCase();
    result = result.filter(
      (s) =>
        (s.title || '').toLowerCase().includes(q) ||
        (s.projectName || '').toLowerCase().includes(q) ||
        (s.repoLabel || '').toLowerCase().includes(q),
    );
  }

  // Sort
  const dir = state.sortDirection === 'asc' ? 1 : -1;

  result = [...result].sort((a, b) => {
    switch (state.sortField) {
      case 'updated':
        return ((a.updatedAtMs ?? 0) - (b.updatedAtMs ?? 0)) * dir;
      case 'created':
        return ((a.startedAtMs ?? 0) - (b.startedAtMs ?? 0)) * dir;
      case 'project': {
        const ap = (a.projectName || '').toLowerCase();
        const bp = (b.projectName || '').toLowerCase();
        return ap < bp ? -1 * dir : ap > bp ? 1 * dir : 0;
      }
    }
  });

  return result;
}

// ── Store creation ──

const INITIAL_STATE: SessionsListState = {
  sessions: [],
  loading: false,
  error: null,
  sourceFilter: 'all',
  statusFilter: 'all',
  sortField: 'updated',
  sortDirection: 'desc',
  searchQuery: '',
};

function createSessionsListStore() {
  const store = createStore<SessionsListState>(INITIAL_STATE);

  async function loadSessions(): Promise<void> {
    store.setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await fetch('/api/sessions/unified?limit=100');
      if (!res.ok) throw new Error(`Failed to load sessions (${res.status})`);
      const sessions: UnifiedSessionItem[] = await res.json();
      store.setState((s) => ({ ...s, sessions, loading: false }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      store.setState((s) => ({ ...s, error: message, loading: false }));
    }
  }

  function refresh(): void {
    void loadSessions();
  }

  function setSourceFilter(sourceFilter: SessionSourceFilter): void {
    store.setState((s) => ({ ...s, sourceFilter }));
  }

  function setStatusFilter(statusFilter: SessionStatusFilter): void {
    store.setState((s) => ({ ...s, statusFilter }));
  }

  function setSortField(sortField: SessionSortField): void {
    store.setState((s) => ({ ...s, sortField }));
  }

  function setSortDirection(sortDirection: SessionSortDirection): void {
    store.setState((s) => ({ ...s, sortDirection }));
  }

  function setSearchQuery(searchQuery: string): void {
    store.setState((s) => ({ ...s, searchQuery }));
  }

  function reset(): void {
    store.setState(INITIAL_STATE);
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    loadSessions,
    refresh,
    setSourceFilter,
    setStatusFilter,
    setSortField,
    setSortDirection,
    setSearchQuery,
    reset,
  };
}

export const sessionsListStore = createSessionsListStore();
