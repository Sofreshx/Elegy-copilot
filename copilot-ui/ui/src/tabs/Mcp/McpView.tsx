import { MouseEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Button, CopyButton, FormInput, PageContainer, Panel, StatusBadge, Toolbar } from '../../components';
import {
  addLocalRepoMcpRoot,
  approveLocalRepoMcpAuthorization,
  cancelLocalRepoMcpDiagnosticRepair,
  cancelLocalRepoMcpManagedProvisioning,
  confirmLocalRepoMcpDiagnosticRepair,
  confirmLocalRepoMcpManagedProvisioning,
  exportLocalRepoMcpDiagnostics,
  getCatalogRepos,
  getLocalRepoMcpCloudflareLoginStatus,
  getLocalRepoMcpConfig,
  getLocalRepoMcpPendingAuthorizations,
  getLocalRepoMcpStatus,
  probeLocalRepoMcp,
  previewLocalRepoMcpDiagnosticRepair,
  previewLocalRepoMcpManagedProvisioning,
  registerCatalogRepo,
  removeLocalRepoMcpRoot,
  saveLocalRepoMcpConfig,
  runLocalRepoMcpDiagnostics,
  startLocalRepoMcpCloudflareLogin,
  startLocalRepoMcpQuickTunnel,
  startLocalRepoMcpTunnel,
  stopLocalRepoMcp,
  stopLocalRepoMcpTunnel,
  validateLocalRepoMcpStableTunnel,
  type LocalRepoMcpConfig,
  type LocalRepoMcpCloudflareLoginResponse,
  type LocalRepoMcpDiagnosticReport,
  type LocalRepoMcpPendingAuthorization,
  type LocalRepoMcpProvisioningPreview,
  type LocalRepoMcpRepairPreview,
  type LocalRepoMcpStatusResponse,
} from '../../lib/api';
import type { CatalogRepoInventoryEntry, LocalRepoReaderAccessState } from '../../lib/types';

const EMPTY_CONFIG: LocalRepoMcpConfig = {
  port: 3333,
  authProvider: 'builtin',
  publicBaseUrl: '',
  authIssuer: '',
  authAudience: '',
  requiredScopes: ['repo:read'],
  cloudflareTunnelName: '',
  cloudflareConfigPath: '',
  cloudflaredPath: '',
};

interface McpProviderDescriptor {
  id: string;
  label: string;
  description: string;
  kind: string;
  status: string;
  connectorUrl: string;
  capabilities: string[];
}

function providerUrlMessage(serverRunning: boolean): string {
  if (!serverRunning) return 'Start to generate a ChatGPT Server URL.';
  return 'Local server is running. Start again to publish a ChatGPT Server URL.';
}

function statusTone(status: string): 'neutral' | 'brand' | 'accent' | 'success' | 'danger' {
  if (status === 'ChatGPT ready') return 'success';
  if (status === 'OAuth protected') return 'success';
  if (status === 'Local only') return 'accent';
  if (status === 'Misconfigured' || status === 'Error') return 'danger';
  if (status === 'Stopped') return 'neutral';
  return 'brand';
}

