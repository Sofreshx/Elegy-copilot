import {
  connectGateway,
  getGatewayConfig,
  getGatewayState,
  getPolicyPreflight,
  initPlanningPersistence,
  saveGatewayConfig,
  scanGatewayRepos,
  toCanonicalSandboxMissingTokenError,
  toCanonicalSandboxMissingTokenErrorFromUnknown,
  toSandboxTokenRemediationMessage,
} from '../../lib/api';
import { formatGatewaySegmentSummary, humanizeToken } from '../../lib/stateDiagnostics';
import { createStore } from '../../lib/store';
import type {
  GatewayScanReposResponse,
  GatewayStateError,
  GatewayStateResponse,
  PolicyPreflightResponse,
} from '../../lib/types';

export interface GatewayState {
  configPath: string;
  configExists: boolean;
  mode: string;
  acpHost: string;
  acpPort: string;
  activeRoot: string;
  allowedRootsText: string;
  discordGuildId: string;
  discordChannelId: string;
  discordUsersText: string;
  discordPermissionsChannelId: string;
  telegramUsersText: string;
  extraScanPath: string;
  scanResults: GatewayScanReposResponse | null;
  stateEnvelope: GatewayStateResponse | null;
  policyPreflight: PolicyPreflightResponse | null;
  mutatingBlocked: boolean;
  mutatingReason: string;
  sandboxTokenMissing: boolean;
  sandboxTokenGuidance: string;
  loadingConfig: boolean;
  saving: boolean;
  refreshingState: boolean;
  connecting: boolean;
  scanning: boolean;
  initializingPersistence: boolean;
  preflightLoading: boolean;
  error: string | null;
  statusMessage: string | null;
}

const INITIAL_STATE: GatewayState = {
  configPath: '',
  configExists: false,
  mode: 'auto',
  acpHost: '127.0.0.1',
  acpPort: '3000',
  activeRoot: '',
  allowedRootsText: '',
  discordGuildId: '',
  discordChannelId: '',
  discordUsersText: '',
  discordPermissionsChannelId: '',
  telegramUsersText: '',
  extraScanPath: '',
  scanResults: null,
  stateEnvelope: null,
  policyPreflight: null,
  mutatingBlocked: false,
  mutatingReason: '',
  sandboxTokenMissing: false,
  sandboxTokenGuidance: '',
  loadingConfig: false,
  saving: false,
  refreshingState: false,
  connecting: false,
  scanning: false,
  initializingPersistence: false,
  preflightLoading: false,
  error: null,
  statusMessage: null,
};

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

function parseDelimitedList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function formatDelimitedList(values: string[]): string {
  return values.join('\n');
}

export function formatGatewayStateSummary(segment: Record<string, unknown> | null, fallbackStatus = 'unknown'): string {
  const summary = formatGatewaySegmentSummary(segment, fallbackStatus);
  const detailSuffix = summary.detail ? ` - ${summary.detail}` : '';
  return `${summary.statusLabel} (${summary.readinessLabel})${detailSuffix}`;
}

export function formatGatewayErrorList(errors: GatewayStateError[] | undefined): string {
  if (!errors || errors.length === 0) {
    return '(none)';
  }

  return errors
    .map((entry) => {
      const code = typeof entry.code === 'string' && entry.code.trim() ? entry.code : 'error';
      const reason = typeof entry.reason === 'string' && entry.reason.trim() ? entry.reason : '';
      const message = typeof entry.message === 'string' && entry.message.trim() ? entry.message : 'unknown_error';
      const statusCode = entry.statusCode != null ? ` (HTTP ${entry.statusCode})` : '';
      const reasonLabel = reason ? humanizeToken(reason) : humanizeToken(code, 'Error');
      return `${reasonLabel}: ${message}${statusCode}`;
    })
    .join('\n');
}

