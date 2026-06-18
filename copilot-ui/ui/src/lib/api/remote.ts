/**
 * API client for Kimaki remote session endpoints.
 */

export interface RemoteStatus {
  state: 'idle' | 'awaiting_install' | 'awaiting_auth' | 'ready' | 'error' | 'unavailable';
  installUrl: string | null;
  guildIds: string[];
  appId: string | null;
  dataDir: string;
  lastError: string | null;
}

export interface RemoteProject {
  directory: string;
  guildId?: string;
  channelId?: string;
  lastActivity?: string;
}

export interface RemoteSession {
  threadId: string;
  threadName: string;
  status: string;
  project: string;
  guildId?: string;
  channelId?: string;
  createdAt: string;
  updatedAt: string;
}

export async function getRemoteStatus(): Promise<RemoteStatus> {
  const res = await fetch('/api/remote/status');
  if (!res.ok) throw new Error(`Failed to get remote status: ${res.status}`);
  return res.json();
}

export async function listRemoteProjects(): Promise<{ projects: RemoteProject[] }> {
  const res = await fetch('/api/remote/projects');
  if (!res.ok) throw new Error(`Failed to list projects: ${res.status}`);
  return res.json();
}

export async function listRemoteSessions(opts?: { project?: string; limit?: number }): Promise<{ sessions: RemoteSession[] }> {
  const params = new URLSearchParams();
  if (opts?.project) params.set('project', opts.project);
  if (opts?.limit) params.set('limit', String(opts.limit));
  const query = params.toString();
  const res = await fetch(`/api/remote/sessions${query ? `?${query}` : ''}`);
  if (!res.ok) throw new Error(`Failed to list sessions: ${res.status}`);
  return res.json();
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
  if (!res.ok) throw new Error(`Failed to send prompt: ${res.status}`);
  return res.json();
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
  if (!res.ok) throw new Error(`Failed to add project: ${res.status}`);
  return res.json();
}

export async function removeRemoteProject(body: {
  directory: string;
}): Promise<{ success: boolean; result: unknown }> {
  const res = await fetch('/api/remote/projects/remove', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Failed to remove project: ${res.status}`);
  return res.json();
}

export async function getRemoteLogs(tail = 50): Promise<{ lines: string[] }> {
  const res = await fetch(`/api/remote/logs?tail=${tail}`);
  if (!res.ok) throw new Error(`Failed to get logs: ${res.status}`);
  return res.json();
}
