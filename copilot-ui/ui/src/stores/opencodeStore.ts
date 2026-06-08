import {
  getOpenCodeStatus,
  saveOpenCodeConfig,
  saveOpenCodeConfigKey,
  resetOpenCodeConfig,
  installOpenCodeAssets,
  installOpenCodeTooling,
  installCodexPlanning as installCodexPlanningApi,
  installOpenCodeCli as installOpenCodeCliApi,
  getOpenCodeRequestLogs,
  getGoWorkspaces,
  registerGoWorkspace,
  createGoWorkspaceFlow,
  activateGoWorkspace,
  validateGoWorkspace,
  deleteGoWorkspace,
} from '../lib/api/opencode';
import { createStore } from '../lib/store';
import type {
  OpenCodeStatusResponse,
  OpenCodeConfigPayload,
  OpenCodeTabSectionId,
  OpenCodeToolingInstallPayload,
  OpenCodeRequestLogEntry,
  OpenCodeGoWorkspacesResponse,
  OpenCodeGoWorkspaceCreatePayload,
  OpenCodeGoWorkspaceCreateFlowPayload,
  OpenCodeGoWorkspaceActionResponse,
  OpenCodeGoWorkspaceCreateFlowResponse,
  OpenCodeGoWorkspaceValidateResponse,
} from '../lib/types';

export interface OpenCodeState {
  status: OpenCodeStatusResponse | null;
  activeSection: OpenCodeTabSectionId;
  selectedLaneId: string | null;
  loading: boolean;
  saving: boolean;
  toolingInstalling: boolean;
  installingCli: boolean;
  permissionsInstalling: boolean;
  error: string | null;
  message: string | null;
  requestLogs: OpenCodeRequestLogEntry[] | null;
  requestLogsLoading: boolean;
  requestLogsTotal: number;
  goWorkspaces: OpenCodeGoWorkspacesResponse | null;
  goWorkspacesLoading: boolean;
  goWorkspacesError: string | null;
}

