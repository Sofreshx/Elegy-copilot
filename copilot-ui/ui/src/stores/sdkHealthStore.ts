import { getSdkHealth } from '../lib/api';
import { createStore } from '../lib/store';
import type { SdkHealthResponse } from '../lib/types';

const SDK_HEALTH_POLL_INTERVAL_MS = 30_000;

export interface SdkHealthState {
  health: SdkHealthResponse | null;
  loading: boolean;
  error: string | null;
  lastUpdatedAtMs: number | null;
}

const INITIAL_STATE: SdkHealthState = {
  health: null,
  loading: false,
  error: null,
  lastUpdatedAtMs: null,
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return 'Unable to load SDK health.';
}

function createSdkHealthStore() {
  const store = createStore<SdkHealthState>(INITIAL_STATE);

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
      const health = await getSdkHealth();

      store.setState((state) => {
        if (nextVersion !== requestVersion) {
          return state;
        }

        return {
          ...state,
          health,
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
    }, SDK_HEALTH_POLL_INTERVAL_MS);
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

export const sdkHealthStore = createSdkHealthStore();
