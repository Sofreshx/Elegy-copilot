import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { navigationStore } from '../ui/src/stores/navigation';

const apiMocks = vi.hoisted(() => ({
  getCatalogSummary: vi.fn(),
}));

vi.mock('../ui/src/lib/api', async () => {
  const actual = await vi.importActual('../ui/src/lib/api');
  return {
    ...actual,
    getCatalogSummary: apiMocks.getCatalogSummary,
  };
});

vi.mock('../ui/src/tabs/Catalog/CatalogView', () => ({
  default: () => <div data-testid="mock-catalog-view">Catalog view</div>,
}));

describe('CatalogShellView', () => {
  beforeEach(() => {
    navigationStore.reset();
    apiMocks.getCatalogSummary.mockReset();
  });

  it('renders the current catalog summary envelope stats', async () => {
    apiMocks.getCatalogSummary.mockResolvedValue({
      kind: 'catalog.summary',
      deterministic: true,
      summary: {
        globalInventory: {
          sections: [
            { kind: 'skill', title: 'Skill', count: 6, items: [] },
            { kind: 'agent', title: 'Agent', count: 2, items: [] },
            { kind: 'mcp', title: 'MCP', count: 1, items: [] },
          ],
        },
      },
    });

    const { default: CatalogShellView } = await import('../ui/src/views/Catalog/CatalogShellView');

    render(<CatalogShellView />);

    expect(screen.getByTestId('catalog-shell-view')).toBeInTheDocument();
    expect(screen.getByTestId('mock-catalog-view')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId('catalog-shell-summary')).toHaveTextContent(
        '6 skill, 2 agent, 1 mcp'
      );
    });
  });

  it('shows the unavailable state when summary loading fails', async () => {
    apiMocks.getCatalogSummary.mockRejectedValue(new Error('boom'));

    const { default: CatalogShellView } = await import('../ui/src/views/Catalog/CatalogShellView');

    render(<CatalogShellView />);

    await waitFor(() => {
      expect(screen.getByTestId('catalog-shell-summary')).toHaveTextContent('Catalog summary unavailable');
    });
  });
});
