import { createStore } from '../lib/store';
import {
  getOpenCodeAgentStatus,
  setOpenCodeAgentModels,
  resetOpenCodeAgentConfig,
} from '../lib/api/opencodeConfig';
import type { OpenCodeAgentStatusResponse } from '../lib/types';

export interface OpenCodeAgentState {
  status: OpenCodeAgentStatusResponse | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  message: string | null;
}

const INITIAL_STATE: OpenCodeAgentState = {
  status: null,
  loading: false,
  saving: false,
  error: null,
  message: null,
};

function createOpenCodeAgentStore() {
  const store = createStore<OpenCodeAgentState>(INITIAL_STATE);

  async function load(): Promise<void> {
    store.setState((state) => ({ ...state, loading: true, error: null }));
    try {
      const status = await getOpenCodeAgentStatus();
      store.setState((state) => ({ ...state, status, loading: false }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load OpenCode agent config';
      store.setState((state) => ({ ...state, loading: false, error: message }));
    }
  }

  async function save(exploreModel: string, scoutModel: string): Promise<void> {
    store.setState((state) => ({ ...state, saving: true, error: null, message: null }));
    try {
      const status = await setOpenCodeAgentModels(exploreModel, scoutModel);
      store.setState((state) => ({
        ...state,
        status,
        saving: false,
        message: 'OpenCode agent models updated.',
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update OpenCode agent config';
      store.setState((state) => ({ ...state, saving: false, error: message }));
    }
  }

  async function reset(): Promise<void> {
    store.setState((state) => ({ ...state, saving: true, error: null, message: null }));
    try {
      const status = await resetOpenCodeAgentConfig();
      store.setState((state) => ({
        ...state,
        status,
        saving: false,
        message: 'OpenCode agent models reset to defaults.',
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reset OpenCode agent config';
      store.setState((state) => ({ ...state, saving: false, error: message }));
    }
  }

  function resetState(): void {
    store.setState(() => ({ ...INITIAL_STATE }));
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    setState: store.setState,
    load,
    save,
    reset,
    resetState,
  };
}

export const opencodeAgentStore = createOpenCodeAgentStore();
