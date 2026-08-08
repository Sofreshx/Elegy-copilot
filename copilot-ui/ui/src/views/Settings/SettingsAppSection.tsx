import { useEffect, useState } from 'react';
import Button from '../../components/Button';
import Panel from '../../components/Panel';
import { assetPath } from '../../lib/assetPath';
import { factoryReset, type FactoryResetResponse } from '../../lib/api/system';
import AppearanceSettings from './AppearanceSettings';
import CollaborationStyleSettingsView from './CollaborationStyleSettingsView';

const BRAND_ICON_SRC = assetPath('elegy-copilot-icon.svg');

interface AppInfo {
  version?: string;
  channel?: string;
  routeCount?: number;
}

export default function SettingsAppSection() {
  const [appInfo, setAppInfo] = useState<AppInfo>({});
  const [infoLoading, setInfoLoading] = useState(true);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetResult, setResetResult] = useState<FactoryResetResponse | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

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
        // App information is optional when the backend is unavailable.
      } finally {
        if (!cancelled) setInfoLoading(false);
      }
    }

    void loadInfo();
    return () => { cancelled = true; };
  }, []);

  const handleFactoryReset = async () => {
    setResetLoading(true);
    setResetResult(null);
    try {
      const result = await factoryReset();
      setResetResult(result);
    } catch (err) {
      setResetResult({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setResetLoading(false);
      setShowConfirm(false);
    }
  };

  return (
    <div className="settings-section">
      <AppearanceSettings />
      <CollaborationStyleSettingsView />

      <Panel title="Keyboard Shortcuts" subtitle="Navigation and actions" testId="settings-shortcuts">
        <dl className="settings-shortcuts-list">
          <dt><kbd>Ctrl+1</kbd> – <kbd>Ctrl+5</kbd></dt>
          <dd>Switch sidebar sections</dd>
          <dt><kbd>Ctrl+B</kbd></dt>
          <dd>Collapse or expand the sidebar</dd>
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

      <Panel title="Factory Reset" subtitle="Reset all integrated surfaces to defaults" testId="settings-factory-reset">
        <div className="settings-factory-reset">
          <p className="settings-factory-reset-desc">
            Resets OpenCode configuration to defaults. Native Codex configuration,
            installed assets, and workspace data remain untouched.
          </p>

          {!showConfirm ? (
            <Button
              variant="danger"
              size="sm"
              testId="factory-reset-start"
              disabled={resetLoading}
              onClick={() => setShowConfirm(true)}
            >
              {resetLoading ? 'Resetting...' : 'Factory Reset'}
            </Button>
          ) : (
            <div className="settings-factory-reset-confirm">
              <p className="settings-factory-reset-warning">
                This will reset all configuration. This cannot be undone.
              </p>
              <div className="settings-factory-reset-actions">
                <Button
                  variant="danger"
                  size="sm"
                  testId="factory-reset-confirm"
                  disabled={resetLoading}
                  onClick={handleFactoryReset}
                >
                  {resetLoading ? 'Resetting...' : 'Confirm Reset'}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  testId="factory-reset-cancel"
                  disabled={resetLoading}
                  onClick={() => setShowConfirm(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {resetResult && (
            <div className="settings-factory-reset-results" data-testid="factory-reset-results">
              {resetResult.error ? (
                <p className="opencode-error">{resetResult.error}</p>
              ) : resetResult.results ? (
                <ul className="settings-factory-reset-list">
                  {Object.entries(resetResult.results).map(([key, r]) => (
                    <li key={key} className={`settings-factory-reset-item settings-factory-reset-${r.status}`}>
                      <strong>{key}</strong>: {r.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}
