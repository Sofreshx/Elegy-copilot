import type { ClaudeCodeStatusResponse, ClaudeCodeCliInstallResponse } from '../types';
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
