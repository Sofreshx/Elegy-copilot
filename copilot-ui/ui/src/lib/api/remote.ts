/**
 * API client for Kimaki remote session endpoints.
 */

export interface RemoteStatus {
  state: 'idle' | 'starting' | 'awaiting_install' | 'awaiting_auth' | 'ready' | 'restarting' | 'error' | 'unavailable';
  available: boolean;
  ready: boolean;
  enabled: boolean;
  pid: number | null;
  uptimeMs: number | null;
  phase: string;
  reason: string | null;
  message: string;
  runtime: 'node' | 'rust';
  installUrl: string | null;
  guildIds: string[];
  appId: string | null;
  dataDir: string | null;
  lastError: string | null;
}

async function readRemoteResponse<T>(res: Response, fallback: string): Promise<T> {
  const body = await res.json().catch(() => null) as { message?: string } | null;
  if (!res.ok) {
    throw new Error(body?.message || fallback);
  }
  return body as T;
}

export interface RemoteProject {
  directory: string;
  guildId?: string;
  channelId?: string;
  lastActivity?: string;
}

export interface RemoteSession {
  threadId: string | null;
  sessionId?: string;
  threadName: string;
  source: 'opencode' | 'kimaki';
  syncStatus: 'pending' | 'connected';
  project: string;
  guildId?: string | null;
  channelId?: string;
  discordUrl?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export async function getRemoteStatus(): Promise<RemoteStatus> {
  const res = await fetch('/api/remote/status');
  return readRemoteResponse(res, `Failed to get remote status: ${res.status}`);
}

export async function restartRemoteRuntime(): Promise<{ success: boolean; state: RemoteStatus['state'] }> {
  const res = await fetch('/api/remote/restart', { method: 'POST' });
  return readRemoteResponse(res, `Failed to restart remote runtime: ${res.status}`);
}

export async function listRemoteProjects(): Promise<{ projects: RemoteProject[] }> {
  const res = await fetch('/api/remote/projects');
  return readRemoteResponse(res, `Failed to list projects: ${res.status}`);
}

export async function listRemoteSessions(opts?: { project?: string; limit?: number }): Promise<{ sessions: RemoteSession[] }> {
  const params = new URLSearchParams();
  if (opts?.project) params.set('project', opts.project);
  if (opts?.limit) params.set('limit', String(opts.limit));
  const query = params.toString();
  const res = await fetch(`/api/remote/sessions${query ? `?${query}` : ''}`);
  return readRemoteResponse(res, `Failed to list sessions: ${res.status}`);
}

export async function sendRemotePrompt(body: {
  project: string;
  prompt: string;
  threadId?: string;
  permission?: string[];
}): Promise<{ success: boolean; result: unknown }> {
  const res = await fetch('/api/remote/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return readRemoteResponse(res, `Failed to send prompt: ${res.status}`);
}

export async function addRemoteProject(body: {
  directory: string;
  guildId?: string;
}): Promise<{ success: boolean; result: unknown }> {
  const res = await fetch('/api/remote/projects/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return readRemoteResponse(res, `Failed to add project: ${res.status}`);
}

export async function getRemoteLogs(tail = 50): Promise<{ lines: string[] }> {
  const res = await fetch(`/api/remote/logs?tail=${tail}`);
  return readRemoteResponse(res, `Failed to get logs: ${res.status}`);
}

export async function renameRemoteSession(body: {
  sessionId: string;
  title: string;
}): Promise<{ ok: boolean; sessionId: string; title: string }> {
  const res = await fetch('/api/remote/sessions/rename', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return readRemoteResponse(res, `Failed to rename session: ${res.status}`);
}

export async function getRemoteSessionsConfig(): Promise<{ enabled: boolean }> {
  const res = await fetch('/api/config/remote-sessions');
  return readRemoteResponse(res, `Failed to get remote sessions config: ${res.status}`);
}

export async function enableRemoteSessions(): Promise<{ ok: boolean; enabled: boolean; state: string }> {
  const res = await fetch('/api/remote/enable', { method: 'POST' });
  return readRemoteResponse(res, `Failed to enable remote sessions: ${res.status}`);
}

export async function disableRemoteSessions(): Promise<{ ok: boolean; enabled: boolean; state: string }> {
  const res = await fetch('/api/remote/disable', { method: 'POST' });
  return readRemoteResponse(res, `Failed to disable remote sessions: ${res.status}`);
}
