import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock the workspace API module
const mockGetWorkspaceLaunchers = vi.fn();
const mockLaunchWorkspace = vi.fn();

vi.mock('../ui/src/lib/api/workspace', () => ({
  getWorkspaceLaunchers: mockGetWorkspaceLaunchers,
  launchWorkspace: mockLaunchWorkspace,
}));

// Mock notificationStore so it doesn't throw
vi.mock('../ui/src/stores/notificationStore', () => ({
  notificationStore: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
}));

describe('WorkspaceActiveRepoCard launcher UI', () => {
  const repoPath = 'C:/repos/my-repo';

  const defaultProps = {
    repo: { repoLabel: 'my-org/my-repo', repoPath, repoId: 'repo-1', sourceId: 'local', sourceLabel: 'Local', scanRoot: 'C:/repos' },
    repoPath,
    summary: null,
    pullRequest: null,
    verificationState: 'verified' as const,
    changeCount: 0,
    onSwitchRepo: vi.fn(),
    showRepoSelector: false,
  };

  const sampleLaunchers = [
    { id: 'vscode', label: 'VS Code', group: 'ides', command: 'code', available: true, argsPreview: '<repo-path>' },
    { id: 'cursor', label: 'Cursor', group: 'ides', command: 'cursor', available: false, reason: 'not found', argsPreview: '<repo-path>' },
    { id: 'opencode', label: 'OpenCode CLI', group: 'agents', command: 'opencode', available: true, argsPreview: 'opencode .' },
    { id: 'codex', label: 'Codex CLI', group: 'agents', command: 'codex', available: false, reason: 'not found', argsPreview: 'codex' },
    { id: 'terminal', label: 'Terminal', group: 'terminals', command: 'terminal', available: true, argsPreview: '-NoExit -WorkingDirectory <repo-path>' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWorkspaceLaunchers.mockResolvedValue({ launchers: sampleLaunchers });
    mockLaunchWorkspace.mockResolvedValue({ ok: true, launcherId: 'opencode', repoPath });
    localStorage.removeItem('elegy-copilot-last-workspace-launcher');
  });

  it('renders the launch trigger as an icon button with accessible name and title', async () => {
    const { default: WorkspaceActiveRepoCard } = await import('../ui/src/views/Workspace/WorkspaceActiveRepoCard');
    render(<WorkspaceActiveRepoCard {...defaultProps} />);

    await waitFor(() => {
      expect(mockGetWorkspaceLaunchers).toHaveBeenCalled();
    });

    const trigger = screen.getByTestId('workspace-launch-trigger');
    expect(trigger).toBeInTheDocument();
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger).toHaveAttribute('aria-label', 'Open in');
    expect(trigger).toHaveAttribute('title', 'Open in');
    // Should contain the icon and chevron spans
    expect(trigger.querySelector('.workspace-launch-trigger-icon')).toBeInTheDocument();
    expect(trigger.querySelector('.workspace-launch-trigger-chevron')).toBeInTheDocument();
    // Should NOT contain a teal primary button class
    expect(trigger).not.toHaveClass('btn-primary');
  });

  it('opens menu on click and shows group labels, icons, and launcher labels', async () => {
    const { default: WorkspaceActiveRepoCard } = await import('../ui/src/views/Workspace/WorkspaceActiveRepoCard');
    render(<WorkspaceActiveRepoCard {...defaultProps} />);

    await waitFor(() => {
      expect(mockGetWorkspaceLaunchers).toHaveBeenCalled();
    });

    // Click the trigger to open menu
    const trigger = screen.getByTestId('workspace-launch-trigger');
    fireEvent.click(trigger);

    // Menu should be visible
    const menu = screen.getByTestId('workspace-launch-menu');
    expect(menu).toBeInTheDocument();

    // Group labels
    expect(screen.getByText('IDEs')).toBeInTheDocument();
    expect(screen.getByText('Agent CLIs')).toBeInTheDocument();
    expect(screen.getByText('Terminals')).toBeInTheDocument();

    // Launcher items with test ids
    expect(screen.getByTestId('workspace-launch-vscode')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-launch-opencode')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-launch-terminal')).toBeInTheDocument();

    // Available items should have labels
    expect(screen.getByText('VS Code')).toBeInTheDocument();
    expect(screen.getByText('OpenCode CLI')).toBeInTheDocument();
    expect(screen.getByText('Terminal')).toBeInTheDocument();

    // Icons should be present inside menu items (icon spans with aria-hidden)
    const icons = screen.getAllByText(/\u25C8|\u26A1|>_/);
    expect(icons.length).toBeGreaterThan(0);
  });

  it('clicking workspace-launch-opencode calls launchWorkspace with opencode and repoPath', async () => {
    const { default: WorkspaceActiveRepoCard } = await import('../ui/src/views/Workspace/WorkspaceActiveRepoCard');
    render(<WorkspaceActiveRepoCard {...defaultProps} />);

    await waitFor(() => {
      expect(mockGetWorkspaceLaunchers).toHaveBeenCalled();
    });

    // Open menu
    fireEvent.click(screen.getByTestId('workspace-launch-trigger'));

    // Click the OpenCode CLI item
    const opencodeItem = screen.getByTestId('workspace-launch-opencode');
    fireEvent.click(opencodeItem);

    await waitFor(() => {
      expect(mockLaunchWorkspace).toHaveBeenCalledWith('opencode', repoPath);
    });
  });

  it('disabled launcher items cannot be clicked', async () => {
    const { default: WorkspaceActiveRepoCard } = await import('../ui/src/views/Workspace/WorkspaceActiveRepoCard');
    render(<WorkspaceActiveRepoCard {...defaultProps} />);

    await waitFor(() => {
      expect(mockGetWorkspaceLaunchers).toHaveBeenCalled();
    });

    // Open menu
    fireEvent.click(screen.getByTestId('workspace-launch-trigger'));

    // Cursor should be disabled (not available)
    const cursorItem = screen.getByTestId('workspace-launch-cursor');
    expect(cursorItem).toBeDisabled();
    expect(cursorItem).toHaveAttribute('title', 'not found');

    // Codex should also be disabled
    const codexItem = screen.getByTestId('workspace-launch-codex');
    expect(codexItem).toBeDisabled();
  });

  it('closes menu after clicking a launcher item', async () => {
    const { default: WorkspaceActiveRepoCard } = await import('../ui/src/views/Workspace/WorkspaceActiveRepoCard');
    render(<WorkspaceActiveRepoCard {...defaultProps} />);

    await waitFor(() => {
      expect(mockGetWorkspaceLaunchers).toHaveBeenCalled();
    });

    // Open menu
    fireEvent.click(screen.getByTestId('workspace-launch-trigger'));
    expect(screen.getByTestId('workspace-launch-menu')).toBeInTheDocument();

    // Click a launcher
    fireEvent.click(screen.getByTestId('workspace-launch-terminal'));

    // Menu should close
    await waitFor(() => {
      expect(screen.queryByTestId('workspace-launch-menu')).not.toBeInTheDocument();
    });
  });

  it('trigger is disabled when no launchers are available', async () => {
    mockGetWorkspaceLaunchers.mockResolvedValue({
      launchers: [
        { id: 'vscode', label: 'VS Code', group: 'ides', command: 'code', available: false, reason: 'not found', argsPreview: '<repo-path>' },
        { id: 'terminal', label: 'Terminal', group: 'terminals', command: 'terminal', available: false, reason: 'unavailable', argsPreview: '' },
      ],
    });

    const { default: WorkspaceActiveRepoCard } = await import('../ui/src/views/Workspace/WorkspaceActiveRepoCard');
    render(<WorkspaceActiveRepoCard {...defaultProps} />);

    await waitFor(() => {
      expect(mockGetWorkspaceLaunchers).toHaveBeenCalled();
    });

    const trigger = screen.getByTestId('workspace-launch-trigger');
    expect(trigger).toBeDisabled();
  });

  it('shows argsPreview text for launchers that have it', async () => {
    const { default: WorkspaceActiveRepoCard } = await import('../ui/src/views/Workspace/WorkspaceActiveRepoCard');
    render(<WorkspaceActiveRepoCard {...defaultProps} />);

    await waitFor(() => {
      expect(mockGetWorkspaceLaunchers).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByTestId('workspace-launch-trigger'));

    // OpenCode should show its argsPreview
    const opencodeItem = screen.getByTestId('workspace-launch-opencode');
    expect(opencodeItem.querySelector('.workspace-launch-menu-item-args')).toHaveTextContent('opencode .');
  });

  it('shows first available launcher icon as default trigger icon', async () => {
    const { default: WorkspaceActiveRepoCard } = await import('../ui/src/views/Workspace/WorkspaceActiveRepoCard');
    render(<WorkspaceActiveRepoCard {...defaultProps} />);
    // Wait for launchers to be fetched AND component to re-render
    await waitFor(() => {
      const trigger = screen.getByTestId('workspace-launch-trigger');
      const icon = trigger.querySelector('.workspace-launch-trigger-icon');
      expect(icon).toBeInTheDocument();
      // First available launcher is 'vscode' (group: ides → ◈ icon)
      expect(icon!.textContent).toContain('\u25C8');
    });
  });

  it('persists last successful launcher ID in localStorage', async () => {
    // Clear any existing persisted launcher
    localStorage.removeItem('elegy-copilot-last-workspace-launcher');
    const { default: WorkspaceActiveRepoCard } = await import('../ui/src/views/Workspace/WorkspaceActiveRepoCard');
    const { unmount } = render(<WorkspaceActiveRepoCard {...defaultProps} />);
    await waitFor(() => { expect(mockGetWorkspaceLaunchers).toHaveBeenCalled(); });
    
    // Launch 'terminal' launcher
    fireEvent.click(screen.getByTestId('workspace-launch-trigger'));
    fireEvent.click(screen.getByTestId('workspace-launch-terminal'));
    await waitFor(() => { expect(mockLaunchWorkspace).toHaveBeenCalledWith('terminal', repoPath); });
    
    expect(localStorage.getItem('elegy-copilot-last-workspace-launcher')).toBe('terminal');
    unmount();
  });
});
