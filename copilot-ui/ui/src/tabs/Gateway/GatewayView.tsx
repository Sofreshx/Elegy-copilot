import { useEffect, useMemo } from 'react';
import { Button, FormInput, Panel, Toolbar } from '../../components';
import { useStoreValue } from '../../lib/store';
import { formatGatewayErrorList, formatGatewayStateSummary, gatewayStore } from './gatewayStore';

function asSegment(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

export default function GatewayView() {
  const gatewayState = useStoreValue(gatewayStore);

  useEffect(() => {
    void gatewayStore.loadInitial();
  }, []);

  const gatewaySummary = useMemo(() => {
    const fallback = gatewayState.stateEnvelope?.ready ? 'ready' : 'not_ready';
    return formatGatewayStateSummary(asSegment(gatewayState.stateEnvelope?.gateway), fallback);
  }, [gatewayState.stateEnvelope]);

  const sandboxLifecycleSummary = useMemo(() => {
    return formatGatewayStateSummary(asSegment(gatewayState.stateEnvelope?.tracker), 'unavailable');
  }, [gatewayState.stateEnvelope]);

  const planningPersistenceSummary = useMemo(() => {
    const planningPersistence = asSegment(gatewayState.stateEnvelope?.planningPersistence);
    const required = planningPersistence?.required === true;
    return formatGatewayStateSummary(planningPersistence, required ? 'required_not_ready' : 'optional');
  }, [gatewayState.stateEnvelope]);

  const gatewayErrorsText = useMemo(() => {
    return formatGatewayErrorList(gatewayState.stateEnvelope?.errors);
  }, [gatewayState.stateEnvelope]);

  const scanRootCount = gatewayState.scanResults?.roots.length || 0;
  const scanRepoCount =
    gatewayState.scanResults?.roots.reduce((count, root) => count + root.repos.length, 0) || 0;

  const handleRefresh = async () => {
    await Promise.allSettled([
      gatewayStore.refreshPolicyPreflight(true),
      gatewayStore.loadConfig(),
      gatewayStore.refreshState(true),
    ]);
  };

  return (
    <section className="gateway-view" data-testid="gateway-view">
      <Toolbar testId="gateway-view-toolbar">
        <div className="gateway-summary">
          <p className="gateway-title">Messaging Gateway</p>
          <p className="gateway-copy">
            {gatewayState.configExists ? 'Config found' : 'Config missing'} | {scanRepoCount} scanned repos
          </p>
        </div>

        <Button
          disabled={
            gatewayState.loadingConfig ||
            gatewayState.refreshingState ||
            gatewayState.preflightLoading
          }
          onClick={handleRefresh}
          testId="gateway-refresh-button"
          variant="secondary"
        >
          {gatewayState.loadingConfig || gatewayState.refreshingState || gatewayState.preflightLoading
            ? 'Refreshing...'
            : 'Refresh'}
        </Button>
      </Toolbar>

      {gatewayState.error ? (
        <p className="gateway-error" role="alert">
          {gatewayState.error}
        </p>
      ) : null}

      {gatewayState.statusMessage ? <p className="gateway-status">{gatewayState.statusMessage}</p> : null}

      {gatewayState.mutatingBlocked ? (
        <p className="gateway-warning" role="alert">
          Mutating actions are disabled by policy preflight: {gatewayState.mutatingReason || 'blocked'}
        </p>
      ) : null}

      <div className="gateway-grid">
        <Panel
          subtitle="Authoritative readiness from /api/gateway/state, with sandbox lifecycle transport and planning kept as diagnostics."
          testId="gateway-state-panel"
          title="Gateway State"
        >
          <div className="gateway-controls">
            <div className="gateway-actions">
              <Button
                disabled={gatewayState.refreshingState}
                onClick={() => {
                  void gatewayStore.refreshState(true);
                }}
                testId="gateway-refresh-state-button"
                variant="secondary"
              >
                {gatewayState.refreshingState ? 'Loading...' : 'Refresh state'}
              </Button>
              <Button
                disabled={gatewayState.connecting || gatewayState.mutatingBlocked}
                onClick={() => {
                  void gatewayStore.connect();
                }}
                testId="gateway-connect-button"
              >
                {gatewayState.connecting ? 'Connecting...' : 'Connect'}
              </Button>
              <Button
                disabled={gatewayState.initializingPersistence || gatewayState.mutatingBlocked}
                onClick={() => {
                  void gatewayStore.initializePersistence();
                }}
                testId="gateway-init-persistence-button"
                variant="secondary"
              >
                {gatewayState.initializingPersistence ? 'Initializing...' : 'Init DB'}
              </Button>
            </div>

            <div className="gateway-state-list">
              <div className="gateway-state-row">
                <p className="gateway-item-title">Gateway Authority</p>
                <p className="gateway-item-copy">{gatewaySummary}</p>
              </div>
              <div className="gateway-state-row">
                <p className="gateway-item-title">Sandbox Lifecycle Transport</p>
                <p className="gateway-item-copy">{sandboxLifecycleSummary}</p>
              </div>
              <div className="gateway-state-row">
                <p className="gateway-item-title">Planning DB Diagnostic</p>
                <p className="gateway-item-copy">{planningPersistenceSummary}</p>
              </div>
            </div>

            <p className="gateway-copy">Detailed diagnostics and reason codes</p>
            <pre className="code-block" data-testid="gateway-errors-block">
              {gatewayErrorsText}
            </pre>
          </div>
        </Panel>

        <Panel
          subtitle="Editable config fields with resilient defaults."
          testId="gateway-config-panel"
          title="Gateway Config"
        >
          <div className="gateway-controls">
            <p className="gateway-copy">
              Config file: <code>{gatewayState.configPath || '(unknown)'}</code>
            </p>

            <label className="form-input" htmlFor="gateway-mode">
              <span className="form-label">Mode</span>
              <select
                data-testid="gateway-mode-select"
                id="gateway-mode"
                onChange={(event) => gatewayStore.setMode(event.target.value)}
                value={gatewayState.mode}
              >
                <option value="auto">auto</option>
                <option value="connected">connected</option>
                <option value="disconnected">disconnected</option>
              </select>
            </label>

            <div className="gateway-field-grid">
              <FormInput
                id="gateway-acp-host"
                label="ACP Host"
                onValueChange={(value) => gatewayStore.setAcpHost(value)}
                placeholder="127.0.0.1"
                testId="gateway-acp-host-input"
                value={gatewayState.acpHost}
              />
              <FormInput
                id="gateway-acp-port"
                label="ACP Port"
                onValueChange={(value) => gatewayStore.setAcpPort(value)}
                placeholder="3000"
                testId="gateway-acp-port-input"
                type="number"
                value={gatewayState.acpPort}
              />
            </div>

            <FormInput
              id="gateway-active-root"
              label="Active Root"
              onValueChange={(value) => gatewayStore.setActiveRoot(value)}
              placeholder="/path/to/repo"
              testId="gateway-active-root-input"
              value={gatewayState.activeRoot}
            />

            <label className="form-input" htmlFor="gateway-allowed-roots">
              <span className="form-label">Allowed Roots (comma or newline separated)</span>
              <textarea
                data-testid="gateway-allowed-roots-input"
                id="gateway-allowed-roots"
                onChange={(event) => gatewayStore.setAllowedRootsText(event.target.value)}
                rows={5}
                value={gatewayState.allowedRootsText}
              />
            </label>

            <div className="gateway-field-grid">
              <FormInput
                id="gateway-discord-guild"
                label="Discord Guild ID"
                onValueChange={(value) => gatewayStore.setDiscordGuildId(value)}
                placeholder="optional"
                testId="gateway-discord-guild-input"
                value={gatewayState.discordGuildId}
              />
              <FormInput
                id="gateway-discord-channel"
                label="Discord Channel ID"
                onValueChange={(value) => gatewayStore.setDiscordChannelId(value)}
                placeholder="optional"
                testId="gateway-discord-channel-input"
                value={gatewayState.discordChannelId}
              />
            </div>

            <FormInput
              id="gateway-discord-users"
              label="Discord User IDs (comma separated)"
              onValueChange={(value) => gatewayStore.setDiscordUsersText(value)}
              placeholder="111, 222"
              testId="gateway-discord-users-input"
              value={gatewayState.discordUsersText}
            />

            <FormInput
              id="gateway-discord-permissions-channel"
              label="Discord Permissions Channel ID"
              onValueChange={(value) => gatewayStore.setDiscordPermissionsChannelId(value)}
              placeholder="optional"
              testId="gateway-discord-permissions-channel-input"
              value={gatewayState.discordPermissionsChannelId}
            />

            <FormInput
              id="gateway-telegram-users"
              label="Telegram User IDs (comma separated)"
              onValueChange={(value) => gatewayStore.setTelegramUsersText(value)}
              placeholder="12345, 67890"
              testId="gateway-telegram-users-input"
              value={gatewayState.telegramUsersText}
            />

            <Button
              disabled={gatewayState.saving || gatewayState.mutatingBlocked}
              onClick={() => {
                void gatewayStore.saveConfig();
              }}
              testId="gateway-save-button"
            >
              {gatewayState.saving ? 'Saving...' : 'Save config'}
            </Button>
          </div>
        </Panel>

        <Panel
          subtitle="Scan workspace roots and summarize discovered repositories."
          testId="gateway-scan-panel"
          title="Repo Scan"
        >
          <div className="gateway-controls">
            <div className="gateway-actions">
              <Button
                disabled={gatewayState.scanning}
                onClick={() => {
                  void gatewayStore.scanRepos();
                }}
                testId="gateway-scan-button"
                variant="secondary"
              >
                {gatewayState.scanning ? 'Scanning...' : 'Scan repos'}
              </Button>
              <FormInput
                id="gateway-extra-scan-path"
                label="Extra Scan Path"
                onValueChange={(value) => gatewayStore.setExtraScanPath(value)}
                placeholder="Optional path"
                testId="gateway-extra-scan-path-input"
                value={gatewayState.extraScanPath}
              />
            </div>

            <p className="gateway-copy">
              Scan summary: {scanRootCount} root(s), {scanRepoCount} repo(s)
            </p>

            {scanRootCount === 0 ? (
              <p className="state-message">No scan output yet.</p>
            ) : (
              <ul className="gateway-scan-list" data-testid="gateway-scan-list">
                {gatewayState.scanResults?.roots.map((root) => (
                  <li key={root.scanRoot}>
                    <p className="gateway-item-title">{root.scanRoot}</p>
                    <p className="gateway-item-copy">{root.repos.length} repo(s)</p>
                    <p className="gateway-item-copy">{root.repos.map((repo) => repo.name).join(', ') || '(none)'}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Panel>
      </div>
    </section>
  );
}
