import {
  createPlanningBacklogItem,
  createPlanningBullet,
  createTrackerSyncedNoteSource,
  deleteTrackerSyncedNoteSource,
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
  setPlanningObsidianSourceSelection,
  triggerPlanningObsidianSync,
  updatePlanningBacklogItem,
  updatePlanningRoadmap,
  updateTrackerSyncedNoteSource,
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
  SyncedNoteSourceLocator,
  SyncedNoteSourceRecord,
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
  obsidianPromotionSaving: boolean;
  obsidianSourceSelectionSaving: boolean;
  obsidianSourceSaving: boolean;
  obsidianSourceDeletingId: string | null;
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
  obsidianPromotionSaving: false,
  obsidianSourceSelectionSaving: false,
  obsidianSourceSaving: false,
  obsidianSourceDeletingId: null,
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

function getObsidianRepoContext(state: PlanningWorkspaceState) {
  return {
    repoId: state.catalogRepoContext?.repoId || '',
    repoPath: state.catalogRepoContext?.repoPath || '',
    repoLabel: state.catalogRepoContext?.repoLabel || '',
  };
}

function getSelectedRoadmap(state: PlanningWorkspaceState) {
  return state.roadmaps.find((roadmap) => roadmap.slug === state.selectedRoadmapSlug)
    || state.roadmaps[0]
    || null;
}

function buildObsidianPromotionSummary(note: ObsidianPlanningNoteSummary | ObsidianPlanningNoteDetail): string {
  const noteSummary = note.summary.trim();
  return [
    `Promoted from external/non-canonical Obsidian note ${note.id} at ${note.notePath}.`,
    noteSummary ? `External note summary: ${noteSummary}` : '',
    'Canonical backlog, roadmaps, and the active session plan remain authoritative.',
  ].filter(Boolean).join(' ');
}

function buildObsidianRoadmapItemSummary(note: ObsidianPlanningNoteSummary | ObsidianPlanningNoteDetail): string {
  const noteSummary = note.summary.trim();
  return [
    `Promoted from external/non-canonical Obsidian note ${note.id}.`,
    noteSummary ? `External note summary: ${noteSummary}` : '',
  ].filter(Boolean).join(' ');
}

function buildBulletPromotionSummary(bullet: PlanningBullet): string {
  return [
    bullet.summary.trim(),
    `Promoted from ${bullet.id}.`,
    bullet.notes.length > 0 ? `Notes: ${bullet.notes.join('; ')}` : '',
  ].filter(Boolean).join(' ');
}

function buildBulletRoadmapItemSummary(bullet: PlanningBullet): string {
  return [
    `Promoted from ${bullet.id}.`,
    bullet.summary.trim(),
    bullet.notes.length > 0 ? `Notes: ${bullet.notes.join('; ')}` : '',
  ].filter(Boolean).join(' ');
}

function resolveRoadmapPromotionDefaults(roadmap: PlanningRoadmap | null): { phase: string; status: string } {
  const phase = roadmap?.items.find((item) => item.phase.trim())?.phase || 'unscheduled';
  return {
    phase,
    status: 'planned',
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
      obsidianPromotionSaving: preserveRepoData ? state.obsidianPromotionSaving : false,
      obsidianSourceSelectionSaving: preserveRepoData ? state.obsidianSourceSelectionSaving : false,
      obsidianSourceSaving: preserveRepoData ? state.obsidianSourceSaving : false,
      obsidianSourceDeletingId: preserveRepoData ? state.obsidianSourceDeletingId : null,
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
    const { repoId, repoPath, repoLabel } = getObsidianRepoContext(stateSnapshot);

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
        obsidianPromotionSaving: false,
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
          obsidianPromotionSaving: false,
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
    const { repoId, repoPath, repoLabel } = getObsidianRepoContext(stateSnapshot);

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
    const { repoId, repoPath, repoLabel } = getObsidianRepoContext(stateSnapshot);

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
    const { repoId, repoPath, repoLabel } = getObsidianRepoContext(stateSnapshot);

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

  async function setObsidianSourceSelection(sourceId: string | null | undefined): Promise<boolean> {
    const stateSnapshot = store.getState();
    const { repoId, repoPath, repoLabel } = getObsidianRepoContext(stateSnapshot);

    if (!repoPath) {
      store.setState((state) => ({
        ...state,
        obsidianError: 'Select a Catalog repo before changing the synced-note source selection.',
      }));
      return false;
    }

    store.setState((state) => ({
      ...state,
      obsidianSourceSelectionSaving: true,
      obsidianError: null,
    }));

    try {
      const response = await setPlanningObsidianSourceSelection(sourceId, {
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
      return true;
    } catch (error) {
      const message = toErrorMessage(error, 'Unable to update the synced-note source selection.');
      store.setState((state) => ({
        ...state,
        obsidianError: message,
      }));
      return false;
    } finally {
      store.setState((state) => ({
        ...state,
        obsidianSourceSelectionSaving: false,
      }));
    }
  }

  async function createObsidianSource(source: SyncedNoteSourceLocator): Promise<SyncedNoteSourceRecord | null> {
    const stateSnapshot = store.getState();
    const { repoPath } = getObsidianRepoContext(stateSnapshot);

    if (!repoPath) {
      store.setState((state) => ({
        ...state,
        obsidianError: 'Select a Catalog repo before creating synced-note sources.',
      }));
      return null;
    }

    store.setState((state) => ({
      ...state,
      obsidianSourceSaving: true,
      obsidianError: null,
    }));

    try {
      const created = await createTrackerSyncedNoteSource(source);
      await loadObsidianNotes();
      return created;
    } catch (error) {
      const message = toErrorMessage(error, 'Unable to create the synced-note source.');
      store.setState((state) => ({
        ...state,
        obsidianError: message,
      }));
      return null;
    } finally {
      store.setState((state) => ({
        ...state,
        obsidianSourceSaving: false,
      }));
    }
  }

  async function updateObsidianSource(
    sourceId: string,
    source: SyncedNoteSourceLocator,
  ): Promise<SyncedNoteSourceRecord | null> {
    const stateSnapshot = store.getState();
    const { repoPath } = getObsidianRepoContext(stateSnapshot);

    if (!repoPath) {
      store.setState((state) => ({
        ...state,
        obsidianError: 'Select a Catalog repo before updating synced-note sources.',
      }));
      return null;
    }

    store.setState((state) => ({
      ...state,
      obsidianSourceSaving: true,
      obsidianError: null,
    }));

    try {
      const updated = await updateTrackerSyncedNoteSource(sourceId, source);
      await loadObsidianNotes();
      return updated;
    } catch (error) {
      const message = toErrorMessage(error, 'Unable to update the synced-note source.');
      store.setState((state) => ({
        ...state,
        obsidianError: message,
      }));
      return null;
    } finally {
      store.setState((state) => ({
        ...state,
        obsidianSourceSaving: false,
      }));
    }
  }

  async function deleteObsidianSource(sourceId: string): Promise<boolean> {
    const stateSnapshot = store.getState();
    const { repoPath } = getObsidianRepoContext(stateSnapshot);

    if (!repoPath) {
      store.setState((state) => ({
        ...state,
        obsidianError: 'Select a Catalog repo before deleting synced-note sources.',
      }));
      return false;
    }

    store.setState((state) => ({
      ...state,
      obsidianSourceDeletingId: sourceId,
      obsidianError: null,
    }));

    try {
      const response = await deleteTrackerSyncedNoteSource(sourceId);
      if (!response.ok) {
        throw new Error('Tracker did not confirm the synced-note source deletion.');
      }

      await loadObsidianNotes();
      return true;
    } catch (error) {
      const message = toErrorMessage(error, 'Unable to delete the synced-note source.');
      store.setState((state) => ({
        ...state,
        obsidianError: message,
      }));
      return false;
    } finally {
      store.setState((state) => ({
        ...state,
        obsidianSourceDeletingId: null,
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

  async function promoteObsidianNoteToBacklog(
    note: ObsidianPlanningNoteSummary | ObsidianPlanningNoteDetail,
  ): Promise<string | null> {
    const stateSnapshot = store.getState();
    const { repoId, repoPath } = getObsidianRepoContext(stateSnapshot);

    if (!repoId || !repoPath) {
      store.setState((state) => ({
        ...state,
        obsidianError: 'Select a Catalog repo before promoting external Obsidian notes into the backlog.',
      }));
      return null;
    }

    store.setState((state) => ({
      ...state,
      obsidianPromotionSaving: true,
      obsidianError: null,
    }));

    try {
      const backlogResponse = await createPlanningBacklogItem({
        repoId,
        repoPath,
        item: {
          title: note.title,
          summary: buildObsidianPromotionSummary(note),
          status: 'proposed',
        },
      });
      const backlogId = String(backlogResponse.item?.id || '').trim();
      if (!backlogId) {
        throw new Error('Backlog promotion did not return a canonical backlog id.');
      }

      await loadBacklog();
      store.setState((state) => ({
        ...state,
        backlogError: null,
        obsidianError: null,
      }));
      return backlogId;
    } catch (error) {
      const message = toErrorMessage(error, 'Unable to promote the external Obsidian note into the backlog.');
      store.setState((state) => ({
        ...state,
        obsidianError: message,
      }));
      return null;
    } finally {
      store.setState((state) => ({
        ...state,
        obsidianPromotionSaving: false,
      }));
    }
  }

  async function promoteObsidianNoteToRoadmap(
    note: ObsidianPlanningNoteSummary | ObsidianPlanningNoteDetail,
  ): Promise<{ backlogId: string; roadmapItemId: string } | null> {
    const stateSnapshot = store.getState();
    const { repoId, repoPath, repoLabel } = getObsidianRepoContext(stateSnapshot);
    const selectedRoadmap = getSelectedRoadmap(stateSnapshot);

    if (!repoId || !repoPath) {
      store.setState((state) => ({
        ...state,
        obsidianError: 'Select a Catalog repo before promoting external Obsidian notes into a roadmap.',
      }));
      return null;
    }

    if (!selectedRoadmap) {
      store.setState((state) => ({
        ...state,
        obsidianError: 'Select a roadmap before promoting an external Obsidian note into roadmap work.',
      }));
      return null;
    }

    store.setState((state) => ({
      ...state,
      obsidianPromotionSaving: true,
      obsidianError: null,
    }));

    try {
      const backlogResponse = await createPlanningBacklogItem({
        repoId,
        repoPath,
        item: {
          title: note.title,
          summary: buildObsidianPromotionSummary(note),
          status: 'proposed',
        },
      });
      const backlogId = String(backlogResponse.item?.id || '').trim();
      if (!backlogId) {
        throw new Error('Roadmap promotion did not return a canonical backlog id.');
      }

      const roadmapDefaults = resolveRoadmapPromotionDefaults(selectedRoadmap);
      const existingRoadmapItemIds = new Set(selectedRoadmap.items.map((item) => item.id));
      const roadmapResponse = await updatePlanningRoadmap(selectedRoadmap.slug, {
        repoId,
        repoPath,
        repoLabel: repoLabel || undefined,
        items: [
          {
            title: note.title,
            phase: roadmapDefaults.phase,
            status: roadmapDefaults.status,
            summary: buildObsidianRoadmapItemSummary(note),
            backlogIds: [backlogId],
            planRefs: [],
          },
        ],
      });

      const roadmapItem = roadmapResponse.roadmap?.items.find((item) => (
        !existingRoadmapItemIds.has(item.id)
        && item.title === note.title
        && item.backlogIds.includes(backlogId)
      )) || null;
      const roadmapItemId = String(roadmapItem?.id || '').trim();
      if (!roadmapItemId) {
        throw new Error('Roadmap promotion did not return a canonical roadmap item id.');
      }

      const currentRoadmapIds = Array.isArray(backlogResponse.item?.roadmapIds)
        ? backlogResponse.item?.roadmapIds
        : [];
      await updatePlanningBacklogItem(backlogId, {
        repoId,
        repoPath,
        item: {
          roadmapIds: [...new Set([...currentRoadmapIds, roadmapItemId])].sort(),
        },
      });

      await Promise.all([loadBacklog(), loadRoadmaps()]);
      store.setState((state) => ({
        ...state,
        backlogError: null,
        error: null,
        obsidianError: null,
      }));

      return {
        backlogId,
        roadmapItemId,
      };
    } catch (error) {
      const message = toErrorMessage(error, 'Unable to promote the external Obsidian note into the selected roadmap.');
      store.setState((state) => ({
        ...state,
        obsidianError: message,
      }));
      return null;
    } finally {
      store.setState((state) => ({
        ...state,
        obsidianPromotionSaving: false,
      }));
    }
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
      promotedRoadmapRefs?: string[];
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
        summary: buildBulletPromotionSummary(bullet),
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

  async function promoteBulletToRoadmap(
    bulletId: string,
  ): Promise<{ backlogId: string; roadmapItemId: string } | null> {
    const stateSnapshot = store.getState();
    const repoId = stateSnapshot.catalogRepoContext?.repoId || '';
    const repoPath = stateSnapshot.catalogRepoContext?.repoPath || '';
    const repoLabel = stateSnapshot.catalogRepoContext?.repoLabel || '';
    const bullet = stateSnapshot.bullets.find((entry) => entry.id === bulletId) || null;
    const selectedRoadmap = getSelectedRoadmap(stateSnapshot);

    if (!repoId || !repoPath || !bullet) {
      store.setState((state) => ({
        ...state,
        error: 'Select a Catalog repo and bullet before promoting roadmap work.',
      }));
      return null;
    }

    if (!selectedRoadmap) {
      store.setState((state) => ({
        ...state,
        error: 'Select a roadmap before promoting a bullet into roadmap work.',
      }));
      return null;
    }

    store.setState((state) => ({
      ...state,
      backlogError: null,
      error: null,
    }));

    try {
      const existingBacklogItem = stateSnapshot.backlogSummary?.items.find((item) => (
        bullet.promotedBacklogRefs.includes(item.id)
      )) || null;

      let backlogId = String(existingBacklogItem?.id || '').trim();
      if (!backlogId) {
        const backlogResponse = await createPlanningBacklogItem({
          repoId,
          repoPath,
          item: {
            title: bullet.title,
            summary: buildBulletPromotionSummary(bullet),
            status: 'proposed',
          },
        });
        backlogId = String(backlogResponse.item?.id || '').trim();
      }

      if (!backlogId) {
        throw new Error('Roadmap promotion did not return a canonical backlog id.');
      }

      const existingRoadmapItem = selectedRoadmap.items.find((item) => (
        bullet.promotedRoadmapRefs.includes(item.id)
      )) || null;
      let roadmapItemId = String(existingRoadmapItem?.id || '').trim();

      if (!roadmapItemId) {
        const roadmapDefaults = resolveRoadmapPromotionDefaults(selectedRoadmap);
        const existingRoadmapItemIds = new Set(selectedRoadmap.items.map((item) => item.id));
        const roadmapResponse = await updatePlanningRoadmap(selectedRoadmap.slug, {
          repoId,
          repoPath,
          repoLabel: repoLabel || undefined,
          items: [
            {
              title: bullet.title,
              phase: roadmapDefaults.phase,
              status: roadmapDefaults.status,
              summary: buildBulletRoadmapItemSummary(bullet),
              backlogIds: [backlogId],
              planRefs: [],
            },
          ],
        });

        const roadmapItem = roadmapResponse.roadmap?.items.find((item) => (
          !existingRoadmapItemIds.has(item.id)
          && item.title === bullet.title
          && item.backlogIds.includes(backlogId)
        )) || null;
        roadmapItemId = String(roadmapItem?.id || '').trim();
      }

      if (!roadmapItemId) {
        throw new Error('Roadmap promotion did not return a canonical roadmap item id.');
      }

      const nextRoadmapIds = existingBacklogItem
        ? [...new Set([...existingBacklogItem.roadmapIds, roadmapItemId])].sort()
        : [roadmapItemId];
      await updatePlanningBacklogItem(backlogId, {
        repoId,
        repoPath,
        item: {
          roadmapIds: nextRoadmapIds,
        },
      });

      await patchBullet(bullet.id, {
        promotedBacklogRefs: [...new Set([...bullet.promotedBacklogRefs, backlogId])].sort(),
        promotedRoadmapRefs: [...new Set([...bullet.promotedRoadmapRefs, roadmapItemId])].sort(),
      });

      await Promise.all([loadBacklog(), loadRoadmaps()]);
      store.setState((state) => ({
        ...state,
        backlogError: null,
        error: null,
      }));

      return {
        backlogId,
        roadmapItemId,
      };
    } catch (error) {
      const message = toErrorMessage(error, 'Unable to promote the selected bullet into the roadmap.');
      store.setState((state) => ({
        ...state,
        error: message,
      }));
      return null;
    }
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
    promoteObsidianNoteToBacklog,
    promoteObsidianNoteToRoadmap,
    setObsidianSourceSelection,
    createObsidianSource,
    updateObsidianSource,
    deleteObsidianSource,
    createBullet,
    patchBullet,
    promoteBulletToBacklog,
    promoteBulletToRoadmap,
    setSelectedRoadmapSlug,
    setIntakeCategoryFilter,
    setIntakePlanningStateFilter,
    setIntakeTargetFilter,
    clearIntakeFilters,
    reset,
  };
}

export const planningWorkspaceStore = createPlanningWorkspaceStore();
