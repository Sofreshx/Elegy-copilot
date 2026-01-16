import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { AgentDiscoverySnapshot, AgentEntry, RepoAgents } from './types';
import { getRepoDisabledSet } from './enablementStore';

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

function tryParseYamlFrontMatter(text: string): Record<string, unknown> | undefined {
	// Minimal front matter parser.
	// Supports simple "key: value" and "key: [a, b]" / multi-line lists.
	// (We intentionally do NOT attempt to parse nested YAML like handoffs.)
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
			fm[key] = [];
			currentListKey = key;
			continue;
		}

		if (value.startsWith('[') && value.endsWith(']')) {
			const inside = value.slice(1, -1).trim();
			if (inside === '') {
				fm[key] = [];
			} else {
				fm[key] = inside
					.split(',')
					.map((s) => stripQuotes(s.trim()))
					.filter(Boolean);
			}
			continue;
		}

		fm[key] = stripQuotes(value);
	}

	return fm;
}

function normalizeString(value: unknown): string | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	const s = value.trim();
	return s ? s : undefined;
}

function normalizeBoolean(value: unknown): boolean | undefined {
	if (typeof value === 'boolean') {
		return value;
	}
	if (typeof value !== 'string') {
		return undefined;
	}
	const s = value.trim().toLowerCase();
	if (s === 'true') {
		return true;
	}
	if (s === 'false') {
		return false;
	}
	return undefined;
}

function normalizeKey(value: string): string {
	return value.trim().toLowerCase();
}

function listAgentFiles(agentsDir: string): string[] {
	if (!existsDir(agentsDir)) {
		return [];
	}

	const entries = fs.readdirSync(agentsDir, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		if (!entry.isFile()) {
			continue;
		}
		const lower = entry.name.toLowerCase();
		if (!lower.endsWith('.agent.md')) {
			continue;
		}
		files.push(path.join(agentsDir, entry.name));
	}

	files.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
	return files;
}

export async function scanAgents(): Promise<AgentDiscoverySnapshot> {
	const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
	const repos: RepoAgents[] = [];

	for (const folder of workspaceFolders) {
		const repoPath = folder.uri.fsPath;
		const agentsDir = path.join(repoPath, '.github', 'agents');
		const agentsDirPath = existsDir(agentsDir) ? agentsDir : undefined;
		const disabledSet = getRepoDisabledSet('agents', repoPath);

		const agents: AgentEntry[] = [];
		if (agentsDirPath) {
			const agentFiles = listAgentFiles(agentsDirPath);
			for (const filePath of agentFiles) {
				if (!existsFile(filePath)) {
					continue;
				}
				const contentStart = readFileStart(filePath);
				const fm = tryParseYamlFrontMatter(contentStart) ?? {};
				const fileName = path.basename(filePath);
				const enabled = !disabledSet.has(normalizeKey(fileName));

				agents.push({
					path: filePath,
					fileName,
					name: normalizeString(fm['name']) ?? fileName,
					description: normalizeString(fm['description']),
					role: normalizeString(fm['role']),
					visibility: normalizeString(fm['visibility']),
					infer: normalizeBoolean(fm['infer']),
					repoPath,
					enabled
				});
			}
		}

		repos.push({
			repoName: folder.name,
			repoPath,
			isInstructionEngine: isInstructionEngineFolder(folder),
			agentsDirPath,
			agents
		});
	}

	repos.sort((a, b) => a.repoName.localeCompare(b.repoName));
	return { repos };
}
