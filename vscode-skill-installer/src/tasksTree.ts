import * as vscode from 'vscode';
import { scanTasks } from './taskScanner';
import { RepoTasks, TaskDiscoverySnapshot, TaskEntry } from './types';

type NodeKind = 'section' | 'repo' | 'status' | 'task';

interface BaseNode {
	kind: NodeKind;
	key: string;
	label: string;
	description?: string;
	contextValue?: string;
	command?: vscode.Command;
	iconPath?: vscode.ThemeIcon;
	children?: Node[];
}

interface TaskNode extends BaseNode {
	kind: 'task';
	task: TaskEntry;
}

interface RepoNode extends BaseNode {
	kind: 'repo';
	repo: RepoTasks;
}

interface StatusNode extends BaseNode {
	kind: 'status';
	statusKey: string;
}

interface SectionNode extends BaseNode {
	kind: 'section';
}

type Node = TaskNode | RepoNode | StatusNode | SectionNode;

const knownStatusOrder = ['in-progress', 'blocked', 'not-started', 'done', 'archived'] as const;
type KnownStatus = (typeof knownStatusOrder)[number];

function normalizeStatus(value: string | undefined): string {
	const s = (value ?? '').trim();
	return s ? s.toLowerCase() : 'unknown';
}

function statusSortKey(statusKey: string): number {
	const idx = knownStatusOrder.indexOf(statusKey as KnownStatus);
	return idx === -1 ? 999 : idx;
}

function statusIcon(statusKey: string): vscode.ThemeIcon {
	switch (statusKey) {
		case 'done':
		case 'archived':
			return new vscode.ThemeIcon('pass');
		case 'blocked':
			return new vscode.ThemeIcon('error');
		case 'in-progress':
			return new vscode.ThemeIcon('loading');
		case 'not-started':
			return new vscode.ThemeIcon('circle-outline');
		default:
			return new vscode.ThemeIcon('question');
	}
}

export class TaskDiscoveryTreeProvider implements vscode.TreeDataProvider<Node> {
	private _onDidChangeTreeData = new vscode.EventEmitter<Node | undefined | null | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private snapshot: TaskDiscoverySnapshot | undefined;

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
				this.snapshot = await scanTasks();
				this.logSnapshot(this.snapshot);
			}
			return this.buildRootNodes(this.snapshot);
		}

		// For expandable nodes, re-scan to keep the view fresh when users expand.
		if (element.kind === 'section' || element.kind === 'repo') {
			this.snapshot = await scanTasks();
			this.logSnapshot(this.snapshot);
			const roots = this.buildRootNodes(this.snapshot);
			const remapped = this.findMatchingNode(roots, element);
			return remapped?.children ?? [];
		}

		return [];
	}

	invalidateCache(): void {
		this.snapshot = undefined;
		this.refresh();
	}

	private buildRootNodes(snapshot: TaskDiscoverySnapshot): Node[] {
		const totalTasks = snapshot.repos.reduce((sum, r) => sum + r.tasks.length, 0);

		const labelSuffix = snapshot.onlyOwner && snapshot.desiredOwner
			? ` (owner: ${snapshot.desiredOwner})`
			: '';

		const section: SectionNode = {
			kind: 'section',
			key: 'workspace-tasks',
			label: `Workspace Tasks${labelSuffix}`,
			description: totalTasks.toString(),
			iconPath: new vscode.ThemeIcon('checklist'),
			children: snapshot.repos.map((r) => this.toRepoNode(r))
		};

		return [section];
	}

	private toRepoNode(repo: RepoTasks): RepoNode {
		const hasTasksDir = Boolean(repo.tasksDirPath);
		const repoIcon = repo.isInstructionEngine ? 'library' : 'repo';
		const children = hasTasksDir ? this.groupTasksByStatus(repo) : [];
		return {
			kind: 'repo',
			key: repo.repoPath,
			label: repo.repoName,
			description: hasTasksDir ? `${repo.tasks.length} tasks` : 'no .instructions/tasks',
			iconPath: new vscode.ThemeIcon(hasTasksDir ? repoIcon : 'circle-slash'),
			repo,
			children
		};
	}

	private groupTasksByStatus(repo: RepoTasks): StatusNode[] {
		const buckets = new Map<string, TaskEntry[]>();
		for (const task of repo.tasks) {
			const key = normalizeStatus(task.status);
			const arr = buckets.get(key) ?? [];
			arr.push(task);
			buckets.set(key, arr);
		}

		const statuses = Array.from(buckets.keys());
		statuses.sort((a, b) => {
			const ak = statusSortKey(a);
			const bk = statusSortKey(b);
			if (ak !== bk) {
				return ak - bk;
			}
			return a.localeCompare(b);
		});

		return statuses.map((statusKey) => {
			const tasks = buckets.get(statusKey) ?? [];
			return {
				kind: 'status',
				key: `${repo.repoPath}::status::${statusKey}`,
				statusKey,
				label: statusKey,
				description: tasks.length.toString(),
				iconPath: statusIcon(statusKey),
				children: tasks.map((t) => this.toTaskNode(repo, statusKey, t))
			};
		});
	}

	private toTaskNode(repo: RepoTasks, statusKey: string, task: TaskEntry): TaskNode {
		const parts: string[] = [];
		parts.push(statusKey);
		if (task.owner) {
			parts.push(task.owner);
		}
		const description = parts.length > 0 ? parts.join(' • ') : undefined;

		return {
			kind: 'task',
			key: task.path,
			label: task.label,
			description,
			iconPath: statusIcon(statusKey),
			task,
			command: {
				title: 'Open Task',
				command: 'vscode.open',
				arguments: [vscode.Uri.file(task.path)]
			}
		};
	}

	private logSnapshot(snapshot: TaskDiscoverySnapshot): void {
		this.output.appendLine('[Skill Installer] Task discovery snapshot');
		this.output.appendLine(`onlyOwner: ${snapshot.onlyOwner}`);
		this.output.appendLine(`desiredOwner: ${snapshot.desiredOwner ?? '(none)'}`);
		this.output.appendLine(`repos: ${snapshot.repos.length}`);
	}

	private findMatchingNode(nodes: Node[], target: Node): Node | undefined {
		for (const node of nodes) {
			if (node.kind === target.kind && node.key === target.key) {
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
