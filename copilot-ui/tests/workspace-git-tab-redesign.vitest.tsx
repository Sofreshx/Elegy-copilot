import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────────────
vi.mock('../ui/src/lib/api/git', () => ({
  getMergeCandidates: vi.fn(),
  mergeDryRun: vi.fn(),
  mergeLocal: vi.fn(),
  pullGit: vi.fn(),
  checkoutGitBranch: vi.fn(),
  discoverGitChecks: vi.fn(),
  getGitCheckState: vi.fn(),
  getGitCiSync: vi.fn(),
  runGitChecks: vi.fn(),
  commitGit: vi.fn(),
  pushGit: vi.fn(),
  listStashes: vi.fn(),
  createStash: vi.fn(),
  applyStash: vi.fn(),
  popStash: vi.fn(),
  dropStash: vi.fn(),
  generateCommitMessage: vi.fn(),
}));

vi.mock('../ui/src/lib/api/executor', () => ({
  listExecutorWorktrees: vi.fn(),
  analyzeWorktreeCleanup: vi.fn(),
  removeWorktree: vi.fn(),
  pruneWorktrees: vi.fn(),
}));

vi.mock('../ui/src/stores/notificationStore', () => ({
  notificationStore: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import WorkspaceGitTab from '../ui/src/views/Workspace/WorkspaceGitTab';
import type { ExecutorWorktreesResponse } from '../ui/src/lib/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function baseWorktreeRecord(overrides: Record<string, unknown> = {}) {
  return {
    worktreeId: 'wt-1',
    repoId: 'repo-1',
    repoPath: '/test/repo',
    path: '/test/repo-worktrees/wt-1',
    worktreePath: '/test/repo-worktrees/wt-1',
    source: 'elegy',
    mode: 'dedicated',
    status: 'ready',
    branch: 'feature/test',
    head: 'abc1234',
    detached: false,
    updatedAt: new Date().toISOString(),
    lifecycle: { lastSeenAt: new Date().toISOString() },
    validation: { pathExists: true },
    launch: { blocked: false, reason: null },
    assignment: null,
    git: {
      head: 'abc1234',
      branch: 'feature/test',
      detached: false,
      ahead: 0,
      behind: 0,
      staged: 0,
      unstaged: 0,
      untracked: 0,
      changed: 0,
      probeError: null,
      mtimeMs: Date.now(),
    },
    _discovered: false,
    _discoveredOnly: false,
    _merged: 'persisted' as const,
    _stableOrder: 1,
    ...overrides,
  };
}

function makeWorktreesResponse(records: ReturnType<typeof baseWorktreeRecord>[]): ExecutorWorktreesResponse {
  return {
    worktrees: records,
    worktreeDiscovery: {
      contractVersion: '1',
      repoId: 'repo-1',
      repoPath: '/test/repo',
      gitListOk: true,
      gitListError: null,
      persistedCount: records.length,
      discoveredCount: 0,
    },
  };
}

// ─── Default props ───────────────────────────────────────────────────────────

const defaultProps = {
  repo: { repoId: 'repo-1', repoPath: '/test/repo', repoLabel: 'test/repo', sourceId: 'local', sourceLabel: 'Local' },
  repoPath: '/test/repo',
  repoId: 'repo-1',
  gitState: {
    summary: {
      branch: 'main',
      clean: false,
      changedFiles: 3,
      stagedFiles: 1,
      additions: 5,
      deletions: 2,
      ahead: 2,
      behind: 1,
      upstream: 'origin/main',
      remoteName: 'origin',
      remoteLabel: 'test/repo',
      remoteUrl: 'https://github.com/test/repo',
      hasRemote: true,
      pullRequest: null,
    },
    branches: {
      currentBranch: 'main',
      branches: [
        { name: 'main', current: true, remote: false, upstream: 'origin/main' },
        { name: 'feature', current: false, remote: false, upstream: null },
        { name: 'origin/main', current: false, remote: true, upstream: null },
      ],
    },
    pullRequest: { pullRequest: null, available: true, tool: 'gh', authenticated: true },
    commitMessage: '',
    generating: false,
    generatedBy: null,
    committing: false,
    syncing: false,
    creatingPullRequest: false,
    pullRequestTitle: '',
    pullRequestBody: '',
    log: { commits: [] },
    error: null,
    status: null,
    diff: null,
  } as any,
  verificationState: 'verified' as const,
  checkResults: null,
  runningChecks: false,
  onRunChecks: vi.fn(),
  onCommit: vi.fn(),
  onPush: vi.fn(),
  onOpenPR: vi.fn(),
  onCreatePR: vi.fn(),
  onSetCommitMessage: vi.fn(),
  onGenerateCommitMessage: vi.fn(),
  onSetPullRequestTitle: vi.fn(),
  onSetPullRequestBody: vi.fn(),
  onRefreshGitState: vi.fn(),
};

// ─── Module references for mock control ──────────────────────────────────────

import * as gitApi from '../ui/src/lib/api/git';
import * as executorApi from '../ui/src/lib/api/executor';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('WorkspaceGitTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementations that resolve immediately
    vi.mocked(gitApi.getMergeCandidates).mockResolvedValue({
      repoPath: '/test/repo',
      currentBranch: 'main',
      branches: [],
    });
    vi.mocked(gitApi.discoverGitChecks).mockResolvedValue({
      repoPath: '/test/repo',
      checksAvailable: 2,
      source: 'legacy',
      checks: [
        { name: 'lint', path: 'npm run lint', description: 'Run linter', source: 'legacy' },
        { name: 'test', path: 'npm test', description: 'Run tests', source: 'legacy' },
      ],
    });
    vi.mocked(gitApi.getGitCheckState).mockResolvedValue({
      repoId: 'repo-1',
      repoPath: '/test/repo',
      hasState: false,
      lastRun: null,
      freshness: { fresh: false, reason: 'no-state' },
      history: [],
    });
    vi.mocked(gitApi.getGitCiSync).mockResolvedValue({
      repoRoot: '/test/repo',
      config: null,
      ciWorkflows: { workflows: [], unknown: [] },
      syncResult: {
        mappings: [],
        summary: { totalCiJobs: 0, mapped: 0, gaps: 0, readiness: 'no-ci' },
      },
    });
    vi.mocked(gitApi.runGitChecks).mockResolvedValue({
      repoRoot: '/test/repo',
      checkedAt: new Date().toISOString(),
      checksAvailable: 2,
      checksRun: 2,
      checksPassed: 2,
      checksFailed: 0,
      allPassed: true,
      results: [
        { checkName: 'lint', passed: true, output: 'ok' },
        { checkName: 'test', passed: true, output: 'ok' },
      ],
      message: 'All checks passed.',
      source: 'legacy' as const,
    });
    vi.mocked(gitApi.commitGit).mockResolvedValue({ committed: true, output: 'ok' });
    vi.mocked(gitApi.pushGit).mockResolvedValue({ pushed: true, output: 'ok' });
    vi.mocked(gitApi.listStashes).mockResolvedValue({ repoPath: '/test/repo', count: 0, stashes: [] });
    vi.mocked(gitApi.createStash).mockResolvedValue({ stashed: true, index: 0, output: 'ok' });
    vi.mocked(gitApi.applyStash).mockResolvedValue({ applied: true, index: 0, output: 'ok' });
    vi.mocked(gitApi.popStash).mockResolvedValue({ popped: true, index: 0, output: 'ok' });
    vi.mocked(gitApi.dropStash).mockResolvedValue({ dropped: true, index: 0, output: 'ok' });
    vi.mocked(gitApi.generateCommitMessage).mockResolvedValue({
      message: 'feat: add test feature',
      model: 'opencode/mimo-v2.5-free',
      source: 'opencode',
      fallbackIndex: 0,
    });
    vi.mocked(gitApi.pullGit).mockResolvedValue({ pulled: true, output: 'ok' });
    vi.mocked(gitApi.checkoutGitBranch).mockResolvedValue({ checkedOut: true, branch: 'feature' });
    vi.mocked(executorApi.listExecutorWorktrees).mockResolvedValue(makeWorktreesResponse([]));
    vi.mocked(executorApi.analyzeWorktreeCleanup).mockResolvedValue({
      eligible: false,
      reason: 'not analyzed',
      dirty: false,
      dirtyFiles: 0,
      missing: false,
      assigned: false,
      mergedIntoCurrentOrDefault: false,
      conflicts: false,
      conflictFiles: [],
      diagnostics: [],
      branch: 'feature/test',
      repoPath: '/test/repo',
      worktreePath: '/test/repo-worktrees/wt-1',
    });
    vi.mocked(executorApi.removeWorktree).mockResolvedValue({
      removed: true,
      worktreePath: '/test/repo-worktrees/wt-1',
      repoPath: '/test/repo',
      output: 'removed',
    });
    vi.mocked(executorApi.pruneWorktrees).mockResolvedValue({
      pruned: true,
      repoPath: '/test/repo',
      output: 'pruned',
      diagnostics: ['ok'],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── Test 1: No Open in... button and no repo switcher ──────────────────────

  it('has no Open in... button and no repo switcher', async () => {
    render(<WorkspaceGitTab {...defaultProps} />);

    // Wait for async effects to settle
    await waitFor(() => {
      expect(screen.getByTestId('workspace-git-tab')).toBeInTheDocument();
    });

    // workspace-launch-trigger moved to WorkspaceView — should NOT be present
    expect(screen.queryByTestId('workspace-launch-trigger')).not.toBeInTheDocument();
    // workspace-switch-repo moved to WorkspaceView — should NOT be present
    expect(screen.queryByTestId('workspace-switch-repo')).not.toBeInTheDocument();
    // No "Switch repo" text-based button
    expect(screen.queryByText(/switch repo/i)).not.toBeInTheDocument();
  });

  // ─── Test 2: Slim summary strip ────────────────────────────────────────────

  it('renders slim summary strip with branch, upstream, dirty count', async () => {
    render(<WorkspaceGitTab {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('workspace-git-summary')).toBeInTheDocument();
    });

    // Branch name
    expect(screen.getByTestId('workspace-summary-branch')).toHaveTextContent('main');
    // Upstream
    expect(screen.getByTestId('workspace-summary-upstream')).toHaveTextContent('origin/main');
    // Dirty count
    expect(screen.getByTestId('workspace-summary-clean')).toHaveTextContent('dirty(3)');
    // Staged count
    expect(screen.getByTestId('workspace-summary-staged')).toHaveTextContent('1 staged');
    // Ahead/behind markers
    expect(screen.getByTestId('workspace-summary-ahead')).toHaveTextContent('↑2');
    expect(screen.getByTestId('workspace-summary-behind')).toHaveTextContent('↓1');
  });

  // ─── Test 3: Local and Remote segmented tabs ───────────────────────────────

  it('renders Local and Remote segmented tabs', async () => {
    render(<WorkspaceGitTab {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('workspace-git-segmented-tabs')).toBeInTheDocument();
    });

    const localTab = screen.getByTestId('workspace-git-tab-local');
    const remoteTab = screen.getByTestId('workspace-git-tab-remote');
    expect(localTab).toBeInTheDocument();
    expect(remoteTab).toBeInTheDocument();

    // Local is active by default
    expect(localTab.className).toContain('workspace-git-segmented-tab-active');
    expect(remoteTab.className).not.toContain('workspace-git-segmented-tab-active');

    // Click Remote tab — it becomes active
    fireEvent.click(remoteTab);
    expect(remoteTab.className).toContain('workspace-git-segmented-tab-active');
    expect(localTab.className).not.toContain('workspace-git-segmented-tab-active');
  });

  // ─── Test 4: Local branches table with columns ─────────────────────────────

  it('renders local branches table with columns', async () => {
    const props = {
      ...defaultProps,
      gitState: {
        ...defaultProps.gitState,
        branches: {
          currentBranch: 'main',
          branches: [
            { name: 'main', current: true, remote: false, upstream: 'origin/main' },
            { name: 'feature-x', current: false, remote: false, upstream: null },
            { name: 'bugfix/y', current: false, remote: false, upstream: null },
            { name: 'origin/main', current: false, remote: true, upstream: null },
          ],
        },
      },
    };

    render(<WorkspaceGitTab {...props} />);

    await waitFor(() => {
      expect(screen.getByTestId('workspace-git-branches-list')).toBeInTheDocument();
    });

    // Verify table headers
    const headers = screen.getAllByRole('columnheader');
    const headerTexts = headers.map((h) => h.textContent);
    expect(headerTexts).toContain('Branch');
    expect(headerTexts).toContain('Current');
    expect(headerTexts).toContain('Upstream');
    expect(headerTexts).toContain('Ahead/Behind');
    expect(headerTexts).toContain('Last Commit');
    expect(headerTexts).toContain('PR Status');
    expect(headerTexts).toContain('Actions');

    // Verify branch rows render
    expect(screen.getByTestId('workspace-git-branch-main')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-git-branch-feature-x')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-git-branch-bugfix/y')).toBeInTheDocument();
    // Remote branches should NOT be in the local table
    expect(screen.queryByTestId('workspace-git-branch-origin/main')).not.toBeInTheDocument();
  });

  // ─── Test 5: Worktrees table uses table layout (not card) ──────────────────

  it('renders worktrees table not as card layout', async () => {
    const worktrees = [
      baseWorktreeRecord({
        worktreeId: 'wt-alpha',
        branch: 'feature/alpha',
        path: '/repo-worktrees/wt-alpha',
      }),
      baseWorktreeRecord({
        worktreeId: 'wt-beta',
        branch: 'feature/beta',
        path: '/repo-worktrees/wt-beta',
      }),
    ];
    vi.mocked(executorApi.listExecutorWorktrees).mockResolvedValue(makeWorktreesResponse(worktrees));

    render(<WorkspaceGitTab {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('workspace-worktrees-list')).toBeInTheDocument();
    });

    // Table structure is present (not card layout)
    const table = screen.getByTestId('workspace-worktrees-list');
    expect(table.tagName).toBe('TABLE');

    // Verify table headers
    const headers = table.querySelectorAll('th');
    const headerTexts = Array.from(headers).map((h) => h.textContent);
    expect(headerTexts).toContain('Branch');
    expect(headerTexts).toContain('Path');
    expect(headerTexts).toContain('Source');
    expect(headerTexts).toContain('Status');
    expect(headerTexts).toContain('Dirty');
    expect(headerTexts).toContain('Flags');
    expect(headerTexts).toContain('Cleanup');

    // No card/Panel elements
    expect(screen.queryByTestId('workspace-worktrees-card')).not.toBeInTheDocument();
    expect(screen.queryByTestId('panel')).not.toBeInTheDocument();

    // Rows present
    expect(screen.getByTestId('workspace-worktree-wt-alpha')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-worktree-wt-beta')).toBeInTheDocument();
  });

  // ─── Test 6: Worktree rows show safe, dirty blocked states ─────────────────

  it('worktree rows show safe, dirty blocked states', async () => {
    const cleanWt = baseWorktreeRecord({
      worktreeId: 'wt-clean',
      branch: 'merged-branch',
      path: '/repo-worktrees/wt-clean',
      git: { ...baseWorktreeRecord({}).git, changed: 0 },
    });
    const dirtyWt = baseWorktreeRecord({
      worktreeId: 'wt-dirty',
      branch: 'dirty-branch',
      path: '/repo-worktrees/wt-dirty',
      git: { ...baseWorktreeRecord({}).git, changed: 3, unstaged: 3 },
    });

    vi.mocked(executorApi.listExecutorWorktrees).mockResolvedValue(makeWorktreesResponse([cleanWt, dirtyWt]));

    // Set up analyze results
    vi.mocked(executorApi.analyzeWorktreeCleanup).mockImplementation(
      async (_repoPath: string, worktreePath: string) => {
        if (worktreePath === '/repo-worktrees/wt-clean') {
          return {
            eligible: true,
            reason: 'safe to remove',
            dirty: false,
            dirtyFiles: 0,
            missing: false,
            assigned: false,
            mergedIntoCurrentOrDefault: true,
            conflicts: false,
            conflictFiles: [],
            diagnostics: [],
            branch: 'merged-branch',
            repoPath: '/test/repo',
            worktreePath,
          };
        }
        // Default: blocked
        return {
          eligible: false,
          reason: 'dirty',
          dirty: true,
          dirtyFiles: 3,
          missing: false,
          assigned: false,
          mergedIntoCurrentOrDefault: true,
          conflicts: false,
          conflictFiles: [],
          diagnostics: [],
          branch: 'dirty-branch',
          repoPath: '/test/repo',
          worktreePath,
        };
      },
    );

    render(<WorkspaceGitTab {...defaultProps} />);

    // Wait for worktree table to appear
    await waitFor(() => {
      expect(screen.getByTestId('workspace-worktrees-list')).toBeInTheDocument();
    });

    // Both rows should have "Analyze" buttons initially
    const analyzeClean = screen.getByTestId('workspace-worktree-analyze-wt-clean');
    const analyzeDirty = screen.getByTestId('workspace-worktree-analyze-wt-dirty');
    expect(analyzeClean).toBeInTheDocument();
    expect(analyzeDirty).toBeInTheDocument();

    // Click "Analyze" on clean worktree
    fireEvent.click(analyzeClean);

    // After analysis, the clean worktree should show "✓ Safe" and "Remove"
    await waitFor(() => {
      expect(screen.getByTestId('workspace-worktree-remove-wt-clean')).toBeInTheDocument();
    });
    expect(screen.getByText(/✓ Safe/)).toBeInTheDocument();

    // Click "Analyze" on dirty worktree
    fireEvent.click(analyzeDirty);

    // After analysis, the dirty worktree should show "✗ Blocked"
    await waitFor(() => {
      expect(screen.getByText(/✗ Blocked/)).toBeInTheDocument();
    });
    // The dirty worktree's Remove button is present but disabled (not eligible)
    const removeDirty = screen.getByTestId('workspace-worktree-remove-wt-dirty');
    expect(removeDirty).toBeDisabled();
  });

  // ─── Test 7: Compact checks card lists configured lanes ───────────────────

  it('compact checks card lists configured lanes', async () => {
    render(<WorkspaceGitTab {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('workspace-checks-section')).toBeInTheDocument();
    });

    expect(screen.getByTestId('workspace-checks-result')).toHaveTextContent('2 checks configured');
    expect(screen.queryByTestId('workspace-checks-disclosure')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('workspace-checks-card-toggle'));

    await waitFor(() => {
      expect(screen.getByTestId('workspace-checks-lane-lint')).toBeInTheDocument();
    });
    expect(screen.getByTestId('workspace-checks-lane-test')).toBeInTheDocument();
  });

  // ─── Test 8: Verify & Commit runs checks and commits on pass ───────────────

  it('Verify & Commit runs checks and commits on pass', async () => {
    const onCommit = vi.fn();
    const props = {
      ...defaultProps,
      onCommit,
      gitState: { ...defaultProps.gitState, commitMessage: 'feat: test' },
    };

    render(<WorkspaceGitTab {...props} />);

    await waitFor(() => {
      expect(screen.getByTestId('workspace-git-composer')).toBeInTheDocument();
    });

    const verifyBtn = screen.getByTestId('workspace-verify-commit');
    expect(verifyBtn).not.toBeDisabled();
    fireEvent.click(verifyBtn);

    await waitFor(() => {
      expect(gitApi.runGitChecks).toHaveBeenCalledWith('/test/repo');
    });
    await waitFor(() => {
      expect(onCommit).toHaveBeenCalled();
    });
  });

  // ─── Test 9: failed checks block commit and render failure details ──────────

  it('failed checks block commit and render failure details', async () => {
    vi.mocked(gitApi.runGitChecks).mockResolvedValue({
      repoRoot: '/test/repo',
      checkedAt: new Date().toISOString(),
      checksAvailable: 2,
      checksRun: 2,
      checksPassed: 0,
      checksFailed: 2,
      allPassed: false,
      results: [
        { checkName: 'lint', status: 'FAIL', passed: false, error: 'lint errors', output: 'failed', commands: [{ command: 'npm run lint', exitCode: 1, success: false, durationMs: 10 }] },
        { checkName: 'test', status: 'FAIL', passed: false, error: 'test failures', output: 'failed', commands: [{ command: 'npm test', exitCode: 1, success: false, durationMs: 10 }] },
      ],
      message: '2 checks failed.',
      source: 'legacy' as const,
    });

    const onCommit = vi.fn();
    const props = {
      ...defaultProps,
      onCommit,
      gitState: { ...defaultProps.gitState, commitMessage: 'feat: test' },
    };

    render(<WorkspaceGitTab {...props} />);

    await waitFor(() => {
      expect(screen.getByTestId('workspace-git-composer')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('workspace-verify-commit'));

    await waitFor(() => {
      expect(gitApi.runGitChecks).toHaveBeenCalled();
    });

    expect(onCommit).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.getByTestId('workspace-force-commit-btn')).toBeInTheDocument();
    });
    expect(screen.getByTestId('workspace-checks-failure-summary')).toHaveTextContent('lint');
    expect(screen.getByTestId('workspace-checks-failure-summary')).toHaveTextContent('test');
  });

  // ─── Test 10: force commit requires override reason ─────────────────────────

  it('force commit requires override reason', async () => {
    vi.mocked(gitApi.runGitChecks).mockResolvedValue({
      repoRoot: '/test/repo',
      checkedAt: new Date().toISOString(),
      checksAvailable: 2, checksRun: 2, checksPassed: 0, checksFailed: 2,
      allPassed: false,
      results: [{ checkName: 'lint', status: 'FAIL', passed: false, error: 'lint errors', output: 'failed' }],
      message: '1 check failed.',
      source: 'legacy' as const,
    });
    vi.mocked(gitApi.commitGit).mockResolvedValue({ committed: true, output: 'ok' });

    const props = {
      ...defaultProps,
      gitState: { ...defaultProps.gitState, commitMessage: 'feat: test' },
    };

    render(<WorkspaceGitTab {...props} />);

    await waitFor(() => {
      expect(screen.getByTestId('workspace-git-composer')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('workspace-verify-commit'));
    await waitFor(() => {
      expect(gitApi.runGitChecks).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getByTestId('workspace-force-commit-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('workspace-force-commit-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('workspace-force-reason-input')).toBeInTheDocument();
    });

    expect(screen.getByTestId('workspace-force-commit-confirm')).toBeDisabled();

    fireEvent.change(screen.getByTestId('workspace-force-reason-input'), { target: { value: 'Known good' } });
    await waitFor(() => {
      expect(screen.getByTestId('workspace-force-commit-confirm')).not.toBeDisabled();
    });

    fireEvent.click(screen.getByTestId('workspace-force-commit-confirm'));

    await waitFor(() => {
      expect(gitApi.commitGit).toHaveBeenCalledWith('/test/repo', 'feat: test', { reason: 'Known good' });
    });
  });

  // ─── Test 11: stash list renders and calls APIs ────────────────────────────

  it('stash list renders and calls APIs', async () => {
    vi.mocked(gitApi.listStashes).mockResolvedValue({
      repoPath: '/test/repo',
      count: 2,
      stashes: [
        { index: 0, ref: 'stash@{0}', hash: 'abc1234', message: 'WIP on main' },
        { index: 1, ref: 'stash@{1}', hash: 'def5678', message: 'temp changes' },
      ],
    });

    render(<WorkspaceGitTab {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('workspace-git-stash-area')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByTestId('workspace-stash-count')).toHaveTextContent('Stashes (2)');
    });

    expect(screen.getByTestId('workspace-stash-create')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('workspace-stash-toggle-list'));
    await waitFor(() => {
      expect(screen.getByTestId('workspace-stash-list')).toBeInTheDocument();
    });

    expect(screen.getByTestId('workspace-stash-apply-0')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-stash-pop-0')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-stash-drop-0')).toBeInTheDocument();
  });

  // ─── Test 12: refresh button calls onRefreshGitState ─────────────────────

  it('refresh button calls onRefreshGitState', async () => {
    const onRefreshGitState = vi.fn();
    render(<WorkspaceGitTab {...defaultProps} onRefreshGitState={onRefreshGitState} />);

    await waitFor(() => {
      expect(screen.getByTestId('workspace-summary-refresh')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('workspace-summary-refresh'));

    expect(onRefreshGitState).toHaveBeenCalledTimes(1);
  });

  // ─── Test 13: stash divider shows explanatory label ───────────────────────

  it('stash divider shows explanatory label', async () => {
    vi.mocked(gitApi.listStashes).mockResolvedValue({
      repoPath: '/test/repo',
      count: 1,
      stashes: [
        { index: 0, ref: 'stash@{0}', hash: 'abc1234', message: 'WIP on main' },
      ],
    });

    render(<WorkspaceGitTab {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('workspace-git-stash-area')).toBeInTheDocument();
    });

    const divider = screen.getByTestId('workspace-git-stash-divider');
    expect(divider).toBeInTheDocument();
    expect(divider.textContent).toContain('Stashed work');
    expect(divider.textContent).toContain('not staged for commit');
  });

  // ─── Test 14: worktree row states show computed chips ──────────────────────

  it('worktree row states show computed chips', async () => {
    const wt = baseWorktreeRecord({ worktreeId: 'wt-dirty', branch: 'feature/dirty', path: '/repo-worktrees/wt-dirty',
      git: { ...baseWorktreeRecord({}).git, changed: 3 },
    });
    vi.mocked(executorApi.listExecutorWorktrees).mockResolvedValue(makeWorktreesResponse([wt]));

    render(<WorkspaceGitTab {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('workspace-worktrees-list')).toBeInTheDocument();
    });

    await waitFor(() => {
      const stateChip = screen.getByTestId('workspace-worktree-state-wt-dirty');
      expect(stateChip).toBeInTheDocument();
      expect(stateChip).toHaveTextContent('Dirty');
    });
  });

  // ─── Test 13: Push is disabled when verification is not current ────────────

  it('Push is disabled when verification is not current', async () => {
    const props = {
      ...defaultProps,
      verificationState: 'stale' as const,
      gitState: { ...defaultProps.gitState, summary: { ...defaultProps.gitState.summary, changedFiles: 3 } },
    };

    render(<WorkspaceGitTab {...props} />);

    await waitFor(() => {
      expect(screen.getByTestId('workspace-push')).toBeDisabled();
    });

    // Push disabled hint should be shown
    const hint = screen.getByTestId('workspace-push-hint');
    expect(hint).toBeInTheDocument();
    expect(hint).toHaveTextContent('Push disabled');
  });

  // ─── Test 14: PR section as collapsible secondary action ───────────────────

  it('renders PR section as collapsible secondary action', async () => {
    render(<WorkspaceGitTab {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('workspace-git-composer')).toBeInTheDocument();
    });

    // Create PR toggle should be present (hasRemote is true, pullRequest is null)
    const toggleBtn = screen.getByTestId('workspace-toggle-pr-form');
    expect(toggleBtn).toBeInTheDocument();
    expect(toggleBtn).toHaveTextContent('+ Create PR');

    // PR form should NOT be visible initially
    expect(screen.queryByTestId('workspace-git-pr-create')).not.toBeInTheDocument();

    // Click toggle to show form
    fireEvent.click(toggleBtn);

    // PR form should now be visible
    await waitFor(() => {
      expect(screen.getByTestId('workspace-git-pr-create')).toBeInTheDocument();
    });

    // Form should have title input
    const prTitleInput = screen.getByPlaceholderText('PR title...');
    expect(prTitleInput).toBeInTheDocument();

    // Form should have body input
    const prBodyInput = screen.getByPlaceholderText('PR body (optional)...');
    expect(prBodyInput).toBeInTheDocument();

    // Create PR button should be present
    expect(screen.getByTestId('workspace-create-pr')).toBeInTheDocument();
  });

  // ─── Test 15: Generate commit message button calls API and fills input ─────

  it('generates commit message and fills input on success', async () => {
    const onSetCommitMessage = vi.fn();
    render(
      <WorkspaceGitTab
        {...defaultProps}
        onSetCommitMessage={onSetCommitMessage}
        gitState={{ ...defaultProps.gitState, commitMessage: '', generating: false }}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('workspace-generate-commit-message')).toBeInTheDocument();
    });

    // Click Generate
    fireEvent.click(screen.getByTestId('workspace-generate-commit-message'));

    // Should call onGenerateCommitMessage (which is mocked to call the API via store)
    await waitFor(() => {
      expect(defaultProps.onGenerateCommitMessage).toHaveBeenCalled();
    });
  });

  // ─── Test 16: Loading state disables the Generate button ───────────────────

  it('disables Generate button while generating', async () => {
    render(
      <WorkspaceGitTab
        {...defaultProps}
        gitState={{ ...defaultProps.gitState, commitMessage: '', generating: true }}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('workspace-generate-commit-message')).toBeInTheDocument();
    });

    const btn = screen.getByTestId('workspace-generate-commit-message');
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent('Generating...');
  });

  // ─── Test 17: Non-empty message shows confirm dialog ───────────────────────

  it('shows confirm dialog when commit message is non-empty', async () => {
    render(
      <WorkspaceGitTab
        {...defaultProps}
        gitState={{ ...defaultProps.gitState, commitMessage: 'existing message', generating: false }}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('workspace-generate-commit-message')).toBeInTheDocument();
    });

    // Click Generate
    fireEvent.click(screen.getByTestId('workspace-generate-commit-message'));

    // Confirm dialog should appear
    await waitFor(() => {
      expect(screen.getByTestId('workspace-generate-confirm')).toBeInTheDocument();
    });

    // "No" button should cancel
    fireEvent.click(screen.getByTestId('workspace-generate-confirm-no'));

    // Confirm dialog should disappear and Generate should not have been called
    await waitFor(() => {
      expect(screen.queryByTestId('workspace-generate-confirm')).not.toBeInTheDocument();
    });
    expect(defaultProps.onGenerateCommitMessage).not.toHaveBeenCalled();
  });

  // ─── Test 18: Confirm dialog "Yes" proceeds with generation ────────────────

  it('confirm dialog Yes button triggers generation', async () => {
    render(
      <WorkspaceGitTab
        {...defaultProps}
        gitState={{ ...defaultProps.gitState, commitMessage: 'existing message', generating: false }}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('workspace-generate-commit-message')).toBeInTheDocument();
    });

    // Click Generate
    fireEvent.click(screen.getByTestId('workspace-generate-commit-message'));

    // Confirm dialog should appear
    await waitFor(() => {
      expect(screen.getByTestId('workspace-generate-confirm')).toBeInTheDocument();
    });

    // "Yes" button should trigger generation
    fireEvent.click(screen.getByTestId('workspace-generate-confirm-yes'));

    await waitFor(() => {
      expect(defaultProps.onGenerateCommitMessage).toHaveBeenCalled();
    });
  });
});
