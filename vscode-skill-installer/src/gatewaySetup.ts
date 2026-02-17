import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import type { WsAuthManager } from './wsAuth';
import type { WsServer } from './wsServer';

// ── Types ─────────────────────────────────────────────────────────────────

interface GatewayConfig {
	mode?: string;
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

// ── Constants & Helpers ───────────────────────────────────────────────────

const GATEWAY_CONFIG_DIRNAME = '.instruction-engine';
const GATEWAY_CONFIG_BASENAME = 'messaging-gateway.config.json';

function getDefaultGatewayConfigPath(): string {
	return path.join(os.homedir(), GATEWAY_CONFIG_DIRNAME, GATEWAY_CONFIG_BASENAME);
}

function isNumericId(value: string): boolean {
	return /^\d+$/.test(value);
}

function parseDiscordChannelLink(input: string): { guildId: string; channelId: string } | undefined {
	const trimmed = input.trim();
	if (!trimmed) return undefined;
	try {
		const url = new URL(trimmed);
		const parts = url.pathname.split('/').filter(Boolean);
		if (parts.length >= 3 && parts[0] === 'channels') {
			const guildId = parts[1];
			const channelId = parts[2];
			if (isNumericId(guildId) && isNumericId(channelId)) {
				return { guildId, channelId };
			}
		}
	} catch {
		// ignore
	}
	return undefined;
}

function parseCommaSeparatedIds(input: string): string[] {
	return input.split(',').map((s) => s.trim()).filter(Boolean);
}

function findLocalTrackerDir(): string | undefined {
	const folders = vscode.workspace.workspaceFolders ?? [];
	for (const folder of folders) {
		const candidate = path.join(folder.uri.fsPath, 'local-tracker', 'package.json');
		if (fs.existsSync(candidate)) {
			return path.dirname(candidate);
		}
	}
	return undefined;
}

function getNpmCommand(): string {
	return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

// ── Config Read / Write ───────────────────────────────────────────────────

function readGatewayConfig(): GatewayConfig | undefined {
	const configPath = getDefaultGatewayConfigPath();
	if (!fs.existsSync(configPath)) return undefined;
	try {
		const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
		if (
			raw &&
			typeof raw === 'object' &&
			raw.discord &&
			typeof raw.discord === 'object' &&
			raw.workspaces &&
			typeof raw.workspaces === 'object'
		) {
			return raw as GatewayConfig;
		}
	} catch {
		// malformed JSON — treat as missing
	}
	return undefined;
}

function writeGatewayConfig(config: GatewayConfig): string {
	const configPath = getDefaultGatewayConfigPath();
	fs.mkdirSync(path.dirname(configPath), { recursive: true });
	fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
	return configPath;
}

function gatewayConfigExists(): boolean {
	return fs.existsSync(getDefaultGatewayConfigPath());
}

function pathsEqual(a: string, b: string): boolean {
	if (process.platform === 'win32') {
		return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
	}
	return path.resolve(a) === path.resolve(b);
}

// ── npm helper ────────────────────────────────────────────────────────────

async function runNpmScript(
	cwd: string,
	script: string,
	extraArgs: string[],
	envOverrides: Record<string, string>,
	output: vscode.OutputChannel,
): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const npm = getNpmCommand();
		const args = ['run', script, '--', ...extraArgs];
		output.appendLine(`[Gateway Setup] Running: ${npm} run ${script} -- ${extraArgs.join(' ')}`);
		const child = spawn(npm, args, {
			cwd,
			env: { ...process.env, ...envOverrides },
			windowsHide: true,
		});
		child.stdout.on('data', (d) => output.append(d.toString()));
		child.stderr.on('data', (d) => output.append(d.toString()));
		child.on('error', (err) => reject(err));
		child.on('close', (code) => {
			if (code === 0) resolve();
			else reject(new Error(`npm exited with code ${code ?? 'unknown'}`));
		});
	});
}

// ── Shared prompts (reused by wizard + edit commands) ─────────────────────

