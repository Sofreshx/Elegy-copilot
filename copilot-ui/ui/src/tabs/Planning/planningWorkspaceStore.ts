import {
  buildPlanningIntakeDirectoryRef,
  buildPlanningRepositoryBacklogRef,
  buildPlanningRoadmapDirectoryRef,
  getPlanningIntakeArtifacts,
  getPlanningRoadmaps,
} from '../../lib/api';
import { createStore } from '../../lib/store';
import type {
  CatalogRepoInventoryEntry,
  PlanningIntakeArtifact,
  PlanningIntakeDirectoryRef,
  PlanningIntakeSummary,
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
  planningIntakeDirectory: PlanningIntakeDirectoryRef | null;
  intakeSummary: PlanningIntakeSummary | null;
  intakeArtifacts: PlanningIntakeArtifact[];
  repositoryBacklog: PlanningRepositoryBacklogRef | null;
  roadmapDirectory: PlanningRoadmapDirectoryRef | null;
  roadmaps: PlanningRoadmap[];
  selectedRoadmapSlug: string;
  intakeLoading: boolean;
  intakeError: string | null;
  roadmapsLoading: boolean;
  loading: boolean;
  error: string | null;
}

const INITIAL_STATE: PlanningWorkspaceState = {
  catalogRepoContext: null,
  planningIntakeDirectory: null,
  intakeSummary: null,
  intakeArtifacts: [],
  repositoryBacklog: null,
  roadmapDirectory: null,
  roadmaps: [],
  selectedRoadmapSlug: '',
  intakeLoading: false,
  intakeError: null,
  roadmapsLoading: false,
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
  let intakeRequestVersion = 0;

  function syncCatalogRepoContext(repo: Partial<CatalogRepoInventoryEntry> | null | undefined): void {
    const catalogRepoContext = normalizeCatalogRepoContext(repo);
    const previousRepoPath = store.getState().catalogRepoContext?.repoPath || '';
    const nextRepoPath = catalogRepoContext?.repoPath || '';
    const preserveRepoData = Boolean(previousRepoPath && previousRepoPath === nextRepoPath);
    const planningIntakeDirectory = buildPlanningIntakeDirectoryRef({
      repoId: catalogRepoContext?.repoId || undefined,
      repoPath: catalogRepoContext?.repoPath || undefined,
      repoLabel: catalogRepoContext?.repoLabel || undefined,
    });
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
      planningIntakeDirectory,
      intakeSummary: preserveRepoData ? state.intakeSummary : null,
      intakeArtifacts: preserveRepoData ? state.intakeArtifacts : [],
      repositoryBacklog,
      roadmapDirectory,
      roadmaps: preserveRepoData ? state.roadmaps : [],
      selectedRoadmapSlug: preserveRepoData ? state.selectedRoadmapSlug : '',
      intakeError: null,
      error: null,
    }));
  }

  async function loadIntakeArtifacts(): Promise<void> {
    const nextVersion = ++intakeRequestVersion;
    const stateSnapshot = store.getState();
    const repoPath = stateSnapshot.catalogRepoContext?.repoPath || '';
    const repoId = stateSnapshot.catalogRepoContext?.repoId || '';
    const repoLabel = stateSnapshot.catalogRepoContext?.repoLabel || '';

    if (!repoPath) {
      store.setState((state) => ({
        ...state,
        intakeSummary: null,
        intakeArtifacts: [],
        intakeLoading: false,
        loading: state.roadmapsLoading,
        intakeError: null,
      }));
      return;
    }

    store.setState((state) => ({
      ...state,
      intakeLoading: true,
      loading: true,
      intakeError: null,
    }));

    try {
      const response = await getPlanningIntakeArtifacts({
        repoId: repoId || undefined,
        repoPath,
        repoLabel: repoLabel || undefined,
      });

      store.setState((state) => {
        if (nextVersion !== intakeRequestVersion) {
          return state;
        }

        return {
          ...state,
          intakeSummary: response.intake,
          intakeArtifacts: response.artifacts,
          intakeLoading: false,
          loading: state.roadmapsLoading,
          intakeError: null,
        };
      });
    } catch (error) {
      const message = toErrorMessage(error, 'Unable to load planning intake artifacts.');

      store.setState((state) => {
        if (nextVersion !== intakeRequestVersion) {
          return state;
        }

        return {
          ...state,
          intakeSummary: null,
          intakeArtifacts: [],
          intakeLoading: false,
          loading: state.roadmapsLoading,
          intakeError: message,
        };
      });
    }
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
        roadmapsLoading: false,
        loading: state.intakeLoading,
        error: null,
      }));
      return;
    }

    store.setState((state) => ({
      ...state,
      roadmapsLoading: true,
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
          roadmapsLoading: false,
          loading: state.intakeLoading,
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
          roadmapsLoading: false,
          loading: state.intakeLoading,
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
    loadIntakeArtifacts,
    loadRoadmaps,
    setSelectedRoadmapSlug,
    reset,
  };
}

export const planningWorkspaceStore = createPlanningWorkspaceStore();
