import type {
  ExecutorHealthResponse,
  ExecutorJobsResponse,
  ExecutorRunsResponse,
  ExecutorWorktreeRecord,
  ExecutorWorktreesResponse,
  ExecutorWorktreeDiscovery,
} from '../types';
import {
  apiRequest,
  asArray,
  asRecord,
  normalizeExecutorHealthResponse,
  normalizeExecutorJobsResponse,
  normalizeExecutorRunsResponse,
  normalizeExecutorWorktreeRecord,
  normalizeExecutorWorktreeDiscovery,
} from './core';

export async function getExecutorHealth(baseUrl?: string): Promise<ExecutorHealthResponse> {
  const payload = await apiRequest<unknown>('/api/executor/health', { baseUrl });
  return normalizeExecutorHealthResponse(payload);
}

export async function listExecutorJobs(baseUrl?: string): Promise<ExecutorJobsResponse> {
  const payload = await apiRequest<unknown>('/api/executor/jobs', { baseUrl });
  return normalizeExecutorJobsResponse(payload);
}

export async function listExecutorRuns(baseUrl?: string): Promise<ExecutorRunsResponse> {
  const payload = await apiRequest<unknown>('/api/executor/runs', { baseUrl });
  return normalizeExecutorRunsResponse(payload);
}

export interface ListExecutorWorktreesOptions {
  baseUrl?: string;
  repoId?: string;
  repoPath?: string;
  includeGit?: boolean;
}

export async function listExecutorWorktrees(
  options: ListExecutorWorktreesOptions | string | undefined = {},
): Promise<ExecutorWorktreesResponse> {
  const opts: ListExecutorWorktreesOptions = typeof options === 'string'
    ? { repoId: options }
    : (options || {});
  const payload = await apiRequest<unknown>('/api/executor/worktrees', {
    baseUrl: opts.baseUrl,
    query: {
      repoId: opts.repoId || undefined,
      repoPath: opts.repoPath || undefined,
      includeGit: opts.includeGit === false ? 'false' : undefined,
    },
  });
  const record = asRecord(payload);
  return {
    worktrees: asArray(record.worktrees)
      .map((entry) => normalizeExecutorWorktreeRecord(entry))
      .filter((entry): entry is ExecutorWorktreeRecord => entry !== null),
    worktreeDiscovery: normalizeExecutorWorktreeDiscovery(record.worktreeDiscovery),
  };
}

// ─── Cleanup endpoints ──────────────────────────────────────────────────────

export interface WorktreeCleanupAnalyzeResponse {
  eligible: boolean;
  reason: string;
  dirty: boolean;
  dirtyFiles: number;
  missing: boolean;
  assigned: boolean;
  mergedIntoCurrentOrDefault: boolean;
  conflicts: boolean;
  conflictFiles: string[];
  diagnostics: string[];
  branch: string;
  repoPath: string;
  worktreePath: string;
}

export interface WorktreeCleanupRemoveResponse {
  removed: boolean;
  worktreePath: string;
  repoPath: string;
  output?: string;
  error?: string;
}

export interface WorktreePruneResponse {
  pruned: boolean;
  repoPath: string;
  output?: string;
  diagnostics?: string[];
  error?: string;
}

export async function analyzeWorktreeCleanup(
  repoPath: string,
  worktreePath: string,
  branch?: string | null,
  baseUrl?: string,
): Promise<WorktreeCleanupAnalyzeResponse> {
  return apiRequest<WorktreeCleanupAnalyzeResponse>('/api/executor/worktrees/cleanup/analyze', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoPath, worktreePath, branch }),
  });
}

export async function removeWorktree(
  repoPath: string,
  worktreePath: string,
  force?: boolean,
  baseUrl?: string,
): Promise<WorktreeCleanupRemoveResponse> {
  return apiRequest<WorktreeCleanupRemoveResponse>('/api/executor/worktrees/cleanup/remove', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoPath, worktreePath, force: force || false }),
  });
}

export async function pruneWorktrees(
  repoPath: string,
  baseUrl?: string,
): Promise<WorktreePruneResponse> {
  return apiRequest<WorktreePruneResponse>('/api/executor/worktrees/prune', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoPath }),
  });
}

export interface WorktreeCleanupRemoveWithBranchResponse {
  removed: boolean;
  worktreePath: string;
  branch: string | null;
  branchDeleted: boolean;
  repoPath: string;
  output?: string;
  branchOutput?: string;
  error?: string;
}

export async function removeWorktreeWithBranch(
  repoPath: string,
  worktreePath: string,
  branch?: string | null,
  force?: boolean,
  baseUrl?: string,
): Promise<WorktreeCleanupRemoveWithBranchResponse> {
  return apiRequest<WorktreeCleanupRemoveWithBranchResponse>('/api/executor/worktrees/cleanup/remove-with-branch', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoPath, worktreePath, branch: branch || undefined, force: force || false }),
  });
}
