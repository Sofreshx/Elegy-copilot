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
    baseRefName?: string;
    headRefName?: string;
    isDraft?: boolean;
    statusCheckRollup?: Array<Record<string, unknown>>;
    reviewDecision?: string | null;
    mergeable?: string;
    mergeStateStatus?: string;
    checksSummary?: { passed: number; failed: number; pending: number };
  } | null;
  error?: string | null;
}

export interface GitSummaryResponse {
  branch: string | null;
  clean: boolean;
  changedFiles: number;
  stagedFiles: number;
  files: Array<{ status: string; path: string }>;
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
  gateStrength?: string | null;
  determinism?: string | null;
  sourcePack?: string | null;
  tags?: string[];
  severity?: string | null;
  promotionState?: string | null;
  owner?: string | null;
}

export interface GitCheckResults {
  repoRoot: string;
  source: 'commit-check' | 'legacy' | 'elegy-checks' | 'none';
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
  runId?: string | null;
  branch?: string | null;
  head?: string | null;
  dirtyHash?: string | null;
  configHash?: string | null;
  configPath?: string | null;
  planHash?: string | null;
  planPath?: string | null;
  action?: string | null;
  selectionMode?: string | null;
  runnerVersion?: string | null;
  sourceKind?: string | null;
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
    source: 'commit-check' | 'legacy' | 'elegy-checks' | 'none';
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
    gateStrength?: string | null;
    determinism?: string | null;
    sourcePack?: string | null;
    tags?: string[];
    severity?: string | null;
    promotionState?: string | null;
    owner?: string | null;
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
  selectedLanes?: string[];
  selectedGroup?: string;
  skipLanes?: Record<string, string>;
  runAll?: boolean;
  action?: 'commit' | 'push' | 'ci-local' | 'release';
  planHash?: string | null;
  planPath?: string | null;
  selectionMode?: string;
  background?: boolean;
}

export interface GitCheckRunJobResponse {
  runId: string;
  repoPath: string;
  profile: string | null;
  status: 'running' | 'complete' | 'failed';
  startedAt: string;
  endedAt?: string | null;
  source?: string;
  result?: GitCheckResults | null;
  error?: string | null;
}

export async function runGitChecksWithProfile(
  repoPath: string,
  options: RunChecksWithProfileOptions,
  baseUrl?: string,
): Promise<GitCheckResults> {
  const response = await apiRequest<GitCheckResults | GitCheckRunJobResponse>('/api/git/checks/run', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoPath, ...options }),
  });
  if (options.background && 'status' in response && response.status === 'running') {
    return waitForGitCheckRun(response.runId, baseUrl);
  }
  if ('status' in response && response.status === 'failed') {
    throw new Error(response.error || 'Background check run failed.');
  }
  if ('status' in response && response.status === 'complete' && response.result) {
    return response.result;
  }
  return response as GitCheckResults;
}

export async function getGitCheckRunStatus(runId: string, baseUrl?: string): Promise<GitCheckRunJobResponse> {
  const url = `/api/git/checks/runs/${encodeURIComponent(runId)}`;
  return apiRequest<GitCheckRunJobResponse>(url, { baseUrl });
}

