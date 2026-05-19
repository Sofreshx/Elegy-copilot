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
          ],
          sections: [
            {
              kind: 'skill',
              title: 'Skill',
              count: 1,
              items: [
                {
                  itemId: 'skill-review',
                  itemKey: 'review',
                  kind: 'skill',
                  title: 'Review skill',
                  description: 'Reusable review guidance.',
                  sourceType: 'catalog-asset',
                  readPath: 'C:\\Users\\demo\\.copilot\\skills\\review\\SKILL.md',
                  actions: {
                    kind: 'catalog-asset',
                    installAssetId: 'skill-review',
                  },
                  harnessStates: [
                    {
                      harnessId: 'copilot',
                      title: 'Copilot',
                      supported: true,
                      installed: false,
                      active: false,
                      actions: {
                        canInstall: true,
                      },
                    },
                  ],
                },
              ],
            },
            {
              kind: 'agent',
              title: 'Agent',
              count: 1,
              items: [
                {
                  itemId: 'opencode-code-explorer-agent',
                  itemKey: 'agents/code-explorer.md',
                  kind: 'agent',
                  title: 'code-explorer',
                  description: 'OpenCode shipped agent.',
                  sourceType: 'harness-manifest',
                  readPath: 'opencode-assets/agents/code-explorer.md',
                  actions: {
                    kind: 'install-surface',
                    installSurfaceTargets: ['opencode'],
                  },
                  harnessStates: [
                    {
                      harnessId: 'opencode',
                      title: 'OpenCode',
                      supported: true,
                      installed: false,
                      active: false,
                      actions: {
                        canInstall: true,
                        canSync: true,
                      },
                    },
                  ],
                },
              ],
            },
            {
              kind: 'mcp',
              title: 'MCP',
              count: 1,
              items: [
                {
                  itemId: 'demo-source:mcp:context7',
                  itemKey: 'mcp:context7',
                  kind: 'mcp',
                  title: 'Context7',
                  description: 'External MCP source.',
                  sourceType: 'external-source',
                  sourceId: 'demo-source',
                  readPath: 'server.json',
                  detail: {
                    installableId: 'mcp:context7',
                  },
                  actions: {
                    kind: 'external-source',
                  },
                  harnessStates: [
                    {
                      harnessId: 'codex',
                      title: 'Codex',
                      supported: true,
                      installed: true,
                      active: true,
                      actions: {
                        canActivate: true,
                        canDeactivate: true,
                      },
                      metadata: {
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

  it('defaults to Global and renders the new catalog sections', async () => {
    const { default: CatalogView } = await import('../ui/src/tabs/Catalog/CatalogView');

    render(<CatalogView />);

    expect(screen.getByTestId('catalog-section-global')).toHaveTextContent('Global');
    expect(screen.getByTestId('catalog-section-repository')).toHaveTextContent('Per repository');
    expect(screen.getByTestId('catalog-global-view')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId('catalog-global-section-skill')).toBeInTheDocument();
    });
    expect(screen.getByTestId('catalog-global-section-agent')).toBeInTheDocument();
    expect(screen.getByTestId('catalog-global-section-mcp')).toBeInTheDocument();
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

    fireEvent.click(screen.getByTestId('catalog-global-action-opencode-code-explorer-agent-opencode'));
    await waitFor(() => {
      expect(mocks.installSurface).toHaveBeenCalledWith('opencode');
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
});
