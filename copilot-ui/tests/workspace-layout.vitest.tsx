import { fireEvent, render, screen, act, waitFor } from '@testing-library/react';
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
    openWorkspaces: [{ repoPath: '/test/repo', repoLabel: 'Open Workspace Label', openedAt: 1 }],
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
  getWorkspaceLaunchers: vi.fn().mockResolvedValue({ launchers: [
    { id: 'vscode', label: 'Visual Studio Code', group: 'ides', available: true },
  ] }),
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

  it('renders persistent workspace identity above labeled tabs', async () => {
    const { default: WorkspaceView } = await import('../ui/src/views/Workspace/WorkspaceView');

    await act(async () => {
      render(<WorkspaceView />);
    });

    const header = screen.getByTestId('workspace-context-header');
    const tabs = screen.getByTestId('workspace-local-tabs-row');
    expect(header).toHaveTextContent('Open Workspace Label');
    expect(header).toHaveTextContent('/test/repo');
    expect(header.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('links the active tab to a stable tabpanel', async () => {
    const { default: WorkspaceView } = await import('../ui/src/views/Workspace/WorkspaceView');
    await act(async () => { render(<WorkspaceView />); });

    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('id', 'workspace-panel-docs');
    expect(panel).toHaveAttribute('aria-labelledby', 'workspace-tab-docs');
  });

  it('opens the launcher menu in light theme with real menu content', async () => {
    document.documentElement.dataset.theme = 'light';
    const { getWorkspaceLaunchers } = await import('../ui/src/lib/api/workspace');
    vi.mocked(getWorkspaceLaunchers).mockResolvedValue({ launchers: [
      { id: 'vscode', label: 'Visual Studio Code', group: 'ides', available: true },
    ] } as any);
    const { default: WorkspaceView } = await import('../ui/src/views/Workspace/WorkspaceView');
    await act(async () => { render(<WorkspaceView />); });

    const trigger = await screen.findByRole('button', { name: 'Open in...' });
    await waitFor(() => expect(trigger).not.toBeDisabled());
    fireEvent.click(trigger);
    expect(screen.getByTestId('workspace-launch-menu')).toBeInTheDocument();
    expect(screen.getByText('Visual Studio Code')).toBeInTheDocument();
  });
});
