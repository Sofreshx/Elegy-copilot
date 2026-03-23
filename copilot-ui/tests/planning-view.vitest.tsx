import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function createMockStore<T>(initialState: T) {
  let state = initialState;
  const listeners = new Set<() => void>();

  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setState: (nextState: T) => {
      state = nextState;
      listeners.forEach((listener) => listener());
    },
  };
}

const mocks = vi.hoisted(() => {
  const planningStore = createMockStore({
    userId: '',
    repoId: 'repo-1',
    catalogRepoContext: {
      repoId: 'repo-1',
      repoPath: 'C:\\Repos\\instruction-engine',
      repoLabel: 'Instruction Engine',
      sources: ['workspace', 'selected'],
    },
    planningIntakeDirectory: null,
    repositoryBacklog: null,
    roadmapDirectory: null,
    query: '',
    sessionId: '',
    scopeUser: true,
    scopeRepo: true,
    scopeGlobal: false,
    draftIdeas: [],
    records: [
      {
        recordId: 'planning-1',
        scope: 'repo',
        repoId: 'repo-1',
        title: 'Backlog follow-up',
        state: 'thought',
      },
    ],
    deniedScopes: [],
    searchResults: [],
    createScope: 'repo',
    createState: 'thought',
    createTitle: '',
    createSummary: '',
    createAcceptanceCriteria: '',
    ideaDraft: '',
    ideaTargetRepos: '',
    selectedIdeaIds: [],
    updatingRecordId: null,
    savingIdeaId: null,
    compiling: false,
    linkedPlanSession: {
      sessionId: 'plan-123',
      planPath: 'C:\\Users\\Dylan\\.copilot\\session-state\\plan-123\\plan.md',
      repoId: 'repo-1',
      source: 'seed-from-intake',
      createdAt: '2026-03-18T00:25:00.000Z',
      updatedAt: '2026-03-18T00:30:00.000Z',
      seedArtifactId: 'PI-001',
      seedArtifactCategory: 'idea',
      seedArtifactTitle: 'Capture planning intake',
    },
    linkedSdkSession: {
      sessionId: 'sdk-123',
      repoId: 'repo-1',
      source: 'compile-selected-ideas',
      createdAt: '2026-03-18T00:30:00.000Z',
      selectedIdeaIds: ['draft-1'],
      selectedIdeaTitles: ['Capture planning intake'],
      targetRepoIds: ['repo-1'],
      promptPreview: 'Create a repo-targeted implementation plan from the following planning ideas.',
    },
    planTitleDraft: 'Instruction Engine follow-up plan',
    planContentDraft: '# Instruction Engine follow-up plan\n\n## Problem\n\nClose the remaining planning UX gaps.\n',
    planLoading: false,
    planSaving: false,
    planError: null,
    selectedRecordId: 'planning-1',
    researchNotes: [],
    diagrams: [],
    selectedDiagramId: '',
    artifactsLoading: false,
    artifactsSaving: false,
    artifactsDeleting: false,
    artifactsError: null,
    compareResponse: null,
    gateState: 'pass',
    gateReason: 'ready',
    conflictRows: [],
    reviewedConflictKeys: [],
    mergeTargetId: '',
    intentToken: null,
    policyPreflight: null,
    mutatingBlocked: false,
    mutatingReason: '',
    loading: false,
    listing: false,
    searching: false,
    comparing: false,
    creating: false,
    preparingIntent: false,
    merging: false,
    preflightLoading: false,
    error: null,
    statusMessage: null,
  });
  const planningWorkspaceStore = createMockStore({
    catalogRepoContext: {
      repoId: 'repo-1',
      repoPath: 'C:\\Repos\\instruction-engine',
      repoLabel: 'Instruction Engine',
      sources: ['workspace'],
    },
    planningBulletsFile: {
      filePath: 'C:\\Repos\\instruction-engine\\docs\\planning\\bullets.md',
      repoRelativePath: 'docs/planning/bullets.md',
      stableIdPattern: 'PB-###',
      supportedStates: ['idea', 'research', 'pre-plan'],
    },
    bulletsSummary: {
      filePath: 'C:\\Repos\\instruction-engine\\docs\\planning\\bullets.md',
      repoRelativePath: 'docs/planning/bullets.md',
      exists: true,
      bulletCount: 1,
      stableIdPattern: 'PB-###',
      supportedStates: ['idea', 'research', 'pre-plan'],
    },
    bullets: [
      {
        id: 'PB-001',
        title: 'Clarify roadmap hierarchy',
        state: 'idea',
        repoId: 'repo-1',
        summary: 'Explain roadmap above backlog above plans.',
        notes: ['Keep bullets browse-first'],
        promotedPlanRefs: ['plan-123'],
        promotedBacklogRefs: [],
      },
    ],
    planningIntakeDirectory: {
      canonicalName: 'Planning Intake',
      repo: {
        repoId: 'repo-1',
        repoPath: 'C:\\Repos\\instruction-engine',
        repoLabel: 'Instruction Engine',
      },
      directoryPath: 'C:\\Repos\\instruction-engine\\docs\\planning\\intake',
      repoRelativePath: 'docs/planning/intake',
      stableIdPattern: 'PI-###',
      supportedCategories: ['idea', 'research', 'refactor-candidate', 'design-complaint', 'audit-request', 'roadmap-request', 'review-prep', 'commit-prep'],
    },
    intakeSummary: {
      directoryPath: 'C:\\Repos\\instruction-engine\\docs\\planning\\intake',
      repoRelativePath: 'docs/planning/intake',
      exists: true,
      artifactCount: 3,
      stableIdPattern: 'PI-###',
      supportedCategories: ['idea', 'research', 'refactor-candidate', 'design-complaint', 'audit-request', 'roadmap-request', 'review-prep', 'commit-prep'],
    },
    intakeArtifacts: [
      {
        kind: 'planning.intake.artifact',
        schemaVersion: 1,
        id: 'PI-001',
        category: 'idea',
        title: 'Capture planning intake',
        summary: 'Persist unscheduled tracked work.',
        acceptanceCriteria: ['Write tests'],
        targetRepoIds: ['repo-1'],
        planningState: 'thought',
        createdAt: '2026-03-18T00:00:00.000Z',
        updatedAt: '2026-03-18T00:00:00.000Z',
        filePath: 'C:\\Repos\\instruction-engine\\docs\\planning\\intake\\PI-001.json',
        repoRelativePath: 'docs/planning/intake/PI-001.json',
      },
      {
        kind: 'planning.intake.artifact',
        schemaVersion: 1,
        id: 'PI-002',
        category: 'research',
        title: 'Validate tracker grouping',
        summary: 'Check grouped intake readability.',
        acceptanceCriteria: ['Add summary cards'],
        targetRepoIds: ['repo-2'],
        planningState: 'ready',
        createdAt: '2026-03-18T00:00:00.000Z',
        updatedAt: '2026-03-18T00:00:00.000Z',
        filePath: 'C:\\Repos\\instruction-engine\\docs\\planning\\intake\\PI-002.json',
        repoRelativePath: 'docs/planning/intake/PI-002.json',
      },
      {
        kind: 'planning.intake.artifact',
        schemaVersion: 1,
        id: 'PI-003',
        category: 'idea',
        title: 'Triage unscoped follow-up',
        summary: 'Keep unscoped work visible.',
        acceptanceCriteria: ['Show unscoped target state'],
        targetRepoIds: [],
        createdAt: '2026-03-18T00:00:00.000Z',
        updatedAt: '2026-03-18T00:00:00.000Z',
        filePath: 'C:\\Repos\\instruction-engine\\docs\\planning\\intake\\PI-003.json',
        repoRelativePath: 'docs/planning/intake/PI-003.json',
      },
    ],
    intakeFilters: {
      category: '__all__',
      planningState: '__all__',
      targetRepoId: '__all__',
    },
    repositoryBacklog: {
      canonicalName: 'Repository Backlog',
      repo: {
        repoId: 'repo-1',
        repoPath: 'C:\\Repos\\instruction-engine',
        repoLabel: 'Instruction Engine',
      },
      filePath: 'C:\\Repos\\instruction-engine\\docs\\backlog.md',
      repoRelativePath: 'docs/backlog.md',
      stableIdPattern: 'RB-###',
    },
    backlogSummary: {
      filePath: 'C:\\Repos\\instruction-engine\\docs\\backlog.md',
      repoRelativePath: 'docs/backlog.md',
      stableIdPattern: 'RB-###',
      description: 'Repo-scoped intake and queued work for the selected repo.',
      items: [
        {
          id: 'RB-001',
          title: 'Establish backlog/roadmap workflow',
          status: 'proposed',
          summary: 'Keep backlog authority explicit in Planning.',
          roadmapIds: ['RM-platform-foundation-001'],
          planRefs: ['plan-123'],
        },
      ],
    },
    roadmapDirectory: {
      canonicalName: 'Roadmap',
      repo: {
        repoId: 'repo-1',
        repoPath: 'C:\\Repos\\instruction-engine',
        repoLabel: 'Instruction Engine',
      },
      directoryPath: 'C:\\Repos\\instruction-engine\\docs\\roadmaps',
      repoRelativePath: 'docs/roadmaps',
      stableIdPattern: 'RM-<roadmap-slug>-###',
    },
    roadmaps: [
      {
        slug: 'platform-foundation',
        title: 'Platform Foundation',
        overview: 'Stage repo work into phased outcomes.',
        filePath: 'C:\\Repos\\instruction-engine\\docs\\roadmaps\\platform-foundation.md',
        repoRelativePath: 'docs/roadmaps/platform-foundation.md',
        itemCount: 1,
        statusCounts: { queued: 1 },
        items: [
          {
            id: 'RM-platform-foundation-001',
            title: 'Establish backlog/roadmap workflow',
            phase: 'foundation',
            status: 'queued',
            backlogIds: ['RB-001'],
            planRefs: [],
          },
        ],
      },
    ],
    selectedRoadmapSlug: 'platform-foundation',
    obsidianStatus: {
      state: 'ready',
      configured: true,
      readAvailable: true,
      syncAvailable: false,
      external: true,
      canonicalAuthority: false,
      message: 'External Obsidian notes are available.',
      notesDirectoryPath: 'C:\\Vault\\Planning\\repo-1',
    },
    obsidianNotes: [
      {
        kind: 'synced-note',
        provider: 'obsidian',
        id: 'obsnote_1234',
        title: 'External planning note',
        summary: 'Review external planning context.',
        repoId: 'repo-1',
        targetRepoIds: ['repo-1'],
        vaultName: 'Planning',
        notePath: 'Planning/repo-1/external-planning-note.md',
        filePath: 'C:\\Vault\\Planning\\repo-1\\external-planning-note.md',
        lastModifiedAt: '2026-03-23T00:00:00.000Z',
        external: true,
        canonicalAuthority: false,
      },
    ],
    obsidianRepresentationsStatus: {
      totalCount: 2,
      writeAvailable: true,
      currentCount: 1,
      staleCount: 1,
      missingCount: 0,
      invalidCount: 0,
      sourceMissingCount: 0,
      message: 'Deterministic Obsidian planning mirrors are available for generation and freshness checks.',
    },
    obsidianRepresentations: [
      {
        kind: 'planning-representation',
        provider: 'obsidian',
        id: 'obsrep_bullets',
        representationKind: 'bullets',
        title: 'Planning Bullets Mirror',
        summary: 'Deterministic Obsidian mirror of docs/planning/bullets.md.',
        repoId: 'repo-1',
        targetRepoIds: ['repo-1'],
        sourceExists: true,
        sourceRepoRelativePath: 'docs/planning/bullets.md',
        notePath: 'Planning/repo-1/_instruction-engine/planning-mirrors/bullets.md',
        noteExists: true,
        freshness: 'current',
        metadataValid: true,
        external: true,
        canonicalAuthority: false,
        message: 'Mirror matches the current canonical repo artifact.',
      },
      {
        kind: 'planning-representation',
        provider: 'obsidian',
        id: 'obsrep_roadmap',
        representationKind: 'roadmap',
        title: 'Roadmap Mirror — Platform Foundation',
        summary: 'Deterministic Obsidian mirror of docs/roadmaps/platform-foundation.md.',
        repoId: 'repo-1',
        targetRepoIds: ['repo-1'],
        roadmapSlug: 'platform-foundation',
        sourceExists: true,
        sourceRepoRelativePath: 'docs/roadmaps/platform-foundation.md',
        notePath: 'Planning/repo-1/_instruction-engine/planning-mirrors/roadmaps/platform-foundation.md',
        noteExists: true,
        freshness: 'stale',
        metadataValid: true,
        external: true,
        canonicalAuthority: false,
        message: 'Canonical repo artifact changed since the mirror was generated.',
      },
    ],
    selectedObsidianNoteId: 'obsnote_1234',
    selectedObsidianNote: {
      kind: 'synced-note',
      provider: 'obsidian',
      id: 'obsnote_1234',
      title: 'External planning note',
      summary: 'Review external planning context.',
      repoId: 'repo-1',
      targetRepoIds: ['repo-1'],
      vaultName: 'Planning',
      notePath: 'Planning/repo-1/external-planning-note.md',
      filePath: 'C:\\Vault\\Planning\\repo-1\\external-planning-note.md',
      lastModifiedAt: '2026-03-23T00:00:00.000Z',
      external: true,
      canonicalAuthority: false,
      content: '# External planning note\n\nReview external planning context.',
      headings: ['External planning note'],
    },
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
  });

  const catalogWorkspaceStore = createMockStore({
    loading: false,
    refreshing: false,
    repoInventoryLoading: false,
    activeRepoPath: 'C:\\Repos\\instruction-engine',
    activeRepoId: 'repo-1',
    repoInventory: {
      repos: [
        {
          repoId: 'repo-1',
          repoPath: 'C:\\Repos\\instruction-engine',
          repoLabel: 'Instruction Engine',
          sources: ['workspace', 'selected'],
          lastRefreshAt: '2026-03-14T12:00:00.000Z',
          hints: {
            languages: ['TypeScript'],
            frameworks: ['React'],
            targets: ['frontend'],
          },
        },
      ],
      selectedRepo: {
        repoId: 'repo-1',
        repoPath: 'C:\\Repos\\instruction-engine',
        repoLabel: 'Instruction Engine',
        sources: ['workspace', 'selected'],
        lastRefreshAt: '2026-03-14T12:00:00.000Z',
        hints: {
          languages: ['TypeScript'],
          frameworks: ['React'],
          targets: ['frontend'],
        },
      },
    },
    selectRepo: vi.fn(),
  });
  const sdkHealthStore = createMockStore({
    health: {
      connected: true,
      state: 'connected',
      sessionCount: 1,
    },
    loading: false,
    error: null,
    lastUpdatedAtMs: 1,
  });
  const stateOverviewStore = createMockStore({
    health: {
      planningPersistence: {
        status: 'ready',
        configured: true,
        usable: true,
        required: true,
        governance: {
          code: 'ready',
          reason: 'ready',
        },
        migrations: {
          appliedAt: '2026-03-18T00:00:00.000Z',
        },
      },
      planningDurabilityDependencyGate: {
        ready: true,
      },
    },
    gatewayState: null,
    catalogHealth: null,
    loading: false,
    error: null,
    lastUpdatedAtMs: 1,
  });
  const sdkSessionsStore = createMockStore({
    sessions: [
      {
        sessionId: 'sdk-123',
        model: 'gpt-4.1',
        cwd: 'C:\\Repos\\instruction-engine',
      },
    ],
    selectedSessionId: 'sdk-123',
    messagesBySession: {},
    pendingBySession: {},
    loading: false,
    creating: false,
    deleting: false,
    sending: false,
    streamStatus: 'connected',
    streamError: null,
    composerPrompt: '',
    error: null,
  });

  return {
    planningStore,
    planningWorkspaceStore,
    catalogWorkspaceStore,
    sdkHealthStore,
    stateOverviewStore,
    sdkSessionsStore,
    loadInitial: vi.fn(),
    refreshPolicyPreflight: vi.fn(),
    listRecords: vi.fn(),
    applyCatalogRepoContext: vi.fn(),
    loadWorkspaceIntake: vi.fn(),
    loadWorkspaceBullets: vi.fn(),
    loadWorkspaceBacklog: vi.fn(),
    loadWorkspaceRoadmaps: vi.fn(),
    loadObsidianNotes: vi.fn(),
    loadObsidianRepresentations: vi.fn(),
    loadObsidianNote: vi.fn(),
    syncObsidianNotes: vi.fn(),
    refreshObsidianRepresentationsInVault: vi.fn(),
    syncCatalogRepoContext: vi.fn(),
    patchBullet: vi.fn(),
    promoteBulletToBacklog: vi.fn(),
    setSelectedRoadmapSlug: vi.fn(),
    setIntakeCategoryFilter: vi.fn(),
    setIntakePlanningStateFilter: vi.fn(),
    setIntakeTargetFilter: vi.fn(),
    clearIntakeFilters: vi.fn(),
    setUserId: vi.fn(),
    setQuery: vi.fn(),
    setSessionId: vi.fn(),
    setScope: vi.fn(),
    setSelectedRecordId: vi.fn(),
    setCreateScope: vi.fn(),
    setCreateState: vi.fn(),
    setCreateTitle: vi.fn(),
    setCreateSummary: vi.fn(),
    setCreateAcceptanceCriteria: vi.fn(),
    createRecord: vi.fn(),
    compareRecords: vi.fn(),
    searchRecords: vi.fn(),
    prepareMergeIntent: vi.fn(),
    confirmMerge: vi.fn(),
    toggleConflictReviewed: vi.fn(),
    setMergeTargetId: vi.fn(),
    loadArtifacts: vi.fn(),
    saveResearchNote: vi.fn(),
    removeResearchNote: vi.fn(),
    loadWorkspace: vi.fn(),
    refreshRepo: vi.fn(),
    selectRepo: vi.fn(),
    goToCatalog: vi.fn(),
    sdkHealthRefresh: vi.fn(),
    sdkHealthStartPolling: vi.fn(),
    sdkHealthStopPolling: vi.fn(),
    stateOverviewRefresh: vi.fn(),
    stateOverviewStartPolling: vi.fn(),
    stateOverviewStopPolling: vi.fn(),
    sdkLoadSessions: vi.fn(),
    sdkSelectSession: vi.fn(),
    localLoadSessions: vi.fn(),
    localSelectSession: vi.fn(),
    setPlanTitleDraft: vi.fn(),
    setPlanContentDraft: vi.fn(),
    loadLinkedPlan: vi.fn(),
    savePlanDraft: vi.fn(),
    goToRuntime: vi.fn(),
  };
});

