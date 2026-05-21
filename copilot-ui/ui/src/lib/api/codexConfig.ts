import type { CodexProviderStatusResponse } from '../types';
import { apiRequest, normalizeCodexProviderStatusResponse } from './core';

export async function getCodexProviderStatus(baseUrl?: string): Promise<CodexProviderStatusResponse> {
  const payload = await apiRequest<unknown>('/api/config/codex-provider', { baseUrl });
  return normalizeCodexProviderStatusResponse(payload);
}

export async function setCodexProviderMode(
  mode: 'native' | 'elegy-routed',
  baseUrl?: string,
): Promise<CodexProviderStatusResponse> {
  const payload = await apiRequest<unknown>('/api/config/codex-provider', {
    baseUrl,
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  return normalizeCodexProviderStatusResponse(payload);
}

export async function resetCodexProvider(
  hard = false,
  baseUrl?: string,
): Promise<CodexProviderStatusResponse> {
  const payload = await apiRequest<unknown>('/api/config/codex-provider/reset', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hard }),
  });
  return normalizeCodexProviderStatusResponse(payload);
}
