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
    apiMocks.setCodexProviderMode.mockResolvedValue({
      codexHome: 'C:/Users/demo/.codex',
      configPath: 'C:/Users/demo/.codex/config.toml',
      statePath: 'C:/Users/demo/.codex/.elegy-codex-provider-state.json',
      backupPath: 'C:/Users/demo/.codex/.elegy-codex-provider-backup.toml',
      exists: true,
      activeMode: 'elegy-routed',
      providerId: 'elegy',
      hasManagedBlock: true,
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
    apiMocks.startDeepseekBridge.mockResolvedValue({ bridgeRunning: true, message: 'Moon Bridge started.' });
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
    apiMocks.getCodexProviderStatus.mockResolvedValue({
      codexHome: 'C:/Users/demo/.codex',
      configPath: 'C:/Users/demo/.codex/config.toml',
      statePath: 'C:/Users/demo/.codex/.elegy-codex-provider-state.json',
      backupPath: 'C:/Users/demo/.codex/.elegy-codex-provider-backup.toml',
      exists: true,
      activeMode: 'deepseek-bridge',
      providerId: 'instruction_engine_deepseek',
      hasManagedBlock: true,
      hasBackup: true,
      gateway: {
        providerId: 'instruction_engine_deepseek',
        model: 'deepseek-v4-pro',
        baseUrl: 'http://127.0.0.1:38440/v1',
        envKey: 'MOON_BRIDGE_DEEPSEEK_TOKEN',
      },
      deepseek: {
        bridgePath: '/path/to/bridge.exe',
        bridgeUrl: 'http://127.0.0.1:38440/v1',
        keyConfigured: true,
        bridgeReachable: true,
        modelsVisible: true,
        bridgeBinaryAvailable: true,
      },
    });

    const { default: SettingsView } = await import('../ui/src/views/Settings/SettingsView');

    render(<SettingsView />);

    await waitFor(() => {
      expect(screen.getByTestId('codex-provider-mode-badge')).toHaveTextContent('DeepSeek V4');
    });

    expect(screen.getByTestId('deepseek-bridge-path')).toBeInTheDocument();
    expect(screen.getByTestId('deepseek-save-settings')).toBeInTheDocument();
    expect(screen.getByTestId('deepseek-start-bridge')).toBeInTheDocument();
    expect(screen.getByTestId('deepseek-stop-bridge')).toBeInTheDocument();
    expect(screen.getByTestId('deepseek-check-status')).toBeInTheDocument();
  });

  it('enables hard restore when a backup exists', async () => {
    const { default: SettingsView } = await import('../ui/src/views/Settings/SettingsView');

    render(<SettingsView />);

    await waitFor(() => {
      expect(screen.getByTestId('codex-provider-hard-reset')).not.toBeDisabled();
    });

    fireEvent.click(screen.getByTestId('codex-provider-hard-reset'));

    await waitFor(() => {
      expect(apiMocks.resetCodexProvider).toHaveBeenCalledWith(true);
    });
  });
});
