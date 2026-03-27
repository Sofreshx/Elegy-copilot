import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
  createPlanningIntakeArtifact: vi.fn(),
  comparePlanningRecords: vi.fn(),
  createPlanningRecord: vi.fn(),
  createSdkSession: vi.fn(),
  deletePlanningResearchNote: vi.fn(),
  getSessionPlanText: vi.fn(),
  getPlanningDiagrams: vi.fn(),
  getPlanningRecords: vi.fn(),
  getPlanningResearchNotes: vi.fn(),
  getPolicyPreflight: vi.fn(),
  mergePlanningRecords: vi.fn(),
  preparePlanningMergeIntent: vi.fn(),
  savePlanningResearchNote: vi.fn(),
  searchPlanningRecords: vi.fn(),
  sendSdkMessage: vi.fn(),
  upsertSessionPlan: vi.fn(),
}));

const sdkMocks = vi.hoisted(() => ({
  loadSessions: vi.fn(),
  selectSession: vi.fn(),
}));

const localSessionMocks = vi.hoisted(() => ({
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
    getSessionPlanText: apiMocks.getSessionPlanText,
    getPlanningDiagrams: apiMocks.getPlanningDiagrams,
    getPlanningRecords: apiMocks.getPlanningRecords,
    getPlanningResearchNotes: apiMocks.getPlanningResearchNotes,
    getPolicyPreflight: apiMocks.getPolicyPreflight,
    mergePlanningRecords: apiMocks.mergePlanningRecords,
    preparePlanningMergeIntent: apiMocks.preparePlanningMergeIntent,
    savePlanningResearchNote: apiMocks.savePlanningResearchNote,
    searchPlanningRecords: apiMocks.searchPlanningRecords,
    sendSdkMessage: apiMocks.sendSdkMessage,
    upsertSessionPlan: apiMocks.upsertSessionPlan,
  };
});

vi.mock('../ui/src/tabs/Sessions/sdkSessionsStore', () => ({
  sdkSessionsStore: {
    loadSessions: sdkMocks.loadSessions,
    selectSession: sdkMocks.selectSession,
  },
}));

vi.mock('../ui/src/tabs/Sessions/sessionsStore', () => ({
  sessionsStore: {
    loadSessions: localSessionMocks.loadSessions,
    selectSession: localSessionMocks.selectSession,
  },
}));

import { createPlanningStore } from '../ui/src/tabs/Planning/planningStore';

