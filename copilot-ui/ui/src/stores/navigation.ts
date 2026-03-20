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
  'executor',
  'sandboxes',
  'diagnostics',
] as const;

export type RuntimeSectionId = (typeof RUNTIME_SECTION_IDS)[number];

export const DIAGNOSTICS_SECTION_IDS = [
  'runtime',
  'database',
  'gateway',
  'tracker',
  'lsp',
] as const;

export type DiagnosticsSectionId = (typeof DIAGNOSTICS_SECTION_IDS)[number];

export const CATALOG_SECTION_IDS = [
  'overview',
  'assets',
  'skills',
  'agents',
] as const;

export type CatalogSectionId = (typeof CATALOG_SECTION_IDS)[number];

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
  catalogSectionId: CatalogSectionId;
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
  diagnosticsSectionId: 'runtime',
  catalogSectionId: 'overview',
  sessionsMode: 'local',
};

function createNavigationStore() {
  const store = createStore<NavigationState>(INITIAL_STATE);

  function setActiveTabId(activeTabId: TabId): void {
    store.setState((state) => ({
      ...state,
      activeTabId,
      catalogSectionId: activeTabId === 'catalog' ? 'overview' : state.catalogSectionId,
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

  function setCatalogSectionId(catalogSectionId: CatalogSectionId): void {
    store.setState((state) => ({
      ...state,
      activeTabId: 'catalog',
      catalogSectionId,
    }));
  }

  function goToCatalog(catalogSectionId: CatalogSectionId = 'overview'): void {
    store.setState((state) => ({
      ...state,
      activeTabId: 'catalog',
      catalogSectionId,
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
    setCatalogSectionId,
    goToRuntime,
    goToCatalog,
    goToPlanning,
    reset,
  };
}

export const navigationStore = createNavigationStore();
