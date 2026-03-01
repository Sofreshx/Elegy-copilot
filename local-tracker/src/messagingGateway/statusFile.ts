import fs from 'fs';
import os from 'os';
import path from 'path';

export const MESSAGING_GATEWAY_STATUS_FILENAME = 'messaging-gateway.status.json';
export const MESSAGING_GATEWAY_STATUS_DIRNAME = '.instruction-engine';
export const MESSAGING_GATEWAY_READINESS_CONTRACT_VERSION = 'messaging_gateway_readiness_v1';
export const MESSAGING_GATEWAY_DISCOVERY_TELEMETRY_CONTRACT_VERSION = 'skill_discovery_telemetry_v1';
export const MESSAGING_GATEWAY_DISCOVERY_TELEMETRY_DEFAULT_SAMPLE_CAPACITY = 12;
export type MessagingGatewayReadinessState = 'ready' | 'not_ready' | 'disconnected';
export type MessagingGatewayReadinessReasonCode = 'gateway_ready' | 'gateway_not_ready' | 'gateway_disconnected';
export type MessagingGatewayDiscoveryMissReason = 'keyword_miss' | 'ambiguity' | 'stale_map' | 'no_route';

export interface MessagingGatewayDiscoveryTelemetrySummary {
	contractVersion: typeof MESSAGING_GATEWAY_DISCOVERY_TELEMETRY_CONTRACT_VERSION;
	sample: {
		capacity: number;
		size: number;
		dropped: number;
		deterministic: true;
	};
	countersByReason: Record<MessagingGatewayDiscoveryMissReason, number>;
	recent: Array<{
		sequence: number;
		reason: MessagingGatewayDiscoveryMissReason;
		command: string;
		detail: string;
	}>;
}

export interface MessagingGatewayStatusV1 {
	schemaVersion: 1;
	contractVersion: typeof MESSAGING_GATEWAY_READINESS_CONTRACT_VERSION;
	compatibility: {
		normalizedFrom: 'v0' | 'v1';
		deterministic: true;
	};
	readiness: {
		state: MessagingGatewayReadinessState;
		reasonCode: MessagingGatewayReadinessReasonCode;
		deterministic: true;
	};
	lastUpdatedUtc: string;

	config: {
		configPath: string;
		mode: 'connected' | 'disconnected';
		discord?: {
			guildId: string;
			channelId: string;
			permissionsChannelId?: string;
		};
		telegram?: {
			allowlistedUsersCount: number;
		};
		allowlists: {
			discordUsersCount: number;
			workspaceRootsCount: number;
		};
		workspaces: {
			activeRoot: string;
		};
	};

	secrets: {
		discordBotToken: {
			present: boolean;
			fromKeychain: boolean;
			fromEnv: boolean;
		};
		gatewayHttpToken: {
			present: boolean;
			fromKeychain: boolean;
			fromEnv: boolean;
		};
		telegramBotToken: {
			present: boolean;
			fromKeychain: boolean;
			fromEnv: boolean;
		};
	};

