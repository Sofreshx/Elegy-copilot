import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { navigationStore } from '../ui/src/stores/navigation';

/* ------------------------------------------------------------------ */
/*  Hoisted mocks                                                     */
/* ------------------------------------------------------------------ */

const apiMocks = vi.hoisted(() => ({
  getCatalogSummary: vi.fn(),
}));

const storeMocks = vi.hoisted(() => ({
  addExternalSource: vi.fn().mockResolvedValue(undefined),
  installAll: vi.fn().mockResolvedValue(undefined),
}));

/* ------------------------------------------------------------------ */
/*  Module mocks                                                      */
/* ------------------------------------------------------------------ */

vi.mock('../ui/src/lib/api', () => ({
  getCatalogSummary: apiMocks.getCatalogSummary,
  getCatalogContent: vi.fn().mockResolvedValue('(mock content)'),
}));

vi.mock('../ui/src/tabs/Assets/catalogWorkspaceStore', () => ({
  catalogWorkspaceStore: {
    getState: (() => {
      const state = {
        summary: null,
        installing: false,
        refreshing: false,
        mutating: false,
        installMessage: null,
      };
      return () => state;
    })(),
    subscribe: () => () => {},
    installSurface: vi.fn().mockResolvedValue(undefined),
    installAsset: vi.fn().mockResolvedValue(undefined),
    activateExternalSourceInstallable: vi.fn().mockResolvedValue(undefined),
    deactivateExternalSourceInstallable: vi.fn().mockResolvedValue(undefined),
    addExternalSource: storeMocks.addExternalSource,
    installAll: storeMocks.installAll,
    refreshWorkspace: vi.fn().mockResolvedValue(undefined),
    loadWorkspace: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../ui/src/views/Catalog/CatalogIcon', () => ({
  default: ({ name }: { name: string }) => (
    <span data-testid={`icon-${name}`}>[{name}]</span>
  ),
}));

vi.mock('../ui/src/tabs/Assets/AssetsView', () => ({
  default: () => <div data-testid="mock-assets-view">Repository view</div>,
}));

/* ------------------------------------------------------------------ */
/*  Test data helpers                                                 */
/* ------------------------------------------------------------------ */

function makeItem(overrides: Record<string, unknown> = {}) {
  return {
    itemId: 'item-default',
    title: 'Default Item',
    description: 'Default description',
    kind: 'skill',
    sourceType: 'shipped',
    sourceId: 'elegy',
    providerId: 'elegy',
    itemKey: 'default-key',
    harnessStates: [],
    ...overrides,
  };
}

function makeBasicSummary(sections: unknown[], harnesses: unknown[] = []) {
  return {
    summary: {
      globalInventory: { sections, harnesses },
      externalSources: [],
    },
  };
}

function getDefaultSectionsWithItems() {
  return [
    {
      kind: 'skill',
      title: 'Skill',
      count: 2,
      items: [
        makeItem({
          itemId: 'skill-1',
          title: 'Code Review',
          kind: 'skill',
          harnessStates: [
            {
              harnessId: 'copilot',
              title: 'Copilot',
              syncStatus: 'synced',
              active: true,
              installed: true,
              supported: true,
              expected: true,
            },
          ],
        }),
        makeItem({
          itemId: 'skill-2',
          title: 'Terminal Skill',
          kind: 'skill',
        }),
      ],
    },
    {
      kind: 'agent',
      title: 'Agent',
      count: 1,
      items: [
        makeItem({
          itemId: 'agent-1',
          title: 'Build Agent',
          kind: 'agent',
          description: 'Automates build workflows',
        }),
      ],
    },
  ];
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe('CatalogShellView', () => {
  beforeEach(() => {
    navigationStore.reset();
    apiMocks.getCatalogSummary.mockReset();
    storeMocks.addExternalSource.mockClear();
    storeMocks.installAll.mockClear();
  });

  // ---- adapted existing: shell renders ----

  it('renders the catalog-shell-view container', async () => {
    apiMocks.getCatalogSummary.mockResolvedValue(
      makeBasicSummary(getDefaultSectionsWithItems(), []),
    );

    const { default: CatalogShellView } = await import(
      '../ui/src/views/Catalog/CatalogShellView'
    );
    render(<CatalogShellView />);

    expect(screen.getByTestId('catalog-shell-view')).toBeInTheDocument();
  });

  // ---- adapted existing: summary loads and shows text ----

  it('loads catalog summary and displays item counts', async () => {
    const sections = [
      { kind: 'skill', title: 'Skill', count: 6, items: [] },
      { kind: 'agent', title: 'Agent', count: 2, items: [] },
      { kind: 'mcp', title: 'MCP', count: 1, items: [] },
    ];
    apiMocks.getCatalogSummary.mockResolvedValue(
      makeBasicSummary(sections, []),
    );

    const { default: CatalogShellView } = await import(
      '../ui/src/views/Catalog/CatalogShellView'
    );
    render(<CatalogShellView />);

    await waitFor(() => {
      expect(
        screen.getByTestId('catalog-shell-summary'),
      ).toHaveTextContent('6 skill · 2 agent · 1 mcp');
    });
  });

  // ---- adapted existing: error state ----

  it('shows "Catalog summary unavailable" when the API call fails', async () => {
    // Use a non-Error rejection so toErrorMessage falls through to the fallback
    apiMocks.getCatalogSummary.mockRejectedValue('Network error');

    const { default: CatalogShellView } = await import(
      '../ui/src/views/Catalog/CatalogShellView'
    );
    render(<CatalogShellView />);

    await waitFor(() => {
      expect(
        screen.getByTestId('catalog-shell-summary'),
      ).toHaveTextContent('Catalog summary unavailable');
    });
  });

  // ---- NEW: header with action buttons ----

  it('renders the Assets & Tools header with action buttons', async () => {
    apiMocks.getCatalogSummary.mockResolvedValue(
      makeBasicSummary(getDefaultSectionsWithItems(), []),
    );

    const { default: CatalogShellView } = await import(
      '../ui/src/views/Catalog/CatalogShellView'
    );
    render(<CatalogShellView />);

    await waitFor(() => {
      expect(screen.getByText('Assets & Tools')).toBeInTheDocument();
    });

    expect(
      screen.getByText(
        'Understand, verify, and repair Elegy-managed resources across every harness.',
      ),
    ).toBeInTheDocument();

    expect(
      screen.getByTestId('assets-tools-refresh'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('assets-tools-repair-issues'),
    ).toBeInTheDocument();
    // Tab bar should be visible
    expect(
      screen.getByTestId('assets-tools-tabs'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('assets-tools-tab-inventory'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('assets-tools-tab-sources'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('assets-tools-tab-overview')).toBeInTheDocument();
    expect(screen.queryByTestId('assets-tools-tab-codex')).not.toBeInTheDocument();
  });

  // ---- NEW: metric cards ----

  it('renders metric cards with correct values', async () => {
    const sections = [
      {
        kind: 'skill',
        title: 'Skill',
        count: 6,
        items: [
          makeItem({
            itemId: 's1',
            kind: 'skill',
            harnessStates: [
              { harnessId: 'codex', supported: true, expected: true, installed: true, active: true, syncStatus: 'synced' },
              { harnessId: 'claude', supported: true, expected: false, installed: false, active: false, syncStatus: 'available' },
            ],
          }),
          makeItem({ itemId: 's2', kind: 'skill' }),
        ],
      },
      {
        kind: 'agent',
        title: 'Agent',
        count: 2,
        items: [
          makeItem({ itemId: 'a1', kind: 'agent' }),
          makeItem({ itemId: 'a2', kind: 'agent' }),
        ],
      },
      {
        kind: 'mcp',
        title: 'MCP',
        count: 1,
        items: [makeItem({ itemId: 'm1', kind: 'mcp' })],
      },
    ];
    const harnesses = [
      { harnessId: 'h1', title: 'Copilot', optedIn: true },
      { harnessId: 'h2', title: 'Codex', optedIn: true },
      { harnessId: 'h3', title: 'OpenCode', optedIn: true },
    ];
    apiMocks.getCatalogSummary.mockResolvedValue(
      makeBasicSummary(sections, harnesses),
    );

    const { default: CatalogShellView } = await import(
      '../ui/src/views/Catalog/CatalogShellView'
    );
    render(<CatalogShellView />);

    await waitFor(() => {
      expect(
        screen.getByTestId('assets-tools-metrics'),
      ).toBeInTheDocument();
    });

    // Health-oriented metrics replace decorative kind totals.
    expect(
      screen.getByTestId('assets-tools-metric-Needs attention'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('assets-tools-metric-Healthy'),
    ).toHaveTextContent('1');
    expect(
      screen.getByTestId('assets-tools-metric-Not installed'),
    ).toHaveTextContent('0');
    expect(
      screen.getByTestId('assets-tools-metric-External'),
    ).toBeInTheDocument();
  });

  // ---- NEW: three-pane inventory layout ----

  it('renders the inventory list and opens details in a drawer', async () => {
    apiMocks.getCatalogSummary.mockResolvedValue(
      makeBasicSummary(getDefaultSectionsWithItems(), []),
    );

    const { default: CatalogShellView } = await import(
      '../ui/src/views/Catalog/CatalogShellView'
    );
    render(<CatalogShellView />);

    await waitFor(() => {
      expect(
        screen.getByTestId('assets-tools-inventory'),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByTestId('assets-tools-group-list'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('asset-detail-drawer')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('assets-tools-item-skill-1'));
    expect(screen.getByTestId('asset-detail-drawer')).toBeInTheDocument();
    expect(screen.getByTestId('assets-tools-reader')).toBeInTheDocument();
  });

  // ---- NEW: provenance-based grouped items ----

  it('renders items grouped by provenance in the left pane', async () => {
    apiMocks.getCatalogSummary.mockResolvedValue(
      makeBasicSummary(getDefaultSectionsWithItems(), []),
    );

    const { default: CatalogShellView } = await import(
      '../ui/src/views/Catalog/CatalogShellView'
    );
    render(<CatalogShellView />);

    await waitFor(() => {
      expect(
        screen.getByTestId('assets-tools-item-skill-1'),
      ).toBeInTheDocument();
    });

    // Default test items have sourceId 'elegy', which falls to "User / repo / external"
    expect(
      screen.getByTestId('assets-tools-prov-group-user-repo-external'),
    ).toBeInTheDocument();

    // Each item card is present
    expect(
      screen.getByTestId('assets-tools-item-skill-1'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('assets-tools-item-skill-2'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('assets-tools-item-agent-1'),
    ).toBeInTheDocument();
  });

  // ---- NEW: tab navigation ----

  it('navigates between tabs', async () => {
    apiMocks.getCatalogSummary.mockResolvedValue(
      makeBasicSummary(getDefaultSectionsWithItems(), []),
    );

    const { default: CatalogShellView } = await import(
      '../ui/src/views/Catalog/CatalogShellView'
    );
    render(<CatalogShellView />);

    await waitFor(() => {
      expect(
        screen.getByTestId('assets-tools-inventory'),
      ).toBeInTheDocument();
    });

    // Switch to Operations tab
    fireEvent.click(screen.getByTestId('assets-tools-tab-operations'));

    await waitFor(() => {
      expect(
        screen.getByTestId('assets-tools-operations'),
      ).toBeInTheDocument();
    });

    // Switch back to Inventory
    fireEvent.click(screen.getByTestId('assets-tools-tab-inventory'));

    await waitFor(() => {
      expect(
        screen.getByTestId('assets-tools-inventory'),
      ).toBeInTheDocument();
    });
  });

  // ---- NEW: select item and show reader + status rail ----

  it('selects an item and shows readable drawer details', async () => {
    apiMocks.getCatalogSummary.mockResolvedValue(
      makeBasicSummary(getDefaultSectionsWithItems(), []),
    );

    const { default: CatalogShellView } = await import(
      '../ui/src/views/Catalog/CatalogShellView'
    );
    render(<CatalogShellView />);

    await waitFor(() => {
      expect(
        screen.getByTestId('assets-tools-item-skill-1'),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('assets-tools-item-skill-1'));
    expect(screen.getByTestId('asset-detail-drawer')).toBeInTheDocument();

    // Title appears in both item card and reader — use getAllByText
    await waitFor(() => {
      expect(
        screen.getAllByText('Default description').length,
      ).toBeGreaterThanOrEqual(1);
    });
    expect(
      screen.getAllByText('Code Review').length,
    ).toBeGreaterThanOrEqual(1);

    // Click a different item and verify the drawer updates
    fireEvent.click(screen.getByTestId('assets-tools-item-agent-1'));

    await waitFor(() => {
      expect(
        screen.getAllByText('Build Agent').length,
      ).toBeGreaterThanOrEqual(1);
    });
  });

  // ---- NEW: inventory tab shows provenance groups ----

  it('renders inventory tab with provenance-based groups', async () => {
    // Our default sections have skill (elegy sourceId) and agent
    apiMocks.getCatalogSummary.mockResolvedValue(
      makeBasicSummary(getDefaultSectionsWithItems(), []),
    );

    const { default: CatalogShellView } = await import(
      '../ui/src/views/Catalog/CatalogShellView'
    );
    render(<CatalogShellView />);

    await waitFor(() => {
      expect(
        screen.getByTestId('assets-tools-inventory'),
      ).toBeInTheDocument();
    });

    // The default items have sourceId 'elegy' which doesn't match any known root,
    // so they should appear in the "User / repo / external" group
    expect(
      screen.getByTestId('assets-tools-prov-group-user-repo-external'),
    ).toBeInTheDocument();
  });

  // ---- NEW: sources tab add tool panel and submit ----

  it('opens add source panel from Sources tab and submits', async () => {
    apiMocks.getCatalogSummary.mockResolvedValue(
      makeBasicSummary(getDefaultSectionsWithItems(), []),
    );

    const { default: CatalogShellView } = await import(
      '../ui/src/views/Catalog/CatalogShellView'
    );
    render(<CatalogShellView />);

    await waitFor(() => {
      expect(screen.getByTestId('catalog-shell-view')).toBeInTheDocument();
    });

    // Navigate to Sources tab
    fireEvent.click(screen.getByTestId('assets-tools-tab-sources'));

    await waitFor(() => {
      expect(screen.getByTestId('assets-tools-sources')).toBeInTheDocument();
    });

    // Click "Add Source" button in the Sources tab
    fireEvent.click(screen.getByTestId('sources-add-tool'));

    await waitFor(() => {
      expect(
        screen.getByTestId('assets-tools-add-panel'),
      ).toBeInTheDocument();
    });

    // Fill in the URL field
    const urlInput = screen.getByTestId('sources-add-url-control');
    fireEvent.change(urlInput, {
      target: { value: 'https://github.com/owner/mcp-tool' },
    });

    // Click submit
    fireEvent.click(screen.getByTestId('sources-add-submit'));

    await waitFor(() => {
      expect(storeMocks.addExternalSource).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://github.com/owner/mcp-tool',
        }),
      );
    });
  });

  // ---- NEW: refresh button ----

  it('calls getCatalogSummary again when Refresh is clicked', async () => {
    apiMocks.getCatalogSummary.mockResolvedValue(
      makeBasicSummary(getDefaultSectionsWithItems(), []),
    );

    const { default: CatalogShellView } = await import(
      '../ui/src/views/Catalog/CatalogShellView'
    );
    render(<CatalogShellView />);

    await waitFor(() => {
      expect(screen.getByTestId('catalog-shell-view')).toBeInTheDocument();
    });

    // Clear the initial call counter
    apiMocks.getCatalogSummary.mockClear();

    // Click refresh
    fireEvent.click(screen.getByTestId('assets-tools-refresh'));

    await waitFor(() => {
      expect(apiMocks.getCatalogSummary).toHaveBeenCalled();
    });
  });
});
