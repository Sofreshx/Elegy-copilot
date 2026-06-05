import { createStore } from '../lib/store';

export type RuntimeApiErrorCode =
  | 'connection_refused'
  | 'aborted'
  | 'network'
  | 'http_error'
  | 'unknown';

export interface RuntimeHealthFailure {
  endpoint: string;
  code: RuntimeApiErrorCode;
  at: number;
  message?: string;
}

export interface RuntimeHealthState {
  disconnected: boolean;
  disconnectedAt: number | null;
  lastFailureAt: number | null;
  lastFailureEndpoint: string | null;
  lastErrorCode: RuntimeApiErrorCode | null;
  failureCount: number;
  watching: boolean;
}

const INITIAL_STATE: RuntimeHealthState = {
  disconnected: false,
  disconnectedAt: null,
  lastFailureAt: null,
  lastFailureEndpoint: null,
  lastErrorCode: null,
  failureCount: 0,
  watching: false,
};

const FAILURE_WINDOW_MS = 10_000;
const DISCONNECT_THRESHOLD = 2;
const HEALTHY_POLL_INTERVAL_MS = 30_000;
const DISCONNECTED_POLL_INTERVAL_MS = 5_000;
const HEALTH_TIMEOUT_MS = 5_000;

export interface RuntimeHealthStoreOptions {
  fetchImpl?: typeof fetch;
  healthEndpoint?: string;
  now?: () => number;
  setTimeoutImpl?: typeof setTimeout;
  clearTimeoutImpl?: typeof clearTimeout;
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = (error as { name?: unknown }).name;
  return name === 'AbortError';
}

function isConnectionRefusedError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const message = String((error as { message?: unknown }).message || '').toLowerCase();
  return (
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('network request failed') ||
    message.includes('fetch failed')
  );
}

function isAbortControllerAvailable(): boolean {
  return typeof AbortController !== 'undefined';
}

