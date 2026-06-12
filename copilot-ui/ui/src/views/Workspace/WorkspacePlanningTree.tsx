import type { PlanningLiveGoal, PlanningLiveRoadmapSummary } from '../../lib/types';

interface WorkspacePlanningTreeProps {
  roadmaps: PlanningLiveRoadmapSummary[];
  goals: Map<string, PlanningLiveGoal>;
  selectedRoadmapId: string | null;
  onSelectRoadmap: (roadmapId: string) => void;
  loading: boolean;
}

interface TreeNode {
  key: string;
  label: string;
  type: 'scope' | 'goal' | 'roadmap';
  roadmap?: PlanningLiveRoadmapSummary;
  goal?: PlanningLiveGoal;
  children: TreeNode[];
  status?: string | null;
  count?: number;
}

function buildTree(
  roadmaps: PlanningLiveRoadmapSummary[],
  goals: Map<string, PlanningLiveGoal>,
): TreeNode[] {
  // Group by scopeKey, then by goalId
  const scopeMap = new Map<string, Map<string, PlanningLiveRoadmapSummary[]>>();

  for (const roadmap of roadmaps) {
    const scopeKey = roadmap.scopeKey || 'default';
    const goalId = roadmap.goalId || '_unknown_';

    if (!scopeMap.has(scopeKey)) {
      scopeMap.set(scopeKey, new Map());
    }
    const goalMap = scopeMap.get(scopeKey)!;
    if (!goalMap.has(goalId)) {
      goalMap.set(goalId, []);
    }
    goalMap.get(goalId)!.push(roadmap);
  }

  const tree: TreeNode[] = [];

  for (const [scopeKey, goalMap] of scopeMap) {
    const scopeChildren: TreeNode[] = [];

    for (const [goalId, goalRoadmaps] of goalMap) {
      const goal = goals.get(goalId);
      const goalLabel = goal?.title || goalId;

      const roadmapNodes: TreeNode[] = goalRoadmaps.map((r) => ({
        key: `roadmap-${r.id}`,
        label: r.title || r.id,
        type: 'roadmap' as const,
        roadmap: r,
        children: [],
        status: r.status,
      }));

      scopeChildren.push({
        key: `goal-${goalId}`,
        label: goalLabel,
        type: 'goal',
        goal: goal || undefined,
        children: roadmapNodes,
        status: goal?.status,
        count: roadmapNodes.length,
      });
    }

    // Format scope label: if scopeKey is a path-like string, show last segment
    const scopeLabel = scopeKey.includes('/') || scopeKey.includes('\\')
      ? scopeKey.split(/[/\\]/).filter(Boolean).pop() || scopeKey
      : scopeKey;

    tree.push({
      key: `scope-${scopeKey}`,
      label: scopeLabel,
      type: 'scope',
      children: scopeChildren,
      count: scopeChildren.reduce((sum, g) => sum + (g.count || 0), 0),
    });
  }

  return tree;
}

function getStatusColor(status: string | null): string {
  const s = (status || '').toLowerCase();
  if (s === 'active' || s === 'proposed' || s === 'in-progress') return 'var(--color-accent-500)';
  if (s === 'completed' || s === 'finished') return 'var(--color-success-500)';
  if (s === 'blocked') return 'var(--color-warning-500)';
  if (s === 'draft') return 'var(--color-ink-400)';
  if (s === 'cancelled' || s === 'invalidated') return 'var(--color-danger-500)';
  return 'var(--color-ink-300)';
}

export default function WorkspacePlanningTree({
  roadmaps,
  goals,
  selectedRoadmapId,
  onSelectRoadmap,
  loading,
}: WorkspacePlanningTreeProps) {
  if (loading) {
    return <div className="state-message">Loading planning data...</div>;
  }

  if (roadmaps.length === 0) {
    return <div className="state-message">No roadmaps found for this repo.</div>;
  }

  const tree = buildTree(roadmaps, goals);

  const totalGoals = goals.size;
  const totalRoadmaps = roadmaps.length;

  return (
    <div className="workspace-planning-tree" data-testid="workspace-planning-tree">
      <div className="workspace-planning-tree-summary">
        <span className="workspace-planning-tree-count">{totalGoals} goal{totalGoals !== 1 ? 's' : ''}</span>
        <span className="workspace-planning-tree-sep">/</span>
        <span className="workspace-planning-tree-count">{totalRoadmaps} roadmap{totalRoadmaps !== 1 ? 's' : ''}</span>
      </div>
      <ul className="workspace-planning-tree-list">
        {tree.map((scope) => (
          <li key={scope.key} className="workspace-planning-tree-section">
            <div className="workspace-planning-tree-section-header">
              <span className="workspace-planning-tree-section-icon">◆</span>
              <span className="workspace-planning-tree-section-label">Scope: {scope.label}</span>
              {scope.count != null && (
                <span className="workspace-planning-tree-section-count">{scope.count} roadmap{scope.count !== 1 ? 's' : ''}</span>
              )}
            </div>
            <ul className="workspace-planning-tree-sublist">
              {scope.children.map((goal) => (
                <li key={goal.key} className="workspace-planning-tree-group">
                  <div className="workspace-planning-tree-group-header">
                    <span className="workspace-planning-tree-group-icon">◎</span>
                    <span className="workspace-planning-tree-group-label">Goal: {goal.label}</span>
                    {goal.status && (
                      <span
                        className="workspace-planning-tree-status"
                        style={{ color: getStatusColor(goal.status) }}
                      >
                        {goal.status}
                      </span>
                    )}
                    {goal.count != null && (
                      <span className="workspace-planning-tree-group-count">{goal.count}</span>
                    )}
                  </div>
                  <ul className="workspace-planning-tree-sublist">
                    {goal.children.map((roadmap) => (
                      <li key={roadmap.key}>
                        <button
                          type="button"
                          className={`workspace-planning-tree-item${roadmap.roadmap?.id === selectedRoadmapId ? ' workspace-planning-tree-item--selected' : ''}`}
                          onClick={() => roadmap.roadmap && onSelectRoadmap(roadmap.roadmap.id)}
                          data-testid={`workspace-planning-tree-roadmap-${roadmap.roadmap?.id}`}
                        >
                          <span className="workspace-planning-tree-item-title">{roadmap.label}</span>
                          {roadmap.status && (
                            <span
                              className="workspace-planning-tree-item-status"
                              style={{ color: getStatusColor(roadmap.status) }}
                            >
                              {roadmap.status}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
