import { useEffect, useState } from 'react';
import { Button, Toolbar } from '../../components';
import { useStoreValue } from '../../lib/store';
import { navigationStore, type SettingsSection } from '../../stores/navigation';
import CodexProviderPanel from './CodexProviderPanel';
import CatalogShellView from '../Catalog/CatalogShellView';
import OpenCodeView from '../../tabs/OpenCode/OpenCodeView';
import MaintenanceView from '../Maintenance/MaintenanceView';
import DashboardView from '../DashboardView';
import ClaudeCodeView from '../../tabs/ClaudeCode/ClaudeCodeView';
import { Panel } from '../../components';

const BRAND_ICON_SRC = '/elegy-copilot-icon.svg';

interface AppInfo {
  version?: string;
  channel?: string;
  routeCount?: number;
}

const SETTINGS_SECTIONS: Array<{ id: SettingsSection; label: string; icon: string }> = [
  { id: 'app', label: 'App Settings', icon: '⚙' },
  { id: 'catalog', label: 'Catalog & Assets', icon: '▤' },
  { id: 'opencode', label: 'OpenCode Setup', icon: '⊞' },
  { id: 'maintenance', label: 'Maintenance', icon: '⚙' },
  { id: 'runtime', label: 'Runtime', icon: '▶' },
  { id: 'codex', label: 'Codex Providers', icon: '◈' },
  { id: 'claude-code', label: 'Claude Code Setup', icon: '◈' },
];

export default function SettingsView() {
  const navState = useStoreValue(navigationStore);
  const [appInfo, setAppInfo] = useState<AppInfo>({});
  const [infoLoading, setInfoLoading] = useState(true);
  const activeSection = navState.settingsSection;

  useEffect(() => {
    let cancelled = false;

    async function loadInfo() {
      try {
        const res = await fetch('/api/health');
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) {
            setAppInfo({
              version: data.version,
              channel: data.channel,
              routeCount: data.routeCount,
            });
          }
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setInfoLoading(false);
      }
    }

    void loadInfo();
    return () => { cancelled = true; };
  }, []);

  function handleBack() {
    navigationStore.navigate('workspace');
  }

  function renderSection() {
    switch (activeSection) {
      case 'catalog':
        return <CatalogShellView />;
      case 'opencode':
        return <OpenCodeView />;
      case 'maintenance':
        return <MaintenanceView />;
      case 'runtime':
        return <DashboardView />;
      case 'codex':
        return <CodexProviderPanel />;
      case 'claude-code':
        return <ClaudeCodeView />;
      case 'app':
      default:
        return <SettingsAppSection appInfo={appInfo} infoLoading={infoLoading} />;
    }
  }

  return (
    <div className="settings-view" data-testid="settings-view">
      <Toolbar testId="settings-toolbar">
        <Button variant="ghost" size="sm" onClick={handleBack} testId="settings-back" aria-label="Back" title="Back">
          ←
        </Button>
        <h2>Settings</h2>
      </Toolbar>

      <div className="settings-layout">
        <nav className="settings-nav" data-testid="settings-nav">
          {SETTINGS_SECTIONS.map((section) => (
            <button
              key={section.id}
              className={`settings-nav-item${activeSection === section.id ? ' settings-nav-item-active' : ''}`}
              onClick={() => navigationStore.setSettingsSection(section.id)}
              data-testid={`settings-nav-${section.id}`}
              type="button"
            >
              <span className="settings-nav-icon" aria-hidden="true">{section.icon}</span>
              <span className="settings-nav-label">{section.label}</span>
            </button>
          ))}
        </nav>

        <div className="settings-content" data-testid="settings-content">
          {renderSection()}
        </div>
      </div>
    </div>
  );
}

function SettingsAppSection({ appInfo, infoLoading }: { appInfo: AppInfo; infoLoading: boolean }) {
  return (
    <div className="settings-section">
      <Panel title="Keyboard Shortcuts" subtitle="Navigation and actions" testId="settings-shortcuts">
        <dl className="settings-shortcuts-list">
          <dt><kbd>Ctrl+1</kbd> – <kbd>Ctrl+3</kbd></dt>
          <dd>Switch sidebar sections</dd>
          <dt><kbd>Escape</kbd></dt>
          <dd>Back from detail view</dd>
        </dl>
      </Panel>

      <Panel title="About" subtitle="Application information" testId="settings-about">
        {infoLoading ? (
          <p className="settings-about-loading">Loading...</p>
        ) : (
          <>
            <div className="settings-about-brand">
              <img
                alt=""
                aria-hidden="true"
                className="settings-about-icon"
                src={BRAND_ICON_SRC}
              />
              <div className="settings-about-copy-block">
                <p className="settings-about-name">Elegy Copilot</p>
                <p className="settings-about-copy">
                  Desktop workspace for sessions, planning, catalog, and maintenance.
                </p>
              </div>
            </div>
            <dl className="settings-about-list">
              {appInfo.version && (
                <>
                  <dt>Version</dt>
                  <dd data-testid="settings-about-version">{appInfo.version}</dd>
                </>
              )}
              {appInfo.channel && (
                <>
                  <dt>Channel</dt>
                  <dd data-testid="settings-about-channel">{appInfo.channel}</dd>
                </>
              )}
              {appInfo.routeCount != null && (
                <>
                  <dt>API Routes</dt>
                  <dd data-testid="settings-about-routes">{appInfo.routeCount}</dd>
                </>
              )}
            </dl>
          </>
        )}
      </Panel>
    </div>
  );
}
