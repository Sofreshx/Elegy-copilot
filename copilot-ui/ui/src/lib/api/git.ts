import { apiRequest } from './core';

export interface GitStatusResponse {
  branch: string;
  files: Array<{ status: string; path: string }>;
  clean: boolean;
  repoRoot?: string | null;
  stagedCount?: number;
  unstagedCount?: number;
  ahead?: number;
  behind?: number;
  upstream?: string | null;
  remoteName?: string | null;
}

export interface GitDiffResponse {
  diff: string;
  staged: boolean;
}

export interface GitLogResponse {
  commits: Array<{ hash: string; message: string; author?: string | null; authoredAt?: string | null }>;
}

export interface GitBranchEntry {
  name: string;
  current: boolean;
  remote: boolean;
  upstream: string | null;
}

export interface GitBranchesResponse {
  currentBranch: string | null;
  branches: GitBranchEntry[];
}

export interface GitPullRequestResponse {
  available: boolean;
  tool: 'gh' | null;
  authenticated: boolean;
  pullRequest: {
    number: number;
    url: string;
    state: string;
  } | null;
  error?: string | null;
}

export interface GitSummaryResponse {
  branch: string | null;
  clean: boolean;
  changedFiles: number;
  stagedFiles: number;
  additions: number;
  deletions: number;
  ahead: number;
  behind: number;
  upstream: string | null;
  remoteName: string | null;
  remoteLabel: string | null;
  hasRemote: boolean;
  pullRequest: GitPullRequestResponse['pullRequest'];
}

export async function getGitStatus(repoPath: string, baseUrl?: string): Promise<GitStatusResponse> {
  const url = `/api/git/status?repoPath=${encodeURIComponent(repoPath)}`;
  return apiRequest<GitStatusResponse>(url, { baseUrl });
}

export async function getGitDiff(repoPath: string, staged = false, baseUrl?: string): Promise<GitDiffResponse> {
  const url = `/api/git/diff?repoPath=${encodeURIComponent(repoPath)}&staged=${staged}`;
  return apiRequest<GitDiffResponse>(url, { baseUrl });
}

export async function getGitLog(repoPath: string, baseUrl?: string): Promise<GitLogResponse> {
  const url = `/api/git/log?repoPath=${encodeURIComponent(repoPath)}`;
  return apiRequest<GitLogResponse>(url, { baseUrl });
}

export async function getGitBranches(repoPath: string, baseUrl?: string): Promise<GitBranchesResponse> {
  const url = `/api/git/branches?repoPath=${encodeURIComponent(repoPath)}`;
  return apiRequest<GitBranchesResponse>(url, { baseUrl });
}

export async function getGitSummary(repoPath: string, baseUrl?: string): Promise<GitSummaryResponse> {
  const url = `/api/git/summary?repoPath=${encodeURIComponent(repoPath)}`;
  return apiRequest<GitSummaryResponse>(url, { baseUrl });
}

export async function getGitPullRequest(repoPath: string, baseUrl?: string): Promise<GitPullRequestResponse> {
  const url = `/api/git/pull-request?repoPath=${encodeURIComponent(repoPath)}`;
  return apiRequest<GitPullRequestResponse>(url, { baseUrl });
}

export async function stageGitFiles(repoPath: string, files?: string[], baseUrl?: string): Promise<{ staged: boolean }> {
  return apiRequest<{ staged: boolean }>('/api/git/stage', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoPath, files: files ?? [] }),
  });
}

export async function unstageGitFiles(repoPath: string, files?: string[], baseUrl?: string): Promise<{ unstaged: boolean }> {
  return apiRequest<{ unstaged: boolean }>('/api/git/unstage', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoPath, files: files ?? [] }),
  });
}

export async function commitGit(repoPath: string, message: string, baseUrl?: string): Promise<{ committed: boolean; output: string }> {
  return apiRequest<{ committed: boolean; output: string }>('/api/git/commit', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoPath, message }),
  });
}

export async function checkoutGitBranch(
  repoPath: string,
  payload: { branchName: string; create?: boolean; startPoint?: string | null },
  baseUrl?: string,
): Promise<{ checkedOut: boolean; branch: string }> {
  return apiRequest<{ checkedOut: boolean; branch: string }>('/api/git/checkout', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoPath, ...payload }),
  });
}

export async function pullGit(repoPath: string, baseUrl?: string): Promise<{ pulled: boolean; output: string }> {
  return apiRequest<{ pulled: boolean; output: string }>('/api/git/pull', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoPath }),
  });
}

export async function pushGit(
  repoPath: string,
  payload: { setUpstream?: boolean } = {},
  baseUrl?: string,
): Promise<{ pushed: boolean; output: string }> {
  return apiRequest<{ pushed: boolean; output: string }>('/api/git/push', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoPath, ...payload }),
  });
}

export async function createGitPullRequest(
  repoPath: string,
  payload: { title?: string; body?: string; base?: string; head?: string },
  baseUrl?: string,
): Promise<{ created: boolean; pullRequest: { number: number; url: string; state: string } }> {
  return apiRequest<{ created: boolean; pullRequest: { number: number; url: string; state: string } }>('/api/git/pull-request', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoPath, ...payload }),
  });
}
