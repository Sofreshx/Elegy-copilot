import type { CliToolingStatusResponse, CliToolingInstallResponse } from '../types';
import { apiRequest } from './core';

export function getCliToolingStatus(baseUrl?: string): Promise<CliToolingStatusResponse> {
  return apiRequest<CliToolingStatusResponse>('/api/tooling/cli/status', { baseUrl });
}

export interface InstallCliToolingPayload {
  toolId: string;
  dryRun?: boolean;
}

export function installCliTooling(
  payload: InstallCliToolingPayload,
  baseUrl?: string,
): Promise<CliToolingInstallResponse> {
  return apiRequest<CliToolingInstallResponse>('/api/tooling/cli/install', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    baseUrl,
  });
}
