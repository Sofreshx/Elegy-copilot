import { useEffect, useState } from 'react';
import { Badge, Button, Panel } from '../../components';
import { useStoreValue } from '../../lib/store';
import { codexProviderStore, type CodexProviderState } from '../../stores/codexProviderStore';
import type { CodexSubagentRecord, CodexSubagentSettings, CodexSubagentUsageResponse, OpenCodeWorkerConfig } from '../../lib/api/codexConfig';

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  fontSize: '13px',
  border: '1px solid var(--border-color, #ccc)',
  borderRadius: '4px',
  background: 'var(--input-bg, #fff)',
  color: 'var(--text-color, #000)',
  fontFamily: 'monospace',
  boxSizing: 'border-box',
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  minHeight: 120,
  resize: 'vertical',
};

function splitInstructions(content: string): string {
  const match = String(content || '').match(/developer_instructions\s*=\s*"""([\s\S]*?)"""/);
  return match ? match[1].trim() : '';
}

function CapabilityList({ title, values }: { title: string; values: string[] }) {
  return (
    <div style={{ minWidth: 160 }}>
      <strong style={{ fontSize: 12 }}>{title}</strong>
      {values.length > 0 ? (
        <ul style={{ margin: '4px 0 0 18px', padding: 0, fontSize: 12 }}>
          {values.map((value) => <li key={value}>{value}</li>)}
        </ul>
      ) : (
        <p className="settings-row-description" style={{ margin: '4px 0 0' }}>None observed.</p>
      )}
    </div>
  );
}

function formatCount(value: number | null | undefined): string {
  return Number(value || 0).toLocaleString();
}

function subagentStatusTone(agent: CodexSubagentRecord): 'neutral' | 'brand' | 'accent' | 'success' | 'danger' {
  if (agent.parseError || agent.missing) return 'danger';
  if (agent.operationalStatus === 'disabled') return 'neutral';
  if (agent.drift) return 'brand';
  if (agent.usable) return 'success';
  return 'neutral';
}

function subagentStatusLabel(agent: CodexSubagentRecord): string {
  if (agent.parseError) return 'Invalid';
  if (agent.missing) return 'Missing';
  if (agent.operationalStatus === 'disabled') return 'Off';
  if (agent.drift) return 'Local override';
  if (agent.usable) return 'Ready';
  return agent.managed ? 'Managed' : 'Unmanaged';
}

function routingTone(routingMode: string): 'neutral' | 'brand' | 'accent' | 'success' | 'danger' {
  if (routingMode === 'off') return 'neutral';
  if (routingMode === 'governed-automatic') return 'brand';
  if (routingMode === 'suggested') return 'accent';
  return 'success';
}