const INITIAL_STATE: OpenCodeState = {
  status: null,
  activeSection: 'overview',
  selectedLaneId: null,
  loading: false,
  saving: false,
  toolingInstalling: false,
  installingCli: false,
  permissionsInstalling: false,
  error: null,
  message: null,
  requestLogs: null,
  requestLogsLoading: false,
  requestLogsTotal: 0,
  goWorkspaces: null,
  goWorkspacesLoading: false,
  goWorkspacesError: null,
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
      if (response.ok === false) {
        store.setState((state) => ({
          ...state,
          saving: false,
          error: response.error || 'Failed to save configuration.',
        }));
        return;
      }
      store.setState((state) => ({
        ...state,
        status: response.status,
        saving: false,
        message: payload.profileRoute
          ? `Profile switched to ${payload.profileRoute}.`
          : 'OpenCode configuration saved.',
      }));
    } catch (error) {
      store.setState((state) => ({
        ...state,
        saving: false,
        error: toErrorMessage(error),
      }));
    }
  }

  async function toggleConfigKey(key: string, value: boolean): Promise<void> {
    store.setState((state) => ({ ...state, saving: true, error: null, message: null }));
    try {
      const response = await saveOpenCodeConfigKey({ key, value });
      store.setState((state) => ({
        ...state,
        status: response.status,
        saving: false,
        message: `${key} ${value ? 'enabled' : 'disabled'} successfully.`,
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
            : payload.kind === 'worktree-permission-profile'
              ? 'Worktree permissions installed.'
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

  async function installCodexPlanning(): Promise<void> {
    store.setState((state) => ({ ...state, toolingInstalling: true, error: null, message: null }));
    try {
      const response = await installCodexPlanningApi();
      if (response.ok) {
        store.setState((state) => ({
          ...state,
          toolingInstalling: false,
          message: 'Codex elegy-planning skill installed.',
        }));
      } else {
        store.setState((state) => ({
          ...state,
          toolingInstalling: false,
          error: response.error || 'Failed to install Codex planning skill.',
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

  async function installOpenCodeCli(): Promise<void> {
    store.setState((state) => ({ ...state, installingCli: true, error: null, message: null }));
    try {
      const response = await installOpenCodeCliApi();
      if (response.ok) {
        store.setState((state) => ({
          ...state,
          installingCli: false,
          message: 'OpenCode CLI install completed.',
        }));
      } else {
        store.setState((state) => ({
          ...state,
          installingCli: false,
          error: response.error || 'Failed to install OpenCode CLI.',
        }));
      }
    } catch (error) {
      store.setState((state) => ({
        ...state,
        installingCli: false,
        error: toErrorMessage(error),
      }));
    }
  }

  async function installWorktreePermissions(): Promise<void> {
    store.setState((state) => ({ ...state, permissionsInstalling: true, error: null, message: null }));
    try {
      const response = await installOpenCodeTooling({ kind: 'worktree-permission-profile' });
      const status = response.status;
      if (response.ok && status) {
        store.setState((state) => ({
          ...state,
          status,
          permissionsInstalling: false,
          message: 'Worktree permissions installed.',
        }));
      } else {
        store.setState((state) => ({
          ...state,
          permissionsInstalling: false,
          error: response.error || 'Failed to install worktree permissions.',
        }));
      }
    } catch (error) {
      store.setState((state) => ({
        ...state,
        permissionsInstalling: false,
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

  async function loadGoWorkspaces(): Promise<void> {
    store.setState((state) => ({ ...state, goWorkspacesLoading: true, goWorkspacesError: null }));
    try {
      const response = await getGoWorkspaces();
      store.setState((state) => ({ ...state, goWorkspaces: response, goWorkspacesLoading: false }));
    } catch (error) {
      store.setState((state) => ({
        ...state,
        goWorkspacesLoading: false,
        goWorkspacesError: toErrorMessage(error),
      }));
    }
  }

  async function createGoWorkspace(payload: OpenCodeGoWorkspaceCreatePayload): Promise<void> {
    store.setState((state) => ({ ...state, goWorkspacesLoading: true, goWorkspacesError: null }));
    try {
      const response = await registerGoWorkspace(payload);
      store.setState((state) => ({ ...state, goWorkspaces: response, goWorkspacesLoading: false }));
    } catch (error) {
      store.setState((state) => ({
        ...state,
        goWorkspacesLoading: false,
        goWorkspacesError: toErrorMessage(error),
      }));
    }
  }

  async function activateGoWorkspaceAction(id: string): Promise<void> {
    store.setState((state) => ({ ...state, goWorkspacesLoading: true, goWorkspacesError: null }));
    try {
      const response = await activateGoWorkspace(id);
      store.setState((state) => ({ ...state, goWorkspaces: response, goWorkspacesLoading: false }));
    } catch (error) {
      store.setState((state) => ({
        ...state,
        goWorkspacesLoading: false,
        goWorkspacesError: toErrorMessage(error),
      }));
    }
  }

  async function validateGoWorkspaceAction(id: string): Promise<void> {
    store.setState((state) => ({ ...state, goWorkspacesLoading: true, goWorkspacesError: null }));
    try {
      await validateGoWorkspace(id);
      // After validation, reload full workspace list to get updated validation status
      const updated = await getGoWorkspaces();
      store.setState((state) => ({ ...state, goWorkspaces: updated, goWorkspacesLoading: false }));
    } catch (error) {
      store.setState((state) => ({
        ...state,
        goWorkspacesLoading: false,
        goWorkspacesError: toErrorMessage(error),
      }));
    }
  }

  async function deleteGoWorkspaceAction(id: string): Promise<void> {
    store.setState((state) => ({ ...state, goWorkspacesLoading: true, goWorkspacesError: null }));
    try {
      const response = await deleteGoWorkspace(id);
      store.setState((state) => ({ ...state, goWorkspaces: response, goWorkspacesLoading: false }));
    } catch (error) {
      store.setState((state) => ({
        ...state,
        goWorkspacesLoading: false,
        goWorkspacesError: toErrorMessage(error),
      }));
    }
  }

  async function createGoWorkspaceFlowAction(payload: OpenCodeGoWorkspaceCreateFlowPayload): Promise<OpenCodeGoWorkspaceCreateFlowResponse> {
    store.setState((state) => ({ ...state, goWorkspacesLoading: true, goWorkspacesError: null }));
    try {
      const response = await createGoWorkspaceFlow(payload);
      store.setState((state) => ({ ...state, goWorkspacesLoading: false }));
      return response;
    } catch (error) {
      store.setState((state) => ({
        ...state,
        goWorkspacesLoading: false,
        goWorkspacesError: toErrorMessage(error),
      }));
      throw error;
    }
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    setState: store.setState,
    load,
    saveConfig,
    toggleConfigKey,
    resetConfig,
    installAssets,
    installTooling,
    installCodexPlanning,
    installOpenCodeCli,
    installWorktreePermissions,
    loadRequestLogs,
    setActiveSection,
    setSelectedLaneId,
    resetState,
    loadGoWorkspaces,
    createGoWorkspace,
    activateGoWorkspaceAction,
    validateGoWorkspaceAction,
    deleteGoWorkspaceAction,
    createGoWorkspaceFlowAction,
  };
}

export const opencodeStore = createOpenCodeStore();
