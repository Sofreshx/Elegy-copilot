import {
  createSdkSession,
  createSdkStreamUrl,
  deleteSdkSession,
  listSdkSessions,
  sendSdkMessage,
} from '../../lib/api';
import { createStore } from '../../lib/store';
import type {
  SdkMessageEntry,
  SdkRelayEvent,
  SdkSessionSummary,
  SdkStreamStatus,
} from '../../lib/types';

interface PendingSdkMessage {
  content: string;
  reasoning: string;
}

export interface SdkSessionsState {
  sessions: SdkSessionSummary[];
  selectedSessionId: string | null;
  messagesBySession: Record<string, SdkMessageEntry[]>;
  pendingBySession: Record<string, PendingSdkMessage>;
  loading: boolean;
  creating: boolean;
  deleting: boolean;
  sending: boolean;
  streamStatus: SdkStreamStatus;
  streamError: string | null;
  composerPrompt: string;
  error: string | null;
}

const INITIAL_STATE: SdkSessionsState = {
  sessions: [],
  selectedSessionId: null,
  messagesBySession: {},
  pendingBySession: {},
  loading: false,
  creating: false,
  deleting: false,
  sending: false,
  streamStatus: 'disconnected',
  streamError: null,
  composerPrompt: '',
  error: null,
};

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

function extractText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => extractText(entry)).join('');
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const directKeys = ['text', 'content', 'delta', 'message', 'reasoning', 'value'];

    for (const key of directKeys) {
      if (typeof record[key] === 'string' && (record[key] as string).trim()) {
        return record[key] as string;
      }
    }

    const nestedKeys = ['delta', 'content', 'message', 'reasoning', 'result'];
    for (const key of nestedKeys) {
      const nestedText = extractText(record[key]);
      if (nestedText.trim()) {
        return nestedText;
      }
    }
  }

  return '';
}

function parseSseData(rawData: string): SdkRelayEvent | null {
  if (!rawData || !rawData.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawData) as Record<string, unknown>;
    const sessionId = typeof parsed.sessionId === 'string' ? parsed.sessionId.trim() : '';
    const type = typeof parsed.type === 'string' ? parsed.type.trim() : '';
    const event = parsed.event && typeof parsed.event === 'object'
      ? (parsed.event as Record<string, unknown>)
      : {};

    if (!sessionId || !type) {
      return null;
    }

    return {
      ...parsed,
      sessionId,
      type,
      event,
    } as SdkRelayEvent;
  } catch {
    return null;
  }
}

