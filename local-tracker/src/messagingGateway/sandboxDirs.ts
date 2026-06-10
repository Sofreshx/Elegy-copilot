import fs from 'fs';
import os from 'os';
import path from 'path';

/** Default sandboxes home: ~/.elegy/sandboxes */
export function getDefaultSandboxesHome(): string {
	return path.join(os.homedir(), '.elegy', 'sandboxes');
}

export interface SandboxDirPaths {
	/** Root dir for this sandbox: <sandboxesHome>/<sandboxId>/ */
	root: string;
	/** Session-state dir: <sandboxesHome>/<sandboxId>/session-state/ */
	sessionState: string;
	/** Logs dir: <sandboxesHome>/<sandboxId>/logs/ */
	logs: string;
}

export interface CleanupSandboxDirsOptions {
	sandboxesHome?: string;
	knownSandboxIds?: Iterable<string>;
	activeSandboxIds?: Iterable<string>;
	/**
	 * Whether directories not present in knownSandboxIds should be treated as orphaned and removable.
	 * Defaults to true for backward compatibility.
	 */
	allowOrphanRemoval?: boolean;
	staleTtlMs: number;
	nowMs?: number;
}

export interface CleanupSandboxDirsResult {
	removedSandboxIds: string[];
	failedSandboxIds: string[];
	skippedActiveSandboxIds: string[];
	skippedFreshSandboxIds: string[];
}

/**
 * Startup orphan cleanup is only considered safe when at least one known sandbox ID exists.
 * Empty known sets are treated as non-authoritative snapshots.
 */
export function shouldAllowOrphanSandboxCleanup(knownSandboxIds: Iterable<string>): boolean {
	for (const sandboxId of knownSandboxIds) {
		if (typeof sandboxId === 'string' && sandboxId.trim().length > 0) {
			return true;
		}
	}
	return false;
}

/**
 * Resolves the canonical directory paths for a sandbox.
 * sandboxId is validated: must be 1-64 chars, alphanumeric + hyphens only.
 */
export function resolveSandboxDirs(sandboxId: string, sandboxesHome?: string): SandboxDirPaths {
	if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/.test(sandboxId)) {
		throw new Error('[sandboxDirs] Invalid sandboxId: must be 1-64 alphanumeric/hyphen chars, cannot start with hyphen');
	}
	const home = sandboxesHome?.trim() || getDefaultSandboxesHome();
	const root = path.join(home, sandboxId);
	return {
		root,
		sessionState: path.join(root, 'session-state'),
		logs: path.join(root, 'logs'),
	};
}

/**
 * Creates sandbox directories if they don't exist.
 * Returns the resolved paths.
 */
export function ensureSandboxDirs(sandboxId: string, sandboxesHome?: string): SandboxDirPaths {
	const dirs = resolveSandboxDirs(sandboxId, sandboxesHome);
	fs.mkdirSync(dirs.sessionState, { recursive: true });
	fs.mkdirSync(dirs.logs, { recursive: true });
	return dirs;
}

/**
 * Removes a sandbox's directory tree.
 * Best-effort: errors are logged but not thrown.
 */
export function removeSandboxDirs(sandboxId: string, sandboxesHome?: string): void {
	const dirs = resolveSandboxDirs(sandboxId, sandboxesHome);
	try {
		fs.rmSync(dirs.root, { recursive: true, force: true });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`[sandboxDirs] Failed to remove dirs for ${sandboxId}: ${msg}`);
	}
}

/**
 * Lists all sandbox IDs that have directories under the sandboxes home.
 */
export function listSandboxIds(sandboxesHome?: string): string[] {
	const home = sandboxesHome?.trim() || getDefaultSandboxesHome();
	if (!fs.existsSync(home)) return [];
	return fs.readdirSync(home, { withFileTypes: true })
		.filter(d => d.isDirectory() && /^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/.test(d.name))
		.map(d => d.name);
}

/**
 * Best-effort cleanup for sandbox directories.
 *
 * - Orphan: directory sandboxId not found in knownSandboxIds.
 * - Stale: directory mtime older than staleTtlMs and sandboxId not active.
 *
 * Safety: only validates/targets sandbox IDs returned by listSandboxIds().
 * Never throws; logs failures and returns a summary.
 */
export function cleanupSandboxDirs(options: CleanupSandboxDirsOptions): CleanupSandboxDirsResult {
	const home = options.sandboxesHome?.trim() || getDefaultSandboxesHome();
	const knownSandboxIds = new Set<string>(options.knownSandboxIds ?? []);
	const activeSandboxIds = new Set<string>(options.activeSandboxIds ?? []);
	const allowOrphanRemoval = options.allowOrphanRemoval ?? true;
	const nowMs = options.nowMs ?? Date.now();

	const removedSandboxIds: string[] = [];
	const failedSandboxIds: string[] = [];
	const skippedActiveSandboxIds: string[] = [];
	const skippedFreshSandboxIds: string[] = [];

	let sandboxIds: string[];
	try {
		sandboxIds = listSandboxIds(home).sort((a, b) => a.localeCompare(b));
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`[sandboxDirs] Failed to list sandbox directories for cleanup: ${msg}`);
		return {
			removedSandboxIds,
			failedSandboxIds,
			skippedActiveSandboxIds,
			skippedFreshSandboxIds,
		};
	}

	for (const sandboxId of sandboxIds) {
		if (activeSandboxIds.has(sandboxId)) {
			skippedActiveSandboxIds.push(sandboxId);
			continue;
		}

		const sandboxRoot = resolveSandboxDirs(sandboxId, home).root;
		const isOrphan = allowOrphanRemoval && !knownSandboxIds.has(sandboxId);

		let isStale = false;
		try {
			const stat = fs.statSync(sandboxRoot);
			isStale = nowMs - stat.mtimeMs >= options.staleTtlMs;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`[sandboxDirs] Failed to stat sandbox dir ${sandboxId}: ${msg}`);
			failedSandboxIds.push(sandboxId);
			continue;
		}

		if (!isOrphan && !isStale) {
			skippedFreshSandboxIds.push(sandboxId);
			continue;
		}

		try {
			fs.rmSync(sandboxRoot, { recursive: true, force: true });
			removedSandboxIds.push(sandboxId);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`[sandboxDirs] Failed to cleanup sandbox dir ${sandboxId}: ${msg}`);
			failedSandboxIds.push(sandboxId);
		}
	}

	return {
		removedSandboxIds,
		failedSandboxIds,
		skippedActiveSandboxIds,
		skippedFreshSandboxIds,
	};
}
