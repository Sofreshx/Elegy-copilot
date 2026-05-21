import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storeMocks = vi.hoisted(() => ({
  loadWorkspace: vi.fn(),
  refreshWorkspace: vi.fn(),
  addExternalSource: vi.fn(),
  refreshExternalSource: vi.fn(),
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
}));

const mockCatalogState = {
  loading: false,
  refreshing: false,
  installing: false,
  mutating: false,
  error: null,
  installMessage: 'Catalog projection refreshed.',
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
        },
        installables: [
          {
            installableId: 'skill:brainstorming',
            kind: 'skill',
            title: 'Brainstorming',
            description: 'Prompted ideation skill.',
            targetSupport: ['codex', 'opencode', 'gemini-cli'],
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
              },
            },
          },
          'gemini-cli': {
            installables: {
              'skill:brainstorming': {
                installed: false,
                enabled: false,
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
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('renders the consolidated status surface and dispatches source actions', async () => {
    const { default: CatalogStatusView } = await import('../ui/src/tabs/Catalog/CatalogStatusView');

    render(<CatalogStatusView />);

    expect(storeMocks.loadWorkspace).toHaveBeenCalledTimes(1);
    expect(storeMocks.loadSkills).toHaveBeenCalledTimes(1);
    expect(storeMocks.startPolling).toHaveBeenCalledTimes(1);

    expect(screen.getByTestId('catalog-status-view')).toBeInTheDocument();
    expect(screen.getByTestId('catalog-status-targets-panel')).toBeInTheDocument();
    expect(screen.getByTestId('catalog-status-sources-panel')).toBeInTheDocument();
    expect(screen.getByTestId('catalog-status-installed-panel')).toBeInTheDocument();
    expect(screen.getByTestId('catalog-status-runtime-panel')).toBeInTheDocument();

    expect(screen.getByText('Demo Source')).toBeInTheDocument();
    expect(screen.getByText(/Supports: Codex, OpenCode, Antigravity CLI/i)).toBeInTheDocument();
    const targetDetails = screen.getAllByTestId('catalog-status-installable-target-detail').map((node) => node.textContent || '');
    expect(targetDetails.some((value) => /Codex: installed and active/i.test(value))).toBe(true);
    expect(targetDetails.some((value) => /OpenCode: supported, not active/i.test(value))).toBe(true);
    expect(targetDetails.some((value) => /Antigravity CLI: supported, not active/i.test(value))).toBe(true);
    expect(screen.getByText('brainstorming')).toBeInTheDocument();
    expect(screen.getByText('skill:brainstorming')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('catalog-status-source-refresh'));

    await waitFor(() => {
      expect(storeMocks.refreshExternalSource).toHaveBeenCalledWith('demo-source');
    });
  });
});

