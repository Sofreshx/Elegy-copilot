import * as vscode from 'vscode';
import {
	ExtensionEventEmitter,
	ExtensionEvent,
	PermissionResolvedPayload
} from './eventEmitter';

type NodeKind = 'section' | 'permission' | 'detail';

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

interface PermissionNode extends BaseNode {
	kind: 'permission';
}

interface DetailNode extends BaseNode {
	kind: 'detail';
}

type Node = SectionNode | PermissionNode | DetailNode;

interface PendingPermissionInfo {
	callbackId: string;
	sessionId: string;
	operation: string;
	description: string;
	requestedAt: string;
	timeoutMs: number;
}

function formatTimestamp(value: string): string {
	try {
		return new Date(value).toLocaleString();
	} catch {
		return value;
	}
}

export class PermissionsTreeProvider implements vscode.TreeDataProvider<Node> {
	private _onDidChangeTreeData = new vscode.EventEmitter<Node | undefined | null | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	constructor(private readonly eventEmitter: ExtensionEventEmitter) {}

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
		const pending = this.eventEmitter.getPendingPermissions();
		const resolvedEvents = this.eventEmitter.getEventHistory(['permission_resolved'], undefined, 10);

		const pendingSection: SectionNode = {
			kind: 'section',
			key: 'pending',
			label: 'Pending Permissions',
			description: pending.length.toString(),
			iconPath: new vscode.ThemeIcon('shield'),
			children: pending.length
				? pending.map((p) => this.toPendingNode(p))
				: [
					{
						kind: 'detail',
						key: 'pending-none',
						label: 'No pending approvals',
						iconPath: new vscode.ThemeIcon('circle-outline')
					}
				]
		};

		const resolvedSection: SectionNode = {
			kind: 'section',
			key: 'recent-resolved',
			label: 'Recent Decisions',
			description: resolvedEvents.length.toString(),
			iconPath: new vscode.ThemeIcon('history'),
			children: resolvedEvents.length
				? resolvedEvents.map((event) => this.toResolvedNode(event))
				: [
					{
						kind: 'detail',
						key: 'resolved-none',
						label: 'No recent decisions',
						iconPath: new vscode.ThemeIcon('circle-outline')
					}
				]
		};

		const exampleSection: SectionNode = {
			kind: 'section',
			key: 'example',
			label: 'Example Hook',
			description: 'Copilot permission flow',
			iconPath: new vscode.ThemeIcon('info'),
			children: [
				{
					kind: 'detail',
					key: 'example-when',
					label: 'When: Copilot requests approval for sensitive actions',
					iconPath: new vscode.ThemeIcon('question')
				},
				{
					kind: 'detail',
					key: 'example-what',
					label: 'What: Permission request appears here and on connected clients',
					iconPath: new vscode.ThemeIcon('broadcast')
				},
				{
					kind: 'detail',
					key: 'example-action',
					label: 'Action: Approve or deny to continue session',
					iconPath: new vscode.ThemeIcon('check')
				}
			]
		};

		return [pendingSection, resolvedSection, exampleSection];
	}

	private toPendingNode(permission: PendingPermissionInfo): PermissionNode {
		const label = permission.operation;
		const description = permission.sessionId.slice(0, 8);
		const children: Node[] = [
			{
				kind: 'detail',
				key: `${permission.callbackId}::session`,
				label: `Session: ${permission.sessionId}`,
				iconPath: new vscode.ThemeIcon('id-badge')
			},
			{
				kind: 'detail',
				key: `${permission.callbackId}::desc`,
				label: `Description: ${permission.description}`,
				iconPath: new vscode.ThemeIcon('note')
			},
			{
				kind: 'detail',
				key: `${permission.callbackId}::requested`,
				label: `Requested: ${formatTimestamp(permission.requestedAt)}`,
				iconPath: new vscode.ThemeIcon('clock')
			},
			{
				kind: 'detail',
				key: `${permission.callbackId}::timeout`,
				label: `Timeout: ${Math.round(permission.timeoutMs / 1000)}s`,
				iconPath: new vscode.ThemeIcon('timer')
			}
		];

		return {
			kind: 'permission',
			key: permission.callbackId,
			label,
			description,
			iconPath: new vscode.ThemeIcon('shield'),
			children
		};
	}

	private toResolvedNode(event: ExtensionEvent): PermissionNode {
		const payload = event.payload as PermissionResolvedPayload;
		const approved = payload?.approved === true;
		const label = approved ? 'Approved' : payload?.timedOut ? 'Timed out' : 'Denied';
		const descriptionParts: string[] = [];
		if (event.sessionId) {
			descriptionParts.push(event.sessionId.slice(0, 8));
		}
		if (payload?.resolvedBy) {
			descriptionParts.push(payload.resolvedBy);
		}
		const description = descriptionParts.join(' • ');

		const children: Node[] = [
			{
				kind: 'detail',
				key: `${event.correlationId}::time`,
				label: `Resolved: ${formatTimestamp(event.timestamp)}`,
				iconPath: new vscode.ThemeIcon('clock')
			},
			{
				kind: 'detail',
				key: `${event.correlationId}::callback`,
				label: `Callback: ${payload?.callbackId ?? 'unknown'}`,
				iconPath: new vscode.ThemeIcon('link')
			}
		];

		if (payload?.resolvedBy) {
			children.push({
				kind: 'detail',
				key: `${event.correlationId}::by`,
				label: `Resolved by: ${payload.resolvedBy}`,
				iconPath: new vscode.ThemeIcon('account')
			});
		}

		return {
			kind: 'permission',
			key: event.correlationId,
			label,
			description,
			iconPath: new vscode.ThemeIcon(approved ? 'pass' : 'error'),
			children
		};
	}
}
