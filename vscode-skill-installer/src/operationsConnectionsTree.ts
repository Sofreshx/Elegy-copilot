import * as vscode from 'vscode';
import { WsServer } from './wsServer';
import { ClientInfoDto } from './clientRegistry';

type NodeKind = 'section' | 'status' | 'client' | 'detail';

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

interface StatusNode extends BaseNode {
	kind: 'status';
}

interface ClientNode extends BaseNode {
	kind: 'client';
	client: ClientInfoDto;
}

interface DetailNode extends BaseNode {
	kind: 'detail';
}

type Node = SectionNode | StatusNode | ClientNode | DetailNode;

function formatTimestamp(value: string): string {
	try {
		return new Date(value).toLocaleString();
	} catch {
		return value;
	}
}

function formatDuration(ms: number): string {
	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	const parts: string[] = [];
	if (hours > 0) {
		parts.push(`${hours}h`);
	}
	if (minutes > 0 || hours > 0) {
		parts.push(`${minutes}m`);
	}
	parts.push(`${seconds}s`);
	return parts.join(' ');
}

export class ConnectionsTreeProvider implements vscode.TreeDataProvider<Node> {
	private _onDidChangeTreeData = new vscode.EventEmitter<Node | undefined | null | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	constructor(private readonly wsServer: WsServer) {}

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
		const config = vscode.workspace.getConfiguration('skillInstaller.ws');
		const enabled = config.get<boolean>('enabled', false);
		const running = this.wsServer.isRunning();
		const port = this.wsServer.getPort();
		const uptimeMs = this.wsServer.getUptimeMs();
		const clientRegistry = this.wsServer.getClientRegistry();
		const clients = clientRegistry.listClientsDto();

		const serverChildren: Node[] = [
			{
				kind: 'status',
				key: 'server-enabled',
				label: `Enabled: ${enabled ? 'yes' : 'no'}`,
				iconPath: new vscode.ThemeIcon(enabled ? 'check' : 'circle-slash')
			},
			{
				kind: 'status',
				key: 'server-state',
				label: `State: ${running ? 'running' : 'stopped'}`,
				iconPath: new vscode.ThemeIcon(running ? 'pulse' : 'circle-outline')
			},
			{
				kind: 'status',
				key: 'server-port',
				label: `Port: ${running && port ? port : 'n/a'}`,
				iconPath: new vscode.ThemeIcon('plug')
			},
			{
				kind: 'status',
				key: 'server-clients',
				label: `Clients: ${clients.length}`,
				iconPath: new vscode.ThemeIcon('device-mobile')
			}
		];

		if (running && uptimeMs !== undefined) {
			serverChildren.push({
				kind: 'status',
				key: 'server-uptime',
				label: `Uptime: ${formatDuration(uptimeMs)}`,
				iconPath: new vscode.ThemeIcon('clock')
			});
		}

		const serverSection: SectionNode = {
			kind: 'section',
			key: 'server',
			label: 'Connection Server',
			description: running ? 'running' : enabled ? 'stopped' : 'disabled',
			iconPath: new vscode.ThemeIcon('radio-tower'),
			children: serverChildren
		};

		const clientNodes: Node[] = clients.map((client) => this.toClientNode(client));
		if (clientNodes.length === 0) {
			clientNodes.push({
				kind: 'status',
				key: 'no-clients',
				label: 'No clients connected',
				iconPath: new vscode.ThemeIcon('circle-slash')
			});
		}

		const clientsSection: SectionNode = {
			kind: 'section',
			key: 'clients',
			label: 'Connected Clients',
			description: clients.length.toString(),
			iconPath: new vscode.ThemeIcon('device-mobile'),
			children: clientNodes
		};

		return [serverSection, clientsSection];
	}

	private toClientNode(client: ClientInfoDto): ClientNode {
		const shortId = client.clientId.slice(0, 8);
		const label = `${client.deviceType} (${client.os})`;
		const description = client.userId ? `${shortId} • ${client.userId}` : shortId;

		const children: Node[] = [
			{
				kind: 'detail',
				key: `${client.clientId}::id`,
				label: `Client ID: ${client.clientId}`,
				iconPath: new vscode.ThemeIcon('id-badge')
			},
			{
				kind: 'detail',
				key: `${client.clientId}::version`,
				label: `App version: ${client.appVersion}`,
				iconPath: new vscode.ThemeIcon('tag')
			},
			{
				kind: 'detail',
				key: `${client.clientId}::connected`,
				label: `Connected: ${formatTimestamp(client.connectionTime)}`,
				iconPath: new vscode.ThemeIcon('clock')
			},
			{
				kind: 'detail',
				key: `${client.clientId}::last-seen`,
				label: `Last seen: ${formatTimestamp(client.lastSeen)}`,
				iconPath: new vscode.ThemeIcon('history')
			},
			{
				kind: 'detail',
				key: `${client.clientId}::state`,
				label: `State: ${client.state}`,
				iconPath: new vscode.ThemeIcon('pulse')
			}
		];

		if (client.userId) {
			children.splice(1, 0, {
				kind: 'detail',
				key: `${client.clientId}::user`,
				label: `User: ${client.userId}`,
				iconPath: new vscode.ThemeIcon('account')
			});
		}

		return {
			kind: 'client',
			key: client.clientId,
			label,
			description,
			iconPath: new vscode.ThemeIcon('device-mobile'),
			client,
			children
		};
	}
}
