import { useEffect, useMemo } from 'react';
import { Button, Panel, Toolbar } from '../../components';
import {
  formatTimestampLabel,
  resolveSessionSourceLabel,
  resolveSessionStartedAt,
  resolveSessionStatus,
  resolveSessionUpdatedAt,
  summarizeSdkHealth,
} from '../../lib/stateDiagnostics';
import { useStoreValue } from '../../lib/store';
import type {
  CatalogAuditAssetSummary,
  SessionSkillUsageEntry,
} from '../../lib/types';
import {
  statsStore,
  STATS_RECENT_SESSION_SAMPLE_SIZE,
  type StatsSessionUsageSample,
} from './statsStore';

type CountEntry = {
  label: string;
  count: number;
  detail?: string;
};

function asFiniteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function formatOptionalTimestamp(value: string | null | undefined): string {
  if (!value) {
    return 'Unknown';
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : value;
}

function readSessionSourceSet(session: Record<string, unknown>): string[] {
  const sourceCandidates = [session.resolvedSourceSet, session.sources, session.source];
  const seen = new Set<string>();
  const sources: string[] = [];

  for (const candidate of sourceCandidates) {
    if (Array.isArray(candidate)) {
      for (const value of candidate) {
        const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
        if (normalized && !seen.has(normalized)) {
          seen.add(normalized);
          sources.push(normalized);
        }
      }
      continue;
    }

    const normalized = typeof candidate === 'string' ? candidate.trim().toLowerCase() : '';
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      sources.push(normalized);
    }
  }

  return sources;
}

function buildSourceCoverage(entries: Record<string, unknown>[]): CountEntry[] {
  const counters = {
    cli: 0,
    vscode: 0,
    sandbox: 0,
    other: 0,
  };

  for (const entry of entries) {
    const sourceSet = readSessionSourceSet(entry);
    if (sourceSet.length === 0) {
      counters.other += 1;
      continue;
    }

    let countedKnownSource = false;
    if (sourceSet.includes('cli')) {
      counters.cli += 1;
      countedKnownSource = true;
    }
    if (sourceSet.includes('vscode')) {
      counters.vscode += 1;
      countedKnownSource = true;
    }
    if (sourceSet.includes('sandbox')) {
      counters.sandbox += 1;
      countedKnownSource = true;
    }
    if (!countedKnownSource) {
      counters.other += 1;
    }
  }

  return [
    { label: 'CLI sessions', count: counters.cli },
    { label: 'VS Code sessions', count: counters.vscode },
    { label: 'Sandbox sessions', count: counters.sandbox },
    { label: 'Other sources', count: counters.other },
  ];
}

function buildTopAgents(samples: StatsSessionUsageSample[]): CountEntry[] {
  const totals = new Map<string, number>();

  for (const sample of samples) {
    const usage = sample.usage?.usage;
    if (!usage || typeof usage !== 'object') {
      continue;
    }

    for (const [agentId, rawCount] of Object.entries(usage)) {
      const count = asFiniteNumber(rawCount);
      if (!agentId.trim() || count <= 0) {
        continue;
      }

      totals.set(agentId, (totals.get(agentId) ?? 0) + count);
    }
  }

  return Array.from(totals.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count || String(left.label || '').localeCompare(String(right.label || '')))
    .slice(0, 5);
}

function buildTopSkills(samples: StatsSessionUsageSample[]): CountEntry[] {
  const totals = new Map<string, { count: number; kind: string | null }>();

  for (const sample of samples) {
    const skills = Array.isArray(sample.usage?.skillUsage?.skills)
      ? sample.usage?.skillUsage?.skills as SessionSkillUsageEntry[]
      : [];

    for (const skill of skills) {
      const skillId = typeof skill.assetId === 'string' ? skill.assetId.trim() : '';
      const count = asFiniteNumber(skill.invocationCount);
      if (!skillId || count <= 0) {
        continue;
      }

      const current = totals.get(skillId);
      totals.set(skillId, {
        count: (current?.count ?? 0) + count,
        kind: typeof skill.assetKind === 'string' ? skill.assetKind : current?.kind ?? null,
      });
    }
  }

  return Array.from(totals.entries())
    .map(([label, value]) => ({
      label,
      count: value.count,
      detail: value.kind ? `${value.kind}` : undefined,
    }))
    .sort((left, right) => right.count - left.count || String(left.label || '').localeCompare(String(right.label || '')))
    .slice(0, 5);
}

