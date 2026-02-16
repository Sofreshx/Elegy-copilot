import fs from 'fs';

import type { MessagingGatewayMode } from './config';
import { loadMessagingGatewayConfig } from './config';
import { AuditLogger } from './auditLogger';
import { CommandRouter, WU002_POLICY_CONTRACT } from './commandRouter';
import { DiscordPlatform } from './discordPlatform';
import { E3CliBridge } from './e3CliBridge';
import { ExtensionBridgeClient } from './extensionBridgeClient';
import { PermissionOrchestrator } from './permissionOrchestrator';
import { SessionThreadManager } from './sessionThreadManager';
import { deleteGatewaySecret, getGatewaySecret, getGatewaySecretsStatus, storeGatewaySecretFromEnv } from './secrets';
import { detectModeAuto, resolveExtensionWsPort } from './workspaceDetection';
import { printGatewayStatusSummary } from './status';

type CliMode = MessagingGatewayMode;

interface CliArgs {
	configPath?: string;
	mode?: CliMode;
	storeDiscordBotToken?: boolean;
	storeExtensionWsJwt?: boolean;
	deleteDiscordBotToken?: boolean;
	deleteExtensionWsJwt?: boolean;
	printConfigPath?: boolean;
	help?: boolean;
}

function printHelp() {
	console.log(`Messaging Gateway (scaffold)

Usage:
  npm run dev:gateway -- [--config <path>] [--mode auto|connected|disconnected]

Config:
  INSTRUCTION_ENGINE_GATEWAY_CONFIG_PATH=<path> (default: ~/.instruction-engine/messaging-gateway.config.json)
  INSTRUCTION_ENGINE_GATEWAY_CONFIG_JSON=<inline-json>

Secrets (preferred: OS keychain; fallback: env vars):
  Discord bot token env fallbacks: INSTRUCTION_ENGINE_DISCORD_BOT_TOKEN, DISCORD_BOT_TOKEN
  Extension WS JWT env fallbacks: INSTRUCTION_ENGINE_EXTENSION_WS_JWT, INSTRUCTION_ENGINE_WS_JWT, EXTENSION_WS_JWT

Keychain utilities (reads token from env and stores in OS credential store):
  --store-discord-bot-token
  --store-extension-ws-jwt
  --delete-discord-bot-token
  --delete-extension-ws-jwt
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
		else if (arg === '--store-extension-ws-jwt') out.storeExtensionWsJwt = true;
		else if (arg === '--delete-discord-bot-token') out.deleteDiscordBotToken = true;
		else if (arg === '--delete-extension-ws-jwt') out.deleteExtensionWsJwt = true;
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

async function handleSecretUtilityFlags(args: CliArgs): Promise<boolean> {
	const flags = [
		args.storeDiscordBotToken,
		args.storeExtensionWsJwt,
		args.deleteDiscordBotToken,
		args.deleteExtensionWsJwt,
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
	if (args.storeExtensionWsJwt) {
		await storeGatewaySecretFromEnv('extensionWsJwt');
		console.log('[Gateway] Stored extension WS JWT in OS credential store');
		return true;
	}
	if (args.deleteDiscordBotToken) {
		const deleted = await deleteGatewaySecret('discordBotToken');
		console.log(`[Gateway] Deleted discord bot token from OS credential store: ${deleted ? 'ok' : 'not found'}`);
		return true;
	}
	if (args.deleteExtensionWsJwt) {
		const deleted = await deleteGatewaySecret('extensionWsJwt');
		console.log(`[Gateway] Deleted extension WS JWT from OS credential store: ${deleted ? 'ok' : 'not found'}`);
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

	if (await handleSecretUtilityFlags(args)) return;

	const loaded = loadMessagingGatewayConfig(args.configPath);
	if (args.printConfigPath) {
		console.log(loaded.configPath);
		return;
	}

	const requestedMode = resolveRequestedMode(args.mode, loaded.config.mode);
	let activeWorkspaceRoot = loaded.config.workspaces.activeRoot;
	const mode = requestedMode === 'auto' ? detectModeAuto(activeWorkspaceRoot) : requestedMode;
	const secretsStatus = await getGatewaySecretsStatus();

	const discordBotToken = await getGatewaySecret('discordBotToken');
	if (!discordBotToken.value) {
		throw new Error(
			'[Gateway] Missing required secret: Discord bot token. Store it in the OS credential store (preferred) or set INSTRUCTION_ENGINE_DISCORD_BOT_TOKEN.',
		);
	}

	let extensionWsPort: { port: number; source: 'env' | 'file' } | undefined;
	let extensionWsJwtValue: string | undefined;
	if (mode === 'connected') {
		extensionWsPort = resolveExtensionWsPort(activeWorkspaceRoot);
		const extensionWsJwt = await getGatewaySecret('extensionWsJwt');
		extensionWsJwtValue = extensionWsJwt.value;
		if (!extensionWsJwtValue) {
			throw new Error(
				'[Gateway] Missing required secret for connected mode: extension WS JWT. Store it in the OS credential store (preferred) or set INSTRUCTION_ENGINE_EXTENSION_WS_JWT, or run with --mode disconnected.',
			);
		}
	}

	printGatewayStatusSummary(loaded, {
		mode,
		configPath: loaded.configPath,
		activeWorkspaceRoot,
		allowedWorkspaceRootsCount: loaded.config.workspaces.allowedRoots.length,
		allowlistedDiscordUsersCount: loaded.config.discord.allowlistedUserIds.length,
		discordGuildId: loaded.config.discord.guildId,
		discordChannelId: loaded.config.discord.channelId,
		secrets: secretsStatus,
		extensionWsPort,
	});

	const auditLogger = new AuditLogger({ workspaceRoot: activeWorkspaceRoot });
	const e3Cli = new E3CliBridge();
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

	let extensionClient: ExtensionBridgeClient | undefined;
	let permissionOrchestrator: PermissionOrchestrator | undefined;
	if (mode === 'connected' && extensionWsJwtValue) {
		permissionOrchestrator = new PermissionOrchestrator({
			auditLogger,
			permissionTimeoutMs: 120_000,
			defaultResolvedBy: 'messaging-gateway',
		});

		extensionClient = new ExtensionBridgeClient({
			resolvePort: () => resolveExtensionWsPort(activeWorkspaceRoot).port,
			getJwt: () => extensionWsJwtValue!,
			onEvent: (event) => {
				permissionOrchestrator?.handleExtensionEvent(event);
				sessionThreads.handleExtensionEvent(event);
			},
			onStatusChanged: (status) => {
				console.log(`[Gateway] Extension WS status: ${status}`);
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
		e3Cli,
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

	console.log('[Gateway] Status OK. Waiting for shutdown (Ctrl+C)...');

	let shuttingDown = false;
	process.on('SIGINT', () => {
		if (shuttingDown) return;
		shuttingDown = true;
		console.log('[Gateway] Shutting down');
		void (async () => {
			try {
				sessionThreads.stop();
				await permissionOrchestrator?.stop();
				await extensionClient?.stop();
				await discord.stop();
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
