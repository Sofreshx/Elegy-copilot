import { CompactSessionCard } from '../../components';
import { useStoreValue } from '../../lib/store';
import { navigationStore } from '../../stores/navigation';
import { projectOverviewStore } from './projectOverviewStore';
import type { ProjectSession } from './projectOverviewStore';

// ── Helpers ──

function normalizeStatus(s: string): 'active' | 'idle' | 'completed' | 'failed' | 'unknown' {
  const lower = (s || '').toLowerCase();
  if (lower === 'active' || lower === 'running') return 'active';
  if (lower === 'idle' || lower === 'paused') return 'idle';
  if (lower === 'completed' || lower === 'done') return 'completed';
  if (lower === 'failed' || lower === 'error') return 'failed';
  return 'unknown';
}

function formatElapsed(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return '';
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function sortByUpdatedDesc(a: ProjectSession, b: ProjectSession): number {
  const aTime = a.updatedAtMs ?? 0;
  const bTime = b.updatedAtMs ?? 0;
  return bTime - aTime;
}

// ── Component ──

export default function ProjectSessionsList() {
  const { sessions, loading } = useStoreValue(projectOverviewStore);

  const sorted = [...sessions].sort(sortByUpdatedDesc);

  if (loading) {
    return (
      <div className="project-sessions-list" data-testid="project-sessions-list">
        <p className="project-sessions-empty">Loading…</p>
      </div>
    );
  }

  if (sorted.length === 0) {
    return (
      <div className="project-sessions-list" data-testid="project-sessions-list">
        <p className="project-sessions-empty">No sessions for this project. Start one!</p>
      </div>
    );
  }

  return (
    <div className="project-sessions-list" data-testid="project-sessions-list">
      {sorted.map((session) => (
        <CompactSessionCard
          key={session.id}
          id={session.id}
          title={session.title}
          status={normalizeStatus(session.status)}
          elapsed={formatElapsed(session.elapsedMs)}
          onSelect={(id) => navigationStore.selectSession(id, 'activity', { source: session.source })}
          testId={`project-session-${session.id}`}
        />
      ))}
    </div>
  );
}
