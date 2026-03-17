import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
  createPlanningBacklogItem: vi.fn(),
  comparePlanningRecords: vi.fn(),
  createPlanningRecord: vi.fn(),
  createSdkSession: vi.fn(),
  deletePlanningResearchNote: vi.fn(),
  getPlanningDiagrams: vi.fn(),
  getPlanningRecords: vi.fn(),
  getPlanningResearchNotes: vi.fn(),
  getPolicyPreflight: vi.fn(),
  mergePlanningRecords: vi.fn(),
  preparePlanningMergeIntent: vi.fn(),
  savePlanningResearchNote: vi.fn(),
  searchPlanningRecords: vi.fn(),
  sendSdkMessage: vi.fn(),
}));

const sdkMocks = vi.hoisted(() => ({
  loadSessions: vi.fn(),
  selectSession: vi.fn(),
}));

vi.mock('../ui/src/lib/api', async () => {
  const actual = await vi.importActual<typeof import('../ui/src/lib/api')>('../ui/src/lib/api');
  return {
    ...actual,
    createPlanningBacklogItem: apiMocks.createPlanningBacklogItem,
    comparePlanningRecords: apiMocks.comparePlanningRecords,
    createPlanningRecord: apiMocks.createPlanningRecord,
    createSdkSession: apiMocks.createSdkSession,
    deletePlanningResearchNote: apiMocks.deletePlanningResearchNote,
    getPlanningDiagrams: apiMocks.getPlanningDiagrams,
    getPlanningRecords: apiMocks.getPlanningRecords,
    getPlanningResearchNotes: apiMocks.getPlanningResearchNotes,
    getPolicyPreflight: apiMocks.getPolicyPreflight,
    mergePlanningRecords: apiMocks.mergePlanningRecords,
    preparePlanningMergeIntent: apiMocks.preparePlanningMergeIntent,
    savePlanningResearchNote: apiMocks.savePlanningResearchNote,
    searchPlanningRecords: apiMocks.searchPlanningRecords,
    sendSdkMessage: apiMocks.sendSdkMessage,
  };
});

vi.mock('../ui/src/tabs/Sessions/sdkSessionsStore', () => ({
  sdkSessionsStore: {
    loadSessions: sdkMocks.loadSessions,
    selectSession: sdkMocks.selectSession,
  },
}));

import { createPlanningStore } from '../ui/src/tabs/Planning/planningStore';

