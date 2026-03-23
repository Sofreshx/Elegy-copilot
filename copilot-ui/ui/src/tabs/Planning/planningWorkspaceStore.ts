import {
  createPlanningBacklogItem,
  createPlanningBullet,
  getPlanningBacklog,
  getPlanningBullets,
  getPlanningObsidianNote,
  getPlanningObsidianRepresentationsStatus,
  getPlanningObsidianStatus,
  buildPlanningIntakeDirectoryRef,
  buildPlanningBulletsFileRef,
  buildPlanningRepositoryBacklogRef,
  buildPlanningRoadmapDirectoryRef,
  getPlanningIntakeArtifacts,
  listPlanningObsidianNotes,
  listPlanningObsidianRepresentations,
  getPlanningRoadmaps,
  refreshPlanningObsidianRepresentations,
  triggerPlanningObsidianSync,
  updatePlanningBullet,
} from '../../lib/api';
import { createStore } from '../../lib/store';
import type {
  PlanningBacklogSummary,
  PlanningBullet,
  PlanningBulletFileRef,
  PlanningBulletsSummary,
  CatalogRepoInventoryEntry,
  ObsidianPlanningNoteDetail,
  ObsidianPlanningNoteSummary,
  ObsidianPlanningRepresentationSummary,
  ObsidianPlanningRepresentationsStatus,
  ObsidianPlanningStatus,
  PlanningIntakeArtifact,
  PlanningIntakeDirectoryRef,
  PlanningIntakeSummary,
  PlanningIntakeTrackerFilters,
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
  planningBulletsFile: PlanningBulletFileRef | null;
  bulletsSummary: PlanningBulletsSummary | null;
  bullets: PlanningBullet[];
  planningIntakeDirectory: PlanningIntakeDirectoryRef | null;
  intakeSummary: PlanningIntakeSummary | null;
  intakeArtifacts: PlanningIntakeArtifact[];
  intakeFilters: PlanningIntakeTrackerFilters;
  repositoryBacklog: PlanningRepositoryBacklogRef | null;
  backlogSummary: PlanningBacklogSummary | null;
  roadmapDirectory: PlanningRoadmapDirectoryRef | null;
  roadmaps: PlanningRoadmap[];
  selectedRoadmapSlug: string;
  obsidianStatus: ObsidianPlanningStatus | null;
  obsidianNotes: ObsidianPlanningNoteSummary[];
  obsidianRepresentationsStatus: ObsidianPlanningRepresentationsStatus | null;
  obsidianRepresentations: ObsidianPlanningRepresentationSummary[];
  selectedObsidianNoteId: string;
  selectedObsidianNote: ObsidianPlanningNoteDetail | null;
  bulletsLoading: boolean;
  bulletsError: string | null;
  intakeLoading: boolean;
  intakeError: string | null;
  backlogLoading: boolean;
  backlogError: string | null;
  roadmapsLoading: boolean;
  obsidianLoading: boolean;
  obsidianDetailLoading: boolean;
  obsidianSyncing: boolean;
  obsidianRepresentationsLoading: boolean;
  obsidianRepresentationsRefreshing: boolean;
  obsidianError: string | null;
  loading: boolean;
  error: string | null;
}

const DEFAULT_INTAKE_FILTERS: PlanningIntakeTrackerFilters = {
  category: '__all__',
  planningState: '__all__',
  targetRepoId: '__all__',
};

const INITIAL_STATE: PlanningWorkspaceState = {
  catalogRepoContext: null,
  planningBulletsFile: null,
  bulletsSummary: null,
  bullets: [],
  planningIntakeDirectory: null,
  intakeSummary: null,
  intakeArtifacts: [],
  intakeFilters: DEFAULT_INTAKE_FILTERS,
  repositoryBacklog: null,
  backlogSummary: null,
  roadmapDirectory: null,
  roadmaps: [],
  selectedRoadmapSlug: '',
  obsidianStatus: null,
  obsidianNotes: [],
  obsidianRepresentationsStatus: null,
  obsidianRepresentations: [],
  selectedObsidianNoteId: '',
  selectedObsidianNote: null,
  bulletsLoading: false,
  bulletsError: null,
  intakeLoading: false,
  intakeError: null,
  backlogLoading: false,
  backlogError: null,
  roadmapsLoading: false,
  obsidianLoading: false,
  obsidianDetailLoading: false,
  obsidianSyncing: false,
  obsidianRepresentationsLoading: false,
  obsidianRepresentationsRefreshing: false,
  obsidianError: null,
  loading: false,
  error: null,
};

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

