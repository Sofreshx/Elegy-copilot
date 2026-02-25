import fs from 'fs';
import childProcess from 'child_process';
import path from 'path';

import type { LifecycleAction, MessagingGatewayConfig, MessagingGatewayMode, ResolvedSandboxLifecycleConfig } from './config';
import { GatewayHttpServer } from './gatewayHttpServer';
import {
	getDefaultMessagingGatewayConfigPath,
	loadMessagingGatewayConfig,
	resolveMessagingGatewayConfigPath,
	resolveSandboxLifecycleConfig,
} from './config';
import { AuditLogger } from './auditLogger';
import { CommandRouter, WU002_POLICY_CONTRACT } from './commandRouter';
import { DiscordPlatform } from './discordPlatform';
import type { BridgeClient } from './bridgeClient';
import { AcpBridgeClient } from './acpBridgeClient';
import { PermissionOrchestrator } from './permissionOrchestrator';
import { SessionThreadManager } from './sessionThreadManager';
import { formatSessionLine, isActiveSessionStatus, parseBridgeSessions } from './sessionsHelpers';
import { deleteGatewaySecret, ensureGatewayHttpToken, getGatewaySecret, getGatewaySecretsStatus, storeGatewaySecretFromEnv } from './secrets';
import { detectModeAuto } from './workspaceDetection';
import { printGatewayStatusSummary } from './status';
import { MessagingGatewayStatusWriter, resolveMessagingGatewayStatusPath, type MessagingGatewayStatusV1 } from './statusFile';
import { ContainerManager, type ContainerManagerOptions } from './containerManager';
import { PortAllocator, type PortAllocatorOptions } from './portAllocator';
import { createLifecycleOperationsHandler } from './lifecycleOperations';
import { createSandboxEventRouter, SandboxRegistry } from './sandboxRegistry';
import { cleanupSandboxDirs, resolveSandboxDirs } from './sandboxDirs';
import {
	assertValidOpenTerminalPayload,
	buildTerminalLaunchTemplate,
	isLifecyclePayloadValidationError,
	LifecyclePayloadValidationError,
	type OpenTerminalPayload,
} from './lifecycleOpenTerminal';