function CodexSubagentCard({ agent, saving, readOnly = false }: { agent: CodexSubagentRecord; saving: boolean; readOnly?: boolean }) {
  const [model, setModel] = useState(agent.model || '');
  const [effort, setEffort] = useState(agent.modelReasoningEffort || 'medium');
  const [sandbox, setSandbox] = useState(agent.sandboxMode || 'read-only');
  const [routingMode, setRoutingMode] = useState(agent.routingMode || 'manual');
  const [allowSpark, setAllowSpark] = useState(agent.allowSpark);
  const [instructions, setInstructions] = useState(splitInstructions(agent.content));

  useEffect(() => {
    setModel(agent.model || '');
    setEffort(agent.modelReasoningEffort || 'medium');
    setSandbox(agent.sandboxMode || 'read-only');
    setRoutingMode(agent.routingMode || 'manual');
    setAllowSpark(agent.allowSpark);
    setInstructions(splitInstructions(agent.content));
  }, [agent]);

  const fieldsDisabled = saving || readOnly;
  const saveDisabled = fieldsDisabled || Boolean(agent.parseError);
  const usage = agent.usageSummary || { runs: 0, tokens: 0, toolEvents: 0, errors: 0 };
  const pathLabel = agent.installedPath || agent.sourcePath || 'No path available';

  return (
    <div className="settings-row" data-testid={`codex-subagent-${agent.name}`} style={{ alignItems: 'flex-start', gap: 16 }}>
      <div className="settings-row-label" style={{ gap: 10, minWidth: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, alignItems: 'center' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <strong>{agent.name}</strong>
              <Badge tone={subagentStatusTone(agent)}>{subagentStatusLabel(agent)}</Badge>
              {readOnly ? <Badge tone="neutral">Project</Badge> : null}
            </div>
            <span className="settings-row-description">{agent.description}</span>
          </div>
          <div>
            <span className="settings-row-description">Routing</span>
            <div><Badge tone={routingTone(agent.routingMode)}>{agent.routingMode}</Badge></div>
          </div>
          <div>
            <span className="settings-row-description">Model</span>
            <div style={{ fontSize: 12, fontFamily: 'monospace', wordBreak: 'break-word' }}>{agent.model || 'unset'}</div>
          </div>
          <div>
            <span className="settings-row-description">Sandbox</span>
            <div><Badge tone={agent.sandboxMode === 'read-only' ? 'success' : 'accent'}>{agent.sandboxMode || 'unset'}</Badge></div>
          </div>
          <div>
            <span className="settings-row-description">Usage</span>
            <div style={{ fontSize: 12 }}>
              {formatCount(usage.runs)} runs · {formatCount(usage.toolEvents)} tools
            </div>
          </div>
        </div>
        {agent.parseError ? (
          <span className="settings-row-error">TOML parse error: {agent.parseError}</span>
        ) : null}
        <details style={{ marginTop: 2 }}>
          <summary className="settings-row-description">Details and controls</summary>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, marginTop: 10 }}>
            <label>
              <span className="settings-row-description">Model</span>
              <input value={model} onChange={(event) => setModel(event.target.value)} style={inputStyle} disabled={fieldsDisabled} readOnly={readOnly} />
            </label>
            <label>
              <span className="settings-row-description">Reasoning</span>
              <select value={effort} onChange={(event) => setEffort(event.target.value)} style={inputStyle} disabled={fieldsDisabled}>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            </label>
            <label>
              <span className="settings-row-description">Sandbox</span>
              <select value={sandbox} onChange={(event) => setSandbox(event.target.value)} style={inputStyle} disabled={fieldsDisabled}>
                <option value="read-only">read-only</option>
                <option value="workspace-write">workspace-write</option>
              </select>
            </label>
            <label>
              <span className="settings-row-description">Routing</span>
              <select value={routingMode} onChange={(event) => setRoutingMode(event.target.value)} style={inputStyle} disabled={fieldsDisabled}>
                <option value="manual">manual</option>
                <option value="suggested">suggested</option>
                <option value="governed-automatic">governed automatic</option>
                <option value="off">off</option>
              </select>
            </label>
          </div>
          {agent.fastModel ? (
            <label className="settings-row-description" style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
              <input type="checkbox" checked={allowSpark} onChange={(event) => setAllowSpark(event.target.checked)} disabled={fieldsDisabled} />
              Allow Spark fast lane when available ({agent.fastModel})
            </label>
          ) : null}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, marginTop: 10 }}>
            <div>
              <span className="settings-row-description">Recent usage</span>
              <p className="settings-row-description" style={{ margin: 0 }}>
                {formatCount(usage.runs)} runs · {formatCount(usage.tokens)} tokens · {formatCount(usage.toolEvents)} tools · {formatCount(usage.errors)} errors
              </p>
            </div>
            <div>
              <span className="settings-row-description">Path</span>
              <p className="settings-row-description" style={{ margin: 0, wordBreak: 'break-all' }}>{pathLabel}</p>
            </div>
          </div>
          <p className="settings-row-description" style={{ marginTop: 8 }}>{agent.toolScopeNote}</p>
          <label style={{ marginTop: 8 }}>
            <span className="settings-row-description">Developer instructions</span>
            <textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} style={textareaStyle} disabled={fieldsDisabled} readOnly={readOnly} />
          </label>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
            <CapabilityList title="Enforced" values={agent.capabilities.enforced} />
            <CapabilityList title="Configured" values={agent.capabilities.configured} />
            <CapabilityList title="Inherited" values={agent.capabilities.inherited} />
            <CapabilityList title="Observed" values={agent.capabilities.observed} />
          </div>
          <details style={{ marginTop: 8 }}>
            <summary className="settings-row-description">Raw TOML preview</summary>
            <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 220, overflow: 'auto', fontSize: 11 }}>{agent.content}</pre>
          </details>
        </details>
      </div>
      <div className="settings-row-action" style={{ flexDirection: 'column', alignItems: 'flex-end' }}>
        {!readOnly ? (
          <Button
            variant="primary"
            size="sm"
            disabled={saveDisabled}
            testId={`codex-subagent-save-${agent.name}`}
            onClick={() => codexProviderStore.saveSubagent(agent.name, {
              model,
              model_reasoning_effort: effort,
              sandbox_mode: sandbox,
              developer_instructions: instructions,
              routingMode,
              allowSpark,
            })}
          >
            Save
          </Button>
        ) : null}
        {agent.managed && !readOnly ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={saving}
            testId={`codex-subagent-reset-${agent.name}`}
            onClick={() => codexProviderStore.resetSubagent(agent.name)}
          >
            {agent.missing ? 'Install' : 'Reset to managed'}
          </Button>
        ) : null}
        {!readOnly ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={saving || agent.scope === 'project'}
            testId={`codex-subagent-uninstall-${agent.name}`}
            onClick={() => codexProviderStore.uninstallSubagent(agent.name, agent.drift)}
          >
            Uninstall
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function CodexSubagentSummary({ data, usage }: { data: NonNullable<CodexProviderState['subagents']>; usage: CodexSubagentUsageResponse | null }) {
  const summary = data.summary;
  const nativeTone = summary.nativeConfigSynced ? 'success' : 'danger';
  const usageLabel = usage ? `${formatCount(usage.summary.runs)} runs` : 'No usage loaded';

  return (
    <Panel title="Subagent Status" subtitle="Current managed Codex agent state" testId="codex-subagents-summary">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
        <div>
          <span className="settings-row-description">Usable</span>
          <div><Badge tone={summary.usable === summary.managed && summary.missing === 0 ? 'success' : 'accent'}>{summary.usable}/{summary.managed}</Badge></div>
        </div>
        <div>
          <span className="settings-row-description">Installed</span>
          <div><Badge tone={summary.missing === 0 ? 'success' : 'danger'}>{summary.installed} installed · {summary.missing} missing</Badge></div>
        </div>
        <div>
          <span className="settings-row-description">Overrides</span>
          <div><Badge tone={summary.drifted > 0 ? 'brand' : 'success'}>{summary.drifted} local</Badge></div>
        </div>
        <div>
          <span className="settings-row-description">Routing</span>
          <div><Badge tone={routingTone(summary.routingMode)}>{summary.routingMode}</Badge></div>
        </div>
        <div>
          <span className="settings-row-description">Fan-out</span>
          <div><Badge tone="neutral">{summary.maxThreads} threads · depth {summary.maxDepth}</Badge></div>
        </div>
        <div>
          <span className="settings-row-description">Native config</span>
          <div><Badge tone={nativeTone}>{summary.nativeConfigSynced ? 'Synced' : 'Not synced'}</Badge></div>
        </div>
        <div>
          <span className="settings-row-description">Usage</span>
          <div><Badge tone={usage ? 'brand' : 'neutral'}>{usageLabel}</Badge></div>
        </div>
        <div>
          <span className="settings-row-description">Project agents</span>
          <div><Badge tone={summary.project > 0 ? 'accent' : 'neutral'}>{summary.project}</Badge></div>
        </div>
      </div>
      {summary.invalid > 0 || summary.disabled > 0 ? (
        <p className="settings-row-description" style={{ margin: '10px 0 0' }}>
          {summary.invalid} invalid · {summary.disabled} disabled. Invalid agents are not saved until reset or corrected.
        </p>
      ) : null}
    </Panel>
  );
}

function CodexSubagentsSection({ state }: { state: CodexProviderState }) {
  const data = state.subagents;
  const settings = data?.settings;
  const nativeConfig = data?.nativeConfig;
  const updateSetting = (patch: Partial<CodexSubagentSettings>) => {
    void codexProviderStore.saveSubagentSettings(patch);
  };

  return (
    <>
      {data ? <CodexSubagentSummary data={data} usage={state.subagentUsage} /> : null}

      <Panel title="Subagent Routing" subtitle="Control when Codex should delegate work" testId="codex-subagent-routing">
        {!settings ? (
          <p className="state-message">Loading subagent settings…</p>
        ) : (
          <>
            <div className="settings-row">
              <div className="settings-row-label">
                <strong>Routing mode</strong>
                <span className="settings-row-description">
                  Default is manual. Governed automatic allows only policy-approved read-only delegation.
                </span>
              </div>
              <div className="settings-row-action">
                <select
                  value={settings.routingMode}
                  disabled={state.subagentSaving}
                  onChange={(event) => updateSetting({ routingMode: event.target.value })}
                  style={inputStyle}
                  data-testid="codex-subagent-routing-mode"
                >
                  <option value="manual">Manual only</option>
                  <option value="suggested">Suggested</option>
                  <option value="governed-automatic">Governed automatic</option>
                  <option value="off">Off</option>
                </select>
              </div>
            </div>
            <div className="settings-row">
              <div className="settings-row-label">
                <strong>Concurrency</strong>
                <span className="settings-row-description">Keep fan-out low to avoid token and MCP startup waste.</span>
                {nativeConfig ? (
                  <span className="settings-row-description">
                    Native config: {nativeConfig.matchesSettings ? 'synced' : 'not synced'} · {nativeConfig.path}
                  </span>
                ) : null}
                {nativeConfig?.parseError ? (
                  <span className="settings-row-error">Config parse error: {nativeConfig.parseError}</span>
                ) : null}
              </div>
              <div className="settings-row-action" style={{ gap: 8 }}>
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={settings.maxThreads}
                  onChange={(event) => updateSetting({ maxThreads: Number(event.target.value) })}
                  style={{ ...inputStyle, width: 90 }}
                  aria-label="Max subagent threads"
                />
                <input
                  type="number"
                  min={0}
                  max={2}
                  value={settings.maxDepth}
                  onChange={(event) => updateSetting({ maxDepth: Number(event.target.value) })}
                  style={{ ...inputStyle, width: 90 }}
                  aria-label="Max subagent depth"
                />
              </div>
            </div>
          </>
        )}
      </Panel>

      <Panel title="Managed Subagents" subtitle="Global ~/.codex/agents definitions managed by Elegy Copilot" testId="codex-subagents-managed">
        {state.subagentsLoading && !data ? <p className="state-message">Loading Codex subagents…</p> : null}
        {data && data.agents.length === 0 ? <p className="state-message">No global Codex subagents found.</p> : null}
        {data?.agents.map((agent) => (
          <CodexSubagentCard key={agent.name} agent={agent} saving={state.subagentSaving} />
        ))}
      </Panel>

      <Panel title="Project Subagents" subtitle="Read-only discovery of .codex/agents in the active project" testId="codex-subagents-project">
        {data && data.projectAgents.length === 0 ? (
          <p className="state-message">No project-scoped Codex subagents discovered for the active workspace.</p>
        ) : null}
        {data?.projectAgents.map((agent) => (
          <CodexSubagentCard key={`${agent.scope}-${agent.name}`} agent={agent} saving={state.subagentSaving} readOnly />
        ))}
      </Panel>
    </>
  );
}

function CodexSubagentUsageSection({ usage }: { usage: CodexSubagentUsageResponse | null }) {
  return (
    <Panel title="Subagent Usage" subtitle="Derived local metadata from Codex state and rollout logs" testId="codex-subagent-usage">
      {!usage ? (
        <p className="state-message">No Codex subagent usage loaded.</p>
      ) : (
        <>
          <div className="settings-row">
            <div className="settings-row-label">
              <strong>Coverage</strong>
              <span className="settings-row-description">{usage.coverage} · {usage.source.path}</span>
            </div>
            <div className="settings-row-action">
              <Badge tone={usage.coverage === 'codex-state-plus-rollouts' ? 'success' : 'neutral'}>
                {usage.summary.runs} runs
              </Badge>
            </div>
          </div>
          <div className="settings-row">
            <div className="settings-row-label">
              <strong>Totals</strong>
              <span className="settings-row-description">
                {usage.summary.tokens.toLocaleString()} tokens · {usage.summary.toolEvents} tool calls · {usage.summary.errors} errors
              </span>
            </div>
          </div>
          {usage.byAgent.map((agent) => (
            <div className="settings-row" key={agent.name}>
              <div className="settings-row-label">
                <strong>{agent.name}</strong>
                <span className="settings-row-description">
                  {agent.count} runs · {agent.tokens.toLocaleString()} tokens · {agent.toolEvents} tool calls · {agent.errors} errors
                </span>
              </div>
            </div>
          ))}
          {usage.runs.slice(0, 20).map((run) => (
            <div className="settings-row" key={run.threadId}>
              <div className="settings-row-label">
                <strong>{run.agent}</strong>
                <span className="settings-row-description">
                  {run.model || 'unknown model'} · {run.tokens.totalTokens.toLocaleString()} tokens · {run.toolEvents} tools
                </span>
                {run.flags.length > 0 ? (
                  <span className="settings-row-description">Flags: {run.flags.join(', ')}</span>
                ) : null}
              </div>
            </div>
          ))}
        </>
      )}
    </Panel>
  );
}

const WORKER_ROLES = ['exploration', 'research', 'review', 'validation'];

function OpenCodeWorkersSection({ state }: { state: CodexProviderState }) {
  const data = state.opencodeWorkers;
  const usage = state.opencodeWorkersUsage;
  const config = data?.config;
  const updateConfig = (patch: Partial<OpenCodeWorkerConfig>) => {
    void codexProviderStore.saveOpenCodeWorkers(patch);
  };

  return (
    <>
      <Panel title="OpenCode Workers" subtitle="CLI-first read-only worker plugin for Codex" testId="codex-opencode-workers">
        {!data || !config ? (
          <p className="state-message">Loading OpenCode Workers…</p>
        ) : (
          <>
            <div className="settings-row">
              <div className="settings-row-label">
                <strong>Status</strong>
                <span className="settings-row-description">Config: <code>{data.configPath}</code></span>
                <span className="settings-row-description">Journal: <code>{data.journalPath}</code></span>
              </div>
              <div className="settings-row-action" style={{ gap: 8 }}>
                <Badge tone={data.installed ? 'success' : 'neutral'}>{data.installed ? 'Installed' : 'Not installed'}</Badge>
                <Badge tone={config.enabled ? 'success' : 'neutral'}>{config.enabled ? 'Enabled' : 'Disabled'}</Badge>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={state.subagentSaving}
                  testId="codex-opencode-workers-install"
                  onClick={() => codexProviderStore.installOpenCodeWorkersPlugin()}
                >
                  Install
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={state.subagentSaving}
                  testId="codex-opencode-workers-remove"
                  onClick={() => codexProviderStore.removeOpenCodeWorkersPlugin()}
                >
                  Remove
                </Button>
                <Button
                  variant={config.enabled ? 'danger' : 'primary'}
                  size="sm"
                  disabled={state.subagentSaving}
                  testId="codex-opencode-workers-toggle"
                  onClick={() => updateConfig({ enabled: !config.enabled })}
                >
                  {config.enabled ? 'Disable' : 'Enable'}
                </Button>
              </div>
            </div>
            <div className="settings-row">
              <div className="settings-row-label">
                <strong>Default profile</strong>
                <span className="settings-row-description">Codex should omit model arguments for routine worker jobs.</span>
              </div>
              <div className="settings-row-action">
                <select
                  value={config.defaultModelProfile}
                  disabled={state.subagentSaving}
                  onChange={(event) => updateConfig({ defaultModelProfile: event.target.value })}
                  style={inputStyle}
                  data-testid="codex-opencode-workers-default-profile"
                >
                  {data.profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>{profile.label || profile.id}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="settings-row">
              <div className="settings-row-label">
                <strong>Paid/direct models</strong>
                <span className="settings-row-description">Direct DeepSeek and other credit-backed routes require explicit opt-in.</span>
              </div>
              <div className="settings-row-action">
                <label className="settings-row-description" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={config.allowPaidModels}
                    disabled={state.subagentSaving}
                    onChange={(event) => updateConfig({ allowPaidModels: event.target.checked })}
                  />
                  Allow paid/direct profiles
                </label>
              </div>
            </div>
            <div className="settings-row">
              <div className="settings-row-label">
                <strong>Timeout</strong>
                <span className="settings-row-description">Worker process timeout in seconds.</span>
              </div>
              <div className="settings-row-action">
                <input
                  type="number"
                  min={60}
                  value={config.timeoutSeconds}
                  onChange={(event) => updateConfig({ timeoutSeconds: Number(event.target.value) })}
                  style={{ ...inputStyle, width: 120 }}
                  data-testid="codex-opencode-workers-timeout"
                />
              </div>
            </div>
          </>
        )}
      </Panel>

      <Panel title="Role Profiles" subtitle="Optional per-role profile overrides" testId="codex-opencode-worker-role-profiles">
        {!config || !data ? (
          <p className="state-message">No profile data loaded.</p>
        ) : (
          WORKER_ROLES.map((role) => (
            <div className="settings-row" key={role}>
              <div className="settings-row-label">
                <strong>{role}</strong>
                <span className="settings-row-description">{config.roleProfiles[role] || config.defaultModelProfile}</span>
              </div>
              <div className="settings-row-action">
                <select
                  value={config.roleProfiles[role] || ''}
                  disabled={state.subagentSaving}
                  onChange={(event) => {
                    const next = { ...config.roleProfiles };
                    if (event.target.value) next[role] = event.target.value;
                    else delete next[role];
                    updateConfig({ roleProfiles: next });
                  }}
                  style={inputStyle}
                  data-testid={`codex-opencode-workers-role-${role}`}
                >
                  <option value="">Use default</option>
                  {data.profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>{profile.label || profile.id}</option>
                  ))}
                </select>
              </div>
            </div>
          ))
        )}
      </Panel>

      <Panel title="Worker Usage" subtitle="Journal-derived usage, policy, and cost evidence" testId="codex-opencode-worker-usage">
        {!usage ? (
          <p className="state-message">No worker usage loaded.</p>
        ) : (
          <>
            <div className="settings-row">
              <div className="settings-row-label">
                <strong>Totals</strong>
                <span className="settings-row-description">
                  {usage.summary.runs} runs · {usage.summary.tokens.toLocaleString()} tokens · ${usage.summary.cost.toFixed(2)} cost · {usage.summary.policyViolations} policy violations
                </span>
              </div>
            </div>
            {usage.byModel.slice(0, 8).map((model) => (
              <div className="settings-row" key={model.name}>
                <div className="settings-row-label">
                  <strong>{model.name}</strong>
                  <span className="settings-row-description">{model.count} runs</span>
                </div>
              </div>
            ))}
          </>
        )}
      </Panel>
    </>
  );
}

