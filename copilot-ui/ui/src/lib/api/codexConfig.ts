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

export async function factoryResetCodexProvider(baseUrl?: string): Promise<CodexProviderStatusResponse> {
  const payload = await apiRequest<unknown>('/api/config/codex-provider/factory-reset', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  return normalizeCodexProviderStatusResponse(payload);
}

export async function reinstallCodexSurface(baseUrl?: string): Promise<{ target: string; dryRun: boolean; force: boolean; surfaces: unknown[] }> {
  return apiRequest('/api/assets/install-surfaces', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target: 'codex', force: true }),
  });
}

export interface CodexPlanningSkillStatus {
  installed: boolean;
  skillDir: string;
  skillFile: string | null;
  codexHome: string;
}

export interface CodexPlanningStatusResponse {
  codexHome: string;
  planningSkill: CodexPlanningSkillStatus;
  planningCliPath: string | null;
  planningDbPath: string | null;
  ready: boolean;
}

export async function getCodexPlanningStatus(baseUrl?: string): Promise<CodexPlanningStatusResponse> {
  return apiRequest<CodexPlanningStatusResponse>('/api/codex-planning-status', { baseUrl });
}

export async function installCodexPlanningSkill(force = false, baseUrl?: string): Promise<{ ok: boolean; syncResult?: unknown; error?: string }> {
  return apiRequest('/api/tooling-updates/update/elegy-skills-codex', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ force }),
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
  modelReasoningEffort: string | null;
  sandboxMode: string | null;
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
  parentThreadId: string;
  agent: string;
  model: string | null;
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

export interface OpenCodeWorkerConfig {
  enabled: boolean;
  defaultModelProfile: string;
  roleProfiles: Record<string, string>;
  rolePolicies: Record<string, { profile?: string; writeEnabled: boolean }>;
  writeEnabled: boolean;
  allowPaidModels: boolean;
  profilesPath: string | null;
  journalPath: string | null;
  timeoutSeconds: number;
}

export interface OpenCodeWorkerProfile {
  id: string;
  label: string;
  description: string;
  tags: string[];
  roleModels: Record<string, string>;
  paid: boolean;
}

export interface OpenCodeWorkersStatusResponse {
  installed: boolean;
  enabled: boolean;
  configPath: string;
  journalPath: string;
  profileCatalogPath: string;
  journalScope: string;
  config: OpenCodeWorkerConfig;
  roles: string[];
  effectiveRoleProfiles: Record<string, string>;
  effectiveRolePolicies: Record<string, { profile: string; writeEnabled: boolean; mode: string }>;
  roleModelMatrix: Record<string, Record<string, string | null>>;
  profiles: OpenCodeWorkerProfile[];
}

export interface OpenCodeWorkersUsageResponse {
  generatedAt: string;
  source: { kind: string; path: string };
  summary: {
    runs: number;
    completed: number;
    failed: number;
    policyViolations: number;
    permissionDenials: number;
    permissionRequests: number;
    writeAttempts: number;
    changedFiles: number;
    dirtyGitStates: number;
    tokens: number;
    cost: number;
  };
  byModel: Array<{ name: string; count: number }>;
  byRole: Array<{ name: string; count: number }>;
  journalScope: string;
  permissionEvidence: Array<Record<string, unknown>>;
  recentJobs: Array<Record<string, unknown>>;
}

export function getOpenCodeWorkersStatus(options: { repoPath?: string | null } = {}, baseUrl?: string): Promise<OpenCodeWorkersStatusResponse> {
  const query = options.repoPath ? `?repoPath=${encodeURIComponent(options.repoPath)}` : '';
  return apiRequest(`/api/codex/opencode-workers${query}`, { baseUrl });
}

export function saveOpenCodeWorkersConfig(
  config: Partial<OpenCodeWorkerConfig>,
  options: { repoPath?: string | null } = {},
  baseUrl?: string,
): Promise<OpenCodeWorkersStatusResponse> {
  return apiRequest('/api/codex/opencode-workers/config', {
    baseUrl,
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config, repoPath: options.repoPath || '' }),
  });
}

export function getOpenCodeWorkersUsage(options: { repoPath?: string | null } = {}, baseUrl?: string): Promise<OpenCodeWorkersUsageResponse> {
  const query = options.repoPath ? `?repoPath=${encodeURIComponent(options.repoPath)}` : '';
  return apiRequest(`/api/codex/opencode-workers/usage${query}`, { baseUrl });
}

export function installOpenCodeWorkers(baseUrl?: string): Promise<{ ok: boolean; status: OpenCodeWorkersStatusResponse; result?: unknown }> {
  return apiRequest('/api/codex/opencode-workers/install', {
    baseUrl,
    method: 'POST',
  });
}

export function removeOpenCodeWorkers(baseUrl?: string): Promise<{ ok: boolean; status: OpenCodeWorkersStatusResponse; removed?: string[] }> {
  return apiRequest('/api/codex/opencode-workers/remove', {
    baseUrl,
    method: 'POST',
  });
}