describe('planningStore catalog repo context', () => {
  beforeEach(() => {
    window.localStorage.clear();
    Object.values(apiMocks).forEach((mock) => mock.mockReset());
    sdkMocks.loadSessions.mockReset();
    sdkMocks.selectSession.mockReset();
    localSessionMocks.loadSessions.mockReset();
    localSessionMocks.selectSession.mockReset();
    apiMocks.createSdkSession.mockResolvedValue({
      sessionId: 'sdk-session-default',
    });
    apiMocks.sendSdkMessage.mockResolvedValue({
      messageId: 'sdk-message-default',
    });
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
        supportedCategories: ['idea', 'research', 'refactor-candidate', 'design-complaint', 'audit-request', 'roadmap-request', 'review-prep', 'commit-prep'],
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
    apiMocks.getSessionPlanText.mockResolvedValue('# Linked plan\n\n## Problem\n\nLoad existing content.\n');
    apiMocks.upsertSessionPlan.mockResolvedValue({
      sessionId: 'plan-session-1',
      source: 'cli',
      planPath: 'C:\\Users\\Dylan\\.copilot\\session-state\\plan-session-1\\plan.md',
      created: true,
      updatedAt: '2026-03-18T00:00:00.000Z',
      content: '# Saved plan\n\n## Problem\n\nClose the planning gap.\n',
    });
    localSessionMocks.loadSessions.mockResolvedValue(undefined);
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

  it('creates explicit audit, roadmap, review-prep, and commit-prep intake requests as tracked artifacts', async () => {
    const store = createPlanningStore();

    store.applyCatalogRepoContext({
      repoId: 'repo-1',
      repoPath: 'C:\\Repos\\instruction-engine',
      repoLabel: 'Instruction Engine',
      sources: ['workspace', 'selected'],
    });

    await store.createActionRequest('audit-request', {
      title: 'Audit current planning workflows',
      notes: 'Focus on intake tracker visibility and request discoverability.',
      targetRepoIds: ['repo-1'],
      saveRepoId: 'repo-1',
    });

    expect(apiMocks.createPlanningIntakeArtifact).toHaveBeenNthCalledWith(1, {
      repoId: 'repo-1',
      artifact: expect.objectContaining({
        category: 'audit-request',
        title: 'Audit current planning workflows',
        targetRepoIds: ['repo-1'],
        planningState: 'requested',
      }),
    });
    expect(apiMocks.createPlanningIntakeArtifact.mock.calls[0]?.[0]?.artifact?.summary).toContain('repo-scoped audit');
    expect(apiMocks.createPlanningIntakeArtifact.mock.calls[0]?.[0]?.artifact?.summary).toContain('does not silently mutate');

    await store.createActionRequest('roadmap-request', {
      title: 'Generate a roadmap proposal for planning actions',
      notes: 'Capture scope, sequencing, and review checkpoints before editing docs.',
      targetRepoIds: ['repo-1'],
      saveRepoId: 'repo-1',
    });

    expect(apiMocks.createPlanningIntakeArtifact).toHaveBeenNthCalledWith(2, {
      repoId: 'repo-1',
      artifact: expect.objectContaining({
        category: 'roadmap-request',
        title: 'Generate a roadmap proposal for planning actions',
        targetRepoIds: ['repo-1'],
        planningState: 'requested',
      }),
    });
    expect(apiMocks.createPlanningIntakeArtifact.mock.calls[1]?.[0]?.artifact?.summary).toContain('roadmap proposal');
    expect(apiMocks.createPlanningIntakeArtifact.mock.calls[1]?.[0]?.artifact?.summary).toContain('must not silently mutate docs/roadmaps');

    await store.createPrepRequest('review-prep', {
      title: 'Package planning UI changes for review',
      notes: 'Call out validation coverage and reviewer questions.',
      targetRepoIds: ['repo-1'],
      saveRepoId: 'repo-1',
    });

    expect(apiMocks.createPlanningIntakeArtifact).toHaveBeenNthCalledWith(3, {
      repoId: 'repo-1',
      artifact: expect.objectContaining({
        category: 'review-prep',
        title: 'Package planning UI changes for review',
        targetRepoIds: ['repo-1'],
        planningState: 'requested',
      }),
    });
    expect(apiMocks.createPlanningIntakeArtifact.mock.calls[2]?.[0]?.artifact?.summary).toContain('AI review package');
    expect(apiMocks.createPlanningIntakeArtifact.mock.calls[2]?.[0]?.artifact?.summary).toContain('must not perform the final git commit');

    await store.createPrepRequest('commit-prep', {
      title: 'Prepare commit-ready summary for planning lane',
      notes: 'Include a concise subject line.',
      targetRepoIds: ['repo-1'],
      saveRepoId: 'repo-1',
    });

    expect(apiMocks.createPlanningIntakeArtifact).toHaveBeenNthCalledWith(4, {
      repoId: 'repo-1',
      artifact: expect.objectContaining({
        category: 'commit-prep',
        title: 'Prepare commit-ready summary for planning lane',
        targetRepoIds: ['repo-1'],
        planningState: 'requested',
      }),
    });
    expect(apiMocks.createPlanningIntakeArtifact.mock.calls[3]?.[0]?.artifact?.summary).toContain('proposed commit messages');
    expect(apiMocks.createPlanningIntakeArtifact.mock.calls[3]?.[0]?.artifact?.summary).toContain('must not execute the final git commit');
  });

  it('persists repo-scoped Planning to SDK linkage for compiled idea batches', async () => {
    apiMocks.createSdkSession.mockResolvedValueOnce({
      sessionId: 'sdk-123',
    });
    apiMocks.sendSdkMessage.mockResolvedValueOnce({
      messageId: 'sdk-message-123',
    });

    const store = createPlanningStore();
    store.applyCatalogRepoContext({
      repoId: 'repo-1',
      repoPath: 'C:\\Repos\\instruction-engine',
      repoLabel: 'Instruction Engine',
      sources: ['workspace', 'selected'],
    });

    store.setIdeaDraft('- Link Planning compile to SDK');
    await store.createIdeaBatch();

    const draftId = store.getState().draftIdeas[0]?.draftId || '';
    store.toggleIdeaSelected(draftId, true);

    const sessionId = await store.compileSelectedIdeas();
    expect(sessionId).toBe('sdk-123');
    expect(apiMocks.createSdkSession).toHaveBeenCalledWith({});
    expect(apiMocks.sendSdkMessage).toHaveBeenCalledWith({
      sessionId: 'sdk-123',
      prompt: expect.stringContaining('Link Planning compile to SDK'),
    });
    expect(sdkMocks.loadSessions).toHaveBeenCalled();
    expect(sdkMocks.selectSession).toHaveBeenCalledWith('sdk-123');
    expect(store.getState().linkedSdkSession).toMatchObject({
      sessionId: 'sdk-123',
      repoId: 'repo-1',
      source: 'compile-selected-ideas',
      selectedIdeaIds: [draftId],
      selectedIdeaTitles: ['Link Planning compile to SDK'],
      targetRepoIds: ['repo-1'],
    });

    const reloadedStore = createPlanningStore();
    reloadedStore.applyCatalogRepoContext({
      repoId: 'repo-1',
      repoPath: 'C:\\Repos\\instruction-engine',
      repoLabel: 'Instruction Engine',
      sources: ['workspace', 'selected'],
    });

    expect(reloadedStore.getState().linkedSdkSession).toMatchObject({
      sessionId: 'sdk-123',
      repoId: 'repo-1',
      source: 'compile-selected-ideas',
      selectedIdeaTitles: ['Link Planning compile to SDK'],
    });
  });

  it('creates and persists repo-scoped linked plan sessions', async () => {
    const store = createPlanningStore();
    store.applyCatalogRepoContext({
      repoId: 'repo-1',
      repoPath: 'C:\\Repos\\instruction-engine',
      repoLabel: 'Instruction Engine',
      sources: ['workspace', 'selected'],
    });

    const sessionId = await store.savePlanDraft({
      title: 'Planning follow-up',
      content: '# Planning follow-up\n\n## Problem\n\nAdd explicit plan authoring.\n',
    });

    expect(sessionId).toBe('plan-session-1');
    expect(apiMocks.upsertSessionPlan).toHaveBeenCalledWith({
      sessionId: undefined,
      title: 'Planning follow-up',
      content: '# Planning follow-up\n\n## Problem\n\nAdd explicit plan authoring.\n',
      repoId: 'repo-1',
      repoPath: 'C:\\Repos\\instruction-engine',
      seedArtifact: undefined,
    });
    expect(localSessionMocks.loadSessions).toHaveBeenCalled();
    expect(localSessionMocks.selectSession).toHaveBeenCalledWith('plan-session-1');
    expect(store.getState().linkedPlanSession).toMatchObject({
      sessionId: 'plan-session-1',
      repoId: 'repo-1',
      source: 'create-plan',
    });

    const reloadedStore = createPlanningStore();
    reloadedStore.applyCatalogRepoContext({
      repoId: 'repo-1',
      repoPath: 'C:\\Repos\\instruction-engine',
      repoLabel: 'Instruction Engine',
      sources: ['workspace', 'selected'],
    });

    expect(reloadedStore.getState().linkedPlanSession).toMatchObject({
      sessionId: 'plan-session-1',
      repoId: 'repo-1',
      source: 'create-plan',
    });
  });

  it('loads linked plan text and supports seeded plan saves from intake artifacts', async () => {
    window.localStorage.setItem(
      'instruction-engine.planning.linked-plan-session.v1',
      JSON.stringify({
        'repo-1': {
          sessionId: 'plan-existing',
          repoId: 'repo-1',
          source: 'create-plan',
          createdAt: '2026-03-18T00:00:00.000Z',
        },
      })
    );
    apiMocks.upsertSessionPlan.mockResolvedValueOnce({
      sessionId: 'plan-session-seeded',
      source: 'cli',
      planPath: 'C:\\Users\\Dylan\\.copilot\\session-state\\plan-session-seeded\\plan.md',
      created: true,
      updatedAt: '2026-03-18T00:05:00.000Z',
      content: '# Seeded plan\n\n## Problem\n\nSeed from intake.\n',
    });

    const store = createPlanningStore();
    store.applyCatalogRepoContext({
      repoId: 'repo-1',
      repoPath: 'C:\\Repos\\instruction-engine',
      repoLabel: 'Instruction Engine',
      sources: ['workspace', 'selected'],
    });

    await store.loadLinkedPlan();
    expect(apiMocks.getSessionPlanText).toHaveBeenCalledWith('plan-existing');
    expect(store.getState().planContentDraft).toContain('# Linked plan');

    const seededArtifact = {
      kind: 'planning.intake.artifact' as const,
      schemaVersion: 1,
      id: 'PI-001',
      category: 'audit-request' as const,
      title: 'Audit planning workflow',
      summary: 'Inspect plan visibility and runtime status.',
      acceptanceCriteria: ['Keep output traceable', 'Do not mutate docs silently'],
      targetRepoIds: ['repo-1'],
      planningState: 'requested',
      createdAt: '2026-03-18T00:00:00.000Z',
      updatedAt: '2026-03-18T00:00:00.000Z',
      filePath: 'C:\\Repos\\instruction-engine\\docs\\planning\\intake\\PI-001.json',
      repoRelativePath: 'docs/planning/intake/PI-001.json',
    };

    const sessionId = await store.savePlanDraft({
      title: 'Seeded planning follow-up',
      seedArtifact: seededArtifact,
      createNewSession: true,
    });

    expect(sessionId).toBe('plan-session-seeded');
    expect(apiMocks.upsertSessionPlan).toHaveBeenCalledTimes(1);
    const seededSaveRequest = apiMocks.upsertSessionPlan.mock.calls[0]?.[0];
    expect(seededSaveRequest).toEqual(expect.objectContaining({
      sessionId: undefined,
      title: 'Seeded planning follow-up',
      repoId: 'repo-1',
      repoPath: 'C:\\Repos\\instruction-engine',
      seedArtifact: expect.objectContaining({
        id: 'PI-001',
        kind: 'intake',
        category: 'audit-request',
        title: 'Audit planning workflow',
        summary: 'Inspect plan visibility and runtime status.',
        targetRepoIds: ['repo-1'],
        state: 'requested',
        originKind: 'intake',
      }),
    }));
    expect(seededSaveRequest?.content).toContain('Intake artifact: PI-001');
    expect(seededSaveRequest?.content).toContain('Source title: Audit planning workflow');
    expect(seededSaveRequest?.content).toContain('Inspect plan visibility and runtime status.');
    expect(seededSaveRequest?.content).toContain('Seeded from PI-001 (audit-request).');
    expect(localSessionMocks.selectSession).toHaveBeenCalledWith('plan-session-seeded');
    expect(store.getState().linkedPlanSession).toMatchObject({
      sessionId: 'plan-session-seeded',
      repoId: 'repo-1',
      source: 'seed-from-intake',
      originKind: 'intake',
      originArtifactId: 'PI-001',
      seedArtifactId: 'PI-001',
    });
  });

  it('round-trips synced-note seeded plan linkage from localStorage and preserves synced-note provenance', async () => {
    window.localStorage.setItem(
      'instruction-engine.planning.linked-plan-session.v1',
      JSON.stringify({
        'repo-1::synced-note::snsrc_1234567890abcdef1234567890abcd::planning': {
          sessionId: 'plan-synced-note',
          repoId: 'repo-1',
          source: 'seed-from-synced-note',
          createdAt: '2026-03-18T00:00:00.000Z',
          seedArtifactId: 'snsrc_1234567890abcdef1234567890abcd',
          seedArtifactTitle: 'Weekly synced planning note',
        },
      })
    );
    apiMocks.upsertSessionPlan.mockResolvedValueOnce({
      sessionId: 'plan-synced-note',
      source: 'cli',
      planPath: 'C:\\Users\\Dylan\\.copilot\\session-state\\plan-synced-note\\plan.md',
      created: false,
      updatedAt: '2026-03-18T00:06:00.000Z',
      content: '# Synced note seeded plan\n\n## Problem\n\nRefine the synced note into implementation steps.\n',
    });

    const store = createPlanningStore();
    store.applyCatalogRepoContext({
      repoId: 'repo-1',
      repoPath: 'C:\\Repos\\instruction-engine',
      repoLabel: 'Instruction Engine',
      sources: ['workspace', 'selected'],
    });

    const sessionId = await store.savePlanDraft({
      title: 'Promote synced note seed',
      seedArtifact: {
        id: 'snsrc_1234567890abcdef1234567890abcd',
        kind: 'synced-note',
        title: 'Weekly synced planning note',
        summary: 'Use the synced note as a planning seed, not as the source of truth.',
        targetRepoIds: ['repo-1'],
      },
    });

    expect(sessionId).toBe('plan-synced-note');
    expect(apiMocks.upsertSessionPlan).toHaveBeenCalledTimes(1);
    const syncedNoteSaveRequest = apiMocks.upsertSessionPlan.mock.calls[0]?.[0];
    expect(syncedNoteSaveRequest).toEqual(expect.objectContaining({
      sessionId: 'plan-synced-note',
      title: 'Promote synced note seed',
      repoId: 'repo-1',
      repoPath: 'C:\\Repos\\instruction-engine',
      seedArtifact: expect.objectContaining({
        id: 'snsrc_1234567890abcdef1234567890abcd',
        kind: 'synced-note',
        category: 'synced-note',
        title: 'Weekly synced planning note',
        summary: 'Use the synced note as a planning seed, not as the source of truth.',
        targetRepoIds: ['repo-1'],
        originKind: 'synced-note',
      }),
    }));
    expect(syncedNoteSaveRequest?.content).toContain('Synced note seed: snsrc_1234567890abcdef1234567890abcd');
    expect(syncedNoteSaveRequest?.content).toContain('Source title: Weekly synced planning note');
    expect(syncedNoteSaveRequest?.content).toContain('Use the synced note as a planning seed, not as the source of truth.');
    expect(syncedNoteSaveRequest?.content).toContain('Promote any durable decisions into repo docs or the active session plan before treating them as canonical.');
    expect(localSessionMocks.selectSession).toHaveBeenCalledWith('plan-synced-note');
    expect(store.getState().linkedPlanSession).toMatchObject({
      sessionId: 'plan-synced-note',
      repoId: 'repo-1',
      source: 'seed-from-synced-note',
      originKind: 'synced-note',
      originArtifactId: 'snsrc_1234567890abcdef1234567890abcd',
      seedArtifactId: 'snsrc_1234567890abcdef1234567890abcd',
      seedArtifactTitle: 'Weekly synced planning note',
    });
  });
});
