import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storeMocks = vi.hoisted(() => ({
  loadWorkspace: vi.fn(),
  refreshWorkspace: vi.fn(),
  addExternalSource: vi.fn(),
  refreshExternalSource: vi.fn(),
  syncInstallVerifyExternalSource: vi.fn(),
  bootstrapSpecKitRepo: vi.fn(),
  removeExternalSource: vi.fn(),
  activateExternalSourceInstallable: vi.fn(),
  deactivateExternalSourceInstallable: vi.fn(),
  reinstallExternalSourceAllTargets: vi.fn(),
  installSurface: vi.fn(),
  loadSkills: vi.fn(),
  refreshSkills: vi.fn(),
  startPolling: vi.fn(),
  stopPolling: vi.fn(),
  refreshStats: vi.fn(),
  getInstalledAssets: vi.fn(),
  getCatalogContent: vi.fn(),
}));

const mockCatalogState = {
  loading: false,
  refreshing: false,
  installing: false,
  mutating: false,
  error: null,
  installMessage: 'Catalog projection refreshed.',
  repoInventory: {
    selectedRepo: {
      repoId: 'repo-1',
      repoPath: 'C:\\work\\repo-1',
      repoLabel: 'Repo 1',
    },
    repos: [],
  },
  activeRepoPath: 'C:\\work\\repo-1',
  summary: {
    externalSources: [
      {
        sourceId: 'demo-source',
        title: 'Demo Source',
        description: 'Shared external catalog source.',
        editable: true,
        sync: {
          status: 'ready',
          lastSyncedAt: '2026-03-09T00:00:00.000Z',
          resolvedRef: 'main',
          lastVerifiedAt: '2026-03-09T00:05:00.000Z',
          verificationStatus: 'partial',
          verificationWarnings: ['Ghidra is not running.'],
          verificationErrors: [],
        },
        installables: [
          {
            installableId: 'skill:brainstorming',
            kind: 'skill',
            title: 'Brainstorming',
            description: 'Prompted ideation skill.',
            targetSupport: ['codex', 'opencode', 'gemini-cli'],
            metadata: {
              relativeSkillFilePath: 'skills/brainstorming/SKILL.md',
            },
          },
          {
            installableId: 'mcp:ghidra',
            kind: 'mcp',
            title: 'Ghidra MCP',
            description: 'Bridge script for the external Ghidra MCP integration.',
            targetSupport: ['codex', 'opencode'],
            sourcePath: 'bridge_mcp_ghidra.py',
          },
        ],
        activation: {
          codex: {
            installables: {
              'skill:brainstorming': {
                installed: true,
                enabled: true,
                managedName: 'external--demo-source--brainstorming',
                installedPath: 'C:\\Users\\demo\\.codex\\skills\\external--demo-source--brainstorming',
                overallStatus: 'installed and active',
                lastVerifiedAt: '2026-03-09T00:05:00.000Z',
                warnings: [],
                errors: [],
                checks: [],
              },
              'mcp:ghidra': {
                installed: true,
                enabled: true,
                managedName: 'external--demo-source--ghidra',
                installedPath: 'C:\\Users\\demo\\.codex\\config.toml',
                overallStatus: 'installed and active',
                lastVerifiedAt: '2026-03-09T00:05:00.000Z',
                warnings: [],
                errors: [],
                checks: [],
              },
            },
          },
          opencode: {
            installables: {
              'mcp:ghidra': {
                installed: false,
                enabled: false,
                overallStatus: 'supported, not active',
                warnings: ['OpenCode restart required'],
                errors: [],
                checks: [],
              },
            },
          },
          'gemini-cli': {
            installables: {
              'skill:brainstorming': {
                installed: false,
                enabled: false,
                overallStatus: 'supported, not active',
                warnings: [],
                errors: [],
                checks: [],
              },
            },
          },
        },
      },
      {
        sourceId: 'spec-kit',
        title: 'Spec Kit',
        description: 'Official GitHub Spec Kit CLI for upstream workflows.',
        editable: false,
        sync: {
          status: 'ready',
          lastSyncedAt: '2026-03-09T00:00:00.000Z',
          resolvedRef: 'v0.8.13',
          lastVerifiedAt: '2026-03-09T00:10:00.000Z',
          verificationStatus: 'ready',
          verificationWarnings: [],
          verificationErrors: [],
        },
        installables: [
          {
            installableId: 'cli:specify',
            kind: 'cli-tool',
            title: 'Spec Kit',
            description: 'Official Specify CLI installed from github/spec-kit.',
            targetSupport: ['host'],
          },
        ],
        activation: {
          host: {
            installables: {
              'cli:specify': {
                installed: true,
                enabled: true,
                managedName: 'external-spec-kit-specify',
                installedPath: 'C:\\Users\\demo\\AppData\\Roaming\\Python\\Scripts\\specify.exe',
                overallStatus: 'installed',
                lastVerifiedAt: '2026-03-09T00:10:00.000Z',
                warnings: [],
                errors: [],
                checks: [],
              },
            },
          },
        },
      },
    ],
    providers: [
      {
        providerId: 'external-provider',
        title: 'Example External Provider',
        description: 'External capability pack for provider-backed skills and agents.',
      },
    ],
  },
};

