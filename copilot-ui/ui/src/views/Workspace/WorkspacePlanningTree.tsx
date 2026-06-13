import type { PlanningLiveGoal, PlanningLiveRoadmapSummary } from '../../lib/types';
import { humanizeToken } from '../../lib/stateDiagnostics';

interface WorkspacePlanningTreeProps {
  goals: PlanningLiveGoal[];
  roadmaps: PlanningLiveRoadmapSummary[];
  selectedGoalId: string | null;
  onSelectGoal: (goalId: string) => void;
  loading: boolean;
}

function statusColor(status: string | null | undefined): string {
  const s = (status || '').toLowerCase();
  if (s === 'active' || s === 'proposed' || s === 'in-progress') return 'var(--color-accent-500)';
  if (s === 'completed' || s === 'finished' || s === 'done') return 'var(--color-success-500)';
  if (s === 'blocked' || s === 'failed') return 'var(--color-danger-500)';
  if (s === 'draft') return 'var(--color-ink-400)';
  return 'var(--color-ink-300)';
}

function formatTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return value;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: '2-digit', year: 'numeric' });
}

export default function WorkspacePlanningTree({
  goals,
  roadmaps,
  selectedGoalId,
  onSelectGoal,
  loading,
}: WorkspacePlanningTreeProps) {
  if (loading) {
    return <div className="state-message">Loading planning data...</div>;
  }

  if (goals.length === 0) {
    return <div className="state-message">No goals found for this repo.</div>;
  }

  const roadmapCountByGoal = new Map<string, number>();
  for (const roadmap of roadmaps) {
    if (!roadmap.goalId) continue;
    roadmapCountByGoal.set(roadmap.goalId, (roadmapCountByGoal.get(roadmap.goalId) || 0) + 1);
  }

  return (
    <div className="workspace-planning-tree" data-testid="workspace-planning-tree">
      <div className="workspace-planning-tree-summary">
        <span className="workspace-planning-tree-count">{goals.length} goal{goals.length === 1 ? '' : 's'}</span>
        <span className="workspace-planning-tree-sep">/</span>
        <span className="workspace-planning-tree-count">{roadmaps.length} roadmap{roadmaps.length === 1 ? '' : 's'}</span>
      </div>
      <ul className="workspace-planning-tree-list workspace-planning-goal-list">
        {goals.map((goal) => {
          const roadmapCount = roadmapCountByGoal.get(goal.id) || 0;
          const created = formatTimestamp(goal.createdAt);
          const updated = formatTimestamp(goal.updatedAt);
          const selected = goal.id === selectedGoalId;
          return (
            <li key={goal.id}>
              <button
                type="button"
                className={`workspace-planning-goal-item${selected ? ' workspace-planning-goal-item--selected' : ''}`}
                onClick={() => onSelectGoal(goal.id)}
                data-testid={`workspace-planning-tree-goal-${goal.id}`}
              >
                <span className="workspace-planning-goal-item-topline">
                  <span className="workspace-planning-goal-title">{goal.title || goal.id}</span>
                  {goal.status && (
                    <span className="workspace-planning-tree-status" style={{ color: statusColor(goal.status) }}>
                      {humanizeToken(goal.status)}
                    </span>
                  )}
                </span>
                <span className="workspace-planning-goal-meta">
                  <span>{roadmapCount} roadmap{roadmapCount === 1 ? '' : 's'}</span>
                  {updated && <span>Updated {updated}</span>}
                  {!updated && created && <span>Created {created}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