function nextMessageId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function createSdkSessionsStore() {
  const store = createStore<SdkSessionsState>(INITIAL_STATE);

  let listRequestVersion = 0;
  let sendRequestVersion = 0;
  let eventSource: EventSource | null = null;
  let streamSessionId: string | null = null;

  function getPending(sessionId: string): PendingSdkMessage {
    const current = store.getState().pendingBySession[sessionId];
    return current ?? { content: '', reasoning: '' };
  }

  function appendMessage(sessionId: string, entry: SdkMessageEntry): void {
    store.setState((state) => {
      const existingMessages = state.messagesBySession[sessionId] ?? [];
      return {
        ...state,
        messagesBySession: {
          ...state.messagesBySession,
          [sessionId]: [...existingMessages, entry],
        },
      };
    });
  }

  function setPending(sessionId: string, nextPending: PendingSdkMessage): void {
    store.setState((state) => ({
      ...state,
      pendingBySession: {
        ...state.pendingBySession,
        [sessionId]: nextPending,
      },
    }));
  }

  function clearPending(sessionId: string): void {
    store.setState((state) => {
      const nextPendingBySession = { ...state.pendingBySession };
      delete nextPendingBySession[sessionId];
      return {
        ...state,
        pendingBySession: nextPendingBySession,
      };
    });
  }

  function handleSdkRelayEvent(event: SdkRelayEvent): void {
    const sessionId = event.sessionId;
    const eventType = typeof event.type === 'string' && event.type.trim()
      ? event.type.trim()
      : (typeof event.event?.type === 'string' ? event.event.type : '');
    const data = event.event?.data;

    if (!sessionId || !eventType) {
      return;
    }

    if (eventType === 'assistant.message_delta') {
      const delta = extractText(data);
      if (!delta) {
        return;
      }

      const pending = getPending(sessionId);
      setPending(sessionId, {
        ...pending,
        content: `${pending.content}${delta}`,
      });
      return;
    }

    if (eventType === 'assistant.reasoning_delta') {
      const delta = extractText(data);
      if (!delta) {
        return;
      }

      const pending = getPending(sessionId);
      setPending(sessionId, {
        ...pending,
        reasoning: `${pending.reasoning}${delta}`,
      });
      return;
    }

    if (eventType === 'assistant.message') {
      const pending = getPending(sessionId);
      const finalized = extractText(data) || pending.content || '(assistant message received)';

      appendMessage(sessionId, {
        id: nextMessageId('assistant'),
        role: 'assistant',
        content: finalized,
        reasoning: pending.reasoning || undefined,
        createdAtMs: Date.now(),
        status: 'complete',
        eventType,
      });

      clearPending(sessionId);
      return;
    }

    if (eventType === 'assistant.reasoning') {
      const pending = getPending(sessionId);
      const reasoning = extractText(data);
      if (!reasoning) {
        return;
      }

      setPending(sessionId, {
        ...pending,
        reasoning,
      });
      return;
    }

    if (eventType === 'tool.executing' || eventType === 'tool.completed') {
      const toolName = extractText((data as Record<string, unknown> | undefined)?.toolName) || 'tool';
      const message = eventType === 'tool.executing'
        ? `Tool executing: ${toolName}`
        : `Tool completed: ${toolName}`;

      appendMessage(sessionId, {
        id: nextMessageId('tool'),
        role: 'tool',
        content: message,
        createdAtMs: Date.now(),
        status: 'complete',
        eventType,
      });
      return;
    }

    if (eventType === 'session.error') {
      const message = extractText(data) || 'SDK session reported an error.';
      appendMessage(sessionId, {
        id: nextMessageId('session-error'),
        role: 'system',
        content: message,
        createdAtMs: Date.now(),
        status: 'error',
        eventType,
      });

      store.setState((state) => ({
        ...state,
        streamStatus: 'error',
        streamError: message,
      }));
      return;
    }

    if (eventType === 'session.idle') {
      store.setState((state) => ({
        ...state,
        streamStatus: 'connected',
        streamError: null,
      }));
    }
  }

  function detachStream(): void {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }

    streamSessionId = null;

    store.setState((state) => ({
      ...state,
      streamStatus: 'disconnected',
      streamError: null,
    }));
  }

  function attachStream(sessionId: string): void {
    if (!sessionId) {
      detachStream();
      return;
    }

    if (typeof EventSource === 'undefined') {
      store.setState((state) => ({
        ...state,
        streamStatus: 'unsupported',
        streamError: 'EventSource is unavailable in this runtime.',
      }));
      return;
    }

    if (streamSessionId === sessionId && eventSource) {
      return;
    }

    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }

    streamSessionId = sessionId;

    store.setState((state) => ({
      ...state,
      streamStatus: 'connecting',
      streamError: null,
    }));

    const source = new EventSource(createSdkStreamUrl(sessionId));

    source.onopen = () => {
      store.setState((state) => ({
        ...state,
        streamStatus: 'connected',
        streamError: null,
      }));
    };

    source.onerror = () => {
      store.setState((state) => ({
        ...state,
        streamStatus: state.streamStatus === 'connected' ? 'reconnecting' : 'error',
        streamError: state.streamStatus === 'connected'
          ? 'Attempting to reconnect to SDK stream...'
          : 'SDK stream connection error.',
      }));
    };

    source.addEventListener('connected', () => {
      store.setState((state) => ({
        ...state,
        streamStatus: 'connected',
        streamError: null,
      }));
    });

    const relayEvents = [
      'assistant.message_delta',
      'assistant.reasoning_delta',
      'assistant.message',
      'assistant.reasoning',
      'session.idle',
      'session.error',
      'tool.executing',
      'tool.completed',
    ] as const;

    for (const relayEvent of relayEvents) {
      source.addEventListener(relayEvent, (nativeEvent) => {
        const payload = parseSseData((nativeEvent as MessageEvent<string>).data);
        if (!payload) {
          return;
        }

        handleSdkRelayEvent(payload);
      });
    }

    eventSource = source;
  }

  async function loadSessions(): Promise<void> {
    const nextVersion = ++listRequestVersion;

    store.setState((state) => ({
      ...state,
      loading: true,
      error: null,
    }));

    try {
      const response = await listSdkSessions();
      const nextSessions = Array.isArray(response.sessions) ? response.sessions : [];

      let nextSelectedSessionId: string | null = null;

      store.setState((state) => {
        if (nextVersion !== listRequestVersion) {
          return state;
        }

        const hasCurrentSelection =
          state.selectedSessionId != null
          && nextSessions.some((session) => session.sessionId === state.selectedSessionId);

        nextSelectedSessionId = hasCurrentSelection
          ? state.selectedSessionId
          : (nextSessions[0]?.sessionId ?? null);

        return {
          ...state,
          sessions: nextSessions,
          selectedSessionId: nextSelectedSessionId,
          loading: false,
          error: null,
        };
      });

      if (nextVersion !== listRequestVersion) {
        return;
      }

      if (nextSelectedSessionId) {
        attachStream(nextSelectedSessionId);
      } else {
        detachStream();
      }
    } catch (error) {
      const message = toErrorMessage(error, 'Unable to load SDK sessions.');

      store.setState((state) => {
        if (nextVersion !== listRequestVersion) {
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

  async function createSession(model?: string): Promise<void> {
    store.setState((state) => ({
      ...state,
      creating: true,
      error: null,
    }));

    try {
      const response = await createSdkSession({
        model: model && model.trim() ? model.trim() : undefined,
      });

      await loadSessions();
      if (response.sessionId) {
        selectSession(response.sessionId);
      }
    } catch (error) {
      const message = toErrorMessage(error, 'Unable to create SDK session.');
      store.setState((state) => ({
        ...state,
        error: message,
      }));
    } finally {
      store.setState((state) => ({
        ...state,
        creating: false,
      }));
    }
  }

  async function removeSession(sessionId: string): Promise<void> {
    const normalizedSessionId = sessionId.trim();
    if (!normalizedSessionId) {
      return;
    }

    store.setState((state) => ({
      ...state,
      deleting: true,
      error: null,
    }));

    try {
      await deleteSdkSession(normalizedSessionId);
      if (streamSessionId === normalizedSessionId) {
        detachStream();
      }

      await loadSessions();
    } catch (error) {
      const message = toErrorMessage(error, 'Unable to delete SDK session.');
      store.setState((state) => ({
        ...state,
        error: message,
      }));
    } finally {
      store.setState((state) => ({
        ...state,
        deleting: false,
      }));
    }
  }

  function selectSession(sessionId: string | null): void {
    let nextSelectedSessionId: string | null = null;

    store.setState((state) => {
      const normalizedSessionId = sessionId ? sessionId.trim() : '';
      nextSelectedSessionId = normalizedSessionId && state.sessions.some((session) => session.sessionId === normalizedSessionId)
        ? normalizedSessionId
        : null;

      return {
        ...state,
        selectedSessionId: nextSelectedSessionId,
      };
    });

    if (nextSelectedSessionId) {
      attachStream(nextSelectedSessionId);
      return;
    }

    detachStream();
  }

  function setComposerPrompt(prompt: string): void {
    store.setState((state) => ({
      ...state,
      composerPrompt: prompt,
    }));
  }

  async function sendPrompt(promptOverride?: string): Promise<void> {
    const snapshot = store.getState();
    const selectedSessionId = snapshot.selectedSessionId;
    const prompt = (promptOverride ?? snapshot.composerPrompt).trim();

    if (!selectedSessionId || !prompt) {
      return;
    }

    const nextVersion = ++sendRequestVersion;

    appendMessage(selectedSessionId, {
      id: nextMessageId('user'),
      role: 'user',
      content: prompt,
      createdAtMs: Date.now(),
      status: 'complete',
      eventType: 'user.prompt',
    });

    store.setState((state) => ({
      ...state,
      sending: true,
      error: null,
      composerPrompt: '',
    }));

    try {
      await sendSdkMessage({
        sessionId: selectedSessionId,
        prompt,
      });

      store.setState((state) => {
        if (nextVersion !== sendRequestVersion) {
          return state;
        }

        return {
          ...state,
          sending: false,
          error: null,
        };
      });
    } catch (error) {
      const message = toErrorMessage(error, 'Unable to send SDK message.');
      store.setState((state) => {
        if (nextVersion !== sendRequestVersion) {
          return state;
        }

        return {
          ...state,
          sending: false,
          error: message,
        };
      });
    }
  }

  function dispose(): void {
    detachStream();
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    loadSessions,
    createSession,
    removeSession,
    selectSession,
    setComposerPrompt,
    sendPrompt,
    attachStream,
    detachStream,
    dispose,
  };
}

export const sdkSessionsStore = createSdkSessionsStore();
