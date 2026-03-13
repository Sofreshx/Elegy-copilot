import * as fs from 'fs';
import * as path from 'path';
import { normalizeCatalogAssetKey } from './catalogAdapter';
import { existsDir, existsFile } from './utils/fs';
import { containsTraversalSegment } from './utils/pathSecurity';

export interface DiscoveredSkillCandidate {
	name: string;
	namespace?: string;
	rootPath: string;
	contentPath: string;
	viewPath: string;
	relativePath: string;
	relativeSegments: string[];
}

function normalizeSkillKey(value: string): string {
	return normalizeCatalogAssetKey(value.replace(/[\\/]+$/g, ''));
}

export function parseDiscoveredSkill(
	rootLabel: string,
	relativeSegments: string[],
	skillRootPath: string
): DiscoveredSkillCandidate | undefined {
	if (relativeSegments.length === 0) {
		return undefined;
	}

	const skillFile = path.join(skillRootPath, 'SKILL.md');
	const indexFile = path.join(skillRootPath, 'index.md');
	if (!existsFile(skillFile) && !existsFile(indexFile)) {
		return undefined;
	}

	let namespace: string | undefined;
	let name = '';
	if (relativeSegments.length === 1) {
		name = normalizeSkillKey(relativeSegments[0]);
	} else if (relativeSegments[0] === 'providers' && relativeSegments.length >= 3) {
		namespace = normalizeSkillKey(relativeSegments[1]);
		name = normalizeSkillKey(relativeSegments[2]);
	} else {
		namespace = normalizeSkillKey(relativeSegments[0]);
		name = normalizeSkillKey(relativeSegments[1]);
	}

	if (!name) {
		return undefined;
	}

	const fileName = existsFile(skillFile) ? 'SKILL.md' : 'index.md';
	return {
		name,
		namespace,
		rootPath: skillRootPath,
		contentPath: existsFile(skillFile) ? skillFile : indexFile,
		viewPath: `${rootLabel}/${relativeSegments.join('/')}/${fileName}`,
		relativePath: relativeSegments.join('/'),
		relativeSegments: [...relativeSegments],
	};
}

export function discoverSkillArtifacts(skillsRoot: string, rootLabel = path.basename(skillsRoot)): DiscoveredSkillCandidate[] {
	if (!existsDir(skillsRoot)) {
		return [];
	}

	const queue: Array<{ dirPath: string; relativeSegments: string[] }> = [
		{ dirPath: skillsRoot, relativeSegments: [] }
	];
	const results: DiscoveredSkillCandidate[] = [];

	while (queue.length > 0) {
		const current = queue.shift();
		if (!current) {
			continue;
		}

		const entries = fs.readdirSync(current.dirPath, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory()) {
				continue;
			}

			const entryPath = path.join(current.dirPath, entry.name);
			const relativeSegments = [...current.relativeSegments, entry.name];
			const parsed = parseDiscoveredSkill(rootLabel, relativeSegments, entryPath);
			if (parsed) {
				results.push(parsed);
			}

			if (relativeSegments.length < 3) {
				queue.push({ dirPath: entryPath, relativeSegments });
			}
		}
	}

	return results.sort((left, right) => {
		const nameCompare = left.name.localeCompare(right.name);
		if (nameCompare !== 0) {
			return nameCompare;
		}
		const namespaceCompare = String(left.namespace || '').localeCompare(String(right.namespace || ''));
		if (namespaceCompare !== 0) {
			return namespaceCompare;
		}
		return left.viewPath.localeCompare(right.viewPath);
	});
}

export function normalizeVaultRelativeRef(vaultRef: string): string | null {
	const normalized = String(vaultRef || '')
		.trim()
		.replace(/\\/g, '/')
		.replace(/\/+/g, '/')
		.replace(/^\/+|\/+$/g, '');
	if (!normalized) {
		return null;
	}
	if (path.isAbsolute(normalized) || /^[a-z]:\//i.test(normalized)) {
		return null;
	}
	if (containsTraversalSegment(normalized)) {
		return null;
	}

	const strippedPrefix = normalized.replace(/^skills-vault\//i, '');
	const segments = strippedPrefix.split('/').filter(Boolean);
	if (segments.length === 0) {
		return null;
	}

	const lastSegment = segments[segments.length - 1].toLowerCase();
	if (lastSegment === 'skill.md' || lastSegment === 'index.md') {
		segments.pop();
	}

	return segments.length > 0 ? segments.join('/') : null;
}

export function resolveVaultSkillArtifact(vaultRoot: string, vaultRef: string): DiscoveredSkillCandidate | undefined {
	const relativeRef = normalizeVaultRelativeRef(vaultRef);
	if (!relativeRef) {
		return undefined;
	}

	const relativeSegments = relativeRef.split('/').filter(Boolean);
	if (relativeSegments.length === 0) {
		return undefined;
	}

	const skillRootPath = path.join(vaultRoot, ...relativeSegments);
	if (!existsDir(skillRootPath)) {
		return undefined;
	}

	return parseDiscoveredSkill('skills-vault', relativeSegments, skillRootPath);
}
