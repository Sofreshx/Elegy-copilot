'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const repoInventoryLib = require('./repoInventoryService');
const sessionLib = require('./sessions');

const REPO_OPERATIONS_SCHEMA_VERSION = 3;
const REPO_OPERATIONS_CONTRACT_VERSION = 'repo-operations.overview.v3';
const REPO_OPERATIONS_ACTION_CONTRACT_VERSION = 'repo-operations.action.v3';
const REPO_OPERATIONS_AGENT = 'repo-operations';
const REPO_OPERATIONS_MODEL = 'opencode-go/deepseek-v4-flash';
const DEFAULT_COMMAND_TIMEOUT_MS = 3000;
const DEFAULT_GITHUB_TIMEOUT_MS = 5000;
const DEFAULT_REPOSITORY_TIMEOUT_MS = 12000;
const DEFAULT_ACTION_TIMEOUT_MS = 30000;
const DEFAULT_AGENT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_CONCURRENCY = 16;
const DEFAULT_AGENT_RUN_LIMIT = 100;
const AGENT_RUN_STATE_VERSION = 1;
const AGENT_RUN_STATUSES = new Set([
  'queued',
  'running',
  'awaiting-approval',
  'blocked',
  'needs-manual-session',
  'completed',
  'failed',
  'cancelled',
]);
const ACTIVE_AGENT_RUN_STATUSES = new Set(['queued', 'running', 'awaiting-approval']);
const TERMINAL_AGENT_RUN_STATUSES = new Set(['completed', 'failed', 'cancelled', 'needs-manual-session', 'blocked']);

const FUTURE_ACTION_REASON = 'This action is intentionally disabled until a safe, explicit preparation flow is available.';
const PR_AGENT_REASON = 'Runs per repository and per pull request; preparation is read-only until a user approves a fresh-SHA merge.';

const CAPABILITIES = Object.freeze({
  readOnlyScan: {
    enabled: true,
    label: 'Refresh all',
    description: 'Read current local Git refs and GitHub state.',
  },
  sync: {
    enabled: true,
    label: 'Sync eligible repositories',
    description: 'Fetch configured remotes and fast-forward clean, tracked current branches only.',
    reason: 'Requires explicit confirmation. Dirty, ahead, diverged, detached, unavailable, or busy repositories are skipped.',
    contract: REPO_OPERATIONS_ACTION_CONTRACT_VERSION,
    requiresConfirmation: true,
    mutation: 'fetch-and-fast-forward-only',
  },
  branchCleanup: {
    enabled: false,
    label: 'Clean merged worktrees',
    description: 'Remove clean, inactive worktrees whose local branch is already merged into the default branch, then delete that local branch safely.',
    reason: 'No eligible merged worktrees were found.',
    contract: REPO_OPERATIONS_ACTION_CONTRACT_VERSION,
    requiresConfirmation: true,
    mutation: 'remove-worktree-and-delete-local-branch',
  },
  pullRequestHandling: {
    enabled: false,
    label: 'Prepare PR handling',
    reason: 'PR handling is intentionally per repository; use the repository OpenCode preparation control.',
    contract: REPO_OPERATIONS_ACTION_CONTRACT_VERSION,
    scope: 'per-repository',
  },
  prAgent: {
    enabled: true,
    label: 'Prepare merge with OpenCode',
    description: PR_AGENT_REASON,
    contract: REPO_OPERATIONS_ACTION_CONTRACT_VERSION,
    model: REPO_OPERATIONS_MODEL,
    agent: REPO_OPERATIONS_AGENT,
    mutation: 'approval-only-squash-merge',
  },
});

const ACTION_CONTRACT = Object.freeze({
  version: REPO_OPERATIONS_ACTION_CONTRACT_VERSION,
  mode: 'safe-sync-and-prepare-then-approve',
  mutationsEnabled: true,
  requiresExplicitApproval: true,
  requiresFreshRepositoryState: true,
  sync: {
    operation: 'fetch-and-fast-forward-only',
    currentBranchOnly: true,
    pushes: false,
    normalMerges: false,
    rebases: false,
    checkouts: false,
    pruning: false,
    stashing: false,
  },
  pullRequest: {
    preparationAgent: REPO_OPERATIONS_AGENT,
    model: REPO_OPERATIONS_MODEL,
    mergeMethod: 'squash',
    requiresObservedHeadSha: true,
    requiresObservedBaseSha: true,
    deletesBranches: false,
    autoMerge: false,
  },
  cleanup: {
    operation: 'remove-worktree-and-delete-local-branch',
    remotes: false,
    force: false,
    requiresCandidateList: true,
    revalidatesEachCandidate: true,
  },
  blockedConditions: [
    'active-session-or-worktree',
    'dirty-worktree',
    'conflicts',
    'ahead-of-upstream',
    'diverged',
    'no-upstream',
    'upstream-gone',
    'remote-unavailable',
    'protected-or-default-branch',
    'stale-approval',
    'current-worktree',
    'current-branch',
    'default-branch',
    'worktree-dirty',
    'not-merged',
    'stale-cleanup-candidate',
  ],
});

const ATTENTION_BRANCH_STATES = new Set([
  'ahead',
  'behind',
  'diverged',
  'no-upstream',
  'upstream-gone',
  'merged',
  'active-worktree',
]);

const ISSUE_DEFINITIONS = Object.freeze({
  'dirty-worktree': { severity: 'error', title: 'Working tree is dirty', message: 'Uncommitted changes are present.' },
  'no-upstream': { severity: 'warning', title: 'No upstream configured', message: 'This branch is not tracking a remote branch.' },
  'upstream-gone': { severity: 'warning', title: 'Upstream is gone', message: 'The configured upstream branch is no longer available.' },
  diverged: { severity: 'error', title: 'Branch diverged', message: 'Local and upstream history have diverged.' },
  ahead: { severity: 'info', title: 'Ahead of upstream', message: 'Local commits have not been pushed.' },
  'ahead-of-upstream': { severity: 'info', title: 'Ahead of upstream', message: 'Local commits have not been pushed.' },
  behind: { severity: 'info', title: 'Behind upstream', message: 'Remote commits are available to fast-forward.' },
  'active-worktree': { severity: 'info', title: 'Worktree exists', message: 'This branch is checked out in a linked worktree.' },
  merged: { severity: 'info', title: 'Merged worktree', message: 'This branch is merged into the default branch and may be eligible for cleanup.' },
  'active-session-or-worktree': { severity: 'warning', title: 'Active session or worktree', message: 'Managed activity is using this repository or worktree.' },
  'remote-unavailable': { severity: 'warning', title: 'Remote unavailable', message: 'The configured remote could not be reached.' },
  'no-remote': { severity: 'warning', title: 'No remote configured', message: 'No Git remote is configured for this repository.' },
  'unsupported-provider': { severity: 'warning', title: 'Provider not supported', message: 'Pull request reporting is only available for GitHub remotes.' },
  'linked-worktree-checkout': { severity: 'info', title: 'Linked worktree checkout', message: 'This checkout is represented by its canonical repository.' },
  'missing-path': { severity: 'error', title: 'Repository unavailable', message: 'The repository path is unavailable.' },
  'scan-failed': { severity: 'error', title: 'Repository scan failed', message: 'The repository could not be scanned.' },
  'command-timeout': { severity: 'warning', title: 'Command timed out', message: 'A repository command exceeded its time limit.' },
  'git-command-failed': { severity: 'warning', title: 'Git command failed', message: 'A Git command could not complete.' },
  'worktree-dirty': { severity: 'error', title: 'Worktree is dirty', message: 'Uncommitted changes prevent safe cleanup.' },
  'worktree-state-unavailable': { severity: 'warning', title: 'Worktree state unavailable', message: 'The linked worktree could not be revalidated.' },
  'current-worktree': { severity: 'warning', title: 'Primary worktree protected', message: 'The repository’s primary worktree is never removed by cleanup.' },
  'not-merged': { severity: 'info', title: 'Not merged', message: 'The branch is not fully merged into the default branch.' },
  'default-branch': { severity: 'warning', title: 'Default branch protected', message: 'The default branch is never removed by cleanup.' },
  'current-branch': { severity: 'warning', title: 'Current branch protected', message: 'The active branch is never removed by cleanup.' },
  'stale-cleanup-candidate': { severity: 'warning', title: 'State changed', message: 'The candidate no longer matches the confirmed scan.' },
  'repository-not-in-catalog': { severity: 'error', title: 'Repository not in catalog', message: 'The repository is not in the canonical catalog inventory.' },
  'cleanup-operation-unavailable': { severity: 'error', title: 'Cleanup unavailable', message: 'Safe Git cleanup operations are unavailable.' },
  'invalid-cleanup-candidate': { severity: 'warning', title: 'Invalid cleanup candidate', message: 'A worktree path, branch, and observed Git SHAs are required.' },
  'activity-state-unavailable': { severity: 'warning', title: 'Activity state unavailable', message: 'Managed session or worktree activity could not be verified.' },
  'missing-github-cli': { severity: 'warning', title: 'GitHub CLI unavailable', message: 'The GitHub CLI is not installed or could not be started.' },
  'github-authentication-unavailable': { severity: 'warning', title: 'GitHub authentication unavailable', message: 'GitHub CLI authentication could not be verified.' },
  'github-query-failed': { severity: 'warning', title: 'GitHub query failed', message: 'Open GitHub pull requests could not be loaded.' },
  'invalid-merge-request': { severity: 'warning', title: 'Invalid merge request', message: 'The merge request is missing a squash operation or expected head SHA.' },
  'stale-repository-state': { severity: 'warning', title: 'Repository state changed', message: 'The repository changed during the safe sync operation.' },
  'fast-forward-verification-failed': { severity: 'error', title: 'Fast-forward verification failed', message: 'The resulting branch was not clean and up to date.' },
  'sync-command-failed': { severity: 'error', title: 'Safe sync failed', message: 'The fetch or fast-forward operation could not complete.' },
  'worktree-remove-failed': { severity: 'error', title: 'Worktree removal failed', message: 'Git could not remove the linked worktree.' },
  'branch-delete-failed': { severity: 'warning', title: 'Local branch retained', message: 'The worktree was removed, but Git kept the local branch.' },
});

function issueForCode(code, details = null, fallbackMessage = null) {
  const definition = ISSUE_DEFINITIONS[code] || {
    severity: 'warning',
    title: code || 'Repository issue',
    message: fallbackMessage || 'Repository state needs attention.',
  };
  return issue(code, fallbackMessage || definition.message, definition.severity, {
    title: definition.title,
    ...(details && typeof details === 'object' ? details : {}),
  });
}

