import { StatusBadge } from '../../components';
import { humanizeToken } from '../../lib/stateDiagnostics';
import type { SessionOrchestrationProjection, SessionOrchestrationTaskBoardItem } from '../../lib/types';

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

  if (items.length === 0) {
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
      <div className="kanban-board">
        <KanbanColumnView column="todo" tasks={columns.todo} />
        <KanbanColumnView column="in_progress" tasks={columns.in_progress} />
        <KanbanColumnView column="done" tasks={columns.done} />
      </div>
    </div>
  );
}