vi.mock('../ui/src/tabs/Planning/planningStore', () => ({
  planningStore: {
    ...mocks.planningStore,
    loadInitial: mocks.loadInitial,
    refreshPolicyPreflight: mocks.refreshPolicyPreflight,
    listRecords: mocks.listRecords,
    applyCatalogRepoContext: mocks.applyCatalogRepoContext,
    setUserId: mocks.setUserId,
    setQuery: mocks.setQuery,
    setSessionId: mocks.setSessionId,
    setScope: mocks.setScope,
    setSelectedRecordId: mocks.setSelectedRecordId,
    setCreateScope: mocks.setCreateScope,
    setCreateState: mocks.setCreateState,
    setCreateTitle: mocks.setCreateTitle,
    setCreateSummary: mocks.setCreateSummary,
    setCreateAcceptanceCriteria: mocks.setCreateAcceptanceCriteria,
    createRecord: mocks.createRecord,
    compareRecords: mocks.compareRecords,
    searchRecords: mocks.searchRecords,
    prepareMergeIntent: mocks.prepareMergeIntent,
    confirmMerge: mocks.confirmMerge,
    toggleConflictReviewed: mocks.toggleConflictReviewed,
    setMergeTargetId: mocks.setMergeTargetId,
    loadArtifacts: mocks.loadArtifacts,
    saveResearchNote: mocks.saveResearchNote,
    removeResearchNote: mocks.removeResearchNote,
    setPlanTitleDraft: mocks.setPlanTitleDraft,
    setPlanContentDraft: mocks.setPlanContentDraft,
    loadLinkedPlan: mocks.loadLinkedPlan,
    savePlanDraft: mocks.savePlanDraft,
  },
  hasReviewedAllPlanningConflicts: () => true,
  planningGateAllowsMerge: () => true,
  isIdeaRecord: (record: { state?: string }) => record.state === 'thought',
}));

