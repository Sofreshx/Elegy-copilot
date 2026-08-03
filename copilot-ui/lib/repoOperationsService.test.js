'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  classifyBranchState,
  createRepoOperationsService,
  scanRepository,
} = require('./repoOperationsService');

function testBranchClassification() {
  const cases = [
    [{ isDefault: true, activeWorktree: true }, 'default'],
    [{ upstream: 'origin/main', ahead: 0, behind: 0 }, 'up-to-date'],
    [{ upstream: 'origin/feature', ahead: 2, behind: 0 }, 'ahead'],
    [{ upstream: 'origin/feature', ahead: 0, behind: 3 }, 'behind'],
    [{ upstream: 'origin/feature', ahead: 2, behind: 3 }, 'diverged'],
    [{ upstream: null, ahead: 0, behind: 0 }, 'no-upstream'],
    [{ upstream: null, upstreamGone: true, ahead: 1, behind: 0 }, 'upstream-gone'],
    [{ upstream: 'origin/feature', mergedIntoDefault: true }, 'merged'],
    [{ upstream: 'origin/feature', activeWorktree: true }, 'active-worktree'],
  ];

  for (const [input, expected] of cases) {
    assert.strictEqual(classifyBranchState(input), expected, `expected ${expected}`);
  }
}

async function testRepositoryScan() {
  const repo = {
    repoId: 'alpha',
    repoPath: 'C:/work/alpha',
    repoLabel: 'Alpha',
    exists: true,
    gitRootKind: 'directory',
    canonicalRemote: 'acme/alpha',
  };

  const result = await scanRepository(repo, {
    git: {
      readStatus: async () => ({
        branch: 'feature/local',
        upstream: 'origin/feature/local',
        ahead: 1,
        behind: 0,
        clean: false,
      }),
      readRemote: async () => ({
        name: 'origin',
        url: 'git@github.com:acme/alpha.git',
        available: true,
      }),
      readDefaultBranch: async () => 'main',
      listBranches: async () => [
        { name: 'main', upstream: 'origin/main', ahead: 0, behind: 0 },
        { name: 'feature/local', upstream: 'origin/feature/local', ahead: 1, behind: 0 },
        { name: 'merged-feature', upstream: null, ahead: 0, behind: 0 },
      ],
      listWorktrees: async () => [{ branch: 'feature/local', path: 'C:/work/alpha' }],
      listMergedBranches: async () => ['merged-feature'],
    },
    github: {
      listOpenPullRequests: async () => [
        {
          number: 10,
          title: 'Local feature',
          url: 'https://github.com/acme/alpha/pull/10',
          headRefName: 'feature/local',
          baseRefName: 'main',
          isDraft: false,
          reviewDecision: 'APPROVED',
          mergeable: 'MERGEABLE',
          mergeStateStatus: 'CLEAN',
          statusCheckRollup: [],
        },
        {
          number: 11,
          title: 'Remote-only feature',
          url: 'https://github.com/acme/alpha/pull/11',
          headRefName: 'remote-only',
          baseRefName: 'main',
          isDraft: true,
          reviewDecision: 'REVIEW_REQUIRED',
          mergeable: 'UNKNOWN',
          mergeStateStatus: 'BLOCKED',
          statusCheckRollup: [],
        },
      ],
    },
  });

  const localBranch = result.branches.find((branch) => branch.name === 'feature/local');
  const mergedBranch = result.branches.find((branch) => branch.name === 'merged-feature');
  assert.strictEqual(result.sync.clean, false);
  assert.ok(result.sync.issueCodes.includes('dirty-worktree'));
  assert.strictEqual(localBranch.state, 'active-worktree');
  assert.strictEqual(localBranch.cleanupEligible, false);
  assert.strictEqual(mergedBranch.state, 'merged');
  assert.strictEqual(mergedBranch.cleanupEligible, true);
  assert.strictEqual(result.pullRequests[0].hasLocalBranch, true);
  assert.strictEqual(result.pullRequests[1].hasLocalBranch, false);
}

