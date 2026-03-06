import fs from 'fs';
import os from 'os';
import path from 'path';

export type MessagingGatewayMode = 'auto' | 'connected' | 'disconnected';
export const LIFECYCLE_ACTIONS = ['create', 'start', 'stop', 'open-terminal', 'pr-open', 'finish'] as const;
export type LifecycleAction = (typeof LIFECYCLE_ACTIONS)[number];

export const MESSAGING_GATEWAY_CONFIG_SCHEMA_VERSION = 1;
export const MESSAGING_GATEWAY_CONFIG_CONTRACT_VERSION = 'messaging_gateway_config_v1';
export type MessagingGatewayConfigCompatibilitySource = 'v0' | 'v1';

export const DEFAULT_SANDBOX_MAX_SANDBOXES = 10;
export const DEFAULT_SANDBOX_PORT_RANGE_START = 13_000;
export const DEFAULT_SANDBOX_PORT_RANGE_END = 13_099;
export const DEFAULT_SANDBOX_CLEANUP_ON_STARTUP = false;
export const DEFAULT_SANDBOX_STALE_TTL_MS = 24 * 60 * 60 * 1000;

const LIFECYCLE_ACTION_SET = new Set<string>(LIFECYCLE_ACTIONS);
const DEFAULT_ENABLED_LIFECYCLE_ACTIONS: LifecycleAction[] = [...LIFECYCLE_ACTIONS];
const DEFAULT_LOCAL_MACHINE_ONLY_ACTIONS: LifecycleAction[] = ['open-terminal'];

export interface MessagingGatewayConfig {
	configVersion?: number;
	schemaVersion?: typeof MESSAGING_GATEWAY_CONFIG_SCHEMA_VERSION;
	contractVersion?: typeof MESSAGING_GATEWAY_CONFIG_CONTRACT_VERSION;
	compatibility?: {
		normalizedFrom: MessagingGatewayConfigCompatibilitySource;
		deterministic: true;
	};
	mode?: MessagingGatewayMode;
	/** ACP (Copilot CLI `--acp --port <N>`) settings. */
	acp?: {
		host?: string;
		port?: number;
	};
	sandboxLifecycle?: {
		maxSandboxes?: number;
		portRange?: {
			start: number;
			end: number;
		};
		cleanupOnStartup?: boolean;
		staleTtlMs?: number;
	};
	discord?: {
		allowlistedUserIds: string[];
		guildId: string;
		channelId: string;
		permissionsChannelId?: string;
	};
	telegram?: {
		allowlistedUserIds: string[];
	};
	workspaces: {
		allowedRoots: string[];
		activeRoot: string;
	};
	gatewayHttp?: {
		lifecycleAuthz?: {
			enabledActions: LifecycleAction[];
			localMachineOnlyActions: LifecycleAction[];
		};
	};
}

export interface LoadedMessagingGatewayConfig {
	configPath: string;
	config: MessagingGatewayConfig;
}

export interface ResolvedSandboxLifecycleConfig {
	maxSandboxes: number;
	portRange: {
		start: number;
		end: number;
	};
	cleanupOnStartup: boolean;
	staleTtlMs: number;
}

export const MESSAGING_GATEWAY_CONFIG_PATH_ENV = 'INSTRUCTION_ENGINE_GATEWAY_CONFIG_PATH';
export const MESSAGING_GATEWAY_CONFIG_JSON_ENV = 'INSTRUCTION_ENGINE_GATEWAY_CONFIG_JSON';

export function getDefaultMessagingGatewayConfigPath(): string {
	return path.join(os.homedir(), '.instruction-engine', 'messaging-gateway.config.json');
}

export function resolveMessagingGatewayConfigPath(configPathFromCli?: string): string {
	const resolved =
		configPathFromCli?.trim() ||
		process.env[MESSAGING_GATEWAY_CONFIG_PATH_ENV]?.trim() ||
		getDefaultMessagingGatewayConfigPath();

	return path.resolve(resolved);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function asNonEmptyString(value: unknown, field: string): string {
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new Error(`[Gateway] Invalid config: ${field} must be a non-empty string`);
	}
	return value.trim();
}

