import { createStore } from '../lib/store';

export const CATALOG_SECTION_IDS = [
  'status',
  'global',
  'repository',
] as const;

export type CatalogSectionId = (typeof CATALOG_SECTION_IDS)[number];

export const SIDEBAR_IDS = [
  'dashboard',
  'projects',
  'catalog',
  'planning',
  'maintenance',
  'settings',
] as const;

export type SidebarItemId = (typeof SIDEBAR_IDS)[number];

export type ProjectSubView = 'overview' | 'sessions' | 'tasks' | 'git' | 'config';
export type SessionDetailTab = 'activity' | 'tasks' | 'artifacts' | 'config' | 'git' | 'usage';
export type MaintenanceSection = 'updates' | 'sandboxes' | 'diagnostics';
export type WizardType = 'project' | 'asset' | null;

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
  { id: 'dashboard', label: 'Runtime', icon: '▶', description: 'Active sessions, runtime output, and quick launch' },
  { id: 'projects', label: 'Projects', icon: '◆', description: 'Registered repositories and project views' },
  { id: 'catalog', label: 'Catalog', icon: '▤', description: 'Asset workspace, installs, and skill discovery' },
  { id: 'planning', label: 'Planning', icon: '☑', description: 'Live roadmaps, durable task boards, and transfer per repository' },
  { id: 'maintenance', label: 'Maintenance', icon: '⚙', description: 'Updates, sandboxes, diagnostics' },
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
};

const INITIAL_STATE: NavigationState = {
  catalogSectionId: 'global',
  activeSidebarItem: 'dashboard',
  selectedProjectId: null,
  projectSubView: 'overview',
  selectedSessionId: null,
  selectedSessionContext: null,
  sessionDetailTab: 'activity',
  maintenanceSection: 'updates',
  wizardOpen: null,
};

function createNavigationStore() {
  const store = createStore<NavigationState>(INITIAL_STATE);

  function setCatalogSectionId(catalogSectionId: CatalogSectionId): void {
    store.setState((state) => ({
      ...state,
      activeSidebarItem: 'catalog',
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
      activeSidebarItem: 'maintenance',
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
    reset,
  };
}

export const navigationStore = createNavigationStore();