async function promptDiscordIds(existing?: GatewayConfig['discord']): Promise<{ guildId: string; channelId: string } | undefined> {
	const channelLinkOrIds = await vscode.window.showInputBox({
		title: 'Discord scope: channel link',
		prompt:
			'Paste a channel link like https://discord.com/channels/<guildId>/<channelId> (recommended). Right-click channel → Copy Link.',
		value: existing ? `https://discord.com/channels/${existing.guildId}/${existing.channelId}` : '',
		ignoreFocusOut: true,
	});
	if (channelLinkOrIds === undefined) return undefined;

	const parsed = parseDiscordChannelLink(channelLinkOrIds);
	if (parsed) return parsed;

	const guildIdInput = await vscode.window.showInputBox({
		title: 'Discord scope: guildId (server ID)',
		prompt: 'Enter the Discord guild/server ID (numeric).',
		value: existing?.guildId ?? '',
		ignoreFocusOut: true,
	});
	if (guildIdInput === undefined) return undefined;
	const guildId = guildIdInput.trim();

	const channelIdInput = await vscode.window.showInputBox({
		title: 'Discord scope: channelId',
		prompt: 'Enter the Discord channel ID (numeric).',
		value: existing?.channelId ?? '',
		ignoreFocusOut: true,
	});
	if (channelIdInput === undefined) return undefined;
	const channelId = channelIdInput.trim();

	if (!isNumericId(guildId) || !isNumericId(channelId)) {
		void vscode.window.showErrorMessage('Invalid guildId/channelId. Expected numeric IDs (snowflakes).');
		return undefined;
	}
	return { guildId, channelId };
}

async function promptAllowlistedUserIds(existing?: string[]): Promise<string[] | undefined> {
	const allowlistInput = await vscode.window.showInputBox({
		title: 'Discord allowlist: user IDs',
		prompt:
			'Your Discord user ID(s), comma-separated. (Developer Mode → right-click your name → Copy ID).',
		value: existing?.join(', ') ?? '',
		ignoreFocusOut: true,
	});
	if (allowlistInput === undefined) return undefined;
	const ids = parseCommaSeparatedIds(allowlistInput);
	if (ids.length === 0 || !ids.every(isNumericId)) {
		void vscode.window.showErrorMessage('Provide at least 1 numeric Discord user ID.');
		return undefined;
	}
	return ids;
}

async function promptWorkspaceRoots(existing?: GatewayConfig['workspaces']): Promise<{ allowedRoots: string[]; activeRoot: string } | undefined> {
	const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
	if (workspaceFolders.length === 0) {
		void vscode.window.showErrorMessage('No workspace folders open. Open your workspace first.');
		return undefined;
	}

	// Build pick items: current VS Code folders + any existing roots not currently open
	const vscodePaths = workspaceFolders.map((f) => f.uri.fsPath);
	const extraRoots = (existing?.allowedRoots ?? []).filter(
		(r) => !vscodePaths.some((v) => pathsEqual(v, r)),
	);
	const allCandidates = [...vscodePaths, ...extraRoots];
	const previouslyAllowed = existing?.allowedRoots ?? [];

	const items = allCandidates.map((p) => ({
		label: p,
		description: extraRoots.some((e) => pathsEqual(e, p)) ? '(not currently open in VS Code)' : '',
		picked: previouslyAllowed.length > 0
			? previouslyAllowed.some((r) => pathsEqual(r, p))
			: vscodePaths.some((v) => pathsEqual(v, p)),
	}));

	const pick = await vscode.window.showQuickPick(items, {
		canPickMany: true,
		title: 'Gateway: allowed workspace roots',
		placeHolder: 'Select which workspace roots the gateway is allowed to access',
		ignoreFocusOut: true,
	});
	if (!pick || pick.length === 0) return undefined;
	const allowedRoots = pick.map((p) => p.label);

	// Pick active root from selected set
	const defaultActive = existing?.activeRoot && allowedRoots.some((r) => pathsEqual(r, existing.activeRoot))
		? existing.activeRoot
		: allowedRoots[0];

	const activeRootPick = await vscode.window.showQuickPick(
		allowedRoots.map((p) => ({
			label: p,
			description: pathsEqual(p, defaultActive) ? '(current)' : '',
		})),
		{
			title: 'Gateway: active workspace root',
			placeHolder: 'Pick the default active root (where ws-port.txt is read from)',
			ignoreFocusOut: true,
		},
	);
	if (!activeRootPick) return undefined;

	return { allowedRoots, activeRoot: activeRootPick.label };
}

