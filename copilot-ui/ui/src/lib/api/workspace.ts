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
  argsPreview?: string;
}

export interface WorkspaceLaunchersResponse {
  launchers: WorkspaceLauncher[];
}

export interface WorkspaceLaunchResponse {
  ok: boolean;
  launcherId: string;
  repoPath: string;
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
