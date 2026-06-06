import type { CodexProviderDeepseekStatus, CodexProviderStatusResponse, MoonBridgeBootstrapStatus } from '../types';
import { apiRequest, normalizeCodexProviderStatusResponse } from './core';

export async function getCodexProviderStatus(baseUrl?: string): Promise<CodexProviderStatusResponse> {
  const payload = await apiRequest<unknown>('/api/config/codex-provider', { baseUrl });
  return normalizeCodexProviderStatusResponse(payload);
}

export async function setCodexProviderMode(
  mode: 'native' | 'deepseek-bridge',
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

export interface DeepseekSettingsPayload {
  bridgePath?: string;
  bridgeConfigPath?: string;
  bridgeUrl?: string;
  keyConfigured?: boolean;
  apiKey?: string;
}

export async function getDeepseekStatus(baseUrl?: string): Promise<CodexProviderDeepseekStatus> {
  const payload = await apiRequest<CodexProviderDeepseekStatus>('/api/config/codex-provider/deepseek', { baseUrl });
  return payload;
}

export async function saveDeepseekSettings(
  settings: DeepseekSettingsPayload,
  baseUrl?: string,
): Promise<CodexProviderDeepseekStatus> {
  const payload = await apiRequest<CodexProviderDeepseekStatus>('/api/config/codex-provider/deepseek', {
    baseUrl,
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  return payload;
}

export async function startDeepseekBridge(baseUrl?: string): Promise<CodexProviderDeepseekStatus & { bridgeRunning: boolean; message: string }> {
  const payload = await apiRequest<CodexProviderDeepseekStatus & { bridgeRunning: boolean; message: string }>(
    '/api/config/codex-provider/deepseek/start',
    { baseUrl, method: 'POST' },
  );
  return payload;
}

export async function stopDeepseekBridge(baseUrl?: string): Promise<{ bridgeRunning: boolean; message: string }> {
  const payload = await apiRequest<{ bridgeRunning: boolean; message: string }>(
    '/api/config/codex-provider/deepseek/stop',
    { baseUrl, method: 'POST' },
  );
  return payload;
}

export async function checkDeepseekBridge(baseUrl?: string): Promise<CodexProviderDeepseekStatus> {
  const payload = await apiRequest<CodexProviderDeepseekStatus>(
    '/api/config/codex-provider/deepseek/status',
    { baseUrl, method: 'POST' },
  );
  return payload;
}

export async function getBootstrapStatus(baseUrl?: string): Promise<MoonBridgeBootstrapStatus> {
  const payload = await apiRequest<MoonBridgeBootstrapStatus>(
    '/api/config/codex-provider/deepseek/bootstrap',
    { baseUrl },
  );
  return payload;
}

export interface BootstrapMoonBridgeResponse {
  success: boolean;
  message?: string;
  error?: string;
  status: MoonBridgeBootstrapStatus;
}

export async function bootstrapMoonBridge(
  options: { forceRebuild?: boolean } = {},
  baseUrl?: string,
): Promise<BootstrapMoonBridgeResponse> {
  const payload = await apiRequest<BootstrapMoonBridgeResponse>(
    '/api/config/codex-provider/deepseek/bootstrap',
    {
      baseUrl,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ forceRebuild: options.forceRebuild }),
    },
  );
  return payload;
}

export function getCodexCliStatus(baseUrl?: string): Promise<{ codexHome: string; cli: { installed: boolean; version: string | null; installCommand: string; lastError: string | null } }> {
  return apiRequest('/api/codex/cli/status', { baseUrl });
}

export function installCodexCli(baseUrl?: string): Promise<{ ok: boolean; version?: string | null; error?: string | null; cli?: unknown }> {
  return apiRequest('/api/codex/cli/install', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
}
