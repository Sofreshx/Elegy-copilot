import { apiRequest } from './core';

export interface ProjectResponse {
  projectId: string;
  repoId: string;
  repoPath: string;
  repoLabel: string;
  canonicalRemote: string | null;
  pinned: boolean;
  lastActivityMs: number | null;
  sessionCount: number;
  activeSessionCount: number;
  installedAssetSummary?: {
    agents: number;
    skills: number;
  };
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface ProjectActivityResponse {
  type: string;
  timestamp: number | null;
  summary: string;
}

export interface ProjectSessionResponse {
  id: string;
  title?: string | null;
  objective?: string | null;
  status?: string | null;
  source?: string | null;
  startedAtMs?: number | null;
  updatedAtMs?: number | null;
  elapsedMs?: number | null;
}

export async function listProjects(baseUrl?: string): Promise<ProjectResponse[]> {
  return apiRequest<ProjectResponse[]>('/api/projects', { baseUrl });
}

export async function updateProject(
  projectId: string,
  payload: Partial<Pick<ProjectResponse, 'pinned' | 'canonicalRemote' | 'lastActivityMs'>>,
  baseUrl?: string,
): Promise<ProjectResponse> {
  return apiRequest<ProjectResponse>(`/api/projects/${encodeURIComponent(projectId)}`, {
    baseUrl,
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export async function listProjectSessions(projectId: string, baseUrl?: string): Promise<ProjectSessionResponse[]> {
  return apiRequest<ProjectSessionResponse[]>(`/api/projects/${encodeURIComponent(projectId)}/sessions`, {
    baseUrl,
  });
}

export async function listProjectActivity(projectId: string, baseUrl?: string): Promise<ProjectActivityResponse[]> {
  return apiRequest<ProjectActivityResponse[]>(`/api/projects/${encodeURIComponent(projectId)}/activity`, {
    baseUrl,
  });
}
