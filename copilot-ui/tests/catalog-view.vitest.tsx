import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { navigationStore } from '../ui/src/stores/navigation';

const mocks = vi.hoisted(() => ({
  selectAsset: vi.fn(),
}));

vi.mock('../ui/src/tabs/Assets/catalogWorkspaceStore', () => ({
  catalogWorkspaceStore: {
    selectAsset: mocks.selectAsset,
  },
}));

vi.mock('../ui/src/tabs/Assets/AssetsView', () => ({
  default: () => <div data-testid="mock-assets-view">Assets view</div>,
}));

vi.mock('../ui/src/tabs/SkillsPreview/SkillsPreviewView', () => ({
  default: () => <div data-testid="mock-skills-view">Skills view</div>,
}));

vi.mock('../ui/src/tabs/Catalog/CatalogOverviewView', () => ({
  default: ({ onOpenSection, onEngageRuntime }: { onOpenSection: (section: 'agents') => void; onEngageRuntime: () => void }) => (
    <div data-testid="mock-overview-view">
      <button data-testid="mock-overview-open-agents" onClick={() => onOpenSection('agents')} type="button">
        Open agents
      </button>
      <button data-testid="mock-overview-engage-runtime" onClick={onEngageRuntime} type="button">
        Engage runtime
      </button>
    </div>
  ),
}));

vi.mock('../ui/src/tabs/Catalog/CatalogAgentsView', () => ({
  default: ({ onInspectAsset }: { onInspectAsset: (assetId: string) => Promise<void> | void }) => (
    <div data-testid="mock-agents-view">
      <button data-testid="mock-agents-inspect" onClick={() => void onInspectAsset('agent-superpowers-reviewer')} type="button">
        Inspect agent
      </button>
    </div>
  ),
}));

describe('CatalogView', () => {
  beforeEach(() => {
    navigationStore.reset();
    mocks.selectAsset.mockReset();
    mocks.selectAsset.mockResolvedValue(undefined);
  });

  it('defaults to Overview, exposes the frozen sections, and routes runtime/agent actions through the shell', async () => {
    const { default: CatalogView } = await import('../ui/src/tabs/Catalog/CatalogView');

    render(<CatalogView />);

    expect(screen.getByTestId('catalog-section-overview')).toHaveTextContent('Overview');
    expect(screen.getByTestId('catalog-section-assets')).toHaveTextContent('Assets');
    expect(screen.getByTestId('catalog-section-skills')).toHaveTextContent('Skills');
    expect(screen.getByTestId('catalog-section-agents')).toHaveTextContent('Agents');
    expect(screen.getByTestId('mock-overview-view')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('mock-overview-open-agents'));
    expect(screen.getByTestId('mock-agents-view')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('mock-agents-inspect'));
    await waitFor(() => {
      expect(mocks.selectAsset).toHaveBeenCalledWith('agent-superpowers-reviewer');
    });
    expect(screen.getByTestId('mock-assets-view')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('catalog-section-overview'));
    fireEvent.click(screen.getByTestId('mock-overview-engage-runtime'));
    expect(navigationStore.getState()).toMatchObject({
      activeTabId: 'home-runtime',
      runtimeSectionId: 'sessions',
    });
  });

  it('supports Catalog subsection deep links while keeping plain Catalog opens on Overview', async () => {
    navigationStore.goToCatalog('assets');

    const { default: CatalogView } = await import('../ui/src/tabs/Catalog/CatalogView');

    render(<CatalogView />);

    expect(screen.getByTestId('mock-assets-view')).toBeInTheDocument();
    expect(screen.getByTestId('catalog-section-assets')).toHaveClass('button-primary');

    act(() => {
      navigationStore.goToCatalog();
    });
    expect(screen.getByTestId('mock-overview-view')).toBeInTheDocument();

    act(() => {
      navigationStore.goToCatalog('agents');
    });
    expect(screen.getByTestId('mock-agents-view')).toBeInTheDocument();

    act(() => {
      navigationStore.setActiveTabId('catalog');
    });
    expect(screen.getByTestId('mock-overview-view')).toBeInTheDocument();
  });
});
