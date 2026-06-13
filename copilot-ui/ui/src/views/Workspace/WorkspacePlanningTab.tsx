import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Button } from '../../components';
import {
  getPlanningLiveAuthorityStatus,
  getPlanningSession,
  listPlanningLiveGoals,
  listPlanningLiveRoadmaps,
} from '../../lib/api/planning';
import type { PlanningSessionResponse } from '../../lib/api/planning';
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

function formatTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return value;
  return new Date(ts).toLocaleString();
}

function readString(record: Record<string, unknown> | null | undefined, keys: string[]): string | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function PlanningSessionStrip({ session }: { session: PlanningSessionResponse | null }) {
  if (!session) return null;
  const sidecar = session.sidecar && typeof session.sidecar === 'object'
    ? session.sidecar as Record<string, unknown>
    : null;

  const fields: Array<{ label: string; value: string | null }> = [
    { label: 'Scope', value: readString(sidecar, ['scope', 'scopeKey']) },
    { label: 'Session', value: readString(sidecar, ['sessionId', 'id', 'planningSessionId']) },
    { label: 'Goal', value: readString(sidecar, ['activeGoalId', 'currentGoalId', 'goalId']) },
    { label: 'Roadmap', value: readString(sidecar, ['activeRoadmapId', 'currentRoadmapId', 'roadmapId']) },
    { label: 'Plan', value: readString(sidecar, ['activePlanId', 'currentPlanId', 'planId']) },
    { label: 'Created', value: formatTimestamp(readString(sidecar, ['createdAt', 'created_at'])) },
    { label: 'Updated', value: formatTimestamp(readString(sidecar, ['updatedAt', 'updated_at'])) },
  ].filter((entry) => entry.value);

  const tags = Array.isArray(sidecar?.tags)
    ? sidecar.tags.map((tag) => typeof tag === 'string' ? tag.trim() : '').filter(Boolean)
    : [];

  return (
    <div className="workspace-planning-session-strip" data-testid="workspace-planning-session-strip">
      <span className={`workspace-planning-session-state${session.exists ? ' workspace-planning-session-state--ready' : ''}`}>
        {session.exists ? 'Session sidecar' : 'Session path'}
      </span>
      {fields.map((field) => (
        <span key={field.label} className="workspace-planning-session-field">
          <span>{field.label}</span>
          <strong>{field.value}</strong>
        </span>
      ))}
      {tags.length > 0 && (
        <span className="workspace-planning-session-tags">
          {tags.map((tag) => <span key={tag} className="planning-chip">{tag}</span>)}
        </span>
      )}
      {session.sidecarPath && (
        <span className="workspace-planning-session-path" title={session.sidecarPath}>
          {session.sidecarPath}
        </span>
      )}
    </div>
  );
}

