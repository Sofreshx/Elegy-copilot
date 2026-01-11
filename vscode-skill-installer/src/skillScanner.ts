import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { RepoSkills, SkillDiscoverySnapshot, SkillEntry } from './types';

function existsDir(dirPath: string): boolean {
	try {
		return fs.statSync(dirPath).isDirectory();
	} catch {
		return false;
	}
}

function existsFile(filePath: string): boolean {
	try {
		return fs.statSync(filePath).isFile();
	} catch {
		return false;
	}
}

function normalizeSkillNameFromFile(filename: string): string {
	return filename.replace(/\.md$/i, '');
}

function listSkillsInDir(skillsRoot: string, source: 'instruction-engine' | 'target-repo'): SkillEntry[] {
	if (!existsDir(skillsRoot)) {
		return [];
	}

	const entries = fs.readdirSync(skillsRoot, { withFileTypes: true });
	const results: SkillEntry[] = [];

	for (const entry of entries) {
		if (entry.isDirectory()) {
			const skillDir = path.join(skillsRoot, entry.name);
			// Common patterns:
			// - <skill>/SKILL.md
			// - <skill>/index.md
			const skillFile = path.join(skillDir, 'SKILL.md');
			const indexFile = path.join(skillDir, 'index.md');
			if (existsFile(skillFile) || existsFile(indexFile)) {
				results.push({ name: entry.name, path: skillDir, source });
				continue;
			}

			// If directory exists but doesn't match known patterns, still treat it as a skill folder
			results.push({ name: entry.name, path: skillDir, source });
			continue;
		}

		if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
			const fullPath = path.join(skillsRoot, entry.name);
			results.push({ name: normalizeSkillNameFromFile(entry.name), path: fullPath, source });
		}
	}

	results.sort((a, b) => a.name.localeCompare(b.name));
	return results;
}

function isInstructionEngineFolder(folder: vscode.WorkspaceFolder): boolean {
	const name = folder.name.toLowerCase();
	if (name === 'instruction-engine') {
		return true;
	}

	const folderPath = folder.uri.fsPath.replace(/\\/g, '/').toLowerCase();
	return folderPath.endsWith('/instruction-engine');
}

function getEngineSkillsRoots(engineRoot: string): string[] {
	// Prefer .github/skills as the canonical source.
	// .codex/skills exists for Codex compatibility and may duplicate entries.
	const roots: string[] = [];
	const githubSkills = path.join(engineRoot, '.github', 'skills');
	if (existsDir(githubSkills)) {
		roots.push(githubSkills);
	}
	const codexSkills = path.join(engineRoot, '.codex', 'skills');
	if (existsDir(codexSkills)) {
		roots.push(codexSkills);
	}
	return roots;
}

function dedupeSkills(entries: SkillEntry[]): SkillEntry[] {
	// Dedupe by skill name; prefer earlier entries (we'll pass .github/skills first).
	const byName = new Map<string, SkillEntry>();
	for (const entry of entries) {
		const key = entry.name.trim().toLowerCase();
		if (!key) {
			continue;
		}
		if (!byName.has(key)) {
			byName.set(key, entry);
			continue;
		}

		// If we already have one, keep it (earlier wins). However, if the existing
		// entry looks like a single markdown file and the new entry is a directory-based
		// skill, prefer the directory.
		const existing = byName.get(key)!;
		const existingIsFile = existing.path.toLowerCase().endsWith('.md');
		const nextIsFile = entry.path.toLowerCase().endsWith('.md');
		if (existingIsFile && !nextIsFile) {
			byName.set(key, entry);
		}
	}

	const results = Array.from(byName.values());
	results.sort((a, b) => a.name.localeCompare(b.name));
	return results;
}

export async function scanSkills(): Promise<SkillDiscoverySnapshot> {
	const workspaceFolders = vscode.workspace.workspaceFolders ?? [];

	const engineFolder = workspaceFolders.find(isInstructionEngineFolder);
	const engineRoot = engineFolder?.uri.fsPath;
	const engineSkillsRoots = engineRoot ? getEngineSkillsRoots(engineRoot) : [];

	// Merge skill roots with a stable priority order: .github/skills first, then .codex/skills.
	// De-dupe by name to prevent showing duplicates when both roots exist.
	const availableSkills = dedupeSkills(
		engineSkillsRoots.flatMap((root) => listSkillsInDir(root, 'instruction-engine'))
	);

	const targetRepos: RepoSkills[] = [];

	for (const folder of workspaceFolders) {
		if (isInstructionEngineFolder(folder)) {
			continue;
		}

		const repoPath = folder.uri.fsPath;
		const skillsDir = path.join(repoPath, '.github', 'skills');
		const skills = listSkillsInDir(skillsDir, 'target-repo');

		targetRepos.push({
			repoName: folder.name,
			repoPath,
			skillsDirPath: existsDir(skillsDir) ? skillsDir : undefined,
			skills
		});
	}

	// Stable order
	targetRepos.sort((a, b) => a.repoName.localeCompare(b.repoName));

	return {
		engineRoot,
		engineSkillsRoots,
		availableSkills,
		targetRepos
	};
}
