import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import McpView from './McpView';

const api = vi.hoisted(() => ({
  addLocalRepoMcpRoot: vi.fn(),
  approveLocalRepoMcpAuthorization: vi.fn(),
  cancelLocalRepoMcpDiagnosticRepair: vi.fn(),
  cancelLocalRepoMcpManagedProvisioning: vi.fn(),
  confirmLocalRepoMcpDiagnosticRepair: vi.fn(),
  confirmLocalRepoMcpManagedProvisioning: vi.fn(),
  exportLocalRepoMcpDiagnostics: vi.fn(),
  getCatalogRepos: vi.fn(),
  getLocalRepoMcpCloudflareLoginStatus: vi.fn(),
  getLocalRepoMcpConfig: vi.fn(),
  getLocalRepoMcpPendingAuthorizations: vi.fn(),
  getLocalRepoMcpStatus: vi.fn(),
  probeLocalRepoMcp: vi.fn(),
  previewLocalRepoMcpDiagnosticRepair: vi.fn(),
  previewLocalRepoMcpManagedProvisioning: vi.fn(),
  registerCatalogRepo: vi.fn(),
  removeLocalRepoMcpRoot: vi.fn(),
  runLocalRepoMcpDiagnostics: vi.fn(),
  saveLocalRepoMcpConfig: vi.fn(),
  startLocalRepoMcp: vi.fn(),
  startLocalRepoMcpCloudflareLogin: vi.fn(),
  startLocalRepoMcpQuickTunnel: vi.fn(),
  startLocalRepoMcpTunnel: vi.fn(),
  stopLocalRepoMcp: vi.fn(),
  stopLocalRepoMcpTunnel: vi.fn(),
}));

vi.mock('../../lib/api', () => api);

const config = {
  port: 3333,
  authProvider: 'builtin',
  publicBaseUrl: 'https://mcp.example.com',
  authIssuer: 'https://mcp.example.com',
  authAudience: 'https://mcp.example.com',
  requiredScopes: ['repo:read'],
  cloudflareTunnelName: 'local-repo-mcp',
  cloudflareConfigPath: '',
  cloudflaredPath: '',
};

function mockReady(overrides: Record<string, unknown> = {}) {
  const serverRunning = Boolean((overrides.server as { running?: boolean } | undefined)?.running);
  const tunnelRunning = Boolean((overrides.tunnel as { running?: boolean } | undefined)?.running);
  const chatGptUrl = tunnelRunning ? 'https://sample.trycloudflare.com/mcp' : '';
  const status = {
    config,
    server: { running: false, pid: null, url: 'http://127.0.0.1:3333/mcp' },
    tunnel: { running: false, pid: null, publicUrl: 'https://mcp.example.com/mcp' },
    securityState: 'Stopped',
    probe: null,
    chatGptAccess: {
      mode: 'quick',
      ready: serverRunning && tunnelRunning,
      url: chatGptUrl,
      auth: 'none',
      urlStable: false,
      blocker: '',
    },
    ...overrides,
  };
  api.getLocalRepoMcpStatus.mockResolvedValue(status);
  api.getLocalRepoMcpConfig.mockResolvedValue({
    config,
    access: {
      repos: [{
        repoId: 'instruction-engine',
        alias: 'instruction-engine',
        root: 'C:\\repo\\instruction-engine',
        label: 'instruction-engine',
        enabled: true,
      }],
    },
  });
  api.getCatalogRepos.mockResolvedValue({
    repos: [{
      repoId: 'instruction-engine',
      repoPath: 'C:\\repo\\instruction-engine',
      repoLabel: 'instruction-engine',
      registered: true,
    }],
  });
  api.getLocalRepoMcpPendingAuthorizations.mockResolvedValue({ pending: [] });
}

function mockMissingOAuth() {
  const missingConfig = {
    ...config,
    authProvider: 'builtin',
    publicBaseUrl: '',
    authIssuer: '',
    authAudience: '',
    cloudflareTunnelName: '',
  };
  api.getLocalRepoMcpStatus.mockResolvedValue({
    config: missingConfig,
    server: { running: false, pid: null, url: 'http://127.0.0.1:3333/mcp' },
    tunnel: { running: false, pid: null, mode: 'none', publicUrl: '' },
    securityState: 'Stopped',
    connectorUrl: '',
    chatGptAccess: {
      mode: 'quick',
      ready: false,
      url: '',
      auth: 'none',
      urlStable: false,
      blocker: '',
    },
  });
  api.getLocalRepoMcpConfig.mockResolvedValue({
    config: missingConfig,
    access: { repos: [] },
  });
  api.getCatalogRepos.mockResolvedValue({ repos: [] });
  api.getLocalRepoMcpPendingAuthorizations.mockResolvedValue({ pending: [] });
}

