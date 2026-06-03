import {
  getOpenCodeStatus,
  saveOpenCodeConfig,
  resetOpenCodeConfig,
  installOpenCodeAssets,
  installOpenCodeTooling,
  getOpenCodeRequestLogs,
} from '../lib/api/opencode';
import { createStore } from '../lib/store';
import type {
  OpenCodeStatusResponse,
  OpenCodeConfigPayload,
  OpenCodeTabSectionId,
  OpenCodeToolingInstallPayload,
  OpenCodeRequestLogEntry,
} from '../lib/types';

export interface OpenCodeState {
  status: OpenCodeStatusResponse | null;
  activeSection: OpenCodeTabSectionId;
  selectedLaneId: string | null;
  loading: boolean;
  saving: boolean;
  toolingInstalling: boolean;
  error: string | null;
  message: string | null;
  requestLogs: OpenCodeRequestLogEntry[] | null;
  requestLogsLoading: boolean;
  requestLogsTotal: number;
}

const INITIAL_STATE: OpenCodeState = {
  status: null,
  activeSection: 'overview',
  selectedLaneId: null,
  loading: false,
  saving: false,
  toolingInstalling: false,
  error: null,
  message: null,
  requestLogs: null,
  requestLogsLoading: false,
  requestLogsTotal: 0,
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return 'An unexpected error occurred.';
}

function createOpenCodeStore() {
  const store = createStore<OpenCodeState>(INITIAL_STATE);

  async function load(): Promise<void> {
    store.setState((state) => ({ ...state, loading: true, error: null }));
    try {
      const status = await getOpenCodeStatus();
      store.setState((state) => ({ ...state, status, loading: false }));
    } catch (error) {
      store.setState((state) => ({
        ...state,
        loading: false,
        error: toErrorMessage(error),
      }));
    }
  }

  async function saveConfig(payload: OpenCodeConfigPayload): Promise<void> {
    store.setState((state) => ({ ...state, saving: true, error: null, message: null }));
    try {
      const response = await saveOpenCodeConfig(payload);
      store.setState((state) => ({
        ...state,
        status: response.status,
        saving: false,
        message: 'OpenCode configuration saved.',
      }));
    } catch (error) {
      store.setState((state) => ({
        ...state,
        saving: false,
        error: toErrorMessage(error),
      }));
    }
  }

  async function resetConfig(): Promise<void> {
    store.setState((state) => ({ ...state, saving: true, error: null, message: null }));
    try {
      const response = await resetOpenCodeConfig();
      store.setState((state) => ({
        ...state,
        status: response.status,
        saving: false,
        message: 'OpenCode configuration reset to defaults.',
      }));
    } catch (error) {
      store.setState((state) => ({
        ...state,
        saving: false,
        error: toErrorMessage(error),
      }));
    }
  }

  async function installAssets(force = false): Promise<void> {
    store.setState((state) => ({ ...state, saving: true, error: null, message: null }));
    try {
      const response = await installOpenCodeAssets(force);
      const status = response.status;
      if (status) {
        store.setState((state) => ({
          ...state,
          status,
          saving: false,
          message: 'OpenCode assets installed.',
        }));
      } else {
        store.setState((state) => ({
          ...state,
          saving: false,
          error: response.error || 'Failed to install OpenCode assets.',
        }));
      }
    } catch (error) {
      store.setState((state) => ({
        ...state,
        saving: false,
        error: toErrorMessage(error),
      }));
    }
  }

  async function installTooling(payload: OpenCodeToolingInstallPayload): Promise<void> {
    store.setState((state) => ({ ...state, toolingInstalling: true, error: null, message: null }));
    try {
      const response = await installOpenCodeTooling(payload);
      const status = response.status;
      if (response.ok && status) {
        store.setState((state) => ({
          ...state,
          status,
          toolingInstalling: false,
          message: payload.kind === 'elegy-planning-cli'
            ? 'elegy-planning CLI install completed.'
            : 'Elegy skills install completed.',
        }));
      } else {
        store.setState((state) => ({
          ...state,
          toolingInstalling: false,
          error: response.error || `Failed to install ${payload.kind}.`,
        }));
      }
    } catch (error) {
      store.setState((state) => ({
        ...state,
        toolingInstalling: false,
        error: toErrorMessage(error),
      }));
    }
  }

  async function loadRequestLogs(params?: { limit?: number; since?: string }): Promise<void> {
    store.setState((state) => ({ ...state, requestLogsLoading: true }));
    try {
      const response = await getOpenCodeRequestLogs(params);
      store.setState((state) => ({
        ...state,
        requestLogs: response.requests,
        requestLogsTotal: response.total,
        requestLogsLoading: false,
      }));
    } catch (error) {
      store.setState((state) => ({
        ...state,
        requestLogsLoading: false,
        error: toErrorMessage(error),
      }));
    }
  }

  function setActiveSection(section: OpenCodeTabSectionId): void {
    store.setState((state) => ({ ...state, activeSection: section }));
  }

  function setSelectedLaneId(laneId: string | null): void {
    store.setState((state) => ({ ...state, selectedLaneId: laneId }));
  }

  function resetState(): void {
    store.setState(() => ({ ...INITIAL_STATE }));
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    setState: store.setState,
    load,
    saveConfig,
    resetConfig,
    installAssets,
    installTooling,
    loadRequestLogs,
    setActiveSection,
    setSelectedLaneId,
    resetState,
  };
}

export const opencodeStore = createOpenCodeStore();
