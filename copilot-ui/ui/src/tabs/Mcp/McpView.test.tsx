import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import McpView from './McpView';

const api = vi.hoisted(() => ({
  addLocalRepoMcpRoot: vi.fn(),
  getCatalogRepos: vi.fn(),
  getLocalRepoMcpConfig: vi.fn(),
  getLocalRepoMcpStatus: vi.fn(),
  probeLocalRepoMcp: vi.fn(),
  registerCatalogRepo: vi.fn(),
  removeLocalRepoMcpRoot: vi.fn(),
  saveLocalRepoMcpConfig: vi.fn(),
  startLocalRepoMcp: vi.fn(),
  startLocalRepoMcpQuickTunnel: vi.fn(),
  startLocalRepoMcpTunnel: vi.fn(),
  stopLocalRepoMcp: vi.fn(),
  stopLocalRepoMcpTunnel: vi.fn(),
}));

vi.mock('../../lib/api', () => api);

const config = {
  port: 3333,
  publicBaseUrl: 'https://mcp.example.com',
  authIssuer: 'https://tenant.auth0.com/',
  authAudience: 'https://mcp.example.com',
  requiredScopes: ['repo:read'],
  cloudflareTunnelName: 'local-repo-mcp',
  cloudflareConfigPath: '',
  cloudflaredPath: '',
};

function mockReady(overrides: Record<string, unknown> = {}) {
  const status = {
    config,
    server: { running: false, pid: null, url: 'http://127.0.0.1:3333/mcp' },
    tunnel: { running: false, pid: null, publicUrl: 'https://mcp.example.com/mcp' },
    securityState: 'Stopped',
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
}

function mockMissingOAuth() {
  const missingConfig = {
    ...config,
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
  });
  api.getLocalRepoMcpConfig.mockResolvedValue({
    config: missingConfig,
    access: { repos: [] },
  });
  api.getCatalogRepos.mockResolvedValue({ repos: [] });
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
  });
  api.getLocalRepoMcpConfig.mockResolvedValue({
    config: issuerOnlyConfig,
    access: { repos: [] },
  });
  api.getCatalogRepos.mockResolvedValue({ repos: [] });
}

describe('McpView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReady();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders loading state while provider data is pending', () => {
    api.getLocalRepoMcpStatus.mockReturnValue(new Promise<never>(() => {}));
    api.getLocalRepoMcpConfig.mockReturnValue(new Promise<never>(() => {}));
    api.getCatalogRepos.mockReturnValue(new Promise<never>(() => {}));

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
    expect(screen.getByText('https://mcp.example.com/mcp')).toBeInTheDocument();
    expect(screen.getByTestId('mcp-readable-root-count')).toHaveTextContent('1 enabled');
  });

  it('shows OAuth protected state when server and tunnel are running', async () => {
    mockReady({
      server: { running: true, pid: 1, url: 'http://127.0.0.1:3333/mcp' },
      tunnel: { running: true, pid: 2, publicUrl: 'https://mcp.example.com/mcp' },
      securityState: 'OAuth protected',
    });

    render(<McpView />);

    await waitFor(() => {
      expect(screen.getByTestId('mcp-exposure-status')).toHaveTextContent('OAuth protected');
    });
  });

  it('allows local start before OAuth is configured', async () => {
    mockMissingOAuth();

    render(<McpView />);

    await waitFor(() => {
      expect(screen.getByTestId('mcp-start')).toBeInTheDocument();
    });

    expect(screen.getByTestId('mcp-start')).not.toBeDisabled();
    expect(screen.getByTestId('mcp-quick-tunnel-start')).toBeDisabled();
    expect(screen.getByText('Start local MCP, then start ChatGPT access to generate a connector URL.')).toBeInTheDocument();
  });

  it('allows ChatGPT access with issuer-only OAuth setup', async () => {
    mockIssuerOnly();

    render(<McpView />);

    await waitFor(() => {
      expect(screen.getByTestId('mcp-quick-tunnel-start')).toBeInTheDocument();
    });

    expect(screen.getByTestId('mcp-quick-tunnel-start')).not.toBeDisabled();
  });

  it('renders generated quick tunnel connector URL', async () => {
    mockReady({
      connectorUrl: 'https://sample.trycloudflare.com/mcp',
      server: { running: true, pid: 1, url: 'http://127.0.0.1:3333/mcp' },
      tunnel: { running: true, pid: 2, mode: 'quick', publicUrl: 'https://sample.trycloudflare.com/mcp' },
      securityState: 'OAuth protected',
    });

    render(<McpView />);

    await waitFor(() => {
      expect(screen.getByText('https://sample.trycloudflare.com/mcp')).toBeInTheDocument();
    });

    expect(screen.getByTestId('mcp-provider-copy-url')).toBeInTheDocument();
  });

  it('opens and closes the provider configuration modal', async () => {
    render(<McpView />);

    await waitFor(() => {
      expect(screen.getByTestId('mcp-configure')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('mcp-configure'));

    expect(screen.getByTestId('mcp-config-modal')).toBeInTheDocument();
    expect(screen.getByTestId('mcp-config-root-status-instruction-engine')).toHaveTextContent('enabled');

    fireEvent.click(screen.getByTestId('mcp-config-modal-close'));

    await waitFor(() => {
      expect(screen.queryByTestId('mcp-config-modal')).not.toBeInTheDocument();
    });
  });

  it('shows generated ChatGPT connection values in primary configuration', async () => {
    const quickConfig = {
      ...config,
      publicBaseUrl: '',
      authAudience: '',
      cloudflareTunnelName: '',
    };
    mockReady({
      config: quickConfig,
      connectorUrl: 'https://sample.trycloudflare.com/mcp',
      server: { running: true, pid: 1, url: 'http://127.0.0.1:3333/mcp' },
      tunnel: { running: true, pid: 2, mode: 'quick', publicUrl: 'https://sample.trycloudflare.com/mcp' },
      securityState: 'OAuth protected',
    });
    api.getLocalRepoMcpConfig.mockResolvedValue({
      config: quickConfig,
      access: { repos: [] },
    });

    render(<McpView />);

    await waitFor(() => {
      expect(screen.getByTestId('mcp-configure')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('mcp-configure'));

    const primaryConfig = within(screen.getByTestId('mcp-config-auth'));
    expect(primaryConfig.getAllByText('https://sample.trycloudflare.com/mcp').length).toBeGreaterThan(0);
    expect(primaryConfig.getByText('https://sample.trycloudflare.com')).toBeInTheDocument();
    expect(primaryConfig.getByText('repo:read')).toBeInTheDocument();
    expect(screen.getByTestId('mcp-config-advanced')).toBeInTheDocument();
  });
});
