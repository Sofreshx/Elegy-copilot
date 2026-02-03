import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

interface FrontMatterResult {
	frontMatter: string;
	content: string;
}

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

function listMarkdownFiles(dirPath: string): string[] {
	if (!existsDir(dirPath)) {
		return [];
	}

	const entries = fs.readdirSync(dirPath, { withFileTypes: true });
	const files = entries
		.filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.md'))
		.map((e) => path.join(dirPath, e.name));

	files.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
	return files;
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

async function archiveTaskFile(filePath: string, archiveDir: string): Promise<'archived' | 'skipped'> {
	const content = await fs.promises.readFile(filePath, 'utf8');
	const parsed = splitFrontMatter(content);
	if (!parsed) {
		return 'skipped';
	}

	const status = parseFrontMatterValue(parsed.frontMatter, 'status');
	if (!status || status.trim().toLowerCase() !== 'done') {
		return 'skipped';
	}

	const updatedFrontMatter = updateFrontMatter(parsed.frontMatter, {
		status: 'archived',
		updated: new Date().toISOString()
	});

	const nextContent = `---\n${updatedFrontMatter}\n---${parsed.content}`;
	const destPath = path.join(archiveDir, path.basename(filePath));
	if (existsFile(destPath)) {
		return 'skipped';
	}

	await fs.promises.mkdir(archiveDir, { recursive: true });
	await fs.promises.writeFile(destPath, nextContent, 'utf8');
	await fs.promises.unlink(filePath);
	return 'archived';
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
		const files = listMarkdownFiles(tasksDir);
		for (const filePath of files) {
			try {
				const result = await archiveTaskFile(filePath, archiveDir);
				if (result === 'archived') {
					archivedCount++;
					output.appendLine(`[Tasks] Archived ${filePath}`);
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

		const files = listMarkdownFiles(archiveDir);
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
	}

	void vscode.window.showInformationMessage(`Deleted ${deletedCount} archived task(s).`);
}
