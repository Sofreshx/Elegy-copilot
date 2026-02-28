import {
  approveTrackerPermission,
  denyTrackerPermission,
  getTrackerPermissions,
  getTrackerSessions,
} from '../../lib/api';
import { createStore } from '../../lib/store';
import type { TrackerPermission, TrackerSession } from '../../lib/types';

const MAX_TRACKER_EVENTS = 50;

export interface TrackerEventItem {
  id: string;
  type: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

type TrackerSseStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'unsupported';

export interface TrackerState {
  permissions: TrackerPermission[];
  sessions: TrackerSession[];
  events: TrackerEventItem[];
  loading: boolean;
  permissionsLoading: boolean;
  sessionsLoading: boolean;
  actionLoading: boolean;
  sseStatus: TrackerSseStatus;
  error: string | null;
  statusMessage: string | null;
}

const INITIAL_STATE: TrackerState = {
  permissions: [],
  sessions: [],
  events: [],
  loading: false,
  permissionsLoading: false,
  sessionsLoading: false,
  actionLoading: false,
  sseStatus: 'disconnected',
  error: null,
  statusMessage: null,
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return 'Unable to load tracker state.';
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') {
    return value as Record<string, unknown>;
  }

  return {};
}

function normalizePermissions(input: unknown): TrackerPermission[] {
  if (Array.isArray(input)) {
    return input.filter((entry): entry is TrackerPermission => Boolean(entry && typeof entry === 'object'));
  }

  const record = asRecord(input);
  const permissions = record.permissions;
  if (!Array.isArray(permissions)) {
    return [];
  }

  return permissions.filter((entry): entry is TrackerPermission => Boolean(entry && typeof entry === 'object'));
}

function normalizeSessions(input: unknown): TrackerSession[] {
  if (Array.isArray(input)) {
    return input.filter((entry): entry is TrackerSession => Boolean(entry && typeof entry === 'object'));
  }

  const record = asRecord(input);
  const sessions = record.sessions;
  if (!Array.isArray(sessions)) {
    return [];
  }

  return sessions.filter((entry): entry is TrackerSession => Boolean(entry && typeof entry === 'object'));
}

function readPermissionId(permission: TrackerPermission): string {
  if (typeof permission.callbackId === 'string' && permission.callbackId.trim()) {
    return permission.callbackId;
  }

  if (typeof permission.id === 'string' && permission.id.trim()) {
    return permission.id;
  }

  return '';
}

