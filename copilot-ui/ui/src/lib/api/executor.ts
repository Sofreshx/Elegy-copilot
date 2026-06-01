import type {
  ExecutorHealthResponse,
  ExecutorJobsResponse,
  ExecutorRunsResponse,
  ExecutorWorktreeRecord,
  ExecutorWorktreesResponse,
} from '../types';
import {
  apiRequest,
  asArray,
  asRecord,
  normalizeExecutorHealthResponse,
  normalizeExecutorJobsResponse,
  normalizeExecutorRunsResponse,
  normalizeExecutorWorktreeRecord,
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

export async function listExecutorWorktrees(baseUrl?: string, repoId?: string): Promise<ExecutorWorktreesResponse> {
  const payload = await apiRequest<unknown>('/api/executor/worktrees', {
    baseUrl,
    query: {
      repoId: repoId || undefined,
    },
  });
  const record = asRecord(payload);
  return {
    worktrees: asArray(record.worktrees)
      .map((entry) => normalizeExecutorWorktreeRecord(entry))
      .filter((entry): entry is ExecutorWorktreeRecord => entry !== null),
  };
}