function asString(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function asNullableString(value) {
  const normalized = asString(value);
  return normalized || null;
}

function asCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function clone(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function normalizePathForComparison(value) {
  return String(value || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function createRunId() {
  return `repo-ops-${crypto.randomUUID().slice(0, 12)}`;
}

function nowIso(now) {
  const value = typeof now === 'function' ? now() : Date.now();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function issue(code, message, severity = 'warning', details = null) {
  const definition = ISSUE_DEFINITIONS[code];
  const normalizedDetails = details && typeof details === 'object' ? { ...details } : null;
  const title = asString(normalizedDetails?.title, definition?.title || code || 'Repository issue');
  if (normalizedDetails) delete normalizedDetails.title;
  return {
    code,
    message,
    severity,
    title,
    ...(normalizedDetails ? { details: normalizedDetails } : {}),
  };
}

function errorMessage(error, fallback) {
  return asString(error?.stderr || error?.message || error, fallback) || fallback;
}

function isTimeoutError(error) {
  return Boolean(
    error?.code === 'ETIMEDOUT'
      || error?.timedOut
      || error?.killed && error?.signal === 'SIGTERM',
  );
}

function commandIssue(error, fallbackCode, fallbackMessage) {
  if (isTimeoutError(error)) {
    return issue('command-timeout', fallbackMessage || 'The repository command timed out.', 'warning', {
      command: error?.command || null,
    });
  }
  return issue(fallbackCode, errorMessage(error, fallbackMessage), 'warning');
}

function normalizeSha(value) {
  const sha = asString(value);
  return sha || null;
}

function buildSyncEligibility(sync, activity = null, available = true) {
  const blockerCodes = [];
  if (!available) blockerCodes.push('repository-unavailable');
  if (!sync?.branch) blockerCodes.push('detached-head');
  if (sync?.clean === false) blockerCodes.push('dirty-worktree');
  if (!sync?.remoteName) blockerCodes.push('no-remote');
  else if (sync?.remoteAvailable === false) blockerCodes.push('remote-unavailable');
  if (!sync?.upstream) blockerCodes.push('no-upstream');
  if (sync?.upstreamGone) blockerCodes.push('upstream-gone');
  if (asCount(sync?.ahead) > 0) blockerCodes.push(asCount(sync?.behind) > 0 ? 'diverged' : 'ahead-of-upstream');
  if (activity?.active === true) blockerCodes.push('active-session-or-worktree');
  for (const code of Array.isArray(activity?.issueCodes) ? activity.issueCodes : []) blockerCodes.push(code);
  return {
    eligible: unique(blockerCodes).length === 0,
    blockerCodes: unique(blockerCodes),
  };
}

function syncStateSignature(sync) {
  return JSON.stringify({
    branch: sync?.branch || null,
    upstream: sync?.upstream || null,
    clean: sync?.clean === true,
    ahead: asCount(sync?.ahead),
    behind: asCount(sync?.behind),
    upstreamGone: Boolean(sync?.upstreamGone),
    remoteName: sync?.remoteName || null,
    remoteAvailable: sync?.remoteAvailable === true,
    headSha: normalizeSha(sync?.headSha),
    upstreamSha: normalizeSha(sync?.upstreamSha),
    activeWorktreeConflict: Boolean(sync?.activeWorktreeConflict),
  });
}

function normalizeSyncState(sync, defaults = {}) {
  const normalized = {
    branch: asNullableString(sync?.branch),
    upstream: asNullableString(sync?.upstream),
    upstreamGone: Boolean(sync?.upstreamGone),
    clean: typeof sync?.clean === 'boolean' ? sync.clean : null,
    ahead: asCount(sync?.ahead),
    behind: asCount(sync?.behind),
    headSha: normalizeSha(sync?.headSha),
    upstreamSha: normalizeSha(sync?.upstreamSha),
    remoteAvailable: Boolean(sync?.remoteAvailable),
    remoteName: asNullableString(sync?.remoteName),
    remoteUrl: asNullableString(sync?.remoteUrl),
    state: asString(sync?.state, 'unavailable'),
    issueCodes: unique(Array.isArray(sync?.issueCodes) ? sync.issueCodes : []),
    activeWorktreeConflict: Boolean(sync?.activeWorktreeConflict),
  };
  const eligibility = buildSyncEligibility(normalized, defaults.activity, defaults.available !== false);
  normalized.syncEligible = eligibility.eligible;
  normalized.blockerCodes = unique([
    ...normalized.issueCodes.filter((code) => [
      'dirty-worktree',
      'no-remote',
      'remote-unavailable',
      'no-upstream',
      'upstream-gone',
      'diverged',
      'ahead-of-upstream',
      'detached-head',
      'active-session-or-worktree',
      'repository-unavailable',
    ].includes(code)),
    ...eligibility.blockerCodes,
  ]);
  return normalized;
}

function withTimeout(promise, timeoutMs) {
  const duration = Number(timeoutMs);
  if (!Number.isFinite(duration) || duration <= 0) return promise;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error('Repository scan timed out.');
      error.code = 'ETIMEDOUT';
      error.timedOut = true;
      reject(error);
    }, duration);
    if (typeof timer.unref === 'function') timer.unref();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function classifyBranchState({
  isDefault = false,
  activeWorktree = false,
  upstream = null,
  upstreamGone = false,
  ahead = 0,
  behind = 0,
  mergedIntoDefault = false,
} = {}) {
  if (isDefault) return 'default';
  if (activeWorktree) return 'active-worktree';
  if (mergedIntoDefault) return 'merged';
  if (upstreamGone) return 'upstream-gone';
  if (!upstream) return 'no-upstream';
  if (ahead > 0 && behind > 0) return 'diverged';
  if (behind > 0) return 'behind';
  if (ahead > 0) return 'ahead';
  return 'up-to-date';
}

function normalizeBranchRecord(branch) {
  return {
    name: asString(branch?.name),
    upstream: asNullableString(branch?.upstream),
    upstreamGone: Boolean(branch?.upstreamGone),
    ahead: asCount(branch?.ahead),
    behind: asCount(branch?.behind),
  };
}

function parsePorcelainStatus(output) {
  let branch = null;
  let upstream = null;
  let ahead = 0;
  let behind = 0;
  let dirty = false;

  for (const line of String(output || '').split(/\r?\n/)) {
    if (line.startsWith('# branch.head ')) {
      branch = asNullableString(line.slice('# branch.head '.length));
      if (branch === '(detached)') branch = null;
      continue;
    }
    if (line.startsWith('# branch.upstream ')) {
      upstream = asNullableString(line.slice('# branch.upstream '.length));
      continue;
    }
    if (line.startsWith('# branch.ab ')) {
      const match = line.match(/# branch\.ab \+?(\d+) -?(\d+)/);
      if (match) {
        ahead = asCount(match[1]);
        behind = asCount(match[2]);
      }
      continue;
    }
    if (line && !line.startsWith('#')) {
      dirty = true;
    }
  }

  return { branch, upstream, ahead, behind, clean: !dirty };
}

function parseBranchRecords(output) {
  return String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, upstream, tracking] = line.split('\t');
      const trackingText = asString(tracking);
      const upstreamGone = /gone/i.test(trackingText);
      const aheadMatch = trackingText.match(/ahead\s+(\d+)/i);
      const behindMatch = trackingText.match(/behind\s+(\d+)/i);
      return normalizeBranchRecord({
        name,
        upstream,
        upstreamGone,
        ahead: aheadMatch ? aheadMatch[1] : trackingText === '>' ? 1 : 0,
        behind: behindMatch ? behindMatch[1] : trackingText === '<' ? 1 : 0,
      });
    })
    .filter((branch) => branch.name);
}

function parseWorktreeRecords(output) {
  const worktrees = [];
  let current = null;
  for (const line of String(output || '').split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      if (current?.branch) worktrees.push(current);
      current = { path: line.slice('worktree '.length).trim(), branch: null };
      continue;
    }
    if (line.startsWith('branch refs/heads/')) {
      current = current || { path: null, branch: null };
      current.branch = line.slice('branch refs/heads/'.length).trim();
    }
  }
  if (current?.branch) worktrees.push(current);
  return worktrees;
}

function parseRemoteRecords(output) {
  const records = new Map();
  for (const line of String(output || '').split(/\r?\n/)) {
    const match = line.match(/^([^\s]+)\s+([^\s]+)\s+\((fetch|push)\)$/i);
    if (!match) continue;
    const name = match[1];
    const record = records.get(name) || { name, url: null };
    if (match[3].toLowerCase() === 'fetch' || !record.url) record.url = match[2];
    records.set(name, record);
  }
  return Array.from(records.values());
}

function normalizeRemoteUrl(url) {
  return asString(url).replace(/[\/]\.git$/, '').replace(/\.git$/, '');
}

function resolveProvider(url) {
  if (!url) return 'none';
  return /(?:^|[@/:])github\.com(?:[/:]|$)/i.test(url) ? 'github' : 'unsupported';
}

function computeChecksSummary(statusCheckRollup) {
  let passed = 0;
  let failed = 0;
  let pending = 0;
  for (const check of Array.isArray(statusCheckRollup) ? statusCheckRollup : []) {
    const conclusion = asString(check?.conclusion || check?.status).toUpperCase();
    if (['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(conclusion)) passed += 1;
    else if (['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED'].includes(conclusion)) failed += 1;
    else pending += 1;
  }
  return { passed, failed, pending };
}

function normalizePullRequest(pr, branches) {
  const headRefName = asString(pr?.headRefName || pr?.head?.ref);
  const localBranch = branches.find((branch) => branch.name === headRefName) || null;
  const statusCheckRollup = Array.isArray(pr?.statusCheckRollup) ? pr.statusCheckRollup : [];
  return {
    number: Number.isFinite(Number(pr?.number)) ? Number(pr.number) : null,
    title: asString(pr?.title, 'Untitled pull request'),
    url: asString(pr?.url),
    state: asString(pr?.state, 'OPEN').toUpperCase(),
    baseRefName: asNullableString(pr?.baseRefName || pr?.base?.ref),
    headRefName: headRefName || null,
    baseSha: normalizeSha(pr?.baseSha || pr?.baseRefOid || pr?.base?.oid),
    headSha: normalizeSha(pr?.headSha || pr?.headRefOid || pr?.head?.oid),
    isDraft: Boolean(pr?.isDraft),
    author: pr?.author && typeof pr.author === 'object'
      ? { login: asNullableString(pr.author.login), name: asNullableString(pr.author.name) }
      : null,
    updatedAt: asNullableString(pr?.updatedAt),
    reviewDecision: asNullableString(pr?.reviewDecision),
    mergeable: asString(pr?.mergeable, 'UNKNOWN').toUpperCase(),
    mergeStateStatus: asString(pr?.mergeStateStatus, 'UNKNOWN').toUpperCase(),
    statusCheckRollup,
    checksSummary: computeChecksSummary(statusCheckRollup),
    hasLocalBranch: Boolean(localBranch),
    localBranchState: localBranch?.state || null,
  };
}

function createCommandRunner(childProcessImpl = childProcess) {
  return (command, args, cwd, timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS) => new Promise((resolve, reject) => {
    childProcessImpl.execFile(command, args, {
      cwd,
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, {
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
          command,
        }));
        return;
      }
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

function createGitOperations({ runCommand, childProcessImpl = childProcess, commandTimeoutMs = DEFAULT_COMMAND_TIMEOUT_MS } = {}) {
  const run = runCommand || createCommandRunner(childProcessImpl);

  async function readStatus(repoPath) {
    const result = await run('git', ['status', '--branch', '--porcelain=v2'], repoPath, commandTimeoutMs);
    const status = parsePorcelainStatus(result.stdout);
    if (status.branch) {
      try {
        const head = await run('git', ['rev-parse', '--verify', 'HEAD'], repoPath, commandTimeoutMs);
        status.headSha = normalizeSha(head.stdout);
      } catch {
        status.headSha = null;
      }
    }
    if (status.upstream) {
      try {
        const upstream = await run('git', ['rev-parse', '--verify', status.upstream], repoPath, commandTimeoutMs);
        status.upstreamSha = normalizeSha(upstream.stdout);
      } catch {
        status.upstreamGone = true;
        status.upstreamSha = null;
      }
    }
    return status;
  }

  async function readRemote(repoPath, upstreamRef = null) {
    const result = await run('git', ['remote', '-v'], repoPath, commandTimeoutMs);
    const remotes = parseRemoteRecords(result.stdout);
    const normalizedUpstream = asString(upstreamRef);
    const upstreamRemoteName = normalizedUpstream.includes('/')
      ? normalizedUpstream.slice(0, normalizedUpstream.indexOf('/'))
      : null;
    const selected = remotes.find((remote) => remote.name === upstreamRemoteName)
      || remotes.find((remote) => remote.name === 'origin')
      || remotes[0]
      || null;
    if (!selected) return { name: null, url: null, available: false };

    try {
      const remoteBranch = normalizedUpstream.startsWith(`${selected.name}/`)
        ? normalizedUpstream.slice(selected.name.length + 1)
        : normalizedUpstream.replace(/^refs\/remotes\/[^/]+\//, '');
      const args = ['ls-remote', '--heads', selected.name];
      if (remoteBranch) args.push(`refs/heads/${remoteBranch}`);
      const remoteResult = await run('git', args, repoPath, commandTimeoutMs);
      const headMatch = remoteBranch
        ? String(remoteResult.stdout || '').match(/^([0-9a-f]+)\s+refs\/heads\/[^\s]+/im)
        : null;
      return {
        ...selected,
        url: normalizeRemoteUrl(selected.url),
        available: true,
        headSha: normalizeSha(headMatch?.[1]),
      };
    } catch (error) {
      return {
        ...selected,
        url: normalizeRemoteUrl(selected.url),
        available: false,
        error,
      };
    }
  }

  async function listBranches(repoPath) {
    const result = await run(
      'git',
      ['for-each-ref', '--format=%(refname:short)\t%(upstream:short)\t%(upstream:track)', 'refs/heads'],
      repoPath,
      commandTimeoutMs,
    );
    return parseBranchRecords(result.stdout);
  }

  async function readDefaultBranch(repoPath, remoteName, branches) {
    if (remoteName) {
      try {
        const result = await run(
          'git',
          ['symbolic-ref', '--quiet', '--short', `refs/remotes/${remoteName}/HEAD`],
          repoPath,
          commandTimeoutMs,
        );
        const remoteHead = asString(result.stdout).replace(new RegExp(`^${remoteName}/`), '');
        if (remoteHead) return remoteHead;
      } catch {
        // Fall through to common local branch names when the remote HEAD is not configured.
      }
    }
    return branches.find((branch) => branch.name === 'main')?.name
      || branches.find((branch) => branch.name === 'master')?.name
      || null;
  }

  async function listWorktrees(repoPath) {
    const result = await run('git', ['worktree', 'list', '--porcelain'], repoPath, commandTimeoutMs);
    return parseWorktreeRecords(result.stdout);
  }

  async function listMergedBranches(repoPath, defaultBranch) {
    if (!defaultBranch) return [];
    const result = await run(
      'git',
      ['for-each-ref', `--merged=${defaultBranch}`, '--format=%(refname:short)', 'refs/heads'],
      repoPath,
      commandTimeoutMs,
    );
    return String(result.stdout || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  async function readRefSha(repoPath, ref) {
    const normalizedRef = asString(ref);
    if (!normalizedRef) return null;
    try {
      const result = await run('git', ['rev-parse', '--verify', normalizedRef], repoPath, commandTimeoutMs);
      return normalizeSha(result.stdout);
    } catch {
      return null;
    }
  }

  async function fetch(repoPath, remoteName) {
    return run('git', ['fetch', '--no-prune', remoteName], repoPath, commandTimeoutMs);
  }

  async function fastForwardOnly(repoPath, upstream) {
    return run('git', ['merge', '--ff-only', upstream], repoPath, commandTimeoutMs);
  }

  async function removeWorktree(repoPath, worktreePath) {
    return run('git', ['worktree', 'remove', worktreePath], repoPath, commandTimeoutMs);
  }

  async function deleteLocalBranch(repoPath, branch) {
    return run('git', ['branch', '-d', branch], repoPath, commandTimeoutMs);
  }

  return {
    readStatus,
    readRemote,
    readRefSha,
    listBranches,
    readDefaultBranch,
    listWorktrees,
    listMergedBranches,
    fetch,
    fastForwardOnly,
    removeWorktree,
    deleteLocalBranch,
  };
}

function createGithubOperations({ runCommand, childProcessImpl = childProcess, githubTimeoutMs = DEFAULT_GITHUB_TIMEOUT_MS } = {}) {
  const run = runCommand || createCommandRunner(childProcessImpl);
  let authPromise = null;

  async function resolveAuthentication(repoPath) {
    if (!authPromise) {
      authPromise = run('gh', ['auth', 'status'], repoPath, githubTimeoutMs)
        .then((authResult) => {
          const authText = `${authResult.stdout}\n${authResult.stderr}`;
          return {
            available: true,
            authenticated: /logged in/i.test(authText) && !/not logged in|not authenticated/i.test(authText),
          };
        })
        .catch((error) => ({
          available: error?.code !== 'ENOENT',
          authenticated: false,
          error,
        }));
    }
    return authPromise;
  }

  return {
    async listOpenPullRequests(repoPath) {
      const auth = await resolveAuthentication(repoPath);
      if (!auth.available || !auth.authenticated) {
        const code = auth.error?.code === 'ENOENT' ? 'missing-github-cli' : 'github-authentication-unavailable';
        return {
          available: false,
          authenticated: false,
          pullRequests: [],
          issue: commandIssue(auth.error, code, code === 'missing-github-cli' ? 'GitHub CLI is unavailable.' : 'GitHub CLI authentication is unavailable.'),
        };
      }
      try {
        const result = await run(
            'gh',
            [
              'pr', 'list', '--state', 'open', '--limit', '1000',
            '--json', 'number,title,url,state,baseRefName,headRefName,baseRefOid,headRefOid,isDraft,author,updatedAt,statusCheckRollup,reviewDecision,mergeable,mergeStateStatus',
          ],
          repoPath,
          githubTimeoutMs,
        );
        const parsed = JSON.parse(result.stdout || '[]');
        return {
          available: true,
          authenticated: true,
          pullRequests: Array.isArray(parsed) ? parsed : [],
          issue: null,
        };
      } catch (error) {
        return {
          available: true,
          authenticated: true,
          pullRequests: [],
          issue: commandIssue(error, 'github-query-failed', 'Open GitHub pull requests could not be loaded.'),
        };
      }
    },
    async getPullRequest(repoPath, number) {
      const auth = await resolveAuthentication(repoPath);
      if (!auth.available || !auth.authenticated) {
        const code = auth.error?.code === 'ENOENT' ? 'missing-github-cli' : 'github-authentication-unavailable';
        return {
          available: false,
          authenticated: false,
          pullRequest: null,
          issue: commandIssue(auth.error, code, code === 'missing-github-cli' ? 'GitHub CLI is unavailable.' : 'GitHub CLI authentication is unavailable.'),
        };
      }
      try {
        const result = await run(
          'gh',
          [
            'pr', 'view', String(number),
            '--json', 'number,title,url,state,baseRefName,headRefName,baseRefOid,headRefOid,isDraft,author,updatedAt,statusCheckRollup,reviewDecision,mergeable,mergeStateStatus',
          ],
          repoPath,
          githubTimeoutMs,
        );
        return {
          available: true,
          authenticated: true,
          pullRequest: JSON.parse(result.stdout || '{}'),
          issue: null,
        };
      } catch (error) {
        return {
          available: true,
          authenticated: true,
          pullRequest: null,
          issue: commandIssue(error, 'github-query-failed', 'The GitHub pull request could not be loaded.'),
        };
      }
    },
    async mergePullRequest(repoPath, number, input = {}) {
      const auth = await resolveAuthentication(repoPath);
      if (!auth.available || !auth.authenticated) {
        const code = auth.error?.code === 'ENOENT' ? 'missing-github-cli' : 'github-authentication-unavailable';
        return {
          ok: false,
          issue: commandIssue(auth.error, code, code === 'missing-github-cli' ? 'GitHub CLI is unavailable.' : 'GitHub CLI authentication is unavailable.'),
        };
      }
      const method = asString(input.method, 'squash').toLowerCase();
      const expectedHeadSha = normalizeSha(input.expectedHeadSha);
      if (method !== 'squash' || !expectedHeadSha) {
        return { ok: false, issue: issue('invalid-merge-request', 'A squash merge and expected head SHA are required.') };
      }
      try {
        const result = await run(
          'gh',
          [
            'pr', 'merge', String(number),
            '--squash',
            '--match-head-commit', expectedHeadSha,
            '--delete-branch=false',
          ],
          repoPath,
          githubTimeoutMs,
        );
        return { ok: true, stdout: String(result.stdout || ''), stderr: String(result.stderr || '') };
      } catch (error) {
        return {
          ok: false,
          issue: commandIssue(error, 'github-merge-failed', 'The GitHub pull request merge failed.'),
          error,
        };
      }
    },
  };
}

function addIssue(issues, nextIssue) {
  if (!nextIssue || issues.some((existing) => existing.code === nextIssue.code && existing.message === nextIssue.message)) {
    return;
  }
  issues.push(nextIssue);
}

function normalizeIssueRecord(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const code = asString(entry.code, 'repository-issue');
  const definition = ISSUE_DEFINITIONS[code];
  return {
    ...entry,
    code,
    severity: asString(entry.severity, definition?.severity || 'warning'),
    title: asString(entry.title, definition?.title || code),
    message: asString(entry.message, definition?.message || 'Repository state needs attention.'),
    details: entry.details && typeof entry.details === 'object' ? entry.details : null,
  };
}

function addStructuredIssueForCode(issues, code, details = null) {
  const normalizedCode = asString(code);
  if (!normalizedCode) return;
  addIssue(issues, issueForCode(normalizedCode, details));
}

function cleanupCandidateKey(candidate) {
  return `${normalizePathForComparison(candidate?.worktreePath)}\u0000${asString(candidate?.branch)}`;
}

function normalizeCleanupCandidate(candidate, defaults = {}) {
  const branch = asString(candidate?.branch);
  const worktreePath = asNullableString(candidate?.worktreePath);
  const blockerCodes = unique(Array.isArray(candidate?.blockerCodes) ? candidate.blockerCodes : []);
  return {
    repoId: asNullableString(candidate?.repoId || defaults.repoId),
    repoLabel: asString(candidate?.repoLabel || defaults.repoLabel, 'Unknown repository'),
    repoPath: asNullableString(candidate?.repoPath || defaults.repoPath),
    worktreePath,
    branch,
    defaultBranch: asNullableString(candidate?.defaultBranch || defaults.defaultBranch),
    observedBranchSha: normalizeSha(candidate?.observedBranchSha),
    observedDefaultSha: normalizeSha(candidate?.observedDefaultSha),
    clean: candidate?.clean === true,
    mergedIntoDefault: candidate?.mergedIntoDefault === true,
    active: candidate?.active === true,
    eligible: candidate?.eligible === true && blockerCodes.length === 0,
    blockerCodes,
    details: candidate?.details && typeof candidate.details === 'object' ? candidate.details : null,
  };
}

function cleanupEligibilityForCandidate({
  repoPath,
  defaultBranch,
  syncBranch,
  branch,
  worktreePath,
  worktreeStatus,
  mergedIntoDefault,
  active,
  observedBranchSha,
  observedDefaultSha,
} = {}) {
  const blockerCodes = [];
  if (!worktreePath || normalizePathForComparison(worktreePath) === normalizePathForComparison(repoPath)) blockerCodes.push('current-worktree');
  if (!branch) blockerCodes.push('worktree-state-unavailable');
  if (branch === defaultBranch) blockerCodes.push('default-branch');
  if (branch === syncBranch) blockerCodes.push('current-branch');
  if (worktreeStatus?.clean !== true) blockerCodes.push(worktreeStatus?.clean === false ? 'worktree-dirty' : 'worktree-state-unavailable');
  if (!mergedIntoDefault) blockerCodes.push('not-merged');
  if (active) blockerCodes.push('active-session-or-worktree');
  if (!observedBranchSha || !observedDefaultSha) blockerCodes.push('worktree-state-unavailable');
  return { eligible: blockerCodes.length === 0, blockerCodes: unique(blockerCodes) };
}

async function scanRepository(repo, options = {}) {
  const git = options.git || createGitOperations(options);
  const github = options.github || createGithubOperations(options);
  const repoPath = asNullableString(repo?.repoPath);
  const issues = [];
  const base = {
    repoId: asNullableString(repo?.repoId),
    repoPath,
    repoLabel: asString(repo?.repoLabel, repoPath || 'Unknown repository'),
    sources: Array.isArray(repo?.sources) ? repo.sources : [],
    registered: Boolean(repo?.registered),
    canonicalRemote: asNullableString(repo?.canonicalRemote),
    available: true,
    provider: 'none',
    sync: {
      branch: null,
      upstream: null,
      upstreamGone: false,
      clean: null,
      ahead: 0,
      behind: 0,
      headSha: null,
      upstreamSha: null,
      remoteAvailable: false,
      remoteName: null,
      remoteUrl: null,
      state: 'unavailable',
      issueCodes: [],
      blockerCodes: [],
      syncEligible: false,
      activeWorktreeConflict: false,
    },
    activity: {
      active: false,
      issueCodes: [],
      details: null,
    },
    branches: [],
    pullRequests: [],
    issues,
    errors: [],
  };

  if (!repoPath || repo?.exists === false || repo?.gitRootKind !== 'directory') {
    const code = repo?.gitRootKind === 'file' ? 'linked-worktree-checkout' : 'missing-path';
    addIssue(issues, issue(code, code === 'missing-path' ? 'The repository path is unavailable.' : 'Linked worktree checkouts are excluded from this global scan.'));
    return {
      ...base,
      available: false,
      sync: { ...base.sync, issueCodes: [code], blockerCodes: [code] },
    };
  }

  let status;
  try {
    status = await git.readStatus(repoPath);
  } catch (error) {
    const nextIssue = commandIssue(error, 'git-command-failed', 'Git status could not be read.');
    addIssue(issues, nextIssue);
    return {
      ...base,
      available: false,
      sync: { ...base.sync, issueCodes: [nextIssue.code] },
      errors: [nextIssue],
    };
  }

  const sync = {
    ...base.sync,
    branch: asNullableString(status?.branch),
    upstream: asNullableString(status?.upstream),
    upstreamGone: Boolean(status?.upstreamGone),
    clean: status?.clean !== false,
    ahead: asCount(status?.ahead),
    behind: asCount(status?.behind),
    headSha: normalizeSha(status?.headSha),
    upstreamSha: normalizeSha(status?.upstreamSha),
    state: status?.clean === false ? 'dirty' : 'clean',
  };
  if (sync.clean === false) addIssue(issues, issue('dirty-worktree', 'The working tree has uncommitted changes.'));
  if (!sync.upstream && sync.branch) addIssue(issues, issue('no-upstream', `Branch ${sync.branch} has no configured upstream.`));
  if (sync.upstreamGone) addIssue(issues, issue('upstream-gone', `Branch ${sync.branch || 'current'} tracks an unavailable upstream.`));
  if (sync.ahead > 0 && sync.behind > 0) addIssue(issues, issue('diverged', `Branch ${sync.branch || 'current'} has diverged from its upstream.`));
  else if (sync.behind > 0) addIssue(issues, issue('behind', `Branch ${sync.branch || 'current'} is behind its upstream.`));
  else if (sync.ahead > 0) addIssue(issues, issue('ahead', `Branch ${sync.branch || 'current'} is ahead of its upstream.`));

  let remote = null;
  try {
    remote = await git.readRemote(repoPath, status?.upstream || null);
    sync.remoteName = asNullableString(remote?.name);
    sync.remoteUrl = asNullableString(remote?.url);
    sync.remoteAvailable = Boolean(remote?.available);
    if (!remote?.name) addIssue(issues, issue('no-remote', 'No Git remote is configured.'));
    else if (!remote.available) addIssue(issues, commandIssue(remote.error, 'remote-unavailable', 'The configured Git remote is unavailable.'));
  } catch (error) {
    const nextIssue = commandIssue(error, 'remote-unavailable', 'Git remote state could not be read.');
    addIssue(issues, nextIssue);
  }

  const provider = resolveProvider(sync.remoteUrl);
  let branchRecords = [];
  try {
    branchRecords = (await git.listBranches(repoPath)).map(normalizeBranchRecord).filter((branch) => branch.name);
  } catch (error) {
    addIssue(issues, commandIssue(error, 'git-command-failed', 'Local branch state could not be read.'));
  }

  let defaultBranch = null;
  try {
    defaultBranch = await git.readDefaultBranch(repoPath, sync.remoteName, branchRecords);
  } catch (error) {
    addIssue(issues, commandIssue(error, 'git-command-failed', 'The repository default branch could not be determined.'));
  }

  let worktrees = [];
  try {
    worktrees = await git.listWorktrees(repoPath);
  } catch (error) {
    addIssue(issues, commandIssue(error, 'git-command-failed', 'Git worktree state could not be read.'));
  }
  const activeWorktrees = new Map(
    worktrees
      .filter((worktree) => asString(worktree?.branch))
      .map((worktree) => [asString(worktree.branch), asNullableString(worktree.path)]),
  );
  const worktreeStateByPath = new Map();
  for (const worktree of worktrees) {
    const worktreePath = asNullableString(worktree?.path);
    if (!worktreePath) continue;
    if (normalizePathForComparison(worktreePath) === normalizePathForComparison(repoPath)) {
      worktreeStateByPath.set(normalizePathForComparison(worktreePath), status);
      continue;
    }
    try {
      const worktreeStatus = typeof git.readStatus === 'function'
        ? await git.readStatus(worktreePath)
        : null;
      worktreeStateByPath.set(normalizePathForComparison(worktreePath), worktreeStatus || null);
    } catch (error) {
      worktreeStateByPath.set(normalizePathForComparison(worktreePath), null);
      addIssue(issues, issueForCode('worktree-state-unavailable', {
        worktreePath,
        error: errorMessage(error, 'Linked worktree state could not be read.'),
      }));
    }
  }

  let activity = options.activity && typeof options.activity === 'object' ? options.activity : null;
  if (typeof options.activityReader === 'function') {
    try {
      activity = await options.activityReader(repo, { repoPath, worktrees, context: options.context || null });
    } catch (error) {
      activity = {
        active: true,
        issueCodes: ['active-session-or-worktree'],
        details: { error: errorMessage(error, 'Managed activity state could not be read.') },
      };
      addIssue(issues, issue('activity-state-unavailable', 'Managed session/worktree state could not be verified.'));
    }
  }
  const linkedActiveWorktree = worktrees.some((worktree) => (
    asString(worktree?.branch) === sync.branch
      && normalizePathForComparison(worktree?.path) !== normalizePathForComparison(repoPath)
      && (
        worktree?.active === true
        || asString(worktree?.status).toLowerCase() === 'active'
        || asString(worktree?.opencodeSessionStatus).toLowerCase() === 'running'
        || asString(worktree?.sessionId)
      )
  ));
  if (linkedActiveWorktree) {
    activity = {
      ...(activity || {}),
      active: true,
      issueCodes: unique([...(activity?.issueCodes || []), 'active-session-or-worktree']),
      details: activity?.details || { reason: 'linked-worktree-active' },
    };
  }
  const normalizedActivity = {
    active: activity?.active === true,
    issueCodes: unique(Array.isArray(activity?.issueCodes) ? activity.issueCodes : []),
    details: activity?.details || null,
  };
  if (normalizedActivity.active) addIssue(issues, issue('active-session-or-worktree', 'A managed session or linked worktree is active for this repository.'));
  sync.activeWorktreeConflict = normalizedActivity.active;

  let mergedBranches = new Set();
  if (defaultBranch) {
    try {
      mergedBranches = new Set(await git.listMergedBranches(repoPath, defaultBranch));
    } catch (error) {
      addIssue(issues, commandIssue(error, 'git-command-failed', 'Merged branch state could not be read.'));
    }
  }

  const branches = branchRecords.map((branch) => {
    const isDefault = branch.name === defaultBranch;
    const activeWorktree = activeWorktrees.has(branch.name);
    const mergedIntoDefault = !isDefault && mergedBranches.has(branch.name);
    const state = classifyBranchState({
      ...branch,
      isDefault,
      activeWorktree,
      mergedIntoDefault,
    });
    const issueCodes = [];
    if (activeWorktree) issueCodes.push('active-worktree');
    if (mergedIntoDefault) issueCodes.push('merged');
    if (branch.upstreamGone) issueCodes.push('upstream-gone');
    else if (!branch.upstream && !isDefault) issueCodes.push('no-upstream');
    if (branch.ahead > 0 && branch.behind > 0) issueCodes.push('diverged');
    else if (branch.behind > 0) issueCodes.push('behind');
    else if (branch.ahead > 0) issueCodes.push('ahead');
    const cleanupEligible = Boolean(
      mergedIntoDefault
        && !activeWorktree
        && branch.name !== sync.branch
        && !isDefault,
    );
    return {
      name: branch.name,
      default: isDefault,
      current: branch.name === sync.branch,
      upstream: branch.upstream,
      upstreamGone: branch.upstreamGone,
      ahead: branch.ahead,
      behind: branch.behind,
      state,
      mergedIntoDefault,
      activeWorktree,
      worktree: activeWorktrees.get(branch.name) || null,
      cleanupEligible,
      issueCodes: unique(issueCodes),
    };
  });

  const cleanupCandidates = [];
  for (const worktree of worktrees) {
    const worktreePath = asNullableString(worktree?.path);
    const branchName = asString(worktree?.branch);
    if (!worktreePath || !branchName) continue;
    const branch = branches.find((entry) => entry.name === branchName) || null;
    const worktreeStatus = worktreeStateByPath.get(normalizePathForComparison(worktreePath)) || null;
    let observedBranchSha = normalizeSha(worktreeStatus?.headSha);
    if (!observedBranchSha && typeof git.readRefSha === 'function') {
      try {
        observedBranchSha = await git.readRefSha(repoPath, branchName);
      } catch (error) {
        addIssue(issues, issueForCode('worktree-state-unavailable', {
          worktreePath,
          branch: branchName,
          error: errorMessage(error, 'Branch SHA could not be read.'),
        }));
      }
    }
    let observedDefaultSha = null;
    if (defaultBranch && typeof git.readRefSha === 'function') {
      try {
        observedDefaultSha = await git.readRefSha(repoPath, defaultBranch);
      } catch (error) {
        addIssue(issues, issueForCode('worktree-state-unavailable', {
          worktreePath,
          branch: defaultBranch,
          error: errorMessage(error, 'Default branch SHA could not be read.'),
        }));
      }
    }
    if (!observedDefaultSha && defaultBranch === sync.branch) observedDefaultSha = normalizeSha(sync.headSha);
    const active = normalizedActivity.active
      || worktree?.active === true
      || asString(worktree?.status).toLowerCase() === 'active'
      || asString(worktree?.opencodeSessionStatus).toLowerCase() === 'running'
      || Boolean(worktree?.sessionId);
    const eligibility = cleanupEligibilityForCandidate({
      repoPath,
      defaultBranch,
      syncBranch: sync.branch,
      branch: branchName,
      worktreePath,
      worktreeStatus,
      mergedIntoDefault: branch?.mergedIntoDefault === true,
      active,
      observedBranchSha,
      observedDefaultSha,
    });
    cleanupCandidates.push(normalizeCleanupCandidate({
      repoId: repo.repoId,
      repoLabel: repo.repoLabel,
      repoPath,
      worktreePath,
      branch: branchName,
      defaultBranch,
      observedBranchSha,
      observedDefaultSha,
      clean: worktreeStatus?.clean === true,
      mergedIntoDefault: branch?.mergedIntoDefault === true,
      active,
      eligible: eligibility.eligible,
      blockerCodes: eligibility.blockerCodes,
      details: { worktreePath, branch: branchName },
    }, repo));
    for (const code of eligibility.blockerCodes) addStructuredIssueForCode(issues, code, { branch: branchName, worktreePath });
  }
  for (const code of unique([
    ...sync.issueCodes,
    ...branches.flatMap((branch) => branch.issueCodes),
  ])) {
    addStructuredIssueForCode(issues, code, { branch: sync.branch, repository: repo.repoLabel });
  }

  const normalizedProvider = provider;
  let pullRequests = [];
  if (provider === 'github' && sync.remoteAvailable) {
    try {
      const githubResult = await github.listOpenPullRequests(repoPath, remote);
      if (!Array.isArray(githubResult) && githubResult?.issue) addIssue(issues, githubResult.issue);
      const rawPullRequests = Array.isArray(githubResult) ? githubResult : (githubResult?.pullRequests || []);
      pullRequests = rawPullRequests.map((pr) => normalizePullRequest(pr, branches));
    } catch (error) {
      addIssue(issues, commandIssue(error, 'github-query-failed', 'Open GitHub pull requests could not be loaded.'));
    }
  } else if (provider === 'github' && !sync.remoteAvailable) {
    addIssue(issues, issue('remote-unavailable', 'GitHub pull requests were skipped because the remote is unavailable.'));
  } else if (provider === 'unsupported') {
    addIssue(issues, issue('unsupported-provider', 'Open pull request reporting is only available for GitHub remotes.'));
  }

  const issueCodes = unique([
    ...issues.map((entry) => entry.code),
    ...branches.flatMap((branch) => branch.issueCodes),
  ]);
  const syncEligibility = buildSyncEligibility(sync, normalizedActivity, true);
  return {
    ...base,
    available: true,
    provider: normalizedProvider,
    sync: {
      ...sync,
      issueCodes,
      blockerCodes: unique([...sync.blockerCodes, ...syncEligibility.blockerCodes]),
      syncEligible: syncEligibility.eligible,
    },
    activity: normalizedActivity,
    defaultBranch,
    branches,
    cleanupCandidates,
    pullRequests,
    issues,
    errors: issues.filter((entry) => entry.severity === 'error' || [
      'command-timeout',
      'git-command-failed',
      'remote-unavailable',
      'missing-github-cli',
      'github-authentication-unavailable',
      'github-query-failed',
      'unsupported-provider',
    ].includes(entry.code)),
  };
}

function buildUnavailableRepository(repo, error) {
  const timeout = isTimeoutError(error);
  const nextIssue = timeout
    ? commandIssue(error, 'command-timeout', 'The repository scan timed out.')
    : issue('scan-failed', errorMessage(error, 'The repository could not be scanned.'));
  return {
    repoId: asNullableString(repo?.repoId),
    repoPath: asNullableString(repo?.repoPath),
    repoLabel: asString(repo?.repoLabel, repo?.repoPath || 'Unknown repository'),
    sources: Array.isArray(repo?.sources) ? repo.sources : [],
    registered: Boolean(repo?.registered),
    canonicalRemote: asNullableString(repo?.canonicalRemote),
    available: false,
    provider: 'none',
    sync: {
      branch: null,
      upstream: null,
      upstreamGone: false,
      clean: null,
      ahead: 0,
      behind: 0,
      headSha: null,
      upstreamSha: null,
      remoteAvailable: false,
      remoteName: null,
      remoteUrl: null,
      state: 'unavailable',
      issueCodes: [nextIssue.code],
      blockerCodes: [nextIssue.code],
      syncEligible: false,
      activeWorktreeConflict: false,
    },
    activity: { active: false, issueCodes: [], details: null },
    defaultBranch: null,
    branches: [],
    pullRequests: [],
    issues: [nextIssue],
    errors: [nextIssue],
  };
}

function hasAttention(repository) {
  return !repository.available
    || repository.issues.length > 0
    || repository.sync.issueCodes.length > 0
    || repository.branches.some((branch) => ATTENTION_BRANCH_STATES.has(branch.state));
}

async function mapWithConcurrency(items, worker, concurrency) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function consume() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), Math.max(1, items.length)) }, () => consume());
  await Promise.all(workers);
  return results;
}

function createManagedActivityReader({ sessions = sessionLib, executorService = null } = {}) {
  return (repo, metadata = {}) => {
    const repoPath = normalizePathForComparison(repo?.repoPath);
    const context = metadata.context || {};
    const sessionRoot = context.elegyHomeAbs || context.elegyHome || null;
    const activeSessionIds = [];
    const activeWorktreeIds = [];
    const activeRunIds = [];

    if (sessionRoot && typeof sessions?.listSessions === 'function') {
      try {
        for (const session of sessions.listSessions(sessionRoot, { activeWindowMinutes: 30, recentLimit: 250 })) {
          const sessionPath = normalizePathForComparison(session?.cwd || session?.repo);
          if (session?.status === 'active' && sessionPath && sessionPath === repoPath) {
            activeSessionIds.push(asString(session.id || session.storageId));
          }
        }
      } catch {
        return {
          active: true,
          issueCodes: ['activity-state-unavailable'],
          details: { reason: 'managed-session-state-unavailable' },
        };
      }
    }

    if (executorService && typeof executorService.listWorktrees === 'function') {
      try {
        for (const worktree of executorService.listWorktrees({ repoId: repo?.repoId })) {
          const assignment = worktree?.assignment || {};
          const assigned = Boolean(assignment.sessionId || assignment.runId || assignment.overlaySessionId);
          if (worktree?.status === 'active' || assigned) {
            activeWorktreeIds.push(asString(worktree.worktreeId || worktree.id || worktree.path));
          }
        }
      } catch {
        return {
          active: true,
          issueCodes: ['activity-state-unavailable'],
          details: { reason: 'managed-worktree-state-unavailable' },
        };
      }
    }

    if (executorService && typeof executorService.listRuns === 'function') {
      try {
        for (const run of executorService.listRuns()) {
          const matchesRepo = (repo?.repoId && run?.repoId === repo.repoId)
            || (repoPath && normalizePathForComparison(run?.repoPath) === repoPath);
          if (matchesRepo && ['queued', 'running', 'awaiting-approval'].includes(asString(run?.status))) {
            activeRunIds.push(asString(run.runId || run.id));
          }
        }
      } catch {
        return {
          active: true,
          issueCodes: ['activity-state-unavailable'],
          details: { reason: 'managed-run-state-unavailable' },
        };
      }
    }

    const issueCodes = [];
    if (activeSessionIds.length > 0) issueCodes.push('active-session-or-worktree');
    if (activeWorktreeIds.length > 0) issueCodes.push('active-session-or-worktree');
    if (activeRunIds.length > 0) issueCodes.push('active-session-or-worktree');
    return {
      active: issueCodes.length > 0,
      issueCodes: unique(issueCodes),
      details: {
        sessionIds: activeSessionIds.filter(Boolean),
        worktreeIds: activeWorktreeIds.filter(Boolean),
        runIds: activeRunIds.filter(Boolean),
      },
    };
  };
}

function normalizeAllowedOperationScope(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    inspect: source.inspect !== false,
    checks: source.checks !== false,
    dryRun: source.dryRun !== false,
    merge: source.merge === true,
    push: false,
    checkout: false,
    rebase: false,
    deleteBranch: false,
    modifyWorktree: false,
    commit: false,
  };
}

function normalizeAgentRun(run) {
  if (!run || typeof run !== 'object') return null;
  const status = AGENT_RUN_STATUSES.has(asString(run.status)) ? asString(run.status) : 'failed';
  return {
    ...clone(run),
    id: asString(run.id),
    status,
    repoId: asNullableString(run.repoId),
    repoPath: asNullableString(run.repoPath),
    repoLabel: asString(run.repoLabel, 'Unknown repository'),
    prNumber: Number.isFinite(Number(run.prNumber)) ? Number(run.prNumber) : null,
    targetBranch: asNullableString(run.targetBranch),
    observedHeadSha: normalizeSha(run.observedHeadSha),
    observedBaseSha: normalizeSha(run.observedBaseSha),
    model: asString(run.model, REPO_OPERATIONS_MODEL),
    agent: asString(run.agent, REPO_OPERATIONS_AGENT),
    allowedOperationScope: normalizeAllowedOperationScope(run.allowedOperationScope),
    blockerCodes: unique(Array.isArray(run.blockerCodes) ? run.blockerCodes : []),
    logs: Array.isArray(run.logs) ? run.logs.slice(-200) : [],
    evidence: run.evidence && typeof run.evidence === 'object' ? clone(run.evidence) : null,
    proposedOperation: run.proposedOperation && typeof run.proposedOperation === 'object'
      ? clone(run.proposedOperation)
      : null,
    error: asNullableString(run.error),
    createdAt: asString(run.createdAt),
    updatedAt: asString(run.updatedAt),
    startedAt: asNullableString(run.startedAt),
    finishedAt: asNullableString(run.finishedAt),
  };
}

function resolveAgentRunStatePath(elegyHome, pathImpl = path) {
  return pathImpl.join(
    pathImpl.resolve(String(elegyHome || '.')),
    'repo-state',
    'repo-operations',
    'agent-runs.json',
  );
}

function readAgentRunState(elegyHome, fsImpl = fs, pathImpl = path) {
  const statePath = resolveAgentRunStatePath(elegyHome, pathImpl);
  try {
    if (!fsImpl.existsSync(statePath)) return { version: AGENT_RUN_STATE_VERSION, runs: [], statePath };
    const parsed = JSON.parse(fsImpl.readFileSync(statePath, 'utf8'));
    return {
      version: AGENT_RUN_STATE_VERSION,
      runs: Array.isArray(parsed?.runs) ? parsed.runs.map(normalizeAgentRun).filter(Boolean) : [],
      statePath,
    };
  } catch {
    return { version: AGENT_RUN_STATE_VERSION, runs: [], statePath };
  }
}

function persistAgentRunState(state, fsImpl = fs, pathImpl = path) {
  const statePath = state.statePath;
  fsImpl.mkdirSync(pathImpl.dirname(statePath), { recursive: true });
  const tempPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  fsImpl.writeFileSync(tempPath, `${JSON.stringify({
    version: AGENT_RUN_STATE_VERSION,
    runs: state.runs.slice(-DEFAULT_AGENT_RUN_LIMIT),
  }, null, 2)}\n`, 'utf8');
  fsImpl.renameSync(tempPath, statePath);
}

function detectOpenCodeBinForRepoOperations(env = process.env, childProcessImpl = childProcess, fsImpl = fs) {
  const explicit = asString(env?.OPENCODE_BIN);
  if (explicit) return explicit;
  if (process.platform === 'win32') {
    for (const command of ['opencode.cmd', 'opencode']) {
      try {
        const output = childProcessImpl.execSync(`where.exe ${command}`, {
          encoding: 'utf8',
          stdio: 'pipe',
          windowsHide: true,
        });
        const candidate = asString(String(output || '').split(/\r?\n/)[0]);
        if (candidate) return candidate;
      } catch {
        // Try the next Windows command name.
      }
    }
    const appData = asString(env?.APPDATA);
    const candidate = appData ? path.join(appData, 'npm', 'opencode.cmd') : '';
    return candidate && fsImpl.existsSync(candidate) ? candidate : null;
  }
  try {
    const output = childProcessImpl.execSync('which opencode', { encoding: 'utf8', stdio: 'pipe' });
    return asString(output) || null;
  } catch {
    return null;
  }
}

function runOpenCodeRepoOperationsAgent(input, deps = {}) {
  const openCodeBin = typeof deps.detectOpenCodeBin === 'function'
    ? deps.detectOpenCodeBin()
    : detectOpenCodeBinForRepoOperations(deps.env || process.env, deps.childProcess || childProcess, deps.fs || fs);
  if (!openCodeBin) {
    throw Object.assign(new Error('OpenCode CLI is not available.'), { code: 'opencode-cli-unavailable' });
  }
  const prompt = [
    'You are the dedicated repo-operations agent. Inspect and analyze one GitHub pull request.',
    'Return one strict JSON object only; do not wrap it in Markdown.',
    'You may inspect files, Git refs, PR metadata, and run read-only checks or dry-runs.',
    'You must not push, merge, checkout, rebase, commit, stash, prune, delete branches, or modify worktrees.',
    'A final merge is performed only by an explicit approval service after a fresh SHA check.',
    '',
    `Repository: ${input.repoPath}`,
    `Repository id: ${input.repoId}`,
    `Pull request: #${input.prNumber}`,
    `Target branch: ${input.targetBranch}`,
    `Observed head SHA: ${input.observedHeadSha}`,
    `Observed base SHA: ${input.observedBaseSha}`,
    `Allowed scope: ${JSON.stringify(input.allowedOperationScope)}`,
    '',
    'Required JSON shape:',
    '{"schemaVersion":1,"evidence":{"summary":"...","mergeable":true,"checks":{"failed":0,"pending":0},"review":"APPROVED","conflicts":[]},"proposedOperation":{"kind":"squash-merge","pullRequest":0}|null,"blockerCodes":[]}',
    'Use blockerCodes for conflicts, dirty state, failed/pending checks, missing approval, stale metadata, or anything needing a manual session.',
  ].join('\n');
  const args = [
    'run',
    '--agent', REPO_OPERATIONS_AGENT,
    '--model', REPO_OPERATIONS_MODEL,
    '--format', 'json',
    '--no-replay',
    '--dir', input.repoPath,
    prompt,
  ];
  return new Promise((resolve, reject) => {
    const shell = process.platform === 'win32' && /\.cmd$/i.test(openCodeBin);
    (deps.childProcess || childProcess).execFile(openCodeBin, args, {
      cwd: input.repoPath,
      timeout: Number(deps.timeoutMs) || DEFAULT_AGENT_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
      shell,
    }, (error, stdout, stderr) => {
      const result = {
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
      };
      if (error) {
        reject(Object.assign(error, result));
        return;
      }
      resolve(result);
    });
  });
}

function extractAgentText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(extractAgentText).filter(Boolean).join('\n');
  if (!value || typeof value !== 'object') return '';
  for (const key of ['content', 'text', 'output', 'message', 'part', 'stdout']) {
    const text = extractAgentText(value[key]);
    if (text.trim()) return text;
  }
  if (Array.isArray(value.parts)) return value.parts.map(extractAgentText).filter(Boolean).join('\n');
  return '';
}

function isAgentEvidence(value) {
  return Boolean(
    value
      && typeof value === 'object'
      && !Array.isArray(value)
      && Number(value.schemaVersion) === 1
      && value.evidence
      && typeof value.evidence === 'object'
      && Array.isArray(value.blockerCodes)
      && Object.prototype.hasOwnProperty.call(value, 'proposedOperation'),
  );
}

function parseAgentEvidence(output) {
  if (output && typeof output === 'object' && !Array.isArray(output)) {
    if (isAgentEvidence(output)) return output;
    if (output.stdout || output.stderr) return parseAgentEvidence(output.stdout || output.stderr);
    const extracted = extractAgentText(output);
    if (extracted) return parseAgentEvidence(extracted);
  }
  const text = String(output || '').trim();
  if (!text) throw Object.assign(new Error('OpenCode returned no structured evidence.'), { code: 'invalid-agent-output' });
  const candidates = [text];
  for (const line of text.split(/\r?\n/).reverse()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const event = JSON.parse(trimmed);
      if (isAgentEvidence(event)) candidates.push(JSON.stringify(event));
      const eventText = extractAgentText(event).trim();
      if (eventText) candidates.push(eventText);
    } catch {
      // Keep the raw line as a possible strict JSON payload below.
    }
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) candidates.push(trimmed);
    const jsonStart = trimmed.indexOf('{');
    const jsonEnd = trimmed.lastIndexOf('}');
    if (jsonStart >= 0 && jsonEnd > jsonStart) candidates.push(trimmed.slice(jsonStart, jsonEnd + 1));
  }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1].trim());
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (isAgentEvidence(parsed)) return parsed;
    } catch {
      // Try the next output candidate.
    }
  }
  throw Object.assign(new Error('OpenCode returned invalid structured evidence.'), { code: 'invalid-agent-output' });
}