function mockIssuerOnly() {
  const issuerOnlyConfig = {
    ...config,
    publicBaseUrl: '',
    authAudience: '',
    cloudflareTunnelName: '',
  };
  api.getLocalRepoMcpStatus.mockResolvedValue({
    config: issuerOnlyConfig,
    server: { running: true, pid: 1, url: 'http://127.0.0.1:3333/mcp' },
    tunnel: { running: false, pid: null, mode: 'none', publicUrl: '' },
    securityState: 'Local only',
    connectorUrl: '',
    chatGptAccess: {
      mode: 'quick',
      ready: false,
      url: '',
      auth: 'none',
      urlStable: false,
      blocker: '',
    },
  });
  api.getLocalRepoMcpConfig.mockResolvedValue({
    config: issuerOnlyConfig,
    access: { repos: [] },
  });
  api.getCatalogRepos.mockResolvedValue({ repos: [] });
  api.getLocalRepoMcpPendingAuthorizations.mockResolvedValue({ pending: [] });
}

function mockMissingCloudflared() {
  const issuerOnlyConfig = {
    ...config,
    publicBaseUrl: '',
    authAudience: '',
    cloudflareTunnelName: '',
  };
  api.getLocalRepoMcpStatus.mockResolvedValue({
    config: issuerOnlyConfig,
    server: { running: false, pid: null, url: 'http://127.0.0.1:3333/mcp' },
    tunnel: { running: false, pid: null, mode: 'none', publicUrl: '' },
    securityState: 'Stopped',
    connectorUrl: '',
    chatGptAccess: {
      mode: 'quick',
      ready: false,
      url: '',
      auth: 'none',
      urlStable: false,
      blocker: 'cloudflared is required before exposing Local Repo Reader to ChatGPT.',
    },
    prerequisites: {
      cloudflared: { available: false, path: 'cloudflared' },
      oauth: { issuerConfigured: true, audienceEffective: '' },
      chatGptAccessReady: false,
    },
  });
  api.getLocalRepoMcpConfig.mockResolvedValue({
    config: issuerOnlyConfig,
    access: { repos: [] },
  });
  api.getCatalogRepos.mockResolvedValue({ repos: [] });
  api.getLocalRepoMcpPendingAuthorizations.mockResolvedValue({ pending: [] });
}

