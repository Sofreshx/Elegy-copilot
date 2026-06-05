import { createStore } from '../lib/store';

export const CATALOG_SECTION_IDS = [
  'status',
  'global',
  'repository',
] as const;

export type CatalogSectionId = (typeof CATALOG_SECTION_IDS)[number];

export const SIDEBAR_IDS = [
  'workspace',
  'lexicon',
  'settings',
] as const;

export type SidebarItemId = (typeof SIDEBAR_IDS)[number];

export type ProjectSubView = 'overview' | 'sessions' | 'tasks' | 'git' | 'config';
export type SessionDetailTab = 'activity' | 'tasks' | 'artifacts' | 'config' | 'git' | 'usage';
export type MaintenanceSection = 'updates' | 'sandboxes' | 'diagnostics';
export type WizardType = 'project' | 'asset' | null;

export type SettingsSection = 'app' | 'catalog' | 'opencode' | 'maintenance' | 'runtime' | 'codex';

export type WorkspaceCenterMode = 'docs' | 'planning-session' | 'terminal';

export interface SelectedSessionContext {
  source?: string | null;
  sandbox?: string | null;
}

export type SidebarNavItem = {
  id: SidebarItemId;
  label: string;
  icon: string;
  description: string;
};

export const SIDEBAR_NAV_ITEMS: readonly SidebarNavItem[] = [
  { id: 'workspace', label: 'Workspace', icon: '⎔', description: 'Document-centric repository workspace with docs, planning, and git operations' },
  { id: 'lexicon', label: 'Lexicon', icon: '◈', description: 'Searchable vocabulary reference for UI, design, architecture, and software engineering terms' },
  { id: 'settings', label: 'Settings', icon: '☰', description: 'App configuration and preferences' },
];

export type NavigationState = {
  catalogSectionId: CatalogSectionId;
  activeSidebarItem: SidebarItemId;
  selectedProjectId: string | null;
  projectSubView: ProjectSubView;
  selectedSessionId: string | null;
  selectedSessionContext: SelectedSessionContext | null;
  sessionDetailTab: SessionDetailTab;
  maintenanceSection: MaintenanceSection;
  wizardOpen: WizardType;
  settingsSection: SettingsSection;
  workspaceCenterMode: WorkspaceCenterMode;
  activePlanningSessionId: string | null;
  activePlanningSessionContext: SelectedSessionContext | null;
};

const INITIAL_STATE: NavigationState = {
  catalogSectionId: 'global',
  activeSidebarItem: 'workspace',
  selectedProjectId: null,
  projectSubView: 'overview',
  selectedSessionId: null,
  selectedSessionContext: null,
  sessionDetailTab: 'activity',
  maintenanceSection: 'updates',
  wizardOpen: null,
  settingsSection: 'app',
  workspaceCenterMode: 'docs',
  activePlanningSessionId: null,
  activePlanningSessionContext: null,
};

function createNavigationStore() {
  const store = createStore<NavigationState>(INITIAL_STATE);

  function setCatalogSectionId(catalogSectionId: CatalogSectionId): void {
    store.setState((state) => ({
      ...state,
      activeSidebarItem: 'settings',
      settingsSection: 'catalog',
      catalogSectionId,
    }));
  }

  function navigate(sidebarItem: SidebarItemId): void {
    store.setState((state) => ({
      ...state,
      activeSidebarItem: sidebarItem,
      selectedSessionId: null,
      selectedSessionContext: null,
      wizardOpen: null,
      workspaceCenterMode: sidebarItem === 'workspace' ? state.workspaceCenterMode : 'docs',
    }));
  }

  function selectProject(projectId: string | null, subView: ProjectSubView = 'overview'): void {
    store.setState((state) => ({
      ...state,
      activeSidebarItem: 'workspace',
      selectedProjectId: projectId,
      projectSubView: subView,
    }));
  }

  function selectSession(
    sessionId: string | null,
    tab: SessionDetailTab = 'activity',
    context: SelectedSessionContext | null = null,
  ): void {
    store.setState((state) => ({
      ...state,
      selectedSessionId: sessionId,
      selectedSessionContext: sessionId ? context : null,
      sessionDetailTab: tab,
    }));
  }

  function setMaintenanceSection(section: MaintenanceSection): void {
    store.setState((state) => ({
      ...state,
      activeSidebarItem: 'settings',
      settingsSection: 'maintenance',
      maintenanceSection: section,
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

  function setSettingsSection(section: SettingsSection): void {
    store.setState((state) => ({
      ...state,
      activeSidebarItem: 'settings',
      settingsSection: section,
    }));
  }

  function setWorkspaceCenterMode(mode: WorkspaceCenterMode): void {
    store.setState((state) => ({
      ...state,
      workspaceCenterMode: mode,
    }));
  }

  function openPlanningSession(sessionId: string, context: SelectedSessionContext | null = null): void {
    store.setState((state) => ({
      ...state,
      workspaceCenterMode: 'planning-session',
      activePlanningSessionId: sessionId,
      activePlanningSessionContext: context,
    }));
  }

  function closePlanningSession(): void {
    store.setState((state) => ({
      ...state,
      workspaceCenterMode: 'docs',
      activePlanningSessionId: null,
      activePlanningSessionContext: null,
    }));
  }

  function reset(): void {
    store.setState(INITIAL_STATE);
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    setCatalogSectionId,
    navigate,
    selectProject,
    selectSession,
    setMaintenanceSection,
    openWizard,
    closeWizard,
    setSettingsSection,
    setWorkspaceCenterMode,
    openPlanningSession,
    closePlanningSession,
    reset,
  };
}

export const navigationStore = createNavigationStore();
