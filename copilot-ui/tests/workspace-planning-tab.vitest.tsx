import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const apiMocks = vi.hoisted(() => ({
  getPlanningLiveAuthorityStatus: vi.fn(),
  getPlanningSession: vi.fn(),
  listPlanningLiveGoals: vi.fn(),
  listPlanningLiveRoadmaps: vi.fn(),
  getPlanningLiveGoal: vi.fn(),
  getPlanningLiveRoadmap: vi.fn(),
  getPlanningLivePlan: vi.fn(),
  listPlanningLivePlans: vi.fn(),
  listPlanningLiveTodos: vi.fn(),
}));

vi.mock('../ui/src/lib/api/planning', () => apiMocks);
vi.mock('../ui/src/lib/api', () => apiMocks);

describe('WorkspacePlanningTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.listPlanningLiveGoals.mockResolvedValue({
      goals: [
        {
          id: 'GOAL-one',
          title: 'A very long goal title that should fit in the wider rail',
          status: 'active',
          tags: ['repo:repo-1'],
          createdAt: '2026-06-01T10:00:00.000Z',
          updatedAt: '2026-06-11T10:00:00.000Z',
          acceptanceCriteria: [],
          rejectionCriteria: [],
        },
      ],
    });
    apiMocks.listPlanningLiveRoadmaps.mockResolvedValue({
      roadmaps: [
        {
          id: 'RM-one',
          goalId: 'GOAL-one',
          title: 'Roadmap should not be listed in the left rail',
          status: 'active',
          tags: ['repo:repo-1'],
          createdAt: '2026-06-02T10:00:00.000Z',
          updatedAt: '2026-06-12T10:00:00.000Z',
        },
      ],
    });
    apiMocks.getPlanningSession.mockResolvedValue({
      ready: true,
      exists: true,
      sidecarPath: 'C:/Users/lolzi/.copilot/planning-session.json',
      sidecar: {
        scope: 'default',
        sessionId: 'SESSION-one',
        activeGoalId: 'GOAL-one',
        updatedAt: '2026-06-12T10:00:00.000Z',
        tags: ['source:codex'],
      },
      lastChecked: '2026-06-12T10:01:00.000Z',
      correlationId: 'planning-session-check',
      availableAt: [],
    });
    apiMocks.getPlanningLiveGoal.mockResolvedValue({
      goal: {
        id: 'GOAL-one',
        title: 'A very long goal title that should fit in the wider rail',
        description: 'Goal description',
        status: 'active',
        tags: ['repo:repo-1'],
        acceptanceCriteria: ['Acceptance one'],
        rejectionCriteria: [],
      },
      roadmaps: [],
    });
    apiMocks.getPlanningLiveRoadmap.mockResolvedValue({
      roadmap: {
        id: 'RM-one',
        goalId: 'GOAL-one',
        title: 'Roadmap should not be listed in the left rail',
        status: 'active',
        tags: ['repo:repo-1'],
      },
      sections: [{ id: 'SEC-one', roadmapId: 'RM-one', title: 'Section one', ordering: 1 }],
      workPoints: [{ id: 'WP-one', roadmapId: 'RM-one', sectionId: 'SEC-one', title: 'Work point one', status: 'active', dependencyIds: [], validationExpectations: [], tags: [] }],
      validation: { status: 'warning', findings: [{ findingId: 'FIND-one', code: 'WARN', message: 'Validation warning', severity: 'warning' }] },
    });
    apiMocks.listPlanningLivePlans.mockResolvedValue({
      plans: [{ id: 'PLAN-one', goalId: 'GOAL-one', roadmapId: 'RM-one', title: 'Plan one', status: 'active', targetedWorkPointIds: ['WP-one'], assumptions: [], stopConditions: [], validationSteps: [], tags: [] }],
    });
    apiMocks.getPlanningLivePlan.mockResolvedValue({
      plan: { id: 'PLAN-one' },
      todos: [{ id: 'TODO-one', planId: 'PLAN-one', title: 'Todo one', status: 'open', evidenceRefs: [], tags: [] }],
      reviewPoints: [{ id: 'REVIEW-one', title: 'Review one', status: 'open' }],
    });
    apiMocks.listPlanningLiveTodos.mockResolvedValue({ todos: [] });
    apiMocks.getPlanningLiveAuthorityStatus.mockResolvedValue({ dbResolution: null });
  });

  it('renders a goal-only rail, session metadata, and a goal-rooted graph', async () => {
    const { default: WorkspacePlanningTab } = await import('../ui/src/views/Workspace/WorkspacePlanningTab');

    render(<WorkspacePlanningTab repoPath="C:/repo" repoId="repo-1" repoLabel="Repo One" />);

    const rail = await screen.findByTestId('workspace-planning-tree-column');
    expect(within(rail).getByText('A very long goal title that should fit in the wider rail')).toBeTruthy();
    expect(within(rail).queryByText('Roadmap should not be listed in the left rail')).toBeNull();
    expect(within(rail).getByText(/Updated/)).toBeTruthy();
    expect(within(rail).getByText('Active')).toBeTruthy();

    expect(await screen.findByTestId('workspace-planning-session-strip')).toHaveTextContent('SESSION-one');
    expect(screen.getByTestId('workspace-planning-session-strip')).toHaveTextContent('GOAL-one');

    await waitFor(() => {
      expect(screen.getByTestId('graph-node-goal-GOAL-one')).toBeTruthy();
      expect(screen.getByTestId('graph-node-roadmap-RM-one')).toBeTruthy();
      expect(screen.getByTestId('graph-node-section-SEC-one')).toBeTruthy();
      expect(screen.getByTestId('graph-node-review-REVIEW-one')).toBeTruthy();
      expect(screen.getByTestId('graph-node-finding-RM-one-FIND-one')).toBeTruthy();
    });
    expect(screen.getByTestId('planning-graph-summary')).toHaveTextContent('8 nodes / 7 links');
    expect(screen.queryByTestId('planning-graph-inspector')).toBeNull();

    fireEvent.click(screen.getByTestId('graph-node-plan-PLAN-one'));
    expect(screen.getByTestId('planning-graph-inspector')).toHaveTextContent('Plan one');
    expect(screen.getByTestId('planning-graph-inspector')).toHaveTextContent('RM-one');
  });
});
