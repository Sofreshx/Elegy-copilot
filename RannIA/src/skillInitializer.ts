import * as vscode from 'vscode';
import { buildCatalogControlPlaneUrl, DEFAULT_CATALOG_CONTROL_PLANE_URL } from './catalogControlPlane';
import { scanSkills } from './skillScanner';
import { RepoSkills } from './types';

async function pickTargetRepo(repos: RepoSkills[]): Promise<RepoSkills | undefined | null> {
	if (repos.length === 0) {
		return undefined;
	}
	if (repos.length === 1) {
		return repos[0];
	}
	const items = repos.map((repo) => ({
		label: repo.repoName,
		description: repo.repoPath,
		repo
	}));
	const picked = await vscode.window.showQuickPick(items, {
		placeHolder: 'Select a repo to manage in the copilot-ui Catalog control plane'
	});
	return picked ? picked.repo : null;
}

function getCatalogControlPlaneUrl(repo?: RepoSkills): string {
	const configuredBaseUrl = vscode.workspace
		.getConfiguration()
		.get<string>('skillInstaller.catalog.baseUrl', DEFAULT_CATALOG_CONTROL_PLANE_URL);

	return buildCatalogControlPlaneUrl({
		baseUrl: configuredBaseUrl,
		tab: 'catalog',
		catalogSection: 'assets',
		repoPath: repo?.repoPath,
		source: 'rannia',
		intent: repo ? 'repo-skill-mutation-handoff' : 'skill-mutation-handoff'
	});
}

export async function initializeSkills(output: vscode.OutputChannel): Promise<void> {
	const snapshot = await scanSkills();
	const repo = await pickTargetRepo(snapshot.targetRepos);
	if (repo === null) {
		return;
	}
	const url = getCatalogControlPlaneUrl(repo);

	output.appendLine(`[Skills] Redirecting skill mutation to copilot-ui control plane: ${url}`);

	await vscode.commands.executeCommand('simpleBrowser.show', url);

	const actions = repo ? ['Copy Repo Path', 'Open External'] : ['Open External'];
	const message = repo
		? `Opened copilot-ui Catalog for ${repo.repoName}. Use copilot-ui for skill installs and repo-local mutations; RannIA remains a discovery surface.`
		: 'Opened copilot-ui Catalog. Use copilot-ui for skill installs and repo-local mutations; RannIA remains a discovery surface.';

	const choice = await vscode.window.showInformationMessage(message, ...actions);
	if (choice === 'Copy Repo Path' && repo) {
		await vscode.env.clipboard.writeText(repo.repoPath);
		void vscode.window.showInformationMessage(`Copied repo path for ${repo.repoName}.`);
		return;
	}

	if (choice === 'Open External') {
		await vscode.env.openExternal(vscode.Uri.parse(url));
	}
}
