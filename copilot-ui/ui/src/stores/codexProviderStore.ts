import { createStore } from '../lib/store';
import {
  getCodexProviderStatus,
  resetCodexProvider,
  setCodexProviderMode,
} from '../lib/api/codexConfig';
import type { CodexProviderStatusResponse } from '../lib/types';

export interface CodexProviderState {
  status: CodexProviderStatusResponse | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  message: string | null;
}

const INITIAL_STATE: CodexProviderState = {
  status: null,
  loading: false,
  saving: false,
  error: null,
  message: null,
};

function createCodexProviderStore() {
  const store = createStore<CodexProviderState>(INITIAL_STATE);

  async function load(): Promise<void> {
    store.setState((state) => ({ ...state, loading: true, error: null }));
    try {
      const status = await getCodexProviderStatus();
      store.setState((state) => ({ ...state, status, loading: false }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load Codex provider status';
      store.setState((state) => ({ ...state, loading: false, error: message }));
    }
  }

  async function setMode(mode: 'native' | 'elegy-routed'): Promise<void> {
    store.setState((state) => ({ ...state, saving: true, error: null, message: null }));
    try {
      const status = await setCodexProviderMode(mode);
      store.setState((state) => ({
        ...state,
        status,
        saving: false,
        message: mode === 'elegy-routed'
          ? 'Codex now defaults to Elegy Routed for new local sessions.'
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
    resetState,
  };
}

export const codexProviderStore = createCodexProviderStore();