vi.mock('../ui/src/tabs/Planning/planningWorkspaceStore', () => ({
  planningWorkspaceStore: {
    ...mocks.planningWorkspaceStore,
    loadBullets: mocks.loadWorkspaceBullets,
    loadIntakeArtifacts: mocks.loadWorkspaceIntake,
    loadBacklog: mocks.loadWorkspaceBacklog,
    loadRoadmaps: mocks.loadWorkspaceRoadmaps,
    loadObsidianNotes: mocks.loadObsidianNotes,
    loadObsidianRepresentations: mocks.loadObsidianRepresentations,
    loadObsidianNote: mocks.loadObsidianNote,
    syncObsidianNotes: mocks.syncObsidianNotes,
    refreshObsidianRepresentationsInVault: mocks.refreshObsidianRepresentationsInVault,
    syncCatalogRepoContext: mocks.syncCatalogRepoContext,
    patchBullet: mocks.patchBullet,
    promoteBulletToBacklog: mocks.promoteBulletToBacklog,
    setSelectedRoadmapSlug: mocks.setSelectedRoadmapSlug,
    setIntakeCategoryFilter: mocks.setIntakeCategoryFilter,
    setIntakePlanningStateFilter: mocks.setIntakePlanningStateFilter,
    setIntakeTargetFilter: mocks.setIntakeTargetFilter,
    clearIntakeFilters: mocks.clearIntakeFilters,
  },
}));

