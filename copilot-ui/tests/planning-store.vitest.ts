import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
  createPlanningIntakeArtifact: vi.fn(),
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
    createPlanningIntakeArtifact: apiMocks.createPlanningIntakeArtifact,
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
    apiMocks.createPlanningIntakeArtifact.mockResolvedValue({
      kind: 'planning.intake.create',
      deterministic: true,
      repo: {
        repoId: 'repo-1',
        repoPath: 'C:\\Repos\\instruction-engine',
        repoLabel: 'Instruction Engine',
      },
      intake: {
        exists: true,
        itemCount: 1,
        directoryPath: 'C:\\Repos\\instruction-engine\\docs\\planning\\intake',
        repoRelativePath: 'docs/planning/intake',
        artifactCount: 1,
        stableIdPattern: 'PI-###',
        supportedCategories: ['idea', 'research', 'refactor-candidate', 'design-complaint', 'audit-request', 'roadmap-request', 'commit-prep'],
      },
      artifacts: [],
      artifact: {
        kind: 'planning.intake.artifact',
        schemaVersion: 1,
        id: 'PI-001',
        category: 'idea',
        title: 'Draft title',
        summary: 'Draft summary',
        acceptanceCriteria: ['First validation check', 'Second validation check'],
        targetRepoIds: ['repo-2'],
        planningState: 'thought',
        createdAt: '2026-03-18T00:00:00.000Z',
        updatedAt: '2026-03-18T00:00:00.000Z',
        filePath: 'C:\\Repos\\instruction-engine\\docs\\planning\\intake\\PI-001.json',
        repoRelativePath: 'docs/planning/intake/PI-001.json',
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
    expect(state.planningIntakeDirectory).toMatchObject({
      canonicalName: 'Planning Intake',
      directoryPath: 'C:\\Repos\\instruction-engine\\docs\\planning\\intake',
      stableIdPattern: 'PI-###',
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
    expect(state.planningIntakeDirectory).toBeNull();
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

  it('saves a local draft to repo-backed planning intake using repoId targeting', async () => {
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

    expect(apiMocks.createPlanningIntakeArtifact).toHaveBeenCalledWith({
      repoId: 'repo-2',
      artifact: {
        category: 'idea',
        title: 'Draft title',
        summary: 'Draft summary',
        acceptanceCriteria: ['First validation check', 'Second validation check'],
        targetRepoIds: [],
        planningState: 'thought',
      },
    });
    expect(store.getState().draftIdeas).toHaveLength(0);
    expect(store.getState().statusMessage).toContain('PI-001');
  });

  it('allows multi-repo drafts to save into a shared intake artifact and can still split them locally', async () => {
    const store = createPlanningStore();

    store.setIdeaDraft('- Shared draft');
    store.setIdeaTargetRepos('repo-a, repo-b');
    await store.createIdeaBatch();

    const draftId = store.getState().draftIdeas[0]?.draftId;
    expect(draftId).toBeTruthy();

    await store.saveIdeaDraft(draftId || '', 'repo-a');
    expect(apiMocks.createPlanningIntakeArtifact).toHaveBeenCalledWith({
      repoId: 'repo-a',
      artifact: expect.objectContaining({
        title: 'Shared draft',
        targetRepoIds: ['repo-a', 'repo-b'],
      }),
    });

    store.setIdeaDraft('- Shared draft for split');
    store.setIdeaTargetRepos('repo-a, repo-b');
    await store.createIdeaBatch();

    const splitDraftId = store.getState().draftIdeas[0]?.draftId;
    expect(splitDraftId).toBeTruthy();

    store.toggleIdeaSelected(splitDraftId || '', true);
    store.splitIdea(splitDraftId || '');

    const state = store.getState();
    expect(state.draftIdeas).toHaveLength(2);
    expect(state.draftIdeas.map((draft) => draft.targetRepoIds)).toEqual([['repo-a'], ['repo-b']]);
    expect(state.draftIdeas.map((draft) => draft.saveRepoId)).toEqual(['repo-a', 'repo-b']);
    expect(state.selectedIdeaIds).toHaveLength(2);
  });
});
