import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { navigationStore } from '../ui/src/stores/navigation';
import { projectOverviewStore } from '../ui/src/views/Project/projectOverviewStore';
import { projectsListStore } from '../ui/src/views/Project/projectsListStore';

const apiMocks = vi.hoisted(() => ({
  listProjects: vi.fn(),
  listProjectSessions: vi.fn(),
  listProjectActivity: vi.fn(),
  getGitSummary: vi.fn(),
  getGitStatus: vi.fn(),
  getGitLog: vi.fn(),
  getGitBranches: vi.fn(),
  getGitPullRequest: vi.fn(),
  getGitDiff: vi.fn(),
  stageGitFiles: vi.fn(),
  unstageGitFiles: vi.fn(),
  commitGit: vi.fn(),
  pullGit: vi.fn(),
  pushGit: vi.fn(),
  checkoutGitBranch: vi.fn(),
  createGitPullRequest: vi.fn(),
  updateProject: vi.fn(),
}));

vi.mock('../ui/src/lib/api', async () => {
  const actual = await vi.importActual('../ui/src/lib/api');
  return {
    ...actual,
    listProjects: apiMocks.listProjects,
    listProjectSessions: apiMocks.listProjectSessions,
    listProjectActivity: apiMocks.listProjectActivity,
    getGitSummary: apiMocks.getGitSummary,
    getGitStatus: apiMocks.getGitStatus,
    getGitLog: apiMocks.getGitLog,
    getGitBranches: apiMocks.getGitBranches,
    getGitPullRequest: apiMocks.getGitPullRequest,
    getGitDiff: apiMocks.getGitDiff,
    stageGitFiles: apiMocks.stageGitFiles,
    unstageGitFiles: apiMocks.unstageGitFiles,
    commitGit: apiMocks.commitGit,
    pullGit: apiMocks.pullGit,
    pushGit: apiMocks.pushGit,
    checkoutGitBranch: apiMocks.checkoutGitBranch,
    createGitPullRequest: apiMocks.createGitPullRequest,
    updateProject: apiMocks.updateProject,
  };
});

describe('Project views', () => {
  beforeEach(() => {
    navigationStore.reset();
    projectOverviewStore.reset();
    projectsListStore.reset();
    Object.values(apiMocks).forEach((mock) => mock.mockReset());

    apiMocks.listProjects.mockResolvedValue([
      {
        projectId: 'repo-1',
        repoId: 'repo-1',
        repoPath: 'C:/repos/repo-1',
        repoLabel: 'Repo One',
        canonicalRemote: 'owner/repo-1',
        pinned: true,
        lastActivityMs: Date.now() - 60_000,
        sessionCount: 2,
        activeSessionCount: 1,
        installedAssetSummary: { agents: 1, skills: 2 },
      },
    ]);
    apiMocks.listProjectSessions.mockResolvedValue([
      {
        id: 'sess-1',
        title: 'Ship Git tab',
        status: 'active',
        source: 'cli',
        startedAtMs: Date.now() - 3600_000,
        updatedAtMs: Date.now() - 30_000,
        elapsedMs: 3570_000,
      },
    ]);
    apiMocks.listProjectActivity.mockResolvedValue([
      { type: 'session', timestamp: Date.now() - 30_000, summary: 'Session sess-1 [active]' },
    ]);
    apiMocks.getGitSummary.mockResolvedValue({
      branch: 'feature/git-panel',
      clean: false,
      changedFiles: 3,
      stagedFiles: 1,
      additions: 15,
      deletions: 4,
      ahead: 2,
      behind: 0,
      upstream: 'origin/feature/git-panel',
      remoteName: 'origin',
      remoteLabel: 'owner/repo-1',
      hasRemote: true,
      pullRequest: { number: 42, url: 'https://github.com/owner/repo-1/pull/42', state: 'OPEN' },
    });
    apiMocks.getGitStatus.mockResolvedValue({
      branch: 'feature/git-panel',
      files: [{ status: ' M', path: 'src/App.tsx' }],
      clean: false,
      stagedCount: 1,
      unstagedCount: 1,
      ahead: 2,
      behind: 0,
      upstream: 'origin/feature/git-panel',
      remoteName: 'origin',
    });
    apiMocks.getGitLog.mockResolvedValue({
      commits: [{ hash: 'abc1234', message: 'Add project git panel' }],
    });
    apiMocks.getGitBranches.mockResolvedValue({
      currentBranch: 'feature/git-panel',
      branches: [
        { name: 'feature/git-panel', current: true, remote: false, upstream: 'origin/feature/git-panel' },
        { name: 'main', current: false, remote: false, upstream: 'origin/main' },
      ],
    });
    apiMocks.getGitPullRequest.mockResolvedValue({
      available: true,
      tool: 'gh',
      authenticated: true,
      pullRequest: { number: 42, url: 'https://github.com/owner/repo-1/pull/42', state: 'OPEN' },
    });
    apiMocks.getGitDiff.mockResolvedValue({ diff: 'diff --git a/src/App.tsx b/src/App.tsx', staged: false });
    apiMocks.pullGit.mockResolvedValue({ pulled: true, output: 'Already up to date.' });
    apiMocks.pushGit.mockResolvedValue({ pushed: true, output: 'Done' });
    apiMocks.checkoutGitBranch.mockResolvedValue({ checkedOut: true, branch: 'main' });
    apiMocks.createGitPullRequest.mockResolvedValue({
      created: true,
      pullRequest: { number: 42, url: 'https://github.com/owner/repo-1/pull/42', state: 'OPEN' },
    });
    apiMocks.updateProject.mockResolvedValue({ pinned: true });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { sessionId: 'sess-1', projectId: 'repo-1', status: 'active' },
      ],
    }));
  });

  it('renders tracked projects with git summary badges', async () => {
    const { default: ProjectsListView } = await import('../ui/src/views/Project/ProjectsListView');

    render(<ProjectsListView />);

    await waitFor(() => {
      expect(screen.getByTestId('project-card-repo-1')).toBeInTheDocument();
    });

    expect(screen.getByText('Repo One')).toBeInTheDocument();
    expect(screen.getByText('feature/git-panel')).toBeInTheDocument();
    expect(screen.getByText('PR #42')).toBeInTheDocument();
  });

  it('renders the project git tab and repo actions', async () => {
    navigationStore.selectProject('repo-1', 'git');
    const { default: ProjectOverview } = await import('../ui/src/views/Project/ProjectOverview');

    render(<ProjectOverview />);

    await waitFor(() => {
      expect(screen.getByTestId('project-git-panel')).toBeInTheDocument();
    });

    expect(screen.getByTestId('git-panel-branch')).toHaveTextContent('feature/git-panel');
    expect(screen.getByTestId('git-panel-pull')).toBeInTheDocument();
    expect(screen.getByTestId('git-panel-push')).toBeInTheDocument();
    expect(screen.getByTestId('git-panel-pr-summary')).toHaveTextContent('#42');
  });

  it('switches to the git tab from project overview navigation', async () => {
    navigationStore.selectProject('repo-1', 'overview');
    const { default: ProjectOverview } = await import('../ui/src/views/Project/ProjectOverview');

    render(<ProjectOverview />);

    await waitFor(() => {
      expect(screen.getByTestId('project-tab-git')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('project-tab-git'));

    await waitFor(() => {
      expect(navigationStore.getState().projectSubView).toBe('git');
    });
  });
});
