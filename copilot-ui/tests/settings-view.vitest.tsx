import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { navigationStore } from '../ui/src/stores/navigation';
import { remotePreferenceStore } from '../ui/src/stores/remotePreferenceStore';
import { codexProviderStore } from '../ui/src/stores/codexProviderStore';

const apiMocks = vi.hoisted(() => ({
  getCodexProviderStatus: vi.fn(),
  setCodexProviderMode: vi.fn(),
  resetCodexProvider: vi.fn(),
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
    remotePreferenceStore.setState(() => ({
      enabled: false,
      loading: false,
      saving: false,
      error: null,
      warning: null,
    }));
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
    });
    apiMocks.getRemotePreference.mockResolvedValue({ enabled: false });
    apiMocks.setRemotePreference.mockResolvedValue({ enabled: true });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '1.0.0', channel: 'dev', routeCount: 123 }),
    }));
  });

  it('renders Codex provider controls and switches to Elegy routed mode', async () => {
    const { default: SettingsView } = await import('../ui/src/views/Settings/SettingsView');

    render(<SettingsView />);

    await waitFor(() => {
      expect(screen.getByTestId('settings-codex-provider')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByTestId('codex-provider-mode-badge')).toHaveTextContent('Native Codex');
    });

    fireEvent.click(screen.getByTestId('codex-provider-elegy'));

    await waitFor(() => {
      expect(apiMocks.setCodexProviderMode).toHaveBeenCalledWith('elegy-routed');
    });
    await waitFor(() => {
      expect(screen.getByTestId('codex-provider-mode-badge')).toHaveTextContent('Elegy Routed');
    });
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
