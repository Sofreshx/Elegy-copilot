import { useEffect, useMemo, useState } from 'react';
import { Button, Panel, Toolbar } from '../../components';
import { getPlanningTaskBoard, listSessions } from '../../lib/api';
import { resolveSessionStatus } from '../../lib/stateDiagnostics';
import { useStoreValue } from '../../lib/store';
import type { SessionOrchestrationProjection, SessionSummary } from '../../lib/types';
import { navigationStore } from '../../stores/navigation';
import TaskBoardView, { type TaskBoardGroupBy } from '../Sessions/TaskBoardView';
import { catalogWorkspaceStore } from '../Assets/catalogWorkspaceStore';

function normalizeCatalogRepoEntry(repo: unknown) {
  if (!repo || typeof repo !== 'object') {
    return null;
  }

  const record = repo as Record<string, unknown>;
  const repoId = typeof record.repoId === 'string' ? record.repoId.trim() : '';
  const repoPath = typeof record.repoPath === 'string' ? record.repoPath.trim() : '';
  const repoLabel = typeof record.repoLabel === 'string' ? record.repoLabel.trim() : '';
  const sources = Array.isArray(record.sources)
    ? record.sources.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];

  if (!repoId && !repoPath && !repoLabel && sources.length === 0) {
    return null;
  }

  return {
    repoId,
    repoPath,
    repoLabel,
    sources,
  };
}