function computeWorkspaceLoading(state: Pick<
  PlanningWorkspaceState,
  'bulletsLoading'
  | 'intakeLoading'
  | 'backlogLoading'
  | 'roadmapsLoading'
  | 'obsidianLoading'
  | 'obsidianDetailLoading'
  | 'obsidianRepresentationsLoading'
>): boolean {
  return Boolean(
    state.bulletsLoading
    || state.intakeLoading
    || state.backlogLoading
    || state.roadmapsLoading
    || state.obsidianLoading
    || state.obsidianDetailLoading
    || state.obsidianRepresentationsLoading
  );
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
  let bulletsRequestVersion = 0;
  let backlogRequestVersion = 0;
  let obsidianRequestVersion = 0;
  let obsidianDetailRequestVersion = 0;
  let obsidianRepresentationsRequestVersion = 0;

  function invalidateRepoScopedRequests(): void {
    roadmapsRequestVersion += 1;
    intakeRequestVersion += 1;
    bulletsRequestVersion += 1;
    backlogRequestVersion += 1;
    obsidianRequestVersion += 1;
    obsidianDetailRequestVersion += 1;
    obsidianRepresentationsRequestVersion += 1;
  }

  function syncCatalogRepoContext(repo: Partial<CatalogRepoInventoryEntry> | null | undefined): void {
    const catalogRepoContext = normalizeCatalogRepoContext(repo);
    const previousRepoPath = store.getState().catalogRepoContext?.repoPath || '';
    const nextRepoPath = catalogRepoContext?.repoPath || '';
    const preserveRepoData = Boolean(previousRepoPath && previousRepoPath === nextRepoPath);
    if (!preserveRepoData) {
      invalidateRepoScopedRequests();
    }
    const planningBulletsFile = buildPlanningBulletsFileRef({
      repoId: catalogRepoContext?.repoId || undefined,
      repoPath: catalogRepoContext?.repoPath || undefined,
      repoLabel: catalogRepoContext?.repoLabel || undefined,
    });
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
      planningBulletsFile,
      bulletsSummary: preserveRepoData ? state.bulletsSummary : null,
      bullets: preserveRepoData ? state.bullets : [],
      planningIntakeDirectory,
      intakeSummary: preserveRepoData ? state.intakeSummary : null,
      intakeArtifacts: preserveRepoData ? state.intakeArtifacts : [],
      intakeFilters: preserveRepoData ? state.intakeFilters : DEFAULT_INTAKE_FILTERS,
      repositoryBacklog,
      backlogSummary: preserveRepoData ? state.backlogSummary : null,
      roadmapDirectory,
      roadmaps: preserveRepoData ? state.roadmaps : [],
      selectedRoadmapSlug: preserveRepoData ? state.selectedRoadmapSlug : '',
      obsidianStatus: preserveRepoData ? state.obsidianStatus : null,
      obsidianNotes: preserveRepoData ? state.obsidianNotes : [],
      obsidianRepresentationsStatus: preserveRepoData ? state.obsidianRepresentationsStatus : null,
      obsidianRepresentations: preserveRepoData ? state.obsidianRepresentations : [],
      selectedObsidianNoteId: preserveRepoData ? state.selectedObsidianNoteId : '',
      selectedObsidianNote: preserveRepoData ? state.selectedObsidianNote : null,
      bulletsLoading: preserveRepoData ? state.bulletsLoading : false,
      intakeLoading: preserveRepoData ? state.intakeLoading : false,
      backlogLoading: preserveRepoData ? state.backlogLoading : false,
      roadmapsLoading: preserveRepoData ? state.roadmapsLoading : false,
      obsidianLoading: preserveRepoData ? state.obsidianLoading : false,
      obsidianDetailLoading: preserveRepoData ? state.obsidianDetailLoading : false,
      obsidianSyncing: preserveRepoData ? state.obsidianSyncing : false,
      obsidianRepresentationsLoading: preserveRepoData ? state.obsidianRepresentationsLoading : false,
      obsidianRepresentationsRefreshing: preserveRepoData ? state.obsidianRepresentationsRefreshing : false,
      bulletsError: null,
      intakeError: null,
      backlogError: null,
      obsidianError: null,
      error: null,
      loading: computeWorkspaceLoading({
        ...state,
        bulletsLoading: preserveRepoData ? state.bulletsLoading : false,
        intakeLoading: preserveRepoData ? state.intakeLoading : false,
        backlogLoading: preserveRepoData ? state.backlogLoading : false,
        roadmapsLoading: preserveRepoData ? state.roadmapsLoading : false,
        obsidianLoading: preserveRepoData ? state.obsidianLoading : false,
        obsidianDetailLoading: preserveRepoData ? state.obsidianDetailLoading : false,
        obsidianRepresentationsLoading: preserveRepoData ? state.obsidianRepresentationsLoading : false,
      }),
    }));
  }

  async function loadBullets(): Promise<void> {
    const nextVersion = ++bulletsRequestVersion;
    const stateSnapshot = store.getState();
    const repoPath = stateSnapshot.catalogRepoContext?.repoPath || '';
    const repoId = stateSnapshot.catalogRepoContext?.repoId || '';
    const repoLabel = stateSnapshot.catalogRepoContext?.repoLabel || '';

    if (!repoPath) {
      store.setState((state) => ({
        ...state,
        bulletsSummary: null,
        bullets: [],
        bulletsLoading: false,
        loading: computeWorkspaceLoading({ ...state, bulletsLoading: false }),
        bulletsError: null,
      }));
      return;
    }

    store.setState((state) => ({
      ...state,
      bulletsLoading: true,
      loading: computeWorkspaceLoading({ ...state, bulletsLoading: true }),
      bulletsError: null,
    }));

    try {
      const response = await getPlanningBullets({
        repoId: repoId || undefined,
        repoPath,
        repoLabel: repoLabel || undefined,
      });

      store.setState((state) => {
        if (nextVersion !== bulletsRequestVersion) {
          return state;
        }

        return {
          ...state,
          bulletsSummary: response.bullets,
          bullets: response.artifacts,
          bulletsLoading: false,
          loading: computeWorkspaceLoading({ ...state, bulletsLoading: false }),
          bulletsError: null,
        };
      });
    } catch (error) {
      const message = toErrorMessage(error, 'Unable to load planning bullets.');

      store.setState((state) => {
        if (nextVersion !== bulletsRequestVersion) {
          return state;
        }

        return {
          ...state,
          bulletsSummary: null,
          bullets: [],
          bulletsLoading: false,
          loading: computeWorkspaceLoading({ ...state, bulletsLoading: false }),
          bulletsError: message,
        };
      });
    }
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
        loading: computeWorkspaceLoading({ ...state, intakeLoading: false }),
        intakeError: null,
      }));
      return;
    }

    store.setState((state) => ({
      ...state,
      intakeLoading: true,
      loading: computeWorkspaceLoading({ ...state, intakeLoading: true }),
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
          loading: computeWorkspaceLoading({ ...state, intakeLoading: false }),
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
          loading: computeWorkspaceLoading({ ...state, intakeLoading: false }),
          intakeError: message,
        };
      });
    }
  }

  async function loadBacklog(): Promise<void> {
    const nextVersion = ++backlogRequestVersion;
    const stateSnapshot = store.getState();
    const repoPath = stateSnapshot.catalogRepoContext?.repoPath || '';
    const repoId = stateSnapshot.catalogRepoContext?.repoId || '';

    if (!repoPath) {
      store.setState((state) => ({
        ...state,
        backlogSummary: null,
        backlogLoading: false,
        loading: computeWorkspaceLoading({ ...state, backlogLoading: false }),
        backlogError: null,
      }));
      return;
    }

    store.setState((state) => ({
      ...state,
      backlogLoading: true,
      loading: computeWorkspaceLoading({ ...state, backlogLoading: true }),
      backlogError: null,
    }));

    try {
      const response = await getPlanningBacklog({
        repoId: repoId || undefined,
        repoPath,
      });

      store.setState((state) => {
        if (nextVersion !== backlogRequestVersion) {
          return state;
        }

        return {
          ...state,
          backlogSummary: response.backlog,
          backlogLoading: false,
          loading: computeWorkspaceLoading({ ...state, backlogLoading: false }),
          backlogError: null,
        };
      });
    } catch (error) {
      const message = toErrorMessage(error, 'Unable to load backlog.');

      store.setState((state) => {
        if (nextVersion !== backlogRequestVersion) {
          return state;
        }

        return {
          ...state,
          backlogSummary: null,
          backlogLoading: false,
          loading: computeWorkspaceLoading({ ...state, backlogLoading: false }),
          backlogError: message,
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
        loading: computeWorkspaceLoading({ ...state, roadmapsLoading: false }),
        error: null,
      }));
      return;
    }

    store.setState((state) => ({
      ...state,
      roadmapsLoading: true,
      loading: computeWorkspaceLoading({ ...state, roadmapsLoading: true }),
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
          loading: computeWorkspaceLoading({ ...state, roadmapsLoading: false }),
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
          loading: computeWorkspaceLoading({ ...state, roadmapsLoading: false }),
          error: message,
        };
      });
    }
  }

  async function loadObsidianNote(noteId?: string): Promise<void> {
    const selectedNoteId = String(noteId || '').trim();
    const nextVersion = ++obsidianDetailRequestVersion;
    const stateSnapshot = store.getState();
    const repoPath = stateSnapshot.catalogRepoContext?.repoPath || '';
    const repoId = stateSnapshot.catalogRepoContext?.repoId || '';
    const repoLabel = stateSnapshot.catalogRepoContext?.repoLabel || '';

    if (!repoPath || !selectedNoteId) {
      store.setState((state) => ({
        ...state,
        selectedObsidianNote: null,
        obsidianDetailLoading: false,
        loading: computeWorkspaceLoading({ ...state, obsidianDetailLoading: false }),
        obsidianError: null,
      }));
      return;
    }

    store.setState((state) => ({
      ...state,
      selectedObsidianNoteId: selectedNoteId,
      selectedObsidianNote:
        state.selectedObsidianNote && state.selectedObsidianNote.id === selectedNoteId
          ? state.selectedObsidianNote
          : null,
      obsidianDetailLoading: true,
      loading: computeWorkspaceLoading({ ...state, obsidianDetailLoading: true }),
      obsidianError: null,
    }));

    try {
      const response = await getPlanningObsidianNote(selectedNoteId, {
        repoId: repoId || undefined,
        repoPath,
        repoLabel: repoLabel || undefined,
      });

      store.setState((state) => {
        if (nextVersion !== obsidianDetailRequestVersion) {
          return state;
        }

        return {
          ...state,
          obsidianStatus: response.status,
          selectedObsidianNote: response.note,
          obsidianDetailLoading: false,
          loading: computeWorkspaceLoading({ ...state, obsidianDetailLoading: false }),
          obsidianError: null,
        };
      });
    } catch (error) {
      const message = toErrorMessage(error, 'Unable to load the selected external Obsidian note.');

      store.setState((state) => {
        if (nextVersion !== obsidianDetailRequestVersion) {
          return state;
        }

        return {
          ...state,
          selectedObsidianNote: null,
          obsidianDetailLoading: false,
          loading: computeWorkspaceLoading({ ...state, obsidianDetailLoading: false }),
          obsidianError: message,
        };
      });
    }
  }

  async function loadObsidianNotes(): Promise<void> {
    const nextVersion = ++obsidianRequestVersion;
    const stateSnapshot = store.getState();
    const repoPath = stateSnapshot.catalogRepoContext?.repoPath || '';
    const repoId = stateSnapshot.catalogRepoContext?.repoId || '';
    const repoLabel = stateSnapshot.catalogRepoContext?.repoLabel || '';

    if (!repoPath) {
      store.setState((state) => ({
        ...state,
        obsidianStatus: null,
        obsidianNotes: [],
        obsidianRepresentationsStatus: null,
        obsidianRepresentations: [],
        selectedObsidianNoteId: '',
        selectedObsidianNote: null,
        obsidianLoading: false,
        obsidianDetailLoading: false,
        obsidianSyncing: false,
        obsidianRepresentationsLoading: false,
        loading: computeWorkspaceLoading({
          ...state,
          obsidianLoading: false,
          obsidianDetailLoading: false,
          obsidianRepresentationsLoading: false,
        }),
        obsidianError: null,
      }));
      return;
    }

    store.setState((state) => ({
      ...state,
      obsidianLoading: true,
      loading: computeWorkspaceLoading({ ...state, obsidianLoading: true }),
      obsidianError: null,
    }));

    try {
      const [statusResponse, notesResponse] = await Promise.all([
        getPlanningObsidianStatus({
          repoId: repoId || undefined,
          repoPath,
          repoLabel: repoLabel || undefined,
        }),
        listPlanningObsidianNotes({
          repoId: repoId || undefined,
          repoPath,
          repoLabel: repoLabel || undefined,
        }),
      ]);

      let nextSelectedNoteId = '';
      store.setState((state) => {
        if (nextVersion !== obsidianRequestVersion) {
          return state;
        }

        nextSelectedNoteId =
          (state.selectedObsidianNoteId
            && notesResponse.notes.some((entry) => entry.id === state.selectedObsidianNoteId)
            ? state.selectedObsidianNoteId
            : (notesResponse.notes[0]?.id ?? ''));

        return {
          ...state,
          obsidianStatus: notesResponse.status || statusResponse.status,
          obsidianNotes: notesResponse.notes,
          selectedObsidianNoteId: nextSelectedNoteId,
          selectedObsidianNote:
            state.selectedObsidianNote && state.selectedObsidianNote.id === nextSelectedNoteId
              ? state.selectedObsidianNote
              : null,
          obsidianLoading: false,
          loading: computeWorkspaceLoading({ ...state, obsidianLoading: false }),
          obsidianError: null,
        };
      });

      const latestState = store.getState();
      const repoContextUnchanged =
        latestState.catalogRepoContext?.repoPath === repoPath
        && (latestState.catalogRepoContext?.repoId || '') === repoId
        && (latestState.catalogRepoContext?.repoLabel || '') === repoLabel;

      if (nextSelectedNoteId && nextVersion === obsidianRequestVersion && repoContextUnchanged) {
        await loadObsidianNote(nextSelectedNoteId);
      } else if (nextVersion === obsidianRequestVersion && repoContextUnchanged) {
        store.setState((state) => ({
          ...state,
          selectedObsidianNote: null,
          obsidianDetailLoading: false,
          loading: computeWorkspaceLoading({ ...state, obsidianDetailLoading: false }),
        }));
      }
    } catch (error) {
      const message = toErrorMessage(error, 'Unable to load external Obsidian notes.');

      store.setState((state) => {
        if (nextVersion !== obsidianRequestVersion) {
          return state;
        }

        return {
          ...state,
          obsidianStatus: null,
          obsidianNotes: [],
          obsidianRepresentationsStatus: null,
          obsidianRepresentations: [],
          selectedObsidianNoteId: '',
          selectedObsidianNote: null,
          obsidianLoading: false,
          obsidianDetailLoading: false,
          obsidianSyncing: false,
          obsidianRepresentationsLoading: false,
          loading: computeWorkspaceLoading({
            ...state,
            obsidianLoading: false,
            obsidianDetailLoading: false,
            obsidianRepresentationsLoading: false,
          }),
          obsidianError: message,
        };
      });
    }
  }

  async function loadObsidianRepresentations(): Promise<void> {
    const nextVersion = ++obsidianRepresentationsRequestVersion;
    const stateSnapshot = store.getState();
    const repoPath = stateSnapshot.catalogRepoContext?.repoPath || '';
    const repoId = stateSnapshot.catalogRepoContext?.repoId || '';
    const repoLabel = stateSnapshot.catalogRepoContext?.repoLabel || '';

    if (!repoPath) {
      store.setState((state) => ({
        ...state,
        obsidianRepresentationsStatus: null,
        obsidianRepresentations: [],
        obsidianRepresentationsLoading: false,
        loading: computeWorkspaceLoading({ ...state, obsidianRepresentationsLoading: false }),
        obsidianError: null,
      }));
      return;
    }

    store.setState((state) => ({
      ...state,
      obsidianRepresentationsLoading: true,
      loading: computeWorkspaceLoading({ ...state, obsidianRepresentationsLoading: true }),
      obsidianError: null,
    }));

    try {
      const [statusResponse, listResponse] = await Promise.all([
        getPlanningObsidianRepresentationsStatus({
          repoId: repoId || undefined,
          repoPath,
          repoLabel: repoLabel || undefined,
        }),
        listPlanningObsidianRepresentations({
          repoId: repoId || undefined,
          repoPath,
          repoLabel: repoLabel || undefined,
        }),
      ]);

      store.setState((state) => {
        if (nextVersion !== obsidianRepresentationsRequestVersion) {
          return state;
        }

        return {
          ...state,
          obsidianRepresentationsStatus: listResponse.representationsStatus || statusResponse.representationsStatus,
          obsidianRepresentations: listResponse.representations,
          obsidianRepresentationsLoading: false,
          loading: computeWorkspaceLoading({ ...state, obsidianRepresentationsLoading: false }),
          obsidianError: null,
        };
      });
    } catch (error) {
      const message = toErrorMessage(error, 'Unable to load Obsidian planning mirrors.');
      store.setState((state) => {
        if (nextVersion !== obsidianRepresentationsRequestVersion) {
          return state;
        }

        return {
          ...state,
          obsidianRepresentationsStatus: null,
          obsidianRepresentations: [],
          obsidianRepresentationsLoading: false,
          loading: computeWorkspaceLoading({ ...state, obsidianRepresentationsLoading: false }),
          obsidianError: message,
        };
      });
    }
  }

  async function syncObsidianNotes(): Promise<void> {
    const stateSnapshot = store.getState();
    const repoPath = stateSnapshot.catalogRepoContext?.repoPath || '';
    const repoId = stateSnapshot.catalogRepoContext?.repoId || '';
    const repoLabel = stateSnapshot.catalogRepoContext?.repoLabel || '';

    if (!repoPath) {
      store.setState((state) => ({
        ...state,
        obsidianError: 'Select a Catalog repo before syncing Obsidian notes.',
      }));
      return;
    }

    store.setState((state) => ({
      ...state,
      obsidianSyncing: true,
      obsidianError: null,
    }));

    try {
      const response = await triggerPlanningObsidianSync({
        repoId: repoId || undefined,
        repoPath,
        repoLabel: repoLabel || undefined,
      });

      store.setState((state) => ({
        ...state,
        obsidianStatus: response.status,
        obsidianError: null,
      }));

      await loadObsidianNotes();
    } catch (error) {
      const message = toErrorMessage(error, 'Unable to sync external Obsidian notes.');
      store.setState((state) => ({
        ...state,
        obsidianError: message,
      }));
    } finally {
      store.setState((state) => ({
        ...state,
        obsidianSyncing: false,
      }));
    }
  }

  async function refreshObsidianRepresentationsInVault(): Promise<void> {
    const stateSnapshot = store.getState();
    const repoPath = stateSnapshot.catalogRepoContext?.repoPath || '';
    const repoId = stateSnapshot.catalogRepoContext?.repoId || '';
    const repoLabel = stateSnapshot.catalogRepoContext?.repoLabel || '';

    if (!repoPath) {
      store.setState((state) => ({
        ...state,
        obsidianError: 'Select a Catalog repo before refreshing Obsidian planning mirrors.',
      }));
      return;
    }

    store.setState((state) => ({
      ...state,
      obsidianRepresentationsRefreshing: true,
      obsidianError: null,
    }));

    try {
      const response = await refreshPlanningObsidianRepresentations({
        repoId: repoId || undefined,
        repoPath,
        repoLabel: repoLabel || undefined,
      });

      store.setState((state) => ({
        ...state,
        obsidianRepresentationsStatus: response.representationsStatus,
        obsidianRepresentations: response.representations,
        obsidianError: null,
      }));

      await loadObsidianNotes();
    } catch (error) {
      const message = toErrorMessage(error, 'Unable to refresh Obsidian planning mirrors.');
      store.setState((state) => ({
        ...state,
        obsidianError: message,
      }));
    } finally {
      store.setState((state) => ({
        ...state,
        obsidianRepresentationsRefreshing: false,
      }));
    }
  }

  async function createBullet(input: {
    title: string;
    state?: PlanningBullet['state'];
    summary?: string;
    notes?: string[];
  }): Promise<PlanningBullet | null> {
    const stateSnapshot = store.getState();
    const repoId = stateSnapshot.catalogRepoContext?.repoId || '';
    if (!repoId) {
      store.setState((state) => ({
        ...state,
        bulletsError: 'Select a Catalog repo before creating bullets.',
      }));
      return null;
    }

    const response = await createPlanningBullet({
      repoId,
      bullet: {
        title: input.title,
        state: input.state,
        repoId,
        summary: input.summary,
        notes: input.notes,
      },
    });

    store.setState((state) => ({
      ...state,
      bulletsSummary: response.bullets,
      bullets: response.artifacts,
      bulletsError: null,
    }));

    return response.artifact ?? null;
  }

  async function patchBullet(
    bulletId: string,
    patch: {
      title?: string;
      state?: PlanningBullet['state'];
      repoId?: string;
      summary?: string;
      notes?: string[];
      promotedPlanRefs?: string[];
      promotedBacklogRefs?: string[];
    }
  ): Promise<PlanningBullet | null> {
    const stateSnapshot = store.getState();
    const repoId = stateSnapshot.catalogRepoContext?.repoId || '';
    if (!repoId) {
      store.setState((state) => ({
        ...state,
        bulletsError: 'Select a Catalog repo before updating bullets.',
      }));
      return null;
    }

    const response = await updatePlanningBullet(bulletId, {
      repoId,
      patch,
    });

    store.setState((state) => ({
      ...state,
      bulletsSummary: response.bullets,
      bullets: response.artifacts,
      bulletsError: null,
    }));

    return response.artifact ?? null;
  }

  async function promoteBulletToBacklog(bulletId: string): Promise<string | null> {
    const stateSnapshot = store.getState();
    const repoId = stateSnapshot.catalogRepoContext?.repoId || '';
    const repoPath = stateSnapshot.catalogRepoContext?.repoPath || '';
    const bullet = stateSnapshot.bullets.find((entry) => entry.id === bulletId) || null;
    if (!repoId || !repoPath || !bullet) {
      store.setState((state) => ({
        ...state,
        backlogError: 'Select a Catalog repo and bullet before creating a backlog suggestion.',
      }));
      return null;
    }

    const backlogResponse = await createPlanningBacklogItem({
      repoId,
      repoPath,
      item: {
        title: bullet.title,
        summary: [
          bullet.summary,
          `Promoted from ${bullet.id}.`,
          bullet.notes.length > 0 ? `Notes: ${bullet.notes.join('; ')}` : '',
        ].filter(Boolean).join(' '),
        status: 'proposed',
      },
    });

    const backlogId = String(backlogResponse.item?.id || '').trim();
    const nextBacklogRefs = backlogId
      ? [...new Set([...bullet.promotedBacklogRefs, backlogId])].sort()
      : bullet.promotedBacklogRefs;

    await patchBullet(bullet.id, {
      promotedBacklogRefs: nextBacklogRefs,
    });

    store.setState((state) => ({
      ...state,
      backlogSummary: backlogResponse.backlog,
      backlogError: null,
    }));

    return backlogId || null;
  }

  function setSelectedRoadmapSlug(value: string): void {
    const selectedRoadmapSlug = value.trim();
    store.setState((state) => ({
      ...state,
      selectedRoadmapSlug,
    }));
  }

  function setIntakeCategoryFilter(value: PlanningIntakeTrackerFilters['category']): void {
    store.setState((state) => ({
      ...state,
      intakeFilters: {
        ...state.intakeFilters,
        category: value,
      },
    }));
  }

  function setIntakePlanningStateFilter(value: PlanningIntakeTrackerFilters['planningState']): void {
    store.setState((state) => ({
      ...state,
      intakeFilters: {
        ...state.intakeFilters,
        planningState: typeof value === 'string' ? value.trim() || '__all__' : '__all__',
      },
    }));
  }

  function setIntakeTargetFilter(value: PlanningIntakeTrackerFilters['targetRepoId']): void {
    store.setState((state) => ({
      ...state,
      intakeFilters: {
        ...state.intakeFilters,
        targetRepoId: typeof value === 'string' ? value.trim() || '__all__' : '__all__',
      },
    }));
  }

  function clearIntakeFilters(): void {
    store.setState((state) => ({
      ...state,
      intakeFilters: DEFAULT_INTAKE_FILTERS,
    }));
  }

  function reset(): void {
    store.setState(INITIAL_STATE);
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    syncCatalogRepoContext,
    loadBullets,
    loadIntakeArtifacts,
    loadBacklog,
    loadRoadmaps,
    loadObsidianNotes,
    loadObsidianRepresentations,
    loadObsidianNote,
    syncObsidianNotes,
    refreshObsidianRepresentationsInVault,
    createBullet,
    patchBullet,
    promoteBulletToBacklog,
    setSelectedRoadmapSlug,
    setIntakeCategoryFilter,
    setIntakePlanningStateFilter,
    setIntakeTargetFilter,
    clearIntakeFilters,
    reset,
  };
}

export const planningWorkspaceStore = createPlanningWorkspaceStore();
