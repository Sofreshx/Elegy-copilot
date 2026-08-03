import { apiRequest } from './core';

export interface RepoOperationsIssue {
  code: string;
  message: string;
  severity?: 'error' | 'warning' | 'info' | string;
  details?: Record<string, unknown> | null;
}

export interface RepoOperationsCapability {
  enabled: boolean;
  label: string;
  description?: string;
  reason?: string;
  contract?: string;
  scope?: string;
  model?: string;
  agent?: string;
  mutation?: string;
  available?: boolean;
  requiresConfirmation?: boolean;
  blockerCodes?: string[];
}

export interface RepoOperationsSync {
  branch: string | null;
  upstream: string | null;
  upstreamGone?: boolean;
  clean: boolean | null;
  ahead: number;
  behind: number;
  headSha?: string | null;
  upstreamSha?: string | null;
  remoteAvailable: boolean;
  remoteName?: string | null;
  remoteUrl?: string | null;
  state?: 'clean' | 'dirty' | 'unavailable' | string;
  issueCodes: string[];
  blockerCodes?: string[];
  syncEligible?: boolean;
  activeWorktreeConflict?: boolean;
}

export interface RepoOperationsBranch {
  repoId?: string | null;
  repoLabel?: string | null;
  repoPath?: string | null;
  name: string;
  default: boolean;
  current: boolean;
  upstream: string | null;
  upstreamGone?: boolean;
  ahead: number;
  behind: number;
  state: 'default' | 'up-to-date' | 'ahead' | 'behind' | 'diverged' | 'no-upstream' | 'upstream-gone' | 'merged' | 'active-worktree' | string;
  mergedIntoDefault: boolean;
  activeWorktree: boolean;
  worktree: string | null;
  cleanupEligible: boolean;
  issueCodes: string[];
}

export interface RepoOperationsPullRequest {
  repoId?: string | null;
  repoLabel?: string | null;
  repoPath?: string | null;
  number: number | null;
  title: string;
  url: string;
  state?: string;
  baseRefName: string | null;
  headRefName: string | null;
  baseSha?: string | null;
  headSha?: string | null;
  isDraft: boolean;
  author?: { login: string | null; name: string | null } | null;
  updatedAt?: string | null;
  reviewDecision?: string | null;
  mergeable?: string;
  mergeStateStatus?: string;
  statusCheckRollup?: unknown[];
  checksSummary?: { passed: number; failed: number; pending: number };
  hasLocalBranch: boolean;
  localBranchState?: string | null;
}

export interface RepoOperationsRunSummary {
  id: string;
  status: string;
  repoId: string | null;
  repoLabel?: string | null;
  prNumber: number | null;
  targetBranch?: string | null;
  blockerCodes: string[];
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface RepoOperationsAgentRun extends RepoOperationsRunSummary {
  repoPath?: string | null;
  observedHeadSha?: string | null;
  observedBaseSha?: string | null;
  model?: string;
  agent?: string;
  allowedOperationScope?: Record<string, boolean>;
  evidence?: Record<string, unknown> | null;
  proposedOperation?: Record<string, unknown> | null;
  logs?: Array<{ at: string; message: string; data?: unknown }>;
  error?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  result?: Record<string, unknown> | null;
}

export interface RepoOperationsSyncResult {
  contractVersion: 'repo-operations.action.v2' | string;
  operation: 'sync';
  startedAt: string;
  completedAt: string;
  summary: {
    requested: number;
    eligible: number;
    synced: number;
    unchanged: number;
    skipped: number;
    failed: number;
  };
  repositories: Array<{
    repoId: string | null;
    repoLabel?: string;
    status: 'synced' | 'unchanged' | 'skipped' | 'failed';
    before: RepoOperationsSync;
    after?: RepoOperationsSync;
    issueCodes: string[];
    error?: string | null;
  }>;
}

export interface RepoOperationsRepository {
  repoId: string | null;
  repoPath: string | null;
  repoLabel: string;
  sources?: string[];
  registered?: boolean;
  canonicalRemote?: string | null;
  available: boolean;
  provider: 'github' | 'unsupported' | 'none' | string;
  sync: RepoOperationsSync;
  defaultBranch?: string | null;
  branches: RepoOperationsBranch[];
  pullRequests: RepoOperationsPullRequest[];
  issues: RepoOperationsIssue[];
  errors?: RepoOperationsIssue[];
  activity?: { active: boolean; issueCodes: string[]; details?: unknown };
  actionCapabilities?: {
    sync?: RepoOperationsCapability;
    prAgent?: RepoOperationsCapability;
  };
}

export interface RepoOperationsOverview {
  contractVersion?: string;
  schemaVersion: number;
  generatedAt: string;
  summary: {
    trackedRepos: number;
    reposNeedingAttention: number;
    syncIssues: number;
    staleBranches: number;
    openPullRequests: number;
  };
  warnings: string[];
  actionContract?: {
    version: string;
    mode: string;
    mutationsEnabled: boolean;
    requiresExplicitApproval: boolean;
    requiresFreshRepositoryState: boolean;
    blockedConditions: string[];
    sync?: Record<string, unknown>;
    pullRequest?: Record<string, unknown>;
  };
  capabilities: {
    readOnlyScan?: RepoOperationsCapability;
    sync: RepoOperationsCapability;
    branchCleanup: RepoOperationsCapability;
    pullRequestHandling: RepoOperationsCapability;
    prAgent?: RepoOperationsCapability;
    [key: string]: RepoOperationsCapability | undefined;
  };
  repositories: RepoOperationsRepository[];
  branches?: RepoOperationsBranch[];
  pullRequests?: RepoOperationsPullRequest[];
  activeRuns?: RepoOperationsRunSummary[];
}

export async function getRepoOperationsOverview(): Promise<RepoOperationsOverview> {
  return apiRequest<RepoOperationsOverview>('/api/repo-operations/overview');
}

export async function syncRepoOperations(input: { confirmed: true }): Promise<RepoOperationsSyncResult> {
  return apiRequest<RepoOperationsSyncResult>('/api/repo-operations/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export interface StartRepoOperationsAgentRunInput {
  repoId: string;
  prNumber: number;
  targetBranch: string;
  observedHeadSha: string;
  observedBaseSha: string;
  allowedOperationScope?: Record<string, boolean>;
}

export async function startRepoOperationsAgentRun(
  input: StartRepoOperationsAgentRunInput,
): Promise<{ run: RepoOperationsAgentRun }> {
  return apiRequest<{ run: RepoOperationsAgentRun }>('/api/repo-operations/agent-runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function getRepoOperationsAgentRun(runId: string): Promise<RepoOperationsAgentRun> {
  return apiRequest<RepoOperationsAgentRun>(`/api/repo-operations/agent-runs/${encodeURIComponent(runId)}`);
}

export async function approveRepoOperationsAgentRun(runId: string): Promise<RepoOperationsAgentRun> {
  return apiRequest<RepoOperationsAgentRun>(`/api/repo-operations/agent-runs/${encodeURIComponent(runId)}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
}

export async function cancelRepoOperationsAgentRun(runId: string): Promise<RepoOperationsAgentRun> {
  return apiRequest<RepoOperationsAgentRun>(`/api/repo-operations/agent-runs/${encodeURIComponent(runId)}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
}
