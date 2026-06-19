/**
 * API client for Kimaki remote session endpoints.
 */

export interface RemoteStatus {
  state: 'idle' | 'starting' | 'awaiting_install' | 'awaiting_auth' | 'ready' | 'restarting' | 'error' | 'unavailable';
  available: boolean;
  ready: boolean;
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
  threadId: string;
  sessionId?: string;
  threadName: string;
  source: string;
  project: string;
  guildId?: string;
  channelId?: string;
  createdAt: string;
  updatedAt: string;
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
