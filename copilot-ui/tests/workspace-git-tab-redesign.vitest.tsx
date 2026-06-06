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
  onSetPullRequestTitle: vi.fn(),
  onSetPullRequestBody: vi.fn(),
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
      checks: [
        { name: 'lint', path: 'npm run lint', description: 'Run linter' },
        { name: 'test', path: 'npm test', description: 'Run tests' },
      ],
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

  // ─── Test 7: Checks disclosure lists discovered checks ─────────────────────

  it('checks disclosure lists discovered checks', async () => {
    render(<WorkspaceGitTab {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('workspace-checks-disclosure')).toBeInTheDocument();
    });

    // Summary shows the count
    expect(screen.getByTestId('workspace-checks-disclosure-summary')).toHaveTextContent('✓ Checks discovered (2)');

    // Content is hidden initially
    expect(screen.queryByTestId('workspace-checks-disclosure-content')).not.toBeInTheDocument();

    // Click to expand
    fireEvent.click(screen.getByTestId('workspace-checks-disclosure-summary'));

    // Wait for content to appear
    await waitFor(() => {
      expect(screen.getByTestId('workspace-checks-disclosure-content')).toBeInTheDocument();
    });

    // Check names, descriptions, and paths are shown
    expect(screen.getByText('lint')).toBeInTheDocument();
    expect(screen.getByText('Run linter')).toBeInTheDocument();
    expect(screen.getByText('npm run lint')).toBeInTheDocument();
    expect(screen.getByText('test')).toBeInTheDocument();
    expect(screen.getByText('Run tests')).toBeInTheDocument();
    expect(screen.getByText('npm test')).toBeInTheDocument();
  });

  // ─── Test 8: Verify & Commit runs checks before committing ─────────────────

  it('Verify & Commit runs checks before committing', async () => {
    const onRunChecks = vi.fn();
    const onSetCommitMessage = vi.fn();
    const props = {
      ...defaultProps,
      commitMessage: '',  // Will set via onSetCommitMessage
      onRunChecks,
      onSetCommitMessage,
    };

    // Need to re-render with commitMessage set. We'll set it via the input.
    const { rerender } = render(<WorkspaceGitTab {...props} />);

    await waitFor(() => {
      expect(screen.getByTestId('workspace-git-composer')).toBeInTheDocument();
    });

    // Find commit input and type a message
    const commitInput = screen.getByTestId('workspace-commit-input');
    fireEvent.change(commitInput, { target: { value: 'feat: add new feature' } });

    // Now re-render with a non-empty commitMessage so the button is enabled
    rerender(<WorkspaceGitTab {...{
      ...props,
      gitState: { ...props.gitState, commitMessage: 'feat: add new feature' },
    }} />);

    // Click Verify & Commit
    const verifyBtn = screen.getByTestId('workspace-verify-commit');
    expect(verifyBtn).not.toBeDisabled();
    fireEvent.click(verifyBtn);

    // Verify onRunChecks was called
    expect(onRunChecks).toHaveBeenCalled();

    // Button text should show "Running checks..." after clicking
    await waitFor(() => {
      expect(screen.getByTestId('workspace-verify-commit')).toHaveTextContent('Running checks...');
    });
  });

  // ─── Test 9: Push is disabled when verification is not current ─────────────

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

  // ─── Test 10: PR section as collapsible secondary action ───────────────────

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
});
