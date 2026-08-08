import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const {
  getRepoOperationsOverview,
  syncRepoOperations,
  fetchRepoOperations,
  analyzeRepoOperations,
  cleanupRepoOperationEntities,
  cleanupRepoOperations,
  startRepoOperationsAgentRun,
  getRepoOperationsAgentRun,
  approveRepoOperationsAgentRun,
  cancelRepoOperationsAgentRun,
} = vi.hoisted(() => ({
  getRepoOperationsOverview: vi.fn(),
  syncRepoOperations: vi.fn(),
  fetchRepoOperations: vi.fn(),
  analyzeRepoOperations: vi.fn(),
  cleanupRepoOperationEntities: vi.fn(),
  cleanupRepoOperations: vi.fn(),
  startRepoOperationsAgentRun: vi.fn(),
  getRepoOperationsAgentRun: vi.fn(),
  approveRepoOperationsAgentRun: vi.fn(),
  cancelRepoOperationsAgentRun: vi.fn(),
}));

vi.mock('../ui/src/lib/api/repoOperations', () => ({
  getRepoOperationsOverview, syncRepoOperations, fetchRepoOperations, analyzeRepoOperations,
  cleanupRepoOperationEntities, cleanupRepoOperations, startRepoOperationsAgentRun,
  getRepoOperationsAgentRun, approveRepoOperationsAgentRun, cancelRepoOperationsAgentRun,
}));

import RepoOperationsView from '../ui/src/views/RepoOperations/RepoOperationsView';
import { navigationStore } from '../ui/src/stores/navigation';
import { repoOperationsStore } from '../ui/src/views/RepoOperations/repoOperationsStore';

const actionResult = {
  contractVersion: 'repo-operations.action.v4', operation: 'fetch', summary: { requested: 2, succeeded: 1, skipped: 0, failed: 1 },
  repositories: [
    { repoId: 'alpha', repoLabel: 'Alpha', status: 'fetched', remotes: [{ name: 'origin', status: 'fetched' }] },
    { repoId: 'beta', repoLabel: 'Beta', status: 'failed', remotes: [{ name: 'backup', status: 'failed', error: 'authentication failed' }], issueCodes: ['remote-unavailable'] },
  ],
};
const analysisResult = {
  contractVersion: 'repo-operations.action.v4', operation: 'analyze', summary: { requested: 1, completed: 1, safe: 1, blocked: 0 },
  entities: [{
    repoId: 'alpha', entityId: 'local:feature/one', status: 'completed', blockerCodes: [],
    evidence: { analysisId: 'analysis-1', analyzedAt: '2026-08-08T10:00:00.000Z', branchTipReachableFromDefault: false, uniqueCommits: 2, treeDelta: false, openPullRequests: [], active: false, protected: false, classification: 'analyzed-safe' },
  }],
};
const overview = {
  schemaVersion: 4,
  contractVersion: 'repo-operations.overview.v4',
  generatedAt: '2026-08-03T10:00:00.000Z',
  summary: { trackedRepos: 2, reposNeedingAttention: 1, syncIssues: 1, staleBranches: 1, openPullRequests: 1, cleanupCandidates: 1, needsAnalysis: 1 },
  warnings: ['One repository was skipped during the previous fetch.'],
  capabilities: {
    sync: { enabled: true, label: 'Fast-forward eligible repositories' },
    fetch: { enabled: true, label: 'Fetch all remotes' },
    analysis: { enabled: true, label: 'Analyze candidates' },
    branchCleanup: { enabled: true, label: 'Clean safe candidates' },
    prAgent: { enabled: true, label: 'Prepare merge with OpenCode' },
  },
  activeRuns: [],
  repositories: [
    {
      repoId: 'alpha', repoPath: 'C:\\work\\alpha', repoLabel: 'Alpha', available: true, provider: 'github', lastActivityMs: Date.now() - 60_000,
      sync: { branch: 'main', upstream: 'origin/main', clean: true, ahead: 0, behind: 0, remoteAvailable: true, syncEligible: true, blockerCodes: [], issueCodes: [] },
      branches: [{ name: 'main', upstream: 'origin/main', state: 'default', worktree: 'C:\\work\\alpha', issueCodes: [] }, { name: 'feature/one', upstream: 'origin/feature/one', state: 'merged', worktree: null, sha: 'feature-sha', activityAt: '2026-08-03T09:00:00.000Z', cleanupEligible: true, issueCodes: ['merged'] }],
      remoteBranches: [],
      entities: [
        { id: 'local:main', kind: 'local-branch', branch: 'main', worktreePath: 'C:\\work\\alpha', remoteName: null, observedSha: 'main-sha', observedDefaultSha: 'main-sha', activityAt: '2026-08-03T10:00:00.000Z', localState: 'default', remoteState: 'tracked', safety: 'protected', cleanupEligible: false, blockerCodes: ['protected-branch'] },
        { id: 'local:feature/one', kind: 'local-branch', branch: 'feature/one', worktreePath: null, remoteName: 'origin', observedSha: 'feature-sha', observedDefaultSha: 'main-sha', activityAt: '2026-08-03T09:00:00.000Z', localState: 'merged', remoteState: 'tracked', safety: 'strict-safe', cleanupEligible: true, blockerCodes: [] },
      ],
      pullRequests: [{ number: 12, title: 'Feature one', url: 'https://github.com/acme/alpha/pull/12', headRefName: 'feature/one', baseRefName: 'main', isDraft: false, reviewDecision: 'APPROVED', mergeStateStatus: 'CLEAN', hasLocalBranch: true, headSha: 'head-12', baseSha: 'base-12', checksSummary: { passed: 3, failed: 0, pending: 0 } }],
      issues: [], actionCapabilities: { sync: { enabled: true, label: 'Fast-forward eligible repositories', blockerCodes: [] }, prAgent: { enabled: true, label: 'Prepare merge with OpenCode' } },
    },
    {
      repoId: 'beta', repoPath: 'C:\\work\\beta', repoLabel: 'Beta', available: true, provider: 'unsupported', lastActivityMs: Date.now() - 15_000,
      sync: { branch: 'develop', upstream: null, clean: false, ahead: 0, behind: 0, remoteAvailable: false, syncEligible: false, blockerCodes: ['dirty-worktree', 'no-upstream'], issueCodes: ['dirty-worktree', 'no-upstream'] },
      branches: [], remoteBranches: [],
      entities: [{ id: 'local:experiment', kind: 'local-branch', branch: 'experiment', worktreePath: null, remoteName: null, observedSha: 'experiment-sha', observedDefaultSha: 'develop-sha', activityAt: '2026-08-02T10:00:00.000Z', localState: 'diverged', remoteState: 'none', safety: 'analysis-required', cleanupEligible: false, blockerCodes: ['analysis-required', 'dirty-worktree'] }],
      pullRequests: [], issues: [{ code: 'unsupported-provider', title: 'Provider not supported', message: 'Open PR reporting is not available for this remote.' }], actionCapabilities: { sync: { enabled: false, label: 'Fast-forward eligible repositories', blockerCodes: ['dirty-worktree'] }, prAgent: { enabled: false, label: 'Prepare merge with OpenCode', reason: 'GitHub is unavailable.' } },
    },
  ],
  entities: [],
};

