import {
  listSessions,
  listExecutorWorktrees,
  runSandboxLifecycleAction,
  toCanonicalSandboxMissingTokenErrorFromUnknown,
  toSandboxTokenRemediationMessage,
} from '../../lib/api';
import { createStore } from '../../lib/store';
import type { ExecutorWorktreeRecord, SandboxLifecycleAction, SessionSummary } from '../../lib/types';
import { gatewayStore } from '../Gateway/gatewayStore';

const SANDBOX_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

export interface SandboxesState {
  sandboxes: SessionSummary[];
  worktrees: ExecutorWorktreeRecord[];
  sandboxId: string;
  baseBranch: string;
  headBranch: string;
  loading: boolean;
  actionLoading: boolean;
  currentAction: SandboxLifecycleAction | null;
  error: string | null;
  statusMessage: string | null;
  tokenMissingBlocked: boolean;
  tokenMissingMessage: string | null;
  worktreesError: string | null;
}

const INITIAL_STATE: SandboxesState = {
  sandboxes: [],
  worktrees: [],
  sandboxId: '',
  baseBranch: 'main',
  headBranch: '',
  loading: false,
  actionLoading: false,
  currentAction: null,
  error: null,
  statusMessage: null,
  tokenMissingBlocked: false,
  tokenMissingMessage: null,
  worktreesError: null,
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return 'Unable to process sandbox request.';
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') {
    return value as Record<string, unknown>;
  }

  return {};
}

export function readSandboxId(session: SessionSummary): string {
  const record = asRecord(session);
  const sandboxValue = record.sandbox;

  if (typeof sandboxValue === 'string' && sandboxValue.trim()) {
    return sandboxValue.trim();
  }

  return typeof session.id === 'string' ? session.id : '';
}

function normalizeSandboxSessions(input: unknown): SessionSummary[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.filter((entry): entry is SessionSummary => {
    return Boolean(entry && typeof entry === 'object' && typeof (entry as SessionSummary).id === 'string');
  });
}

function getSandboxDraftEntropy(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return Math.random().toString(36).slice(2, 14);
}

function createSandboxDraftId(): string {
  const timePart = Date.now().toString(36);

  let entropyPart = getSandboxDraftEntropy()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .replace(/^-+/, '')
    .slice(0, 24);

  if (!entropyPart) {
    entropyPart = 'draft';
  }

  const candidate = `sb-${timePart}-${entropyPart}`.slice(0, 64);
  if (SANDBOX_ID_PATTERN.test(candidate)) {
    return candidate;
  }

  const fallback = `sb-${Math.random().toString(36).slice(2, 14)}`;
  return SANDBOX_ID_PATTERN.test(fallback) ? fallback : 'sb-draft-1';
}