describe('planningStore catalog repo context', () => {
  beforeEach(() => {
    Object.values(apiMocks).forEach((mock) => mock.mockReset());
    sdkMocks.loadSessions.mockReset();
    sdkMocks.selectSession.mockReset();
    apiMocks.createPlanningBacklogItem.mockResolvedValue({
      kind: 'planning.backlog.create',
      deterministic: true,
      repo: {
        repoId: 'repo-1',
        repoPath: 'C:\\Repos\\instruction-engine',
        repoLabel: 'Instruction Engine',
      },
      backlog: {
        exists: true,
        itemCount: 1,
        items: [
          {
            id: 'RB-001',
            title: 'Draft title',
            status: 'proposed',
            summary: 'Draft summary',
            roadmapIds: [],
            planRefs: [],
            keyPoints: [],
          },
        ],
      },
      item: {
        id: 'RB-001',
        title: 'Draft title',
        status: 'proposed',
        summary: 'Draft summary',
        roadmapIds: [],
        planRefs: [],
        keyPoints: [],
      },
    });
  });

  it('applies Catalog repo context and aligns repo-scoped planning capture', () => {
    const store = createPlanningStore();

    store.applyCatalogRepoContext({
      repoId: 'repo-1',
      repoPath: 'C:\\Repos\\instruction-engine',
      repoLabel: 'Instruction Engine',
      sources: ['workspace', 'selected'],
    });

    const state = store.getState();
    expect(state.catalogRepoContext).toEqual({
      repoId: 'repo-1',
      repoPath: 'C:\\Repos\\instruction-engine',
      repoLabel: 'Instruction Engine',
      sources: ['workspace', 'selected'],
    });
    expect(state.repositoryBacklog).toMatchObject({
      canonicalName: 'Repository Backlog',
      filePath: 'C:\\Repos\\instruction-engine\\docs\\backlog.md',
      stableIdPattern: 'RB-###',
    });
    expect(state.roadmapDirectory).toMatchObject({
      canonicalName: 'Roadmap',
      directoryPath: 'C:\\Repos\\instruction-engine\\docs\\roadmaps',
      stableIdPattern: 'RM-<roadmap-slug>-###',
    });
    expect(state.repoId).toBe('repo-1');
    expect(state.createScope).toBe('repo');
    expect(state.scopeRepo).toBe(true);
  });

  it('clears the synced repo id when Catalog repo context is removed', () => {
    const store = createPlanningStore();

    store.applyCatalogRepoContext({
      repoId: 'repo-1',
      repoPath: 'C:\\Repos\\instruction-engine',
      repoLabel: 'Instruction Engine',
    });
    store.applyCatalogRepoContext(null);

    const state = store.getState();
    expect(state.catalogRepoContext).toBeNull();
    expect(state.repositoryBacklog).toBeNull();
    expect(state.roadmapDirectory).toBeNull();
    expect(state.repoId).toBe('');
  });

  it('captures bullet drafts locally without creating legacy planning records', async () => {
    const store = createPlanningStore();

    store.setIdeaDraft('- First local draft\n- Second local draft');
    await store.createIdeaBatch();

    const state = store.getState();
    expect(state.draftIdeas).toHaveLength(2);
    expect(state.records).toEqual([]);
    expect(state.draftIdeas.map((draft) => draft.title)).toEqual(['First local draft', 'Second local draft']);
    expect(apiMocks.createPlanningRecord).not.toHaveBeenCalled();
  });

  it('saves a local draft to the repo backlog using repoId targeting', async () => {
    const store = createPlanningStore();

    store.setIdeaDraft('- Draft title');
    await store.createIdeaBatch();

    const draftId = store.getState().draftIdeas[0]?.draftId;
    expect(draftId).toBeTruthy();

    await store.updateIdea(draftId || '', {
      summary: 'Draft summary',
      acceptanceCriteriaText: 'First validation check\nSecond validation check',
      saveRepoId: 'repo-2',
    });
    await store.saveIdeaDraft(draftId || '', 'repo-2');

    expect(apiMocks.createPlanningBacklogItem).toHaveBeenCalledWith({
      repoId: 'repo-2',
      item: {
        title: 'Draft title',
        summary: 'Draft summary\n\nAcceptance criteria:\n- First validation check\n- Second validation check',
        status: 'proposed',
        roadmapIds: [],
        keyPoints: [],
      },
    });
    expect(store.getState().draftIdeas).toHaveLength(0);
    expect(store.getState().statusMessage).toContain('RB-001');
  });

  it('requires multi-repo drafts to be split before backlog save and can split them locally', async () => {
    const store = createPlanningStore();

    store.setIdeaDraft('- Shared draft');
    store.setIdeaTargetRepos('repo-a, repo-b');
    await store.createIdeaBatch();

    const draftId = store.getState().draftIdeas[0]?.draftId;
    expect(draftId).toBeTruthy();

    await store.saveIdeaDraft(draftId || '');
    expect(apiMocks.createPlanningBacklogItem).not.toHaveBeenCalled();
    expect(store.getState().statusMessage).toContain('Split multi-repo drafts');

    store.toggleIdeaSelected(draftId || '', true);
    store.splitIdea(draftId || '');

    const state = store.getState();
    expect(state.draftIdeas).toHaveLength(2);
    expect(state.draftIdeas.map((draft) => draft.targetRepoIds)).toEqual([['repo-a'], ['repo-b']]);
    expect(state.draftIdeas.map((draft) => draft.saveRepoId)).toEqual(['repo-a', 'repo-b']);
    expect(state.selectedIdeaIds).toHaveLength(2);
  });
});
