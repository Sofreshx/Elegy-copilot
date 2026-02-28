import { getLspConfig, installLsp } from '../../lib/api';
import { createStore } from '../../lib/store';

export interface LspState {
  config: Record<string, unknown>;
  loading: boolean;
  installing: boolean;
  error: string | null;
  installLogs: string;
  installMeta: string;
}

const INITIAL_STATE: LspState = {
  config: {},
  loading: false,
  installing: false,
  error: null,
  installLogs: '',
  installMeta: 'Install has not been run in this session.',
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return 'Unable to load LSP data.';
}

function normalizeConfig(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') {
    return value as Record<string, unknown>;
  }

  return {};
}

function createLspStore() {
  const store = createStore<LspState>(INITIAL_STATE);
  let configRequestVersion = 0;

  async function loadConfig(): Promise<void> {
    const nextVersion = ++configRequestVersion;

    store.setState((state) => ({
      ...state,
      loading: true,
      error: null,
    }));

    try {
      const response = await getLspConfig();
      const config = normalizeConfig(response.config);

      store.setState((state) => {
        if (nextVersion !== configRequestVersion) {
          return state;
        }

        return {
          ...state,
          config,
          loading: false,
          error: null,
        };
      });
    } catch (error) {
      const message = toErrorMessage(error);

      store.setState((state) => {
        if (nextVersion !== configRequestVersion) {
          return state;
        }

        return {
          ...state,
          loading: false,
          error: message,
        };
      });
    }
  }

  async function install(): Promise<void> {
    store.setState((state) => ({
      ...state,
      installing: true,
      error: null,
      installMeta: 'Installing language servers...',
    }));

    try {
      const response = await installLsp();
      const chunks: string[] = [];

      if (typeof response.stdout === 'string' && response.stdout.trim()) {
        chunks.push(response.stdout.trim());
      }

      if (typeof response.stderr === 'string' && response.stderr.trim()) {
        chunks.push(response.stderr.trim());
      }

      if (typeof response.error === 'string' && response.error.trim()) {
        chunks.push(`ERROR: ${response.error.trim()}`);
      }

      store.setState((state) => ({
        ...state,
        installing: false,
        installLogs: chunks.join('\n\n') || 'Done.',
        installMeta: response.ok ? 'Install completed.' : 'Install completed with warnings.',
      }));

      await loadConfig();
    } catch (error) {
      const message = toErrorMessage(error);

      store.setState((state) => ({
        ...state,
        installing: false,
        error: message,
        installMeta: 'Install failed.',
      }));

      throw error;
    }
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    loadConfig,
    refresh: loadConfig,
    install,
  };
}

export const lspStore = createLspStore();