export default function CodexProviderPanel() {
  const state: CodexProviderState = useStoreValue(codexProviderStore);

  useEffect(() => {
    void codexProviderStore.load();
  }, []);

  useEffect(() => {
    if (state.activeSection === 'subagents' || state.activeSection === 'usage') {
      void codexProviderStore.loadSubagents();
    }
    if (state.activeSection === 'workers') {
      void codexProviderStore.loadOpenCodeWorkers();
    }
  }, [state.activeSection]);

  const status = state.status;
  const activeMode = status?.activeMode || 'native';
  const dsStatus = state.deepseekStatus;
  const bsStatus = state.bootstrapStatus;

  const [bridgePath, setBridgePath] = useState(dsStatus?.bridgePath || '');
  const [bridgeConfigPath, setBridgeConfigPath] = useState(dsStatus?.bridgeConfigPath || '');
  const [apiKey, setApiKey] = useState('');
  const [bridgeUrl, setBridgeUrl] = useState(dsStatus?.bridgeUrl || 'http://127.0.0.1:38440/v1');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [confirmFactoryReset, setConfirmFactoryReset] = useState(false);

  useEffect(() => {
    if (dsStatus?.bridgePath) setBridgePath(dsStatus.bridgePath);
    if (dsStatus?.bridgeConfigPath) setBridgeConfigPath(dsStatus.bridgeConfigPath);
    if (dsStatus?.bridgeUrl) setBridgeUrl(dsStatus.bridgeUrl);
  }, [dsStatus?.bridgePath, dsStatus?.bridgeConfigPath, dsStatus?.bridgeUrl]);

  useEffect(() => {
    if (!confirmFactoryReset) return;
    const timer = setTimeout(() => setConfirmFactoryReset(false), 4000);
    return () => clearTimeout(timer);
  }, [confirmFactoryReset]);

  const currentModeLabel = activeMode === 'deepseek-bridge' ? 'DeepSeek V4' : 'Native Codex';

  const isDeepseekActive = activeMode === 'deepseek-bridge';
  const bridgeBinaryReady = !!dsStatus?.bridgeBinaryAvailable || bsStatus?.built === true;
  const bridgeCheckoutReady = !!dsStatus?.bridgeCheckoutAvailable;
  const bridgeAvailable = bridgeBinaryReady || bridgeCheckoutReady;
  const keyReady = !!dsStatus?.keyConfigured;
  const bridgeReachable = !!dsStatus?.bridgeReachable;
  const prereqsMet = bridgeAvailable && keyReady && bridgeReachable;

  const bootstrapInstalled = bsStatus?.installed === true;
  const bootstrapBuilt = bsStatus?.built === true;
  const bootstrapPrereqsMet = bsStatus?.gitAvailable === true && bsStatus?.goAvailable === true;

  const handleBootstrap = () => {
    void codexProviderStore.bootstrap().then(() => {
      void codexProviderStore.fetchBootstrapStatus();
    });
  };

  return (
    <div className="settings-section">
      <div className="workspace-nav" role="tablist" aria-label="Codex settings sections" style={{ marginBottom: 12 }}>
        {[
          { id: 'overview', label: 'Overview' },
          { id: 'subagents', label: 'Subagents' },
          { id: 'workers', label: 'OpenCode Workers' },
          { id: 'usage', label: 'Subagent Usage' },
        ].map((tab) => (
          <button
            key={tab.id}
            role="tab"
            className={`opencode-tab${state.activeSection === tab.id ? ' opencode-tab-active' : ''}`}
            data-testid={`codex-tab-${tab.id}`}
            onClick={() => codexProviderStore.setActiveSection(tab.id as CodexProviderState['activeSection'])}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {state.activeSection === 'subagents' ? (
        <CodexSubagentsSection state={state} />
      ) : null}

      {state.activeSection === 'usage' ? (
        <CodexSubagentUsageSection usage={state.subagentUsage} />
      ) : null}

      {state.activeSection === 'workers' ? (
        <OpenCodeWorkersSection state={state} />
      ) : null}

      {state.activeSection === 'overview' ? (
        <>
      {/* ── Codex Configuration ── */}
      <Panel
        title="Codex Configuration"
        subtitle="Switch local Codex between native OpenAI defaults and DeepSeek V4 via Moon Bridge"
        testId="settings-codex-provider"
        actions={
          <>
            <Button
              variant={activeMode === 'native' ? 'primary' : 'secondary'}
              size="sm"
              testId="codex-provider-native"
              disabled={state.loading || state.saving}
              onClick={() => codexProviderStore.setMode('native')}
            >
              {state.saving && activeMode !== 'native' ? 'Saving…' : 'Native Codex'}
            </Button>
            <Button
              variant={isDeepseekActive ? 'primary' : 'secondary'}
              size="sm"
              testId="codex-provider-deepseek"
              disabled={state.loading || state.saving}
              onClick={() => codexProviderStore.setMode('deepseek-bridge')}
            >
              {state.saving && activeMode !== 'deepseek-bridge' ? 'Saving…' : 'DeepSeek V4'}
            </Button>
          </>
        }
      >
        <div className="settings-row">
          <div className="settings-row-label">
            <strong>Current local default</strong>
            <span className="settings-row-description">
              This updates the shared Codex home config used by local Codex clients.
            </span>
          </div>
          <div className="settings-row-action">
            <Badge tone={isDeepseekActive ? 'brand' : 'neutral'} testId="codex-provider-mode-badge">
              {currentModeLabel}
            </Badge>
          </div>
        </div>

        {status && (
          <div className="settings-row">
            <div className="settings-row-label">
              <span className="settings-row-description">
                Config: <code>{status.configPath}</code>
              </span>
            </div>
            <div className="settings-row-action">
              {status.hasBackup ? <Badge tone="brand" testId="codex-provider-backup-badge">Backup Ready</Badge> : null}
            </div>
          </div>
        )}

        {state.message ? (
          <p className="settings-row-description" data-testid="codex-provider-message">
            {state.message}
          </p>
        ) : null}

        {state.error ? (
          <p className="settings-row-error" data-testid="codex-provider-error">
            {state.error}
          </p>
        ) : null}

        <div className="settings-row">
          <div className="settings-row-label">
            <span className="settings-row-description">
              Existing open Codex windows may need a new thread or restart before provider changes are reflected.
            </span>
          </div>
        </div>
      </Panel>

      {/* ── Moon Bridge Setup ── */}
      <Panel title="Moon Bridge Setup" subtitle="Manage the DeepSeek Moon Bridge installation and configuration" testId="deepseek-bridge-setup">
        {/* Bootstrap Status */}
        <div className="settings-row" data-testid="deepseek-bootstrap-status">
          <div className="settings-row-label">
            <strong>Bootstrap</strong>
            <div className="settings-row-description" style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
              <span>
                <Badge tone={bootstrapPrereqsMet ? 'success' : 'danger'}>
                  Prerequisites{bootstrapPrereqsMet ? '' : ' missing'}
                </Badge>
                {bsStatus ? (
                  <span style={{ marginLeft: 8 }}>
                    Git: {bsStatus.gitAvailable ? '✓' : '✗'} · Go: {bsStatus.goAvailable ? '✓' : '✗'}
                  </span>
                ) : (
                  <span style={{ marginLeft: 8 }}>Loading…</span>
                )}
              </span>
              {bsStatus && (
                <>
                  <span>
                    <Badge tone={bootstrapInstalled ? 'success' : 'neutral'}>
                      {bootstrapInstalled ? 'Cloned' : 'Not cloned'}
                    </Badge>
                    {bootstrapInstalled && (
                      <code style={{ marginLeft: 8, fontSize: '0.72rem' }}>{bsStatus.installRoot}</code>
                    )}
                  </span>
                  <span>
                    <Badge tone={bootstrapBuilt ? 'success' : 'neutral'}>
                      {bootstrapBuilt ? 'Built' : 'Not built'}
                    </Badge>
                    {bootstrapBuilt && (
                      <code style={{ marginLeft: 8, fontSize: '0.72rem' }}>{bsStatus.binaryPath}</code>
                    )}
                  </span>
                  {bsStatus.lastBootstrapAt && (
                    <span style={{ fontSize: '0.75rem', color: 'var(--fg-muted, #666)' }}>
                      Last bootstrap: {new Date(bsStatus.lastBootstrapAt).toLocaleString()}
                    </span>
                  )}
                  {bsStatus.lastError && (
                    <span style={{ color: 'var(--color-danger-500, #c00)', fontSize: '0.75rem' }}>
                      {bsStatus.lastError}
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
          <div className="settings-row-action">
            <Button
              variant="primary"
              size="sm"
              testId="deepseek-bootstrap-install"
              disabled={state.bootstrapLoading || !bootstrapPrereqsMet}
              onClick={handleBootstrap}
            >
              {state.bootstrapLoading
                ? 'Installing…'
                : bootstrapBuilt
                  ? 'Rebuild Moon Bridge'
                  : 'Install Moon Bridge'}
            </Button>
          </div>
        </div>
      </Panel>

      {/* ── Advanced Configuration ── */}
      <Panel title="Advanced" subtitle="Manual bridge path, config, and URL overrides" testId="deepseek-advanced">
        <p className="settings-row-description" style={{ marginTop: 0 }}>
          Use only if the managed install cannot be used.
        </p>

        <div className="settings-row">
          <div className="settings-row-label">
            <strong>Moon Bridge Executable Path</strong>
            <span className="settings-row-description">
              Full path to the Moon Bridge binary or a checkout directory.
            </span>
          </div>
          <div className="settings-row-action" style={{ flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <input
              type="text"
              value={bridgePath}
              onChange={(e) => setBridgePath(e.target.value)}
              placeholder="C:\Users\...\moon-bridge.exe"
              style={inputStyle}
              data-testid="deepseek-bridge-path"
            />
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-row-label">
            <strong>Moon Bridge Config Path</strong>
            <span className="settings-row-description">
              Path to the Moon Bridge config.yml file.
            </span>
          </div>
          <div className="settings-row-action" style={{ flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <input
              type="text"
              value={bridgeConfigPath}
              onChange={(e) => setBridgeConfigPath(e.target.value)}
              placeholder="C:\Users\...\config.yml"
              style={inputStyle}
              data-testid="deepseek-bridge-config-path"
            />
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-row-label">
            <strong>Bridge URL</strong>
            <span className="settings-row-description">
              Moon Bridge loopback endpoint. Defaults to http://127.0.0.1:38440/v1.
            </span>
          </div>
          <div className="settings-row-action" style={{ flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <input
              type="text"
              value={bridgeUrl}
              onChange={(e) => setBridgeUrl(e.target.value)}
              placeholder="http://127.0.0.1:38440/v1"
              style={inputStyle}
              data-testid="deepseek-bridge-url"
            />
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-row-label">
            <strong>DeepSeek API Key</strong>
            <span className="settings-row-description">
              Saved to the Moon Bridge config only. Key is never returned by the API after saving.
            </span>
          </div>
          <div className="settings-row-action" style={{ flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              style={inputStyle}
              data-testid="deepseek-api-key"
            />
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-row-label">
            <strong>Save Settings</strong>
            <span className="settings-row-description">
              Saves bridge paths, URL, and API key (to Moon Bridge config only).
            </span>
          </div>
          <div className="settings-row-action">
            <Button
              variant="primary"
              size="sm"
              testId="deepseek-save-settings"
              disabled={state.saving}
              onClick={() => codexProviderStore.saveDeepseek({
                bridgePath: bridgePath || undefined,
                bridgeConfigPath: bridgeConfigPath || undefined,
                bridgeUrl: bridgeUrl || undefined,
                keyConfigured: apiKey.length > 0 ? true : undefined,
                apiKey: apiKey || undefined,
              })}
            >
              {state.saving ? 'Saving…' : 'Save Settings'}
            </Button>
          </div>
        </div>
      </Panel>

      {/* ── Bridge Control ── */}
      <Panel title="Bridge Control" subtitle="Start, stop, and check the Moon Bridge" testId="deepseek-bridge-control">
        <div className="settings-row">
          <div className="settings-row-action">
            <Button
              variant="secondary"
              size="sm"
              testId="deepseek-start-bridge"
              disabled={state.bridgeLoading}
              onClick={() => codexProviderStore.startBridge()}
            >
              {state.bridgeLoading ? '…' : 'Start Bridge'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              testId="deepseek-stop-bridge"
              disabled={state.bridgeLoading}
              onClick={() => codexProviderStore.stopBridge()}
            >
              Stop Bridge
            </Button>
            <Button
              variant="secondary"
              size="sm"
              testId="deepseek-check-status"
              disabled={state.bridgeLoading}
              onClick={() => codexProviderStore.checkBridge()}
            >
              Check Status
            </Button>
          </div>
        </div>

        {dsStatus && (
          <div className="settings-row" style={{ marginTop: 8 }}>
            <div className="settings-row-label">
              <span className="settings-row-description">
                Bridge path: {dsStatus.bridgePath
                  ? <Badge tone={bridgeBinaryReady ? 'success' : bridgeCheckoutReady ? 'brand' : 'danger'}>{bridgeBinaryReady ? 'Binary found' : bridgeCheckoutReady ? 'Needs build' : 'Missing'}</Badge>
                  : <Badge tone="neutral">Not set</Badge>}
              </span>
              <span className="settings-row-description">
                Key configured: <Badge tone={keyReady ? 'success' : 'neutral'}>{keyReady ? 'Yes' : 'No'}</Badge>
              </span>
              <span className="settings-row-description">
                Bridge running: <Badge tone={dsStatus.bridgeRunning ? 'success' : 'neutral'}>{dsStatus.bridgeRunning ? 'Running' : 'Stopped'}</Badge>
              </span>
              <span className="settings-row-description">
                Bridge reachable: <Badge tone={bridgeReachable ? 'success' : 'danger'}>{bridgeReachable ? 'Yes' : 'No'}</Badge>
              </span>
              <span className="settings-row-description">
                Models visible: <Badge tone={dsStatus.modelsVisible ? 'success' : 'danger'}>{dsStatus.modelsVisible ? 'Yes' : 'No'}</Badge>
              </span>
              {dsStatus.probeError ? (
                <span className="settings-row-description" style={{ color: 'var(--danger-color, #c00)' }}>
                  {dsStatus.probeError}
                </span>
              ) : null}
            </div>
          </div>
        )}

        {!isDeepseekActive && (
          <div className="settings-row" style={{ marginTop: 8 }}>
            <div className="settings-row-label">
              <strong>Prerequisites</strong>
              <span className="settings-row-description">
                {bridgeAvailable ? '\u2705' : '\u274C'} Moon Bridge binary or checkout available
              </span>
              <span className="settings-row-description">
                {keyReady ? '\u2705' : '\u274C'} DeepSeek API key configured
              </span>
              <span className="settings-row-description">
                {bridgeReachable ? '\u2705' : '\u274C'} Bridge endpoint reachable
              </span>
              {!prereqsMet && (
                <span className="settings-row-description">
                  Save settings, start the bridge, and ensure it is reachable before activating.
                </span>
              )}
            </div>
            <div className="settings-row-action">
              <Button
                variant="primary"
                size="sm"
                testId="deepseek-activate"
                disabled={state.saving || !prereqsMet}
                onClick={() => codexProviderStore.setMode('deepseek-bridge')}
              >
                {state.saving ? 'Activating…' : 'Activate DeepSeek in Codex'}
              </Button>
            </div>
          </div>
        )}
        {isDeepseekActive && (
          <div className="settings-row" style={{ marginTop: 8 }}>
            <div className="settings-row-label">
              <span className="settings-row-description" style={{ color: 'var(--color-info-500, #2563eb)', fontSize: '0.8rem' }}>
                DeepSeek is configured as Codex&apos;s active model. Codex Desktop may show it as Custom until its model picker displays local catalog models.
              </span>
            </div>
          </div>
        )}
      </Panel>

      {/* ── Recovery ── */}
      <Panel title="Recovery" subtitle="Reset Codex config, restore Moon Bridge, or reinstall components" testId="codex-provider-recovery">
        <div className="settings-row">
          <div className="settings-row-label">
            <strong>Provider Reset</strong>
            <span className="settings-row-description">
              Soft reset removes only Elegy-managed Codex provider settings from the config. Hard restore writes back the pre-Elegy backup snapshot.
            </span>
          </div>
          <div className="settings-row-action">
            <Button
              variant="secondary"
              size="sm"
              testId="codex-provider-soft-reset"
              disabled={state.loading || state.saving}
              onClick={() => codexProviderStore.reset(false)}
            >
              Soft Reset
            </Button>
            <Button
              variant="ghost"
              size="sm"
              testId="codex-provider-hard-reset"
              disabled={state.loading || state.saving || !status?.hasBackup}
              onClick={() => codexProviderStore.reset(true)}
            >
              Hard Restore
            </Button>
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-row-label">
            <strong>Factory Reset</strong>
            <span className="settings-row-description">
              Removes ALL Elegy-managed Codex settings, state files, and config backups.
              Codex will return to its native OpenAI defaults. A timestamped backup is saved before reset.
            </span>
          </div>
          <div className="settings-row-action">
            <Button
              variant="danger"
              size="sm"
              testId="codex-provider-factory-reset"
              disabled={state.loading || state.saving}
              onClick={() => {
                if (confirmFactoryReset) {
                  setConfirmFactoryReset(false);
                  codexProviderStore.factoryReset();
                } else {
                  setConfirmFactoryReset(true);
                }
              }}
            >
              {state.saving && confirmFactoryReset ? 'Resetting…'
                : confirmFactoryReset ? 'Confirm Factory Reset?'
                : 'Factory Reset'}
            </Button>
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-row-label">
            <strong>Reinstall Codex Surface</strong>
            <span className="settings-row-description">
              Re-runs the Codex installer to sync agents, skills, and prompts. Switches to native mode afterward.
            </span>
          </div>
          <div className="settings-row-action">
            <Button
              variant="secondary"
              size="sm"
              testId="codex-provider-reinstall-surface"
              disabled={state.loading || state.saving}
              onClick={() => codexProviderStore.reinstallSurface()}
            >
              {state.saving ? 'Reinstalling…' : 'Reinstall Codex Surface'}
            </Button>
          </div>
        </div>
      </Panel>

      {/* ── Codex CLI Installation ── */}
      <Panel title="Codex CLI" subtitle="Install the Codex CLI globally via npm" testId="codex-cli-section">
        <div className="settings-row" data-testid="codex-cli-status">
          <div className="settings-row-label">
            <div className="settings-row-description" style={{ marginTop: 4 }}>
              {state.cliStatus?.installed ? (
                <span>
                  <Badge tone="success">Installed</Badge>
                  {state.cliStatus.version ? (
                    <code style={{ marginLeft: 8, fontSize: '0.72rem' }}>{state.cliStatus.version}</code>
                  ) : null}
                </span>
              ) : (
                <span>
                  <Badge tone="neutral">Not installed</Badge>
                  <span style={{ marginLeft: 8 }}>
                    Install the Codex CLI globally via npm to use Codex outside the dashboard.
                  </span>
                </span>
              )}
              {state.cliStatus?.lastError ? (
                <span style={{ color: 'var(--danger-color, #c00)', fontSize: '0.75rem', display: 'block', marginTop: 4 }}>
                  {state.cliStatus.lastError}
                </span>
              ) : null}
            </div>
          </div>
          <div className="settings-row-action">
            {!state.cliStatus?.installed ? (
              <Button
                variant="secondary"
                size="sm"
                testId="codex-cli-install"
                disabled={state.installingCli}
                onClick={() => codexProviderStore.installCodexCli()}
              >
                {state.installingCli ? 'Installing…' : 'Install Codex CLI'}
              </Button>
            ) : (
              <Badge tone="success" testId="codex-cli-installed-badge">Installed</Badge>
            )}
          </div>
        </div>
      </Panel>

      {/* ── Elegy Planning Skill ── */}
      <Panel title="Elegy Planning" subtitle="Enable durable planning for Codex sessions" testId="codex-planning-section">
        <div className="settings-row" data-testid="codex-planning-status">
          <div className="settings-row-label">
            <div className="settings-row-description" style={{ marginTop: 4 }}>
              {state.planningStatus?.planningSkill?.installed ? (
                <span>
                  <Badge tone="success">Installed</Badge>
                  <span style={{ marginLeft: 8, fontSize: '0.75rem', color: 'var(--tertiary-text-color, #666)' }}>
                    {state.planningStatus.planningSkill.skillDir}
                  </span>
                </span>
              ) : (
                <span>
                  <Badge tone="neutral">Not installed</Badge>
                  <span style={{ marginLeft: 8 }}>
                    Enable durable planning (goals, roadmaps, work points) for Codex sessions.
                  </span>
                </span>
              )}
              {state.planningStatus?.ready ? (
                <span style={{ display: 'block', marginTop: 4, fontSize: '0.75rem', color: 'var(--success-color, #0a0)' }}>
                  Ready — skill installed and CLI available.
                </span>
              ) : state.planningStatus?.planningSkill?.installed && !state.planningStatus?.ready ? (
                <span style={{ display: 'block', marginTop: 4, fontSize: '0.75rem', color: 'var(--warning-color, #c90)' }}>
                  Skill installed but CLI not detected. Run the installer to complete setup.
                </span>
              ) : null}
            </div>
          </div>
          <div className="settings-row-action">
            {!state.planningStatus?.planningSkill?.installed ? (
              <Button
                variant="secondary"
                size="sm"
                testId="codex-planning-install"
                disabled={state.installingPlanning}
                onClick={() => codexProviderStore.installPlanning()}
              >
                {state.installingPlanning ? 'Installing…' : 'Install Planning Skill'}
              </Button>
            ) : (
              <Badge tone="success" testId="codex-planning-installed-badge">Installed</Badge>
            )}
          </div>
        </div>
      </Panel>
        </>
      ) : null}
    </div>
  );
}
