import * as vscode from 'vscode';
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
import { GitHubOAuthManager, OAuthUriHandler } from './oauthManager';
import { ConnectionsTreeProvider } from './operationsConnectionsTree';
import { RequestsTreeProvider } from './operationsRequestsTree';
import { PermissionsTreeProvider } from './operationsPermissionsTree';
import { archiveDoneTasks, purgeArchivedTasks } from './taskLifecycle';
import { initializeSkills } from './skillInitializer';

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

export function activate(context: vscode.ExtensionContext): void {
	const output = vscode.window.createOutputChannel('Skill Installer');
	context.subscriptions.push(output);

	// Initialize session manager
	const sessionManager = new SessionManager(output);
	context.subscriptions.push(sessionManager);

	// Initialize GitHub OAuth manager
	const oauthManager = new GitHubOAuthManager(context.secrets, output);
	context.subscriptions.push(oauthManager);
	
	// Initialize OAuth manager in background (non-blocking)
	oauthManager.initialize().catch((err) => {
		const message = err instanceof Error ? err.message : 'Unknown error';
		output.appendLine(`[OAuth] Failed to initialize: ${message}`);
	});
	
	// Register URI handler for OAuth callback
	const uriHandler = new OAuthUriHandler(oauthManager, output);
	context.subscriptions.push(vscode.window.registerUriHandler(uriHandler));
	
	// Register login command
	context.subscriptions.push(
		vscode.commands.registerCommand('skillInstaller.login', async () => {
			await oauthManager.login();
		})
	);
	
	// Register logout command
	context.subscriptions.push(
		vscode.commands.registerCommand('skillInstaller.logout', async () => {
			if (!oauthManager.isLoggedIn()) {
				void vscode.window.showInformationMessage('Not currently logged in.');
				return;
			}
			
			const confirm = await vscode.window.showWarningMessage(
				`Are you sure you want to logout from GitHub (${oauthManager.getUser()?.login})?`,
				{ modal: true },
				'Logout'
			);
			
			if (confirm === 'Logout') {
				await oauthManager.logout();
			}
		})
	);

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

	// Set up event callback for session updates to broadcast via WebSocket
	chatParticipant.setSessionEventCallback((sessionId, event) => {
		wsServer.broadcastEvent('session_event', {
			sessionId,
			eventType: event.type,
			timestamp: event.timestamp.toISOString(),
			data: event.data,
		});
	});

	// Start WebSocket server (async, non-blocking)
	wsServer.start().catch((err) => {
		const message = err instanceof Error ? err.message : 'Unknown error';
		output.appendLine(`[WS Server] Failed to start: ${message}`);
	});

	// Register command to show connected clients
	context.subscriptions.push(
		vscode.commands.registerCommand('skillInstaller.showClientList', async () => {
			const registry = wsServer.getClientRegistry();
			const clients = registry.listClientsDto();

			if (clients.length === 0) {
				void vscode.window.showInformationMessage('No mobile companion clients connected.');
				return;
			}

			const items = clients.map(c => ({
				label: `${c.deviceType} (${c.os})`,
				description: c.clientId.substring(0, 8),
				detail: `Connected: ${new Date(c.connectionTime).toLocaleString()} | Last seen: ${new Date(c.lastSeen).toLocaleString()}`,
				client: c,
			}));

			const selected = await vscode.window.showQuickPick(items, {
				placeHolder: `${clients.length} client(s) connected`,
				title: 'Connected Mobile Companion Clients',
			});

			if (selected) {
				const action = await vscode.window.showQuickPick(
					[
						{ label: 'View Details', action: 'details' },
						{ label: 'Disconnect', action: 'disconnect' },
					],
					{ placeHolder: `Action for ${selected.label}` }
				);

				if (action?.action === 'disconnect') {
					registry.disconnectClient(selected.client.clientId);
					void vscode.window.showInformationMessage(`Disconnected client ${selected.client.clientId.substring(0, 8)}`);
				} else if (action?.action === 'details') {
					const details = [
						`Client ID: ${selected.client.clientId}`,
						`Device Type: ${selected.client.deviceType}`,
						`OS: ${selected.client.os}`,
						`App Version: ${selected.client.appVersion}`,
						`User ID: ${selected.client.userId ?? 'N/A'}`,
						`Connected: ${new Date(selected.client.connectionTime).toLocaleString()}`,
						`Last Seen: ${new Date(selected.client.lastSeen).toLocaleString()}`,
						`State: ${selected.client.state}`,
					].join('\n');
					output.appendLine(`[Client Details]\n${details}`);
					output.show();
				}
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
		vscode.commands.registerCommand('skillInstaller.refresh', () => {
			skillProvider.invalidateCache();
			agentProvider.invalidateCache();
			workflowProvider.invalidateCache();
			auditProvider.invalidateCache();
			connectionsProvider.invalidateCache();
			requestsProvider.invalidateCache();
			permissionsProvider.invalidateCache();
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
		vscode.commands.registerCommand('skillInstaller.archiveDoneTasks', async () => {
			await archiveDoneTasks(output);
			workflowProvider.invalidateCache();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('skillInstaller.purgeArchivedTasks', async () => {
			await purgeArchivedTasks(output);
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

	output.appendLine('[Skill Installer] Activated');
}

export function deactivate(): void {
	// no-op
}
