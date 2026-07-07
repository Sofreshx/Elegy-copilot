import { MouseEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Button, CopyButton, FormInput, PageContainer, Panel, StatusBadge, Toolbar } from '../../components';
import {
  addLocalRepoMcpRoot,
  approveLocalRepoMcpAuthorization,
  getCatalogRepos,
  getLocalRepoMcpConfig,
  getLocalRepoMcpPendingAuthorizations,
  getLocalRepoMcpStatus,
  probeLocalRepoMcp,
  registerCatalogRepo,
  removeLocalRepoMcpRoot,
  saveLocalRepoMcpConfig,
  startLocalRepoMcp,
  startLocalRepoMcpQuickTunnel,
  startLocalRepoMcpTunnel,
  stopLocalRepoMcp,
  stopLocalRepoMcpTunnel,
  type LocalRepoMcpConfig,
  type LocalRepoMcpPendingAuthorization,
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
  actions: ReactNode;
  configureComponent: ReactNode;
}

function connectorUrl(config: LocalRepoMcpConfig): string {
  return config.publicBaseUrl ? `${config.publicBaseUrl.replace(/\/+$/, '')}/mcp` : '';
}

function baseUrlFromConnectorUrl(url: string): string {
  return url.replace(/\/mcp\/?$/, '').replace(/\/+$/, '');
}

function hasOAuthConfig(config: LocalRepoMcpConfig, liveConnectorUrl = ''): boolean {
  return Boolean(config.authIssuer && (config.authAudience || config.publicBaseUrl || liveConnectorUrl));
}

function hasNamedTunnelConfig(config: LocalRepoMcpConfig): boolean {
  return Boolean(config.publicBaseUrl && hasOAuthConfig(config) && config.cloudflareTunnelName);
}

function providerUrlMessage(serverRunning: boolean, issuerConfigured: boolean, authProvider = 'builtin'): string {
  if (!serverRunning) return 'Start local MCP, then start ChatGPT access to generate a connector URL.';
  if (!issuerConfigured && authProvider === 'external') return 'Add OAuth issuer before exposing Local Repo Reader to ChatGPT.';
  return 'Start ChatGPT access to generate a connector URL.';
}

