import { apiRequest } from './core';

export interface GitStatusResponse {
  branch: string;
  files: Array<{ status: string; path: string }>;
  clean: boolean;
  repoRoot?: string | null;
  stagedCount?: number;
  unstagedCount?: number;
  ahead?: number;
  behind?: number;
  upstream?: string | null;
  remoteName?: string | null;
}

export interface GitDiffResponse {
  diff: string;
  staged: boolean;
}

export interface GitLogResponse {
  commits: Array<{ hash: string; fullHash?: string | null; message: string; author?: string | null; authoredAt?: string | null }>;
}

export interface GitBranchEntry {
  name: string;
  current: boolean;
  remote: boolean;
  upstream: string | null;
}

export interface GitBranchesResponse {
  currentBranch: string | null;
  branches: GitBranchEntry[];
}

export interface GitPullRequestResponse {
  available: boolean;
  tool: 'gh' | null;
  authenticated: boolean;
  pullRequest: {
    number: number;
    url: string;
    state: string;
  } | null;
  error?: string | null;
}

export interface GitSummaryResponse {
  branch: string | null;
  clean: boolean;
  changedFiles: number;
  stagedFiles: number;
  additions: number;
  deletions: number;
  ahead: number;
  behind: number;
  upstream: string | null;
  remoteName: string | null;
  remoteLabel: string | null;
  remoteUrl: string | null;
  hasRemote: boolean;
  pullRequest: GitPullRequestResponse['pullRequest'];
}

export async function getGitStatus(repoPath: string, baseUrl?: string): Promise<GitStatusResponse> {
  const url = `/api/git/status?repoPath=${encodeURIComponent(repoPath)}`;
  return apiRequest<GitStatusResponse>(url, { baseUrl });
}

export async function getGitDiff(repoPath: string, staged = false, baseUrl?: string): Promise<GitDiffResponse> {
  const url = `/api/git/diff?repoPath=${encodeURIComponent(repoPath)}&staged=${staged}`;
  return apiRequest<GitDiffResponse>(url, { baseUrl });
}

export async function getGitLog(repoPath: string, baseUrl?: string): Promise<GitLogResponse> {
  const url = `/api/git/log?repoPath=${encodeURIComponent(repoPath)}`;
  return apiRequest<GitLogResponse>(url, { baseUrl });
}

export async function getGitBranches(repoPath: string, baseUrl?: string): Promise<GitBranchesResponse> {
  const url = `/api/git/branches?repoPath=${encodeURIComponent(repoPath)}`;
  return apiRequest<GitBranchesResponse>(url, { baseUrl });
}

export async function getGitSummary(repoPath: string, baseUrl?: string): Promise<GitSummaryResponse> {
  const url = `/api/git/summary?repoPath=${encodeURIComponent(repoPath)}`;
  return apiRequest<GitSummaryResponse>(url, { baseUrl });
}

export async function getGitPullRequest(repoPath: string, baseUrl?: string): Promise<GitPullRequestResponse> {
  const url = `/api/git/pull-request?repoPath=${encodeURIComponent(repoPath)}`;
  return apiRequest<GitPullRequestResponse>(url, { baseUrl });
}

export async function stageGitFiles(repoPath: string, files?: string[], baseUrl?: string): Promise<{ staged: boolean }> {
  return apiRequest<{ staged: boolean }>('/api/git/stage', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoPath, files: files ?? [] }),
  });
}

export async function unstageGitFiles(repoPath: string, files?: string[], baseUrl?: string): Promise<{ unstaged: boolean }> {
  return apiRequest<{ unstaged: boolean }>('/api/git/unstage', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoPath, files: files ?? [] }),
  });
}

export async function stageGitFile(repoPath: string, filePath: string, baseUrl?: string): Promise<{ staged: boolean }> {
  return apiRequest<{ staged: boolean }>('/api/git/stage', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoPath, files: [filePath] }),
  });
}