describe('RepoOperationsView', () => {
  let openWorkspace: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    getRepoOperationsOverview.mockResolvedValue(overview);
    syncRepoOperations.mockResolvedValue({ ...actionResult, operation: 'sync' });
    fetchRepoOperations.mockResolvedValue(actionResult);
    analyzeRepoOperations.mockResolvedValue(analysisResult);
    cleanupRepoOperationEntities.mockResolvedValue({ ...actionResult, operation: 'cleanup' });
    cleanupRepoOperations.mockResolvedValue({ ...actionResult, operation: 'cleanup' });
    startRepoOperationsAgentRun.mockResolvedValue({ run: { id: 'run-12', status: 'awaiting-approval', repoId: 'alpha', repoLabel: 'Alpha', prNumber: 12, blockerCodes: [], proposedOperation: { kind: 'squash-merge' }, evidence: { summary: 'Clean merge candidate.' } } });
    getRepoOperationsAgentRun.mockResolvedValue({ id: 'run-12', status: 'awaiting-approval', repoId: 'alpha', repoLabel: 'Alpha', prNumber: 12, blockerCodes: [] });
    approveRepoOperationsAgentRun.mockResolvedValue({ id: 'run-12', status: 'completed', repoId: 'alpha', repoLabel: 'Alpha', prNumber: 12, blockerCodes: [] });
    cancelRepoOperationsAgentRun.mockResolvedValue({ id: 'run-12', status: 'cancelled', repoId: 'alpha', repoLabel: 'Alpha', prNumber: 12, blockerCodes: [] });
    openWorkspace = vi.spyOn(navigationStore, 'openWorkspace').mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    repoOperationsStore.reset();
    openWorkspace.mockRestore();
    vi.clearAllMocks();
  });

  it('orders repositories by recent activity and opens the selected repository workspace', async () => {
    getRepoOperationsOverview.mockResolvedValueOnce({ ...overview, repositories: [overview.repositories[1], overview.repositories[0]] });
    render(<RepoOperationsView />);
    await waitFor(() => expect(screen.getByTestId('repo-operations-view')).toBeInTheDocument());
    expect(screen.getAllByRole('button', { name: /Alpha|Beta/ }).map((button) => button.textContent)).toContain('Beta');
    const repositoryLinks = screen.getAllByRole('button', { name: /Alpha|Beta/ }).filter((button) => button.className.includes('repo-operations-repo-link'));
    expect(repositoryLinks.map((button) => button.textContent)).toEqual(['Beta', 'Alpha']);
    fireEvent.click(screen.getByRole('button', { name: 'Alpha' }));
    expect(openWorkspace).toHaveBeenCalledWith('C:\\work\\alpha', 'Alpha');
  });

  it('confirms explicit fetch/prune and keeps partial results visible', async () => {
    render(<RepoOperationsView />);
    await waitFor(() => expect(screen.getByTestId('repo-operations-view')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Fetch all remotes' }));
    expect(screen.getByText('This fetches and prunes local remote-tracking refs only. It does not update any checkout.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Fetch remotes' }));
    await waitFor(() => expect(fetchRepoOperations).toHaveBeenCalledWith({ confirmed: true }));
    expect(await screen.findByText('authentication failed', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('backup')).toBeInTheDocument();
    expect(screen.getByText('remote-unavailable')).toBeInTheDocument();
  });

  it('analyzes explicit branch selection before a stronger cleanup lane', async () => {
    render(<RepoOperationsView />);
    await waitFor(() => expect(screen.getByTestId('repo-operations-view')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Branches & worktrees' }));
    fireEvent.click(screen.getByLabelText('Select feature/one'));
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Analyze selected' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Analyze selected', exact: true })[1]);
    await waitFor(() => expect(analyzeRepoOperations).toHaveBeenCalledWith({ entities: [{ repoId: 'alpha', entityId: 'local:feature/one' }] }));
    expect(await screen.findByText(/analyzed safe · tree delta none · unique commits 2/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'feature/one' }));
    expect(screen.getByText('Cheap analysis report')).toBeInTheDocument();
    expect(screen.getByText('Safe to delete after fresh recheck')).toBeInTheDocument();
  });

  it('applies every declared operation filter and supports selecting every visible entity', async () => {
    render(<RepoOperationsView />);
    await waitFor(() => expect(screen.getByTestId('repo-operations-view')).toBeInTheDocument());
    const filter = screen.getByLabelText('Filter operation type');

    fireEvent.change(filter, { target: { value: 'sync-eligible' } });
    expect(screen.getByRole('button', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Beta' })).not.toBeInTheDocument();

    fireEvent.change(filter, { target: { value: 'branches' } });
    expect(screen.getByRole('button', { name: 'feature/one' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'experiment' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'main' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Select all visible entities'));
    expect(screen.getByText('2 selected')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter repositories and operations' }), { target: { value: 'feature/one' } });
    expect(screen.getByRole('button', { name: 'feature/one' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'experiment' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter repositories and operations' }), { target: { value: '' } });

    fireEvent.change(filter, { target: { value: 'pull-requests' } });
    expect(screen.getByText('#12 · Feature one')).toBeInTheDocument();
    expect(screen.queryByText('No open pull requests match this filter.')).not.toBeInTheDocument();
  });

  it('uses a bounded detail drawer with issue evidence and a workspace action', async () => {
    render(<RepoOperationsView />);
    await waitFor(() => expect(screen.getByTestId('repo-operations-view')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '3' }));
    const drawer = screen.getByRole('complementary', { name: 'Repository details' });
    expect(drawer).toHaveClass('repo-operations-detail-drawer');
    expect(screen.getByText('Provider not supported')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open workspace' }));
    expect(openWorkspace).toHaveBeenCalledWith('C:\\work\\beta', 'Beta');
  });

  it('starts a repository-scoped merge preparation and exposes a later approval', async () => {
    render(<RepoOperationsView />);
    await waitFor(() => expect(screen.getByTestId('repo-operations-view')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('repo-operations-prepare-alpha'));
    expect(screen.getByRole('dialog', { name: 'Choose a pull request for Alpha' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /#12.*Feature one.*Prepare/ }));
    await waitFor(() => expect(startRepoOperationsAgentRun).toHaveBeenCalledWith(expect.objectContaining({ repoId: 'alpha', prNumber: 12, targetBranch: 'main', observedHeadSha: 'head-12', observedBaseSha: 'base-12' })));
    fireEvent.click(screen.getByRole('button', { name: 'Agent runs' }));
    expect(screen.getByText('awaiting-approval')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Approve next step' }));
    await waitFor(() => expect(approveRepoOperationsAgentRun).toHaveBeenCalledWith('run-12'));
    fireEvent.click(screen.getByRole('button', { name: 'Repositories' }));
    fireEvent.click(screen.getByTestId('repo-operations-prepare-alpha'));
    fireEvent.click(screen.getByRole('button', { name: /#12.*Feature one.*Repair in isolated worktree/ }));
    await waitFor(() => expect(startRepoOperationsAgentRun).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'merge-repair', repoId: 'alpha', prNumber: 12 })));
  });

  it('renders an explicit scan error and a tab-specific empty state', async () => {
    getRepoOperationsOverview.mockRejectedValueOnce(new Error('scanner unavailable'));
    render(<RepoOperationsView />);
    await waitFor(() => expect(screen.getByTestId('repo-operations-error')).toBeInTheDocument());
    expect(screen.getByText('scanner unavailable')).toBeInTheDocument();
    cleanup(); repoOperationsStore.reset();
    getRepoOperationsOverview.mockResolvedValueOnce({ ...overview, repositories: [], summary: { ...overview.summary, trackedRepos: 0 } });
    render(<RepoOperationsView />);
    await waitFor(() => expect(screen.getByText('No repositories match this filter.')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Branches & worktrees' }));
    expect(screen.getByText('No branch or worktree entities match this filter.')).toBeInTheDocument();
  });
});