function checksBlockers(pr) {
  const summary = pr?.checksSummary || computeChecksSummary(pr?.statusCheckRollup);
  const codes = [];
  if (summary.failed > 0) codes.push('failed-checks');
  if (summary.pending > 0) codes.push('pending-checks');
  return codes;
}

function classifyManualHandoff(blockerCodes) {
  return blockerCodes.some((code) => [
    'merge-conflict',
    'mergeability-unknown',
    'failed-checks',
    'pending-checks',
    'dirty-worktree',
    'active-session-or-worktree',
    'diverged',
    'local-only-branch',
  ].includes(code));
}

function buildAgentPreflight(pr, repo, input, defaultBranch, localState = null) {
  const blockerCodes = [];
  const normalizedState = normalizeSyncState(localState?.sync || localState, {
    activity: localState?.activity,
    available: localState?.available !== false,
  });
  if (asString(pr?.state, 'OPEN').toUpperCase() !== 'OPEN') blockerCodes.push('pr-not-open');
  if (asString(pr?.baseRefName) !== asString(defaultBranch)) blockerCodes.push('wrong-target-branch');
  if (asString(input.targetBranch) !== asString(defaultBranch)) blockerCodes.push('wrong-target-branch');
  if (pr?.isDraft) blockerCodes.push('draft-pr');
  if (asString(pr?.mergeable, 'UNKNOWN').toUpperCase() === 'CONFLICTING') blockerCodes.push('merge-conflict');
  else if (asString(pr?.mergeable, 'UNKNOWN').toUpperCase() !== 'MERGEABLE') blockerCodes.push('mergeability-unknown');
  if (asString(pr?.mergeStateStatus, 'UNKNOWN').toUpperCase() !== 'CLEAN') blockerCodes.push('merge-state-not-clean');
  blockerCodes.push(...checksBlockers(pr));
  if (asString(pr?.reviewDecision).toUpperCase() !== 'APPROVED') blockerCodes.push('review-not-approved');
  if (!normalizeSha(pr?.headSha) || normalizeSha(pr?.headSha) !== normalizeSha(input.observedHeadSha)) blockerCodes.push('stale-head-sha');
  if (!normalizeSha(pr?.baseSha) || normalizeSha(pr?.baseSha) !== normalizeSha(input.observedBaseSha)) blockerCodes.push('stale-base-sha');
  if (normalizedState.clean === false) blockerCodes.push('dirty-worktree');
  if (normalizedState.activeWorktreeConflict || localState?.activity?.active === true) blockerCodes.push('active-session-or-worktree');
  return unique(blockerCodes);
}

