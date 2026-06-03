import { describe, expect, it } from 'vitest';
import {
  normalizeRepoEntries,
  resolveRepoLabel,
  mergeRepoRoadmaps,
  filterBySelectedRepos,
  sortRoadmaps,
  type AugmentedRoadmap,
  type RepoChoice,
} from '../ui/src/tabs/Planning/planningExplorerContracts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRepoChoice(overrides: Partial<RepoChoice> = {}): RepoChoice {
  return {
    repoId: 'repo-1',
    repoPath: '/path/to/repo',
    repoLabel: 'My Repo',
    ...overrides,
  };
}

function makeRoadmap(
  id: string,
  repoSource: RepoChoice,
  overrides: Partial<AugmentedRoadmap['_repoSource'] & Record<string, unknown>> = {},
): AugmentedRoadmap {
  return {
    id,
    title: `Roadmap ${id}`,
    status: 'active',
    tags: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    summary: null,
    goalId: null,
    correlationId: null,
    revision: null,
    _repoSource: repoSource,
    ...overrides,
  } as AugmentedRoadmap;
}

// ---------------------------------------------------------------------------
// normalizeRepoEntries
// ---------------------------------------------------------------------------

describe('normalizeRepoEntries', () => {
  it('normalises valid repo entries', () => {
    const input = [
      { repoId: 'r1', repoPath: '/a', repoLabel: 'A' },
      { repoId: '  r2  ', repoPath: ' /b ', repoLabel: ' B ' },
    ];
    const result = normalizeRepoEntries(input);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ repoId: 'r1', repoPath: '/a', repoLabel: 'A' });
    expect(result[1]).toEqual({ repoId: 'r2', repoPath: '/b', repoLabel: 'B' });
  });

  it('rejects entries where ALL four fields are empty (pass 1 filter)', () => {
    const input = [{ repoId: '', repoPath: '', repoLabel: '', sources: [] }];
    expect(normalizeRepoEntries(input)).toHaveLength(0);
  });

  it('rejects entries with neither repoId nor repoPath (pass 2 filter)', () => {
    const input = [
      { repoId: '', repoPath: '', repoLabel: 'Has label only', sources: [] },
    ];
    expect(normalizeRepoEntries(input)).toHaveLength(0);
  });

  it('accepts entry with repoPath but no repoId (after pass 2)', () => {
    const input = [
      { repoId: '', repoPath: '/real/path', repoLabel: '', sources: [] },
    ];
    const result = normalizeRepoEntries(input);
    expect(result).toHaveLength(1);
    expect(result[0].repoPath).toBe('/real/path');
  });

  it('accepts entry with repoId but no repoPath (after pass 2)', () => {
    const input = [
      { repoId: 'my-id', repoPath: '', repoLabel: '', sources: [] },
    ];
    const result = normalizeRepoEntries(input);
    expect(result).toHaveLength(1);
    expect(result[0].repoId).toBe('my-id');
  });

  it('filters null and non-object entries', () => {
    const input = [null, undefined, 'string', 42] as unknown[];
    expect(normalizeRepoEntries(input)).toHaveLength(0);
  });

  it('handles empty array', () => {
    expect(normalizeRepoEntries([])).toHaveLength(0);
  });

  it('normalises multiple entries including invalid ones', () => {
    const input = [
      { repoId: 'good', repoPath: '/g', repoLabel: 'G' },
      { repoId: '', repoPath: '', repoLabel: '', sources: [] },
      { repoId: '', repoPath: '', repoLabel: 'Label only', sources: [] }, // fails pass 2 (no repoId, no repoPath)
      { repoId: 'also-good', repoPath: '', repoLabel: 'AG', sources: ['src'] },
    ];
    const result = normalizeRepoEntries(input);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.repoId)).toEqual(['good', 'also-good']);
  });
});

// ---------------------------------------------------------------------------
// resolveRepoLabel
// ---------------------------------------------------------------------------