function resolveCatalogRepoContext(catalogState: ReturnType<typeof catalogWorkspaceStore.getState>) {
  const selectedRepo = normalizeCatalogRepoEntry(catalogState.repoInventory?.selectedRepo);
  if (selectedRepo) {
    return selectedRepo;
  }

  const repos = Array.isArray(catalogState.repoInventory?.repos) ? catalogState.repoInventory.repos : [];
  const activeRepoId = typeof catalogState.activeRepoId === 'string' ? catalogState.activeRepoId.trim() : '';
  const activeRepoPath = typeof catalogState.activeRepoPath === 'string' ? catalogState.activeRepoPath.trim() : '';

  return (
    normalizeCatalogRepoEntry(
      repos.find((repo) => {
        const repoRecord = repo as Record<string, unknown>;
        const repoId = typeof repoRecord.repoId === 'string' ? repoRecord.repoId.trim() : '';
        const repoPath = typeof repoRecord.repoPath === 'string' ? repoRecord.repoPath.trim() : '';
        return (activeRepoId && repoId === activeRepoId) || (activeRepoPath && repoPath === activeRepoPath);
      })
    )
    ?? null
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getProjectionTasks(projection: SessionOrchestrationProjection | null): Array<Record<string, unknown>> {
  const taskBoard = asRecord(projection?.taskBoard);
  return Array.isArray(taskBoard.items)
    ? taskBoard.items.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
    : [];
}

function buildPlanningTaskBoardSessionSummary(
  projection: SessionOrchestrationProjection | null,
  sessions: SessionSummary[],
) {
  const linkedSessionIds = Array.from(new Set(
    getProjectionTasks(projection)
      .map((task) => asString(task.ownerSessionId))
      .filter((sessionId): sessionId is string => Boolean(sessionId)),
  ));
  const linkedSessions = sessions.filter((session) => linkedSessionIds.includes(session.id));
  const liveSessions = linkedSessions.filter((session) => resolveSessionStatus(session) === 'active');

  if (liveSessions.length > 0) {
    return {
      title: 'Linked live sessions',
      status: 'active',
      detail: `${liveSessions.length} linked session(s) currently report live runtime evidence.`,
      helper: liveSessions.map((session) => session.id).join(' | '),
    };
  }

  if (linkedSessionIds.length > 0) {
    return {
      title: 'Linked live sessions',
      status: 'unknown',
      detail: `${linkedSessionIds.length} linked session reference(s) exist, but none currently show confirmed live runtime status.`,
      helper: linkedSessionIds.join(' | '),
    };
  }

  return {
    title: 'Linked live sessions',
    status: 'idle',
    detail: 'No durable task in this repo is linked to a live session yet.',
    helper: 'Launch or resume runtime work from Home / Runtime when a durable task is ready.',
  };
}

export default function PlanningAuthorityView() {
  const catalogState = useStoreValue(catalogWorkspaceStore);
  const [taskBoardProjection, setTaskBoardProjection] = useState<SessionOrchestrationProjection | null>(null);
  const [taskBoardSessions, setTaskBoardSessions] = useState<SessionSummary[]>([]);
  const [taskBoardLoading, setTaskBoardLoading] = useState(false);
  const [taskBoardError, setTaskBoardError] = useState<string | null>(null);
  const [taskBoardFilterStatus, setTaskBoardFilterStatus] = useState('all');
  const [taskBoardGroupBy, setTaskBoardGroupBy] = useState<TaskBoardGroupBy>('status');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const selectedCatalogRepo = useMemo(() => resolveCatalogRepoContext(catalogState), [catalogState]);
  const knownCatalogRepos = useMemo(() => {
    const repos = Array.isArray(catalogState.repoInventory?.repos) ? catalogState.repoInventory.repos : [];
    return repos
      .map((repo) => normalizeCatalogRepoEntry(repo))
      .filter((repo): repo is NonNullable<ReturnType<typeof normalizeCatalogRepoEntry>> => repo !== null);
  }, [catalogState.repoInventory?.repos]);

  useEffect(() => {
    if (catalogState.repoInventory || catalogState.repoInventoryLoading || catalogState.loading) {
      return;
    }

    void catalogWorkspaceStore.loadWorkspace();
  }, [catalogState.repoInventory, catalogState.repoInventoryLoading, catalogState.loading]);

  useEffect(() => {
    let cancelled = false;
    const repoId = selectedCatalogRepo?.repoId?.trim();

    if (!repoId) {
      setTaskBoardProjection(null);
      setTaskBoardSessions([]);
      setTaskBoardError(null);
      setTaskBoardLoading(false);
      setSelectedTaskId(null);
      return () => {
        cancelled = true;
      };
    }

    setTaskBoardLoading(true);
    setTaskBoardError(null);
    setSelectedTaskId(null);

    void Promise.all([
      getPlanningTaskBoard({
        repoId,
        repoPath: selectedCatalogRepo?.repoPath || undefined,
        repoLabel: selectedCatalogRepo?.repoLabel || undefined,
      }),
      listSessions(undefined, { source: 'all', dedupe: 'on' }).catch(() => ({ sessions: [] })),
    ])
      .then(([response, sessionsResponse]) => {
        if (cancelled) {
          return;
        }

        setTaskBoardProjection(response.projection ?? null);
        setTaskBoardSessions(Array.isArray(sessionsResponse.sessions) ? sessionsResponse.sessions : []);
        setTaskBoardLoading(false);
        setTaskBoardError(null);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setTaskBoardProjection(null);
        setTaskBoardSessions([]);
        setTaskBoardLoading(false);
        setTaskBoardError(error instanceof Error && error.message.trim() ? error.message : 'Unable to load the Planning task board.');
      });

    return () => {
      cancelled = true;
    };
  }, [selectedCatalogRepo?.repoId, selectedCatalogRepo?.repoLabel, selectedCatalogRepo?.repoPath]);

  const taskBoardSessionSummary = useMemo(
    () => buildPlanningTaskBoardSessionSummary(taskBoardProjection, taskBoardSessions),
    [taskBoardProjection, taskBoardSessions],
  );

  return (
    <section className="planning-view" data-testid="planning-view">
      <Toolbar testId="planning-view-toolbar">
        <div className="workspace-nav-summary">
          <p className="workspace-nav-title">Planning</p>
          <p className="workspace-nav-copy">
            Planning now uses `elegy-planning` as the mandatory durable authority. Repo-file bullets, backlog, and roadmap docs are retired from the live path.
          </p>
        </div>

        <div className="planning-toolbar-actions">
          <label className="form-input" htmlFor="planning-active-repo-select">
            <span className="form-label">Planning repo</span>
            <select
              data-testid="planning-active-repo-select"
              id="planning-active-repo-select"
              onChange={(event) => {
                const repoId = event.target.value.trim();
                if (!repoId) {
                  return;
                }
                void catalogWorkspaceStore.selectRepo({ repoId });
              }}
              value={selectedCatalogRepo?.repoId || ''}
            >
              <option value="">
                {catalogState.repoInventoryLoading
                  ? '(loading known repos...)'
                  : knownCatalogRepos.length > 0
                    ? '(choose a Catalog repo)'
                    : '(no Catalog repos available)'}
              </option>
              {knownCatalogRepos.map((repo) => (
                <option key={repo.repoId} value={repo.repoId}>
                  {repo.repoLabel || repo.repoId || repo.repoPath}
                </option>
              ))}
            </select>
          </label>
          <Button onClick={() => navigationStore.setCatalogSectionId('repository')} testId="planning-open-catalog" variant="secondary">
            Open Repository Catalog
          </Button>
        </div>
      </Toolbar>

      <div className="planning-metric-grid" data-testid="planning-context-summary">
        <div className="planning-metric-card">
          <p className="planning-metric-label">Active repo</p>
          <p className="planning-metric-value planning-metric-value-small">
            {selectedCatalogRepo?.repoLabel || 'Select a Catalog repo'}
          </p>
          <p className="planning-copy">
            <code>{selectedCatalogRepo?.repoId || '(no repo selected)'}</code>
          </p>
        </div>
        <div className="planning-metric-card">
          <p className="planning-metric-label">Planning authority</p>
          <p className="planning-metric-value">elegy-planning</p>
          <p className="planning-copy">Workflow artifacts must sync into the Rust planning authority.</p>
        </div>
        <div className="planning-metric-card">
          <p className="planning-metric-label">Repo-file planning</p>
          <p className="planning-metric-value">Retired</p>
          <p className="planning-copy">Legacy bullets, backlog docs, and roadmap docs no longer serve the live Planning tab.</p>
        </div>
      </div>

      <Panel
        subtitle="Planning is the primary visible task-board projection/control surface over durable repo-state tasks. Runtime stays session, overlay, and workflow-link oriented."
        testId="planning-task-board-panel"
        title="Visible Task Board"
      >
        <div className="planning-actions">
          <Button
            onClick={() => navigationStore.navigate('dashboard')}
            testId="planning-task-board-open-runtime-sessions"
            variant="secondary"
          >
            Open Runtime Sessions
          </Button>
          <Button
            onClick={() => navigationStore.navigate('dashboard')}
            testId="planning-task-board-open-executor"
            variant="ghost"
          >
            Open Executor
          </Button>
        </div>
        <TaskBoardView
          emptyCopy={selectedCatalogRepo?.repoId
            ? 'No durable repo-state tasks were found for this repo yet. Additive runtime or workflow metadata can stay empty until work is launched.'
            : 'Select a Catalog repo to load its durable repo-state task board.'}
          error={taskBoardError}
          filterStatus={taskBoardFilterStatus}
          groupBy={taskBoardGroupBy}
          loading={taskBoardLoading}
          onFilterStatusChange={(status) => {
            setTaskBoardFilterStatus(status);
            setSelectedTaskId(null);
          }}
          onGroupByChange={(value) => setTaskBoardGroupBy(value)}
          onSelectTask={(taskId) => setSelectedTaskId(taskId)}
          projection={taskBoardProjection}
          selectedTaskId={selectedTaskId}
          sessionSummary={taskBoardSessionSummary}
          subtitle="Repo-state tasks remain canonical durable authority. Runtime actors, workflow runs, and worktrees remain additive overlays."
          testId="planning-task-board-view"
          title="Planning Repo Task Board"
        />
      </Panel>

      <Panel
        subtitle="This live Planning tab is intentionally narrowed to the mandatory authority path while the remaining migration surfaces are being replaced."
        testId="planning-authority-cutover-panel"
        title="Authority Cutover"
      >
        <div className="planning-controls">
          <p className="planning-copy">Workflow artifact writes fail if `elegy-planning` sync does not complete.</p>
          <p className="planning-copy">Repo-file planning endpoints now return explicit retirement errors instead of serving as a second planning store.</p>
          <p className="planning-copy">`elegy-memory` remains additive memory only and does not replace planning durability.</p>
        </div>
      </Panel>
    </section>
  );
}
