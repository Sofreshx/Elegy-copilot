import { useState, useEffect } from 'react';
import { Panel } from '../../components';
import { navigationStore } from '../../stores/navigation';
import { getPlanningRecords, listPlanningLivePlans, listPlanningLiveRoadmaps, getPlanningLiveAuthorityStatus } from '../../lib/api/planning';
import { getPlanningSummary } from '../../lib/api/elegyDb';
import type { PlanningRecordItem, PlanningSummaryLinkedPlan } from '../../lib/types';
import SessionDetailView from '../Sessions/SessionDetailView';

interface WorkspacePlanningTabProps {
  repoPath: string;
  repoId: string | null;
  repoLabel: string | null;
}

interface MergedPlanningItem {
  id: string;
  title: string;
  status: string | null;
  source: 'records' | 'elegy-db' | 'live' | 'live-roadmap';
  sessionId?: string;
}

export default function WorkspacePlanningTab({ repoPath, repoId, repoLabel }: WorkspacePlanningTabProps) {
  const [mergedItems, setMergedItems] = useState<MergedPlanningItem[]>([]);
  const [planningLoading, setPlanningLoading] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [dbDiagnosticMessage, setDbDiagnosticMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadPlanning() {
      setPlanningLoading(true);
      try {
        const query: Record<string, string> = {};
        if (repoId) query.repoId = repoId;

        const liveQuery: Record<string, string | undefined> = {};
        if (repoId) liveQuery.repoId = repoId;
        liveQuery.repoPath = repoPath;
        if (repoLabel) liveQuery.repoLabel = repoLabel;

        const [recordsResult, summaryResult, livePlansResult, liveRoadmapsResult] = await Promise.allSettled([
          getPlanningRecords(query),
          getPlanningSummary(repoPath),
          listPlanningLivePlans(liveQuery),
          listPlanningLiveRoadmaps({ ...liveQuery, includeUnscoped: true }),
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

        if (livePlansResult.status === 'fulfilled') {
          const livePlans = livePlansResult.value.plans || [];
          for (const plan of livePlans) {
            if (!seenIds.has(plan.id)) {
              items.push({
                id: plan.id,
                title: String(plan.title || plan.id),
                status: plan.status ?? null,
                source: 'live',
              });
              seenIds.add(plan.id);
            }
          }
        } else {
          console.debug('Live plans fetch failed:', livePlansResult.reason);
        }

        if (liveRoadmapsResult.status === 'fulfilled') {
          const roadmaps = liveRoadmapsResult.value.roadmaps || [];
          for (const roadmap of roadmaps) {
            if (!seenIds.has(roadmap.id)) {
              items.push({
                id: roadmap.id,
                title: String(roadmap.title || roadmap.id),
                status: roadmap.status ?? null,
                source: 'live-roadmap',
              });
              seenIds.add(roadmap.id);
            }
          }
        } else {
          console.debug('Live roadmaps fetch failed:', liveRoadmapsResult.reason);
        }

        setMergedItems(items.slice(0, 15));

        // Diagnostic: if empty and repoLabel set, check DB authority status
        if (items.length === 0 && repoLabel) {
          try {
            const authorityStatus = await getPlanningLiveAuthorityStatus();
            if (authorityStatus.dbResolution) {
              const selectedSource = authorityStatus.dbResolution.source;
              const populatedCandidates = authorityStatus.dbResolution.candidates.filter(
                (c) => c.populated && c.source !== selectedSource,
              );
              if (populatedCandidates.length > 0) {
                const otherDb = populatedCandidates[0].path;
                setDbDiagnosticMessage(
                  `Planning authority is using ${authorityStatus.dbPath || 'unknown DB'} (${selectedSource || 'unknown source'}). A populated database exists at ${otherDb} with planning scopes.`,
                );
              }
            }
          } catch {
            // diagnostic fetch is best-effort
          }
        } else {
          setDbDiagnosticMessage(null);
        }
      } catch (e) {
        console.debug('Planning load failed:', e instanceof Error ? e.message : e);
      } finally {
        if (!cancelled) setPlanningLoading(false);
      }
    }
    void loadPlanning();
    return () => { cancelled = true; };
  }, [repoPath, repoId, repoLabel]);

  function handleSelectSession(item: MergedPlanningItem) {
    if (item.source === 'live-roadmap') {
      // Open standalone planning graph for the roadmap
      const params = new URLSearchParams();
      params.set('roadmapId', item.id);
      if (repoId) params.set('repoId', repoId);
      if (repoPath) params.set('repoPath', repoPath);
      if (repoLabel) params.set('repoLabel', repoLabel);
      window.open(`/?${params.toString()}`, '_blank');
    } else if (item.sessionId) {
      setSelectedSessionId(item.sessionId);
      navigationStore.openPlanningSession(item.sessionId);
    } else {
      setSelectedSessionId(item.id);
      navigationStore.openPlanningSession(item.id);
    }
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
        <Panel title="Planning" subtitle={`${mergedItems.length} sessions`} testId="workspace-planning-panel">
          {planningLoading ? (
            <div className="state-message">Loading...</div>
          ) : mergedItems.length === 0 ? (
            <div className="state-message">
              <span>No planning sessions for this repo.</span>
              {dbDiagnosticMessage ? (
                <div className="state-message-diagnostic" style={{ marginTop: '0.5rem', fontSize: '0.85em', opacity: 0.75 }}>
                  {dbDiagnosticMessage}
                </div>
              ) : null}
            </div>
          ) : (
            <ul className="workspace-planning-list" data-testid="workspace-planning-list">
              {mergedItems.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="workspace-planning-item"
                    onClick={() => handleSelectSession(item)}
                    data-testid={`workspace-planning-item-${item.id}`}
                  >
                    <span className="workspace-planning-item-title">{item.title}</span>
                    {item.source === 'live-roadmap' ? (
                      <span className="workspace-planning-item-source">roadmap</span>
                    ) : null}
                    {item.status ? (
                      <span className="workspace-planning-item-status">{item.status}</span>
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