function createGatewayStore() {
  const store = createStore<GatewayState>(INITIAL_STATE);
  let configRequestVersion = 0;
  let stateRequestVersion = 0;
  let preflightRequestVersion = 0;

  function resolveSandboxTokenGateFromPayload(payload: unknown): { blocked: boolean; guidance: string } {
    const mapped = toCanonicalSandboxMissingTokenError(payload);
    if (!mapped) {
      return {
        blocked: false,
        guidance: '',
      };
    }

    return {
      blocked: true,
      guidance: toSandboxTokenRemediationMessage(payload),
    };
  }

  function resolveSandboxTokenGateFromError(error: unknown): { blocked: boolean; guidance: string } {
    const mapped = toCanonicalSandboxMissingTokenErrorFromUnknown(error);
    if (!mapped) {
      return {
        blocked: false,
        guidance: '',
      };
    }

    return {
      blocked: true,
      guidance: toSandboxTokenRemediationMessage(error),
    };
  }

  function setStatus(statusMessage: string): void {
    store.setState((state) => ({
      ...state,
      statusMessage,
    }));
  }

  function setSandboxTokenGate(blocked: boolean, guidance = ''): void {
    store.setState((state) => ({
      ...state,
      sandboxTokenMissing: blocked,
      sandboxTokenGuidance: blocked ? guidance : '',
    }));
  }

  async function refreshPolicyPreflight(forceRefresh = false): Promise<void> {
    const nextVersion = ++preflightRequestVersion;

    store.setState((state) => ({
      ...state,
      preflightLoading: true,
      error: null,
    }));

    try {
      const response = await getPolicyPreflight(undefined, forceRefresh);

      store.setState((state) => {
        if (nextVersion !== preflightRequestVersion) {
          return state;
        }

        const mutatingBlocked = !response.ok;
        const mutatingReason = response.message || response.reason || '';

        return {
          ...state,
          preflightLoading: false,
          policyPreflight: response,
          mutatingBlocked,
          mutatingReason,
          statusMessage: mutatingBlocked
            ? `Policy gate active: ${mutatingReason || 'mutating actions are blocked.'}`
            : state.statusMessage,
        };
      });
    } catch (error) {
      const message = toErrorMessage(error, 'Unable to load policy preflight.');

      store.setState((state) => {
        if (nextVersion !== preflightRequestVersion) {
          return state;
        }

        return {
          ...state,
          preflightLoading: false,
          policyPreflight: {
            ok: false,
            status: 'failed',
            reason: 'preflight_request_failed',
            message,
          },
          mutatingBlocked: true,
          mutatingReason: message,
          error: message,
        };
      });
    }
  }

  async function loadConfig(): Promise<void> {
    const nextVersion = ++configRequestVersion;

    store.setState((state) => ({
      ...state,
      loadingConfig: true,
      error: null,
      statusMessage: 'Loading gateway config...',
    }));

    try {
      const response = await getGatewayConfig();
      const config = response.config || {};
      const workspaces = config.workspaces || {};
      const discord = config.discord || {};
      const telegram = config.telegram || {};

      store.setState((state) => {
        if (nextVersion !== configRequestVersion) {
          return state;
        }

        return {
          ...state,
          loadingConfig: false,
          configPath: response.configPath,
          configExists: response.exists,
          mode: config.mode || 'auto',
          acpHost: config.acp?.host || '127.0.0.1',
          acpPort: String(config.acp?.port || 3000),
          activeRoot: workspaces.activeRoot || '',
          allowedRootsText: formatDelimitedList(workspaces.allowedRoots || []),
          discordGuildId: discord.guildId || '',
          discordChannelId: discord.channelId || '',
          discordUsersText: (discord.allowlistedUserIds || []).join(', '),
          discordPermissionsChannelId: discord.permissionsChannelId || '',
          telegramUsersText: (telegram.allowlistedUserIds || []).join(', '),
          statusMessage: 'Gateway config loaded.',
          error: null,
        };
      });
    } catch (error) {
      const message = toErrorMessage(error, 'Unable to load gateway config.');

      store.setState((state) => {
        if (nextVersion !== configRequestVersion) {
          return state;
        }

        return {
          ...state,
          loadingConfig: false,
          error: message,
          statusMessage: `Gateway config failed: ${message}`,
        };
      });
    }
  }

  async function refreshState(setStatusMessage = true): Promise<void> {
    const nextVersion = ++stateRequestVersion;

    store.setState((state) => ({
      ...state,
      refreshingState: true,
      error: null,
      statusMessage: setStatusMessage ? 'Loading gateway state...' : state.statusMessage,
    }));

    try {
      const response = await getGatewayState();
      const sandboxTokenGate = resolveSandboxTokenGateFromPayload(response);

      store.setState((state) => {
        if (nextVersion !== stateRequestVersion) {
          return state;
        }

        return {
          ...state,
          refreshingState: false,
          stateEnvelope: response,
          error: null,
          sandboxTokenMissing: sandboxTokenGate.blocked,
          sandboxTokenGuidance: sandboxTokenGate.guidance,
          statusMessage: setStatusMessage ? 'Gateway state loaded.' : state.statusMessage,
        };
      });
    } catch (error) {
      const message = toErrorMessage(error, 'Unable to refresh gateway state.');
      const sandboxTokenGate = resolveSandboxTokenGateFromError(error);

      store.setState((state) => {
        if (nextVersion !== stateRequestVersion) {
          return state;
        }

        return {
          ...state,
          refreshingState: false,
          error: message,
          sandboxTokenMissing: sandboxTokenGate.blocked,
          sandboxTokenGuidance: sandboxTokenGate.guidance,
          statusMessage: `Gateway state failed: ${message}`,
        };
      });
    }
  }

  async function connect(): Promise<void> {
    const stateSnapshot = store.getState();
    if (stateSnapshot.mutatingBlocked) {
      setStatus(`Connect blocked: ${stateSnapshot.mutatingReason || 'policy gate active'}.`);
      return;
    }

    store.setState((state) => ({
      ...state,
      connecting: true,
      error: null,
      statusMessage: 'Connecting gateway...',
    }));

    try {
      const response = await connectGateway();
      const sandboxTokenGate = resolveSandboxTokenGateFromPayload(response);

      store.setState((state) => ({
        ...state,
        connecting: false,
        stateEnvelope: response,
        error: null,
        sandboxTokenMissing: sandboxTokenGate.blocked,
        sandboxTokenGuidance: sandboxTokenGate.guidance,
        statusMessage: response.ready ? 'Gateway connect completed and ready.' : 'Gateway connect completed.',
      }));

      await refreshState(false);
    } catch (error) {
      const message = toErrorMessage(error, 'Unable to connect gateway.');
      const sandboxTokenGate = resolveSandboxTokenGateFromError(error);

      store.setState((state) => ({
        ...state,
        connecting: false,
        error: message,
        sandboxTokenMissing: sandboxTokenGate.blocked,
        sandboxTokenGuidance: sandboxTokenGate.guidance,
        statusMessage: `Gateway connect failed: ${message}`,
      }));

      await refreshState(false);
    }
  }

  async function scanRepos(): Promise<void> {
    const stateSnapshot = store.getState();

    store.setState((state) => ({
      ...state,
      scanning: true,
      error: null,
      statusMessage: 'Scanning repositories...',
    }));

    try {
      const response = await scanGatewayRepos(stateSnapshot.extraScanPath);

      const totalRepos = response.roots.reduce((count, root) => count + root.repos.length, 0);

      store.setState((state) => ({
        ...state,
        scanning: false,
        scanResults: response,
        error: null,
        statusMessage: `Found ${totalRepos} repo(s) across ${response.roots.length} scan root(s).`,
      }));
    } catch (error) {
      const message = toErrorMessage(error, 'Unable to scan repositories.');

      store.setState((state) => ({
        ...state,
        scanning: false,
        error: message,
        statusMessage: `Scan failed: ${message}`,
      }));
    }
  }

  async function saveConfig(): Promise<void> {
    const stateSnapshot = store.getState();
    if (stateSnapshot.mutatingBlocked) {
      setStatus(`Save blocked: ${stateSnapshot.mutatingReason || 'policy gate active'}.`);
      return;
    }

    const allowedRoots = parseDelimitedList(stateSnapshot.allowedRootsText);
    const activeRoot = stateSnapshot.activeRoot.trim();
    const discordUsers = parseDelimitedList(stateSnapshot.discordUsersText);
    const telegramUsers = parseDelimitedList(stateSnapshot.telegramUsersText);

    const hasAnyDiscordInput = Boolean(
      stateSnapshot.discordGuildId.trim() ||
      stateSnapshot.discordChannelId.trim() ||
      stateSnapshot.discordUsersText.trim() ||
      stateSnapshot.discordPermissionsChannelId.trim()
    );

    const includeDiscord =
      hasAnyDiscordInput &&
      stateSnapshot.discordGuildId.trim().length > 0 &&
      stateSnapshot.discordChannelId.trim().length > 0 &&
      discordUsers.length > 0;

    const includeTelegram = telegramUsers.length > 0;

    if (hasAnyDiscordInput && !includeDiscord) {
      setStatus('Validation error: Discord requires guildId, channelId, and at least one allowlisted user.');
      return;
    }

    if (!includeDiscord && !includeTelegram) {
      setStatus('Validation error: configure at least one platform (Discord or Telegram).');
      return;
    }

    if (allowedRoots.length === 0) {
      setStatus('Validation error: set at least one allowed workspace root.');
      return;
    }

    if (!activeRoot) {
      setStatus('Validation error: active root is required.');
      return;
    }

    const parsedPort = Number.parseInt(stateSnapshot.acpPort, 10);
    const acpPort = Number.isFinite(parsedPort) ? parsedPort : 3000;

    store.setState((state) => ({
      ...state,
      saving: true,
      error: null,
      statusMessage: 'Saving gateway config...',
    }));

    try {
      await saveGatewayConfig({
        mode: stateSnapshot.mode || 'auto',
        acp: {
          host: stateSnapshot.acpHost.trim() || '127.0.0.1',
          port: acpPort,
         },
        ...(includeDiscord
          ? {
            discord: {
              allowlistedUserIds: discordUsers,
              guildId: stateSnapshot.discordGuildId.trim(),
              channelId: stateSnapshot.discordChannelId.trim(),
              ...(stateSnapshot.discordPermissionsChannelId.trim()
                ? { permissionsChannelId: stateSnapshot.discordPermissionsChannelId.trim() }
                : {}),
            },
          }
          : {}),
        ...(includeTelegram
          ? {
            telegram: {
              allowlistedUserIds: telegramUsers,
            },
          }
          : {}),
        workspaces: {
          allowedRoots,
          activeRoot,
        },
      });

      store.setState((state) => ({
        ...state,
        saving: false,
        error: null,
        statusMessage: 'Gateway config saved.',
      }));

      await Promise.allSettled([loadConfig(), refreshState(false)]);
    } catch (error) {
      const message = toErrorMessage(error, 'Unable to save gateway config.');

      store.setState((state) => ({
        ...state,
        saving: false,
        error: message,
        statusMessage: `Gateway save failed: ${message}`,
      }));
    }
  }

  async function initializePersistence(): Promise<void> {
    const stateSnapshot = store.getState();
    if (stateSnapshot.mutatingBlocked) {
      setStatus(`Init DB blocked: ${stateSnapshot.mutatingReason || 'policy gate active'}.`);
      return;
    }

    store.setState((state) => ({
      ...state,
      initializingPersistence: true,
      error: null,
      statusMessage: 'Initializing planning persistence...',
    }));

    try {
      const response = await initPlanningPersistence();

      store.setState((state) => ({
        ...state,
        initializingPersistence: false,
        error: null,
        statusMessage: response.ready ? 'Planning persistence initialized and ready.' : 'Planning persistence init completed.',
      }));

      await refreshState(false);
    } catch (error) {
      const message = toErrorMessage(error, 'Unable to initialize planning persistence.');

      store.setState((state) => ({
        ...state,
        initializingPersistence: false,
        error: message,
        statusMessage: `Planning persistence init failed: ${message}`,
      }));

      await refreshState(false);
    }
  }

  async function loadInitial(): Promise<void> {
    await Promise.allSettled([
      refreshPolicyPreflight(false),
      loadConfig(),
      refreshState(false),
    ]);

    store.setState((state) => ({
      ...state,
      statusMessage: state.error ? state.statusMessage : 'Gateway state loaded.',
    }));
  }

  function setMode(value: string): void {
    store.setState((state) => ({
      ...state,
      mode: value,
    }));
  }

  function setAcpHost(value: string): void {
    store.setState((state) => ({
      ...state,
      acpHost: value,
    }));
  }

  function setAcpPort(value: string): void {
    store.setState((state) => ({
      ...state,
      acpPort: value,
    }));
  }

  function setActiveRoot(value: string): void {
    store.setState((state) => ({
      ...state,
      activeRoot: value,
    }));
  }

  function setAllowedRootsText(value: string): void {
    store.setState((state) => ({
      ...state,
      allowedRootsText: value,
    }));
  }

  function setDiscordGuildId(value: string): void {
    store.setState((state) => ({
      ...state,
      discordGuildId: value,
    }));
  }

  function setDiscordChannelId(value: string): void {
    store.setState((state) => ({
      ...state,
      discordChannelId: value,
    }));
  }

  function setDiscordUsersText(value: string): void {
    store.setState((state) => ({
      ...state,
      discordUsersText: value,
    }));
  }

  function setDiscordPermissionsChannelId(value: string): void {
    store.setState((state) => ({
      ...state,
      discordPermissionsChannelId: value,
    }));
  }

  function setTelegramUsersText(value: string): void {
    store.setState((state) => ({
      ...state,
      telegramUsersText: value,
    }));
  }

  function setExtraScanPath(value: string): void {
    store.setState((state) => ({
      ...state,
      extraScanPath: value,
    }));
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    loadInitial,
    refreshPolicyPreflight,
    loadConfig,
    refreshState,
    connect,
    scanRepos,
    saveConfig,
    initializePersistence,
    setMode,
    setAcpHost,
    setAcpPort,
    setActiveRoot,
    setAllowedRootsText,
    setDiscordGuildId,
    setDiscordChannelId,
    setDiscordUsersText,
    setDiscordPermissionsChannelId,
    setTelegramUsersText,
    setExtraScanPath,
    setSandboxTokenGate,
  };
}

export const gatewayStore = createGatewayStore();
