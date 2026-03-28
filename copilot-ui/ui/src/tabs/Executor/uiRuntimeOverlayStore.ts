import {
  closeUiRuntimeOverlaySession,
  createUiRuntimeOverlaySession,
  getCatalogRepos,
  listUiRuntimeOverlaySessions,
} from '../../lib/api';
import { createStore } from '../../lib/store';
import type {
  CatalogRepoInventoryEntry,
  CreateUiRuntimeOverlaySessionPayload,
  UiRuntimeOverlaySession,
} from '../../lib/types';

export interface UiRuntimeOverlayState {
  sessions: UiRuntimeOverlaySession[];
  catalogRepos: CatalogRepoInventoryEntry[];
  selectedRepo: CatalogRepoInventoryEntry | null;
  loading: boolean;
  creating: boolean;
  closing: boolean;
  closingSessionId: string | null;
  error: string | null;
}

const INITIAL_STATE: UiRuntimeOverlayState = {
  sessions: [],
  catalogRepos: [],
  selectedRepo: null,
  loading: false,
  creating: false,
  closing: false,
  closingSessionId: null,
  error: null,
};

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

function toTimestamp(value: string | null | undefined): number {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortSessions(left: UiRuntimeOverlaySession, right: UiRuntimeOverlaySession): number {
  const timestampDelta =
    toTimestamp(right.updatedAt || right.createdAt) - toTimestamp(left.updatedAt || left.createdAt);
  if (timestampDelta !== 0) {
    return timestampDelta;
  }

  return left.id.localeCompare(right.id);
}

function mergeSession(
  sessions: UiRuntimeOverlaySession[],
  session: UiRuntimeOverlaySession
): UiRuntimeOverlaySession[] {
  return [...sessions.filter((entry) => entry.id !== session.id), session].sort(sortSessions);
}

function createUiRuntimeOverlayStore() {
  const store = createStore<UiRuntimeOverlayState>(INITIAL_STATE);
  let loadVersion = 0;

  async function load(): Promise<void> {
    const requestVersion = loadVersion + 1;
    loadVersion = requestVersion;
    store.setState((state) => ({ ...state, loading: true, error: null }));

    try {
      const [sessionsResponse, repoInventory] = await Promise.all([
        listUiRuntimeOverlaySessions(),
        getCatalogRepos(),
      ]);

      if (requestVersion !== loadVersion) {
        return;
      }

      store.setState((state) => ({
        ...state,
        sessions: [...sessionsResponse.sessions].sort(sortSessions),
        catalogRepos: repoInventory.repos,
        selectedRepo: repoInventory.selectedRepo ?? null,
        loading: false,
        error: null,
      }));
    } catch (error) {
      if (requestVersion !== loadVersion) {
        return;
      }

      store.setState((state) => ({
        ...state,
        loading: false,
        error: toErrorMessage(error, 'Unable to load attach mode foundation state.'),
      }));
    }
  }

  async function createSession(
    payload: CreateUiRuntimeOverlaySessionPayload
  ): Promise<UiRuntimeOverlaySession | null> {
    store.setState((state) => ({ ...state, creating: true, error: null }));

    try {
      const response = await createUiRuntimeOverlaySession(payload);
      let repoInventory = null;

      try {
        repoInventory = await getCatalogRepos();
      } catch {
        repoInventory = null;
      }

      store.setState((state) => ({
        ...state,
        sessions: mergeSession(state.sessions, response.session),
        catalogRepos: repoInventory?.repos ?? state.catalogRepos,
        selectedRepo: repoInventory?.selectedRepo ?? state.selectedRepo,
        creating: false,
        error: null,
      }));

      return response.session;
    } catch (error) {
      store.setState((state) => ({
        ...state,
        creating: false,
        error: toErrorMessage(error, 'Unable to create attach mode session.'),
      }));
      return null;
    }
  }

  async function closeSession(sessionId: string): Promise<UiRuntimeOverlaySession | null> {
    store.setState((state) => ({
      ...state,
      closing: true,
      closingSessionId: sessionId,
      error: null,
    }));

    try {
      const response = await closeUiRuntimeOverlaySession(sessionId);
      store.setState((state) => ({
        ...state,
        sessions: mergeSession(state.sessions, response.session),
        closing: false,
        closingSessionId: null,
        error: null,
      }));

      return response.session;
    } catch (error) {
      store.setState((state) => ({
        ...state,
        closing: false,
        closingSessionId: null,
        error: toErrorMessage(error, 'Unable to close attach mode session.'),
      }));
      return null;
    }
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    load,
    createSession,
    closeSession,
  };
}

export const uiRuntimeOverlayStore = createUiRuntimeOverlayStore();