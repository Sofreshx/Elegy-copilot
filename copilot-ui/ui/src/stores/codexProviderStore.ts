import { createStore } from '../lib/store';
import { navigationStore } from './navigation';
import {
  getCodexCliStatus,
  getCodexProviderStatus,
  getCodexSubagentUsage,
  getCodexSubagents,
  installCodexCli,
  type CodexSubagentUsageResponse,
  type CodexSubagentsResponse,
} from '../lib/api/codexConfig';
import type { CodexProviderStatusResponse } from '../lib/types';

export interface CodexProviderState {
  status: CodexProviderStatusResponse | null;
  loading: boolean;
  installingCli: boolean;
  cliStatus: {
    installed: boolean;
    version: string | null;
    installCommand: string;
    lastError: string | null;
  } | null;
  subagents: CodexSubagentsResponse | null;
  subagentUsage: CodexSubagentUsageResponse | null;
  activeSection: 'overview' | 'assets' | 'subagents' | 'usage';
  subagentsLoading: boolean;
  error: string | null;
  message: string | null;
}

const INITIAL_STATE: CodexProviderState = {
  status: null,
  loading: false,
  installingCli: false,
  cliStatus: null,
  subagents: null,
  subagentUsage: null,
  activeSection: 'overview',
  subagentsLoading: false,
  error: null,
  message: null,
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function createCodexProviderStore() {
  const store = createStore<CodexProviderState>(INITIAL_STATE);

  async function load(): Promise<void> {
    store.setState((state) => ({ ...state, loading: true, error: null }));
    try {
      const [status, cliResponse] = await Promise.all([
        getCodexProviderStatus(),
        getCodexCliStatus().catch(() => null),
      ]);
      store.setState((state) => ({
        ...state,
        status,
        cliStatus: cliResponse?.cli || state.cliStatus,
        loading: false,
      }));
    } catch (error) {
      store.setState((state) => ({
        ...state,
        loading: false,
        error: errorMessage(error, 'Failed to load native Codex status.'),
      }));
    }
  }

  function setActiveSection(activeSection: CodexProviderState['activeSection']): void {
    store.setState((state) => ({ ...state, activeSection }));
  }

  async function loadSubagents(): Promise<void> {
    store.setState((state) => ({ ...state, subagentsLoading: true, error: null }));
    try {
      const repoPath = navigationStore.getState().activeWorkspaceId || undefined;
      const [subagents, subagentUsage] = await Promise.all([
        getCodexSubagents({ repoPath }),
        getCodexSubagentUsage().catch(() => null),
      ]);
      store.setState((state) => ({
        ...state,
        subagents,
        subagentUsage,
        subagentsLoading: false,
      }));
    } catch (error) {
      store.setState((state) => ({
        ...state,
        subagentsLoading: false,
        error: errorMessage(error, 'Failed to load native Codex agents.'),
      }));
    }
  }

  async function installCli(): Promise<void> {
    store.setState((state) => ({ ...state, installingCli: true, error: null, message: null }));
    try {
      const result = await installCodexCli();
      const cliResponse = await getCodexCliStatus().catch(() => null);
      store.setState((state) => ({
        ...state,
        installingCli: false,
        cliStatus: cliResponse?.cli || state.cliStatus,
        error: result.ok ? null : (result.error || 'Codex CLI installation failed.'),
        message: result.ok ? 'Codex CLI installation completed.' : null,
      }));
    } catch (error) {
      store.setState((state) => ({
        ...state,
        installingCli: false,
        error: errorMessage(error, 'Codex CLI installation failed.'),
      }));
    }
  }

  function resetState(): void {
    store.setState(() => ({ ...INITIAL_STATE }));
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    load,
    loadSubagents,
    installCli,
    setActiveSection,
    resetState,
  };
}

export const codexProviderStore = createCodexProviderStore();
