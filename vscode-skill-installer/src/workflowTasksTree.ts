import * as vscode from 'vscode';
import { scanTasks } from './taskScanner';
import { RepoTasks, TaskDiscoverySnapshot, TaskEntry } from './types';

type NodeKind =
	| 'section'
	| 'lane'
	| 'repo'
	| 'status'
	| 'task'
	| 'e3-session'
	| 'e3-summary'
	| 'e3-graph'
	| 'e3-planning'
	| 'e3-todo'
	| 'e3-plan'
	| 'e3-group'
	| 'e3-task'
	| 'e3-edge'
	| 'e3-info';

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

interface E3SessionNode extends BaseNode {
	kind: 'e3-session';
}

interface E3SummaryNode extends BaseNode {
	kind: 'e3-summary';
}

interface E3GraphNode extends BaseNode {
	kind: 'e3-graph';
}

interface E3PlanningNode extends BaseNode {
	kind: 'e3-planning';
}

interface E3TodoNode extends BaseNode {
	kind: 'e3-todo';
}

interface E3PlanNode extends BaseNode {
	kind: 'e3-plan';
}

interface E3GroupNode extends BaseNode {
	kind: 'e3-group';
}

interface E3TaskNode extends BaseNode {
	kind: 'e3-task';
	task: E3Task;
}

interface E3EdgeNode extends BaseNode {
	kind: 'e3-edge';
}

interface E3InfoNode extends BaseNode {
	kind: 'e3-info';
}

type Node =
	| SectionNode
	| LaneNode
	| RepoNode
	| StatusNode
	| TaskNode
	| E3SessionNode
	| E3SummaryNode
	| E3GraphNode
	| E3PlanningNode
	| E3TodoNode
	| E3PlanNode
	| E3GroupNode
	| E3TaskNode
	| E3EdgeNode
	| E3InfoNode;

interface E3Session {
	id: string;
	plan_id?: string;
	status: 'active' | 'completed' | 'abandoned';
	request_summary?: string;
	started_at: string;
	ended_at?: string;
	replan_count: number;
	open_task_count?: number;
}

interface E3Task {
	id: string;
	title: string;
	description?: string;
	status: 'not-started' | 'in-progress' | 'done' | 'blocked' | 'failed';
	group_id?: string;
	group_title?: string;
	group_order?: number;
	priority: number;
	depends_on: string;
	attempt_count: number;
	error_summary?: string;
}

interface E3Todo {
	id: string;
	session_id: string;
	title: string;
	summary?: string;
	status: 'active' | 'completed' | 'archived';
	task_ids: string;
	created_at: string;
	updated_at: string;
}

interface E3TaskPlan {
	id: string;
	session_id: string;
	todo_id?: string;
	parent_plan_id?: string;
	task_id?: string;
	title: string;
	summary?: string;
	level: number;
	status: 'active' | 'completed' | 'superseded' | 'archived';
	created_at: string;
	updated_at: string;
}

interface E3TaskSummary {
	total: number;
	done: number;
	inProgress: number;
	notStarted: number;
	blocked: number;
	failed: number;
	groups: Array<{ group_id: string; group_title: string; total: number; done: number }>;
}

interface E3NextTask {
	task: E3Task | null;
	reason: string;
}

interface E3GroupGraph {
	groupId: string;
	groupTitle: string;
	groupOrder: number;
	total: number;
	done: number;
	tasks: E3Task[];
}

interface E3GraphData {
	groups: E3GroupGraph[];
	dependentsByTaskId: Map<string, string[]>;
	taskById: Map<string, E3Task>;
	edgeCount: number;
}

interface E3Snapshot {
	activeSessions: E3SessionSnapshot[];
	resumableSessions: E3Session[];
}

interface E3SessionSnapshot {
	session: E3Session;
	tasks: E3Task[];
	summary: E3TaskSummary | null;
	nextTask: E3NextTask | null;
	graph: E3GraphData;
	todos: E3Todo[];
	taskPlans: E3TaskPlan[];
}

const knownStatusOrder = ['in-progress', 'blocked', 'not-started', 'done', 'archived', 'unknown'] as const;
type KnownStatus = (typeof knownStatusOrder)[number];

const activeStatuses = new Set(['in-progress', 'blocked', 'not-started', 'unknown']);
const e3StatusOrder: ReadonlyArray<E3Task['status']> = ['in-progress', 'blocked', 'not-started', 'failed', 'done'];

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

