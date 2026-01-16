import * as vscode from 'vscode';
import { SkillDiscoveryTreeProvider } from './tree';
import { TaskDiscoveryTreeProvider } from './tasksTree';
import { ActiveTaskTreeProvider } from './activeTasksTree';
import { AgentDiscoveryTreeProvider } from './agentsTree';
import { clearRepoContext } from './contextCleaner';
import { WorkflowTaskTreeProvider } from './workflowTasksTree';
import { setRepoItemEnabled } from './enablementStore';
import { AgentEntry, SkillEntry } from './types';

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

	const skillProvider = new SkillDiscoveryTreeProvider(output);
	const taskProvider = new TaskDiscoveryTreeProvider(output);
	const activeTaskProvider = new ActiveTaskTreeProvider(output);
	const agentProvider = new AgentDiscoveryTreeProvider(output);
	const workflowProvider = new WorkflowTaskTreeProvider(output);
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('skillInstaller.skillsView', skillProvider)
	);
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('skillInstaller.tasksView', taskProvider)
	);
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('skillInstaller.activeTasksView', activeTaskProvider)
	);
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('skillInstaller.agentsView', agentProvider)
	);
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('skillInstaller.workflowView', workflowProvider)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('skillInstaller.refresh', () => {
			skillProvider.invalidateCache();
			taskProvider.invalidateCache();
			activeTaskProvider.invalidateCache();
			agentProvider.invalidateCache();
			workflowProvider.invalidateCache();
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
