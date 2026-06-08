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
  profiles: [
    { id: 'opencode-go', label: 'OpenCode Go', description: 'Default route', route: 'opencode-go', smallModel: 'DeepSeek V4 Flash Max', bigModel: 'DeepSeek V4 Pro Max', reviewModel: 'DeepSeek V4 Pro High' },
    { id: 'deepseek-direct', label: 'Direct DeepSeek', description: 'Direct route', route: 'deepseek-direct', smallModel: 'DeepSeek V4 Flash Max', bigModel: 'DeepSeek V4 Pro Max', reviewModel: 'DeepSeek V4 Pro High' },
  ],
  availableRoutes: ['opencode-go', 'deepseek-direct'],
  lanes: [
    {
      id: 'quick',
      label: 'Quick',
      description: 'Fast implementation',
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
      id: 'standard',
      label: 'Standard',
      description: 'Balanced implementation',
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
      id: 'spec',
      label: 'Spec',
      description: 'Spec-driven development',
      nodes: [
        { id: 'user-request', label: 'User Request', kind: 'start' },
        { id: 'implementation', label: 'Implementation', kind: 'action' },
      ],
      edges: [{ from: 'user-request', to: 'implementation', label: 'route' }],
      modelPolicy: { small: 'Flash Max', big: 'Pro Max', review: 'Pro High' },
      requiredSetup: ['opencode-config', 'specs-dir'],
      clarificationGates: ['spec-scope'],
      worktreeBehavior: null,
      escalationTriggers: ['spec-rejected'],
    },
    {
      id: 'project',
      label: 'Project',
      description: 'Full project lifecycle',
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

    expect(screen.getByTestId('opencode-view')).toBeInTheDocument();
    expect(screen.getByTestId('opencode-toolbar')).toBeInTheDocument();
    expect(screen.getByTestId('opencode-tabs')).toBeInTheDocument();
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

    fireEvent.click(screen.getByTestId('opencode-tab-setup'));
    expect(screen.getByTestId('opencode-setup')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('opencode-tab-overview'));
    expect(screen.getByTestId('opencode-overview')).toBeInTheDocument();
  });

  it('renders lane cards in lanes section', async () => {
    opencodeStore.setState((s) => ({ ...s, status: mockStatus, loading: false }));
    const { default: OpenCodeView } = await import('../ui/src/tabs/OpenCode/OpenCodeView');
    render(<OpenCodeView />);

    fireEvent.click(screen.getByTestId('opencode-tab-lanes'));

    expect(screen.getByTestId('opencode-lane-quick')).toBeInTheDocument();
    expect(screen.getByTestId('opencode-lane-standard')).toBeInTheDocument();
    expect(screen.getByTestId('opencode-lane-spec')).toBeInTheDocument();
    expect(screen.getByTestId('opencode-lane-project')).toBeInTheDocument();
  });

  it('shows lane detail when lane card is clicked', async () => {
    opencodeStore.setState((s) => ({ ...s, status: mockStatus, loading: false }));
    const { default: OpenCodeView } = await import('../ui/src/tabs/OpenCode/OpenCodeView');
    render(<OpenCodeView />);

    fireEvent.click(screen.getByTestId('opencode-tab-lanes'));
    fireEvent.click(screen.getByTestId('opencode-lane-spec'));

    expect(screen.getByTestId('opencode-lane-detail-spec')).toBeInTheDocument();
    expect(screen.getByText('Spec-driven development')).toBeInTheDocument();
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

  it('renders setup checklist in setup section', async () => {
    opencodeStore.setState((s) => ({ ...s, status: mockStatus, loading: false }));
    const { default: OpenCodeView } = await import('../ui/src/tabs/OpenCode/OpenCodeView');
    render(<OpenCodeView />);

    fireEvent.click(screen.getByTestId('opencode-tab-setup'));

    expect(screen.getByTestId('opencode-setup-checklist')).toBeInTheDocument();
    expect(screen.getByTestId('opencode-setup-opencode-config')).toBeInTheDocument();
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
    expect(screen.queryByTestId('opencode-lane-detail-spec')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('opencode-lane-spec'));
    expect(screen.getByTestId('opencode-lane-detail-spec')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('opencode-lane-spec'));
    expect(screen.queryByTestId('opencode-lane-detail-spec')).not.toBeInTheDocument();
  });

  it('profiles section saves small/big models via saveConfig (P2c fix)', async () => {
    const saveSpy = vi.spyOn(opencodeStore, 'saveConfig').mockResolvedValue(undefined);
    opencodeStore.setState((s) => ({ ...s, status: mockStatus, loading: false }));
    const { default: OpenCodeView } = await import('../ui/src/tabs/OpenCode/OpenCodeView');
    render(<OpenCodeView />);

    fireEvent.click(screen.getByTestId('opencode-tab-profiles'));

    const smallInput = screen.getByTestId('opencode-small-model-input') as HTMLInputElement;
    const bigInput = screen.getByTestId('opencode-big-model-input') as HTMLInputElement;
    fireEvent.change(smallInput, { target: { value: 'deepseek/deepseek-v4-flash' } });
    fireEvent.change(bigInput, { target: { value: 'deepseek/deepseek-v4-pro' } });

    fireEvent.click(screen.getByTestId('opencode-models-save'));

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalledWith({ smallModel: 'deepseek/deepseek-v4-flash', bigModel: 'deepseek/deepseek-v4-pro', reviewModel: 'DeepSeek V4 Pro High' });
    });
    saveSpy.mockRestore();
  });
});