async function waitForGitCheckRun(runId: string, baseUrl?: string): Promise<GitCheckResults> {
  for (let attempt = 0; attempt < 3600; attempt += 1) {
    const job = await getGitCheckRunStatus(runId, baseUrl);
    if (job.status === 'complete' && job.result) return job.result;
    if (job.status === 'failed') throw new Error(job.error || 'Background check run failed.');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Background check run timed out while polling for completion.');
}

export interface GitCheckPlanCandidate {
  id: string;
  name?: string;
  description?: string;
  classification: 'verified' | 'inferred' | 'manual' | 'remote-only' | string;
  source?: string;
  provenance?: string;
  command?: string | null;
  commands?: string[];
  cwd?: string;
  kind?: string | null;
  executionPolicy?: 'local-command' | 'never-auto-execute' | string;
  required?: boolean;
  blocking?: boolean;
  skippable?: boolean;
  cost?: 'fast' | 'medium' | 'heavy' | string;
  defaultProfiles?: string[];
  gateStrength?: string | null;
  determinism?: string | null;
  ciWorkflow?: string | null;
  ciJob?: string | null;
  ciRequired?: boolean;
  opensWindow?: boolean;
  commandProvenance?: { source?: string; path?: string; field?: string; job?: string | null };
  reason?: string;
  remoteOnly?: boolean;
  affectedByChange?: boolean;
}

export interface GitCheckPlanResponse {
  schemaVersion: 'check-plan/v1';
  repoPath: string;
  action: 'commit' | 'push' | 'ci-local' | 'release' | string;
  generatedAt?: string;
  planHash?: string | null;
  configHash?: string | null;
  selectionMode: string;
  affectedScope: {
    branch: string | null;
    head: string | null;
    dirtyHash: string | null;
    clean?: boolean;
    changedFiles: string[];
  };
  discoveryMode?: string;
  candidates: GitCheckPlanCandidate[];
  recommendedChecks: GitCheckPlanCandidate[];
  requiredChecks: GitCheckPlanCandidate[];
  omittedChecks: Array<{ id: string; reason: string; classification: string }>;
  expectedCost: { tier: 'fast' | 'medium' | 'heavy' | string; score: number; checkCount: number };
  selectionRationale: string;
  remoteEvidence?: GitCheckPlanCandidate[];
  readOnly: boolean;
  persistence: 'approval-gated-adoption-only' | string;
}

export async function getGitCheckPlan(
  repoPath: string,
  action: GitCheckPlanResponse['action'] = 'commit',
  baseUrl?: string,
  selectionMode?: string,
): Promise<GitCheckPlanResponse> {
  const mode = selectionMode ? `&selectionMode=${encodeURIComponent(selectionMode)}` : '';
  const url = `/api/git/checks/plan?repoPath=${encodeURIComponent(repoPath)}&action=${encodeURIComponent(action)}${mode}`;
  return apiRequest<GitCheckPlanResponse>(url, { baseUrl });
}

export interface GitHubCheckHistoryResponse {
  source: 'github';
  available: boolean;
  reason: string | null;
  provider: 'github';
  repository: string | null;
  branch: string | null;
  runs: Array<Record<string, unknown>>;
  mergedIntoLocalEvidence: false;
}

export async function getGitHubCheckHistory(
  repoPath: string,
  options: { branch?: string | null; limit?: number } = {},
  baseUrl?: string,
): Promise<GitHubCheckHistoryResponse> {
  const params = new URLSearchParams({ repoPath });
  // `null` explicitly means all branches. Omitting the option preserves the
  // backend's default of the current branch.
  if (options.branch === null) params.set('branch', 'all');
  else if (options.branch) params.set('branch', options.branch);
  if (options.limit) params.set('limit', String(options.limit));
  return apiRequest<GitHubCheckHistoryResponse>(`/api/git/checks/github-history?${params.toString()}`, { baseUrl });
}

export interface GitLocalCheckHistoryResponse {
  repoId: string;
  branch: string | null;
  limit: number;
  offset: number;
  nextOffset: number | null;
  runs: any[];
}

export async function getGitLocalCheckHistory(
  repoPath: string,
  options: { branch?: string | null; limit?: number; offset?: number } = {},
  baseUrl?: string,
): Promise<GitLocalCheckHistoryResponse> {
  const params = new URLSearchParams({ repoPath });
  if (options.branch === null) params.set('branch', 'all');
  else if (options.branch) params.set('branch', options.branch);
  if (options.limit) params.set('limit', String(options.limit));
  if (options.offset) params.set('offset', String(options.offset));
  return apiRequest<GitLocalCheckHistoryResponse>(`/api/git/checks/history?${params.toString()}`, { baseUrl });
}

export interface GitCheckStateResponse {
  repoId: string;
  repoPath: string;
  hasState: boolean;
  lastRun: {
    timestamp: string;
    gitFingerprint: { branch?: string | null; head: string | null; dirtyHash: string | null };
    configHash: string | null;
    configPath?: string | null;
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
      gateStrength?: string;
      determinism?: string;
      sourcePack?: string | null;
      tags?: string[];
      severity?: string;
      promotionState?: string;
      owner?: string | null;
      commands: Array<{ command: string; exitCode: number; success: boolean; durationMs: number }>;
    }>;
    groups: Record<string, { description: string }>;
    groupResults: Record<string, { passedLanes: string[]; failedLanes: string[]; allPassed: boolean }>;
    ciSync: any | null;
    branch?: string | null;
    head?: string | null;
    dirtyHash?: string | null;
    planHash?: string | null;
    action?: string | null;
    selectionMode?: string | null;
    runnerVersion?: string | null;
    source?: string | null;
    sourceKind?: string | null;
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

export interface ElegyChecksAuditResponse {
  repoRoot: string;
  detectedStacks: string[];
  proposals: Array<{
    id: string;
    pack: string;
    checkId: string;
    status: 'missing' | 'configured';
    gateStrength: 'blocking' | 'advisory' | 'required-evidence' | 'score';
    severity: string;
    reason: string;
    commands: string[];
    tags: string[];
  }>;
  summary: {
    proposalCount: number;
    missing: number;
    configured: number;
    advisory: number;
    blocking: number;
  };
}

export interface ElegyChecksHistoryResponse {
  repoId: string;
  branch: string | null;
  limit: number;
  offset: number;
  nextOffset: number | null;
  runs: Array<{
    runId: string;
    timestamp: string;
    profile: string | null;
    overallPass: boolean;
    checksRun: number;
    checksPassed: number;
    checksFailed: number;
    configHash: string;
    configPath?: string | null;
    planHash?: string | null;
    action?: string | null;
    selectionMode?: string | null;
    runnerVersion?: string | null;
    source?: string | null;
    lanes?: Record<string, unknown>;
  }>;
}

export interface ElegyChecksLogsResponse {
  repoId: string;
  runId: string;
  limit: number;
  offset: number;
  nextOffset: number | null;
  entries: any[];
}

export interface ElegyChecksPacksResponse {
  packs: Array<{ id: string; version: string; description: string; checks: any[] }>;
}

export async function auditElegyChecks(repoPath: string, baseUrl?: string): Promise<ElegyChecksAuditResponse> {
  const url = `/api/git/checks/audit?repoPath=${encodeURIComponent(repoPath)}`;
  return apiRequest<ElegyChecksAuditResponse>(url, { baseUrl });
}

export async function getElegyChecksHistory(repoPath: string, limit = 25, offset = 0, baseUrl?: string): Promise<ElegyChecksHistoryResponse> {
  const url = `/api/git/checks/history?repoPath=${encodeURIComponent(repoPath)}&limit=${encodeURIComponent(String(limit))}&offset=${encodeURIComponent(String(offset))}`;
  return apiRequest<ElegyChecksHistoryResponse>(url, { baseUrl });
}

export async function getElegyChecksLogs(repoPath: string, runId: string, limit = 100, offset = 0, baseUrl?: string): Promise<ElegyChecksLogsResponse> {
  const url = `/api/git/checks/logs?repoPath=${encodeURIComponent(repoPath)}&runId=${encodeURIComponent(runId)}&limit=${encodeURIComponent(String(limit))}&offset=${encodeURIComponent(String(offset))}`;
  return apiRequest<ElegyChecksLogsResponse>(url, { baseUrl });
}

export async function listElegyCheckPacks(repoPath: string, baseUrl?: string): Promise<ElegyChecksPacksResponse> {
  const url = `/api/git/checks/packs?repoPath=${encodeURIComponent(repoPath)}`;
  return apiRequest<ElegyChecksPacksResponse>(url, { baseUrl });
}

export async function applyElegyCheckRecommendation(repoPath: string, proposal: string, baseUrl?: string): Promise<any> {
  return apiRequest<any>('/api/git/checks/apply', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoPath, proposal }),
  });
}

