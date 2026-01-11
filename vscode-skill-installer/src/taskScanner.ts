import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { RepoTasks, TaskDiscoverySnapshot, TaskEntry } from './types';

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

function isInstructionEngineFolder(folder: vscode.WorkspaceFolder): boolean {
	const name = folder.name.toLowerCase();
	if (name === 'instruction-engine') {
		return true;
	}

	const folderPath = folder.uri.fsPath.replace(/\\/g, '/').toLowerCase();
	return folderPath.endsWith('/instruction-engine');
}

function readFileStart(filePath: string, maxBytes = 64_000): string {
	const fd = fs.openSync(filePath, 'r');
	try {
		const buffer = Buffer.allocUnsafe(maxBytes);
		const bytesRead = fs.readSync(fd, buffer, 0, maxBytes, 0);
		return buffer.subarray(0, bytesRead).toString('utf8');
	} finally {
		fs.closeSync(fd);
	}
}

function tryParseYamlFrontMatter(text: string): { fm: Record<string, unknown>; bodyStartIndex: number } | undefined {
	// Minimal front matter parser for the task schema.
	// Only supports simple "key: value" and "key: [a, b]" / "key: [\n  - a\n]" cases.
	if (!text.startsWith('---')) {
		return undefined;
	}

	const endMarker = '\n---';
	const endIdx = text.indexOf(endMarker, 3);
	if (endIdx === -1) {
		return undefined;
	}

	const yamlBlock = text.slice(3, endIdx).trim();
	const fm: Record<string, unknown> = {};

	const lines = yamlBlock.split(/\r?\n/);
	let currentListKey: string | undefined;

	for (const rawLine of lines) {
		const line = rawLine.trimEnd();
		if (!line.trim() || line.trimStart().startsWith('#')) {
			continue;
		}

		const listMatch = line.match(/^\s*-\s+(.*)$/);
		if (listMatch && currentListKey) {
			const item = listMatch[1].trim();
			const arr = (fm[currentListKey] as unknown[]) ?? [];
			arr.push(stripQuotes(item));
			fm[currentListKey] = arr;
			continue;
		}

		currentListKey = undefined;
		const kv = line.match(/^\s*([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
		if (!kv) {
			continue;
		}

		const key = kv[1];
		let value = kv[2].trim();
		if (value === '') {
			// Potential multi-line list in subsequent lines
			fm[key] = [];
			currentListKey = key;
			continue;
		}

		// Inline list: [a, b]
		if (value.startsWith('[') && value.endsWith(']')) {
			const inside = value.slice(1, -1).trim();
			if (inside === '') {
				fm[key] = [];
			} else {
				fm[key] = inside.split(',').map((s) => stripQuotes(s.trim())).filter(Boolean);
			}
			continue;
		}

		fm[key] = stripQuotes(value);
	}

	return { fm, bodyStartIndex: endIdx + endMarker.length };
}

function stripQuotes(value: string): string {
	const trimmed = value.trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function normalizeOwner(value: unknown): string | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	const owner = value.trim();
	return owner ? owner : undefined;
}

function normalizeString(value: unknown): string | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	const s = value.trim();
	return s ? s : undefined;
}

function normalizeStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const arr = value
		.map((v) => (typeof v === 'string' ? v.trim() : ''))
		.filter((v) => v.length > 0);
	return arr.length > 0 ? arr : undefined;
}

function getTaskLabel(filePath: string, fm: Record<string, unknown>): string {
	const title = normalizeString(fm['title']);
	if (title) {
		return title;
	}
	return path.basename(filePath);
}

function listTaskFiles(tasksDir: string): string[] {
	if (!existsDir(tasksDir)) {
		return [];
	}

	const entries = fs.readdirSync(tasksDir, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		if (!entry.isFile()) {
			continue;
		}
		if (!entry.name.toLowerCase().endsWith('.md')) {
			continue;
		}
		files.push(path.join(tasksDir, entry.name));
	}
	files.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
	return files;
}

export async function scanTasks(): Promise<TaskDiscoverySnapshot> {
	const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
	const config = vscode.workspace.getConfiguration();
	const onlyOwner = Boolean(config.get<boolean>('skillInstaller.tasks.onlyOwner'));
	const desiredOwnerRaw = (config.get<string>('skillInstaller.tasks.owner') ?? '').trim();
	const desiredOwner = desiredOwnerRaw.toLowerCase();

	const repos: RepoTasks[] = [];

	for (const folder of workspaceFolders) {
		// Mirror skill scanner behavior: treat instruction-engine as a special folder.
		// Tasks are usually tracked in target repos, but we still include engine tasks if present.
		const repoPath = folder.uri.fsPath;
		const tasksDir = path.join(repoPath, '.instructions', 'tasks');
		const tasksDirPath = existsDir(tasksDir) ? tasksDir : undefined;

		const tasks: TaskEntry[] = [];
		if (tasksDirPath) {
			const taskFiles = listTaskFiles(tasksDirPath);
			for (const filePath of taskFiles) {
				if (!existsFile(filePath)) {
					continue;
				}
				const contentStart = readFileStart(filePath);
				const parsed = tryParseYamlFrontMatter(contentStart);
				const fm = parsed?.fm ?? {};

				const owner = normalizeOwner(fm['owner']);
				if (onlyOwner) {
					if (!desiredOwner) {
						// If no owner configured, do not hide everything; just show all.
					} else if (!owner || owner.toLowerCase() !== desiredOwner) {
						continue;
					}
				}

				tasks.push({
					path: filePath,
					fileName: path.basename(filePath),
					label: getTaskLabel(filePath, fm),
					id: normalizeString(fm['id']),
					type: normalizeString(fm['type']),
					status: normalizeString(fm['status']),
					priority: normalizeString(fm['priority']),
					owner,
					skills: normalizeStringArray(fm['skills']),
					created: normalizeString(fm['created']),
					updated: normalizeString(fm['updated'])
				});
			}
		}

		repos.push({
			repoName: folder.name,
			repoPath,
			isInstructionEngine: isInstructionEngineFolder(folder),
			tasksDirPath,
			tasks
		});
	}

	repos.sort((a, b) => a.repoName.localeCompare(b.repoName));

	return {
		onlyOwner,
		desiredOwner: desiredOwnerRaw || undefined,
		repos
	};
}
