import { getClaudeCodeStatus, installClaudeCodeCli } from '../lib/api/claudeCode';
import { createStore } from '../lib/store';
import type { ClaudeCodeStatusResponse } from '../lib/types';

export interface ClaudeCodeState {
  status: ClaudeCodeStatusResponse | null;
  loading: boolean;
  installing: boolean;
  error: string | null;
  message: string | null;
}

const INITIAL_STATE: ClaudeCodeState = {
  status: null,
  loading: false,
  installing: false,
  error: null,
  message: null,
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return 'An unexpected error occurred.';
}

function createClaudeCodeStore() {
  const store = createStore<ClaudeCodeState>(INITIAL_STATE);

  function validateClaudeCodeStatus(raw: unknown): ClaudeCodeStatusResponse | null {
    if (!raw || typeof raw !== 'object') return null;
    const status = raw as Record<string, unknown>;
    if (typeof status.overallStatus !== 'string') return null;
    if (typeof status.claudeHome !== 'string') return null;
    return raw as ClaudeCodeStatusResponse;
  }

  async function load(): Promise<void> {
    store.setState((state) => ({ ...state, loading: true, error: null }));
    try {
      const raw = await getClaudeCodeStatus();
      const status = validateClaudeCodeStatus(raw);
      if (!status) {
        store.setState((state) => ({
          ...state,
          loading: false,
          error: 'Claude Code status response is incomplete or malformed. Claude Code may not be installed or configured on this system.',
          status: null,
        }));
        return;
      }
      store.setState((state) => ({ ...state, status, loading: false }));
    } catch (error) {
      store.setState((state) => ({ ...state, loading: false, error: toErrorMessage(error) }));
    }
  }

  async function installCli(): Promise<void> {
    store.setState((state) => ({ ...state, installing: true, error: null, message: null }));
    try {
      const response = await installClaudeCodeCli();
      if (response.ok) {
        const validated = response.status ? validateClaudeCodeStatus(response.status) : null;
        store.setState((state) => ({
          ...state,
          status: validated,
          installing: false,
          message: 'Claude Code CLI installed successfully.',
        }));
      } else {
        store.setState((state) => ({
          ...state,
          installing: false,
          error: response.error || 'Failed to install Claude Code CLI.',
        }));
      }
    } catch (error) {
      store.setState((state) => ({ ...state, installing: false, error: toErrorMessage(error) }));
    }
  }

  function resetState(): void {
    store.setState(() => ({ ...INITIAL_STATE }));
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    load,
    installCli,
    resetState,
  };
}

export const claudeCodeStore = createClaudeCodeStore();