async function testGithubUnavailableRemainsVisible() {
  const result = await scanRepository({
    repoId: 'github-unavailable',
    repoPath: 'C:/work/github-unavailable',
    repoLabel: 'GitHub unavailable',
    exists: true,
    gitRootKind: 'directory',
  }, {
    git: {
      readStatus: async () => ({ branch: 'main', upstream: 'origin/main', ahead: 0, behind: 0, clean: true }),
      readRemote: async () => ({ name: 'origin', url: 'https://github.com/acme/unavailable.git', available: true }),
      readDefaultBranch: async () => 'main',
      listBranches: async () => [{ name: 'main', upstream: 'origin/main', ahead: 0, behind: 0 }],
      listWorktrees: async () => [],
      listMergedBranches: async () => ['main'],
    },
    github: {
      listOpenPullRequests: async () => ({
        available: false,
        authenticated: false,
        pullRequests: [],
        issue: { code: 'missing-github-cli', message: 'GitHub CLI is unavailable.' },
      }),
    },
  });

  assert.strictEqual(result.pullRequests.length, 0);
  assert.ok(result.issues.some((entry) => entry.code === 'missing-github-cli'));
}

async function testOverviewAggregation() {
  const overviewService = createRepoOperationsService({
    now: () => '2026-08-03T10:00:00.000Z',
    inventory: async () => ({
      repos: [
        { repoId: 'alpha', repoPath: 'C:/work/alpha', repoLabel: 'Alpha', isWorktreeCheckout: false },
        { repoId: 'linked', repoPath: 'C:/work/linked', repoLabel: 'Linked', isWorktreeCheckout: true },
        { repoId: 'missing', repoPath: 'C:/work/missing', repoLabel: 'Missing', isWorktreeCheckout: false },
      ],
    }),
    scanRepository: async (repo) => {
      if (repo.repoId === 'missing') {
        throw new Error('repository path is unavailable');
      }
      return {
        ...repo,
        available: true,
        sync: { issueCodes: ['dirty-worktree'] },
        branches: [{ name: 'feature', state: 'merged', cleanupEligible: true }],
        pullRequests: [{ number: 1 }],
        issues: [],
      };
    },
  });

  const overview = await overviewService.getOverview();
  assert.strictEqual(overview.schemaVersion, 2);
  assert.strictEqual(overview.generatedAt, '2026-08-03T10:00:00.000Z');
  assert.deepStrictEqual(overview.repositories.map((repo) => repo.repoId), ['alpha', 'missing']);
  assert.strictEqual(overview.summary.trackedRepos, 2);
  assert.strictEqual(overview.summary.reposNeedingAttention, 2);
  assert.strictEqual(overview.summary.syncIssues, 2);
  assert.strictEqual(overview.summary.staleBranches, 1);
  assert.strictEqual(overview.summary.openPullRequests, 1);
  assert.strictEqual(overview.repositories[1].available, false);
  assert.ok(overview.repositories[1].issues.some((issue) => issue.code === 'scan-failed'));
  assert.strictEqual(overview.capabilities.sync.enabled, true);
  assert.strictEqual(overview.capabilities.branchCleanup.enabled, false);
  assert.strictEqual(overview.capabilities.pullRequestHandling.enabled, false);
  assert.strictEqual(overview.capabilities.pullRequestHandling.scope, 'per-repository');
  assert.strictEqual(overview.actionContract.version, 'repo-operations.action.v2');
  assert.strictEqual(overview.actionContract.requiresExplicitApproval, true);
}

