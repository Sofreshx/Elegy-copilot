import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { SkillDiscoveryTreeProvider } from './tree';
import { AgentDiscoveryTreeProvider } from './agentsTree';
import { clearRepoContext } from './contextCleaner';
import { WorkflowTaskTreeProvider } from './workflowTasksTree';
import { setRepoItemEnabled } from './enablementStore';
import { AgentEntry, SkillEntry } from './types';
import { AuditTreeProvider, AUDIT_TYPES } from './auditTree';
import { WsServer } from './wsServer';
import { WsAuthManager } from './wsAuth';
import { SessionManager } from './sessionManager';
import { RemoteControlParticipant } from './chatParticipant';
import { ConnectionsTreeProvider } from './operationsConnectionsTree';
import { RequestsTreeProvider } from './operationsRequestsTree';
import { PermissionsTreeProvider } from './operationsPermissionsTree';
import { archiveDoneTasks, purgeArchivedTasks } from './taskLifecycle';
import { initializeSkills } from './skillInitializer';
import { McpProvidersTreeProvider } from './mcpProvidersTree';
import { McpProviderInfo, syncMcpConfigForRepo, syncMcpConfigForWorkspace } from './mcpConfig';
import { DumpCleanerTreeProvider } from './dumpCleanerTree';
import {
	setupMessagingGatewayWizard,
	storeDiscordBotTokenCommand,
	storeExtensionWsJwtCommand,
	editDiscordCommand,
	manageWorkspacesCommand,
	syncWorkspacesCommand,
	viewConfigCommand,
	openConfigCommand,
} from './gatewaySetup';

function getSkillFromCommand(arg: unknown): SkillEntry | undefined {
	if (!arg || typeof arg !== 'object') {
		return undefined;
	}
	if ('skill' in (arg as Record<string, unknown>)) {
		const skill = (arg as { skill?: SkillEntry }).skill;
		if (skill && typeof skill.name === 'string') {
			return skill;
		}
	}
	return undefined;
}

function getAgentFromCommand(arg: unknown): AgentEntry | undefined {
	if (!arg || typeof arg !== 'object') {
		return undefined;
	}
	if ('agent' in (arg as Record<string, unknown>)) {
		const agent = (arg as { agent?: AgentEntry }).agent;
		if (agent && typeof agent.fileName === 'string') {
			return agent;
		}
	}
	return undefined;
}

function getMcpProviderFromCommand(arg: unknown): McpProviderInfo | undefined {
	if (!arg || typeof arg !== 'object') {
		return undefined;
	}
	if ('provider' in (arg as Record<string, unknown>)) {
		const provider = (arg as { provider?: McpProviderInfo }).provider;
		if (provider && typeof provider.id === 'string') {
			return provider;
		}
	}
	return undefined;
}

function getRepoPathFromCommand(arg: unknown): string | undefined {
	if (!arg || typeof arg !== 'object') {
		return undefined;
	}
	if ('repoPath' in (arg as Record<string, unknown>)) {
		const repoPath = (arg as { repoPath?: string }).repoPath;
		return typeof repoPath === 'string' ? repoPath : undefined;
	}
	return undefined;
}

function isInstructionEngineFolder(folder: vscode.WorkspaceFolder): boolean {
	const name = folder.name.toLowerCase();
	if (name === 'instruction-engine') {
		return true;
	}
	const folderPath = folder.uri.fsPath.replace(/\\/g, '/').toLowerCase();
	return folderPath.endsWith('/instruction-engine');
}