function buildTopAssets(assets: CatalogAuditAssetSummary[]): CountEntry[] {
  return [...assets]
    .map((asset) => {
      const invocationCount = asFiniteNumber(asset.usage?.invocationCount);
      const queryCount = asFiniteNumber(asset.search?.sampled?.queryCount);
      const selectedCount = asFiniteNumber(asset.search?.sampled?.selectedCount);
      const score = invocationCount * 100 + selectedCount * 10 + queryCount;
      const detailParts = [];

      detailParts.push(`${invocationCount} invocations`);
      if (queryCount > 0) {
        detailParts.push(`${queryCount} queries`);
      }
      if (selectedCount > 0) {
        detailParts.push(`${selectedCount} selections`);
      }
      if (typeof asset.kind === 'string' && asset.kind.trim()) {
        detailParts.unshift(asset.kind);
      }

      return {
        label: asset.current?.title || asset.assetId,
        count: score,
        detail: detailParts.join(' | '),
      };
    })
    .filter((entry) => entry.count > 0)
    .sort((left, right) => right.count - left.count || String(left.label || '').localeCompare(String(right.label || '')))
    .slice(0, 5);
}

export default function StatsView() {
  const statsState = useStoreValue(statsStore);

  useEffect(() => {
    statsStore.startPolling();
    return () => {
      statsStore.stopPolling();
    };
  }, []);

  const sourceCoverage = useMemo(
    () => buildSourceCoverage(statsState.sessions as Record<string, unknown>[]),
    [statsState.sessions]
  );
  const activeSessionCount = useMemo(
    () => statsState.sessions.filter((session) => resolveSessionStatus(session) === 'active').length,
    [statsState.sessions]
  );
  const topAgents = useMemo(
    () => buildTopAgents(statsState.recentSessionUsage),
    [statsState.recentSessionUsage]
  );
  const topSkills = useMemo(
    () => buildTopSkills(statsState.recentSessionUsage),
    [statsState.recentSessionUsage]
  );
  const topAssets = useMemo(
    () => buildTopAssets(Array.isArray(statsState.analytics?.assets) ? statsState.analytics.assets : []),
    [statsState.analytics]
  );
  const recentSessions = useMemo(
    () => statsState.sessions.slice(0, 8),
    [statsState.sessions]
  );
  const providerUsage = statsState.providerUsage;

  const runtimeStatus = statsState.health
    ? (statsState.health.ok ? 'Healthy' : 'Degraded')
    : (statsState.healthError ? 'Unavailable' : 'Checking');
  const runtimeDetail = statsState.health
    ? `Engine root: ${statsState.health.engineRoot}`
    : (statsState.healthError || 'Waiting for runtime health telemetry.');

  const catalogStatus = statsState.catalogHealth
    ? (statsState.catalogHealth.ok ? 'Ready' : 'Degraded')
    : (statsState.catalogHealthError ? 'Unavailable' : 'Checking');
  const catalogDetail = statsState.catalogHealth
    ? `Read mode: ${statsState.catalogHealth.projection?.readMode || 'unknown'}`
    : (statsState.catalogHealthError || 'Waiting for catalog health telemetry.');

  const executorStatus = statsState.executorHealth
    ? (statsState.executorHealth.enabled ? statsState.executorHealth.state : 'Managed Off')
    : (statsState.executorHealthError ? 'Unavailable' : 'Checking');
  const executorDetail = statsState.executorHealth
    ? statsState.executorHealth.enabled
      ? `${statsState.executorHealth.jobCount} jobs, ${statsState.executorHealth.runCount} runs, ${statsState.executorHealth.scheduledJobCount} scheduled`
      : 'Managed executor is off; external session telemetry can still be observed.'
    : (statsState.executorHealthError || 'Waiting for executor health telemetry.');

  const analyticsStats = statsState.analytics?.stats;
  const telemetryCounters = statsState.analytics?.telemetry?.countersByEventType ?? {};
  const sampledSessionsCount = statsState.recentSessionUsage.length;
  const refreshLabel = statsState.loading
    ? 'Refreshing telemetry…'
    : statsState.lastUpdatedAtMs
      ? `Updated ${formatTimestampLabel(statsState.lastUpdatedAtMs)}`
      : 'Waiting for first stats refresh.';

  return (
    <section className="workspace-stack stats-view" data-testid="stats-view">
      <Toolbar testId="stats-toolbar">
        <div className="workspace-nav-summary">
          <p className="workspace-nav-title">Stats</p>
          <p className="workspace-nav-copy">
            Aggregate runtime health, session coverage, catalog telemetry, and recent sampled usage in one operator surface.
          </p>
        </div>

        <div className="planning-toolbar-actions">
          <p className="workspace-nav-copy">{refreshLabel}</p>
          <Button
            onClick={() => {
              void statsStore.refresh();
            }}
            testId="stats-refresh-action"
            variant="secondary"
          >
            Refresh Stats
          </Button>
        </div>
      </Toolbar>

      <div className="state-grid">
        <Panel
          subtitle="Tracks the current app, catalog, SDK bridge, and executor state using the existing runtime health endpoints."
          testId="stats-runtime-health-panel"
          title="Runtime Health"
        >
          <div className="state-card-grid">
            <article className="state-card">
              <p className="state-card-title">Instruction Engine</p>
              <p className="workspace-section-label">{runtimeStatus}</p>
              <p className="state-card-copy">{runtimeDetail}</p>
            </article>
            <article className="state-card">
              <p className="state-card-title">Catalog Projection</p>
              <p className="workspace-section-label">{catalogStatus}</p>
              <p className="state-card-copy">{catalogDetail}</p>
            </article>
            <article className="state-card">
              <p className="state-card-title">Executor</p>
              <p className="workspace-section-label">{executorStatus}</p>
              <p className="state-card-copy">{executorDetail}</p>
            </article>
          </div>

          {statsState.healthError ? <p className="state-message state-error">{statsState.healthError}</p> : null}
          {statsState.catalogHealthError ? <p className="state-message state-error">{statsState.catalogHealthError}</p> : null}
          {statsState.executorHealthError ? <p className="state-message state-error">{statsState.executorHealthError}</p> : null}
        </Panel>

        <Panel
          subtitle="Shows the deduped merged session inventory and recent source coverage from CLI, VS Code, and sandbox lanes."
          testId="stats-sessions-panel"
          title="Session Landscape"
          footer={(
            <p className="state-card-detail">
              Session counts come from the merged runtime inventory returned by /api/sessions with source=all and dedupe=on.
            </p>
          )}
        >
          <div className="state-card-grid">
            <article className="state-card">
              <p className="state-card-title">Merged sessions</p>
              <p className="workspace-section-label">{statsState.sessions.length}</p>
              <p className="state-card-copy">Recent deduped sessions visible across runtime sources.</p>
            </article>
            <article className="state-card">
              <p className="state-card-title">Active sessions</p>
              <p className="workspace-section-label">{activeSessionCount}</p>
              <p className="state-card-copy">Sessions currently reporting an active status.</p>
            </article>
            {sourceCoverage.map((entry) => (
              <article className="state-card" key={entry.label}>
                <p className="state-card-title">{entry.label}</p>
                <p className="workspace-section-label">{entry.count}</p>
                <p className="state-card-copy">Sessions whose merged source set includes this lane.</p>
              </article>
            ))}
          </div>

          {statsState.sessionsError ? <p className="state-message state-error">{statsState.sessionsError}</p> : null}
        </Panel>
      </div>

      <div className="state-grid">
        <Panel
          subtitle="Summarizes aggregate asset, repo, session, search, and invocation telemetry from catalog audit analytics."
          testId="stats-catalog-telemetry-panel"
          title="Catalog Telemetry"
        >
          <div className="state-card-grid">
            <article className="state-card">
              <p className="state-card-title">Assets surfaced</p>
              <p className="workspace-section-label">{analyticsStats?.assetCount ?? 0}</p>
              <p className="state-card-copy">Assets represented in the current telemetry rollup.</p>
            </article>
            <article className="state-card">
              <p className="state-card-title">Repos surfaced</p>
              <p className="workspace-section-label">{analyticsStats?.repoCount ?? 0}</p>
              <p className="state-card-copy">Repos represented in the current telemetry rollup.</p>
            </article>
            <article className="state-card">
              <p className="state-card-title">Sessions surfaced</p>
              <p className="workspace-section-label">{analyticsStats?.sessionCount ?? 0}</p>
              <p className="state-card-copy">Sessions represented in the asset audit analytics summary.</p>
            </article>
            <article className="state-card">
              <p className="state-card-title">Audit events</p>
              <p className="workspace-section-label">{analyticsStats?.auditEventCount ?? 0}</p>
              <p className="state-card-copy">Total audit events included in the current aggregate snapshot.</p>
            </article>
            <article className="state-card">
              <p className="state-card-title">Sampled search events</p>
              <p className="workspace-section-label">{analyticsStats?.sampledSearchEventCount ?? 0}</p>
              <p className="state-card-copy">Bounded search/discovery events retained in telemetry samples.</p>
            </article>
            <article className="state-card">
              <p className="state-card-title">Event types seen</p>
              <p className="workspace-section-label">{Object.keys(telemetryCounters).length}</p>
              <p className="state-card-copy">Distinct audit event types represented in the current rollup.</p>
            </article>
          </div>

          {statsState.analyticsError ? <p className="state-message state-error">{statsState.analyticsError}</p> : null}

          {topAssets.length === 0 ? (
            <p className="state-message">No asset activity has been observed yet.</p>
          ) : (
            <ul className="tracker-session-list" data-testid="stats-top-assets-list">
              {topAssets.map((entry) => (
                <li key={entry.label}>
                  <div>
                    <p className="tracker-item-title">{entry.label}</p>
                    {entry.detail ? <p className="tracker-item-copy">{entry.detail}</p> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          subtitle="Rolls up recent per-session agent and skill usage from a bounded sample of the most recent merged sessions."
          testId="stats-recent-usage-panel"
          title="Recent Usage"
          footer={(
            <p className="state-card-detail">
              Recent agent and skill rollups are sampled from the most recent {STATS_RECENT_SESSION_SAMPLE_SIZE} merged sessions, not the full historical ledger.
            </p>
          )}
        >
          <div className="state-meta-grid">
            <article className="state-meta-card">
              <p className="state-card-title">Sampled sessions</p>
              <p className="workspace-section-label">{sampledSessionsCount}</p>
              <p className="state-card-copy">Recent merged sessions enriched with per-session usage when available.</p>
            </article>
            <article className="state-meta-card">
              <p className="state-card-title">Top recent agents</p>
              {topAgents.length === 0 ? (
                <p className="state-card-copy">No recent agent usage sample is available yet.</p>
              ) : (
                <ul className="tracker-session-list" data-testid="stats-top-agents-list">
                  {topAgents.map((entry) => (
                    <li key={entry.label}>
                      <div>
                        <p className="tracker-item-title">{entry.label}</p>
                        <p className="tracker-item-copy">{entry.count} sampled events</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </article>
            <article className="state-meta-card">
              <p className="state-card-title">Top recent skills</p>
              {topSkills.length === 0 ? (
                <p className="state-card-copy">No recent skill usage sample is available yet.</p>
              ) : (
                <ul className="tracker-session-list" data-testid="stats-top-skills-list">
                  {topSkills.map((entry) => (
                    <li key={entry.label}>
                      <div>
                        <p className="tracker-item-title">{entry.label}</p>
                        <p className="tracker-item-copy">
                          {entry.count} sampled invocations{entry.detail ? ` | ${entry.detail}` : ''}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          </div>

          {statsState.usageError ? <p className="state-message state-error">{statsState.usageError}</p> : null}
        </Panel>
      </div>

      <Panel
        subtitle="Aggregates provider, model, and agent usage from OpenCode request logs and Codex session inventory."
        testId="stats-provider-usage-panel"
        title="Provider Usage"
        footer={providerUsage ? (
          <p className="state-card-detail">
            Generated {formatOptionalTimestamp(providerUsage.generatedAt)} from {providerUsage.opencode.logFiles} log file(s).
            {providerUsage.opencode.totalRequests - providerUsage.opencode.sampledRequests > 0
              ? ` Showing ${providerUsage.opencode.sampledRequests} of ${providerUsage.opencode.totalRequests} total requests.`
              : ''}
          </p>
        ) : null}
      >
        {!providerUsage ? (
          <p className="state-message">Provider usage data is not yet available.</p>
        ) : (
          <div className="state-meta-grid">
            <article className="state-meta-card">
              <p className="state-card-title">OpenCode Requests</p>
              <p className="workspace-section-label">{providerUsage.opencode.totalRequests}</p>
              <p className="state-card-copy">Total LLM requests across {providerUsage.opencode.logFiles} log files.</p>
            </article>
            <article className="state-meta-card">
              <p className="state-card-title">Codex Sessions</p>
              <p className="workspace-section-label">{providerUsage.codex.sessionCount}</p>
              <p className="state-card-copy">Sessions found in Codex session index.</p>
            </article>
            <article className="state-meta-card">
              <p className="state-card-title">Top Providers</p>
              {providerUsage.opencode.providers.length === 0 ? (
                <p className="state-card-copy">No provider data available.</p>
              ) : (
                <ul className="tracker-session-list" data-testid="stats-top-providers-list">
                  {providerUsage.opencode.providers.slice(0, 5).map((entry) => (
                    <li key={entry.name}>
                      <div>
                        <p className="tracker-item-title">{entry.name}</p>
                        <p className="tracker-item-copy">{entry.count} requests</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </article>
            <article className="state-meta-card">
              <p className="state-card-title">Top Models</p>
              {providerUsage.opencode.topModels.length === 0 ? (
                <p className="state-card-copy">No model data available.</p>
              ) : (
                <ul className="tracker-session-list" data-testid="stats-top-models-list">
                  {providerUsage.opencode.topModels.slice(0, 5).map((entry) => (
                    <li key={entry.name}>
                      <div>
                        <p className="tracker-item-title">{entry.name}</p>
                        <p className="tracker-item-copy">{entry.count} requests · {entry.provider}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </article>
            <article className="state-meta-card">
              <p className="state-card-title">Top Agents / Lanes</p>
              {providerUsage.opencode.topAgents.length === 0 ? (
                <p className="state-card-copy">No agent data available.</p>
              ) : (
                <ul className="tracker-session-list" data-testid="stats-top-agents-list">
                  {providerUsage.opencode.topAgents.slice(0, 5).map((entry) => (
                    <li key={entry.name}>
                      <div>
                        <p className="tracker-item-title">{entry.name}</p>
                        <p className="tracker-item-copy">{entry.count} requests</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </article>
            {providerUsage.codex.sessionCount > 0 ? (
              <article className="state-meta-card">
                <p className="state-card-title">Recent Codex Sessions</p>
                <ul className="tracker-session-list" data-testid="stats-codex-sessions-list">
                  {providerUsage.codex.recentSessions.slice(0, 5).map((session) => (
                    <li key={session.id}>
                      <div>
                        <p className="tracker-item-title">{session.name || session.id}</p>
                        <p className="tracker-item-copy">{session.updatedAt ? formatOptionalTimestamp(session.updatedAt) : 'Unknown'}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </article>
            ) : null}
          </div>
        )}

        {statsState.providerUsageError ? (
          <p className="state-message state-error">{statsState.providerUsageError}</p>
        ) : null}
      </Panel>

      <Panel
        subtitle="Recent merged sessions, their observed sources, and whether the Stats tab could enrich them with sampled usage data."
        testId="stats-recent-sessions-panel"
        title="Recent Sessions"
      >
        {recentSessions.length === 0 ? (
          <p className="state-message">No merged sessions have been observed yet.</p>
        ) : (
          <ul className="tracker-session-list" data-testid="stats-recent-sessions-list">
            {recentSessions.map((session) => {
              const usageSample = statsState.recentSessionUsage.find((sample) => sample.session.id === session.id) ?? null;
              const startedAt = resolveSessionStartedAt(session);
              const updatedAt = resolveSessionUpdatedAt(session);

              return (
                <li key={session.id}>
                  <div>
                    <p className="tracker-item-title">{session.id}</p>
                    <p className="tracker-item-copy">
                      {resolveSessionSourceLabel(session)}
                      {' | '}
                      {resolveSessionStatus(session)}
                      {startedAt ? ` | started ${formatTimestampLabel(startedAt)}` : ''}
                      {updatedAt ? ` | updated ${formatTimestampLabel(updatedAt)}` : ''}
                    </p>
                    <p className="tracker-item-copy">
                      {usageSample
                        ? usageSample.error
                          ? usageSample.error
                          : 'Recent usage sample available.'
                        : 'No recent usage sample requested for this session.'}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {statsState.analytics?.generatedAt ? (
          <p className="state-card-detail">Catalog analytics generated {formatOptionalTimestamp(statsState.analytics.generatedAt)}.</p>
        ) : null}
      </Panel>
    </section>
  );
}