async function testSafeMassSync() {
  const states = new Map([
    ['C:/work/eligible', { branch: 'feature', upstream: 'origin/feature', ahead: 0, behind: 2, clean: true, headSha: 'a1', upstreamSha: 'r1' }],
    ['C:/work/unchanged', { branch: 'main', upstream: 'origin/main', ahead: 0, behind: 0, clean: true, headSha: 'm1', upstreamSha: 'm1' }],
    ['C:/work/dirty', { branch: 'main', upstream: 'origin/main', ahead: 0, behind: 1, clean: false, headSha: 'd1', upstreamSha: 'd2' }],
    ['C:/work/ahead', { branch: 'feature', upstream: 'origin/feature', ahead: 1, behind: 0, clean: true, headSha: 'f1', upstreamSha: 'f0' }],
    ['C:/work/no-remote', { branch: 'main', upstream: 'origin/main', ahead: 0, behind: 1, clean: true, headSha: 'n1', upstreamSha: 'n2' }],
    ['C:/work/busy', { branch: 'main', upstream: 'origin/main', ahead: 0, behind: 1, clean: true, headSha: 'b1', upstreamSha: 'b2' }],
  ]);
  const calls = [];
  const inventory = {
    repos: Array.from(states.keys()).map((repoPath, index) => ({
      repoId: repoPath.slice('C:/work/'.length),
      repoPath,
      repoLabel: repoPath.slice('C:/work/'.length),
      exists: true,
      gitRootKind: 'directory',
      isWorktreeCheckout: false,
      index,
    })),
  };
  const git = {
    readStatus: async (repoPath) => ({ ...states.get(repoPath) }),
    readRemote: async (repoPath) => repoPath === 'C:/work/no-remote'
      ? { name: 'origin', url: 'https://github.com/acme/no-remote.git', available: false }
      : { name: 'origin', url: 'https://github.com/acme/repo.git', available: true },
    fetch: async (repoPath, remoteName) => {
      calls.push(['fetch', repoPath, remoteName]);
      if (repoPath === 'C:/work/eligible') {
        const current = states.get(repoPath);
        states.set(repoPath, { ...current, upstreamSha: 'r2' });
      }
    },
    fastForwardOnly: async (repoPath, upstream) => {
      calls.push(['ff-only', repoPath, upstream]);
      const current = states.get(repoPath);
      states.set(repoPath, { ...current, ahead: 0, behind: 0, headSha: current.upstreamSha });
    },
  };
  const service = createRepoOperationsService({
    inventory: async () => inventory,
    git,
    github: { listOpenPullRequests: async () => [] },
    activityReader: async (repo) => repo.repoId === 'busy'
      ? { active: true, issueCodes: ['active-session-or-worktree'] }
      : { active: false, issueCodes: [] },
    now: () => '2026-08-03T10:01:00.000Z',
    concurrency: 1,
  });

  const result = await service.syncRepositories({ elegyHome: 'C:/home/.elegy' }, { confirmed: true });
  assert.strictEqual(result.contractVersion, 'repo-operations.action.v2');
  assert.strictEqual(result.operation, 'sync');
  assert.strictEqual(result.summary.requested, 6);
  assert.strictEqual(result.summary.synced, 1);
  assert.strictEqual(result.summary.unchanged, 1);
  assert.strictEqual(result.summary.skipped, 4);
  assert.strictEqual(result.summary.failed, 0);
  assert.deepStrictEqual(calls, [
    ['fetch', 'C:/work/eligible', 'origin'],
    ['ff-only', 'C:/work/eligible', 'origin/feature'],
    ['fetch', 'C:/work/unchanged', 'origin'],
  ]);
  assert.ok(result.repositories.find((entry) => entry.repoId === 'dirty').issueCodes.includes('dirty-worktree'));
  assert.ok(result.repositories.find((entry) => entry.repoId === 'busy').issueCodes.includes('active-session-or-worktree'));
  assert.ok(calls.every((call) => !/push|pull|rebase|checkout|prune|stash/i.test(call.join(' '))));
}

