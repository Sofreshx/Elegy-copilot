import type {
  OpenCodeStatusResponse,
  OpenCodeConfigPayload,
  OpenCodeConfigResponse,
  OpenCodeAssetsInstallResponse,
  OpenCodeToolingInstallPayload,
  OpenCodeToolingInstallResponse,
  OpenCodeRequestLogsResponse,
  ToolingUpdateActionResponse,
} from '../types';
import { apiRequest } from './core';

export function getOpenCodeStatus(baseUrl?: string): Promise<OpenCodeStatusResponse> {
  return apiRequest<OpenCodeStatusResponse>('/api/opencode/status', { baseUrl });
}

export function saveOpenCodeConfig(
  payload: OpenCodeConfigPayload,
  baseUrl?: string,
): Promise<OpenCodeConfigResponse> {
  return apiRequest<OpenCodeConfigResponse>('/api/opencode/config', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function resetOpenCodeConfig(baseUrl?: string): Promise<OpenCodeConfigResponse> {
  return apiRequest<OpenCodeConfigResponse>('/api/opencode/config/reset', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
}

export function installOpenCodeAssets(
  force = false,
  baseUrl?: string,
): Promise<OpenCodeAssetsInstallResponse> {
  return apiRequest<OpenCodeAssetsInstallResponse>('/api/opencode/assets/install', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ force }),
  });
}

export function installOpenCodeTooling(
  payload: OpenCodeToolingInstallPayload,
  baseUrl?: string,
): Promise<OpenCodeToolingInstallResponse> {
  return apiRequest<OpenCodeToolingInstallResponse>('/api/opencode/tooling/install', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function installCodexPlanning(
  force = false,
  baseUrl?: string,
): Promise<ToolingUpdateActionResponse> {
  return apiRequest<ToolingUpdateActionResponse>('/api/tooling-updates/update/elegy-skills-codex', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ force }),
  });
}

export function installOpenCodeCli(baseUrl?: string): Promise<{ ok: boolean; error?: string }> {
  return apiRequest<{ ok: boolean; error?: string }>('/api/opencode/cli/install', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
}

export function getOpenCodeRequestLogs(
  params?: { limit?: number; since?: string },
  baseUrl?: string,
): Promise<OpenCodeRequestLogsResponse> {
  const searchParams = new URLSearchParams();
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.since) searchParams.set('since', params.since);
  const qs = searchParams.toString();
  return apiRequest<OpenCodeRequestLogsResponse>(
    `/api/opencode/logs/requests${qs ? `?${qs}` : ''}`,
    { baseUrl },
  );
}