function asStringArray(value: unknown, field: string): string[] {
	if (!Array.isArray(value)) {
		throw new Error(`[Gateway] Invalid config: ${field} must be an array of strings`);
	}
	const strings = value.map((v, index) => asNonEmptyString(v, `${field}[${index}]`));
	return strings;
}

function uniqueStrings(values: string[]): string[] {
	const seen = new Set<string>();
	const output: string[] = [];
	for (const value of values) {
		if (seen.has(value)) continue;
		seen.add(value);
		output.push(value);
	}
	return output;
}

function asLifecycleActionsArray(value: unknown, field: string): LifecycleAction[] {
	const actions = asStringArray(value, field);
	const output: LifecycleAction[] = [];

	for (const action of actions) {
		if (!LIFECYCLE_ACTION_SET.has(action)) {
			throw new Error(`[Gateway] Invalid config: ${field} contains unsupported action '${action}'`);
		}
		output.push(action as LifecycleAction);
	}

	return output;
}

function asOptionalPort(value: unknown, field: string): number | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < 1 || value > 65535) {
		throw new Error(`[Gateway] Invalid config: ${field} must be an integer port (1-65535)`);
	}
	return value;
}

function asOptionalIntegerInRange(value: unknown, field: string, min: number, max: number): number | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) {
		throw new Error(`[Gateway] Invalid config: ${field} must be an integer (${min}-${max})`);
	}
	return value;
}

function asOptionalBoolean(value: unknown, field: string): boolean | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== 'boolean') {
		throw new Error(`[Gateway] Invalid config: ${field} must be a boolean`);
	}
	return value;
}

function asOptionalPositiveInteger(value: unknown, field: string): number | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
		throw new Error(`[Gateway] Invalid config: ${field} must be a positive integer`);
	}
	return value;
}

function assertAllNumericIds(ids: string[], field: string) {
	for (const id of ids) {
		if (!/^\d+$/.test(id)) {
			throw new Error(`[Gateway] Invalid config: ${field} contains a non-numeric ID`);
		}
	}
}

function normalizeWorkspaceRoot(inputPath: string): string {
	return path.resolve(inputPath);
}

function pathsEqual(a: string, b: string): boolean {
	if (process.platform === 'win32') {
		return a.toLowerCase() === b.toLowerCase();
	}
	return a === b;
}

function uniquePaths(pathsInput: string[]): string[] {
	const output: string[] = [];
	for (const p of pathsInput) {
		if (!output.some((existing) => pathsEqual(existing, p))) output.push(p);
	}
	return output;
}