export async function unstageGitFile(repoPath: string, filePath: string, baseUrl?: string): Promise<{ unstaged: boolean }> {
  return apiRequest<{ unstaged: boolean }>('/api/git/unstage', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoPath, files: [filePath] }),
  });
}

export interface GitCheckResult {
  checkName: string;
  status?: 'PASS' | 'FAIL' | 'SKIP' | string;
  passed: boolean;
  exitCode?: number | null;
  durationMs?: number | null;
  error?: string;
  output?: string;
  score?: number | null;
  commands?: Array<{ command: string; exitCode: number; success: boolean; durationMs: number }>;
  group?: string | null;
  blocking?: boolean;
  ciWorkflow?: string | null;
  ciJob?: string | null;
  ciRequired?: boolean;
  required?: boolean;
  skippable?: boolean;
  cost?: 'fast' | 'medium' | 'heavy';
  opensWindow?: boolean;
  defaultProfiles?: string[];
}

export interface GitCheckResults {
  repoRoot: string;
  source: 'commit-check' | 'legacy' | 'none';
  checkedAt: string;
  threshold?: number;
  compositeScore?: number | null;
  anyGateFailed?: boolean;
  checksAvailable: number;
  checksRun: number;
  checksPassed: number;
  checksFailed: number;
  allPassed: boolean;
  groups?: Record<string, { description: string }>;
  groupResults?: Record<string, { passedLanes: string[]; failedLanes: string[]; allPassed: boolean }>;
  results: GitCheckResult[];
  message: string;
  profile?: string | null;
  requiredFailures?: string[];
  skippedLanes?: Record<string, string>;
  overrideReasons?: Record<string, string>;
  logs?: Array<{
    timestamp: string;
    event: string;
    lane?: string;
    status?: string;
    exitCode?: number;
    durationMs?: number;
    reason?: string;
  }>;
  errorOutput?: string;
}

export interface GitActionResponse {
  checkResults?: GitCheckResults | null;
  overrideApplied?: boolean;
  overrideReason?: string | null;
  committed?: boolean;
  pushed?: boolean;
  created?: boolean;
  output?: string;
  pullRequest?: any;
  error?: string;
  requiresOverride?: boolean;
}

export async function commitGit(
  repoPath: string,
  message: string,
  unsafeOverride?: { reason: string }
): Promise<GitActionResponse> {
  return apiRequest<GitActionResponse>('/api/git/commit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      repoPath,
      message,
      unsafeOverride: unsafeOverride || undefined,
    }),
  });
}

export async function checkoutGitBranch(
  repoPath: string,
  payload: { branchName: string; create?: boolean; startPoint?: string | null },
  baseUrl?: string,
): Promise<{ checkedOut: boolean; branch: string }> {
  return apiRequest<{ checkedOut: boolean; branch: string }>('/api/git/checkout', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoPath, ...payload }),
  });
}

export async function pullGit(repoPath: string, baseUrl?: string): Promise<{ pulled: boolean; output: string }> {
  return apiRequest<{ pulled: boolean; output: string }>('/api/git/pull', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoPath }),
  });
}

export async function pushGit(
  repoPath: string,
  setUpstream: boolean,
  unsafeOverride?: { reason: string }
): Promise<GitActionResponse> {
  return apiRequest<GitActionResponse>('/api/git/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      repoPath,
      setUpstream,
      unsafeOverride: unsafeOverride || undefined,
    }),
  });
}

export async function createGitPullRequest(
  repoPath: string,
  title: string,
  body: string,
  unsafeOverride?: { reason: string }
): Promise<GitActionResponse> {
  return apiRequest<GitActionResponse>('/api/git/pull-request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      repoPath,
      title,
      body,
      unsafeOverride: unsafeOverride || undefined,
    }),
  });
}

