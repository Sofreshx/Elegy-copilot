import { fireEvent, render, screen } from '@testing-library/react';
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
    query: '',
    sessionId: '',
    scopeUser: true,
    scopeRepo: true,
    scopeGlobal: false,
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
    compiling: false,
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
    loading: false,
    error: null,
  });

  const catalogWorkspaceStore = createMockStore({
    loading: false,
    refreshing: false,
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

  return {
    planningStore,
    planningWorkspaceStore,
    catalogWorkspaceStore,
    loadInitial: vi.fn(),
    refreshPolicyPreflight: vi.fn(),
    listRecords: vi.fn(),
    applyCatalogRepoContext: vi.fn(),
    loadWorkspaceRoadmaps: vi.fn(),
    syncCatalogRepoContext: vi.fn(),
    setSelectedRoadmapSlug: vi.fn(),
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
    goToCatalog: vi.fn(),
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
  },
  hasReviewedAllPlanningConflicts: () => true,
  planningGateAllowsMerge: () => true,
  isIdeaRecord: (record: { state?: string }) => record.state === 'thought',
}));

vi.mock('../ui/src/tabs/Planning/planningWorkspaceStore', () => ({
  planningWorkspaceStore: {
    ...mocks.planningWorkspaceStore,
    loadRoadmaps: mocks.loadWorkspaceRoadmaps,
    syncCatalogRepoContext: mocks.syncCatalogRepoContext,
    setSelectedRoadmapSlug: mocks.setSelectedRoadmapSlug,
  },
}));

vi.mock('../ui/src/tabs/Assets/catalogWorkspaceStore', () => ({
  catalogWorkspaceStore: {
    ...mocks.catalogWorkspaceStore,
    loadWorkspace: mocks.loadWorkspace,
    refreshRepo: mocks.refreshRepo,
  },
}));

vi.mock('../ui/src/stores/navigation', () => ({
  navigationStore: {
    goToCatalog: mocks.goToCatalog,
  },
}));

vi.mock('../ui/src/tabs/Planning/PlanningIdeasPanel', () => ({
  default: () => <div data-testid="mock-planning-ideas-panel">Ideas panel</div>,
}));

vi.mock('../ui/src/tabs/Planning/ResearchNotesPanel', () => ({
  default: () => <div data-testid="research-notes-panel">Research notes</div>,
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
      mocks.loadWorkspaceRoadmaps,
      mocks.syncCatalogRepoContext,
      mocks.setSelectedRoadmapSlug,
      mocks.loadWorkspace,
      mocks.refreshRepo,
      mocks.goToCatalog,
    ].forEach((mock) => mock.mockReset());
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('prioritizes backlog and roadmap surfaces from Catalog repo context and demotes legacy notes', async () => {
    const { default: PlanningView } = await import('../ui/src/tabs/Planning/PlanningView');

    render(<PlanningView />);

    expect(screen.getByText('Repository Backlog + Roadmaps')).toBeInTheDocument();
    expect(screen.getByTestId('planning-backlog-surface-panel')).toHaveTextContent('C:\\Repos\\instruction-engine\\docs\\backlog.md');
    expect(screen.getByTestId('planning-roadmap-surface-panel')).toHaveTextContent('C:\\Repos\\instruction-engine\\docs\\roadmaps');
    expect(screen.getByTestId('planning-roadmap-list')).toHaveTextContent('Platform Foundation');
    expect(screen.getByTestId('planning-roadmap-detail')).toHaveTextContent('RM-platform-foundation-001');
    expect(screen.getByTestId('planning-repo-id-readonly')).toHaveValue('repo-1');
    expect(screen.queryByTestId('research-notes-panel')).not.toBeInTheDocument();
    expect(mocks.syncCatalogRepoContext).toHaveBeenCalled();
    expect(mocks.loadWorkspaceRoadmaps).toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('planning-roadmap-select'), {
      target: { value: 'platform-foundation' },
    });
    expect(mocks.setSelectedRoadmapSlug).toHaveBeenCalledWith('platform-foundation');

    fireEvent.click(screen.getByTestId('planning-show-legacy-artifacts'));
    expect(screen.getByTestId('research-notes-panel')).toBeInTheDocument();
  });
});