export type RepoQualityReadiness =
  | 'ready'
  | 'unsupported'
  | 'setup-required'
  | 'repair-required'
  | 'local-failing'
  | 'remote-failing'
  | 'remote-unknown';

export interface RepoQualityStatus {
  schemaVersion: 'repo-quality-status/v1';
  repoPath: string;
  readiness: RepoQualityReadiness;
  nextAction: { id: string; label: string };
  remoteStatus?: string;
  support: { supported: boolean; adapter: string; reason: string | null };
  local: {
    config: { elegy: boolean; legacyCommitCheck: boolean };
    hooks: {
      manager: string;
      configured: boolean;
      active: boolean;
      configPath: string | null;
      coreHooksPath: string | null;
    };
    lastProof: GitCheckStateResponse['lastRun'];
    freshness: { fresh: boolean; reason: string };
  };
  remote: {
    available: boolean;
    reason?: string;
    provider?: 'github';
    repository?: string;
    branch?: string | null;
    latestConclusion?: string | null;
    protected?: boolean;
    runs?: Array<Record<string, unknown>>;
  };
  drift: Array<{ id: string; severity: 'warning' | 'error'; message: string }>;
}

export interface RepoQualitySetupTaskResult {
  schemaVersion: 'repo-quality-setup-task/v1';
  repoPath: string;
  skill: 'repo-quality-setup';
  prompt: string;
  launched: boolean;
  taskId?: string | null;
  reason?: string;
}

