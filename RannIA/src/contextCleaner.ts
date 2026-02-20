import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { existsDir, existsFile } from './utils/fs';
import { getRepoArtefactsDir, getRepoAuditDir, getRepoContextsDir, getRepoStateRootDir } from './enginePaths';

type ClearTargetKind = 'dir' | 'file';

interface ClearTarget {
	kind: ClearTargetKind;
	relativePath: string;
	description: string;
}

const defaultTargets: ClearTarget[] = [
	{
		kind: 'dir',
		relativePath: 'artefacts',
		description: 'Central artefact working memory'
	},
	{
		kind: 'dir',
		relativePath: 'contexts',
		description: 'Central contexts cache'
	},
	{
		kind: 'dir',
		relativePath: 'audit',
		description: 'Central audit outputs'
	}
];

function safeDisplayPath(p: string): string {
	return p.replace(/\\/g, '/');
}

function deleteDir(dirPath: string): void {
	fs.rmSync(dirPath, { recursive: true, force: true });
}

function deleteFile(filePath: string): void {
	try {
		fs.unlinkSync(filePath);
	} catch {
		// ignore
	}
}

export async function clearRepoContext(
	repoPath: string,
	output: vscode.OutputChannel,
	mode: 'prompt' | 'dry-run' | 'force' = 'prompt'
): Promise<void> {
	const repoName = path.basename(repoPath);
	const repoStateRoot = getRepoStateRootDir(repoPath);
	const existing: { target: ClearTarget; absPath: string }[] = [];
	const missing: { target: ClearTarget; absPath: string }[] = [];

	for (const target of defaultTargets) {
		const absPath =
			target.relativePath === 'artefacts'
				? getRepoArtefactsDir(repoPath)
				: target.relativePath === 'contexts'
					? getRepoContextsDir(repoPath)
					: target.relativePath === 'audit'
						? getRepoAuditDir(repoPath)
						: path.join(repoStateRoot, target.relativePath);
		const exists = target.kind === 'dir' ? existsDir(absPath) : existsFile(absPath);
		(exists ? existing : missing).push({ target, absPath });
	}

	output.appendLine(`[Skill Installer] Clear context (central repo-state): ${repoName}`);
	output.appendLine('Will remove:');
	for (const item of existing) {
		output.appendLine(`- ${safeDisplayPath(item.absPath)} (${item.target.description})`);
	}
	if (existing.length === 0) {
		output.appendLine('- (nothing found)');
	}

	if (mode === 'dry-run') {
		void missing;
		return;
	}

	if (mode === 'prompt') {
		const choice = await vscode.window.showWarningMessage(
			`Clear central repo-state for '${repoName}'? This deletes central artefacts/contexts/audits (not tasks).`,
			{ modal: true },
			'Dry Run',
			'Clear'
		);
		if (!choice) {
			return;
		}
		if (choice === 'Dry Run') {
			return;
		}
	}

	for (const item of existing) {
		if (item.target.kind === 'dir') {
			deleteDir(item.absPath);
		} else {
			deleteFile(item.absPath);
		}
	}

	output.appendLine('[Skill Installer] Clear context complete');
}
