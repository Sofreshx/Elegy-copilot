import { useCallback, useEffect, useRef, useState } from 'react';
import { Panel, PageContainer } from '../components';
import HealthDot from '../components/HealthDot';
import { navigationStore } from '../stores/navigation';

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
  sessions?: DashboardHarnessSession[];
}

interface DashboardHarnessSessionsSummaryResponse {
  snapshotId: string;
  totalSessionCount: number;
  harnesses: DashboardHarnessSummary[];
}

interface DashboardHarnessSessionsPageResponse {
  snapshotId: string;
  harness: DashboardHarnessSummary;
  sessions: DashboardHarnessSession[];
  page: {
    hasMore: boolean;
    nextCursor: string | null;
  };
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
  const [pageLoading, setPageLoading] = useState(false);
  const [visibleSessions, setVisibleSessions] = useState<DashboardHarnessSession[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const selectedHarnessIdRef = useRef<string | null>(null);
  const refreshControllerRef = useRef<AbortController | null>(null);
  const pageControllerRef = useRef<AbortController | null>(null);
  const refreshInFlightRef = useRef(false);
  const pageRequestIdRef = useRef(0);

  const loadPage = useCallback(async (
    harnessId: string,
    cursor: string | null,
    append: boolean,
    parentSignal?: AbortSignal,
  ) => {
    const requestId = pageRequestIdRef.current + 1;
    pageRequestIdRef.current = requestId;
    pageControllerRef.current?.abort();
    const controller = new AbortController();
    pageControllerRef.current = controller;
    const abortFromParent = () => controller.abort();
    if (parentSignal) {
      if (parentSignal.aborted) controller.abort();
      else parentSignal.addEventListener('abort', abortFromParent, { once: true });
    }
    setPageLoading(true);
    setPageError(null);
    try {
      let requestedCursor = cursor;
      let shouldAppend = append;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const params = new URLSearchParams({ limit: '100' });
        if (requestedCursor) params.set('cursor', requestedCursor);
        const response = await fetch(`/api/dashboard/harness-sessions/${encodeURIComponent(harnessId)}?${params.toString()}`, {
          signal: controller.signal,
        });
        const body = await response.json().catch(() => null) as (DashboardHarnessSessionsPageResponse & { error?: string; message?: string }) | null;
        if (response.status === 409 && body?.error === 'stale_cursor' && requestedCursor) {
          requestedCursor = null;
          shouldAppend = false;
          continue;
        }
        if (!response.ok || !body || !Array.isArray(body.sessions)) {
          throw new Error(body?.message || 'Session page could not be loaded.');
        }
        if (controller.signal.aborted || requestId !== pageRequestIdRef.current) return;
        setVisibleSessions((current) => shouldAppend ? [...current, ...body.sessions] : body.sessions);
        setNextCursor(body.page?.nextCursor || null);
        return;
      }
    } catch (error) {
      if (!controller.signal.aborted && requestId === pageRequestIdRef.current) {
        setPageError(error instanceof Error ? error.message : 'Session page could not be loaded.');
      }
    } finally {
      if (parentSignal) parentSignal.removeEventListener('abort', abortFromParent);
      if (requestId === pageRequestIdRef.current) {
        setPageLoading(false);
        if (pageControllerRef.current === controller) pageControllerRef.current = null;
      }
    }
  }, []);

