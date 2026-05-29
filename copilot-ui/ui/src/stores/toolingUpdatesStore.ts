import {
  checkToolingUpdates,
  getToolingUpdatesStatus,
  updateElegyPlanningCli,
  updateElegySkillsAssets,
} from '../lib/api';
import { createStore } from '../lib/store';
import type { ToolingUpdatesStatusResponse } from '../lib/types';

const TOOLING_UPDATES_POLL_INTERVAL_MS = 5 * 60_000;

export interface ToolingUpdatesState {
  status: ToolingUpdatesStatusResponse | null;
  loading: boolean;
  checking: boolean;
  updatingPlanning: boolean;
  updatingSkills: boolean;
  error: string | null;
  lastUpdatedAtMs: number | null;
}

const INITIAL_STATE: ToolingUpdatesState = {
  status: null,
  loading: false,
  checking: false,
  updatingPlanning: false,
  updatingSkills: false,
  error: null,
  lastUpdatedAtMs: null,
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return 'Unable to load tooling update status.';
}

function createToolingUpdatesStore() {
  const store = createStore<ToolingUpdatesState>(INITIAL_STATE);
  let requestVersion = 0;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  async function refresh(): Promise<void> {
    const nextVersion = ++requestVersion;
    store.setState((state) => ({
      ...state,
      loading: true,
      error: null,
    }));

    try {
      const status = await getToolingUpdatesStatus();
      store.setState((state) => {
        if (nextVersion !== requestVersion) {
          return state;
        }
        return {
          ...state,
          status,
          loading: false,
          error: null,
          lastUpdatedAtMs: Date.now(),
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
          lastUpdatedAtMs: Date.now(),
        };
      });
    }
  }

  async function checkNow(): Promise<void> {
    store.setState((state) => ({
      ...state,
      checking: true,
      error: null,
    }));

    try {
      const status = await checkToolingUpdates();
      store.setState((state) => ({
        ...state,
        status,
        checking: false,
        error: null,
        lastUpdatedAtMs: Date.now(),
      }));
    } catch (error) {
      store.setState((state) => ({
        ...state,
        checking: false,
        error: toErrorMessage(error),
        lastUpdatedAtMs: Date.now(),
      }));
    }
  }

  async function updatePlanning(): Promise<void> {
    store.setState((state) => ({
      ...state,
      updatingPlanning: true,
      error: null,
    }));

    try {
      const response = await updateElegyPlanningCli();
      if (response.status) {
        store.setState((state) => ({
          ...state,
          status: response.status ?? state.status,
          updatingPlanning: false,
          error: null,
          lastUpdatedAtMs: Date.now(),
        }));
      } else {
        await refresh();
        store.setState((state) => ({
          ...state,
          updatingPlanning: false,
        }));
      }
    } catch (error) {
      store.setState((state) => ({
        ...state,
        updatingPlanning: false,
        error: toErrorMessage(error),
        lastUpdatedAtMs: Date.now(),
      }));
    }
  }

  async function updateSkills(): Promise<void> {
    store.setState((state) => ({
      ...state,
      updatingSkills: true,
      error: null,
    }));

    try {
      const response = await updateElegySkillsAssets({
        force: false,
      });
      if (response.status) {
        store.setState((state) => ({
          ...state,
          status: response.status ?? state.status,
          updatingSkills: false,
          error: null,
          lastUpdatedAtMs: Date.now(),
        }));
      } else {
        await refresh();
        store.setState((state) => ({
          ...state,
          updatingSkills: false,
        }));
      }
    } catch (error) {
      store.setState((state) => ({
        ...state,
        updatingSkills: false,
        error: toErrorMessage(error),
        lastUpdatedAtMs: Date.now(),
      }));
    }
  }

  function startPolling(): void {
    if (pollTimer) {
      return;
    }

    void checkNow();
    pollTimer = setInterval(() => {
      void checkNow();
    }, TOOLING_UPDATES_POLL_INTERVAL_MS);
  }

  function stopPolling(): void {
    if (!pollTimer) {
      return;
    }
    clearInterval(pollTimer);
    pollTimer = null;
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    refresh,
    checkNow,
    updatePlanning,
    updateSkills,
    startPolling,
    stopPolling,
  };
}

export const toolingUpdatesStore = createToolingUpdatesStore();
