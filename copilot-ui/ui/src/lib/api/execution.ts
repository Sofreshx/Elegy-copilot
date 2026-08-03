import { apiRequest } from './core';

export type ExecutionRunStatus = 'starting' | 'running' | 'stopping' | 'done' | 'failed' | 'stopped';
export type ExecutionRunKind = 'command' | 'setup';

export interface ExecutionCommandSource {
  kind: 'readme';
  docPath: string;
  line: number;
}

export interface ExecutionCommand {
  id: string;
  kind: string;
  command: string;
  args: string[];
  label: string;
  description: string;
  category: string;
  longRunning: boolean;
  source?: ExecutionCommandSource | null;
}

export interface ExecutionCategory {
  id: string;
  label: string;
  commands: ExecutionCommand[];
}

export interface ExecutionDiscovery {
  schemaVersion: number;
  repoPath: string;
  detectedAt: string;
  sources: Array<{ path: string; mtime: string }>;
  setup: { id: string; label: string } | null;
  categories: ExecutionCategory[];
  meta: { total: number; skipped: number };
}

export type ExecutionSetupStatus = 'not-started' | 'running' | 'done' | 'failed';

export interface ExecutionSetupState {
  status: ExecutionSetupStatus;
  runId?: string;
  lastRunAt?: string;
  lastExitCode?: number;
}

export interface ExecutionRun {
  runId: string;
  repoPath: string;
  kind: ExecutionRunKind;
  commandId: string | null;
  command: string;
  args: string[];
  status: ExecutionRunStatus;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  startedAt: string;
  finishedAt: string | null;
}

export interface ExecutionRunOutcome {
  lastRunAt: string;
  lastExitCode: number;
}

export interface ExecutionOverview {
  repoPath: string;
  discovery: ExecutionDiscovery;
  setup: ExecutionSetupState;
  activeRun: ExecutionRun | null;
  lastRuns: Record<string, ExecutionRunOutcome>;
}

export interface ExecutionRunResponse {
  runId: string;
  run: ExecutionRun;
}

export async function getExecutionOverview(repoPath: string): Promise<ExecutionOverview> {
  return apiRequest('/api/execution/overview', { query: { repoPath } });
}

export async function refreshExecutionCommands(repoPath: string): Promise<ExecutionOverview['discovery']> {
  const response = await apiRequest<{ discovery: ExecutionOverview['discovery'] }>('/api/execution/refresh', {
    method: 'POST',
    query: { repoPath },
  });
  return response.discovery;
}

export async function runExecutionCommand(repoPath: string, commandId: string): Promise<ExecutionRunResponse> {
  return apiRequest('/api/execution/run', {
    method: 'POST',
    query: { repoPath },
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ repoPath, commandId }),
  });
}

export async function startExecutionSetup(repoPath: string): Promise<ExecutionRunResponse> {
  return apiRequest('/api/execution/setup', {
    method: 'POST',
    query: { repoPath },
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ repoPath }),
  });
}

export async function getExecutionRun(runId: string): Promise<ExecutionRun> {
  const response = await apiRequest<{ run: ExecutionRun }>(`/api/execution/runs/${encodeURIComponent(runId)}`);
  return response.run;
}

export async function stopExecutionRun(runId: string): Promise<ExecutionRun> {
  const response = await apiRequest<{ run: ExecutionRun }>(`/api/execution/runs/${encodeURIComponent(runId)}/stop`, {
    method: 'POST',
  });
  return response.run;
}

export function isExecutionRunActive(status: ExecutionRunStatus | null | undefined): boolean {
  return status === 'running' || status === 'stopping';
}
