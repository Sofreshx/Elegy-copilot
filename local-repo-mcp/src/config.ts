import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type RepoRoot = {
  id: string;
  label: string;
  rootPath: string;
};

export type OAuthConfig = {
  enabled: boolean;
  provider: 'builtin' | 'external' | 'disabled';
  issuer: string;
  audience: string;
  requiredScopes: string[];
  publicBaseUrl: string;
  stateDir: string;
};

export const PORT = Number.parseInt(process.env.LOCAL_REPO_MCP_PORT || '3333', 10);
export const MAX_FILE_SIZE_BYTES = 200000;
export const DEFAULT_TREE_LIMIT = 500;
export const DEFAULT_SEARCH_LIMIT = 100;

function expandHome(inputPath: string): string {
  if (inputPath === '~') return os.homedir();
  if (inputPath.startsWith('~/') || inputPath.startsWith('~\\')) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

export function resolveElegyHome(): string {
  return path.resolve(expandHome(process.env.ELEGY_HOME || process.env.INSTRUCTION_ENGINE_ELEGY_HOME || '~/.elegy'));
}

export function resolveAccessPath(): string {
  return process.env.LOCAL_REPO_MCP_ACCESS_FILE
    ? path.resolve(expandHome(process.env.LOCAL_REPO_MCP_ACCESS_FILE))
    : path.join(resolveElegyHome(), 'catalog', 'local-repo-reader', 'access.json');
}

export function resolveOAuthStateDir(): string {
  return process.env.LOCAL_REPO_MCP_OAUTH_STATE_DIR
    ? path.resolve(expandHome(process.env.LOCAL_REPO_MCP_OAUTH_STATE_DIR))
    : path.join(resolveElegyHome(), 'local-repo-mcp', 'oauth');
}

export function getRepoRoots(): RepoRoot[] {
  const override = process.env.LOCAL_REPO_MCP_ROOTS_JSON;
  if (override) {
    const parsed = JSON.parse(override) as RepoRoot[];
    if (!Array.isArray(parsed)) {
      throw new Error('LOCAL_REPO_MCP_ROOTS_JSON must be an array.');
    }
    return parsed.map(normalizeRoot).filter((root) => fs.existsSync(root.rootPath));
  }

  const accessPath = resolveAccessPath();
  if (!fs.existsSync(accessPath)) {
    return [];
  }

  const access = JSON.parse(fs.readFileSync(accessPath, 'utf8')) as { repos?: Array<Record<string, unknown>> };
  return Array.isArray(access.repos)
    ? access.repos
      .filter((entry) => entry.enabled !== false)
      .map((entry) => normalizeRoot({
        id: String(entry.alias || entry.repoId || ''),
        label: String(entry.label || entry.repoLabel || entry.alias || entry.repoId || ''),
        rootPath: String(entry.root || entry.repoPath || ''),
      }))
      .filter((root) => root.id && root.rootPath && fs.existsSync(root.rootPath))
    : [];
}

function normalizeRoot(root: RepoRoot): RepoRoot {
  if (!root.id || !root.label || !root.rootPath) {
    throw new Error('Each root needs id, label, and rootPath.');
  }
  return {
    id: root.id,
    label: root.label,
    rootPath: path.resolve(expandHome(root.rootPath)),
  };
}

export function getOAuthConfig(): OAuthConfig {
  const authMode = (process.env.LOCAL_REPO_MCP_AUTH_MODE || 'oauth').trim().toLowerCase();
  const requestedProvider = (process.env.LOCAL_REPO_MCP_AUTH_PROVIDER || 'external').trim().toLowerCase();
  const provider = authMode === 'disabled'
    ? 'disabled'
    : requestedProvider === 'builtin'
      ? 'builtin'
      : 'external';
  const requiredScopes = (process.env.LOCAL_REPO_MCP_REQUIRED_SCOPES || 'repo:read')
    .split(/[,\s]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
  const publicBaseUrl = (process.env.LOCAL_REPO_MCP_PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');

  return {
    enabled: provider !== 'disabled',
    provider,
    issuer: (process.env.LOCAL_REPO_MCP_AUTH_ISSUER || publicBaseUrl).trim().replace(/\/+$/, ''),
    audience: (process.env.LOCAL_REPO_MCP_AUTH_AUDIENCE || publicBaseUrl).trim().replace(/\/+$/, ''),
    requiredScopes,
    publicBaseUrl,
    stateDir: resolveOAuthStateDir(),
  };
}
