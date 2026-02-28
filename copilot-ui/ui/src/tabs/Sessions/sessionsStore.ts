import { listSessions } from '../../lib/api';
import { createStore } from '../../lib/store';
import type { SessionSummary } from '../../lib/types';

export interface SessionsState {
  sessions: SessionSummary[];
  selectedSessionId: string | null;
  loading: boolean;
  error: string | null;
}

const INITIAL_STATE: SessionsState = {
  sessions: [],
  selectedSessionId: null,
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

        return {
          sessions: nextSessions,
          selectedSessionId: hasSelectedSession ? state.selectedSessionId : (nextSessions[0]?.id ?? null),
          loading: false,
          error: null,
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

  function selectSession(sessionId: string | null): void {
    store.setState((state) => {
      const nextSelectedId =
        sessionId != null && state.sessions.some((session) => session.id === sessionId) ? sessionId : null;

      return {
        ...state,
        selectedSessionId: nextSelectedId,
      };
    });
  }

  function refresh(): Promise<void> {
    return loadSessions();
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    loadSessions,
    selectSession,
    refresh,
  };
}

export const sessionsStore = createSessionsStore();
