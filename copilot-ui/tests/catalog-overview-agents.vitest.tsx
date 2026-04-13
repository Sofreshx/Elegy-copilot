import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storeMocks = vi.hoisted(() => ({
  loadWorkspace: vi.fn(),
  loadSkills: vi.fn(),
}));

const mockCatalogState = {
  loading: false,
  refreshing: false,
  mutating: false,
  error: null,
  summaryError: null,
  activeRepoPath: 'C:\\repo',
  assets: [
    {
      assetId: 'agent-superpowers-reviewer',
      assetKey: 'superpowers-reviewer',
      kind: 'agent',
      installed: true,
      enabled: true,
      selectedEntry: {
        assetId: 'agent-superpowers-reviewer',
        kind: 'agent',
        title: 'Superpowers Reviewer',
        description: 'Provider-backed review agent.',
        metadata: {
          provider: 'superpowers-copilot',
          sourcePackage: 'dwaintr-superpowers-copilot',
          namespace: 'superpowers',
          readOnly: true,
        },
        provenance: {
          providerId: 'superpowers-copilot',
        },
      },
    },
    {
      assetId: 'agent-local-helper',
      assetKey: 'local-helper',
      kind: 'agent',
      installed: true,
      enabled: true,
      selectedEntry: {
        assetId: 'agent-local-helper',
        kind: 'agent',
        title: 'Local Helper',
        description: 'Locally authored helper.',
        metadata: {},
      },
    },
  ],
  bundles: [
    {
      bundleId: 'balanced-default',
      title: 'Balanced Default',
    },
  ],
  runtimeHealth: {
    ok: true,
    projection: {
      readMode: 'persisted-snapshot',
    },
  },
  summary: {
    generatedAt: '2026-03-14T12:00:00.000Z',
    readMode: 'persisted-snapshot',
    activation: {
      managedImportProviderIds: ['superpowers-copilot'],
    },
    stats: {
      effectiveCount: 4,
      installedCount: 3,
      byKind: {
        agent: 2,
      },
    },
    providers: [
      {
        providerId: 'superpowers-copilot',
        title: 'Superpowers for GitHub Copilot',
        description: 'External capability pack for provider-backed skills and agents.',
        installStrategy: 'managed-import',
        discoveredAssets: {
          count: 3,
          byKind: {
            skill: 2,
            agent: 1,
          },
        },
        state: {
          installed: true,
        },
      },
    ],
  },
  repoInventory: {
    selectedRepo: {
      repoId: 'repo-1',
      repoLabel: 'repo',
      repoPath: 'C:\\repo',
    },
    repos: [],
  },
};

const mockSkillsState = {
  skills: [
    {
      assetId: 'skill-superpowers-brainstorming',
      name: 'brainstorming',
      kind: 'full',
      provider: 'superpowers-copilot',
      namespace: 'superpowers',
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

vi.mock('../ui/src/tabs/Assets/catalogWorkspaceStore', () => ({
  catalogWorkspaceStore: {
    getState: () => mockCatalogState,
    subscribe: () => () => {},
    loadWorkspace: storeMocks.loadWorkspace,
  },
}));

vi.mock('../ui/src/tabs/SkillsPreview/skillsPreviewStore', () => ({
  skillsPreviewStore: {
    getState: () => mockSkillsState,
    subscribe: () => () => {},
    loadSkills: storeMocks.loadSkills,
  },
}));

describe('Catalog overview and agents surfaces', () => {
  beforeEach(() => {
    storeMocks.loadWorkspace.mockReset();
    storeMocks.loadSkills.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('renders Catalog Overview with summary metrics, context panel, and navigation actions', async () => {
    const openSection = vi.fn();
    const engageRuntime = vi.fn();
    const { default: CatalogOverviewView } = await import('../ui/src/tabs/Catalog/CatalogOverviewView');

    render(<CatalogOverviewView onEngageRuntime={engageRuntime} onOpenSection={openSection} />);

    expect(storeMocks.loadWorkspace).toHaveBeenCalledTimes(1);
    expect(storeMocks.loadSkills).toHaveBeenCalledTimes(1);

    // Summary metrics are surfaced
    expect(screen.getByTestId('catalog-overview-effective-count')).toHaveTextContent('4');
    expect(screen.getByTestId('catalog-overview-installed-count')).toHaveTextContent('3');
    expect(screen.getByTestId('catalog-overview-skill-count')).toHaveTextContent('1');
    expect(screen.getByTestId('catalog-overview-agent-count')).toHaveTextContent('2');

    // Context panel shows projection state
    expect(screen.getByTestId('catalog-overview-context-panel')).toHaveTextContent('persisted-snapshot');
    expect(screen.getByTestId('catalog-overview-context-panel')).toHaveTextContent('superpowers-copilot');

    // Navigation buttons route into dedicated sections
    fireEvent.click(screen.getByTestId('catalog-overview-open-assets'));
    expect(openSection).toHaveBeenCalledWith('assets');

    fireEvent.click(screen.getByTestId('catalog-overview-open-skills'));
    expect(openSection).toHaveBeenCalledWith('skills');

    fireEvent.click(screen.getByTestId('catalog-overview-open-agents'));
    expect(openSection).toHaveBeenCalledWith('agents');
  });

  it('shows provider-qualified agent identity and engagement entry points on the Agents surface', async () => {
    const inspectAsset = vi.fn();
    const openSection = vi.fn();
    const engageRuntime = vi.fn();
    const { default: CatalogAgentsView } = await import('../ui/src/tabs/Catalog/CatalogAgentsView');

    render(
      <CatalogAgentsView
        onEngageRuntime={engageRuntime}
        onInspectAsset={inspectAsset}
        onOpenSection={openSection}
      />
    );

    expect(storeMocks.loadWorkspace).toHaveBeenCalledTimes(1);

    // Agent inventory renders both agents
    expect(screen.getByText('Superpowers Reviewer')).toBeInTheDocument();
    expect(screen.getByText('Local Helper')).toBeInTheDocument();

    // Provider-qualified identity is visible on provider-backed agents
    expect(screen.getAllByText(/superpowers-copilot/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/read-only/).length).toBeGreaterThan(0);

    // Agent card inspect and engage actions work
    const featuredAgentCard = screen.getByText('Superpowers Reviewer').closest('.catalog-agent-card');
    expect(featuredAgentCard).not.toBeNull();

    fireEvent.click(within(featuredAgentCard as HTMLElement).getByTestId('catalog-agent-inspect'));
    expect(inspectAsset).toHaveBeenCalledWith('agent-superpowers-reviewer');

    fireEvent.click(within(featuredAgentCard as HTMLElement).getByTestId('catalog-agent-engage'));
    expect(engageRuntime).toHaveBeenCalledTimes(1);
  });
});