function e3StatusIcon(status: E3Task['status']): vscode.ThemeIcon {
	switch (status) {
		case 'done':
			return new vscode.ThemeIcon('pass');
		case 'blocked':
			return new vscode.ThemeIcon('error');
		case 'failed':
			return new vscode.ThemeIcon('error');
		case 'in-progress':
			return new vscode.ThemeIcon('loading');
		case 'not-started':
		default:
			return new vscode.ThemeIcon('circle-outline');
	}
}

function e3StatusSortKey(status: E3Task['status']): number {
	const idx = e3StatusOrder.indexOf(status);
	return idx === -1 ? 999 : idx;
}

function parseDependsOn(raw: string | undefined): string[] {
	if (!raw?.trim()) {
		return [];
	}
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) {
			return [];
		}
		return parsed.filter((value): value is string => typeof value === 'string' && value.length > 0);
	} catch {
		return [];
	}
}

function parseStringArrayJson(raw: string | undefined): string[] {
	if (!raw?.trim()) {
		return [];
	}
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) {
			return [];
		}
		return parsed.filter((value): value is string => typeof value === 'string' && value.length > 0);
	} catch {
		return [];
	}
}

export class WorkflowTaskTreeProvider implements vscode.TreeDataProvider<Node> {
	private _onDidChangeTreeData = new vscode.EventEmitter<Node | undefined | null | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private snapshot: TaskDiscoverySnapshot | undefined;
	private e3Snapshot: E3Snapshot | undefined;

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
			if (!this.snapshot || !this.e3Snapshot) {
				await this.refreshSnapshots();
			}
			return this.buildRootNodes(this.snapshot!, this.e3Snapshot!);
		}

		if (this.shouldRefreshChildren(element)) {
			await this.refreshSnapshots();
			const roots = this.buildRootNodes(this.snapshot!, this.e3Snapshot!);
			const remapped = this.findMatchingNode(roots, element);
			return remapped?.children ?? [];
		}

		return element.children ?? [];
	}

	invalidateCache(): void {
		this.snapshot = undefined;
		this.e3Snapshot = undefined;
		this.refresh();
	}

	private async refreshSnapshots(): Promise<void> {
		this.snapshot = await scanTasks();
		this.e3Snapshot = await this.scanE3Snapshot();
		this.logSnapshot(this.snapshot, this.e3Snapshot);
	}

	private shouldRefreshChildren(element: Node): boolean {
		return element.kind === 'section'
			|| element.kind === 'lane'
			|| element.kind === 'repo'
			|| element.kind === 'e3-session'
			|| element.kind === 'e3-summary'
			|| element.kind === 'e3-graph'
			|| element.kind === 'e3-planning'
			|| element.kind === 'e3-todo'
			|| element.kind === 'e3-group';
	}

	private buildRootNodes(snapshot: TaskDiscoverySnapshot, e3Snapshot: E3Snapshot): Node[] {
		const config = vscode.workspace.getConfiguration();
		const nextUpLimit = Math.max(1, config.get<number>('skillInstaller.workflow.nextUpLimit') ?? 5);
		const totalTasks = snapshot.repos.reduce((sum, repo) => sum + repo.tasks.length, 0);

		const nextUpTasks = this.getNextUp(snapshot, nextUpLimit);
		const activeLane = this.buildActiveLane(snapshot);

		const filedTasksSection: SectionNode = {
			kind: 'section',
			key: 'workflow',
			label: 'Filed Tasks Workflow',
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

		return [this.buildE3Section(e3Snapshot), filedTasksSection];
	}

	private buildE3Section(snapshot: E3Snapshot): SectionNode {
		const activeCount = snapshot.activeSessions.length;
		const resumableCount = snapshot.resumableSessions.length;
		const sectionDescription = activeCount > 0
			? `${activeCount} active`
			: `${resumableCount} resumable`;

		const children: Node[] = [];
		if (activeCount === 0) {
			children.push({
				kind: 'e3-info',
				key: 'e3-idle',
				label: 'No active Executive3 session',
				description: 'Unfinished sessions are listed below',
				iconPath: new vscode.ThemeIcon('circle-outline')
			});
		}

		for (const sessionSnapshot of snapshot.activeSessions) {
			children.push(this.buildE3SessionNode(sessionSnapshot));
		}

		if (snapshot.resumableSessions.length > 0) {
			for (const session of snapshot.resumableSessions) {
				children.push({
					kind: 'e3-info',
					key: `e3-resumable::${session.id}`,
					label: `Resumable ${session.id}`,
					description: `${session.open_task_count ?? 0} open tasks`,
					iconPath: new vscode.ThemeIcon('history')
				});
			}
		}

		return {
			kind: 'section',
			key: 'e3-session',
			label: 'Executive3 Session',
			description: sectionDescription,
			iconPath: new vscode.ThemeIcon('graph'),
			children
		};
	}

	private buildE3SessionNode(snapshot: E3SessionSnapshot): E3SessionNode {
		const session = snapshot.session;
		const started = session.started_at ? new Date(session.started_at).toLocaleString() : undefined;
		const nextTask = snapshot.nextTask?.task?.title;
		const nextTaskStatus = snapshot.nextTask?.task?.status;
		const nextTaskDescription = nextTask
			? `${nextTaskStatus ?? 'not-started'} • ${nextTask}`
			: (snapshot.nextTask?.reason ?? 'No actionable task');

		const details: Node[] = [
			{
				kind: 'e3-info',
				key: `${session.id}::status`,
				label: `Status: ${session.status}`,
				description: session.plan_id ? `Plan ${session.plan_id}` : 'No plan',
				iconPath: new vscode.ThemeIcon('symbol-event')
			},
			{
				kind: 'e3-info',
				key: `${session.id}::started`,
				label: `Started: ${started ?? 'unknown'}`,
				description: `Replans: ${session.replan_count}`,
				iconPath: new vscode.ThemeIcon('history')
			},
			{
				kind: 'e3-info',
				key: `${session.id}::next`,
				label: 'Next Task',
				description: nextTaskDescription,
				iconPath: new vscode.ThemeIcon('play-circle')
			}
		];

		if (session.request_summary?.trim()) {
			details.push({
				kind: 'e3-info',
				key: `${session.id}::request`,
				label: 'Request',
				description: session.request_summary,
				iconPath: new vscode.ThemeIcon('note')
			});
		}

		details.push(this.buildE3SummaryNode(snapshot));
		details.push(this.buildE3PlanningNode(snapshot));
		details.push(this.buildE3GraphNode(snapshot));

		return {
			kind: 'e3-session',
			key: session.id,
			label: `Session ${session.id}`,
			description: `${snapshot.tasks.length} tasks`,
			iconPath: new vscode.ThemeIcon('vm-active'),
			children: details
		};
	}

	private buildE3SummaryNode(snapshot: E3SessionSnapshot): E3SummaryNode {
		const summary = snapshot.summary;
		if (!summary) {
			return {
				kind: 'e3-summary',
				key: 'e3-summary',
				label: 'Progress',
				description: 'No summary',
				iconPath: new vscode.ThemeIcon('dashboard'),
				children: []
			};
		}

		const percent = summary.total > 0 ? Math.round((summary.done / summary.total) * 100) : 0;
		const groupNodes = summary.groups
			.slice()
			.sort((a, b) => a.group_title.localeCompare(b.group_title))
			.map<E3InfoNode>((group) => ({
				kind: 'e3-info',
				key: `e3-summary-group::${group.group_id}`,
				label: `${group.group_title}`,
				description: `${group.done}/${group.total} done`,
				iconPath: new vscode.ThemeIcon('list-tree')
			}));

		return {
			kind: 'e3-summary',
			key: 'e3-summary',
			label: 'Progress',
			description: `${summary.done}/${summary.total} done (${percent}%)`,
			iconPath: new vscode.ThemeIcon('dashboard'),
			children: [
				{
					kind: 'e3-info',
					key: 'e3-counts-main',
					label: 'Counts',
					description: `in-progress ${summary.inProgress} • not-started ${summary.notStarted} • blocked ${summary.blocked} • failed ${summary.failed}`,
					iconPath: new vscode.ThemeIcon('symbol-number')
				},
				...groupNodes
			]
		};
	}

	private buildE3PlanningNode(snapshot: E3SessionSnapshot): E3PlanningNode {
		if (!snapshot.todos.length && !snapshot.taskPlans.length) {
			return {
				kind: 'e3-planning',
				key: `e3-planning::${snapshot.session.id}`,
				label: 'Planning',
				description: 'No todo/plans attached to session',
				iconPath: new vscode.ThemeIcon('list-tree'),
				children: []
			};
		}

		const plansByTodo = new Map<string, E3TaskPlan[]>();
		for (const plan of snapshot.taskPlans) {
			const key = plan.todo_id ?? 'unassigned';
			const arr = plansByTodo.get(key) ?? [];
			arr.push(plan);
			plansByTodo.set(key, arr);
		}

		const todoNodes: Node[] = snapshot.todos.map((todo) => {
			const linkedTaskIds = parseStringArrayJson(todo.task_ids);
			const plans = plansByTodo.get(todo.id) ?? [];
			plans.sort((a, b) => a.level - b.level || a.title.localeCompare(b.title));

			const planNodes: E3PlanNode[] = plans.map((plan) => ({
				kind: 'e3-plan',
				key: `e3-plan::${plan.id}`,
				label: plan.title,
				description: `${plan.status} • level ${plan.level}${plan.task_id ? ` • task ${plan.task_id}` : ''}`,
				iconPath: new vscode.ThemeIcon('symbol-method'),
			}));

			return {
				kind: 'e3-todo',
				key: `e3-todo::${todo.id}`,
				label: todo.title,
				description: `${todo.status} • ${linkedTaskIds.length} tasks • ${plans.length} plans`,
				iconPath: new vscode.ThemeIcon('checklist'),
				children: planNodes,
			};
		});

		const unassignedPlans = (plansByTodo.get('unassigned') ?? [])
			.sort((a, b) => a.level - b.level || a.title.localeCompare(b.title))
			.map<E3PlanNode>((plan) => ({
				kind: 'e3-plan',
				key: `e3-plan::${plan.id}`,
				label: plan.title,
				description: `${plan.status} • level ${plan.level}`,
				iconPath: new vscode.ThemeIcon('symbol-method'),
			}));

		const children = [...todoNodes, ...unassignedPlans];

		return {
			kind: 'e3-planning',
			key: `e3-planning::${snapshot.session.id}`,
			label: 'Planning',
			description: `${snapshot.todos.length} todos • ${snapshot.taskPlans.length} plans`,
			iconPath: new vscode.ThemeIcon('list-tree'),
			children,
		};
	}

	private buildE3GraphNode(snapshot: E3SessionSnapshot): E3GraphNode {
		if (!snapshot.graph.groups.length) {
			return {
				kind: 'e3-graph',
				key: 'e3-graph',
				label: 'Dependency Graph',
				description: 'No tasks in current session',
				iconPath: new vscode.ThemeIcon('graph'),
				children: []
			};
		}

		const groups = snapshot.graph.groups.map<E3GroupNode>((group) => {
			const taskNodes = group.tasks.map((task) => this.toE3TaskNode(task, snapshot.graph));
			return {
				kind: 'e3-group',
				key: `e3-group::${group.groupId}`,
				label: group.groupTitle,
				description: `${group.done}/${group.total} done`,
				iconPath: new vscode.ThemeIcon('symbol-namespace'),
				children: taskNodes
			};
		});

		return {
			kind: 'e3-graph',
			key: 'e3-graph',
			label: 'Dependency Graph',
			description: `${snapshot.tasks.length} nodes • ${snapshot.graph.edgeCount} edges`,
			iconPath: new vscode.ThemeIcon('graph'),
			children: groups
		};
	}

	private toE3TaskNode(task: E3Task, graph: E3GraphData): E3TaskNode {
		const deps = parseDependsOn(task.depends_on);
		const dependents = graph.dependentsByTaskId.get(task.id) ?? [];

		const relationNodes: Node[] = [];
		if (deps.length === 0 && dependents.length === 0) {
			relationNodes.push({
				kind: 'e3-info',
				key: `e3-task::${task.id}::isolated`,
				label: 'No edges',
				description: 'No dependencies or dependents',
				iconPath: new vscode.ThemeIcon('circle-outline')
			});
		}

		for (const depId of deps) {
			const depTask = graph.taskById.get(depId);
			relationNodes.push({
				kind: 'e3-edge',
				key: `e3-task::${task.id}::dep::${depId}`,
				label: `Depends on ← ${depTask?.title ?? depId}`,
				description: depTask?.status,
				iconPath: new vscode.ThemeIcon('arrow-left')
			});
		}

		for (const dependentId of dependents) {
			const dependentTask = graph.taskById.get(dependentId);
			relationNodes.push({
				kind: 'e3-edge',
				key: `e3-task::${task.id}::dependent::${dependentId}`,
				label: `Unblocks → ${dependentTask?.title ?? dependentId}`,
				description: dependentTask?.status,
				iconPath: new vscode.ThemeIcon('arrow-right')
			});
		}

		return {
			kind: 'e3-task',
			key: `e3-task::${task.id}`,
			label: task.title,
			description: `${task.status} • P${task.priority} • attempts ${task.attempt_count}`,
			iconPath: e3StatusIcon(task.status),
			task,
			children: relationNodes
		};
	}

	private buildGraphData(tasks: E3Task[]): E3GraphData {
		const taskById = new Map<string, E3Task>();
		for (const task of tasks) {
			taskById.set(task.id, task);
		}

		const dependentsByTaskId = new Map<string, string[]>();
		let edgeCount = 0;
		for (const task of tasks) {
			for (const depId of parseDependsOn(task.depends_on)) {
				edgeCount += 1;
				const dependents = dependentsByTaskId.get(depId) ?? [];
				dependents.push(task.id);
				dependentsByTaskId.set(depId, dependents);
			}
		}

		const groupMap = new Map<string, E3GroupGraph>();
		for (const task of tasks) {
			const groupId = task.group_id ?? 'ungrouped';
			const existing = groupMap.get(groupId) ?? {
				groupId,
				groupTitle: task.group_title ?? groupId,
				groupOrder: task.group_order ?? Number.MAX_SAFE_INTEGER,
				total: 0,
				done: 0,
				tasks: []
			};
			existing.total += 1;
			if (task.status === 'done') {
				existing.done += 1;
			}
			existing.groupOrder = Math.min(existing.groupOrder, task.group_order ?? Number.MAX_SAFE_INTEGER);
			existing.tasks.push(task);
			groupMap.set(groupId, existing);
		}

		const groups = Array.from(groupMap.values());
		for (const group of groups) {
			group.tasks.sort((a, b) => {
				const as = e3StatusSortKey(a.status);
				const bs = e3StatusSortKey(b.status);
				if (as !== bs) {
					return as - bs;
				}
				if (a.priority !== b.priority) {
					return b.priority - a.priority;
				}
				return a.title.localeCompare(b.title);
			});
		}

		groups.sort((a, b) => {
			if (a.groupOrder !== b.groupOrder) {
				return a.groupOrder - b.groupOrder;
			}
			return a.groupTitle.localeCompare(b.groupTitle);
		});

		return { groups, dependentsByTaskId, taskById, edgeCount };
	}

	private async scanE3Snapshot(): Promise<E3Snapshot> {
		const activeSessions = (await this.executeE3Command<E3Session[]>(
			'executive3.getSessions',
			JSON.stringify({ statuses: ['active'], limit: 10 })
		)) ?? [];

		const activeSnapshots: E3SessionSnapshot[] = [];
		for (const session of activeSessions) {
			const tasks = (await this.executeE3Command<E3Task[]>(
				'executive3.getTasks',
				JSON.stringify({ session_id: session.id })
			)) ?? [];

			const summary = await this.executeE3Command<E3TaskSummary>(
				'executive3.getTaskSummary',
				session.id
			);

			const nextTask = await this.executeE3Command<E3NextTask>(
				'executive3.getNextTask',
				session.id
			);

			const todos = (await this.executeE3Command<E3Todo[]>(
				'executive3.getTodos',
				JSON.stringify({ session_id: session.id, limit: 100 })
			)) ?? [];

			const taskPlans = (await this.executeE3Command<E3TaskPlan[]>(
				'executive3.getTaskPlans',
				JSON.stringify({ session_id: session.id })
			)) ?? [];

			activeSnapshots.push({
				session,
				tasks,
				summary: summary ?? null,
				nextTask: nextTask ?? null,
				graph: this.buildGraphData(tasks),
				todos,
				taskPlans,
			});
		}

		const resumableSessions = (await this.executeE3Command<E3Session[]>(
			'executive3.getSessions',
			JSON.stringify({ resumableOnly: true, limit: 10 })
		)) ?? [];

		const activeIds = new Set(activeSnapshots.map((snapshot) => snapshot.session.id));
		const resumableOnly = resumableSessions.filter((session) => !activeIds.has(session.id));

		return {
			activeSessions: activeSnapshots,
			resumableSessions: resumableOnly,
		};
	}

	private async executeE3Command<T>(command: string, ...args: unknown[]): Promise<T | undefined> {
		try {
			const raw = await vscode.commands.executeCommand<unknown>(command, ...args);
			if (typeof raw === 'string') {
				const parsed = JSON.parse(raw) as unknown;
				if (parsed && typeof parsed === 'object' && 'error' in parsed) {
					const msg = String((parsed as { error?: unknown }).error ?? 'Unknown error');
					this.output.appendLine(`[Skill Installer] ${command} failed: ${msg}`);
					return undefined;
				}
				return parsed as T;
			}
			return raw as T;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			this.output.appendLine(`[Skill Installer] ${command} threw: ${msg}`);
			return undefined;
		}
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

	private logSnapshot(snapshot: TaskDiscoverySnapshot, e3Snapshot: E3Snapshot): void {
		this.output.appendLine('[Skill Installer] Task workflow snapshot');
		this.output.appendLine(`repos: ${snapshot.repos.length}`);
		this.output.appendLine(`e3 active sessions: ${e3Snapshot.activeSessions.length}`);
		this.output.appendLine(`e3 resumable sessions: ${e3Snapshot.resumableSessions.length}`);
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
