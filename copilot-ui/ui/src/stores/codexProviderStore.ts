import { createStore } from '../lib/store';
import {
  checkDeepseekBridge,
  getCodexProviderStatus,
  getDeepseekStatus,
  getBootstrapStatus,
  getCodexCliStatus,
  bootstrapMoonBridge,
  resetCodexProvider,
  saveDeepseekSettings,
  setCodexProviderMode,
  startDeepseekBridge,
  stopDeepseekBridge,
  factoryResetCodexProvider,
  reinstallCodexSurface,
  type DeepseekSettingsPayload,
} from '../lib/api/codexConfig';
import type { CodexProviderDeepseekStatus, CodexProviderStatusResponse, MoonBridgeBootstrapStatus } from '../lib/types';

export interface CodexProviderState {
  status: CodexProviderStatusResponse | null;
  deepseekStatus: CodexProviderDeepseekStatus | null;
  bootstrapStatus: MoonBridgeBootstrapStatus | null;
  loading: boolean;
  saving: boolean;
  bridgeLoading: boolean;
  bootstrapLoading: boolean;
  installingCli: boolean;
  cliStatus: { installed: boolean; version: string | null; installCommand: string; lastError: string | null } | null;
  error: string | null;
  message: string | null;
}

const INITIAL_STATE: CodexProviderState = {
  status: null,
  deepseekStatus: null,
  bootstrapStatus: null,
  loading: false,
  saving: false,
  bridgeLoading: false,
  bootstrapLoading: false,
  installingCli: false,
  cliStatus: null,
  error: null,
  message: null,
};

