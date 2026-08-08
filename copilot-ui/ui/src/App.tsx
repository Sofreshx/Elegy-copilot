import { Suspense, useCallback, useEffect, lazy } from 'react';
import AppLayout from './components/AppLayout';
import PageContainer from './components/PageContainer';
import RouteLoading from './components/RouteLoading';
import Sidebar from './components/Sidebar';
import ToastContainer from './components/ToastContainer';
import { shallowEqual, useStoreSelector } from './lib/store';
import {
  navigationStore,
  SIDEBAR_NAV_ITEMS,
  type SidebarItemId,
} from './stores/navigation';
import { desktopUpdaterStore } from './stores/desktopUpdaterStore';
import { runtimeHealthStore } from './stores/runtimeHealthStore';
import { shellPreferencesStore } from './stores/shellPreferences';
import { overseerWorkStore } from './views/Overseer/overseerWorkStore';

const loadStandaloneGraphWindow = () => import('./tabs/Planning/StandaloneGraphWindow');
const loadSessionDetailView = () => import('./views/Sessions/SessionDetailView');
const loadSettingsView = () => import('./views/Settings/SettingsView');
const loadAssetCreationWizard = () => import('./views/Catalog/AssetCreationWizard');
const loadAddProjectWizard = () => import('./views/Project/AddProjectWizard');
const loadWorkspaceView = () => import('./views/Workspace/WorkspaceView');
const loadRepositoriesView = () => import('./views/Repositories/RepositoriesView');
const loadRepoOperationsView = () => import('./views/RepoOperations/RepoOperationsView');
const loadRemoteView = () => import('./tabs/Remote/RemoteView');
const loadMcpView = () => import('./tabs/Mcp/McpView');
const loadIntelligenceSurfaceView = () => import('./views/Intelligence/IntelligenceSurfaceView');
const loadOverseerShell = () => import('./views/Overseer/OverseerShell');
const loadWorkspaceNotesTab = () => import('./views/Workspace/WorkspaceNotesTab');

const StandaloneGraphWindow = lazy(loadStandaloneGraphWindow);
const SessionDetailView = lazy(loadSessionDetailView);
const SettingsView = lazy(loadSettingsView);
const AssetCreationWizard = lazy(loadAssetCreationWizard);
const AddProjectWizard = lazy(loadAddProjectWizard);
const WorkspaceView = lazy(loadWorkspaceView);
const RepositoriesView = lazy(loadRepositoriesView);
const RepoOperationsView = lazy(loadRepoOperationsView);
const RemoteView = lazy(loadRemoteView);
const McpView = lazy(loadMcpView);
const IntelligenceSurfaceView = lazy(loadIntelligenceSurfaceView);
const OverseerShell = lazy(loadOverseerShell);
const WorkspaceNotesTab = lazy(loadWorkspaceNotesTab);

const sidebarRouteLoaders: Partial<Record<SidebarItemId, () => Promise<unknown>>> = {
  workspace: loadWorkspaceView,
  remote: loadRemoteView,
  mcp: loadMcpView,
  repositories: loadRepositoriesView,
  'repo-operations': loadRepoOperationsView,
  notes: loadWorkspaceNotesTab,
  overseer: loadOverseerShell,
  'world-model': loadIntelligenceSurfaceView,
  settings: loadSettingsView,
};

