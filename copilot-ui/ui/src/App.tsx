import { useEffect, useState } from 'react';
import TabShell from './components/TabShell';
import { useStoreValue } from './lib/store';
import { NAVIGATION_TABS, TabId } from './stores/navigation';
import { sdkHealthStore } from './stores/sdkHealthStore';
import CatalogView from './tabs/Catalog/CatalogView';
import PlanningView from './tabs/Planning/PlanningView';
import SessionsWorkspaceView from './tabs/Sessions/SessionsWorkspaceView';
import StateView from './tabs/State/StateView';

const environmentLabel = 'Instruction Engine UI';

export default function App() {
  const [activeTabId, setActiveTabId] = useState<TabId>('planning');
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
    <main aria-labelledby="instruction-engine-title" className="app-shell">
      <header className="hero-card">
        <p className="kicker">{environmentLabel}</p>
        <p className={`sdk-health-indicator sdk-health-${sdkHealthClassName}`}>
          SDK Health: {sdkHealthSummary}
        </p>
        <h1 id="instruction-engine-title">Instruction Engine Control Plane</h1>
        <p>
          Planning-first workspace for turning ideas into repo-targeted plans, managing assets,
          operating sessions, and checking system readiness without scattering the workflow across
          overlapping tabs.
        </p>
      </header>

      <TabShell
        activeTabId={activeTabId}
        tabs={NAVIGATION_TABS}
        tablistLabel="Instruction Engine sections"
        onTabChange={setActiveTabId}
      >
        {activeTabId === 'planning' ? <PlanningView onSdkSessionReady={() => setActiveTabId('sessions')} /> : null}
        {activeTabId === 'catalog' ? <CatalogView /> : null}
        {activeTabId === 'sessions' ? <SessionsWorkspaceView /> : null}
        {activeTabId === 'state' ? <StateView /> : null}
      </TabShell>
    </main>
  );
}
