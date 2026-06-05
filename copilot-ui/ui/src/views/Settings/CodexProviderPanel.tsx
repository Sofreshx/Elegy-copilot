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

const stepNumberStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 22,
  height: 22,
  borderRadius: '50%',
  background: 'var(--accent, #6c5ce7)',
  color: '#fff',
  fontSize: '12px',
  fontWeight: 700,
  marginRight: 8,
  flexShrink: 0,
};

export default function CodexProviderPanel() {
  const state: CodexProviderState = useStoreValue(codexProviderStore);

  useEffect(() => {
    void codexProviderStore.load();
  }, []);

  const status = state.status;
  const activeMode = status?.activeMode || 'native';
  const dsStatus = state.deepseekStatus;
  const bsStatus = state.bootstrapStatus;

  const [bridgePath, setBridgePath] = useState(dsStatus?.bridgePath || '');
  const [bridgeConfigPath, setBridgeConfigPath] = useState(dsStatus?.bridgeConfigPath || '');
  const [apiKey, setApiKey] = useState('');
  const [bridgeUrl, setBridgeUrl] = useState(dsStatus?.bridgeUrl || 'http://127.0.0.1:38440/v1');
  const [advancedOpen, setAdvancedOpen] = useState(false);

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
  const bridgeBinaryReady = !!dsStatus?.bridgeBinaryAvailable || bsStatus?.built === true;
  const bridgeCheckoutReady = !!dsStatus?.bridgeCheckoutAvailable;
  const bridgeAvailable = bridgeBinaryReady || bridgeCheckoutReady;
  const keyReady = !!dsStatus?.keyConfigured;
  const bridgeReachable = !!dsStatus?.bridgeReachable;
  const bridgeRunning = !!dsStatus?.bridgeRunning;
  const prereqsMet = bridgeAvailable && keyReady && bridgeRunning && bridgeReachable;
  const showDeepSeekSection = activeMode !== 'elegy-routed';

  const bootstrapInstalled = bsStatus?.installed === true;
  const bootstrapBuilt = bsStatus?.built === true;
  const bootstrapPrereqsMet = bsStatus?.gitAvailable === true && bsStatus?.goAvailable === true;

  const handleBootstrap = () => {
    void codexProviderStore.bootstrap().then(() => {
      void codexProviderStore.fetchBootstrapStatus();
    });
  };

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
      {/* Current mode badge + config info */}
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

      {/* ---- Guided DeepSeek Setup (only when not Elegy Routed) ---- */}
      {showDeepSeekSection && (
        <>
          <hr style={{ margin: '12px 0', border: 'none', borderTop: '1px solid var(--border-color, #ddd)' }} />

          {/* Step 1: Install / Build Moon Bridge */}
          <div className="settings-row" data-testid="deepseek-bootstrap-status">
            <div className="settings-row-label">
              <strong>
                <span style={stepNumberStyle}>1</span>
                Install Moon Bridge
              </strong>
              <div className="settings-row-description" style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4, marginLeft: 30 }}>
                <span>
                  <Badge tone={bootstrapPrereqsMet ? 'success' : 'danger'}>
                    Prerequisites{bootstrapPrereqsMet ? '' : ' missing'}
                  </Badge>
                  {bsStatus ? (
                    <span style={{ marginLeft: 8 }}>
                      Git: {bsStatus.gitAvailable ? '✓' : '✗'} · Go: {bsStatus.goAvailable ? '✓' : '✗'}
                    </span>
                  ) : null}
                </span>
                {bsStatus && (
                  <>
                    <span>
                      <Badge tone={bootstrapInstalled ? 'success' : 'neutral'}>
                        {bootstrapInstalled ? 'Cloned' : 'Not cloned'}
                      </Badge>
                      {bootstrapInstalled && (
                        <code style={{ marginLeft: 8, fontSize: '0.72rem' }}>{bsStatus.installRoot}</code>
                      )}
                    </span>
                    <span>
                      <Badge tone={bootstrapBuilt ? 'success' : 'neutral'}>
                        {bootstrapBuilt ? 'Built' : 'Not built'}
                      </Badge>
                      {bootstrapBuilt && (
                        <code style={{ marginLeft: 8, fontSize: '0.72rem' }}>{bsStatus.binaryPath}</code>
                      )}
                    </span>
                    {bsStatus.lastBootstrapAt && (
                      <span style={{ fontSize: '0.75rem', color: 'var(--fg-muted, #666)' }}>
                        Last bootstrap: {new Date(bsStatus.lastBootstrapAt).toLocaleString()}
                      </span>
                    )}
                    {bsStatus.lastError && (
                      <span style={{ color: 'var(--color-danger-500, #c00)', fontSize: '0.75rem' }}>
                        {bsStatus.lastError}
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>
            <div className="settings-row-action">
              <Button
                variant="primary"
                size="sm"
                testId="deepseek-bootstrap-install"
                disabled={state.bootstrapLoading || !bootstrapPrereqsMet}
                onClick={handleBootstrap}
              >
                {state.bootstrapLoading
                  ? 'Installing…'
                  : bootstrapBuilt
                    ? 'Rebuild Moon Bridge'
                    : 'Install Moon Bridge'}
              </Button>
            </div>
          </div>

          {/* Step 2: Add DeepSeek API Key (primary path, not hidden in Advanced) */}
          <div className="settings-row">
            <div className="settings-row-label">
              <strong>
                <span style={stepNumberStyle}>2</span>
                Add DeepSeek API Key
              </strong>
              <span className="settings-row-description" style={{ marginLeft: 30 }}>
                Saved to the managed Moon Bridge config. Key is never returned by the API after saving.
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
              <Badge tone={keyReady ? 'success' : 'neutral'} testId="deepseek-key-status">
                {keyReady ? 'Key saved' : 'No key'}
              </Badge>
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-label" />
            <div className="settings-row-action">
              <Button
                variant="primary"
                size="sm"
                testId="deepseek-save-settings"
                disabled={state.saving || apiKey.length === 0}
                onClick={() => codexProviderStore.saveDeepseek({
                  keyConfigured: true,
                  apiKey: apiKey,
                })}
              >
                {state.saving ? 'Saving…' : 'Save API Key'}
              </Button>
            </div>
          </div>

          {/* Step 3: Start and Verify Bridge */}
          <div className="settings-row">
            <div className="settings-row-label">
              <strong>
                <span style={stepNumberStyle}>3</span>
                Start and Verify Bridge
              </strong>
              <span className="settings-row-description" style={{ marginLeft: 30 }}>
                Start the Moon Bridge process and check connectivity and model availability.
              </span>
              {dsStatus && (
                <div className="settings-row-description" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4, marginLeft: 30 }}>
                  <span>
                    Bridge running: <Badge tone={dsStatus.bridgeRunning ? 'success' : 'neutral'}>{dsStatus.bridgeRunning ? 'Running' : 'Stopped'}</Badge>
                  </span>
                  <span>
                    Reachable: <Badge tone={bridgeReachable ? 'success' : 'danger'}>{bridgeReachable ? 'Yes' : 'No'}</Badge>
                  </span>
                  <span>
                    Models visible: <Badge tone={dsStatus.modelsVisible ? 'success' : 'danger'}>{dsStatus.modelsVisible ? 'Yes' : 'No'}</Badge>
                  </span>
                  {dsStatus.probeError ? (
                    <span style={{ color: 'var(--danger-color, #c00)', fontSize: '0.75rem', width: '100%' }}>
                      {dsStatus.probeError}
                    </span>
                  ) : null}
                </div>
              )}
            </div>
            <div className="settings-row-action" style={{ display: 'flex', gap: 4 }}>
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

          {/* Step 4: Activate DeepSeek in Codex */}
          <div className="settings-row">
            <div className="settings-row-label">
              <strong>
                <span style={stepNumberStyle}>4</span>
                Activate DeepSeek in Codex
              </strong>
              <div className="settings-row-description" style={{ marginLeft: 30, marginTop: 4 }}>
                <span>
                  {bridgeAvailable ? '\u2705' : '\u274C'} Moon Bridge binary or checkout available
                </span>
                <br />
                <span>
                  {keyReady ? '\u2705' : '\u274C'} DeepSeek API key configured
                </span>
                <br />
                <span>
                  {dsStatus?.bridgeRunning ? '\u2705' : '\u274C'} Bridge process running
                </span>
                <br />
                <span>
                  {bridgeReachable ? '\u2705' : '\u274C'} Bridge endpoint reachable
                </span>
                {!prereqsMet && (
                  <span style={{ display: 'block', marginTop: 4 }}>
                    Complete steps 1-3 before activating. Ensure the bridge is built, key is saved, and bridge is running.
                  </span>
                )}
              </div>
            </div>
            <div className="settings-row-action">
              {isDeepseekActive ? (
                <Badge tone="success" testId="deepseek-active-badge">Active</Badge>
              ) : (
                <Button
                  variant="primary"
                  size="sm"
                  testId="deepseek-activate"
                  disabled={state.saving || !prereqsMet}
                  onClick={() => codexProviderStore.setMode('deepseek-bridge')}
                >
                  {state.saving ? 'Activating…' : 'Activate DeepSeek in Codex'}
                </Button>
              )}
            </div>
          </div>

          {/* Advanced: manual paths, URL, recovery/reset, raw diagnostics (collapsed) */}
          <hr style={{ margin: '12px 0', border: 'none', borderTop: '1px solid var(--border-color, #ddd)' }} />

          <div className="settings-row">
            <div className="settings-row-label">
              <strong>
                <button
                  type="button"
                  onClick={() => setAdvancedOpen(!advancedOpen)}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--accent, inherit)',
                    font: 'inherit',
                    padding: 0,
                    textDecoration: 'underline',
                  }}
                  data-testid="deepseek-advanced-toggle"
                >
                  {advancedOpen ? '▾' : '▸'} Advanced
                </button>
              </strong>
              <span className="settings-row-description">
                Manual bridge paths, URL overrides, recovery, and raw diagnostics.
              </span>
            </div>
          </div>

          {advancedOpen && (
            <>
              <div className="settings-row">
                <div className="settings-row-label">
                  <strong>Moon Bridge Executable Path</strong>
                  <span className="settings-row-description">
                    Full path to the Moon Bridge binary or a checkout directory. Leave empty for managed install.
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
                    Path to the Moon Bridge config.yml file. Leave empty for managed install.
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
                  <strong>Save Manual Settings</strong>
                  <span className="settings-row-description">
                    Saves manual bridge paths and URL overrides.
                  </span>
                </div>
                <div className="settings-row-action">
                  <Button
                    variant="secondary"
                    size="sm"
                    testId="deepseek-save-advanced"
                    disabled={state.saving}
                    onClick={() => codexProviderStore.saveDeepseek({
                      bridgePath: bridgePath || undefined,
                      bridgeConfigPath: bridgeConfigPath || undefined,
                      bridgeUrl: bridgeUrl || undefined,
                    })}
                  >
                    {state.saving ? 'Saving…' : 'Save Paths & URL'}
                  </Button>
                </div>
              </div>

              {dsStatus && (
                <div className="settings-row">
                  <div className="settings-row-label">
                    <strong>Raw Diagnostics</strong>
                    <div className="settings-row-description" style={{ marginTop: 4 }}>
                      <span>Bridge path: <Badge tone={bridgeBinaryReady ? 'success' : bridgeCheckoutReady ? 'brand' : 'danger'}>{bridgeBinaryReady ? 'Binary found' : bridgeCheckoutReady ? 'Needs build' : 'Missing'}</Badge></span>
                      <br />
                      <span>Key configured: <Badge tone={keyReady ? 'success' : 'neutral'}>{keyReady ? 'Yes' : 'No'}</Badge></span>
                      <br />
                      <span>Env var (MOON_BRIDGE_DEEPSEEK_TOKEN): <Badge tone={dsStatus.envKeyConfigured ? 'success' : 'neutral'}>{dsStatus.envKeyConfigured ? 'Set' : 'Not set'}</Badge></span>
                      {dsStatus.modelIds && dsStatus.modelIds.length > 0 && (
                        <>
                          <br />
                          <span>Model IDs: <code style={{ fontSize: '0.72rem' }}>{dsStatus.modelIds.join(', ')}</code></span>
                        </>
                      )}
                      {dsStatus.probeError ? (
                        <>
                          <br />
                          <span style={{ color: 'var(--danger-color, #c00)' }}>Probe error: {dsStatus.probeError}</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
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
            </>
          )}
        </>
      )}

      {/* Recovery (shown even when Elegy Routed is active) */}
      {!showDeepSeekSection && (
        <>
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
        </>
      )}

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
