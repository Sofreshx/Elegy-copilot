import type { LocalRepoReaderAccessState } from '../types';
import { apiRequest } from './core';

export interface LocalRepoMcpConfig {
  schemaVersion?: number;
  activeExposureMode?: 'quick' | 'stable';
  quickTunnel?: { enabled: boolean };
  stableTunnel?: {
    configured: boolean;
    publicOrigin: string;
    canonicalResource: string;
    hostname: string;
    cloudflareTunnelName: string;
    cloudflareTunnelId: string;
    cloudflareConfigPath: string;
    cloudflareCredentialsPath: string;
    cloudflaredPath: string;
    managementMode: 'managed' | 'existing';
    setupVersion: number;
    autoStart: boolean;
  };
  oauth?: {
    provider: 'builtin' | 'external' | string;
    issuer: string;
    audience: string;
    requiredScopes: string[];
    accessTokenTtlSeconds?: number;
    refreshTokenTtlSeconds?: number;
  };
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
  lastExit?: unknown;
  notice?: string;
  output?: {
    stdout?: string;
    stderr?: string;
  };
}

export interface LocalRepoMcpStatusResponse {
  config: LocalRepoMcpConfig;
  configPath?: string;
  connectorUrl?: string;
  server: LocalRepoMcpProcessStatus;
  tunnel: LocalRepoMcpProcessStatus;
  lifecycle?: {
    code: string;
    blocked: boolean;
    recovering: boolean;
    message?: string;
    reason?: string;
    retryDelayMs?: number;
    checkedAt?: string;
  };
  securityState: 'Stopped' | 'Local only' | 'OAuth protected' | 'Misconfigured' | string;
  chatGptAccess?: {
    mode: 'none' | 'quick' | 'stable' | string;
    configured?: boolean;
    online?: boolean;
    ready: boolean;
    url: string;
    auth: 'none' | 'oauth' | string;
    urlStable: boolean;
    lifecycleState?: 'not_configured' | 'configured_offline' | 'starting' | 'online_unverified' | 'oauth_ready' | 'degraded' | 'misconfigured' | 'repair_required' | 'quick_ready' | 'stopped' | string;
    blocker?: string;
  };
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
  pendingErrorCode?: 'approval_secret_mismatch' | 'pending_request_failed' | string;
  pendingError?: string;
  probe?: {
    ok: boolean;
    status?: number | null;
    code?: string;
    message?: string;
    target?: string;
    tools?: string[];
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

export interface LocalRepoMcpCloudflareOperation {
  kind: string;
  command?: string;
  args?: string[];
  path?: string;
  effect: string;
}

export interface LocalRepoMcpProvisioningPreview {
  previewId: string;
  createdAt?: string;
  expiresAt: string;
  tunnelName?: string;
  zone?: string;
  hostname: string;
  publicOrigin?: string;
  canonicalResource: string;
  operations: LocalRepoMcpCloudflareOperation[];
}

export interface LocalRepoMcpProvisioningResult {
  provisioning: LocalRepoMcpProvisioningPreview & {
    tunnelId?: string;
    configPath?: string;
    credentialsPath?: string;
  };
  config: LocalRepoMcpConfig;
}

export interface LocalRepoMcpCloudflareLoginResponse {
  cloudflareLogin: {
    available: boolean;
    cloudflaredPath?: string;
    running: boolean;
    pid?: number | null;
    lastExit?: { code?: number | null; signal?: string | null; exitedAt?: string } | null;
    certPath?: string;
    loggedIn: boolean;
  };
}

export interface LocalRepoMcpDiagnosticReport {
  schemaVersion: number;
  generatedAt?: string;
  overall: 'pass' | 'blocked' | string;
  checks: Array<{
    id: string;
    layer: string;
    status: 'pass' | 'blocked' | string;
    code: string;
    message: string;
  }>;
  repairs: Array<{
    id: string;
    label: string;
    description?: string;
    requiresConfirmation: boolean;
  }>;
}

export interface LocalRepoMcpRepairPreview {
  previewId: string;
  repairId: string;
  createdAt?: string;
  expiresAt?: string;
  operations: LocalRepoMcpCloudflareOperation[];
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

export function validateLocalRepoMcpStableTunnel(): Promise<LocalRepoMcpStatusResponse> {
  return apiRequest<LocalRepoMcpStatusResponse>('/api/local-repo-mcp/tunnel/stable/validate', { method: 'POST' });
}

export function getLocalRepoMcpCloudflareLoginStatus(): Promise<LocalRepoMcpCloudflareLoginResponse> {
  return apiRequest<LocalRepoMcpCloudflareLoginResponse>('/api/local-repo-mcp/tunnel/stable/cloudflare-login');
}

export function startLocalRepoMcpCloudflareLogin(): Promise<LocalRepoMcpCloudflareLoginResponse> {
  return apiRequest<LocalRepoMcpCloudflareLoginResponse>('/api/local-repo-mcp/tunnel/stable/cloudflare-login', {
    method: 'POST',
  });
}

export function previewLocalRepoMcpManagedProvisioning(zone: string): Promise<LocalRepoMcpProvisioningPreview> {
  return apiRequest<LocalRepoMcpProvisioningPreview>('/api/local-repo-mcp/tunnel/stable/provision/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ zone }),
  });
}

export function confirmLocalRepoMcpManagedProvisioning(previewId: string): Promise<LocalRepoMcpProvisioningResult> {
  return apiRequest<LocalRepoMcpProvisioningResult>('/api/local-repo-mcp/tunnel/stable/provision/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ previewId }),
  });
}

export function cancelLocalRepoMcpManagedProvisioning(previewId: string): Promise<{ cancelled: boolean }> {
  return apiRequest<{ cancelled: boolean }>('/api/local-repo-mcp/tunnel/stable/provision/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ previewId }),
  });
}

export function runLocalRepoMcpDiagnostics(): Promise<LocalRepoMcpDiagnosticReport> {
  return apiRequest<LocalRepoMcpDiagnosticReport>('/api/local-repo-mcp/tunnel/stable/diagnostics/run', {
    method: 'POST',
  });
}

export function exportLocalRepoMcpDiagnostics(): Promise<LocalRepoMcpDiagnosticReport> {
  return apiRequest<LocalRepoMcpDiagnosticReport>('/api/local-repo-mcp/tunnel/stable/diagnostics/export');
}

export function previewLocalRepoMcpDiagnosticRepair(repairId: string): Promise<LocalRepoMcpRepairPreview> {
  return apiRequest<LocalRepoMcpRepairPreview>('/api/local-repo-mcp/tunnel/stable/repair/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repairId }),
  });
}

export function confirmLocalRepoMcpDiagnosticRepair(previewId: string): Promise<{ repair: { id: string; status: string } }> {
  return apiRequest<{ repair: { id: string; status: string } }>('/api/local-repo-mcp/tunnel/stable/repair/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ previewId }),
  });
}

export function cancelLocalRepoMcpDiagnosticRepair(previewId: string): Promise<{ cancelled: boolean }> {
  return apiRequest<{ cancelled: boolean }>('/api/local-repo-mcp/tunnel/stable/repair/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ previewId }),
  });
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
