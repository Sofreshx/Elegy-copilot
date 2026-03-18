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
        supportedCategories: ['idea', 'research', 'refactor-candidate', 'design-complaint', 'audit-request', 'roadmap-request', 'commit-prep'],
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
      planningIntakeDirectory: {
        canonicalName: 'Planning Intake',
        directoryPath: 'C:\\Repos\\instruction-engine\\docs\\planning\\intake',
        stableIdPattern: 'PI-###',
        supportedCategories: ['idea', 'research', 'refactor-candidate', 'design-complaint', 'audit-request', 'roadmap-request', 'commit-prep'],
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
});
