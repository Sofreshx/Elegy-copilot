import { apiRequest } from './core';

export interface DriftCheckResponse {
  ok: boolean;
  report?: {
    score: number;
    issues: Array<{
      code: string;
      severity: 'error' | 'warning' | 'info';
      claim: {
        type: string;
        value: string;
        negated: boolean;
        source: { file: string; line: number; section: string | null };
      } | null;
      file: string;
      line: number;
      message: string;
      suggestion: string | null;
    }>;
    fileCount: number;
    claimCount: number;
    verifiedCount: number;
    failedCount: number;
    timestamp: string;
    severityCounts?: { error: number; warning: number; info: number };
  };
  exitCode?: number;
  error?: string;
}

export interface DocsRepairIssue {
  code: string;
  severity: 'error' | 'warning' | 'info' | string;
  file: string;
  line: number;
  message: string;
  suggestion: string | null;
}

export interface DocsRepairRun {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | string;
  repoPath: string;
  repoId: string | null;
  batchSize: number;
  modelProfile: string;
  model: string;
  branch: string | null;
  worktreePath: string | null;
  commitSha: string | null;
  prUrl: string | null;
  issues: Array<DocsRepairIssue & { key?: string }>;
  issueSummary: { total: number; byCode: Record<string, number> };
  validation: {
    targetedChecks?: string[];
    selectedCount?: number;
    fixedCount?: number;
    remainingSelected?: string[];
    newEligibleErrors?: string[];
    full?: { exitCode?: number; score?: number; severityCounts?: { error: number; warning: number; info: number } | null };
    [key: string]: unknown;
  } | null;
  error: string | null;
  logs: Array<{ at: string; message: string; data?: unknown }>;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface DocsRepairStatusResponse {
  repoPath: string;
  repoId: string | null;
  concurrencyLimit: number;
  activeCount: number;
  openCodeAvailable: boolean;
  runs: DocsRepairRun[];
}

export interface DocsRepairCreateResponse {
  run: DocsRepairRun;
  status: DocsRepairStatusResponse;
}

export function getRepoContextCheck(
  repoPath: string,
  check?: string,
  baseUrl?: string,
): Promise<DriftCheckResponse> {
  const checkParam = check ? `&check=${encodeURIComponent(check)}` : '';
  return apiRequest<DriftCheckResponse>(
    `/api/repo-context/check?repo=${encodeURIComponent(repoPath)}${checkParam}`,
    { baseUrl },
  );
}

export function listDocsRepairRuns(
  repoPath: string,
  repoId?: string | null,
  baseUrl?: string,
): Promise<DocsRepairStatusResponse> {
  return apiRequest<DocsRepairStatusResponse>('/api/repo-context/repairs', {
    baseUrl,
    query: {
      repoPath,
      repoId: repoId || undefined,
    },
  });
}

export function startDocsRepairRun(
  payload: {
    repoPath: string;
    repoId?: string | null;
    issues: Array<DocsRepairIssue & { key?: string }>;
    batchSize: 20 | 50;
    filters?: { severity?: 'all' | 'error' | 'warning' | 'info' };
    modelProfile?: string;
  },
  baseUrl?: string,
): Promise<DocsRepairCreateResponse> {
  return apiRequest<DocsRepairCreateResponse>('/api/repo-context/repairs', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