async function promptOptionalPermissionsChannelId(existing?: string): Promise<string | undefined> {
	const input = await vscode.window.showInputBox({
		title: 'Discord: permissions channel ID (optional)',
		prompt:
			'Separate channel for permission prompts? Leave blank to use the main channel. Enter a numeric channel ID or paste a channel link.',
		value: existing ?? '',
		ignoreFocusOut: true,
	});
	if (input === undefined) return existing; // cancelled — keep existing
	const trimmed = input.trim();
	if (!trimmed) return undefined; // cleared — no dedicated permissions channel

	// Try parsing as a channel link
	const parsed = parseDiscordChannelLink(trimmed);
	if (parsed) return parsed.channelId;

	// Otherwise expect a raw numeric ID
	if (!isNumericId(trimmed)) {
		void vscode.window.showErrorMessage('Invalid channel ID. Expected a numeric Discord snowflake.');
		return existing;
	}
	return trimmed;
}

async function promptMode(existing?: string): Promise<string | undefined> {
	const modes = [
		{ label: 'auto', description: 'Auto-detect connected/disconnected based on extension WS discovery file' },
		{ label: 'connected', description: 'Requires extension WS JWT (for /task, /plan, /resume...)' },
		{ label: 'disconnected', description: 'Read-only + offline queueing only' },
	];
	const pick = await vscode.window.showQuickPick(modes, {
		title: 'Gateway: mode',
		placeHolder: existing ? `Current: ${existing}` : 'Select gateway mode',
		ignoreFocusOut: true,
	});
	return pick?.label;
}

// ── 1) Setup Wizard (create or reconfigure — pre-fills from existing) ─────

export async function setupMessagingGatewayWizard(
	output: vscode.OutputChannel,
	authManager: WsAuthManager,
	wsServer: WsServer,
): Promise<void> {
	const existing = readGatewayConfig();

	// Workspace roots
	const workspaces = await promptWorkspaceRoots(existing?.workspaces);
	if (!workspaces) return;

	// Mode
	const mode = await promptMode(existing?.mode);
	if (!mode) return;

	// Discord guild + channel
	const discordIds = await promptDiscordIds(existing?.discord);
	if (!discordIds) return;

	// Allowlisted user IDs
	const allowlistedUserIds = await promptAllowlistedUserIds(existing?.discord.allowlistedUserIds);
	if (!allowlistedUserIds) return;

	// Optional: permissions channel
	const permissionsChannelId = await promptOptionalPermissionsChannelId(existing?.discord.permissionsChannelId);

	const config: GatewayConfig = {
		mode,
		discord: {
			allowlistedUserIds,
			guildId: discordIds.guildId,
			channelId: discordIds.channelId,
			...(permissionsChannelId ? { permissionsChannelId } : {}),
		},
		workspaces,
	};

	const configPath = writeGatewayConfig(config);
	output.appendLine(`[Gateway Setup] Wrote config: ${configPath}`);

	// Offer to store secrets
	const localTrackerDir = findLocalTrackerDir();
	if (!localTrackerDir) {
		void vscode.window.showWarningMessage(
			'Gateway config written, but could not find local-tracker in your open workspace.\n' +
			'Secrets (bot token / WS JWT) must be stored by running local-tracker commands manually.',
		);
		return;
	}

	const next = await vscode.window.showInformationMessage(
		'Config written. Store the Discord bot token + extension WS JWT in your OS credential store now?',
		'Store both',
		'Skip',
	);
	if (next !== 'Store both') return;

	const botToken = await vscode.window.showInputBox({
		title: 'Discord bot token',
		prompt: 'Paste the Discord bot token (will be stored in OS credential store).',
		password: true,
		ignoreFocusOut: true,
	});
	if (!botToken) return;

	await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: 'Storing gateway secrets...', cancellable: false },
		async () => {
			await runNpmScript(
				localTrackerDir,
				'dev:gateway',
				['--store-discord-bot-token'],
				{ INSTRUCTION_ENGINE_DISCORD_BOT_TOKEN: botToken },
				output,
			);

			if (!authManager.getSecret()) {
				await authManager.initialize();
			}
			const wsEnabled = vscode.workspace.getConfiguration('skillInstaller.ws').get<boolean>('enabled', false);
			const port = wsServer.getPort();
			if (!wsEnabled || !wsServer.isRunning() || !port) {
				output.appendLine('[Gateway Setup] WS server not enabled/running; skipping WS JWT storage.');
				return;
			}
			const token = authManager.generateToken('gateway');
			await runNpmScript(
				localTrackerDir,
				'dev:gateway',
				['--store-extension-ws-jwt'],
				{ INSTRUCTION_ENGINE_EXTENSION_WS_JWT: token },
				output,
			);
		},
	);

	void vscode.window.showInformationMessage('Gateway secrets stored. Run: npm run dev:gateway (in local-tracker).');
}