function statusTone(status: string): 'neutral' | 'brand' | 'accent' | 'success' | 'danger' {
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
  const [configuringProviderId, setConfiguringProviderId] = useState<string | null>(null);
  const [pendingAuthorizations, setPendingAuthorizations] = useState<LocalRepoMcpPendingAuthorization[]>([]);

  async function loadPendingAuthorizations() {
    try {
      const pendingResult = await getLocalRepoMcpPendingAuthorizations();
      const pendingStoppedNormally = pendingResult.pendingError && !pendingResult.server.running && !pendingResult.tunnel.running;
      setPendingAuthorizations(pendingResult.pending || []);
      setPendingError(pendingStoppedNormally ? null : pendingResult.pendingError || null);
    } catch (err) {
      setPendingAuthorizations([]);
      setPendingError(err instanceof Error ? err.message : String(err));
    }
  }

  async function load() {
    setError(null);
    try {
      const [statusResult, configResult, reposResult] = await Promise.all([
        getLocalRepoMcpStatus(),
        getLocalRepoMcpConfig(),
        getCatalogRepos(),
      ]);
      const nextConfig = { ...EMPTY_CONFIG, ...configResult.config };
      setStatus(statusResult);
      setConfig(nextConfig);
      setAccess(configResult.access);
      setRepos(reposResult.repos.filter((repo) => repo.repoPath));
      void loadPendingAuthorizations();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

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
  const localRepoConnectorUrl = status?.connectorUrl || status?.tunnel.publicUrl || connectorUrl(config);
  const securityState = error ? 'Error' : status?.securityState || 'Stopped';
  const authProvider = config.authProvider || 'builtin';
  const issuerConfigured = authProvider === 'builtin' ? Boolean(localRepoConnectorUrl) : Boolean(config.authIssuer);
  const namedTunnelConfigured = hasNamedTunnelConfig(config);
  const cloudflaredAvailable = status?.prerequisites?.cloudflared.available ?? true;
  const cloudflaredPath = status?.prerequisites?.cloudflared.path || config.cloudflaredPath || 'cloudflared';
  const effectiveIssuer = status?.prerequisites?.oauth.issuerEffective || config.authIssuer || (localRepoConnectorUrl ? baseUrlFromConnectorUrl(localRepoConnectorUrl) : '');
  const effectiveAudience = status?.prerequisites?.oauth.audienceEffective || config.authAudience || (localRepoConnectorUrl ? baseUrlFromConnectorUrl(localRepoConnectorUrl) : '');
  const staleTunnel = Boolean(status?.tunnel.running && !status?.server.running);
  const chatGptAccessReady = status?.prerequisites?.chatGptAccessReady || status?.securityState === 'OAuth protected';
  const startChatGptDisabled = mutating || !cloudflaredAvailable || chatGptAccessReady;

  async function startChatGptAccess() {
    await startLocalRepoMcpQuickTunnel();
  }

  const provider = useMemo<McpProviderDescriptor>(() => ({
    id: 'local-repo-reader',
    label: 'Local Repo Reader',
    description: 'Read-only MCP for selected local repositories and folders.',
    kind: 'Folder/File Read',
    status: securityState,
    connectorUrl: localRepoConnectorUrl,
    capabilities: ['repo_roots', 'repo_tree', 'repo_read_file', 'repo_search', 'repo_git_status', 'repo_git_log'],
    actions: null,
    configureComponent: null,
  }), [localRepoConnectorUrl, securityState]);

  const configuredModalOpen = configuringProviderId === provider.id;

  return (
    <div className="view-shell mcp-view" data-testid="mcp-view">
      <div className="view-static">
        <Toolbar testId="mcp-toolbar"><h2>MCP</h2></Toolbar>
      </div>

      <div className="view-scroll">
        <PageContainer>
          {error ? <p className="opencode-error" data-testid="mcp-error">{error}</p> : null}

          <Panel title="Web Chatbot Access" subtitle="Current local MCP exposure state" testId="mcp-overall-status">
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
                <StatusBadge status={localRepoConnectorUrl ? 'ready' : 'missing'} testId="mcp-connector-status" />
              </div>
            </div>
          </Panel>

          <Panel title="MCP Providers" subtitle="Local servers that can be exposed to web chatbot clients" testId="mcp-providers">
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

                  <div className="mcp-provider-meta">
                    <span><strong>Kind</strong>{provider.kind}</span>
                    <span><strong>Server</strong>{status?.server.running ? 'running' : 'stopped'}</span>
                    <span><strong>Tunnel</strong>{status?.tunnel.running ? 'running' : 'stopped'}</span>
                    <span><strong>Auth</strong>{issuerConfigured ? 'issuer set' : 'missing'}</span>
                    <span><strong>Roots</strong>{enabledRootCount}</span>
                    <span><strong>Probe</strong>{status?.probe ? (status.probe.ok ? 'ok' : `failed ${status.probe.status || ''}`) : 'not run'}</span>
                  </div>

                  <div className="mcp-provider-capabilities" aria-label="Local Repo Reader tools">
                    {provider.capabilities.map((capability) => (
                      <StatusBadge key={capability} status={capability} testId="mcp-provider-capability" />
                    ))}
                  </div>

                  <div className="catalog-inline-note mcp-provider-url">
                    {provider.connectorUrl || providerUrlMessage(Boolean(status?.server.running), issuerConfigured, authProvider)}
                    {provider.connectorUrl ? <CopyButton text={provider.connectorUrl} testId="mcp-provider-copy-url" /> : null}
                  </div>

                  <div className="mcp-chatgpt-setup" data-testid="mcp-chatgpt-setup">
                    <div className="mcp-chatgpt-setup-header">
                      <div>
                        <h4>ChatGPT Access Setup</h4>
                        <p className="assets-tools-item-description">Start a local OAuth-protected quick HTTPS tunnel for ChatGPT.</p>
                      </div>
                      <StatusBadge
                        status={status?.prerequisites?.chatGptAccessReady ? 'ready' : cloudflaredAvailable ? 'setup needed' : 'blocked'}
                        tone={status?.prerequisites?.chatGptAccessReady ? 'success' : cloudflaredAvailable ? 'accent' : 'danger'}
                        testId="mcp-chatgpt-readiness"
                      />
                    </div>
                    {cloudflaredAvailable ? null : (
                      <p className="opencode-error mcp-chatgpt-blocker" data-testid="mcp-cloudflared-blocker">
                        cloudflared was not found at {cloudflaredPath}. Install cloudflared on PATH or set an absolute path in Advanced Stable Tunnel.
                      </p>
                    )}
                    {staleTunnel ? (
                      <p className="opencode-error mcp-chatgpt-blocker" data-testid="mcp-stale-tunnel-warning">
                        ChatGPT tunnel is running but Local Repo MCP is stopped. Start ChatGPT Access again to restart the local server and tunnel.
                      </p>
                    ) : null}
                    {pendingError ? (
                      <p className="catalog-inline-note" data-testid="mcp-pending-warning">
                        Pending approval check unavailable: {pendingError}
                      </p>
                    ) : null}
                    <div className="mcp-provider-meta">
                      <span><strong>ChatGPT MCP endpoint</strong>{localRepoConnectorUrl || 'generated after Start ChatGPT Access'}</span>
                      <span><strong>OAuth issuer</strong>{effectiveIssuer || 'generated from connector URL'}</span>
                      <span><strong>OAuth audience</strong>{effectiveAudience || 'generated from connector URL'}</span>
                      <span><strong>Required scope</strong>{config.requiredScopes.join(' ')}</span>
                    </div>
                    {pendingAuthorizations.length > 0 ? (
                      <div className="mcp-provider-meta" data-testid="mcp-pending-authorizations">
                        {pendingAuthorizations.map((pending) => (
                          <span key={pending.id}>
                            <strong>Pending approval {pending.userCode}</strong>
                            <Button
                              size="sm"
                              disabled={mutating}
                              onClick={() => void mutate(() => approveLocalRepoMcpAuthorization(pending.id))}
                              testId={`mcp-approve-authorization-${pending.id}`}
                            >
                              Approve
                            </Button>
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {localRepoConnectorUrl ? (
                      <div className="catalog-inline-note mcp-provider-url">
                        {localRepoConnectorUrl}
                        <CopyButton text={localRepoConnectorUrl} testId="mcp-chatgpt-copy-url" />
                      </div>
                    ) : null}
                    <div className="opencode-model-actions">
                      <Button
                        size="sm"
                        disabled={startChatGptDisabled}
                        loading={mutating}
                        loadingLabel="Starting..."
                        onClick={() => void mutate(startChatGptAccess)}
                        testId="mcp-quick-tunnel-start"
                      >
                        Start ChatGPT Access
                      </Button>
                      <Button size="sm" variant="secondary" disabled={mutating} onClick={() => setConfiguringProviderId(provider.id)} testId="mcp-chatgpt-configure-advanced">Advanced Config</Button>
                    </div>
                  </div>

                  <div className="opencode-model-actions">
                    <Button size="sm" variant="secondary" disabled={mutating || status?.server.running} onClick={() => void mutate(startLocalRepoMcp)} testId="mcp-start">Start Local Only</Button>
                    <Button size="sm" variant="secondary" disabled={mutating || !status?.server.running} onClick={() => void mutate(stopLocalRepoMcp)} testId="mcp-stop">Stop</Button>
                    <Button size="sm" variant="secondary" disabled={mutating || !namedTunnelConfigured || status?.tunnel.running} onClick={() => void mutate(startLocalRepoMcpTunnel)} testId="mcp-tunnel-start">Start Named Tunnel</Button>
                    <Button size="sm" variant="secondary" disabled={mutating || !status?.tunnel.running} onClick={() => void mutate(stopLocalRepoMcpTunnel)} testId="mcp-tunnel-stop">Stop Tunnel</Button>
                    <Button size="sm" variant="ghost" disabled={mutating || !status?.server.running} onClick={() => void mutate(probeLocalRepoMcp)} testId="mcp-probe">Probe</Button>
                    <Button size="sm" variant="secondary" disabled={mutating} onClick={() => setConfiguringProviderId(provider.id)} testId="mcp-configure">Configure</Button>
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
  loading,
  mutating,
  repos,
  status,
  onClose,
  onMutate,
}: {
  access: LocalRepoReaderAccessState | null;
  config: LocalRepoMcpConfig;
  loading: boolean;
  mutating: boolean;
  repos: CatalogRepoInventoryEntry[];
  status: LocalRepoMcpStatusResponse | null;
  onClose: () => void;
  onMutate: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [draftConfig, setDraftConfig] = useState<LocalRepoMcpConfig>(config);
  const [repoPathInput, setRepoPathInput] = useState('');
  const [repoLabelInput, setRepoLabelInput] = useState('');

  useEffect(() => {
    setDraftConfig(config);
  }, [config]);

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

  const enabledPaths = useMemo(
    () => new Set((access?.repos || []).map((repo) => repo.root.toLowerCase())),
    [access],
  );
  const liveConnectorUrl = status?.connectorUrl || status?.tunnel.publicUrl || '';
  const stableConnectorUrl = connectorUrl(draftConfig);
  const effectiveConnectorUrl = liveConnectorUrl || stableConnectorUrl;
  const effectiveBaseUrl = effectiveConnectorUrl ? baseUrlFromConnectorUrl(effectiveConnectorUrl) : draftConfig.publicBaseUrl;
  const effectiveAudience = draftConfig.authAudience || effectiveBaseUrl;

  function updateConfig<K extends keyof LocalRepoMcpConfig>(key: K, value: LocalRepoMcpConfig[K]) {
    setDraftConfig((current) => ({ ...current, [key]: value }));
  }

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
            <p className="assets-tools-item-description">Auth, tunnel, and readable repository configuration</p>
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

          <Panel title="ChatGPT Access" subtitle="OAuth issuer and generated connector values" testId="mcp-config-auth">
            <p className="catalog-inline-note">
              Elegy generates a local OAuth issuer from the ChatGPT access tunnel and uses it as the audience unless an advanced override is saved.
            </p>
            <div className="opencode-model-actions" style={{ marginTop: 12 }}>
              <Button size="sm" disabled={mutating} onClick={() => void onMutate(() => saveLocalRepoMcpConfig(draftConfig))} testId="mcp-config-save">Save Config</Button>
              {effectiveConnectorUrl ? (
                <span className="catalog-inline-note">
                  {effectiveConnectorUrl}
                  <CopyButton text={effectiveConnectorUrl} testId="mcp-config-copy-url" />
                </span>
              ) : null}
            </div>
            <div className="mcp-provider-meta" style={{ marginTop: 16 }}>
              <span><strong>ChatGPT MCP endpoint</strong>{effectiveConnectorUrl || 'generated after Start ChatGPT Access'}</span>
              <span><strong>OAuth issuer</strong>{draftConfig.authIssuer || effectiveAudience || 'generated from connector URL'}</span>
              <span><strong>OAuth audience</strong>{effectiveAudience || 'generated from connector URL'}</span>
              <span><strong>Required scope</strong>{draftConfig.requiredScopes.join(' ')}</span>
            </div>
          </Panel>

          <Panel title="Advanced Stable Tunnel" subtitle="Optional named tunnel and audience override" testId="mcp-config-advanced">
            <p className="catalog-inline-note">
              Use these fields only when you already have a stable HTTPS hostname routed to http://127.0.0.1:{draftConfig.port}.
            </p>
            <div className="assets-tools-add-panel-form">
              <FormInput label="Auth Provider" testId="mcp-config-auth-provider" value={draftConfig.authProvider || 'builtin'} onValueChange={(value) => updateConfig('authProvider', value)} placeholder="builtin or external" />
              <FormInput label="External OAuth Issuer" testId="mcp-config-auth-issuer" value={draftConfig.authIssuer} onValueChange={(value) => updateConfig('authIssuer', value)} placeholder="Only for external OAuth providers" />
              <FormInput label="Public Base URL" testId="mcp-config-public-url" value={draftConfig.publicBaseUrl} onValueChange={(value) => updateConfig('publicBaseUrl', value)} placeholder="https://mcp.example.com" />
              <FormInput label="OAuth Audience Override" testId="mcp-config-auth-audience" value={draftConfig.authAudience} onValueChange={(value) => updateConfig('authAudience', value)} placeholder="Defaults to connector base URL" />
              <FormInput label="Cloudflare Tunnel Name" testId="mcp-config-tunnel-name" value={draftConfig.cloudflareTunnelName} onValueChange={(value) => updateConfig('cloudflareTunnelName', value)} placeholder="local-repo-mcp" />
              <FormInput label="Cloudflare Config Path" testId="mcp-config-cloudflare-config-path" value={draftConfig.cloudflareConfigPath} onValueChange={(value) => updateConfig('cloudflareConfigPath', value)} placeholder="Optional config.yml path" />
              <FormInput label="cloudflared Path" testId="mcp-config-cloudflared-path" value={draftConfig.cloudflaredPath} onValueChange={(value) => updateConfig('cloudflaredPath', value)} placeholder="Optional absolute path" />
            </div>
            <div className="opencode-model-actions" style={{ marginTop: 12 }}>
              <Button size="sm" disabled={mutating} onClick={() => void onMutate(() => saveLocalRepoMcpConfig(draftConfig))} testId="mcp-config-save-advanced">Save Advanced</Button>
              {stableConnectorUrl ? (
                <span className="catalog-inline-note">
                  {stableConnectorUrl}
                  <CopyButton text={stableConnectorUrl} testId="mcp-config-copy-stable-url" />
                </span>
              ) : null}
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
