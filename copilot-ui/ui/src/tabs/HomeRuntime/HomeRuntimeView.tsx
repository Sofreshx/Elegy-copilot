import { useEffect, useMemo } from 'react';
import { Button, Panel, StatusBadge, Toolbar } from '../../components';
import {
  formatGatewaySegmentSummary,
  formatTimestampLabel,
  humanizeToken,
  resolveSessionStatus,
  resolveSessionUpdatedAt,
  summarizeSdkHealth,
} from '../../lib/stateDiagnostics';
import type { SessionSummary } from '../../lib/types';
import { useStoreValue } from '../../lib/store';
import {
  navigationStore,
  type DiagnosticsSectionId,
  type RuntimeSectionId,
} from '../../stores/navigation';
import { sdkHealthStore } from '../../stores/sdkHealthStore';
import GatewayView from '../Gateway/GatewayView';
import LspView from '../LSP/LspView';
import SandboxesView from '../Sandboxes/SandboxesView';
import { readSandboxId, sandboxesStore } from '../Sandboxes/sandboxesStore';
import SessionsView from '../Sessions/SessionsView';
import { sessionsStore } from '../Sessions/sessionsStore';
import { stateOverviewStore } from '../State/stateOverviewStore';
import TrackerView from '../Tracker/TrackerView';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function readBoolean(record: Record<string, unknown>, key: string): boolean | null {
  return typeof record[key] === 'boolean' ? (record[key] as boolean) : null;
}

function readString(record: Record<string, unknown>, key: string): string {
  return typeof record[key] === 'string' ? String(record[key]).trim() : '';
}

function buildStatusToken(record: Record<string, unknown>, fallback: string): string {
  const status = readString(record, 'status');
  if (status) {
    return status;
  }

  const ready = readBoolean(record, 'ready');
  if (ready === true) {
    return 'ready';
  }
  if (ready === false) {
    return 'not_ready';
  }

  const usable = readBoolean(record, 'usable');
  if (usable === true) {
    return 'usable';
  }

  const ok = readBoolean(record, 'ok');
  if (ok === true) {
    return 'healthy';
  }
  if (ok === false) {
    return 'degraded';
  }

  return fallback;
}

function joinDetails(parts: Array<string | null | undefined>): string {
  return parts.map((part) => String(part || '').trim()).filter(Boolean).join(' | ');
}

function formatOptionalTimestampLabel(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) {
    return formatTimestampLabel(parsed);
  }

  return value;
}

function pickMostRecentSession(sessions: SessionSummary[]): SessionSummary | null {
  return sessions.reduce<SessionSummary | null>((latest, session) => {
    if (!latest) {
      return session;
    }

    const sessionTimestamp = resolveSessionUpdatedAt(session) ?? 0;
    const latestTimestamp = resolveSessionUpdatedAt(latest) ?? 0;
    return sessionTimestamp > latestTimestamp ? session : latest;
  }, null);
}

function renderDiagnosticsSection(activeSection: DiagnosticsSectionId) {
  if (activeSection === 'gateway') {
    return <GatewayView />;
  }
  if (activeSection === 'tracker') {
    return <TrackerView />;
  }

  return <LspView />;
}

