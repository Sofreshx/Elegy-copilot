import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export const POINTER_SCHEMA_VERSION = 1;

export interface SkillPointerFrontmatter {
	'schema-version': number;
	'vault-ref': string;
	name: string;
	description: string;
	triggers: string;
}

/**
 * Check if a SKILL.md file is a pointer (lightweight) rather than full content.
 * Pointers contain a `vault-ref:` line in their YAML frontmatter.
 */
export function isPointerSkill(skillPath: string): boolean {
	try {
		const skillMd = fs.statSync(skillPath).isDirectory()
			? path.join(skillPath, 'SKILL.md')
			: skillPath;
		const content = fs.readFileSync(skillMd, 'utf8');
		return /^---[\s\S]*?vault-ref:\s*.+[\s\S]*?---/m.test(content);
	} catch {
		return false;
	}
}

/**
 * Parse pointer frontmatter from a SKILL.md file.
 * Returns null if the file is not a valid pointer.
 */
export function parsePointerFrontmatter(content: string): SkillPointerFrontmatter | null {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) { return null; }

	const yaml = match[1];
	const fields: Record<string, string> = {};
	for (const line of yaml.split(/\r?\n/)) {
		const kv = line.match(/^(\S+):\s*(.*)$/);
		if (kv) {
			fields[kv[1]] = kv[2].trim();
		}
	}

	if (!fields['vault-ref'] || !fields['schema-version']) { return null; }

	const schemaVersion = parseInt(fields['schema-version'], 10);
	if (isNaN(schemaVersion)) { return null; }

	return {
		'schema-version': schemaVersion,
		'vault-ref': fields['vault-ref'],
		name: fields['name'] ?? '',
		description: fields['description'] ?? '',
		triggers: fields['triggers'] ?? '',
	};
}

/**
 * Generate pointer SKILL.md content for a skill.
 */
export function writePointerContent(
	name: string,
	description: string,
	triggers: string,
	vaultRef: string
): string {
	return [
		'---',
		`schema-version: ${POINTER_SCHEMA_VERSION}`,
		`vault-ref: ${vaultRef}`,
		`name: ${name}`,
		`description: ${description}`,
		`triggers: ${triggers}`,
		'---',
		'',
		`# ${name}`,
		'',
		`> This is a pointer file. Full skill content is in the vault.`,
		`> Vault reference: \`${vaultRef}\``,
		'',
		`**Description:** ${description}`,
		'',
		`**Triggers:** ${triggers}`,
		'',
	].join('\n');
}

/**
 * Check if SkillPointer mode is enabled via VS Code configuration.
 */
export function isPointerEnabled(): boolean {
	return vscode.workspace.getConfiguration().get<boolean>('skillInstaller.skillPointer.enabled', false);
}
