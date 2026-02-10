import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { existsDir, existsFile } from './utils/fs';

interface FrontMatterResult {
	frontMatter: string;
	content: string;
}

function listMarkdownFilesRecursive(dirPath: string): string[] {
	if (!existsDir(dirPath)) {
		return [];
	}

	const files: string[] = [];
	const pending: string[] = [dirPath];

	while (pending.length > 0) {
		const current = pending.pop();
		if (!current) {
			continue;
		}
		if (!existsDir(current)) {
			continue;
		}

		const entries = fs.readdirSync(current, { withFileTypes: true });
		for (const entry of entries) {
			const entryPath = path.join(current, entry.name);
			if (entry.isDirectory()) {
				pending.push(entryPath);
				continue;
			}
			if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
				files.push(entryPath);
			}
		}
	}

	files.sort((a, b) => a.localeCompare(b));
	return files;
}

function getUniqueArchivePath(destPath: string): string {
	if (!existsFile(destPath)) {
		return destPath;
	}

	const dir = path.dirname(destPath);
	const ext = path.extname(destPath);
	const base = path.basename(destPath, ext);

	const match = base.match(/^(.*)--archived-(\d+)$/i);
	const stem = match ? match[1] : base;
	const start = match ? Math.max(2, Number.parseInt(match[2], 10) + 1) : 2;

	for (let i = start; i < 10_000; i++) {
		const candidate = path.join(dir, `${stem}--archived-${i}${ext}`);
		if (!existsFile(candidate)) {
			return candidate;
		}
	}

	throw new Error(`Unable to allocate unique archive path for ${destPath}`);
}

// Exported for extension tests (kept small and deterministic)
export const __taskLifecycleTestExports = {
	getUniqueArchivePath,
	listMarkdownFilesRecursive
};

async function deleteEmptyDirs(dirPath: string): Promise<void> {
	if (!existsDir(dirPath)) {
		return;
	}

	const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
	await Promise.all(
		entries
			.filter((e) => e.isDirectory())
			.map(async (e) => {
				const child = path.join(dirPath, e.name);
				await deleteEmptyDirs(child);
			})
	);

	// Remove directory if it's now empty.
	try {
		const after = await fs.promises.readdir(dirPath);
		if (after.length === 0) {
			await fs.promises.rmdir(dirPath);
		}
	} catch {
		// ignore
	}
}

function splitFrontMatter(content: string): FrontMatterResult | undefined {
	if (!content.startsWith('---')) {
		return undefined;
	}

	const endMarker = '\n---';
	const endIdx = content.indexOf(endMarker, 3);
	if (endIdx === -1) {
		return undefined;
	}

	const frontMatter = content.slice(3, endIdx).trim();
	const rest = content.slice(endIdx + endMarker.length);
	return { frontMatter, content: rest };
}

function parseFrontMatterValue(frontMatter: string, key: string): string | undefined {
	const lines = frontMatter.split(/\r?\n/);
	const target = key.toLowerCase();
	for (const line of lines) {
		const match = line.match(/^\s*([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
		if (!match) {
			continue;
		}
		const lineKey = match[1].toLowerCase();
		if (lineKey === target) {
			return match[2].trim().replace(/^['"]|['"]$/g, '');
		}
	}
	return undefined;
}

function updateFrontMatter(frontMatter: string, updates: Record<string, string>): string {
	const lines = frontMatter.split(/\r?\n/);
	const seen = new Set<string>();

	const updated = lines.map((line) => {
		const match = line.match(/^(\s*)([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
		if (!match) {
			return line;
		}
		const [, indent, key] = match;
		const normalized = key.toLowerCase();
		if (updates[normalized] !== undefined) {
			seen.add(normalized);
			return `${indent}${key}: ${updates[normalized]}`;
		}
		return line;
	});

	for (const [key, value] of Object.entries(updates)) {
		if (!seen.has(key.toLowerCase())) {
			updated.push(`${key}: ${value}`);
		}
	}

	return updated.join('\n');
}

async function archiveTaskFile(
	filePath: string,
	archiveDir: string
): Promise<{ result: 'archived'; destPath: string } | { result: 'skipped'; reason: string }> {
	const content = await fs.promises.readFile(filePath, 'utf8');
	const parsed = splitFrontMatter(content);
	if (!parsed) {
		return { result: 'skipped', reason: 'missing-front-matter' };
	}

	const status = parseFrontMatterValue(parsed.frontMatter, 'status');
	if (!status || status.trim().toLowerCase() !== 'done') {
		return { result: 'skipped', reason: 'not-done' };
	}

	const updatedFrontMatter = updateFrontMatter(parsed.frontMatter, {
		status: 'archived',
		updated: new Date().toISOString()
	});

	const nextContent = `---\n${updatedFrontMatter}\n---${parsed.content}`;
	const destPath = getUniqueArchivePath(path.join(archiveDir, path.basename(filePath)));

	await fs.promises.mkdir(archiveDir, { recursive: true });
	await fs.promises.writeFile(destPath, nextContent, 'utf8');
	await fs.promises.unlink(filePath);
	return { result: 'archived', destPath };
}

export async function archiveDoneTasks(output: vscode.OutputChannel): Promise<void> {
	const folders = vscode.workspace.workspaceFolders ?? [];
	if (folders.length === 0) {
		void vscode.window.showInformationMessage('No workspace folders found.');
		return;
	}

	let archivedCount = 0;
	let skippedCount = 0;

	for (const folder of folders) {
		const repoPath = folder.uri.fsPath;
		const tasksDir = path.join(repoPath, '.instructions', 'tasks');
		if (!existsDir(tasksDir)) {
			continue;
		}

		const archiveDir = path.join(repoPath, '.instructions', 'tasks.archive');
		const files = listMarkdownFilesRecursive(tasksDir);
		for (const filePath of files) {
			try {
				const result = await archiveTaskFile(filePath, archiveDir);
				if (result.result === 'archived') {
					archivedCount++;
					output.appendLine(`[Tasks] Archived ${filePath} -> ${result.destPath}`);
				} else {
					skippedCount++;
				}
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				output.appendLine(`[Tasks] Failed to archive ${filePath}: ${message}`);
			}
		}
	}

	void vscode.window.showInformationMessage(
		`Archived ${archivedCount} task(s). Skipped ${skippedCount} task(s).`
	);
}

export async function purgeArchivedTasks(output: vscode.OutputChannel): Promise<void> {
	const folders = vscode.workspace.workspaceFolders ?? [];
	if (folders.length === 0) {
		void vscode.window.showInformationMessage('No workspace folders found.');
		return;
	}

	const confirm = await vscode.window.showWarningMessage(
		'Delete all archived task files from .instructions/tasks.archive?',
		{ modal: true },
		'Delete'
	);
	if (confirm !== 'Delete') {
		return;
	}

	let deletedCount = 0;

	for (const folder of folders) {
		const repoPath = folder.uri.fsPath;
		const archiveDir = path.join(repoPath, '.instructions', 'tasks.archive');
		if (!existsDir(archiveDir)) {
			continue;
		}

		const files = listMarkdownFilesRecursive(archiveDir);
		for (const filePath of files) {
			try {
				await fs.promises.unlink(filePath);
				deletedCount++;
				output.appendLine(`[Tasks] Deleted archived ${filePath}`);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				output.appendLine(`[Tasks] Failed to delete ${filePath}: ${message}`);
			}
		}

		await deleteEmptyDirs(archiveDir);
	}

	void vscode.window.showInformationMessage(`Deleted ${deletedCount} archived task(s).`);
}
