import type { PlanningLiveRoadmapSummary, PlanningLiveRoadmapsResponse } from '../../lib/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Normalised repo choice (sources excluded — not needed for explorer view). */
export interface RepoChoice {
  repoId: string;
  repoPath: string;
  repoLabel: string;
}

/** A roadmap augmented with the repo it was fetched from. */
export type AugmentedRoadmap = PlanningLiveRoadmapSummary & { _repoSource: RepoChoice };

// ---------------------------------------------------------------------------
// R6.1 — Normalise raw repo entries
// ---------------------------------------------------------------------------

/**
 * Normalises raw repo inventory entries into `RepoChoice` objects.
 * Replicates the logic from `normalizeCatalogRepoEntry` (PlanningAuthorityView.tsx:50-68)
 * and then applies a SECOND stricter filter requiring at least `repoId` OR `repoPath`.
 */
export function normalizeRepoEntries(repos: unknown[]): RepoChoice[] {
  return repos
    .map((repo) => {
      if (!repo || typeof repo !== 'object') return null;

      const record = repo as Record<string, unknown>;
      const repoId = typeof record.repoId === 'string' ? record.repoId.trim() : '';
      const repoPath = typeof record.repoPath === 'string' ? record.repoPath.trim() : '';
      const repoLabel = typeof record.repoLabel === 'string' ? record.repoLabel.trim() : '';
      const sources = Array.isArray(record.sources)
        ? record.sources.map((entry) => String(entry || '').trim()).filter(Boolean)
        : [];

      // Pass 1: same filter as normalizeCatalogRepoEntry
      if (!repoId && !repoPath && !repoLabel && sources.length === 0) {
        return null;
      }

      // Pass 2: require at least repoId OR repoPath (need a scope for API calls)
      if (!repoId && !repoPath) {
        return null;
      }

      return { repoId, repoPath, repoLabel };
    })
    .filter((entry): entry is RepoChoice => entry !== null);
}

// ---------------------------------------------------------------------------
// R6.2 — Resolve repo display label
// ---------------------------------------------------------------------------

/**
 * Returns the best human-readable label for a repo.
 * Falls back: repoLabel → repoId → repoPath → "Unknown repo".
 */
export function resolveRepoLabel(
  repo: { repoLabel?: string | null; repoId?: string | null; repoPath?: string | null },
): string {
  if (typeof repo.repoLabel === 'string' && repo.repoLabel.trim()) {
    return repo.repoLabel.trim();
  }
  if (typeof repo.repoId === 'string' && repo.repoId.trim()) {
    return repo.repoId.trim();
  }
  if (typeof repo.repoPath === 'string' && repo.repoPath.trim()) {
    return repo.repoPath.trim();
  }
  return 'Unknown repo';
}

// ---------------------------------------------------------------------------
// R6.3 — Merge multi-repo roadmap fetches
// ---------------------------------------------------------------------------

/**
 * Merges Promise.allSettled results from per-repo `listPlanningLiveRoadmaps` calls.
 * Returns the merged roadmap list (each augmented with `_repoSource`) and the list
 * of repos whose fetch failed.
 */
export function mergeRepoRoadmaps(
  results: PromiseSettledResult<PlanningLiveRoadmapsResponse>[],
  reposByIndex: RepoChoice[],
): { roadmaps: AugmentedRoadmap[]; failedRepos: RepoChoice[] } {
  const roadmaps: AugmentedRoadmap[] = [];
  const failedRepos: RepoChoice[] = [];

  for (let i = 0; i < Math.max(results.length, reposByIndex.length); i++) {
    const result = results[i];
    const repo = reposByIndex[i];
    if (!repo) continue;

    if (result?.status === 'fulfilled') {
      const items = Array.isArray(result.value.roadmaps) ? result.value.roadmaps : [];
      for (const item of items) {
        roadmaps.push({ ...item, _repoSource: repo });
      }
    } else {
      failedRepos.push(repo);
    }
  }

  return { roadmaps, failedRepos };
}

// ---------------------------------------------------------------------------
// R6.4 — Filter by selected repos
// ---------------------------------------------------------------------------

/**
 * Filters roadmaps to only those whose source repo compound key is in the set.
 * Compound key format: `${repoPath}|${repoId}` — handles empty repoId values.
 */
export function filterBySelectedRepos(
  roadmaps: AugmentedRoadmap[],
  selectedRepoKeys: Set<string>,
): AugmentedRoadmap[] {
  return roadmaps.filter((r) => {
    const key = `${r._repoSource.repoPath}|${r._repoSource.repoId}`;
    return selectedRepoKeys.has(key);
  });
}

// ---------------------------------------------------------------------------
// R6.5 — Sort roadmaps by date
// ---------------------------------------------------------------------------

/**
 * Sorts roadmaps by the specified date field in descending order.
 * Items with null/missing dates sort to the end. Stable sort within each group.
 */
export function sortRoadmaps(
  roadmaps: AugmentedRoadmap[],
  by: 'created' | 'updated',
): AugmentedRoadmap[] {
  const field = by === 'created' ? 'createdAt' : 'updatedAt';
  const sorted = [...roadmaps];

  sorted.sort((a, b) => {
    const aDate = typeof a[field] === 'string' ? Date.parse(a[field]) : NaN;
    const bDate = typeof b[field] === 'string' ? Date.parse(b[field]) : NaN;
    const aValid = Number.isFinite(aDate);
    const bValid = Number.isFinite(bDate);

    if (aValid && bValid) {
      return bDate - aDate; // descending
    }
    if (aValid) return -1; // a before b (valid before null)
    if (bValid) return 1;  // b before a
    return 0; // both null — preserve original order (stable)
  });

  return sorted;
}
