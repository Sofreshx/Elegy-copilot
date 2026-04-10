import { listSessionsWorkspace } from '../../lib/api';
import { createStore } from '../../lib/store';
import type { SessionsWorkspaceEntry, SessionsWorkspaceResponse } from '../../lib/types';

export type SessionsWorkspaceView = 'active' | 'history';

export interface SessionsWorkspaceState {
  active: SessionsWorkspaceEntry[];
  history: SessionsWorkspaceEntry[];
  selectedView: SessionsWorkspaceView;
  selectedEntryId: string | null;
  loading: boolean;
  error: string | null;
}

const INITIAL_STATE: SessionsWorkspaceState = {
  active: [],
  history: [],
  selectedView: 'active',
  selectedEntryId: null,
  loading: false,
  error: null,
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return 'Unable to load the sessions workspace.';
}

function entriesForView(state: Pick<SessionsWorkspaceState, 'active' | 'history' | 'selectedView'>): SessionsWorkspaceEntry[] {
  return state.selectedView === 'history' ? state.history : state.active;
}

function resolveSelectedEntryId(
  state: Pick<SessionsWorkspaceState, 'active' | 'history' | 'selectedView' | 'selectedEntryId'>
): string | null {
  const visibleEntries = entriesForView(state);
  if (state.selectedEntryId && visibleEntries.some((entry) => entry.entryId === state.selectedEntryId)) {
    return state.selectedEntryId;
  }
  return visibleEntries[0]?.entryId ?? null;
}

function createSessionsWorkspaceStore() {
  const store = createStore<SessionsWorkspaceState>(INITIAL_STATE);
  let requestVersion = 0;

  async function load(): Promise<void> {
    const nextVersion = ++requestVersion;
    store.setState((state) => ({
      ...state,
      loading: true,
      error: null,
    }));

    try {
      const response: SessionsWorkspaceResponse = await listSessionsWorkspace();
      const active = Array.isArray(response.active) ? response.active : [];
      const history = Array.isArray(response.history) ? response.history : [];

      store.setState((state) => {
        if (nextVersion !== requestVersion) {
          return state;
        }

        const nextState = {
          ...state,
          active,
          history,
          loading: false,
          error: null,
        };

        return {
          ...nextState,
          selectedEntryId: resolveSelectedEntryId(nextState),
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

  function refresh(): Promise<void> {
    return load();
  }

  function selectView(selectedView: SessionsWorkspaceView): void {
    store.setState((state) => {
      const nextState = {
        ...state,
        selectedView,
      };
      return {
        ...nextState,
        selectedEntryId: resolveSelectedEntryId(nextState),
      };
    });
  }

  function selectEntry(selectedEntryId: string | null): void {
    store.setState((state) => {
      const visibleEntries = entriesForView(state);
      const nextSelectedEntryId =
        selectedEntryId && visibleEntries.some((entry) => entry.entryId === selectedEntryId) ? selectedEntryId : null;
      return {
        ...state,
        selectedEntryId: nextSelectedEntryId,
      };
    });
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    load,
    refresh,
    selectView,
    selectEntry,
  };
}

export const sessionsWorkspaceStore = createSessionsWorkspaceStore();
