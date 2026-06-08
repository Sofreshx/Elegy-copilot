import { apiRequest } from './core';

export interface WorkspaceCommand {
  id: string;
  label: string;
  kind: string;
  command: string;
  args: string[];
  cwd?: string;
  description?: string;
  confirm: boolean;
  longRunning: boolean;
  envProfile?: string;
  detected?: boolean;
}

export interface WorkspaceCommandsResponse {
  repoPath: string;
  commands: WorkspaceCommand[];
  detected: WorkspaceCommand[];
  hasConfig: boolean;
}

export interface WorkspaceCommandRunResponse {
  commandId: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface WorkspaceLauncher {
  id: string;
  label: string;
  group: string;
  command: string;
  available: boolean;
  reason?: string;
}

export interface WorkspaceLaunchersResponse {
  launchers: WorkspaceLauncher[];
}

export interface WorkspaceLaunchResponse {
  ok: boolean;
  launcherId: string;
  repoPath: string;
}

export interface PinnedCommand {
  id: string;
  label: string;
  kind: string;
  command: string;
  args: string[];
  cwd?: string;
  confirm: boolean;
  longRunning: boolean;
  sourceDocPath?: string;
  sourceBlockId?: string;
  sourceDocHash?: string;
  createdAt: string;
  lastRunAt?: string;
  lastExitCode?: number;
  pinnedBySourceHash?: string;
  description?: string;
}

export interface PinnedCommandsResponse {
  commands: PinnedCommand[];
}

export async function getPinnedCommands(repoPath: string, baseUrl?: string): Promise<PinnedCommandsResponse> {
  const url = `/api/workspace/pinned-commands?repoPath=${encodeURIComponent(repoPath)}`;
  return apiRequest<PinnedCommandsResponse>(url, { baseUrl });
}

export async function createPinnedCommand(
  repoPath: string,
  command: Omit<PinnedCommand, 'createdAt'> & { createdAt?: string },
  baseUrl?: string,
): Promise<{ ok: boolean; command: PinnedCommand; error?: string }> {
  return apiRequest<{ ok: boolean; command: PinnedCommand; error?: string }>(
    '/api/workspace/pinned-commands',
    {
      baseUrl,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoPath, command }),
    },
  );
}

export async function deletePinnedCommand(
  repoPath: string,
  commandId: string,
  baseUrl?: string,
): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>(
    `/api/workspace/pinned-commands/${encodeURIComponent(commandId)}`,
    {
      baseUrl,
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoPath, commandId }),
    },
  );
}

export async function getWorkspaceCommands(repoPath: string, baseUrl?: string): Promise<WorkspaceCommandsResponse> {
  const url = `/api/workspace/commands?repoPath=${encodeURIComponent(repoPath)}`;
  return apiRequest<WorkspaceCommandsResponse>(url, { baseUrl });
}

export async function runWorkspaceCommand(repoPath: string, commandId: string, baseUrl?: string): Promise<WorkspaceCommandRunResponse> {
  return apiRequest<WorkspaceCommandRunResponse>('/api/workspace/commands/run', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoPath, commandId }),
  });
}

export async function getWorkspaceLaunchers(baseUrl?: string): Promise<WorkspaceLaunchersResponse> {
  return apiRequest<WorkspaceLaunchersResponse>('/api/workspace/launchers', { baseUrl });
}

export async function launchWorkspace(launcherId: string, repoPath: string, baseUrl?: string): Promise<WorkspaceLaunchResponse> {
  return apiRequest<WorkspaceLaunchResponse>('/api/workspace/launch', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ launcherId, repoPath }),
  });
}