function createCodexProviderStore() {
  const store = createStore<CodexProviderState>(INITIAL_STATE);

  async function load(): Promise<void> {
    store.setState((state) => ({ ...state, loading: true, error: null }));
    try {
      const [status, dsStatus, bootstrapStatus, cliStatusResult] = await Promise.all([
        getCodexProviderStatus(),
        getDeepseekStatus().catch(() => null),
        getBootstrapStatus().catch(() => null),
        getCodexCliStatus().catch(() => null),
      ]);
      store.setState((state) => ({
        ...state,
        status,
        deepseekStatus: dsStatus,
        bootstrapStatus,
        cliStatus: cliStatusResult?.cli || state.cliStatus,
        loading: false,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load Codex provider status';
      store.setState((state) => ({ ...state, loading: false, error: message }));
    }
  }

  async function setMode(mode: 'native' | 'deepseek-bridge'): Promise<void> {
    store.setState((state) => ({ ...state, saving: true, error: null, message: null }));
    try {
      const status = await setCodexProviderMode(mode);
      store.setState((state) => ({
        ...state,
        status,
        saving: false,
        message: mode === 'deepseek-bridge'
          ? 'Codex now defaults to DeepSeek V4 via Moon Bridge.'
          : 'Codex provider returned to native defaults.',
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update Codex provider';
      store.setState((state) => ({ ...state, saving: false, error: message }));
    }
  }

  async function reset(hard = false): Promise<void> {
    store.setState((state) => ({ ...state, saving: true, error: null, message: null }));
    try {
      const status = await resetCodexProvider(hard);
      store.setState((state) => ({
        ...state,
        status,
        saving: false,
        message: hard
          ? 'Codex config restored from the pre-Elegy backup snapshot.'
          : 'Removed Elegy-managed Codex provider settings from config.',
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reset Codex provider';
      store.setState((state) => ({ ...state, saving: false, error: message }));
    }
  }

  async function factoryReset(): Promise<void> {
    store.setState((state) => ({ ...state, saving: true, error: null, message: null }));
    try {
      const status = await factoryResetCodexProvider();
      store.setState((state) => ({
        ...state,
        status,
        saving: false,
        message: 'Codex config factory reset complete. All Elegy-managed settings removed.',
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to factory-reset Codex provider';
      store.setState((state) => ({ ...state, saving: false, error: message }));
    }
  }

  async function reinstallSurface(): Promise<void> {
    store.setState((state) => ({ ...state, saving: true, error: null, message: null }));
    try {
      await reinstallCodexSurface();
      // After reinstalling, switch to native mode for a clean starting point
      await setMode('native');
      await load(); // Refresh full status after mode switch
      store.setState((state) => ({
        ...state,
        saving: false,
        message: 'Codex surface reinstalled and set to native mode.',
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reinstall Codex surface';
      store.setState((state) => ({ ...state, saving: false, error: message }));
    }
  }

  async function saveDeepseek(settings: DeepseekSettingsPayload): Promise<void> {
    store.setState((state) => ({ ...state, saving: true, error: null, message: null }));
    try {
      const dsStatus = await saveDeepseekSettings(settings);
      store.setState((state) => ({
        ...state,
        deepseekStatus: dsStatus,
        saving: false,
        message: 'DeepSeek settings saved.',
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save DeepSeek settings';
      store.setState((state) => ({ ...state, saving: false, error: message }));
    }
  }

  async function startBridge(): Promise<void> {
    store.setState((state) => ({ ...state, bridgeLoading: true, error: null }));
    try {
      const result = await startDeepseekBridge();
      store.setState((state) => ({
        ...state,
        deepseekStatus: state.deepseekStatus
          ? { ...state.deepseekStatus, ...result }
          : result,
        bridgeLoading: false,
        message: result.message,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start Moon Bridge';
      store.setState((state) => ({ ...state, bridgeLoading: false, error: message }));
    }
  }

  async function stopBridge(): Promise<void> {
    store.setState((state) => ({ ...state, bridgeLoading: true, error: null }));
    try {
      const result = await stopDeepseekBridge();
      store.setState((state) => ({
        ...state,
        deepseekStatus: state.deepseekStatus
          ? { ...state.deepseekStatus, bridgeRunning: result.bridgeRunning }
          : null,
        bridgeLoading: false,
        message: result.message,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to stop Moon Bridge';
      store.setState((state) => ({ ...state, bridgeLoading: false, error: message }));
    }
  }

  async function checkBridge(): Promise<void> {
    store.setState((state) => ({ ...state, bridgeLoading: true, error: null }));
    try {
      const dsStatus = await checkDeepseekBridge();
      store.setState((state) => ({
        ...state,
        deepseekStatus: dsStatus,
        bridgeLoading: false,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to check Moon Bridge status';
      store.setState((state) => ({ ...state, bridgeLoading: false, error: message }));
    }
  }

  async function fetchBootstrapStatus(): Promise<void> {
    store.setState((state) => ({ ...state, bridgeLoading: true, error: null }));
    try {
      const bootstrapStatus = await getBootstrapStatus();
      store.setState((state) => ({
        ...state,
        bootstrapStatus,
        bridgeLoading: false,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch Moon Bridge bootstrap status';
      store.setState((state) => ({ ...state, bridgeLoading: false, error: message }));
    }
  }

  async function bootstrap(): Promise<void> {
    store.setState((state) => ({ ...state, bootstrapLoading: true, error: null, message: null }));
    try {
      const result = await bootstrapMoonBridge({ forceRebuild: false });
      store.setState((state) => ({
        ...state,
        bootstrapStatus: result.status,
        bootstrapLoading: false,
        message: result.success
          ? result.message || 'Moon Bridge installed and built.'
          : result.error || 'Moon Bridge bootstrap failed.',
      }));
      // Re-read DeepSeek status so bridgeBinaryAvailable reflects the managed binary
      if (result.success) {
        try {
          const dsStatus = await getDeepseekStatus();
          store.setState((prev) => ({ ...prev, deepseekStatus: dsStatus }));
        } catch {
          // best-effort refresh
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to bootstrap Moon Bridge';
      store.setState((state) => ({ ...state, bootstrapLoading: false, error: message }));
    }
  }

  async function loadCliStatus(): Promise<void> {
    try {
      const result = await getCodexCliStatus();
      store.setState((state) => ({
        ...state,
        cliStatus: result.cli || null,
      }));
    } catch {
      // best-effort, CLI status is non-critical
    }
  }

  async function installCodexCli(): Promise<void> {
    store.setState((state) => ({ ...state, installingCli: true, error: null, message: null }));
    try {
      const { installCodexCli: apiInstall } = await import('../lib/api/codexConfig');
      const response = await apiInstall();
      if (response.ok) {
        store.setState((state) => ({
          ...state,
          installingCli: false,
          message: 'Codex CLI installed successfully.',
          cliStatus: response.cli || null,
        }));
      } else {
        store.setState((state) => ({
          ...state,
          installingCli: false,
          error: response.error || 'Failed to install Codex CLI.',
        }));
      }
    } catch (error) {
      store.setState((state) => ({
        ...state,
        installingCli: false,
        error: error instanceof Error ? error.message : 'An unexpected error occurred.',
      }));
    }
  }

  function resetState(): void {
    store.setState(() => ({ ...INITIAL_STATE }));
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    setState: store.setState,
    load,
    setMode,
    reset,
    factoryReset,
    reinstallSurface,
    saveDeepseek,
    startBridge,
    stopBridge,
    checkBridge,
    fetchBootstrapStatus,
    bootstrap,
    loadCliStatus,
    installCodexCli,
    resetState,
  };
}

export const codexProviderStore = createCodexProviderStore();
