import {
  checkToolingUpdates,
  getToolingUpdatesStatus,
  updateElegyPlugins,
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
  updatingPlugins: boolean;
  updatingPlanning: boolean;
  updatingSkills: boolean;
  error: string | null;
  lastUpdatedAtMs: number | null;
}

const INITIAL_STATE: ToolingUpdatesState = {
  status: null,
  loading: false,
  checking: false,
  updatingPlugins: false,
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

function sameStatus(left: ToolingUpdatesStatusResponse | null, right: ToolingUpdatesStatusResponse): boolean {
  if (left === null) return false;
  const { checkedAtMs: _leftCheckedAt, ...leftSemantic } = left;
  const { checkedAtMs: _rightCheckedAt, ...rightSemantic } = right;
  return JSON.stringify(leftSemantic) === JSON.stringify(rightSemantic);
}

export function createToolingUpdatesStore(deps: {
  getStatus?: typeof getToolingUpdatesStatus;
  checkUpdates?: typeof checkToolingUpdates;
} = {}) {
  const getStatus = deps.getStatus ?? getToolingUpdatesStatus;
  const checkUpdates = deps.checkUpdates ?? checkToolingUpdates;
  const store = createStore<ToolingUpdatesState>(INITIAL_STATE);
  let requestVersion = 0;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let checkInFlight: Promise<void> | null = null;

  async function refresh(): Promise<void> {
    const nextVersion = ++requestVersion;
    store.setState((state) => ({
      ...state,
      loading: true,
      error: null,
    }));

    try {
      const status = await getStatus();
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

  async function checkNow(options: { silent?: boolean } = {}): Promise<void> {
    if (checkInFlight) return checkInFlight;
    checkInFlight = (async () => {
    if (!options.silent) {
      store.setState((state) => ({
        ...state,
        checking: true,
        error: null,
      }));
    }

    try {
      const status = await checkUpdates();
      store.setState((state) => {
        if (options.silent && sameStatus(state.status, status) && state.error === null) return state;
        return {
          ...state,
          status,
          checking: false,
          error: null,
          lastUpdatedAtMs: Date.now(),
        };
      });
    } catch (error) {
      store.setState((state) => ({
        ...state,
        checking: false,
        error: toErrorMessage(error),
        lastUpdatedAtMs: Date.now(),
      }));
    }
    })().finally(() => {
      checkInFlight = null;
    });
    return checkInFlight;
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

  async function updatePlugins(pluginNames?: string[]): Promise<void> {
    store.setState((state) => ({
      ...state,
      updatingPlugins: true,
      error: null,
    }));

    try {
      const response = await updateElegyPlugins({
        ...(pluginNames && pluginNames.length ? { pluginNames } : {}),
      });
      if (response.status) {
        store.setState((state) => ({
          ...state,
          status: response.status ?? state.status,
          updatingPlugins: false,
          error: null,
          lastUpdatedAtMs: Date.now(),
        }));
      } else {
        await refresh();
        store.setState((state) => ({
          ...state,
          updatingPlugins: false,
        }));
      }
    } catch (error) {
      store.setState((state) => ({
        ...state,
        updatingPlugins: false,
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

    pollTimer = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        void checkNow({ silent: true });
      }
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
    updatePlugins,
    updatePlanning,
    updateSkills,
    startPolling,
    stopPolling,
  };
}

export const toolingUpdatesStore = createToolingUpdatesStore();
