import { useState, useEffect } from 'react';
import { Panel } from '../../components';
import { navigationStore } from '../../stores/navigation';
import { getPlanningRecords } from '../../lib/api/planning';
import type { PlanningRecordItem } from '../../lib/types';
import SessionDetailView from '../Sessions/SessionDetailView';

interface WorkspacePlanningTabProps {
  repoPath: string;
  repoId: string | null;
}

export default function WorkspacePlanningTab({ repoPath, repoId }: WorkspacePlanningTabProps) {
  const [planningRecords, setPlanningRecords] = useState<PlanningRecordItem[]>([]);
  const [planningLoading, setPlanningLoading] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

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
      } catch (e) {
        // planning is optional, don't show error
        console.debug('Planning records fetch failed:', e instanceof Error ? e.message : e);
      } finally {
        if (!cancelled) setPlanningLoading(false);
      }
    }
    void loadPlanning();
    return () => { cancelled = true; };
  }, [repoPath, repoId]);

  function handleSelectSession(recordId: string) {
    setSelectedSessionId(recordId);
    navigationStore.openPlanningSession(recordId);
  }

  function handleBack() {
    setSelectedSessionId(null);
    navigationStore.closePlanningSession();
  }

  return (
    <div className="workspace-planning-tab" data-testid="workspace-planning-tab">
      {selectedSessionId ? (
        <SessionDetailView
          embedded
          sessionIdOverride={selectedSessionId}
          onBack={handleBack}
        />
      ) : (
        <Panel title="Planning" subtitle={`${planningRecords.length} sessions`} testId="workspace-planning-panel">
          {planningLoading ? (
            <div className="state-message">Loading...</div>
          ) : planningRecords.length === 0 ? (
            <div className="state-message">No planning sessions for this repo.</div>
          ) : (
            <ul className="workspace-planning-list" data-testid="workspace-planning-list">
              {planningRecords.map((record) => (
                <li key={record.recordId}>
                  <button
                    type="button"
                    className="workspace-planning-item"
                    onClick={() => handleSelectSession(record.recordId)}
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
      )}
    </div>
  );
}
