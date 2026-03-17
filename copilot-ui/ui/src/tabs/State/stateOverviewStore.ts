import { getGatewayState, getHealth, getRuntimeCatalogHealth } from '../../lib/api';
import { createStore } from '../../lib/store';
import type { GatewayStateResponse, HealthResponse, RuntimeCatalogHealthResponse } from '../../lib/types';

const STATE_OVERVIEW_POLL_INTERVAL_MS = 30_000;

export interface StateOverviewState {
  health: HealthResponse | null;
  gatewayState: GatewayStateResponse | null;
  catalogHealth: RuntimeCatalogHealthResponse | null;
  loading: boolean;
  error: string | null;
  lastUpdatedAtMs: number | null;
}

const INITIAL_STATE: StateOverviewState = {
  health: null,
  gatewayState: null,
  catalogHealth: null,
  loading: false,
  error: null,
  lastUpdatedAtMs: null,
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return 'Unable to load system state.';
}

function createStateOverviewStore() {
  const store = createStore<StateOverviewState>(INITIAL_STATE);
  let requestVersion = 0;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  async function refresh(): Promise<void> {
    const nextVersion = ++requestVersion;

    store.setState((state) => ({
      ...state,
      loading: true,
      error: null,
    }));

    try {
      const [health, gatewayState, catalogHealth] = await Promise.all([
        getHealth(),
        getGatewayState(),
        getRuntimeCatalogHealth(),
      ]);

      store.setState((state) => {
        if (nextVersion !== requestVersion) {
          return state;
        }

        return {
          ...state,
          health,
          gatewayState,
          catalogHealth,
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

  function startPolling(): void {
    if (pollTimer) {
      return;
    }

    void refresh();
    pollTimer = setInterval(() => {
      void refresh();
    }, STATE_OVERVIEW_POLL_INTERVAL_MS);
  }

  function stopPolling(): void {
    if (!pollTimer) {
      return;
    }

    clearInterval(pollTimer);
    pollTimer = null;
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    refresh,
    startPolling,
    stopPolling,
  };
}

export const stateOverviewStore = createStateOverviewStore();
