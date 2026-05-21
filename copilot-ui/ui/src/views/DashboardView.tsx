import { useEffect, useState, useCallback } from 'react';
import { Panel } from '../components';
import CompactSessionCard from '../components/CompactSessionCard';
import HealthDot from '../components/HealthDot';
import { navigationStore } from '../stores/navigation';
import { STOCK_SESSIONS } from '../constants/stockSessions';
import type { StockSession } from '../constants/stockSessions';
import PlanFromBacklogPanel from './Dashboard/PlanFromBacklogPanel';
import { sessionWizardStore } from './Sessions/sessionWizardStore';

interface DashboardSession {
  sessionId: string;
  objective?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  repoLabel?: string | null;
  source?: string | null;
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
  const [backlogPanelOpen, setBacklogPanelOpen] = useState(false);

  function handleStockSession(preset: StockSession) {
    if (preset.usesBacklogFlow) {
      setBacklogPanelOpen(true);
      return;
    }
    // Pre-fill the wizard and open it
    sessionWizardStore.reset();
    sessionWizardStore.setAgentId(preset.agentId);
    if (preset.defaultModel) sessionWizardStore.setModel(preset.defaultModel);
    if (preset.objectiveTemplate) sessionWizardStore.setObjective(preset.objectiveTemplate);
    if (preset.opensToObjective) sessionWizardStore.setStep(1);
    navigationStore.openWizard('session');
  }

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [sessionsRes, summaryRes] = await Promise.allSettled([
        fetch('/api/sessions/unified?limit=20', { signal }).then((r) => r.ok ? r.json() : []),
        fetch('/api/dashboard/summary', { signal }).then((r) => r.ok ? r.json() : null),
      ]);

      if (signal?.aborted) return;

      setSessions(sessionsRes.status === 'fulfilled' ? sessionsRes.value : []);
      setSummary(summaryRes.status === 'fulfilled' ? summaryRes.value : null);
    } catch {
      // API not available yet — show empty state
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  // Initial load + auto-refresh every 10s for active sessions
  useEffect(() => {
    const controller = new AbortController();

    void load(controller.signal);
    const interval = setInterval(() => void load(controller.signal), 10000);

    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [load]);

  const activeSessions = sessions.filter((s) => {
    const status = normalizeStatus(s.status);
    return status === 'active' || status === 'idle';
  });

  const recentSessions = sessions.filter((s) => {
    const status = normalizeStatus(s.status);
    return status !== 'active' && status !== 'idle';
  });

  const totalCount = summary?.totalSessionCount ?? sessions.length;

  return (
    <div className="dashboard-view" data-testid="execution-hub">
      {/* Runtime Header */}
      <div className="execution-hub-header" data-testid="execution-hub-header">
        <div className="execution-hub-header-left">
          <h1 className="execution-hub-title" data-testid="execution-hub-title">Runtime</h1>
          <span className="execution-hub-count" data-testid="execution-hub-count">
            {totalCount} session{totalCount !== 1 ? 's' : ''}
          </span>
          {summary ? (
            <span className="execution-hub-health" data-testid="execution-hub-health">
              <HealthDot tone={summary.healthIndicator === 'error' ? 'error' : summary.healthIndicator === 'degraded' ? 'warn' : 'ok'} />
            </span>
          ) : null}
        </div>
        <button
          className="button button-primary"
          data-testid="execution-hub-new-session"
          onClick={() => navigationStore.openWizard('session')}
          type="button"
        >
          + New Session
        </button>
      </div>

      {/* Quick Start */}
      <div className="execution-hub-quick-start" data-testid="execution-hub-quick-start">
        <span className="execution-hub-quick-start-label">Quick Start</span>
        <div className="execution-hub-quick-start-grid" data-testid="execution-hub-quick-start-grid">
          {STOCK_SESSIONS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="execution-hub-stock-card"
              data-testid={`execution-hub-stock-${preset.id}`}
              onClick={() => handleStockSession(preset)}
            >
              <span className="execution-hub-stock-icon">{preset.icon}</span>
              <span className="execution-hub-stock-label">{preset.label}</span>
              <span className="execution-hub-stock-desc">{preset.description}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Plan from Backlog Panel */}
      {backlogPanelOpen && (
        <PlanFromBacklogPanel onClose={() => setBacklogPanelOpen(false)} />
      )}

      {/* Active Sessions */}
      <Panel title={`Active Sessions (${activeSessions.length})`} testId="execution-hub-active-sessions">
        {loading ? (
          <p className="active-sessions-empty" data-testid="execution-hub-loading">Loading sessions…</p>
        ) : activeSessions.length === 0 && recentSessions.length === 0 ? (
          <div className="execution-hub-empty-state" data-testid="execution-hub-empty-state">
            <p style={{ fontSize: '1.1rem', marginBottom: 8 }}>No sessions yet</p>
            <p style={{ opacity: 0.7, marginBottom: 16 }}>Create your first session to get started.</p>
            <button
              className="button button-primary"
              data-testid="execution-hub-empty-cta"
              onClick={() => navigationStore.openWizard('session')}
              type="button"
            >
              + Create First Session
            </button>
          </div>
        ) : activeSessions.length === 0 ? (
          <p className="active-sessions-empty" data-testid="execution-hub-no-active">No active sessions right now.</p>
        ) : (
          <div className="active-sessions-strip" data-testid="execution-hub-active-list">
            {activeSessions.map((session) => (
              <CompactSessionCard
                key={session.sessionId}
                id={session.sessionId}
                title={session.objective ?? 'Untitled'}
                projectName={session.projectName || undefined}
                repoLabel={session.repoLabel || undefined}
                status={normalizeStatus(session.status)}
                elapsed={formatElapsed(session.elapsedMs)}
                onSelect={(id) => navigationStore.selectSession(id, 'activity', { source: session.source })}
                testId={`execution-hub-session-${session.sessionId}`}
              />
            ))}
          </div>
        )}
      </Panel>

      {/* Recent Sessions */}
      {!loading && recentSessions.length > 0 ? (
        <Panel title={`Recent Sessions (${recentSessions.length})`} testId="execution-hub-recent-sessions">
          <div className="recent-sessions-list" data-testid="execution-hub-recent-list">
            {recentSessions.map((session) => (
              <CompactSessionCard
                key={session.sessionId}
                id={session.sessionId}
                title={session.objective ?? 'Untitled'}
                projectName={session.projectName || undefined}
                repoLabel={session.repoLabel || undefined}
                status={normalizeStatus(session.status)}
                elapsed={formatElapsed(session.elapsedMs)}
                onSelect={(id) => navigationStore.selectSession(id, 'activity', { source: session.source })}
                testId={`execution-hub-session-${session.sessionId}`}
              />
            ))}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
