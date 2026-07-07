import { createStore } from '../lib/store';
import { navigationStore } from './navigation';
import {
  checkDeepseekBridge,
  getCodexProviderStatus,
  getDeepseekStatus,
  getBootstrapStatus,
  getCodexCliStatus,
  bootstrapMoonBridge,
  resetCodexProvider,
  saveDeepseekSettings,
  setCodexProviderMode,
  startDeepseekBridge,
  stopDeepseekBridge,
  factoryResetCodexProvider,
  reinstallCodexSurface,
  getCodexPlanningStatus,
  installCodexPlanningSkill,
  getCodexSubagents,
  getOpenCodeWorkersStatus,
  getOpenCodeWorkersUsage,
  installOpenCodeWorkers,
  removeOpenCodeWorkers,
  saveCodexSubagentSettings,
  saveOpenCodeWorkersConfig,
  updateCodexSubagent,
  resetCodexSubagent,
  uninstallCodexSubagent,
  getCodexSubagentUsage,
  type DeepseekSettingsPayload,
  type CodexSubagentsResponse,
  type CodexSubagentUsageResponse,
  type CodexSubagentSettings,
  type OpenCodeWorkerConfig,
  type OpenCodeWorkersStatusResponse,
  type OpenCodeWorkersUsageResponse,
} from '../lib/api/codexConfig';
import type { CodexProviderDeepseekStatus, CodexProviderStatusResponse, CodexPlanningStatusResponse, MoonBridgeBootstrapStatus } from '../lib/types';

export interface CodexProviderState {
  status: CodexProviderStatusResponse | null;
  deepseekStatus: CodexProviderDeepseekStatus | null;
  bootstrapStatus: MoonBridgeBootstrapStatus | null;
  loading: boolean;
  saving: boolean;
  bridgeLoading: boolean;
  bootstrapLoading: boolean;
  installingCli: boolean;
  cliStatus: { installed: boolean; version: string | null; installCommand: string; lastError: string | null } | null;
  planningStatus: CodexPlanningStatusResponse | null;
  installingPlanning: boolean;
  subagents: CodexSubagentsResponse | null;
  subagentUsage: CodexSubagentUsageResponse | null;
  opencodeWorkers: OpenCodeWorkersStatusResponse | null;
  opencodeWorkersUsage: OpenCodeWorkersUsageResponse | null;
  activeSection: 'overview' | 'subagents' | 'workers' | 'usage';
  subagentsLoading: boolean;
  subagentSaving: boolean;
  error: string | null;
  message: string | null;
}

const INITIAL_STATE: CodexProviderState = {
  status: null,
  deepseekStatus: null,
  bootstrapStatus: null,
  loading: false,
  saving: false,
  bridgeLoading: false,
  bootstrapLoading: false,
  installingCli: false,
  cliStatus: null,
  planningStatus: null,
  installingPlanning: false,
  subagents: null,
  subagentUsage: null,
  opencodeWorkers: null,
  opencodeWorkersUsage: null,
  activeSection: 'overview',
  subagentsLoading: false,
  subagentSaving: false,
  error: null,
  message: null,
};

