import { createStore } from '../lib/store';
import {
  checkDeepseekBridge,
  getCodexProviderStatus,
  getDeepseekStatus,
  resetCodexProvider,
  saveDeepseekSettings,
  setCodexProviderMode,
  startDeepseekBridge,
  stopDeepseekBridge,
  type DeepseekSettingsPayload,
} from '../lib/api/codexConfig';
import type { CodexProviderDeepseekStatus, CodexProviderStatusResponse } from '../lib/types';

export interface CodexProviderState {
  status: CodexProviderStatusResponse | null;
  deepseekStatus: CodexProviderDeepseekStatus | null;
  loading: boolean;
  saving: boolean;
  bridgeLoading: boolean;
  error: string | null;
  message: string | null;
}

const INITIAL_STATE: CodexProviderState = {
  status: null,
  deepseekStatus: null,
  loading: false,
  saving: false,
  bridgeLoading: false,
  error: null,
  message: null,
};

function createCodexProviderStore() {
  const store = createStore<CodexProviderState>(INITIAL_STATE);

  async function load(): Promise<void> {
    store.setState((state) => ({ ...state, loading: true, error: null }));
    try {
      const [status, dsStatus] = await Promise.all([
        getCodexProviderStatus(),
        getDeepseekStatus().catch(() => null),
      ]);
      store.setState((state) => ({ ...state, status, deepseekStatus: dsStatus, loading: false }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load Codex provider status';
      store.setState((state) => ({ ...state, loading: false, error: message }));
    }
  }

  async function setMode(mode: 'native' | 'elegy-routed' | 'deepseek-bridge'): Promise<void> {
    store.setState((state) => ({ ...state, saving: true, error: null, message: null }));
    try {
      const status = await setCodexProviderMode(mode);
      store.setState((state) => ({
        ...state,
        status,
        saving: false,
        message: mode === 'elegy-routed'
          ? 'Codex now defaults to Elegy Routed for new local sessions.'
          : mode === 'deepseek-bridge'
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
          : 'Removed Elegy-managed Codex provider settings.',
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reset Codex provider';
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
          ? { ...state.deepseekStatus, bridgeRunning: result.bridgeRunning }
          : null,
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
    saveDeepseek,
    startBridge,
    stopBridge,
    checkBridge,
    resetState,
  };
}

export const codexProviderStore = createCodexProviderStore();
