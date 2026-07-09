import type {
  InstallSurfaceTarget,
  ToolingUpdateActionResponse,
  ToolingUpdatesStatusResponse,
} from '../types';
import { apiRequest } from './core';

export function getToolingUpdatesStatus(baseUrl?: string): Promise<ToolingUpdatesStatusResponse> {
  return apiRequest<ToolingUpdatesStatusResponse>('/api/tooling-updates/status', { baseUrl });
}

export function checkToolingUpdates(baseUrl?: string): Promise<ToolingUpdatesStatusResponse> {
  return apiRequest<ToolingUpdatesStatusResponse>('/api/tooling-updates/check', {
    method: 'POST',
    baseUrl,
  });
}

export function updateElegyPlanningCli(baseUrl?: string): Promise<ToolingUpdateActionResponse> {
  return apiRequest<ToolingUpdateActionResponse>('/api/tooling-updates/update/elegy-planning', {
    method: 'POST',
    baseUrl,
  });
}

export interface UpdateElegyPluginsPayload {
  pluginNames?: string[];
  releaseTag?: string;
}

export function updateElegyPlugins(
  payload: UpdateElegyPluginsPayload = {},
  baseUrl?: string,
): Promise<ToolingUpdateActionResponse> {
  return apiRequest<ToolingUpdateActionResponse>('/api/tooling-updates/update/elegy-plugins', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    baseUrl,
  });
}

export function downloadElegyCliSurface(
  surface: string,
  baseUrl?: string,
): Promise<ToolingUpdateActionResponse> {
  return apiRequest<ToolingUpdateActionResponse>(`/api/tooling-updates/download/${surface}`, {
    method: 'POST',
    baseUrl,
  });
}

export function downloadAllElegyCliSurfaces(
  baseUrl?: string,
): Promise<ToolingUpdateActionResponse> {
  return apiRequest<ToolingUpdateActionResponse>('/api/tooling-updates/download-all', {
    method: 'POST',
    baseUrl,
  });
}

export interface UpdateElegySkillsPayload {
  force?: boolean;
  targets?: InstallSurfaceTarget[];
}

export function updateElegySkillsAssets(
  payload: UpdateElegySkillsPayload = {},
  baseUrl?: string,
): Promise<ToolingUpdateActionResponse> {
  return apiRequest<ToolingUpdateActionResponse>('/api/tooling-updates/update/elegy-skills', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    baseUrl,
  });
}