// ── 2) Edit Discord Settings ──────────────────────────────────────────────

export async function editDiscordCommand(output: vscode.OutputChannel): Promise<void> {
	const config = readGatewayConfig();
	if (!config) {
		const action = await vscode.window.showErrorMessage(
			'No gateway config found. Run "Gateway: Setup Messaging Gateway" first.',
			'Run Setup',
		);
		if (action === 'Run Setup') {
			await vscode.commands.executeCommand('skillInstaller.gateway.setup');
		}
		return;
	}

	const action = await vscode.window.showQuickPick(
		[
			{ label: 'Change channel (guild + channel)', id: 'channel' },
			{ label: 'Manage allowlisted user IDs', id: 'users' },
			{ label: 'Change permissions channel', id: 'permissions' },
			{ label: 'Change mode', id: 'mode' },
			{ label: 'Edit all Discord settings', id: 'all' },
		],
		{ title: 'Gateway: edit Discord settings', ignoreFocusOut: true },
	);
	if (!action) return;

	let changed = false;

	if (action.id === 'channel' || action.id === 'all') {
		const ids = await promptDiscordIds(config.discord);
		if (!ids) return;
		config.discord.guildId = ids.guildId;
		config.discord.channelId = ids.channelId;
		changed = true;
	}

	if (action.id === 'users' || action.id === 'all') {
		const ids = await promptAllowlistedUserIds(config.discord.allowlistedUserIds);
		if (!ids) return;
		config.discord.allowlistedUserIds = ids;
		changed = true;
	}

	if (action.id === 'permissions' || action.id === 'all') {
		const permissionsChannelId = await promptOptionalPermissionsChannelId(config.discord.permissionsChannelId);
		if (permissionsChannelId) {
			config.discord.permissionsChannelId = permissionsChannelId;
		} else {
			delete config.discord.permissionsChannelId;
		}
		changed = true;
	}

	if (action.id === 'mode' || action.id === 'all') {
		const mode = await promptMode(config.mode);
		if (!mode) return;
		config.mode = mode;
		changed = true;
	}

	if (changed) {
		const configPath = writeGatewayConfig(config);
		output.appendLine(`[Gateway] Updated Discord settings: ${configPath}`);
		void vscode.window.showInformationMessage('Gateway Discord settings updated.');
	}
}

// ── 3) Manage Workspaces ──────────────────────────────────────────────────

export async function manageWorkspacesCommand(output: vscode.OutputChannel): Promise<void> {
	const config = readGatewayConfig();
	if (!config) {
		const action = await vscode.window.showErrorMessage(
			'No gateway config found. Run "Gateway: Setup Messaging Gateway" first.',
			'Run Setup',
		);
		if (action === 'Run Setup') {
			await vscode.commands.executeCommand('skillInstaller.gateway.setup');
		}
		return;
	}

	const workspaces = await promptWorkspaceRoots(config.workspaces);
	if (!workspaces) return;

	config.workspaces = workspaces;
	const configPath = writeGatewayConfig(config);
	output.appendLine(`[Gateway] Updated workspaces: ${configPath}`);
	void vscode.window.showInformationMessage(
		`Gateway workspaces updated. ${workspaces.allowedRoots.length} root(s), active: ${path.basename(workspaces.activeRoot)}`,
	);
}

