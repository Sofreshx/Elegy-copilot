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
import { ConnectionsTreeProvider } from './operationsConnectionsTree';
import { RequestsTreeProvider } from './operationsRequestsTree';
import { PermissionsTreeProvider } from './operationsPermissionsTree';
import { archiveDoneTasks, purgeArchivedTasks } from './taskLifecycle';
import { initializeSkills } from './skillInitializer';
import { McpProvidersTreeProvider } from './mcpProvidersTree';
import { McpProviderInfo, syncMcpConfigForRepo, syncMcpConfigForWorkspace } from './mcpConfig';
import { DumpCleanerTreeProvider } from './dumpCleanerTree';
import { migrateLegacyWorkspaceState } from './legacyMigration';
import { resumeMigration, getCurrentPhase, migrateIn, migrateOut } from './skillPointerLifecycle';
import { isPointerEnabled } from './skillPointer';
import { buildSearchIndex, SkillSearchIndex } from './skillResolver';

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

export function activate(context: vscode.ExtensionContext): void {
	const output = vscode.window.createOutputChannel('RannIA');
	context.subscriptions.push(output);

	// SkillPointer: resume any interrupted migration before discovery
	resumeMigration(output);

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

	// ── WS Port Discovery ─────────────────────────────────────────────────
	context.subscriptions.push(
		vscode.commands.registerCommand('skillInstaller.ws.showPort', async () => {
			const wsConfig = vscode.workspace.getConfiguration('skillInstaller.ws');
			const wsEnabled = wsConfig.get<boolean>('enabled', false);
			const port = wsServer.getPort();

			if (!wsEnabled) {
				const choice = await vscode.window.showWarningMessage(
					'WebSocket server is disabled. Enable skillInstaller.ws.enabled to use the WS server.',
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

	// SkillPointer: build search index if in pointer mode
	let skillSearchIndex: SkillSearchIndex | undefined;
	if (isPointerEnabled()) {
		skillSearchIndex = buildSearchIndex();
		output.appendLine(`[SkillPointer] Search index built: ${skillSearchIndex.entries.length} entries`);
	}

	context.subscriptions.push(
		vscode.commands.registerCommand('skillInstaller.skillPointer.refreshIndex', () => {
			skillSearchIndex = buildSearchIndex();
			output.appendLine(`[SkillPointer] Search index refreshed: ${skillSearchIndex?.entries.length ?? 0} entries`);
			skillProvider.invalidateCache();
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
				test: 'unit-test-runner',
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
		vscode.commands.registerCommand('skillInstaller.migrateLegacyState', async () => {
			await migrateLegacyWorkspaceState(output);
			workflowProvider.invalidateCache();
			skillProvider.invalidateCache();
			agentProvider.invalidateCache();
			auditProvider.invalidateCache();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('skillInstaller.skillPointer.migrate', () => {
			const phase = getCurrentPhase();
			const enabled = isPointerEnabled();

			if (enabled && phase === 'disabled') {
				const result = migrateIn(output);
				if (result.success) {
					void vscode.window.showInformationMessage('SkillPointer migration complete. Skills are now in pointer mode.');
				} else {
					void vscode.window.showErrorMessage(`SkillPointer migration failed: ${result.error}`);
				}
			} else if (!enabled && phase === 'enabled') {
				const result = migrateOut(output);
				if (result.success) {
					void vscode.window.showInformationMessage('SkillPointer restoration complete. Skills are back to full mode.');
				} else {
					void vscode.window.showErrorMessage(`SkillPointer restoration failed: ${result.error}`);
				}
			} else {
				void vscode.window.showInformationMessage(`SkillPointer: phase=${phase}, flag=${enabled ? 'enabled' : 'disabled'}. No action needed.`);
			}

			skillProvider.invalidateCache();
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

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration('skillInstaller.skillPointer.enabled')) {
				const enabled = vscode.workspace.getConfiguration().get<boolean>('skillInstaller.skillPointer.enabled', false);
				const phase = getCurrentPhase();
				if (enabled && phase === 'disabled') {
					migrateIn(output);
					skillProvider.invalidateCache();
				} else if (!enabled && phase === 'enabled') {
					migrateOut(output);
					skillProvider.invalidateCache();
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
