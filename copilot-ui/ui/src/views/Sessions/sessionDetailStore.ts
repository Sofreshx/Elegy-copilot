import { createStore } from '../../lib/store';
import {
  getSessionStructuredState,
  getSessionHandoff,
  getSessionProposition,
  getSessionVerificationGuide,
  getSessionAgentUsage,
  getSessionContinuationPackage,
  listSessionPlans,
  listSessionsWorkspace,
  getSessionEvents,
  getSessionPlanById,
  sendSdkMessage,
  createSdkStreamUrl,
  answerSdkQuestion,
  cancelExecutorJob,
  deleteSdkSession,
} from '../../lib/api';
import { notificationStore } from '../../stores/notificationStore';
import { questionBadgeStore } from '../../stores/questionBadgeStore';
import type {
  SessionStructuredStateResponse,
  SessionOrchestrationProjection,
  SessionEvent,
  SdkMessageEntry,
  SdkStreamStatus,
  SessionPlanArtifact,
  SessionAgentUsageResponse,
  ToolCallBlock,
  PendingQuestion,
  SessionsWorkspaceEntry,
} from '../../lib/types';

type SessionArtifactSource = 'cli' | 'vscode' | 'sandbox';
type ContinuationTargetHarness = 'codex' | 'opencode';
type ContinuationActionMode = 'copy' | 'download';
type PendingQuestionOption = NonNullable<PendingQuestion['options']>[number];

function normalizeSdkMessageRole(value: unknown): SdkMessageEntry['role'] {
  const normalized = asNonEmptyString(value)?.toLowerCase();
  if (normalized === 'user' || normalized === 'assistant' || normalized === 'system' || normalized === 'tool') {
    return normalized;
  }
  return 'unknown';
}

function normalizeSdkMessageStatus(value: unknown): SdkMessageEntry['status'] {
  const normalized = asNonEmptyString(value)?.toLowerCase();
  if (normalized === 'streaming' || normalized === 'complete' || normalized === 'error') {
    return normalized;
  }
  return 'complete';
}

function asRecordOrUndefined(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

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
  planContents: Record<string, string>;
  handoff: string | null;
  proposition: string | null;
  verificationGuide: string | null;
  agentUsage: SessionAgentUsageResponse | null;
  toolCalls: ToolCallBlock[];
  pendingQuestions: PendingQuestion[];
  sendError: string | null;
  lastFailedPrompt: string | null;
  lastFailedMessageId: string | null;
  stopping: boolean;
  refreshing: boolean;
  historyLoaded: boolean;
  streamPaused: boolean;
  isRemote: boolean;
  remoteUrl: string | null;
  remoteSessionId: string | null;
  continuationActionKey: string | null;
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
  planContents: {},
  handoff: null,
  proposition: null,
  verificationGuide: null,
  agentUsage: null,
  toolCalls: [],
  pendingQuestions: [],
  sendError: null,
  lastFailedPrompt: null,
  lastFailedMessageId: null,
  stopping: false,
  refreshing: false,
  historyLoaded: false,
  streamPaused: false,
  isRemote: false,
  remoteUrl: null,
  remoteSessionId: null,
  continuationActionKey: null,
};

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeSessionArtifactSource(value: unknown): SessionArtifactSource | null {
  const normalized = asNonEmptyString(value)?.toLowerCase();
  if (normalized === 'cli' || normalized === 'vscode' || normalized === 'sandbox') {
    return normalized;
  }
  return null;
}

function findWorkspaceSessionEntry(entries: SessionsWorkspaceEntry[], sessionId: string): SessionsWorkspaceEntry | null {
  return entries.find((entry) => entry.sessionId === sessionId)
    ?? entries.find((entry) => entry.linkedSessionId === sessionId)
    ?? null;
}

async function resolveSessionArtifactLocator(
  sessionId: string,
  source?: string,
  sandbox?: string
): Promise<{ source?: SessionArtifactSource; sandbox?: string }> {
  const normalizedSource = normalizeSessionArtifactSource(source);
  const normalizedSandbox = normalizedSource === 'sandbox'
    ? asNonEmptyString(sandbox) ?? undefined
    : undefined;

  if (normalizedSource) {
    return {
      source: normalizedSource,
      sandbox: normalizedSandbox,
    };
  }

  try {
    const workspace = await listSessionsWorkspace();
    const entry = findWorkspaceSessionEntry(
      [...workspace.active, ...workspace.history],
      sessionId,
    );
    const workspaceSource = normalizeSessionArtifactSource(entry?.detail?.source ?? entry?.source);
    if (!workspaceSource) {
      return {};
    }
    return {
      source: workspaceSource,
      sandbox: workspaceSource === 'sandbox'
        ? asNonEmptyString(entry?.detail?.sandbox) ?? undefined
        : undefined,
    };
  } catch {
    return {};
  }
}

