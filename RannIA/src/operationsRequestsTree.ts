import * as vscode from 'vscode';
import { AgentSession, SessionManager, SessionStatus } from './sessionManager';

type NodeKind = 'section' | 'session' | 'detail';

interface BaseNode {
	kind: NodeKind;
	key: string;
	label: string;
	description?: string;
	iconPath?: vscode.ThemeIcon;
	children?: Node[];
}

interface SectionNode extends BaseNode {
	kind: 'section';
}

interface SessionNode extends BaseNode {
	kind: 'session';
	session: AgentSession;
}

interface DetailNode extends BaseNode {
	kind: 'detail';
}

type Node = SectionNode | SessionNode | DetailNode;

function formatTimestamp(value: Date): string {
	return value.toLocaleString();
}

function formatDuration(start: Date, end?: Date): string {
	const endTime = end ?? new Date();
	const diff = Math.max(0, endTime.getTime() - start.getTime());
	const seconds = Math.floor(diff / 1000);
	const minutes = Math.floor(seconds / 60);
	const remainder = seconds % 60;
	return `${minutes}m ${remainder}s`;
}

function truncate(value: string, max = 120): string {
	if (value.length <= max) {
		return value;
	}
	return value.slice(0, max) + '...';
}

function statusIcon(status: SessionStatus): vscode.ThemeIcon {
	switch (status) {
		case 'active':
			return new vscode.ThemeIcon('pulse');
		case 'pending':
			return new vscode.ThemeIcon('clock');
		case 'completed':
			return new vscode.ThemeIcon('pass');
		case 'failed':
			return new vscode.ThemeIcon('error');
		case 'cancelled':
			return new vscode.ThemeIcon('circle-slash');
		default:
			return new vscode.ThemeIcon('question');
	}
}

export class RequestsTreeProvider implements vscode.TreeDataProvider<Node> {
	private _onDidChangeTreeData = new vscode.EventEmitter<Node | undefined | null | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	constructor(private readonly sessionManager: SessionManager) {}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	invalidateCache(): void {
		this.refresh();
	}

	getTreeItem(element: Node): vscode.TreeItem {
		const item = new vscode.TreeItem(
			element.label,
			element.children && element.children.length > 0
				? vscode.TreeItemCollapsibleState.Collapsed
				: vscode.TreeItemCollapsibleState.None
		);

		item.description = element.description;
		item.iconPath = element.iconPath;
		return item;
	}

	async getChildren(element?: Node): Promise<Node[]> {
		if (!element) {
			return this.buildRootNodes();
		}

		return element.children ?? [];
	}

	private buildRootNodes(): Node[] {
		const activeSessions = this.sessionManager.getActiveSessions();
		const activeIds = new Set(activeSessions.map((s) => s.id));
		const recentSessions = this.sessionManager
			.getAllSessions()
			.filter((s) => !activeIds.has(s.id))
			.sort((a, b) => b.startTime.getTime() - a.startTime.getTime())
			.slice(0, 15);

		const activeSection: SectionNode = {
			kind: 'section',
			key: 'active-sessions',
			label: 'Active Sessions',
			description: activeSessions.length.toString(),
			iconPath: new vscode.ThemeIcon('pulse'),
			children: activeSessions.length
				? activeSessions.map((s) => this.toSessionNode(s))
				: [
					{
						kind: 'detail',
						key: 'no-active',
						label: 'No active sessions',
						iconPath: new vscode.ThemeIcon('circle-outline')
					}
				]
		};

		const recentSection: SectionNode = {
			kind: 'section',
			key: 'recent-sessions',
			label: 'Recent Sessions',
			description: recentSessions.length.toString(),
			iconPath: new vscode.ThemeIcon('history'),
			children: recentSessions.length
				? recentSessions.map((s) => this.toSessionNode(s))
				: [
					{
						kind: 'detail',
						key: 'no-recent',
						label: 'No recent sessions',
						iconPath: new vscode.ThemeIcon('circle-outline')
					}
				]
		};

		return [activeSection, recentSection];
	}

	private toSessionNode(session: AgentSession): SessionNode {
		const label = `@${session.agentName}`;
		const description = `${session.status} • ${formatTimestamp(session.startTime)}`;
		const children: Node[] = [
			{
				kind: 'detail',
				key: `${session.id}::id`,
				label: `Session: ${session.id}`,
				iconPath: new vscode.ThemeIcon('id-badge')
			},
			{
				kind: 'detail',
				key: `${session.id}::status`,
				label: `Status: ${session.status}`,
				iconPath: statusIcon(session.status)
			},
			{
				kind: 'detail',
				key: `${session.id}::started`,
				label: `Started: ${formatTimestamp(session.startTime)}`,
				iconPath: new vscode.ThemeIcon('clock')
			},
			{
				kind: 'detail',
				key: `${session.id}::duration`,
				label: `Duration: ${formatDuration(session.startTime, session.endTime)}`,
				iconPath: new vscode.ThemeIcon('watch')
			},
			{
				kind: 'detail',
				key: `${session.id}::tool-calls`,
				label: `Tool calls: ${session.toolCalls.length}`,
				iconPath: new vscode.ThemeIcon('tools')
			}
		];

		const prompt = truncate(session.prompt, 160);
		children.push({
			kind: 'detail',
			key: `${session.id}::prompt`,
			label: `Prompt: ${prompt}`,
			iconPath: new vscode.ThemeIcon('comment')
		});

		const lastTool = session.toolCalls[session.toolCalls.length - 1];
		if (lastTool) {
			const duration = lastTool.durationMs ? ` (${lastTool.durationMs}ms)` : '';
			children.push({
				kind: 'detail',
				key: `${session.id}::last-tool`,
				label: `Last tool: ${lastTool.tool}${duration}`,
				iconPath: new vscode.ThemeIcon('tools')
			});
		}

		const lastEvent = session.events[session.events.length - 1];
		if (lastEvent) {
			children.push({
				kind: 'detail',
				key: `${session.id}::last-event`,
				label: `Last event: ${lastEvent.type}`,
				iconPath: new vscode.ThemeIcon('calendar')
			});
		}

		if (session.error) {
			children.push({
				kind: 'detail',
				key: `${session.id}::error`,
				label: `Error: ${truncate(session.error, 140)}`,
				iconPath: new vscode.ThemeIcon('error')
			});
		}

		return {
			kind: 'session',
			key: session.id,
			label,
			description,
			iconPath: statusIcon(session.status),
			session,
			children
		};
	}
}
