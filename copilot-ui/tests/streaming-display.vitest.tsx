import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SdkMessageEntry } from '../ui/src/lib/types';
import SdkMessageList from '../ui/src/tabs/Sessions/SdkMessageList';

const mockListSdkSessions = vi.fn();
const mockCreateSdkSession = vi.fn();
const mockDeleteSdkSession = vi.fn();
const mockSendSdkMessage = vi.fn();

vi.mock('../ui/src/lib/api', () => ({
  listSdkSessions: mockListSdkSessions,
  createSdkSession: mockCreateSdkSession,
  deleteSdkSession: mockDeleteSdkSession,
  sendSdkMessage: mockSendSdkMessage,
  createSdkStreamUrl: (sessionId: string) => `http://localhost/fake-sse/${sessionId}`,
}));

class MockEventSource {
  static instances: MockEventSource[] = [];

  url: string;

  readyState = 0;

  onopen: (() => void) | null = null;

  onerror: (() => void) | null = null;

  private listeners = new Map<string, Set<(event: MessageEvent<string>) => void>>();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, handler: (event: MessageEvent<string>) => void): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)?.add(handler);
  }

  close(): void {
    this.readyState = 2;
  }

  emitOpen(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  emitError(): void {
    this.onerror?.();
  }

  emit(type: string, payload: unknown): void {
    const event = { data: JSON.stringify(payload) } as MessageEvent<string>;
    for (const handler of this.listeners.get(type) ?? []) {
      handler(event);
    }
  }

  static latest(): MockEventSource {
    const instance = MockEventSource.instances[MockEventSource.instances.length - 1];
    if (!instance) {
      throw new Error('Expected EventSource instance to be created');
    }
    return instance;
  }

  static reset(): void {
    MockEventSource.instances = [];
  }
}

