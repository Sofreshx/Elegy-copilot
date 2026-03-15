import { describe, expect, it, vi } from 'vitest';

vi.mock('../ui/src/lib/api', async () => {
  const actual = await vi.importActual<typeof import('../ui/src/lib/api')>('../ui/src/lib/api');

  return {
    ...actual,
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

    expect(store.getState().roadmaps).toHaveLength(1);
    expect(store.getState().selectedRoadmapSlug).toBe('platform-foundation');

    store.setSelectedRoadmapSlug('platform-foundation');
    expect(store.getState().selectedRoadmapSlug).toBe('platform-foundation');
  });
});
