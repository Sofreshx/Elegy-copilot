import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function createMockStore<T>(initialState: T) {
  let state = initialState;
  const listeners = new Set<() => void>();

  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setState: (nextState: T) => {
      state = nextState;
      listeners.forEach((listener) => listener());
    },
  };
}

const planningStoreMocks = vi.hoisted(() => ({
  createActionRequest: vi.fn(),
}));

const planningWorkspaceMocks = vi.hoisted(() => ({
  createBullet: vi.fn(),
  store: createMockStore({
    planningBulletsFile: {
      filePath: 'C:\\Repos\\instruction-engine\\docs\\planning\\bullets.md',
      repoRelativePath: 'docs/planning/bullets.md',
    },
    bulletsError: null as string | null,
  }),
}));

vi.mock('../ui/src/tabs/Planning/planningStore', () => ({
  planningStore: {
    ...planningStoreMocks,
  },
}));

vi.mock('../ui/src/tabs/Planning/planningWorkspaceStore', () => ({
  planningWorkspaceStore: {
    ...planningWorkspaceMocks.store,
    createBullet: planningWorkspaceMocks.createBullet,
  },
}));

describe('PlanningIdeasPanel', () => {
  beforeEach(() => {
    planningStoreMocks.createActionRequest.mockReset();
    planningWorkspaceMocks.createBullet.mockReset();
    planningWorkspaceMocks.store.setState({
      planningBulletsFile: {
        filePath: 'C:\\Repos\\instruction-engine\\docs\\planning\\bullets.md',
        repoRelativePath: 'docs/planning/bullets.md',
      },
      bulletsError: null,
    });
    planningStoreMocks.createActionRequest.mockResolvedValue(null);
    planningWorkspaceMocks.createBullet.mockResolvedValue(null);
  });

  it('keeps bullet capture visible but blocks repo-file writes until a Catalog repo is selected', async () => {
    const onOpenCatalogAssets = vi.fn();
    const { default: PlanningIdeasPanel } = await import('../ui/src/tabs/Planning/PlanningIdeasPanel');

    render(
      <PlanningIdeasPanel
        onOpenCatalogAssets={onOpenCatalogAssets}
        planningState={{
          catalogRepoContext: null,
          creating: false,
          error: null,
          statusMessage: null,
        } as never}
      />
    );

    expect(screen.getByTestId('planning-bullet-intake')).toBeInTheDocument();
    expect(screen.getByText(/No Catalog repo is selected yet/i)).toBeInTheDocument();
    expect(screen.getByTestId('planning-create-bullet')).toBeDisabled();
    expect(screen.getByTestId('planning-action-workflows-panel')).toHaveTextContent(
      /docs\/planning\/intake\/\*\.json/i
    );

    fireEvent.click(screen.getByTestId('planning-open-catalog-assets-bullets'));
    expect(onOpenCatalogAssets).toHaveBeenCalled();
  });

  it('creates repo bullets in docs/planning/bullets.md for the selected Catalog repo', async () => {
    planningWorkspaceMocks.createBullet.mockResolvedValueOnce({
      id: 'PB-001',
      title: 'Clarify roadmap hierarchy',
    });

    const onBulletCreated = vi.fn();
    const { default: PlanningIdeasPanel } = await import('../ui/src/tabs/Planning/PlanningIdeasPanel');

    render(
      <PlanningIdeasPanel
        onBulletCreated={onBulletCreated}
        planningState={{
          catalogRepoContext: {
            repoId: 'repo-1',
            repoLabel: 'Instruction Engine',
            repoPath: 'C:\\Repos\\instruction-engine',
            sources: ['workspace', 'selected'],
          },
          creating: false,
          error: null,
          statusMessage: null,
        } as never}
      />
    );

    expect(screen.getByTestId('planning-bullet-composer-panel')).toHaveTextContent('docs/planning/bullets.md');
    expect(screen.getByTestId('planning-bullet-composer-file-path')).toHaveTextContent(
      'C:\\Repos\\instruction-engine\\docs\\planning\\bullets.md'
    );

    fireEvent.change(screen.getByTestId('planning-bullet-title'), {
      target: { value: 'Clarify roadmap hierarchy' },
    });
    fireEvent.change(screen.getByTestId('planning-bullet-state'), {
      target: { value: 'research' },
    });
    fireEvent.change(screen.getByTestId('planning-bullet-summary'), {
      target: { value: 'Explain roadmap above backlog above plans.' },
    });
    fireEvent.change(screen.getByTestId('planning-bullet-notes'), {
      target: { value: '- Show repo context first\n- Keep bullets browse-first' },
    });
    fireEvent.click(screen.getByTestId('planning-create-bullet'));

    await waitFor(() =>
      expect(planningWorkspaceMocks.createBullet).toHaveBeenCalledWith({
        title: 'Clarify roadmap hierarchy',
        state: 'research',
        summary: 'Explain roadmap above backlog above plans.',
        notes: ['- Keep bullets browse-first', '- Show repo context first'],
      })
    );
    expect(onBulletCreated).toHaveBeenCalled();
  });

  it('creates explicit audit and roadmap request artifacts from the typed intake lane', async () => {
    planningStoreMocks.createActionRequest
      .mockResolvedValueOnce('PI-101')
      .mockResolvedValueOnce('PI-102');

    const onIntakeArtifactCreated = vi.fn();
    const { default: PlanningIdeasPanel } = await import('../ui/src/tabs/Planning/PlanningIdeasPanel');

    render(
      <PlanningIdeasPanel
        onIntakeArtifactCreated={onIntakeArtifactCreated}
        planningState={{
          catalogRepoContext: {
            repoId: 'repo-1',
            repoLabel: 'Instruction Engine',
            repoPath: 'C:\\Repos\\instruction-engine',
            sources: ['workspace', 'selected'],
          },
          creating: false,
          error: null,
          statusMessage: null,
        } as never}
      />
    );

    fireEvent.change(screen.getByTestId('planning-prep-title'), {
      target: { value: 'Prepare Planning tab changes' },
    });
    fireEvent.change(screen.getByTestId('planning-prep-notes'), {
      target: { value: 'Focus on validation notes and commit summary wording.' },
    });

    fireEvent.click(screen.getByTestId('planning-create-audit-request'));
    await waitFor(() => expect(planningStoreMocks.createActionRequest).toHaveBeenCalledWith('audit-request', {
      title: 'Prepare Planning tab changes',
      notes: 'Focus on validation notes and commit summary wording.',
      targetRepoIds: ['repo-1'],
      saveRepoId: 'repo-1',
    }));

    fireEvent.change(screen.getByTestId('planning-prep-title'), {
      target: { value: 'Generate roadmap proposal for Planning tab summary' },
    });
    fireEvent.click(screen.getByTestId('planning-create-roadmap-request'));

    await waitFor(() => expect(planningStoreMocks.createActionRequest).toHaveBeenCalledWith('roadmap-request', {
      title: 'Generate roadmap proposal for Planning tab summary',
      notes: '',
      targetRepoIds: ['repo-1'],
      saveRepoId: 'repo-1',
    }));
    expect(onIntakeArtifactCreated).toHaveBeenCalledTimes(2);
  });
});
