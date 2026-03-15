import { describe, expect, it } from 'vitest';

import { createPlanningStore } from '../ui/src/tabs/Planning/planningStore';

describe('planningStore catalog repo context', () => {
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
});