function buildContinuationActionKey(mode: ContinuationActionMode, targetHarness: ContinuationTargetHarness): string {
  return `${mode}:${targetHarness}`;
}

function formatContinuationHarnessLabel(targetHarness: ContinuationTargetHarness): string {
  return targetHarness === 'opencode' ? 'OpenCode' : 'Codex';
}

function sanitizeFilenameSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function buildContinuationFilename(sessionId: string, targetHarness: ContinuationTargetHarness): string {
  return `${sanitizeFilenameSegment(sessionId)}-${targetHarness}-continuation-package.json`;
}

function isOrchestrationProjection(
  value: unknown
): value is SessionOrchestrationProjection {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// ── Event normalization helpers ────────────────────────────────────
// events.jsonl uses several schema variants; these helpers handle them all.

function eventTypeOf(ev: SessionEvent): string | null {
  return (ev.type || ev.event || ev.name || null) as string | null;
}

function eventTimeMs(ev: SessionEvent): number {
  for (const field of ['timestamp', 'time', 'ts', 'createdAt', 'at', 'date'] as const) {
    const val = (ev as Record<string, unknown>)[field];
    if (typeof val === 'number') return val > 1e12 ? val : val * 1000;
    if (typeof val === 'string') {
      const ms = Date.parse(val);
      if (!isNaN(ms)) return ms;
    }
  }
  return 0;
}

function eventPayload(ev: SessionEvent): Record<string, unknown> {
  return (ev.payload || ev.data || ev) as Record<string, unknown>;
}

function convertEventsToTimeline(events: SessionEvent[]): {
  messages: SdkMessageEntry[];
  toolCalls: ToolCallBlock[];
  questions: PendingQuestion[];
} {
  const messages: SdkMessageEntry[] = [];
  const toolCalls: ToolCallBlock[] = [];
  const questions: PendingQuestion[] = [];
  const seenMessageIds = new Set<string>();
  const toolCallMap = new Map<string, ToolCallBlock>();
  const questionMap = new Map<string, PendingQuestion>();

  for (const ev of events) {
    const type = eventTypeOf(ev);
    const payload = eventPayload(ev);
    const ts = eventTimeMs(ev);

    if (type === 'user.message') {
      const content = String(payload.content || payload.transformedContent || '');
      const id = String(ev.id || payload.messageId || `hist-user-${ts}`);
      if (!seenMessageIds.has(id) && content) {
        seenMessageIds.add(id);
        messages.push({
          id,
          role: 'user',
          content,
          createdAtMs: ts || Date.now(),
          status: 'complete',
          eventType: type,
        });
      }
    }

    if (type === 'assistant.message') {
      const content = String(payload.content || '');
      const reasoning = payload.reasoningText || payload.reasoning;
      const id = String(payload.messageId || ev.id || `hist-asst-${ts}`);
      if (!seenMessageIds.has(id)) {
        seenMessageIds.add(id);
        messages.push({
          id,
          role: 'assistant',
          content,
          reasoning: reasoning ? String(reasoning) : undefined,
          createdAtMs: ts || Date.now(),
          status: 'complete',
          eventType: type,
        });
      }
    }

    if (type === 'tool.execution_start' || type === 'tool.executing') {
      const toolCallId = String(payload.toolCallId || ev.id || `hist-tc-${ts}`);
      if (!toolCallMap.has(toolCallId)) {
        toolCallMap.set(toolCallId, {
          toolCallId,
          toolName: String(payload.toolName || payload.name || 'unknown'),
          arguments: (payload.arguments ?? payload.input) as Record<string, unknown> | undefined,
          status: 'executing',
          startedAtMs: ts || Date.now(),
        });
      }
    }

    if (type === 'tool.execution_complete' || type === 'tool.completed') {
      const toolCallId = String(payload.toolCallId || ev.id || `hist-tc-${ts}`);
      const existing = toolCallMap.get(toolCallId);
      if (existing) {
        existing.status = 'completed';
        existing.output = payload.output !== undefined ? String(payload.output) : undefined;
        existing.completedAtMs = ts || Date.now();
      } else {
        toolCallMap.set(toolCallId, {
          toolCallId,
          toolName: String(payload.toolName || payload.name || 'unknown'),
          arguments: (payload.arguments ?? payload.input) as Record<string, unknown> | undefined,
          output: payload.output !== undefined ? String(payload.output) : undefined,
          status: 'completed',
          startedAtMs: ts || Date.now(),
          completedAtMs: ts || Date.now(),
        });
      }
    }

    if (type === 'question.asked') {
      const qId = String(payload.toolCallId || ev.id || `hist-q-${ts}`);
      if (!questionMap.has(qId)) {
        questionMap.set(qId, {
          questionId: qId,
          toolCallId: String(payload.toolCallId || ''),
          question: String(payload.question || ''),
          options: Array.isArray(payload.options) ? payload.options : undefined,
          askedAtMs: ts || Date.now(),
          answered: false,
        });
      }
    }

    if (type === 'question.answered') {
      const qId = String(payload.toolCallId || ev.id || '');
      const existing = questionMap.get(qId);
      if (existing) {
        existing.answered = true;
        existing.answeredValue = String(payload.answer || payload.value || '');
      }
    }
  }

  toolCalls.push(...toolCallMap.values());
  questions.push(...questionMap.values());

  return { messages, toolCalls, questions };
}

function createSessionDetailStore() {
  const store = createStore<SessionDetailState>(INITIAL_STATE);
  let activeEventSource: EventSource | null = null;
  let activeReconnectTimer: (() => void) | null = null;
  let pauseBuffer: Record<string, unknown>[] = [];

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
      historyLoaded: false,
      // Clear live data from previous session
      sdkMessages: [],
      sdkPendingContent: '',
      sdkPendingReasoning: '',
      toolCalls: [],
      pendingQuestions: [],
      planContents: {},
      sendError: null,
        lastFailedPrompt: null,
        lastFailedMessageId: null,
      }));

    const locator = await resolveSessionArtifactLocator(sessionId, source, sandbox);
    const resolvedSource = locator.source;
    const resolvedSandbox = locator.sandbox;

    if (store.getState().sessionId !== sessionId) {
      return;
    }

    store.setState((s) => ({
      ...s,
      sessionSource: resolvedSource ?? null,
      sessionSandbox: resolvedSandbox ?? null,
    }));

    const opts = { source: resolvedSource, sandbox: resolvedSandbox };

    const results = await Promise.allSettled([
      getSessionStructuredState(sessionId, opts),
      listSessionPlans(sessionId, opts),
      getSessionAgentUsage(sessionId, opts),
      getSessionHandoff(sessionId, opts),
      getSessionProposition(sessionId, opts),
      getSessionVerificationGuide(sessionId, opts),
      getSessionEvents(sessionId, { ...opts, limit: 500 }),
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
    const eventsResp =
      results[6].status === 'fulfilled' ? results[6].value : null;

    const rawOrch = structuredState?.orchestration ?? null;
    const orchestration = isOrchestrationProjection(rawOrch) ? rawOrch : null;

    // Convert historical events into timeline items
    const history = eventsResp?.events
      ? convertEventsToTimeline(eventsResp.events)
      : { messages: [], toolCalls: [], questions: [] };

    const firstError = results.find((r) => r.status === 'rejected') as
      | PromiseRejectedResult
      | undefined;

    store.setState((s) => ({
      ...s,
      loading: false,
      historyLoaded: true,
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
      sdkMessages: history.messages,
      toolCalls: history.toolCalls,
      pendingQuestions: history.questions,
    }));
  }

  function attachStream(sessionId: string): void {
    detachStream();

    store.setState((s) => ({ ...s, sdkStreamStatus: 'connecting' }));

    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 5;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    // ── Shared SSE handler ──────────────────────────────────────────
    // Defined at the attachStream level since it doesn't depend on `es`.
    function handleSseData(data: Record<string, unknown>): void {
      // When paused, buffer events instead of applying them
      if (store.getState().streamPaused) {
        pauseBuffer.push(data);
        return;
      }

      const eventType = (data.type ?? (data.event as Record<string, unknown> | undefined)?.type) as string | undefined;
      const eventData = ((data.event as Record<string, unknown> | undefined)?.data ??
        (data.event as Record<string, unknown> | undefined) ??
        data) as Record<string, unknown>;

      if (eventData.content !== undefined || eventData.reasoning !== undefined) {
        store.setState((s) => ({
          ...s,
          sdkPendingContent:
            eventData.content !== undefined
              ? String(eventData.content)
              : s.sdkPendingContent,
          sdkPendingReasoning:
            eventData.reasoning !== undefined
              ? String(eventData.reasoning)
              : s.sdkPendingReasoning,
        }));
      }

      if (eventData.id && eventData.role) {
        const entry: SdkMessageEntry = {
          id: String(eventData.id),
          role: normalizeSdkMessageRole(eventData.role),
          content: String(eventData.content ?? ''),
          reasoning: eventData.reasoning ? String(eventData.reasoning) : undefined,
          createdAtMs:
            typeof eventData.createdAtMs === 'number'
              ? eventData.createdAtMs
              : Date.now(),
          status: normalizeSdkMessageStatus(eventData.status),
          eventType: eventData.eventType as string | undefined,
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

      // Handle tool.executing events
      if (eventType === 'tool.executing' && eventData.toolCallId) {
        const block: ToolCallBlock = {
          toolCallId: String(eventData.toolCallId),
          toolName: String(eventData.toolName ?? 'unknown'),
          arguments: asRecordOrUndefined(eventData.arguments),
          status: 'executing',
          startedAtMs: typeof eventData.startedAtMs === 'number'
            ? eventData.startedAtMs
            : Date.now(),
        };

        store.setState((s) => {
          const exists = s.toolCalls.some(
            (tc) => tc.toolCallId === block.toolCallId
          );
          return {
            ...s,
            toolCalls: exists ? s.toolCalls : [...s.toolCalls, block],
          };
        });
      }

      // Handle tool.completed events
      if (eventType === 'tool.completed' && eventData.toolCallId) {
        const toolCallId = String(eventData.toolCallId);
        const output = eventData.output !== undefined
          ? String(eventData.output)
          : undefined;
        const completedAtMs = typeof eventData.completedAtMs === 'number'
          ? eventData.completedAtMs
          : Date.now();

        store.setState((s) => {
          const idx = s.toolCalls.findIndex(
            (tc) => tc.toolCallId === toolCallId
          );
          if (idx < 0) {
            return {
              ...s,
              toolCalls: [
                ...s.toolCalls,
                {
                  toolCallId,
                  toolName: String(eventData.toolName ?? 'unknown'),
                  arguments: asRecordOrUndefined(eventData.arguments),
                  output,
                  status: 'completed' as const,
                  startedAtMs: completedAtMs,
                  completedAtMs,
                },
              ],
            };
          }
          return {
            ...s,
            toolCalls: s.toolCalls.map((tc, i) =>
              i === idx
                ? { ...tc, status: 'completed' as const, output, completedAtMs }
                : tc
            ),
          };
        });
      }

      // Handle question.asked events
      if (eventType === 'question.asked') {
        const pq: PendingQuestion = {
          questionId: String(eventData.toolCallId || `q-${Date.now()}`),
          toolCallId: String(eventData.toolCallId || ''),
          question: String(eventData.question || ''),
          options: Array.isArray(eventData.options)
            ? eventData.options.filter((option): option is PendingQuestionOption => {
                return Boolean(
                  option
                  && typeof option === 'object'
                  && typeof (option as { label?: unknown }).label === 'string'
                  && typeof (option as { value?: unknown }).value === 'string'
                );
              })
            : undefined,
          askedAtMs: Date.now(),
          answered: false,
        };

        store.setState((s) => ({
          ...s,
          pendingQuestions: [...s.pendingQuestions, pq],
        }));

        // Report to global badge store
        const sid = store.getState().sessionId;
        if (sid) {
          const unansweredCount = store.getState().pendingQuestions.filter((q) => !q.answered).length;
          questionBadgeStore.reportQuestion(sid, unansweredCount);
        }

        // Toast notification so user notices even when on another view
        notificationStore.warning('Model needs input', {
          message: String(eventData.question || 'A session is waiting for your answer'),
          duration: null,
        });
      }

      // Handle question.answered events
      if (eventType === 'question.answered') {
        const toolCallId = String(eventData.toolCallId || '');
        store.setState((s) => ({
          ...s,
          pendingQuestions: s.pendingQuestions.map((q) =>
            q.toolCallId === toolCallId
              ? { ...q, answered: true, answeredValue: String(eventData.answer || '') }
              : q
          ),
        }));

        // Update global badge store
        const sid2 = store.getState().sessionId;
        if (sid2) {
          const unansweredCount = store.getState().pendingQuestions.filter((q) => !q.answered).length;
          questionBadgeStore.reportQuestion(sid2, unansweredCount);
        }
      }

      // Handle remote session events
      if (eventType === 'session.remote_status' || eventType === 'session.info') {
        const url = eventData.remoteUrl ?? eventData.url;
        if (url) {
          store.setState((s) => ({
            ...s,
            isRemote: true,
            remoteUrl: String(url),
          }));
        }
        if (eventData.isRemote !== undefined) {
          store.setState((s) => ({
            ...s,
            isRemote: Boolean(eventData.isRemote),
          }));
        }
      }

      if (eventType === 'session.handoff') {
        const remoteSessionId = eventData.remoteSessionId ?? eventData.taskId;
        if (remoteSessionId) {
          store.setState((s) => ({
            ...s,
            remoteSessionId: String(remoteSessionId),
          }));
        }
      }

      if (eventType === 'session.warning') {
        const message = String(eventData.message || eventData.reason || 'Remote session warning');
        notificationStore.warning('Remote Session Warning', {
          message,
          duration: 8000,
        });
      }
    }

    function parseSsePayload(raw: string): Record<string, unknown> | null {
      try {
        return JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return null;
      }
    }

    function connect() {
      const url = createSdkStreamUrl(sessionId);
      const es = new EventSource(url);
      activeEventSource = es;

      es.onopen = () => {
        reconnectAttempts = 0;
        store.setState((s) => ({ ...s, sdkStreamStatus: 'connected' }));
      };

      es.addEventListener('connected', () => {
        store.setState((s) => ({ ...s, sdkStreamStatus: 'connected' }));
      });

      const namedEvents = [
        'assistant.message_delta',
        'assistant.reasoning_delta',
        'assistant.message',
        'assistant.reasoning',
        'session.idle',
        'session.error',
        'session.info',
        'session.handoff',
        'session.warning',
        'session.remote_status',
        'tool.executing',
        'tool.completed',
        'question.asked',
        'question.answered',
      ] as const;

      for (const eventName of namedEvents) {
        es.addEventListener(eventName, (nativeEvent) => {
          const payload = parseSsePayload((nativeEvent as MessageEvent<string>).data);
          if (!payload) return;
          handleSseData(payload);
        });
      }

      // Fallback: catch any unnamed/generic events that lack an `event:` field
      es.onmessage = (event) => {
        const payload = parseSsePayload(event.data);
        if (!payload) return;
        handleSseData(payload);
      };

      es.onerror = () => {
        if (es.readyState === EventSource.CLOSED) {
          // Permanently closed — attempt manual reconnect with exponential backoff
          if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 30000);
            store.setState((s) => ({ ...s, sdkStreamStatus: 'reconnecting' }));
            reconnectTimer = setTimeout(() => {
              if (activeEventSource === es) {
                connect();
              }
            }, delay);
          } else {
            store.setState((s) => ({ ...s, sdkStreamStatus: 'error' }));
          }
        } else {
          // CONNECTING — EventSource is auto-reconnecting per spec
          store.setState((s) => ({ ...s, sdkStreamStatus: 'reconnecting' }));
        }
      };
    }

    connect();

    // Store cleanup ref so detachStream can clear pending reconnect timers
    activeReconnectTimer = () => {
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };
  }

  function detachStream(): void {
    if (activeReconnectTimer) {
      activeReconnectTimer();
      activeReconnectTimer = null;
    }
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
    pauseBuffer = [];
  }

  function pauseStream(): void {
    store.setState((s) => ({ ...s, streamPaused: true, sdkStreamStatus: 'paused' }));
  }

  function resumeStream(): void {
    const hadBuffered = pauseBuffer.length > 0;
    pauseBuffer = [];
    store.setState((s) => ({ ...s, streamPaused: false }));

    // If events were buffered while paused, do a quick re-sync to catch up
    if (hadBuffered) {
      const { sessionId, sessionSource, sessionSandbox } = store.getState();
      if (sessionId) {
        getSessionEvents(sessionId, {
          source: sessionSource ?? undefined,
          sandbox: sessionSandbox ?? undefined,
          limit: 500,
        }).then((resp) => {
          if (resp?.events && !store.getState().streamPaused) {
            const history = convertEventsToTimeline(resp.events);
            store.setState((s) => ({
              ...s,
              sdkMessages: history.messages,
              toolCalls: history.toolCalls,
              pendingQuestions: history.questions,
            }));
          }
        }).catch(() => {
          // Non-critical — live stream will continue delivering new events
        });
      }
    }

    // Restore connected status if stream is still attached
    if (activeEventSource && activeEventSource.readyState !== EventSource.CLOSED) {
      store.setState((s) => ({ ...s, sdkStreamStatus: 'connected' }));
    }
  }

  async function sendMessage(prompt: string): Promise<void> {
    const { sessionId } = store.getState();
    if (!sessionId || !prompt.trim()) return;

    store.setState((s) => ({ ...s, sendError: null, lastFailedPrompt: null, lastFailedMessageId: null }));

    const messageId = `user-${Date.now()}`;
    const userEntry: SdkMessageEntry = {
      id: messageId,
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
        sendError: `Send failed: ${err instanceof Error ? err.message : String(err)}`,
        lastFailedPrompt: prompt.trim(),
        lastFailedMessageId: messageId,
      }));
    }
  }

  function retrySend(): void {
    const { lastFailedPrompt, lastFailedMessageId } = store.getState();
    if (lastFailedPrompt) {
      // Remove the failed optimistic message so sendMessage can re-add it
      store.setState((s) => ({
        ...s,
        sendError: null,
        lastFailedPrompt: null,
        lastFailedMessageId: null,
        sdkMessages: lastFailedMessageId
          ? s.sdkMessages.filter((m) => m.id !== lastFailedMessageId)
          : s.sdkMessages,
      }));
      void sendMessage(lastFailedPrompt);
    }
  }

  function dismissSendError(): void {
    const { lastFailedMessageId } = store.getState();
    store.setState((s) => ({
      ...s,
      sendError: null,
      lastFailedPrompt: null,
      lastFailedMessageId: null,
      sdkMessages: lastFailedMessageId
        ? s.sdkMessages.filter((m) => m.id !== lastFailedMessageId)
        : s.sdkMessages,
    }));
  }

  function setComposerPrompt(value: string): void {
    store.setState((s) => ({ ...s, composerPrompt: value }));
  }

  function reset(): void {
    detachStream();
    store.setState(INITIAL_STATE);
  }

  async function answerQuestion(toolCallId: string, answer: string): Promise<void> {
    const { sessionId } = store.getState();
    if (!sessionId || !toolCallId) return;

    try {
      await answerSdkQuestion({ sessionId, toolCallId, answer });

      // Only mark answered after the API call succeeds
      store.setState((s) => ({
        ...s,
        pendingQuestions: s.pendingQuestions.map((q) =>
          q.toolCallId === toolCallId
            ? { ...q, answered: true, answeredValue: answer }
            : q
        ),
      }));
    } catch (err) {
      console.error('Failed to answer question:', err);
      // Don't mark as answered — user can retry
      store.setState((s) => ({
        ...s,
        error: `Answer failed: ${err instanceof Error ? err.message : String(err)}`,
      }));
    }
  }

  async function stopSession(): Promise<void> {
    const { sessionId } = store.getState();
    if (!sessionId) return;

    store.setState((s) => ({ ...s, stopping: true, error: null }));

    try {
      try {
        await cancelExecutorJob(sessionId);
      } catch {
        // Executor job might not exist — that's OK
      }

      await deleteSdkSession(sessionId);

      detachStream();
      store.setState((s) => ({
        ...s,
        stopping: false,
        sdkStreamStatus: 'disconnected',
      }));

      notificationStore.success('Session stopped', {
        message: `Session ${sessionId} has been stopped.`,
      });
    } catch (err) {
      store.setState((s) => ({
        ...s,
        stopping: false,
        error: `Stop failed: ${err instanceof Error ? err.message : String(err)}`,
      }));
    }
  }

  async function refreshSession(): Promise<void> {
    const { sessionId, sessionSource, sessionSandbox } = store.getState();
    if (!sessionId) return;

    store.setState((s) => ({ ...s, refreshing: true }));

    try {
      await loadSession(sessionId, sessionSource ?? undefined, sessionSandbox ?? undefined);
    } finally {
      store.setState((s) => ({ ...s, refreshing: false }));
    }
  }

  async function fetchContinuationPackage(targetHarness: ContinuationTargetHarness) {
    const { sessionId, sessionSource, sessionSandbox } = store.getState();
    if (!sessionId) {
      throw new Error('No session selected.');
    }

    return getSessionContinuationPackage(sessionId, {
      source: sessionSource ?? undefined,
      sandbox: sessionSandbox ?? undefined,
      targetHarness,
    });
  }

  async function copyContinuationPrompt(targetHarness: ContinuationTargetHarness): Promise<void> {
    if (typeof navigator === 'undefined' || typeof navigator.clipboard?.writeText !== 'function') {
      notificationStore.error('Continuation copy failed', {
        message: 'Clipboard access is unavailable in this environment.',
      });
      return;
    }

    const actionKey = buildContinuationActionKey('copy', targetHarness);
    store.setState((s) => ({ ...s, continuationActionKey: actionKey }));

    try {
      const continuationPackage = await fetchContinuationPackage(targetHarness);
      await navigator.clipboard.writeText(continuationPackage.prompt.text);
      notificationStore.success('Continuation prompt copied', {
        message: `${formatContinuationHarnessLabel(targetHarness)} continuation prompt copied to the clipboard.`,
      });
    } catch (err) {
      notificationStore.error('Continuation copy failed', {
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      store.setState((s) => (
        s.continuationActionKey === actionKey
          ? { ...s, continuationActionKey: null }
          : s
      ));
    }
  }

  async function downloadContinuationPackage(targetHarness: ContinuationTargetHarness): Promise<void> {
    const { sessionId } = store.getState();
    if (!sessionId) {
      notificationStore.error('Continuation export failed', {
        message: 'No session selected.',
      });
      return;
    }

    if (
      typeof window === 'undefined'
      || typeof document === 'undefined'
      || typeof Blob === 'undefined'
      || typeof window.URL?.createObjectURL !== 'function'
      || typeof window.URL?.revokeObjectURL !== 'function'
    ) {
      notificationStore.error('Continuation export failed', {
        message: 'File downloads are unavailable in this environment.',
      });
      return;
    }

    const actionKey = buildContinuationActionKey('download', targetHarness);
    store.setState((s) => ({ ...s, continuationActionKey: actionKey }));

    try {
      const continuationPackage = await fetchContinuationPackage(targetHarness);
      const fileName = buildContinuationFilename(sessionId, targetHarness);
      const blob = new Blob([JSON.stringify(continuationPackage, null, 2)], {
        type: 'application/json',
      });
      const objectUrl = window.URL.createObjectURL(blob);

      try {
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = fileName;
        if (document.body) {
          document.body.appendChild(link);
        }
        link.click();
        link.remove();
      } finally {
        window.URL.revokeObjectURL(objectUrl);
      }

      notificationStore.success('Continuation package exported', {
        message: `Downloaded ${fileName}.`,
      });
    } catch (err) {
      notificationStore.error('Continuation export failed', {
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      store.setState((s) => (
        s.continuationActionKey === actionKey
          ? { ...s, continuationActionKey: null }
          : s
      ));
    }
  }

  async function loadPlanContent(planId: string): Promise<void> {
    const { sessionId, sessionSource, sessionSandbox, planContents } = store.getState();
    if (!sessionId || planContents[planId] !== undefined) return;

    // Mark as loading with a sentinel
    store.setState((s) => ({
      ...s,
      planContents: { ...s.planContents, [planId]: '' },
    }));

    try {
      const text = await getSessionPlanById(
        sessionId,
        planId,
        { source: sessionSource ?? undefined, sandbox: sessionSandbox ?? undefined }
      );
      store.setState((s) => ({
        ...s,
        planContents: { ...s.planContents, [planId]: text || '(empty plan)' },
      }));
    } catch {
      store.setState((s) => ({
        ...s,
        planContents: { ...s.planContents, [planId]: '(failed to load plan content)' },
      }));
    }
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
    answerQuestion,
    retrySend,
    dismissSendError,
    stopSession,
    refreshSession,
    copyContinuationPrompt,
    downloadContinuationPackage,
    loadPlanContent,
    pauseStream,
    resumeStream,
    reset,
  };
}

export const sessionDetailStore = createSessionDetailStore();
