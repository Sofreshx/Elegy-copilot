import type { LocalRepoReaderAccessState } from '../types';
import { apiRequest } from './core';

export interface LocalRepoMcpConfig {
  schemaVersion?: number;
  authProvider?: 'builtin' | 'external' | string;
  port: number;
  publicBaseUrl: string;
  authIssuer: string;
  authAudience: string;
  requiredScopes: string[];
  cloudflareTunnelName: string;
  cloudflareConfigPath: string;
  cloudflaredPath: string;
  updatedAt?: string | null;
}

export interface LocalRepoMcpProcessStatus {
  running: boolean;
  pid: number | null;
  mode?: 'none' | 'quick' | 'named' | string;
  url?: string;
  publicUrl?: string;
}

export interface LocalRepoMcpStatusResponse {
  config: LocalRepoMcpConfig;
  configPath?: string;
  connectorUrl?: string;
  server: LocalRepoMcpProcessStatus;
  tunnel: LocalRepoMcpProcessStatus;
  securityState: 'Stopped' | 'Local only' | 'OAuth protected' | 'Misconfigured' | string;
  prerequisites?: {
    cloudflared: {
      available: boolean;
      path: string;
    };
    oauth: {
      provider?: 'builtin' | 'external' | string;
      issuerConfigured: boolean;
      issuerEffective?: string;
      audienceEffective: string;
    };
    chatGptAccessReady: boolean;
  };
  pending?: LocalRepoMcpPendingAuthorization[];
  probe?: {
    ok: boolean;
    status?: number;
    metadata?: unknown;
  };
}

export interface LocalRepoMcpPendingAuthorization {
  id: string;
  userCode: string;
  clientId: string;
  scope: string;
  resource: string;
  createdAt: string;
  expiresAt: string;
}

export interface LocalRepoMcpConfigResponse {
  config: LocalRepoMcpConfig;
  access: LocalRepoReaderAccessState;
}

export function getLocalRepoMcpStatus(): Promise<LocalRepoMcpStatusResponse> {
  return apiRequest<LocalRepoMcpStatusResponse>('/api/local-repo-mcp/status');
}

export function getLocalRepoMcpConfig(): Promise<LocalRepoMcpConfigResponse> {
  return apiRequest<LocalRepoMcpConfigResponse>('/api/local-repo-mcp/config');
}

export function saveLocalRepoMcpConfig(config: Partial<LocalRepoMcpConfig>): Promise<LocalRepoMcpConfigResponse> {
  return apiRequest<LocalRepoMcpConfigResponse>('/api/local-repo-mcp/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config }),
  });
}

export function addLocalRepoMcpRoot(payload: { repoId?: string | null; repoPath?: string | null; alias?: string }): Promise<LocalRepoMcpConfigResponse> {
  return apiRequest<LocalRepoMcpConfigResponse>('/api/local-repo-mcp/roots/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function removeLocalRepoMcpRoot(payload: { repoId?: string | null; repoPath?: string | null; alias?: string }): Promise<LocalRepoMcpConfigResponse> {
  return apiRequest<LocalRepoMcpConfigResponse>('/api/local-repo-mcp/roots/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function startLocalRepoMcp(): Promise<LocalRepoMcpStatusResponse> {
  return apiRequest<LocalRepoMcpStatusResponse>('/api/local-repo-mcp/start', { method: 'POST' });
}

export function stopLocalRepoMcp(): Promise<LocalRepoMcpStatusResponse> {
  return apiRequest<LocalRepoMcpStatusResponse>('/api/local-repo-mcp/stop', { method: 'POST' });
}

export function startLocalRepoMcpTunnel(): Promise<LocalRepoMcpStatusResponse> {
  return apiRequest<LocalRepoMcpStatusResponse>('/api/local-repo-mcp/tunnel/start', { method: 'POST' });
}

export function startLocalRepoMcpQuickTunnel(): Promise<LocalRepoMcpStatusResponse> {
  return apiRequest<LocalRepoMcpStatusResponse>('/api/local-repo-mcp/tunnel/quick/start', { method: 'POST' });
}

export function stopLocalRepoMcpTunnel(): Promise<LocalRepoMcpStatusResponse> {
  return apiRequest<LocalRepoMcpStatusResponse>('/api/local-repo-mcp/tunnel/stop', { method: 'POST' });
}

export function probeLocalRepoMcp(): Promise<LocalRepoMcpStatusResponse> {
  return apiRequest<LocalRepoMcpStatusResponse>('/api/local-repo-mcp/probe', { method: 'POST' });
}

export function getLocalRepoMcpPendingAuthorizations(): Promise<LocalRepoMcpStatusResponse> {
  return apiRequest<LocalRepoMcpStatusResponse>('/api/local-repo-mcp/oauth/pending');
}

export function approveLocalRepoMcpAuthorization(id: string): Promise<LocalRepoMcpStatusResponse> {
  return apiRequest<LocalRepoMcpStatusResponse>('/api/local-repo-mcp/oauth/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
}
