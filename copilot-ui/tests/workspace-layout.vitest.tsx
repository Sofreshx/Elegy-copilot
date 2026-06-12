import { render, screen, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../ui/src/lib/store', () => {
  const repoState = {
    repos: [{ repoPath: '/test/repo', repoLabel: 'Test Repo', repoId: 'test-id' }],
    selectedRepo: { repoPath: '/test/repo', repoLabel: 'Test Repo', repoId: 'test-id' },
    loading: false,
    error: null,
    searchQuery: '',
  };

  const gitState = {
    summary: null,
    pullRequest: null,
    error: null,
  };

  const navState = {
    activeWorkspaceId: '/test/repo',
    activeWorkspaceLocalTab: 'docs',
    openWorkspaces: [],
  };

  return {
    useStoreValue: vi.fn((store: any) => {
      // Return appropriate state based on which store is queried
      if (store.repos) return repoState;       // repositoriesStore
      if (store.summary !== undefined || store.pullRequest !== undefined) return gitState; // gitStore
      if (store.activeWorkspaceId !== undefined) return navState; // navigationStore
      return {};
    }),
    createStore: vi.fn((initialState: any) => ({
      getState: () => initialState,
      setState: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
    })),
  };
});

vi.mock('../ui/src/stores/navigation', () => ({
  navigationStore: {
    activeWorkspaceId: '/test/repo',
    activeWorkspaceLocalTab: 'docs',
    openWorkspaces: [],
    setActiveWorkspaceLocalTab: vi.fn(),
    openWorkspace: vi.fn(),
  },
}));

vi.mock('../ui/src/stores/notificationStore', () => ({
  notificationStore: { error: vi.fn() },
}));

vi.mock('../ui/src/views/Repositories/repositoriesStore', () => ({
  repositoriesStore: {
    repos: [{ repoPath: '/test/repo', repoLabel: 'Test Repo', repoId: 'test-id' }],
    selectedRepo: { repoPath: '/test/repo', repoLabel: 'Test Repo', repoId: 'test-id' },
    loading: false,
    error: null,
    searchQuery: '',
    loadInventory: vi.fn(),
    reset: vi.fn(),
    selectRepo: vi.fn(),
    setSearchQuery: vi.fn(),
  },
}));

vi.mock('../ui/src/stores/gitStore', () => ({
  gitStore: {
    summary: null,
    pullRequest: null,
    error: null,
    loadStatus: vi.fn(),
    commit: vi.fn(),
    push: vi.fn(),
    createPullRequest: vi.fn(),
    setCommitMessage: vi.fn(),
    setPullRequestTitle: vi.fn(),
    setPullRequestBody: vi.fn(),
  },
}));

vi.mock('../ui/src/lib/api/workspace', () => ({
  getWorkspaceLaunchers: vi.fn().mockResolvedValue({ launchers: [] }),
  launchWorkspace: vi.fn(),
}));

vi.mock('../ui/src/views/Repositories/GitHubAuthBanner', () => ({
  default: () => null,
}));

describe('WorkspaceView layout contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders local tabs row outside workspace-tab-content', async () => {
    const { default: WorkspaceView } = await import('../ui/src/views/Workspace/WorkspaceView');

    await act(async () => {
      render(<WorkspaceView />);
    });

    const tabsRow = screen.getByTestId('workspace-local-tabs-row');
    const tabContent = screen.getByTestId('workspace-tab-content');

    // Tabs row should NOT be inside the tab content area
    expect(tabContent.contains(tabsRow)).toBe(false);
  });

  it('renders workspace-tab-content as a view-scroll region', async () => {
    const { default: WorkspaceView } = await import('../ui/src/views/Workspace/WorkspaceView');

    await act(async () => {
      render(<WorkspaceView />);
    });

    const tabContent = screen.getByTestId('workspace-tab-content');
    expect(tabContent).toBeInTheDocument();
    expect(tabContent.className).toContain('view-scroll');
  });
});
