import { useCallback, useEffect } from 'react';
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
import StandaloneGraphWindow from './tabs/Planning/StandaloneGraphWindow';
import SessionDetailView from './views/Sessions/SessionDetailView';
import SettingsView from './views/Settings/SettingsView';
import LexiconView from './tabs/Lexicon/LexiconView';
import AssetCreationWizard from './views/Catalog/AssetCreationWizard';
import AddProjectWizard from './views/Project/AddProjectWizard';
import WorkspaceView from './views/Workspace/WorkspaceView';
import RepositoriesView from './views/Repositories/RepositoriesView';
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
      case 'lexicon':
        return <LexiconView />;
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
          <StandaloneGraphWindow />
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
      {renderContent()}
      </AppLayout>
    </>
  );
}
