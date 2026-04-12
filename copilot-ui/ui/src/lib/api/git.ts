import { apiRequest } from './core';

export interface GitStatusResponse {
  branch: string;
  files: Array<{ status: string; path: string }>;
  clean: boolean;
}

export interface GitDiffResponse {
  diff: string;
  staged: boolean;
}

export interface GitLogResponse {
  commits: Array<{ hash: string; message: string }>;
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