function validateAndNormalizeConfig(raw: unknown): MessagingGatewayConfig {
	if (!isRecord(raw)) {
		throw new Error('[Gateway] Invalid config: root must be an object');
	}

	const configVersion = asOptionalPositiveInteger(raw.configVersion, 'configVersion');
	const hasExplicitV1Marker =
		configVersion !== undefined ||
		raw.schemaVersion !== undefined ||
		raw.contractVersion !== undefined;
	const normalizedFrom: MessagingGatewayConfigCompatibilitySource = hasExplicitV1Marker ? 'v1' : 'v0';

	const modeRaw = raw.mode;
	if (
		modeRaw !== undefined &&
		modeRaw !== 'auto' &&
		modeRaw !== 'connected' &&
		modeRaw !== 'disconnected'
	) {
		throw new Error('[Gateway] Invalid config: mode must be one of auto|connected|disconnected');
	}

	let acp: MessagingGatewayConfig['acp'] | undefined;
	if (raw.acp !== undefined && raw.acp !== null) {
		if (!isRecord(raw.acp)) throw new Error('[Gateway] Invalid config: acp must be an object');
		const host = raw.acp.host !== undefined && raw.acp.host !== null ? asNonEmptyString(raw.acp.host, 'acp.host') : undefined;
		const port = asOptionalPort(raw.acp.port, 'acp.port');
		acp = { host, port };
	}

	let sandboxLifecycle: MessagingGatewayConfig['sandboxLifecycle'] | undefined;
	if (raw.sandboxLifecycle !== undefined && raw.sandboxLifecycle !== null) {
		if (!isRecord(raw.sandboxLifecycle)) {
			throw new Error('[Gateway] Invalid config: sandboxLifecycle must be an object');
		}

		const maxSandboxes = asOptionalIntegerInRange(raw.sandboxLifecycle.maxSandboxes, 'sandboxLifecycle.maxSandboxes', 1, 100);
		const cleanupOnStartup = asOptionalBoolean(raw.sandboxLifecycle.cleanupOnStartup, 'sandboxLifecycle.cleanupOnStartup');
		const staleTtlMs = asOptionalIntegerInRange(
			raw.sandboxLifecycle.staleTtlMs,
			'sandboxLifecycle.staleTtlMs',
			0,
			365 * 24 * 60 * 60 * 1000,
		);

		let portRange: { start: number; end: number } | undefined;
		if (raw.sandboxLifecycle.portRange !== undefined && raw.sandboxLifecycle.portRange !== null) {
			if (!isRecord(raw.sandboxLifecycle.portRange)) {
				throw new Error('[Gateway] Invalid config: sandboxLifecycle.portRange must be an object');
			}

			const start = asOptionalPort(raw.sandboxLifecycle.portRange.start, 'sandboxLifecycle.portRange.start');
			const end = asOptionalPort(raw.sandboxLifecycle.portRange.end, 'sandboxLifecycle.portRange.end');
			if (start === undefined || end === undefined) {
				throw new Error('[Gateway] Invalid config: sandboxLifecycle.portRange must include integer start and end (1-65535)');
			}
			if (start > end) {
				throw new Error('[Gateway] Invalid config: sandboxLifecycle.portRange.start must be <= sandboxLifecycle.portRange.end');
			}
			portRange = { start, end };
		}

		sandboxLifecycle = {
			maxSandboxes,
			portRange,
			cleanupOnStartup,
			staleTtlMs,
		};
	}

	const legacyDiscordRaw =
		raw.allowlistedUserIds !== undefined ||
		raw.guildId !== undefined ||
		raw.channelId !== undefined ||
		raw.permissionsChannelId !== undefined
			? {
				allowlistedUserIds: raw.allowlistedUserIds,
				guildId: raw.guildId,
				channelId: raw.channelId,
				permissionsChannelId: raw.permissionsChannelId,
			}
			: undefined;

	const discordRaw = raw.discord ?? legacyDiscordRaw;
	let discord: MessagingGatewayConfig['discord'] | undefined;
	if (discordRaw !== undefined && discordRaw !== null) {
		if (!isRecord(discordRaw)) {
			throw new Error('[Gateway] Invalid config: discord must be an object');
		}

		const allowlistedUserIds = uniqueStrings(asStringArray(discordRaw.allowlistedUserIds, 'discord.allowlistedUserIds'));
		if (allowlistedUserIds.length === 0) {
			throw new Error('[Gateway] Invalid config: discord.allowlistedUserIds must not be empty');
		}
		assertAllNumericIds(allowlistedUserIds, 'discord.allowlistedUserIds');

		const guildId = asNonEmptyString(discordRaw.guildId, 'discord.guildId');
		const channelId = asNonEmptyString(discordRaw.channelId, 'discord.channelId');
		if (!/^\d+$/.test(guildId)) throw new Error('[Gateway] Invalid config: discord.guildId must be numeric');
		if (!/^\d+$/.test(channelId)) throw new Error('[Gateway] Invalid config: discord.channelId must be numeric');

		let permissionsChannelId: string | undefined;
		if (discordRaw.permissionsChannelId !== undefined && discordRaw.permissionsChannelId !== null) {
			permissionsChannelId = asNonEmptyString(discordRaw.permissionsChannelId, 'discord.permissionsChannelId');
			if (!/^\d+$/.test(permissionsChannelId)) {
				throw new Error('[Gateway] Invalid config: discord.permissionsChannelId must be numeric');
			}
		}

		discord = {
			allowlistedUserIds,
			guildId,
			channelId,
			permissionsChannelId,
		};
	}

	const legacyTelegramRaw = raw.telegramAllowlistedUserIds !== undefined
		? { allowlistedUserIds: raw.telegramAllowlistedUserIds }
		: undefined;
	const telegramRaw = raw.telegram ?? legacyTelegramRaw;
	let telegram: MessagingGatewayConfig['telegram'] | undefined;
	if (telegramRaw !== undefined && telegramRaw !== null) {
		if (!isRecord(telegramRaw)) {
			throw new Error('[Gateway] Invalid config: telegram must be an object');
		}
		const allowlistedUserIds = uniqueStrings(asStringArray(telegramRaw.allowlistedUserIds, 'telegram.allowlistedUserIds'));
		if (allowlistedUserIds.length === 0) {
			throw new Error('[Gateway] Invalid config: telegram.allowlistedUserIds must not be empty');
		}
		assertAllNumericIds(allowlistedUserIds, 'telegram.allowlistedUserIds');

		telegram = {
			allowlistedUserIds,
		};
	}

	if (!discord && !telegram) {
		const allowPlatformless = process.env.INSTRUCTION_ENGINE_GATEWAY_ALLOW_PLATFORMLESS === '1';
		if (!allowPlatformless) {
			throw new Error('[Gateway] Invalid config: at least one platform (discord or telegram) must be configured');
		}
	}

	const legacyWorkspaceRoot = raw.workspaceRoot ?? raw.workspacePath;
	const legacyAllowedRoots = raw.allowedRoots ?? raw.allowedWorkspaceRoots;
	const workspacesRaw = raw.workspaces ?? (
		legacyWorkspaceRoot !== undefined || legacyAllowedRoots !== undefined
			? {
				allowedRoots: legacyAllowedRoots ?? (legacyWorkspaceRoot !== undefined ? [legacyWorkspaceRoot] : undefined),
				activeRoot: raw.activeRoot ?? legacyWorkspaceRoot,
			}
			: undefined
	);
	if (!isRecord(workspacesRaw)) {
		throw new Error('[Gateway] Invalid config: workspaces must be an object');
	}

	const allowedRootsRaw = asStringArray(workspacesRaw.allowedRoots, 'workspaces.allowedRoots');
	if (allowedRootsRaw.length === 0) {
		throw new Error('[Gateway] Invalid config: workspaces.allowedRoots must not be empty');
	}
	const allowedRoots = uniquePaths(allowedRootsRaw.map(normalizeWorkspaceRoot));

	const activeRoot = normalizeWorkspaceRoot(asNonEmptyString(workspacesRaw.activeRoot, 'workspaces.activeRoot'));
	if (!allowedRoots.some((r) => pathsEqual(r, activeRoot))) {
		throw new Error('[Gateway] Invalid config: workspaces.activeRoot must be included in workspaces.allowedRoots');
	}
	if (!fs.existsSync(activeRoot) || !fs.statSync(activeRoot).isDirectory()) {
		throw new Error('[Gateway] Invalid config: workspaces.activeRoot must exist and be a directory');
	}

	let gatewayHttp: MessagingGatewayConfig['gatewayHttp'] | undefined;
	if (raw.gatewayHttp !== undefined && raw.gatewayHttp !== null) {
		if (!isRecord(raw.gatewayHttp)) {
			throw new Error('[Gateway] Invalid config: gatewayHttp must be an object');
		}

		const lifecycleAuthzRaw = raw.gatewayHttp.lifecycleAuthz;
		if (lifecycleAuthzRaw !== undefined && lifecycleAuthzRaw !== null && !isRecord(lifecycleAuthzRaw)) {
			throw new Error('[Gateway] Invalid config: gatewayHttp.lifecycleAuthz must be an object');
		}

		const enabledActions = lifecycleAuthzRaw?.enabledActions
			? asLifecycleActionsArray(lifecycleAuthzRaw.enabledActions, 'gatewayHttp.lifecycleAuthz.enabledActions')
			: [...DEFAULT_ENABLED_LIFECYCLE_ACTIONS];

		const localMachineOnlyActions = lifecycleAuthzRaw?.localMachineOnlyActions
			? asLifecycleActionsArray(lifecycleAuthzRaw.localMachineOnlyActions, 'gatewayHttp.lifecycleAuthz.localMachineOnlyActions')
			: [...DEFAULT_LOCAL_MACHINE_ONLY_ACTIONS];

		gatewayHttp = {
			lifecycleAuthz: {
				enabledActions,
				localMachineOnlyActions,
			},
		};
	}

	return {
		configVersion: configVersion ?? MESSAGING_GATEWAY_CONFIG_SCHEMA_VERSION,
		schemaVersion: MESSAGING_GATEWAY_CONFIG_SCHEMA_VERSION,
		contractVersion: MESSAGING_GATEWAY_CONFIG_CONTRACT_VERSION,
		compatibility: {
			normalizedFrom,
			deterministic: true,
		},
		mode: modeRaw,
		acp,
		sandboxLifecycle,
		discord,
		telegram,
		workspaces: {
			allowedRoots,
			activeRoot,
		},
		gatewayHttp,
	};
}