describe('McpView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReady();
    api.getLocalRepoMcpCloudflareLoginStatus.mockResolvedValue({
      cloudflareLogin: { available: true, running: false, loggedIn: false, certPath: 'C:\\Users\\test\\.cloudflared\\cert.pem' },
    });
    api.exportLocalRepoMcpDiagnostics.mockResolvedValue({ schemaVersion: 1, overall: 'pass', checks: [], repairs: [] });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders loading state while provider data is pending', () => {
    api.getLocalRepoMcpStatus.mockReturnValue(new Promise<never>(() => {}));
    api.getLocalRepoMcpConfig.mockReturnValue(new Promise<never>(() => {}));
    api.getCatalogRepos.mockReturnValue(new Promise<never>(() => {}));
    api.getLocalRepoMcpPendingAuthorizations.mockReturnValue(new Promise<never>(() => {}));

    render(<McpView />);

    expect(screen.getByTestId('mcp-view')).toBeInTheDocument();
    expect(screen.getByText('Loading MCP providers...')).toBeInTheDocument();
  });

  it('renders the Local Repo Reader provider card', async () => {
    render(<McpView />);

    await waitFor(() => {
      expect(screen.getByTestId('mcp-provider-local-repo-reader')).toBeInTheDocument();
    });

    expect(screen.getByText('Local Repo Reader')).toBeInTheDocument();
    expect(screen.getByText('Start to generate a ChatGPT Server URL.')).toBeInTheDocument();
    expect(screen.getByText('This quick tunnel URL is temporary. If you stop or restart access, create or reconnect the ChatGPT app with the new URL.')).toBeInTheDocument();
    expect(screen.getByTestId('mcp-readable-root-count')).toHaveTextContent('1 enabled');
    expect(screen.queryByTestId('mcp-start-local-only')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mcp-stop')).not.toBeInTheDocument();
  });

  it('shows ChatGPT-ready state when the quick tunnel is running', async () => {
    mockReady({
      server: { running: true, pid: 1, url: 'http://127.0.0.1:3333/mcp' },
      tunnel: { running: true, pid: 2, mode: 'quick', publicUrl: 'https://sample.trycloudflare.com/mcp' },
      securityState: 'ChatGPT ready',
      chatGptAccess: {
        mode: 'quick',
        ready: true,
        url: 'https://sample.trycloudflare.com/mcp',
        auth: 'none',
        urlStable: false,
        blocker: '',
      },
      probe: { ok: true, status: 200, code: 'ok', message: 'MCP tools/list succeeded.' },
    });

    render(<McpView />);

    await waitFor(() => {
      expect(screen.getByTestId('mcp-exposure-status')).toHaveTextContent('ChatGPT ready');
    });

    expect(screen.getByTestId('mcp-chatgpt-readiness')).toHaveTextContent('ready for ChatGPT');
    expect(screen.getAllByText('https://sample.trycloudflare.com/mcp').length).toBeGreaterThan(0);
    expect(screen.getByText('None')).toBeInTheDocument();
    expect(screen.getByTestId('mcp-quick-tunnel-start')).toHaveTextContent('Start');
    expect(screen.getByTestId('mcp-quick-tunnel-start')).toBeDisabled();
    expect(screen.getByTestId('mcp-provider-copy-url')).toBeInTheDocument();
    expect(screen.getByTestId('mcp-chatgpt-copy-url')).toBeInTheDocument();
  });

  it('starts ChatGPT access through the quick tunnel', async () => {
    mockMissingOAuth();
    api.startLocalRepoMcpQuickTunnel.mockResolvedValue({});

    render(<McpView />);

    await waitFor(() => {
      expect(screen.getByTestId('mcp-quick-tunnel-start')).toBeInTheDocument();
    });

    expect(screen.getByTestId('mcp-quick-tunnel-start')).toHaveTextContent('Start');
    expect(screen.getByTestId('mcp-quick-tunnel-start')).not.toBeDisabled();
    expect(screen.queryByTestId('mcp-temporary-tunnel-start')).not.toBeInTheDocument();
    expect(screen.getByTestId('mcp-chatgpt-readiness')).toHaveTextContent('ready to start');

    fireEvent.click(screen.getByTestId('mcp-quick-tunnel-start'));

    await waitFor(() => {
      expect(api.startLocalRepoMcpQuickTunnel).toHaveBeenCalled();
      expect(api.startLocalRepoMcpTunnel).not.toHaveBeenCalled();
    });
  });

  it('does not show pending OAuth polling failures during no-auth setup', async () => {
    mockMissingOAuth();
    api.getLocalRepoMcpPendingAuthorizations.mockRejectedValue(new Error('pending route failed'));

    render(<McpView />);

    await waitFor(() => {
      expect(screen.getByTestId('mcp-provider-local-repo-reader')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('mcp-error')).not.toBeInTheDocument();
    expect(screen.getByTestId('mcp-quick-tunnel-start')).not.toBeDisabled();
    expect(screen.queryByTestId('mcp-pending-warning')).not.toBeInTheDocument();
    expect(api.getLocalRepoMcpPendingAuthorizations).not.toHaveBeenCalled();
  });

  it('shows restart guidance when pending approval secret is out of sync', async () => {
    mockReady({
      server: { running: true, pid: 1, url: 'http://127.0.0.1:3333/mcp' },
      tunnel: { running: true, pid: 2, mode: 'named', publicUrl: 'https://mcp.example.com/mcp' },
      securityState: 'OAuth protected',
    });
    api.getLocalRepoMcpPendingAuthorizations.mockResolvedValue({
      pending: [],
      pendingErrorCode: 'approval_secret_mismatch',
      pendingError: 'Unable to read pending OAuth authorizations (403).',
      server: { running: true },
      tunnel: { running: true },
    });

    render(<McpView />);

    await waitFor(() => {
      expect(screen.getByTestId('mcp-pending-warning')).toHaveTextContent('Approval channel is out of sync');
    });
  });

  it('shows and approves pending persistent OAuth requests', async () => {
    mockReady({
      server: { running: true, pid: 1, url: 'http://127.0.0.1:3333/mcp' },
      tunnel: { running: true, pid: 2, mode: 'named', publicUrl: 'https://mcp.example.com/mcp' },
      securityState: 'OAuth protected',
      chatGptAccess: {
        mode: 'stable',
        configured: true,
        online: true,
        ready: false,
        url: 'https://mcp.example.com/mcp',
        auth: 'oauth',
        urlStable: true,
        lifecycleState: 'online_unverified',
      },
    });
    api.getLocalRepoMcpPendingAuthorizations.mockResolvedValue({
      pending: [{
        id: 'auth-1',
        userCode: '123456',
        clientId: 'chatgpt-client',
        scope: 'repo:read offline_access',
        resource: 'https://mcp.example.com/mcp',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }],
      server: { running: true },
      tunnel: { running: true },
    });
    api.approveLocalRepoMcpAuthorization.mockResolvedValue({});

    render(<McpView />);

    await waitFor(() => {
      expect(screen.getByTestId('mcp-pending-authorizations')).toHaveTextContent('123456');
    });
    fireEvent.click(screen.getByTestId('mcp-approve-auth-1'));
    await waitFor(() => {
      expect(api.approveLocalRepoMcpAuthorization).toHaveBeenCalledWith('auth-1');
    });
  });

  it('blocks ChatGPT access when cloudflared is missing', async () => {
    mockMissingCloudflared();

    render(<McpView />);

    await waitFor(() => {
      expect(screen.getByTestId('mcp-quick-tunnel-start')).toBeInTheDocument();
    });

    expect(screen.getByTestId('mcp-cloudflared-blocker')).toHaveTextContent('cloudflared is required');
    expect(screen.getByTestId('mcp-quick-tunnel-start')).toBeDisabled();
  });

  it('renders generated ChatGPT connector URL', async () => {
    mockReady({
      server: { running: true, pid: 1, url: 'http://127.0.0.1:3333/mcp' },
      tunnel: { running: true, pid: 2, mode: 'quick', publicUrl: 'https://sample.trycloudflare.com/mcp' },
      securityState: 'ChatGPT ready',
      chatGptAccess: {
        mode: 'quick',
        ready: true,
        url: 'https://sample.trycloudflare.com/mcp',
        auth: 'none',
        urlStable: false,
        blocker: '',
      },
      probe: { ok: true, status: 200, code: 'ok', message: 'MCP tools/list succeeded.' },
    });

    render(<McpView />);

    await waitFor(() => {
      expect(screen.getAllByText('https://sample.trycloudflare.com/mcp').length).toBeGreaterThan(0);
    });

    expect(screen.getByTestId('mcp-provider-copy-url')).toBeInTheDocument();
    expect(screen.getByTestId('mcp-chatgpt-copy-url')).toBeInTheDocument();
  });

  it('shows probe failures instead of marking ChatGPT ready', async () => {
    mockReady({
      server: { running: true, pid: 1, url: 'http://127.0.0.1:3333/mcp' },
      tunnel: { running: true, pid: 2, mode: 'quick', publicUrl: 'https://sample.trycloudflare.com/mcp' },
      securityState: 'Misconfigured',
      chatGptAccess: {
        mode: 'quick',
        ready: false,
        url: '',
        auth: 'none',
        urlStable: false,
        blocker: '',
      },
      probe: { ok: false, status: 401, code: 'oauth_challenge', message: 'MCP endpoint requires OAuth or bearer auth.' },
    });

    render(<McpView />);

    await waitFor(() => {
      expect(screen.getByTestId('mcp-provider-status')).toHaveTextContent('Misconfigured');
    });

    expect(screen.getByTestId('mcp-chatgpt-readiness')).toHaveTextContent('ready to start');
    expect(screen.getByTestId('mcp-probe-warning')).toHaveTextContent('OAuth or bearer auth');
    expect(screen.getByText(/failed 401/)).toBeInTheDocument();
  });

  it('shows stale server cleanup notices', async () => {
    mockReady({
      server: {
        running: true,
        pid: 1,
        url: 'http://127.0.0.1:3333/mcp',
        notice: 'Stopped stale Local Repo MCP process(es): 9999',
      },
      tunnel: { running: true, pid: 2, mode: 'quick', publicUrl: 'https://sample.trycloudflare.com/mcp' },
      securityState: 'ChatGPT ready',
      chatGptAccess: {
        mode: 'quick',
        ready: true,
        url: 'https://sample.trycloudflare.com/mcp',
        auth: 'none',
        urlStable: false,
        blocker: '',
      },
      probe: { ok: true, status: 200, code: 'ok', message: 'MCP tools/list succeeded.' },
    });

    render(<McpView />);

    await waitFor(() => {
      expect(screen.getByTestId('mcp-server-notice')).toHaveTextContent('Stopped stale Local Repo MCP process');
    });
  });

  it('opens and closes the provider configuration modal', async () => {
    render(<McpView />);

    await waitFor(() => {
      expect(screen.getByTestId('mcp-configure')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('mcp-configure'));

    expect(screen.getByTestId('mcp-config-modal')).toBeInTheDocument();
    expect(screen.getByTestId('mcp-config-root-status-instruction-engine')).toHaveTextContent('enabled');
    expect(within(screen.getByTestId('mcp-config-modal')).getByText('ChatGPT Access')).toBeInTheDocument();
    expect(screen.getByTestId('mcp-config-cloudflared-path')).toBeInTheDocument();
    expect(screen.getByTestId('mcp-config-public-url')).toBeInTheDocument();
    expect(screen.getByTestId('mcp-config-tunnel-name')).toBeInTheDocument();
    expect(screen.queryByTestId('mcp-config-auth-issuer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mcp-config-auth-audience')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('mcp-config-modal-close'));

    await waitFor(() => {
      expect(screen.queryByTestId('mcp-config-modal')).not.toBeInTheDocument();
    });
  });

  it('shows persistent access separately and keeps it unverified while offline', async () => {
    render(<McpView />);

    await waitFor(() => {
      expect(screen.getByTestId('mcp-persistent-access')).toBeInTheDocument();
    });

    expect(screen.getByText('Persistent OAuth Tunnel')).toBeInTheDocument();
    expect(screen.getByTestId('mcp-stable-readiness')).toHaveTextContent('configured — offline');
    expect(screen.getByTestId('mcp-stable-copy-url')).toBeInTheDocument();
    expect(screen.getByTestId('mcp-stable-start')).not.toBeDisabled();
    expect(screen.getByText(/not marked ChatGPT-ready until a complete OAuth authorization probe succeeds/i)).toBeInTheDocument();
  });

  it('does not present a stale endpoint as persistent when stable setup is incomplete', async () => {
    mockMissingOAuth();
    const staleConfig = {
      ...config,
      publicBaseUrl: 'https://old-session.trycloudflare.com',
      cloudflareTunnelName: '',
      stableTunnel: {
        configured: false,
        publicOrigin: 'https://old-session.trycloudflare.com',
        canonicalResource: 'https://old-session.trycloudflare.com/mcp',
        cloudflareTunnelName: '',
      },
    };
    api.getLocalRepoMcpConfig.mockResolvedValue({ config: staleConfig, access: { repos: [] } });
    api.getLocalRepoMcpStatus.mockResolvedValue({
      ...(await api.getLocalRepoMcpStatus()),
      config: staleConfig,
      lifecycle: {
        code: 'autostart_disabled',
        blocked: false,
        recovering: false,
        message: 'Persistent tunnel autostart is not enabled.',
      },
    });

    render(<McpView />);
    await waitFor(() => expect(screen.getByTestId('mcp-persistent-access')).toBeInTheDocument());

    expect(screen.getByTestId('mcp-stable-readiness')).toHaveTextContent('not configured');
    expect(screen.queryByTestId('mcp-stable-copy-url')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mcp-stable-lifecycle')).not.toBeInTheDocument();
  });

  it('shows simple ChatGPT connection values in primary configuration', async () => {
    const localConfig = {
      ...config,
      publicBaseUrl: '',
      authAudience: '',
      cloudflareTunnelName: '',
    };
    mockReady({
      config: localConfig,
      server: { running: true, pid: 1, url: 'http://127.0.0.1:3333/mcp' },
      tunnel: { running: false, pid: null, mode: 'none', publicUrl: '' },
      securityState: 'Local only',
    });
    api.getLocalRepoMcpConfig.mockResolvedValue({
      config: localConfig,
      access: { repos: [] },
    });

    render(<McpView />);

    await waitFor(() => {
      expect(screen.getByTestId('mcp-configure')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('mcp-configure'));

    const primaryConfig = within(screen.getByTestId('mcp-config-auth'));
    expect(primaryConfig.getAllByText('http://127.0.0.1:3333/mcp').length).toBeGreaterThan(0);
    expect(primaryConfig.getByText('None in the default ChatGPT flow')).toBeInTheDocument();
    expect(primaryConfig.getByText('requires external tunnel setup')).toBeInTheDocument();
    expect(screen.queryByTestId('mcp-config-advanced')).not.toBeInTheDocument();
  });

  it('guides managed Cloudflare setup through login, frozen preview, and confirmation', async () => {
    mockMissingOAuth();
    api.startLocalRepoMcpCloudflareLogin.mockResolvedValue({
      cloudflareLogin: { available: true, running: true, loggedIn: false, pid: 42 },
    });
    api.previewLocalRepoMcpManagedProvisioning.mockResolvedValue({
      previewId: 'preview-1',
      expiresAt: '2026-07-25T12:10:00.000Z',
      hostname: 'mcp-reader.example.com',
      canonicalResource: 'https://mcp-reader.example.com/mcp',
      operations: [
        { kind: 'command', command: 'cloudflared', args: ['tunnel', 'create', 'elegy-local-repo-mcp'], effect: 'Create tunnel' },
        { kind: 'command', command: 'cloudflared', args: ['tunnel', 'route', 'dns', 'elegy-local-repo-mcp', 'mcp-reader.example.com'], effect: 'Create DNS' },
      ],
    });
    api.confirmLocalRepoMcpManagedProvisioning.mockResolvedValue({
      provisioning: { status: 'completed' },
      config: { ...config, stableTunnel: { configured: true, autoStart: false } },
    });

    render(<McpView />);
    await waitFor(() => expect(screen.getByTestId('mcp-stable-configure')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('mcp-stable-configure'));

    expect(screen.getByTestId('mcp-managed-setup-wizard')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mcp-cloudflare-login-start'));
    await waitFor(() => expect(api.startLocalRepoMcpCloudflareLogin).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('Cloudflare Zone'), { target: { value: 'example.com' } });
    fireEvent.click(screen.getByTestId('mcp-managed-preview'));
    await waitFor(() => expect(api.previewLocalRepoMcpManagedProvisioning).toHaveBeenCalledWith('example.com'));
    expect(screen.getByTestId('mcp-managed-preview-details')).toHaveTextContent('mcp-reader.example.com');
    expect(screen.getByTestId('mcp-managed-preview-details')).toHaveTextContent('tunnel create');

    fireEvent.click(screen.getByTestId('mcp-managed-confirm'));
    await waitFor(() => expect(api.confirmLocalRepoMcpManagedProvisioning).toHaveBeenCalledWith('preview-1'));
  });

  it('runs structured persistent diagnostics and previews repairs before confirmation', async () => {
    api.runLocalRepoMcpDiagnostics.mockResolvedValue({
      schemaVersion: 1,
      generatedAt: '2026-07-25T12:00:00.000Z',
      overall: 'blocked',
      checks: [
        { id: 'dns_resolution', layer: 'dns', status: 'blocked', code: 'dns_lookup_failed', message: 'DNS is missing.' },
      ],
      repairs: [
        { id: 'repair_dns_route', label: 'Repair Cloudflare DNS route', description: 'Recreate DNS.', requiresConfirmation: true },
      ],
    });
    api.previewLocalRepoMcpDiagnosticRepair.mockResolvedValue({
      previewId: 'repair-preview-1',
      repairId: 'repair_dns_route',
      operations: [{ kind: 'command', command: 'cloudflared', args: ['tunnel', 'route', 'dns'], effect: 'Recreate DNS.' }],
    });
    api.confirmLocalRepoMcpDiagnosticRepair.mockResolvedValue({
      repair: { id: 'repair_dns_route', status: 'completed' },
    });

    render(<McpView />);
    await waitFor(() => expect(screen.getByTestId('mcp-stable-diagnostics-run')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('mcp-stable-diagnostics-run'));

    await waitFor(() => expect(screen.getByTestId('mcp-diagnostic-report')).toHaveTextContent('DNS is missing.'));
    expect(screen.getByTestId('mcp-diagnostic-report')).toHaveTextContent('dns_lookup_failed');
    fireEvent.click(screen.getByTestId('mcp-repair-preview-repair_dns_route'));
    await waitFor(() => expect(screen.getByTestId('mcp-repair-preview')).toHaveTextContent('Recreate DNS.'));
    fireEvent.click(screen.getByTestId('mcp-repair-confirm'));
    await waitFor(() => expect(api.confirmLocalRepoMcpDiagnosticRepair).toHaveBeenCalledWith('repair-preview-1'));
  });
});
