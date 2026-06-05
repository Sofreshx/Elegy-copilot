import { apiRequest } from './core';

export interface RepoDocEntry {
  path: string;
  name: string;
  size: number;
  modifiedAt: string;
}

export interface RepoDocsListResponse {
  repoPath: string;
  files: RepoDocEntry[];
  count: number;
}

export interface RepoDocReadResponse {
  path: string;
  name: string;
  content: string;
  size: number;
  modifiedAt: string;
}

export async function listRepoDocs(repoPath: string, baseUrl?: string): Promise<RepoDocsListResponse> {
  const url = `/api/repo-docs/list?repoPath=${encodeURIComponent(repoPath)}`;
  return apiRequest<RepoDocsListResponse>(url, { baseUrl });
}

export async function readRepoDoc(repoPath: string, docPath: string, baseUrl?: string): Promise<RepoDocReadResponse> {
  const url = `/api/repo-docs/read?repoPath=${encodeURIComponent(repoPath)}&path=${encodeURIComponent(docPath)}`;
  return apiRequest<RepoDocReadResponse>(url, { baseUrl });
}