export default function HomeRuntimeView() {
  const navigationState = useStoreValue(navigationStore);
  const overviewState = useStoreValue(stateOverviewStore);
  const sdkHealthState = useStoreValue(sdkHealthStore);
  const localSessionState = useStoreValue(sessionsStore);
  const sandboxState = useStoreValue(sandboxesStore);

  useEffect(() => {
    stateOverviewStore.startPolling();
    void sessionsStore.loadSessions();
    void sandboxesStore.loadSandboxes();

    return () => {
      stateOverviewStore.stopPolling();
    };
  }, []);

  const runtimeCard = useMemo(() => {
    const runtime = asRecord(overviewState.health?.runtime);
    const status = buildStatusToken(runtime, overviewState.health?.ok ? 'healthy' : 'unknown');
    const detail = joinDetails([
      readString(runtime, 'statusMessage'),
      readString(runtime, 'mode'),
      overviewState.health?.engineRoot ? `engine: ${overviewState.health.engineRoot}` : '',
    ]) || 'Local runtime diagnostics from /api/health.';

    return {
      title: 'Runtime',
      status,
      copy: overviewState.health?.ok ? 'Backend health endpoint is responding.' : 'Runtime health needs attention.',
      detail,
    };
  }, [overviewState.health]);

  const persistenceCard = useMemo(() => {
    const persistence = asRecord(overviewState.health?.planningPersistence);
    const status = buildStatusToken(persistence, 'unknown');
    const detail = joinDetails([
      readBoolean(persistence, 'configured') === true ? 'configured' : '',
      readBoolean(persistence, 'usable') === true ? 'usable' : '',
      readBoolean(persistence, 'required') === true ? 'required' : '',
      readBoolean(persistence, 'initRequired') === true ? 'init required' : '',
      readString(persistence, 'message'),
    ]) || 'Planning persistence and database readiness.';

    return {
      title: 'Planning DB',
      status,
      copy: 'Tracks planning persistence, authority state, and dependency gates.',
      detail,
    };
  }, [overviewState.health]);

  const gatewayCard = useMemo(() => {
    const gatewayState = overviewState.gatewayState;
    const gateway = asRecord(gatewayState?.gateway);
    const tracker = asRecord(gatewayState?.tracker);
    const gatewaySummary = formatGatewaySegmentSummary(
      Object.keys(gateway).length ? gateway : null,
      gatewayState?.ready ? 'ready' : 'not_ready',
    );
    const config = asRecord(gateway.config);
    const source = readString(gateway, 'source');
    const reasonCode = readString(gateway, 'reasonCode');
    const lastUpdatedUtc = readString(gateway, 'lastUpdatedUtc') || readString(tracker, 'lastUpdatedUtc');
    const trackerSource = readString(tracker, 'source');
    const detail = joinDetails([
      source ? `authority: ${humanizeToken(source)}` : 'authority: shared gateway readiness',
      reasonCode ? `reason: ${humanizeToken(reasonCode)}` : '',
      trackerSource ? `projection: ${humanizeToken(trackerSource)}` : '',
      gatewaySummary.detail || '',
      lastUpdatedUtc ? `updated: ${formatOptionalTimestampLabel(lastUpdatedUtc)}` : '',
      readBoolean(config, 'exists') === true ? 'config present' : 'config missing',
    ]) || 'Authoritative gateway readiness from /api/gateway/state.';

    return {
      title: 'Gateway Authority',
      status: readString(gateway, 'status') || (gatewayState?.ready ? 'ready' : 'not_ready'),
      copy: 'Projects canonical gateway readiness from the shared status-file contract.',
      detail,
    };
  }, [overviewState.gatewayState]);

  const catalogCard = useMemo(() => {
    const projection = overviewState.catalogHealth?.projection;
    const freshness = projection?.freshness?.status || '';
    const readMode = projection?.readMode || '';
    const status = overviewState.catalogHealth?.ok ? (freshness || 'healthy') : 'degraded';
    const detail = joinDetails([
      readMode ? `mode: ${readMode}` : '',
      freshness ? `freshness: ${freshness}` : '',
      overviewState.catalogHealth?.audit?.exists ? 'audit log present' : 'audit log missing',
    ]) || 'Catalog projection and audit runtime health.';

    return {
      title: 'Catalog',
      status,
      copy: 'Confirms projection persistence, freshness, and audit storage.',
      detail,
    };
  }, [overviewState.catalogHealth]);

  const sdkCard = useMemo(() => {
    const summary = summarizeSdkHealth(sdkHealthState.health, sdkHealthState.error);
    return {
      title: 'Copilot SDK',
      status: summary.status.toLowerCase().replace(/\s+/g, '_'),
      copy: 'Reports bridge readiness for SDK-backed planning and session flows.',
      detail: summary.detail,
    };
  }, [sdkHealthState.error, sdkHealthState.health]);

  const policyCard = useMemo(() => {
    const policy = asRecord(overviewState.health?.policy);
    const status = buildStatusToken(policy, readString(policy, 'reason') || 'unknown');
    const detail = joinDetails([
      readString(policy, 'message'),
      readString(policy, 'checkedAt'),
    ]) || 'Mutating action preflight state.';

    return {
      title: 'Policy Gate',
      status,
      copy: 'Surfaces whether mutating actions are currently blocked.',
      detail,
    };
  }, [overviewState.health]);

  const sessionsCard = useMemo(() => {
    const totalSessions = localSessionState.sessions.length;
    const activeSessions = localSessionState.sessions.filter((session) => resolveSessionStatus(session) === 'active').length;
    const sdkSessionCount = Number.isFinite(sdkHealthState.health?.sessionCount)
      ? Number(sdkHealthState.health?.sessionCount)
      : 0;
    const recentSession = pickMostRecentSession(localSessionState.sessions);
    const status = localSessionState.error
      ? 'error'
      : localSessionState.loading
        ? 'loading'
        : activeSessions > 0
          ? 'active'
          : totalSessions > 0 || sdkSessionCount > 0
            ? 'idle'
            : 'unknown';

    return {
      title: 'Sessions',
      status,
      copy: 'Summarizes current local session activity and SDK bridge occupancy.',
      detail: joinDetails([
        `${totalSessions} local session(s)`,
        `${activeSessions} active`,
        `${sdkSessionCount} SDK bridge session(s)`,
        recentSession ? `latest: ${recentSession.id}` : 'no recent session selected',
      ]),
    };
  }, [localSessionState.error, localSessionState.loading, localSessionState.sessions, sdkHealthState.health?.sessionCount]);

  const sandboxesCard = useMemo(() => {
    const totalSandboxes = sandboxState.sandboxes.length;
    const activeSandboxes = sandboxState.sandboxes.filter((sandbox) => resolveSessionStatus(sandbox) === 'active').length;
    const recentSandbox = pickMostRecentSession(sandboxState.sandboxes);
    const status = sandboxState.error
      ? 'error'
      : sandboxState.loading
        ? 'loading'
        : sandboxState.tokenMissingBlocked
          ? 'blocked'
          : activeSandboxes > 0
            ? 'active'
            : totalSandboxes > 0
              ? 'idle'
              : 'unknown';

    return {
      title: 'Sandboxes',
      status,
      copy: 'Tracks sandbox lifecycle readiness and follow-session availability.',
      detail: joinDetails([
        `${totalSandboxes} sandbox session(s)`,
        `${activeSandboxes} active`,
        sandboxState.tokenMissingBlocked ? (sandboxState.tokenMissingMessage || 'tracker auth required') : '',
        recentSandbox ? `latest: ${readSandboxId(recentSandbox) || recentSandbox.id}` : '',
      ]),
    };
  }, [
    sandboxState.error,
    sandboxState.loading,
    sandboxState.sandboxes,
    sandboxState.tokenMissingBlocked,
    sandboxState.tokenMissingMessage,
  ]);

  const recentActivityCard = useMemo(() => {
    const recentSession = pickMostRecentSession(localSessionState.sessions);
    const recentSandbox = pickMostRecentSession(sandboxState.sandboxes);
    const recentSessionTime = recentSession ? resolveSessionUpdatedAt(recentSession) : null;
    const recentSandboxTime = recentSandbox ? resolveSessionUpdatedAt(recentSandbox) : null;
    const hasRecentActivity = Boolean(recentSession || recentSandbox);

    return {
      title: 'Recent Activity',
      status: hasRecentActivity ? 'active' : 'idle',
      copy: 'Points to the latest runtime or sandbox work so operators can resume quickly.',
      detail: joinDetails([
        recentSession ? `session ${recentSession.id} @ ${formatTimestampLabel(recentSessionTime)}` : 'no recent local session',
        recentSandbox ? `sandbox ${readSandboxId(recentSandbox) || recentSandbox.id} @ ${formatTimestampLabel(recentSandboxTime)}` : 'no recent sandbox',
      ]),
    };
  }, [localSessionState.sessions, sandboxState.sandboxes]);

  const cards = [
    runtimeCard,
    gatewayCard,
    persistenceCard,
    catalogCard,
    sdkCard,
    policyCard,
    sessionsCard,
    sandboxesCard,
    recentActivityCard,
  ];

  const sectionCopy: Record<RuntimeSectionId, { title: string; body: string }> = {
    overview: {
      title: 'Overview',
      body: 'Operational landing dashboard with status summaries, recent activity, and direct handoff actions.',
    },
    sessions: {
      title: 'Sessions',
      body: 'Inspect local and SDK-backed sessions, stream messages, and continue runtime work.',
    },
    sandboxes: {
      title: 'Sandboxes',
      body: 'Manage sandbox lifecycle, branch context, and follow sandbox work back into runtime sessions.',
    },
    diagnostics: {
      title: 'Diagnostics',
      body: 'Open gateway, tracker, and LSP operator tools without leaving the runtime hub.',
    },
  };

  const activeSection = navigationState.runtimeSectionId;
  const activeSectionCopy = sectionCopy[activeSection];

  const handleRefresh = async () => {
    await Promise.allSettled([
      stateOverviewStore.refresh(),
      sessionsStore.refresh(),
      sandboxesStore.refresh(),
      sdkHealthStore.refresh(),
    ]);
  };

  const handleFollowSandboxSession = (sessionId: string) => {
    void (async () => {
      try {
        await sessionsStore.loadSessions();
        sessionsStore.selectSession(sessionId);
      } finally {
        navigationStore.goToRuntime('sessions', { sessionsMode: 'local' });
      }
    })();
  };

  return (
    <section className="workspace-stack home-runtime-view" data-testid="home-runtime-view">
      <Toolbar testId="home-runtime-toolbar">
        <div className="workspace-nav-summary">
          <p className="workspace-nav-title">Home / Runtime</p>
          <p className="workspace-nav-copy">{activeSectionCopy.body}</p>
        </div>

        <div className="workspace-nav" role="tablist" aria-label="Home and runtime sections">
          <Button
            onClick={() => navigationStore.setRuntimeSectionId('overview')}
            testId="home-runtime-section-overview"
            variant={activeSection === 'overview' ? 'primary' : 'ghost'}
          >
            Overview
          </Button>
          <Button
            onClick={() => navigationStore.setRuntimeSectionId('sessions')}
            testId="home-runtime-section-sessions"
            variant={activeSection === 'sessions' ? 'primary' : 'ghost'}
          >
            Sessions
          </Button>
          <Button
            onClick={() => navigationStore.setRuntimeSectionId('sandboxes')}
            testId="home-runtime-section-sandboxes"
            variant={activeSection === 'sandboxes' ? 'primary' : 'ghost'}
          >
            Sandboxes
          </Button>
          <Button
            onClick={() => navigationStore.setRuntimeSectionId('diagnostics')}
            testId="home-runtime-section-diagnostics"
            variant={activeSection === 'diagnostics' ? 'primary' : 'ghost'}
          >
            Diagnostics
          </Button>
        </div>
      </Toolbar>

      <p className="workspace-section-label">{activeSectionCopy.title}</p>

      {overviewState.error ? (
        <p className="state-error" role="alert">
          {overviewState.error}
        </p>
      ) : null}

      {activeSection === 'overview' ? (
        <div className="state-grid">
          <Panel
            subtitle="Runtime readiness, planning persistence, catalog health, session activity, and sandbox lifecycle at a glance."
            testId="home-runtime-overview-panel"
            title="Overview"
            footer={
              <p>
                Last updated: {formatTimestampLabel(overviewState.lastUpdatedAtMs || sdkHealthState.lastUpdatedAtMs)}
              </p>
            }
          >
            <div className="state-card-grid">
              {cards.map((card) => (
                <article className="state-card" key={card.title}>
                  <div className="state-card-header">
                    <p className="state-card-title">{card.title}</p>
                    <StatusBadge status={card.status} testId="home-runtime-card-status" />
                  </div>
                  <p className="state-card-copy">{card.copy}</p>
                  <p className="state-card-detail">{card.detail}</p>
                </article>
              ))}
            </div>
          </Panel>

          <Panel
            subtitle="Direct operators into the next relevant runtime workspace without visiting retired top-level tabs."
            testId="home-runtime-quick-actions-panel"
            title="Quick Actions"
          >
            <div className="state-card-grid">
              <article className="state-card">
                <div className="state-card-header">
                  <p className="state-card-title">Refresh runtime/status data</p>
                </div>
                <p className="state-card-copy">Refresh readiness, sessions, sandboxes, and SDK bridge summaries.</p>
                <Button
                  disabled={overviewState.loading || localSessionState.loading || sandboxState.loading || sdkHealthState.loading}
                  onClick={() => {
                    void handleRefresh();
                  }}
                  testId="runtime-overview-refresh-action"
                  variant="secondary"
                >
                  {(overviewState.loading || localSessionState.loading || sandboxState.loading || sdkHealthState.loading)
                    ? 'Refreshing...'
                    : 'Refresh Runtime'}
                </Button>
              </article>

              <article className="state-card">
                <div className="state-card-header">
                  <p className="state-card-title">Jump to active sessions</p>
                </div>
                <p className="state-card-copy">Open the session workspace with the local runtime focus restored.</p>
                <Button
                  onClick={() => navigationStore.goToRuntime('sessions', { sessionsMode: 'local' })}
                  testId="runtime-overview-sessions-action"
                  variant="secondary"
                >
                  Open Sessions
                </Button>
              </article>

              <article className="state-card">
                <div className="state-card-header">
                  <p className="state-card-title">Create or resume SDK session</p>
                </div>
                <p className="state-card-copy">Open the runtime workspace already pointed at SDK-backed sessions.</p>
                <Button
                  onClick={() => navigationStore.goToRuntime('sessions', { sessionsMode: 'sdk' })}
                  testId="runtime-overview-sdk-action"
                  variant="secondary"
                >
                  Open SDK Sessions
                </Button>
              </article>

              <article className="state-card">
                <div className="state-card-header">
                  <p className="state-card-title">Launch or continue sandbox-backed runtime work</p>
                </div>
                <p className="state-card-copy">Jump into sandbox lifecycle controls and follow sandbox sessions into runtime.</p>
                <Button
                  onClick={() => navigationStore.goToRuntime('sandboxes')}
                  testId="runtime-overview-sandbox-action"
                  variant="secondary"
                >
                  Open Sandboxes
                </Button>
              </article>

              <article className="state-card">
                <div className="state-card-header">
                  <p className="state-card-title">Jump to Catalog</p>
                </div>
                <p className="state-card-copy">Continue asset, skill, and agent discovery from the runtime home hub.</p>
                <Button
                  onClick={() => navigationStore.goToCatalog()}
                  testId="runtime-overview-catalog-action"
                  variant="secondary"
                >
                  Open Catalog
                </Button>
              </article>

              <article className="state-card">
                <div className="state-card-header">
                  <p className="state-card-title">Jump to Planning</p>
                </div>
                <p className="state-card-copy">Return to idea capture, planning records, and compile workflows.</p>
                <Button
                  onClick={() => navigationStore.goToPlanning()}
                  testId="runtime-overview-planning-action"
                  variant="secondary"
                >
                  Open Planning
                </Button>
              </article>
            </div>
          </Panel>
        </div>
      ) : null}

      {activeSection === 'sessions' ? <SessionsView preferredMode={navigationState.sessionsMode} /> : null}

      {activeSection === 'sandboxes' ? (
        <SandboxesView
          onFollowSessions={(sessionId) => {
            handleFollowSandboxSession(sessionId);
          }}
        />
      ) : null}

      {activeSection === 'diagnostics' ? (
        <div className="workspace-stack" data-testid="home-runtime-diagnostics-view">
          <div className="workspace-nav" role="tablist" aria-label="Runtime diagnostics sections">
            <Button
              onClick={() => navigationStore.setDiagnosticsSectionId('gateway')}
              testId="home-runtime-diagnostics-gateway"
              variant={navigationState.diagnosticsSectionId === 'gateway' ? 'primary' : 'ghost'}
            >
              Gateway
            </Button>
            <Button
              onClick={() => navigationStore.setDiagnosticsSectionId('tracker')}
              testId="home-runtime-diagnostics-tracker"
              variant={navigationState.diagnosticsSectionId === 'tracker' ? 'primary' : 'ghost'}
            >
              Tracker
            </Button>
            <Button
              onClick={() => navigationStore.setDiagnosticsSectionId('lsp')}
              testId="home-runtime-diagnostics-lsp"
              variant={navigationState.diagnosticsSectionId === 'lsp' ? 'primary' : 'ghost'}
            >
              LSP
            </Button>
          </div>

          <p className="workspace-section-label">
            Diagnostics / {navigationState.diagnosticsSectionId.charAt(0).toUpperCase() + navigationState.diagnosticsSectionId.slice(1)}
          </p>

          {renderDiagnosticsSection(navigationState.diagnosticsSectionId)}
        </div>
      ) : null}
    </section>
  );
}