export interface GitChecksDiscoverResponse {
  repoPath: string;
  checksAvailable: number;
  source: 'commit-check' | 'legacy' | 'none';
  groups?: Record<string, { description: string }>;
  profiles?: Record<string, { label: string; description: string; cost: 'fast' | 'medium' | 'heavy'; opensWindow: boolean }>;
  checks: Array<{
    name: string;
    path: string;
    description: string;
    source: 'commit-check' | 'legacy' | 'none';
    group?: string | null;
    blocking?: boolean;
    ciWorkflow?: string | null;
    ciJob?: string | null;
    ciRequired?: boolean;
    required?: boolean;
    skippable?: boolean;
    requiresReasonOnSkip?: boolean;
    defaultProfiles?: string[];
    cost?: 'fast' | 'medium' | 'heavy';
    opensWindow?: boolean;
  }>;
}

export async function discoverGitChecks(repoPath: string, baseUrl?: string): Promise<GitChecksDiscoverResponse> {
  const url = `/api/git/checks/discover?repoPath=${encodeURIComponent(repoPath)}`;
  return apiRequest<GitChecksDiscoverResponse>(url, { baseUrl });
}

export async function runGitChecks(repoPath: string, baseUrl?: string): Promise<GitCheckResults> {
  return apiRequest<GitCheckResults>('/api/git/checks/run', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoPath }),
  });
}

export interface RunChecksWithProfileOptions {
  profile?: string;
  selectedLane?: string;
  selectedGroup?: string;
  skipLanes?: Record<string, string>;
}

export async function runGitChecksWithProfile(
  repoPath: string,
  options: RunChecksWithProfileOptions,
  baseUrl?: string,
): Promise<GitCheckResults> {
  return apiRequest<GitCheckResults>('/api/git/checks/run', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoPath, ...options }),
  });
}

export interface GitCheckStateResponse {
  repoId: string;
  repoPath: string;
  hasState: boolean;
  lastRun: {
    timestamp: string;
    gitFingerprint: { head: string | null; dirtyHash: string | null };
    configHash: string | null;
    overallPass: boolean;
    compositeScore: number | null;
    profile?: string | null;
    lanes: Record<string, {
      status: string;
      exitCode: number;
      durationMs: number;
      score: number | null;
      details: string;
      group: string | null;
      blocking: boolean;
      ciWorkflow: string | null;
      ciJob: string | null;
      ciRequired: boolean;
      required?: boolean;
      skippable?: boolean;
      cost?: string;
      opensWindow?: boolean;
      defaultProfiles?: string[];
      commands: Array<{ command: string; exitCode: number; success: boolean; durationMs: number }>;
    }>;
    groups: Record<string, { description: string }>;
    groupResults: Record<string, { passedLanes: string[]; failedLanes: string[]; allPassed: boolean }>;
    ciSync: any | null;
  } | null;
  freshness: { fresh: boolean; reason: string };
  history: any[];
}

export interface GitCiSyncResponse {
  repoRoot: string;
  config: { laneCount: number; gateCount: number } | null;
  ciWorkflows: any;
  syncResult: {
    mappings: Array<{
      workflowFile: string;
      jobName: string;
      required: boolean;
      localLanes: string[];
      status: 'mapped' | 'ci-gap';
    }>;
    summary: {
      totalCiJobs: number;
      mapped: number;
      gaps: number;
      readiness: 'ready' | 'ci-gap' | 'no-ci';
    };
  };
}

export async function getGitCheckState(repoPath: string, baseUrl?: string): Promise<GitCheckStateResponse> {
  const url = `/api/git/checks/state?repoPath=${encodeURIComponent(repoPath)}`;
  return apiRequest<GitCheckStateResponse>(url, { baseUrl });
}

export async function getGitCiSync(repoPath: string, baseUrl?: string): Promise<GitCiSyncResponse> {
  const url = `/api/git/checks/ci-sync?repoPath=${encodeURIComponent(repoPath)}`;
  return apiRequest<GitCiSyncResponse>(url, { baseUrl });
}

// ─── Merge candidate and dry-run APIs ──────────────────────────────────────