describe('resolveRepoLabel', () => {
  it('returns repoLabel when present', () => {
    expect(resolveRepoLabel({ repoLabel: 'My Label', repoId: 'id', repoPath: '/p' })).toBe('My Label');
  });

  it('falls back to repoId when repoLabel is empty', () => {
    expect(resolveRepoLabel({ repoLabel: '', repoId: 'fallback-id', repoPath: '/p' })).toBe('fallback-id');
  });

  it('falls back to repoPath when repoLabel and repoId are empty', () => {
    expect(resolveRepoLabel({ repoLabel: '', repoId: '', repoPath: '/fallback-path' })).toBe('/fallback-path');
  });

  it('falls back to repoPath when repoLabel is null', () => {
    expect(resolveRepoLabel({ repoLabel: null, repoId: null, repoPath: '/p' })).toBe('/p');
  });

  it('returns "Unknown repo" when all are empty/null', () => {
    expect(resolveRepoLabel({ repoLabel: '', repoId: '', repoPath: '' })).toBe('Unknown repo');
  });

  it('handles undefined fields', () => {
    expect(resolveRepoLabel({})).toBe('Unknown repo');
  });

  it('trims whitespace', () => {
    expect(resolveRepoLabel({ repoLabel: '  trimmed  ' })).toBe('trimmed');
  });
});

// ---------------------------------------------------------------------------
// mergeRepoRoadmaps
// ---------------------------------------------------------------------------

