import { execFile } from 'child_process';
import path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface WorkspaceGitSnapshot {
	workspaceRoot: string;
	/** Git toplevel; may equal workspaceRoot. */
	repoRoot: string;
	repoName: string;
	branch: string;
	ahead: number;
	behind: number;
	modified: number;
	untracked: number;
	staged: number;
	checkedAt: string;
}

async function runGit(args: string[], cwd: string): Promise<string> {
	const { stdout } = await execFileAsync('git', args, { cwd, windowsHide: true });
	return stdout;
}

async function getRepoRoot(workspaceRoot: string): Promise<string | null> {
	try {
		const stdout = await runGit(['rev-parse', '--show-toplevel'], workspaceRoot);
		const root = stdout.trim();
		return root.length > 0 ? root : null;
	} catch {
		return null;
	}
}

async function getCurrentBranch(repoRoot: string): Promise<string> {
	const stdout = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot);
	return stdout.trim();
}

function parsePorcelainCounts(porcelain: string): { modified: number; untracked: number; staged: number } {
	const lines = porcelain
		.split('\n')
		.map((l) => l.trimEnd())
		.filter((l) => l.length >= 2);

	let modified = 0;
	let untracked = 0;
	let staged = 0;

	for (const line of lines) {
		if (line.startsWith('??')) {
			untracked++;
			continue;
		}
		const indexStatus = line[0];
		const workStatus = line[1];
		if (indexStatus !== ' ' && indexStatus !== '?') staged++;
		if (workStatus !== ' ' && workStatus !== '?') modified++;
	}

	return { modified, untracked, staged };
}

async function getStatusCounts(repoRoot: string): Promise<{ modified: number; untracked: number; staged: number }> {
	const stdout = await runGit(['status', '--porcelain'], repoRoot);
	return parsePorcelainCounts(stdout);
}

async function getAheadBehind(repoRoot: string): Promise<{ ahead: number; behind: number }> {
	try {
		const stdout = await runGit(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], repoRoot);
		const [aheadRaw, behindRaw] = stdout
			.trim()
			.split(/\s+/)
			.map((v) => parseInt(v, 10));
		return {
			ahead: Number.isFinite(aheadRaw) ? aheadRaw : 0,
			behind: Number.isFinite(behindRaw) ? behindRaw : 0,
		};
	} catch {
		return { ahead: 0, behind: 0 };
	}
}

/**
 * Computes a git snapshot for a given workspace root.
 * Returns null if the workspace is not inside a git repository, or git is unavailable.
 */
export async function getWorkspaceGitSnapshot(workspaceRootInput: string): Promise<WorkspaceGitSnapshot | null> {
	const workspaceRoot = path.resolve(workspaceRootInput);
	const repoRoot = await getRepoRoot(workspaceRoot);
	if (!repoRoot) return null;

	try {
		const [branch, counts, aheadBehind] = await Promise.all([
			getCurrentBranch(repoRoot),
			getStatusCounts(repoRoot),
			getAheadBehind(repoRoot),
		]);

		return {
			workspaceRoot,
			repoRoot,
			repoName: path.basename(repoRoot),
			branch,
			ahead: aheadBehind.ahead,
			behind: aheadBehind.behind,
			modified: counts.modified,
			untracked: counts.untracked,
			staged: counts.staged,
			checkedAt: new Date().toISOString(),
		};
	} catch {
		return null;
	}
}