function isLoopbackAddress(address: string | undefined): boolean {
	if (!address) return false;
	return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function resolvePolicyValidatorPath(): string | null {
	const candidates = [
		path.resolve(process.cwd(), '../scripts/validate-policy-lockfiles.js'),
		path.resolve(process.cwd(), 'scripts/validate-policy-lockfiles.js'),
		path.resolve(__dirname, '../../../scripts/validate-policy-lockfiles.js'),
	];

	for (const candidate of candidates) {
		if (fs.existsSync(candidate)) return candidate;
	}

	return null;
}

type CliMode = MessagingGatewayMode;

interface CliArgs {
	configPath?: string;
	mode?: CliMode;
	storeDiscordBotToken?: boolean;
	deleteDiscordBotToken?: boolean;
	storeGatewayHttpToken?: boolean;
	deleteGatewayHttpToken?: boolean;
	printConfigPath?: boolean;
	help?: boolean;
}

export interface SandboxLifecycleRuntime {
	lifecycleConfig: ResolvedSandboxLifecycleConfig;
	containerManager: ContainerManager;
	portAllocator: PortAllocator;
}

export interface SandboxLifecycleRuntimeFactory {
	createContainerManager: (options: ContainerManagerOptions) => ContainerManager;
	createPortAllocator: (options: PortAllocatorOptions) => PortAllocator;
}

const DEFAULT_SANDBOX_LIFECYCLE_RUNTIME_FACTORY: SandboxLifecycleRuntimeFactory = {
	createContainerManager: (options) => new ContainerManager(options),
	createPortAllocator: (options) => new PortAllocator(options),
};

export function createSandboxLifecycleRuntime(
	sandboxLifecycleConfig: MessagingGatewayConfig['sandboxLifecycle'],
	factory: SandboxLifecycleRuntimeFactory = DEFAULT_SANDBOX_LIFECYCLE_RUNTIME_FACTORY,
): SandboxLifecycleRuntime {
	const lifecycleConfig = resolveSandboxLifecycleConfig(sandboxLifecycleConfig);
	return {
		lifecycleConfig,
		containerManager: factory.createContainerManager({
			maxSandboxes: lifecycleConfig.maxSandboxes,
		}),
		portAllocator: factory.createPortAllocator({
			rangeStart: lifecycleConfig.portRange.start,
			rangeEnd: lifecycleConfig.portRange.end,
		}),
	};
}

function printHelp() {
	console.log(`Messaging Gateway (scaffold)

Usage:
  npm run dev:gateway -- [--config <path>] [--mode auto|connected|disconnected]

Utility:
	--print-config-path     Print the resolved config path (or env JSON source) and exit

Config:
  INSTRUCTION_ENGINE_GATEWAY_CONFIG_PATH=<path> (default: ~/.instruction-engine/messaging-gateway.config.json)
  INSTRUCTION_ENGINE_GATEWAY_CONFIG_JSON=<inline-json>

Secrets (preferred: OS keychain; fallback: env vars):
  Discord bot token env fallbacks: INSTRUCTION_ENGINE_DISCORD_BOT_TOKEN, DISCORD_BOT_TOKEN

ACP (Copilot CLI \`copilot --acp --port <N>\`) env overrides:
  INSTRUCTION_ENGINE_ACP_HOST=127.0.0.1
  INSTRUCTION_ENGINE_ACP_PORT=3000

Keychain utilities (reads token from env and stores in OS credential store):
  --store-discord-bot-token
  --delete-discord-bot-token
  --store-gateway-http-token
  --delete-gateway-http-token
`);
}

function parseArgs(argv: string[]): CliArgs {
	const out: CliArgs = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--help' || arg === '-h') out.help = true;
		else if (arg === '--config') out.configPath = argv[++i];
		else if (arg.startsWith('--config=')) out.configPath = arg.slice('--config='.length);
		else if (arg === '--mode') out.mode = argv[++i] as CliMode;
		else if (arg.startsWith('--mode=')) out.mode = arg.slice('--mode='.length) as CliMode;
		else if (arg === '--store-discord-bot-token') out.storeDiscordBotToken = true;
		else if (arg === '--delete-discord-bot-token') out.deleteDiscordBotToken = true;
		else if (arg === '--store-gateway-http-token') out.storeGatewayHttpToken = true;
		else if (arg === '--delete-gateway-http-token') out.deleteGatewayHttpToken = true;
		else if (arg === '--print-config-path') out.printConfigPath = true;
		else throw new Error(`[Gateway] Unknown argument: ${arg}`);
	}
	return out;
}

function resolveRequestedMode(cli: CliMode | undefined, configMode: CliMode | undefined): CliMode {
	const envMode = (process.env.INSTRUCTION_ENGINE_GATEWAY_MODE || '').trim();
	const requested = cli || (envMode as CliMode) || configMode || 'auto';
	if (requested !== 'auto' && requested !== 'connected' && requested !== 'disconnected') {
		throw new Error('[Gateway] Invalid mode (expected auto|connected|disconnected)');
	}
	return requested;
}

function parseOptionalEnvPort(envValue: string | undefined): number | undefined {
	const raw = (envValue || '').trim();
	if (!raw) return undefined;
	const n = Number(raw);
	if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 65535) {
		throw new Error('[Gateway] Invalid INSTRUCTION_ENGINE_ACP_PORT (expected integer 1-65535)');
	}
	return n;
}

