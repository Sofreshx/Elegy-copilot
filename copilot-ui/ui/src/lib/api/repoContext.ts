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

export function getRepoContextCheck(
  repoPath: string,
  baseUrl?: string,
): Promise<DriftCheckResponse> {
  return apiRequest<DriftCheckResponse>(
    `/api/repo-context/check?repo=${encodeURIComponent(repoPath)}`,
    { baseUrl },
  );
}
