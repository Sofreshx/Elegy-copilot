import { useEffect } from 'react';
import { Badge, Button, Panel } from '../../components';
import { useStoreValue } from '../../lib/store';
import type { CodexSubagentRecord } from '../../lib/api/codexConfig';
import { codexProviderStore } from '../../stores/codexProviderStore';
import { toolingUpdatesStore } from '../../stores/toolingUpdatesStore';
import HarnessAssetsPanel from '../Catalog/HarnessAssetsPanel';
import { MetricValue, ProviderDefinitionGrid, ProviderPath } from './ProviderData';

const CODEX_PLUGIN_NAMES = [
  'elegy-documentation',
  'elegy-mcp',
  'elegy-checks',
  'elegy-planning',
] as const;

const CODEX_EXPECTATIONS = {
  enabled: true,
  concurrency: 6,
  model: 'gpt-5.6-luna',
  reasoning: 'high',
  depth: 1,
  runtime: 1800,
} as const;

function statusTone(status: string | null | undefined): 'success' | 'accent' | 'danger' | 'neutral' {
  const normalized = String(status || '').toLowerCase();
  if (['ready', 'current', 'installed', 'healthy', 'synced', 'completed'].includes(normalized)) return 'success';
  if (['stale', 'warning', 'degraded', 'missingartifact'].includes(normalized)) return 'accent';
  if (['failed', 'error', 'missing', 'notinstalled'].includes(normalized)) return 'danger';
  return 'neutral';
}

function ReadOnlyBadge({ children = 'Harness-owned · read-only' }: { children?: string }) {
  return <Badge tone="neutral">{children}</Badge>;
}

