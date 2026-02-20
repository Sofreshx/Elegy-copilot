import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { scanSkills } from './skillScanner';
import { scanTasks } from './taskScanner';
import { setRepoItemEnabled } from './enablementStore';
import { RepoSkills, SkillEntry } from './types';

function normalizeKey(value: string): string {
	return value.trim().toLowerCase();
}

async function pathExists(targetPath: string): Promise<boolean> {
	try {
		await fs.promises.stat(targetPath);
		return true;
	} catch {
		return false;
	}
}

async function copyDir(source: string, dest: string): Promise<void> {
	await fs.promises.mkdir(dest, { recursive: true });
	const entries = await fs.promises.readdir(source, { withFileTypes: true });
	for (const entry of entries) {
		const srcPath = path.join(source, entry.name);
		const destPath = path.join(dest, entry.name);
		if (entry.isDirectory()) {
			await copyDir(srcPath, destPath);
		} else if (entry.isFile()) {
			await fs.promises.copyFile(srcPath, destPath);
		}
	}
}

async function copySkillEntry(skill: SkillEntry, targetSkillsDir: string): Promise<'copied' | 'skipped'> {
	const sourcePath = skill.path;
	const stat = await fs.promises.stat(sourcePath);
	if (stat.isDirectory()) {
		const destDir = path.join(targetSkillsDir, path.basename(sourcePath));
		if (await pathExists(destDir)) {
			return 'skipped';
		}
		await copyDir(sourcePath, destDir);
		return 'copied';
	}

	const destFile = path.join(targetSkillsDir, `${skill.name}.md`);
	if (await pathExists(destFile)) {
		return 'skipped';
	}
	await fs.promises.mkdir(targetSkillsDir, { recursive: true });
	await fs.promises.copyFile(sourcePath, destFile);
	return 'copied';
}

async function pickTargetRepo(repos: RepoSkills[]): Promise<RepoSkills | undefined> {
	if (repos.length === 0) {
		return undefined;
	}
	if (repos.length === 1) {
		return repos[0];
	}
	const items = repos.map((repo) => ({
		label: repo.repoName,
		description: repo.repoPath,
		repo
	}));
	const picked = await vscode.window.showQuickPick(items, {
		placeHolder: 'Select a target repo for .github/skills'
	});
	return picked?.repo;
}

async function getRecommendedSkillSet(repoPath: string): Promise<Set<string>> {
	const snapshot = await scanTasks();
	const repo = snapshot.repos.find((r) => r.repoPath === repoPath);
	const recommended = new Set<string>();
	if (!repo) {
		return recommended;
	}
	for (const task of repo.tasks) {
		for (const skill of task.skills ?? []) {
			const key = normalizeKey(skill);
			if (key) {
				recommended.add(key);
			}
		}
	}
	return recommended;
}

export async function initializeSkills(output: vscode.OutputChannel): Promise<void> {
	const snapshot = await scanSkills();
	const targetRepos = snapshot.targetRepos;
	if (targetRepos.length === 0) {
		void vscode.window.showInformationMessage('No target repos found for skills initialization.');
		return;
	}

	const repo = await pickTargetRepo(targetRepos);
	if (!repo) {
		return;
	}

	if (snapshot.availableSkills.length === 0) {
		void vscode.window.showInformationMessage(
			'No available skills found in the VS Code user asset home (skillInstaller.state.root/skills).'
		);
		return;
	}

	const existing = new Set(repo.skills.map((s) => normalizeKey(s.name)));
	const recommended = await getRecommendedSkillSet(repo.repoPath);

	const items = snapshot.availableSkills.map((skill) => {
		const key = normalizeKey(skill.name);
		const isExisting = existing.has(key);
		const isRecommended = recommended.has(key) && !isExisting;
		const detailParts: string[] = [];
		if (isExisting) {
			detailParts.push('already in repo');
		}
		if (recommended.has(key)) {
			detailParts.push('recommended');
		}
		return {
			label: skill.name,
			description: skill.source,
			detail: detailParts.join(' • ') || skill.path,
			skill,
			picked: isRecommended
		};
	});

	const selected = await vscode.window.showQuickPick(items, {
		canPickMany: true,
		placeHolder: 'Select skills to copy into .github/skills (recommended pre-selected)'
	});

	if (!selected || selected.length === 0) {
		void vscode.window.showInformationMessage('No skills selected.');
		return;
	}

	const targetSkillsDir = path.join(repo.repoPath, '.github', 'skills');
	let copiedCount = 0;
	let skippedCount = 0;

	for (const item of selected) {
		try {
			const result = await copySkillEntry(item.skill, targetSkillsDir);
			if (result === 'copied') {
				copiedCount++;
				output.appendLine(`[Skills] Copied ${item.skill.name} to ${repo.repoName}`);
			} else {
				skippedCount++;
				output.appendLine(`[Skills] Skipped existing ${item.skill.name} in ${repo.repoName}`);
			}

			await setRepoItemEnabled('skills', repo.repoPath, item.skill.name, true);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			output.appendLine(`[Skills] Failed to copy ${item.skill.name}: ${message}`);
		}
	}

	void vscode.window.showInformationMessage(
		`Initialized ${copiedCount} skill(s). Skipped ${skippedCount} existing.`
	);
}