export async function getRepoQualityStatus(repoPath: string, baseUrl?: string): Promise<RepoQualityStatus> {
  const url = `/api/git/quality/status?repoPath=${encodeURIComponent(repoPath)}`;
  return apiRequest<RepoQualityStatus>(url, { baseUrl });
}

export async function createRepoQualitySetupTask(repoPath: string, baseUrl?: string): Promise<RepoQualitySetupTaskResult> {
  return apiRequest<RepoQualitySetupTaskResult>('/api/git/quality/setup-task', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoPath }),
  });
}

// ─── Git hooks state and setup ──────────────────────────────────────────────

export interface GitHooksState {
  available: boolean;
  reason?: string;
  coreHooksPath?: string | null;
  active?: boolean;
  hooks?: Record<string, { exists: boolean; managed: boolean; group: string }>;
}

export interface GitHooksSetupResult {
  hooksConfigured: boolean;
  coreHooksPath: string;
  hooksPresent: Record<string, boolean>;
  allHooksPresent: boolean;
  skipped?: boolean;
  reason?: string;
}

export async function getGitHooksState(repoPath: string, baseUrl?: string): Promise<GitHooksState> {
  const url = `/api/git/hooks/state?repoPath=${encodeURIComponent(repoPath)}`;
  return apiRequest<GitHooksState>(url, { baseUrl });
}

export async function setupGitHooks(repoPath: string, baseUrl?: string): Promise<GitHooksSetupResult> {
  return apiRequest<GitHooksSetupResult>('/api/git/hooks/setup', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoPath }),
  });
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

// ─── Commit message generation ──────────────────────────────────────────

export interface GenerateCommitMessageResponse {
  ok: boolean;
  message: string;
  model: string | null;
  source: 'opencode';
  fallbackIndex: number;
  warnings?: string[];
  code?: string;
  lastError?: string;
}

export interface GenerateCommitMessageOptions {
  stagedOnly?: boolean;
  models?: string[];
}

export async function generateCommitMessage(
  repoPath: string,
  options?: GenerateCommitMessageOptions
): Promise<GenerateCommitMessageResponse> {
  return apiRequest<GenerateCommitMessageResponse>('/api/git/commit-message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      repoPath,
      stagedOnly: options?.stagedOnly,
      models: options?.models,
    }),
  });
}
