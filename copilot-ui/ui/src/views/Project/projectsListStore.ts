import { createStore } from '../../lib/store';
import { getGitSummary, listProjects, updateProject } from '../../lib/api';
import type { GitSummaryResponse } from '../../lib/api/git';
import type { ProjectResponse } from '../../lib/api/projects';
import { EMPTY_PROJECT_GIT_SUMMARY, type ProjectGitSummary, type ProjectRecord } from './projectTypes';

// ── Types ──

export interface ProjectListItem {
  projectId: string;
  repoId: string;
  repoPath: string;
  repoLabel: string;
  pinned: boolean;
  lastActivityMs: number | null;
  canonicalRemote: string | null;
  activeSessionCount: number;
  totalSessionCount: number;
  gitSummary: ProjectGitSummary | null;
}

export type ProjectSortField = 'name' | 'activity' | 'sessions';

export interface ProjectsListState {
  projects: ProjectListItem[];
  loading: boolean;
  loadingGitSummary: boolean;
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
        (p.repoLabel || '').toLowerCase().includes(q) ||
        (p.repoPath || '').toLowerCase().includes(q),
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
        return (a.repoLabel || '').toLowerCase().localeCompare((b.repoLabel || '').toLowerCase());
      case 'activity':
        return (b.lastActivityMs ?? 0) - (a.lastActivityMs ?? 0);
      case 'sessions':
        return b.activeSessionCount - a.activeSessionCount;
    }
  });

  return result;
}

interface UnifiedSession {
  sessionId: string;
  projectId?: string | null;
  status?: string;
}

function toProjectGitSummary(summary: GitSummaryResponse): ProjectGitSummary {
  return {
    branch: summary.branch,
    clean: summary.clean,
    changedFiles: summary.changedFiles,
    stagedFiles: summary.stagedFiles,
    ahead: summary.ahead,
    behind: summary.behind,
    additions: summary.additions,
    deletions: summary.deletions,
    hasRemote: summary.hasRemote,
    prNumber: summary.pullRequest?.number ?? null,
    prUrl: summary.pullRequest?.url ?? null,
    prState: summary.pullRequest?.state ?? null,
    remoteName: summary.remoteName,
    remoteLabel: summary.remoteLabel,
  };
}

function toProjectListItem(project: ProjectRecord): ProjectListItem {
  return {
    projectId: project.projectId,
    repoId: project.repoId,
    repoPath: project.repoPath,
    repoLabel: project.repoLabel,
    pinned: project.pinned,
    lastActivityMs: project.lastActivityMs,
    canonicalRemote: project.canonicalRemote,
    activeSessionCount: project.activeSessionCount,
    totalSessionCount: project.sessionCount,
    gitSummary: null,
  };
}

function toProjectRecord(project: ProjectResponse, sessionCount: number, activeSessionCount: number): ProjectRecord {
  return {
    ...project,
    sessionCount,
    activeSessionCount,
  };
}

// ── Store creation ──

const INITIAL_STATE: ProjectsListState = {
  projects: [],
  loading: false,
  loadingGitSummary: false,
  error: null,
  searchQuery: '',
  sortField: 'name',
  showPinnedFirst: true,
};

function createProjectsListStore() {
  const store = createStore<ProjectsListState>(INITIAL_STATE);

  async function loadProjects(): Promise<void> {
    store.setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [projects, sessionsRes] = await Promise.all([
        listProjects(),
        fetch('/api/sessions/unified?limit=200'),
      ]);

      // Build per-project session counts
      let sessions: UnifiedSession[] = [];
      if (sessionsRes.ok) {
        sessions = await sessionsRes.json();
      }

      const activeCountMap = new Map<string, number>();
      const totalCountMap = new Map<string, number>();

      for (const s of sessions) {
        const pid = s.projectId;
        if (!pid) continue;
        totalCountMap.set(pid, (totalCountMap.get(pid) ?? 0) + 1);
        const isActive = (s.status ?? '').toLowerCase() === 'active' || (s.status ?? '').toLowerCase() === 'running';
        if (isActive) {
          activeCountMap.set(pid, (activeCountMap.get(pid) ?? 0) + 1);
        }
      }

      const nextProjects = projects.map((project) =>
        toProjectListItem(
          toProjectRecord(
            project,
            totalCountMap.get(project.projectId) ?? project.sessionCount ?? 0,
            activeCountMap.get(project.projectId) ?? project.activeSessionCount ?? 0,
          ),
        ),
      );

      store.setState((s) => ({ ...s, projects: nextProjects, loading: false }));
      void loadGitSummaries(nextProjects);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      store.setState((s) => ({ ...s, error: message, loading: false }));
    }
  }

  async function loadGitSummaries(projects: ProjectListItem[]): Promise<void> {
    if (projects.length === 0) {
      return;
    }

    store.setState((s) => ({ ...s, loadingGitSummary: true }));
    const results = await Promise.allSettled(
      projects.map(async (project) => ({
        projectId: project.projectId,
        summary: toProjectGitSummary(await getGitSummary(project.repoPath)),
      })),
    );

    const summaryMap = new Map<string, ProjectGitSummary>();
    for (const result of results) {
      if (result.status === 'fulfilled') {
        summaryMap.set(result.value.projectId, result.value.summary);
      }
    }

    store.setState((s) => ({
      ...s,
      loadingGitSummary: false,
      projects: s.projects.map((project) => ({
        ...project,
        gitSummary: summaryMap.get(project.projectId) ?? project.gitSummary ?? EMPTY_PROJECT_GIT_SUMMARY,
      })),
    }));
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

  function togglePin(projectId: string): void {
    const current = store.getState();
    const project = current.projects.find((p) => p.projectId === projectId);
    if (!project) return;

    const newPinned = !project.pinned;

    store.setState((s) => ({
      ...s,
      projects: s.projects.map((p) =>
        p.projectId === projectId ? { ...p, pinned: newPinned } : p,
      ),
    }));

    void updateProject(projectId, { pinned: newPinned }).catch(() => {
      store.setState((s) => ({
        ...s,
        projects: s.projects.map((p) =>
          p.projectId === projectId ? { ...p, pinned: project.pinned } : p,
        ),
      }));
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
