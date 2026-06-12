import { render, screen, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Hoist mocks for the API and store imports
const { fetchMock } = vi.hoisted(() => {
  const mockStore = {
    load: vi.fn(),
    state: {
      refreshing: false,
      error: null,
      installMessage: null,
      mutating: false,
    },
  };

  const mockCatalogWorkspaceStore = {
    refreshing: false,
    error: null,
    installMessage: null,
    mutating: false,
    activateExternalSourceInstallable: vi.fn(),
    deactivateExternalSourceInstallable: vi.fn(),
    installAsset: vi.fn(),
    installSurface: vi.fn(),
    uninstallHarnessAsset: vi.fn(),
  };

  return {
    fetchMock: vi.fn(),
    mockStore,
    mockCatalogWorkspaceStore,
  };
});

vi.mock('../ui/src/lib/api', () => ({
  getCatalogSummary: vi.fn().mockResolvedValue({
    summary: {
      globalInventory: {
        sections: [
          { kind: 'agent', title: 'agents', count: 2, items: [] },
          { kind: 'skill', title: 'skills', count: 3, items: [] },
        ],
        harnesses: [],
      },
      externalSources: [],
      updatedAt: new Date().toISOString(),
      source: 'mock',
    },
  }),
}));

vi.mock('../ui/src/lib/store', () => ({
  useStoreValue: vi.fn(() => ({ refreshing: false, error: null, installMessage: null, mutating: false })),
  createStore: vi.fn((initialState: any) => ({
    getState: () => initialState,
    setState: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
  })),
}));

vi.mock('../ui/src/tabs/Assets/catalogWorkspaceStore', () => ({
  catalogWorkspaceStore: {
    refreshing: false,
    error: null,
    installMessage: null,
    mutating: false,
    activateExternalSourceInstallable: vi.fn(),
    deactivateExternalSourceInstallable: vi.fn(),
    installAsset: vi.fn(),
    installSurface: vi.fn(),
    uninstallHarnessAsset: vi.fn(),
  },
}));

describe('CatalogShellView layout contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders catalog shell as a view-shell', async () => {
    const { default: CatalogShellView } = await import('../ui/src/views/Catalog/CatalogShellView');

    await act(async () => {
      render(<CatalogShellView />);
    });

    const shell = screen.getByTestId('catalog-shell-view');
    expect(shell).toBeInTheDocument();
    expect(shell.className).toContain('view-shell');
  });

  it('renders tabs outside catalog-shell-content', async () => {
    const { default: CatalogShellView } = await import('../ui/src/views/Catalog/CatalogShellView');

    await act(async () => {
      render(<CatalogShellView />);
    });

    const tabs = screen.getByTestId('assets-tools-tabs');
    const content = screen.getByTestId('catalog-shell-content');

    // Tabs should NOT be inside the scrollable content
    expect(content.contains(tabs)).toBe(false);
  });

  it('renders catalog-shell-content as a view-scroll region', async () => {
    const { default: CatalogShellView } = await import('../ui/src/views/Catalog/CatalogShellView');

    await act(async () => {
      render(<CatalogShellView />);
    });

    const content = screen.getByTestId('catalog-shell-content');
    expect(content).toBeInTheDocument();
    expect(content.className).toContain('view-scroll');
  });

  it('renders sticky header as a view-static region', async () => {
    const { default: CatalogShellView } = await import('../ui/src/views/Catalog/CatalogShellView');

    await act(async () => {
      render(<CatalogShellView />);
    });

    const header = screen.getByTestId('catalog-shell-sticky-header');
    expect(header).toBeInTheDocument();
    expect(header.className).toContain('view-static');
  });
});
