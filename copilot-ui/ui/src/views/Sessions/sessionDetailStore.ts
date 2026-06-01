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
} from '../../lib/api';
import { notificationStore } from '../../stores/notificationStore';
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
    // SDK bridge removed — no live stream available
    store.setState((s) => ({ ...s, sdkStreamStatus: 'disconnected' }));
  }

  // attachStream_DISABLED: SDK bridge removed. Original implementation deleted.
  function attachStream_DISABLED(sessionId: string): void {
    // Dead code — SDK bridge no longer available
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

    // SDK bridge removed — sending messages is no longer supported
    store.setState((s) => ({
      ...s,
      sendError: 'SDK bridge is no longer available. Session detail is read-only.',
    }));
  }

  function retrySend(): void {
    // SDK bridge removed — retry not supported
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
    // SDK bridge removed — answering questions is no longer supported
    store.setState((s) => ({
      ...s,
      error: 'SDK bridge is no longer available. Cannot answer questions.',
    }));
  }

  async function stopSession(): Promise<void> {
    // SDK bridge removed — stopping sessions is no longer supported
    store.setState((s) => ({
      ...s,
      error: 'SDK bridge is no longer available. Cannot stop sessions.',
    }));
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
