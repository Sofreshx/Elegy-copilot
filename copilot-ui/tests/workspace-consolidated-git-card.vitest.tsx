import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import WorkspaceActiveRepoCard from '../ui/src/views/Workspace/WorkspaceActiveRepoCard';

describe('WorkspaceActiveRepoCard (consolidated Git card)', () => {
  const defaultProps = {
    repo: { repoLabel: 'my-org/my-repo', repoPath: 'C:/repos/my-repo', repoId: 'repo-1', sourceId: 'local', sourceLabel: 'Local', scanRoot: 'C:/repos' },
    repoPath: 'C:/repos/my-repo',
    summary: {
      branch: 'feature/test',
      clean: false,
      changedFiles: 3,
      stagedFiles: 1,
      additions: 12,
      deletions: 4,
      ahead: 2,
      behind: 1,
      upstream: 'origin/feature/test',
      remoteName: 'origin',
      remoteLabel: 'my-org/my-repo',
      remoteUrl: 'https://github.com/my-org/my-repo',
      hasRemote: true,
      pullRequest: null,
    },
    pullRequest: null,
    verificationState: 'verified' as const,
    changeCount: 3,
    onSwitchRepo: vi.fn(),
    showRepoSelector: false,
    checkResults: null,
    runningChecks: false,
    commitMessage: '',
    committing: false,
    syncing: false,
    creatingPullRequest: false,
    pullRequestTitle: '',
    pullRequestBody: '',
    log: {
      commits: [
        { hash: 'abc1234', fullHash: 'abc1234567890def', message: 'Fix bug', author: 'Alice', authoredAt: '2025-06-01T10:00:00Z' },
        { hash: 'def5678', fullHash: 'def5678901234abc', message: 'Add feature', author: null, authoredAt: null },
      ],
    },
    onRunChecks: vi.fn(),
    onCommit: vi.fn(),
    onPush: vi.fn(),
    onOpenPR: vi.fn(),
    onCreatePR: vi.fn(),
    onSetCommitMessage: vi.fn(),
    onSetPullRequestTitle: vi.fn(),
    onSetPullRequestBody: vi.fn(),
  };

  it('renders the consolidated Git card with correct title', () => {
    render(<WorkspaceActiveRepoCard {...defaultProps} />);
    expect(screen.getByTestId('workspace-active-card')).toBeInTheDocument();
    expect(screen.getByText('Git')).toBeInTheDocument();
    // my-org/my-repo appears both in Panel subtitle and remote-label span
    expect(screen.getAllByText('my-org/my-repo').length).toBeGreaterThanOrEqual(1);
  });

  it('shows branch, verification, and change count in summary', () => {
    render(<WorkspaceActiveRepoCard {...defaultProps} />);
    expect(screen.getByTestId('workspace-branch')).toHaveTextContent('feature/test');
    expect(screen.getByTestId('workspace-verification')).toHaveTextContent('Verified');
    expect(screen.getByTestId('workspace-changes')).toHaveTextContent('3 changes');
  });

  it('renders repo link when remoteUrl is provided', () => {
    render(<WorkspaceActiveRepoCard {...defaultProps} />);
    const repoLink = screen.getByTestId('workspace-repo-link');
    expect(repoLink).toBeInTheDocument();
    expect(repoLink).toHaveAttribute('href', 'https://github.com/my-org/my-repo');
  });

  it('does not render repo link when remoteUrl is null', () => {
    const props = {
      ...defaultProps,
      summary: { ...defaultProps.summary, remoteUrl: null },
    };
    render(<WorkspaceActiveRepoCard {...props} />);
    expect(screen.queryByTestId('workspace-repo-link')).not.toBeInTheDocument();
  });

  it('renders PR section when pullRequest exists', () => {
    const props = {
      ...defaultProps,
      pullRequest: { number: 42, url: 'https://github.com/my-org/my-repo/pull/42', state: 'OPEN' },
    };
    render(<WorkspaceActiveRepoCard {...props} />);
    expect(screen.getByTestId('workspace-open-pr')).toBeInTheDocument();
    expect(screen.getByText('PR #42 (OPEN)')).toBeInTheDocument();
  });

  it('shows create PR form when hasRemote is true and no PR exists', () => {
    render(<WorkspaceActiveRepoCard {...defaultProps} />);
    expect(screen.getByTestId('workspace-pr-create')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-create-pr')).toBeInTheDocument();
  });

  it('commit button is disabled when commit message is empty', () => {
    render(<WorkspaceActiveRepoCard {...defaultProps} />);
    expect(screen.getByTestId('workspace-commit')).toBeDisabled();
  });

  it('calls onCommit when commit button is clicked', () => {
    const props = { ...defaultProps, commitMessage: 'test commit' };
    render(<WorkspaceActiveRepoCard {...props} />);
    fireEvent.click(screen.getByTestId('workspace-commit'));
    expect(props.onCommit).toHaveBeenCalled();
  });

  it('calls onPush when push button is clicked', () => {
    render(<WorkspaceActiveRepoCard {...defaultProps} />);
    fireEvent.click(screen.getByTestId('workspace-push'));
    expect(defaultProps.onPush).toHaveBeenCalled();
  });

  it('calls onRunChecks when run checks button is clicked', () => {
    render(<WorkspaceActiveRepoCard {...defaultProps} />);
    fireEvent.click(screen.getByTestId('workspace-run-checks'));
    expect(defaultProps.onRunChecks).toHaveBeenCalled();
  });

  it('calls onCreatePR when create PR button is clicked', () => {
    const props = { ...defaultProps, pullRequestTitle: 'New feature' };
    render(<WorkspaceActiveRepoCard {...props} />);
    fireEvent.click(screen.getByTestId('workspace-create-pr'));
    expect(props.onCreatePR).toHaveBeenCalled();
  });

  it('renders recent commits as buttons', () => {
    render(<WorkspaceActiveRepoCard {...defaultProps} />);
    expect(screen.getByTestId('workspace-commit-log')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-commit-entry-0')).toHaveTextContent('Fix bug');
    expect(screen.getByTestId('workspace-commit-entry-1')).toHaveTextContent('Add feature');
  });

  it('clicking a commit button expands inline details', () => {
    render(<WorkspaceActiveRepoCard {...defaultProps} />);
    
    // Details not visible initially
    expect(screen.queryByTestId('workspace-commit-detail-0')).not.toBeInTheDocument();
    
    // Click first commit
    fireEvent.click(screen.getByTestId('workspace-commit-entry-0'));
    
    // Details visible now
    const detail = screen.getByTestId('workspace-commit-detail-0');
    expect(detail).toBeInTheDocument();
    expect(detail).toHaveTextContent('abc1234');
    expect(detail).toHaveTextContent('abc1234567890def');
    expect(detail).toHaveTextContent('Fix bug');
    expect(detail).toHaveTextContent('Alice');
    expect(detail).toHaveTextContent('2025-06-01T10:00:00Z');
    
    // Click again to collapse
    fireEvent.click(screen.getByTestId('workspace-commit-entry-0'));
    expect(screen.queryByTestId('workspace-commit-detail-0')).not.toBeInTheDocument();
  });

  it('shows Unknown author and Unknown date when commit data is missing', () => {
    render(<WorkspaceActiveRepoCard {...defaultProps} />);
    
    // Click second commit (has null author/date)
    fireEvent.click(screen.getByTestId('workspace-commit-entry-1'));
    
    const detail = screen.getByTestId('workspace-commit-detail-1');
    expect(detail).toHaveTextContent('Unknown author');
    expect(detail).toHaveTextContent('Unknown date');
  });

  it('shows check results warning when verification is not verified', () => {
    const props = { ...defaultProps, verificationState: 'stale' as const };
    render(<WorkspaceActiveRepoCard {...props} />);
    expect(screen.getByTestId('workspace-commit-warning')).toBeInTheDocument();
  });

  it('does not show warning when verification is verified', () => {
    render(<WorkspaceActiveRepoCard {...defaultProps} />);
    expect(screen.queryByTestId('workspace-commit-warning')).not.toBeInTheDocument();
  });

  it('calls onSwitchRepo when Switch repo button is clicked', () => {
    render(<WorkspaceActiveRepoCard {...defaultProps} />);
    fireEvent.click(screen.getByTestId('workspace-switch-repo'));
    expect(defaultProps.onSwitchRepo).toHaveBeenCalled();
  });

  it('shows check results when checkResults is provided', () => {
    const props = {
      ...defaultProps,
      checkResults: {
        repoRoot: 'C:/repos/my-repo',
        checkedAt: '2025-06-01T10:00:00Z',
        checksAvailable: 2,
        checksRun: 2,
        checksPassed: 2,
        checksFailed: 0,
        allPassed: true,
        results: [],
        message: 'All checks passed',
      },
    };
    render(<WorkspaceActiveRepoCard {...props} />);
    expect(screen.getByTestId('workspace-checks-result')).toHaveTextContent('All checks passed');
  });

  it('shows failed check results when allPassed is false', () => {
    const props = {
      ...defaultProps,
      checkResults: {
        repoRoot: 'C:/repos/my-repo',
        checkedAt: '2025-06-01T10:00:00Z',
        checksAvailable: 2,
        checksRun: 2,
        checksPassed: 0,
        checksFailed: 2,
        allPassed: false,
        results: [],
        message: 'Some checks failed',
      },
    };
    render(<WorkspaceActiveRepoCard {...props} />);
    expect(screen.getByTestId('workspace-checks-result')).toHaveTextContent('Some checks failed');
  });

  it('disables commit button while committing', () => {
    const props = { ...defaultProps, commitMessage: 'test', committing: true };
    render(<WorkspaceActiveRepoCard {...props} />);
    expect(screen.getByTestId('workspace-commit')).toBeDisabled();
    expect(screen.getByTestId('workspace-commit')).toHaveTextContent('Committing...');
  });

  it('disables push button while syncing', () => {
    const props = { ...defaultProps, syncing: true };
    render(<WorkspaceActiveRepoCard {...props} />);
    expect(screen.getByTestId('workspace-push')).toBeDisabled();
    expect(screen.getByTestId('workspace-push')).toHaveTextContent('Pushing...');
  });

  it('disables create PR button while creatingPullRequest', () => {
    const props = { ...defaultProps, pullRequestTitle: 'Test PR', creatingPullRequest: true };
    render(<WorkspaceActiveRepoCard {...props} />);
    expect(screen.getByTestId('workspace-create-pr')).toBeDisabled();
    expect(screen.getByTestId('workspace-create-pr')).toHaveTextContent('Creating...');
  });

  it('create PR button is disabled when title is empty', () => {
    const props = { ...defaultProps, pullRequestTitle: '' };
    render(<WorkspaceActiveRepoCard {...props} />);
    expect(screen.getByTestId('workspace-create-pr')).toBeDisabled();
  });

  it('shows existing PR section with Open PR button when pullRequest exists', () => {
    const props = {
      ...defaultProps,
      pullRequest: { number: 42, url: 'https://github.com/my-org/my-repo/pull/42', state: 'OPEN' },
    };
    render(<WorkspaceActiveRepoCard {...props} />);
    expect(screen.getByTestId('workspace-open-pr')).toBeInTheDocument();
    expect(screen.getByText('PR #42 (OPEN)')).toBeInTheDocument();
  });

  it('calls onOpenPR when Open PR button is clicked', () => {
    const props = {
      ...defaultProps,
      pullRequest: { number: 42, url: 'https://github.com/my-org/my-repo/pull/42', state: 'OPEN' },
    };
    render(<WorkspaceActiveRepoCard {...props} />);
    fireEvent.click(screen.getByTestId('workspace-open-pr'));
    expect(props.onOpenPR).toHaveBeenCalled();
  });

  it('shows empty log state when log is null', () => {
    const props = { ...defaultProps, log: null };
    render(<WorkspaceActiveRepoCard {...props} />);
    expect(screen.getByText('No commits found.')).toBeInTheDocument();
  });

  it('shows empty log state when log has no commits', () => {
    const props = { ...defaultProps, log: { commits: [] } };
    render(<WorkspaceActiveRepoCard {...props} />);
    expect(screen.getByText('No commits found.')).toBeInTheDocument();
  });

  it('shows ahead and behind markers in summary', () => {
    render(<WorkspaceActiveRepoCard {...defaultProps} />);
    expect(screen.getByText('+2 ahead')).toBeInTheDocument();
    expect(screen.getByText('-1 behind')).toBeInTheDocument();
  });

  it('does not show ahead/behind when values are zero', () => {
    const props = {
      ...defaultProps,
      summary: { ...defaultProps.summary, ahead: 0, behind: 0 },
    };
    render(<WorkspaceActiveRepoCard {...props} />);
    expect(screen.queryByText(/ahead/)).not.toBeInTheDocument();
    expect(screen.queryByText(/behind/)).not.toBeInTheDocument();
  });
});