function createRuntimeHealthStore(options: RuntimeHealthStoreOptions = {}) {
  const fetchImpl = options.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
  const healthEndpoint = options.healthEndpoint ?? '/api/health';
  const now = options.now ?? (() => Date.now());
  const setTimeoutImpl = options.setTimeoutImpl ?? setTimeout;
  const clearTimeoutImpl = options.clearTimeoutImpl ?? clearTimeout;

  const store = createStore<RuntimeHealthState>(INITIAL_STATE);
  const failureTimestamps: number[] = [];
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let healthController: AbortController | null = null;
  let inFlightHealthCheck = false;

  function pruneFailures(currentTime: number): void {
    while (failureTimestamps.length > 0 && currentTime - failureTimestamps[0] > FAILURE_WINDOW_MS) {
      failureTimestamps.shift();
    }
  }

  function recordConnectionFailure(endpoint: string, code: RuntimeApiErrorCode, message?: string): void {
    const currentTime = now();
    failureTimestamps.push(currentTime);
    pruneFailures(currentTime);

    const failureCount = failureTimestamps.length;
    const shouldBeDisconnected = failureCount >= DISCONNECT_THRESHOLD;

    store.setState((state) => {
      const nextDisconnected = shouldBeDisconnected || state.disconnected;
      return {
        ...state,
        disconnected: nextDisconnected,
        disconnectedAt: nextDisconnected && state.disconnectedAt == null ? currentTime : state.disconnectedAt,
        lastFailureAt: currentTime,
        lastFailureEndpoint: endpoint,
        lastErrorCode: code,
        failureCount,
      };
    });

    if (process.env.NODE_ENV !== 'production') {
      void message;
    }

    if (shouldBeDisconnected && pollTimer == null && state_value('watching')) {
      schedulePoll(DISCONNECTED_POLL_INTERVAL_MS);
    }
  }

  function recordConnectionSuccess(): void {
    failureTimestamps.length = 0;
    store.setState((state) => {
      if (!state.disconnected && state.failureCount === 0) {
        return state;
      }
      return {
        ...state,
        disconnected: false,
        disconnectedAt: null,
        lastFailureAt: null,
        lastFailureEndpoint: null,
        lastErrorCode: null,
        failureCount: 0,
      };
    });
    if (state_value('watching')) {
      schedulePoll(HEALTHY_POLL_INTERVAL_MS);
    }
  }

  function state_value<K extends keyof RuntimeHealthState>(key: K): RuntimeHealthState[K] {
    return store.getState()[key];
  }

  function schedulePoll(delayMs: number): void {
    if (pollTimer != null) {
      clearTimeoutImpl(pollTimer);
      pollTimer = null;
    }
    pollTimer = setTimeoutImpl(() => {
      pollTimer = null;
      void runHealthCheck();
    }, delayMs);
  }

  async function runHealthCheck(): Promise<void> {
    if (inFlightHealthCheck) {
      return;
    }
    if (!fetchImpl) {
      return;
    }
    inFlightHealthCheck = true;
    if (healthController && isAbortControllerAvailable()) {
      try {
        healthController.abort();
      } catch {
        // best-effort abort
      }
    }
    if (isAbortControllerAvailable()) {
      healthController = new AbortController();
    }
    const controller = healthController;
    const timeout = setTimeoutImpl(() => {
      if (controller) {
        try {
          controller.abort();
        } catch {
          // best-effort abort
        }
      }
    }, HEALTH_TIMEOUT_MS);

    try {
      const response = await fetchImpl(healthEndpoint, {
        method: 'GET',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: controller?.signal,
      });
      if (response.ok) {
        recordConnectionSuccess();
      } else {
        recordConnectionFailure(healthEndpoint, 'http_error', `HTTP ${response.status}`);
      }
    } catch (error) {
      const code: RuntimeApiErrorCode = isAbortError(error)
        ? 'aborted'
        : isConnectionRefusedError(error)
          ? 'connection_refused'
          : 'network';
      recordConnectionFailure(healthEndpoint, code, error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeoutImpl(timeout);
      inFlightHealthCheck = false;
      if (state_value('watching')) {
        const nextDelay = state_value('disconnected')
          ? DISCONNECTED_POLL_INTERVAL_MS
          : HEALTHY_POLL_INTERVAL_MS;
        schedulePoll(nextDelay);
      }
    }
  }

  function startWatching(): void {
    if (state_value('watching')) {
      return;
    }
    store.setState((state) => ({ ...state, watching: true }));
    void runHealthCheck();
  }

  function stopWatching(): void {
    store.setState((state) => ({ ...state, watching: false }));
    if (pollTimer != null) {
      clearTimeoutImpl(pollTimer);
      pollTimer = null;
    }
    if (healthController) {
      try {
        healthController.abort();
      } catch {
        // best-effort abort
      }
      healthController = null;
    }
  }

  function setDisconnected(value: boolean): void {
    store.setState((state) => {
      if (value) {
        return {
          ...state,
          disconnected: true,
          disconnectedAt: state.disconnectedAt ?? now(),
        };
      }
      return {
        ...state,
        disconnected: false,
        disconnectedAt: null,
        lastFailureAt: null,
        lastFailureEndpoint: null,
        lastErrorCode: null,
        failureCount: 0,
      };
    });
    failureTimestamps.length = 0;
  }

  function reset(): void {
    stopWatching();
    failureTimestamps.length = 0;
    store.setState(() => ({ ...INITIAL_STATE }));
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    recordConnectionFailure,
    recordConnectionSuccess,
    startWatching,
    stopWatching,
    runHealthCheck,
    setDisconnected,
    reset,
  };
}

export type RuntimeHealthStore = ReturnType<typeof createRuntimeHealthStore>;

let defaultStore: RuntimeHealthStore | null = null;

export function getRuntimeHealthStore(): RuntimeHealthStore {
  if (defaultStore == null) {
    defaultStore = createRuntimeHealthStore();
  }
  return defaultStore;
}

export const runtimeHealthStore = getRuntimeHealthStore();

export { createRuntimeHealthStore };
