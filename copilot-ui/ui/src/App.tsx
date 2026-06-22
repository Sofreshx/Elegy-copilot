import { Suspense, useCallback, useEffect, lazy } from 'react';
import AppLayout from './components/AppLayout';
import Sidebar from './components/Sidebar';
import ToastContainer from './components/ToastContainer';
import { useStoreValue } from './lib/store';
import {
  navigationStore,
  SIDEBAR_NAV_ITEMS,
  type SidebarItemId,
} from './stores/navigation';
import { desktopUpdaterStore } from './stores/desktopUpdaterStore';
import { runtimeHealthStore } from './stores/runtimeHealthStore';
import { toolingUpdatesStore } from './stores/toolingUpdatesStore';
import WorkspaceFloatingCard from './components/WorkspaceFloatingCard';

const StandaloneGraphWindow = lazy(() => import('./tabs/Planning/StandaloneGraphWindow'));
const SessionDetailView = lazy(() => import('./views/Sessions/SessionDetailView'));
const SettingsView = lazy(() => import('./views/Settings/SettingsView'));
const PatternAtlasView = lazy(() => import('./tabs/PatternAtlas/PatternAtlasView'));
const AssetCreationWizard = lazy(() => import('./views/Catalog/AssetCreationWizard'));
const AddProjectWizard = lazy(() => import('./views/Project/AddProjectWizard'));
const WorkspaceView = lazy(() => import('./views/Workspace/WorkspaceView'));
const RepositoriesView = lazy(() => import('./views/Repositories/RepositoriesView'));
const RemoteView = lazy(() => import('./tabs/Remote/RemoteView'));
export default function App() {
  const navigationState = useStoreValue(navigationStore);
  const desktopUpdaterState = useStoreValue(desktopUpdaterStore);

  useEffect(() => {
    desktopUpdaterStore.startListening();
    runtimeHealthStore.startWatching();
    toolingUpdatesStore.startPolling();
    return () => {
      desktopUpdaterStore.stopListening();
      runtimeHealthStore.stopWatching();
      toolingUpdatesStore.stopPolling();
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
      case 'pattern-atlas':
        return <PatternAtlasView />;
      case 'repositories':
        return <RepositoriesView />;
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
          <Suspense>
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
      appVersion={desktopUpdaterState.currentVersion}
      sidebar={
        <Sidebar
          items={SIDEBAR_NAV_ITEMS}
          activeItem={navigationState.activeSidebarItem}
          onNavigate={(id: SidebarItemId) => navigationStore.navigate(id)}
        />
      }
    >
      <Suspense>
        {renderContent()}
      </Suspense>
      <WorkspaceFloatingCard />
      </AppLayout>
    </>
  );
}
