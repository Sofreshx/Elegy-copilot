import { createStore } from '../../lib/store';
import {
  getSessionStructuredState,
  getSessionHandoff,
  getSessionProposition,
  getSessionVerificationGuide,
  getSessionAgentUsage,
  listSessionPlans,
  sendSdkMessage,
  createSdkStreamUrl,
} from '../../lib/api';
import type {
  SessionStructuredStateResponse,
  SessionOrchestrationProjection,
  SdkMessageEntry,
  SdkStreamStatus,
  SessionPlanArtifact,
  SessionAgentUsageResponse,
} from '../../lib/types';

export interface SessionDetailState {
  sessionId: string | null;
  sessionSource: string | null;
  sessionSandbox: string | null;
  loading: boolean;
  error: string | null;
  structuredState: SessionStructuredStateResponse | null;
  orchestration: SessionOrchestrationProjection | null;
  sdkMessages: SdkMessageEntry[];
  sdkPendingContent: string;
  sdkPendingReasoning: string;
  sdkStreamStatus: SdkStreamStatus;
  composerPrompt: string;
  plans: SessionPlanArtifact[];
  handoff: string | null;
  proposition: string | null;
  verificationGuide: string | null;
  agentUsage: SessionAgentUsageResponse | null;
}

const INITIAL_STATE: SessionDetailState = {
  sessionId: null,
  sessionSource: null,
  sessionSandbox: null,
  loading: false,
  error: null,
  structuredState: null,
  orchestration: null,
  sdkMessages: [],
  sdkPendingContent: '',
  sdkPendingReasoning: '',
  sdkStreamStatus: 'disconnected',
  composerPrompt: '',
  plans: [],
  handoff: null,
  proposition: null,
  verificationGuide: null,
  agentUsage: null,
};

function isOrchestrationProjection(
  value: unknown
): value is SessionOrchestrationProjection {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function createSessionDetailStore() {
  const store = createStore<SessionDetailState>(INITIAL_STATE);
  let activeEventSource: EventSource | null = null;

  async function loadSession(
    sessionId: string,
    source?: string,
    sandbox?: string
  ): Promise<void> {
    store.setState((s) => ({
      ...s,
      sessionId,
      sessionSource: source ?? null,
      sessionSandbox: sandbox ?? null,
      loading: true,
      error: null,
    }));

    const opts = { source, sandbox };

    const results = await Promise.allSettled([
      getSessionStructuredState(sessionId, opts),
      listSessionPlans(sessionId, opts),
      getSessionAgentUsage(sessionId, opts),
      getSessionHandoff(sessionId, opts),
      getSessionProposition(sessionId, opts),
      getSessionVerificationGuide(sessionId, opts),
    ]);

    const structuredState =
      results[0].status === 'fulfilled' ? results[0].value : null;
    const plansResp =
      results[1].status === 'fulfilled' ? results[1].value : null;
    const agentUsage =
      results[2].status === 'fulfilled' ? results[2].value : null;
    const handoffResp =
      results[3].status === 'fulfilled' ? results[3].value : null;
    const propositionResp =
      results[4].status === 'fulfilled' ? results[4].value : null;
    const verificationResp =
      results[5].status === 'fulfilled' ? results[5].value : null;

    const rawOrch = structuredState?.orchestration ?? null;
    const orchestration = isOrchestrationProjection(rawOrch) ? rawOrch : null;

    const firstError = results.find((r) => r.status === 'rejected') as
      | PromiseRejectedResult
      | undefined;

    store.setState((s) => ({
      ...s,
      loading: false,
      error:
        !structuredState && firstError
          ? String(firstError.reason ?? 'Failed to load session')
          : null,
      structuredState,
      orchestration,
      plans: plansResp?.plans ?? [],
      agentUsage,
      handoff: handoffResp?.content ?? null,
      proposition: propositionResp?.content ?? null,
      verificationGuide: verificationResp?.content ?? null,
    }));
  }

  function attachStream(sessionId: string): void {
    detachStream();

    store.setState((s) => ({ ...s, sdkStreamStatus: 'connecting' }));

    const url = createSdkStreamUrl(sessionId);
    const es = new EventSource(url);
    activeEventSource = es;

    es.onopen = () => {
      store.setState((s) => ({ ...s, sdkStreamStatus: 'connected' }));
    };

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.content !== undefined || data.reasoning !== undefined) {
          store.setState((s) => ({
            ...s,
            sdkPendingContent:
              data.content !== undefined
                ? String(data.content)
                : s.sdkPendingContent,
            sdkPendingReasoning:
              data.reasoning !== undefined
                ? String(data.reasoning)
                : s.sdkPendingReasoning,
          }));
        }

        if (data.id && data.role) {
          const entry: SdkMessageEntry = {
            id: String(data.id),
            role: data.role ?? 'unknown',
            content: String(data.content ?? ''),
            reasoning: data.reasoning ? String(data.reasoning) : undefined,
            createdAtMs:
              typeof data.createdAtMs === 'number'
                ? data.createdAtMs
                : Date.now(),
            status: data.status ?? 'complete',
            eventType: data.eventType,
          };

          store.setState((s) => {
            const existing = s.sdkMessages.findIndex(
              (m) => m.id === entry.id
            );
            const messages =
              existing >= 0
                ? s.sdkMessages.map((m, i) => (i === existing ? entry : m))
                : [...s.sdkMessages, entry];

            return {
              ...s,
              sdkMessages: messages,
              sdkPendingContent: '',
              sdkPendingReasoning: '',
            };
          });
        }
      } catch {
        // Ignore unparseable events
      }
    };

    es.onerror = () => {
      store.setState((s) => ({
        ...s,
        sdkStreamStatus: es.readyState === EventSource.CONNECTING
          ? 'reconnecting'
          : 'error',
      }));
    };
  }

  function detachStream(): void {
    if (activeEventSource) {
      activeEventSource.close();
      activeEventSource = null;
    }
    store.setState((s) => ({
      ...s,
      sdkStreamStatus: 'disconnected',
      sdkPendingContent: '',
      sdkPendingReasoning: '',
    }));
  }

  async function sendMessage(prompt: string): Promise<void> {
    const { sessionId } = store.getState();
    if (!sessionId || !prompt.trim()) return;

    const userEntry: SdkMessageEntry = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: prompt.trim(),
      createdAtMs: Date.now(),
      status: 'complete',
    };

    store.setState((s) => ({
      ...s,
      sdkMessages: [...s.sdkMessages, userEntry],
      composerPrompt: '',
    }));

    try {
      await sendSdkMessage({ sessionId, prompt: prompt.trim() });
    } catch (err) {
      store.setState((s) => ({
        ...s,
        error: `Send failed: ${err instanceof Error ? err.message : String(err)}`,
      }));
    }
  }

  function setComposerPrompt(value: string): void {
    store.setState((s) => ({ ...s, composerPrompt: value }));
  }

  function reset(): void {
    detachStream();
    store.setState(INITIAL_STATE);
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    setState: store.setState,
    loadSession,
    attachStream,
    detachStream,
    sendMessage,
    setComposerPrompt,
    reset,
  };
}

export const sessionDetailStore = createSessionDetailStore();