async function testConfirmationAndStaleSync() {
  const repo = {
    repoId: 'stale',
    repoPath: 'C:/work/stale',
    repoLabel: 'Stale',
    exists: true,
    gitRootKind: 'directory',
    isWorktreeCheckout: false,
  };
  let status = { branch: 'main', upstream: 'origin/main', ahead: 0, behind: 1, clean: true, headSha: 'h1', upstreamSha: 'r1' };
  let remoteHeadSha = 'remote-1';
  const calls = [];
  const service = createRepoOperationsService({
    inventory: async () => ({ repos: [repo] }),
    git: {
      readStatus: async () => ({ ...status }),
      readRemote: async () => ({ name: 'origin', available: true, url: 'https://github.com/acme/stale.git', headSha: remoteHeadSha }),
      fetch: async () => {
        calls.push('fetch');
        status = { ...status, upstreamSha: 'r2' };
        remoteHeadSha = 'remote-2';
      },
      fastForwardOnly: async () => calls.push('ff-only'),
    },
    github: { listOpenPullRequests: async () => [] },
  });
  await assert.rejects(
    () => service.syncRepositories({ elegyHome: 'C:/home/.elegy' }, { confirmed: false }),
    (error) => error.statusCode === 400 && error.code === 'confirmation-required',
  );
  const result = await service.syncRepositories({ elegyHome: 'C:/home/.elegy' }, { confirmed: true });
  assert.strictEqual(result.summary.failed, 1);
  assert.strictEqual(result.repositories[0].status, 'failed');
  assert.ok(result.repositories[0].issueCodes.includes('stale-repository-state'));
  assert.deepStrictEqual(calls, ['fetch']);
}