export default function McpView() {
  const [status, setStatus] = useState<LocalRepoMcpStatusResponse | null>(null);
  const [config, setConfig] = useState<LocalRepoMcpConfig>(EMPTY_CONFIG);
  const [access, setAccess] = useState<LocalRepoReaderAccessState | null>(null);
  const [repos, setRepos] = useState<CatalogRepoInventoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [pendingErrorCode, setPendingErrorCode] = useState<string | null>(null);
  const [pendingAuthorizations, setPendingAuthorizations] = useState<LocalRepoMcpPendingAuthorization[]>([]);
  const [configuringProviderId, setConfiguringProviderId] = useState<string | null>(null);
  const [diagnosticReport, setDiagnosticReport] = useState<LocalRepoMcpDiagnosticReport | null>(null);
  const [repairPreview, setRepairPreview] = useState<LocalRepoMcpRepairPreview | null>(null);
  const [cloudflareLoginState, setCloudflareLoginState] = useState<LocalRepoMcpCloudflareLoginResponse['cloudflareLogin'] | null>(null);

  async function loadPendingAuthorizations() {
    try {
      const pendingResult = await getLocalRepoMcpPendingAuthorizations();
      const pendingStoppedNormally = pendingResult.pendingError && !pendingResult.server.running && !pendingResult.tunnel.running;
      setPendingError(pendingStoppedNormally ? null : pendingResult.pendingError || null);
      setPendingErrorCode(pendingStoppedNormally ? null : pendingResult.pendingErrorCode || null);
      setPendingAuthorizations(pendingResult.pending || []);
    } catch (err) {
      setPendingError(err instanceof Error ? err.message : String(err));
      setPendingErrorCode(null);
      setPendingAuthorizations([]);
    }
  }

  async function load() {
    setError(null);
    try {
      const [statusResult, configResult, reposResult, cloudflareLoginResult] = await Promise.all([
        getLocalRepoMcpStatus(),
        getLocalRepoMcpConfig(),
        getCatalogRepos(),
        getLocalRepoMcpCloudflareLoginStatus().catch(() => null),
      ]);
      const nextConfig = { ...EMPTY_CONFIG, ...configResult.config };
      setStatus(statusResult);
      setConfig(nextConfig);
      setAccess(configResult.access);
      setRepos(reposResult.repos.filter((repo) => repo.repoPath));
      setCloudflareLoginState(cloudflareLoginResult?.cloudflareLogin || null);
      if (statusResult.securityState === 'OAuth protected') {
        void loadPendingAuthorizations();
      } else {
        setPendingError(null);
        setPendingErrorCode(null);
        setPendingAuthorizations([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!status?.server.running || status.securityState !== 'OAuth protected' || (config.authProvider || 'builtin') !== 'builtin') return undefined;
    const timer = window.setInterval(() => {
      void loadPendingAuthorizations();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [status?.server.running, status?.securityState, config.authProvider]);

  async function mutate(action: () => Promise<unknown>) {
    setMutating(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setMutating(false);
    }
  }

  const enabledRootCount = access?.repos?.length || 0;
  const localMcpEndpoint = status?.server.url || `http://127.0.0.1:${config.port}/mcp`;
  const chatGptUrl = status?.chatGptAccess?.url || '';
  const chatGptReady = Boolean(status?.chatGptAccess?.mode === 'quick' && status.chatGptAccess.ready && chatGptUrl);
  const stableConfigured = Boolean(config.stableTunnel?.configured || (config.publicBaseUrl && config.cloudflareTunnelName));
  const stableUrl = stableConfigured
    ? config.stableTunnel?.canonicalResource || (config.publicBaseUrl ? `${config.publicBaseUrl.replace(/\/+$/, '')}/mcp` : '')
    : '';
  const stableOnline = status?.chatGptAccess?.mode === 'stable' && Boolean(status.chatGptAccess.online);
  const stableReady = stableOnline && status?.chatGptAccess?.lifecycleState === 'oauth_ready';
  const cloudflaredMissing = Boolean(status?.prerequisites?.cloudflared && !status.prerequisites.cloudflared.available);
  const securityState = error ? 'Error' : status?.securityState || 'Stopped';
  const startChatGptDisabled = mutating || chatGptReady || cloudflaredMissing;
  const pendingApprovalSecretMismatch = Boolean(pendingError && pendingErrorCode === 'approval_secret_mismatch');
  const probeStatus = status?.probe ? (status.probe.ok ? 'ok' : `failed ${status.probe.status || status.probe.code || ''}`) : 'not run';

  async function startChatGptAccess() {
    await startLocalRepoMcpQuickTunnel();
  }

  async function runStableDiagnostics() {
    const report = await runLocalRepoMcpDiagnostics();
    setDiagnosticReport(report);
    setRepairPreview(null);
  }

  async function previewStableRepair(repairId: string) {
    setRepairPreview(await previewLocalRepoMcpDiagnosticRepair(repairId));
  }

  async function confirmStableRepair() {
    if (!repairPreview) return;
    await confirmLocalRepoMcpDiagnosticRepair(repairPreview.previewId);
    setRepairPreview(null);
    setDiagnosticReport(await runLocalRepoMcpDiagnostics());
  }

  async function cancelStableRepair() {
    if (!repairPreview) return;
    await cancelLocalRepoMcpDiagnosticRepair(repairPreview.previewId);
    setRepairPreview(null);
  }

  async function downloadDiagnosticExport() {
    const exported = await exportLocalRepoMcpDiagnostics();
    const blob = new Blob([`${JSON.stringify(exported, null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `elegy-local-repo-mcp-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const provider = useMemo<McpProviderDescriptor>(() => ({
    id: 'local-repo-reader',
    label: 'Local Repo Reader',
    description: 'Read-only MCP for selected local repositories and folders.',
    kind: 'Folder/File Read',
    status: securityState,
    connectorUrl: chatGptUrl || (status?.server.running ? localMcpEndpoint : ''),
    capabilities: ['repo_roots', 'repo_tree', 'repo_read_file', 'repo_search', 'repo_git_status', 'repo_git_log'],
  }), [chatGptUrl, localMcpEndpoint, securityState, status?.server.running]);

  const configuredModalOpen = configuringProviderId === provider.id;

  return (
    <div className="view-shell mcp-view" data-testid="mcp-view">
      <div className="view-static">
        <Toolbar testId="mcp-toolbar"><h2>MCP</h2></Toolbar>
      </div>

      <div className="view-scroll">
        <PageContainer>
          {error ? <p className="opencode-error" data-testid="mcp-error">{error}</p> : null}

          <Panel title="Local MCP Access" subtitle="Current local repository reader state" testId="mcp-overall-status">
            <div className="mcp-status-grid">
              <div className="opencode-readiness-card">
                <span className="opencode-readiness-label">Exposure</span>
                <StatusBadge status={securityState} tone={statusTone(securityState)} testId="mcp-exposure-status" />
              </div>
              <div className="opencode-readiness-card">
                <span className="opencode-readiness-label">Providers</span>
                <StatusBadge status="1 configured" testId="mcp-provider-count" />
              </div>
              <div className="opencode-readiness-card">
                <span className="opencode-readiness-label">Readable Roots</span>
                <StatusBadge status={`${enabledRootCount} enabled`} testId="mcp-readable-root-count" />
              </div>
              <div className="opencode-readiness-card">
                <span className="opencode-readiness-label">Connector URL</span>
                <StatusBadge status={chatGptReady ? 'ready' : 'missing'} testId="mcp-connector-status" />
              </div>
            </div>
          </Panel>

          <Panel title="MCP Providers" subtitle="Start local file access for ChatGPT web" testId="mcp-providers">
            {loading ? (
              <p className="opencode-loading">Loading MCP providers...</p>
            ) : provider ? (
              <div className="mcp-provider-grid">
                <article className="assets-tools-item-card mcp-provider-card" data-testid="mcp-provider-local-repo-reader">
                  <div className="assets-tools-item-header">
                    <div>
                      <h3>{provider.label}</h3>
                      <p className="assets-tools-item-description">{provider.description}</p>
                    </div>
                    <StatusBadge status={provider.status} tone={statusTone(provider.status)} testId="mcp-provider-status" />
                  </div>

                  <div className="mcp-provider-capabilities" aria-label="Local Repo Reader tools">
                    {provider.capabilities.map((capability) => (
                      <StatusBadge key={capability} status={capability} testId="mcp-provider-capability" />
                    ))}
                  </div>

                  <div className="catalog-inline-note mcp-provider-url">
                    {chatGptReady ? chatGptUrl : providerUrlMessage(Boolean(status?.server.running))}
                    {chatGptReady ? <CopyButton text={chatGptUrl} testId="mcp-provider-copy-url" /> : null}
                  </div>

                  <div className="mcp-chatgpt-setup" data-testid="mcp-chatgpt-setup">
                    <div className="mcp-chatgpt-setup-header">
                      <div>
                        <h4>ChatGPT Web Access</h4>
                        <p className="assets-tools-item-description">Creates a temporary HTTPS MCP URL with Authentication set to None.</p>
                      </div>
                      <StatusBadge
                        status={chatGptReady ? 'ready for ChatGPT' : cloudflaredMissing ? 'cloudflared missing' : mutating ? 'starting' : 'ready to start'}
                        tone={chatGptReady ? 'success' : cloudflaredMissing ? 'danger' : 'accent'}
                        testId="mcp-chatgpt-readiness"
                      />
                    </div>
                    {pendingError ? (
                      <p className="catalog-inline-note" data-testid="mcp-pending-warning">
                        {pendingApprovalSecretMismatch
                          ? 'Approval channel is out of sync from a previous tunneled session. Restart the local server before using local MCP clients.'
                          : `Pending approval check unavailable: ${pendingError}`}
                      </p>
                    ) : null}
                    {status?.server.notice ? (
                      <p className="catalog-inline-note" data-testid="mcp-server-notice">{status.server.notice}</p>
                    ) : null}
                    {status?.probe && !status.probe.ok ? (
                      <p className="catalog-inline-note" data-testid="mcp-probe-warning">
                        ChatGPT readiness probe failed: {status.probe.message || status.probe.code || status.probe.status}
                      </p>
                    ) : null}
                    {cloudflaredMissing ? (
                      <p className="catalog-inline-note" data-testid="mcp-cloudflared-blocker">
                        cloudflared is required for ChatGPT access. Install it on PATH or set the path in Advanced Config.
                      </p>
                    ) : null}
                    {chatGptReady ? (
                      <div className="catalog-inline-note mcp-provider-url">
                        {chatGptUrl}
                        <CopyButton text={chatGptUrl} testId="mcp-chatgpt-copy-url" />
                      </div>
                    ) : null}
                    <p className="catalog-inline-note" data-testid="mcp-temporary-url-note">
                      This quick tunnel URL is temporary. If you stop or restart access, create or reconnect the ChatGPT app with the new URL.
                    </p>
                    <details className="catalog-inline-note" data-testid="mcp-diagnostics">
                      <summary>Diagnostics</summary>
                      <div className="mcp-provider-meta">
                        <span><strong>Kind</strong>{provider.kind}</span>
                        <span><strong>Server</strong>{status?.server.running ? 'running' : 'stopped'}</span>
                        <span><strong>Tunnel</strong>{status?.tunnel.running ? status.tunnel.mode || 'running' : 'stopped'}</span>
                        <span><strong>Authentication</strong>None</span>
                        <span><strong>Roots</strong>{enabledRootCount}</span>
                        <span><strong>Probe</strong>{probeStatus}</span>
                      </div>
                    </details>
                    <div className="opencode-model-actions">
                      <Button
                        size="sm"
                        disabled={startChatGptDisabled}
                        loading={mutating}
                        loadingLabel="Starting..."
                        onClick={() => void mutate(startChatGptAccess)}
                        testId="mcp-quick-tunnel-start"
                      >
                        Start
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={mutating || (!status?.server.running && !status?.tunnel.running)}
                        onClick={() => void mutate(async () => { await stopLocalRepoMcpTunnel(); await stopLocalRepoMcp(); })}
                        testId="mcp-chatgpt-stop"
                      >
                        Stop
                      </Button>
                      <Button size="sm" variant="secondary" disabled={mutating} onClick={() => setConfiguringProviderId(provider.id)} testId="mcp-configure">Configure</Button>
                    </div>
                  </div>
                  <div className="mcp-chatgpt-setup" data-testid="mcp-persistent-access">
                    <div className="mcp-chatgpt-setup-header">
                      <div>
                        <h4>Persistent OAuth Tunnel <StatusBadge status="experimental" tone="accent" /></h4>
                        <p className="assets-tools-item-description">Uses your Cloudflare named tunnel and a stable OAuth-protected endpoint.</p>
                      </div>
                      <StatusBadge
                        status={stableReady ? 'ChatGPT ready' : stableOnline ? 'online — OAuth unverified' : stableConfigured ? 'configured — offline' : 'not configured'}
                        tone={stableReady ? 'success' : stableOnline ? 'accent' : 'neutral'}
                        testId="mcp-stable-readiness"
                      />
                    </div>
                    {stableUrl ? (
                      <div className="catalog-inline-note mcp-provider-url">
                        {stableUrl}
                        <CopyButton text={stableUrl} testId="mcp-stable-copy-url" />
                      </div>
                    ) : null}
                    <p className="catalog-inline-note">
                      {stableReady
                        ? 'Full OAuth authorization, refresh rotation, revocation, and authenticated MCP access passed.'
                        : 'Stable mode is not marked ChatGPT-ready until a complete OAuth authorization probe succeeds.'}
                    </p>
                    {pendingAuthorizations.length > 0 ? (
                      <div data-testid="mcp-pending-authorizations">
                        <h5>OAuth approval required</h5>
                        {pendingAuthorizations.map((pending) => (
                          <div className="catalog-inline-note" key={pending.id} data-testid="mcp-pending-authorization">
                            <div className="mcp-provider-meta">
                              <span><strong>Approval code</strong>{pending.userCode}</span>
                              <span><strong>Client</strong>{pending.clientId}</span>
                              <span><strong>Scopes</strong>{pending.scope}</span>
                              <span><strong>Resource</strong>{pending.resource}</span>
                            </div>
                            <Button
                              size="sm"
                              disabled={mutating}
                              onClick={() => void mutate(() => approveLocalRepoMcpAuthorization(pending.id))}
                              testId={`mcp-approve-${pending.id}`}
                            >
                              Approve
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {stableReady ? (
                      <details className="catalog-inline-note" data-testid="mcp-chatgpt-registration">
                        <summary>Register in ChatGPT</summary>
                        <ol>
                          <li>Create a custom MCP app using the endpoint above.</li>
                          <li>Select OAuth authentication.</li>
                          <li>Complete the approval request shown here.</li>
                          <li>Future restarts reuse the same endpoint.</li>
                        </ol>
                      </details>
                    ) : null}
                    {status?.tunnel.lastExit || status?.tunnel.output?.stderr ? (
                      <details className="catalog-inline-note" data-testid="mcp-stable-diagnostics">
                        <summary>Persistent tunnel diagnostics</summary>
                        <pre>{status.tunnel.output?.stderr || status.tunnel.output?.stdout || JSON.stringify(status.tunnel.lastExit, null, 2)}</pre>
                      </details>
                    ) : null}
                    {status?.lifecycle?.message && (stableConfigured || status.lifecycle.code !== 'autostart_disabled') ? (
                      <p className="catalog-inline-note" data-testid="mcp-stable-lifecycle">
                        {status.lifecycle.message}
                      </p>
                    ) : null}
                    {diagnosticReport ? (
                      <section className="mcp-diagnostic-report" data-testid="mcp-diagnostic-report" aria-label="Persistent tunnel diagnostic report">
                        <div className="mcp-diagnostic-report-header">
                          <h5>Connection diagnostics</h5>
                          <StatusBadge
                            status={diagnosticReport.overall === 'pass' ? 'all checks passed' : 'attention required'}
                            tone={diagnosticReport.overall === 'pass' ? 'success' : 'danger'}
                          />
                        </div>
                        <div className="mcp-diagnostic-checks">
                          {diagnosticReport.checks.map((check) => (
                            <div className="mcp-diagnostic-check" key={check.id}>
                              <StatusBadge
                                status={check.status}
                                tone={check.status === 'pass' ? 'success' : 'danger'}
                              />
                              <div>
                                <strong>{check.layer.replace(/_/g, ' ')}</strong>
                                <code>{check.code}</code>
                                <p>{check.message}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                        {diagnosticReport.repairs.length > 0 ? (
                          <div className="mcp-repair-options">
                            <h5>Safe repairs</h5>
                            {diagnosticReport.repairs.map((repair) => (
                              <div className="mcp-repair-option" key={repair.id}>
                                <div>
                                  <strong>{repair.label}</strong>
                                  {repair.description ? <p>{repair.description}</p> : null}
                                </div>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  disabled={mutating || Boolean(repairPreview)}
                                  onClick={() => void mutate(() => previewStableRepair(repair.id))}
                                  testId={`mcp-repair-preview-${repair.id}`}
                                >
                                  Preview
                                </Button>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </section>
                    ) : null}
                    {repairPreview ? (
                      <section className="mcp-repair-preview" data-testid="mcp-repair-preview">
                        <h5>Review repair operations</h5>
                        {repairPreview.operations.map((operation, index) => (
                          <div className="catalog-inline-note" key={`${operation.kind}-${index}`}>
                            <strong>{operation.kind.replace(/-/g, ' ')}</strong>
                            {operation.command ? <code>{[operation.command, ...(operation.args || [])].join(' ')}</code> : null}
                            <p>{operation.effect}</p>
                          </div>
                        ))}
                        <div className="opencode-model-actions">
                          <Button size="sm" disabled={mutating} onClick={() => void mutate(confirmStableRepair)} testId="mcp-repair-confirm">
                            Confirm Repair
                          </Button>
                          <Button size="sm" variant="secondary" disabled={mutating} onClick={() => void mutate(cancelStableRepair)} testId="mcp-repair-cancel">
                            Cancel
                          </Button>
                        </div>
                      </section>
                    ) : null}
                    <div className="opencode-model-actions">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={mutating || !stableConfigured}
                        onClick={() => void mutate(runStableDiagnostics)}
                        testId="mcp-stable-diagnostics-run"
                      >
                        Run Diagnostics
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={mutating || !diagnosticReport}
                        onClick={() => void mutate(downloadDiagnosticExport)}
                        testId="mcp-stable-diagnostics-export"
                      >
                        Export Redacted Report
                      </Button>
                      <Button
                        size="sm"
                        disabled={mutating || !stableConfigured}
                        onClick={() => void mutate(validateLocalRepoMcpStableTunnel)}
                        testId="mcp-stable-validate"
                      >
                        Validate Configuration
                      </Button>
                      <Button
                        size="sm"
                        disabled={mutating || !stableConfigured || stableOnline}
                        onClick={() => void mutate(startLocalRepoMcpTunnel)}
                        testId="mcp-stable-start"
                      >
                        Start Persistent Access
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={mutating || !stableOnline}
                        onClick={() => void mutate(probeLocalRepoMcp)}
                        testId="mcp-stable-test"
                      >
                        Test OAuth Connection
                      </Button>
                      <Button size="sm" variant="secondary" disabled={mutating} onClick={() => setConfiguringProviderId(provider.id)} testId="mcp-stable-configure">
                        {stableConfigured ? 'Edit Configuration' : 'Set Up Persistent Access'}
                      </Button>
                    </div>
                  </div>
                </article>
              </div>
            ) : (
              <p className="assets-tools-empty">No MCP providers configured.</p>
            )}
          </Panel>
        </PageContainer>
      </div>

      {configuredModalOpen ? (
        <LocalRepoReaderConfigModal
          access={access}
          config={config}
          initialCloudflareLogin={cloudflareLoginState}
          loading={loading}
          mutating={mutating}
          repos={repos}
          status={status}
          onClose={() => setConfiguringProviderId(null)}
          onMutate={mutate}
        />
      ) : null}
    </div>
  );
}

function LocalRepoReaderConfigModal({
  access,
  config,
  initialCloudflareLogin,
  loading,
  mutating,
  repos,
  status,
  onClose,
  onMutate,
}: {
  access: LocalRepoReaderAccessState | null;
  config: LocalRepoMcpConfig;
  initialCloudflareLogin: LocalRepoMcpCloudflareLoginResponse['cloudflareLogin'] | null;
  loading: boolean;
  mutating: boolean;
  repos: CatalogRepoInventoryEntry[];
  status: LocalRepoMcpStatusResponse | null;
  onClose: () => void;
  onMutate: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [repoPathInput, setRepoPathInput] = useState('');
  const [repoLabelInput, setRepoLabelInput] = useState('');
  const [cloudflaredPathInput, setCloudflaredPathInput] = useState(config.cloudflaredPath || '');
  const [publicOriginInput, setPublicOriginInput] = useState(config.stableTunnel?.publicOrigin || config.publicBaseUrl || '');
  const [tunnelNameInput, setTunnelNameInput] = useState(config.stableTunnel?.cloudflareTunnelName || config.cloudflareTunnelName || '');
  const [tunnelIdInput, setTunnelIdInput] = useState(config.stableTunnel?.cloudflareTunnelId || '');
  const [tunnelConfigPathInput, setTunnelConfigPathInput] = useState(config.stableTunnel?.cloudflareConfigPath || config.cloudflareConfigPath || '');
  const [tunnelCredentialsPathInput, setTunnelCredentialsPathInput] = useState(config.stableTunnel?.cloudflareCredentialsPath || '');
  const [managedZoneInput, setManagedZoneInput] = useState('');
  const [cloudflareLogin, setCloudflareLogin] = useState<LocalRepoMcpCloudflareLoginResponse['cloudflareLogin'] | null>(initialCloudflareLogin);
  const [provisioningPreview, setProvisioningPreview] = useState<LocalRepoMcpProvisioningPreview | null>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousActive = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      previousActive?.focus?.();
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      if (e.key !== 'Tab' || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    setCloudflaredPathInput(config.cloudflaredPath || '');
  }, [config.cloudflaredPath]);

  const enabledPaths = useMemo(
    () => new Set((access?.repos || []).map((repo) => repo.root.toLowerCase())),
    [access],
  );
  const localEndpoint = status?.server.url || `http://127.0.0.1:${config.port}/mcp`;

  async function registerAndEnableRepo(repo: CatalogRepoInventoryEntry) {
    const registeredRepo = repo.registered
      ? repo
      : (await registerCatalogRepo({
        repoId: repo.repoId || undefined,
        repoPath: repo.repoPath || undefined,
        repoLabel: repo.repoLabel || undefined,
      })).repo || repo;
    await addLocalRepoMcpRoot({
      repoId: registeredRepo.repoId || repo.repoId,
      repoPath: registeredRepo.repoPath || repo.repoPath,
    });
  }

  async function registerPathAndEnable() {
    const repoPath = repoPathInput.trim();
    if (!repoPath) {
      throw new Error('Repository path is required');
    }
    const result = await registerCatalogRepo({
      repoPath,
      repoLabel: repoLabelInput.trim() || undefined,
    });
    await addLocalRepoMcpRoot({
      repoId: result.repo?.repoId,
      repoPath: result.repo?.repoPath || repoPath,
    });
    setRepoPathInput('');
    setRepoLabelInput('');
  }

  async function saveCloudflaredPath() {
    await saveLocalRepoMcpConfig({ cloudflaredPath: cloudflaredPathInput.trim() });
  }

  async function beginCloudflareLogin() {
    const result = await startLocalRepoMcpCloudflareLogin();
    setCloudflareLogin(result.cloudflareLogin);
  }

  async function previewManagedSetup() {
    setProvisioningPreview(await previewLocalRepoMcpManagedProvisioning(managedZoneInput.trim()));
  }

  async function confirmManagedSetup() {
    if (!provisioningPreview) return;
    await confirmLocalRepoMcpManagedProvisioning(provisioningPreview.previewId);
    setProvisioningPreview(null);
  }

  async function cancelManagedSetup() {
    if (!provisioningPreview) return;
    await cancelLocalRepoMcpManagedProvisioning(provisioningPreview.previewId);
    setProvisioningPreview(null);
  }

  async function setStableAutoStart(enabled: boolean) {
    await saveLocalRepoMcpConfig({
      stableTunnel: {
        ...(config.stableTunnel || {
          configured: false,
          publicOrigin: '',
          canonicalResource: '',
          hostname: '',
          cloudflareTunnelName: '',
          cloudflareTunnelId: '',
          cloudflareConfigPath: '',
          cloudflareCredentialsPath: '',
          cloudflaredPath: '',
          managementMode: 'managed',
          setupVersion: 0,
          autoStart: false,
        }),
        autoStart: enabled,
      },
    });
  }

  async function saveStableConfiguration() {
    const publicOrigin = publicOriginInput.trim().replace(/\/+$/, '');
    const cloudflareTunnelName = tunnelNameInput.trim();
    await saveLocalRepoMcpConfig({
      activeExposureMode: 'stable',
      publicBaseUrl: publicOrigin,
      authProvider: 'builtin',
      authIssuer: publicOrigin,
      authAudience: publicOrigin ? `${publicOrigin}/mcp` : '',
      cloudflareTunnelName,
      cloudflareConfigPath: tunnelConfigPathInput.trim(),
      cloudflaredPath: cloudflaredPathInput.trim(),
      stableTunnel: {
        configured: Boolean(publicOrigin && cloudflareTunnelName),
        publicOrigin,
        canonicalResource: publicOrigin ? `${publicOrigin}/mcp` : '',
        hostname: (() => { try { return publicOrigin ? new URL(publicOrigin).hostname : ''; } catch { return ''; } })(),
        cloudflareTunnelName,
        cloudflareTunnelId: tunnelIdInput.trim(),
        cloudflareConfigPath: tunnelConfigPathInput.trim(),
        cloudflareCredentialsPath: tunnelCredentialsPathInput.trim(),
        cloudflaredPath: cloudflaredPathInput.trim(),
        managementMode: config.stableTunnel?.managementMode || 'existing',
        setupVersion: config.stableTunnel?.setupVersion || 0,
        autoStart: config.stableTunnel?.autoStart || false,
      },
    });
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <div className="asset-detail-modal-backdrop" onClick={handleBackdropClick} data-testid="mcp-config-modal-backdrop">
      <div
        ref={panelRef}
        className="asset-detail-modal mcp-config-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mcp-config-modal-title"
        data-testid="mcp-config-modal"
      >
        <div className="asset-detail-modal-header">
          <div>
            <h2 id="mcp-config-modal-title" style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700 }}>
              Local Repo Reader
            </h2>
            <p className="assets-tools-item-description">Readable repository and tunnel configuration</p>
          </div>
          <button
            ref={closeRef}
            onClick={onClose}
            className="button button-ghost button-sm"
            data-testid="mcp-config-modal-close"
            aria-label="Close Local Repo Reader configuration"
            type="button"
          >
            x
          </button>
        </div>

        <div className="asset-detail-modal-body">
          {loading ? <p className="opencode-loading">Loading Local Repo Reader configuration...</p> : null}

          <Panel title="ChatGPT Access" subtitle="Connection settings" testId="mcp-config-auth">
            <p className="catalog-inline-note">
              The default ChatGPT flow uses a temporary Cloudflare quick tunnel and no OAuth. Set a cloudflared path only if it is not available on PATH.
            </p>
            <div className="assets-tools-add-panel-form" style={{ marginTop: 12 }}>
              <FormInput label="cloudflared Path" testId="mcp-config-cloudflared-path" value={cloudflaredPathInput} onValueChange={setCloudflaredPathInput} placeholder="Optional absolute path to cloudflared.exe" />
            </div>
            <div className="opencode-model-actions" style={{ marginTop: 12 }}>
              <Button size="sm" disabled={mutating} onClick={() => void onMutate(saveCloudflaredPath)} testId="mcp-config-save-cloudflared-path">Save Path</Button>
            </div>
            <details className="catalog-inline-note" style={{ marginTop: 16 }}>
              <summary>Local diagnostics</summary>
              <div className="mcp-provider-meta" style={{ marginTop: 12 }}>
                <span><strong>Local endpoint</strong>{localEndpoint}</span>
                <span><strong>Authentication</strong>None in the default ChatGPT flow</span>
                <span><strong>Stable URL</strong>requires external tunnel setup</span>
              </div>
            </details>
          </Panel>

          <Panel title="Managed Persistent OAuth Tunnel" subtitle="Guided Cloudflare Free setup" testId="mcp-managed-setup-wizard">
            <ol className="mcp-setup-steps">
              <li>
                <div>
                  <strong>Connect Cloudflare</strong>
                  <p>Cloudflare opens a browser so you can authorize this workstation. Elegy never receives your account password.</p>
                </div>
                <div className="mcp-setup-step-action">
                  <StatusBadge
                    status={cloudflareLogin?.loggedIn ? 'connected' : cloudflareLogin?.running ? 'waiting for browser' : 'not connected'}
                    tone={cloudflareLogin?.loggedIn ? 'success' : cloudflareLogin?.running ? 'accent' : 'neutral'}
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={mutating || cloudflareLogin?.running || cloudflareLogin?.available === false}
                    onClick={() => void onMutate(beginCloudflareLogin)}
                    testId="mcp-cloudflare-login-start"
                  >
                    {cloudflareLogin?.loggedIn ? 'Reconnect' : 'Connect Cloudflare'}
                  </Button>
                </div>
              </li>
              <li>
                <div>
                  <strong>Choose your existing DNS zone</strong>
                  <p>Elegy will use <code>mcp-reader.&lt;your-zone&gt;</code>. Named tunnels and DNS routing are available on Cloudflare Free.</p>
                </div>
                <FormInput
                  label="Cloudflare Zone"
                  testId="mcp-managed-zone"
                  value={managedZoneInput}
                  onValueChange={setManagedZoneInput}
                  placeholder="example.com"
                />
              </li>
              <li>
                <div>
                  <strong>Review the exact changes</strong>
                  <p>The preview expires after ten minutes. Nothing is provisioned until you confirm it.</p>
                </div>
                <Button
                  size="sm"
                  disabled={mutating || !managedZoneInput.trim() || Boolean(provisioningPreview)}
                  onClick={() => void onMutate(previewManagedSetup)}
                  testId="mcp-managed-preview"
                >
                  Preview Cloudflare Setup
                </Button>
              </li>
            </ol>
            {provisioningPreview ? (
              <section className="mcp-provisioning-preview" data-testid="mcp-managed-preview-details">
                <div className="mcp-diagnostic-report-header">
                  <div>
                    <h5>Frozen provisioning preview</h5>
                    <p><strong>Endpoint</strong> {provisioningPreview.canonicalResource}</p>
                  </div>
                  <StatusBadge status="awaiting confirmation" tone="accent" />
                </div>
                {provisioningPreview.operations.map((operation, index) => (
                  <div className="catalog-inline-note" key={`${operation.kind}-${index}`}>
                    <strong>{operation.kind.replace(/-/g, ' ')}</strong>
                    {operation.command ? <code>{[operation.command, ...(operation.args || [])].join(' ')}</code> : null}
                    <p>{operation.effect}</p>
                  </div>
                ))}
                <p className="catalog-inline-note">
                  Partial failures preserve any tunnel or DNS resource already created and return a repair path. Elegy never deletes Cloudflare resources automatically.
                </p>
                <div className="opencode-model-actions">
                  <Button size="sm" disabled={mutating} onClick={() => void onMutate(confirmManagedSetup)} testId="mcp-managed-confirm">
                    Confirm and Provision
                  </Button>
                  <Button size="sm" variant="secondary" disabled={mutating} onClick={() => void onMutate(cancelManagedSetup)} testId="mcp-managed-cancel">
                    Cancel
                  </Button>
                </div>
              </section>
            ) : null}
            {config.stableTunnel?.managementMode === 'managed' && config.stableTunnel.setupVersion >= 1 ? (
              <label className="mcp-autostart-toggle">
                <input
                  type="checkbox"
                  checked={config.stableTunnel.autoStart}
                  disabled={mutating}
                  onChange={(event) => void onMutate(() => setStableAutoStart(event.target.checked))}
                  data-testid="mcp-managed-autostart"
                />
                <span>
                  <strong>Start persistent access with Elegy</strong>
                  <small>Uses owned-process validation and bounded crash recovery. No Windows service is installed.</small>
                </span>
              </label>
            ) : null}
          </Panel>

          <Panel title="Attach Existing Persistent Tunnel" subtitle="Manual advanced configuration" testId="mcp-config-stable">
            <p className="catalog-inline-note">
              Use this path only when a named tunnel and DNS route already exist. Elegy validates the local config, credentials, ingress, and account-visible tunnel identity.
            </p>
            <div className="assets-tools-add-panel-form" style={{ marginTop: 12 }}>
              <FormInput label="Public Origin" testId="mcp-config-public-url" value={publicOriginInput} onValueChange={setPublicOriginInput} placeholder="https://repo-mcp.example.com" />
              <FormInput label="Tunnel Name" testId="mcp-config-tunnel-name" value={tunnelNameInput} onValueChange={setTunnelNameInput} placeholder="local-repo-mcp" />
              <FormInput label="Tunnel UUID" testId="mcp-config-tunnel-id" value={tunnelIdInput} onValueChange={setTunnelIdInput} placeholder="Optional; discovered during validation" />
              <FormInput label="Cloudflare Config Path" testId="mcp-config-tunnel-config-path" value={tunnelConfigPathInput} onValueChange={setTunnelConfigPathInput} placeholder="Optional path to config.yml" />
              <FormInput label="Credentials Path" testId="mcp-config-tunnel-credentials-path" value={tunnelCredentialsPathInput} onValueChange={setTunnelCredentialsPathInput} placeholder="Optional; otherwise read from config.yml" />
            </div>
            <div className="opencode-model-actions" style={{ marginTop: 12 }}>
              <Button size="sm" disabled={mutating} onClick={() => void onMutate(saveStableConfiguration)} testId="mcp-config-save-stable">Save Persistent Configuration</Button>
            </div>
          </Panel>

          <Panel title="Readable Repositories" subtitle="Registered repos enabled for chatbot reads" testId="mcp-config-roots">
            <div className="assets-tools-add-panel-form" style={{ marginBottom: 'var(--space-md)' }}>
              <FormInput label="Repository Path" testId="mcp-config-register-path" value={repoPathInput} onValueChange={setRepoPathInput} placeholder="C:\\Users\\lolzi\\Documents\\GitHub\\instruction-engine" />
              <FormInput label="Label" testId="mcp-config-register-label" value={repoLabelInput} onValueChange={setRepoLabelInput} placeholder="Optional display label" />
            </div>
            <div className="opencode-model-actions" style={{ marginBottom: 12 }}>
              <Button size="sm" disabled={mutating || !repoPathInput.trim()} onClick={() => void onMutate(registerPathAndEnable)} testId="mcp-config-register-enable">Register + Enable</Button>
            </div>
            {repos.length === 0 ? (
              <p className="assets-tools-empty">No known repositories available. Paste a local repo path above to register and enable it.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                {repos.map((repo) => {
                  const key = repo.repoId || repo.repoPath || repo.repoLabel || 'repo';
                  const enabled = Boolean(repo.repoPath && enabledPaths.has(repo.repoPath.toLowerCase()));
                  return (
                    <div className="assets-tools-item-card" key={key}>
                      <div className="assets-tools-item-header">
                        <span>{repo.repoLabel || repo.repoId || repo.repoPath}</span>
                        <StatusBadge status={enabled ? 'enabled' : repo.registered ? 'registered' : 'detected'} testId={`mcp-config-root-status-${key}`} />
                      </div>
                      <p className="assets-tools-item-description">{repo.repoPath}</p>
                      <div className="sources-card-actions">
                        {enabled ? (
                          <Button size="sm" variant="secondary" disabled={mutating} onClick={() => void onMutate(() => removeLocalRepoMcpRoot({ repoId: repo.repoId, repoPath: repo.repoPath }))} testId={`mcp-config-root-remove-${key}`}>Remove</Button>
                        ) : (
                          <Button size="sm" disabled={mutating} onClick={() => void onMutate(() => registerAndEnableRepo(repo))} testId={`mcp-config-root-add-${key}`}>
                            {repo.registered ? 'Enable' : 'Register + Enable'}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