vi.mock('../ui/src/tabs/Assets/catalogWorkspaceStore', () => ({
  catalogWorkspaceStore: {
    ...mocks.catalogWorkspaceStore,
    loadWorkspace: mocks.loadWorkspace,
    refreshRepo: mocks.refreshRepo,
    selectRepo: mocks.selectRepo,
  },
}));

vi.mock('../ui/src/stores/navigation', () => ({
  navigationStore: {
    goToCatalog: mocks.goToCatalog,
    goToRuntime: mocks.goToRuntime,
  },
}));

vi.mock('../ui/src/stores/sdkHealthStore', () => ({
  sdkHealthStore: {
    ...mocks.sdkHealthStore,
    refresh: mocks.sdkHealthRefresh,
    startPolling: mocks.sdkHealthStartPolling,
    stopPolling: mocks.sdkHealthStopPolling,
  },
}));

vi.mock('../ui/src/tabs/State/stateOverviewStore', () => ({
  stateOverviewStore: {
    ...mocks.stateOverviewStore,
    refresh: mocks.stateOverviewRefresh,
    startPolling: mocks.stateOverviewStartPolling,
    stopPolling: mocks.stateOverviewStopPolling,
  },
}));

vi.mock('../ui/src/tabs/Sessions/sdkSessionsStore', () => ({
  sdkSessionsStore: {
    ...mocks.sdkSessionsStore,
    loadSessions: mocks.sdkLoadSessions,
    selectSession: mocks.sdkSelectSession,
  },
}));

vi.mock('../ui/src/tabs/Sessions/sessionsStore', () => ({
  sessionsStore: {
    loadSessions: mocks.localLoadSessions,
    selectSession: mocks.localSelectSession,
  },
}));

vi.mock('../ui/src/tabs/Planning/PlanningIdeasPanel', () => ({
  default: () => <div data-testid="mock-planning-ideas-panel">Ideas panel</div>,
}));

vi.mock('../ui/src/tabs/Planning/ResearchNotesPanel', () => ({
  default: () => <div data-testid="research-notes-panel">Research notes</div>,
}));

vi.mock('../ui/src/tabs/Planning/ObsidianNotesPanel', () => ({
  default: () => <div data-testid="planning-obsidian-notes-panel">External Obsidian notes</div>,
}));

vi.mock('../ui/src/tabs/Planning/MermaidViewer', () => ({
  default: () => <div data-testid="mermaid-viewer">Diagram preview</div>,
}));