const mockSkillsState = {
  skills: [
    {
      assetId: 'skill-external-provider-brainstorming',
      name: 'brainstorming',
      kind: 'full',
      loadMode: 'always',
      availability: 'installed',
      provider: 'external-provider',
      namespace: 'external',
    },
  ],
  loading: false,
  error: null,
  searchQuery: '',
  selectedSkillId: null,
  detailLoading: false,
  detailError: null,
  detailText: '(select a skill above)',
};

const mockStatsState = {
  loading: false,
  usageError: null,
  recentSessionUsage: [
    {
      session: { id: 'session-1' },
      error: null,
      usage: {
        id: 'session-1',
        source: 'cli',
        usage: {},
        skillUsage: {
          totalInvocations: 3,
          uniqueSkillCount: 1,
          skills: [
            {
              assetId: 'skill:brainstorming',
              assetKind: 'skill',
              invocationCount: 3,
            },
          ],
        },
      },
    },
  ],
};

vi.mock('../ui/src/lib/api', async () => {
  const actual = await vi.importActual('../ui/src/lib/api');
  return {
    ...actual,
    getInstalledAssets: storeMocks.getInstalledAssets,
    getCatalogContent: storeMocks.getCatalogContent,
  };
});

vi.mock('../ui/src/tabs/Assets/catalogWorkspaceStore', () => ({
  catalogWorkspaceStore: {
    getState: () => mockCatalogState,
    subscribe: () => () => {},
    loadWorkspace: storeMocks.loadWorkspace,
    refreshWorkspace: storeMocks.refreshWorkspace,
    addExternalSource: storeMocks.addExternalSource,
    refreshExternalSource: storeMocks.refreshExternalSource,
    syncInstallVerifyExternalSource: storeMocks.syncInstallVerifyExternalSource,
    bootstrapSpecKitRepo: storeMocks.bootstrapSpecKitRepo,
    removeExternalSource: storeMocks.removeExternalSource,
    activateExternalSourceInstallable: storeMocks.activateExternalSourceInstallable,
    deactivateExternalSourceInstallable: storeMocks.deactivateExternalSourceInstallable,
    reinstallExternalSourceAllTargets: storeMocks.reinstallExternalSourceAllTargets,
    installSurface: storeMocks.installSurface,
  },
}));

vi.mock('../ui/src/tabs/SkillsPreview/skillsPreviewStore', () => ({
  skillsPreviewStore: {
    getState: () => mockSkillsState,
    subscribe: () => () => {},
    loadSkills: storeMocks.loadSkills,
    refresh: storeMocks.refreshSkills,
  },
}));

vi.mock('../ui/src/tabs/Stats/statsStore', () => ({
  statsStore: {
    getState: () => mockStatsState,
    subscribe: () => () => {},
    startPolling: storeMocks.startPolling,
    stopPolling: storeMocks.stopPolling,
    refresh: storeMocks.refreshStats,
  },
}));