export default function WorkspacePlanningTab({ repoPath, repoId, repoLabel }: WorkspacePlanningTabProps) {
  const [roadmaps, setRoadmaps] = useState<PlanningLiveRoadmapSummary[]>([]);
  const [goals, setGoals] = useState<PlanningLiveGoal[]>([]);
  const [session, setSession] = useState<PlanningSessionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [dbDiagnosticMessage, setDbDiagnosticMessage] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const repoQuery = useMemo(() => ({
    repoId: repoId || undefined,
    repoPath: repoPath || undefined,
    repoLabel: repoLabel || undefined,
  }), [repoId, repoPath, repoLabel]);

  const fetchList = useCallback(async (options: { background?: boolean } = {}) => {
    const background = options.background === true;
    try {
      if (!background) setLoading(true);
      setFetchError(null);

      const [goalsResult, roadmapsResult, sessionResult] = await Promise.allSettled([
        listPlanningLiveGoals({ ...repoQuery, includeUnscoped: true }),
        listPlanningLiveRoadmaps({ ...repoQuery, includeUnscoped: true }),
        getPlanningSession(),
      ]);

      const fetchedGoals = goalsResult.status === 'fulfilled' ? goalsResult.value.goals || [] : [];
      const fetchedRoadmaps = roadmapsResult.status === 'fulfilled' ? roadmapsResult.value.roadmaps || [] : [];

      setGoals(fetchedGoals);
      setRoadmaps(fetchedRoadmaps);
      setSession(sessionResult.status === 'fulfilled' ? sessionResult.value : null);
      setLastRefreshed(new Date());

      if (goalsResult.status === 'rejected' && roadmapsResult.status === 'rejected') {
        throw goalsResult.reason;
      }

      if (fetchedGoals.length === 0 && fetchedRoadmaps.length === 0 && repoLabel) {
        try {
          const authorityStatus = await getPlanningLiveAuthorityStatus();
          if (authorityStatus.dbResolution) {
            const selectedSource = authorityStatus.dbResolution.source;
            const populatedCandidates = authorityStatus.dbResolution.candidates.filter(
              (c) => c.populated && c.path !== authorityStatus.dbPath,
            );
            if (populatedCandidates.length > 0) {
              setDbDiagnosticMessage(
                `Planning authority is using ${authorityStatus.dbPath || 'unknown DB'} (${selectedSource || 'unknown source'}). A populated database exists at ${populatedCandidates[0].path} with planning scopes.`,
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
      if (!background) setLoading(false);
    }
  }, [repoQuery]);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  useEffect(() => {
    if (!selectedGoalId || !goals.find((goal) => goal.id === selectedGoalId)) {
      const activeGoal = goals.find((goal) => goal.status?.toLowerCase() === 'active');
      const newestGoal = [...goals].sort((a, b) => {
        const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return bTime - aTime;
      })[0];
      const defaultSelection = activeGoal || newestGoal || null;
      if (defaultSelection && defaultSelection.id !== selectedGoalId) {
        setSelectedGoalId(defaultSelection.id);
      }
    }
  }, [goals, selectedGoalId]);

  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    if (autoRefresh) {
      pollRef.current = setInterval(() => {
        void fetchList({ background: true });
      }, 60000);
    }

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [autoRefresh, fetchList]);

  function handleRefresh() {
    void fetchList();
  }

  function handleGraphRefreshNeeded() {
    setLastRefreshed(new Date());
  }

  const selectedGoal = goals.find((goal) => goal.id === selectedGoalId) || null;

  return (
    <div className="workspace-planning-tab" data-testid="workspace-planning-tab">
      <div className="workspace-planning-toolbar" data-testid="workspace-planning-toolbar">
        <div className="workspace-planning-toolbar-left">
          <Button onClick={handleRefresh} testId="workspace-planning-refresh" variant="secondary" size="sm">
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
          {selectedGoal && (
            <span className="workspace-planning-chip workspace-planning-chip--goal">
              {selectedGoal.title || selectedGoal.id}
            </span>
          )}
        </div>
      </div>

      {fetchError && (
        <div className="workspace-planning-error" data-testid="workspace-planning-error">
          {fetchError}
        </div>
      )}

      {dbDiagnosticMessage && !loading && goals.length === 0 && roadmaps.length === 0 && (
        <div className="workspace-planning-diagnostic" data-testid="workspace-planning-diagnostic">
          {dbDiagnosticMessage}
        </div>
      )}

      <PlanningSessionStrip session={session} />

      <div className="workspace-planning-page" data-testid="workspace-planning-page">
        <div className="workspace-planning-tree-column" data-testid="workspace-planning-tree-column">
          <WorkspacePlanningTree
            roadmaps={roadmaps}
            goals={goals}
            selectedGoalId={selectedGoalId}
            onSelectGoal={setSelectedGoalId}
            loading={loading}
          />
        </div>

        <div className="workspace-planning-graph-column" data-testid="workspace-planning-graph-column">
          {selectedGoalId ? (
            <PlanningGraphView
              key={selectedGoalId}
              goalId={selectedGoalId}
              repoQuery={repoQuery}
              onBack={() => setSelectedGoalId(null)}
              onRefreshNeeded={handleGraphRefreshNeeded}
            />
          ) : (
            <div className="workspace-planning-empty-select" data-testid="workspace-planning-empty-select">
              <span className="state-message">Select a goal to view its planning graph.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