export interface MergeCandidate {
  name: string;
  upstream: string | null;
  lastCommit: string;
  lastCommitDate: string;
  isMerged: boolean;
  ahead: number;
  behind: number;
  error?: string;
}

export interface MergeCandidatesResponse {
  repoPath: string;
  currentBranch: string;
  branches: MergeCandidate[];
}

export interface MergeDryRunResponse {
  ok: boolean;
  clean: boolean;
  conflicts?: string[];
  diagnostics: string;
  sourceRef: string;
  targetRef: string;
  dirty: boolean;
}

export interface MergeLocalResponse {
  merged: boolean;
  sourceRef: string;
  targetRef: string;
  output: string;
}

export async function getMergeCandidates(repoPath: string, baseUrl?: string): Promise<MergeCandidatesResponse> {
  const url = `/api/git/merge-candidates?repoPath=${encodeURIComponent(repoPath)}`;
  return apiRequest<MergeCandidatesResponse>(url, { baseUrl });
}

export async function mergeDryRun(
  repoPath: string,
  sourceRef: string,
  targetRef: string,
  baseUrl?: string,
): Promise<MergeDryRunResponse> {
  return apiRequest<MergeDryRunResponse>('/api/git/merge-dry-run', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoPath, sourceRef, targetRef }),
  });
}

export async function mergeLocal(
  repoPath: string,
  sourceRef: string,
  targetRef: string,
  baseUrl?: string,
): Promise<MergeLocalResponse> {
  return apiRequest<MergeLocalResponse>('/api/git/merge-local', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoPath, sourceRef, targetRef }),
  });
}

export interface MergeWorktreeResponse {
  merged: boolean;
  conflicts?: boolean;
  conflictFiles?: string[];
  diagnostics?: string;
  sourceRef: string;
  targetRef: string;
  output?: string;
  error?: string;
}

export async function mergeWorktree(
  repoPath: string,
  worktreePath: string,
  worktreeBranch: string,
  targetBranch: string,
  baseUrl?: string,
): Promise<MergeWorktreeResponse> {
  return apiRequest<MergeWorktreeResponse>('/api/git/merge-worktree', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoPath, worktreePath, worktreeBranch, targetBranch }),
  });
}

// ─── Stash APIs ────────────────────────────────────────────────────────────

export interface GitStashEntry {
  index: number;
  ref: string;
  hash: string;
  message: string;
}

export interface GitStashListResponse {
  repoPath: string;
  count: number;
  stashes: GitStashEntry[];
}

export interface GitStashOperationResponse {
  stashed?: boolean;
  applied?: boolean;
  popped?: boolean;
  dropped?: boolean;
  index: number;
  output: string;
  error?: string;
}

export async function listStashes(repoPath: string, baseUrl?: string): Promise<GitStashListResponse> {
  const url = `/api/git/stashes?repoPath=${encodeURIComponent(repoPath)}`;
  return apiRequest<GitStashListResponse>(url, { baseUrl });
}

export async function createStash(repoPath: string, message?: string, baseUrl?: string): Promise<GitStashOperationResponse> {
  return apiRequest<GitStashOperationResponse>('/api/git/stash', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoPath, message: message || undefined }),
  });
}

export async function applyStash(repoPath: string, index?: number, baseUrl?: string): Promise<GitStashOperationResponse> {
  return apiRequest<GitStashOperationResponse>('/api/git/stash/apply', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoPath, index: index !== undefined ? index : undefined }),
  });
}

export async function popStash(repoPath: string, index?: number, baseUrl?: string): Promise<GitStashOperationResponse> {
  return apiRequest<GitStashOperationResponse>('/api/git/stash/pop', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoPath, index: index !== undefined ? index : undefined }),
  });
}

export async function dropStash(repoPath: string, index?: number, baseUrl?: string): Promise<GitStashOperationResponse> {
  return apiRequest<GitStashOperationResponse>('/api/git/stash/drop', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoPath, index: index !== undefined ? index : undefined }),
  });
}
