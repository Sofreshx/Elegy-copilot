import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRuntimeHealthStore } from '../ui/src/stores/runtimeHealthStore';

interface FakeResponseInit {
  ok?: boolean;
  status?: number;
}

function createFakeFetch(impl: (url: string) => Promise<FakeResponseInit> | FakeResponseInit) {
  return vi.fn(async (_input: RequestInfo | URL) => {
    const url = typeof _input === 'string' ? _input : _input.toString();
    const init = await impl(url);
    return {
      ok: init.ok ?? true,
      status: init.status ?? 200,
      json: async () => ({}),
    } as Response;
  });
}

function setupTimers() {
  vi.useFakeTimers();
}

describe('runtimeHealthStore', () => {
  beforeEach(() => {
    setupTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts in connected state with no failures', () => {
    const store = createRuntimeHealthStore({ fetchImpl: createFakeFetch(async () => ({ ok: true })) });
    const state = store.getState();
    expect(state.disconnected).toBe(false);
    expect(state.failureCount).toBe(0);
  });

  it('marks disconnected only after DISCONNECT_THRESHOLD failures inside the window', () => {
    const store = createRuntimeHealthStore({ fetchImpl: createFakeFetch(async () => ({ ok: true })) });

    store.recordConnectionFailure('/api/foo', 'connection_refused');
    expect(store.getState().disconnected).toBe(false);
    expect(store.getState().failureCount).toBe(1);

    store.recordConnectionFailure('/api/foo', 'connection_refused');
    const state = store.getState();
    expect(state.disconnected).toBe(true);
    expect(state.disconnectedAt).toBeTypeOf('number');
    expect(state.failureCount).toBe(2);
    expect(state.lastErrorCode).toBe('connection_refused');
    expect(state.lastFailureEndpoint).toBe('/api/foo');
  });

  it('does not mark disconnected when failures fall outside the rolling window', () => {
    let currentTime = 1_000_000;
    const store = createRuntimeHealthStore({
      fetchImpl: createFakeFetch(async () => ({ ok: true })),
      now: () => currentTime,
    });

    store.recordConnectionFailure('/api/foo', 'connection_refused');
    currentTime += 11_000;
    store.recordConnectionFailure('/api/foo', 'connection_refused');

    expect(store.getState().disconnected).toBe(false);
    expect(store.getState().failureCount).toBe(1);
  });

  it('clears disconnected state on the first success after a failure burst', () => {
    const store = createRuntimeHealthStore({ fetchImpl: createFakeFetch(async () => ({ ok: true })) });

    store.recordConnectionFailure('/api/foo', 'connection_refused');
    store.recordConnectionFailure('/api/foo', 'connection_refused');
    expect(store.getState().disconnected).toBe(true);

    store.recordConnectionSuccess();
    const state = store.getState();
    expect(state.disconnected).toBe(false);
    expect(state.disconnectedAt).toBeNull();
    expect(state.failureCount).toBe(0);
  });

  it('polls /api/health while watching and uses the slower cadence when healthy', async () => {
    const fetchImpl = createFakeFetch(async () => ({ ok: true }));
    const store = createRuntimeHealthStore({ fetchImpl, healthEndpoint: '/api/health' });

    store.startWatching();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/health',
      expect.objectContaining({ method: 'GET' }),
    );

    const initialCalls = fetchImpl.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(initialCalls);

    store.stopWatching();
  });

  it('polls faster while disconnected and reports the failure back into the store', async () => {
    let currentTime = 1_000_000;
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL) => {
      throw Object.assign(new TypeError('Failed to fetch'), { name: 'TypeError' });
    });
    const store = createRuntimeHealthStore({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => currentTime,
    });

    store.startWatching();
    await vi.runOnlyPendingTimersAsync();

    store.recordConnectionFailure('/api/foo', 'connection_refused');
    store.recordConnectionFailure('/api/foo', 'connection_refused');
    expect(store.getState().disconnected).toBe(true);

    const initialCalls = fetchImpl.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(initialCalls);

    store.stopWatching();
  });

  it('setDisconnected(true) marks disconnected and persists disconnectedAt', () => {
    const store = createRuntimeHealthStore({ fetchImpl: createFakeFetch(async () => ({ ok: true })) });
    store.setDisconnected(true);
    const state = store.getState();
    expect(state.disconnected).toBe(true);
    expect(state.disconnectedAt).toBeTypeOf('number');
  });

  it('setDisconnected(false) clears failures and disconnectedAt', () => {
    const store = createRuntimeHealthStore({ fetchImpl: createFakeFetch(async () => ({ ok: true })) });
    store.recordConnectionFailure('/api/foo', 'connection_refused');
    store.recordConnectionFailure('/api/foo', 'connection_refused');
    store.setDisconnected(false);
    const state = store.getState();
    expect(state.disconnected).toBe(false);
    expect(state.disconnectedAt).toBeNull();
    expect(state.failureCount).toBe(0);
  });
});
