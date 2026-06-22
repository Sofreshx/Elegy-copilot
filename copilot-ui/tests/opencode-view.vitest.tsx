import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenCodeStatusResponse } from '../ui/src/lib/types';
import { opencodeStore } from '../ui/src/stores/opencodeStore';

const mockStatus: OpenCodeStatusResponse = {
  overallStatus: 'ready',
  warnings: [],
  setupChecks: [
    { id: 'opencode-config', label: 'OpenCode config readable', status: 'ok', detail: '/path/to/config', action: null },
    { id: 'elegy-planning-cli', label: 'elegy-planning CLI', status: 'ok', detail: 'CLI available', action: null },
    { id: 'project-lane', label: 'Project lane ready', status: 'ok', detail: 'All good', action: null },
  ],
  activeProfileId: 'opencode-go',
  effectiveProfileId: 'opencode-go',
  selectedProfileId: 'opencode-go',
  profiles: [
    { id: 'opencode-go', label: 'OpenCode Go', description: 'Default route', route: 'opencode-go', smallModel: 'DeepSeek V4 Flash Max', bigModel: 'DeepSeek V4 Pro Max', reviewModel: 'DeepSeek V4 Pro High' },
    { id: 'deepseek-direct', label: 'Direct DeepSeek', description: 'Direct route', route: 'deepseek-direct', smallModel: 'DeepSeek V4 Flash Max', bigModel: 'DeepSeek V4 Pro Max', reviewModel: 'DeepSeek V4 Pro High' },
  ],
  availableRoutes: ['opencode-go', 'deepseek-direct'],
  lanes: [
    {
      id: 'quick',
      label: 'Quick',
      description: 'Fast, focused implementation with optional review',
      nodes: [
        { id: 'user-request', label: 'User Request', kind: 'start' },
        { id: 'implementation', label: 'Implementation', kind: 'action' },
      ],
      edges: [{ from: 'user-request', to: 'implementation', label: 'route' }],
      modelPolicy: { small: 'Flash Max', big: null, review: null },
      requiredSetup: ['opencode-config'],
      clarificationGates: [],
      worktreeBehavior: null,
      escalationTriggers: [],
    },
    {
      id: 'project',
      label: 'Project',
      description: 'Full project life cycle via Elegy Planning graph, worktrees, and evidence',
      nodes: [
        { id: 'user-request', label: 'User Request', kind: 'start' },
        { id: 'implementation', label: 'Implementation', kind: 'action' },
      ],
      edges: [{ from: 'user-request', to: 'implementation', label: 'route' }],
      modelPolicy: { small: 'Flash Max', big: 'Pro Max', review: 'Pro High' },
      requiredSetup: ['opencode-config', 'elegy-planning-cli', 'worktree-plugin'],
      clarificationGates: ['goal-definition'],
      worktreeBehavior: 'git worktree isolation',
      escalationTriggers: ['planning-graph-unavailable'],
    },
    {
      id: 'runner',
      label: 'Runner',
      description: 'Execute a text plan via sub-agents with full review gates.',
      nodes: [
        { id: 'user-request', label: 'User Request', kind: 'start' },
        { id: 'implementation', label: 'Implementation', kind: 'action' },
      ],
      edges: [{ from: 'user-request', to: 'implementation', label: 'route' }],
      modelPolicy: { small: 'Flash Max', big: 'Pro Max', review: 'Pro High' },
      requiredSetup: ['opencode-config'],
      clarificationGates: [],
      worktreeBehavior: null,
      escalationTriggers: [],
    },
    {
      id: 'runner-flash',
      label: 'Runner Flash',
      description: 'Same as Runner but uses Flash implementation model.',
      nodes: [
        { id: 'user-request', label: 'User Request', kind: 'start' },
        { id: 'implementation', label: 'Implementation', kind: 'action' },
      ],
      edges: [{ from: 'user-request', to: 'implementation', label: 'route' }],
      modelPolicy: { small: 'Flash Max', big: 'Pro Max', review: 'Pro High' },
      requiredSetup: ['opencode-config'],
      clarificationGates: [],
      worktreeBehavior: null,
      escalationTriggers: [],
    },
  ],
  configPreview: { provider: { route: 'opencode-go' } },
  opencodeHome: '/home/user/.config/opencode',
  configPath: '/home/user/.config/opencode/opencode.jsonc',
  smallModel: 'DeepSeek V4 Flash Max',
  bigModel: 'DeepSeek V4 Pro Max',
  isCustomConfig: false,
  elegyPlanningCli: { cliPath: '/usr/local/bin/elegy-planning', currentVersion: '1.0.0', canUpdate: true },
  elegySkillsAssets: { trackedCount: 3, outdatedCount: 0, updateAvailable: false, canUpdate: true, assets: [] },
  planningLiveAuthority: { ready: true, state: null },
  profileMismatch: null,
  invalidProviderModels: null,
  availableModels: [
    { id: 'opencode-go/deepseek-v4-flash', displayName: 'DeepSeek V4 Flash', provider: 'opencode-go' },
    { id: 'opencode-go/deepseek-v4-pro', displayName: 'DeepSeek V4 Pro', provider: 'opencode-go' },
    { id: 'deepseek/deepseek-v4-flash', displayName: 'DeepSeek V4 Flash Max', provider: 'deepseek' },
    { id: 'deepseek/deepseek-v4-pro', displayName: 'DeepSeek V4 Pro Max', provider: 'deepseek' },
  ],
};

