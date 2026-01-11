import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

type ClearTargetKind = 'dir' | 'file';

interface ClearTarget {
	kind: ClearTargetKind;
	relativePath: string;
	description: string;
}

const defaultTargets: ClearTarget[] = [
	{
		kind: 'dir',
		relativePath: '.instructions-output',
		description: 'Generated reports/logs (developer-local)'
	},
	{
		kind: 'file',
		relativePath: path.join('.instructions', 'active-tasks.md'),
		description: 'Session RAM (developer-local)'
	},
	{
		kind: 'dir',
		relativePath: path.join('.instructions', 'artefacts'),
		description: 'Artefact working memory (clearable by request)'
	},
	{
		kind: 'dir',
		relativePath: path.join('.instructions', 'fragments'),
		description: 'Fragment scratch (if used)'
	},
	{
		kind: 'dir',
		relativePath: path.join('.instructions', 'tmp'),
		description: 'Temporary scratch (if used)'
	},
	{
		kind: 'dir',
		relativePath: path.join('.instructions', '.tmp'),
		description: 'Temporary scratch (if used)'
	},
	{
		kind: 'dir',
		relativePath: path.join('.instructions', '.cache'),
		description: 'Cache (if used)'
	}
];

function existsDir(dirPath: string): boolean {
	try {
		return fs.statSync(dirPath).isDirectory();
	} catch {
		return false;
	}
}

function existsFile(filePath: string): boolean {
	try {
		return fs.statSync(filePath).isFile();
	} catch {
		return false;
	}
}

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
	const existing: { target: ClearTarget; absPath: string }[] = [];
	const missing: { target: ClearTarget; absPath: string }[] = [];

	for (const target of defaultTargets) {
		const absPath = path.join(repoPath, target.relativePath);
		const exists = target.kind === 'dir' ? existsDir(absPath) : existsFile(absPath);
		(exists ? existing : missing).push({ target, absPath });
	}

	output.appendLine(`[Skill Installer] Clear context: ${repoName}`);
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
			`Clear repo context for '${repoName}'? This deletes local outputs/artefacts (not tasks).`,
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