describe('PlanningView', () => {
  beforeEach(() => {
    [
      mocks.loadInitial,
      mocks.refreshPolicyPreflight,
      mocks.listRecords,
      mocks.applyCatalogRepoContext,
      mocks.loadWorkspaceBullets,
      mocks.loadWorkspaceIntake,
      mocks.loadWorkspaceBacklog,
      mocks.loadWorkspaceRoadmaps,
      mocks.loadObsidianNotes,
      mocks.loadObsidianRepresentations,
      mocks.loadObsidianNote,
      mocks.syncObsidianNotes,
      mocks.refreshObsidianRepresentationsInVault,
      mocks.syncCatalogRepoContext,
      mocks.patchBullet,
      mocks.promoteBulletToBacklog,
      mocks.setSelectedRoadmapSlug,
      mocks.setIntakeCategoryFilter,
      mocks.setIntakePlanningStateFilter,
      mocks.setIntakeTargetFilter,
      mocks.clearIntakeFilters,
      mocks.loadWorkspace,
      mocks.refreshRepo,
      mocks.selectRepo,
      mocks.goToCatalog,
      mocks.sdkHealthRefresh,
      mocks.sdkHealthStartPolling,
      mocks.sdkHealthStopPolling,
      mocks.stateOverviewRefresh,
      mocks.stateOverviewStartPolling,
      mocks.stateOverviewStopPolling,
      mocks.sdkLoadSessions,
      mocks.sdkSelectSession,
      mocks.localLoadSessions,
      mocks.localSelectSession,
      mocks.setPlanTitleDraft,
      mocks.setPlanContentDraft,
      mocks.loadLinkedPlan,
      mocks.savePlanDraft,
      mocks.goToRuntime,
    ].forEach((mock) => mock.mockReset());

    mocks.setIntakeCategoryFilter.mockImplementation((category: string) => {
      const state = mocks.planningWorkspaceStore.getState();
      mocks.planningWorkspaceStore.setState({
        ...state,
        intakeFilters: {
          ...state.intakeFilters,
          category,
        },
      });
    });
    mocks.setIntakePlanningStateFilter.mockImplementation((planningState: string) => {
      const state = mocks.planningWorkspaceStore.getState();
      mocks.planningWorkspaceStore.setState({
        ...state,
        intakeFilters: {
          ...state.intakeFilters,
          planningState,
        },
      });
    });
    mocks.setIntakeTargetFilter.mockImplementation((targetRepoId: string) => {
      const state = mocks.planningWorkspaceStore.getState();
      mocks.planningWorkspaceStore.setState({
        ...state,
        intakeFilters: {
          ...state.intakeFilters,
          targetRepoId,
        },
      });
    });
    mocks.clearIntakeFilters.mockImplementation(() => {
      const state = mocks.planningWorkspaceStore.getState();
      mocks.planningWorkspaceStore.setState({
        ...state,
        intakeFilters: {
          category: '__all__',
          planningState: '__all__',
          targetRepoId: '__all__',
        },
      });
    });

    mocks.planningStore.setState({
      userId: '',
      repoId: 'repo-1',
      catalogRepoContext: {
        repoId: 'repo-1',
        repoPath: 'C:\\Repos\\instruction-engine',
        repoLabel: 'Instruction Engine',
        sources: ['workspace', 'selected'],
      },
      planningIntakeDirectory: null,
      repositoryBacklog: null,
      roadmapDirectory: null,
      query: '',
      sessionId: '',
      scopeUser: true,
      scopeRepo: true,
      scopeGlobal: false,
      draftIdeas: [],
      records: [
        {
          recordId: 'planning-1',
          scope: 'repo',
          repoId: 'repo-1',
          title: 'Backlog follow-up',
          state: 'thought',
        },
      ],
      deniedScopes: [],
      searchResults: [],
      createScope: 'repo',
      createState: 'thought',
      createTitle: '',
      createSummary: '',
      createAcceptanceCriteria: '',
      ideaDraft: '',
      ideaTargetRepos: '',
      selectedIdeaIds: [],
      updatingRecordId: null,
      savingIdeaId: null,
      compiling: false,
      linkedPlanSession: {
        sessionId: 'plan-123',
        planPath: 'C:\\Users\\Dylan\\.copilot\\session-state\\plan-123\\plan.md',
        repoId: 'repo-1',
        source: 'seed-from-intake',
        createdAt: '2026-03-18T00:25:00.000Z',
        updatedAt: '2026-03-18T00:30:00.000Z',
        seedArtifactId: 'PI-001',
        seedArtifactCategory: 'idea',
        seedArtifactTitle: 'Capture planning intake',
      },
      linkedSdkSession: {
        sessionId: 'sdk-123',
        repoId: 'repo-1',
        source: 'compile-selected-ideas',
        createdAt: '2026-03-18T00:30:00.000Z',
        selectedIdeaIds: ['draft-1'],
        selectedIdeaTitles: ['Capture planning intake'],
        targetRepoIds: ['repo-1'],
        promptPreview: 'Create a repo-targeted implementation plan from the following planning ideas.',
      },
      planTitleDraft: 'Instruction Engine follow-up plan',
      planContentDraft: '# Instruction Engine follow-up plan\n\n## Problem\n\nClose the remaining planning UX gaps.\n',
      planLoading: false,
      planSaving: false,
      planError: null,
      selectedRecordId: 'planning-1',
      researchNotes: [],
      diagrams: [],
      selectedDiagramId: '',
      artifactsLoading: false,
      artifactsSaving: false,
      artifactsDeleting: false,
      artifactsError: null,
      compareResponse: null,
      gateState: 'pass',
      gateReason: 'ready',
      conflictRows: [],
      reviewedConflictKeys: [],
      mergeTargetId: '',
      intentToken: null,
      policyPreflight: null,
      mutatingBlocked: false,
      mutatingReason: '',
      loading: false,
      listing: false,
      searching: false,
      comparing: false,
      creating: false,
      preparingIntent: false,
      merging: false,
      preflightLoading: false,
      error: null,
      statusMessage: null,
    });
    mocks.planningWorkspaceStore.setState({
      catalogRepoContext: {
        repoId: 'repo-1',
        repoPath: 'C:\\Repos\\instruction-engine',
        repoLabel: 'Instruction Engine',
        sources: ['workspace'],
      },
      planningBulletsFile: {
        filePath: 'C:\\Repos\\instruction-engine\\docs\\planning\\bullets.md',
        repoRelativePath: 'docs/planning/bullets.md',
        stableIdPattern: 'PB-###',
        supportedStates: ['idea', 'research', 'pre-plan'],
      },
      bulletsSummary: {
        filePath: 'C:\\Repos\\instruction-engine\\docs\\planning\\bullets.md',
        repoRelativePath: 'docs/planning/bullets.md',
        exists: true,
        bulletCount: 1,
        stableIdPattern: 'PB-###',
        supportedStates: ['idea', 'research', 'pre-plan'],
      },
      bullets: [
        {
          id: 'PB-001',
          title: 'Clarify roadmap hierarchy',
          state: 'idea',
          repoId: 'repo-1',
          summary: 'Explain roadmap above backlog above plans.',
          notes: ['Keep bullets browse-first'],
          promotedPlanRefs: ['plan-123'],
          promotedBacklogRefs: [],
        },
      ],
      planningIntakeDirectory: {
        canonicalName: 'Planning Intake',
        repo: {
          repoId: 'repo-1',
          repoPath: 'C:\\Repos\\instruction-engine',
          repoLabel: 'Instruction Engine',
        },
        directoryPath: 'C:\\Repos\\instruction-engine\\docs\\planning\\intake',
        repoRelativePath: 'docs/planning/intake',
        stableIdPattern: 'PI-###',
        supportedCategories: ['idea', 'research', 'refactor-candidate', 'design-complaint', 'audit-request', 'roadmap-request', 'review-prep', 'commit-prep'],
      },
      intakeSummary: {
        directoryPath: 'C:\\Repos\\instruction-engine\\docs\\planning\\intake',
        repoRelativePath: 'docs/planning/intake',
        exists: true,
        artifactCount: 3,
        stableIdPattern: 'PI-###',
        supportedCategories: ['idea', 'research', 'refactor-candidate', 'design-complaint', 'audit-request', 'roadmap-request', 'review-prep', 'commit-prep'],
      },
      intakeArtifacts: [
        {
          kind: 'planning.intake.artifact',
          schemaVersion: 1,
          id: 'PI-001',
          category: 'idea',
          title: 'Capture planning intake',
          summary: 'Persist unscheduled tracked work.',
          acceptanceCriteria: ['Write tests'],
          targetRepoIds: ['repo-1'],
          planningState: 'thought',
          createdAt: '2026-03-18T00:00:00.000Z',
          updatedAt: '2026-03-18T00:00:00.000Z',
          filePath: 'C:\\Repos\\instruction-engine\\docs\\planning\\intake\\PI-001.json',
          repoRelativePath: 'docs/planning/intake/PI-001.json',
        },
        {
          kind: 'planning.intake.artifact',
          schemaVersion: 1,
          id: 'PI-002',
          category: 'research',
          title: 'Validate tracker grouping',
          summary: 'Check grouped intake readability.',
          acceptanceCriteria: ['Add summary cards'],
          targetRepoIds: ['repo-2'],
          planningState: 'ready',
          createdAt: '2026-03-18T00:00:00.000Z',
          updatedAt: '2026-03-18T00:00:00.000Z',
          filePath: 'C:\\Repos\\instruction-engine\\docs\\planning\\intake\\PI-002.json',
          repoRelativePath: 'docs/planning/intake/PI-002.json',
        },
        {
          kind: 'planning.intake.artifact',
          schemaVersion: 1,
          id: 'PI-003',
          category: 'idea',
          title: 'Triage unscoped follow-up',
          summary: 'Keep unscoped work visible.',
          acceptanceCriteria: ['Show unscoped target state'],
          targetRepoIds: [],
          createdAt: '2026-03-18T00:00:00.000Z',
          updatedAt: '2026-03-18T00:00:00.000Z',
          filePath: 'C:\\Repos\\instruction-engine\\docs\\planning\\intake\\PI-003.json',
          repoRelativePath: 'docs/planning/intake/PI-003.json',
        },
      ],
      intakeFilters: {
        category: '__all__',
        planningState: '__all__',
        targetRepoId: '__all__',
      },
      repositoryBacklog: {
        canonicalName: 'Repository Backlog',
        repo: {
          repoId: 'repo-1',
          repoPath: 'C:\\Repos\\instruction-engine',
          repoLabel: 'Instruction Engine',
        },
        filePath: 'C:\\Repos\\instruction-engine\\docs\\backlog.md',
        repoRelativePath: 'docs/backlog.md',
        stableIdPattern: 'RB-###',
      },
      backlogSummary: {
        filePath: 'C:\\Repos\\instruction-engine\\docs\\backlog.md',
        repoRelativePath: 'docs/backlog.md',
        stableIdPattern: 'RB-###',
        description: 'Repo-scoped intake and queued work for the selected repo.',
        items: [
          {
            id: 'RB-001',
            title: 'Establish backlog/roadmap workflow',
            status: 'proposed',
            summary: 'Keep backlog authority explicit in Planning.',
            roadmapIds: ['RM-platform-foundation-001'],
            planRefs: ['plan-123'],
          },
        ],
      },
      roadmapDirectory: {
        canonicalName: 'Roadmap',
        repo: {
          repoId: 'repo-1',
          repoPath: 'C:\\Repos\\instruction-engine',
          repoLabel: 'Instruction Engine',
        },
        directoryPath: 'C:\\Repos\\instruction-engine\\docs\\roadmaps',
        repoRelativePath: 'docs/roadmaps',
        stableIdPattern: 'RM-<roadmap-slug>-###',
      },
      roadmaps: [
        {
          slug: 'platform-foundation',
          title: 'Platform Foundation',
          overview: 'Stage repo work into phased outcomes.',
          filePath: 'C:\\Repos\\instruction-engine\\docs\\roadmaps\\platform-foundation.md',
          repoRelativePath: 'docs/roadmaps/platform-foundation.md',
          itemCount: 1,
          statusCounts: { queued: 1 },
          items: [
            {
              id: 'RM-platform-foundation-001',
              title: 'Establish backlog/roadmap workflow',
              phase: 'foundation',
              status: 'queued',
              backlogIds: ['RB-001'],
              planRefs: [],
            },
          ],
        },
      ],
      selectedRoadmapSlug: 'platform-foundation',
      obsidianStatus: {
        state: 'ready',
        configured: true,
        readAvailable: true,
        syncAvailable: false,
        external: true,
        canonicalAuthority: false,
        message: 'External Obsidian notes are available.',
        notesDirectoryPath: 'C:\\Vault\\Planning\\repo-1',
      },
      obsidianNotes: [
        {
          kind: 'synced-note',
          provider: 'obsidian',
          id: 'obsnote_1234',
          title: 'External planning note',
          summary: 'Review external planning context.',
          repoId: 'repo-1',
          targetRepoIds: ['repo-1'],
          vaultName: 'Planning',
          notePath: 'Planning/repo-1/external-planning-note.md',
          filePath: 'C:\\Vault\\Planning\\repo-1\\external-planning-note.md',
          lastModifiedAt: '2026-03-23T00:00:00.000Z',
          external: true,
          canonicalAuthority: false,
        },
      ],
      obsidianRepresentationsStatus: {
        totalCount: 2,
        writeAvailable: true,
        currentCount: 1,
        staleCount: 1,
        missingCount: 0,
        invalidCount: 0,
        sourceMissingCount: 0,
        message: 'Deterministic Obsidian planning mirrors are available for generation and freshness checks.',
      },
      obsidianRepresentations: [
        {
          kind: 'planning-representation',
          provider: 'obsidian',
          id: 'obsrep_bullets',
          representationKind: 'bullets',
          title: 'Planning Bullets Mirror',
          summary: 'Deterministic Obsidian mirror of docs/planning/bullets.md.',
          repoId: 'repo-1',
          targetRepoIds: ['repo-1'],
          sourceExists: true,
          sourceRepoRelativePath: 'docs/planning/bullets.md',
          notePath: 'Planning/repo-1/_instruction-engine/planning-mirrors/bullets.md',
          noteExists: true,
          freshness: 'current',
          metadataValid: true,
          external: true,
          canonicalAuthority: false,
          message: 'Mirror matches the current canonical repo artifact.',
        },
        {
          kind: 'planning-representation',
          provider: 'obsidian',
          id: 'obsrep_roadmap',
          representationKind: 'roadmap',
          title: 'Roadmap Mirror — Platform Foundation',
          summary: 'Deterministic Obsidian mirror of docs/roadmaps/platform-foundation.md.',
          repoId: 'repo-1',
          targetRepoIds: ['repo-1'],
          roadmapSlug: 'platform-foundation',
          sourceExists: true,
          sourceRepoRelativePath: 'docs/roadmaps/platform-foundation.md',
          notePath: 'Planning/repo-1/_instruction-engine/planning-mirrors/roadmaps/platform-foundation.md',
          noteExists: true,
          freshness: 'stale',
          metadataValid: true,
          external: true,
          canonicalAuthority: false,
          message: 'Canonical repo artifact changed since the mirror was generated.',
        },
      ],
      selectedObsidianNoteId: 'obsnote_1234',
      selectedObsidianNote: {
        kind: 'synced-note',
        provider: 'obsidian',
        id: 'obsnote_1234',
        title: 'External planning note',
        summary: 'Review external planning context.',
        repoId: 'repo-1',
        targetRepoIds: ['repo-1'],
        vaultName: 'Planning',
        notePath: 'Planning/repo-1/external-planning-note.md',
        filePath: 'C:\\Vault\\Planning\\repo-1\\external-planning-note.md',
        lastModifiedAt: '2026-03-23T00:00:00.000Z',
        external: true,
        canonicalAuthority: false,
        content: '# External planning note\n\nReview external planning context.',
        headings: ['External planning note'],
      },
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
    });
    mocks.catalogWorkspaceStore.setState({
      loading: false,
      refreshing: false,
      repoInventoryLoading: false,
      activeRepoPath: 'C:\\Repos\\instruction-engine',
      activeRepoId: 'repo-1',
      repoInventory: {
        repos: [
          {
            repoId: 'repo-1',
            repoPath: 'C:\\Repos\\instruction-engine',
            repoLabel: 'Instruction Engine',
            sources: ['workspace', 'selected'],
            lastRefreshAt: '2026-03-14T12:00:00.000Z',
            hints: {
              languages: ['TypeScript'],
              frameworks: ['React'],
              targets: ['frontend'],
            },
          },
        ],
        selectedRepo: {
          repoId: 'repo-1',
          repoPath: 'C:\\Repos\\instruction-engine',
          repoLabel: 'Instruction Engine',
          sources: ['workspace', 'selected'],
          lastRefreshAt: '2026-03-14T12:00:00.000Z',
          hints: {
            languages: ['TypeScript'],
            frameworks: ['React'],
            targets: ['frontend'],
          },
        },
      },
    });
    mocks.sdkHealthStore.setState({
      health: {
        connected: true,
        state: 'connected',
        sessionCount: 1,
      },
      loading: false,
      error: null,
      lastUpdatedAtMs: 1,
    });
    mocks.stateOverviewStore.setState({
      health: {
        planningPersistence: {
          status: 'ready',
          configured: true,
          usable: true,
          required: true,
          governance: {
            code: 'ready',
            reason: 'ready',
          },
          migrations: {
            appliedAt: '2026-03-18T00:00:00.000Z',
          },
        },
        planningDurabilityDependencyGate: {
          ready: true,
        },
      },
      gatewayState: null,
      catalogHealth: null,
      loading: false,
      error: null,
      lastUpdatedAtMs: 1,
    });
    mocks.sdkSessionsStore.setState({
      sessions: [
        {
          sessionId: 'sdk-123',
          model: 'gpt-4.1',
          cwd: 'C:\\Repos\\instruction-engine',
        },
      ],
      selectedSessionId: 'sdk-123',
      messagesBySession: {},
      pendingBySession: {},
      loading: false,
      creating: false,
      deleting: false,
      sending: false,
      streamStatus: 'connected',
      streamError: null,
      composerPrompt: '',
      error: null,
    });
    mocks.sdkLoadSessions.mockResolvedValue(undefined);
    mocks.localLoadSessions.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('prioritizes intake, backlog, and roadmap surfaces from Catalog repo context and demotes legacy notes', async () => {
    const { default: PlanningView } = await import('../ui/src/tabs/Planning/PlanningView');

    render(<PlanningView />);

    expect(screen.getByText('Planning')).toBeInTheDocument();
    expect(screen.getByTestId('planning-plan-authoring-panel')).toHaveTextContent('Create / Edit Plan');
    expect(screen.getByTestId('planning-plan-authoring-panel')).toHaveTextContent('plan-123');
    expect(screen.getByTestId('planning-plan-authoring-panel')).toHaveTextContent('Seeded from');
    expect(screen.getByTestId('planning-linked-plan-file-path')).toHaveTextContent(
      'C:\\Users\\Dylan\\.copilot\\session-state\\plan-123\\plan.md'
    );
    expect(screen.getByTestId('planning-context-summary')).toHaveTextContent('Instruction Engine');
    expect(screen.getByTestId('planning-context-summary')).toHaveTextContent('repo-1');
    expect(screen.getByTestId('planning-context-summary')).toHaveTextContent('Bullets');
    expect(screen.getByTestId('planning-context-summary')).toHaveTextContent('Typed intake');
    expect(screen.getByTestId('planning-persistence-panel')).toHaveTextContent('Planning database ready');
    expect(screen.queryByTestId('research-notes-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('planning-obsidian-notes-panel')).toBeInTheDocument();
    expect(screen.getByTestId('planning-sdk-lane-panel')).toHaveTextContent('Planning ↔ SDK Lane');
    expect(screen.getByTestId('planning-sdk-lane-panel')).toHaveTextContent('sdk-123');
    expect(screen.getByTestId('planning-sdk-lane-panel')).toHaveTextContent('Capture planning intake');
    expect(mocks.applyCatalogRepoContext).toHaveBeenCalled();
    expect(mocks.syncCatalogRepoContext).toHaveBeenCalled();
    expect(mocks.loadWorkspaceBullets).toHaveBeenCalled();
    expect(mocks.loadWorkspaceIntake).toHaveBeenCalled();
    expect(mocks.loadWorkspaceBacklog).toHaveBeenCalled();
    expect(mocks.loadWorkspaceRoadmaps).toHaveBeenCalled();
    expect(mocks.loadObsidianNotes).toHaveBeenCalled();
    expect(mocks.loadObsidianRepresentations).toHaveBeenCalled();
    expect(mocks.sdkHealthStartPolling).toHaveBeenCalled();
    expect(mocks.stateOverviewStartPolling).toHaveBeenCalled();
    expect(mocks.sdkLoadSessions).toHaveBeenCalledWith({
      attachStream: false,
      preserveSelection: true,
      selectSessionId: 'sdk-123',
    });

    const bulletsLoadCount = mocks.loadWorkspaceBullets.mock.calls.length;
    const intakeLoadCount = mocks.loadWorkspaceIntake.mock.calls.length;
    const backlogLoadCount = mocks.loadWorkspaceBacklog.mock.calls.length;
    const roadmapLoadCount = mocks.loadWorkspaceRoadmaps.mock.calls.length;
    const obsidianLoadCount = mocks.loadObsidianNotes.mock.calls.length;
    const obsidianRepresentationLoadCount = mocks.loadObsidianRepresentations.mock.calls.length;
    fireEvent.click(screen.getByTestId('planning-refresh-context'));
    expect(mocks.loadWorkspaceBullets.mock.calls.length).toBeGreaterThan(bulletsLoadCount);
    expect(mocks.loadWorkspaceIntake.mock.calls.length).toBeGreaterThan(intakeLoadCount);
    expect(mocks.loadWorkspaceBacklog.mock.calls.length).toBeGreaterThan(backlogLoadCount);
    expect(mocks.loadWorkspaceRoadmaps.mock.calls.length).toBeGreaterThan(roadmapLoadCount);
    expect(mocks.loadObsidianNotes.mock.calls.length).toBeGreaterThan(obsidianLoadCount);
    expect(mocks.loadObsidianRepresentations.mock.calls.length).toBeGreaterThan(obsidianRepresentationLoadCount);
    expect(mocks.stateOverviewRefresh).toHaveBeenCalled();
    expect(mocks.sdkHealthRefresh).toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('planning-section-bullets'));
    expect(screen.getByTestId('mock-planning-ideas-panel')).toBeInTheDocument();
    expect(screen.getByTestId('planning-bullets-surface-panel')).toHaveTextContent('C:\\Repos\\instruction-engine\\docs\\planning\\bullets.md');
    expect(screen.getByTestId('planning-bullets-surface-file-open')).toBeInTheDocument();
    expect(screen.getByTestId('planning-bullets-list')).toHaveTextContent('PB-001');
    expect(screen.getByTestId('planning-intake-surface-panel')).toHaveTextContent('C:\\Repos\\instruction-engine\\docs\\planning\\intake');
    expect(screen.getByTestId('planning-intake-summary-grid')).toHaveTextContent('Visible intake artifacts');
    expect(screen.getByTestId('planning-intake-summary-grid')).toHaveTextContent('Idea (2)');
    expect(screen.getByTestId('planning-intake-summary-grid')).toHaveTextContent('Research (1)');
    expect(screen.getByTestId('planning-intake-summary-grid')).toHaveTextContent('Thought (1)');
    expect(screen.getByTestId('planning-intake-summary-grid')).toHaveTextContent('Ready (1)');
    expect(screen.getByTestId('planning-intake-summary-grid')).toHaveTextContent('Unscoped (1)');
    expect(screen.getByTestId('planning-intake-grouped-list')).toHaveTextContent('Capture planning intake');
    expect(screen.getByTestId('planning-intake-grouped-list')).toHaveTextContent('Validate tracker grouping');
    expect(screen.getByTestId('planning-intake-grouped-list')).toHaveTextContent('Triage unscoped follow-up');

    fireEvent.click(screen.getByTestId('planning-section-backlog'));
    expect(screen.getByTestId('planning-backlog-surface-panel')).toHaveTextContent('C:\\Repos\\instruction-engine\\docs\\backlog.md');
    expect(screen.getByTestId('planning-backlog-surface-file-open')).toBeInTheDocument();
    expect(screen.getByTestId('planning-repo-id-readonly')).toHaveValue('repo-1');
    expect(screen.getByTestId('planning-backlog-list')).toHaveTextContent('RB-001');

    fireEvent.click(screen.getByTestId('planning-section-roadmaps'));
    expect(screen.getByTestId('planning-roadmap-surface-panel')).toHaveTextContent('C:\\Repos\\instruction-engine\\docs\\roadmaps');
    expect(screen.getByTestId('planning-roadmap-surface-directory-open')).toBeInTheDocument();
    expect(screen.getByTestId('planning-roadmap-list')).toHaveTextContent('Platform Foundation');
    expect(screen.getByTestId('planning-roadmap-detail')).toHaveTextContent('RM-platform-foundation-001');

    fireEvent.change(screen.getByTestId('planning-roadmap-select'), {
      target: { value: 'platform-foundation' },
    });
    expect(mocks.setSelectedRoadmapSlug).toHaveBeenCalledWith('platform-foundation');

    fireEvent.click(screen.getByTestId('planning-section-plans'));
    fireEvent.click(screen.getByTestId('planning-show-legacy-artifacts'));
    expect(screen.getByTestId('research-notes-panel')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('planning-open-catalog'));
    expect(mocks.goToCatalog).toHaveBeenCalledWith('assets');
  });

  it('saves direct plans and can reopen the linked local session from Planning', async () => {
    const { default: PlanningView } = await import('../ui/src/tabs/Planning/PlanningView');

    render(<PlanningView />);

    fireEvent.change(screen.getByTestId('planning-plan-title'), {
      target: { value: 'Direct plan title' },
    });
    expect(mocks.setPlanTitleDraft).toHaveBeenCalledWith('Direct plan title');

    fireEvent.change(screen.getByTestId('planning-plan-content'), {
      target: { value: '# Direct plan title\n\n## Problem\n\nAuthor the plan in UI.\n' },
    });
    expect(mocks.setPlanContentDraft).toHaveBeenCalledWith('# Direct plan title\n\n## Problem\n\nAuthor the plan in UI.\n');

    fireEvent.click(screen.getByTestId('planning-save-plan'));
    expect(mocks.savePlanDraft).toHaveBeenCalledWith({
      title: 'Instruction Engine follow-up plan',
      content: '# Instruction Engine follow-up plan\n\n## Problem\n\nClose the remaining planning UX gaps.\n',
    });

    fireEvent.click(screen.getByTestId('planning-open-linked-plan-session'));
    await waitFor(() => expect(mocks.localLoadSessions).toHaveBeenCalled());
    expect(mocks.localSelectSession).toHaveBeenCalledWith('plan-123');
    expect(mocks.goToRuntime).toHaveBeenCalledWith('sessions', { sessionsMode: 'local' });
  });

  it('seeds plans from intake artifacts and exposes shared database diagnostics', async () => {
    const { default: PlanningView } = await import('../ui/src/tabs/Planning/PlanningView');

    render(<PlanningView />);

    fireEvent.change(screen.getByTestId('planning-plan-seed'), {
      target: { value: 'PI-001' },
    });
    fireEvent.click(screen.getByTestId('planning-seed-plan'));

    expect(mocks.savePlanDraft).toHaveBeenCalledWith({
      title: 'Instruction Engine follow-up plan',
      seedArtifact: {
        id: 'PI-001',
        category: 'idea',
        title: 'Capture planning intake',
        kind: 'planning.intake.artifact',
        schemaVersion: 1,
        summary: 'Persist unscheduled tracked work.',
        acceptanceCriteria: ['Write tests'],
        targetRepoIds: ['repo-1'],
        planningState: 'thought',
        createdAt: '2026-03-18T00:00:00.000Z',
        updatedAt: '2026-03-18T00:00:00.000Z',
        filePath: 'C:\\Repos\\instruction-engine\\docs\\planning\\intake\\PI-001.json',
        repoRelativePath: 'docs/planning/intake/PI-001.json',
      },
    });

    fireEvent.click(screen.getByTestId('planning-open-database-diagnostics'));
    expect(mocks.goToRuntime).toHaveBeenCalledWith('diagnostics', { diagnosticsSectionId: 'database' });
  });

  it('reopens the linked SDK session from Planning', async () => {
    const onSdkSessionReady = vi.fn();
    const { default: PlanningView } = await import('../ui/src/tabs/Planning/PlanningView');

    render(<PlanningView onSdkSessionReady={onSdkSessionReady} />);

    fireEvent.click(screen.getByTestId('planning-sdk-open-linked-session'));

    await waitFor(() => expect(mocks.sdkLoadSessions).toHaveBeenCalledWith({ selectSessionId: 'sdk-123' }));
    expect(mocks.sdkSelectSession).toHaveBeenCalledWith('sdk-123');
    expect(onSdkSessionReady).toHaveBeenCalledWith('sdk-123');

    fireEvent.click(screen.getByTestId('planning-sdk-refresh-link'));
    expect(mocks.sdkHealthRefresh).toHaveBeenCalled();
  });

  it('bootstraps known repos when Planning opens before Catalog inventory has loaded', async () => {
    mocks.catalogWorkspaceStore.setState({
      loading: false,
      refreshing: false,
      repoInventoryLoading: false,
      activeRepoPath: '',
      activeRepoId: '',
      repoInventory: null,
    });

    const { default: PlanningView } = await import('../ui/src/tabs/Planning/PlanningView');

    render(<PlanningView />);

    await waitFor(() => expect(mocks.loadWorkspace).toHaveBeenCalled());
  });

  it('filters intake artifacts by category, state, and target without leaving the planning tracker', async () => {
    const { default: PlanningView } = await import('../ui/src/tabs/Planning/PlanningView');

    render(<PlanningView />);

    fireEvent.click(screen.getByTestId('planning-section-bullets'));

    fireEvent.change(screen.getByTestId('planning-intake-category-filter'), {
      target: { value: 'research' },
    });
    expect(mocks.setIntakeCategoryFilter).toHaveBeenCalledWith('research');
    expect(screen.getByTestId('planning-intake-grouped-list')).toHaveTextContent('Validate tracker grouping');
    expect(screen.queryByText('Capture planning intake')).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('planning-intake-state-filter'), {
      target: { value: 'ready' },
    });
    expect(mocks.setIntakePlanningStateFilter).toHaveBeenCalledWith('ready');
    expect(screen.getByText('Showing 1 of 3 intake artifacts.')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('planning-intake-target-filter'), {
      target: { value: 'repo-2' },
    });
    expect(mocks.setIntakeTargetFilter).toHaveBeenCalledWith('repo-2');
    expect(screen.getByTestId('planning-intake-grouped-list')).toHaveTextContent('targets: repo-2');

    fireEvent.click(screen.getByTestId('planning-intake-clear-filters'));
    expect(mocks.clearIntakeFilters).toHaveBeenCalled();
    expect(screen.getByTestId('planning-intake-grouped-list')).toHaveTextContent('Capture planning intake');
    expect(screen.getByTestId('planning-intake-grouped-list')).toHaveTextContent('Triage unscoped follow-up');
  });

  it('keeps draft intake available even when no Catalog repo is currently selected', async () => {
    const planningState = mocks.planningStore.getState();
    mocks.planningStore.setState({
      ...planningState,
      linkedSdkSession: null,
    });
    mocks.catalogWorkspaceStore.setState({
      loading: false,
      refreshing: false,
      repoInventoryLoading: false,
      activeRepoPath: '',
      activeRepoId: '',
      repoInventory: {
        repos: [
          {
            repoId: 'repo-1',
            repoPath: 'C:\\Repos\\instruction-engine',
            repoLabel: 'Instruction Engine',
            sources: ['workspace'],
          },
        ],
        selectedRepo: null,
      },
    });
    mocks.planningWorkspaceStore.setState({
      catalogRepoContext: null,
      planningBulletsFile: null,
      bulletsSummary: null,
      bullets: [],
      planningIntakeDirectory: null,
      intakeSummary: null,
      intakeArtifacts: [],
      intakeFilters: {
        category: '__all__',
        planningState: '__all__',
        targetRepoId: '__all__',
      },
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
    });

    const { default: PlanningView } = await import('../ui/src/tabs/Planning/PlanningView');

    render(<PlanningView />);

    fireEvent.click(screen.getByTestId('planning-section-bullets'));

    expect(screen.getByTestId('mock-planning-ideas-panel')).toBeInTheDocument();
    expect(screen.getByTestId('planning-context-summary')).toHaveTextContent('Select a Catalog repo');
    expect(screen.getByTestId('planning-refresh-context')).toBeDisabled();
    expect(screen.getAllByText('Select a repository in Catalog to resolve bullet, intake, backlog, and roadmap surfaces.').length).toBeGreaterThan(0);
    expect(mocks.applyCatalogRepoContext).toHaveBeenCalledWith(null);
    expect(mocks.loadWorkspaceBullets).not.toHaveBeenCalled();
    expect(mocks.loadWorkspaceIntake).not.toHaveBeenCalled();
    expect(mocks.loadWorkspaceBacklog).not.toHaveBeenCalled();
    expect(mocks.loadWorkspaceRoadmaps).not.toHaveBeenCalled();
  });
});