	runtime: {
		discord: {
			connected: boolean;
			ready: boolean;
		};
		discoveryTelemetry: MessagingGatewayDiscoveryTelemetrySummary;
		telegram?: {
			connected: boolean;
			ready: boolean;
		};
		acp?: {
			connected: boolean;
		};
		sessions?: {
			activeSessionThreadCount: number;
		};
		/** Adapter health snapshots from HealthRegistry */
		adapterHealth?: Array<{
			adapterId: string;
			kind: string;
			state: string;
			detail?: string;
			lastCheckedUtc: string;
		}>;
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function asOptionalString(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function asBoolean(value: unknown, fallback: boolean = false): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

function asNonNegativeInteger(value: unknown, fallback: number = 0): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
		return fallback;
	}
	return value;
}

function normalizeSecretStatus(raw: unknown): { present: boolean; fromKeychain: boolean; fromEnv: boolean } {
	const source = isRecord(raw) ? raw : {};
	return {
		present: asBoolean(source.present, false),
		fromKeychain: asBoolean(source.fromKeychain, false),
		fromEnv: asBoolean(source.fromEnv, false),
	};
}

function createDiscoveryCounters(raw: unknown): Record<MessagingGatewayDiscoveryMissReason, number> {
	const source = isRecord(raw) ? raw : {};
	return {
		keyword_miss: asNonNegativeInteger(source.keyword_miss, 0),
		ambiguity: asNonNegativeInteger(source.ambiguity, 0),
		stale_map: asNonNegativeInteger(source.stale_map, 0),
		no_route: asNonNegativeInteger(source.no_route, 0),
	};
}

function asDiscoveryMissReason(value: unknown): MessagingGatewayDiscoveryMissReason | undefined {
	if (value === 'keyword_miss' || value === 'ambiguity' || value === 'stale_map' || value === 'no_route') {
		return value;
	}
	return undefined;
}

function normalizeDiscoveryTelemetry(raw: unknown): MessagingGatewayDiscoveryTelemetrySummary {
	const source = isRecord(raw) ? raw : {};
	const sourceSample = isRecord(source.sample) ? source.sample : {};
	const recent = Array.isArray(source.recent)
		? source.recent
			.filter((item): item is Record<string, unknown> => isRecord(item))
			.map((item) => {
				const reason = asDiscoveryMissReason(item.reason) ?? 'no_route';
				return {
					sequence: asNonNegativeInteger(item.sequence, 0),
					reason,
					command: asOptionalString(item.command) ?? '(unknown)',
					detail: asOptionalString(item.detail) ?? '',
				};
			})
		: [];

	const capacity = asNonNegativeInteger(
		sourceSample.capacity,
		MESSAGING_GATEWAY_DISCOVERY_TELEMETRY_DEFAULT_SAMPLE_CAPACITY,
	);

	const boundedRecent = recent.slice(Math.max(0, recent.length - capacity));

	return {
		contractVersion:
			asOptionalString(source.contractVersion) === MESSAGING_GATEWAY_DISCOVERY_TELEMETRY_CONTRACT_VERSION
				? MESSAGING_GATEWAY_DISCOVERY_TELEMETRY_CONTRACT_VERSION
				: MESSAGING_GATEWAY_DISCOVERY_TELEMETRY_CONTRACT_VERSION,
		sample: {
			capacity,
			size: boundedRecent.length,
			dropped: asNonNegativeInteger(sourceSample.dropped, 0),
			deterministic: true,
		},
		countersByReason: createDiscoveryCounters(source.countersByReason),
		recent: boundedRecent,
	};
}

export function deriveMessagingGatewayReadiness(runtime: {
	discord?: { connected: boolean; ready: boolean };
	telegram?: { connected: boolean; ready: boolean };
} | undefined): {
	state: MessagingGatewayReadinessState;
	reasonCode: MessagingGatewayReadinessReasonCode;
	deterministic: true;
} {
	const platforms = [runtime?.discord, runtime?.telegram].filter(
		(platform): platform is { connected: boolean; ready: boolean } => Boolean(platform),
	);

	if (platforms.length === 0) {
		return {
			state: 'disconnected',
			reasonCode: 'gateway_disconnected',
			deterministic: true,
		};
	}

	if (platforms.some((platform) => platform.connected === true && platform.ready === true)) {
		return {
			state: 'ready',
			reasonCode: 'gateway_ready',
			deterministic: true,
		};
	}

	if (platforms.some((platform) => platform.connected === true)) {
		return {
			state: 'not_ready',
			reasonCode: 'gateway_not_ready',
			deterministic: true,
		};
	}

	return {
		state: 'disconnected',
		reasonCode: 'gateway_disconnected',
		deterministic: true,
	};
}

export function normalizeMessagingGatewayStatusV1(input: unknown): MessagingGatewayStatusV1 {
	const source = isRecord(input) ? input : {};
	const sourceConfig = isRecord(source.config) ? source.config : {};
	const sourceConfigDiscord = isRecord(sourceConfig.discord) ? sourceConfig.discord : undefined;
	const sourceConfigTelegram = isRecord(sourceConfig.telegram) ? sourceConfig.telegram : undefined;
	const sourceConfigAllowlists = isRecord(sourceConfig.allowlists) ? sourceConfig.allowlists : {};
	const sourceConfigWorkspaces = isRecord(sourceConfig.workspaces) ? sourceConfig.workspaces : {};
	const sourceSecrets = isRecord(source.secrets) ? source.secrets : {};
	const sourceRuntime = isRecord(source.runtime) ? source.runtime : {};
	const sourceRuntimeDiscord = isRecord(sourceRuntime.discord) ? sourceRuntime.discord : {};
	const sourceRuntimeTelegram = isRecord(sourceRuntime.telegram) ? sourceRuntime.telegram : undefined;
	const sourceRuntimeAcp = isRecord(sourceRuntime.acp) ? sourceRuntime.acp : undefined;
	const sourceRuntimeSessions = isRecord(sourceRuntime.sessions) ? sourceRuntime.sessions : {};
	const sourceRuntimeDiscoveryTelemetry = isRecord(sourceRuntime.discoveryTelemetry)
		? sourceRuntime.discoveryTelemetry
		: undefined;

	const normalizedFrom: 'v0' | 'v1' =
		source.schemaVersion === 1 || source.contractVersion === MESSAGING_GATEWAY_READINESS_CONTRACT_VERSION
			? 'v1'
			: 'v0';

	const runtimeDiscord = {
		connected: asBoolean(sourceRuntimeDiscord.connected, asBoolean(source.connected, false)),
		ready: asBoolean(sourceRuntimeDiscord.ready, asBoolean(source.ready, false)),
	};

	const runtime: MessagingGatewayStatusV1['runtime'] = {
		discord: runtimeDiscord,
		discoveryTelemetry: normalizeDiscoveryTelemetry(sourceRuntimeDiscoveryTelemetry),
	};

	if (sourceRuntimeTelegram) {
		runtime.telegram = {
			connected: asBoolean(sourceRuntimeTelegram.connected, false),
			ready: asBoolean(sourceRuntimeTelegram.ready, false),
		};
	}

	if (sourceRuntimeAcp) {
		runtime.acp = {
			connected: asBoolean(sourceRuntimeAcp.connected, false),
		};
	}

	const activeSessionThreadCount = asNonNegativeInteger(
		sourceRuntimeSessions.activeSessionThreadCount,
		asNonNegativeInteger(source.activeSessionThreadCount, 0),
	);
	runtime.sessions = {
		activeSessionThreadCount,
	};

	if (Array.isArray(sourceRuntime.adapterHealth)) {
		runtime.adapterHealth = sourceRuntime.adapterHealth
			.filter((item): item is Record<string, unknown> => isRecord(item))
			.map((item) => ({
				adapterId: asOptionalString(item.adapterId) ?? 'unknown',
				kind: asOptionalString(item.kind) ?? 'unknown',
				state: asOptionalString(item.state) ?? 'unknown',
				detail: asOptionalString(item.detail),
				lastCheckedUtc: asOptionalString(item.lastCheckedUtc) ?? new Date(0).toISOString(),
			}));
	}

	const config: MessagingGatewayStatusV1['config'] = {
		configPath: asOptionalString(sourceConfig.configPath) ?? asOptionalString(source.configPath) ?? '(unknown)',
		mode: sourceConfig.mode === 'connected' ? 'connected' : 'disconnected',
		allowlists: {
			discordUsersCount: asNonNegativeInteger(sourceConfigAllowlists.discordUsersCount, 0),
			workspaceRootsCount: asNonNegativeInteger(sourceConfigAllowlists.workspaceRootsCount, 0),
		},
		workspaces: {
			activeRoot: asOptionalString(sourceConfigWorkspaces.activeRoot) ?? asOptionalString(source.activeWorkspaceRoot) ?? '',
		},
	};

	if (sourceConfigDiscord) {
		const guildId = asOptionalString(sourceConfigDiscord.guildId);
		const channelId = asOptionalString(sourceConfigDiscord.channelId);
		if (guildId && channelId) {
			config.discord = {
				guildId,
				channelId,
				permissionsChannelId: asOptionalString(sourceConfigDiscord.permissionsChannelId),
			};
		}
	}

	if (sourceConfigTelegram) {
		config.telegram = {
			allowlistedUsersCount: asNonNegativeInteger(sourceConfigTelegram.allowlistedUsersCount, 0),
		};
	}

	return {
		schemaVersion: 1,
		contractVersion: MESSAGING_GATEWAY_READINESS_CONTRACT_VERSION,
		compatibility: {
			normalizedFrom,
			deterministic: true,
		},
		readiness: deriveMessagingGatewayReadiness(runtime),
		lastUpdatedUtc: asOptionalString(source.lastUpdatedUtc) ?? new Date().toISOString(),
		config,
		secrets: {
			discordBotToken: normalizeSecretStatus(sourceSecrets.discordBotToken),
			gatewayHttpToken: normalizeSecretStatus(sourceSecrets.gatewayHttpToken),
			telegramBotToken: normalizeSecretStatus(sourceSecrets.telegramBotToken),
		},
		runtime,
	};
}

export function getDefaultMessagingGatewayStatusPath(): string {
	return path.resolve(path.join(os.homedir(), MESSAGING_GATEWAY_STATUS_DIRNAME, MESSAGING_GATEWAY_STATUS_FILENAME));
}

export function resolveMessagingGatewayStatusPath(configPath: string): string {
	// WU-014 requirement + extension reader both assume the default home-based path.
	// Keep the signature (configPath) for future evolution, but always write to default for now.
	void configPath;
	return getDefaultMessagingGatewayStatusPath();
}

function ensureParentDir(filePath: string): void {
	const dir = path.dirname(filePath);
	if (!dir) return;
	fs.mkdirSync(dir, { recursive: true });
}

function writeAtomicFile(destPath: string, contents: string): void {
	ensureParentDir(destPath);

	const dir = path.dirname(destPath);
	const tmpName = `${path.basename(destPath)}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
	const tmpPath = path.join(dir, tmpName);

	fs.writeFileSync(tmpPath, contents, 'utf8');

	try {
		fs.renameSync(tmpPath, destPath);
		return;
	} catch {
		// Some platforms cannot rename over an existing file.
		try {
			if (fs.existsSync(destPath)) {
				fs.unlinkSync(destPath);
			}
			fs.renameSync(tmpPath, destPath);
			return;
		} catch {
			// Best-effort cleanup.
			try {
				if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
			} catch {
				// ignore
			}
			throw new Error(`[Gateway] Failed to write status file: ${destPath}`);
		}
	}
}

export class MessagingGatewayStatusWriter {
	private readonly status: MessagingGatewayStatusV1;
	private heartbeatTimer: NodeJS.Timeout | undefined;

	constructor(
		private readonly statusPath: string,
		status: unknown,
	) {
		this.status = normalizeMessagingGatewayStatusV1(status);
	}

	getPath(): string {
		return this.statusPath;
	}

	stopHeartbeat(): void {
		if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
		this.heartbeatTimer = undefined;
	}

	startHeartbeat(intervalMs: number, onBeat: (status: MessagingGatewayStatusV1) => void): void {
		this.stopHeartbeat();
		this.heartbeatTimer = setInterval(() => {
			try {
				onBeat(this.status);
				this.writeNow();
			} catch {
				// Heartbeat is best-effort; do not crash the gateway.
			}
		}, intervalMs);
	}

	update(mutator: (status: MessagingGatewayStatusV1) => void): void {
		try {
			mutator(this.status);
			this.writeNow();
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`[Gateway] Status write failed: ${message}`);
		}
	}

	writeNow(): void {
		this.status.lastUpdatedUtc = new Date().toISOString();
		const json = JSON.stringify(this.status, null, 2);
		writeAtomicFile(this.statusPath, json);
	}
}
