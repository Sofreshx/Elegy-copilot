import { createStore } from '../lib/store';

export const TAB_IDS = [
  'home-runtime',
  'catalog',
  'planning',
] as const;

export type TabId = (typeof TAB_IDS)[number];

export const RUNTIME_SECTION_IDS = [
  'overview',
  'sessions',
  'sandboxes',
  'diagnostics',
] as const;

export type RuntimeSectionId = (typeof RUNTIME_SECTION_IDS)[number];

export const DIAGNOSTICS_SECTION_IDS = [
  'gateway',
  'tracker',
  'lsp',
] as const;

export type DiagnosticsSectionId = (typeof DIAGNOSTICS_SECTION_IDS)[number];

export type SessionsMode = 'local' | 'sdk';

export type NavigationTab = {
  id: TabId;
  label: string;
  description: string;
};

export type NavigationState = {
  activeTabId: TabId;
  runtimeSectionId: RuntimeSectionId;
  diagnosticsSectionId: DiagnosticsSectionId;
  sessionsMode: SessionsMode;
};

export const NAVIGATION_TABS: readonly NavigationTab[] = [
  { id: 'home-runtime', label: 'Home / Runtime', description: 'Overview, sessions, sandboxes, and diagnostics' },
  { id: 'catalog', label: 'Catalog', description: 'Asset workspace, installs, and skill discovery' },
  { id: 'planning', label: 'Planning', description: 'Repo-backed backlog, roadmaps, and planning workflows' },
];

const INITIAL_STATE: NavigationState = {
  activeTabId: 'home-runtime',
  runtimeSectionId: 'overview',
  diagnosticsSectionId: 'gateway',
  sessionsMode: 'local',
};

function createNavigationStore() {
  const store = createStore<NavigationState>(INITIAL_STATE);

  function setActiveTabId(activeTabId: TabId): void {
    store.setState((state) => ({
      ...state,
      activeTabId,
    }));
  }

  function setRuntimeSectionId(runtimeSectionId: RuntimeSectionId): void {
    store.setState((state) => ({
      ...state,
      activeTabId: 'home-runtime',
      runtimeSectionId,
      sessionsMode: runtimeSectionId === 'sessions' ? state.sessionsMode : state.sessionsMode,
    }));
  }

  function setDiagnosticsSectionId(diagnosticsSectionId: DiagnosticsSectionId): void {
    store.setState((state) => ({
      ...state,
      activeTabId: 'home-runtime',
      runtimeSectionId: 'diagnostics',
      diagnosticsSectionId,
    }));
  }

  function goToRuntime(
    runtimeSectionId: RuntimeSectionId,
    options: { sessionsMode?: SessionsMode; diagnosticsSectionId?: DiagnosticsSectionId } = {},
  ): void {
    store.setState((state) => ({
      ...state,
      activeTabId: 'home-runtime',
      runtimeSectionId,
      sessionsMode: options.sessionsMode || (runtimeSectionId === 'sessions' ? state.sessionsMode : state.sessionsMode),
      diagnosticsSectionId:
        options.diagnosticsSectionId || (runtimeSectionId === 'diagnostics' ? state.diagnosticsSectionId : state.diagnosticsSectionId),
    }));
  }

  function goToCatalog(): void {
    store.setState((state) => ({
      ...state,
      activeTabId: 'catalog',
    }));
  }

  function goToPlanning(): void {
    store.setState((state) => ({
      ...state,
      activeTabId: 'planning',
    }));
  }

  function reset(): void {
    store.setState(INITIAL_STATE);
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    setActiveTabId,
    setRuntimeSectionId,
    setDiagnosticsSectionId,
    goToRuntime,
    goToCatalog,
    goToPlanning,
    reset,
  };
}

export const navigationStore = createNavigationStore();