describe('OpenCodeView', () => {
  beforeEach(() => {
    opencodeStore.resetState();
  });

  it('renders the OpenCode workspace view', async () => {
    opencodeStore.setState((s) => ({ ...s, status: mockStatus, loading: false }));
    const { default: OpenCodeView } = await import('../ui/src/tabs/OpenCode/OpenCodeView');
    render(<OpenCodeView />);

    expect(screen.getByTestId('opencode-settings-view')).toBeInTheDocument();
    expect(screen.getByTestId('opencode-settings-toolbar')).toBeInTheDocument();
    expect(screen.getByTestId('opencode-tab-overview')).toBeInTheDocument();
  });

  it('shows overview section by default', async () => {
    opencodeStore.setState((s) => ({ ...s, status: mockStatus, loading: false }));
    const { default: OpenCodeView } = await import('../ui/src/tabs/OpenCode/OpenCodeView');
    render(<OpenCodeView />);

    expect(screen.getByTestId('opencode-overview')).toBeInTheDocument();
    expect(screen.getByTestId('opencode-readiness')).toBeInTheDocument();
    expect(screen.getByTestId('opencode-overall-status')).toHaveTextContent('READY');
  });

  it('switches between tab sections', async () => {
    opencodeStore.setState((s) => ({ ...s, status: mockStatus, loading: false }));
    const { default: OpenCodeView } = await import('../ui/src/tabs/OpenCode/OpenCodeView');
    render(<OpenCodeView />);

    fireEvent.click(screen.getByTestId('opencode-tab-lanes'));
    expect(screen.getByTestId('opencode-lanes')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('opencode-tab-profiles'));
    expect(screen.getByTestId('opencode-profiles')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('opencode-tab-overview'));
    expect(screen.getByTestId('opencode-overview')).toBeInTheDocument();
  });

  it('renders lane cards in lanes section', async () => {
    opencodeStore.setState((s) => ({ ...s, status: mockStatus, loading: false }));
    const { default: OpenCodeView } = await import('../ui/src/tabs/OpenCode/OpenCodeView');
    render(<OpenCodeView />);

    fireEvent.click(screen.getByTestId('opencode-tab-lanes'));

    expect(screen.getByTestId('opencode-lane-quick')).toBeInTheDocument();
    expect(screen.getByTestId('opencode-lane-project')).toBeInTheDocument();
    expect(screen.getByTestId('opencode-lane-runner')).toBeInTheDocument();
    expect(screen.getByTestId('opencode-lane-runner-flash')).toBeInTheDocument();
  });

  it('shows lane detail when lane card is clicked', async () => {
    opencodeStore.setState((s) => ({ ...s, status: mockStatus, loading: false }));
    const { default: OpenCodeView } = await import('../ui/src/tabs/OpenCode/OpenCodeView');
    render(<OpenCodeView />);

    fireEvent.click(screen.getByTestId('opencode-tab-lanes'));
    fireEvent.click(screen.getByTestId('opencode-lane-project'));

    expect(screen.getByTestId('opencode-lane-detail-project')).toBeInTheDocument();
    expect(screen.getByText('Full project life cycle via Elegy Planning graph, worktrees, and evidence')).toBeInTheDocument();
  });

  it('renders profile cards in profiles section', async () => {
    opencodeStore.setState((s) => ({ ...s, status: mockStatus, loading: false }));
    const { default: OpenCodeView } = await import('../ui/src/tabs/OpenCode/OpenCodeView');
    render(<OpenCodeView />);

    fireEvent.click(screen.getByTestId('opencode-tab-profiles'));

    expect(screen.getByTestId('opencode-profile-opencode-go')).toBeInTheDocument();
    expect(screen.getByTestId('opencode-profile-deepseek-direct')).toBeInTheDocument();
    expect(screen.getByTestId('opencode-profile-badge-opencode-go')).toHaveTextContent('Active');
  });

  it('shows loading state before status loads', async () => {
    opencodeStore.setState((s) => ({ ...s, status: null, loading: true }));
    const { default: OpenCodeView } = await import('../ui/src/tabs/OpenCode/OpenCodeView');
    render(<OpenCodeView />);

    expect(screen.getByTestId('opencode-loading')).toBeInTheDocument();
  });

  it('lanes section re-renders when selectedLaneId changes in the store (P2a fix)', async () => {
    opencodeStore.setState((s) => ({ ...s, status: mockStatus, loading: false, selectedLaneId: null }));
    const { default: OpenCodeView } = await import('../ui/src/tabs/OpenCode/OpenCodeView');
    render(<OpenCodeView />);

    fireEvent.click(screen.getByTestId('opencode-tab-lanes'));
    expect(screen.queryByTestId('opencode-lane-detail-project')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('opencode-lane-project'));
    expect(screen.getByTestId('opencode-lane-detail-project')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('opencode-lane-project'));
    expect(screen.queryByTestId('opencode-lane-detail-project')).not.toBeInTheDocument();
  });

  it('profiles section saves role models via saveConfig (P2c fix)', async () => {
    const saveSpy = vi.spyOn(opencodeStore, 'saveConfig').mockResolvedValue(undefined);
    opencodeStore.setState((s) => ({ ...s, status: mockStatus, loading: false }));
    const { default: OpenCodeView } = await import('../ui/src/tabs/OpenCode/OpenCodeView');
    render(<OpenCodeView />);

    fireEvent.click(screen.getByTestId('opencode-tab-profiles'));

    const planningInput = screen.getByTestId('opencode-role-planning-input') as HTMLInputElement;
    const implementationInput = screen.getByTestId('opencode-role-implementation-input') as HTMLInputElement;
    const reviewInput = screen.getByTestId('opencode-role-review-input') as HTMLInputElement;
    fireEvent.change(planningInput, { target: { value: 'opencode-go/deepseek-v4-pro' } });
    fireEvent.change(implementationInput, { target: { value: 'opencode-go/deepseek-v4-flash' } });
    fireEvent.change(reviewInput, { target: { value: 'opencode-go/deepseek-v4-pro' } });

    fireEvent.click(screen.getByTestId('opencode-models-save'));

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalledWith({
        roleModels: {
          planning: 'opencode-go/deepseek-v4-pro',
          implementation: 'opencode-go/deepseek-v4-flash',
          review: 'opencode-go/deepseek-v4-pro',
        },
      });
    });
    saveSpy.mockRestore();
  });
  it('profile card active badge follows effective profile id', async () => {
    const statusWithMismatch = {
      ...mockStatus,
      effectiveProfileId: 'deepseek-direct',
      selectedProfileId: 'opencode-go',
    };
    opencodeStore.setState((s) => ({ ...s, status: statusWithMismatch, loading: false }));
    const { default: OpenCodeView } = await import('../ui/src/tabs/OpenCode/OpenCodeView');
    render(<OpenCodeView />);

    fireEvent.click(screen.getByTestId('opencode-tab-profiles'));

    // The effective profile should have the Active badge
    expect(screen.getByTestId('opencode-profile-badge-deepseek-direct')).toHaveTextContent('Active');
    // The selected (but not effective) profile should have the Selected badge
    expect(screen.getByTestId('opencode-profile-badge-opencode-go')).toHaveTextContent('Selected');
    // The effective profile card should have the active class
    const effectiveCard = screen.getByTestId('opencode-profile-deepseek-direct');
    expect(effectiveCard.className).toContain('opencode-profile-card-active');
  });
  it('shows profile mismatch panel when selected differs from effective', async () => {
    const statusWithMismatch = {
      ...mockStatus,
      effectiveProfileId: 'deepseek-direct',
      selectedProfileId: 'opencode-go',
    };
    opencodeStore.setState((s) => ({ ...s, status: statusWithMismatch, loading: false }));
    const { default: OpenCodeView } = await import('../ui/src/tabs/OpenCode/OpenCodeView');
    render(<OpenCodeView />);

    fireEvent.click(screen.getByTestId('opencode-tab-profiles'));

    // The diff notice panel should be visible
    expect(screen.getByTestId('opencode-profile-diff-notice')).toBeInTheDocument();
    // It should contain the re-apply button
    expect(screen.getByTestId('opencode-profile-reapply-selected')).toBeInTheDocument();
    expect(screen.getByTestId('opencode-profile-reapply-selected')).toHaveTextContent('Re-apply opencode-go');
  });
  it('shows refreshing indicator when reloading with existing status', async () => {
    opencodeStore.setState((s) => ({ ...s, status: mockStatus, loading: true }));
    const { default: OpenCodeView } = await import('../ui/src/tabs/OpenCode/OpenCodeView');
    render(<OpenCodeView />);

    // Should show the refreshing indicator, not full loading
    expect(screen.getByTestId('opencode-refreshing')).toBeInTheDocument();
    expect(screen.getByTestId('opencode-refreshing')).toHaveTextContent('Refreshing…');
    // Content should still be visible
    expect(screen.getByTestId('opencode-overview')).toBeInTheDocument();
  });
});
