import * as fs from 'fs';
import * as path from 'path';
import { getSkillVaultDir, getUserSkillsDir } from './enginePaths';
import { parsePointerFrontmatter, isPointerSkill, POINTER_SCHEMA_VERSION } from './skillPointer';
import { existsDir, existsFile } from './utils/fs';
import { isConfinedToRoot, rejectSymlink, containsTraversalSegment } from './utils/pathSecurity';

// --- Types ---

export interface SkillIndexEntry {
	name: string;
	description: string;
	triggers: string;
	vaultRef: string;
	vaultPath: string;
}

export interface SkillSearchIndex {
	entries: SkillIndexEntry[];
	builtAt: string;
}

// --- Vault reference parsing ---

/**
 * Parse vault-ref from a pointer SKILL.md file.
 * Returns the vault-ref string or null if not a valid pointer.
 */
export function parseVaultRef(skillPath: string): string | null {
	try {
		const skillMd = fs.statSync(skillPath).isDirectory()
			? path.join(skillPath, 'SKILL.md')
			: skillPath;
		const content = fs.readFileSync(skillMd, 'utf8');
		const parsed = parsePointerFrontmatter(content);
		return parsed?.['vault-ref'] ?? null;
	} catch {
		return null;
	}
}

// --- On-demand skill resolution ---

/**
 * Resolve a skill by name: if it's a pointer, load from vault. Fail-closed.
 * Returns the path to the resolved SKILL.md (vault or original), or null on failure.
 */
export function resolveSkill(skillName: string): string | null {
	const skillsDir = getUserSkillsDir();
	const skillPath = path.join(skillsDir, skillName);
	
	if (!existsDir(skillPath)) {
		return null;
	}

	// If not a pointer, return the path directly
	if (!isPointerSkill(skillPath)) {
		const skillMd = path.join(skillPath, 'SKILL.md');
		return existsFile(skillMd) ? skillMd : null;
	}

	// Pointer: resolve via vault
	const vaultRef = parseVaultRef(skillPath);
	if (!vaultRef) {
		return null; // Fail-closed: invalid pointer
	}

	// Security: reject traversal segments in vault-ref
	if (containsTraversalSegment(vaultRef)) {
		return null; // Fail-closed: path traversal attempt
	}

	const vaultDir = getSkillVaultDir();
	const vaultSkillDir = path.join(vaultDir, vaultRef);
	const vaultSkillMd = path.join(vaultSkillDir, 'SKILL.md');

	// Security: verify resolved path is confined to vault root
	if (!isConfinedToRoot(vaultSkillDir, vaultDir)) {
		return null; // Fail-closed: path escapes vault
	}

	// Security: reject symlinks in the resolved path
	if (rejectSymlink(vaultSkillDir)) {
		return null; // Fail-closed: symlink detected
	}

	if (!existsDir(vaultSkillDir) || !existsFile(vaultSkillMd)) {
		return null; // Fail-closed: vault entry missing
	}

	// Validate schema version
	try {
		const content = fs.readFileSync(path.join(skillPath, 'SKILL.md'), 'utf8');
		const parsed = parsePointerFrontmatter(content);
		if (!parsed || parsed['schema-version'] !== POINTER_SCHEMA_VERSION) {
			return null; // Fail-closed: unsupported schema version
		}
	} catch {
		return null;
	}

	return vaultSkillMd;
}

// --- Search index ---

/**
 * Build an in-memory search index from all skills in the vault.
 * Used for the search/execute pattern where skills are discovered by keyword matching.
 */
export function buildSearchIndex(): SkillSearchIndex {
	const vaultDir = getSkillVaultDir();
	const entries: SkillIndexEntry[] = [];

	if (!existsDir(vaultDir)) {
		return { entries, builtAt: new Date().toISOString() };
	}

	const dirs = fs.readdirSync(vaultDir, { withFileTypes: true });

	for (const dir of dirs) {
		if (!dir.isDirectory() || dir.name.startsWith('.')) {
			continue;
		}

		const skillMd = path.join(vaultDir, dir.name, 'SKILL.md');
		if (!existsFile(skillMd)) {
			continue;
		}

		try {
			const content = fs.readFileSync(skillMd, 'utf8');
			
			// Extract description and triggers from the full SKILL.md
			const descMatch = content.match(/^description:\s*(.+)$/m)
				?? content.match(/^>\s*(.+)$/m);
			const description = descMatch ? descMatch[1].trim() : '';

			const triggerMatch = content.match(/triggers[^:]*:\s*(.+)$/im);
			const triggers = triggerMatch ? triggerMatch[1].trim() : '';

			entries.push({
				name: dir.name,
				description,
				triggers,
				vaultRef: dir.name,
				vaultPath: path.join(vaultDir, dir.name),
			});
		} catch {
			// Skip unreadable entries
			continue;
		}
	}

	entries.sort((a, b) => a.name.localeCompare(b.name));
	return { entries, builtAt: new Date().toISOString() };
}

/**
 * Search the index by query string. Returns entries matching name, description, or triggers.
 * Substring match with relevance scoring.
 */
export function searchIndex(index: SkillSearchIndex, query: string): SkillIndexEntry[] {
	const q = query.trim().toLowerCase();
	if (!q) {
		return [...index.entries];
	}

	const scored: Array<{ entry: SkillIndexEntry; score: number }> = [];

	for (const entry of index.entries) {
		let score = 0;
		const nameLower = entry.name.toLowerCase();
		const descLower = entry.description.toLowerCase();
		const trigLower = entry.triggers.toLowerCase();

		// Exact name match is highest
		if (nameLower === q) {
			score += 100;
		} else if (nameLower.includes(q)) {
			score += 50;
		}

		// Trigger matches
		if (trigLower.includes(q)) {
			score += 30;
		}

		// Description matches
		if (descLower.includes(q)) {
			score += 10;
		}

		// Multi-word: check individual terms
		const terms = q.split(/\s+/);
		if (terms.length > 1) {
			for (const term of terms) {
				if (nameLower.includes(term)) { score += 5; }
				if (trigLower.includes(term)) { score += 3; }
				if (descLower.includes(term)) { score += 1; }
			}
		}

		if (score > 0) {
			scored.push({ entry, score });
		}
	}

	scored.sort((a, b) => b.score - a.score);
	return scored.map((s) => s.entry);
}
