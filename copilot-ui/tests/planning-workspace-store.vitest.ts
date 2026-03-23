import { describe, expect, it, vi } from 'vitest';

vi.mock('../ui/src/lib/api', async () => {
  const actual = await vi.importActual<typeof import('../ui/src/lib/api')>('../ui/src/lib/api');

  return {
    ...actual,
    getPlanningIntakeArtifacts: vi.fn(async () => ({
      count: 1,
      intake: {
        directoryPath: 'C:\\Repos\\instruction-engine\\docs\\planning\\intake',
        repoRelativePath: 'docs/planning/intake',
        exists: true,
        artifactCount: 1,
        stableIdPattern: 'PI-###',
        supportedCategories: ['idea', 'research', 'refactor-candidate', 'design-complaint', 'audit-request', 'roadmap-request', 'review-prep', 'commit-prep'],
      },
      artifacts: [
        {
          kind: 'planning.intake.artifact',
          schemaVersion: 1,
          id: 'PI-001',
          category: 'idea',
          title: 'Capture planning intake',
          summary: 'Persist repo-backed intake artifacts.',
          acceptanceCriteria: ['Write tests'],
          targetRepoIds: ['repo-1'],
          planningState: 'thought',
          createdAt: '2026-03-18T00:00:00.000Z',
          updatedAt: '2026-03-18T00:00:00.000Z',
          filePath: 'C:\\Repos\\instruction-engine\\docs\\planning\\intake\\PI-001.json',
          repoRelativePath: 'docs/planning/intake/PI-001.json',
        },
      ],
      repo: {
        repoId: 'repo-1',
        repoPath: 'C:\\Repos\\instruction-engine',
        repoLabel: 'Instruction Engine',
      },
    })),
    getPlanningRoadmaps: vi.fn(async () => ({
      count: 1,
      roadmaps: [
        {
          slug: 'platform-foundation',
          title: 'Platform Foundation',
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
      repo: {
        repoId: 'repo-1',
        repoPath: 'C:\\Repos\\instruction-engine',
        repoLabel: 'Instruction Engine',
      },
    })),
    getPlanningObsidianStatus: vi.fn(async () => ({
      repo: {
        repoId: 'repo-1',
        repoPath: 'C:\\Repos\\instruction-engine',
        repoLabel: 'Instruction Engine',
      },
      status: {
        state: 'ready',
        configured: true,
        readAvailable: true,
        syncAvailable: true,
        external: true,
        canonicalAuthority: false,
        message: 'External Obsidian notes are available.',
        notesDirectoryPath: 'C:\\Vault\\Planning\\repo-1',
        cli: {
          state: 'ready',
          message: 'Obsidian CLI probe succeeded.',
        },
        remoteSync: {
          state: 'idle',
          configured: true,
          pollEnabled: true,
          pollIntervalMs: 60000,
          message: 'Remote pull sync is configured and waiting for the next poll.',
          conflictCount: 0,
          appliedCount: 0,
          deletedCount: 0,
          skippedCount: 0,
        },
      },
    })),
    getPlanningObsidianRepresentationsStatus: vi.fn(async () => ({
      repo: {
        repoId: 'repo-1',
        repoPath: 'C:\\Repos\\instruction-engine',
        repoLabel: 'Instruction Engine',
      },
      status: {
        state: 'ready',
        configured: true,
        readAvailable: true,
        syncAvailable: true,
        external: true,
        canonicalAuthority: false,
        message: 'External Obsidian notes are available.',
        notesDirectoryPath: 'C:\\Vault\\Planning\\repo-1',
      },
      representationsStatus: {
        totalCount: 2,
        writeAvailable: true,
        currentCount: 1,
        staleCount: 1,
        missingCount: 0,
        invalidCount: 0,
        sourceMissingCount: 0,
        message: 'Deterministic Obsidian planning mirrors are available for generation and freshness checks.',
      },
    })),
    listPlanningObsidianNotes: vi.fn(async () => ({
      count: 1,
      repo: {
        repoId: 'repo-1',
        repoPath: 'C:\\Repos\\instruction-engine',
        repoLabel: 'Instruction Engine',
      },
      status: {
        state: 'ready',
        configured: true,
        readAvailable: true,
        syncAvailable: true,
        external: true,
        canonicalAuthority: false,
        message: 'External Obsidian notes are available.',
        notesDirectoryPath: 'C:\\Vault\\Planning\\repo-1',
        cli: {
          state: 'ready',
          message: 'Obsidian CLI probe succeeded.',
        },
        remoteSync: {
          state: 'idle',
          configured: true,
          pollEnabled: true,
          pollIntervalMs: 60000,
          message: 'Remote pull sync is configured and waiting for the next poll.',
          conflictCount: 0,
          appliedCount: 0,
          deletedCount: 0,
          skippedCount: 0,
        },
      },
      notes: [
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
    })),
    listPlanningObsidianRepresentations: vi.fn(async () => ({
      count: 2,
      repo: {
        repoId: 'repo-1',
        repoPath: 'C:\\Repos\\instruction-engine',
        repoLabel: 'Instruction Engine',
      },
      status: {
        state: 'ready',
        configured: true,
        readAvailable: true,
        syncAvailable: true,
        external: true,
        canonicalAuthority: false,
        message: 'External Obsidian notes are available.',
        notesDirectoryPath: 'C:\\Vault\\Planning\\repo-1',
      },
      representationsStatus: {
        totalCount: 2,
        writeAvailable: true,
        currentCount: 1,
        staleCount: 1,
        missingCount: 0,
        invalidCount: 0,
        sourceMissingCount: 0,
        message: 'Deterministic Obsidian planning mirrors are available for generation and freshness checks.',
      },
      representations: [
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
          sourceFilePath: 'C:\\Repos\\instruction-engine\\docs\\planning\\bullets.md',
          sourceRepoRelativePath: 'docs/planning/bullets.md',
          sourceUpdatedAt: '2026-03-23T00:00:00.000Z',
          sourceContentHash: 'hash-bullets',
          notePath: 'Planning/repo-1/_instruction-engine/planning-mirrors/bullets.md',
          filePath: 'C:\\Vault\\Planning\\repo-1\\_instruction-engine\\planning-mirrors\\bullets.md',
          noteExists: true,
          noteUpdatedAt: '2026-03-23T00:05:00.000Z',
          generatedAt: '2026-03-23T00:05:00.000Z',
          freshness: 'current',
          metadataValid: true,
          external: true,
          canonicalAuthority: false,
          message: 'Mirror matches the current canonical repo artifact.',
          bulletCount: 1,
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
          sourceFilePath: 'C:\\Repos\\instruction-engine\\docs\\roadmaps\\platform-foundation.md',
          sourceRepoRelativePath: 'docs/roadmaps/platform-foundation.md',
          sourceUpdatedAt: '2026-03-23T00:00:00.000Z',
          sourceContentHash: 'hash-roadmap',
          notePath: 'Planning/repo-1/_instruction-engine/planning-mirrors/roadmaps/platform-foundation.md',
          filePath: 'C:\\Vault\\Planning\\repo-1\\_instruction-engine\\planning-mirrors\\roadmaps\\platform-foundation.md',
          noteExists: true,
          noteUpdatedAt: '2026-03-23T00:05:00.000Z',
          generatedAt: '2026-03-23T00:05:00.000Z',
          freshness: 'stale',
          metadataValid: true,
          external: true,
          canonicalAuthority: false,
          message: 'Canonical repo artifact changed since the mirror was generated.',
          itemCount: 1,
        },
      ],
    })),
    getPlanningObsidianNote: vi.fn(async () => ({
      repo: {
        repoId: 'repo-1',
        repoPath: 'C:\\Repos\\instruction-engine',
        repoLabel: 'Instruction Engine',
      },
      status: {
        state: 'ready',
        configured: true,
        readAvailable: true,
        syncAvailable: true,
        external: true,
        canonicalAuthority: false,
        message: 'External Obsidian notes are available.',
        notesDirectoryPath: 'C:\\Vault\\Planning\\repo-1',
        cli: {
          state: 'ready',
          message: 'Obsidian CLI probe succeeded.',
        },
        remoteSync: {
          state: 'idle',
          configured: true,
          pollEnabled: true,
          pollIntervalMs: 60000,
          message: 'Remote pull sync is configured and waiting for the next poll.',
          conflictCount: 0,
          appliedCount: 0,
          deletedCount: 0,
          skippedCount: 0,
        },
      },
      note: {
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
    })),
    triggerPlanningObsidianSync: vi.fn(async () => ({
      repo: {
        repoId: 'repo-1',
        repoPath: 'C:\\Repos\\instruction-engine',
        repoLabel: 'Instruction Engine',
      },
      status: {
        state: 'ready',
        configured: true,
        readAvailable: true,
        syncAvailable: true,
        external: true,
        canonicalAuthority: false,
        message: 'External Obsidian notes are available.',
        notesDirectoryPath: 'C:\\Vault\\Planning\\repo-1',
        cli: {
          state: 'ready',
          message: 'Obsidian CLI probe succeeded.',
        },
        remoteSync: {
          state: 'success',
          configured: true,
          pollEnabled: true,
          pollIntervalMs: 60000,
          message: 'Remote Obsidian sync applied 1 update(s) and 0 deletion(s).',
          conflictCount: 0,
          appliedCount: 1,
          deletedCount: 0,
          skippedCount: 0,
        },
      },
      result: {
        state: 'success',
        appliedCount: 1,
        deletedCount: 0,
        skippedCount: 0,
        conflictCount: 0,
      },
    })),
    refreshPlanningObsidianRepresentations: vi.fn(async () => ({
      count: 2,
      repo: {
        repoId: 'repo-1',
        repoPath: 'C:\\Repos\\instruction-engine',
        repoLabel: 'Instruction Engine',
      },
      status: {
        state: 'ready',
        configured: true,
        readAvailable: true,
        syncAvailable: true,
        external: true,
        canonicalAuthority: false,
        message: 'External Obsidian notes are available.',
        notesDirectoryPath: 'C:\\Vault\\Planning\\repo-1',
      },
      representationsStatus: {
        totalCount: 2,
        writeAvailable: true,
        currentCount: 2,
        staleCount: 0,
        missingCount: 0,
        invalidCount: 0,
        sourceMissingCount: 0,
        message: 'Deterministic Obsidian planning mirrors are available for generation and freshness checks.',
      },
      representations: [
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
          freshness: 'current',
          metadataValid: true,
          external: true,
          canonicalAuthority: false,
          message: 'Mirror matches the current canonical repo artifact.',
        },
      ],
      result: {
        refreshedCount: 2,
        skippedCount: 0,
        skippedIds: [],
      },
    })),
  };
});

import { createPlanningWorkspaceStore } from '../ui/src/tabs/Planning/planningWorkspaceStore';

describe('planningWorkspaceStore', () => {
  it('derives canonical repository backlog and roadmap refs from Catalog repo context', () => {
    const store = createPlanningWorkspaceStore();

    store.syncCatalogRepoContext({
      repoId: 'repo-1',
      repoPath: 'C:\\Repos\\instruction-engine',
      repoLabel: 'Instruction Engine',
      sources: ['workspace', 'selected'],
    });

    expect(store.getState()).toMatchObject({
      catalogRepoContext: {
        repoId: 'repo-1',
        repoPath: 'C:\\Repos\\instruction-engine',
        repoLabel: 'Instruction Engine',
        sources: ['workspace', 'selected'],
      },
      intakeFilters: {
        category: '__all__',
        planningState: '__all__',
        targetRepoId: '__all__',
      },
      planningIntakeDirectory: {
        canonicalName: 'Planning Intake',
        directoryPath: 'C:\\Repos\\instruction-engine\\docs\\planning\\intake',
        stableIdPattern: 'PI-###',
        supportedCategories: ['idea', 'research', 'refactor-candidate', 'design-complaint', 'audit-request', 'roadmap-request', 'review-prep', 'commit-prep'],
      },
      repositoryBacklog: {
        canonicalName: 'Repository Backlog',
        filePath: 'C:\\Repos\\instruction-engine\\docs\\backlog.md',
        stableIdPattern: 'RB-###',
      },
      roadmapDirectory: {
        canonicalName: 'Roadmap',
        directoryPath: 'C:\\Repos\\instruction-engine\\docs\\roadmaps',
        stableIdPattern: 'RM-<roadmap-slug>-###',
      },
    });
  });

  it('loads roadmaps against the synced repo context and keeps roadmap selection in workspace state', async () => {
    const store = createPlanningWorkspaceStore();

    store.syncCatalogRepoContext({
      repoId: 'repo-1',
      repoPath: 'C:\\Repos\\instruction-engine',
      repoLabel: 'Instruction Engine',
      sources: ['workspace'],
    });

    await store.loadRoadmaps();
    await store.loadIntakeArtifacts();

    expect(store.getState().roadmaps).toHaveLength(1);
    expect(store.getState().intakeArtifacts).toHaveLength(1);
    expect(store.getState().selectedRoadmapSlug).toBe('platform-foundation');

    store.setSelectedRoadmapSlug('platform-foundation');
    expect(store.getState().selectedRoadmapSlug).toBe('platform-foundation');
  });

  it('loads external obsidian notes for the selected repo without changing canonical planning authority', async () => {
    const store = createPlanningWorkspaceStore();

    store.syncCatalogRepoContext({
      repoId: 'repo-1',
      repoPath: 'C:\\Repos\\instruction-engine',
      repoLabel: 'Instruction Engine',
      sources: ['workspace'],
    });

    await store.loadObsidianNotes();

    expect(store.getState().obsidianStatus).toMatchObject({
      state: 'ready',
      external: true,
      canonicalAuthority: false,
    });
    expect(store.getState().obsidianNotes).toHaveLength(1);
    expect(store.getState().selectedObsidianNoteId).toBe('obsnote_1234');
    expect(store.getState().selectedObsidianNote?.title).toBe('External planning note');
  });

  it('loads deterministic obsidian planning mirrors for canonical bullets and roadmaps', async () => {
    const store = createPlanningWorkspaceStore();

    store.syncCatalogRepoContext({
      repoId: 'repo-1',
      repoPath: 'C:\\Repos\\instruction-engine',
      repoLabel: 'Instruction Engine',
      sources: ['workspace'],
    });

    await store.loadObsidianRepresentations();

    expect(store.getState().obsidianRepresentationsStatus).toMatchObject({
      totalCount: 2,
      writeAvailable: true,
      currentCount: 1,
      staleCount: 1,
    });
    expect(store.getState().obsidianRepresentations).toHaveLength(2);
    expect(store.getState().obsidianRepresentations[0]).toMatchObject({
      external: true,
      canonicalAuthority: false,
    });
  });

  it('runs manual obsidian sync and refreshes the workspace note inventory', async () => {
    const store = createPlanningWorkspaceStore();

    store.syncCatalogRepoContext({
      repoId: 'repo-1',
      repoPath: 'C:\\Repos\\instruction-engine',
      repoLabel: 'Instruction Engine',
      sources: ['workspace'],
    });

    await store.syncObsidianNotes();

    expect(store.getState().obsidianNotes).toHaveLength(1);
    expect(store.getState().obsidianSyncing).toBe(false);
    expect(store.getState().obsidianStatus?.remoteSync?.state).toBe('idle');
  });

  it('refreshes deterministic obsidian planning mirrors from canonical repo artifacts', async () => {
    const store = createPlanningWorkspaceStore();

    store.syncCatalogRepoContext({
      repoId: 'repo-1',
      repoPath: 'C:\\Repos\\instruction-engine',
      repoLabel: 'Instruction Engine',
      sources: ['workspace'],
    });

    await store.refreshObsidianRepresentationsInVault();

    expect(store.getState().obsidianRepresentationsRefreshing).toBe(false);
    expect(store.getState().obsidianRepresentationsStatus?.currentCount).toBe(2);
    expect(store.getState().obsidianRepresentations).toHaveLength(2);
  });

  it('tracks intake filters and resets them after switching to a different repo context', () => {
    const store = createPlanningWorkspaceStore();

    store.syncCatalogRepoContext({
      repoId: 'repo-1',
      repoPath: 'C:\\Repos\\instruction-engine',
      repoLabel: 'Instruction Engine',
      sources: ['workspace'],
    });

    store.setIntakeCategoryFilter('idea');
    store.setIntakePlanningStateFilter('thought');
    store.setIntakeTargetFilter('repo-1');

    expect(store.getState().intakeFilters).toEqual({
      category: 'idea',
      planningState: 'thought',
      targetRepoId: 'repo-1',
    });

    store.syncCatalogRepoContext({
      repoId: 'repo-1',
      repoPath: 'C:\\Repos\\instruction-engine',
      repoLabel: 'Instruction Engine (renamed)',
      sources: ['workspace', 'selected'],
    });
    expect(store.getState().intakeFilters).toEqual({
      category: 'idea',
      planningState: 'thought',
      targetRepoId: 'repo-1',
    });

    store.syncCatalogRepoContext({
      repoId: 'repo-2',
      repoPath: 'C:\\Repos\\other-repo',
      repoLabel: 'Other Repo',
      sources: ['workspace'],
    });
    expect(store.getState().intakeFilters).toEqual({
      category: '__all__',
      planningState: '__all__',
      targetRepoId: '__all__',
    });
  });
});
