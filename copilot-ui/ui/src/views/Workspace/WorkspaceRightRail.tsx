import { useState, useEffect } from 'react';
import { Panel } from '../../components';
import { navigationStore } from '../../stores/navigation';
import { getPlanningRecords } from '../../lib/api/planning';
import type { PlanningRecordItem } from '../../lib/types';
import WorkspaceCommandsCard from './WorkspaceCommandsCard';

interface WorkspaceRightRailProps {
  repoPath: string;
  repoId: string | null;
}

export default function WorkspaceRightRail({
  repoPath,
  repoId,
}: WorkspaceRightRailProps) {
  const [planningRecords, setPlanningRecords] = useState<PlanningRecordItem[]>([]);
  const [planningLoading, setPlanningLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadPlanning() {
      setPlanningLoading(true);
      try {
        const query: Record<string, string> = {};
        if (repoId) query.repoId = repoId;
        const data = await getPlanningRecords(query);
        if (!cancelled) {
          const records = (data.records || []);
          const filtered = repoId
            ? records.filter((r) => r.repoId === repoId)
            : records.filter((r) => !r.repoId);
          setPlanningRecords(filtered.slice(0, 10));
        }
      } catch {
        // planning is optional, don't show error
      } finally {
        if (!cancelled) setPlanningLoading(false);
      }
    }
    void loadPlanning();
    return () => { cancelled = true; };
  }, [repoPath, repoId]);

  return (
    <div className="workspace-right-rail-stack" data-testid="workspace-right-rail-stack">
      <Panel title="Planning" subtitle={`${planningRecords.length} sessions`} testId="workspace-planning-card">
        {planningLoading ? (
          <div className="state-message">Loading...</div>
        ) : planningRecords.length === 0 ? (
          <div className="state-message">No planning sessions for this repo.</div>
        ) : (
          <ul className="workspace-planning-list">
            {planningRecords.map((record) => (
              <li key={record.recordId}>
                <button
                  type="button"
                  className="workspace-planning-item"
                  onClick={() => navigationStore.openPlanningSession(record.recordId)}
                  data-testid={`workspace-planning-item-${record.recordId}`}
                >
                  <span className="workspace-planning-item-title">{String(record.title || record.recordId)}</span>
                  {record.state ? (
                    <span className="workspace-planning-item-status">{String(record.state)}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <WorkspaceCommandsCard repoPath={repoPath} />
    </div>
  );
}
