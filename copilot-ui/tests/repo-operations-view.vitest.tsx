import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const {
  getRepoOperationsOverview,
  syncRepoOperations,
  startRepoOperationsAgentRun,
  approveRepoOperationsAgentRun,
  cancelRepoOperationsAgentRun,
} = vi.hoisted(() => ({
  getRepoOperationsOverview: vi.fn(),
  syncRepoOperations: vi.fn(),
  startRepoOperationsAgentRun: vi.fn(),
  approveRepoOperationsAgentRun: vi.fn(),
  cancelRepoOperationsAgentRun: vi.fn(),
}));

vi.mock('../ui/src/lib/api/repoOperations', () => ({
  getRepoOperationsOverview,
  syncRepoOperations,
  startRepoOperationsAgentRun,
  approveRepoOperationsAgentRun,
  cancelRepoOperationsAgentRun,
}));

import RepoOperationsView from '../ui/src/views/RepoOperations/RepoOperationsView';
import { repoOperationsStore } from '../ui/src/views/RepoOperations/repoOperationsStore';

const overview = {
  schemaVersion: 2,
  contractVersion: 'repo-operations.overview.v2',
  generatedAt: '2026-08-03T10:00:00.000Z',
  summary: {
    trackedRepos: 2,
    reposNeedingAttention: 1,
    syncIssues: 1,
    staleBranches: 1,
    openPullRequests: 1,
  },
  warnings: [],
  capabilities: {
    sync: { enabled: true, label: 'Sync eligible repositories', reason: 'Explicit confirmation required.' },
    branchCleanup: { enabled: false, label: 'Prepare branch cleanup', reason: 'Preparation and approval support is planned.' },
    pullRequestHandling: { enabled: false, label: 'Prepare PR handling', scope: 'per-repository', reason: 'PR handling is per repository.' },
    prAgent: { enabled: true, label: 'Prepare merge with OpenCode', model: 'opencode-go/deepseek-v4-flash' },
  },
  activeRuns: [],
  repositories: [
    {
      repoId: 'alpha',
      repoPath: 'C:\\work\\alpha',
      repoLabel: 'Alpha',
      available: true,
      provider: 'github',
      sync: {
        branch: 'main',
        upstream: 'origin/main',
        clean: true,
        ahead: 0,
        behind: 0,
        remoteAvailable: true,
        syncEligible: true,
        blockerCodes: [],
        issueCodes: [],
      },
      branches: [
        { name: 'main', upstream: 'origin/main', state: 'default', worktree: 'C:\\work\\alpha', issueCodes: [] },
        { name: 'feature/one', upstream: 'origin/feature/one', state: 'merged', worktree: null, issueCodes: ['merged'] },
      ],
      pullRequests: [
        {
          number: 12,
          title: 'Feature one',
          url: 'https://github.com/acme/alpha/pull/12',
          headRefName: 'feature/one',
          baseRefName: 'main',
          isDraft: false,
          reviewDecision: 'APPROVED',
          mergeStateStatus: 'CLEAN',
          hasLocalBranch: true,
          headSha: 'head-12',
          baseSha: 'base-12',
          checksSummary: { passed: 3, failed: 0, pending: 0 },
        },
      ],
      issues: [],
      actionCapabilities: {
        sync: { enabled: true, label: 'Sync eligible repositories', blockerCodes: [] },
        prAgent: { enabled: true, label: 'Prepare merge with OpenCode', model: 'opencode-go/deepseek-v4-flash' },
      },
    },
    {
      repoId: 'beta',
      repoPath: 'C:\\work\\beta',
      repoLabel: 'Beta',
      available: true,
      provider: 'unsupported',
      sync: {
        branch: 'develop',
        upstream: null,
        clean: false,
        ahead: 0,
        behind: 0,
        remoteAvailable: false,
        syncEligible: false,
        blockerCodes: ['dirty-worktree', 'no-upstream', 'remote-unavailable'],
        issueCodes: ['dirty-worktree', 'no-upstream'],
      },
      branches: [],
      pullRequests: [],
      issues: [{ code: 'unsupported-provider', message: 'Open PR reporting is not available for this remote.' }],
      actionCapabilities: {
        sync: { enabled: false, label: 'Sync eligible repositories', blockerCodes: ['dirty-worktree', 'no-upstream', 'remote-unavailable'] },
        prAgent: { enabled: false, label: 'Prepare merge with OpenCode', reason: 'GitHub is unavailable.' },
      },
    },
  ],
};

