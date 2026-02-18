import fs from 'fs';
import os from 'os';
import path from 'path';

export type MessagingGatewayMode = 'auto' | 'connected' | 'disconnected';
export type MessagingGatewayConnectedBridge = 'extension-ws' | 'acp';

export interface MessagingGatewayConfig {
	mode?: MessagingGatewayMode;
	/** Connected mode bridge implementation. Defaults to 'extension-ws'. */
	connectedBridge?: MessagingGatewayConnectedBridge;
	/** ACP (Copilot CLI `--acp --port <N>`) settings. Used when connectedBridge='acp'. */
	acp?: {
		host?: string;
		port?: number;
	};
	discord: {
		allowlistedUserIds: string[];
		guildId: string;
		channelId: string;
		permissionsChannelId?: string;
	};
	workspaces: {
		allowedRoots: string[];
		activeRoot: string;
	};
}

export interface LoadedMessagingGatewayConfig {
	configPath: string;
	config: MessagingGatewayConfig;
}

const CONFIG_PATH_ENV = 'INSTRUCTION_ENGINE_GATEWAY_CONFIG_PATH';
const CONFIG_JSON_ENV = 'INSTRUCTION_ENGINE_GATEWAY_CONFIG_JSON';

export function getDefaultMessagingGatewayConfigPath(): string {
	return path.join(os.homedir(), '.instruction-engine', 'messaging-gateway.config.json');
}

export function resolveMessagingGatewayConfigPath(configPathFromCli?: string): string {
	return (
		configPathFromCli?.trim() ||
		process.env[CONFIG_PATH_ENV]?.trim() ||
		getDefaultMessagingGatewayConfigPath()
	);
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

function asOptionalPort(value: unknown, field: string): number | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < 1 || value > 65535) {
		throw new Error(`[Gateway] Invalid config: ${field} must be an integer port (1-65535)`);
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

	const modeRaw = raw.mode;
	if (
		modeRaw !== undefined &&
		modeRaw !== 'auto' &&
		modeRaw !== 'connected' &&
		modeRaw !== 'disconnected'
	) {
		throw new Error('[Gateway] Invalid config: mode must be one of auto|connected|disconnected');
	}

	const connectedBridgeRaw = raw.connectedBridge;
	if (
		connectedBridgeRaw !== undefined &&
		connectedBridgeRaw !== 'extension-ws' &&
		connectedBridgeRaw !== 'acp'
	) {
		throw new Error('[Gateway] Invalid config: connectedBridge must be one of extension-ws|acp');
	}

	let acp: MessagingGatewayConfig['acp'] | undefined;
	if (raw.acp !== undefined && raw.acp !== null) {
		if (!isRecord(raw.acp)) throw new Error('[Gateway] Invalid config: acp must be an object');
		const host = raw.acp.host !== undefined && raw.acp.host !== null ? asNonEmptyString(raw.acp.host, 'acp.host') : undefined;
		const port = asOptionalPort(raw.acp.port, 'acp.port');
		acp = { host, port };
	}

	const discordRaw = raw.discord;
	if (!isRecord(discordRaw)) {
		throw new Error('[Gateway] Invalid config: discord must be an object');
	}

	const allowlistedUserIds = asStringArray(discordRaw.allowlistedUserIds, 'discord.allowlistedUserIds');
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

	const workspacesRaw = raw.workspaces;
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

	return {
		mode: modeRaw,
		connectedBridge: connectedBridgeRaw,
		acp,
		discord: {
			allowlistedUserIds,
			guildId,
			channelId,
			permissionsChannelId,
		},
		workspaces: {
			allowedRoots,
			activeRoot,
		},
	};
}

function readConfigFromEnvJson(): LoadedMessagingGatewayConfig | undefined {
	const json = process.env[CONFIG_JSON_ENV];
	if (!json || json.trim().length === 0) return undefined;

	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		throw new Error(`[Gateway] Invalid config: ${CONFIG_JSON_ENV} is not valid JSON`);
	}

	return {
		configPath: `(env:${CONFIG_JSON_ENV})`,
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
				`[Gateway] Set ${CONFIG_PATH_ENV} to a JSON config file path, or set ${CONFIG_JSON_ENV} to inline JSON.\n` +
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
