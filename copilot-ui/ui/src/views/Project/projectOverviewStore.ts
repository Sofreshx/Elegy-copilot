import { createStore } from '../../lib/store';
import { listProjectActivity, listProjects, listProjectSessions } from '../../lib/api';

// ── Types ──

export interface ProjectInfo {
  projectId: string;
  repoId: string;
  repoPath: string;
  repoLabel: string;
  pinned: boolean;
  lastActivityMs: number | null;
  canonicalRemote: string | null;
  sessionCount: number;
  activeSessionCount: number;
  installedAssetSummary?: {
    agents: number;
    skills: number;
  };
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface ProjectSession {
  id: string;
  title: string;
  status: string;
  source: string;
  startedAtMs: number | null;
  updatedAtMs: number | null;
  elapsedMs: number | null;
}

export interface ActivityItem {
  type: string;
  timestamp: number | null;
  summary: string;
}

export interface ProjectOverviewState {
  projectId: string | null;
  projectInfo: ProjectInfo | null;
  sessions: ProjectSession[];
  activity: ActivityItem[];
  loading: boolean;
  error: string | null;
}

// ── Initial state ──

const INITIAL_STATE: ProjectOverviewState = {
  projectId: null,
  projectInfo: null,
  sessions: [],
  activity: [],
  loading: false,
  error: null,
};

// ── Helpers ──

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return 'Failed to load project data.';
}

// ── Store factory ──

function createProjectOverviewStore() {
  const store = createStore<ProjectOverviewState>(INITIAL_STATE);

  let requestVersion = 0;

  async function loadProjectInfo(projectId: string): Promise<ProjectInfo | null> {
    try {
      const projects = await listProjects();
      return projects.find((project) => project.projectId === projectId) ?? null;
    } catch {
      return null;
    }
  }

  async function loadProject(projectId: string): Promise<void> {
    const nextVersion = ++requestVersion;

    store.setState((state) => ({
      ...state,
      projectId,
      loading: true,
      error: null,
    }));

    try {
      const [sessionsResult, activityResult, infoResult] = await Promise.allSettled([
        listProjectSessions(projectId),
        listProjectActivity(projectId),
        loadProjectInfo(projectId),
      ]);

      if (nextVersion !== requestVersion) return;

      const sessions: ProjectSession[] =
        sessionsResult.status === 'fulfilled'
          ? sessionsResult.value.map((session) => ({
            id: session.id,
            title: session.title || session.objective || session.id,
            status: session.status || 'unknown',
            source: session.source || 'local',
            startedAtMs: session.startedAtMs ?? null,
            updatedAtMs: session.updatedAtMs ?? null,
            elapsedMs: session.elapsedMs ?? null,
          }))
          : [];
      const activity: ActivityItem[] =
        activityResult.status === 'fulfilled' ? activityResult.value : [];
      const projectInfo: ProjectInfo | null =
        infoResult.status === 'fulfilled' ? infoResult.value : null;

      store.setState((state) => ({
        ...state,
        projectId,
        projectInfo,
        sessions,
        activity,
        loading: false,
        error: null,
      }));
    } catch (error) {
      if (nextVersion !== requestVersion) return;

      store.setState((state) => ({
        ...state,
        loading: false,
        error: toErrorMessage(error),
      }));
    }
  }

  async function refresh(): Promise<void> {
    const { projectId } = store.getState();
    if (projectId) {
      await loadProject(projectId);
    }
  }

  function reset(): void {
    requestVersion++;
    store.setState(INITIAL_STATE);
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    setState: store.setState,
    loadProject,
    loadProjectInfo,
    refresh,
    reset,
  };
}

export const projectOverviewStore = createProjectOverviewStore();
