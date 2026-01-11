import * as vscode from 'vscode';
import { SkillDiscoveryTreeProvider } from './tree';
import { TaskDiscoveryTreeProvider } from './tasksTree';
import { ActiveTaskTreeProvider } from './activeTasksTree';
import { AgentDiscoveryTreeProvider } from './agentsTree';
import { clearRepoContext } from './contextCleaner';

export function activate(context: vscode.ExtensionContext): void {
	const output = vscode.window.createOutputChannel('Skill Installer');
	context.subscriptions.push(output);

	const skillProvider = new SkillDiscoveryTreeProvider(output);
	const taskProvider = new TaskDiscoveryTreeProvider(output);
	const activeTaskProvider = new ActiveTaskTreeProvider(output);
	const agentProvider = new AgentDiscoveryTreeProvider(output);
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
		vscode.commands.registerCommand('skillInstaller.refresh', () => {
			skillProvider.invalidateCache();
			taskProvider.invalidateCache();
			activeTaskProvider.invalidateCache();
			agentProvider.invalidateCache();
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
