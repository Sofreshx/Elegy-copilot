import {
  getClaudeCodeProviderStatus,
  setClaudeCodeProvider,
  resetClaudeCodeProvider,
  saveClaudeCodeDeepseekKey,
} from '../lib/api/claudeCode';
import { createStore } from '../lib/store';
import type { ClaudeCodeProviderMode, ClaudeCodeProviderStatusResponse } from '../lib/types';

export interface ClaudeCodeProviderState {
  status: ClaudeCodeProviderStatusResponse | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  message: string | null;
}

const INITIAL_STATE: ClaudeCodeProviderState = {
  status: null,
  loading: false,
  saving: false,
  error: null,
  message: null,
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return 'An unexpected error occurred.';
}

const MODE_LABELS: Record<ClaudeCodeProviderMode, string> = {
  vanilla: 'Vanilla Claude',
  'opencode-go': 'OpenCode Go',
  'deepseek-direct': 'DeepSeek Direct',
  custom: 'Custom',
};

function createClaudeCodeProviderStore() {
  const store = createStore<ClaudeCodeProviderState>(INITIAL_STATE);

  async function load(): Promise<void> {
    store.setState((state) => ({ ...state, loading: true, error: null }));
    try {
      const status = await getClaudeCodeProviderStatus();
      store.setState((state) => ({ ...state, status, loading: false }));
    } catch (error) {
      store.setState((state) => ({ ...state, loading: false, error: toErrorMessage(error) }));
    }
  }

  async function setMode(mode: ClaudeCodeProviderMode, apiKey?: string): Promise<void> {
    store.setState((state) => ({ ...state, saving: true, error: null, message: null }));
    try {
      const result = await setClaudeCodeProvider(mode, apiKey);
      if (result.ok) {
        store.setState((state) => ({
          ...state,
          status: result.status,
          saving: false,
          message: `Provider set to ${MODE_LABELS[mode] || mode}.`,
        }));
      } else {
        store.setState((state) => ({
          ...state,
          saving: false,
          error: result.error || `Failed to set provider to ${mode}.`,
        }));
      }
    } catch (error) {
      store.setState((state) => ({ ...state, saving: false, error: toErrorMessage(error) }));
    }
  }

  async function reset(restore = false): Promise<void> {
    store.setState((state) => ({ ...state, saving: true, error: null, message: null }));
    try {
      const result = await resetClaudeCodeProvider(restore);
      if (result.ok) {
        store.setState((state) => ({
          ...state,
          status: result.status,
          saving: false,
          message: restore
            ? 'Restored from backup.'
            : 'Reset to Vanilla Claude (default Anthropic provider).',
        }));
      } else {
        store.setState((state) => ({
          ...state,
          saving: false,
          error: result.error || 'Failed to reset provider.',
        }));
      }
    } catch (error) {
      store.setState((state) => ({ ...state, saving: false, error: toErrorMessage(error) }));
    }
  }

  async function saveDeepseekKey(apiKey: string): Promise<void> {
    store.setState((state) => ({ ...state, saving: true, error: null, message: null }));
    try {
      const result = await saveClaudeCodeDeepseekKey(apiKey);
      if (result.ok) {
        store.setState((state) => ({
          ...state,
          saving: false,
          message: 'DeepSeek API key saved.',
        }));
      } else {
        store.setState((state) => ({
          ...state,
          saving: false,
          error: 'Failed to save DeepSeek API key.',
        }));
      }
    } catch (error) {
      store.setState((state) => ({ ...state, saving: false, error: toErrorMessage(error) }));
    }
  }

  function resetState(): void {
    store.setState(() => ({ ...INITIAL_STATE }));
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    load,
    setMode,
    reset,
    saveDeepseekKey,
    resetState,
  };
}

export const claudeCodeProviderStore = createClaudeCodeProviderStore();
