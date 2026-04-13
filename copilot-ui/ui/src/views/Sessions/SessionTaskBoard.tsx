import { StatusBadge } from '../../components';
import { humanizeToken } from '../../lib/stateDiagnostics';
import type { SessionOrchestrationProjection, SessionOrchestrationTaskBoardItem, SessionOrchestrationActor } from '../../lib/types';

interface Props {
  orchestration: SessionOrchestrationProjection | null;
}

type KanbanColumn = 'todo' | 'in_progress' | 'done';

function classifyStatus(status: string | null | undefined): KanbanColumn {
  const normalized = (status ?? '').toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'in_progress' || normalized === 'running' || normalized === 'active') {
    return 'in_progress';
  }
  if (normalized === 'done' || normalized === 'complete' || normalized === 'completed') {
    return 'done';
  }
  return 'todo';
}

const COLUMN_LABELS: Record<KanbanColumn, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  done: 'Done',
};

function TaskCard({ task }: { task: SessionOrchestrationTaskBoardItem }) {
  return (
    <div className="task-card" data-testid="task-card">
      <div className="task-card-title">{task.title ?? task.taskId}</div>
      <div className="task-card-meta">
        <StatusBadge
          status={humanizeToken(task.status)}
          testId="task-status-badge"
        />
        {task.activeActorLabel && (
          <span className="task-card-assignee" data-testid="task-assignee">
            {task.activeActorLabel}
          </span>
        )}
      </div>
    </div>
  );
}

function ActorCard({ actor }: { actor: SessionOrchestrationActor }) {
  const statusLabel = actor.status ?? 'unknown';
  const isActive = statusLabel === 'active' || statusLabel === 'running';
  return (
    <div className={`task-card task-card-actor${isActive ? ' task-card-actor-active' : ''}`} data-testid="actor-card">
      <div className="task-card-title">
        {isActive && <span className="actor-pulse" data-testid="actor-pulse">●</span>}
        {' '}{actor.label ?? actor.actorId}
      </div>
      <div className="task-card-meta">
        <StatusBadge status={humanizeToken(statusLabel)} testId="actor-status-badge" />
        {actor.role && (
          <span className="task-card-role" data-testid="actor-role">{actor.role}</span>
        )}
        {actor.invocationCount != null && actor.invocationCount > 0 && (
          <span className="task-card-invocations" data-testid="actor-invocations">
            {actor.invocationCount} call{actor.invocationCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>
    </div>
  );
}

function BackgroundActorsSection({ actors }: { actors: SessionOrchestrationActor[] }) {
  if (actors.length === 0) return null;
  const active = actors.filter((a) => a.status === 'active' || a.status === 'running');
  const completed = actors.filter((a) => a.status !== 'active' && a.status !== 'running');

  return (
    <div className="background-actors-section" data-testid="background-actors-section">
      <h4 className="background-actors-title">
        Background Agents
        {active.length > 0 && (
          <span className="background-actors-count" data-testid="active-agents-count">
            {' '}({active.length} active)
          </span>
        )}
      </h4>
      <div className="background-actors-list">
        {active.map((a) => <ActorCard key={a.actorId} actor={a} />)}
        {completed.map((a) => <ActorCard key={a.actorId} actor={a} />)}
      </div>
    </div>
  );
}

function KanbanColumnView({
  column,
  tasks,
}: {
  column: KanbanColumn;
  tasks: SessionOrchestrationTaskBoardItem[];
}) {
  return (
    <div className="kanban-column" data-testid={`kanban-column-${column}`}>
      <div className="kanban-column-header">
        <span className="kanban-column-title">{COLUMN_LABELS[column]}</span>
        <span className="kanban-column-count">{tasks.length}</span>
      </div>
      <div className="kanban-column-body">
        {tasks.map((task) => (
          <TaskCard key={task.taskId} task={task} />
        ))}
      </div>
    </div>
  );
}

export default function SessionTaskBoard({ orchestration }: Props) {
  const items = orchestration?.taskBoard?.items ?? [];
  const actors = orchestration?.actors?.items ?? [];

  if (items.length === 0 && actors.length === 0) {
    return (
      <div className="session-task-board" data-testid="session-task-board">
        <div className="session-empty-state" data-testid="task-board-empty">
          No tasks for this session
        </div>
      </div>
    );
  }

  const columns: Record<KanbanColumn, SessionOrchestrationTaskBoardItem[]> = {
    todo: [],
    in_progress: [],
    done: [],
  };

  for (const task of items) {
    const col = classifyStatus(task.status);
    columns[col].push(task);
  }

  return (
    <div className="session-task-board" data-testid="session-task-board">
      <BackgroundActorsSection actors={actors} />
      {items.length > 0 && (
        <div className="kanban-board">
          <KanbanColumnView column="todo" tasks={columns.todo} />
          <KanbanColumnView column="in_progress" tasks={columns.in_progress} />
          <KanbanColumnView column="done" tasks={columns.done} />
        </div>
      )}
    </div>
  );
}
