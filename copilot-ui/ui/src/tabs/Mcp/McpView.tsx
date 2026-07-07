import { MouseEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Button, CopyButton, FormInput, PageContainer, Panel, StatusBadge, Toolbar } from '../../components';
import {
  addLocalRepoMcpRoot,
  getCatalogRepos,
  getLocalRepoMcpConfig,
  getLocalRepoMcpPendingAuthorizations,
  getLocalRepoMcpStatus,
  registerCatalogRepo,
  removeLocalRepoMcpRoot,
  saveLocalRepoMcpConfig,
  startLocalRepoMcp,
  startLocalRepoMcpQuickTunnel,
  stopLocalRepoMcp,
  stopLocalRepoMcpTunnel,
  type LocalRepoMcpConfig,
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

function providerUrlMessage(serverRunning: boolean): string {
  if (!serverRunning) return 'Start ChatGPT Access to generate a private HTTPS MCP URL.';
  return 'Local MCP endpoint is ready.';
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
  const [configuringProviderId, setConfiguringProviderId] = useState<string | null>(null);

  async function loadPendingAuthorizations() {
    try {
      const pendingResult = await getLocalRepoMcpPendingAuthorizations();
      const pendingStoppedNormally = pendingResult.pendingError && !pendingResult.server.running && !pendingResult.tunnel.running;
      setPendingError(pendingStoppedNormally ? null : pendingResult.pendingError || null);
      setPendingErrorCode(pendingStoppedNormally ? null : pendingResult.pendingErrorCode || null);
    } catch (err) {
      setPendingError(err instanceof Error ? err.message : String(err));
      setPendingErrorCode(null);
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

  useEffect(() => {
    if (!status?.server.running || (config.authProvider || 'builtin') !== 'builtin') return undefined;
    const timer = window.setInterval(() => {
      void loadPendingAuthorizations();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [status?.server.running, config.authProvider]);

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
  const chatGptReady = Boolean(status?.chatGptAccess?.ready && chatGptUrl);
  const cloudflaredMissing = Boolean(status?.prerequisites?.cloudflared && !status.prerequisites.cloudflared.available);
  const securityState = error ? 'Error' : status?.securityState || 'Stopped';
  const startLocalDisabled = mutating || Boolean(status?.server.running);
  const startChatGptDisabled = mutating || chatGptReady || cloudflaredMissing;
  const pendingApprovalSecretMismatch = Boolean(pendingError && pendingErrorCode === 'approval_secret_mismatch');

  async function startLocalAccess() {
    await startLocalRepoMcp();
  }

  async function startChatGptAccess() {
    await startLocalRepoMcpQuickTunnel();
  }

  const provider = useMemo<McpProviderDescriptor>(() => ({
    id: 'local-repo-reader',
    label: 'Local Repo Reader',
    description: 'Read-only MCP for selected local repositories and folders.',
    kind: 'Folder/File Read',
    status: securityState,
    connectorUrl: chatGptUrl || (status?.server.running ? localMcpEndpoint : ''),
    capabilities: ['repo_roots', 'repo_tree', 'repo_read_file', 'repo_search', 'repo_git_status', 'repo_git_log'],
    actions: null,
    configureComponent: null,
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
                    <span><strong>Tunnel</strong>{status?.tunnel.running ? status.tunnel.mode || 'running' : 'stopped'}</span>
                    <span><strong>Auth</strong>{chatGptReady ? 'none' : 'local only'}</span>
                    <span><strong>Roots</strong>{enabledRootCount}</span>
                    <span><strong>Probe</strong>{status?.probe ? (status.probe.ok ? 'ok' : `failed ${status.probe.status || ''}`) : 'not run'}</span>
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
                        <h4>ChatGPT Access</h4>
                        <p className="assets-tools-item-description">Start Local Repo Reader and create a private temporary HTTPS URL for ChatGPT.</p>
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
                    {cloudflaredMissing ? (
                      <p className="catalog-inline-note" data-testid="mcp-cloudflared-blocker">
                        cloudflared is required for ChatGPT access. Install it on PATH or set the path in Advanced Config.
                      </p>
                    ) : null}
                    <div className="mcp-provider-meta">
                      <span><strong>Access mode</strong>temporary Cloudflare quick tunnel</span>
                      <span><strong>ChatGPT setting</strong>paste this URL as the Server URL</span>
                      <span><strong>Authentication</strong>None</span>
                      <span><strong>URL stability</strong>{chatGptReady ? 'temporary; changes after restart' : 'generated after start'}</span>
                    </div>
                    {chatGptReady ? (
                      <div className="catalog-inline-note mcp-provider-url">
                        {chatGptUrl}
                        <CopyButton text={chatGptUrl} testId="mcp-chatgpt-copy-url" />
                      </div>
                    ) : null}
                    <p className="catalog-inline-note" data-testid="mcp-temporary-url-note">
                      This quick tunnel URL is temporary. If you stop or restart access, create or reconnect the ChatGPT app with the new URL.
                    </p>
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
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={mutating || (!status?.server.running && !status?.tunnel.running)}
                        onClick={() => void mutate(async () => { await stopLocalRepoMcpTunnel(); await stopLocalRepoMcp(); })}
                        testId="mcp-chatgpt-stop"
                      >
                        Stop
                      </Button>
                      <Button size="sm" variant="secondary" disabled={mutating} onClick={() => setConfiguringProviderId(provider.id)} testId="mcp-chatgpt-configure-advanced">Advanced Config</Button>
                    </div>
                  </div>

                  <div className="opencode-model-actions">
                    <Button size="sm" variant="secondary" disabled={startLocalDisabled} onClick={() => void mutate(startLocalAccess)} testId="mcp-start-local-only">Start Local Only</Button>
                    <Button size="sm" variant="secondary" disabled={mutating || !status?.server.running} onClick={() => void mutate(stopLocalRepoMcp)} testId="mcp-stop">Stop Local</Button>
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
  const [repoPathInput, setRepoPathInput] = useState('');
  const [repoLabelInput, setRepoLabelInput] = useState('');
  const [cloudflaredPathInput, setCloudflaredPathInput] = useState(config.cloudflaredPath || '');

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
            <p className="assets-tools-item-description">Local endpoint and readable repository configuration</p>
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

          <Panel title="ChatGPT Access" subtitle="Advanced connection values" testId="mcp-config-auth">
            <p className="catalog-inline-note">
              The default ChatGPT flow uses a temporary Cloudflare quick tunnel and no OAuth. Set a cloudflared path only if it is not available on PATH.
            </p>
            <div className="assets-tools-add-panel-form" style={{ marginTop: 12 }}>
              <FormInput label="cloudflared Path" testId="mcp-config-cloudflared-path" value={cloudflaredPathInput} onValueChange={setCloudflaredPathInput} placeholder="Optional absolute path to cloudflared.exe" />
            </div>
            <div className="opencode-model-actions" style={{ marginTop: 12 }}>
              <Button size="sm" disabled={mutating} onClick={() => void onMutate(saveCloudflaredPath)} testId="mcp-config-save-cloudflared-path">Save Path</Button>
            </div>
            <div className="opencode-model-actions" style={{ marginTop: 12 }}>
              {localEndpoint ? (
                <span className="catalog-inline-note">
                  {localEndpoint}
                  <CopyButton text={localEndpoint} testId="mcp-config-copy-url" />
                </span>
              ) : null}
            </div>
            <div className="mcp-provider-meta" style={{ marginTop: 16 }}>
              <span><strong>Local MCP endpoint</strong>{localEndpoint}</span>
              <span><strong>Authentication</strong>None in the default ChatGPT flow</span>
              <span><strong>Stable URL</strong>requires advanced external tunnel setup</span>
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
