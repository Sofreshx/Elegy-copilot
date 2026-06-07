import { apiRequest } from './core';

export interface RepoDocTreeFileNode {
  name: string;
  path: string;
  kind: 'file';
  size?: number;
  modifiedAt?: string;
  isSymlink?: boolean;
  resolvedPath?: string;
  blockedReason?: string;
  fileKind?: 'doc' | 'agent' | 'skill' | 'config' | 'manifest';
  harness?: string;
}

export interface RepoDocTreeDirNode {
  name: string;
  path: string;
  kind: 'directory';
  children: RepoDocTreeNode[];
  collapsed?: boolean;
  dirKind?: 'specs' | 'docs' | 'skills' | 'agents' | 'harness' | 'root';
}

export type RepoDocTreeNode = RepoDocTreeFileNode | RepoDocTreeDirNode;

export interface RepoDocsTreeResponse {
  repoPath: string;
  tree: RepoDocTreeNode[];
  totalFiles: number;
  totalDirs: number;
}

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

export async function listRepoDocsTree(repoPath: string, baseUrl?: string): Promise<RepoDocsTreeResponse> {
  const url = `/api/repo-docs/tree?repoPath=${encodeURIComponent(repoPath)}`;
  return apiRequest<RepoDocsTreeResponse>(url, { baseUrl });
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
