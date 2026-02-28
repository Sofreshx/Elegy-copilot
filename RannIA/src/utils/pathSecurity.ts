import * as fs from 'fs';
import * as path from 'path';

/**
 * Check if a resolved path is confined within the given root directory.
 * Prevents path traversal attacks (e.g., ../../etc/passwd).
 */
export function isConfinedToRoot(candidatePath: string, rootDir: string): boolean {
	const resolvedCandidate = path.resolve(candidatePath);
	const resolvedRoot = path.resolve(rootDir);
	const normalizedCandidate = resolvedCandidate.toLowerCase();
	const normalizedRoot = resolvedRoot.toLowerCase();

	return normalizedCandidate === normalizedRoot
		|| normalizedCandidate.startsWith(normalizedRoot + path.sep);
}

/**
 * Reject paths that contain symbolic links.
 * Returns true if the path (or any component) is a symlink.
 */
export function rejectSymlink(targetPath: string): boolean {
	try {
		const stat = fs.lstatSync(targetPath);
		if (stat.isSymbolicLink()) {
			return true;
		}

		// Also check parent directories for symlinks
		let current = path.resolve(targetPath);
		const root = path.parse(current).root;
		while (current !== root) {
			const parent = path.dirname(current);
			if (parent === current) { break; }
			try {
				const parentStat = fs.lstatSync(current);
				if (parentStat.isSymbolicLink()) {
					return true;
				}
			} catch {
				break;
			}
			current = parent;
		}

		return false;
	} catch {
		return true; // Fail-closed: can't stat means reject
	}
}

/**
 * Check if a path string contains traversal segments (.. or .).
 */
export function containsTraversalSegment(pathStr: string): boolean {
	const normalized = pathStr.replace(/\\/g, '/');
	const segments = normalized.split('/');
	return segments.some((seg) => seg === '..' || seg === '.');
}
