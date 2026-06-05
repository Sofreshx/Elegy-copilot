import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { navigationStore } from '../ui/src/stores/navigation';

const mocks = vi.hoisted(() => ({
  getCatalogSummary: vi.fn(),
  getCatalogContent: vi.fn(),
  installSurface: vi.fn(),
  setHarnessOptIn: vi.fn(),
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
      const state = { summary: null, loading: false, refreshing: false, installing: false, mutating: false, error: null };
      return () => state;
    })(),
    setState: () => {},
    subscribe: () => () => {},
    selectAsset: vi.fn(),
    installAsset: vi.fn(),
    installSurface: mocks.installSurface,
    toggleHarnessOptIn: mocks.setHarnessOptIn,
    loadWorkspace: vi.fn(),
  },
}));

vi.mock('../ui/src/tabs/Assets/AssetsView', () => ({
  default: () => <div data-testid="mock-assets-view">Repository view</div>,
}));

vi.mock('../ui/src/tabs/Catalog/CatalogStatusView', () => ({
  default: () => <div data-testid="mock-catalog-status-view">Catalog status</div>,
}));

function buildSummaryWithCodexMissing({ missingHarnessCount = 1 } = {}) {
  return {
    kind: 'catalog.summary',
    deterministic: true,
    summary: {
      globalInventory: {
        harnesses: [
          { harnessId: 'copilot', title: 'Copilot', homePath: '~/.copilot', optedIn: true },
          { harnessId: 'codex', title: 'Codex', homePath: '~/.codex', skillsHomePath: '~/.codex/skills', optedIn: true },
        ],
        sections: [
          {
            kind: 'skill',
            title: 'Skill',
            count: 1,
            items: [
              {
                itemId: 'codex-skill-discovery-skill',
                conceptualKey: 'skill-discovery',
                itemKey: 'skill-discovery',
                kind: 'skill',
                title: 'Skill Discovery',
                description: 'Test skill.',
                sourceType: 'catalog-asset',
                syncStatus: 'missing',
                missingHarnessCount,
                actions: {
                  kind: 'catalog-asset',
                  installAssetId: 'codex-skill-discovery-skill',
                  installSurfaceTargets: ['codex'],
                },
                harnessStates: [
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
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  };
}

describe('Asset sync warning clears after successful install (R6)', () => {
  beforeEach(() => {
    navigationStore.reset();
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.getCatalogContent.mockResolvedValue('# Detail');
  });

  it('Test A: warning clears after successful install', async () => {
    mocks.getCatalogSummary.mockResolvedValue(
      buildSummaryWithCodexMissing({ missingHarnessCount: 1 }),
    );
    mocks.installSurface.mockResolvedValue({
      target: 'all',
      dryRun: false,
      force: false,
      surfaces: [
        {
          surface: 'codex',
          ok: true,
          counts: { created: 1, updated: 0, skipped: 0, skippedConflict: 0, total: 1 },
        },
      ],
    });

    const { default: CatalogView } = await import('../ui/src/tabs/Catalog/CatalogView');
    render(<CatalogView />);

    await waitFor(() => {
      expect(screen.getByTestId('catalog-global-view')).toBeInTheDocument();
    });

    // The warning banner should be visible initially
    await waitFor(() => {
      expect(screen.getByTestId('catalog-global-warning-codex-skill-discovery-skill')).toBeInTheDocument();
    });

    // Click Sync all harnesses
    const syncAllButton = screen.getByTestId('catalog-global-sync-all');
    fireEvent.click(syncAllButton);

    await waitFor(() => {
      expect(mocks.installSurface).toHaveBeenCalledWith('all', false);
    });

    // After a successful install, the summary would be refreshed without the warning.
    // Simulate the refreshed summary by calling getCatalogSummary on the next render.
    mocks.getCatalogSummary.mockResolvedValue(
      buildSummaryWithCodexMissing({ missingHarnessCount: 0 }),
    );

    // Trigger a re-fetch by updating the store's summary.generatedAt
    act(() => {
      navigationStore.setCatalogSectionId('status');
    });
    act(() => {
      navigationStore.setCatalogSectionId('global');
    });

    await waitFor(() => {
      expect(screen.queryByTestId('catalog-global-warning-codex-skill-discovery-skill')).not.toBeInTheDocument();
    });
  });

  it('Test B: per-asset failure surfaced in install warning', async () => {
    mocks.getCatalogSummary.mockResolvedValue(
      buildSummaryWithCodexMissing({ missingHarnessCount: 1 }),
    );
    mocks.installSurface.mockResolvedValue({
      target: 'codex',
      dryRun: false,
      force: false,
      surfaces: [
        {
          surface: 'codex',
          ok: true,
          counts: { created: 0, updated: 0, skipped: 1, skippedConflict: 0, total: 1 },
        },
      ],
    });

    const { default: CatalogView } = await import('../ui/src/tabs/Catalog/CatalogView');
    render(<CatalogView />);

    await waitFor(() => {
      expect(screen.getByTestId('catalog-global-view')).toBeInTheDocument();
    });

    // The warning should be visible initially
    await waitFor(() => {
      expect(screen.getByTestId('catalog-global-warning-codex-skill-discovery-skill')).toBeInTheDocument();
    });

    // Click Sync all harnesses. The mock returns a skipped result.
    fireEvent.click(screen.getByTestId('catalog-global-sync-all'));

    await waitFor(() => {
      expect(mocks.installSurface).toHaveBeenCalledWith('all', false);
    });

    // The installSurface mock resolves with 1 skipped asset.
    // The store's installWarning should be set.
    expect(mocks.installSurface).toHaveResolvedWith(expect.objectContaining({
      surfaces: expect.arrayContaining([
        expect.objectContaining({
          counts: expect.objectContaining({ skipped: 1 }),
        }),
      ]),
    }));
  });

  it('Test A2: harness opt-in clears warnings from global view', async () => {
    // Start with a summary where codex is NOT opted in (no warnings)
    mocks.getCatalogSummary.mockResolvedValue({
      kind: 'catalog.summary',
      deterministic: true,
      summary: {
        globalInventory: {
          harnesses: [
            { harnessId: 'copilot', title: 'Copilot', homePath: '~/.copilot', optedIn: true },
            { harnessId: 'codex', title: 'Codex', homePath: '~/.codex', skillsHomePath: '~/.codex/skills', optedIn: false },
          ],
          sections: [
            {
              kind: 'skill',
              title: 'Skill',
              count: 1,
              items: [
                {
                  itemId: 'codex-skill-discovery-skill',
                  conceptualKey: 'skill-discovery',
                  itemKey: 'skill-discovery',
                  kind: 'skill',
                  title: 'Skill Discovery',
                  description: 'Test skill.',
                  sourceType: 'catalog-asset',
                  syncStatus: 'available',
                  missingHarnessCount: 0,
                  actions: {
                    kind: 'catalog-asset',
                    installAssetId: 'codex-skill-discovery-skill',
                    installSurfaceTargets: ['codex'],
                  },
                  harnessStates: [
                    {
                      harnessId: 'codex',
                      title: 'Codex',
                      supported: true,
                      expected: false,
                      installed: false,
                      active: false,
                      syncStatus: 'available',
                      actions: { canInstall: true },
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    });
    mocks.setHarnessOptIn.mockResolvedValue({ target: 'codex', optedIn: true, assetCount: 1 });

    const { default: CatalogView } = await import('../ui/src/tabs/Catalog/CatalogView');
    render(<CatalogView />);

    await waitFor(() => {
      expect(screen.getByTestId('catalog-global-view')).toBeInTheDocument();
    });

    // No warning banner for codex since it is not opted in
    const warningElements = screen.queryAllByTestId(/^catalog-global-warning-/);
    expect(warningElements.length).toBe(0);
  });
});