async function testPerRepositoryAgentRunAndFreshApproval() {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-ops-test-'));
  const repo = {
    repoId: 'alpha',
    repoPath: 'C:/work/alpha',
    repoLabel: 'Alpha',
    exists: true,
    gitRootKind: 'directory',
    isWorktreeCheckout: false,
  };
  let headSha = 'head-1';
  let mergeCalls = 0;
  const service = createRepoOperationsService({
    inventory: async () => ({ repos: [repo] }),
    fsImpl: fs,
    pathImpl: path,
    git: {
      readStatus: async () => ({ branch: 'main', upstream: 'origin/main', ahead: 0, behind: 0, clean: true, headSha: 'base-1', upstreamSha: 'base-1' }),
      readRemote: async () => ({ name: 'origin', available: true, url: 'https://github.com/acme/alpha.git' }),
    },
    github: {
      listOpenPullRequests: async () => [],
      getPullRequest: async () => ({
        number: 12,
        title: 'Easy feature',
        url: 'https://github.com/acme/alpha/pull/12',
        state: 'OPEN',
        baseRefName: 'main',
        headRefName: 'feature/easy',
        baseSha: 'base-1',
        headSha,
        isDraft: false,
        reviewDecision: 'APPROVED',
        mergeable: 'MERGEABLE',
        mergeStateStatus: 'CLEAN',
        statusCheckRollup: [{ conclusion: 'SUCCESS' }],
      }),
      mergePullRequest: async (repoPath, number, input) => {
        mergeCalls += 1;
        assert.strictEqual(repoPath, repo.repoPath);
        assert.strictEqual(number, 12);
        assert.strictEqual(input.method, 'squash');
        assert.strictEqual(input.expectedHeadSha, 'head-1');
        return { ok: true };
      },
    },
    fs: fs,
    agentRunner: async (input) => {
      assert.strictEqual(input.agent, 'repo-operations');
      assert.strictEqual(input.model, 'opencode-go/deepseek-v4-flash');
      return {
        stdout: JSON.stringify({
          type: 'assistant',
          content: JSON.stringify({
            schemaVersion: 1,
            evidence: { mergeable: true, checks: { failed: 0, pending: 0 }, review: 'APPROVED' },
            proposedOperation: { kind: 'squash-merge', pullRequest: 12 },
            blockerCodes: [],
          }),
        }),
      };
    },
    now: () => '2026-08-03T10:02:00.000Z',
  });
  try {
    const started = await service.startAgentRun({
      elegyHome: tempHome,
      repoId: 'alpha',
      prNumber: 12,
      targetBranch: 'main',
      observedHeadSha: 'head-1',
      observedBaseSha: 'base-1',
      allowedOperationScope: { inspect: true, checks: true, dryRun: true, merge: false },
    });
    assert.strictEqual(started.run.status, 'queued');
    await new Promise((resolve) => setTimeout(resolve, 25));
    const awaiting = await service.getAgentRun({ elegyHome: tempHome, runId: started.run.id });
    assert.strictEqual(awaiting.status, 'awaiting-approval');
    const approved = await service.approveAgentRun({ elegyHome: tempHome, runId: started.run.id });
    assert.strictEqual(approved.status, 'completed');
    assert.strictEqual(mergeCalls, 1);

    headSha = 'head-2';
    const staleStarted = await service.startAgentRun({
      elegyHome: tempHome,
      repoId: 'alpha',
      prNumber: 12,
      targetBranch: 'main',
      observedHeadSha: 'head-2',
      observedBaseSha: 'base-1',
      allowedOperationScope: { inspect: true, checks: true, dryRun: true, merge: false },
    });
    headSha = 'head-3';
    await new Promise((resolve) => setTimeout(resolve, 25));
    const staleAwaiting = await service.getAgentRun({ elegyHome: tempHome, runId: staleStarted.run.id });
    assert.strictEqual(staleAwaiting.status, 'blocked');
    assert.ok(staleAwaiting.blockerCodes.includes('stale-head-sha'));
    assert.strictEqual(mergeCalls, 1);
  } finally {
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
}

async function testCancellationDoesNotGetOverwritten() {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-ops-cancel-test-'));
  const repo = {
    repoId: 'cancelled',
    repoPath: 'C:/work/cancelled',
    repoLabel: 'Cancelled',
    exists: true,
    gitRootKind: 'directory',
    isWorktreeCheckout: false,
  };
  let agentStartedResolve;
  const agentStarted = new Promise((resolve) => { agentStartedResolve = resolve; });
  let releaseAgent;
  const agentResult = new Promise((resolve) => { releaseAgent = resolve; });
  const service = createRepoOperationsService({
    inventory: async () => ({ repos: [repo] }),
    fsImpl: fs,
    pathImpl: path,
    git: {
      readStatus: async () => ({ branch: 'main', upstream: 'origin/main', ahead: 0, behind: 0, clean: true, headSha: 'base-1', upstreamSha: 'base-1' }),
      readRemote: async () => ({ name: 'origin', available: true, url: 'https://github.com/acme/cancelled.git' }),
    },
    github: {
      getPullRequest: async () => ({
        number: 13,
        title: 'Cancelable feature',
        state: 'OPEN',
        baseRefName: 'main',
        headRefName: 'feature/cancelable',
        baseSha: 'base-1',
        headSha: 'head-13',
        isDraft: false,
        reviewDecision: 'APPROVED',
        mergeable: 'MERGEABLE',
        mergeStateStatus: 'CLEAN',
        statusCheckRollup: [{ conclusion: 'SUCCESS' }],
      }),
    },
    agentRunner: async () => {
      agentStartedResolve();
      return agentResult;
    },
  });
  const context = { elegyHome: tempHome };
  const started = await service.startAgentRun({
    context,
    repoId: 'cancelled',
    prNumber: 13,
    targetBranch: 'main',
    observedHeadSha: 'head-13',
    observedBaseSha: 'base-1',
  });
  await agentStarted;
  const cancelled = await service.cancelAgentRun({ context, runId: started.run.id });
  assert.strictEqual(cancelled.status, 'cancelled');
  releaseAgent({
    schemaVersion: 1,
    evidence: { mergeable: true, checks: { failed: 0, pending: 0 }, review: 'APPROVED' },
    proposedOperation: { kind: 'squash-merge', pullRequest: 13 },
    blockerCodes: [],
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const final = await service.getAgentRun({ context, runId: started.run.id });
  assert.strictEqual(final.status, 'cancelled');
  fs.rmSync(tempHome, { recursive: true, force: true });
}

async function main() {
  testBranchClassification();
  await testRepositoryScan();
  await testGithubUnavailableRemainsVisible();
  await testOverviewAggregation();
  await testSafeMassSync();
  await testConfirmationAndStaleSync();
  await testPerRepositoryAgentRunAndFreshApproval();
  await testCancellationDoesNotGetOverwritten();
  console.log('repoOperationsService.test.js: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
