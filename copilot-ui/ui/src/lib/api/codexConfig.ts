import type { CodexProviderStatusResponse } from '../types';
import { apiRequest, normalizeCodexProviderStatusResponse } from './core';

export async function getCodexProviderStatus(baseUrl?: string): Promise<CodexProviderStatusResponse> {
  const payload = await apiRequest<unknown>('/api/config/codex-provider', { baseUrl });
  return normalizeCodexProviderStatusResponse(payload);
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

export interface CodexSubagentSettings {
  routingMode: string;
  maxThreads: number;
  maxDepth: number;
  jobMaxRuntimeSeconds: number;
  telemetryRetentionDays: number;
  settingsPath?: string;
}

export interface CodexSubagentNativeConfig {
  path: string;
  changed: boolean;
  parseError: string | null;
  values: {
    maxThreads: number | null;
    maxDepth: number | null;
    jobMaxRuntimeSeconds: number | null;
  } | null;
  matchesSettings: boolean | null;
}

export interface CodexSubagentRecord {
  name: string;
  description: string;
  model: string | null;
  modelProvider: string | null;
  modelReasoningEffort: string | null;
  sandboxMode: string | null;
  writeEnabled: boolean;
  requestedRelease: string | null;
  routingMode: string;
  fastModel: string | null;
  allowSpark: boolean;
  toolScopeNote: string;
  managed: boolean;
  scope: string;
  missing: boolean;
  drift: boolean;
  operationalStatus: string;
  usable: boolean;
  parseError: string | null;
  sourcePath: string | null;
  installedPath: string | null;
  content: string;
  capabilities: {
    enforced: string[];
    configured: string[];
    inherited: string[];
    observed: string[];
  };
  usageSummary: {
    runs: number;
    tokens: number;
    toolEvents: number;
    errors: number;
  };
}

export interface CodexSubagentsResponse {
  codexHome: string;
  agentsDir: string;
  inventoryPath: string;
  settings: CodexSubagentSettings;
  nativeConfig: CodexSubagentNativeConfig;
  summary: {
    managed: number;
    installed: number;
    missing: number;
    drifted: number;
    invalid: number;
    usable: number;
    disabled: number;
    project: number;
    routingMode: string;
    maxThreads: number;
    maxDepth: number;
    nativeConfigSynced: boolean;
  };
  agents: CodexSubagentRecord[];
  projectAgents: CodexSubagentRecord[];
  capabilityLegend: Record<string, string>;
}

export interface CodexSubagentUsageRun {
  threadId: string;
  parentThreadId: string | null;
  agent: string;
  nickname: string | null;
  status: string | null;
  state: 'starting' | 'running' | 'waiting_tool' | 'completed' | 'failed' | 'canceled' | 'stale' | string;
  model: string | null;
  reasoningEffort: string | null;
  sandboxMode: string | null;
  createdAt: string | null;
  startedAt: string | null;
  providerId: string | null;
  providerProfile: string | null;
  providerRole: string | null;
  modelSource: string | null;
  resolvedModelId: string | null;
  requestedRelease: string | null;
  costPolicy: string | null;
  writeMode: string | null;
  jobIdentifier: string | null;
  scopeStatus: 'not_applicable' | 'verified' | 'scope_violation' | 'unknown' | string;
  changedFiles: string[];
  toolEvents: number;
  errors: number;
  completed: boolean;
  flags: string[];
  updatedAt: string | null;
  tokens: {
    totalTokens: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningOutputTokens: number;
  };
}

export interface CodexSubagentUsageResponse {
  generatedAt: string;
  coverage: string;
  source: { kind: string; path: string };
  summary: {
    runs: number;
    tokens: number;
    toolEvents: number;
    errors: number;
  };
  byAgent: Array<{
    name: string;
    count: number;
    tokens: number;
    toolEvents: number;
    errors: number;
  }>;
  runs: CodexSubagentUsageRun[];
}

export function getCodexSubagents(options: { repoPath?: string | null } = {}, baseUrl?: string): Promise<CodexSubagentsResponse> {
  const query = options.repoPath ? `?repoPath=${encodeURIComponent(options.repoPath)}` : '';
  return apiRequest(`/api/codex/subagents${query}`, { baseUrl });
}

export function saveCodexSubagentSettings(settings: Partial<CodexSubagentSettings>, baseUrl?: string): Promise<{ ok: boolean; settings: CodexSubagentSettings; nativeConfig: CodexSubagentNativeConfig }> {
  return apiRequest('/api/codex/subagents/settings', {
    baseUrl,
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
}

export function updateCodexSubagent(name: string, updates: Record<string, unknown>, baseUrl?: string): Promise<CodexSubagentsResponse> {
  return apiRequest(`/api/codex/subagents/${encodeURIComponent(name)}`, {
    baseUrl,
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
}

export function resetCodexSubagent(name: string, baseUrl?: string): Promise<CodexSubagentsResponse> {
  return apiRequest(`/api/codex/subagents/${encodeURIComponent(name)}/reset`, {
    baseUrl,
    method: 'POST',
  });
}

export function uninstallCodexSubagent(name: string, force = false, baseUrl?: string): Promise<CodexSubagentsResponse> {
  const query = force ? '?force=true' : '';
  return apiRequest(`/api/codex/subagents/${encodeURIComponent(name)}${query}`, {
    baseUrl,
    method: 'DELETE',
  });
}

export function getCodexSubagentUsage(baseUrl?: string): Promise<CodexSubagentUsageResponse> {
  return apiRequest('/api/codex/subagents/usage', { baseUrl });
}
