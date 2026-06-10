import type { EnrichedWorktreesResponse, PlanningSummaryResponse } from '../types';

const BASE = '/api/elegy-db';

export async function getEnrichedWorktrees(repoPath: string): Promise<EnrichedWorktreesResponse> {
  const url = `${BASE}/worktrees/enriched?repoPath=${encodeURIComponent(repoPath)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to get enriched worktrees: ${res.status}`);
  return res.json();
}

export async function getPlanningSummary(repoPath: string): Promise<PlanningSummaryResponse> {
  const url = `${BASE}/planning/summary?repoPath=${encodeURIComponent(repoPath)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to get planning summary: ${res.status}`);
  return res.json();
}

// getHealth is available from '../api/health'
