import { getCliToolingStatus, installCliTooling } from '../lib/api';
import { createStore } from '../lib/store';
import type { CliToolingStatusResponse, CliToolingTool } from '../lib/types';

export interface CliToolingState {
  status: CliToolingStatusResponse | null;
  loading: boolean;
  installing: Record<string, boolean>;
  error: string | null;
  lastUpdatedAtMs: number | null;
}

const INITIAL_STATE: CliToolingState = {
  status: null,
  loading: false,
  installing: {},
  error: null,
  lastUpdatedAtMs: null,
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return 'Unable to load CLI tooling status.';
}

function createCliToolingStore() {
  const store = createStore<CliToolingState>(INITIAL_STATE);
  let requestVersion = 0;

  async function refresh(): Promise<void> {
    const nextVersion = ++requestVersion;
    store.setState((state) => ({
      ...state,
      loading: true,
      error: null,
    }));

    try {
      const status = await getCliToolingStatus();
      store.setState((state) => {
        if (nextVersion !== requestVersion) {
          return state;
        }
        return {
          ...state,
          status,
          loading: false,
          error: null,
          lastUpdatedAtMs: Date.now(),
        };
      });
    } catch (error) {
      const message = toErrorMessage(error);
      store.setState((state) => {
        if (nextVersion !== requestVersion) {
          return state;
        }
        return {
          ...state,
          loading: false,
          error: message,
          lastUpdatedAtMs: Date.now(),
        };
      });
    }
  }

  async function install(toolId: string, dryRun = false): Promise<void> {
    store.setState((state) => ({
      ...state,
      installing: { ...state.installing, [toolId]: true },
      error: null,
    }));

    try {
      const response = await installCliTooling({ toolId, dryRun });
      // Refresh status after install to get updated version
      await refresh();
      store.setState((state) => ({
        ...state,
        installing: { ...state.installing, [toolId]: false },
      }));
    } catch (error) {
      store.setState((state) => ({
        ...state,
        installing: { ...state.installing, [toolId]: false },
        error: toErrorMessage(error),
        lastUpdatedAtMs: Date.now(),
      }));
    }
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    refresh,
    install,
  };
}

export const cliToolingStore = createCliToolingStore();
