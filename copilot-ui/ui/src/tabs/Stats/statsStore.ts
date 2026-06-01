import {
  getCatalogAssetAnalytics,
  getExecutorHealth,
  getHealth,
  getRuntimeCatalogHealth,
  getSessionAgentUsage,
  listSessions,
} from '../../lib/api';
import { resolveSessionStartedAt, resolveSessionUpdatedAt } from '../../lib/stateDiagnostics';
import { createStore } from '../../lib/store';
import type {
  CatalogAssetAuditAnalytics,
  ExecutorHealthResponse,
  HealthResponse,
  RuntimeCatalogHealthResponse,
  SessionAgentUsageResponse,
  SessionSummary,
} from '../../lib/types';

const STATS_POLL_INTERVAL_MS = 30_000;
export const STATS_RECENT_SESSION_SAMPLE_SIZE = 6;
export const STATS_SESSION_USAGE_LIMIT = 100;

export interface StatsSessionUsageSample {
  session: SessionSummary;
  usage: SessionAgentUsageResponse | null;
  error: string | null;
}

export interface StatsState {
  health: HealthResponse | null;
  healthError: string | null;
  catalogHealth: RuntimeCatalogHealthResponse | null;
  catalogHealthError: string | null;
  analytics: CatalogAssetAuditAnalytics | null;
  analyticsError: string | null;
  executorHealth: ExecutorHealthResponse | null;
  executorHealthError: string | null;
  sessions: SessionSummary[];
  sessionsError: string | null;
  recentSessionUsage: StatsSessionUsageSample[];
  usageError: string | null;
  loading: boolean;
  lastUpdatedAtMs: number | null;
}

const INITIAL_STATE: StatsState = {
  health: null,
  healthError: null,
  catalogHealth: null,
  catalogHealthError: null,
  analytics: null,
  analyticsError: null,
  executorHealth: null,
  executorHealthError: null,
  sessions: [],
  sessionsError: null,
  recentSessionUsage: [],
  usageError: null,
  loading: false,
  lastUpdatedAtMs: null,
};

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

function sortSessionsByRecentActivity(left: SessionSummary, right: SessionSummary): number {
  const rightAt = resolveSessionUpdatedAt(right) ?? resolveSessionStartedAt(right) ?? 0;
  const leftAt = resolveSessionUpdatedAt(left) ?? resolveSessionStartedAt(left) ?? 0;
  if (rightAt !== leftAt) {
    return rightAt - leftAt;
  }

  return String(left.id || '').localeCompare(String(right.id || ''));
}

function normalizeSessions(sessions: SessionSummary[]): SessionSummary[] {
  return Array.isArray(sessions)
    ? [...sessions].sort(sortSessionsByRecentActivity)
    : [];
}

async function loadUsageSample(session: SessionSummary): Promise<StatsSessionUsageSample> {
  const sessionSource = typeof session.source === 'string' && session.source.trim()
    ? session.source
    : undefined;

  try {
    const usage = await getSessionAgentUsage(session.id, {
      source: sessionSource,
      limit: STATS_SESSION_USAGE_LIMIT,
    });
    return {
      session,
      usage,
      error: null,
    };
  } catch (error) {
    return {
      session,
      usage: null,
      error: toErrorMessage(error, `Unable to load sampled usage for session ${session.id}.`),
    };
  }
}

function createStatsStore() {
  const store = createStore<StatsState>(INITIAL_STATE);
  let requestVersion = 0;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  async function refresh(): Promise<void> {
    const nextVersion = ++requestVersion;

    store.setState((state) => ({
      ...state,
      loading: true,
      healthError: null,
      catalogHealthError: null,
      analyticsError: null,
      sdkHealthError: null,
      executorHealthError: null,
      sessionsError: null,
      usageError: null,
    }));

    const [
      healthResult,
      catalogHealthResult,
      analyticsResult,
      executorHealthResult,
      sessionsResult,
    ] = await Promise.allSettled([
      getHealth(),
      getRuntimeCatalogHealth(),
      getCatalogAssetAnalytics(),
      getExecutorHealth(),
      listSessions(undefined, { source: 'all', dedupe: 'on' }),
    ]);

    if (nextVersion !== requestVersion) {
      return;
    }

    const nextSessions = sessionsResult.status === 'fulfilled'
      ? normalizeSessions(sessionsResult.value.sessions)
      : null;

    let recentSessionUsage: StatsSessionUsageSample[] | null = null;
    let usageError: string | null = null;

    if (nextSessions) {
      recentSessionUsage = await Promise.all(
        nextSessions
          .slice(0, STATS_RECENT_SESSION_SAMPLE_SIZE)
          .map((session) => loadUsageSample(session))
      );

      if (nextVersion !== requestVersion) {
        return;
      }

      const failedSamples = recentSessionUsage.filter((sample) => sample.error);
      if (failedSamples.length > 0) {
        usageError = failedSamples.length === recentSessionUsage.length
          ? 'Recent sampled session usage is temporarily unavailable.'
          : `Some recent sampled session usage is unavailable (${failedSamples.length}/${recentSessionUsage.length}).`;
      }
    } else if (sessionsResult.status === 'rejected') {
      usageError = 'Recent sampled session usage refresh was skipped because merged sessions could not be loaded.';
    }

    store.setState((state) => ({
      ...state,
      health: healthResult.status === 'fulfilled' ? healthResult.value : state.health,
      healthError:
        healthResult.status === 'rejected'
          ? toErrorMessage(healthResult.reason, 'Unable to load runtime health.')
          : null,
      catalogHealth:
        catalogHealthResult.status === 'fulfilled' ? catalogHealthResult.value : state.catalogHealth,
      catalogHealthError:
        catalogHealthResult.status === 'rejected'
          ? toErrorMessage(catalogHealthResult.reason, 'Unable to load runtime catalog health.')
          : null,
      analytics:
        analyticsResult.status === 'fulfilled' ? (analyticsResult.value.analytics ?? null) : state.analytics,
      analyticsError:
        analyticsResult.status === 'rejected'
          ? toErrorMessage(analyticsResult.reason, 'Unable to load catalog telemetry.')
          : null,
      executorHealth:
        executorHealthResult.status === 'fulfilled' ? executorHealthResult.value : state.executorHealth,
      executorHealthError:
        executorHealthResult.status === 'rejected'
          ? toErrorMessage(executorHealthResult.reason, 'Unable to load executor health.')
          : null,
      sessions: nextSessions ?? state.sessions,
      sessionsError:
        sessionsResult.status === 'rejected'
          ? toErrorMessage(sessionsResult.reason, 'Unable to load merged session inventory.')
          : null,
      recentSessionUsage: recentSessionUsage ?? state.recentSessionUsage,
      usageError,
      loading: false,
      lastUpdatedAtMs: Date.now(),
    }));
  }

  function startPolling(): void {
    if (pollTimer) {
      return;
    }

    void refresh();
    pollTimer = setInterval(() => {
      void refresh();
    }, STATS_POLL_INTERVAL_MS);
  }

  function stopPolling(): void {
    if (!pollTimer) {
      return;
    }

    clearInterval(pollTimer);
    pollTimer = null;
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    refresh,
    startPolling,
    stopPolling,
  };
}

export const statsStore = createStatsStore();