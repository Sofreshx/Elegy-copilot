import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { navigationStore } from '../ui/src/stores/navigation';

const mocks = vi.hoisted(() => ({
  getCatalogSummary: vi.fn(),
  getCatalogContent: vi.fn(),
  selectAsset: vi.fn(),
  installAsset: vi.fn(),
  installSurface: vi.fn(),
  activateExternalSourceInstallable: vi.fn(),
  deactivateExternalSourceInstallable: vi.fn(),
}));

vi.mock('../ui/src/lib/api', async () => {
  const actual = await vi.importActual('../ui/src/lib/api');
  return {
    ...actual,
    getCatalogSummary: mocks.getCatalogSummary,
    getCatalogContent: mocks.getCatalogContent,
  };
});

vi.mock('../ui/src/tabs/Assets/catalogWorkspaceStore', () => ({
  catalogWorkspaceStore: {
    getState: (() => {
      const state = { summary: null };
      return () => state;
    })(),
    subscribe: () => () => {},
    selectAsset: mocks.selectAsset,
    installAsset: mocks.installAsset,
    installSurface: mocks.installSurface,
    activateExternalSourceInstallable: mocks.activateExternalSourceInstallable,
    deactivateExternalSourceInstallable: mocks.deactivateExternalSourceInstallable,
  },
}));

vi.mock('../ui/src/tabs/Assets/AssetsView', () => ({
  default: () => <div data-testid="mock-assets-view">Repository view</div>,
}));

vi.mock('../ui/src/tabs/Catalog/CatalogStatusView', () => ({
  default: () => <div data-testid="mock-catalog-status-view">Catalog status</div>,
}));

