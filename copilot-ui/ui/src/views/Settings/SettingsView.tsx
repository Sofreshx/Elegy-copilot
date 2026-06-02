import { useEffect, useState } from 'react';
import { Panel, Toolbar } from '../../components';
import { SIDEBAR_NAV_ITEMS } from '../../stores/navigation';
import CodexProviderPanel from './CodexProviderPanel';

const BRAND_ICON_SRC = '/elegy-copilot-icon.svg';

interface AppInfo {
  version?: string;
  channel?: string;
  routeCount?: number;
}

export default function SettingsView() {
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
        <CodexProviderPanel />

        <Panel title="Keyboard Shortcuts" subtitle="Navigation and actions" testId="settings-shortcuts">
          <dl className="settings-shortcuts-list">
            <dt><kbd>Ctrl+1</kbd> – <kbd>Ctrl+{SIDEBAR_NAV_ITEMS.length}</kbd></dt>
            <dd>Switch sidebar sections</dd>
            <dt><kbd>Escape</kbd></dt>
            <dd>Back from detail view</dd>
          </dl>
        </Panel>

        <Panel title="About" subtitle="Application information" testId="settings-about">
          {infoLoading ? (
            <p className="settings-about-loading">Loading…</p>
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
    </div>
  );
}
