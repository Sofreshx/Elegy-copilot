import * as vscode from 'vscode';
import { scanTasks } from './taskScanner';
import { RepoTasks, TaskDiscoverySnapshot, TaskEntry } from './types';

type NodeKind = 'section' | 'lane' | 'repo' | 'status' | 'task';

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

interface SectionNode extends BaseNode {
	kind: 'section';
}

interface LaneNode extends BaseNode {
	kind: 'lane';
	laneKey: 'next-up' | 'active' | 'pipeline';
}

interface RepoNode extends BaseNode {
	kind: 'repo';
	repo: RepoTasks;
}

interface StatusNode extends BaseNode {
	kind: 'status';
	statusKey: string;
}

interface TaskNode extends BaseNode {
	kind: 'task';
	task: TaskEntry;
}

type Node = SectionNode | LaneNode | RepoNode | StatusNode | TaskNode;

const knownStatusOrder = ['in-progress', 'blocked', 'not-started', 'done', 'archived', 'unknown'] as const;
type KnownStatus = (typeof knownStatusOrder)[number];

const activeStatuses = new Set(['in-progress', 'blocked', 'not-started', 'unknown']);

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

function isActiveTask(task: TaskEntry): boolean {
	return activeStatuses.has(normalizeStatus(task.status));
}

function prioritySortKey(priority: string | undefined): number {
	if (!priority) {
		return 99;
	}
	const normalized = priority.trim().toLowerCase();
	if (normalized.startsWith('p')) {
		const num = Number.parseInt(normalized.slice(1), 10);
		if (!Number.isNaN(num)) {
			return num;
		}
	}
	if (normalized === 'high') {
		return 1;
	}
	if (normalized === 'medium') {
		return 2;
	}
	if (normalized === 'low') {
		return 3;
	}
	return 99;
}

function taskDescription(statusKey: string, task: TaskEntry): string | undefined {
	const parts: string[] = [];
	if (statusKey) {
		parts.push(statusKey);
	}
	if (task.priority) {
		parts.push(task.priority);
	}
	if (task.owner) {
		parts.push(task.owner);
	}
	return parts.length > 0 ? parts.join(' • ') : undefined;
}

export class WorkflowTaskTreeProvider implements vscode.TreeDataProvider<Node> {
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

		if (element.kind === 'section' || element.kind === 'lane' || element.kind === 'repo') {
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
		const config = vscode.workspace.getConfiguration();
		const nextUpLimit = Math.max(1, config.get<number>('skillInstaller.workflow.nextUpLimit') ?? 5);
		const totalTasks = snapshot.repos.reduce((sum, repo) => sum + repo.tasks.length, 0);

		const nextUpTasks = this.getNextUp(snapshot, nextUpLimit);
		const activeLane = this.buildActiveLane(snapshot);

		const section: SectionNode = {
			kind: 'section',
			key: 'workflow',
			label: 'Task Workflow',
			description: totalTasks.toString(),
			iconPath: new vscode.ThemeIcon('pulse'),
			children: [
				{
					kind: 'lane',
					laneKey: 'next-up',
					key: 'next-up',
					label: 'Next Up',
					description: nextUpTasks.length.toString(),
					iconPath: new vscode.ThemeIcon('play-circle'),
					children: nextUpTasks.map((t) => this.toTaskNode(t))
				},
				activeLane,
				{
					kind: 'lane',
					laneKey: 'pipeline',
					key: 'pipeline',
					label: 'Pipeline',
					description: totalTasks.toString(),
					iconPath: new vscode.ThemeIcon('list-tree'),
					children: snapshot.repos.map((r) => this.toRepoNode(r))
				}
			]
		};

		return [section];
	}

	private getNextUp(snapshot: TaskDiscoverySnapshot, limit: number): TaskEntry[] {
		const active: TaskEntry[] = [];
		for (const repo of snapshot.repos) {
			for (const task of repo.tasks) {
				if (isActiveTask(task)) {
					active.push(task);
				}
			}
		}

		active.sort((a, b) => {
			const ap = prioritySortKey(a.priority);
			const bp = prioritySortKey(b.priority);
			if (ap !== bp) {
				return ap - bp;
			}
			const as = statusSortKey(normalizeStatus(a.status));
			const bs = statusSortKey(normalizeStatus(b.status));
			if (as !== bs) {
				return as - bs;
			}
			return a.label.localeCompare(b.label);
		});

		return active.slice(0, limit);
	}

	private buildActiveLane(snapshot: TaskDiscoverySnapshot): LaneNode {
		const activeByRepo = snapshot.repos
			.map((repo) => ({
				repo,
				tasks: repo.tasks.filter(isActiveTask)
			}))
			.filter((entry) => entry.tasks.length > 0);

		const totalActive = activeByRepo.reduce((sum, entry) => sum + entry.tasks.length, 0);

		return {
			kind: 'lane',
			laneKey: 'active',
			key: 'active',
			label: 'Active',
			description: totalActive.toString(),
			iconPath: new vscode.ThemeIcon('rocket'),
			children: activeByRepo.length
				? activeByRepo.map((entry) => this.toActiveRepoNode(entry.repo, entry.tasks))
				: [
					{
						kind: 'status',
						key: 'active-empty',
						statusKey: 'active-empty',
						label: 'No active tasks',
						iconPath: new vscode.ThemeIcon('circle-outline')
					}
				]
		};
	}

	private toRepoNode(repo: RepoTasks): RepoNode {
		const hasTasksDir = Boolean(repo.tasksDirPath);
		const repoIcon = repo.isInstructionEngine ? 'library' : 'repo';
		const children = hasTasksDir ? this.groupTasksByStatus(repo, repo.tasks, 'workflow-status') : [];
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

	private toActiveRepoNode(repo: RepoTasks, tasks: TaskEntry[]): RepoNode {
		const hasTasksDir = Boolean(repo.tasksDirPath);
		const repoIcon = repo.isInstructionEngine ? 'library' : 'repo';
		const children = hasTasksDir ? this.groupTasksByStatus(repo, tasks, 'active-status') : [];
		return {
			kind: 'repo',
			key: `${repo.repoPath}::active`,
			label: repo.repoName,
			description: hasTasksDir ? `${tasks.length} active` : 'no .instructions/tasks',
			iconPath: new vscode.ThemeIcon(hasTasksDir ? repoIcon : 'circle-slash'),
			repo,
			children
		};
	}

	private groupTasksByStatus(repo: RepoTasks, tasks: TaskEntry[], keyPrefix: string): StatusNode[] {
		const buckets = new Map<string, TaskEntry[]>();
		for (const task of tasks) {
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
				key: `${repo.repoPath}::${keyPrefix}::${statusKey}`,
				statusKey,
				label: statusKey,
				description: tasks.length.toString(),
				iconPath: statusIcon(statusKey),
				children: tasks.map((t) => this.toTaskNode(t, statusKey))
			};
		});
	}

	private toTaskNode(task: TaskEntry, statusKey?: string): TaskNode {
		const derivedStatus = statusKey ?? normalizeStatus(task.status);
		return {
			kind: 'task',
			key: task.path,
			label: task.label,
			description: taskDescription(derivedStatus, task),
			iconPath: statusIcon(derivedStatus),
			task,
			command: {
				title: 'Open Task',
				command: 'vscode.open',
				arguments: [vscode.Uri.file(task.path)]
			}
		};
	}

	private logSnapshot(snapshot: TaskDiscoverySnapshot): void {
		this.output.appendLine('[Skill Installer] Task workflow snapshot');
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
