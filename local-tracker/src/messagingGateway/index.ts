import fs from 'fs';

import type { MessagingGatewayMode } from './config';
import { getDefaultMessagingGatewayConfigPath, loadMessagingGatewayConfig, resolveMessagingGatewayConfigPath } from './config';
import { AuditLogger } from './auditLogger';
import { CommandRouter, WU002_POLICY_CONTRACT } from './commandRouter';
import { DiscordPlatform } from './discordPlatform';
import type { BridgeClient } from './bridgeClient';
import { AcpBridgeClient } from './acpBridgeClient';
import { PermissionOrchestrator } from './permissionOrchestrator';
import { SessionThreadManager } from './sessionThreadManager';
import { formatSessionLine, isActiveSessionStatus, parseBridgeSessions } from './sessionsHelpers';
import { deleteGatewaySecret, getGatewaySecret, getGatewaySecretsStatus, storeGatewaySecretFromEnv } from './secrets';
import { detectModeAuto } from './workspaceDetection';
import { printGatewayStatusSummary } from './status';
import { MessagingGatewayStatusWriter, resolveMessagingGatewayStatusPath, type MessagingGatewayStatusV1 } from './statusFile';

type CliMode = MessagingGatewayMode;

interface CliArgs {
	configPath?: string;
	mode?: CliMode;
	storeDiscordBotToken?: boolean;
	deleteDiscordBotToken?: boolean;
	printConfigPath?: boolean;
	help?: boolean;
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
		extensionClient.start();
	}

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

main().catch((err: unknown) => {
	const message = err instanceof Error ? err.message : String(err);
	console.error(message);
	process.exit(1);
});
