import * as fs from 'fs';
import * as path from 'path';
import {
	DEFAULT_PROVIDER_CATALOG,
	buildProviderQualifiedAssetKey,
	inferAssetProvenance,
} from '@instruction-engine/contracts';
import { getSkillVaultDir, getUserSkillsDir } from './enginePaths';
import { discoverSkillArtifacts, resolveVaultSkillArtifact } from './skillDiscovery';
import { parsePointerFrontmatter, isPointerSkill, POINTER_SCHEMA_VERSION } from './skillPointer';
import { existsDir, existsFile } from './utils/fs';
import { isConfinedToRoot, rejectSymlink, containsTraversalSegment } from './utils/pathSecurity';

// --- Types ---

export interface SkillIndexEntry {
	name: string;
	description: string;
	triggers: string;
	assetKey: string;
	namespace?: string;
	provider?: string;
	viewPath: string;
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

interface ResolvedSkillEntry {
	name: string;
	assetKey: string;
	namespace?: string;
	provider?: string;
	viewPath: string;
	contentPath: string;
	description: string;
	triggers: string;
}

function toPosixPath(inputPath: string): string {
	return String(inputPath || '').replace(/\\/g, '/');
}

function safeRealpath(absPath: string): string {
	try {
		if (typeof fs.realpathSync.native === 'function') {
			return fs.realpathSync.native(absPath);
		}
		return fs.realpathSync(absPath);
	} catch {
		return path.resolve(absPath);
	}
}

function extractDescriptionAndTriggers(content: string): Pick<ResolvedSkillEntry, 'description' | 'triggers'> {
	const descMatch = content.match(/^description:\s*(.+)$/m)
		?? content.match(/^>\s*(.+)$/m);
	const triggerMatch = content.match(/triggers[^:]*:\s*(.+)$/im);
	return {
		description: descMatch ? descMatch[1].trim() : '',
		triggers: triggerMatch ? triggerMatch[1].trim() : '',
	};
}

function createResolvedSkillEntry(
	contentPath: string,
	name: string,
	namespace: string | undefined,
	viewPath: string
): ResolvedSkillEntry | undefined {
	if (!existsFile(contentPath)) {
		return undefined;
	}

	try {
		const content = fs.readFileSync(contentPath, 'utf8');
		const provenance = inferAssetProvenance({
			kind: 'skill',
			resolvedPath: toPosixPath(safeRealpath(contentPath)),
			namespace,
			providers: DEFAULT_PROVIDER_CATALOG
		});
		const assetKey = provenance.providerId
			? buildProviderQualifiedAssetKey('skill', name, provenance)
			: name;
		return {
			name,
			assetKey,
			namespace,
			provider: provenance.providerId,
			viewPath,
			contentPath,
			...extractDescriptionAndTriggers(content)
		};
	} catch {
		return undefined;
	}
}

function buildSkillLookupEntries(
	skillsDir: string,
	vaultDir: string
): Array<ResolvedSkillEntry & { source: 'skills' | 'skills-vault'; isPointer: boolean; vaultRef: string }> {
	const results: Array<ResolvedSkillEntry & { source: 'skills' | 'skills-vault'; isPointer: boolean; vaultRef: string }> = [];

	for (const skill of discoverSkillArtifacts(skillsDir, 'skills')) {
		const pointer = isPointerSkill(skill.rootPath);
		if (pointer) {
			const vaultRef = parseVaultRef(skill.rootPath);
			if (!vaultRef || containsTraversalSegment(vaultRef)) {
				continue;
			}
			try {
				const pointerContent = fs.readFileSync(path.join(skill.rootPath, 'SKILL.md'), 'utf8');
				const parsedPointer = parsePointerFrontmatter(pointerContent);
				if (!parsedPointer || parsedPointer['schema-version'] !== POINTER_SCHEMA_VERSION) {
					continue;
				}
			} catch {
				continue;
			}
			const resolvedVault = resolveVaultSkillArtifact(vaultDir, vaultRef);
			if (!resolvedVault) {
				continue;
			}
			const entry = createResolvedSkillEntry(
				resolvedVault.contentPath,
				resolvedVault.name,
				resolvedVault.namespace,
				resolvedVault.viewPath
			);
			if (entry) {
				results.push({
					...entry,
					source: 'skills',
					isPointer: true,
					vaultRef,
					contentPath: resolvedVault.contentPath
				});
			}
			continue;
		}

		const entry = createResolvedSkillEntry(skill.contentPath, skill.name, skill.namespace, skill.viewPath);
		if (entry) {
			results.push({
				...entry,
				source: 'skills',
				isPointer: false,
				vaultRef: skill.relativePath
			});
		}
	}

	for (const skill of discoverSkillArtifacts(vaultDir, 'skills-vault')) {
		const entry = createResolvedSkillEntry(skill.contentPath, skill.name, skill.namespace, skill.viewPath);
		if (entry) {
			results.push({
				...entry,
				source: 'skills-vault',
				isPointer: false,
				vaultRef: skill.relativePath
			});
		}
	}

	return results;
}

function dedupeResolvedEntries(
	entries: Array<ResolvedSkillEntry & { source: 'skills' | 'skills-vault'; isPointer: boolean; vaultRef: string }>
): Array<ResolvedSkillEntry & { source: 'skills' | 'skills-vault'; isPointer: boolean; vaultRef: string }> {
	const byKey = new Map<string, ResolvedSkillEntry & { source: 'skills' | 'skills-vault'; isPointer: boolean; vaultRef: string }>();
	for (const entry of entries) {
		const existing = byKey.get(entry.assetKey);
		if (!existing) {
			byKey.set(entry.assetKey, entry);
			continue;
		}

		const existingPriority = existing.source === 'skills-vault' ? 3 : existing.isPointer ? 1 : 2;
		const nextPriority = entry.source === 'skills-vault' ? 3 : entry.isPointer ? 1 : 2;
		if (nextPriority > existingPriority) {
			byKey.set(entry.assetKey, entry);
		}
	}

	return Array.from(byKey.values()).sort((a, b) => {
		const nameCompare = a.name.localeCompare(b.name);
		if (nameCompare !== 0) {
			return nameCompare;
		}
		return a.assetKey.localeCompare(b.assetKey);
	});
}

function resolveSkillMatch(
	skillIdentity: string,
	skillsDir: string,
	vaultDir: string
): string | null {
	const query = skillIdentity.trim().toLowerCase();
	if (!query) {
		return null;
	}

	const entries = dedupeResolvedEntries(buildSkillLookupEntries(skillsDir, vaultDir));
	const exactAssetKey = entries.find((entry) => entry.assetKey.toLowerCase() === query);
	if (exactAssetKey) {
		return exactAssetKey.contentPath;
	}

	const exactNamespace = entries.find(
		(entry) => `${entry.namespace ?? ''}/${entry.name}`.replace(/^\/+/, '').toLowerCase() === query
	);
	if (exactNamespace) {
		return exactNamespace.contentPath;
	}

	const exactName = entries.find(
		(entry) => entry.name.toLowerCase() === query && !entry.provider
	) ?? entries.find((entry) => entry.name.toLowerCase() === query);
	if (exactName) {
		return exactName.contentPath;
	}

	return null;
}

function isSafeResolvedSkillPath(contentPath: string, skillsDir: string, vaultDir: string): boolean {
	const skillRoot = path.dirname(contentPath);
	const withinSkillsRoot = isConfinedToRoot(skillRoot, skillsDir);
	const withinVaultRoot = isConfinedToRoot(skillRoot, vaultDir);
	if (!withinSkillsRoot && !withinVaultRoot) {
		return false;
	}
	if (rejectSymlink(skillRoot)) {
		return false;
	}
	return existsFile(contentPath);
}

// --- On-demand skill resolution ---

/**
 * Resolve a skill by name: if it's a pointer, load from vault. Fail-closed.
 * Returns the path to the resolved SKILL.md (vault or original), or null on failure.
 */
export function resolveSkill(skillName: string): string | null {
	const skillsDir = getUserSkillsDir();
	const vaultDir = getSkillVaultDir();
	return resolveSkillFromRoots(skillName, skillsDir, vaultDir);
}

// --- Search index ---

/**
 * Build an in-memory search index from all skills in the vault.
 * Used for the search/execute pattern where skills are discovered by keyword matching.
 */
export function buildSearchIndex(): SkillSearchIndex {
	return buildSearchIndexFromRoots(getUserSkillsDir(), getSkillVaultDir());
}

export function resolveSkillFromRoots(skillName: string, skillsDir: string, vaultDir: string): string | null {
	const directMatch = resolveSkillMatch(skillName, skillsDir, vaultDir);
	if (directMatch && isSafeResolvedSkillPath(directMatch, skillsDir, vaultDir)) {
		return directMatch;
	}

	const skillPath = path.join(skillsDir, skillName);
	if (!existsDir(skillPath)) {
		return null;
	}

	if (!isPointerSkill(skillPath)) {
		const skillMd = path.join(skillPath, 'SKILL.md');
		return existsFile(skillMd) ? skillMd : null;
	}

	const vaultRef = parseVaultRef(skillPath);
	if (!vaultRef || containsTraversalSegment(vaultRef)) {
		return null;
	}

	const resolvedVault = resolveVaultSkillArtifact(vaultDir, vaultRef);
	if (!resolvedVault) {
		return null;
	}

	if (!isConfinedToRoot(resolvedVault.rootPath, vaultDir)) {
		return null;
	}

	if (rejectSymlink(resolvedVault.rootPath)) {
		return null;
	}

	if (!existsDir(resolvedVault.rootPath) || !existsFile(resolvedVault.contentPath)) {
		return null;
	}

	try {
		const content = fs.readFileSync(path.join(skillPath, 'SKILL.md'), 'utf8');
		const parsed = parsePointerFrontmatter(content);
		if (!parsed || parsed['schema-version'] !== POINTER_SCHEMA_VERSION) {
			return null;
		}
	} catch {
		return null;
	}

	return resolvedVault.contentPath;
}

export function buildSearchIndexFromRoots(skillsDir: string, vaultDir: string): SkillSearchIndex {
	const entries: SkillIndexEntry[] = [];

	if (!existsDir(skillsDir) && !existsDir(vaultDir)) {
		return { entries, builtAt: new Date().toISOString() };
	}

	for (const entry of dedupeResolvedEntries(buildSkillLookupEntries(skillsDir, vaultDir))) {
		entries.push({
			name: entry.name,
			description: entry.description,
			triggers: entry.triggers,
			assetKey: entry.assetKey,
			namespace: entry.namespace,
			provider: entry.provider,
			viewPath: entry.viewPath,
			vaultRef: entry.vaultRef,
			vaultPath: path.dirname(entry.contentPath),
		});
	}

	entries.sort((a, b) => {
		const nameCompare = a.name.localeCompare(b.name);
		if (nameCompare !== 0) {
			return nameCompare;
		}
		return a.assetKey.localeCompare(b.assetKey);
	});
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
		const assetKeyLower = entry.assetKey.toLowerCase();
		const namespaceLower = String(entry.namespace || '').toLowerCase();
		const providerLower = String(entry.provider || '').toLowerCase();
		const descLower = entry.description.toLowerCase();
		const trigLower = entry.triggers.toLowerCase();

		// Exact name match is highest
		if (assetKeyLower === q) {
			score += 125;
		} else if (`${namespaceLower}/${nameLower}`.replace(/^\/+/, '') === q) {
			score += 110;
		} else if (nameLower === q) {
			score += 100;
		} else if (nameLower.includes(q)) {
			score += 50;
		} else if (assetKeyLower.includes(q)) {
			score += 45;
		}

		// Trigger matches
		if (trigLower.includes(q)) {
			score += 30;
		}

		// Description matches
		if (descLower.includes(q)) {
			score += 10;
		}

		if (namespaceLower.includes(q)) {
			score += 20;
		}

		if (providerLower.includes(q)) {
			score += 15;
		}

		// Multi-word: check individual terms
		const terms = q.split(/\s+/);
		if (terms.length > 1) {
			for (const term of terms) {
				if (nameLower.includes(term)) { score += 5; }
				if (assetKeyLower.includes(term)) { score += 4; }
				if (namespaceLower.includes(term)) { score += 3; }
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
