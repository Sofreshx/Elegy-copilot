import {
  addUiRuntimeOverlayAnnotation,
  addUiRuntimeOverlayChangeRequest,
  addUiRuntimeOverlayObservation,
  closeUiRuntimeOverlaySession,
  createUiRuntimeOverlaySession,
  getCatalogRepos,
  listUiRuntimeOverlaySessions,
  queueUiRuntimeOverlayChangeRequest,
  releaseUiRuntimeOverlayChangeRequest,
} from '../../lib/api';
import { createStore } from '../../lib/store';
import type {
  CatalogRepoInventoryEntry,
  CreateUiRuntimeOverlayAnnotationPayload,
  CreateUiRuntimeOverlayChangeRequestPayload,
  CreateUiRuntimeOverlayObservationPayload,
  CreateUiRuntimeOverlaySessionPayload,
  UiRuntimeOverlayAnnotationMutationResponse,
  UiRuntimeOverlayChangeRequestMutationResponse,
  UiRuntimeOverlayObservationMutationResponse,
  UiRuntimeOverlayQueueChangeRequestResponse,
  UiRuntimeOverlaySession,
} from '../../lib/types';

export interface UiRuntimeOverlayState {
  sessions: UiRuntimeOverlaySession[];
  catalogRepos: CatalogRepoInventoryEntry[];
  selectedRepo: CatalogRepoInventoryEntry | null;
  selectedSessionId: string | null;
  loading: boolean;
  creating: boolean;
  closing: boolean;
  closingSessionId: string | null;
  addingObservation: boolean;
  addingAnnotation: boolean;
  addingChangeRequest: boolean;
  queueingChangeRequestId: string | null;
  releasingChangeRequestId: string | null;
  error: string | null;
}

