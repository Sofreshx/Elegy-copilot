import { useEffect, useState } from 'react';
import { Badge, Button, Panel, Toolbar } from '../../components';
import { useStoreValue } from '../../lib/store';
import { navigationStore } from '../../stores/navigation';

interface AppInfo {
  version?: string;
  channel?: string;
  routeCount?: number;
}

export default function SettingsView() {
  const navigationState = useStoreValue(navigationStore);
  const [appInfo, setAppInfo] = useState<AppInfo>({});
  const [infoLoading, setInfoLoading] = useState(true);

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

  return (
    <div className="settings-view" data-testid="settings-view">
      <Toolbar testId="settings-toolbar">
        <h2>Settings</h2>
      </Toolbar>

      <div className="settings-content">
        <Panel title="Display" subtitle="UI preferences" testId="settings-display">
          <div className="settings-row">
            <div className="settings-row-label">
              <strong>Admin Mode</strong>
              <span className="settings-row-description">
                Show diagnostic detail, raw JSON, and internal state across all views
              </span>
            </div>
            <div className="settings-row-action">
              <Button
                variant={navigationState.adminMode ? 'primary' : 'secondary'}
                size="sm"
                testId="settings-admin-toggle"
                onClick={() => navigationStore.toggleAdmin()}
              >
                {navigationState.adminMode ? 'On' : 'Off'}
              </Button>
              {navigationState.adminMode && (
                <Badge tone="accent" testId="settings-admin-badge">Active</Badge>
              )}
            </div>
          </div>
        </Panel>

        <Panel title="Keyboard Shortcuts" subtitle="Navigation and actions" testId="settings-shortcuts">
          <dl className="settings-shortcuts-list">
            <dt><kbd>Ctrl+N</kbd></dt>
            <dd>New session wizard</dd>
            <dt><kbd>Ctrl+1</kbd> – <kbd>Ctrl+7</kbd></dt>
            <dd>Switch sidebar sections</dd>
            <dt><kbd>Escape</kbd></dt>
            <dd>Close wizard / back from detail view</dd>
          </dl>
        </Panel>

        <Panel title="About" subtitle="Application information" testId="settings-about">
          {infoLoading ? (
            <p className="settings-about-loading">Loading…</p>
          ) : (
            <dl className="settings-about-list">
              <dt>App</dt>
              <dd>Elegy Copilot</dd>
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
          )}
        </Panel>
      </div>
    </div>
  );
}
