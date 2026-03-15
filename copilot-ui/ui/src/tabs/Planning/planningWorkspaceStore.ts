import {
  buildPlanningRepositoryBacklogRef,
  buildPlanningRoadmapDirectoryRef,
  getPlanningRoadmaps,
} from '../../lib/api';
import { createStore } from '../../lib/store';
import type {
  CatalogRepoInventoryEntry,
  PlanningRepositoryBacklogRef,
  PlanningRoadmap,
  PlanningRoadmapDirectoryRef,
} from '../../lib/types';

export interface PlanningCatalogRepoContext {
  repoId: string;
  repoPath: string;
  repoLabel: string;
  sources: string[];
}

export interface PlanningWorkspaceState {
  catalogRepoContext: PlanningCatalogRepoContext | null;
  repositoryBacklog: PlanningRepositoryBacklogRef | null;
  roadmapDirectory: PlanningRoadmapDirectoryRef | null;
  roadmaps: PlanningRoadmap[];
  selectedRoadmapSlug: string;
  loading: boolean;
  error: string | null;
}

const INITIAL_STATE: PlanningWorkspaceState = {
  catalogRepoContext: null,
  repositoryBacklog: null,
  roadmapDirectory: null,
  roadmaps: [],
  selectedRoadmapSlug: '',
  loading: false,
  error: null,
};

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

function normalizeCatalogRepoContext(
  repo: Partial<CatalogRepoInventoryEntry> | null | undefined
): PlanningCatalogRepoContext | null {
  if (!repo || typeof repo !== 'object') {
    return null;
  }

  const repoId = typeof repo.repoId === 'string' ? repo.repoId.trim() : '';
  const repoPath = typeof repo.repoPath === 'string' ? repo.repoPath.trim() : '';
  const repoLabel = typeof repo.repoLabel === 'string' ? repo.repoLabel.trim() : '';
  const sources = Array.isArray(repo.sources)
    ? repo.sources
      .map((entry) => String(entry || '').trim())
      .filter((entry) => entry.length > 0)
    : [];

  if (!repoId && !repoPath && !repoLabel && sources.length === 0) {
    return null;
  }

  return {
    repoId,
    repoPath,
    repoLabel,
    sources,
  };
}

export function createPlanningWorkspaceStore() {
  const store = createStore<PlanningWorkspaceState>(INITIAL_STATE);
  let roadmapsRequestVersion = 0;

  function syncCatalogRepoContext(repo: Partial<CatalogRepoInventoryEntry> | null | undefined): void {
    const catalogRepoContext = normalizeCatalogRepoContext(repo);
    const repositoryBacklog = buildPlanningRepositoryBacklogRef({
      repoId: catalogRepoContext?.repoId || undefined,
      repoPath: catalogRepoContext?.repoPath || undefined,
      repoLabel: catalogRepoContext?.repoLabel || undefined,
    });
    const roadmapDirectory = buildPlanningRoadmapDirectoryRef({
      repoId: catalogRepoContext?.repoId || undefined,
      repoPath: catalogRepoContext?.repoPath || undefined,
      repoLabel: catalogRepoContext?.repoLabel || undefined,
    });

    store.setState((state) => ({
      ...state,
      catalogRepoContext,
      repositoryBacklog,
      roadmapDirectory,
      roadmaps: catalogRepoContext?.repoPath ? state.roadmaps : [],
      selectedRoadmapSlug: catalogRepoContext?.repoPath ? state.selectedRoadmapSlug : '',
      error: null,
    }));
  }

  async function loadRoadmaps(): Promise<void> {
    const nextVersion = ++roadmapsRequestVersion;
    const stateSnapshot = store.getState();
    const repoPath = stateSnapshot.catalogRepoContext?.repoPath || '';
    const repoId = stateSnapshot.catalogRepoContext?.repoId || '';
    const repoLabel = stateSnapshot.catalogRepoContext?.repoLabel || '';

    if (!repoPath) {
      store.setState((state) => ({
        ...state,
        roadmaps: [],
        selectedRoadmapSlug: '',
        loading: false,
        error: null,
      }));
      return;
    }

    store.setState((state) => ({
      ...state,
      loading: true,
      error: null,
    }));

    try {
      const response = await getPlanningRoadmaps({
        repoId: repoId || undefined,
        repoPath,
        repoLabel: repoLabel || undefined,
      });

      store.setState((state) => {
        if (nextVersion !== roadmapsRequestVersion) {
          return state;
        }

        const selectedRoadmapSlug =
          state.selectedRoadmapSlug
          && response.roadmaps.some((roadmap) => roadmap.slug === state.selectedRoadmapSlug)
            ? state.selectedRoadmapSlug
            : (response.roadmaps[0]?.slug ?? '');

        return {
          ...state,
          roadmaps: response.roadmaps,
          selectedRoadmapSlug,
          loading: false,
          error: null,
        };
      });
    } catch (error) {
      const message = toErrorMessage(error, 'Unable to load roadmaps.');

      store.setState((state) => {
        if (nextVersion !== roadmapsRequestVersion) {
          return state;
        }

        return {
          ...state,
          roadmaps: [],
          selectedRoadmapSlug: '',
          loading: false,
          error: message,
        };
      });
    }
  }

  function setSelectedRoadmapSlug(value: string): void {
    const selectedRoadmapSlug = value.trim();
    store.setState((state) => ({
      ...state,
      selectedRoadmapSlug,
    }));
  }

  function reset(): void {
    store.setState(INITIAL_STATE);
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    syncCatalogRepoContext,
    loadRoadmaps,
    setSelectedRoadmapSlug,
    reset,
  };
}

export const planningWorkspaceStore = createPlanningWorkspaceStore();
