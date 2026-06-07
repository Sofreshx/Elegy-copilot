import { apiRequest } from './core';

export interface RepoDocEntry {
  path: string;
  name: string;
  size: number;
  modifiedAt: string;
  isSymlink?: boolean;
  resolvedPath?: string;
  blockedReason?: string;
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
  isSymlink?: boolean;
  resolvedPath?: string;
}

export async function listRepoDocs(repoPath: string, baseUrl?: string): Promise<RepoDocsListResponse> {
  const url = `/api/repo-docs/list?repoPath=${encodeURIComponent(repoPath)}`;
  return apiRequest<RepoDocsListResponse>(url, { baseUrl });
}

export async function readRepoDoc(repoPath: string, docPath: string, baseUrl?: string): Promise<RepoDocReadResponse> {
  const url = `/api/repo-docs/read?repoPath=${encodeURIComponent(repoPath)}&path=${encodeURIComponent(docPath)}`;
  return apiRequest<RepoDocReadResponse>(url, { baseUrl });
}

export interface GraphNode {
  id: string;
  label: string;
  path: string;
  depth: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: 'link' | 'wiki';
}

export interface RepoDocsGraphResponse {
  repoPath: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  errors?: { path: string; error: string }[];
  skipped?: { path: string; reason: string }[];
}

export async function getRepoDocsGraph(repoPath: string, baseUrl?: string): Promise<RepoDocsGraphResponse> {
  const url = `/api/repo-docs/graph?repoPath=${encodeURIComponent(repoPath)}`;
  return apiRequest<RepoDocsGraphResponse>(url, { baseUrl });
}

export interface RepoDocWriteResponse {
  path: string;
  name: string;
  size: number;
  modifiedAt: string;
}

export async function writeRepoDoc(repoPath: string, docPath: string, content: string, baseUrl?: string): Promise<RepoDocWriteResponse> {
  const url = `/api/repo-docs/write`;
  return apiRequest<RepoDocWriteResponse>(url, {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoPath, path: docPath, content }),
  });
}

export interface RepoDocDeleteResponse {
  deleted: boolean;
  path: string;
}

export async function deleteRepoDoc(repoPath: string, docPath: string, baseUrl?: string): Promise<RepoDocDeleteResponse> {
  const url = `/api/repo-docs/delete?repoPath=${encodeURIComponent(repoPath)}&path=${encodeURIComponent(docPath)}`;
  return apiRequest<RepoDocDeleteResponse>(url, { baseUrl, method: 'DELETE' });
}