// ── 4) Sync Workspaces (one-click) ───────────────────────────────────────

export async function syncWorkspacesCommand(output: vscode.OutputChannel): Promise<void> {
	const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
	if (workspaceFolders.length === 0) {
		void vscode.window.showErrorMessage('No workspace folders open.');
		return;
	}

	const config = readGatewayConfig();
	if (!config) {
		const action = await vscode.window.showErrorMessage(
			'No gateway config found. Run "Gateway: Setup Messaging Gateway" first.',
			'Run Setup',
		);
		if (action === 'Run Setup') {
			await vscode.commands.executeCommand('skillInstaller.gateway.setup');
		}
		return;
	}

	const newRoots = workspaceFolders.map((f) => f.uri.fsPath);

	// Build a summary of changes
	const added = newRoots.filter(
		(r) => !config.workspaces.allowedRoots.some((existing) => pathsEqual(existing, r)),
	);
	const removed = config.workspaces.allowedRoots.filter(
		(r) => !newRoots.some((nr) => pathsEqual(nr, r)),
	);

	if (added.length === 0 && removed.length === 0) {
		void vscode.window.showInformationMessage('Gateway workspace roots are already in sync with VS Code.');
		return;
	}

	const parts: string[] = [];
	if (added.length > 0) parts.push(`Add: ${added.map((p) => path.basename(p)).join(', ')}`);
	if (removed.length > 0) parts.push(`Remove: ${removed.map((p) => path.basename(p)).join(', ')}`);

	const confirm = await vscode.window.showInformationMessage(
		`Sync gateway workspaces?\n${parts.join(' | ')}`,
		{ modal: true },
		'Sync',
	);
	if (confirm !== 'Sync') return;

	config.workspaces.allowedRoots = newRoots;

	// If activeRoot is no longer in the list, pick the first one
	if (!newRoots.some((r) => pathsEqual(r, config.workspaces.activeRoot))) {
		config.workspaces.activeRoot = newRoots[0];
		output.appendLine(`[Gateway] Active root changed to: ${newRoots[0]}`);
	}

	const configPath = writeGatewayConfig(config);
	output.appendLine(`[Gateway] Synced workspaces: ${configPath}`);
	void vscode.window.showInformationMessage(
		`Gateway workspaces synced. ${newRoots.length} root(s), active: ${path.basename(config.workspaces.activeRoot)}`,
	);
}

// ── 5) View Config ────────────────────────────────────────────────────────

export async function viewConfigCommand(output: vscode.OutputChannel): Promise<void> {
	const config = readGatewayConfig();
	if (!config) {
		const action = await vscode.window.showErrorMessage(
			`No gateway config found at:\n${getDefaultGatewayConfigPath()}\n\nRun "Gateway: Setup Messaging Gateway" to create one.`,
			'Run Setup',
		);
		if (action === 'Run Setup') {
			await vscode.commands.executeCommand('skillInstaller.gateway.setup');
		}
		return;
	}

	const summary = [
		`Mode: ${config.mode ?? 'auto'}`,
		`Guild (server): ${config.discord.guildId}`,
		`Channel: ${config.discord.channelId}`,
		...(config.discord.permissionsChannelId ? [`Permissions channel: ${config.discord.permissionsChannelId}`] : []),
		`Allowlisted users: ${config.discord.allowlistedUserIds.length} (${config.discord.allowlistedUserIds.join(', ')})`,
		`Workspace roots: ${config.workspaces.allowedRoots.length}`,
		`Active root: ${config.workspaces.activeRoot}`,
	].join('\n');

	output.appendLine(`[Gateway Config]\n${summary}`);

	const action = await vscode.window.showInformationMessage(
		`Gateway Config — Mode: ${config.mode ?? 'auto'} | Guild: ${config.discord.guildId} | ` +
		`Users: ${config.discord.allowlistedUserIds.length} | Roots: ${config.workspaces.allowedRoots.length}`,
		'Edit Discord',
		'Edit Workspaces',
		'Open in Editor',
	);

	if (action === 'Edit Discord') {
		await vscode.commands.executeCommand('skillInstaller.gateway.editDiscord');
	} else if (action === 'Edit Workspaces') {
		await vscode.commands.executeCommand('skillInstaller.gateway.manageWorkspaces');
	} else if (action === 'Open in Editor') {
		await vscode.commands.executeCommand('skillInstaller.gateway.openConfig');
	}
}

