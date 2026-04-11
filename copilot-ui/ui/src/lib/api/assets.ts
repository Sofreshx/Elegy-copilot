import type {
  InstalledAssetsResponse,
  LspConfigResponse,
  LspInstallResponse,
  ManagedAssetsResponse,
  SandboxLifecycleAction,
  SandboxLifecyclePayload,
  SandboxLifecycleResponse,
  SkillsPreviewResponse,
} from '../types';
import { apiRequest } from './core';

export function getManagedAssets(baseUrl?: string): Promise<ManagedAssetsResponse> {
  return apiRequest<ManagedAssetsResponse>('/api/assets/managed', { baseUrl });
}

export function getInstalledAssets(baseUrl?: string): Promise<InstalledAssetsResponse> {
  return apiRequest<InstalledAssetsResponse>('/api/assets/installed', { baseUrl });
}

export function syncAllAssets(force = false, baseUrl?: string, pointerMode = true): Promise<{ result: unknown[] }> {
  return apiRequest<{ result: unknown[] }>('/api/assets/sync-all', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ force, pointerMode }),
  });
}

export function patchVscodeSettings(baseUrl?: string): Promise<{ result: unknown }> {
  return apiRequest<{ result: unknown }>('/api/vscode/patch-settings', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ dryRun: false }),
  });
}

export function patchVscodeGithubMcp(baseUrl?: string): Promise<{ result: unknown }> {
  return apiRequest<{ result: unknown }>('/api/vscode/patch-github-mcp', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ dryRun: false }),
  });
}

export function authorizeCopilotFolders(baseUrl?: string): Promise<{ result: unknown }> {
  return apiRequest<{ result: unknown }>('/api/copilot/authorize', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ dryRun: false }),
  });
}

export function runSandboxLifecycleAction(
  action: SandboxLifecycleAction,
  payload: SandboxLifecyclePayload,
  baseUrl?: string
): Promise<SandboxLifecycleResponse> {
  return apiRequest<SandboxLifecycleResponse>(
    `/api/tracker/lifecycle/${encodeURIComponent(action)}`,
    {
      baseUrl,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload ?? {}),
    }
  );
}

export function getLspConfig(baseUrl?: string): Promise<LspConfigResponse> {
  return apiRequest<LspConfigResponse>('/api/lsp/config', { baseUrl });
}

export function installLsp(baseUrl?: string): Promise<LspInstallResponse> {
  return apiRequest<LspInstallResponse>('/api/lsp/install', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
}

export function getSkillsPreview(baseUrl?: string): Promise<SkillsPreviewResponse> {
  return apiRequest<SkillsPreviewResponse>('/api/skills/preview', { baseUrl });
}

export function getAssetView(path: string, baseUrl?: string): Promise<string> {
  return apiRequest<string>('/api/assets/view', {
    baseUrl,
    query: {
      path,
    },
  });
}
