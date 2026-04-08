import { Button, StatusBadge } from '../../components';
import { humanizeToken } from '../../lib/stateDiagnostics';
import type {
  SessionOrchestrationActor,
  SessionOrchestrationProjection,
  SessionOrchestrationTaskBoardItem,
  SessionOrchestrationWorkflowRun,
  WorktreeBinding,
} from '../../lib/types';

export type TaskBoardGroupBy = 'status' | 'actor' | 'workflow' | 'none';

interface TaskBoardViewProps {
  projection?: SessionOrchestrationProjection | Record<string, unknown> | null;
  loading?: boolean;
  error?: string | null;
  filterStatus?: string;
  groupBy?: TaskBoardGroupBy;
  selectedTaskId?: string | null;
  onFilterStatusChange?: (status: string) => void;
  onGroupByChange?: (groupBy: TaskBoardGroupBy) => void;
  onSelectTask?: (taskId: string | null) => void;
  title?: string;
  subtitle?: string;
  emptyCopy?: string;
  sessionSummary?: {
    title?: string;
    status?: string;
    detail?: string;
    helper?: string | null;
  };
  testId?: string;
}

interface NormalizedTaskBoardItem {
  taskId: string;
  title: string;
  status: string;
  ownerSessionId: string | null;
  activeActorId: string | null;
  activeActorLabel: string | null;
  workflowStatus: string | null;
  workflowMode: string | null;
  workflowRunId: string | null;
  worktreeId: string | null;
  worktreeMode: string | null;
  worktreePath: string | null;
  durablePath: string | null;
  linkedPlanningSummary: string;
  raw: SessionOrchestrationTaskBoardItem;
}

