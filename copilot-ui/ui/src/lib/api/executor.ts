import type {
  CancelExecutorJobResponse,
  CreateExecutorJobPayload,
  CreateExecutorJobResponse,
  ExecutorHealthResponse,
  ExecutorJobsResponse,
  ExecutorRunsResponse,
  ExecutorWorktreeRecord,
  ExecutorWorktreesResponse,
  ResolveExecutorWorktreePayload,
  ResolveExecutorWorktreeResponse,
  TriggerExecutorJobResponse,
} from '../types';
import {
  apiRequest,
  asArray,
  asRecord,
  asTrimmedString,
  normalizeExecutorHealthResponse,
  normalizeExecutorJob,
  normalizeExecutorJobsResponse,
  normalizeExecutorRun,
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

export async function createExecutorJob(
  payload: CreateExecutorJobPayload,
  baseUrl?: string
): Promise<CreateExecutorJobResponse> {
  const response = await apiRequest<unknown>('/api/executor/jobs', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const record = asRecord(response);
  const job = normalizeExecutorJob(record.job);
  if (!job) {
    throw new Error('invalid_executor_job_response');
  }
  return {
    job,
    run: normalizeExecutorRun(record.run),
  };
}

export async function triggerExecutorJob(jobId: string, baseUrl?: string): Promise<TriggerExecutorJobResponse> {
  const response = await apiRequest<unknown>(`/api/executor/jobs/${encodeURIComponent(jobId)}/trigger`, {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  const record = asRecord(response);
  const run = normalizeExecutorRun(record.run);
  if (!run) {
    throw new Error('invalid_executor_run_response');
  }
  return { run };
}

export async function cancelExecutorJob(jobId: string, baseUrl?: string): Promise<CancelExecutorJobResponse> {
  const response = await apiRequest<unknown>(`/api/executor/jobs/${encodeURIComponent(jobId)}/cancel`, {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  const record = asRecord(response);
  const job = normalizeExecutorJob(record.job);
  if (!job) {
    throw new Error('invalid_executor_job_response');
  }
  return {
    job,
    run: normalizeExecutorRun(record.run),
  };
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

export async function resolveExecutorWorktree(
  payload: ResolveExecutorWorktreePayload,
  baseUrl?: string
): Promise<ResolveExecutorWorktreeResponse> {
  const response = await apiRequest<unknown>('/api/executor/worktrees/resolve', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const record = asRecord(response);
  return {
    repo: Object.keys(asRecord(record.repo)).length > 0 ? asRecord(record.repo) : null,
    cwd: asTrimmedString(record.cwd) || null,
    worktree: normalizeExecutorWorktreeRecord(record.worktree),
  };
}
