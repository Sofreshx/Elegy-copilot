import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

export interface RepoStateKey {
	repoId: string;
	repoPath: string;
	repoLabel: string;
}

function normalizePathForKey(p: string): string {
	return p.replace(/\\/g, '/').trim().toLowerCase();
}

function expandHome(p: string): string {
	const trimmed = p.trim();
	if (!trimmed) {
		return trimmed;
	}
	if (trimmed === '~') {
		return os.homedir();
	}
	if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
		return path.join(os.homedir(), trimmed.slice(2));
	}
	return trimmed;
}

function defaultStateRoot(): string {
	return path.join(os.homedir(), '.copilot');
}

export function resolveStateRoot(): string {
	const config = vscode.workspace.getConfiguration();
	const configured = (config.get<string>('skillInstaller.state.root') ?? '').trim();
	const resolved = configured ? path.resolve(expandHome(configured)) : defaultStateRoot();
	return resolved;
}

export function getUserAgentsDir(): string {
	return path.join(resolveStateRoot(), 'agents');
}

export function getUserSkillsDir(): string {
	return path.join(resolveStateRoot(), 'skills');
}

export function getUserPromptsDir(): string {
	return path.join(resolveStateRoot(), 'prompts');
}

export function getUserCopilotInstructionsPath(): string {
	return path.join(resolveStateRoot(), 'copilot-instructions.md');
}

export function getSessionsRootDir(): string {
	return path.join(resolveStateRoot(), 'session-state');
}

export function getSessionsArchiveRootDir(): string {
	return path.join(resolveStateRoot(), 'sessions-archive');
}

export function getSessionDir(sessionId: string): string {
	return path.join(getSessionsRootDir(), sessionId);
}

export function getRepoStateKey(repoPath: string): RepoStateKey {
	const normalized = normalizePathForKey(repoPath);
	const hash = crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
	return {
		repoId: hash.slice(0, 12),
		repoPath,
		repoLabel: path.basename(repoPath),
	};
}

export function getRepoStateRootDir(repoPath: string): string {
	const { repoId } = getRepoStateKey(repoPath);
	return path.join(resolveStateRoot(), 'repo-state', repoId);
}

export function getRepoRegistryPath(repoPath: string): string {
	return path.join(getRepoStateRootDir(repoPath), 'registry.json');
}

export function getRepoTasksDir(repoPath: string): string {
	return path.join(getRepoStateRootDir(repoPath), 'tasks');
}

export function getRepoTasksArchiveDir(repoPath: string): string {
	return path.join(getRepoStateRootDir(repoPath), 'tasks.archive');
}

export function getRepoArtefactsDir(repoPath: string): string {
	return path.join(getRepoStateRootDir(repoPath), 'artefacts');
}

export function getSkillVaultDir(): string {
	return path.join(resolveStateRoot(), 'skills-vault');
}

export function getMigrationJournalPath(): string {
	return path.join(getSkillVaultDir(), '.migration-journal.json');
}

export function getRepoContextsDir(repoPath: string): string {
	return path.join(getRepoStateRootDir(repoPath), 'contexts');
}

export function getRepoAuditDir(repoPath: string): string {
	return path.join(getRepoStateRootDir(repoPath), 'audit');
}
