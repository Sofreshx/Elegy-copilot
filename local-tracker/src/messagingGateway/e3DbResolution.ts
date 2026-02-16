import fs from 'fs';
import path from 'path';

export type E3DbResolutionSource = 'db-path-file' | 'workspace-default';

export interface E3DbResolution {
	workspaceRoot: string;
	dbPath: string;
	source: E3DbResolutionSource;
	dbPathFile: string;
	workspaceDefaultDbPath: string;
}

function canonicalPathForComparison(inputPath: string): string {
	const normalized = path.normalize(inputPath);
	return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function pathsEqual(a: string, b: string): boolean {
	return canonicalPathForComparison(a) === canonicalPathForComparison(b);
}

export function getWorkspaceE3LocalDir(workspaceRoot: string): string {
	return path.join(workspaceRoot, '.e3-local');
}

export function getWorkspaceDbPathFile(workspaceRoot: string): string {
	return path.join(getWorkspaceE3LocalDir(workspaceRoot), 'db-path.txt');
}

export function getWorkspaceDefaultE3DbPath(workspaceRoot: string): string {
	return path.join(getWorkspaceE3LocalDir(workspaceRoot), 'executive3.db');
}

export function resolveE3DbPathForWorkspaceRoot(workspaceRoot: string): E3DbResolution {
	const normalizedWorkspaceRoot = path.resolve(workspaceRoot);
	const dbPathFile = getWorkspaceDbPathFile(normalizedWorkspaceRoot);
	const workspaceDefaultDbPath = getWorkspaceDefaultE3DbPath(normalizedWorkspaceRoot);

	let resolvedFromFile: string | undefined;
	if (fs.existsSync(dbPathFile)) {
		const raw = fs.readFileSync(dbPathFile, 'utf8').trim();
		if (raw.length > 0) {
			// Contract says this is a canonical absolute path, but we tolerate relative paths
			// relative to the discovery file directory.
			resolvedFromFile = path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(path.dirname(dbPathFile), raw);
		}
	}

	if (resolvedFromFile && !pathsEqual(resolvedFromFile, workspaceDefaultDbPath)) {
		return {
			workspaceRoot: normalizedWorkspaceRoot,
			dbPath: resolvedFromFile,
			source: 'db-path-file',
			dbPathFile,
			workspaceDefaultDbPath,
		};
	}

	return {
		workspaceRoot: normalizedWorkspaceRoot,
		dbPath: workspaceDefaultDbPath,
		source: 'workspace-default',
		dbPathFile,
		workspaceDefaultDbPath,
	};
}
