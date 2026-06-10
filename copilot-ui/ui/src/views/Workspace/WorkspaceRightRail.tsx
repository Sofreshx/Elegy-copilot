import { useState, useEffect } from 'react';
import { Panel } from '../../components';
import { navigationStore } from '../../stores/navigation';
import { getPlanningRecords } from '../../lib/api/planning';
import { getPlanningSummary } from '../../lib/api/elegyDb';
import type { PlanningRecordItem, PlanningSummaryLinkedPlan } from '../../lib/types';
import WorkspaceCommandsCard from './WorkspaceCommandsCard';
import WorkspaceWorktreesCard from './WorkspaceWorktreesCard';

interface WorkspaceRightRailProps {
  repoPath: string;
  repoId: string | null;
}

interface MergedPlanningItem {
  id: string;
  title: string;
  status: string | null;
  source: 'records' | 'elegy-db';
  sessionId?: string;
}

export default function WorkspaceRightRail({
  repoPath,
  repoId,
}: WorkspaceRightRailProps) {
  const [mergedItems, setMergedItems] = useState<MergedPlanningItem[]>([]);
  const [planningLoading, setPlanningLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadPlanning() {
      setPlanningLoading(true);
      try {
        const query: Record<string, string> = {};
        if (repoId) query.repoId = repoId;

        const [recordsResult, summaryResult] = await Promise.allSettled([
          getPlanningRecords(query),
          getPlanningSummary(repoPath),
        ]);

        if (cancelled) return;

        const items: MergedPlanningItem[] = [];
        const seenIds = new Set<string>();

        if (recordsResult.status === 'fulfilled') {
          const records = (recordsResult.value.records || []);
          const filtered = repoId
            ? records.filter((r: PlanningRecordItem) => r.repoId === repoId)
            : records.filter((r: PlanningRecordItem) => !r.repoId);
          for (const record of filtered.slice(0, 10)) {
            items.push({
              id: record.recordId,
              title: String(record.title || record.recordId),
              status: record.state ?? null,
              source: 'records',
            });
            seenIds.add(record.recordId);
          }
        } else {
          console.debug('Planning records fetch failed:', recordsResult.reason);
        }

        if (summaryResult.status === 'fulfilled') {
          const linkedPlans = summaryResult.value.linkedPlans || [];
          for (const plan of linkedPlans) {
            if (!seenIds.has(plan.planId)) {
              items.push({
                id: plan.planId,
                title: String(plan.title || plan.planId),
                status: plan.status,
                source: 'elegy-db',
                sessionId: plan.sessionId,
              });
              seenIds.add(plan.planId);
            }
          }
        } else {
          console.debug('Planning summary fetch failed:', summaryResult.reason);
        }

        setMergedItems(items.slice(0, 10));
      } catch (e) {
        console.debug('Planning load failed:', e instanceof Error ? e.message : e);
      } finally {
        if (!cancelled) setPlanningLoading(false);
      }
    }
    void loadPlanning();
    return () => { cancelled = true; };
  }, [repoPath, repoId]);

  function handleSelectSession(item: MergedPlanningItem) {
    const sessionId = item.sessionId || item.id;
    navigationStore.openPlanningSession(sessionId);
  }

  return (
    <div className="workspace-right-rail-stack" data-testid="workspace-right-rail-stack">
      <Panel title="Planning" subtitle={`${mergedItems.length} sessions`} testId="workspace-planning-card">
        {planningLoading ? (
          <div className="state-message">Loading...</div>
        ) : mergedItems.length === 0 ? (
          <div className="state-message">No planning sessions for this repo.</div>
        ) : (
          <ul className="workspace-planning-list">
            {mergedItems.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="workspace-planning-item"
                  onClick={() => handleSelectSession(item)}
                  data-testid={`workspace-planning-item-${item.id}`}
                >
                  <span className="workspace-planning-item-title">{item.title}</span>
                  {item.status ? (
                    <span className="workspace-planning-item-status">{item.status}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <WorkspaceWorktreesCard repoId={repoId} repoPath={repoPath} />
      <WorkspaceCommandsCard repoPath={repoPath} />
    </div>
  );
}
