import { Panel } from '../../components';
import { useStoreValue } from '../../lib/store';
import { navigationStore } from '../../stores/navigation';
import { projectOverviewStore } from './projectOverviewStore';
import type { ProjectSession } from './projectOverviewStore';

// ── Helpers ──

type TaskColumn = 'backlog' | 'inProgress' | 'done';

function classifySession(status: string): TaskColumn {
  const lower = (status || '').toLowerCase();
  if (lower === 'active' || lower === 'running') return 'inProgress';
  if (lower === 'completed' || lower === 'done') return 'done';
  return 'backlog';
}

function formatElapsed(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return '';
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ── Sub-components ──

interface TaskCardProps {
  session: ProjectSession;
}

function TaskCard({ session }: TaskCardProps) {
  return (
    <div
      className="task-card"
      data-testid={`task-card-${session.id}`}
      role="button"
      tabIndex={0}
      onClick={() => navigationStore.selectSession(session.id, 'activity', { source: session.source })}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          navigationStore.selectSession(session.id, 'activity', { source: session.source });
        }
      }}
    >
      <span className="task-card-title">{session.title}</span>
      <span className="task-card-status">{session.status}</span>
      {session.elapsedMs ? (
        <span className="task-card-elapsed">{formatElapsed(session.elapsedMs)}</span>
      ) : null}
    </div>
  );
}

interface ColumnProps {
  title: string;
  sessions: ProjectSession[];
  testId: string;
}

function Column({ title, sessions, testId }: ColumnProps) {
  return (
    <div className="task-column" data-testid={testId}>
      <h4 className="task-column-title">
        {title} <span className="task-column-count">({sessions.length})</span>
      </h4>
      <div className="task-column-cards">
        {sessions.length === 0 ? (
          <p className="task-column-empty">No items</p>
        ) : (
          sessions.map((s) => <TaskCard key={s.id} session={s} />)
        )}
      </div>
    </div>
  );
}

// ── Main component ──

export default function ProjectTaskBoard() {
  const { sessions, loading } = useStoreValue(projectOverviewStore);

  if (loading) {
    return (
      <div className="project-task-board" data-testid="project-task-board">
        <p>Loading…</p>
      </div>
    );
  }

  const backlog: ProjectSession[] = [];
  const inProgress: ProjectSession[] = [];
  const done: ProjectSession[] = [];

  for (const session of sessions) {
    const column = classifySession(session.status);
    if (column === 'backlog') backlog.push(session);
    else if (column === 'inProgress') inProgress.push(session);
    else done.push(session);
  }

  return (
    <div className="project-task-board" data-testid="project-task-board">
      <Panel title="Task Board" subtitle="Sessions mapped to task columns">
        <div className="task-board-columns">
          <Column title="Backlog" sessions={backlog} testId="task-column-backlog" />
          <Column title="In Progress" sessions={inProgress} testId="task-column-in-progress" />
          <Column title="Done" sessions={done} testId="task-column-done" />
        </div>
      </Panel>
    </div>
  );
}