  const load = useCallback(async () => {
    if (refreshInFlightRef.current || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) {
      return;
    }
    refreshInFlightRef.current = true;
    refreshControllerRef.current?.abort();
    const controller = new AbortController();
    refreshControllerRef.current = controller;
    try {
      const [harnessesRes, summaryRes] = await Promise.allSettled([
        fetch('/api/dashboard/harness-sessions/summary', { signal: controller.signal }).then(async (response) => {
          if (!response.ok) throw new Error('Harness session summary could not be loaded.');
          return response.json() as Promise<DashboardHarnessSessionsSummaryResponse>;
        }),
        fetch('/api/dashboard/summary', { signal: controller.signal }).then((response) => (
          response.ok ? response.json() as Promise<DashboardSummary> : null
        )),
      ]);
      if (controller.signal.aborted) return;

      if (summaryRes.status === 'fulfilled' && summaryRes.value) setSummary(summaryRes.value);
      if (harnessesRes.status === 'rejected') {
        setInventoryError(harnessesRes.reason instanceof Error
          ? harnessesRes.reason.message
          : 'Harness session summary could not be loaded.');
        return;
      }

      const nextHarnesses = Array.isArray(harnessesRes.value.harnesses)
        ? harnessesRes.value.harnesses
        : [];
      setInventoryError(null);
      const nextSelectedHarnessId = resolveSelectedHarnessId(selectedHarnessIdRef.current, nextHarnesses);
      selectedHarnessIdRef.current = nextSelectedHarnessId;
      setHarnesses(nextHarnesses);
      setSelectedHarnessId(nextSelectedHarnessId);

      const nextSelectedHarness = nextHarnesses.find((harness) => harness.harnessId === nextSelectedHarnessId);
      if (nextSelectedHarness?.inventoryAvailable) {
        await loadPage(nextSelectedHarness.harnessId, null, false, controller.signal);
      } else {
        setVisibleSessions([]);
        setNextCursor(null);
        setPageError(null);
      }
    } catch {
      // The Runtime view keeps its last successful snapshot during transient failures.
    } finally {
      if (!controller.signal.aborted) setLoading(false);
      if (refreshControllerRef.current === controller) refreshControllerRef.current = null;
      refreshInFlightRef.current = false;
    }
  }, [loadPage]);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const clearTimer = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    const run = async () => {
      clearTimer();
      await load();
      if (!disposed && document.visibilityState !== 'hidden') {
        timer = setTimeout(() => void run(), 30_000);
      }
    };
    const handleVisibilityChange = () => {
      clearTimer();
      if (document.visibilityState === 'hidden') {
        refreshControllerRef.current?.abort();
        pageControllerRef.current?.abort();
        return;
      }
      void run();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    void run();

    return () => {
      disposed = true;
      clearTimer();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      refreshControllerRef.current?.abort();
      pageControllerRef.current?.abort();
    };
  }, [load]);

  const totalCount = summary?.totalSessionCount ?? harnesses.reduce((sum, harness) => sum + harness.sessionCount, 0);
  const selectedHarness = harnesses.find((harness) => harness.harnessId === selectedHarnessId) ?? harnesses[0] ?? null;
  const selectedHarnessSessions = selectedHarness
    ? [...visibleSessions].sort(
      (left, right) => (right.updatedAtMs || right.startedAtMs || 0) - (left.updatedAtMs || left.startedAtMs || 0),
    )
    : [];

  function handleOpenHarnessSession(session: DashboardHarnessSession) {
    if (!selectedHarness || !session.canOpen) {
      return;
    }
    navigationStore.selectSession(session.sessionId, 'activity', { source: session.source || 'cli' });
  }

  function handleSelectHarness(harness: DashboardHarnessSummary) {
    selectedHarnessIdRef.current = harness.harnessId;
    setSelectedHarnessId(harness.harnessId);
    setVisibleSessions([]);
    setNextCursor(null);
    setPageError(null);
    if (harness.inventoryAvailable) {
      void loadPage(harness.harnessId, null, false);
    }
  }

  return (
    <PageContainer testId="dashboard-page-container">
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
      </div>

      <Panel
        title={`Harness Sessions (${harnesses.length})`}
        subtitle="Browse stored sessions by harness, then inspect each harness inventory newest-first."
        testId="execution-hub-harness-sessions"
      >
        {inventoryError ? (
          <p className="active-sessions-empty" role="status" data-testid="execution-hub-refresh-error">
            {inventoryError} Showing the last successful snapshot.
          </p>
        ) : null}
        {loading ? (
          <p className="active-sessions-empty" data-testid="execution-hub-loading">Loading sessions…</p>
        ) : harnesses.length === 0 ? (
          <div className="execution-hub-empty-state" data-testid="execution-hub-empty-state">
            <p style={{ fontSize: '1.1rem', marginBottom: 8 }}>No sessions yet</p>
            <p style={{ opacity: 0.7, marginBottom: 16 }}>Sessions will appear here once you run code in a supported harness.</p>
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
                  onClick={() => handleSelectHarness(harness)}
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
                  ) : pageLoading && selectedHarnessSessions.length === 0 ? (
                    <p className="active-sessions-empty" data-testid="execution-hub-page-loading">Loading session page…</p>
                  ) : pageError && selectedHarnessSessions.length === 0 ? (
                    <p className="active-sessions-empty" data-testid="execution-hub-page-error">{pageError}</p>
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
                      {nextCursor ? (
                        <button
                          type="button"
                          className="execution-hub-harness-session-card is-openable"
                          data-testid="execution-hub-load-more"
                          disabled={pageLoading}
                          onClick={() => void loadPage(selectedHarness.harnessId, nextCursor, true)}
                        >
                          {pageLoading ? 'Loading…' : 'Load more sessions'}
                        </button>
                      ) : null}
                      {pageError ? <p className="active-sessions-empty" role="alert">{pageError}</p> : null}
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
    </PageContainer>
  );
}
