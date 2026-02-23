import fs from 'fs';
import os from 'os';
import path from 'path';

/** Default sandboxes home: ~/.copilot/sandboxes */
export function getDefaultSandboxesHome(): string {
	return path.join(os.homedir(), '.copilot', 'sandboxes');
}

export interface SandboxDirPaths {
	/** Root dir for this sandbox: <sandboxesHome>/<sandboxId>/ */
	root: string;
	/** Session-state dir: <sandboxesHome>/<sandboxId>/session-state/ */
	sessionState: string;
	/** Logs dir: <sandboxesHome>/<sandboxId>/logs/ */
	logs: string;
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
