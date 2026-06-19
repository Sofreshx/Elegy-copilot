import type {
  GatewayConfigResponse,
  GatewaySaveConfigResponse,
  GatewayScanReposResponse,
  GatewayStateResponse,
} from '../types';
import {
  apiRequest,
  normalizeGatewayConfigResponse,
  normalizeGatewaySaveConfigResponse,
  normalizeGatewayScanReposResponse,
  normalizeGatewayStateResponse,
} from './core';
import type { GatewaySaveConfigPayload } from './core';

export async function getGatewayConfig(baseUrl?: string): Promise<GatewayConfigResponse> {
  const payload = await apiRequest<unknown>('/api/gateway/config', { baseUrl });
  return normalizeGatewayConfigResponse(payload);
}

export async function saveGatewayConfig(payload: GatewaySaveConfigPayload, baseUrl?: string): Promise<GatewaySaveConfigResponse> {
  const response = await apiRequest<unknown>('/api/gateway/config', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  return normalizeGatewaySaveConfigResponse(response);
}

export async function getGatewayState(baseUrl?: string): Promise<GatewayStateResponse> {
  const payload = await apiRequest<unknown>('/api/gateway/state', { baseUrl });
  return normalizeGatewayStateResponse(payload);
}

export async function connectGateway(baseUrl?: string): Promise<GatewayStateResponse> {
  const payload = await apiRequest<unknown>('/api/gateway/connect', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  return normalizeGatewayStateResponse(payload);
}

export async function scanGatewayRepos(extraPath?: string, baseUrl?: string): Promise<GatewayScanReposResponse> {
  const payload = await apiRequest<unknown>('/api/gateway/scan-repos', {
    baseUrl,
    query: {
      extra: extraPath && extraPath.trim() ? extraPath.trim() : undefined,
    },
  });

  return normalizeGatewayScanReposResponse(payload);
}
