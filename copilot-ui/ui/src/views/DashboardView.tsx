import { useCallback, useEffect, useState } from 'react';
import { Panel } from '../components';
import HealthDot from '../components/HealthDot';
import { STOCK_SESSIONS } from '../constants/stockSessions';
import type { StockSession } from '../constants/stockSessions';
import { navigationStore } from '../stores/navigation';
import PlanFromBacklogPanel from './Dashboard/PlanFromBacklogPanel';
import { sessionWizardStore } from './Sessions/sessionWizardStore';

interface DashboardHarnessSession {
  sessionId: string;
  title: string;
  canOpen?: boolean;
  projectName?: string | null;
  repoLabel?: string | null;
  source?: string | null;
  status: string;
  elapsedMs?: number | null;
  startedAtMs?: number | null;
  updatedAtMs?: number | null;
}

interface DashboardHarnessSummary {
  harnessId: string;
  title: string;
  inventoryAvailable: boolean;
  inventoryReason?: string | null;
  sessionCount: number;
  latestUpdatedAtMs?: number | null;
  sessions: DashboardHarnessSession[];
}

interface DashboardHarnessSessionsResponse {
  totalSessionCount: number;
  harnesses: DashboardHarnessSummary[];
}

interface DashboardSummary {
  activeSessionCount: number;
  totalSessionCount: number;
  healthIndicator: 'ok' | 'degraded' | 'error';
  recentActivity: Array<{
    type: string;
    timestamp: string | number | null;
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

function formatTimestamp(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return 'No recent activity';
  return new Date(ms).toLocaleString();
}

function normalizeStatus(s: string): 'active' | 'idle' | 'completed' | 'failed' | 'unknown' {
  const lower = (s || '').toLowerCase();
  if (lower === 'active' || lower === 'running') return 'active';
  if (lower === 'idle' || lower === 'paused') return 'idle';
  if (lower === 'completed' || lower === 'done') return 'completed';
  if (lower === 'failed' || lower === 'error') return 'failed';
  return 'unknown';
}

function resolveSelectedHarnessId(
  currentSelectedHarnessId: string | null,
  nextHarnesses: DashboardHarnessSummary[],
): string | null {
  if (currentSelectedHarnessId && nextHarnesses.some((harness) => harness.harnessId === currentSelectedHarnessId)) {
    return currentSelectedHarnessId;
  }
  return nextHarnesses.find((harness) => harness.sessionCount > 0)?.harnessId ?? nextHarnesses[0]?.harnessId ?? null;
}

export default function DashboardView() {
  const [harnesses, setHarnesses] = useState<DashboardHarnessSummary[]>([]);
  const [selectedHarnessId, setSelectedHarnessId] = useState<string | null>(null);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [backlogPanelOpen, setBacklogPanelOpen] = useState(false);

  function handleStockSession(preset: StockSession) {
    if (preset.usesBacklogFlow) {
      setBacklogPanelOpen(true);
      return;
    }
    sessionWizardStore.reset();
    sessionWizardStore.setAgentId(preset.agentId);
    if (preset.defaultModel) sessionWizardStore.setModel(preset.defaultModel);
    if (preset.objectiveTemplate) sessionWizardStore.setObjective(preset.objectiveTemplate);
    if (preset.opensToObjective) sessionWizardStore.setStep(1);
    navigationStore.openWizard('session');
  }

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [harnessesRes, summaryRes] = await Promise.allSettled([
        fetch('/api/dashboard/harness-sessions', { signal }).then((r) =>
          r.ok ? r.json() : { totalSessionCount: 0, harnesses: [] },
        ),
        fetch('/api/dashboard/summary', { signal }).then((r) => (r.ok ? r.json() : null)),
      ]);

      if (signal?.aborted) return;

      const nextHarnesses = harnessesRes.status === 'fulfilled'
        ? (Array.isArray((harnessesRes.value as DashboardHarnessSessionsResponse).harnesses)
          ? (harnessesRes.value as DashboardHarnessSessionsResponse).harnesses
          : [])
        : [];

      setHarnesses(nextHarnesses);
      setSelectedHarnessId((currentSelectedHarnessId) => resolveSelectedHarnessId(currentSelectedHarnessId, nextHarnesses));
      setSummary(summaryRes.status === 'fulfilled' ? summaryRes.value : null);
    } catch {
      // API not available yet — show empty state
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    void load(controller.signal);
    const interval = setInterval(() => void load(controller.signal), 10000);

    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [load]);

  const totalCount = summary?.totalSessionCount ?? harnesses.reduce((sum, harness) => sum + harness.sessionCount, 0);
  const selectedHarness = harnesses.find((harness) => harness.harnessId === selectedHarnessId) ?? harnesses[0] ?? null;
  const selectedHarnessSessions = selectedHarness
    ? [...(Array.isArray(selectedHarness.sessions) ? selectedHarness.sessions : [])].sort(
      (left, right) => (right.updatedAtMs || right.startedAtMs || 0) - (left.updatedAtMs || left.startedAtMs || 0),
    )
    : [];

  function handleOpenHarnessSession(session: DashboardHarnessSession) {
    if (!selectedHarness || !session.canOpen) {
      return;
    }
    navigationStore.selectSession(session.sessionId, 'activity', { source: session.source || 'cli' });
  }

  return (
    <div className="dashboard-view" data-testid="execution-hub">
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

      {backlogPanelOpen ? <PlanFromBacklogPanel onClose={() => setBacklogPanelOpen(false)} /> : null}

      <Panel
        title={`Harness Sessions (${harnesses.length})`}
        subtitle="Browse stored sessions by harness, then inspect each harness inventory newest-first."
        testId="execution-hub-harness-sessions"
      >
        {loading ? (
          <p className="active-sessions-empty" data-testid="execution-hub-loading">Loading sessions…</p>
        ) : harnesses.length === 0 ? (
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
        ) : (
          <div className="execution-hub-harness-layout">
            <div className="execution-hub-harness-list" data-testid="execution-hub-harness-list">
              {harnesses.map((harness) => (
                <button
                  key={harness.harnessId}
                  type="button"
                  className={`execution-hub-harness-card ${selectedHarness?.harnessId === harness.harnessId ? 'is-selected' : ''}`}
                  data-testid={`execution-hub-harness-${harness.harnessId}`}
                  onClick={() => setSelectedHarnessId(harness.harnessId)}
                >
                  <span className="execution-hub-harness-title">{harness.title}</span>
                  <span className="execution-hub-harness-count">{harness.sessionCount} session{harness.sessionCount !== 1 ? 's' : ''}</span>
                  <span className="execution-hub-harness-meta">
                    {harness.inventoryAvailable ? formatTimestamp(harness.latestUpdatedAtMs) : 'Inventory unavailable'}
                  </span>
                </button>
              ))}
            </div>

            <div className="execution-hub-harness-detail">
              {selectedHarness ? (
                <>
                  <div className="execution-hub-harness-detail-header">
                    <h3 className="execution-hub-harness-detail-title" data-testid="execution-hub-selected-harness-title">
                      {selectedHarness.title}
                    </h3>
                    <p className="execution-hub-harness-detail-copy">
                      {selectedHarness.sessionCount} session{selectedHarness.sessionCount !== 1 ? 's' : ''} · latest activity {formatTimestamp(selectedHarness.latestUpdatedAtMs)}
                    </p>
                  </div>

                  {!selectedHarness.inventoryAvailable ? (
                    <p className="active-sessions-empty" data-testid="execution-hub-harness-unavailable">
                      Session inventory is not available for {selectedHarness.title} yet.
                    </p>
                  ) : selectedHarnessSessions.length === 0 ? (
                    <p className="active-sessions-empty" data-testid="execution-hub-harness-empty">
                      No sessions were found for {selectedHarness.title}.
                    </p>
                  ) : (
                    <div className="execution-hub-harness-session-list" data-testid="execution-hub-harness-session-list">
                      {selectedHarnessSessions.map((session) => {
                        const status = normalizeStatus(session.status);
                        const content = (
                          <>
                            <div className="execution-hub-harness-session-main">
                              <span
                                className="execution-hub-harness-session-title"
                                data-testid={`execution-hub-harness-session-title-${session.sessionId}`}
                              >
                                {session.title}
                              </span>
                              <span className="execution-hub-harness-session-copy">
                                {session.repoLabel || session.projectName || session.source || 'No repo context'}
                              </span>
                            </div>
                            <div className="execution-hub-harness-session-side">
                              <span className="execution-hub-harness-session-updated">{formatTimestamp(session.updatedAtMs || session.startedAtMs || null)}</span>
                              <span className={`execution-hub-harness-session-status status-${status}`}>{status}</span>
                              {session.elapsedMs ? (
                                <span className="execution-hub-harness-session-elapsed">{formatElapsed(session.elapsedMs)}</span>
                              ) : null}
                            </div>
                          </>
                        );

                        if (!session.canOpen) {
                          return (
                            <article
                              key={`${selectedHarness.harnessId}:${session.sessionId}`}
                              className="execution-hub-harness-session-card"
                              data-testid={`execution-hub-harness-session-${session.sessionId}`}
                            >
                              {content}
                            </article>
                          );
                        }

                        return (
                          <button
                            key={`${selectedHarness.harnessId}:${session.sessionId}`}
                            type="button"
                            className="execution-hub-harness-session-card is-openable"
                            data-testid={`execution-hub-harness-session-${session.sessionId}`}
                            onClick={() => handleOpenHarnessSession(session)}
                          >
                            {content}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              ) : (
                <p className="active-sessions-empty">Select a harness to inspect its session inventory.</p>
              )}
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