// ── 6) Open Config in Editor ──────────────────────────────────────────────

export async function openConfigCommand(): Promise<void> {
	const configPath = getDefaultGatewayConfigPath();
	if (!fs.existsSync(configPath)) {
		const action = await vscode.window.showErrorMessage(
			`Config file does not exist: ${configPath}\nRun "Gateway: Setup Messaging Gateway" to create it.`,
			'Run Setup',
		);
		if (action === 'Run Setup') {
			await vscode.commands.executeCommand('skillInstaller.gateway.setup');
		}
		return;
	}

	const doc = await vscode.workspace.openTextDocument(configPath);
	await vscode.window.showTextDocument(doc);
}

// ── 7) Store Secret Commands (unchanged) ──────────────────────────────────

export async function storeDiscordBotTokenCommand(output: vscode.OutputChannel): Promise<void> {
	const localTrackerDir = findLocalTrackerDir();
	if (!localTrackerDir) {
		void vscode.window.showErrorMessage('Could not find local-tracker in the current workspace. Open the instruction-engine workspace and try again.');
		return;
	}

	const botToken = await vscode.window.showInputBox({
		title: 'Discord bot token',
		prompt: 'Paste the Discord bot token (will be stored in OS credential store).',
		password: true,
		ignoreFocusOut: true,
	});
	if (!botToken) return;

	await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: 'Storing Discord bot token...', cancellable: false },
		async () => {
			await runNpmScript(localTrackerDir, 'dev:gateway', ['--store-discord-bot-token'], { INSTRUCTION_ENGINE_DISCORD_BOT_TOKEN: botToken }, output);
		},
	);

	void vscode.window.showInformationMessage('Stored Discord bot token for the gateway.');
}

export async function storeExtensionWsJwtCommand(
	output: vscode.OutputChannel,
	authManager: WsAuthManager,
	wsServer: WsServer,
): Promise<void> {
	const localTrackerDir = findLocalTrackerDir();
	if (!localTrackerDir) {
		void vscode.window.showErrorMessage('Could not find local-tracker in the current workspace. Open the instruction-engine workspace and try again.');
		return;
	}

	const wsEnabled = vscode.workspace.getConfiguration('skillInstaller.ws').get<boolean>('enabled', false);
	const port = wsServer.getPort();
	if (!wsEnabled || !wsServer.isRunning() || !port) {
		void vscode.window.showErrorMessage('Extension WS server is not enabled or not running. Enable skillInstaller.ws.enabled, reload the window, then try again.');
		return;
	}

	const userIdInput = await vscode.window.showInputBox({
		title: 'Gateway WS token subject',
		prompt: 'Token subject (sub). Default is "gateway".',
		value: 'gateway',
		ignoreFocusOut: true,
	});
	if (userIdInput === undefined) return;
	const userId = userIdInput.trim();
	if (!userId) return;

	if (!authManager.getSecret()) {
		await authManager.initialize();
	}
	const token = authManager.generateToken(userId);

	await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: 'Storing extension WS JWT...', cancellable: false },
		async () => {
			await runNpmScript(
				localTrackerDir,
				'dev:gateway',
				['--store-extension-ws-jwt'],
				{ INSTRUCTION_ENGINE_EXTENSION_WS_JWT: token },
				output,
			);
		},
	);

	void vscode.window.showInformationMessage('Stored extension WS JWT for the gateway.');
}
