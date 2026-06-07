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
        'Explore, install, sync, and verify agents, skills, hooks, plugins, and external MCP tools.',
      ),
    ).toBeInTheDocument();

    expect(
      screen.getByTestId('assets-tools-refresh'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('assets-tools-add-tool'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('assets-tools-sync-harnesses'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('assets-tools-repository-view'),
    ).toBeInTheDocument();
  });

  // ---- NEW: metric cards ----

  it('renders metric cards with correct values', async () => {
    const sections = [
      {
        kind: 'skill',
        title: 'Skill',
        count: 6,
        items: [
          makeItem({ itemId: 's1', kind: 'skill' }),
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

    // Agent metric
    expect(
      screen.getByTestId('assets-tools-metric-Agents'),
    ).toHaveTextContent('2');
    // Skill metric
    expect(
      screen.getByTestId('assets-tools-metric-Skills'),
    ).toHaveTextContent('2');
    // Hooks metric — no hook items → "Coming soon"
    expect(
      screen.getByTestId('assets-tools-metric-Hooks'),
    ).toHaveTextContent('Coming soon');
    // Plugins metric
    expect(
      screen.getByTestId('assets-tools-metric-Plugins'),
    ).toHaveTextContent('0');
    // External Tools metric — 1 mcp item + 0 external installables
    expect(
      screen.getByTestId('assets-tools-metric-External Tools'),
    ).toHaveTextContent('1');
    // Harnesses synced — 3 opted in
    expect(
      screen.getByTestId('assets-tools-metric-Harnesses synced'),
    ).toHaveTextContent('3');
  });

  // ---- NEW: three-column explorer ----

  it('renders the three-column explorer layout', async () => {
    apiMocks.getCatalogSummary.mockResolvedValue(
      makeBasicSummary(getDefaultSectionsWithItems(), []),
    );

    const { default: CatalogShellView } = await import(
      '../ui/src/views/Catalog/CatalogShellView'
    );
    render(<CatalogShellView />);

    await waitFor(() => {
      expect(
        screen.getByTestId('assets-tools-explorer'),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByTestId('assets-tools-filters'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('assets-tools-list'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('assets-tools-inspector'),
    ).toBeInTheDocument();
  });

  // ---- NEW: grouped items ----

  it('renders grouped items in the center list', async () => {
    apiMocks.getCatalogSummary.mockResolvedValue(
      makeBasicSummary(getDefaultSectionsWithItems(), []),
    );

    const { default: CatalogShellView } = await import(
      '../ui/src/views/Catalog/CatalogShellView'
    );
    render(<CatalogShellView />);

    await waitFor(() => {
      expect(
        screen.getByTestId('assets-tools-group-core-agents'),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByTestId('assets-tools-group-shared-skills'),
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

  // ---- NEW: filter by type chip ----

  it('filters items by type chip selection', async () => {
    apiMocks.getCatalogSummary.mockResolvedValue(
      makeBasicSummary(getDefaultSectionsWithItems(), []),
    );

    const { default: CatalogShellView } = await import(
      '../ui/src/views/Catalog/CatalogShellView'
    );
    render(<CatalogShellView />);

    // wait for items to render
    await waitFor(() => {
      expect(
        screen.getByTestId('assets-tools-item-skill-1'),
      ).toBeInTheDocument();
    });

    // Both groups visible initially
    expect(
      screen.getByTestId('assets-tools-group-shared-skills'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('assets-tools-group-core-agents'),
    ).toBeInTheDocument();

    // Click the 'agent' type chip
    fireEvent.click(screen.getByTestId('assets-tools-filter-type-agent'));

    // Skill group should be gone (0 items after filter), agent group remains
    await waitFor(() => {
      expect(
        screen.queryByTestId('assets-tools-group-shared-skills'),
      ).toBeNull();
    });
    expect(
      screen.getByTestId('assets-tools-group-core-agents'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('assets-tools-item-agent-1'),
    ).toBeInTheDocument();
  });

  // ---- NEW: filter by search text ----

  it('filters items by search text', async () => {
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

    const searchInput = screen.getByTestId('catalog-shell-search');
    fireEvent.change(searchInput, { target: { value: 'Build' } });

    await waitFor(() => {
      // Only the Build Agent item matches
      expect(
        screen.queryByTestId('assets-tools-item-skill-1'),
      ).toBeNull();
    });
    expect(
      screen.getByTestId('assets-tools-item-agent-1'),
    ).toBeInTheDocument();
  });

  // ---- NEW: select item and show inspector ----

  it('selects an item and shows inspector details', async () => {
    apiMocks.getCatalogSummary.mockResolvedValue(
      makeBasicSummary(getDefaultSectionsWithItems(), []),
    );

    const { default: CatalogShellView } = await import(
      '../ui/src/views/Catalog/CatalogShellView'
    );
    render(<CatalogShellView />);

    // The component auto-selects the first item (needs-attention or first in list)
    await waitFor(() => {
      expect(
        screen.getByTestId('assets-tools-inspector'),
      ).toBeInTheDocument();
    });

    // Wait for auto-select: the component picks the first item once summary loads.
    // Title appears in both item card <span> and inspector <h3>, so use getAllByText.
    await waitFor(() => {
      expect(
        screen.getAllByText('Default description').length,
      ).toBeGreaterThanOrEqual(1);
    });
    expect(
      screen.getAllByText('Code Review').length,
    ).toBeGreaterThanOrEqual(1);

    // Click a different item and verify the inspector updates
    fireEvent.click(screen.getByTestId('assets-tools-item-agent-1'));

    await waitFor(() => {
      expect(
        screen.getAllByText('Automates build workflows').length,
      ).toBeGreaterThanOrEqual(1);
    });
    expect(
      screen.getAllByText('Build Agent').length,
    ).toBeGreaterThanOrEqual(1);
  });

  // ---- NEW: hooks group empty state ----

  it('shows no hooks group when no hooks exist', async () => {
    // Our default sections have skill, agent — NO hooks
    apiMocks.getCatalogSummary.mockResolvedValue(
      makeBasicSummary(getDefaultSectionsWithItems(), []),
    );

    const { default: CatalogShellView } = await import(
      '../ui/src/views/Catalog/CatalogShellView'
    );
    render(<CatalogShellView />);

    await waitFor(() => {
      expect(
        screen.getByTestId('assets-tools-group-shared-skills'),
      ).toBeInTheDocument();
    });

    // Hooks group should not exist in the DOM
    expect(
      screen.queryByTestId('assets-tools-group-hooks'),
    ).toBeNull();
  });

  // ---- NEW: add tool panel and submit ----

  it('opens add tool panel and submits MCP source', async () => {
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

    // Click Add Tool button — should show the panel
    fireEvent.click(screen.getByTestId('assets-tools-add-tool'));

    await waitFor(() => {
      expect(
        screen.getByTestId('assets-tools-add-panel'),
      ).toBeInTheDocument();
    });

    // Fill in the URL field (the input has testId + '-control')
    const urlInput = screen.getByTestId('assets-tools-add-panel-url-control');
    fireEvent.change(urlInput, {
      target: { value: 'https://github.com/owner/mcp-tool' },
    });

    // Click submit
    fireEvent.click(screen.getByTestId('assets-tools-add-panel-submit'));

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