describe('RepoOperationsView', () => {
  beforeEach(() => {
    getRepoOperationsOverview.mockResolvedValue(overview);
    syncRepoOperations.mockResolvedValue({
      contractVersion: 'repo-operations.action.v2',
      operation: 'sync',
      summary: { requested: 2, eligible: 1, synced: 1, unchanged: 0, skipped: 1, failed: 0 },
      repositories: [],
    });
    startRepoOperationsAgentRun.mockResolvedValue({
      run: {
        id: 'run-12',
        status: 'awaiting-approval',
        repoId: 'alpha',
        repoLabel: 'Alpha',
        prNumber: 12,
        blockerCodes: [],
        proposedOperation: { kind: 'squash-merge', pullRequest: 12 },
        evidence: { summary: 'Clean merge candidate.' },
      },
    });
    approveRepoOperationsAgentRun.mockResolvedValue({
      id: 'run-12',
      status: 'completed',
      repoId: 'alpha',
      prNumber: 12,
      blockerCodes: [],
    });
    cancelRepoOperationsAgentRun.mockResolvedValue({
      id: 'run-12',
      status: 'cancelled',
      repoId: 'alpha',
      prNumber: 12,
      blockerCodes: [],
    });
  });

  afterEach(() => {
    cleanup();
    repoOperationsStore.reset();
    vi.clearAllMocks();
  });

  it('loads the aggregate view, confirms safe sync, and keeps unsafe actions disabled', async () => {
    render(<RepoOperationsView />);

    expect(screen.getByTestId('repo-operations-loading')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('repo-operations-view')).toBeInTheDocument());
    expect(screen.getAllByText('Alpha').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Beta').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /Feature one/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sync eligible repositories' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Prepare branch cleanup' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Prepare PR handling' })).not.toBeInTheDocument();
    expect(screen.getByTestId('repo-operations-prepare-alpha')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Sync eligible repositories' }));
    expect(screen.getByRole('dialog', { name: 'Confirm repository sync' })).toBeInTheDocument();
    expect(screen.getByText(/1 eligible repository/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm sync' }));
    await waitFor(() => expect(syncRepoOperations).toHaveBeenCalledWith({ confirmed: true }));
    await waitFor(() => expect(getRepoOperationsOverview).toHaveBeenCalledTimes(2));

    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter repositories and operations' }), {
      target: { value: 'Beta' },
    });
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.queryByText('Feature one')).not.toBeInTheDocument();
  });

  it('opens a repository-scoped PR picker and exposes approval/cancel states', async () => {
    render(<RepoOperationsView />);
    await waitFor(() => expect(screen.getByTestId('repo-operations-view')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('repo-operations-prepare-alpha'));
    expect(screen.getByRole('dialog', { name: 'Choose a pull request for Alpha' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /#12.*Feature one/ }));
    await waitFor(() => expect(startRepoOperationsAgentRun).toHaveBeenCalledWith(expect.objectContaining({
      repoId: 'alpha',
      prNumber: 12,
      targetBranch: 'main',
      observedHeadSha: 'head-12',
      observedBaseSha: 'base-12',
    })));
    expect(screen.getByText(/awaiting-approval/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Approve squash merge' }));
    await waitFor(() => expect(approveRepoOperationsAgentRun).toHaveBeenCalledWith('run-12'));
  });

  it('cancels a repository-scoped preparation run without a global action', async () => {
    render(<RepoOperationsView />);
    await waitFor(() => expect(screen.getByTestId('repo-operations-view')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('repo-operations-prepare-alpha'));
    fireEvent.click(screen.getByRole('button', { name: /#12.*Feature one/ }));
    await waitFor(() => expect(screen.getByText(/awaiting-approval/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel run' }));
    await waitFor(() => expect(cancelRepoOperationsAgentRun).toHaveBeenCalledWith('run-12'));
  });

  it('refreshes explicitly and exposes a partial-result warning', async () => {
    render(<RepoOperationsView />);
    await waitFor(() => expect(screen.getByTestId('repo-operations-view')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Refresh all' }));
    await waitFor(() => expect(getRepoOperationsOverview).toHaveBeenCalledTimes(2));

    act(() => {
      repoOperationsStore.setState((state) => ({
        ...state,
        overview: { ...overview, warnings: ['One repository could not be inspected.'] },
      }));
    });
    expect(screen.getByText('One repository could not be inspected.')).toBeInTheDocument();
  });

  it('shows the error state when the scan fails', async () => {
    getRepoOperationsOverview.mockRejectedValueOnce(new Error('scanner unavailable'));
    render(<RepoOperationsView />);
    await waitFor(() => expect(screen.getByTestId('repo-operations-error')).toBeInTheDocument());
    expect(screen.getByText('scanner unavailable')).toBeInTheDocument();
  });

  it('renders an explicit empty state while preserving responsive table containers', async () => {
    getRepoOperationsOverview.mockResolvedValueOnce({
      ...overview,
      summary: { trackedRepos: 0, reposNeedingAttention: 0, syncIssues: 0, staleBranches: 0, openPullRequests: 0 },
      repositories: [],
    });
    render(<RepoOperationsView />);
    await waitFor(() => expect(screen.getByTestId('repo-operations-view')).toBeInTheDocument());
    expect(screen.getByText('No repositories match this filter.')).toBeInTheDocument();
    expect(screen.getByText('No local branches match this filter.')).toBeInTheDocument();
    expect(screen.getByText('No open GitHub pull requests match this filter.')).toBeInTheDocument();
    expect(document.querySelectorAll('.repo-operations-table-wrap').length).toBe(3);
  });
});
