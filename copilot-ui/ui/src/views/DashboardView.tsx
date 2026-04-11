import { useEffect, useState } from 'react';
import { Panel } from '../components';
import CompactSessionCard from '../components/CompactSessionCard';
import HealthDot from '../components/HealthDot';
import { navigationStore } from '../stores/navigation';

interface DashboardSession {
  id: string;
  title: string;
  projectId?: string | null;
  projectName?: string | null;
  repoLabel?: string | null;
  status: string;
  elapsedMs?: number | null;
  updatedAtMs?: number | null;
}

interface DashboardSummary {
  activeSessionCount: number;
  totalSessionCount: number;
  healthIndicator: 'ok' | 'degraded' | 'error';
  recentActivity: Array<{
    type: string;
    timestamp: string;
    summary: string;
  }>;
}

function formatElapsed(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return '';
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatTimeAgo(isoOrMs: string | number): string {
  const ms = typeof isoOrMs === 'number' ? isoOrMs : new Date(isoOrMs).getTime();
  const diff = Date.now() - ms;
  if (diff < 60000) return 'just now';
  const min = Math.floor(diff / 60000);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function normalizeStatus(s: string): 'active' | 'idle' | 'completed' | 'failed' | 'unknown' {
  const lower = (s || '').toLowerCase();
  if (lower === 'active' || lower === 'running') return 'active';
  if (lower === 'idle' || lower === 'paused') return 'idle';
  if (lower === 'completed' || lower === 'done') return 'completed';
  if (lower === 'failed' || lower === 'error') return 'failed';
  return 'unknown';
}

export default function DashboardView() {
  const [sessions, setSessions] = useState<DashboardSession[]>([]);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [sessionsRes, summaryRes] = await Promise.allSettled([
          fetch('/api/sessions/unified?limit=20').then((r) => r.ok ? r.json() : []),
          fetch('/api/dashboard/summary').then((r) => r.ok ? r.json() : null),
        ]);

        if (cancelled) return;

        setSessions(sessionsRes.status === 'fulfilled' ? sessionsRes.value : []);
        setSummary(summaryRes.status === 'fulfilled' ? summaryRes.value : null);
      } catch {
        // API not available yet — show empty state
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    const interval = setInterval(() => void load(), 15000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const activeSessions = sessions.filter((s) => {
    const status = normalizeStatus(s.status);
    return status === 'active' || status === 'idle';
  });

  const healthTone = summary?.healthIndicator === 'error' ? 'error'
    : summary?.healthIndicator === 'degraded' ? 'warn'
    : 'ok';

  const healthLabel = summary?.healthIndicator === 'error' ? 'Issues detected'
    : summary?.healthIndicator === 'degraded' ? 'Degraded'
    : 'All systems operational';

  return (
    <div className="dashboard-view" data-testid="dashboard-view">
      {/* Health Summary */}
      <div className={`health-summary health-summary-${summary?.healthIndicator || 'ok'}`} data-testid="dashboard-health">
        <HealthDot tone={healthTone} />
        <span>{healthLabel}</span>
        {summary ? (
          <span style={{ marginLeft: 'auto', fontSize: '0.78rem', opacity: 0.7 }}>
            {summary.activeSessionCount} active / {summary.totalSessionCount} total sessions
          </span>
        ) : null}
      </div>

      {/* Quick Launch */}
      <div className="dashboard-quick-launch">
        <button
          className="button button-primary"
          data-testid="dashboard-new-session"
          onClick={() => navigationStore.openWizard('session')}
          type="button"
        >
          + New Session
        </button>
        <button
          className="button button-secondary"
          data-testid="dashboard-add-project"
          onClick={() => navigationStore.openWizard('project')}
          type="button"
        >
          Add Project
        </button>
      </div>

      {/* Active Sessions */}
      <Panel title="Active Sessions" testId="dashboard-active-sessions">
        {loading ? (
          <p className="active-sessions-empty">Loading sessions…</p>
        ) : activeSessions.length === 0 ? (
          <p className="active-sessions-empty">No active sessions. Start one above!</p>
        ) : (
          <div className="active-sessions-strip">
            {activeSessions.map((session) => (
              <CompactSessionCard
                key={session.id}
                id={session.id}
                title={session.title}
                projectName={session.projectName || undefined}
                repoLabel={session.repoLabel || undefined}
                status={normalizeStatus(session.status)}
                elapsed={formatElapsed(session.elapsedMs)}
                onSelect={(id) => navigationStore.selectSession(id)}
                testId={`dashboard-session-${session.id}`}
              />
            ))}
          </div>
        )}
      </Panel>

      {/* Recent Activity */}
      <Panel title="Recent Activity" testId="dashboard-recent-activity">
        {summary?.recentActivity && summary.recentActivity.length > 0 ? (
          <div className="recent-activity-feed">
            {summary.recentActivity.slice(0, 10).map((item, i) => (
              <div className="activity-item" key={`${item.timestamp}-${i}`}>
                <span className="activity-item-time">{formatTimeAgo(item.timestamp)}</span>
                <span className="activity-item-summary">{item.summary}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="active-sessions-empty">No recent activity</p>
        )}
      </Panel>
    </div>
  );
}