interface NormalizedProjection {
  sessionId: string | null;
  objective: string | null;
  repoLabel: string | null;
  repoId: string | null;
  repoPath: string | null;
  branch: string | null;
  isolationMode: string | null;
  contextType: string | null;
  sandboxId: string | null;
  worktreeId: string | null;
  worktreePath: string | null;
  worktreeStatus: string | null;
  worktree: WorktreeBinding | null;
  launchBlocked: boolean;
  launchBlockedReason: string | null;
  workflowKind: string | null;
  workflowStatus: string | null;
  workflowMode: string | null;
  workflowTrigger: string | null;
  workflowRunId: string | null;
  workflowJobId: string | null;
  workflowRuns: SessionOrchestrationWorkflowRun[];
  actors: SessionOrchestrationActor[];
  activeActorId: string | null;
  tasks: NormalizedTaskBoardItem[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function summarizeLinkedPlanning(value: unknown): string {
  const record = asRecord(value);
  const parts = [
    asArray<string>(record.backlogIds).length ? `${asArray<string>(record.backlogIds).length} backlog ref(s)` : '',
    asArray<string>(record.roadmapIds).length ? `${asArray<string>(record.roadmapIds).length} roadmap ref(s)` : '',
  ].filter(Boolean);
  return parts.join(' | ');
}

function normalizeTask(item: SessionOrchestrationTaskBoardItem): NormalizedTaskBoardItem | null {
  const taskId = asString(item.taskId);
  if (!taskId) {
    return null;
  }

  const workflow = asRecord(item.workflow);
  const worktree = asRecord(item.worktree);

  return {
    taskId,
    title: asString(item.title) || taskId,
    status: asString(item.status) || 'unknown',
    ownerSessionId: asString(item.ownerSessionId),
    activeActorId: asString(item.activeActorId),
    activeActorLabel: asString(item.activeActorLabel),
    workflowStatus: asString(workflow.status),
    workflowMode: asString(workflow.mode),
    workflowRunId: asString(workflow.latestRunId) || asString(workflow.runId),
    worktreeId: asString(worktree.worktreeId),
    worktreeMode: asString(worktree.mode),
    worktreePath: asString(worktree.path) || asString(worktree.worktreePath),
    durablePath: asString(item.durablePath),
    linkedPlanningSummary: summarizeLinkedPlanning(item.linkedPlanning),
    raw: item,
  };
}

function normalizeProjection(
  projection?: SessionOrchestrationProjection | Record<string, unknown> | null,
): NormalizedProjection {
  const source = asRecord(projection);
  const repo = asRecord(source.repo);
  const isolation = asRecord(source.isolation);
  const actorsRecord = asRecord(source.actors);
  const taskBoard = asRecord(source.taskBoard);
  const workflow = asRecord(source.workflow);
  const tasks = asArray<SessionOrchestrationTaskBoardItem>(taskBoard.items)
    .map((item) => normalizeTask(item))
    .filter((item): item is NormalizedTaskBoardItem => item !== null);

  return {
    sessionId: asString(source.sessionId),
    objective: asString(source.objective),
    repoLabel: asString(repo.repoLabel),
    repoId: asString(repo.repoId),
    repoPath: asString(repo.repoPath),
    branch: asString(repo.branch),
    isolationMode: asString(isolation.mode),
    contextType: asString(isolation.contextType),
    sandboxId: asString(isolation.sandboxId),
    worktreeId: asString(isolation.worktreeId),
    worktreePath: asString(isolation.worktreePath),
    worktreeStatus: asString(isolation.worktreeStatus),
    worktree: Object.keys(asRecord(isolation.worktree)).length > 0 ? (isolation.worktree as WorktreeBinding) : null,
    launchBlocked: asBoolean(isolation.launchBlocked),
    launchBlockedReason: asString(isolation.launchBlockedReason),
    workflowKind: asString(workflow.workflowKind),
    workflowStatus: asString(workflow.status),
    workflowMode: asString(workflow.mode),
    workflowTrigger: asString(workflow.trigger),
    workflowRunId: asString(workflow.runId),
    workflowJobId: asString(workflow.jobId),
    workflowRuns: asArray<SessionOrchestrationWorkflowRun>(workflow.runs),
    actors: asArray<SessionOrchestrationActor>(actorsRecord.items).filter((actor) => Boolean(asString(actor.actorId))),
    activeActorId: asString(actorsRecord.activeActorId),
    tasks,
  };
}

function groupTasks(tasks: NormalizedTaskBoardItem[], groupBy: TaskBoardGroupBy): Array<{ key: string; label: string; items: NormalizedTaskBoardItem[] }> {
  if (groupBy === 'none') {
    return [{ key: 'all', label: 'All durable tasks', items: tasks }];
  }

  const groups = new Map<string, NormalizedTaskBoardItem[]>();
  for (const task of tasks) {
    const key = groupBy === 'actor'
      ? (task.activeActorLabel || task.activeActorId || 'unassigned')
      : groupBy === 'workflow'
        ? (task.workflowStatus || 'workflow-unspecified')
        : task.status;
    const current = groups.get(key) ?? [];
    current.push(task);
    groups.set(key, current);
  }

  return Array.from(groups.entries())
    .map(([key, items]) => ({
      key,
      label: groupBy === 'actor' ? `Actor: ${key}` : groupBy === 'workflow' ? `Workflow: ${humanizeToken(key)}` : humanizeToken(key),
      items,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function buildNextActions(projection: NormalizedProjection): string[] {
  const nextActions: string[] = [];
  const activeTask = projection.tasks.find((task) => task.status === 'in_progress' || task.status === 'ready');
  if (activeTask) {
    nextActions.push(`Review durable task ${activeTask.taskId} (${humanizeToken(activeTask.status)})`);
  }
  if (projection.activeActorId) {
    nextActions.push(`Check in-session actor ${projection.activeActorId}`);
  }
  if (projection.workflowStatus) {
    nextActions.push(`Track executor workflow ${humanizeToken(projection.workflowStatus)}`);
  }
  if (projection.launchBlocked && projection.launchBlockedReason) {
    nextActions.push(`Resolve worktree launch block: ${projection.launchBlockedReason}`);
  }
  if (projection.tasks.length === 0 && projection.repoId) {
    nextActions.push('No durable repo-state tasks are linked yet; keep task-board state projection-only.');
  }
  return nextActions.slice(0, 4);
}

export default function TaskBoardView({
  projection,
  loading = false,
  error = null,
  filterStatus = 'all',
  groupBy = 'status',
  selectedTaskId = null,
  onFilterStatusChange,
  onGroupByChange,
  onSelectTask,
  title = 'Visible Task Board',
  subtitle = 'Durable repo-state tasks with runtime overlays, executor workflow state, and worktree context.',
  emptyCopy = 'No orchestration task metadata is available for this selection yet.',
  sessionSummary,
  testId = 'task-board-view',
}: TaskBoardViewProps) {
  const normalized = normalizeProjection(projection);
  const filteredTasks = normalized.tasks.filter((task) => filterStatus === 'all' || task.status === filterStatus);
  const groupedTasks = groupTasks(filteredTasks, groupBy);
  const selectedTask = filteredTasks.find((task) => task.taskId === selectedTaskId) ?? filteredTasks[0] ?? null;
  const nextActions = buildNextActions(normalized);
  const resolvedSessionSummary = {
    title: sessionSummary?.title || 'Linked live session',
    status: sessionSummary?.status || (normalized.sessionId ? 'unknown' : 'idle'),
    detail: sessionSummary?.detail || [
      normalized.sessionId ? `session ${normalized.sessionId}` : 'no linked session',
      normalized.repoLabel || normalized.repoId ? `repo ${normalized.repoLabel || normalized.repoId}` : '',
      normalized.branch ? `branch ${normalized.branch}` : '',
    ].filter(Boolean).join(' | '),
    helper: sessionSummary?.helper || null,
  };

  return (
    <section className="workspace-stack" data-testid={testId}>
      <div className="session-detail">
        <p className="session-detail-suggestion">
          <span>{title}:</span> {normalized.repoLabel || normalized.repoId || normalized.sessionId || 'runtime selection'}
        </p>
        <p className="tracker-item-copy">{subtitle}</p>
      </div>

      <div className="state-card-grid">
        <article className="state-card">
          <div className="state-card-header">
            <p className="state-card-title">{resolvedSessionSummary.title}</p>
            <StatusBadge status={resolvedSessionSummary.status} testId={`${testId}-session-status`} />
          </div>
          <p className="state-card-detail">{resolvedSessionSummary.detail || 'No linked live session was confirmed.'}</p>
          {resolvedSessionSummary.helper ? <p className="tracker-item-copy">{resolvedSessionSummary.helper}</p> : null}
        </article>

        <article className="state-card">
          <div className="state-card-header">
            <p className="state-card-title">In-session actors</p>
            <StatusBadge status={normalized.actors.length ? 'active' : 'idle'} testId={`${testId}-actor-status`} />
          </div>
          <p className="state-card-detail">
            {normalized.actors.length > 0
              ? normalized.actors.map((actor) => `${actor.label || actor.actorId} (${humanizeToken(actor.role || 'unknown')})`).join(' | ')
              : 'No runtime-scoped actor summaries reported.'}
          </p>
        </article>

        <article className="state-card">
          <div className="state-card-header">
            <p className="state-card-title">Worktree isolation</p>
            <StatusBadge
              status={normalized.launchBlocked ? 'blocked' : normalized.worktreeStatus || normalized.isolationMode || 'unknown'}
              testId={`${testId}-worktree-status`}
            />
          </div>
          <p className="state-card-detail">
            {[
              normalized.contextType ? `context ${normalized.contextType}` : '',
              normalized.isolationMode ? `mode ${normalized.isolationMode}` : '',
              normalized.worktreeId ? `worktree ${normalized.worktreeId}` : '',
              normalized.worktreePath ? normalized.worktreePath : '',
              normalized.sandboxId ? `sandbox ${normalized.sandboxId}` : '',
            ].filter(Boolean).join(' | ') || 'No dedicated isolation metadata reported.'}
          </p>
          {normalized.launchBlockedReason ? <p className="tracker-item-copy">{normalized.launchBlockedReason}</p> : null}
        </article>

        <article className="state-card">
          <div className="state-card-header">
            <p className="state-card-title">Workflow overlay</p>
            <StatusBadge status={normalized.workflowStatus || 'unknown'} testId={`${testId}-workflow-status`} />
          </div>
          <p className="state-card-detail">
            {[
              normalized.workflowKind ? humanizeToken(normalized.workflowKind) : '',
              normalized.workflowMode ? `mode ${normalized.workflowMode}` : '',
              normalized.workflowTrigger ? `trigger ${normalized.workflowTrigger}` : '',
              normalized.workflowRunId ? `run ${normalized.workflowRunId}` : '',
            ].filter(Boolean).join(' | ') || 'No workflow overlay linked.'}
          </p>
        </article>

        <article className="state-card">
          <div className="state-card-header">
            <p className="state-card-title">Next actions</p>
            <StatusBadge status={nextActions.length ? 'ready' : 'idle'} testId={`${testId}-next-actions-status`} />
          </div>
          {nextActions.length > 0 ? (
            <ul className="session-detail-warnings">
              {nextActions.map((entry) => (
                <li key={entry}>{entry}</li>
              ))}
            </ul>
          ) : (
            <p className="state-card-detail">No immediate operator actions were derived.</p>
          )}
        </article>
      </div>

      {normalized.objective ? <p className="tracker-item-copy">Objective: {normalized.objective}</p> : null}
      {error ? <p className="sessions-error" role="alert">{error}</p> : null}

      <div className="sessions-controls executor-form-grid">
        <label className="form-input" htmlFor={`${testId}-filter-status`}>
          <span className="form-label">Durable task status filter</span>
          <select
            data-testid={`${testId}-filter-status`}
            id={`${testId}-filter-status`}
            onChange={(event) => onFilterStatusChange?.(event.target.value)}
            value={filterStatus}
          >
            <option value="all">All</option>
            {Array.from(new Set(normalized.tasks.map((task) => task.status))).sort().map((status) => (
              <option key={status} value={status}>{humanizeToken(status)}</option>
            ))}
          </select>
        </label>

        <label className="form-input" htmlFor={`${testId}-group-by`}>
          <span className="form-label">Board grouping</span>
          <select
            data-testid={`${testId}-group-by`}
            id={`${testId}-group-by`}
            onChange={(event) => onGroupByChange?.(event.target.value as TaskBoardGroupBy)}
            value={groupBy}
          >
            <option value="status">Status</option>
            <option value="actor">Actor</option>
            <option value="workflow">Workflow</option>
            <option value="none">None</option>
          </select>
        </label>
      </div>

      {loading && normalized.tasks.length === 0 ? <p className="state-message">Loading orchestration task board...</p> : null}
      {!loading && filteredTasks.length === 0 ? <p className="state-message">{emptyCopy}</p> : null}

      {filteredTasks.length > 0 ? (
        <div className="sessions-grid">
          <section className="session-detail-artifacts">
            <h4>Durable repo-state task board</h4>
            {groupedTasks.map((group) => (
              <div key={group.key} className="metadata-block">
                <h5>{group.label}</h5>
                <ul className="tracker-session-list executor-job-list">
                  {group.items.map((task) => {
                    const isSelected = selectedTask?.taskId === task.taskId;
                    return (
                      <li className={isSelected ? 'is-selected' : ''} key={task.taskId}>
                        <div>
                          <p className="tracker-item-title">{task.title}</p>
                          <p className="tracker-item-copy">
                            {[
                              task.taskId,
                              humanizeToken(task.status),
                              task.activeActorLabel || task.activeActorId ? `actor ${task.activeActorLabel || task.activeActorId}` : '',
                              task.workflowStatus ? `workflow ${humanizeToken(task.workflowStatus)}` : '',
                            ].filter(Boolean).join(' | ')}
                          </p>
                          <p className="tracker-item-copy">
                            {[
                              task.ownerSessionId ? `owner ${task.ownerSessionId}` : 'unowned',
                              task.worktreeId ? `worktree ${task.worktreeId}` : '',
                              task.worktreeMode ? `mode ${task.worktreeMode}` : '',
                            ].filter(Boolean).join(' | ')}
                          </p>
                        </div>
                        <div className="tracker-item-actions">
                          <Button
                            onClick={() => onSelectTask?.(task.taskId)}
                            size="sm"
                            testId={`${testId}-task-${task.taskId}`}
                            variant={isSelected ? 'primary' : 'ghost'}
                          >
                            {isSelected ? 'Selected' : 'Inspect'}
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </section>

          <section className="session-detail-artifacts">
            <h4>Selected durable task + live overlay context</h4>
            {selectedTask ? (
              <>
                <dl className="detail-grid">
                  <div>
                    <dt>Task</dt>
                    <dd>{selectedTask.taskId}</dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>{humanizeToken(selectedTask.status)}</dd>
                  </div>
                  <div>
                    <dt>Owner app session</dt>
                    <dd>{selectedTask.ownerSessionId || '(none)'}</dd>
                  </div>
                  <div>
                    <dt>Active actor</dt>
                    <dd>{selectedTask.activeActorLabel || selectedTask.activeActorId || '(none)'}</dd>
                  </div>
                  <div>
                    <dt>Workflow overlay</dt>
                    <dd>{selectedTask.workflowStatus ? humanizeToken(selectedTask.workflowStatus) : '(none)'}</dd>
                  </div>
                  <div>
                    <dt>Worktree isolation</dt>
                    <dd>{selectedTask.worktreeId || selectedTask.worktreePath || selectedTask.worktreeMode || '(shared / unspecified)'}</dd>
                  </div>
                </dl>
                {selectedTask.linkedPlanningSummary ? (
                  <p className="tracker-item-copy">Linked planning: {selectedTask.linkedPlanningSummary}</p>
                ) : null}
                {selectedTask.durablePath ? <p className="tracker-item-copy">Durable path: {selectedTask.durablePath}</p> : null}
              </>
            ) : (
              <p className="state-message">Select a durable repo-state task to inspect its runtime overlay summary.</p>
            )}
          </section>
        </div>
      ) : null}
    </section>
  );
}
