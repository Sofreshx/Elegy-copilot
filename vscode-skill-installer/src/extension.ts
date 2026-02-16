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
import { GitHubOAuthManager, OAuthUriHandler } from './oauthManager';
import { ConnectionsTreeProvider } from './operationsConnectionsTree';
import { RequestsTreeProvider } from './operationsRequestsTree';
import { PermissionsTreeProvider } from './operationsPermissionsTree';
import { archiveDoneTasks, purgeArchivedTasks } from './taskLifecycle';
import { initializeSkills } from './skillInitializer';
import { McpProvidersTreeProvider } from './mcpProvidersTree';
import { McpProviderInfo, syncMcpConfigForRepo, syncMcpConfigForWorkspace } from './mcpConfig';
import { RelayAuthBridge } from './relayAuthBridge';
import { RelayClient } from './relayClient';
import { E3Database } from './e3Database';
import { buildE3DashboardHtml } from './e3WebReport';

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

	// Register relay status command
	context.subscriptions.push(
		vscode.commands.registerCommand('skillInstaller.relayStatus', () => {
			if (!relayClient) {
				void vscode.window.showInformationMessage(
					'Cloud Relay is not enabled. Enable it in settings (skillInstaller.relay.enabled).'
				);
				return;
			}

			const status = relayClient.getStatus();
			const clientId = relayClient.getClientId();
			const userId = relayClient.getUserId();
			const parts = [`Cloud Relay: ${status}`];
			if (clientId) { parts.push(`Client: ${clientId.slice(0, 8)}`); }
			if (userId) { parts.push(`User: ${userId}`); }

			void vscode.window.showInformationMessage(parts.join(' | '));
		})
	);

	// Register relay auth test command
	context.subscriptions.push(
		vscode.commands.registerCommand('skillInstaller.relay.testAuth', async () => {
			if (!relayAuthBridge) {
				void vscode.window.showInformationMessage(
					'Cloud Relay is not enabled. Enable it in settings (skillInstaller.relay.enabled).'
				);
				return;
			}

			output.appendLine('[RelayAuth Test] Starting auth test...');
			const tokens = await relayAuthBridge.getRelayTokens();

			if (!tokens) {
				output.appendLine('[RelayAuth Test] Authentication failed — no tokens returned');
				void vscode.window.showWarningMessage('Relay Auth Test: FAILED — could not obtain tokens');
				return;
			}

			const claims = relayAuthBridge.decodeJwtClaims(tokens.accessToken);
			const expirySeconds = tokens.expiresAt - Math.floor(Date.now() / 1000);
			const expiryMinutes = Math.round(expirySeconds / 60);

			if (claims) {
				output.appendLine(`[RelayAuth Test] sub: ${claims.sub ?? 'N/A'}`);
				output.appendLine(`[RelayAuth Test] client_type: ${claims.client_type ?? 'N/A'}`);
				output.appendLine(`[RelayAuth Test] scopes: ${claims.scopes ?? claims.scope ?? 'N/A'}`);
				output.appendLine(`[RelayAuth Test] expires in: ${expiryMinutes}m (${expirySeconds}s)`);
				output.appendLine(`[RelayAuth Test] full claims: ${JSON.stringify(claims, null, 2)}`);
			} else {
				output.appendLine('[RelayAuth Test] Could not decode JWT claims');
			}

			const sub = claims?.sub ? String(claims.sub) : 'unknown';
			void vscode.window.showInformationMessage(
				`Relay Auth Test: OK | sub: ${sub} | expires in: ${expiryMinutes}m`
			);
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

	// Initialize relay client for cloud connectivity (if enabled)
	const relayConfig = vscode.workspace.getConfiguration('skillInstaller.relay');
	const relayEnabled = relayConfig.get<boolean>('enabled', false);

	let relayClient: RelayClient | undefined;
	let relayAuthBridge: RelayAuthBridge | undefined;

	if (relayEnabled) {
		relayAuthBridge = new RelayAuthBridge(context.secrets, output);
		context.subscriptions.push(relayAuthBridge);

		const rc = new RelayClient(relayAuthBridge, output);
		relayClient = rc;
		context.subscriptions.push(rc);

		// Route incoming relay requests through the WsServer handlers
		rc.setRequestHandler((request) => wsServer.handleRelayRequest(request));

		// Forward extension events to relay for remote mobile clients
		const eventEmitter = wsServer.getEventEmitter();
		eventEmitter.onEvent((event) => {
			if (rc.getStatus() === 'connected') {
				rc.sendEvent(event);
			}
		});

		// Connect to relay (async, non-blocking)
		rc.connect().catch((err) => {
			const message = err instanceof Error ? err.message : 'Unknown error';
			output.appendLine(`[Relay] Failed to connect: ${message}`);
		});

		// Log relay connection status changes
		rc.onStatusChanged((status) => {
			output.appendLine(`[Relay] Status changed: ${status}`);
		});
	}

	// ── Executive3 Database ──────────────────────────────────────────────
	const e3db = new E3Database(output);
	context.subscriptions.push(e3db);

	// Resolve workspace-local DB path: prefer first workspace folder's .e3-local/
	// This makes the DB discoverable by CLI tools and agents via run_in_terminal
	const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
	const e3WorkspaceFolder = workspaceFolders.find(isInstructionEngineFolder) ?? workspaceFolders[0];
	const e3WorkspaceDir = e3WorkspaceFolder?.uri.fsPath;
	const e3StorageDir = e3WorkspaceDir
		? path.join(e3WorkspaceDir, '.e3-local')
		: (context.storageUri?.fsPath ?? context.globalStorageUri.fsPath);
	try {
		const resolvedPath = e3db.open(e3StorageDir);
		// Write db-path.txt so CLI tools in any workspace folder can discover one canonical DB.
		for (const folder of workspaceFolders) {
			const e3LocalDir = path.join(folder.uri.fsPath, '.e3-local');
			fs.mkdirSync(e3LocalDir, { recursive: true });
			const discoveryPath = path.join(e3LocalDir, 'db-path.txt');
			fs.writeFileSync(discoveryPath, resolvedPath, 'utf-8');
			output.appendLine(`[E3 DB] Discovery file written: ${discoveryPath}`);
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Unknown error';
		output.appendLine(`[E3 DB] Auto-init failed: ${msg}`);
		// Show user-visible notification so agents know the DB is broken
		vscode.window.showWarningMessage(
			`Executive3 DB failed to initialize: ${msg}. ` +
			`Run "Executive3: Diagnostics" from the command palette for details.`
		);
	}

	context.subscriptions.push(
		vscode.commands.registerCommand('executive3.ensureDb', () => {
			if (e3db.isOpen()) {
				return JSON.stringify({ status: 'ready', path: e3db.getDbPath() });
			}
			try {
				const dbPath = e3db.open(e3StorageDir);
				return JSON.stringify({ status: 'ready', path: dbPath });
			} catch (err) {
				const msg = err instanceof Error ? err.message : 'Unknown error';
				vscode.window.showErrorMessage(`Executive3 DB error: ${msg}`);
				return JSON.stringify({ status: 'error', message: msg });
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('executive3.diagnostics', () => {
			const diag = {
				dbOpen: e3db.isOpen(),
				dbPath: e3db.getDbPath() ?? null,
				storageUri: context.storageUri?.fsPath ?? null,
				globalStorageUri: context.globalStorageUri.fsPath,
				usedStorage: e3db.isOpen() ? e3db.getDbPath() : (context.storageUri?.fsPath ?? context.globalStorageUri.fsPath),
				betterSqlite3: 'unknown' as string,
			};
			try {
				require.resolve('better-sqlite3');
				diag.betterSqlite3 = 'resolved';
			} catch {
				diag.betterSqlite3 = 'NOT FOUND';
			}
			const msg = JSON.stringify(diag, null, 2);
			output.appendLine(`[E3 DB] Diagnostics:\n${msg}`);
			output.show(true);
			return msg;
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('executive3.getTasks', (filterJson?: string) => {
			try {
				const filter = filterJson ? JSON.parse(filterJson) : undefined;
				return JSON.stringify(e3db.getTasks(filter));
			} catch (err) {
				const msg = err instanceof Error ? err.message : 'Unknown error';
				return JSON.stringify({ error: msg });
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('executive3.createTask', (taskJson: string) => {
			try {
				const task = JSON.parse(taskJson);
				const created = e3db.createTask(task);
				return JSON.stringify(created);
			} catch (err) {
				const msg = err instanceof Error ? err.message : 'Unknown error';
				return JSON.stringify({ error: msg });
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('executive3.updateTask', (id: string, status: string, errorSummary?: string) => {
			try {
				e3db.updateTaskStatus(id, status as 'not-started' | 'in-progress' | 'done' | 'blocked' | 'failed', errorSummary);
				return JSON.stringify({ success: true });
			} catch (err) {
				const msg = err instanceof Error ? err.message : 'Unknown error';
				return JSON.stringify({ error: msg });
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('executive3.logExecution', (entryJson: string) => {
			try {
				const entry = JSON.parse(entryJson);
				e3db.logExecution(entry);
				return JSON.stringify({ success: true });
			} catch (err) {
				const msg = err instanceof Error ? err.message : 'Unknown error';
				return JSON.stringify({ error: msg });
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('executive3.getSession', (sessionId?: string) => {
			try {
				const session = sessionId ? e3db.getSession(sessionId) : e3db.getActiveSession();
				return JSON.stringify(session ?? null);
			} catch (err) {
				const msg = err instanceof Error ? err.message : 'Unknown error';
				return JSON.stringify({ error: msg });
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('executive3.createSession', (sessionJson: string) => {
			try {
				const session = JSON.parse(sessionJson);
				const created = e3db.createSession(session);
				return JSON.stringify(created);
			} catch (err) {
				const msg = err instanceof Error ? err.message : 'Unknown error';
				return JSON.stringify({ error: msg });
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('executive3.getSessions', (filterJson?: string) => {
			try {
				const filter = filterJson ? JSON.parse(filterJson) : undefined;
				return JSON.stringify(e3db.getSessions(filter));
			} catch (err) {
				const msg = err instanceof Error ? err.message : 'Unknown error';
				return JSON.stringify({ error: msg });
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('executive3.createTodo', (todoJson: string) => {
			try {
				const todo = JSON.parse(todoJson);
				return JSON.stringify(e3db.createTodo(todo));
			} catch (err) {
				const msg = err instanceof Error ? err.message : 'Unknown error';
				return JSON.stringify({ error: msg });
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('executive3.getTodos', (filterJson?: string) => {
			try {
				const filter = filterJson ? JSON.parse(filterJson) : undefined;
				return JSON.stringify(e3db.getTodos(filter));
			} catch (err) {
				const msg = err instanceof Error ? err.message : 'Unknown error';
				return JSON.stringify({ error: msg });
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('executive3.createTaskPlan', (planJson: string) => {
			try {
				const plan = JSON.parse(planJson);
				return JSON.stringify(e3db.createTaskPlan(plan));
			} catch (err) {
				const msg = err instanceof Error ? err.message : 'Unknown error';
				return JSON.stringify({ error: msg });
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('executive3.getTaskPlans', (filterJson?: string) => {
			try {
				const filter = filterJson ? JSON.parse(filterJson) : undefined;
				return JSON.stringify(e3db.getTaskPlans(filter));
			} catch (err) {
				const msg = err instanceof Error ? err.message : 'Unknown error';
				return JSON.stringify({ error: msg });
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('executive3.getDbHealth', () => {
			try {
				return JSON.stringify(e3db.getDbHealth());
			} catch (err) {
				const msg = err instanceof Error ? err.message : 'Unknown error';
				return JSON.stringify({ error: msg });
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('executive3.storeContext', (noteJson: string) => {
			try {
				const note = JSON.parse(noteJson);
				e3db.storeContext(note);
				return JSON.stringify({ success: true });
			} catch (err) {
				const msg = err instanceof Error ? err.message : 'Unknown error';
				return JSON.stringify({ error: msg });
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('executive3.getContext', (scope: string, scopeId?: string) => {
			try {
				return JSON.stringify(e3db.getContext(scope, scopeId));
			} catch (err) {
				const msg = err instanceof Error ? err.message : 'Unknown error';
				return JSON.stringify({ error: msg });
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('executive3.getNextTask', (sessionId?: string) => {
			try {
				return JSON.stringify(e3db.getNextTask(sessionId));
			} catch (err) {
				const msg = err instanceof Error ? err.message : 'Unknown error';
				return JSON.stringify({ error: msg });
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('executive3.createPlan', (planJson: string) => {
			try {
				const plan = JSON.parse(planJson);
				const created = e3db.createPlan(plan);
				return JSON.stringify(created);
			} catch (err) {
				const msg = err instanceof Error ? err.message : 'Unknown error';
				return JSON.stringify({ error: msg });
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('executive3.getTaskSummary', (sessionId?: string, planId?: string) => {
			try {
				return JSON.stringify(e3db.getTaskSummary(sessionId, planId));
			} catch (err) {
				const msg = err instanceof Error ? err.message : 'Unknown error';
				return JSON.stringify({ error: msg });
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('executive3.getExecutionLog', (filterJson?: string) => {
			try {
				const filter = filterJson ? JSON.parse(filterJson) : undefined;
				return JSON.stringify(e3db.getExecutionLog(filter));
			} catch (err) {
				const msg = err instanceof Error ? err.message : 'Unknown error';
				return JSON.stringify({ error: msg });
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('executive3.incrementTaskAttempt', (taskId: string) => {
			try {
				const count = e3db.incrementTaskAttempt(taskId);
				return JSON.stringify({ attempt_count: count });
			} catch (err) {
				const msg = err instanceof Error ? err.message : 'Unknown error';
				return JSON.stringify({ error: msg });
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('executive3.incrementReplanCount', (sessionId: string) => {
			try {
				const count = e3db.incrementReplanCount(sessionId);
				return JSON.stringify({ replan_count: count });
			} catch (err) {
				const msg = err instanceof Error ? err.message : 'Unknown error';
				return JSON.stringify({ error: msg });
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('executive3.exportAll', () => {
			try {
				return JSON.stringify(e3db.exportAll());
			} catch (err) {
				const msg = err instanceof Error ? err.message : 'Unknown error';
				return JSON.stringify({ error: msg });
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('executive3.reset', () => {
			try {
				e3db.reset();
				return JSON.stringify({ success: true });
			} catch (err) {
				const msg = err instanceof Error ? err.message : 'Unknown error';
				return JSON.stringify({ error: msg });
			}
		})
	);

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
	const connectionsProvider = new ConnectionsTreeProvider(wsServer, relayClient);
	const requestsProvider = new RequestsTreeProvider(sessionManager);
	const permissionsProvider = new PermissionsTreeProvider(wsServer.getEventEmitter());
	const mcpProvider = new McpProvidersTreeProvider(output);
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
		vscode.commands.registerCommand('skillInstaller.refresh', () => {
			skillProvider.invalidateCache();
			agentProvider.invalidateCache();
			workflowProvider.invalidateCache();
			auditProvider.invalidateCache();
			connectionsProvider.invalidateCache();
			requestsProvider.invalidateCache();
			permissionsProvider.invalidateCache();
			mcpProvider.invalidateCache();
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
		vscode.commands.registerCommand('skillInstaller.openE3WebUI', async () => {
			try {
				const data = e3db.exportAll();
				const html = buildE3DashboardHtml(data);
				const outputDir = path.join(e3StorageDir, 'reports');
				fs.mkdirSync(outputDir, { recursive: true });
				const reportPath = path.join(outputDir, 'e3-dashboard.html');
				fs.writeFileSync(reportPath, html, 'utf-8');

				await vscode.env.openExternal(vscode.Uri.file(reportPath));
				void vscode.window.showInformationMessage('Opened Executive3 browser dashboard.');
			} catch (err) {
				const msg = err instanceof Error ? err.message : 'Unknown error';
				void vscode.window.showErrorMessage(`Failed to open Executive3 dashboard: ${msg}`);
			}
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