function NativeCodexOverview() {
  const state = useStoreValue(codexProviderStore);
  const cli = state.cliStatus;
  const provider = state.status;
  const pluginsState = useStoreValue(toolingUpdatesStore);
  const plugins = pluginsState.status?.elegyPlugins?.plugins ?? [];
  const pluginByName = new Map(plugins.map((plugin) => [plugin.plugin, plugin]));
  const nativeSettings = state.subagents?.settings;

  return (
    <div className="codex-settings-sections" data-testid="codex-native-overview">
      <Panel
        title="Native Codex"
        subtitle="Codex CLI health and harness-owned configuration"
        testId="codex-native-status"
      >
        <div className="codex-status-grid">
          <div className="codex-status-card">
            <span className="codex-status-label">Provider</span>
            <Badge tone="success">Native Codex CLI</Badge>
            <ReadOnlyBadge />
          </div>
          <div className="codex-status-card">
            <span className="codex-status-label">CLI</span>
            <Badge tone={statusTone(cli?.installed ? 'installed' : 'missing')}>
              {cli?.installed ? (cli.version || 'Installed') : 'Not detected'}
            </Badge>
            {!cli?.installed ? (
              <Button
                variant="secondary"
                size="sm"
                testId="codex-install-cli"
                disabled={state.installingCli}
                onClick={() => void codexProviderStore.installCli()}
              >
                {state.installingCli ? 'Installing…' : 'Install Codex CLI'}
              </Button>
            ) : null}
          </div>
          <div className="codex-status-card">
            <span className="codex-status-label">Configuration</span>
            <code>{provider?.configPath || 'Not found'}</code>
            <small>Managed by Codex and read-only here.</small>
          </div>
          <div className="codex-status-card">
            <span className="codex-status-label">Codex home</span>
            <code>{provider?.codexHome || 'Not found'}</code>
          </div>
        </div>
        {provider?.hasLegacyBlock ? (
          <div className="state-message state-message-error" role="alert" data-testid="codex-legacy-migration-warning">
            <strong>Codex legacy configuration migration required.</strong>
            <p>
              This Codex home still contains a known Elegy provider block. Run the Codex installer migration before using native Codex; it backs up the file and removes only known Elegy-managed legacy entries.
            </p>
            <small>{provider.legacyMigration?.action || 'Run the Codex installer to remove known Elegy legacy provider blocks.'}</small>
          </div>
        ) : null}
        {cli?.lastError ? <p className="state-message state-message-error">{cli.lastError}</p> : null}
        {state.message ? <p className="state-message">{state.message}</p> : null}
      </Panel>

      <Panel
        title="Expected [agents] configuration"
        subtitle="The current Codex subagent policy is visible for verification, not edited by Elegy."
        testId="codex-agents-expectations"
      >
        <ProviderDefinitionGrid className="codex-config-expectations" testId="codex-agents-expectation-values" items={[
          { label: 'Enabled', value: <strong>{String(CODEX_EXPECTATIONS.enabled)}</strong> },
          { label: 'Concurrency', value: <strong>{nativeSettings?.maxThreads ?? CODEX_EXPECTATIONS.concurrency}</strong> },
          { label: 'Model', value: <strong>{CODEX_EXPECTATIONS.model}</strong> },
          { label: 'Reasoning', value: <strong>{CODEX_EXPECTATIONS.reasoning}</strong> },
          { label: 'Depth', value: <strong>{nativeSettings?.maxDepth ?? CODEX_EXPECTATIONS.depth}</strong> },
          { label: 'Runtime', value: <strong>{nativeSettings?.jobMaxRuntimeSeconds ?? CODEX_EXPECTATIONS.runtime}s</strong> },
        ]} />
        <p className="codex-readonly-note">
          Native Codex agents and this configuration are harness-owned. Use the Codex configuration surface when a native value must change.
        </p>
      </Panel>

      <Panel
        title="Elegy Codex plugins"
        subtitle="Installed through the Elegy marketplace; versions and updates stay in Maintenance → Updates."
        testId="codex-plugin-status"
      >
        <div className="codex-plugin-list">
          {CODEX_PLUGIN_NAMES.map((name) => {
            const plugin = pluginByName.get(name);
            const pluginStatus = plugin?.status || 'unknown';
            return (
              <div className="codex-plugin-row" key={name} data-testid={`codex-plugin-${name}`}>
                <div>
                  <strong>{name}</strong>
                  {name === 'elegy-planning' ? <small>Direct Codex subagent/workflow plugin</small> : <small>Elegy marketplace plugin</small>}
                </div>
                <div className="codex-plugin-state">
                  <Badge tone={statusTone(pluginStatus)}>{plugin ? pluginStatus : 'Status unavailable'}</Badge>
                  <ReadOnlyBadge>Marketplace-managed · read-only</ReadOnlyBadge>
                </div>
              </div>
            );
          })}
        </div>
        {pluginsState.error ? <p className="state-message state-message-error">{pluginsState.error}</p> : null}
      </Panel>
    </div>
  );
}

function AgentRow({ agent, project }: { agent: CodexSubagentRecord; project?: boolean }) {
  const status = agent.operationalStatus || (agent.usable ? 'usable' : agent.missing ? 'missing' : 'unknown');
  return (
    <div className="codex-agent-row" data-testid={`codex-agent-${agent.name}`}>
      <div className="codex-agent-main">
        <strong>{agent.name}</strong>
        <details className="codex-agent-details">
          <summary>{agent.description || 'Codex subagent definition'}</summary>
          <div className="codex-agent-detail-grid">
            <span>Model</span><strong>{agent.model || 'Inherited'}</strong>
            <span>Reasoning</span><strong>{agent.modelReasoningEffort || 'Default'}</strong>
            <span>Sandbox</span><strong>{agent.sandboxMode || 'Default'}</strong>
            <span>Source</span><ProviderPath value={agent.sourcePath || agent.installedPath} />
          </div>
          {agent.content ? <pre>{agent.content}</pre> : null}
        </details>
      </div>
      <div className="codex-agent-state">
        <Badge tone={statusTone(status)}>{status}</Badge>
        <ReadOnlyBadge>{project ? 'Repository-owned · read-only' : 'Harness-owned · read-only'}</ReadOnlyBadge>
      </div>
    </div>
  );
}