async function handleSecretUtilityFlags(args: CliArgs): Promise<boolean> {
	const flags = [
		args.storeDiscordBotToken,
		args.deleteDiscordBotToken,
		args.storeGatewayHttpToken,
		args.deleteGatewayHttpToken,
	].filter(Boolean);
	if (flags.length === 0) return false;
	if (flags.length > 1) {
		throw new Error('[Gateway] Only one secret utility flag can be used at a time');
	}

	if (args.storeDiscordBotToken) {
		await storeGatewaySecretFromEnv('discordBotToken');
		console.log('[Gateway] Stored discord bot token in OS credential store');
		return true;
	}
	if (args.deleteDiscordBotToken) {
		const deleted = await deleteGatewaySecret('discordBotToken');
		console.log(`[Gateway] Deleted discord bot token from OS credential store: ${deleted ? 'ok' : 'not found'}`);
		return true;
	}
	if (args.storeGatewayHttpToken) {
		await storeGatewaySecretFromEnv('gatewayHttpToken');
		console.log('[Gateway] Stored gateway HTTP token in OS credential store');
		return true;
	}
	if (args.deleteGatewayHttpToken) {
		const deleted = await deleteGatewaySecret('gatewayHttpToken');
		console.log(`[Gateway] Deleted gateway HTTP token from OS credential store: ${deleted ? 'ok' : 'not found'}`);
		return true;
	}

	return false;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		printHelp();
		return;
	}

	if (args.printConfigPath) {
		if ((process.env.INSTRUCTION_ENGINE_GATEWAY_CONFIG_JSON || '').trim().length > 0) {
			console.log('(env:INSTRUCTION_ENGINE_GATEWAY_CONFIG_JSON)');
			return;
		}
		console.log(resolveMessagingGatewayConfigPath(args.configPath || process.env.INSTRUCTION_ENGINE_GATEWAY_CONFIG_PATH));
		console.log(`(default: ${getDefaultMessagingGatewayConfigPath()})`);
		return;
	}

	if (await handleSecretUtilityFlags(args)) return;

	const loaded = loadMessagingGatewayConfig(args.configPath);

	const requestedMode = resolveRequestedMode(args.mode, loaded.config.mode);
	let activeWorkspaceRoot = loaded.config.workspaces.activeRoot;
	const acpHost = (process.env.INSTRUCTION_ENGINE_ACP_HOST || loaded.config.acp?.host || '127.0.0.1').trim();
	const acpPort = parseOptionalEnvPort(process.env.INSTRUCTION_ENGINE_ACP_PORT) ?? loaded.config.acp?.port;
	const mode = requestedMode === 'auto' ? detectModeAuto(acpPort) : requestedMode;
	const secretsStatus = await getGatewaySecretsStatus();

	const discordBotToken = await getGatewaySecret('discordBotToken');
	if (!discordBotToken.value) {
		throw new Error(
			'[Gateway] Missing required secret: Discord bot token. Store it in the OS credential store (preferred) or set INSTRUCTION_ENGINE_DISCORD_BOT_TOKEN.',
		);
	}

	if (mode === 'connected' && !acpPort) {
		throw new Error(
			'[Gateway] ACP bridge requires a port. Set INSTRUCTION_ENGINE_ACP_PORT or config acp.port, and start Copilot CLI with `copilot --acp --port <PORT>`',
		);
	}

	printGatewayStatusSummary(loaded, {
		mode,
		configPath: loaded.configPath,
		activeWorkspaceRoot,
		allowedWorkspaceRootsCount: loaded.config.workspaces.allowedRoots.length,
		allowlistedDiscordUsersCount: loaded.config.discord.allowlistedUserIds.length,
		discordGuildId: loaded.config.discord.guildId,
		discordChannelId: loaded.config.discord.channelId,
		discordPermissionsChannelId: loaded.config.discord.permissionsChannelId,
		secrets: secretsStatus,
		acpHost,
		acpPort,
	});

	const auditLogger = new AuditLogger({ workspaceRoot: activeWorkspaceRoot });
	const discord = new DiscordPlatform(loaded.config.discord);

	const sessionThreads = new SessionThreadManager({
		minUpdateIntervalMs: 3000,
		postPermissionPrompt: async (req) => {
			// Discord-only: permission prompts are posted into the session thread.
			try {
				await discord.sendPermissionPrompt({
					threadId: req.threadId,
					callbackId: req.callbackId,
					summary: req.summary,
				});
			} catch {
				// Best-effort: ignore (Discord not ready / thread archived / rate limit).
			}
		},
		markPermissionResolved: async (res) => {
			try {
				await discord.markPermissionPromptResolved({
					callbackId: res.callbackId,
					approved: res.approved,
					resolvedBy: res.resolvedBy,
					timedOut: res.timedOut,
				});
			} catch {
				// ignore
			}
		},
	});

	const statusWriter = new MessagingGatewayStatusWriter(
		resolveMessagingGatewayStatusPath(loaded.configPath),
		{
			schemaVersion: 1,
			lastUpdatedUtc: new Date().toISOString(),
			config: {
				configPath: loaded.configPath,
				mode,
				discord: {
					guildId: loaded.config.discord.guildId,
					channelId: loaded.config.discord.channelId,
					permissionsChannelId: loaded.config.discord.permissionsChannelId,
				},
				allowlists: {
					discordUsersCount: loaded.config.discord.allowlistedUserIds.length,
					workspaceRootsCount: loaded.config.workspaces.allowedRoots.length,
				},
				workspaces: {
					activeRoot: activeWorkspaceRoot,
				},
			},
			secrets: {
				discordBotToken: {
					present: secretsStatus.discordBotToken.present,
					fromKeychain: secretsStatus.discordBotToken.source === 'keychain',
					fromEnv: secretsStatus.discordBotToken.source === 'env',
				},
				gatewayHttpToken: {
					present: secretsStatus.gatewayHttpToken.present,
					fromKeychain: secretsStatus.gatewayHttpToken.source === 'keychain',
					fromEnv: secretsStatus.gatewayHttpToken.source === 'env',
				},
			},
			runtime: {
				discord: {
					connected: false,
					ready: false,
				},
				acp: mode === 'connected' ? { connected: false } : undefined,
				sessions: {
					activeSessionThreadCount: 0,
				},
			},
		} satisfies MessagingGatewayStatusV1,
	);

	let acpConnected = false;
	let gatewayHttpServer: GatewayHttpServer | undefined;
	function refreshDynamicStatusFields(status: MessagingGatewayStatusV1): void {
		status.config.workspaces.activeRoot = activeWorkspaceRoot;
		if (status.runtime.sessions) {
			status.runtime.sessions.activeSessionThreadCount = sessionThreads.getActiveSessionThreadCount();
		}
		if (mode === 'connected') {
			if (!status.runtime.acp) status.runtime.acp = { connected: false };
			status.runtime.acp.connected = acpConnected;
		}
	}

	// Write once on startup after config + secrets resolved.
	statusWriter.update((s) => refreshDynamicStatusFields(s));
	// Heartbeat: refresh timestamp + dynamic fields.
	statusWriter.startHeartbeat(15_000, (s) => refreshDynamicStatusFields(s));

	// --- Sandbox Container Manager ---
	// Initialize early so reconcile() cleans orphaned containers before accepting commands.
	const sandboxLifecycleRuntime = createSandboxLifecycleRuntime(loaded.config.sandboxLifecycle);
	const { containerManager, portAllocator, lifecycleConfig: sandboxLifecycleConfig } = sandboxLifecycleRuntime;
	try {
		await containerManager.reconcile();
		console.log('[Gateway] Sandbox container reconciliation complete (orphans cleaned)');
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[Gateway] Sandbox container reconciliation failed (non-fatal): ${message}`);
	}

	let knownSandboxIds = new Set<string>();
	let activeSandboxIds = new Set<string>();
	let hasContainerSnapshot = true;
	try {
		const containers = await containerManager.list();
		knownSandboxIds = new Set(
			containers
				.map((container) => container.sandboxId)
				.filter((sandboxId): sandboxId is string => typeof sandboxId === 'string' && sandboxId.trim().length > 0),
		);
		activeSandboxIds = new Set(
			containers
				.filter((container) => container.state === 'running')
				.map((container) => container.sandboxId)
				.filter((sandboxId): sandboxId is string => typeof sandboxId === 'string' && sandboxId.trim().length > 0),
		);
	} catch (err) {
		hasContainerSnapshot = false;
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[Gateway] Sandbox container listing failed before dir cleanup (non-fatal): ${message}`);
	}

	if (sandboxLifecycleConfig.cleanupOnStartup) {
		if (!hasContainerSnapshot) {
			console.error('[Gateway] Sandbox dir cleanup skipped (non-fatal): container snapshot unavailable');
		} else {
		try {
			const cleanupResult = cleanupSandboxDirs({
				knownSandboxIds,
				activeSandboxIds,
				staleTtlMs: sandboxLifecycleConfig.staleTtlMs,
			});
			console.log(
				`[Gateway] Sandbox dir cleanup complete (removed=${cleanupResult.removedSandboxIds.length}, failed=${cleanupResult.failedSandboxIds.length}, active_skipped=${cleanupResult.skippedActiveSandboxIds.length}, fresh_skipped=${cleanupResult.skippedFreshSandboxIds.length})`,
			);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`[Gateway] Sandbox dir cleanup failed (non-fatal): ${message}`);
		}
		}
	}

	// --- Sandbox Registry ---
	const sandboxRegistry = new SandboxRegistry({
		onSandboxEvent: (sandboxEvent) => {
			permissionOrchestrator?.handleExtensionEvent(sandboxEvent.event);
			sessionThreads.handleExtensionEvent(sandboxEvent.event);
			gatewayHttpServer?.pushLiveEvent({ type: String((sandboxEvent.event as any)?.type ?? 'sandbox-event'), data: { sandboxId: sandboxEvent.sandboxId, event: sandboxEvent.event } });
		},
		onSandboxStatusChanged: (change) => {
			console.log(`[Gateway] Sandbox ${change.sandboxId} status: ${change.status}`);
		},
	});

	let extensionClient: BridgeClient | undefined;
	let permissionOrchestrator: PermissionOrchestrator | undefined;
	if (mode === 'connected') {
		permissionOrchestrator = new PermissionOrchestrator({
			auditLogger,
			permissionTimeoutMs: 120_000,
			defaultResolvedBy: 'messaging-gateway',
		});

		extensionClient = new AcpBridgeClient({
			host: acpHost,
			port: acpPort!,
			resolveCwd: () => activeWorkspaceRoot,
			onEvent: (event) => {
				permissionOrchestrator?.handleExtensionEvent(event);
				sessionThreads.handleExtensionEvent(event);
				gatewayHttpServer?.pushLiveEvent({ type: String((event as any)?.type ?? 'acp-event'), data: event });
			},
			onStatusChanged: (status) => {
				console.log(`[Gateway] ACP status: ${status}`);
				acpConnected = status === 'connected';
				statusWriter.update((s) => {
					if (!s.runtime.acp) s.runtime.acp = { connected: false };
					s.runtime.acp.connected = acpConnected;
					refreshDynamicStatusFields(s);
				});
			},
		});
		permissionOrchestrator.setClient(extensionClient);

		// Multi-sandbox: resolve the correct BridgeClient per sandbox
		permissionOrchestrator.setClientResolver((sandboxId) => {
			if (sandboxId) {
				const entry = sandboxRegistry.get(sandboxId);
				return entry?.client;
			}
			return extensionClient;
		});

		extensionClient.start();
	}

	// --- Gateway HTTP Server ---
	const httpTokenResult = await ensureGatewayHttpToken();
	const gatewayHttpToken = httpTokenResult.value;
	console.log(`[Gateway] HTTP API token source: ${httpTokenResult.source}`);
	const lifecycleOperations = createLifecycleOperationsHandler({
		auditLogger,
		containerManager,
		sandboxRegistry,
		portAllocator,
		createSandboxBridgeClient: mode === 'connected'
			? ({ sandboxId, hostPort }) => {
				const eventRouter = createSandboxEventRouter(sandboxRegistry, sandboxId);
				return new AcpBridgeClient({
					host: '127.0.0.1',
					port: hostPort,
					resolveCwd: () => resolveSandboxDirs(sandboxId).root,
					onEvent: eventRouter.onEvent,
					onStatusChanged: eventRouter.onStatusChanged,
				});
			}
			: undefined,
	});

	gatewayHttpServer = new GatewayHttpServer({
		bearerToken: gatewayHttpToken,
		getSessions: async () => {
			if (!extensionClient || extensionClient.getStatus() !== 'connected') {
				return [];
			}
			const raw = await extensionClient.get_sessions();
			return parseBridgeSessions(raw);
		},
		getPendingPermissions: () => permissionOrchestrator?.getPending() ?? [],
		approvePermission: async (callbackId, resolvedBy) => {
			if (!permissionOrchestrator) throw new Error('No permission orchestrator available');
			await permissionOrchestrator.approve(callbackId, resolvedBy);
		},
		denyPermission: async (callbackId, resolvedBy) => {
			if (!permissionOrchestrator) throw new Error('No permission orchestrator available');
			await permissionOrchestrator.deny(callbackId, resolvedBy);
		},
		handleLifecycleAction: async (action, payload, req) => {
			if (action !== 'open-terminal') {
				return await lifecycleOperations.handle(action, payload, req);
			}

			const actor = String(req.headers['x-ie-actor'] ?? '').trim() || 'unknown';
			let parsedPayload: OpenTerminalPayload;
			try {
				parsedPayload = assertValidOpenTerminalPayload(payload);
			} catch (err) {
				if (isLifecyclePayloadValidationError(err)) {
					auditLogger.logSecurityEvent('gateway.lifecycle.open_terminal.denied', {
						action,
						code: err.code,
						reason: err.reason,
						actor,
						remoteAddress: req.socket.remoteAddress,
					});
				}
				throw err;
			}

			const sandboxDirs = resolveSandboxDirs(parsedPayload.sandboxId);
			if (!fs.existsSync(sandboxDirs.root) || !fs.statSync(sandboxDirs.root).isDirectory()) {
				const validationError = new LifecyclePayloadValidationError({
					code: 'invalid_lifecycle_payload',
					reason: `sandbox_not_found:${parsedPayload.sandboxId}`,
				});
				auditLogger.logSecurityEvent('gateway.lifecycle.open_terminal.denied', {
					action,
					code: validationError.code,
					reason: validationError.reason,
					sandboxId: parsedPayload.sandboxId,
					actor,
					remoteAddress: req.socket.remoteAddress,
				});
				throw validationError;
			}

			try {
				const template = buildTerminalLaunchTemplate({
					sandboxRoot: sandboxDirs.root,
					launcher: parsedPayload.launcher,
				});

				const child = childProcess.spawn(template.command, template.args, {
					cwd: template.cwd,
					detached: true,
					shell: false,
					stdio: 'ignore',
					windowsHide: false,
				});

				await new Promise<void>((resolve, reject) => {
					let settled = false;
					const finishOk = () => {
						if (settled) return;
						settled = true;
						resolve();
					};
					const finishErr = (error: Error) => {
						if (settled) return;
						settled = true;
						reject(error);
					};

					child.once('spawn', finishOk);
					child.once('error', finishErr);
				});

				child.unref();

				auditLogger.logSecurityEvent('gateway.lifecycle.open_terminal.allowed', {
					action,
					sandboxId: parsedPayload.sandboxId,
					launcher: template.launcher,
					profile: parsedPayload.profile ?? 'default',
					actor,
					remoteAddress: req.socket.remoteAddress,
					pid: child.pid ?? null,
				});

				return {
					launched: true,
					sandboxId: parsedPayload.sandboxId,
					launcher: template.launcher,
					profile: parsedPayload.profile ?? 'default',
					pid: child.pid ?? null,
				};
			} catch (err) {
				if (isLifecyclePayloadValidationError(err)) {
					throw err;
				}

				const message = err instanceof Error ? err.message : String(err);
				auditLogger.logSecurityEvent('gateway.lifecycle.open_terminal.error', {
					action,
					reason: 'launcher_spawn_failed',
					message,
					sandboxId: parsedPayload.sandboxId,
					actor,
					remoteAddress: req.socket.remoteAddress,
				});
				throw err;
			}
		},
		getPolicyGateStatus: (() => {
			let cache: { expiresAt: number; value: { ok: boolean; reason?: string; message?: string } } = {
				expiresAt: 0,
				value: { ok: false, reason: 'policy_gate_uninitialized' },
			};

			return () => {
				const now = Date.now();
				if (now < cache.expiresAt) return cache.value;

				const validatorPath = resolvePolicyValidatorPath();
				if (!validatorPath) {
					cache = {
						expiresAt: now + 10_000,
						value: { ok: false, reason: 'validator_missing', message: 'validate-policy-lockfiles.js not found' },
					};
					return cache.value;
				}

				const result = childProcess.spawnSync(process.execPath, [validatorPath], {
					encoding: 'utf8',
					windowsHide: true,
					maxBuffer: 512 * 1024,
				});

				if (result.status === 0) {
					cache = {
						expiresAt: now + 10_000,
						value: { ok: true, message: String(result.stdout || '').trim() || 'policy gate passed' },
					};
					return cache.value;
				}

				cache = {
					expiresAt: now + 10_000,
					value: {
						ok: false,
						reason: 'validation_failed',
						message: String(result.stderr || result.stdout || '').trim() || 'policy lockfile validation failed',
					},
				};
				return cache.value;
			};
		})(),
		authorizeLifecycleAction: (action: LifecycleAction, req) => {
			const lifecycleAuthz = loaded.config.gatewayHttp?.lifecycleAuthz;
			const enabledActions = new Set<LifecycleAction>(lifecycleAuthz?.enabledActions ?? ['create', 'start', 'stop', 'open-terminal', 'pr-open']);
			const localMachineOnlyActions = new Set<LifecycleAction>(lifecycleAuthz?.localMachineOnlyActions ?? ['open-terminal']);

			if (!enabledActions.has(action)) {
				return { allowed: false, reason: 'action_disabled' };
			}

			if (localMachineOnlyActions.has(action) && !isLoopbackAddress(req.socket.remoteAddress)) {
				return { allowed: false, reason: 'local_machine_only' };
			}

			if (action === 'open-terminal') {
				const actor = String(req.headers['x-ie-actor'] ?? '').trim().toLowerCase();
				if (actor && actor !== 'local-ui') {
					return { allowed: false, reason: 'local_ui_required' };
				}
			}

			return { allowed: true };
		},
	});

	await gatewayHttpServer.start();
	console.log(`[Gateway] HTTP API token (first 8 chars): ${gatewayHttpToken.slice(0, 8)}...`);

	const configIsPersistable = !loaded.configPath.startsWith('(env:');
	async function setActiveWorkspaceRoot(nextWorkspaceRoot: string): Promise<void> {
		activeWorkspaceRoot = nextWorkspaceRoot;
		loaded.config.workspaces.activeRoot = nextWorkspaceRoot;
		if (configIsPersistable) {
			fs.writeFileSync(loaded.configPath, JSON.stringify(loaded.config, null, 2), 'utf8');
		}
		statusWriter.update((s) => {
			s.config.workspaces.activeRoot = nextWorkspaceRoot;
			refreshDynamicStatusFields(s);
		});
	}

	const router = new CommandRouter({
		policy: {
			allowlistedUserIds: loaded.config.discord.allowlistedUserIds,
			requiredGuildId: loaded.config.discord.guildId,
			requiredChannelId: loaded.config.discord.channelId,
			rateLimitsPerMinute: WU002_POLICY_CONTRACT.rateLimitsPerMinute,
			maxActiveInvokeSessionsPerUser: WU002_POLICY_CONTRACT.maxActiveInvokeSessionsPerUser,
			permissionTimeoutMs: WU002_POLICY_CONTRACT.permissionTimeoutMs,
			maxPromptChars: WU002_POLICY_CONTRACT.maxPromptChars,
		},
		workspaces: {
			getActiveWorkspaceRoot: () => activeWorkspaceRoot,
			getAllowedWorkspaceRoots: () => loaded.config.workspaces.allowedRoots,
			setActiveWorkspaceRoot,
		},
		auditLogger,
		extensionClient,
		permissionOrchestrator,
		sandboxRegistry,
	});

	discord.setCommandHandler(async (interaction) => {
		const baseCtx = {
			userId: interaction.context.userId,
			userDisplayName: interaction.context.userDisplayName,
			guildId: interaction.context.guildId,
			channelId: interaction.context.channelId,
			platform: interaction.platform,
		};

		const commandName = interaction.command;
		if (commandName === '/task' || commandName === '/plan') {
			const initial = await interaction.replyInitial('Starting…');
			const connected = extensionClient?.getStatus() === 'connected';
			if (!connected) {
				const result = await router.route({ name: commandName, args: interaction.args }, baseCtx);
				await initial.edit(result.messages[0] ?? 'OK');
				for (const msg of result.messages.slice(1)) {
					await interaction.sendMessage(msg);
				}
				return;
			}

			const prompt =
				typeof (interaction.args as any)?.prompt === 'string'
					? String((interaction.args as any).prompt)
					: '';
			const threadName = `${commandName.slice(1)}: ${prompt}`.trim();
			const thread = await interaction.createThread(threadName);
			await initial.edit(`Created thread: ${thread.name} (id=${thread.id}). Invoking…`);
			await thread.sendMessage('Starting session…');
			const live = await thread.sendMessage('Live status: (waiting for updates)…');

			const result = await router.route({ name: commandName, args: interaction.args }, baseCtx);
			const sessionId = typeof (result.meta as any)?.sessionId === 'string' ? String((result.meta as any).sessionId) : undefined;
			if (sessionId) {
				sessionThreads.attachThread({ sessionId, thread, liveMessage: live });
				await thread.sendMessage(`Session attached: ${sessionId}`);
			}

			// Put the invoked summary into the session thread (not the parent channel).
			await initial.edit(`Invoked. Thread: ${thread.name} (id=${thread.id}).`);
			for (const msg of result.messages) {
				await thread.sendMessage(msg);
			}
			return;
		}

		const result = await router.route({ name: commandName, args: interaction.args }, baseCtx);
		const first = result.messages[0] ?? 'OK';
		await interaction.replyInitial(first);
		for (const msg of result.messages.slice(1)) {
			await interaction.sendMessage(msg);
		}
	});

	await discord.start();
	statusWriter.update((s) => {
		s.runtime.discord.connected = true;
		s.runtime.discord.ready = true;
		refreshDynamicStatusFields(s);
	});

	// Best-effort: keep a single top-level "Sessions summary" message updated in the main channel.
	const sessionsSummary = discord.startSessionsSummary({
		intervalMs: 30_000,
		buildContent: async () => {
			const pending = permissionOrchestrator?.getPending() ?? [];
			const pendingBySessionId = new Map<string, number>();
			for (const p of pending) {
				const sessionId = typeof p.sessionId === 'string' ? p.sessionId : '';
				if (!sessionId) continue;
				pendingBySessionId.set(sessionId, (pendingBySessionId.get(sessionId) ?? 0) + 1);
			}

			const client = extensionClient;
			const connected = client?.getStatus() === 'connected';
			const sessions = connected ? parseBridgeSessions(await client!.get_sessions().catch(() => null)) : [];
			const active = sessions.filter((s) => isActiveSessionStatus(s.status));

			const lines: string[] = [];
			lines.push('Sessions summary');
			lines.push(`Bridge: ${connected ? 'connected' : 'disconnected'}`);
			lines.push(`Pending approvals: ${pending.length}`);
			lines.push(`Active sessions: ${active.length}`);

			for (const s of active.slice(0, 10)) {
				lines.push(formatSessionLine(s, pendingBySessionId.get(s.id)));
			}

			return lines.join('\n');
		},
	});

	console.log('[Gateway] Status OK. Waiting for shutdown (Ctrl+C)...');

	let shuttingDown = false;
	process.on('SIGINT', () => {
		if (shuttingDown) return;
		shuttingDown = true;
		console.log('[Gateway] Shutting down');
		void (async () => {
			try {
				sessionThreads.stop();
				sessionsSummary.stop();
				await permissionOrchestrator?.stop();
				await extensionClient?.stop();
				await discord.stop();
				await gatewayHttpServer?.stop();
				await sandboxRegistry.stopAll();
				await containerManager.stopAll();
				statusWriter.stopHeartbeat();
				statusWriter.update((s) => {
					s.runtime.discord.connected = false;
					s.runtime.discord.ready = false;
					if (s.runtime.acp) s.runtime.acp.connected = false;
					if (s.runtime.sessions) s.runtime.sessions.activeSessionThreadCount = 0;
				});
			} finally {
				process.exit(0);
			}
		})();
	});

	await new Promise(() => {
		// keep process alive
	});
}

if (require.main === module) {
	main().catch((err: unknown) => {
		const message = err instanceof Error ? err.message : String(err);
		console.error(message);
		process.exit(1);
	});
}
