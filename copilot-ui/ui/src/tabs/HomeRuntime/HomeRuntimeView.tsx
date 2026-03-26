import { useEffect, useMemo, useState } from 'react';
import { Button, Panel, StatusBadge, Toolbar } from '../../components';
import { patchVscodeGithubMcp } from '../../lib/api';
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
import ExecutorView from '../Executor/ExecutorView';
import LspView from '../LSP/LspView';
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

function readNumber(record: Record<string, unknown>, key: string): number | null {
  return typeof record[key] === 'number' && Number.isFinite(record[key] as number)
    ? (record[key] as number)
    : null;
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

function formatDiagnosticsSectionLabel(sectionId: DiagnosticsSectionId): string {
  if (sectionId === 'runtime') {
    return 'Elegy Copilot Runtime';
  }
  if (sectionId === 'database') {
    return 'Planning Database';
  }
  if (sectionId === 'lsp') {
    return 'LSP';
  }

  return sectionId.charAt(0).toUpperCase() + sectionId.slice(1);
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

interface GithubWorkspaceControlState {
  patching: boolean;
  message: string | null;
  error: string | null;
}

function renderDiagnosticsSection(
  activeSection: DiagnosticsSectionId,
  health: ReturnType<typeof stateOverviewStore.getState>['health'],
  githubWorkspaceControl: GithubWorkspaceControlState,
  onEnableGithubWorkspaceMcp: () => void,
) {
  if (activeSection === 'runtime') {
    const runtime = asRecord(health?.runtime);
    const provider = asRecord(runtime.provider);
    const capabilities = asRecord(runtime.capabilities);
    const githubAccess = asRecord(runtime.githubAccess);
    const githubCli = asRecord(githubAccess.cli);
    const githubWorkspace = asRecord(githubAccess.workspace);
    const githubGuidance = asRecord(githubAccess.guidance);
    const startupManagedAssetSync = asRecord(health?.startupManagedAssetSync);
    const autonomousDecisionLog = asRecord(health?.autonomousDecisionLog);
    const capabilityEntries = Object.entries(capabilities)
      .map(([key, value]) => `${humanizeToken(key)}: ${humanizeToken(value, 'Unknown')}`)
      .sort((left, right) => left.localeCompare(right));

    return (
      <div className="state-grid">
        <Panel
          subtitle="Elegy Copilot runtime compatibility contract and provider capability state from /api/health."
          testId="home-runtime-diagnostics-runtime-panel"
          title="Elegy Copilot Runtime"
        >
          <div className="state-card-grid">
            <article className="state-card">
              <div className="state-card-header">
                <p className="state-card-title">Runtime Contract</p>
                <StatusBadge
                  status={buildStatusToken(runtime, typeof health?.ok === 'boolean' ? (health.ok ? 'healthy' : 'degraded') : 'unknown')}
                  testId="home-runtime-diagnostics-runtime-status"
                />
              </div>
              <p className="state-card-copy">Current runtime mode plus the resolved engine root used by the backend.</p>
              <p className="state-card-detail">
                {joinDetails([
                  readString(runtime, 'mode'),
                  health?.engineRoot ? `engine: ${health.engineRoot}` : '',
                  health?.copilotHome ? `copilot: ${health.copilotHome}` : '',
                  health?.vscodeHome ? `vscode: ${health.vscodeHome}` : '',
                ]) || 'No runtime contract details reported.'}
              </p>
            </article>

            <article className="state-card">
              <div className="state-card-header">
                <p className="state-card-title">Provider Selection</p>
                <StatusBadge status={readString(provider, 'selectionSource') || 'unknown'} testId="home-runtime-diagnostics-provider-status" />
              </div>
              <p className="state-card-copy">Shows the selected/default runtime providers and how the selection was derived.</p>
              <p className="state-card-detail">
                {joinDetails([
                  readString(provider, 'selectedProvider') ? `selected: ${humanizeToken(readString(provider, 'selectedProvider'))}` : '',
                  readString(provider, 'defaultProvider') ? `default: ${humanizeToken(readString(provider, 'defaultProvider'))}` : '',
                  readString(provider, 'selectionSource') ? `source: ${humanizeToken(readString(provider, 'selectionSource'))}` : '',
                ]) || 'No provider metadata reported.'}
              </p>
            </article>

            <article className="state-card">
              <div className="state-card-header">
                <p className="state-card-title">Capabilities</p>
                <StatusBadge status={capabilityEntries.length ? 'reported' : 'unknown'} testId="home-runtime-diagnostics-capabilities-status" />
              </div>
              <p className="state-card-copy">High-signal runtime capability probes used by the compatibility contract.</p>
              <p className="state-card-detail">
                {capabilityEntries.length ? capabilityEntries.join(' | ') : 'No capability probes reported.'}
              </p>
            </article>

            <article className="state-card">
              <div className="state-card-header">
                <p className="state-card-title">GitHub CLI Access</p>
                <StatusBadge
                  status={buildStatusToken(githubCli, readString(githubCli, 'status') || 'unknown')}
                  testId="home-runtime-diagnostics-github-cli-status"
                />
              </div>
              <p className="state-card-copy">Copilot CLI sessions already expose the built-in GitHub troubleshooting lane.</p>
              <p className="state-card-detail">
                {joinDetails([
                  readString(githubCli, 'serverId') ? `server: ${readString(githubCli, 'serverId')}` : '',
                  readBoolean(githubCli, 'readOnlyDefault') === true ? 'read-only default' : '',
                  readString(githubCli, 'detail'),
                ]) || 'No CLI GitHub access details reported.'}
              </p>
            </article>

            <article className="state-card">
              <div className="state-card-header">
                <p className="state-card-title">Workspace GitHub MCP</p>
                <StatusBadge
                  status={buildStatusToken(githubWorkspace, readString(githubWorkspace, 'status') || 'unknown')}
                  testId="home-runtime-diagnostics-github-workspace-status"
                />
              </div>
              <p className="state-card-copy">
                Configure `.vscode/mcp.json` for read-only GitHub inspection in VS Code/Copilot workspace sessions.
              </p>
              <p className="state-card-detail">
                {joinDetails([
                  readString(githubWorkspace, 'configPath') ? `config: ${readString(githubWorkspace, 'configPath')}` : '',
                  readString(githubWorkspace, 'tokenEnvVar') ? `env: ${readString(githubWorkspace, 'tokenEnvVar')}` : '',
                  readBoolean(githubWorkspace, 'readOnlyDefault') === true ? 'read-only default' : '',
                  readString(githubWorkspace, 'detail'),
                ]) || 'No workspace GitHub MCP details reported.'}
              </p>
              <div className="workspace-nav">
                <Button
                  disabled={githubWorkspaceControl.patching}
                  onClick={onEnableGithubWorkspaceMcp}
                  testId="home-runtime-diagnostics-github-enable"
                  variant="secondary"
                >
                  {githubWorkspaceControl.patching ? 'Enabling...' : 'Enable workspace GitHub MCP'}
                </Button>
              </div>
              {githubWorkspaceControl.error ? (
                <p className="state-message state-error" role="alert">
                  {githubWorkspaceControl.error}
                </p>
              ) : null}
              {githubWorkspaceControl.message ? (
                <p className="state-message">{githubWorkspaceControl.message}</p>
              ) : null}
              <p className="state-card-detail">
                {joinDetails([
                  readString(githubGuidance, 'tokenEnvVar') ? `recommended token env: ${readString(githubGuidance, 'tokenEnvVar')}` : '',
                  readString(githubGuidance, 'docPath') ? `docs: ${readString(githubGuidance, 'docPath')}` : '',
                ]) || 'GitHub MCP guidance is not currently available.'}
              </p>
            </article>

            <article className="state-card">
              <div className="state-card-header">
                <p className="state-card-title">Startup Sync</p>
                <StatusBadge
                  status={readString(startupManagedAssetSync, 'status') || 'unknown'}
                  testId="home-runtime-diagnostics-startup-sync-status"
                />
              </div>
              <p className="state-card-copy">Managed-asset sync outcome captured during backend startup and surfaced through /api/health.</p>
              <p className="state-card-detail">
                {joinDetails([
                  readString(startupManagedAssetSync, 'message'),
                  readNumber(startupManagedAssetSync, 'homeCount') != null ? `homes: ${readNumber(startupManagedAssetSync, 'homeCount')}` : '',
                  readNumber(startupManagedAssetSync, 'syncedCount') != null ? `synced: ${readNumber(startupManagedAssetSync, 'syncedCount')}` : '',
                  readNumber(startupManagedAssetSync, 'prunedCount') != null ? `pruned: ${readNumber(startupManagedAssetSync, 'prunedCount')}` : '',
                  readNumber(startupManagedAssetSync, 'errorCount') != null ? `errors: ${readNumber(startupManagedAssetSync, 'errorCount')}` : '',
                  readBoolean(startupManagedAssetSync, 'decisionLogged') === true ? 'decision logged' : '',
                  readString(startupManagedAssetSync, 'lastRunAt') ? `updated: ${formatOptionalTimestampLabel(readString(startupManagedAssetSync, 'lastRunAt'))}` : '',
                ]) || 'No startup sync state reported.'}
              </p>
            </article>

            <article className="state-card">
              <div className="state-card-header">
                <p className="state-card-title">Autonomous Decision Log</p>
                <StatusBadge
                  status={readString(autonomousDecisionLog, 'status') || 'unknown'}
                  testId="home-runtime-diagnostics-decision-log-status"
                />
              </div>
              <p className="state-card-copy">Append-only user-local decision log summary for durable autonomous runtime actions.</p>
              <p className="state-card-detail">
                {joinDetails([
                  readNumber(autonomousDecisionLog, 'eventCount') != null ? `events: ${readNumber(autonomousDecisionLog, 'eventCount')}` : '',
                  readString(autonomousDecisionLog, 'lastEventKind') ? `last: ${humanizeToken(readString(autonomousDecisionLog, 'lastEventKind'))}` : '',
                  readString(autonomousDecisionLog, 'lastEventOutcome') ? `outcome: ${humanizeToken(readString(autonomousDecisionLog, 'lastEventOutcome'))}` : '',
                  readString(autonomousDecisionLog, 'lastEventAt') ? `updated: ${formatOptionalTimestampLabel(readString(autonomousDecisionLog, 'lastEventAt'))}` : '',
                  readString(autonomousDecisionLog, 'lastError') ? `last error: ${readString(autonomousDecisionLog, 'lastError')}` : '',
                ]) || 'No autonomous decision log state reported.'}
              </p>
              {readString(autonomousDecisionLog, 'lastEventSummary') ? (
                <p className="state-card-detail">{readString(autonomousDecisionLog, 'lastEventSummary')}</p>
              ) : null}
              {readString(autonomousDecisionLog, 'path') ? (
                <p className="state-card-detail">{readString(autonomousDecisionLog, 'path')}</p>
              ) : null}
            </article>
          </div>
        </Panel>

        <Panel
          subtitle="Raw runtime diagnostics for debugging provider/capability mismatches."
          testId="home-runtime-diagnostics-runtime-raw-panel"
          title="Runtime Raw State"
        >
          <div className="state-meta-grid">
            <div className="state-meta-card">
              <p className="state-meta-label">Health Runtime</p>
              <pre className="code-block">{JSON.stringify(runtime, null, 2) || '{}'}</pre>
            </div>
            <div className="state-meta-card">
              <p className="state-meta-label">Health Envelope</p>
              <pre className="code-block">{JSON.stringify(health || {}, null, 2) || '{}'}</pre>
            </div>
          </div>
        </Panel>
      </div>
    );
  }

  if (activeSection === 'database') {
    const persistence = asRecord(health?.planningPersistence);
    const governance = asRecord(persistence.governance);
    const migrations = asRecord(persistence.migrations);
    const dependencyGate = asRecord(health?.planningDurabilityDependencyGate);

    return (
      <div className="state-grid">
        <Panel
          subtitle="Planning persistence authority, migration state, and durability gate details from /api/health."
          testId="home-runtime-diagnostics-database-panel"
          title="Planning Database"
        >
          <div className="state-card-grid">
            <article className="state-card">
              <div className="state-card-header">
                <p className="state-card-title">Database Status</p>
                <StatusBadge status={buildStatusToken(persistence, 'unknown')} testId="home-runtime-diagnostics-database-status" />
              </div>
              <p className="state-card-copy">Current planning persistence readiness and configuration state.</p>
              <p className="state-card-detail">
                {joinDetails([
                  readBoolean(persistence, 'configured') === true ? 'configured' : '',
                  readBoolean(persistence, 'usable') === true ? 'usable' : '',
                  readBoolean(persistence, 'required') === true ? 'required' : '',
                  readString(persistence, 'lastError') ? `last error: ${readString(persistence, 'lastError')}` : '',
                ]) || 'No planning persistence status reported.'}
              </p>
            </article>

            <article className="state-card">
              <div className="state-card-header">
                <p className="state-card-title">Governance</p>
                <StatusBadge status={buildStatusToken(governance, readString(governance, 'code') || 'unknown')} testId="home-runtime-diagnostics-governance-status" />
              </div>
              <p className="state-card-copy">Fail-closed planning database governance and readiness contract.</p>
              <p className="state-card-detail">
                {joinDetails([
                  readString(governance, 'code') ? `code: ${humanizeToken(readString(governance, 'code'))}` : '',
                  readString(governance, 'reason') ? `reason: ${humanizeToken(readString(governance, 'reason'))}` : '',
                  readBoolean(governance, 'failClosed') === true ? 'fail closed' : '',
                  readBoolean(governance, 'ready') === true ? 'ready' : 'not ready',
                ]) || 'No governance state reported.'}
              </p>
            </article>

            <article className="state-card">
              <div className="state-card-header">
                <p className="state-card-title">Migrations</p>
                <StatusBadge
                  status={
                    readBoolean(migrations, 'baselineMismatch') === true || readBoolean(migrations, 'driftDetected') === true
                      ? 'error'
                      : 'verified'
                  }
                  testId="home-runtime-diagnostics-migrations-status"
                />
              </div>
              <p className="state-card-copy">Migration manifest, checksum baseline, and applied version count.</p>
              <p className="state-card-detail">
                {joinDetails([
                  readString(migrations, 'schemaTable') ? `table: ${readString(migrations, 'schemaTable')}` : '',
                  readString(migrations, 'latestVersion') ? `latest: ${readString(migrations, 'latestVersion')}` : '',
                  typeof migrations.appliedCount === 'number' ? `applied: ${migrations.appliedCount}` : '',
                  typeof migrations.manifestCount === 'number' ? `manifest: ${migrations.manifestCount}` : '',
                  readBoolean(migrations, 'baselineMismatch') === true ? 'baseline mismatch' : '',
                  readBoolean(migrations, 'driftDetected') === true ? 'drift detected' : '',
                ]) || 'No migration state reported.'}
              </p>
            </article>

            <article className="state-card">
              <div className="state-card-header">
                <p className="state-card-title">Durability Gate</p>
                <StatusBadge status={buildStatusToken(dependencyGate, 'unknown')} testId="home-runtime-diagnostics-gate-status" />
              </div>
              <p className="state-card-copy">Shows whether planning durability routes are currently allowed to mutate persistence.</p>
              <p className="state-card-detail">
                {joinDetails([
                  readString(dependencyGate, 'marker') ? `marker: ${humanizeToken(readString(dependencyGate, 'marker'))}` : '',
                  readString(dependencyGate, 'reason') ? `reason: ${humanizeToken(readString(dependencyGate, 'reason'))}` : '',
                  readBoolean(dependencyGate, 'ready') === true ? 'ready' : 'not ready',
                ]) || 'No durability gate state reported.'}
              </p>
            </article>
          </div>
        </Panel>

        <Panel
          subtitle="Raw planning persistence payloads for debugging migration/governance issues."
          testId="home-runtime-diagnostics-database-raw-panel"
          title="Database Raw State"
        >
          <div className="state-meta-grid">
            <div className="state-meta-card">
              <p className="state-meta-label">Planning Persistence</p>
              <pre className="code-block">{JSON.stringify(persistence, null, 2) || '{}'}</pre>
            </div>
            <div className="state-meta-card">
              <p className="state-meta-label">Durability Gate</p>
              <pre className="code-block">{JSON.stringify(dependencyGate, null, 2) || '{}'}</pre>
            </div>
          </div>
        </Panel>
      </div>
    );
  }

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
  const [githubWorkspaceControl, setGithubWorkspaceControl] = useState<GithubWorkspaceControlState>({
    patching: false,
    message: null,
    error: null,
  });

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
    executor: {
      title: 'Executor',
      body: 'Schedule SDK-backed prompts, monitor runs, observe external sessions, and manage sandbox execution mode.',
    },
    diagnostics: {
      title: 'Diagnostics',
      body: 'Inspect Elegy Copilot runtime, planning database, gateway, tracker, and LSP operator diagnostics from one runtime hub.',
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

  const handleEnableGithubWorkspaceMcp = () => {
    void (async () => {
      setGithubWorkspaceControl({
        patching: true,
        message: null,
        error: null,
      });

      try {
        const response = await patchVscodeGithubMcp();
        const result = asRecord(response?.result);
        const changed = readBoolean(result, 'changed');
        const message = changed === false
          ? 'Workspace GitHub MCP was already configured.'
          : 'Workspace GitHub MCP was added to .vscode/mcp.json. Load your MCP env file before opening VS Code.';
        setGithubWorkspaceControl({
          patching: false,
          message,
          error: null,
        });
      } catch (error) {
        setGithubWorkspaceControl({
          patching: false,
          message: null,
          error: error instanceof Error && error.message.trim()
            ? error.message
            : 'Unable to patch workspace GitHub MCP config.',
        });
      } finally {
        await stateOverviewStore.refresh();
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

        <div className="workspace-nav workspace-nav-stable" role="tablist" aria-label="Home and runtime sections">
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
            onClick={() => navigationStore.setRuntimeSectionId('executor')}
            testId="home-runtime-section-executor"
            variant={activeSection === 'executor' ? 'primary' : 'ghost'}
          >
            Executor
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
                  <p className="state-card-title">Open Executor</p>
                </div>
                <p className="state-card-copy">Schedule prompts, monitor active runs, and reopen linked SDK sessions.</p>
                <Button
                  onClick={() => navigationStore.goToRuntime('executor')}
                  testId="runtime-overview-executor-action"
                  variant="secondary"
                >
                  Open Executor
                </Button>
              </article>

              <article className="state-card">
                <div className="state-card-header">
                  <p className="state-card-title">Launch or continue sandbox-backed runtime work</p>
                </div>
                <p className="state-card-copy">Open Executor to manage sandbox lifecycle, launch sandbox-backed runs, and follow sandbox sessions into runtime.</p>
                <Button
                  onClick={() => navigationStore.goToRuntime('executor')}
                  testId="runtime-overview-sandbox-action"
                  variant="secondary"
                >
                  Open Executor Sandbox Mode
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

      {activeSection === 'executor' ? <ExecutorView /> : null}

      {activeSection === 'diagnostics' ? (
        <div className="workspace-stack" data-testid="home-runtime-diagnostics-view">
          <div className="workspace-nav workspace-nav-stable" role="tablist" aria-label="Runtime diagnostics sections">
            <Button
              onClick={() => navigationStore.setDiagnosticsSectionId('runtime')}
              testId="home-runtime-diagnostics-runtime"
              variant={navigationState.diagnosticsSectionId === 'runtime' ? 'primary' : 'ghost'}
            >
              Runtime
            </Button>
            <Button
              onClick={() => navigationStore.setDiagnosticsSectionId('database')}
              testId="home-runtime-diagnostics-database"
              variant={navigationState.diagnosticsSectionId === 'database' ? 'primary' : 'ghost'}
            >
              Database
            </Button>
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
            Diagnostics / {formatDiagnosticsSectionLabel(navigationState.diagnosticsSectionId)}
          </p>

          {renderDiagnosticsSection(
            navigationState.diagnosticsSectionId,
            overviewState.health,
            githubWorkspaceControl,
            handleEnableGithubWorkspaceMcp,
          )}
        </div>
      ) : null}
    </section>
  );
}
