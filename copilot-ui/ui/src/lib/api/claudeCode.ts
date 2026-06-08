import type {
  ClaudeCodeStatusResponse,
  ClaudeCodeCliInstallResponse,
  ClaudeCodeProviderMode,
  ClaudeCodeProviderStatusResponse,
  ClaudeCodeProviderSetResponse,
  ClaudeCodeProviderResetResponse,
} from '../types';
import { apiRequest } from './core';

export function getClaudeCodeStatus(baseUrl?: string): Promise<ClaudeCodeStatusResponse> {
  return apiRequest<ClaudeCodeStatusResponse>('/api/claude-code/status', { baseUrl });
}

export function installClaudeCodeCli(baseUrl?: string): Promise<ClaudeCodeCliInstallResponse> {
  return apiRequest<ClaudeCodeCliInstallResponse>('/api/claude-code/cli/install', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
}

export function getClaudeCodeProviderStatus(baseUrl?: string): Promise<ClaudeCodeProviderStatusResponse> {
  return apiRequest<ClaudeCodeProviderStatusResponse>('/api/claude-code/provider', { baseUrl });
}

export function setClaudeCodeProvider(
  mode: ClaudeCodeProviderMode,
  apiKey?: string,
  baseUrl?: string,
): Promise<ClaudeCodeProviderSetResponse> {
  return apiRequest<ClaudeCodeProviderSetResponse>('/api/claude-code/provider', {
    baseUrl,
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, apiKey }),
  });
}

export function resetClaudeCodeProvider(
  restore = false,
  baseUrl?: string,
): Promise<ClaudeCodeProviderResetResponse> {
  return apiRequest<ClaudeCodeProviderResetResponse>('/api/claude-code/provider/reset', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ restore }),
  });
}

export function saveClaudeCodeDeepseekKey(
  apiKey: string,
  baseUrl?: string,
): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>('/api/claude-code/provider/deepseek-key', {
    baseUrl,
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey }),
  });
}