function preloadSidebarRoute(id: SidebarItemId) {
  void sidebarRouteLoaders[id]?.().catch(() => {
    // Navigation still owns error handling if a prefetched chunk is unavailable.
  });
}
export default function App() {
  const navigationState = useStoreSelector(navigationStore, (state) => ({
    activeSidebarItem: state.activeSidebarItem,
    activeWorkspaceId: state.activeWorkspaceId,
    openWorkspaces: state.openWorkspaces,
    selectedSessionId: state.selectedSessionId,
    wizardOpen: state.wizardOpen,
  }), shallowEqual);
  const currentVersion = useStoreSelector(desktopUpdaterStore, (state) => state.currentVersion);
  const sidebarCollapsed = useStoreSelector(shellPreferencesStore, (state) => state.sidebarCollapsed);
  const overseerAttentionCount = useStoreSelector(overseerWorkStore, (state) => state.attentionCount);

  useEffect(() => {
    desktopUpdaterStore.startListening();
    runtimeHealthStore.startWatching();
    const stopThemeSync = shellPreferencesStore.startThemeSync();
    return () => {
      desktopUpdaterStore.stopListening();
      runtimeHealthStore.stopWatching();
      stopThemeSync();
    };
  }, []);

  const handleKeyboard = useCallback((e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (e.key === 'Escape') {
      if (navigationStore.getState().wizardOpen) {
        navigationStore.closeWizard();
        e.preventDefault();
      } else if (navigationStore.getState().selectedSessionId) {
        navigationStore.selectSession(null);
        e.preventDefault();
      } else if (navigationStore.getState().workspaceCenterMode === 'planning-session') {
        navigationStore.closePlanningSession();
        e.preventDefault();
      }
      return;
    }

    if (!e.ctrlKey && !e.metaKey) return;

    if (e.key.toLowerCase() === 'b') {
      e.preventDefault();
      shellPreferencesStore.toggleSidebar();
      return;
    }

    const digit = parseInt(e.key, 10);
    if (digit >= 1 && digit <= SIDEBAR_NAV_ITEMS.length) {
      e.preventDefault();
      navigationStore.navigate(SIDEBAR_NAV_ITEMS[digit - 1].id);
    }
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyboard);
    return () => window.removeEventListener('keydown', handleKeyboard);
  }, [handleKeyboard]);

  function renderContent() {
    if (navigationState.wizardOpen === 'project') {
      return <AddProjectWizard />;
    }
    if (navigationState.wizardOpen === 'asset') {
      return <AssetCreationWizard />;
    }

    if (navigationState.selectedSessionId) {
      return <SessionDetailView />;
    }

    switch (navigationState.activeSidebarItem) {
      case 'workspace':
        return navigationState.activeWorkspaceId
          ? <WorkspaceView />
          : <RepositoriesView />;
      case 'remote':
        return <RemoteView />;
      case 'mcp':
        return <McpView />;
      case 'overseer':
        return <OverseerShell />;
      case 'world-model':
        return <IntelligenceSurfaceView surfaceId="opportunity-world-model" />;
      case 'repositories':
        return <RepositoriesView />;
      case 'repo-operations':
        return <RepoOperationsView />;
      case 'notes':
        return (
          <div className="view-shell notes-view" data-testid="notes-view">
            <div className="view-scroll notes-scroll" data-testid="notes-scroll">
              <PageContainer>
                <WorkspaceNotesTab />
              </PageContainer>
            </div>
          </div>
        );
      case 'settings':
        return <SettingsView />;
      default:
        return <RepositoriesView />;
    }
  }

  // Standalone graph window via URL params
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const roadmapId = params.get('roadmapId');
    if (roadmapId) {
      return (
        <>
          <ToastContainer />
          <Suspense fallback={<RouteLoading label="Loading planning graph…" />}>
            <StandaloneGraphWindow />
          </Suspense>
        </>
      );
    }
  }

  return (
    <>
      <ToastContainer />
      <AppLayout
      appVersion={currentVersion}
      sidebar={
        <Sidebar
          items={SIDEBAR_NAV_ITEMS}
          activeItem={navigationState.activeSidebarItem}
          openWorkspaces={navigationState.openWorkspaces}
          activeWorkspaceId={navigationState.activeWorkspaceId}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => shellPreferencesStore.toggleSidebar()}
          onNavigate={(id: SidebarItemId) => navigationStore.navigate(id)}
          onPrefetchNavigate={preloadSidebarRoute}
          onFocusWorkspace={(repoPath) => navigationStore.focusWorkspace(repoPath)}
          onCloseWorkspace={(repoPath) => navigationStore.closeWorkspace(repoPath)}
          attentionCounts={{ overseer: overseerAttentionCount }}
        />
      }
    >
      <Suspense fallback={<RouteLoading />}>
        {renderContent()}
      </Suspense>
      </AppLayout>
    </>
  );
}
