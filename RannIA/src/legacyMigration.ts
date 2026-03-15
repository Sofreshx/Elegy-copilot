import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { existsDir, existsFile } from './utils/fs';
import { getRepoAuditDir, getRepoRegistryPath, getRepoTasksArchiveDir, getRepoTasksDir } from './enginePaths';
import { AUDIT_TYPES } from './auditTree';

interface MigrationCounts {
	filesCopied: number;
	filesSkipped: number;
	errors: number;
}

type LegacyDirCopyFilter = (srcPath: string) => boolean;

function isMarkdownTaskFile(srcPath: string): boolean {
	return srcPath.toLowerCase().endsWith('.md');
}

async function copyDirRecursive(
	srcDir: string,
	destDir: string,
	output: vscode.OutputChannel,
	includeFile?: LegacyDirCopyFilter
): Promise<MigrationCounts> {
	const counts: MigrationCounts = { filesCopied: 0, filesSkipped: 0, errors: 0 };
	if (!existsDir(srcDir)) {
		return counts;
	}

	const entries = await fs.promises.readdir(srcDir, { withFileTypes: true });
	for (const entry of entries) {
		const srcPath = path.join(srcDir, entry.name);
		const destPath = path.join(destDir, entry.name);
		try {
			if (entry.isDirectory()) {
				const nested = await copyDirRecursive(srcPath, destPath, output, includeFile);
				counts.filesCopied += nested.filesCopied;
				counts.filesSkipped += nested.filesSkipped;
				counts.errors += nested.errors;
				continue;
			}
			if (!entry.isFile()) {
				counts.filesSkipped++;
				continue;
			}
			if (includeFile && !includeFile(srcPath)) {
				counts.filesSkipped++;
				continue;
			}

			if (existsFile(destPath)) {
				counts.filesSkipped++;
				continue;
			}

			await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
			await fs.promises.copyFile(srcPath, destPath);
			counts.filesCopied++;
		} catch (err) {
			counts.errors++;
			const message = err instanceof Error ? err.message : String(err);
			output.appendLine(`[Migration] Failed to copy ${srcPath}: ${message}`);
		}
	}

	return counts;
}

export const __legacyMigrationTestExports = {
	copyDirRecursive,
	isMarkdownTaskFile
};

export async function migrateLegacyRepoState(repoPath: string, output: vscode.OutputChannel): Promise<void> {
	const legacyRoot = path.join(repoPath, '.instructions');
	const legacyRegistry = path.join(legacyRoot, 'registry.json');
	const legacyTasks = path.join(legacyRoot, 'tasks');
	const legacyArchive = path.join(legacyRoot, 'tasks.archive');
	const legacyOutput = path.join(repoPath, '.instructions-output');

	let copied = 0;
	let skipped = 0;
	let errors = 0;

	// Registry
	if (existsFile(legacyRegistry)) {
		const destRegistry = getRepoRegistryPath(repoPath);
		try {
			if (!existsFile(destRegistry)) {
				await fs.promises.mkdir(path.dirname(destRegistry), { recursive: true });
				await fs.promises.copyFile(legacyRegistry, destRegistry);
				copied++;
				output.appendLine(`[Migration] Copied registry -> ${destRegistry.replace(/\\/g, '/')}`);
			} else {
				skipped++;
			}
		} catch (err) {
			errors++;
			const message = err instanceof Error ? err.message : String(err);
			output.appendLine(`[Migration] Failed to migrate registry: ${message}`);
		}
	}

	// Tasks
	{
		const destTasks = getRepoTasksDir(repoPath);
		const res = await copyDirRecursive(legacyTasks, destTasks, output, isMarkdownTaskFile);
		copied += res.filesCopied;
		skipped += res.filesSkipped;
		errors += res.errors;
		if (res.filesCopied > 0) {
			output.appendLine(`[Migration] Copied ${res.filesCopied} task file(s) -> ${destTasks.replace(/\\/g, '/')}`);
		}
	}

	// Tasks archive
	{
		const destArchive = getRepoTasksArchiveDir(repoPath);
		const res = await copyDirRecursive(legacyArchive, destArchive, output, isMarkdownTaskFile);
		copied += res.filesCopied;
		skipped += res.filesSkipped;
		errors += res.errors;
		if (res.filesCopied > 0) {
			output.appendLine(`[Migration] Copied ${res.filesCopied} archived task file(s) -> ${destArchive.replace(/\\/g, '/')}`);
		}
	}

	// Audit reports (best-effort)
	if (existsDir(legacyOutput)) {
		const destAudit = getRepoAuditDir(repoPath);
		await fs.promises.mkdir(destAudit, { recursive: true });
		for (const meta of AUDIT_TYPES) {
			const src = path.join(legacyOutput, meta.file);
			const dest = path.join(destAudit, meta.file);
			try {
				if (!existsFile(src)) {
					continue;
				}
				if (existsFile(dest)) {
					skipped++;
					continue;
				}
				await fs.promises.copyFile(src, dest);
				copied++;
			} catch (err) {
				errors++;
				const message = err instanceof Error ? err.message : String(err);
				output.appendLine(`[Migration] Failed to migrate audit report ${meta.file}: ${message}`);
			}
		}
	}

	void vscode.window.showInformationMessage(
		`Legacy migration complete for ${path.basename(repoPath)}: copied ${copied}, skipped ${skipped}, errors ${errors}.`
	);
}

export async function migrateLegacyWorkspaceState(output: vscode.OutputChannel): Promise<void> {
	const folders = vscode.workspace.workspaceFolders ?? [];
	if (folders.length === 0) {
		void vscode.window.showInformationMessage('No workspace folders found.');
		return;
	}

	const items = folders.map((f) => ({
		label: f.name,
		description: f.uri.fsPath.replace(/\\/g, '/'),
		repoPath: f.uri.fsPath,
	}));
	items.unshift({ label: '(All repos)', description: 'Migrate every workspace folder', repoPath: '' });

	const picked = await vscode.window.showQuickPick(items, {
		placeHolder: 'Select a repo to migrate legacy .instructions state into central repo-state'
	});
	if (!picked) {
		return;
	}

	if (!picked.repoPath) {
		for (const f of folders) {
			await migrateLegacyRepoState(f.uri.fsPath, output);
		}
		return;
	}

	await migrateLegacyRepoState(picked.repoPath, output);
}