function createRepoOperationsAgentService(options = {}) {
  const inventorySource = options.inventory || options.repoInventory;
  const git = options.git;
  const github = options.github;
  const fsImpl = options.fsImpl || options.fs || fs;
  const pathImpl = options.pathImpl || options.path || path;
  const now = options.now || (() => new Date().toISOString());
  const agentRunner = options.agentRunner || ((input) => runOpenCodeRepoOperationsAgent(input, {
    childProcessImpl: options.childProcessImpl || childProcess,
    fs: fsImpl,
    env: options.env || process.env,
    detectOpenCodeBin: options.detectOpenCodeBin,
    timeoutMs: options.agentTimeoutMs,
  }));
  const activityReader = options.activityReader;

  async function readInventory(context = {}) {
    const inventory = typeof inventorySource === 'function'
      ? await inventorySource(context)
      : await inventorySource.listKnownRepos(context);
    return inventory && Array.isArray(inventory.repos) ? inventory : { repos: [] };
  }

  async function resolveRepo(context, repoId) {
    const inventory = await readInventory(context);
    const repo = inventory.repos.find((entry) => entry?.repoId === repoId && !entry?.isWorktreeCheckout && entry?.gitRootKind !== 'file');
    if (!repo) throw Object.assign(new Error('Repository is not in the canonical catalog inventory.'), { statusCode: 404, code: 'repository-not-in-catalog' });
    return repo;
  }

  async function readLocalState(repo, context = {}) {
    if (!git?.readStatus) return { available: false, sync: { clean: null }, activity: { active: false, issueCodes: [] } };
    const status = await git.readStatus(repo.repoPath);
    const remote = git.readRemote ? await git.readRemote(repo.repoPath, status?.upstream || null) : { name: null, available: false };
    const activity = typeof activityReader === 'function'
      ? await activityReader(repo, { context })
      : { active: false, issueCodes: [] };
    return {
      available: true,
      sync: normalizeSyncState({
        ...status,
        remoteAvailable: Boolean(remote?.available),
        remoteName: remote?.name || null,
        remoteUrl: remote?.url || null,
        state: status?.clean === false ? 'dirty' : 'clean',
      }, { activity, available: true }),
      activity,
    };
  }

  async function readPullRequest(repo, number) {
    if (typeof github?.getPullRequest === 'function') {
      const result = await github.getPullRequest(repo.repoPath, number);
      if (result?.issue) throw Object.assign(new Error(result.issue.message), { code: result.issue.code, issue: result.issue });
      return normalizePullRequest(result?.pullRequest || result, []);
    }
    const result = await github.listOpenPullRequests(repo.repoPath);
    if (result?.issue) throw Object.assign(new Error(result.issue.message), { code: result.issue.code, issue: result.issue });
    const list = Array.isArray(result) ? result : result?.pullRequests || [];
    const match = list.find((entry) => Number(entry?.number) === Number(number));
    return match ? normalizePullRequest(match, []) : null;
  }

  async function resolveDefaultBranch(repo, localState) {
    if (repo.defaultBranch) return repo.defaultBranch;
    if (typeof git?.readDefaultBranch === 'function') {
      return git.readDefaultBranch(repo.repoPath, localState?.sync?.remoteName, []);
    }
    return 'main';
  }

  function saveRun(context, run) {
    const state = readAgentRunState(context.elegyHome, fsImpl, pathImpl);
    const normalized = normalizeAgentRun(run);
    const index = state.runs.findIndex((entry) => entry.id === normalized.id);
    if (index >= 0) state.runs[index] = normalized;
    else state.runs.push(normalized);
    state.runs = state.runs.slice(-DEFAULT_AGENT_RUN_LIMIT);
    persistAgentRunState(state, fsImpl, pathImpl);
    return normalized;
  }

  function loadRun(context, runId) {
    const state = readAgentRunState(context.elegyHome, fsImpl, pathImpl);
    return state.runs.find((entry) => entry.id === runId) || null;
  }

  function appendLog(context, run, message, data = null) {
    run.logs = [...(Array.isArray(run.logs) ? run.logs : []), {
      at: nowIso(now),
      message,
      data: data && typeof data === 'object' ? clone(data) : data,
    }].slice(-200);
    run.updatedAt = nowIso(now);
    return saveRun(context, run);
  }

  function setRunStatus(context, run, status, updates = {}) {
    run.status = status;
    Object.assign(run, updates);
    run.updatedAt = nowIso(now);
    if (TERMINAL_AGENT_RUN_STATUSES.has(status)) run.finishedAt = run.finishedAt || run.updatedAt;
    return saveRun(context, run);
  }

  function getCancelledRun(context, run) {
    const persisted = loadRun(context, run.id);
    return persisted?.status === 'cancelled' ? persisted : null;
  }

  async function executeRun(context, run) {
    const persistedRun = loadRun(context, run.id);
    if (!persistedRun || persistedRun.status === 'cancelled') return persistedRun || run;
    run = persistedRun;
    setRunStatus(context, run, 'running', { startedAt: nowIso(now), error: null });
    appendLog(context, run, 'Started repository PR preparation.', { model: run.model, agent: run.agent });
    try {
      const repo = await resolveRepo(context, run.repoId);
      const localState = await readLocalState(repo, context);
      const defaultBranch = await resolveDefaultBranch(repo, localState);
      const pr = await readPullRequest(repo, run.prNumber);
      const cancelledBeforePreflight = getCancelledRun(context, run);
      if (cancelledBeforePreflight) return cancelledBeforePreflight;
      if (!pr) {
        setRunStatus(context, run, 'blocked', { blockerCodes: ['pr-not-found'] });
        appendLog(context, run, 'Pull request was not found or is no longer open.');
        return loadRun(context, run.id);
      }
      const initialBlockers = buildAgentPreflight(pr, repo, run, defaultBranch, localState);
      if (initialBlockers.length > 0) {
        const status = classifyManualHandoff(initialBlockers) ? 'needs-manual-session' : 'blocked';
        setRunStatus(context, run, status, { blockerCodes: initialBlockers, evidence: { preflight: true, pullRequest: pr } });
        appendLog(context, run, 'Preparation stopped during preflight.', { blockerCodes: initialBlockers });
        return loadRun(context, run.id);
      }
      const agentResult = await agentRunner({
        agent: run.agent,
        model: run.model,
        repoId: run.repoId,
        repoPath: repo.repoPath,
        repoLabel: repo.repoLabel,
        prNumber: run.prNumber,
        targetBranch: run.targetBranch,
        observedHeadSha: run.observedHeadSha,
        observedBaseSha: run.observedBaseSha,
        allowedOperationScope: run.allowedOperationScope,
      });
      const cancelledAfterAgent = getCancelledRun(context, run);
      if (cancelledAfterAgent) return cancelledAfterAgent;
      const evidence = parseAgentEvidence(agentResult?.stdout || agentResult);
      const agentBlockers = unique([
        ...(Array.isArray(evidence.blockerCodes) ? evidence.blockerCodes : []),
        ...(Array.isArray(evidence.evidence?.blockerCodes) ? evidence.evidence.blockerCodes : []),
      ]);
      if (agentBlockers.length > 0) {
        const status = classifyManualHandoff(agentBlockers) ? 'needs-manual-session' : 'blocked';
        setRunStatus(context, run, status, { blockerCodes: agentBlockers, evidence });
        appendLog(context, run, 'OpenCode returned blockers requiring manual handling.', { blockerCodes: agentBlockers });
        return loadRun(context, run.id);
      }
      const afterAgentPr = await readPullRequest(repo, run.prNumber);
      const afterAgentBlockers = buildAgentPreflight(afterAgentPr, repo, run, defaultBranch, await readLocalState(repo, context));
      const cancelledBeforeFinalCheck = getCancelledRun(context, run);
      if (cancelledBeforeFinalCheck) return cancelledBeforeFinalCheck;
      if (afterAgentBlockers.length > 0) {
        setRunStatus(context, run, 'blocked', { blockerCodes: afterAgentBlockers, evidence });
        appendLog(context, run, 'Repository or PR state changed during preparation.', { blockerCodes: afterAgentBlockers });
        return loadRun(context, run.id);
      }
      const proposedOperation = evidence.proposedOperation && typeof evidence.proposedOperation === 'object'
        ? evidence.proposedOperation
        : null;
      const cancelledBeforeApproval = getCancelledRun(context, run);
      if (cancelledBeforeApproval) return cancelledBeforeApproval;
      if (asString(proposedOperation?.kind) !== 'squash-merge' || Number(proposedOperation?.pullRequest) !== Number(run.prNumber)) {
        setRunStatus(context, run, 'blocked', { blockerCodes: ['no-safe-proposed-operation'], evidence });
        appendLog(context, run, 'OpenCode did not return the supported squash-merge proposal.');
        return loadRun(context, run.id);
      }
      setRunStatus(context, run, 'awaiting-approval', {
        blockerCodes: [],
        evidence,
        proposedOperation,
      });
      appendLog(context, run, 'Preparation completed; explicit approval is required before merge.');
    } catch (error) {
      const cancelledAfterError = getCancelledRun(context, run);
      if (cancelledAfterError) return cancelledAfterError;
      const code = asString(error?.code, 'agent-run-failed');
      setRunStatus(context, run, 'failed', { blockerCodes: [code], error: errorMessage(error, 'Repository PR preparation failed.') });
      appendLog(context, run, 'Repository PR preparation failed.', { code, error: run.error });
    }
    return loadRun(context, run.id);
  }

  async function startAgentRun(input = {}) {
    const context = input.context || input;
    const repoId = asString(input.repoId);
    const prNumber = Number(input.prNumber);
    if (!repoId || !Number.isInteger(prNumber) || prNumber <= 0) {
      throw Object.assign(new Error('repoId and a positive prNumber are required.'), { statusCode: 400, code: 'invalid-agent-run-request' });
    }
    if (!asString(input.targetBranch) || !normalizeSha(input.observedHeadSha) || !normalizeSha(input.observedBaseSha)) {
      throw Object.assign(new Error('targetBranch, observedHeadSha, and observedBaseSha are required.'), { statusCode: 400, code: 'observed-sha-required' });
    }
    const repo = await resolveRepo(context, repoId);
    const timestamp = nowIso(now);
    const run = normalizeAgentRun({
      id: createRunId(),
      status: 'queued',
      repoId,
      repoPath: repo.repoPath,
      repoLabel: repo.repoLabel,
      prNumber,
      targetBranch: asString(input.targetBranch),
      observedHeadSha: normalizeSha(input.observedHeadSha),
      observedBaseSha: normalizeSha(input.observedBaseSha),
      model: REPO_OPERATIONS_MODEL,
      agent: REPO_OPERATIONS_AGENT,
      allowedOperationScope: normalizeAllowedOperationScope(input.allowedOperationScope),
      evidence: null,
      proposedOperation: null,
      blockerCodes: [],
      logs: [],
      error: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: null,
      finishedAt: null,
    });
    saveRun(context, run);
    setTimeout(() => {
      void executeRun(context, run).catch(() => {});
    }, 0);
    return { run: clone(run), activeRuns: listActiveRuns(context) };
  }

  function listActiveRuns(context = {}) {
    return readAgentRunState(context.elegyHome, fsImpl, pathImpl).runs
      .filter((run) => ACTIVE_AGENT_RUN_STATUSES.has(run.status))
      .map((run) => ({
        id: run.id,
        status: run.status,
        repoId: run.repoId,
        repoLabel: run.repoLabel,
        prNumber: run.prNumber,
        targetBranch: run.targetBranch,
        blockerCodes: run.blockerCodes,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
      }));
  }

  async function getAgentRun(input = {}) {
    const run = loadRun(input.context || input, asString(input.runId));
    if (!run) throw Object.assign(new Error('Repo Operations agent run not found.'), { statusCode: 404, code: 'agent-run-not-found' });
    return clone(run);
  }

  async function approveAgentRun(input = {}) {
    const context = input.context || input;
    const run = loadRun(context, asString(input.runId));
    if (!run) throw Object.assign(new Error('Repo Operations agent run not found.'), { statusCode: 404, code: 'agent-run-not-found' });
    if (run.status !== 'awaiting-approval') {
      throw Object.assign(new Error('Only a run awaiting approval can be approved.'), { statusCode: 409, code: 'approval-not-available' });
    }
    const repo = await resolveRepo(context, run.repoId);
    const localState = await readLocalState(repo, context);
    const defaultBranch = await resolveDefaultBranch(repo, localState);
    let pr;
    try {
      pr = await readPullRequest(repo, run.prNumber);
    } catch (error) {
      setRunStatus(context, run, 'blocked', { blockerCodes: [asString(error?.code, 'github-query-failed')], error: errorMessage(error, 'Fresh GitHub state could not be read.') });
      return loadRun(context, run.id);
    }
    const blockers = buildAgentPreflight(pr, repo, run, defaultBranch, localState);
    if (blockers.length > 0) {
      setRunStatus(context, run, 'blocked', { blockerCodes: unique(['stale-approval', ...blockers]) });
      appendLog(context, run, 'Approval rejected because fresh repository or PR state is no longer eligible.', { blockerCodes: blockers });
      return loadRun(context, run.id);
    }
    if (typeof github?.mergePullRequest !== 'function') {
      setRunStatus(context, run, 'failed', { blockerCodes: ['github-merge-unavailable'], error: 'The GitHub merge operation is unavailable.' });
      return loadRun(context, run.id);
    }
    const mergeResult = await github.mergePullRequest(repo.repoPath, run.prNumber, {
      method: 'squash',
      expectedHeadSha: run.observedHeadSha,
    });
    if (!mergeResult?.ok) {
      const code = asString(mergeResult?.issue?.code, 'github-merge-failed');
      setRunStatus(context, run, 'blocked', { blockerCodes: unique(['stale-approval', code]), error: mergeResult?.issue?.message || 'The GitHub merge was not performed.' });
      appendLog(context, run, 'GitHub rejected the fresh-SHA squash merge.', { code });
      return loadRun(context, run.id);
    }
    setRunStatus(context, run, 'completed', {
      blockerCodes: [],
      error: null,
      result: { operation: 'squash-merge', pullRequest: run.prNumber, headSha: run.observedHeadSha },
    });
    appendLog(context, run, 'Approved squash merge completed; branch deletion and auto-merge were not requested.');
    return loadRun(context, run.id);
  }

  async function cancelAgentRun(input = {}) {
    const context = input.context || input;
    const run = loadRun(context, asString(input.runId));
    if (!run) throw Object.assign(new Error('Repo Operations agent run not found.'), { statusCode: 404, code: 'agent-run-not-found' });
    if (run.status === 'completed') throw Object.assign(new Error('Completed runs cannot be cancelled.'), { statusCode: 409, code: 'run-already-completed' });
    setRunStatus(context, run, 'cancelled', { error: null, blockerCodes: [] });
    appendLog(context, run, 'Run cancelled by the user.');
    return loadRun(context, run.id);
  }

  return {
    startAgentRun,
    getAgentRun,
    approveAgentRun,
    cancelAgentRun,
    listActiveRuns,
  };
}

