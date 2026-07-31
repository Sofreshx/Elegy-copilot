import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { navigationStore } from '../ui/src/stores/navigation';
import { codexProviderStore } from '../ui/src/stores/codexProviderStore';

const apiMocks = vi.hoisted(() => ({
  getCodexProviderStatus: vi.fn(),
  getCodexCliStatus: vi.fn(),
  installCodexCli: vi.fn(),
  getCodexSubagents: vi.fn(),
  getCodexSubagentUsage: vi.fn(),
  getRemotePreference: vi.fn(),
  setRemotePreference: vi.fn(),
}));

vi.mock('../ui/src/lib/api/codexConfig', async () => {
  const actual = await vi.importActual('../ui/src/lib/api/codexConfig');
  return {
    ...actual,
    getCodexProviderStatus: apiMocks.getCodexProviderStatus,
    getCodexCliStatus: apiMocks.getCodexCliStatus,
    installCodexCli: apiMocks.installCodexCli,
    getCodexSubagents: apiMocks.getCodexSubagents,
    getCodexSubagentUsage: apiMocks.getCodexSubagentUsage,
  };
});

vi.mock('../ui/src/lib/api/sdk', async () => {
  const actual = await vi.importActual('../ui/src/lib/api/sdk');
  return {
    ...actual,
    getRemotePreference: apiMocks.getRemotePreference,
    setRemotePreference: apiMocks.setRemotePreference,
  };
});

