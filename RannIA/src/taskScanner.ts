import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { RepoTasks, TaskDiscoverySnapshot, TaskEntry } from './types';
import { existsDir, existsFile } from './utils/fs';
import { tryParseYamlFrontMatter } from './utils/yaml';
import { normalizeString } from './utils/strings';
import { getRepoTasksDir } from './enginePaths';

function isInstructionEngineRepo(repoName: string, repoPath: string): boolean {
	if (repoName.toLowerCase() === 'instruction-engine') {
		return true;
	}

	const folderPath = repoPath.replace(/\\/g, '/').toLowerCase();
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

function normalizeOwner(value: unknown): string | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	const owner = value.trim();
	return owner ? owner : undefined;
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

function getLegacyRepoTasksDir(repoPath: string): string {
	return path.join(repoPath, '.instructions', 'tasks');
}

function scanRepoTasksForPath(
	repoName: string,
	repoPath: string,
	onlyOwner: boolean,
	desiredOwnerRaw: string
): RepoTasks {
	const desiredOwner = desiredOwnerRaw.trim().toLowerCase();
	const tasksDir = getRepoTasksDir(repoPath);
	const tasksDirPath = existsDir(tasksDir) ? tasksDir : undefined;

	// Legacy repo-local task folders remain migration-only compatibility input.
	// Do not silently fall back to them here; task discovery should expose the
	// canonical repo-state store as the single durable authority.
	const _legacyTasksDir = getLegacyRepoTasksDir(repoPath);
	void _legacyTasksDir;

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

	return {
		repoName,
		repoPath,
		isInstructionEngine: isInstructionEngineRepo(repoName, repoPath),
		tasksDirPath,
		tasks
	};
}

export const __taskScannerTestExports = {
	getLegacyRepoTasksDir,
	scanRepoTasksForPath
};

export async function scanTasks(): Promise<TaskDiscoverySnapshot> {
	const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
	const config = vscode.workspace.getConfiguration();
	const onlyOwner = Boolean(config.get<boolean>('skillInstaller.tasks.onlyOwner'));
	const desiredOwnerRaw = (config.get<string>('skillInstaller.tasks.owner') ?? '').trim();

	const repos: RepoTasks[] = [];

	for (const folder of workspaceFolders) {
		repos.push(scanRepoTasksForPath(folder.name, folder.uri.fsPath, onlyOwner, desiredOwnerRaw));
	}

	repos.sort((a, b) => a.repoName.localeCompare(b.repoName));

	return {
		onlyOwner,
		desiredOwner: desiredOwnerRaw || undefined,
		repos
	};
}
