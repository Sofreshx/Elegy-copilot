import { createStore } from '../lib/store';

// ── Legacy tab IDs (kept for backward compatibility) ──
export const TAB_IDS = [
  'home-runtime',
  'catalog',
  'planning',
  'stats',
] as const;

export type TabId = (typeof TAB_IDS)[number];

export const RUNTIME_SECTION_IDS = [
  'overview',
  'sessions',
  'executor',
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

// ── New sidebar-driven navigation ──
export const SIDEBAR_IDS = [
  'dashboard',
  'projects',
  'catalog',
  'planning',
  'workflows',
  'maintenance',
  'settings',
] as const;

export type SidebarItemId = (typeof SIDEBAR_IDS)[number];

export type ProjectSubView = 'overview' | 'sessions' | 'tasks' | 'config';
export type SessionDetailTab = 'activity' | 'tasks' | 'artifacts' | 'config' | 'git';
export type MaintenanceSection = 'updates' | 'sandboxes' | 'diagnostics';
export type PlanningSection = 'notes' | 'research' | 'mermaid' | 'ideas';
export type WizardType = 'session' | 'project' | 'workflow' | null;

export type SidebarNavItem = {
  id: SidebarItemId;
  label: string;
  icon: string;
  description: string;
};

export const SIDEBAR_NAV_ITEMS: readonly SidebarNavItem[] = [
  { id: 'dashboard', label: 'Execution', icon: '▶', description: 'Active sessions, session output, and quick launch' },
  { id: 'projects', label: 'Projects', icon: '◆', description: 'Registered repositories and project views' },
  { id: 'catalog', label: 'Catalog', icon: '▤', description: 'Asset workspace, installs, and skill discovery' },
  { id: 'planning', label: 'Todo', icon: '☑', description: 'Work queue and backlog per repository' },
  { id: 'workflows', label: 'Workflows', icon: '⟳', description: 'Workflow templates, chained sessions, and automation' },
  { id: 'maintenance', label: 'Maintenance', icon: '⚙', description: 'Updates, sandboxes, diagnostics' },
  { id: 'settings', label: 'Settings', icon: '☰', description: 'App configuration and preferences' },
];

export type NavigationState = {
  // Legacy fields (backward compat — Phase 1a bridge)
  activeTabId: TabId;
  runtimeSectionId: RuntimeSectionId;
  diagnosticsSectionId: DiagnosticsSectionId;
  catalogSectionId: CatalogSectionId;
  sessionsMode: SessionsMode;

  // New sidebar-driven fields
  activeSidebarItem: SidebarItemId;
  selectedProjectId: string | null;
  projectSubView: ProjectSubView;
  selectedSessionId: string | null;
  sessionDetailTab: SessionDetailTab;
  maintenanceSection: MaintenanceSection;
  planningSection: PlanningSection;
  selectedWorkflowTemplateId: string | null;
  selectedWorkflowRunId: string | null;
  adminMode: boolean;
  wizardOpen: WizardType;
};

// Legacy tab definitions (kept for reference by runtime overlay and stats tab routes)
export const NAVIGATION_TABS: readonly NavigationTab[] = [
  { id: 'home-runtime', label: 'Home / Runtime', description: 'Overview, sessions, executor, and diagnostics' },
  { id: 'catalog', label: 'Catalog', description: 'Asset workspace, installs, and skill discovery' },
  { id: 'planning', label: 'Planning', description: 'Repo-backed backlog, roadmaps, and planning workflows' },
  { id: 'stats', label: 'Stats', description: 'Runtime health, catalog telemetry, and recent sampled usage' },
];

const INITIAL_STATE: NavigationState = {
  // Legacy defaults
  activeTabId: 'home-runtime',
  runtimeSectionId: 'overview',
  diagnosticsSectionId: 'runtime',
  catalogSectionId: 'overview',
  sessionsMode: 'local',

  // New defaults
  activeSidebarItem: 'dashboard',
  selectedProjectId: null,
  projectSubView: 'overview',
  selectedSessionId: null,
  sessionDetailTab: 'activity',
  maintenanceSection: 'updates',
  planningSection: 'notes',
  selectedWorkflowTemplateId: null,
  selectedWorkflowRunId: null,
  adminMode: false,
  wizardOpen: null,
};

function createNavigationStore() {
  const store = createStore<NavigationState>(INITIAL_STATE);

  // ── Legacy methods (backward compat) ──

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

  // ── New sidebar-driven methods ──

  function navigate(sidebarItem: SidebarItemId): void {
    store.setState((state) => ({
      ...state,
      activeSidebarItem: sidebarItem,
      selectedSessionId: null,
      wizardOpen: null,
    }));
  }

  function selectProject(projectId: string | null, subView: ProjectSubView = 'overview'): void {
    store.setState((state) => ({
      ...state,
      activeSidebarItem: 'projects',
      selectedProjectId: projectId,
      projectSubView: subView,
    }));
  }

  function selectSession(sessionId: string | null, tab: SessionDetailTab = 'activity'): void {
    store.setState((state) => ({
      ...state,
      selectedSessionId: sessionId,
      sessionDetailTab: tab,
    }));
  }

  function setMaintenanceSection(section: MaintenanceSection): void {
    store.setState((state) => ({
      ...state,
      activeSidebarItem: 'maintenance',
      maintenanceSection: section,
    }));
  }

  function setPlanningSection(section: PlanningSection): void {
    store.setState((state) => ({
      ...state,
      activeSidebarItem: 'planning',
      planningSection: section,
    }));
  }

  function selectWorkflowTemplate(templateId: string | null): void {
    store.setState((state) => ({
      ...state,
      activeSidebarItem: 'workflows',
      selectedWorkflowTemplateId: templateId,
      selectedWorkflowRunId: null,
    }));
  }

  function selectWorkflowRun(runId: string | null): void {
    store.setState((state) => ({
      ...state,
      activeSidebarItem: 'workflows',
      selectedWorkflowRunId: runId,
      selectedWorkflowTemplateId: null,
    }));
  }

  function openWizard(wizard: WizardType): void {
    store.setState((state) => ({
      ...state,
      wizardOpen: wizard,
    }));
  }

  function closeWizard(): void {
    store.setState((state) => ({
      ...state,
      wizardOpen: null,
    }));
  }

  function toggleAdmin(): void {
    store.setState((state) => ({
      ...state,
      adminMode: !state.adminMode,
    }));
  }

  function reset(): void {
    store.setState(INITIAL_STATE);
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    // Legacy
    setActiveTabId,
    setRuntimeSectionId,
    setDiagnosticsSectionId,
    setCatalogSectionId,
    goToRuntime,
    goToCatalog,
    goToPlanning,
    // New sidebar-driven
    navigate,
    selectProject,
    selectSession,
    setMaintenanceSection,
    setPlanningSection,
    selectWorkflowTemplate,
    selectWorkflowRun,
    openWizard,
    closeWizard,
    toggleAdmin,
    reset,
  };
}

export const navigationStore = createNavigationStore();
