import { apiRequest } from './core';

export interface FactoryResetResult {
  status: 'ok' | 'skipped' | 'error';
  message: string;
}

export interface FactoryResetResponse {
  ok: boolean;
  results?: {
    opencode: FactoryResetResult;
    codex: FactoryResetResult;
  };
  error?: string;
}

export function factoryReset(baseUrl?: string): Promise<FactoryResetResponse> {
  return apiRequest<FactoryResetResponse>('/api/system/factory-reset', {
    baseUrl,
    method: 'POST',
  });
}
