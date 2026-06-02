import type {
  OpenCodeStatusResponse,
  OpenCodeConfigPayload,
  OpenCodeConfigResponse,
  OpenCodeAssetsInstallResponse,
  OpenCodeToolingInstallPayload,
  OpenCodeToolingInstallResponse,
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