function createTrackerStore() {
  const store = createStore<TrackerState>(INITIAL_STATE);
  let permissionsRequestVersion = 0;
  let sessionsRequestVersion = 0;
  let eventSource: EventSource | null = null;

  function addEvent(type: string, payload: Record<string, unknown>): void {
    const timestamp = new Date().toISOString();
    const id = `${timestamp}-${Math.random().toString(36).slice(2, 10)}`;

    store.setState((state) => ({
      ...state,
      events: [{ id, type, timestamp, payload }, ...state.events].slice(0, MAX_TRACKER_EVENTS),
    }));
  }

  async function loadPermissions(): Promise<void> {
    const nextVersion = ++permissionsRequestVersion;

    store.setState((state) => ({
      ...state,
      permissionsLoading: true,
      error: null,
    }));

    try {
      const response = await getTrackerPermissions();
      const permissions = normalizePermissions(response);

      store.setState((state) => {
        if (nextVersion !== permissionsRequestVersion) {
          return state;
        }

        return {
          ...state,
          permissions,
          permissionsLoading: false,
          error: null,
        };
      });
    } catch (error) {
      const message = toErrorMessage(error);

      store.setState((state) => {
        if (nextVersion !== permissionsRequestVersion) {
          return state;
        }

        return {
          ...state,
          permissionsLoading: false,
          error: message,
        };
      });

      throw error;
    }
  }

  async function loadSessions(): Promise<void> {
    const nextVersion = ++sessionsRequestVersion;

    store.setState((state) => ({
      ...state,
      sessionsLoading: true,
      error: null,
    }));

    try {
      const response = await getTrackerSessions();
      const sessions = normalizeSessions(response);

      store.setState((state) => {
        if (nextVersion !== sessionsRequestVersion) {
          return state;
        }

        return {
          ...state,
          sessions,
          sessionsLoading: false,
          error: null,
        };
      });
    } catch (error) {
      const message = toErrorMessage(error);

      store.setState((state) => {
        if (nextVersion !== sessionsRequestVersion) {
          return state;
        }

        return {
          ...state,
          sessionsLoading: false,
          error: message,
        };
      });

      throw error;
    }
  }

  async function loadTracker(): Promise<void> {
    store.setState((state) => ({
      ...state,
      loading: true,
      error: null,
      statusMessage: 'Loading tracker data...',
    }));

    const results = await Promise.allSettled([loadPermissions(), loadSessions()]);

    const failures = results.filter((result) => result.status === 'rejected');

    store.setState((state) => ({
      ...state,
      loading: false,
      statusMessage: failures.length > 0 ? 'Tracker loaded with warnings.' : 'Tracker loaded.',
    }));
  }

  async function runPermissionAction(
    action: 'approve' | 'deny',
    permissionId: string
  ): Promise<void> {
    const normalizedPermissionId = permissionId.trim();
    if (!normalizedPermissionId) {
      throw new Error('Permission id is required.');
    }

    store.setState((state) => ({
      ...state,
      actionLoading: true,
      error: null,
      statusMessage: `${action === 'approve' ? 'Approving' : 'Denying'} permission...`,
    }));

    try {
      if (action === 'approve') {
        await approveTrackerPermission(normalizedPermissionId);
      } else {
        await denyTrackerPermission(normalizedPermissionId);
      }

      await loadPermissions();

      store.setState((state) => ({
        ...state,
        actionLoading: false,
        statusMessage: `Permission ${action}d.`,
      }));
    } catch (error) {
      const message = toErrorMessage(error);

      store.setState((state) => ({
        ...state,
        actionLoading: false,
        error: message,
        statusMessage: `Permission ${action} failed.`,
      }));

      throw error;
    }
  }

  function startLiveEvents(): void {
    if (eventSource) {
      return;
    }

    if (typeof EventSource === 'undefined') {
      store.setState((state) => ({
        ...state,
        sseStatus: 'unsupported',
        statusMessage: 'Tracker live updates are unavailable in this environment.',
      }));
      return;
    }

    store.setState((state) => ({
      ...state,
      sseStatus: 'connecting',
      statusMessage: 'Connecting to tracker events...',
    }));

    const source = new EventSource('/api/tracker/events');
    eventSource = source;

    source.addEventListener('connected', () => {
      store.setState((state) => ({
        ...state,
        sseStatus: 'connected',
        statusMessage: 'Tracker live events connected.',
      }));
    });

    source.addEventListener('live', (event: MessageEvent<string>) => {
      let payload: Record<string, unknown>;

      try {
        const parsed = JSON.parse(event.data) as unknown;
        payload = asRecord(parsed);
      } catch {
        payload = { raw: event.data };
      }

      const type = typeof payload.type === 'string' && payload.type.trim() ? payload.type : 'live';
      addEvent(type, payload);

      void loadPermissions();
    });

    source.onmessage = (event: MessageEvent<string>) => {
      if (!event.data) {
        return;
      }

      let payload: Record<string, unknown>;
      try {
        payload = asRecord(JSON.parse(event.data));
      } catch {
        payload = { raw: event.data };
      }

      addEvent('message', payload);
    };

    source.onerror = () => {
      store.setState((state) => ({
        ...state,
        sseStatus: 'reconnecting',
        statusMessage: 'Tracker event stream disconnected. Reconnecting...',
      }));
    };
  }

  function stopLiveEvents(): void {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }

    store.setState((state) => ({
      ...state,
      sseStatus: 'disconnected',
      statusMessage: 'Tracker live events disconnected.',
    }));
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    loadTracker,
    refresh: loadTracker,
    loadPermissions,
    loadSessions,
    approvePermission: async (permission: TrackerPermission) => {
      await runPermissionAction('approve', readPermissionId(permission));
    },
    denyPermission: async (permission: TrackerPermission) => {
      await runPermissionAction('deny', readPermissionId(permission));
    },
    startLiveEvents,
    stopLiveEvents,
    readPermissionId,
  };
}

export const trackerStore = createTrackerStore();