const INITIAL_STATE: UiRuntimeOverlayState = {
  sessions: [],
  catalogRepos: [],
  selectedRepo: null,
  selectedSessionId: null,
  loading: false,
  creating: false,
  closing: false,
  closingSessionId: null,
  addingObservation: false,
  addingAnnotation: false,
  addingChangeRequest: false,
  queueingChangeRequestId: null,
  releasingChangeRequestId: null,
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

function reconcileSelectedSessionId(
  currentSelectedSessionId: string | null,
  sessions: UiRuntimeOverlaySession[],
  preferredSessionId: string | null = null
): string | null {
  if (preferredSessionId && sessions.some((session) => session.id === preferredSessionId)) {
    return preferredSessionId;
  }

  if (currentSelectedSessionId && sessions.some((session) => session.id === currentSelectedSessionId)) {
    return currentSelectedSessionId;
  }

  return sessions[0]?.id ?? null;
}

function createUiRuntimeOverlayStore() {
  const store = createStore<UiRuntimeOverlayState>(INITIAL_STATE);
  let loadVersion = 0;
  let mutationVersion = 0;

  function discardStaleLoad(requestVersion: number, requestMutationVersion: number): boolean {
    if (requestVersion === loadVersion && requestMutationVersion === mutationVersion) {
      return false;
    }

    if (requestVersion === loadVersion) {
      store.setState((state) => (state.loading ? { ...state, loading: false } : state));
    }

    return true;
  }

  function commitMutation(): void {
    mutationVersion += 1;
  }

  function selectSession(sessionId: string | null): void {
    store.setState((state) => ({
      ...state,
      selectedSessionId: sessionId && state.sessions.some((session) => session.id === sessionId)
        ? sessionId
        : reconcileSelectedSessionId(state.selectedSessionId, state.sessions),
    }));
  }

  async function load(): Promise<void> {
    const requestVersion = loadVersion + 1;
    const requestMutationVersion = mutationVersion;
    loadVersion = requestVersion;
    store.setState((state) => ({ ...state, loading: true, error: null }));

    try {
      const [sessionsResponse, repoInventory] = await Promise.all([
        listUiRuntimeOverlaySessions(),
        getCatalogRepos(),
      ]);

      if (discardStaleLoad(requestVersion, requestMutationVersion)) {
        return;
      }

      store.setState((state) => ({
        ...state,
        sessions: [...sessionsResponse.sessions].sort(sortSessions),
        catalogRepos: repoInventory.repos,
        selectedRepo: repoInventory.selectedRepo ?? null,
        selectedSessionId: reconcileSelectedSessionId(
          state.selectedSessionId,
          [...sessionsResponse.sessions].sort(sortSessions)
        ),
        loading: false,
        error: null,
      }));
    } catch (error) {
      if (discardStaleLoad(requestVersion, requestMutationVersion)) {
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

      commitMutation();
      store.setState((state) => ({
        ...state,
        sessions: mergeSession(state.sessions, response.session),
        catalogRepos: repoInventory?.repos ?? state.catalogRepos,
        selectedRepo: repoInventory?.selectedRepo ?? state.selectedRepo,
        selectedSessionId: reconcileSelectedSessionId(
          state.selectedSessionId,
          mergeSession(state.sessions, response.session),
          response.session.id
        ),
        loading: false,
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
      commitMutation();
      store.setState((state) => ({
        ...state,
        sessions: mergeSession(state.sessions, response.session),
        selectedSessionId: reconcileSelectedSessionId(
          state.selectedSessionId,
          mergeSession(state.sessions, response.session),
          response.session.id
        ),
        loading: false,
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

  async function addObservation(
    sessionId: string,
    payload: CreateUiRuntimeOverlayObservationPayload
  ): Promise<UiRuntimeOverlayObservationMutationResponse | null> {
    store.setState((state) => ({ ...state, addingObservation: true, error: null }));

    try {
      const response = await addUiRuntimeOverlayObservation(sessionId, payload);
      commitMutation();
      store.setState((state) => ({
        ...state,
        sessions: mergeSession(state.sessions, response.session),
        selectedSessionId: reconcileSelectedSessionId(
          state.selectedSessionId,
          mergeSession(state.sessions, response.session),
          response.session.id
        ),
        loading: false,
        addingObservation: false,
        error: null,
      }));

      return response;
    } catch (error) {
      store.setState((state) => ({
        ...state,
        addingObservation: false,
        error: toErrorMessage(error, 'Unable to add runtime observation.'),
      }));
      return null;
    }
  }

  async function addAnnotation(
    sessionId: string,
    payload: CreateUiRuntimeOverlayAnnotationPayload
  ): Promise<UiRuntimeOverlayAnnotationMutationResponse | null> {
    store.setState((state) => ({ ...state, addingAnnotation: true, error: null }));

    try {
      const response = await addUiRuntimeOverlayAnnotation(sessionId, payload);
      commitMutation();
      store.setState((state) => ({
        ...state,
        sessions: mergeSession(state.sessions, response.session),
        selectedSessionId: reconcileSelectedSessionId(
          state.selectedSessionId,
          mergeSession(state.sessions, response.session),
          response.session.id
        ),
        loading: false,
        addingAnnotation: false,
        error: null,
      }));

      return response;
    } catch (error) {
      store.setState((state) => ({
        ...state,
        addingAnnotation: false,
        error: toErrorMessage(error, 'Unable to add runtime annotation.'),
      }));
      return null;
    }
  }

  async function addChangeRequest(
    sessionId: string,
    payload: CreateUiRuntimeOverlayChangeRequestPayload
  ): Promise<UiRuntimeOverlayChangeRequestMutationResponse | null> {
    store.setState((state) => ({ ...state, addingChangeRequest: true, error: null }));

    try {
      const response = await addUiRuntimeOverlayChangeRequest(sessionId, payload);
      commitMutation();
      store.setState((state) => ({
        ...state,
        sessions: mergeSession(state.sessions, response.session),
        selectedSessionId: reconcileSelectedSessionId(
          state.selectedSessionId,
          mergeSession(state.sessions, response.session),
          response.session.id
        ),
        loading: false,
        addingChangeRequest: false,
        error: null,
      }));

      return response;
    } catch (error) {
      store.setState((state) => ({
        ...state,
        addingChangeRequest: false,
        error: toErrorMessage(error, 'Unable to add change request.'),
      }));
      return null;
    }
  }

  async function queueChangeRequest(
    sessionId: string,
    changeRequestId: string
  ): Promise<UiRuntimeOverlayQueueChangeRequestResponse | null> {
    store.setState((state) => ({
      ...state,
      queueingChangeRequestId: changeRequestId,
      error: null,
    }));

    try {
      const response = await queueUiRuntimeOverlayChangeRequest(sessionId, changeRequestId);
      commitMutation();
      store.setState((state) => ({
        ...state,
        sessions: mergeSession(state.sessions, response.session),
        selectedSessionId: reconcileSelectedSessionId(
          state.selectedSessionId,
          mergeSession(state.sessions, response.session),
          response.session.id
        ),
        loading: false,
        queueingChangeRequestId: null,
        error: null,
      }));

      return response;
    } catch (error) {
      const errorMessage = toErrorMessage(error, 'Unable to queue change request into executor.');

      try {
        const sessionsResponse = await listUiRuntimeOverlaySessions();
        const sessions = [...sessionsResponse.sessions].sort(sortSessions);
        commitMutation();

        store.setState((state) => ({
          ...state,
          sessions,
          selectedSessionId: reconcileSelectedSessionId(state.selectedSessionId, sessions, sessionId),
          loading: false,
          queueingChangeRequestId: null,
          error: errorMessage,
        }));
      } catch {
        store.setState((state) => ({
          ...state,
          queueingChangeRequestId: null,
          error: errorMessage,
        }));
      }

      return null;
    }
  }

  async function releaseChangeRequest(
    sessionId: string,
    changeRequestId: string
  ): Promise<UiRuntimeOverlayChangeRequestMutationResponse | null> {
    store.setState((state) => ({
      ...state,
      releasingChangeRequestId: changeRequestId,
      error: null,
    }));

    try {
      const response = await releaseUiRuntimeOverlayChangeRequest(sessionId, changeRequestId);
      commitMutation();
      store.setState((state) => ({
        ...state,
        sessions: mergeSession(state.sessions, response.session),
        selectedSessionId: reconcileSelectedSessionId(
          state.selectedSessionId,
          mergeSession(state.sessions, response.session),
          response.session.id
        ),
        loading: false,
        releasingChangeRequestId: null,
        error: null,
      }));

      return response;
    } catch (error) {
      const errorMessage = toErrorMessage(error, 'Unable to release reserved change request.');

      try {
        const sessionsResponse = await listUiRuntimeOverlaySessions();
        const sessions = [...sessionsResponse.sessions].sort(sortSessions);
        commitMutation();

        store.setState((state) => ({
          ...state,
          sessions,
          selectedSessionId: reconcileSelectedSessionId(state.selectedSessionId, sessions, sessionId),
          loading: false,
          releasingChangeRequestId: null,
          error: errorMessage,
        }));
      } catch {
        store.setState((state) => ({
          ...state,
          releasingChangeRequestId: null,
          error: errorMessage,
        }));
      }

      return null;
    }
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    selectSession,
    load,
    createSession,
    closeSession,
    addObservation,
    addAnnotation,
    addChangeRequest,
    queueChangeRequest,
    releaseChangeRequest,
  };
}

export const uiRuntimeOverlayStore = createUiRuntimeOverlayStore();