describe('SettingsView', () => {
  beforeEach(() => {
    navigationStore.reset();
    codexProviderStore.resetState();
    Object.values(apiMocks).forEach((mock) => mock.mockReset());

    apiMocks.getCodexProviderStatus.mockResolvedValue({
      codexHome: 'C:/Users/demo/.codex',
      configPath: 'C:/Users/demo/.codex/config.toml',
      backupPath: null,
      exists: true,
      activeMode: 'native',
      providerId: 'openai',
      hasLegacyBlock: false,
      hasBackup: false,
    });
    apiMocks.getCodexCliStatus.mockResolvedValue({
      codexHome: 'C:/Users/demo/.codex',
      cli: { installed: true, version: '0.1.0', installCommand: 'codex', lastError: null },
    });
    apiMocks.installCodexCli.mockResolvedValue({ ok: true, version: '0.1.0' });
    apiMocks.getRemotePreference.mockResolvedValue({ enabled: false });
    apiMocks.setRemotePreference.mockResolvedValue({ enabled: true });
    apiMocks.getCodexSubagents.mockResolvedValue({
      codexHome: 'C:/Users/demo/.codex',
      agentsDir: 'C:/Users/demo/.codex/agents',
      inventoryPath: 'C:/Users/demo/.codex/.elegy-copilot-codex-managed.json',
      settings: {
        routingMode: 'manual',
        maxThreads: 3,
        maxDepth: 1,
        jobMaxRuntimeSeconds: 1800,
        telemetryRetentionDays: 90,
        settingsPath: 'C:/Users/demo/.codex/.elegy-copilot-codex-subagents.json',
      },
      nativeConfig: {
        path: 'C:/Users/demo/.codex/config.toml',
        changed: false,
        parseError: null,
        values: { maxThreads: 3, maxDepth: 1, jobMaxRuntimeSeconds: 1800 },
        matchesSettings: true,
      },
      summary: {
        managed: 4,
        installed: 3,
        missing: 1,
        drifted: 1,
        invalid: 0,
        usable: 3,
        disabled: 0,
        project: 0,
        routingMode: 'manual',
        maxThreads: 3,
        maxDepth: 1,
        nativeConfigSynced: true,
      },
      agents: [
        {
          name: 'explorer',
          description: 'Read-only exploration agent.',
          model: 'gpt-5.4-mini',
          modelReasoningEffort: 'low',
          sandboxMode: 'read-only',
          routingMode: 'manual',
          fastModel: 'gpt-5.3-codex-spark',
          allowSpark: true,
          toolScopeNote: 'Read-only sandbox is enforced.',
          managed: true,
          scope: 'global',
          missing: false,
          drift: false,
          operationalStatus: 'ready',
          usable: true,
          parseError: null,
          sourcePath: 'repo/codex-assets/agents/explorer.toml',
          installedPath: 'C:/Users/demo/.codex/agents/explorer.toml',
          content: 'developer_instructions = """explore"""',
          capabilities: { enforced: ['sandbox:read-only'], configured: ['model:gpt-5.4-mini'], inherited: [], observed: [] },
          usageSummary: { runs: 2, tokens: 1200, toolEvents: 8, errors: 0 },
        },
        {
          name: 'test-runner',
          description: 'Command-only validation agent.',
          model: 'gpt-5.4-mini',
          modelReasoningEffort: 'medium',
          sandboxMode: 'workspace-write',
          routingMode: 'manual',
          fastModel: null,
          allowSpark: false,
          toolScopeNote: 'Validation commands only.',
          managed: true,
          scope: 'global',
          missing: true,
          drift: false,
          operationalStatus: 'missing',
          usable: false,
          parseError: null,
          sourcePath: 'repo/codex-assets/agents/test-runner.toml',
          installedPath: null,
          content: 'developer_instructions = """test"""',
          capabilities: { enforced: ['sandbox:workspace-write'], configured: ['model:gpt-5.4-mini'], inherited: [], observed: [] },
          usageSummary: { runs: 0, tokens: 0, toolEvents: 0, errors: 0 },
        },
      ],
      projectAgents: [],
      capabilityLegend: {
        enforced: 'Codex/app setting prevents access.',
        configured: 'Agent TOML requests this behavior.',
        inherited: 'Parent Codex session may still provide this capability.',
        observed: 'Local telemetry saw this agent use it.',
      },
    });
    apiMocks.getCodexSubagentUsage.mockResolvedValue({
      generatedAt: '2026-07-06T00:00:00.000Z',
      coverage: 'codex-state-plus-rollouts',
      source: { kind: 'codex-state', path: 'C:/Users/demo/.codex/state_5.sqlite' },
      summary: { runs: 2, tokens: 1200, toolEvents: 8, errors: 0 },
      byAgent: [{ name: 'explorer', count: 2, tokens: 1200, toolEvents: 8, errors: 0 }],
      runs: [],
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '1.0.0', channel: 'dev', routeCount: 123 }),
    }));
  });

  it('renders native Codex settings without legacy provider controls', async () => {
    navigationStore.setSettingsSection('codex');
    const { default: SettingsView } = await import('../ui/src/views/Settings/SettingsView');

    await act(async () => {
      render(<SettingsView />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('codex-native-status')).toBeInTheDocument();
    });

    expect(screen.getByTestId('codex-agents-expectation-values')).toHaveTextContent('6');
    expect(screen.getByTestId('codex-agents-expectation-values')).toHaveTextContent('gpt-5.6-luna');
    expect(screen.getByTestId('codex-agents-expectation-values')).toHaveTextContent('1800s');
    expect(screen.queryByText(/Moon Bridge|DeepSeek|OpenCode Worker|Native Go/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('codex-tab-assets')).toBeInTheDocument();
  });

  it('surfaces a blocking migration warning for legacy Codex provider state', async () => {
    apiMocks.getCodexProviderStatus.mockResolvedValueOnce({
      codexHome: 'C:/Users/demo/.codex',
      configPath: 'C:/Users/demo/.codex/config.toml',
      backupPath: null,
      exists: true,
      activeMode: 'native',
      providerId: 'openai',
      hasLegacyBlock: true,
      hasBackup: false,
      legacyMigration: {
        required: true,
        action: 'Run the Codex installer to remove known Elegy legacy provider blocks.',
      },
    });
    navigationStore.setSettingsSection('codex');
    const { default: SettingsView } = await import('../ui/src/views/Settings/SettingsView');

    await act(async () => {
      render(<SettingsView />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('codex-legacy-migration-warning')).toBeInTheDocument();
    });
    expect(screen.getByTestId('codex-legacy-migration-warning')).toHaveTextContent(/migration required/i);
    expect(screen.getByTestId('codex-legacy-migration-warning')).toHaveTextContent(/Run the Codex installer/i);
  });

  it('shows the four Codex marketplace plugins as read-only status', async () => {
    navigationStore.setSettingsSection('codex');
    const { default: SettingsView } = await import('../ui/src/views/Settings/SettingsView');

    await act(async () => {
      render(<SettingsView />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('codex-plugin-status')).toBeInTheDocument();
    });
    for (const plugin of ['elegy-documentation', 'elegy-mcp', 'elegy-checks', 'elegy-planning']) {
      expect(screen.getByTestId(`codex-plugin-${plugin}`)).toHaveTextContent('Marketplace-managed · read-only');
    }
    expect(screen.getByTestId('codex-plugin-elegy-planning')).toHaveTextContent('Direct Codex subagent/workflow plugin');
  });

  it('mounts the dedicated Codex Assets tab with status-only inventory', async () => {
    navigationStore.setSettingsSection('codex');
    const { default: SettingsView } = await import('../ui/src/views/Settings/SettingsView');

    await act(async () => {
      render(<SettingsView />);
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Assets' }));
    await waitFor(() => {
      expect(screen.getByTestId('harness-assets-panel-codex')).toBeInTheDocument();
    });
    expect(screen.getByTestId('harness-assets-refresh-codex')).toBeInTheDocument();
  });

  it('renders native Codex subagents as read-only rows', async () => {
    navigationStore.setSettingsSection('codex');
    const { default: SettingsView } = await import('../ui/src/views/Settings/SettingsView');

    await act(async () => {
      render(<SettingsView />);
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Subagents' }));

    await waitFor(() => {
      expect(apiMocks.getCodexSubagents).toHaveBeenCalled();
      expect(screen.getByTestId('codex-subagents-panel')).toBeInTheDocument();
    });

    expect(screen.getByTestId('codex-agent-explorer')).toHaveTextContent('Harness-owned · read-only');
    expect(screen.getByTestId('codex-agent-test-runner')).toHaveTextContent('Harness-owned · read-only');
    expect(screen.queryByText(/Native Go|DeepSeek|OpenCode Worker/i)).not.toBeInTheDocument();
  });

  it('renders all settings nav items from the shared SETTINGS_NAV_ITEMS list', async () => {
    const { default: SettingsView } = await import('../ui/src/views/Settings/SettingsView');
    const { SETTINGS_NAV_ITEMS } = await import('../ui/src/stores/navigation');

    await act(async () => {
      render(<SettingsView />);
    });

    // Verify nav container exists
    const nav = screen.getByTestId('settings-nav');
    expect(nav).toBeInTheDocument();

    // Verify all nav items are rendered from the shared list
    for (const item of SETTINGS_NAV_ITEMS) {
      const navItem = screen.getByTestId(`settings-nav-${item.id}`);
      expect(navItem).toBeInTheDocument();
      expect(navItem.textContent).toContain(item.label);
    }
  });

  it('renders telemetry settings with harness tabs', async () => {
    navigationStore.setSettingsSection('telemetry');
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/telemetry/harnesses')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            generatedAt: '2026-06-15T12:00:00.000Z',
            harnesses: {
              opencode: {
                id: 'opencode',
                label: 'OpenCode',
                source: { kind: 'log-files', path: 'C:/Users/demo/.local/share/opencode/log', openTelemetry: true },
                coverage: 'sampled-log-files',
                sample: { limit: 200, logFiles: 1, sampledLines: 3, deterministic: true },
                summary: { requests: 1, sampledRequests: 1, errors: 1, toolEvents: 1, sessions: null },
                providerUsage: { providers: [], topModels: [], topAgents: [] },
                topTools: [{ name: 'shell_command', count: 1 }],
                errorsByType: [{ name: 'permission', count: 1 }],
                recentErrors: [
                  { timestamp: '2026-06-15T12:00:01Z', type: 'permission', source: 'demo.log', message: 'permission denied' },
                ],
                recentEvents: [
                  { timestamp: '2026-06-15T12:00:00Z', type: 'tool', source: 'demo.log', label: 'shell_command', message: 'tool call' },
                ],
              },
              codex: {
                id: 'codex',
                label: 'Codex',
                source: { kind: 'session-index', path: 'C:/Users/demo/.codex/session_index.jsonl' },
                coverage: 'session-index-only',
                sample: { limit: 200, logFiles: 0, sampledLines: 0, deterministic: true },
                summary: { requests: null, sampledRequests: null, errors: 0, toolEvents: 0, sessions: 2 },
                providerUsage: { providers: [], topModels: [], topAgents: [] },
                topTools: [],
                errorsByType: [],
                recentErrors: [],
                recentEvents: [],
              },
            },
          }),
          text: async () => '',
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ version: '1.0.0', channel: 'dev', routeCount: 123 }),
        text: async () => '',
      } as Response;
    });

    const { default: SettingsView } = await import('../ui/src/views/Settings/SettingsView');

    await act(async () => {
      render(<SettingsView />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('telemetry-settings-view')).toBeInTheDocument();
    });

    expect(screen.getByTestId('telemetry-tab-opencode')).toBeInTheDocument();
    expect(screen.getByTestId('telemetry-tab-codex')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('shell_command')).toBeInTheDocument();
    });
    expect(screen.getByText('Enabled')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('telemetry-filter-errors'));
    await waitFor(() => {
      expect(screen.getByText(/permission denied/i)).toBeInTheDocument();
    });
  });

  it('renders static toolbar for settings', async () => {
    const { default: SettingsView } = await import('../ui/src/views/Settings/SettingsView');

    await act(async () => {
      render(<SettingsView />);
    });

    // The sticky toolbar wrapper should be present
    const stickyToolbar = screen.getByTestId('settings-sticky-toolbar');
    expect(stickyToolbar).toBeInTheDocument();
    expect(stickyToolbar.className).toContain('view-static');
  });

  it('settings nav uses SETTINGS_NAV_ITEMS, not a local duplicate', async () => {
    // Import the module and verify it doesn't export a local SETTINGS_SECTIONS constant
    const mod = await import('../ui/src/views/Settings/SettingsView');
    // The module should not have a SETTINGS_SECTIONS export (it was removed)
    expect((mod as any).SETTINGS_SECTIONS).toBeUndefined();
  });

  describe('layout contract', () => {
    it('renders settings-content as a scroll region (view-scroll class)', async () => {
      const { default: SettingsView } = await import('../ui/src/views/Settings/SettingsView');

      await act(async () => {
        render(<SettingsView />);
      });

      const content = screen.getByTestId('settings-content');
      expect(content).toBeInTheDocument();
      expect(content.className).toContain('view-scroll');
    });

    it('keeps toolbar outside the scroll content region', async () => {
      const { default: SettingsView } = await import('../ui/src/views/Settings/SettingsView');

      await act(async () => {
        render(<SettingsView />);
      });

      const toolbar = screen.getByTestId('settings-sticky-toolbar');
      const content = screen.getByTestId('settings-content');

      // The toolbar should NOT be inside the scrollable settings-content
      expect(content.contains(toolbar)).toBe(false);

      // The toolbar should be a view-static region
      expect(toolbar.className).toContain('view-static');
    });

    it('keeps settings nav outside the scroll content region', async () => {
      const { default: SettingsView } = await import('../ui/src/views/Settings/SettingsView');

      await act(async () => {
        render(<SettingsView />);
      });

      const nav = screen.getByTestId('settings-nav');
      const content = screen.getByTestId('settings-content');

      // The nav should NOT be inside the scrollable settings-content
      expect(content.contains(nav)).toBe(false);
    });
  });
});