export function resolveSandboxLifecycleConfig(
	config: MessagingGatewayConfig['sandboxLifecycle'] | undefined,
): ResolvedSandboxLifecycleConfig {
	const start = config?.portRange?.start ?? DEFAULT_SANDBOX_PORT_RANGE_START;
	const end = config?.portRange?.end ?? DEFAULT_SANDBOX_PORT_RANGE_END;

	return {
		maxSandboxes: config?.maxSandboxes ?? DEFAULT_SANDBOX_MAX_SANDBOXES,
		portRange: { start, end },
		cleanupOnStartup: config?.cleanupOnStartup ?? DEFAULT_SANDBOX_CLEANUP_ON_STARTUP,
		staleTtlMs: config?.staleTtlMs ?? DEFAULT_SANDBOX_STALE_TTL_MS,
	};
}

function readConfigFromEnvJson(): LoadedMessagingGatewayConfig | undefined {
	const json = process.env[MESSAGING_GATEWAY_CONFIG_JSON_ENV];
	if (!json || json.trim().length === 0) return undefined;

	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		throw new Error(`[Gateway] Invalid config: ${MESSAGING_GATEWAY_CONFIG_JSON_ENV} is not valid JSON`);
	}

	return {
		configPath: `(env:${MESSAGING_GATEWAY_CONFIG_JSON_ENV})`,
		config: validateAndNormalizeConfig(parsed),
	};
}

export function loadMessagingGatewayConfig(configPathFromCli?: string): LoadedMessagingGatewayConfig {
	const fromEnvJson = readConfigFromEnvJson();
	if (fromEnvJson) return fromEnvJson;

	const configPath = resolveMessagingGatewayConfigPath(configPathFromCli);

	if (!fs.existsSync(configPath)) {
		throw new Error(
			`[Gateway] Missing config file: ${configPath}\n` +
				`[Gateway] Set ${MESSAGING_GATEWAY_CONFIG_PATH_ENV} to a JSON config file path, or set ${MESSAGING_GATEWAY_CONFIG_JSON_ENV} to inline JSON.\n` +
				`[Gateway] See local-tracker/docs/messaging-gateway.md (Step 3) for an example config.`,
		);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
	} catch {
		throw new Error(`[Gateway] Invalid config: failed to read/parse JSON at ${configPath}`);
	}

	return {
		configPath,
		config: validateAndNormalizeConfig(parsed),
	};
}
