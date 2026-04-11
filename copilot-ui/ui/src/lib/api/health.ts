import type { HealthResponse, VersionResponse } from '../types';
import { apiRequest } from './core';

export function getHealth(baseUrl?: string): Promise<HealthResponse> {
  return apiRequest<HealthResponse>('/api/health', { baseUrl });
}

export function getVersion(baseUrl?: string): Promise<VersionResponse> {
  return apiRequest<VersionResponse>('/api/version', { baseUrl });
}