function CodexSubagentsSection() {
  const state = useStoreValue(codexProviderStore);
  const subagents = state.subagents;

  return (
    <div className="codex-settings-sections" data-testid="codex-subagents-section">
      <Panel
        title="Native Codex agents"
        subtitle="Six native agents from the current Codex receipt. These definitions are inspected here and managed by Codex."
        testId="codex-subagents-panel"
      >
        {state.subagentsLoading ? <p className="state-message">Loading Codex agents…</p> : null}
        {state.error ? <p className="state-message state-message-error">{state.error}</p> : null}
        {!state.subagentsLoading && !subagents ? (
          <p className="state-message">No Codex agent inventory is available.</p>
        ) : null}
        {subagents?.agents.map((agent) => <AgentRow key={agent.name} agent={agent} />)}
        {subagents?.projectAgents.length ? (
          <>
            <h4>Repository agents</h4>
            {subagents.projectAgents.map((agent) => <AgentRow key={agent.name} agent={agent} project />)}
          </>
        ) : null}
      </Panel>
    </div>
  );
}

function CodexUsageSection() {
  const state = useStoreValue(codexProviderStore);
  const usage = state.subagentUsage;
  return (
    <div className="codex-settings-sections" data-testid="codex-usage-section">
      <Panel title="Subagent usage" subtitle="Read-only usage reported by the Codex runtime." testId="codex-subagent-usage">
        {!usage ? <p className="state-message">No usage data is available.</p> : null}
        {usage ? (
          <>
            <ProviderDefinitionGrid className="codex-config-expectations" items={[
              { label: 'Runs', value: <MetricValue value={usage.summary.runs} /> },
              { label: 'Tokens', value: <MetricValue value={usage.summary.tokens} /> },
              { label: 'Tool events', value: <MetricValue value={usage.summary.toolEvents} /> },
              { label: 'Errors', value: <MetricValue value={usage.summary.errors} /> },
            ]} />
            <div className="codex-usage-list">
              {usage.byAgent.map((entry) => (
                <div className="codex-usage-row" key={entry.name}>
                  <strong>{entry.name}</strong>
                  <span className="provider-inline-metrics">
                    <span><MetricValue value={entry.count} /> runs</span>
                    <span><MetricValue value={entry.tokens} /> tokens</span>
                    <span><MetricValue value={entry.errors} /> errors</span>
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </Panel>
    </div>
  );
}

export default function CodexProviderPanel() {
  const state = useStoreValue(codexProviderStore);
  const toolingState = useStoreValue(toolingUpdatesStore);

  useEffect(() => {
    void codexProviderStore.load();
    void toolingUpdatesStore.refresh();
    return () => codexProviderStore.resetState();
  }, []);

  useEffect(() => {
    if ((state.activeSection === 'subagents' || state.activeSection === 'usage') && !state.subagents && !state.subagentsLoading) {
      void codexProviderStore.loadSubagents();
    }
  }, [state.activeSection, state.subagents, state.subagentsLoading]);

  const section = state.activeSection;

  return (
    <div className="codex-provider-panel" data-testid="codex-provider-panel">
      <div className="workspace-nav" role="tablist" aria-label="Codex sections">
        {([
          ['overview', 'Overview'],
          ['assets', 'Assets'],
          ['subagents', 'Subagents'],
          ['usage', 'Usage'],
        ] as const).map(([id, label]) => (
          <button
            type="button"
            role="tab"
            aria-selected={section === id}
            key={id}
            className={`opencode-tab${section === id ? ' opencode-tab-active' : ''}`}
            data-testid={`codex-tab-${id}`}
            onClick={() => codexProviderStore.setActiveSection(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {state.loading && !state.status ? <p className="state-message">Loading native Codex status…</p> : null}
      {state.error && section === 'overview' ? <p className="state-message state-message-error">{state.error}</p> : null}
      {toolingState.loading && section === 'overview' ? <p className="state-message">Refreshing plugin status…</p> : null}

      {section === 'overview' ? <NativeCodexOverview /> : null}
      {section === 'assets' ? <HarnessAssetsPanel harnessId="codex" /> : null}
      {section === 'subagents' ? <CodexSubagentsSection /> : null}
      {section === 'usage' ? <CodexUsageSection /> : null}
    </div>
  );
}