function createCodexProviderStore() {
  const store = createStore<CodexProviderState>(INITIAL_STATE);

  async function load(): Promise<void> {
    store.setState((state) => ({ ...state, loading: true, error: null }));
    try {
      const [status, dsStatus, bootstrapStatus, cliStatusResult, planningStatus] = await Promise.all([
        getCodexProviderStatus(),
        getDeepseekStatus().catch(() => null),
        getBootstrapStatus().catch(() => null),
        getCodexCliStatus().catch(() => null),
        getCodexPlanningStatus().catch(() => null),
      ]);
      store.setState((state) => ({
        ...state,
        status,
        deepseekStatus: dsStatus,
        bootstrapStatus,
        cliStatus: cliStatusResult?.cli || state.cliStatus,
        planningStatus,
        loading: false,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load Codex provider status';
      store.setState((state) => ({ ...state, loading: false, error: message }));
    }
  }

  function setActiveSection(activeSection: CodexProviderState['activeSection']): void {
    store.setState((state) => ({ ...state, activeSection }));
  }

  async function loadSubagents(): Promise<void> {
    store.setState((state) => ({ ...state, subagentsLoading: true, error: null }));
    try {
      const [subagents, subagentUsage] = await Promise.all([
        getCodexSubagents({ repoPath: navigationStore.getState().activeWorkspaceId }),
        getCodexSubagentUsage().catch(() => null),
      ]);
      store.setState((state) => ({
        ...state,
        subagents,
        subagentUsage,
        subagentsLoading: false,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load Codex subagents';
      store.setState((state) => ({ ...state, subagentsLoading: false, error: message }));
    }
  }

  async function loadOpenCodeWorkers(): Promise<void> {
    store.setState((state) => ({ ...state, subagentsLoading: true, error: null }));
    try {
      const repoPath = navigationStore.getState().activeWorkspaceId;
      const [opencodeWorkers, opencodeWorkersUsage] = await Promise.all([
        getOpenCodeWorkersStatus({ repoPath }),
        getOpenCodeWorkersUsage({ repoPath }).catch(() => null),
      ]);
      store.setState((state) => ({
        ...state,
        opencodeWorkers,
        opencodeWorkersUsage,
        subagentsLoading: false,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load OpenCode Workers';
      store.setState((state) => ({ ...state, subagentsLoading: false, error: message }));
    }
  }

  async function saveOpenCodeWorkers(settings: Partial<OpenCodeWorkerConfig>): Promise<void> {
    store.setState((state) => ({ ...state, subagentSaving: true, error: null, message: null }));
    try {
      const repoPath = navigationStore.getState().activeWorkspaceId;
      const opencodeWorkers = await saveOpenCodeWorkersConfig(settings, { repoPath });
      const opencodeWorkersUsage = await getOpenCodeWorkersUsage({ repoPath }).catch(() => null);
      store.setState((state) => ({
        ...state,
        opencodeWorkers,
        opencodeWorkersUsage,
        subagentSaving: false,
        message: 'OpenCode Workers settings saved.',
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save OpenCode Workers settings';
      store.setState((state) => ({ ...state, subagentSaving: false, error: message }));
    }
  }

  async function installOpenCodeWorkersPlugin(): Promise<void> {
    store.setState((state) => ({ ...state, subagentSaving: true, error: null, message: null }));
    try {
      const result = await installOpenCodeWorkers();
      store.setState((state) => ({
        ...state,
        opencodeWorkers: result.status,
        subagentSaving: false,
        message: result.ok ? 'OpenCode Workers marketplace export complete.' : 'OpenCode Workers install failed.',
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to install OpenCode Workers';
      store.setState((state) => ({ ...state, subagentSaving: false, error: message }));
    }
  }

  async function removeOpenCodeWorkersPlugin(): Promise<void> {
    store.setState((state) => ({ ...state, subagentSaving: true, error: null, message: null }));
    try {
      const result = await removeOpenCodeWorkers();
      store.setState((state) => ({
        ...state,
        opencodeWorkers: result.status,
        subagentSaving: false,
        message: 'OpenCode Workers removed from managed Codex plugin locations.',
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to remove OpenCode Workers';
      store.setState((state) => ({ ...state, subagentSaving: false, error: message }));
    }
  }

  async function saveSubagentSettings(settings: Partial<CodexSubagentSettings>): Promise<void> {
    store.setState((state) => ({ ...state, subagentSaving: true, error: null, message: null }));
    try {
      const result = await saveCodexSubagentSettings(settings);
      store.setState((state) => ({
        ...state,
        subagents: state.subagents
          ? {
            ...state.subagents,
            settings: result.settings,
            nativeConfig: result.nativeConfig,
            summary: {
              ...state.subagents.summary,
              routingMode: result.settings.routingMode,
              maxThreads: result.settings.maxThreads,
              maxDepth: result.settings.maxDepth,
              nativeConfigSynced: result.nativeConfig.matchesSettings === true,
            },
          }
          : state.subagents,
        subagentSaving: false,
        message: 'Codex subagent settings saved.',
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save Codex subagent settings';
      store.setState((state) => ({ ...state, subagentSaving: false, error: message }));
    }
  }

  async function saveSubagent(name: string, updates: Record<string, unknown>): Promise<void> {
    store.setState((state) => ({ ...state, subagentSaving: true, error: null, message: null }));
    try {
      const subagents = await updateCodexSubagent(name, updates);
      store.setState((state) => ({
        ...state,
        subagents,
        subagentSaving: false,
        message: `Codex subagent ${name} saved.`,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : `Failed to save Codex subagent ${name}`;
      store.setState((state) => ({ ...state, subagentSaving: false, error: message }));
    }
  }

  async function resetSubagent(name: string): Promise<void> {
    store.setState((state) => ({ ...state, subagentSaving: true, error: null, message: null }));
    try {
      const subagents = await resetCodexSubagent(name);
      store.setState((state) => ({
        ...state,
        subagents,
        subagentSaving: false,
        message: `Codex subagent ${name} reset to managed default.`,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : `Failed to reset Codex subagent ${name}`;
      store.setState((state) => ({ ...state, subagentSaving: false, error: message }));
    }
  }

  async function uninstallSubagent(name: string, force = false): Promise<void> {
    store.setState((state) => ({ ...state, subagentSaving: true, error: null, message: null }));
    try {
      const subagents = await uninstallCodexSubagent(name, force);
      store.setState((state) => ({
        ...state,
        subagents,
        subagentSaving: false,
        message: `Codex subagent ${name} uninstalled.`,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : `Failed to uninstall Codex subagent ${name}`;
      store.setState((state) => ({ ...state, subagentSaving: false, error: message }));
    }
  }

  async function setMode(mode: 'native' | 'deepseek-bridge'): Promise<void> {
    store.setState((state) => ({ ...state, saving: true, error: null, message: null }));
    try {
      const status = await setCodexProviderMode(mode);
      store.setState((state) => ({
        ...state,
        status,
        saving: false,
        message: mode === 'deepseek-bridge'
          ? 'Codex now defaults to DeepSeek V4 via Moon Bridge.'
          : 'Codex provider returned to native defaults.',
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update Codex provider';
      store.setState((state) => ({ ...state, saving: false, error: message }));
    }
  }

  async function reset(hard = false): Promise<void> {
    store.setState((state) => ({ ...state, saving: true, error: null, message: null }));
    try {
      const status = await resetCodexProvider(hard);
      store.setState((state) => ({
        ...state,
        status,
        saving: false,
        message: hard
          ? 'Codex config restored from the pre-Elegy backup snapshot.'
          : 'Removed Elegy-managed Codex provider settings from config.',
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reset Codex provider';
      store.setState((state) => ({ ...state, saving: false, error: message }));
    }
  }

  async function factoryReset(): Promise<void> {
    store.setState((state) => ({ ...state, saving: true, error: null, message: null }));
    try {
      const status = await factoryResetCodexProvider();
      store.setState((state) => ({
        ...state,
        status,
        saving: false,
        message: 'Codex config factory reset complete. All Elegy-managed settings removed.',
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to factory-reset Codex provider';
      store.setState((state) => ({ ...state, saving: false, error: message }));
    }
  }

  async function reinstallSurface(): Promise<void> {
    store.setState((state) => ({ ...state, saving: true, error: null, message: null }));
    try {
      await reinstallCodexSurface();
      // After reinstalling, switch to native mode for a clean starting point
      await setMode('native');
      await load(); // Refresh full status after mode switch
      store.setState((state) => ({
        ...state,
        saving: false,
        message: 'Codex surface reinstalled and set to native mode.',
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reinstall Codex surface';
      store.setState((state) => ({ ...state, saving: false, error: message }));
    }
  }

  async function saveDeepseek(settings: DeepseekSettingsPayload): Promise<void> {
    store.setState((state) => ({ ...state, saving: true, error: null, message: null }));
    try {
      const dsStatus = await saveDeepseekSettings(settings);
      store.setState((state) => ({
        ...state,
        deepseekStatus: dsStatus,
        saving: false,
        message: 'DeepSeek settings saved.',
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save DeepSeek settings';
      store.setState((state) => ({ ...state, saving: false, error: message }));
    }
  }

  async function startBridge(): Promise<void> {
    store.setState((state) => ({ ...state, bridgeLoading: true, error: null }));
    try {
      const result = await startDeepseekBridge();
      store.setState((state) => ({
        ...state,
        deepseekStatus: state.deepseekStatus
          ? { ...state.deepseekStatus, ...result }
          : result,
        bridgeLoading: false,
        message: result.message,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start Moon Bridge';
      store.setState((state) => ({ ...state, bridgeLoading: false, error: message }));
    }
  }

  async function stopBridge(): Promise<void> {
    store.setState((state) => ({ ...state, bridgeLoading: true, error: null }));
    try {
      const result = await stopDeepseekBridge();
      store.setState((state) => ({
        ...state,
        deepseekStatus: state.deepseekStatus
          ? { ...state.deepseekStatus, bridgeRunning: result.bridgeRunning }
          : null,
        bridgeLoading: false,
        message: result.message,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to stop Moon Bridge';
      store.setState((state) => ({ ...state, bridgeLoading: false, error: message }));
    }
  }

  async function checkBridge(): Promise<void> {
    store.setState((state) => ({ ...state, bridgeLoading: true, error: null }));
    try {
      const dsStatus = await checkDeepseekBridge();
      store.setState((state) => ({
        ...state,
        deepseekStatus: dsStatus,
        bridgeLoading: false,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to check Moon Bridge status';
      store.setState((state) => ({ ...state, bridgeLoading: false, error: message }));
    }
  }

  async function fetchBootstrapStatus(): Promise<void> {
    store.setState((state) => ({ ...state, bridgeLoading: true, error: null }));
    try {
      const bootstrapStatus = await getBootstrapStatus();
      store.setState((state) => ({
        ...state,
        bootstrapStatus,
        bridgeLoading: false,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch Moon Bridge bootstrap status';
      store.setState((state) => ({ ...state, bridgeLoading: false, error: message }));
    }
  }

  async function bootstrap(): Promise<void> {
    store.setState((state) => ({ ...state, bootstrapLoading: true, error: null, message: null }));
    try {
      const result = await bootstrapMoonBridge({ forceRebuild: false });
      store.setState((state) => ({
        ...state,
        bootstrapStatus: result.status,
        bootstrapLoading: false,
        message: result.success
          ? result.message || 'Moon Bridge installed and built.'
          : result.error || 'Moon Bridge bootstrap failed.',
      }));
      // Re-read DeepSeek status so bridgeBinaryAvailable reflects the managed binary
      if (result.success) {
        try {
          const dsStatus = await getDeepseekStatus();
          store.setState((prev) => ({ ...prev, deepseekStatus: dsStatus }));
        } catch {
          // best-effort refresh
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to bootstrap Moon Bridge';
      store.setState((state) => ({ ...state, bootstrapLoading: false, error: message }));
    }
  }

  async function loadCliStatus(): Promise<void> {
    try {
      const result = await getCodexCliStatus();
      store.setState((state) => ({
        ...state,
        cliStatus: result.cli || null,
      }));
    } catch {
      // best-effort, CLI status is non-critical
    }
  }

  async function installCodexCli(): Promise<void> {
    store.setState((state) => ({ ...state, installingCli: true, error: null, message: null }));
    try {
      const { installCodexCli: apiInstall } = await import('../lib/api/codexConfig');
      const response = await apiInstall();
      if (response.ok) {
        const cliResult = response.cli as { installed: boolean; version: string | null; installCommand: string; lastError: string | null } | undefined;
        store.setState((state) => ({
          ...state,
          installingCli: false,
          message: 'Codex CLI installed successfully.',
          cliStatus: cliResult || state.cliStatus,
        }));
      } else {
        store.setState((state) => ({
          ...state,
          installingCli: false,
          error: response.error || 'Failed to install Codex CLI.',
        }));
      }
    } catch (error) {
      store.setState((state) => ({
        ...state,
        installingCli: false,
        error: error instanceof Error ? error.message : 'An unexpected error occurred.',
      }));
    }
  }

  async function loadPlanningStatus(): Promise<void> {
    try {
      const planningStatus = await getCodexPlanningStatus();
      store.setState((state) => ({
        ...state,
        planningStatus,
      }));
    } catch {
      // best-effort, planning status is non-critical
    }
  }

  async function installPlanning(): Promise<void> {
    store.setState((state) => ({ ...state, installingPlanning: true, error: null, message: null }));
    try {
      const result = await installCodexPlanningSkill();
      if (result.ok) {
        // Refresh planning status after install
        const planningStatus = await getCodexPlanningStatus();
        store.setState((state) => ({
          ...state,
          installingPlanning: false,
          planningStatus,
          message: 'Elegy Planning skill installed successfully for Codex.',
        }));
      } else {
        store.setState((state) => ({
          ...state,
          installingPlanning: false,
          error: result.error || 'Failed to install Elegy Planning skill.',
        }));
      }
    } catch (error) {
      store.setState((state) => ({
        ...state,
        installingPlanning: false,
        error: error instanceof Error ? error.message : 'An unexpected error occurred.',
      }));
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
    setActiveSection,
    loadSubagents,
    loadOpenCodeWorkers,
    saveOpenCodeWorkers,
    installOpenCodeWorkersPlugin,
    removeOpenCodeWorkersPlugin,
    saveSubagentSettings,
    saveSubagent,
    resetSubagent,
    uninstallSubagent,
    setMode,
    reset,
    factoryReset,
    reinstallSurface,
    saveDeepseek,
    startBridge,
    stopBridge,
    checkBridge,
    fetchBootstrapStatus,
    bootstrap,
    loadCliStatus,
    installCodexCli,
    loadPlanningStatus,
    installPlanning,
    resetState,
  };
}

export const codexProviderStore = createCodexProviderStore();
