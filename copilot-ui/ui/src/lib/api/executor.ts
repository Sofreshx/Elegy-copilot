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