describe('CatalogView', () => {
  beforeEach(() => {
    navigationStore.reset();
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.selectAsset.mockResolvedValue(undefined);
    mocks.installAsset.mockResolvedValue(undefined);
    mocks.installSurface.mockResolvedValue(undefined);
    mocks.activateExternalSourceInstallable.mockResolvedValue(undefined);
    mocks.deactivateExternalSourceInstallable.mockResolvedValue(undefined);
    mocks.getCatalogContent.mockResolvedValue('# Detail');
    mocks.getCatalogSummary.mockResolvedValue({
      kind: 'catalog.summary',
      deterministic: true,
      summary: {
        globalInventory: {
          harnesses: [
            { harnessId: 'copilot', title: 'Copilot', homePath: 'C:\\Users\\demo\\.copilot' },
            { harnessId: 'codex', title: 'Codex', homePath: 'C:\\Users\\demo\\.codex', skillsHomePath: 'C:\\Users\\demo\\.codex\\skills' },
            { harnessId: 'opencode', title: 'OpenCode', homePath: 'C:\\Users\\demo\\.config\\opencode', skillsHomePath: 'C:\\Users\\demo\\.config\\opencode\\skills' },
          ],
          sections: [
            {
              kind: 'skill',
              title: 'Skill',
              count: 2,
              items: [
                {
                  itemId: 'skill-review',
                  conceptualKey: 'review',
                  itemKey: 'review',
                  kind: 'skill',
                  title: 'Review skill',
                  description: 'Reusable review guidance.',
                  sourceType: 'catalog-asset',
                  readPath: 'C:\\Users\\demo\\.copilot\\skills\\review\\SKILL.md',
                  syncStatus: 'available',
                  actions: {
                    kind: 'catalog-asset',
                    installAssetId: 'skill-review',
                  },
                  harnessStates: [
                    {
                      harnessId: 'copilot',
                      title: 'Copilot',
                      supported: true,
                      expected: true,
                      installed: false,
                      active: false,
                      syncStatus: 'missing',
                      actions: {
                        canInstall: true,
                      },
                    },
                  ],
                },
                {
                  itemId: 'skill-discovery',
                  conceptualKey: 'skill-discovery',
                  itemKey: 'skill-discovery',
                  kind: 'skill',
                  title: 'Skill Discovery',
                  description: 'Vault-first routing for on-demand skills.',
                  sourceType: 'catalog-asset',
                  readPath: 'C:\\Users\\demo\\.copilot\\skills\\skill-discovery\\SKILL.md',
                  central: true,
                  keyFeature: true,
                  keyFeatureLabel: 'Retrieval',
                  keyFeatureOrder: 0,
                  scopeKinds: ['global', 'harness', 'repo'],
                  syncStatus: 'missing',
                  missingHarnessCount: 1,
                  actions: {
                    kind: 'catalog-asset',
                    installAssetId: 'skill-discovery',
                    installSurfaceTargets: ['codex', 'opencode'],
                  },
                  harnessStates: [
                    {
                      harnessId: 'copilot',
                      title: 'Copilot',
                      supported: true,
                      expected: true,
                      installed: true,
                      active: true,
                      syncStatus: 'synced',
                      actions: {
                        canInstall: true,
                      },
                      metadata: {
                        actionKind: 'catalog-asset',
                      },
                    },
                    {
                      harnessId: 'codex',
                      title: 'Codex',
                      supported: true,
                      expected: true,
                      installed: false,
                      active: false,
                      syncStatus: 'missing',
                      actions: {
                        canInstall: true,
                        canSync: true,
                      },
                      metadata: {
                        actionKind: 'install-surface',
                      },
                    },
                    {
                      harnessId: 'opencode',
                      title: 'OpenCode',
                      supported: true,
                      expected: true,
                      installed: true,
                      active: true,
                      syncStatus: 'synced',
                      actions: {
                        canInstall: true,
                        canSync: true,
                      },
                      metadata: {
                        actionKind: 'install-surface',
                      },
                    },
                  ],
                },
              ],
            },
            {
              kind: 'agent',
              title: 'Agent',
              count: 0,
              items: [],
            },
            {
              kind: 'mcp',
              title: 'MCP',
              count: 1,
              items: [
                {
                  itemId: 'demo-source:mcp:context7',
                  conceptualKey: 'context7',
                  itemKey: 'mcp:context7',
                  kind: 'mcp',
                  title: 'Context7',
                  description: 'External MCP source.',
                  sourceType: 'external-source',
                  sourceId: 'demo-source',
                  readPath: 'server.json',
                  detail: {
                    installableId: 'mcp:context7',
                    sourceSyncStatus: 'ready',
                    sourceResolvedRef: 'main',
                    sourceLastVerifiedAt: '2026-05-25T00:00:00.000Z',
                    sourceVerificationStatus: 'partial',
                    sourceVerificationWarnings: ['OpenCode restart required'],
                    sourceVerificationErrors: ['Codex config parse failed'],
                  },
                  actions: {
                    kind: 'external-source',
                  },
                  harnessStates: [
                    {
                      harnessId: 'codex',
                      title: 'Codex',
                      supported: true,
                      expected: false,
                      installed: true,
                      active: true,
                      syncStatus: 'active',
                      actions: {
                        canActivate: true,
                        canDeactivate: true,
                      },
                      detail: {
                        enabled: true,
                        installed: true,
                        managedName: 'external--demo-source--context7',
                        installedPath: 'C:\\Users\\demo\\.codex\\config.toml',
                        overallStatus: 'installed-active',
                        sourceStatus: 'ready',
                        lastVerifiedAt: '2026-05-25T00:00:00.000Z',
                        warnings: ['Restart Codex to reconnect.'],
                        errors: [],
                      },
                      metadata: {
                        actionKind: 'external-source',
                        installableId: 'mcp:context7',
                      },
                    },
                    {
                      harnessId: 'opencode',
                      title: 'OpenCode',
                      supported: true,
                      expected: false,
                      installed: false,
                      active: false,
                      syncStatus: 'available',
                      actions: {
                        canActivate: true,
                        canDeactivate: true,
                      },
                      detail: {
                        enabled: false,
                        installed: false,
                        managedName: 'external--demo-source--context7',
                        installedPath: 'C:\\Users\\demo\\.config\\opencode\\opencode.json',
                        overallStatus: 'needs-attention',
                        sourceStatus: 'ready',
                        lastVerifiedAt: '2026-05-25T00:00:00.000Z',
                        warnings: ['OpenCode restart required'],
                        errors: ['OpenCode bridge is not connected'],
                      },
                      metadata: {
                        actionKind: 'external-source',
                        installableId: 'mcp:context7',
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    });
  });

  it('defaults to Global and still exposes the status section', async () => {
    const { default: CatalogView } = await import('../ui/src/tabs/Catalog/CatalogView');

    render(<CatalogView />);

    expect(screen.getByTestId('catalog-section-status')).toHaveTextContent('Status');
    expect(screen.getByTestId('catalog-section-global')).toHaveTextContent('Global');
    expect(screen.getByTestId('catalog-section-repository')).toHaveTextContent('Per repository');
    expect(screen.getByTestId('catalog-global-view')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId('catalog-global-section-skill')).toBeInTheDocument();
    });
    expect(screen.getByTestId('catalog-global-section-agent')).toBeInTheDocument();
    expect(screen.getByTestId('catalog-global-section-mcp')).toBeInTheDocument();

    act(() => {
      navigationStore.setCatalogSectionId('status');
    });

    await waitFor(() => {
      expect(screen.getByTestId('mock-catalog-status-view')).toBeInTheDocument();
    });
  });

  it('switches to Repository and keeps deep links working', async () => {
    navigationStore.setCatalogSectionId('repository');

    const { default: CatalogView } = await import('../ui/src/tabs/Catalog/CatalogView');
    render(<CatalogView />);

    expect(screen.getByTestId('mock-assets-view')).toBeInTheDocument();
    expect(screen.getByTestId('catalog-section-repository')).toHaveClass('button-primary');

    act(() => {
      navigationStore.setCatalogSectionId('global');
    });

    await waitFor(() => {
      expect(screen.getByTestId('catalog-global-view')).toBeInTheDocument();
    });
  });

  it('dispatches truthful global actions and opens item details', async () => {
    const { default: CatalogView } = await import('../ui/src/tabs/Catalog/CatalogView');

    render(<CatalogView />);

    await waitFor(() => {
      expect(screen.getByTestId('catalog-global-item-skill-review')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('catalog-global-action-skill-review-copilot'));
    await waitFor(() => {
      expect(mocks.installAsset).toHaveBeenCalledWith({ assetId: 'skill-review' });
    });

    fireEvent.click(screen.getByTestId('catalog-global-warning-action-skill-discovery-codex'));
    await waitFor(() => {
      expect(mocks.installSurface).toHaveBeenCalledWith('codex');
    });

    fireEvent.click(screen.getByTestId('catalog-global-action-demo-source:mcp:context7-codex'));
    await waitFor(() => {
      expect(mocks.deactivateExternalSourceInstallable).toHaveBeenCalledWith({
        sourceId: 'demo-source',
        installableId: 'mcp:context7',
        target: 'codex',
      });
    });

    fireEvent.click(screen.getByTestId('catalog-global-details-skill-review'));
    await waitFor(() => {
      expect(mocks.getCatalogContent).toHaveBeenCalledWith({
        mode: 'absolute',
        path: 'C:\\Users\\demo\\.copilot\\skills\\review\\SKILL.md',
      });
    });
    expect(screen.getByTestId('catalog-global-detail-panel')).toHaveTextContent('# Detail');
  });

  it('renders key-skill warnings and sync-all action', async () => {
    const { default: CatalogView } = await import('../ui/src/tabs/Catalog/CatalogView');

    render(<CatalogView />);

    await waitFor(() => {
      expect(screen.getByTestId('catalog-global-warning-skill-discovery')).toBeInTheDocument();
    });
    expect(screen.getByTestId('catalog-global-sync-all')).toHaveTextContent('Sync all harnesses');
    expect(screen.getByTestId('catalog-global-item-skill-discovery')).toHaveTextContent('Central');
    expect(screen.getByTestId('catalog-global-item-skill-discovery')).toHaveTextContent('Retrieval');

    fireEvent.click(screen.getByTestId('catalog-global-sync-all'));
    await waitFor(() => {
      expect(mocks.installSurface).toHaveBeenCalledWith('all', false);
    });
  });

  it('renders external-source verification and per-target issues in Global view', async () => {
    const { default: CatalogView } = await import('../ui/src/tabs/Catalog/CatalogView');

    render(<CatalogView />);

    await waitFor(() => {
      expect(screen.getByTestId('catalog-global-source-verification-demo-source:mcp:context7')).toBeInTheDocument();
    });

    expect(screen.getByTestId('catalog-global-source-verification-demo-source:mcp:context7')).toHaveTextContent('Sync ready');
    expect(screen.getByTestId('catalog-global-source-verification-demo-source:mcp:context7')).toHaveTextContent('verification partial');
    expect(screen.getByText('Codex config parse failed')).toBeInTheDocument();
    expect(screen.getAllByText('OpenCode restart required')).toHaveLength(2);
    expect(screen.getByTestId('catalog-global-harness-detail-demo-source:mcp:context7-codex')).toHaveTextContent('State installed-active');
    expect(screen.getByTestId('catalog-global-harness-detail-demo-source:mcp:context7-opencode')).toHaveTextContent('State needs-attention');
    expect(screen.getByText('Restart Codex to reconnect.')).toBeInTheDocument();
    expect(screen.getByText('OpenCode bridge is not connected')).toBeInTheDocument();
  });
});
