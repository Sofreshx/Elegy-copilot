import * as vscode from 'vscode';
import { scanSkills } from './skillScanner';
import { RepoSkills, SkillDiscoverySnapshot, SkillEntry } from './types';

type NodeKind = 'root' | 'section' | 'repo' | 'skill';

interface BaseNode {
	kind: NodeKind;
	label: string;
	description?: string;
	contextValue?: string;
	command?: vscode.Command;
	iconPath?: vscode.ThemeIcon;
	children?: Node[];
}

interface SkillNode extends BaseNode {
	kind: 'skill';
	skill: SkillEntry;
}

interface RepoNode extends BaseNode {
	kind: 'repo';
	repo: RepoSkills;
}

interface SectionNode extends BaseNode {
	kind: 'section';
}

interface RootNode extends BaseNode {
	kind: 'root';
}

type Node = SkillNode | RepoNode | SectionNode | RootNode;

export class SkillDiscoveryTreeProvider implements vscode.TreeDataProvider<Node> {
	private _onDidChangeTreeData = new vscode.EventEmitter<Node | undefined | null | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private snapshot: SkillDiscoverySnapshot | undefined;

	constructor(private readonly output: vscode.OutputChannel) {}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: Node): vscode.TreeItem {
		const item = new vscode.TreeItem(
			element.label,
			element.children && element.children.length > 0
				? vscode.TreeItemCollapsibleState.Collapsed
				: vscode.TreeItemCollapsibleState.None
		);

		item.description = element.description;
		item.contextValue = element.contextValue;
		item.command = element.command;
		item.iconPath = element.iconPath;
		return item;
	}

	async getChildren(element?: Node): Promise<Node[]> {
		if (!element) {
			if (!this.snapshot) {
				this.snapshot = await scanSkills();
				this.logSnapshot(this.snapshot);
			}
			return this.buildRootNodes(this.snapshot);
		}

		// For expandable nodes, re-scan to keep the view fresh when users expand.
		if (element.kind === 'section' || element.kind === 'repo') {
			this.snapshot = await scanSkills();
			this.logSnapshot(this.snapshot);
			const roots = this.buildRootNodes(this.snapshot);
			const remapped = this.findMatchingNode(roots, element);
			return remapped?.children ?? [];
		}

		return [];
	}

	async getParent(element: Node): Promise<Node | undefined> {
		void element;
		return undefined;
	}

	invalidateCache(): void {
		this.snapshot = undefined;
		this.refresh();
	}

	private buildRootNodes(snapshot: SkillDiscoverySnapshot): Node[] {
		const availableSection: SectionNode = {
			kind: 'section',
			label: 'Available (instruction-engine)',
			description: snapshot.availableSkills.length.toString(),
			iconPath: new vscode.ThemeIcon('library'),
			children: snapshot.availableSkills.map((s) => this.toSkillNode(s))
		};

		const loadedSection: SectionNode = {
			kind: 'section',
			label: 'Loaded (target repos)',
			description: snapshot.targetRepos.reduce((sum, r) => sum + r.skills.length, 0).toString(),
			iconPath: new vscode.ThemeIcon('repo'),
			children: snapshot.targetRepos.map((r) => this.toRepoNode(r))
		};

		return [availableSection, loadedSection];
	}

	private toRepoNode(repo: RepoSkills): RepoNode {
		const hasSkillsDir = Boolean(repo.skillsDirPath);
		return {
			kind: 'repo',
			label: repo.repoName,
			description: hasSkillsDir ? `${repo.skills.length} skills` : 'no .github/skills',
			iconPath: new vscode.ThemeIcon(hasSkillsDir ? 'folder' : 'circle-slash'),
			repo,
			children: repo.skills.map((s) => this.toSkillNode(s))
		};
	}

	private toSkillNode(skill: SkillEntry): SkillNode {
		const enabled = skill.enabled !== false;
		const descriptionParts: string[] = [];
		if (skill.source === 'instruction-engine') {
			descriptionParts.push('engine');
		} else {
			descriptionParts.push('discoverable');
		}
		if (!enabled) {
			descriptionParts.push('disabled');
		}
		const description = descriptionParts.length > 0 ? descriptionParts.join(' • ') : undefined;
		const contextValue = enabled
			? 'skillInstaller.skill.enabled'
			: 'skillInstaller.skill.disabled';
		const icon = enabled ? 'book' : 'circle-slash';
		return {
			kind: 'skill',
			label: skill.name,
			description,
			contextValue,
			iconPath: new vscode.ThemeIcon(icon),
			skill,
			command: {
				title: 'Open Skill',
				command: 'vscode.open',
				arguments: [vscode.Uri.file(skill.path)]
			}
		};
	}

	private logSnapshot(snapshot: SkillDiscoverySnapshot): void {
		this.output.clear();
		this.output.appendLine('[Skill Installer] Skill discovery snapshot');
		this.output.appendLine(`engineRoot: ${snapshot.engineRoot ?? '(not found)'}`);
		this.output.appendLine(
			`engineSkillsRoots: ${snapshot.engineSkillsRoots.length > 0 ? snapshot.engineSkillsRoots.join(' | ') : '(not found)'}`
		);
		this.output.appendLine(`available: ${snapshot.availableSkills.length}`);
		this.output.appendLine(`targetRepos: ${snapshot.targetRepos.length}`);
	}

	private findMatchingNode(nodes: Node[], target: Node): Node | undefined {
		for (const node of nodes) {
			if (node.kind === target.kind && node.label === target.label) {
				return node;
			}
			const childMatch = node.children ? this.findMatchingNode(node.children, target) : undefined;
			if (childMatch) {
				return childMatch;
			}
		}
		return undefined;
	}
}