describe('CatalogStatusView', () => {
  beforeEach(() => {
    Object.values(storeMocks).forEach((mock) => mock.mockReset());
    storeMocks.getInstalledAssets.mockResolvedValue({
      agents: [],
      skills: [
        {
          name: 'brainstorming',
          absPath: 'C:\\Users\\demo\\.codex\\skills\\external--demo-source--brainstorming',
          kind: 'full',
        },
      ],
      prompts: [],
      instructions: {
        installed: true,
        absPath: 'C:\\Users\\demo\\.copilot\\copilot-instructions.md',
      },
    });
    storeMocks.getCatalogContent.mockResolvedValue('# External detail');
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('renders the consolidated status surface and dispatches source actions', async () => {
    const { default: CatalogStatusView } = await import('../ui/src/tabs/Catalog/CatalogStatusView');

    render(<CatalogStatusView />);

    await waitFor(() => {
      expect(screen.getByTestId('catalog-status-installed-skills-list')).toBeInTheDocument();
    });

    expect(storeMocks.loadWorkspace).toHaveBeenCalledTimes(1);
    expect(storeMocks.loadSkills).toHaveBeenCalledTimes(1);
    expect(storeMocks.startPolling).toHaveBeenCalledTimes(1);

    expect(screen.getByTestId('catalog-status-view')).toBeInTheDocument();
    expect(screen.getByTestId('catalog-status-targets-panel')).toBeInTheDocument();
    expect(screen.getByTestId('catalog-status-sources-panel')).toBeInTheDocument();
    expect(screen.getByTestId('catalog-status-installed-panel')).toBeInTheDocument();
    expect(screen.getByTestId('catalog-status-runtime-panel')).toBeInTheDocument();

    expect(screen.getByText('Demo Source')).toBeInTheDocument();
    expect(screen.getAllByText('Spec Kit').length).toBeGreaterThan(0);
    expect(screen.getByText(/Supports: Codex, OpenCode, Antigravity CLI/i)).toBeInTheDocument();
    expect(screen.getByText(/Supports: Host CLI/i)).toBeInTheDocument();
    const targetDetails = screen.getAllByTestId('catalog-status-installable-target-detail').map((node) => node.textContent || '');
    expect(targetDetails.some((value) => /Codex: installed and active/i.test(value))).toBe(true);
    expect(targetDetails.some((value) => /OpenCode: supported, not active/i.test(value))).toBe(true);
    expect(targetDetails.some((value) => /Antigravity CLI: supported, not active/i.test(value))).toBe(true);
    expect(targetDetails.some((value) => /Host CLI: installed/i.test(value))).toBe(true);
    expect(screen.getAllByText('brainstorming').length).toBeGreaterThan(0);
    expect(screen.getByText('skill:brainstorming')).toBeInTheDocument();
    expect(screen.getByText(/Verification partial/i)).toBeInTheDocument();
    expect(screen.getByTestId('catalog-status-external-inventory-list')).toHaveTextContent('Ghidra MCP');
    expect(screen.getByTestId('catalog-status-external-inventory-list')).toHaveTextContent('Spec Kit');

    const sourceList = screen.getByTestId('catalog-status-source-list');
    const brainstormingItem = within(sourceList).getByText('Brainstorming').closest('li');
    const ghidraItem = within(sourceList).getByText('Ghidra MCP').closest('li');
    const specKitInstallableItem = within(sourceList).getAllByText('Spec Kit')[1]?.closest('li');

    expect(brainstormingItem).not.toBeNull();
    expect(ghidraItem).not.toBeNull();
    expect(specKitInstallableItem).not.toBeNull();

    await act(async () => {
      fireEvent.click(screen.getAllByTestId('catalog-status-source-refresh')[0]);
      fireEvent.click(screen.getAllByTestId('catalog-status-source-sync-install-verify')[0]);
      fireEvent.click(screen.getByTestId('catalog-status-source-bootstrap-spec-kit'));
      fireEvent.click(within(brainstormingItem as HTMLElement).getByRole('button', { name: 'Details' }));
      fireEvent.click(within(ghidraItem as HTMLElement).getByRole('button', { name: 'Details' }));
      fireEvent.click(within(brainstormingItem as HTMLElement).getByRole('button', { name: /Deactivate Codex/i }));
      fireEvent.click(within(brainstormingItem as HTMLElement).getByRole('button', { name: /Activate OpenCode/i }));
      fireEvent.click(within(brainstormingItem as HTMLElement).getByRole('button', { name: /Activate Antigravity CLI/i }));
      fireEvent.click(within(specKitInstallableItem as HTMLElement).getByRole('button', { name: /Deactivate Host CLI/i }));
    });

    await waitFor(() => {
      expect(storeMocks.refreshExternalSource).toHaveBeenCalledWith('demo-source');
    });
    await waitFor(() => {
      expect(storeMocks.syncInstallVerifyExternalSource).toHaveBeenCalledWith({
        sourceId: 'demo-source',
        repoPath: 'C:\\work\\repo-1',
      });
    });
    await waitFor(() => {
      expect(storeMocks.bootstrapSpecKitRepo).toHaveBeenCalledWith({
        repoPath: 'C:\\work\\repo-1',
        integration: 'copilot',
        script: 'ps',
      });
    });
    await waitFor(() => {
      expect(storeMocks.getCatalogContent).toHaveBeenCalledWith({
        mode: 'external-source',
        sourceId: 'demo-source',
        path: 'skills/brainstorming/SKILL.md',
      });
    });
    await waitFor(() => {
      expect(storeMocks.getCatalogContent).toHaveBeenCalledWith({
        mode: 'external-source',
        sourceId: 'demo-source',
        path: 'bridge_mcp_ghidra.py',
      });
    });
    expect(screen.getByTestId('catalog-status-detail-panel')).toHaveTextContent('# External detail');
    await waitFor(() => {
      expect(storeMocks.deactivateExternalSourceInstallable).toHaveBeenCalledWith({
        sourceId: 'demo-source',
        installableId: 'skill:brainstorming',
        target: 'codex',
      });
    });
    await waitFor(() => {
      expect(storeMocks.activateExternalSourceInstallable).toHaveBeenCalledWith({
        sourceId: 'demo-source',
        installableId: 'skill:brainstorming',
        target: 'opencode',
      });
    });
    await waitFor(() => {
      expect(storeMocks.activateExternalSourceInstallable).toHaveBeenCalledWith({
        sourceId: 'demo-source',
        installableId: 'skill:brainstorming',
        target: 'gemini-cli',
      });
    });
    await waitFor(() => {
      expect(storeMocks.deactivateExternalSourceInstallable).toHaveBeenCalledWith({
        sourceId: 'spec-kit',
        installableId: 'cli:specify',
        target: 'host',
      });
    });
  });
});

