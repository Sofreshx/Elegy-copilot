import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const planningStoreMocks = vi.hoisted(() => ({
  setIdeaDraft: vi.fn(),
  setIdeaTargetRepos: vi.fn(),
  setCreateScope: vi.fn(),
  createIdeaBatch: vi.fn(),
  compileSelectedIdeas: vi.fn(),
  toggleIdeaSelected: vi.fn(),
  updateIdea: vi.fn(),
  saveIdeaDraft: vi.fn(),
  splitIdea: vi.fn(),
  removeIdea: vi.fn(),
}));

vi.mock('../ui/src/tabs/Planning/planningStore', () => ({
  planningStore: planningStoreMocks,
}));

describe('PlanningIdeasPanel', () => {
  beforeEach(() => {
    Object.values(planningStoreMocks).forEach((mock) => mock.mockReset());
    planningStoreMocks.compileSelectedIdeas.mockResolvedValue(null);
  });

  it('keeps first-class bullet intake available without an active Catalog repo', async () => {
    const onOpenCatalogAssets = vi.fn();
    const { default: PlanningIdeasPanel } = await import('../ui/src/tabs/Planning/PlanningIdeasPanel');

    render(
      <PlanningIdeasPanel
        knownRepos={[
          {
            repoId: 'repo-1',
            repoLabel: 'Instruction Engine',
            repoPath: 'C:\\Repos\\instruction-engine',
          },
        ]}
        onOpenCatalogAssets={onOpenCatalogAssets}
        planningState={{
          catalogRepoContext: null,
          createScope: 'user',
          creating: false,
          compiling: false,
          draftIdeas: [],
          ideaDraft: '',
          ideaTargetRepos: '',
          mutatingBlocked: false,
          selectedIdeaIds: [],
        } as never}
      />
    );

    expect(screen.getByTestId('planning-bullet-intake')).toBeInTheDocument();
    expect(screen.getByText(/No Catalog repo is selected yet/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Bullets'), {
      target: { value: '- Draft backlog bullet' },
    });
    expect(planningStoreMocks.setIdeaDraft).toHaveBeenCalledWith('- Draft backlog bullet');

    fireEvent.change(screen.getByTestId('planning-ideas-target-repos'), {
      target: { value: 'repo-1' },
    });
    expect(planningStoreMocks.setIdeaTargetRepos).toHaveBeenCalledWith('repo-1');

    fireEvent.click(screen.getByTestId('planning-open-catalog-assets'));
    expect(onOpenCatalogAssets).toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('planning-ideas-add'));
    expect(planningStoreMocks.createIdeaBatch).toHaveBeenCalled();
  });

  it('supports repo-specific split and planning intake save controls for drafts', async () => {
    planningStoreMocks.compileSelectedIdeas.mockResolvedValueOnce('sdk-123');

    const onSdkSessionReady = vi.fn();
    const { default: PlanningIdeasPanel } = await import('../ui/src/tabs/Planning/PlanningIdeasPanel');

    render(
      <PlanningIdeasPanel
        knownRepos={[
          {
            repoId: 'repo-1',
            repoLabel: 'Instruction Engine',
            repoPath: 'C:\\Repos\\instruction-engine',
          },
          {
            repoId: 'repo-2',
            repoLabel: 'Copilot UI',
            repoPath: 'C:\\Repos\\copilot-ui',
          },
        ]}
        onSdkSessionReady={onSdkSessionReady}
        planningState={{
          catalogRepoContext: {
            repoId: 'repo-1',
            repoLabel: 'Instruction Engine',
            repoPath: 'C:\\Repos\\instruction-engine',
            sources: ['workspace', 'selected'],
          },
          createScope: 'repo',
          creating: false,
          compiling: false,
          draftIdeas: [
            {
              draftId: 'draft-multi',
              title: 'Shared draft',
              summary: 'Shared summary',
              acceptanceCriteriaText: '',
              acceptanceCriteria: [],
              targetRepoIds: ['repo-1', 'repo-2'],
              saveRepoId: null,
              state: 'thought',
              createdAt: '2026-03-17T00:00:00.000Z',
              updatedAt: '2026-03-17T00:00:00.000Z',
            },
            {
              draftId: 'draft-single',
              title: 'Repo draft',
              summary: 'Repo summary',
              acceptanceCriteriaText: '',
              acceptanceCriteria: [],
              targetRepoIds: ['repo-1'],
              saveRepoId: 'repo-1',
              state: 'thought',
              createdAt: '2026-03-17T00:00:00.000Z',
              updatedAt: '2026-03-17T00:00:00.000Z',
            },
          ],
          ideaDraft: '',
          ideaTargetRepos: '',
          mutatingBlocked: false,
          savingIdeaId: null,
          selectedIdeaIds: ['draft-single'],
          updatingRecordId: null,
        } as never}
      />
    );

    expect(screen.getByTestId('idea-split-required-draft-multi')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('idea-split-draft-multi'));
    await waitFor(() => expect(planningStoreMocks.splitIdea).toHaveBeenCalledWith('draft-multi'));

    fireEvent.click(screen.getByTestId('idea-save-intake-draft-single'));
    await waitFor(() => expect(planningStoreMocks.saveIdeaDraft).toHaveBeenCalledWith('draft-single', 'repo-1'));

    fireEvent.click(screen.getByTestId('planning-ideas-compile'));
    await waitFor(() => expect(planningStoreMocks.compileSelectedIdeas).toHaveBeenCalled());
    await waitFor(() => expect(onSdkSessionReady).toHaveBeenCalledWith('sdk-123'));
  });
});