export function activate(context: vscode.ExtensionContext): void {
	const output = vscode.window.createOutputChannel('RannIA');
	context.subscriptions.push(output);

	// Initialize session manager
	const sessionManager = new SessionManager(output);
	context.subscriptions.push(sessionManager);

	// Initialize chat participant for remote agent invocation
	const chatParticipant = new RemoteControlParticipant(output, sessionManager);
	chatParticipant.register();
	context.subscriptions.push(chatParticipant);

	// Initialize WebSocket server with authentication
	const authManager = new WsAuthManager(context.secrets, output);
	const wsServer = new WsServer(context, output, authManager);
	context.subscriptions.push(wsServer);

	// Wire up session manager and chat participant to WebSocket server
	wsServer.setSessionManager(sessionManager);
	wsServer.setChatParticipant(chatParticipant);

	// Start WebSocket server (async, non-blocking)
	wsServer.start().catch((err) => {
		const message = err instanceof Error ? err.message : 'Unknown error';
		output.appendLine(`[WS Server] Failed to start: ${message}`);
	});

	// ── WS Pairing / Port Discovery (Gateway bootstrap) ───────────────────
	context.subscriptions.push(
		vscode.commands.registerCommand('skillInstaller.ws.showPort', async () => {
			const wsConfig = vscode.workspace.getConfiguration('skillInstaller.ws');
			const wsEnabled = wsConfig.get<boolean>('enabled', false);
			const port = wsServer.getPort();

			if (!wsEnabled) {
				const choice = await vscode.window.showWarningMessage(
					'WebSocket server is disabled. Enable skillInstaller.ws.enabled to use gateway pairing.',
					'Open Settings'
				);
				if (choice === 'Open Settings') {
					await vscode.commands.executeCommand('workbench.action.openSettings', 'skillInstaller.ws.enabled');
				}
				return;
			}

			if (!wsServer.isRunning() || !port) {
				void vscode.window.showInformationMessage('WebSocket server is not running yet. Try again in a moment.');
				return;
			}

			const url = `ws://127.0.0.1:${port}`;
			await vscode.env.clipboard.writeText(url);
			void vscode.window.showInformationMessage(`WS listening on ${port}. Copied URL to clipboard.`);
		})
	);

	// ── Messaging Gateway Setup (Discord config + keychain helpers) ───────
	context.subscriptions.push(
		vscode.commands.registerCommand('skillInstaller.gateway.setup', async () => {
			await setupMessagingGatewayWizard(output, authManager, wsServer);
		})
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('skillInstaller.gateway.storeDiscordBotToken', async () => {
			await storeDiscordBotTokenCommand(output);
		})
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('skillInstaller.gateway.storeExtensionWsJwt', async () => {
			await storeExtensionWsJwtCommand(output, authManager, wsServer);
		})
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('skillInstaller.gateway.editDiscord', async () => {
			await editDiscordCommand(output);
		})
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('skillInstaller.gateway.manageWorkspaces', async () => {
			await manageWorkspacesCommand(output);
		})
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('skillInstaller.gateway.syncWorkspaces', async () => {
			await syncWorkspacesCommand(output);
		})
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('skillInstaller.gateway.viewConfig', async () => {
			await viewConfigCommand(output);
		})
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('skillInstaller.gateway.openConfig', async () => {
			await openConfigCommand();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('skillInstaller.ws.pairGateway', async () => {
			const wsConfig = vscode.workspace.getConfiguration('skillInstaller.ws');
			const wsEnabled = wsConfig.get<boolean>('enabled', false);
			const port = wsServer.getPort();

			if (!wsEnabled) {
				const choice = await vscode.window.showWarningMessage(
					'WebSocket server is disabled. Enable skillInstaller.ws.enabled to pair a gateway.',
					'Open Settings'
				);
				if (choice === 'Open Settings') {
					await vscode.commands.executeCommand('workbench.action.openSettings', 'skillInstaller.ws.enabled');
				}
				return;
			}

			if (!wsServer.isRunning() || !port) {
				void vscode.window.showInformationMessage('WebSocket server is not running yet. Try again in a moment.');
				return;
			}

			const userIdInput = await vscode.window.showInputBox({
				prompt: 'Gateway userId (token subject)',
				value: 'gateway',
				ignoreFocusOut: true,
			});
			const userId = (userIdInput ?? '').trim();
			if (!userId) {
				return;
			}

			try {
				if (!authManager.getSecret()) {
					await authManager.initialize();
				}
				const token = authManager.generateToken(userId);
				const url = `ws://127.0.0.1:${port}`;
				const pairing = `WS_URL=${url}\nWS_TOKEN=${token}`;
				await vscode.env.clipboard.writeText(pairing);
				void vscode.window.showInformationMessage('Gateway pairing info copied to clipboard.');
			} catch (err) {
				const msg = err instanceof Error ? err.message : 'Unknown error';
				void vscode.window.showErrorMessage(`Failed to generate pairing token: ${msg}`);
			}
		})
	);
	const skillProvider = new SkillDiscoveryTreeProvider(output);
	const agentProvider = new AgentDiscoveryTreeProvider(output);
	const workflowProvider = new WorkflowTaskTreeProvider(output);
	const auditProvider = new AuditTreeProvider(output);
	const connectionsProvider = new ConnectionsTreeProvider(wsServer);
	const requestsProvider = new RequestsTreeProvider(sessionManager);
	const permissionsProvider = new PermissionsTreeProvider(wsServer.getEventEmitter());
	const mcpProvider = new McpProvidersTreeProvider(output);
	const dumpCleanerProvider = new DumpCleanerTreeProvider(output);
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('skillInstaller.skillsView', skillProvider)
	);
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('skillInstaller.agentsView', agentProvider)
	);
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('skillInstaller.workflowView', workflowProvider)
	);
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('skillInstaller.auditView', auditProvider)
	);
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('skillInstaller.connectionsView', connectionsProvider)
	);
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('skillInstaller.requestsView', requestsProvider)
	);
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('skillInstaller.permissionsView', permissionsProvider)
	);
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('skillInstaller.mcpView', mcpProvider)
	);
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('skillInstaller.dumpCleanerView', dumpCleanerProvider)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('skillInstaller.refresh', () => {
			skillProvider.invalidateCache();
			agentProvider.invalidateCache();
			workflowProvider.invalidateCache();
			auditProvider.invalidateCache();
			connectionsProvider.invalidateCache();
			requestsProvider.invalidateCache();
			permissionsProvider.invalidateCache();
			mcpProvider.invalidateCache();
			dumpCleanerProvider.invalidateCache();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('skillInstaller.dumpCleaner.delete', async (arg?: unknown) => {
			await dumpCleanerProvider.deleteCandidate(arg);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('skillInstaller.refreshAudit', () => {
			auditProvider.invalidateCache();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('skillInstaller.runAudit', async () => {
			const items = AUDIT_TYPES.map((a) => ({
				label: a.label,
				description: `Run ${a.type} audit`,
				auditType: a.type
			}));

			const selected = await vscode.window.showQuickPick(items, {
				placeHolder: 'Select audit type to run'
			});

			if (!selected) {
				return;
			}

			const agentMap: Record<string, string> = {
				deploy: 'deploy-auditor',
				stack: 'stack-auditor',
				test: 'test-auditor',
				e2e: 'e2e-validator',
				security: 'security-auditor'
			};

			const agentName = agentMap[selected.auditType];
			void vscode.window.showInformationMessage(
				`Run the ${selected.label} audit using @${agentName} in Copilot chat.`
			);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('skillInstaller.enableSkill', async (arg?: unknown) => {
			const skill = getSkillFromCommand(arg);
			if (!skill || !skill.repoPath) {
				void vscode.window.showWarningMessage('Select a skill with a repo path to enable.');
				return;
			}
			await setRepoItemEnabled('skills', skill.repoPath, skill.name, true);
			skillProvider.invalidateCache();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('skillInstaller.initializeSkills', async () => {
			await initializeSkills(output);
			skillProvider.invalidateCache();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('skillInstaller.disableSkill', async (arg?: unknown) => {
			const skill = getSkillFromCommand(arg);
			if (!skill || !skill.repoPath) {
				void vscode.window.showWarningMessage('Select a skill with a repo path to disable.');
				return;
			}
			await setRepoItemEnabled('skills', skill.repoPath, skill.name, false);
			skillProvider.invalidateCache();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('skillInstaller.enableAgent', async (arg?: unknown) => {
			const agent = getAgentFromCommand(arg);
			if (!agent || !agent.repoPath) {
				void vscode.window.showWarningMessage('Select an agent with a repo path to enable.');
				return;
			}
			await setRepoItemEnabled('agents', agent.repoPath, agent.fileName, true);
			agentProvider.invalidateCache();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('skillInstaller.disableAgent', async (arg?: unknown) => {
			const agent = getAgentFromCommand(arg);
			if (!agent || !agent.repoPath) {
				void vscode.window.showWarningMessage('Select an agent with a repo path to disable.');
				return;
			}
			await setRepoItemEnabled('agents', agent.repoPath, agent.fileName, false);
			agentProvider.invalidateCache();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('skillInstaller.enableMcpProvider', async (arg?: unknown) => {
			const provider = getMcpProviderFromCommand(arg);
			if (!provider || !provider.repoPath) {
				void vscode.window.showWarningMessage('Select an MCP provider with a repo path to enable.');
				return;
			}
			await setRepoItemEnabled('mcpProviders', provider.repoPath, provider.id, true);
			await syncMcpConfigForRepo(provider.repoPath, output);
			mcpProvider.invalidateCache();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('skillInstaller.disableMcpProvider', async (arg?: unknown) => {
			const provider = getMcpProviderFromCommand(arg);
			if (!provider || !provider.repoPath) {
				void vscode.window.showWarningMessage('Select an MCP provider with a repo path to disable.');
				return;
			}
			await setRepoItemEnabled('mcpProviders', provider.repoPath, provider.id, false);
			await syncMcpConfigForRepo(provider.repoPath, output);
			mcpProvider.invalidateCache();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('skillInstaller.syncMcpConfig', async (arg?: unknown) => {
			const repoPath = getRepoPathFromCommand(arg);
			if (repoPath) {
				await syncMcpConfigForRepo(repoPath, output);
			} else {
				await syncMcpConfigForWorkspace(output);
			}
			mcpProvider.invalidateCache();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('skillInstaller.openMcpSettings', async () => {
			await vscode.commands.executeCommand('workbench.action.openSettings', 'skillInstaller.mcp');
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('skillInstaller.runE2E', async () => {
			const config = vscode.workspace.getConfiguration();
			let url = (config.get<string>('skillInstaller.e2e.url') ?? '').trim();
			if (!url) {
				url =
					(await vscode.window.showInputBox({
						prompt: 'Enter the E2E dashboard URL to open',
						placeHolder: 'https://...'
					})) ?? '';
			}
			if (!url) {
				void vscode.window.showInformationMessage('No E2E URL configured.');
				return;
			}
			if (!/^https?:\/\//i.test(url)) {
				url = `https://${url}`;
			}
			await vscode.commands.executeCommand('simpleBrowser.show', url);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('skillInstaller.archiveDoneTasks', async (arg?: unknown) => {
			let repoPath: string | undefined;
			if (arg && typeof arg === 'object' && 'repoPath' in (arg as Record<string, unknown>)) {
				const maybe = (arg as { repoPath?: unknown }).repoPath;
				repoPath = typeof maybe === 'string' ? maybe : undefined;
			} else if (arg && typeof arg === 'object' && 'repo' in (arg as Record<string, unknown>)) {
				const repoObj = (arg as { repo?: unknown }).repo;
				if (repoObj && typeof repoObj === 'object' && 'repoPath' in (repoObj as Record<string, unknown>)) {
					const maybe = (repoObj as { repoPath?: unknown }).repoPath;
					repoPath = typeof maybe === 'string' ? maybe : undefined;
				}
			}
			await archiveDoneTasks(output, repoPath);
			workflowProvider.invalidateCache();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('skillInstaller.purgeArchivedTasks', async (arg?: unknown) => {
			let repoPath: string | undefined;
			if (arg && typeof arg === 'object' && 'repoPath' in (arg as Record<string, unknown>)) {
				const maybe = (arg as { repoPath?: unknown }).repoPath;
				repoPath = typeof maybe === 'string' ? maybe : undefined;
			} else if (arg && typeof arg === 'object' && 'repo' in (arg as Record<string, unknown>)) {
				const repoObj = (arg as { repo?: unknown }).repo;
				if (repoObj && typeof repoObj === 'object' && 'repoPath' in (repoObj as Record<string, unknown>)) {
					const maybe = (repoObj as { repoPath?: unknown }).repoPath;
					repoPath = typeof maybe === 'string' ? maybe : undefined;
				}
			}
			await purgeArchivedTasks(output, repoPath);
			workflowProvider.invalidateCache();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('skillInstaller.clearRepoContext', async (arg?: unknown) => {
			const folders = vscode.workspace.workspaceFolders ?? [];
			if (folders.length === 0) {
				void vscode.window.showInformationMessage('No workspace folders found.');
				return;
			}

			let repoPath: string | undefined;
			if (arg && typeof arg === 'object' && 'repoPath' in (arg as Record<string, unknown>)) {
				const maybe = (arg as { repoPath?: string }).repoPath;
				repoPath = typeof maybe === 'string' ? maybe : undefined;
			} else if (arg && typeof arg === 'object' && 'repo' in (arg as Record<string, unknown>)) {
				const repoObj = (arg as { repo?: unknown }).repo;
				if (repoObj && typeof repoObj === 'object' && 'repoPath' in (repoObj as Record<string, unknown>)) {
					const maybe = (repoObj as { repoPath?: string }).repoPath;
					repoPath = typeof maybe === 'string' ? maybe : undefined;
				}
			} else if (arg instanceof vscode.Uri) {
				repoPath = arg.fsPath;
			} else if (typeof arg === 'string') {
				repoPath = arg;
			}

			if (!repoPath) {
				const picked = await vscode.window.showQuickPick(
					folders.map((f) => ({ label: f.name, description: f.uri.fsPath, folder: f })),
					{ placeHolder: 'Select a repo to clear context for' }
				);
				if (!picked) {
					return;
				}
				repoPath = picked.folder.uri.fsPath;
			}

			await clearRepoContext(repoPath, output, 'prompt');
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('skillInstaller.clearAllRepoContexts', async () => {
			const folders = vscode.workspace.workspaceFolders ?? [];
			if (folders.length === 0) {
				void vscode.window.showInformationMessage('No workspace folders found.');
				return;
			}

			const choice = await vscode.window.showWarningMessage(
				'Clear repo context for ALL workspace folders? This deletes local outputs/artefacts (not tasks).',
				{ modal: true },
				'Clear All'
			);
			if (choice !== 'Clear All') {
				return;
			}

			for (const folder of folders) {
				await clearRepoContext(folder.uri.fsPath, output, 'force');
			}
		})
	);

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration('skillInstaller.mcp')) {
				mcpProvider.invalidateCache();
				const autoSync = vscode.workspace
					.getConfiguration()
					.get<boolean>('skillInstaller.mcp.autoSync', true);
				if (autoSync) {
					void syncMcpConfigForWorkspace(output);
				}
			}
		})
	);

	const autoSync = vscode.workspace.getConfiguration().get<boolean>('skillInstaller.mcp.autoSync', true);
	if (autoSync) {
		void syncMcpConfigForWorkspace(output);
	}

	output.appendLine('[Skill Installer] Activated');
}

export function deactivate(): void {
	// no-op
}
