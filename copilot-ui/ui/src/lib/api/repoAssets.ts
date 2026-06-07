export interface RepoAssetHarnessStatus {
  harness: string;
  installed: boolean;
  installedAt: string | null;
}

export interface RepoAssetEntry {
  id: string;
  name: string;
  kind: 'agent' | 'skill' | 'config';
  path: string;
  sourceHarness: string | null;
  filePath: string;
  size: number;
  modifiedAt: string;
  harnesses: RepoAssetHarnessStatus[];
  // UI state (not from API)
  _installing?: string; // harness being installed
}

export interface RepoAssetsDiscoverResponse {
  repoPath: string;
  assets: RepoAssetEntry[];
  availableHarnesses: string[];
  count: number;
}

export interface RepoAssetInstallResponse {
  ok: boolean;
  assetId: string;
  harness: string;
  installedAt: string;
}

const BASE = '/api/repo-assets';

export async function discoverRepoAssets(repoPath: string): Promise<RepoAssetsDiscoverResponse> {
  const url = `${BASE}/discover?repoPath=${encodeURIComponent(repoPath)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to discover repo assets: ${res.status}`);
  return res.json();
}

export async function installRepoAsset(repoPath: string, assetId: string, harness: string): Promise<RepoAssetInstallResponse> {
  const res = await fetch(BASE + '/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoPath, assetId, harness }),
  });
  if (!res.ok) throw new Error(`Failed to install repo asset: ${res.status}`);
  return res.json();
}