describe('mergeRepoRoadmaps', () => {
  const repoA = makeRepoChoice({ repoId: 'a', repoLabel: 'Repo A' });
  const repoB = makeRepoChoice({ repoId: 'b', repoLabel: 'Repo B' });

  it('merges roadmaps from multiple successful fetches with _repoSource', () => {
    const results: PromiseSettledResult<{ roadmaps: { id: string }[] }>[] = [
      { status: 'fulfilled', value: { roadmaps: [{ id: 'r1' }] } },
      { status: 'fulfilled', value: { roadmaps: [{ id: 'r2' }] } },
    ] as any;
    const { roadmaps, failedRepos } = mergeRepoRoadmaps(results as any, [repoA, repoB]);
    expect(roadmaps).toHaveLength(2);
    expect(roadmaps[0]._repoSource).toEqual(repoA);
    expect(roadmaps[0].id).toBe('r1');
    expect(roadmaps[1]._repoSource).toEqual(repoB);
    expect(roadmaps[1].id).toBe('r2');
    expect(failedRepos).toHaveLength(0);
  });

  it('collects failed repos separately', () => {
    const results: PromiseSettledResult<{ roadmaps: { id: string }[] }>[] = [
      { status: 'fulfilled', value: { roadmaps: [{ id: 'r1' }] } },
      { status: 'rejected', reason: new Error('fail') },
    ] as any;
    const { roadmaps, failedRepos } = mergeRepoRoadmaps(results as any, [repoA, repoB]);
    expect(roadmaps).toHaveLength(1);
    expect(roadmaps[0]._repoSource).toEqual(repoA);
    expect(failedRepos).toHaveLength(1);
    expect(failedRepos[0]).toEqual(repoB);
  });

  it('handles empty roadmaps array in fulfilled response', () => {
    const results: PromiseSettledResult<{ roadmaps: unknown }>[] = [
      { status: 'fulfilled', value: { roadmaps: null } },
    ] as any;
    const { roadmaps } = mergeRepoRoadmaps(results as any, [repoA]);
    expect(roadmaps).toHaveLength(0);
  });

  it('handles empty results array', () => {
    const { roadmaps, failedRepos } = mergeRepoRoadmaps([], []);
    expect(roadmaps).toHaveLength(0);
    expect(failedRepos).toHaveLength(0);
  });

  it('skips results with no matching repo at index', () => {
    const results: PromiseSettledResult<{ roadmaps: { id: string }[] }>[] = [
      { status: 'fulfilled', value: { roadmaps: [{ id: 'r1' }] } },
    ] as any;
    const { roadmaps, failedRepos } = mergeRepoRoadmaps(results as any, []); // no repos
    expect(roadmaps).toHaveLength(0);
    expect(failedRepos).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// filterBySelectedRepos
// ---------------------------------------------------------------------------

describe('filterBySelectedRepos', () => {
  const repoA = makeRepoChoice({ repoId: 'a', repoPath: '/a', repoLabel: 'A' });
  const repoB = makeRepoChoice({ repoId: 'b', repoPath: '/b', repoLabel: 'B' });
  const repoNoId = makeRepoChoice({ repoId: '', repoPath: '/c', repoLabel: 'C' });

  const r1 = makeRoadmap('r1', repoA);
  const r2 = makeRoadmap('r2', repoB);
  const r3 = makeRoadmap('r3', repoNoId);

  it('includes roadmaps from selected repos', () => {
    const set = new Set(['/a|a']);
    const result = filterBySelectedRepos([r1, r2], set);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('r1');
  });

  it('excludes roadmaps from deselected repos', () => {
    const set = new Set(['/b|b']);
    const result = filterBySelectedRepos([r1, r2], set);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('r2');
  });

  it('handles empty selected set', () => {
    const result = filterBySelectedRepos([r1, r2], new Set());
    expect(result).toHaveLength(0);
  });

  it('handles empty repoId with compound key', () => {
    const set = new Set(['/c|']);
    const result = filterBySelectedRepos([r3], set);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('r3');
  });

  it('selects all when all repo keys are in the set', () => {
    const set = new Set(['/a|a', '/b|b']);
    const result = filterBySelectedRepos([r1, r2], set);
    expect(result).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// sortRoadmaps
// ---------------------------------------------------------------------------

describe('sortRoadmaps', () => {
  const repo = makeRepoChoice();

  const older = makeRoadmap('older', repo, {
    createdAt: '2026-01-01T00:00:00Z' as any,
    updatedAt: '2026-01-01T00:00:00Z' as any,
  });
  const newer = makeRoadmap('newer', repo, {
    createdAt: '2026-06-01T00:00:00Z' as any,
    updatedAt: '2026-06-01T00:00:00Z' as any,
  });
  const nullDates = makeRoadmap('nulls', repo, {
    createdAt: null as any,
    updatedAt: null as any,
  });

  it('sorts by updatedAt descending by default', () => {
    const result = sortRoadmaps([older, newer], 'updated');
    expect(result.map((r) => r.id)).toEqual(['newer', 'older']);
  });

  it('preserves input order for equal dates (stable sort)', () => {
    const aSame = makeRoadmap('a', repo, { createdAt: '2026-01-01T00:00:00Z' as any, updatedAt: '2026-01-01T00:00:00Z' as any });
    const bSame = makeRoadmap('b', repo, { createdAt: '2026-01-01T00:00:00Z' as any, updatedAt: '2026-01-01T00:00:00Z' as any });
    const result = sortRoadmaps([aSame, bSame], 'created');
    expect(result[0].id).toBe('a');
    expect(result[1].id).toBe('b');
  });

  it('sorts null dates to the end', () => {
    const result = sortRoadmaps([nullDates, newer, older], 'updated');
    expect(result.map((r) => r.id)).toEqual(['newer', 'older', 'nulls']);
  });

  it('sorts null dates to end when all are null', () => {
    const allNull = [
      makeRoadmap('a', repo, { createdAt: null as any, updatedAt: null as any }),
      makeRoadmap('b', repo, { createdAt: null as any, updatedAt: null as any }),
    ];
    const result = sortRoadmaps(allNull, 'updated');
    expect(result[0].id).toBe('a');
    expect(result[1].id).toBe('b');
  });

  it('sorts by createdAt when mode is "created"', () => {
    const createdNewer = makeRoadmap('cn', repo, {
      createdAt: '2026-06-01T00:00:00Z' as any,
      updatedAt: '2026-01-01T00:00:00Z' as any,
    });
    const createdOlder = makeRoadmap('co', repo, {
      createdAt: '2026-01-01T00:00:00Z' as any,
      updatedAt: '2026-06-01T00:00:00Z' as any,
    });
    const result = sortRoadmaps([createdOlder, createdNewer], 'created');
    expect(result.map((r) => r.id)).toEqual(['cn', 'co']);
  });

  it('handles empty array', () => {
    expect(sortRoadmaps([], 'updated')).toHaveLength(0);
  });
});
