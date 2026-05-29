import type { OpenCodeAgentStatusResponse } from '../types';
import { apiRequest, normalizeOpenCodeAgentStatusResponse } from './core';

export async function getOpenCodeAgentStatus(baseUrl?: string): Promise<OpenCodeAgentStatusResponse> {
  const payload = await apiRequest<unknown>('/api/config/opencode-agents', { baseUrl });
  return normalizeOpenCodeAgentStatusResponse(payload);
}

export async function setOpenCodeAgentModels(
  exploreModel: string,
  scoutModel: string,
  baseUrl?: string,
): Promise<OpenCodeAgentStatusResponse> {
  const payload = await apiRequest<unknown>('/api/config/opencode-agents', {
    baseUrl,
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ exploreModel, scoutModel }),
  });
  return normalizeOpenCodeAgentStatusResponse(payload);
}

export async function resetOpenCodeAgentConfig(
  baseUrl?: string,
): Promise<OpenCodeAgentStatusResponse> {
  const payload = await apiRequest<unknown>('/api/config/opencode-agents/reset', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  return normalizeOpenCodeAgentStatusResponse(payload);
}
