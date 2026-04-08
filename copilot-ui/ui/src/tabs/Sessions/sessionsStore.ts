import { getSessionStructuredState, listSessions } from '../../lib/api';
import { createStore } from '../../lib/store';
import type { SessionOrchestrationProjection, SessionStructuredStateResponse, SessionSummary } from '../../lib/types';

export type SessionsTaskBoardGroupBy = 'status' | 'actor' | 'workflow' | 'none';

export interface SessionsState {
  sessions: SessionSummary[];
  selectedSessionId: string | null;
  sessionOrchestrationById: Record<string, SessionOrchestrationProjection>;
  orchestrationLoading: boolean;
  orchestrationError: string | null;
  taskBoardFilterStatus: string;
  taskBoardGroupBy: SessionsTaskBoardGroupBy;
  selectedTaskId: string | null;
  loading: boolean;
  error: string | null;
}

const INITIAL_STATE: SessionsState = {
  sessions: [],
  selectedSessionId: null,
  sessionOrchestrationById: {},
  orchestrationLoading: false,
  orchestrationError: null,
  taskBoardFilterStatus: 'all',
  taskBoardGroupBy: 'status',
  selectedTaskId: null,
  loading: false,
  error: null,
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return 'Unable to load sessions.';
}

function createSessionsStore() {
  const store = createStore<SessionsState>(INITIAL_STATE);
  let requestVersion = 0;
  let orchestrationRequestVersion = 0;

  function normalizeOrchestration(
    response: SessionStructuredStateResponse | null | undefined,
  ): SessionOrchestrationProjection | null {
    if (response?.orchestration && typeof response.orchestration === 'object' && !Array.isArray(response.orchestration)) {
      return response.orchestration as SessionOrchestrationProjection;
    }

    return null;
  }

  async function loadSessionOrchestration(session: SessionSummary | null): Promise<void> {
    const sessionId = typeof session?.id === 'string' ? session.id.trim() : '';
    if (!sessionId) {
      store.setState((state) => ({
        ...state,
        orchestrationLoading: false,
        orchestrationError: null,
      }));
      return;
    }

    const nextVersion = ++orchestrationRequestVersion;
    store.setState((state) => ({
      ...state,
      orchestrationLoading: true,
      orchestrationError: null,
    }));

    try {
      const response = await getSessionStructuredState(sessionId, {
        source: typeof session.source === 'string' ? session.source : undefined,
        sandbox: typeof session.sandbox === 'string' ? session.sandbox : undefined,
        planId: 'latest',
      });
      const orchestration = normalizeOrchestration(response);

      store.setState((state) => {
        if (nextVersion !== orchestrationRequestVersion) {
          return state;
        }

        const nextMap = orchestration
          ? {
            ...state.sessionOrchestrationById,
            [sessionId]: orchestration,
          }
          : state.sessionOrchestrationById;

        return {
          ...state,
          sessionOrchestrationById: nextMap,
          orchestrationLoading: false,
          orchestrationError: null,
        };
      });
    } catch (error) {
      const message = error instanceof Error && error.message.trim()
        ? error.message
        : 'Unable to load session orchestration.';

      store.setState((state) => {
        if (nextVersion !== orchestrationRequestVersion) {
          return state;
        }

        return {
          ...state,
          orchestrationLoading: false,
          orchestrationError: message,
        };
      });
    }
  }

  async function loadSessions(): Promise<void> {
    const nextVersion = ++requestVersion;

    store.setState((state) => ({
      ...state,
      loading: true,
      error: null,
    }));

    try {
      const response = await listSessions();
      const nextSessions = Array.isArray(response.sessions) ? response.sessions : [];

      store.setState((state) => {
        if (nextVersion !== requestVersion) {
          return state;
        }

        const hasSelectedSession =
          state.selectedSessionId != null &&
          nextSessions.some((session) => session.id === state.selectedSessionId);
        const nextSelectedSessionId = hasSelectedSession ? state.selectedSessionId : (nextSessions[0]?.id ?? null);

        return {
          ...state,
          sessions: nextSessions,
          selectedSessionId: nextSelectedSessionId,
          loading: false,
          error: null,
        };
      });

      const selectedSessionId = store.getState().selectedSessionId;
      const selectedSession = nextSessions.find((session) => session.id === selectedSessionId) ?? null;
      void loadSessionOrchestration(selectedSession);
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

  function selectSession(sessionId: string | null): void {
    let nextSelectedSession: SessionSummary | null = null;
    store.setState((state) => {
      const nextSelectedId =
        sessionId != null && state.sessions.some((session) => session.id === sessionId) ? sessionId : null;
      nextSelectedSession = state.sessions.find((session) => session.id === nextSelectedId) ?? null;

      return {
        ...state,
        selectedSessionId: nextSelectedId,
        selectedTaskId: null,
      };
    });

    void loadSessionOrchestration(nextSelectedSession);
  }

  function refresh(): Promise<void> {
    return loadSessions();
  }

  function setTaskBoardFilterStatus(taskBoardFilterStatus: string): void {
    store.setState((state) => ({
      ...state,
      taskBoardFilterStatus,
      selectedTaskId: null,
    }));
  }

  function setTaskBoardGroupBy(taskBoardGroupBy: SessionsTaskBoardGroupBy): void {
    store.setState((state) => ({
      ...state,
      taskBoardGroupBy,
    }));
  }

  function selectTask(taskId: string | null): void {
    store.setState((state) => ({
      ...state,
      selectedTaskId: taskId && taskId.trim() ? taskId.trim() : null,
    }));
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    loadSessions,
    loadSessionOrchestration,
    selectSession,
    refresh,
    setTaskBoardFilterStatus,
    setTaskBoardGroupBy,
    selectTask,
  };
}

export const sessionsStore = createSessionsStore();
