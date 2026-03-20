import { useEffect } from 'react';
import TabShell from './components/TabShell';
import { useStoreValue } from './lib/store';
import { navigationStore, NAVIGATION_TABS } from './stores/navigation';
import { sdkHealthStore } from './stores/sdkHealthStore';
import CatalogView from './tabs/Catalog/CatalogView';
import HomeRuntimeView from './tabs/HomeRuntime/HomeRuntimeView';
import PlanningView from './tabs/Planning/PlanningView';

const environmentLabel = 'Elegy Copilot UI';

export default function App() {
  const navigationState = useStoreValue(navigationStore);
  const sdkHealthState = useStoreValue(sdkHealthStore);

  useEffect(() => {
    sdkHealthStore.startPolling();
    return () => {
      sdkHealthStore.stopPolling();
    };
  }, []);

  const sdkHealthClassName = sdkHealthState.error
    ? 'error'
    : sdkHealthState.health?.connected
      ? 'ok'
      : sdkHealthState.loading
        ? 'loading'
        : 'warn';

  const sdkHealthSummary = sdkHealthState.error
    ? sdkHealthState.error
    : sdkHealthState.health
      ? `${sdkHealthState.health.state}${Number.isFinite(sdkHealthState.health.sessionCount)
        ? `, sessions=${sdkHealthState.health.sessionCount}`
        : ''}`
      : 'awaiting first poll';

  return (
    <main aria-labelledby="elegy-copilot-title" className="app-shell">
      <header className="hero-card">
        <p className="kicker">{environmentLabel}</p>
        <p className={`sdk-health-indicator sdk-health-${sdkHealthClassName}`}>
          SDK Health: {sdkHealthSummary}
        </p>
        <h1 id="elegy-copilot-title">Elegy Copilot Control Plane</h1>
        <p>
          Planning-first workspace for turning ideas into repo-targeted plans, managing assets,
          operating sessions, and checking system readiness without scattering the workflow across
          overlapping tabs.
        </p>
      </header>

      <TabShell
        activeTabId={navigationState.activeTabId}
        tabs={NAVIGATION_TABS}
        tablistLabel="Elegy Copilot sections"
        onTabChange={(tabId) => navigationStore.setActiveTabId(tabId)}
      >
        {navigationState.activeTabId === 'home-runtime' ? <HomeRuntimeView /> : null}
        {navigationState.activeTabId === 'catalog' ? <CatalogView /> : null}
        {navigationState.activeTabId === 'planning' ? (
          <PlanningView onSdkSessionReady={() => {
            navigationStore.goToRuntime('sessions', { sessionsMode: 'sdk' });
          }} />
        ) : null}
      </TabShell>
    </main>
  );
}
