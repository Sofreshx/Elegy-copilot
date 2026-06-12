import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '../../components';
import {
  listPlanningLiveRoadmaps,
  getPlanningLiveGoal,
  getPlanningLiveAuthorityStatus,
} from '../../lib/api/planning';
import type {
  PlanningLiveGoal,
  PlanningLiveRoadmapSummary,
} from '../../lib/types';
import PlanningGraphView from '../../tabs/Planning/PlanningGraphView';
import WorkspacePlanningTree from './WorkspacePlanningTree';

interface WorkspacePlanningTabProps {
  repoPath: string;
  repoId: string | null;
  repoLabel: string | null;
}

function formatRefreshTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function WorkspacePlanningTab({ repoPath, repoId, repoLabel }: WorkspacePlanningTabProps) {
  const [roadmaps, setRoadmaps] = useState<PlanningLiveRoadmapSummary[]>([]);
  const [goals, setGoals] = useState<Map<string, PlanningLiveGoal>>(new Map());
  const [loading, setLoading] = useState(false);
  const [selectedRoadmapId, setSelectedRoadmapId] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [dbDiagnosticMessage, setDbDiagnosticMessage] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const repoQuery = {
    repoId: repoId || undefined,
    repoPath: repoPath || undefined,
    repoLabel: repoLabel || undefined,
  };

  // ── Fetch roadmaps and goals ──
  const fetchList = useCallback(async () => {
    try {
      setLoading(true);
      setFetchError(null);

      const roadmapsResult = await listPlanningLiveRoadmaps({
        ...repoQuery,
        includeUnscoped: true,
      });
      const fetchedRoadmaps = roadmapsResult.roadmaps || [];

      // Fetch goals for all unique goalIds
      const goalIds = new Set<string>();
      for (const r of fetchedRoadmaps) {
        if (r.goalId) goalIds.add(r.goalId);
      }

      const goalMap = new Map<string, PlanningLiveGoal>();
      const goalPromises = Array.from(goalIds).map(async (goalId) => {
        try {
          const goalResult = await getPlanningLiveGoal(goalId, repoQuery);
          if (goalResult.goal) {
            goalMap.set(goalId, goalResult.goal);
          }
        } catch {
          // Individual goal fetch failure is non-fatal
        }
      });
      await Promise.allSettled(goalPromises);

      setRoadmaps(fetchedRoadmaps);
      setGoals(goalMap);
      setLastRefreshed(new Date());

      // Diagnostic: if empty and repoLabel set
      if (fetchedRoadmaps.length === 0 && repoLabel) {
        try {
          const authorityStatus = await getPlanningLiveAuthorityStatus();
          if (authorityStatus.dbResolution) {
            const selectedSource = authorityStatus.dbResolution.source;
            const populatedCandidates = authorityStatus.dbResolution.candidates.filter(
              (c: any) => c.populated && c.path !== authorityStatus.dbPath,
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
      console.debug('Planning list fetch failed:', e instanceof Error ? e.message : e);
      setFetchError(e instanceof Error ? e.message : 'Failed to load planning data');
    } finally {
      setLoading(false);
    }
  }, [repoPath, repoId, repoLabel]);

  // ── Initial fetch ──
  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  // ── Default selection: prefer active roadmap, otherwise newest ──
  useEffect(() => {
    if (!selectedRoadmapId || !roadmaps.find((r) => r.id === selectedRoadmapId)) {
      const activeRoadmap = roadmaps.find((r) => r.status?.toLowerCase() === 'active');
      const newestRoadmap = [...roadmaps].sort((a, b) => {
        const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return bTime - aTime;
      })[0];

      const defaultSelection = activeRoadmap || newestRoadmap || null;
      if (defaultSelection && defaultSelection.id !== selectedRoadmapId) {
        setSelectedRoadmapId(defaultSelection.id);
      }
    }
  }, [roadmaps, selectedRoadmapId]);

  // ── Auto-refresh polling ──
  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    if (autoRefresh) {
      pollRef.current = setInterval(() => {
        void fetchList();
      }, 15000);
    }

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [autoRefresh, fetchList]);

  // ── Handle manual refresh ──
  function handleRefresh() {
    void fetchList();
  }

  // ── Handle roadmap selection ──
  function handleSelectRoadmap(roadmapId: string) {
    setSelectedRoadmapId(roadmapId);
  }

  // ── Handle back from graph view ──
  function handleBackFromGraph() {
    setSelectedRoadmapId(null);
  }

  // ── Handle refresh from graph ──
  function handleGraphRefreshNeeded() {
    setLastRefreshed(new Date());
  }

  // ── Get selected roadmap info for chips ──
  const selectedRoadmap = roadmaps.find((r) => r.id === selectedRoadmapId) || null;
  const selectedGoal = selectedRoadmap?.goalId ? goals.get(selectedRoadmap.goalId) || null : null;
  const selectedScopeKey = selectedRoadmap?.scopeKey ?? undefined;

  return (
    <div className="workspace-planning-tab" data-testid="workspace-planning-tab">
      {/* ── Toolbar ── */}
      <div className="workspace-planning-toolbar" data-testid="workspace-planning-toolbar">
        <div className="workspace-planning-toolbar-left">
          <Button
            onClick={handleRefresh}
            testId="workspace-planning-refresh"
            variant="secondary"
            size="sm"
          >
            Refresh
          </Button>
          <label className="workspace-planning-autorefresh-label">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              data-testid="workspace-planning-autorefresh"
            />
            Auto-refresh
          </label>
          {lastRefreshed && (
            <span className="workspace-planning-last-refreshed">
              Last refreshed: {formatRefreshTime(lastRefreshed)}
            </span>
          )}
        </div>
        <div className="workspace-planning-toolbar-right">
          {/* Breadcrumb chips */}
          {selectedScopeKey && (
            <span className="workspace-planning-chip workspace-planning-chip--scope">
              {selectedScopeKey.includes('/') || selectedScopeKey.includes('\\')
                ? selectedScopeKey.split(/[/\\]/).filter(Boolean).pop() || selectedScopeKey
                : selectedScopeKey}
            </span>
          )}
          {selectedGoal && (
            <span className="workspace-planning-chip workspace-planning-chip--goal">
              {selectedGoal.title || selectedGoal.id}
            </span>
          )}
          {selectedRoadmap && (
            <span className="workspace-planning-chip workspace-planning-chip--roadmap">
              {selectedRoadmap.title || selectedRoadmap.id}
            </span>
          )}
        </div>
      </div>

      {/* ── Error banner ── */}
      {fetchError && (
        <div className="workspace-planning-error" data-testid="workspace-planning-error">
          {fetchError}
        </div>
      )}

      {/* ── Diagnostic message ── */}
      {dbDiagnosticMessage && !loading && roadmaps.length === 0 && (
        <div className="workspace-planning-diagnostic" data-testid="workspace-planning-diagnostic">
          {dbDiagnosticMessage}
        </div>
      )}

      {/* ── Two-column layout ── */}
      <div className="workspace-planning-page" data-testid="workspace-planning-page">
        {/* Left: Tree */}
        <div className="workspace-planning-tree-column" data-testid="workspace-planning-tree-column">
          <WorkspacePlanningTree
            roadmaps={roadmaps}
            goals={goals}
            selectedRoadmapId={selectedRoadmapId}
            onSelectRoadmap={handleSelectRoadmap}
            loading={loading}
          />
        </div>

        {/* Right: Graph or empty state */}
        <div className="workspace-planning-graph-column" data-testid="workspace-planning-graph-column">
          {selectedRoadmapId ? (
            <PlanningGraphView
              key={selectedRoadmapId}
              roadmapId={selectedRoadmapId}
              repoQuery={repoQuery}
              onBack={handleBackFromGraph}
              onRefreshNeeded={handleGraphRefreshNeeded}
            />
          ) : (
            <div className="workspace-planning-empty-select" data-testid="workspace-planning-empty-select">
              <span className="state-message">
                Select a roadmap from the tree to view its planning graph.
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
