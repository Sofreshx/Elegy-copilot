import { useEffect, useState } from 'react';
import { Badge, Button, Panel } from '../../components';
import { useStoreValue } from '../../lib/store';
import { codexProviderStore, type CodexProviderState } from '../../stores/codexProviderStore';

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  fontSize: '13px',
  border: '1px solid var(--border-color, #ccc)',
  borderRadius: '4px',
  background: 'var(--input-bg, #fff)',
  color: 'var(--text-color, #000)',
  fontFamily: 'monospace',
  boxSizing: 'border-box',
};

export default function CodexProviderPanel() {
  const state: CodexProviderState = useStoreValue(codexProviderStore);

  useEffect(() => {
    void codexProviderStore.load();
  }, []);

  const status = state.status;
  const activeMode = status?.activeMode || 'native';
  const dsStatus = state.deepseekStatus;

  const [bridgePath, setBridgePath] = useState(dsStatus?.bridgePath || '');
  const [bridgeConfigPath, setBridgeConfigPath] = useState(dsStatus?.bridgeConfigPath || '');
  const [apiKey, setApiKey] = useState('');
  const [bridgeUrl, setBridgeUrl] = useState(dsStatus?.bridgeUrl || 'http://127.0.0.1:38440/v1');

  useEffect(() => {
    if (dsStatus?.bridgePath) setBridgePath(dsStatus.bridgePath);
    if (dsStatus?.bridgeConfigPath) setBridgeConfigPath(dsStatus.bridgeConfigPath);
    if (dsStatus?.bridgeUrl) setBridgeUrl(dsStatus.bridgeUrl);
  }, [dsStatus?.bridgePath, dsStatus?.bridgeConfigPath, dsStatus?.bridgeUrl]);

  const currentModeLabel = activeMode === 'native'
    ? 'Native Codex'
    : activeMode === 'elegy-routed'
    ? 'Elegy Routed'
    : 'DeepSeek V4';

  const isDeepseekActive = activeMode === 'deepseek-bridge';
  const bridgeBinaryReady = !!dsStatus?.bridgeBinaryAvailable;
  const bridgeCheckoutReady = !!dsStatus?.bridgeCheckoutAvailable;
  const bridgeAvailable = bridgeBinaryReady || bridgeCheckoutReady;
  const keyReady = !!dsStatus?.keyConfigured;
  const bridgeReachable = !!dsStatus?.bridgeReachable;
  const prereqsMet = bridgeAvailable && keyReady && bridgeReachable;
  const showDeepSeekSection = activeMode !== 'elegy-routed';

  return (
    <Panel
      title="Codex Configuration"
      subtitle="Switch local Codex between native defaults, Elegy routing, and DeepSeek V4 via Moon Bridge"
      testId="settings-codex-provider"
      actions={
        <>
          <Button
            variant={activeMode === 'native' ? 'primary' : 'secondary'}
            size="sm"
            testId="codex-provider-native"
            disabled={state.loading || state.saving}
            onClick={() => codexProviderStore.setMode('native')}
          >
            {state.saving && activeMode !== 'native' ? 'Saving…' : 'Native Codex'}
          </Button>
          <Button
            variant={activeMode === 'elegy-routed' ? 'primary' : 'secondary'}
            size="sm"
            testId="codex-provider-elegy"
            disabled={state.loading || state.saving}
            onClick={() => codexProviderStore.setMode('elegy-routed')}
          >
            {state.saving && activeMode !== 'elegy-routed' ? 'Saving…' : 'Elegy Routed'}
          </Button>
          <Button
            variant={isDeepseekActive ? 'primary' : 'secondary'}
            size="sm"
            testId="codex-provider-deepseek"
            disabled={state.loading || state.saving}
            onClick={() => codexProviderStore.setMode('deepseek-bridge')}
          >
            {state.saving && activeMode !== 'deepseek-bridge' ? 'Saving…' : 'DeepSeek V4'}
          </Button>
        </>
      }
    >
      <div className="settings-row">
        <div className="settings-row-label">
          <strong>Current local default</strong>
          <span className="settings-row-description">
            This updates the shared Codex home config used by local Codex clients.
          </span>
        </div>
        <div className="settings-row-action">
          <Badge tone={activeMode === 'native' ? 'neutral' : activeMode === 'elegy-routed' ? 'accent' : 'brand'} testId="codex-provider-mode-badge">
            {currentModeLabel}
          </Badge>
        </div>
      </div>

      {status && (
        <div className="settings-row">
          <div className="settings-row-label">
            <span className="settings-row-description">
              Config: <code>{status.configPath}</code>
            </span>
            {status.gateway?.baseUrl ? (
              <span className="settings-row-description">
                Gateway: <code>{status.gateway.baseUrl}</code>
              </span>
            ) : null}
          </div>
          <div className="settings-row-action">
            {status.hasBackup ? <Badge tone="brand" testId="codex-provider-backup-badge">Backup Ready</Badge> : null}
          </div>
        </div>
      )}

      {showDeepSeekSection && (
        <>
          <hr style={{ margin: '12px 0', border: 'none', borderTop: '1px solid var(--border-color, #ddd)' }} />

          <div className="settings-row">
            <div className="settings-row-label">
              <strong>Moon Bridge Executable Path</strong>
              <span className="settings-row-description">
                Full path to the Moon Bridge binary or a checkout directory (Go 1.25+ required to build from checkout).
              </span>
            </div>
            <div className="settings-row-action" style={{ flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
              <input
                type="text"
                value={bridgePath}
                onChange={(e) => setBridgePath(e.target.value)}
                placeholder="C:\Users\...\moon-bridge.exe"
                style={inputStyle}
                data-testid="deepseek-bridge-path"
              />
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-label">
              <strong>Moon Bridge Config Path</strong>
              <span className="settings-row-description">
                Path to the Moon Bridge config.yml file.
              </span>
            </div>
            <div className="settings-row-action" style={{ flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
              <input
                type="text"
                value={bridgeConfigPath}
                onChange={(e) => setBridgeConfigPath(e.target.value)}
                placeholder="C:\Users\...\config.yml"
                style={inputStyle}
                data-testid="deepseek-bridge-config-path"
              />
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-label">
              <strong>Bridge URL</strong>
              <span className="settings-row-description">
                Moon Bridge loopback endpoint. Defaults to http://127.0.0.1:38440/v1.
              </span>
            </div>
            <div className="settings-row-action" style={{ flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
              <input
                type="text"
                value={bridgeUrl}
                onChange={(e) => setBridgeUrl(e.target.value)}
                placeholder="http://127.0.0.1:38440/v1"
                style={inputStyle}
                data-testid="deepseek-bridge-url"
              />
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-label">
              <strong>DeepSeek API Key</strong>
              <span className="settings-row-description">
                Saved to the Moon Bridge config only. Key is never returned by the API after saving.
              </span>
            </div>
            <div className="settings-row-action" style={{ flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                style={inputStyle}
                data-testid="deepseek-api-key"
              />
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-label">
              <strong>Save Settings</strong>
              <span className="settings-row-description">
                Saves bridge paths, URL, and API key (to Moon Bridge config only).
              </span>
            </div>
            <div className="settings-row-action">
              <Button
                variant="primary"
                size="sm"
                testId="deepseek-save-settings"
                disabled={state.saving}
                onClick={() => codexProviderStore.saveDeepseek({
                  bridgePath: bridgePath || undefined,
                  bridgeConfigPath: bridgeConfigPath || undefined,
                  bridgeUrl: bridgeUrl || undefined,
                  keyConfigured: apiKey.length > 0 ? true : undefined,
                  apiKey: apiKey || undefined,
                })}
              >
                {state.saving ? 'Saving…' : 'Save Settings'}
              </Button>
            </div>
          </div>

          {!bridgeBinaryReady && !bridgeCheckoutReady && (
            <div className="settings-row">
              <div className="settings-row-label">
                <strong>Install Moon Bridge</strong>
                <span className="settings-row-description">
                  Moon Bridge is not installed. <strong>Option 1:</strong> Download a release from the Moon Bridge GitHub releases page. <strong>Option 2:</strong> Clone the repo and run <code>go build</code> (Go 1.25+ required), then provide the path to the binary or checkout directory.
                </span>
              </div>
            </div>
          )}

          {bridgeCheckoutReady && !bridgeBinaryReady && (
            <div className="settings-row">
              <div className="settings-row-label">
                <span className="settings-row-description" style={{ color: 'var(--warning-color, #b45309)' }}>
                  The configured path is a directory. Build the binary first with <code>go build</code>, then update the path to the built executable.
                </span>
              </div>
            </div>
          )}

          <div className="settings-row">
            <div className="settings-row-label">
              <strong>Bridge Control</strong>
              <span className="settings-row-description">
                Start or stop the Moon Bridge process. Check status to verify connectivity and model availability.
              </span>
            </div>
            <div className="settings-row-action">
              <Button
                variant="secondary"
                size="sm"
                testId="deepseek-start-bridge"
                disabled={state.bridgeLoading}
                onClick={() => codexProviderStore.startBridge()}
              >
                {state.bridgeLoading ? '…' : 'Start Bridge'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                testId="deepseek-stop-bridge"
                disabled={state.bridgeLoading}
                onClick={() => codexProviderStore.stopBridge()}
              >
                Stop Bridge
              </Button>
              <Button
                variant="secondary"
                size="sm"
                testId="deepseek-check-status"
                disabled={state.bridgeLoading}
                onClick={() => codexProviderStore.checkBridge()}
              >
                Check Status
              </Button>
            </div>
          </div>

          {dsStatus && (
            <div className="settings-row">
              <div className="settings-row-label">
                <span className="settings-row-description">
                  Bridge path: {dsStatus.bridgePath
                    ? <Badge tone={bridgeBinaryReady ? 'success' : bridgeCheckoutReady ? 'brand' : 'danger'}>{bridgeBinaryReady ? 'Binary found' : bridgeCheckoutReady ? 'Needs build' : 'Missing'}</Badge>
                    : <Badge tone="neutral">Not set</Badge>}
                </span>
                <span className="settings-row-description">
                  Key configured: <Badge tone={keyReady ? 'success' : 'neutral'}>{keyReady ? 'Yes' : 'No'}</Badge>
                </span>
                <span className="settings-row-description">
                  Env var (MOON_BRIDGE_DEEPSEEK_TOKEN): <Badge tone={dsStatus.envKeyConfigured ? 'success' : 'neutral'}>{dsStatus.envKeyConfigured ? 'Set' : 'Not set'}</Badge>
                </span>
                <span className="settings-row-description">
                  Bridge running: <Badge tone={dsStatus.bridgeRunning ? 'success' : 'neutral'}>{dsStatus.bridgeRunning ? 'Running' : 'Stopped'}</Badge>
                </span>
                <span className="settings-row-description">
                  Bridge reachable: <Badge tone={bridgeReachable ? 'success' : 'danger'}>{bridgeReachable ? 'Yes' : 'No'}</Badge>
                </span>
                <span className="settings-row-description">
                  Models visible: <Badge tone={dsStatus.modelsVisible ? 'success' : 'danger'}>{dsStatus.modelsVisible ? 'Yes' : 'No'}</Badge>
                </span>
                {dsStatus.probeError ? (
                  <span className="settings-row-description" style={{ color: 'var(--danger-color, #c00)' }}>
                    {dsStatus.probeError}
                  </span>
                ) : null}
              </div>
            </div>
          )}

          {!isDeepseekActive && (
            <div className="settings-row">
              <div className="settings-row-label">
                <strong>Prerequisites</strong>
                <span className="settings-row-description">
                  {bridgeAvailable ? '\u2705' : '\u274C'} Moon Bridge binary or checkout available
                </span>
                <span className="settings-row-description">
                  {keyReady ? '\u2705' : '\u274C'} DeepSeek API key configured
                </span>
                <span className="settings-row-description">
                  {bridgeReachable ? '\u2705' : '\u274C'} Bridge endpoint reachable
                </span>
                {!prereqsMet && (
                  <span className="settings-row-description">
                    Save settings, start the bridge, and ensure it is reachable before activating.
                  </span>
                )}
              </div>
              <div className="settings-row-action">
                <Button
                  variant="primary"
                  size="sm"
                  testId="deepseek-activate"
                  disabled={state.saving || !prereqsMet}
                  onClick={() => codexProviderStore.setMode('deepseek-bridge')}
                >
                  {state.saving ? 'Activating…' : 'Activate DeepSeek in Codex'}
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <hr style={{ margin: '12px 0', border: 'none', borderTop: '1px solid var(--border-color, #ddd)' }} />

      <div className="settings-row">
        <div className="settings-row-label">
          <strong>Recovery</strong>
          <span className="settings-row-description">
            Soft reset removes only Elegy-managed provider settings. Hard restore writes back the pre-Elegy backup snapshot.
          </span>
        </div>
        <div className="settings-row-action">
          <Button
            variant="secondary"
            size="sm"
            testId="codex-provider-soft-reset"
            disabled={state.loading || state.saving}
            onClick={() => codexProviderStore.reset(false)}
          >
            Soft Reset
          </Button>
          <Button
            variant="ghost"
            size="sm"
            testId="codex-provider-hard-reset"
            disabled={state.loading || state.saving || !status?.hasBackup}
            onClick={() => codexProviderStore.reset(true)}
          >
            Hard Restore
          </Button>
        </div>
      </div>

      {state.message ? (
        <p className="settings-row-description" data-testid="codex-provider-message">
          {state.message}
        </p>
      ) : null}

      {state.error ? (
        <p className="settings-row-error" data-testid="codex-provider-error">
          {state.error}
        </p>
      ) : null}

      <div className="settings-row">
        <div className="settings-row-label">
          <span className="settings-row-description">
            Existing open Codex windows may need a new thread or restart before provider changes are reflected.
          </span>
        </div>
      </div>
    </Panel>
  );
}