function createRepoOperationsService(options = {}) {
  const inventorySource = options.inventory || options.repoInventory || (async (context) => (
    repoInventoryLib.listKnownRepos({
      elegyHome: context.elegyHome,
      engineRoot: context.engineRoot,
      includeUnavailable: true,
      readOnly: true,
    })
  ));
  const git = options.git || createGitOperations({
    runCommand: options.runCommand,
    childProcessImpl: options.childProcessImpl,
    commandTimeoutMs: options.commandTimeoutMs,
  });
  const github = options.github || createGithubOperations({
    runCommand: options.runCommand,
    childProcessImpl: options.childProcessImpl,
    githubTimeoutMs: options.githubTimeoutMs,
  });
  const activityReader = options.activityReader || createManagedActivityReader({
    sessions: options.sessions || sessionLib,
    executorService: options.executorService || null,
  });
  const scanner = options.scanRepository || ((repo, context) => scanRepository(repo, {
    git,
    github,
    commandTimeoutMs: options.commandTimeoutMs,
    githubTimeoutMs: options.githubTimeoutMs,
    fsImpl: options.fsImpl,
    activityReader,
    context,
  }));
  const now = options.now || (() => new Date().toISOString());
  const concurrency = Number.isFinite(Number(options.concurrency)) ? Number(options.concurrency) : DEFAULT_CONCURRENCY;
  const actionTimeoutMs = Number(options.actionTimeoutMs) > 0 ? Number(options.actionTimeoutMs) : DEFAULT_ACTION_TIMEOUT_MS;
  const agentService = createRepoOperationsAgentService({
    inventory: inventorySource,
    git,
    github,
    fsImpl: options.fsImpl,
    pathImpl: options.pathImpl,
    childProcessImpl: options.childProcessImpl,
    env: options.env,
    detectOpenCodeBin: options.detectOpenCodeBin,
    agentRunner: options.agentRunner,
    agentTimeoutMs: options.agentTimeoutMs,
    activityReader,
    sessions: options.sessions,
    executorService: options.executorService,
    now,
  });

  async function readCatalogInventory(context = {}) {
    return typeof inventorySource === 'function'
      ? inventorySource(context)
      : inventorySource.listKnownRepos(context);
  }

  function normalizeRepository(repository) {
    const activity = repository?.activity && typeof repository.activity === 'object'
      ? repository.activity
      : { active: false, issueCodes: [], details: null };
    const sync = normalizeSyncState(repository?.sync, {
      activity,
      available: repository?.available !== false,
    });
    const issues = Array.isArray(repository?.issues) ? repository.issues.map(normalizeIssueRecord).filter(Boolean) : [];
    const branches = Array.isArray(repository?.branches) ? repository.branches : [];
    const pullRequests = Array.isArray(repository?.pullRequests) ? repository.pullRequests : [];
    for (const code of unique([
      ...sync.issueCodes,
      ...branches.flatMap((branch) => Array.isArray(branch?.issueCodes) ? branch.issueCodes : []),
    ])) {
      if (!issues.some((entry) => entry.code === code)) {
        addStructuredIssueForCode(issues, code, { repository: repository?.repoLabel || repository?.repoId || null });
      }
    }
    const cleanupCandidates = Array.isArray(repository?.cleanupCandidates)
      ? repository.cleanupCandidates.map((candidate) => normalizeCleanupCandidate(candidate, repository)).filter((candidate) => candidate.worktreePath && candidate.branch)
      : [];
    const cleanupEligible = cleanupCandidates.some((candidate) => candidate.eligible);
    const githubUnavailable = issues.some((entry) => [
      'missing-github-cli',
      'github-authentication-unavailable',
      'github-query-failed',
    ].includes(entry?.code));
    const prAgentAvailable = repository?.provider === 'github'
      && sync.remoteAvailable === true
      && !githubUnavailable;
    return {
      ...repository,
      available: repository?.available !== false,
      sync,
      activity,
      branches,
      pullRequests,
      issues,
      cleanupCandidates,
      errors: Array.isArray(repository?.errors) ? repository.errors : [],
      actionCapabilities: {
        sync: {
          ...CAPABILITIES.sync,
          enabled: CAPABILITIES.sync.enabled && sync.syncEligible,
          blockerCodes: sync.blockerCodes,
        },
        prAgent: {
          ...CAPABILITIES.prAgent,
          enabled: CAPABILITIES.prAgent.enabled && prAgentAvailable && pullRequests.length > 0,
          available: prAgentAvailable,
          reason: prAgentAvailable
            ? (pullRequests.length > 0 ? PR_AGENT_REASON : 'No open GitHub pull requests are currently available.')
            : 'GitHub pull request preparation is unavailable for this repository.',
        },
        branchCleanup: {
          ...CAPABILITIES.branchCleanup,
          enabled: cleanupEligible,
          reason: cleanupEligible ? CAPABILITIES.branchCleanup.description : 'No clean, inactive, merged worktrees are eligible for cleanup.',
          blockerCodes: cleanupEligible ? [] : unique(cleanupCandidates.flatMap((candidate) => candidate.blockerCodes)),
        },
      },
    };
  }

  async function readSyncActionState(repo, context = {}) {
    try {
      const status = await git.readStatus(repo.repoPath);
      const remote = await git.readRemote(repo.repoPath, status?.upstream || null);
      const activity = typeof activityReader === 'function'
        ? await activityReader(repo, { context })
        : { active: false, issueCodes: [] };
      const sync = normalizeSyncState({
        ...status,
        remoteAvailable: Boolean(remote?.available),
        remoteName: remote?.name || null,
        remoteUrl: remote?.url || null,
        state: status?.clean === false ? 'dirty' : 'clean',
      }, { activity, available: true });
      return { available: true, sync, remoteHeadSha: normalizeSha(remote?.headSha), activity };
    } catch (error) {
      const nextIssue = commandIssue(error, 'sync-state-read-failed', 'Repository state could not be re-checked.');
      return {
        available: false,
        sync: normalizeSyncState({
          state: 'unavailable',
          issueCodes: [nextIssue.code],
          blockerCodes: [nextIssue.code],
        }, { available: false }),
        activity: { active: false, issueCodes: [] },
        error: nextIssue,
      };
    }
  }

  function syncResultBase(repo, before, status, issueCodes = []) {
    return {
      repoId: repo?.repoId || null,
      repoLabel: repo?.repoLabel || repo?.repoPath || 'Unknown repository',
      status,
      before: normalizeSyncState(before, { activity: repo?.activity, available: repo?.available !== false }),
      issueCodes: unique(issueCodes),
      error: null,
    };
  }

  async function syncOneRepository(repo, context = {}) {
    const before = normalizeSyncState(repo?.sync, {
      activity: repo?.activity,
      available: repo?.available !== false,
    });
    if (!before.syncEligible) {
      return syncResultBase(repo, before, 'skipped', before.blockerCodes.length ? before.blockerCodes : ['repository-unavailable']);
    }
    const fresh = await withTimeout(readSyncActionState(repo, context), actionTimeoutMs);
    if (!fresh.available || !fresh.sync.syncEligible) {
      const issueCodes = fresh.sync.blockerCodes.length ? fresh.sync.blockerCodes : ['stale-repository-state'];
      const result = syncResultBase(repo, before, 'failed', issueCodes);
      result.error = fresh.error?.message || 'Repository became unavailable before sync.';
      result.after = fresh.sync;
      return result;
    }
    if (syncStateSignature(before) !== syncStateSignature(fresh.sync)) {
      const result = syncResultBase(repo, before, 'failed', ['stale-repository-state']);
      result.error = 'Repository state changed before sync; no retry was attempted.';
      result.after = fresh.sync;
      return result;
    }
    if (typeof git.fetch !== 'function' || typeof git.fastForwardOnly !== 'function') {
      const result = syncResultBase(repo, before, 'failed', ['sync-operation-unavailable']);
      result.error = 'The safe fetch/fast-forward Git operations are unavailable.';
      return result;
    }
    try {
      await withTimeout(git.fetch(repo.repoPath, fresh.sync.remoteName), actionTimeoutMs);
      const afterFetchState = await withTimeout(readSyncActionState(repo, context), actionTimeoutMs);
      const afterFetch = afterFetchState.sync;
      const remoteChanged = Boolean(
        fresh.remoteHeadSha
        && afterFetchState.remoteHeadSha
        && fresh.remoteHeadSha !== afterFetchState.remoteHeadSha,
      );
      const localChanged = fresh.sync.headSha !== afterFetch.headSha
        || fresh.sync.branch !== afterFetch.branch
        || fresh.sync.upstream !== afterFetch.upstream
        || fresh.sync.clean !== afterFetch.clean
        || fresh.sync.ahead !== afterFetch.ahead;
      if (remoteChanged || localChanged || !afterFetch.syncEligible) {
        const blockerCodes = unique([
          'stale-repository-state',
          ...(afterFetch.syncEligible ? [] : afterFetch.blockerCodes),
        ]);
        const result = syncResultBase(repo, before, 'failed', blockerCodes);
        result.error = 'Repository or remote state changed during fetch; no retry was attempted.';
        result.after = afterFetch;
        return result;
      }
      if (afterFetch.behind === 0) {
        const result = syncResultBase(repo, before, 'unchanged', []);
        result.after = afterFetch;
        return result;
      }
      await withTimeout(git.fastForwardOnly(repo.repoPath, afterFetch.upstream), actionTimeoutMs);
      const afterState = await withTimeout(readSyncActionState(repo, context), actionTimeoutMs);
      const after = afterState.sync;
      const remoteChangedAfterFastForward = Boolean(
        afterFetchState.remoteHeadSha
        && afterState.remoteHeadSha
        && afterFetchState.remoteHeadSha !== afterState.remoteHeadSha,
      );
      if (remoteChangedAfterFastForward || !after.syncEligible || after.ahead !== 0 || after.behind !== 0 || after.clean !== true) {
        const issueCodes = remoteChangedAfterFastForward
          ? ['stale-repository-state', ...after.blockerCodes]
          : ['fast-forward-verification-failed', ...after.blockerCodes];
        const result = syncResultBase(repo, before, 'failed', unique(issueCodes));
        result.error = remoteChangedAfterFastForward
          ? 'The remote changed during fast-forward; no retry was attempted.'
          : 'Fast-forward verification did not produce a clean, up-to-date branch.';
        result.after = after;
        return result;
      }
      const result = syncResultBase(repo, before, 'synced', []);
      result.after = after;
      return result;
    } catch (error) {
      const nextIssue = commandIssue(error, 'sync-command-failed', 'Safe repository sync failed.');
      const result = syncResultBase(repo, before, 'failed', [nextIssue.code]);
      result.error = nextIssue.message;
      return result;
    }
  }

  async function cleanupWorktrees(context = {}, input = {}) {
    if (input.confirmed !== true) {
      throw Object.assign(new Error('Explicit confirmation is required to clean merged worktrees.'), {
        statusCode: 400,
        code: 'confirmation-required',
      });
    }
    if (!Array.isArray(input.candidates)) {
      throw Object.assign(new Error('A cleanup candidate list is required.'), {
        statusCode: 400,
        code: 'candidate-list-required',
      });
    }

    const startedAt = now();
    let inventory;
    try {
      inventory = await readCatalogInventory(context);
    } catch (error) {
      throw Object.assign(new Error(`Repository inventory could not be loaded: ${errorMessage(error, 'unknown error')}`), {
        statusCode: 503,
        code: 'repository-inventory-unavailable',
      });
    }
    const catalogRepos = (Array.isArray(inventory?.repos) ? inventory.repos : [])
      .filter((repo) => !repo?.isWorktreeCheckout && repo?.gitRootKind !== 'file');
    const reposById = new Map(catalogRepos.map((repo) => [asString(repo?.repoId), repo]));
    const requested = input.candidates.map((candidate, index) => ({
      index,
      ...normalizeCleanupCandidate(candidate),
      requestedBranchSha: normalizeSha(candidate?.observedBranchSha),
      requestedDefaultSha: normalizeSha(candidate?.observedDefaultSha),
    }));
    const repositories = [];
    let eligibleCount = 0;

    for (const request of requested) {
      const baseResult = {
        index: request.index,
        repoId: request.repoId,
        repoLabel: request.repoLabel,
        worktreePath: request.worktreePath,
        branch: request.branch,
        status: 'skipped',
        removedWorktree: false,
        deletedBranch: false,
        blockerCodes: [],
        error: null,
      };
      if (!request.repoId || !request.worktreePath || !request.branch || !request.requestedBranchSha || !request.requestedDefaultSha) {
        baseResult.blockerCodes = ['invalid-cleanup-candidate'];
        repositories.push(baseResult);
        continue;
      }
      const repo = reposById.get(request.repoId);
      if (!repo || !repo.repoPath) {
        baseResult.blockerCodes = ['repository-not-in-catalog'];
        repositories.push(baseResult);
        continue;
      }

      let scanned;
      try {
        // Every candidate gets its own scan immediately before any mutation. This
        // deliberately trades a little throughput for a small, auditable safety
        // boundary around worktree removal and local branch deletion.
        scanned = await withTimeout(
          Promise.resolve(scanner(repo, context)),
          options.repositoryTimeoutMs || DEFAULT_REPOSITORY_TIMEOUT_MS,
        );
      } catch (error) {
        baseResult.status = 'failed';
        baseResult.blockerCodes = [isTimeoutError(error) ? 'command-timeout' : 'scan-failed'];
        baseResult.error = errorMessage(error, 'Repository state could not be revalidated.');
        repositories.push(baseResult);
        continue;
      }

      const freshRepository = normalizeRepository(scanned || buildUnavailableRepository(repo, new Error('Repository scan returned no result')));
      const freshCandidate = freshRepository.cleanupCandidates.find((candidate) => (
        cleanupCandidateKey(candidate) === cleanupCandidateKey(request)
      ));
      if (!freshCandidate) {
        baseResult.blockerCodes = ['stale-cleanup-candidate'];
        repositories.push(baseResult);
        continue;
      }
      const stale = freshCandidate.observedBranchSha !== request.requestedBranchSha
        || freshCandidate.observedDefaultSha !== request.requestedDefaultSha;
      if (stale) {
        baseResult.blockerCodes = ['stale-cleanup-candidate'];
        baseResult.details = {
          observedBranchSha: freshCandidate.observedBranchSha,
          observedDefaultSha: freshCandidate.observedDefaultSha,
        };
        repositories.push(baseResult);
        continue;
      }
      const recheckedEligibility = cleanupEligibilityForCandidate({
        repoPath: repo.repoPath,
        defaultBranch: freshCandidate.defaultBranch,
        syncBranch: freshRepository.sync?.branch,
        branch: freshCandidate.branch,
        worktreePath: freshCandidate.worktreePath,
        worktreeStatus: { clean: freshCandidate.clean },
        mergedIntoDefault: freshCandidate.mergedIntoDefault,
        active: freshCandidate.active,
        observedBranchSha: freshCandidate.observedBranchSha,
        observedDefaultSha: freshCandidate.observedDefaultSha,
      });
      if (!freshCandidate.eligible || !recheckedEligibility.eligible) {
        baseResult.blockerCodes = unique([
          ...freshCandidate.blockerCodes,
          ...recheckedEligibility.blockerCodes,
        ]);
        if (baseResult.blockerCodes.length === 0) baseResult.blockerCodes = ['stale-cleanup-candidate'];
        repositories.push(baseResult);
        continue;
      }
      eligibleCount += 1;
      if (typeof git.removeWorktree !== 'function' || typeof git.deleteLocalBranch !== 'function') {
        baseResult.status = 'failed';
        baseResult.blockerCodes = ['cleanup-operation-unavailable'];
        baseResult.error = 'Safe Git cleanup operations are unavailable.';
        repositories.push(baseResult);
        continue;
      }

      try {
        const removeResult = await withTimeout(git.removeWorktree(repo.repoPath, freshCandidate.worktreePath), actionTimeoutMs);
        if (removeResult?.ok === false) {
          throw Object.assign(new Error(errorMessage(removeResult?.error, 'The worktree could not be removed.')), { code: 'worktree-remove-failed' });
        }
        baseResult.removedWorktree = true;
        try {
          const branchResult = await withTimeout(git.deleteLocalBranch(repo.repoPath, freshCandidate.branch), actionTimeoutMs);
          if (branchResult?.deleted === false || branchResult?.ok === false) {
            baseResult.status = 'partial';
            baseResult.blockerCodes = ['branch-delete-failed'];
            baseResult.error = errorMessage(branchResult?.error, 'The worktree was removed, but the local branch was not deleted.');
          } else {
            baseResult.deletedBranch = true;
            baseResult.status = 'removed';
          }
        } catch (error) {
          baseResult.status = 'partial';
          baseResult.blockerCodes = ['branch-delete-failed'];
          baseResult.error = errorMessage(error, 'The worktree was removed, but the local branch was not deleted.');
        }
      } catch (error) {
        baseResult.status = 'failed';
        baseResult.blockerCodes = [isTimeoutError(error) ? 'command-timeout' : 'worktree-remove-failed'];
        baseResult.error = errorMessage(error, 'The worktree could not be removed.');
      }
      repositories.push(baseResult);
    }

    const summary = {
      requested: repositories.length,
      eligible: eligibleCount,
      removed: repositories.filter((entry) => entry.status === 'removed').length,
      partial: repositories.filter((entry) => entry.status === 'partial').length,
      skipped: repositories.filter((entry) => entry.status === 'skipped').length,
      failed: repositories.filter((entry) => entry.status === 'failed').length,
      removedWorktrees: repositories.filter((entry) => entry.removedWorktree).length,
      deletedBranches: repositories.filter((entry) => entry.deletedBranch).length,
    };
    return {
      contractVersion: REPO_OPERATIONS_ACTION_CONTRACT_VERSION,
      operation: 'cleanup',
      startedAt,
      completedAt: now(),
      summary,
      repositories,
    };
  }

  return {
    async getOverview(context = {}) {
      let inventory;
      const warnings = [];
      try {
        inventory = typeof inventorySource === 'function'
          ? await inventorySource(context)
          : await inventorySource.listKnownRepos(context);
      } catch (error) {
        warnings.push(`Repository inventory could not be loaded: ${errorMessage(error, 'unknown error')}`);
        inventory = { repos: [] };
      }

      const catalogRepos = (Array.isArray(inventory?.repos) ? inventory.repos : [])
        .filter((repo) => !repo?.isWorktreeCheckout && repo?.gitRootKind !== 'file');
      const repositories = await mapWithConcurrency(catalogRepos, async (repo) => {
        try {
          return await withTimeout(Promise.resolve(scanner(repo, context)), options.repositoryTimeoutMs || DEFAULT_REPOSITORY_TIMEOUT_MS);
        } catch (error) {
          return buildUnavailableRepository(repo, error);
        }
      }, concurrency);
      const normalizedRepositories = repositories.filter(Boolean).map(normalizeRepository);
      const allBranches = normalizedRepositories.flatMap((repository) => repository.branches.map((branch) => ({
        ...branch,
        repoId: repository.repoId,
        repoLabel: repository.repoLabel,
        repoPath: repository.repoPath,
      })));
      const allPullRequests = normalizedRepositories.flatMap((repository) => repository.pullRequests.map((pullRequest) => ({
        ...pullRequest,
        repoId: repository.repoId,
        repoLabel: repository.repoLabel,
        repoPath: repository.repoPath,
      })));
      const allCleanupCandidates = normalizedRepositories.flatMap((repository) => repository.cleanupCandidates.map((candidate) => ({
        ...candidate,
        repoId: repository.repoId,
        repoLabel: repository.repoLabel,
        repoPath: repository.repoPath,
      })));
      const summary = {
        trackedRepos: normalizedRepositories.length,
        reposNeedingAttention: normalizedRepositories.filter(hasAttention).length,
        syncIssues: normalizedRepositories.reduce((count, repository) => count + repository.sync.issueCodes.length, 0),
        staleBranches: allBranches.filter((branch) => ATTENTION_BRANCH_STATES.has(branch.state)).length,
        openPullRequests: allPullRequests.length,
      };

      return {
        contractVersion: REPO_OPERATIONS_CONTRACT_VERSION,
        schemaVersion: REPO_OPERATIONS_SCHEMA_VERSION,
        generatedAt: now(),
        summary,
        warnings,
        capabilities: {
          ...CAPABILITIES,
          branchCleanup: {
            ...CAPABILITIES.branchCleanup,
            enabled: allCleanupCandidates.some((candidate) => candidate.eligible),
            reason: allCleanupCandidates.some((candidate) => candidate.eligible)
              ? CAPABILITIES.branchCleanup.description
              : 'No clean, inactive, merged worktrees are eligible for cleanup.',
            blockerCodes: allCleanupCandidates.some((candidate) => candidate.eligible)
              ? []
              : unique(allCleanupCandidates.flatMap((candidate) => candidate.blockerCodes)),
          },
        },
        actionContract: ACTION_CONTRACT,
        activeRuns: agentService.listActiveRuns(context),
        repositories: normalizedRepositories,
        branches: allBranches,
        pullRequests: allPullRequests,
        cleanupCandidates: allCleanupCandidates,
      };
    },
    async syncRepositories(context = {}, input = {}) {
      if (input.confirmed !== true) {
        throw Object.assign(new Error('Explicit confirmation is required to sync eligible repositories.'), {
          statusCode: 400,
          code: 'confirmation-required',
        });
      }
      let inventory;
      try {
        inventory = await readCatalogInventory(context);
      } catch (error) {
        throw Object.assign(new Error(`Repository inventory could not be loaded: ${errorMessage(error, 'unknown error')}`), {
          statusCode: 503,
          code: 'repository-inventory-unavailable',
        });
      }
      const catalogRepos = (Array.isArray(inventory?.repos) ? inventory.repos : [])
        .filter((repo) => !repo?.isWorktreeCheckout && repo?.gitRootKind !== 'file');
      const startedAt = now();
      const repositories = await mapWithConcurrency(catalogRepos, async (repo) => {
        try {
          const scanned = await withTimeout(Promise.resolve(scanner(repo, context)), options.repositoryTimeoutMs || DEFAULT_REPOSITORY_TIMEOUT_MS);
          return await syncOneRepository(normalizeRepository(scanned || buildUnavailableRepository(repo, new Error('Repository scan returned no result'))), context);
        } catch (error) {
          const unavailable = buildUnavailableRepository(repo, error);
          return syncResultBase(repo, unavailable.sync, 'failed', unavailable.sync.blockerCodes || ['scan-failed']);
        }
      }, concurrency);
      const summary = {
        requested: repositories.length,
        eligible: repositories.filter((entry) => entry.before?.syncEligible === true).length,
        synced: repositories.filter((entry) => entry.status === 'synced').length,
        unchanged: repositories.filter((entry) => entry.status === 'unchanged').length,
        skipped: repositories.filter((entry) => entry.status === 'skipped').length,
        failed: repositories.filter((entry) => entry.status === 'failed').length,
      };
      return {
        contractVersion: REPO_OPERATIONS_ACTION_CONTRACT_VERSION,
        operation: 'sync',
        startedAt,
        completedAt: now(),
        summary,
        repositories,
      };
    },
    cleanupWorktrees,
    async startAgentRun(input = {}) {
      return agentService.startAgentRun(input);
    },
    async getAgentRun(input = {}) {
      return agentService.getAgentRun(input);
    },
    async approveAgentRun(input = {}) {
      return agentService.approveAgentRun(input);
    },
    async cancelAgentRun(input = {}) {
      return agentService.cancelAgentRun(input);
    },
  };
}

module.exports = {
  ACTION_CONTRACT,
  CAPABILITIES,
  REPO_OPERATIONS_SCHEMA_VERSION,
  classifyBranchState,
  createCommandRunner,
  createGithubOperations,
  createGitOperations,
  createRepoOperationsService,
  parseBranchRecords,
  parsePorcelainStatus,
  parseRemoteRecords,
  parseWorktreeRecords,
  scanRepository,
};
