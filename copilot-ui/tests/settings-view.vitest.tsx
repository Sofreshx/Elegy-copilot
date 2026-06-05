import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { navigationStore } from '../ui/src/stores/navigation';
import { codexProviderStore } from '../ui/src/stores/codexProviderStore';

const apiMocks = vi.hoisted(() => ({
  getCodexProviderStatus: vi.fn(),
  setCodexProviderMode: vi.fn(),
  resetCodexProvider: vi.fn(),
  getDeepseekStatus: vi.fn(),
  saveDeepseekSettings: vi.fn(),
  startDeepseekBridge: vi.fn(),
  stopDeepseekBridge: vi.fn(),
  checkDeepseekBridge: vi.fn(),
  getBootstrapStatus: vi.fn(),
  bootstrapMoonBridge: vi.fn(),
  getRemotePreference: vi.fn(),
  setRemotePreference: vi.fn(),
}));

vi.mock('../ui/src/lib/api/codexConfig', async () => {
  const actual = await vi.importActual('../ui/src/lib/api/codexConfig');
  return {
    ...actual,
    getCodexProviderStatus: apiMocks.getCodexProviderStatus,
    setCodexProviderMode: apiMocks.setCodexProviderMode,
    resetCodexProvider: apiMocks.resetCodexProvider,
    getDeepseekStatus: apiMocks.getDeepseekStatus,
    saveDeepseekSettings: apiMocks.saveDeepseekSettings,
    startDeepseekBridge: apiMocks.startDeepseekBridge,
    stopDeepseekBridge: apiMocks.stopDeepseekBridge,
    checkDeepseekBridge: apiMocks.checkDeepseekBridge,
    getBootstrapStatus: apiMocks.getBootstrapStatus,
    bootstrapMoonBridge: apiMocks.bootstrapMoonBridge,
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
      statePath: 'C:/Users/demo/.codex/.elegy-codex-provider-state.json',
      backupPath: 'C:/Users/demo/.codex/.elegy-codex-provider-backup.toml',
      exists: true,
      activeMode: 'native',
      providerId: 'openai',
      hasManagedBlock: false,
      hasBackup: true,
      gateway: {
        providerId: 'elegy',
        model: 'opencode-go',
        baseUrl: 'http://127.0.0.1:4318/v1',
        envKey: 'OPENCODE_GO_API_KEY',
      },
      deepseek: {
        bridgePath: null,
        bridgeConfigPath: null,
        bridgeUrl: 'http://127.0.0.1:38440/v1',
        keyConfigured: false,
        bridgeReachable: false,
        modelsVisible: false,
        bridgeBinaryAvailable: false,
      },
    });
    apiMocks.getDeepseekStatus.mockResolvedValue({
      bridgePath: null,
      bridgeConfigPath: null,
      bridgeUrl: 'http://127.0.0.1:38440/v1',
      keyConfigured: false,
      bridgeReachable: false,
      modelsVisible: false,
      bridgeBinaryAvailable: false,
    });
    apiMocks.setCodexProviderMode.mockImplementation(async (mode) => ({
      codexHome: 'C:/Users/demo/.codex',
      configPath: 'C:/Users/demo/.codex/config.toml',
      statePath: 'C:/Users/demo/.codex/.elegy-codex-provider-state.json',
      backupPath: 'C:/Users/demo/.codex/.elegy-codex-provider-backup.toml',
      exists: true,
      activeMode: mode,
      providerId: mode,
      hasManagedBlock: mode !== 'native',
      hasBackup: true,
      gateway: {
        providerId: 'elegy',
        model: 'opencode-go',
        baseUrl: 'http://127.0.0.1:4318/v1',
        envKey: 'OPENCODE_GO_API_KEY',
      },
      deepseek: {
        bridgePath: null,
        bridgeConfigPath: null,
        bridgeUrl: 'http://127.0.0.1:38440/v1',
        keyConfigured: false,
        bridgeReachable: false,
        modelsVisible: false,
        bridgeBinaryAvailable: false,
      },
    }));
    apiMocks.resetCodexProvider.mockResolvedValue({
      codexHome: 'C:/Users/demo/.codex',
      configPath: 'C:/Users/demo/.codex/config.toml',
      statePath: 'C:/Users/demo/.codex/.elegy-codex-provider-state.json',
      backupPath: 'C:/Users/demo/.codex/.elegy-codex-provider-backup.toml',
      exists: true,
      activeMode: 'native',
      providerId: 'openai',
      hasManagedBlock: false,
      hasBackup: true,
      gateway: {
        providerId: 'elegy',
        model: 'opencode-go',
        baseUrl: 'http://127.0.0.1:4318/v1',
        envKey: 'OPENCODE_GO_API_KEY',
      },
      deepseek: {
        bridgePath: null,
        bridgeConfigPath: null,
        bridgeUrl: 'http://127.0.0.1:38440/v1',
        keyConfigured: false,
        bridgeReachable: false,
        modelsVisible: false,
        bridgeBinaryAvailable: false,
      },
    });
    apiMocks.saveDeepseekSettings.mockResolvedValue({
      bridgePath: '/path/to/bridge.exe',
      bridgeUrl: 'http://127.0.0.1:38440/v1',
      keyConfigured: true,
      bridgeReachable: false,
      modelsVisible: false,
      bridgeBinaryAvailable: true,
    });
    // startDeepseekBridge returns full status with readiness fields,
    // matching the backend contract in routes/config.js:593-596
    apiMocks.startDeepseekBridge.mockResolvedValue({
      bridgePath: '/path/to/bridge.exe',
      bridgeConfigPath: '/path/to/config.yaml',
      bridgeUrl: 'http://127.0.0.1:38440/v1',
      keyConfigured: true,
      bridgeReachable: true,
      modelsVisible: true,
      bridgeBinaryAvailable: true,
      bridgeRunning: true,
      modelIds: ['deepseek-v4-pro', 'deepseek-v4-flash'],
      message: 'Moon Bridge started and ready.',
    });
    apiMocks.stopDeepseekBridge.mockResolvedValue({ bridgeRunning: false, message: 'Moon Bridge stopped.' });
    apiMocks.checkDeepseekBridge.mockResolvedValue({
      bridgeUrl: 'http://127.0.0.1:38440/v1',
      keyConfigured: true,
      bridgeReachable: true,
      modelsVisible: true,
      bridgeBinaryAvailable: true,
      bridgeRunning: true,
      modelIds: ['deepseek-v4-pro', 'deepseek-v4-flash'],
    });
    apiMocks.getRemotePreference.mockResolvedValue({ enabled: false });
    apiMocks.setRemotePreference.mockResolvedValue({ enabled: true });
    apiMocks.getBootstrapStatus.mockResolvedValue({
      installRoot: 'C:/Users/demo/.copilot/managed-cli/moon-bridge',
      sourceUrl: 'https://github.com/ZhiYi-R/moon-bridge.git',
      binaryPath: 'C:/Users/demo/.copilot/managed-cli/moon-bridge/bin/moon-bridge.exe',
      configPath: 'C:/Users/demo/.copilot/managed-cli/moon-bridge/config.yaml',
      gitAvailable: true,
      goAvailable: true,
      installed: false,
      built: false,
      lastBootstrapAt: null,
      lastError: null,
    });
    apiMocks.bootstrapMoonBridge.mockResolvedValue({
      success: true,
      message: 'Moon Bridge installed and built successfully.',
      status: {
        installRoot: 'C:/Users/demo/.copilot/managed-cli/moon-bridge',
        sourceUrl: 'https://github.com/ZhiYi-R/moon-bridge.git',
        binaryPath: 'C:/Users/demo/.copilot/managed-cli/moon-bridge/bin/moon-bridge.exe',
        configPath: 'C:/Users/demo/.copilot/managed-cli/moon-bridge/config.yaml',
        gitAvailable: true,
        goAvailable: true,
        installed: true,
        built: true,
        lastBootstrapAt: '2025-06-05T00:00:00.000Z',
        lastError: null,
      },
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '1.0.0', channel: 'dev', routeCount: 123 }),
    }));
  });

  it('renders Codex provider controls with three mode buttons', async () => {
    const { default: SettingsView } = await import('../ui/src/views/Settings/SettingsView');

    render(<SettingsView />);

    // Select Codex Providers nav item (default is 'app')
    await waitFor(() => {
      expect(screen.getByTestId('settings-nav-codex')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('settings-nav-codex'));

    await waitFor(() => {
      expect(screen.getByTestId('settings-codex-provider')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByTestId('codex-provider-mode-badge')).toHaveTextContent('Native Codex');
    });

    expect(screen.getByTestId('codex-provider-native')).toBeInTheDocument();
    expect(screen.getByTestId('codex-provider-elegy')).toBeInTheDocument();
    expect(screen.getByTestId('codex-provider-deepseek')).toBeInTheDocument();
  });

  it('renders DeepSeek fields when deepseek-bridge mode is active', async () => {
    const { default: SettingsView } = await import('../ui/src/views/Settings/SettingsView');

    render(<SettingsView />);

    // Select Codex Providers nav item (default is 'app')
    await waitFor(() => {
      expect(screen.getByTestId('settings-nav-codex')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('settings-nav-codex'));

    // Start in native mode; click the DeepSeek V4 button to switch to deepseek-bridge mode
    await waitFor(() => {
      expect(screen.getByTestId('codex-provider-mode-badge')).toHaveTextContent('Native Codex');
    });
    fireEvent.click(screen.getByTestId('codex-provider-deepseek'));
    await waitFor(() => {
      expect(screen.getByTestId('codex-provider-mode-badge')).toHaveTextContent('DeepSeek V4');
    });

    // Open Advanced section to reveal deepseek-bridge-path
    fireEvent.click(screen.getByTestId('deepseek-advanced-toggle'));

    expect(screen.getByTestId('deepseek-bridge-path')).toBeInTheDocument();
    expect(screen.getByTestId('deepseek-save-settings')).toBeInTheDocument();
    expect(screen.getByTestId('deepseek-start-bridge')).toBeInTheDocument();
    expect(screen.getByTestId('deepseek-stop-bridge')).toBeInTheDocument();
    expect(screen.getByTestId('deepseek-check-status')).toBeInTheDocument();
  });

  it('enables hard restore when a backup exists', async () => {
    const { default: SettingsView } = await import('../ui/src/views/Settings/SettingsView');

    render(<SettingsView />);

    // Select Codex Providers nav item (default is 'app')
    await waitFor(() => {
      expect(screen.getByTestId('settings-nav-codex')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('settings-nav-codex'));

    // Open Advanced section to reveal the hard-reset button
    await waitFor(() => {
      expect(screen.getByTestId('deepseek-advanced-toggle')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('deepseek-advanced-toggle'));

    await waitFor(() => {
      expect(screen.getByTestId('codex-provider-hard-reset')).not.toBeDisabled();
    });

    fireEvent.click(screen.getByTestId('codex-provider-hard-reset'));

    await waitFor(() => {
      expect(apiMocks.resetCodexProvider).toHaveBeenCalledWith(true);
    });
  });

  it('startBridge merges bridgeReachable and modelsVisible so activate enables without Check Status', async () => {
    // Set up native-mode status first, then simulate guided deepseek flow
    const { default: SettingsView } = await import('../ui/src/views/Settings/SettingsView');

    render(<SettingsView />);

    // Navigate to Codex Providers
    await waitFor(() => {
      expect(screen.getByTestId('settings-nav-codex')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('settings-nav-codex'));

    // Verify initial state: deepseek section visible, activate not present in native mode
    await waitFor(() => {
      expect(screen.getByTestId('codex-provider-mode-badge')).toHaveTextContent('Native Codex');
    });

    // Click Start Bridge — the mock returns bridgeReachable: true, modelsVisible: true
    fireEvent.click(screen.getByTestId('deepseek-start-bridge'));

    // After start, the store should have merged bridgeReachable and modelsVisible
    // into deepseekStatus. The mock also returns bridgeBinaryAvailable: true, keyConfigured: true.
    await waitFor(() => {
      expect(apiMocks.startDeepseekBridge).toHaveBeenCalled();
    });

    // The activate button should become enabled because prereqsMet now includes
    // bridgeRunning, bridgeReachable, and modelsVisible from the start response.
    await waitFor(() => {
      const activateBtn = screen.getByTestId('deepseek-activate');
      expect(activateBtn).not.toBeDisabled();
    });
  });
});
