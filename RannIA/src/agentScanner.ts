import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { AgentDiscoverySnapshot, AgentEntry, RepoAgents } from './types';
import { getRepoDisabledSet } from './enablementStore';
import { getUserAgentsDir, resolveStateRoot } from './enginePaths';
import { existsDir, existsFile } from './utils/fs';
import { tryParseYamlFrontMatter } from './utils/yaml';
import { normalizeString } from './utils/strings';

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

	// Always include the user-level agent store under skillInstaller.state.root.
	const userRoot = resolveStateRoot();
	const userAgentsDir = getUserAgentsDir();
	const userAgentsDirPath = existsDir(userAgentsDir) ? userAgentsDir : undefined;
	const userDisabledSet = getRepoDisabledSet('agents', userRoot);

	const userAgents: AgentEntry[] = [];
	if (userAgentsDirPath) {
		const agentFiles = listAgentFiles(userAgentsDirPath);
		for (const filePath of agentFiles) {
			if (!existsFile(filePath)) {
				continue;
			}
			const contentStart = readFileStart(filePath);
			const fm = tryParseYamlFrontMatter(contentStart)?.fm ?? {};
			const fileName = path.basename(filePath);
			const enabled = !userDisabledSet.has(normalizeKey(fileName));

			const rawInfer = fm['infer'];
			let inferStr: string | undefined;
			if (typeof rawInfer === 'boolean') inferStr = rawInfer ? 'true' : 'false';
			else if (typeof rawInfer === 'string') inferStr = rawInfer.trim().toLowerCase();

			const userInvocable =
				normalizeBoolean(fm['user-invocable']) ??
				normalizeBoolean(fm['user-invokable']) ??
				(inferStr === 'true' || inferStr === 'user');

			let disableModelInvocation = normalizeBoolean(fm['disable-model-invocation']);
			if (disableModelInvocation === undefined) {
				if (inferStr === 'agent') {
					disableModelInvocation = false;
				} else {
					disableModelInvocation = true;
				}
			}

			userAgents.push({
				path: filePath,
				fileName,
				name: normalizeString(fm['name']) ?? fileName,
				description: normalizeString(fm['description']),
				role: normalizeString(fm['role']),
				visibility: normalizeString(fm['visibility']),
				infer: normalizeBoolean(fm['infer']),
				userInvocable,
				userInvokable: userInvocable,
				disableModelInvocation,
				repoPath: userRoot,
				enabled
			});
		}
	}

	repos.push({
		repoName: 'User Asset Home',
		repoPath: userRoot,
		isInstructionEngine: false,
		agentsDirPath: userAgentsDirPath,
		agents: userAgents
	});

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
				const fm = tryParseYamlFrontMatter(contentStart)?.fm ?? {};
				const fileName = path.basename(filePath);
				const enabled = !disabledSet.has(normalizeKey(fileName));

				// Determine new-style fields, falling back to legacy keys/`infer` when needed
				const rawInfer = fm['infer'];
				let inferStr: string | undefined;
				if (typeof rawInfer === 'boolean') inferStr = rawInfer ? 'true' : 'false';
				else if (typeof rawInfer === 'string') inferStr = rawInfer.trim().toLowerCase();

				const userInvocable =
					normalizeBoolean(fm['user-invocable']) ??
					normalizeBoolean(fm['user-invokable']) ??
					(inferStr === 'true' || inferStr === 'user');

				let disableModelInvocation = normalizeBoolean(fm['disable-model-invocation']);
				if (disableModelInvocation === undefined) {
					if (inferStr === 'agent') {
						disableModelInvocation = false; // allow model-invocation for subagents
					} else {
						// be conservative: disallow model invocation unless explicitly marked 'agent'
						disableModelInvocation = true;
					}
				}

				agents.push({
					path: filePath,
					fileName,
					name: normalizeString(fm['name']) ?? fileName,
					description: normalizeString(fm['description']),
					role: normalizeString(fm['role']),
					visibility: normalizeString(fm['visibility']),
					infer: normalizeBoolean(fm['infer']), // legacy
					userInvocable,
					userInvokable: userInvocable,
					disableModelInvocation,
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

	repos.sort((a, b) => {
		if (a.repoPath === userRoot) return -1;
		if (b.repoPath === userRoot) return 1;
		return a.repoName.localeCompare(b.repoName);
	});
	return { repos };
}