function makeMessage(overrides: Partial<SdkMessageEntry> = {}): SdkMessageEntry {
  return {
    id: overrides.id ?? 'msg-1',
    role: overrides.role ?? 'assistant',
    content: overrides.content ?? 'Hello from assistant',
    createdAtMs: overrides.createdAtMs ?? Date.now(),
    status: overrides.status ?? 'complete',
    eventType: overrides.eventType,
    reasoning: overrides.reasoning,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

describe('SdkMessageList', () => {
  beforeEach(() => {
    if (!('scrollIntoView' in Element.prototype)) {
      Object.defineProperty(Element.prototype, 'scrollIntoView', {
        value: vi.fn(),
        configurable: true,
        writable: true,
      });
      return;
    }

    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders empty state when no messages or deltas exist', () => {
    render(
      <SdkMessageList
        messages={[]}
        pendingContent=""
        pendingReasoning=""
        streamStatus="disconnected"
      />
    );

    expect(screen.getByText('No SDK messages yet.')).toBeInTheDocument();
  });

  it('renders completed messages plus pending deltas and reasoning', () => {
    render(
      <SdkMessageList
        messages={[makeMessage({ role: 'assistant', content: 'Final answer', reasoning: 'Reasoning body' })]}
        pendingContent="Token delta"
        pendingReasoning="Reasoning delta"
        streamStatus="connected"
      />
    );

    expect(screen.getByText('Final answer')).toBeInTheDocument();
    expect(screen.getByText('Reasoning')).toBeInTheDocument();
    expect(screen.getByText('Token delta')).toBeInTheDocument();
    expect(screen.getByText('Reasoning (delta)')).toBeInTheDocument();
    expect(screen.getByText('connected')).toBeInTheDocument();
  });
});

describe('sdkSessionsStore streaming behavior', () => {
  beforeEach(() => {
    MockEventSource.reset();
    mockCreateSdkSession.mockReset();
    mockDeleteSdkSession.mockReset();
    mockSendSdkMessage.mockReset();
    mockListSdkSessions.mockReset();
    vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('accumulates deltas and finalizes assistant messages', async () => {
    mockListSdkSessions.mockResolvedValue({
      sessions: [{ sessionId: 'sdk-1', model: null, createdAt: '2026-03-01T00:00:00Z', sseClientCount: 0 }],
    });

    const { sdkSessionsStore } = await import('../ui/src/tabs/Sessions/sdkSessionsStore');

    await sdkSessionsStore.loadSessions();
    const source = MockEventSource.latest();
    source.emitOpen();

    source.emit('assistant.message_delta', {
      sessionId: 'sdk-1',
      type: 'assistant.message_delta',
      event: { data: { delta: 'Hello ' } },
    });
    source.emit('assistant.message_delta', {
      sessionId: 'sdk-1',
      type: 'assistant.message_delta',
      event: { data: { delta: 'world' } },
    });
    source.emit('assistant.reasoning_delta', {
      sessionId: 'sdk-1',
      type: 'assistant.reasoning_delta',
      event: { data: { delta: 'Thinking...' } },
    });

    let state = sdkSessionsStore.getState();
    expect(state.pendingBySession['sdk-1']).toEqual({
      content: 'Hello world',
      reasoning: 'Thinking...',
    });

    source.emit('assistant.message', {
      sessionId: 'sdk-1',
      type: 'assistant.message',
      event: { data: {} },
    });

    await waitFor(() => {
      state = sdkSessionsStore.getState();
      expect(state.messagesBySession['sdk-1']).toHaveLength(1);
    });

    state = sdkSessionsStore.getState();
    expect(state.messagesBySession['sdk-1'][0]?.content).toBe('Hello world');
    expect(state.messagesBySession['sdk-1'][0]?.reasoning).toBe('Thinking...');
    expect(state.pendingBySession['sdk-1']).toBeUndefined();

    sdkSessionsStore.dispose();
  });

  it('handles rapid streaming updates without crashing', async () => {
    mockListSdkSessions.mockResolvedValue({
      sessions: [{ sessionId: 'sdk-rapid', model: null, createdAt: '2026-03-01T00:00:00Z', sseClientCount: 0 }],
    });

    const { sdkSessionsStore } = await import('../ui/src/tabs/Sessions/sdkSessionsStore');

    await sdkSessionsStore.loadSessions();
    const source = MockEventSource.latest();
    source.emitOpen();

    for (let index = 0; index < 50; index += 1) {
      source.emit('assistant.message_delta', {
        sessionId: 'sdk-rapid',
        type: 'assistant.message_delta',
        event: { data: { delta: `chunk-${index};` } },
      });
    }

    source.emit('assistant.message', {
      sessionId: 'sdk-rapid',
      type: 'assistant.message',
      event: { data: {} },
    });

    await waitFor(() => {
      const state = sdkSessionsStore.getState();
      expect(state.messagesBySession['sdk-rapid']).toHaveLength(1);
    });

    const state = sdkSessionsStore.getState();
    expect(state.messagesBySession['sdk-rapid'][0]?.content.startsWith('chunk-0;')).toBe(true);
    expect(state.messagesBySession['sdk-rapid'][0]?.content.includes('chunk-49;')).toBe(true);

    sdkSessionsStore.dispose();
  });

  it('ignores stale loadSessions completions for stream side effects', async () => {
    const staleList = createDeferred<{
      sessions: Array<{ sessionId: string; model: null; createdAt: string; sseClientCount: number }>;
    }>();
    const latestList = createDeferred<{
      sessions: Array<{ sessionId: string; model: null; createdAt: string; sseClientCount: number }>;
    }>();

    mockListSdkSessions
      .mockReturnValueOnce(staleList.promise)
      .mockReturnValueOnce(latestList.promise);

    const { sdkSessionsStore } = await import('../ui/src/tabs/Sessions/sdkSessionsStore');

    const staleLoad = sdkSessionsStore.loadSessions();
    const latestLoad = sdkSessionsStore.loadSessions();

    latestList.resolve({
      sessions: [{ sessionId: 'sdk-active', model: null, createdAt: '2026-03-01T00:00:00Z', sseClientCount: 0 }],
    });
    await latestLoad;

    const activeSource = MockEventSource.latest();
    activeSource.emitOpen();

    expect(sdkSessionsStore.getState().selectedSessionId).toBe('sdk-active');
    expect(activeSource.url).toContain('/sdk-active');
    expect(MockEventSource.instances).toHaveLength(1);

    staleList.resolve({
      sessions: [{ sessionId: 'sdk-stale', model: null, createdAt: '2026-03-01T00:00:00Z', sseClientCount: 0 }],
    });
    await staleLoad;

    const state = sdkSessionsStore.getState();
    expect(state.selectedSessionId).toBe('sdk-active');
    expect(state.sessions.map((session) => session.sessionId)).toEqual(['sdk-active']);
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.latest()).toBe(activeSource);
    expect(activeSource.readyState).not.toBe(2);

    sdkSessionsStore.dispose();
  });

  it('does not attach an unknown selected session and detaches current stream', async () => {
    mockListSdkSessions.mockResolvedValue({
      sessions: [{ sessionId: 'sdk-valid', model: null, createdAt: '2026-03-01T00:00:00Z', sseClientCount: 0 }],
    });

    const { sdkSessionsStore } = await import('../ui/src/tabs/Sessions/sdkSessionsStore');

    await sdkSessionsStore.loadSessions();
    const validSource = MockEventSource.latest();
    validSource.emitOpen();

    expect(sdkSessionsStore.getState().selectedSessionId).toBe('sdk-valid');
    expect(MockEventSource.instances).toHaveLength(1);

    sdkSessionsStore.selectSession('  sdk-unknown  ');

    const state = sdkSessionsStore.getState();
    expect(state.selectedSessionId).toBeNull();
    expect(state.streamStatus).toBe('disconnected');
    expect(validSource.readyState).toBe(2);
    expect(MockEventSource.instances).toHaveLength(1);

    sdkSessionsStore.dispose();
  });
});