function resolveCanonicalSandboxId(
  response: unknown,
  fallbackSandboxId: string,
  payloadSandboxId: string
): string {
  const responseRecord = asRecord(response);
  const resultRecord = asRecord(responseRecord.result);

  const candidates = [
    resultRecord.sandboxId,
    responseRecord.sandboxId,
    fallbackSandboxId,
    payloadSandboxId,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return '';
}

function createSandboxesStore() {
  const store = createStore<SandboxesState>(INITIAL_STATE);
  let requestVersion = 0;

  gatewayStore.subscribe(() => {
    const gatewayState = gatewayStore.getState();
    if (gatewayState.sandboxTokenMissing) {
      return;
    }

    store.setState((state) => {
      if (!state.tokenMissingBlocked && !state.tokenMissingMessage) {
        return state;
      }

      return {
        ...state,
        tokenMissingBlocked: false,
        tokenMissingMessage: null,
      };
    });
  });

  function readTokenMissingGate(state: SandboxesState): { blocked: boolean; message: string | null } {
    const gatewayState = gatewayStore.getState();
    const gatewayBlocked = gatewayState.sandboxTokenMissing;
    const gatewayMessage = gatewayState.sandboxTokenGuidance || null;

    return {
      blocked: state.tokenMissingBlocked || gatewayBlocked,
      message: state.tokenMissingMessage || gatewayMessage,
    };
  }

  async function loadSandboxes(): Promise<void> {
    const nextVersion = ++requestVersion;

    store.setState((state) => ({
      ...state,
      loading: true,
      error: null,
    }));

    try {
      const [response, worktreeResult] = await Promise.all([
        listSessions(undefined, {
          activeWindowMinutes: 30,
          source: 'sandbox',
        }),
        listExecutorWorktrees()
          .then((value) => ({ worktrees: value.worktrees, error: null as string | null }))
          .catch((error) => ({ worktrees: [] as ExecutorWorktreeRecord[], error: toErrorMessage(error) })),
      ]);
      const sandboxes = normalizeSandboxSessions(response.sessions);

      store.setState((state) => {
        if (nextVersion !== requestVersion) {
          return state;
        }

        const firstSandboxId = sandboxes[0] ? readSandboxId(sandboxes[0]) : '';
        const resolvedSandboxId = state.sandboxId.trim() || firstSandboxId || createSandboxDraftId();

        return {
          ...state,
          sandboxes,
          worktrees: worktreeResult.worktrees,
          sandboxId: resolvedSandboxId,
          loading: false,
          error: null,
          worktreesError: worktreeResult.error,
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
        };
      });
    }
  }

  async function runLifecycleAction(action: SandboxLifecycleAction, payload: Record<string, unknown>): Promise<string> {
    const gateState = readTokenMissingGate(store.getState());
    if (gateState.blocked) {
      const blockedMessage = gateState.message || toSandboxTokenRemediationMessage();

      store.setState((state) => ({
        ...state,
        error: blockedMessage,
        statusMessage: blockedMessage,
      }));

      throw new Error(blockedMessage);
    }

    store.setState((state) => ({
      ...state,
      actionLoading: true,
      currentAction: action,
      error: null,
      statusMessage: `Running sandbox ${action}...`,
    }));

    const stateBeforeRequest = store.getState();
    const fallbackSandboxId = stateBeforeRequest.sandboxId;
    const payloadSandboxId = typeof payload.sandboxId === 'string' ? payload.sandboxId : '';

    try {
      const response = await runSandboxLifecycleAction(action, payload);
      const canonicalSandboxId = resolveCanonicalSandboxId(response, fallbackSandboxId, payloadSandboxId);

      await loadSandboxes();

      store.setState((state) => ({
        ...state,
        actionLoading: false,
        currentAction: null,
        sandboxId: canonicalSandboxId || state.sandboxId,
        statusMessage: `Sandbox ${action} completed.`,
        tokenMissingBlocked: false,
        tokenMissingMessage: null,
      }));

      return canonicalSandboxId;
    } catch (error) {
      const canonicalMissingToken = toCanonicalSandboxMissingTokenErrorFromUnknown(error);
      const message = canonicalMissingToken
        ? toSandboxTokenRemediationMessage(error)
        : toErrorMessage(error);

      if (canonicalMissingToken) {
        gatewayStore.setSandboxTokenGate(true, message);
      }

      store.setState((state) => ({
        ...state,
        actionLoading: false,
        currentAction: null,
        error: message,
        statusMessage: `Sandbox ${action} failed.`,
        tokenMissingBlocked: Boolean(canonicalMissingToken),
        tokenMissingMessage: canonicalMissingToken ? message : null,
      }));

      throw error;
    }
  }

  function setSandboxId(value: string): void {
    store.setState((state) => ({
      ...state,
      sandboxId: value,
    }));
  }

  function setBaseBranch(value: string): void {
    store.setState((state) => ({
      ...state,
      baseBranch: value,
    }));
  }

  function setHeadBranch(value: string): void {
    store.setState((state) => ({
      ...state,
      headBranch: value,
    }));
  }

  function setStatusMessage(message: string | null): void {
    store.setState((state) => ({
      ...state,
      statusMessage: message,
    }));
  }

  async function createSandbox(): Promise<void> {
    const sandboxId = store.getState().sandboxId.trim();
    const payload = sandboxId ? { sandboxId } : {};
    await runLifecycleAction('create', payload);
  }

  async function startSandbox(): Promise<void> {
    const sandboxId = store.getState().sandboxId.trim();
    if (!sandboxId) {
      throw new Error('Sandbox start requires sandboxId.');
    }

    await runLifecycleAction('start', { sandboxId });
  }

  async function stopSandbox(): Promise<void> {
    const sandboxId = store.getState().sandboxId.trim();
    if (!sandboxId) {
      throw new Error('Sandbox stop requires sandboxId.');
    }

    await runLifecycleAction('stop', { sandboxId });
  }

  async function openSandboxTerminal(): Promise<void> {
    const sandboxId = store.getState().sandboxId.trim();
    if (!sandboxId) {
      throw new Error('Sandbox open-terminal requires sandboxId.');
    }

    await runLifecycleAction('open-terminal', { sandboxId });
  }

  async function openSandboxPullRequest(): Promise<void> {
    const { sandboxId, baseBranch, headBranch } = store.getState();
    const normalizedSandboxId = sandboxId.trim();
    const normalizedBaseBranch = baseBranch.trim();
    const normalizedHeadBranch = headBranch.trim();

    if (!normalizedSandboxId) {
      throw new Error('Sandbox pr-open requires sandboxId.');
    }

    if (!normalizedBaseBranch || !normalizedHeadBranch) {
      throw new Error('Sandbox pr-open requires baseBranch and headBranch.');
    }

    await runLifecycleAction('pr-open', {
      sandboxId: normalizedSandboxId,
      baseBranch: normalizedBaseBranch,
      headBranch: normalizedHeadBranch,
    });
  }

  async function followSandboxSession(inputSandboxId: string): Promise<SessionSummary> {
    const targetSandboxId = inputSandboxId.trim();
    if (!targetSandboxId) {
      throw new Error('Follow requires sandboxId.');
    }

    const response = await listSessions(undefined, {
      activeWindowMinutes: 30,
      source: 'sandbox',
    });
    const sandboxes = normalizeSandboxSessions(response.sessions);

    const match =
      sandboxes.find((entry) => readSandboxId(entry).toLowerCase() === targetSandboxId.toLowerCase()) ||
      sandboxes.find((entry) => entry.id.toLowerCase() === targetSandboxId.toLowerCase()) ||
      null;

    if (!match) {
      throw new Error(`Sandbox ${targetSandboxId} not found in sessions.`);
    }

    store.setState((state) => ({
      ...state,
      sandboxes,
      worktrees: store.getState().worktrees,
      sandboxId: readSandboxId(match) || targetSandboxId,
      statusMessage: `Following sandbox ${targetSandboxId} in Sessions tab.`,
      error: null,
    }));

    return match;
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    loadSandboxes,
    refresh: loadSandboxes,
    setSandboxId,
    setBaseBranch,
    setHeadBranch,
    setStatusMessage,
    createSandbox,
    startSandbox,
    stopSandbox,
    openSandboxTerminal,
    openSandboxPullRequest,
    followSandboxSession,
  };
}

export const sandboxesStore = createSandboxesStore();
