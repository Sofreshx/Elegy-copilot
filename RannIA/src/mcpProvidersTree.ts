import * as vscode from 'vscode';
import { getMcpProviderInfos, McpProviderInfo } from './mcpConfig';

type NodeKind = 'section' | 'repo' | 'provider' | 'detail';

interface BaseNode {
	kind: NodeKind;
	key: string;
	label: string;
	description?: string;
	contextValue?: string;
	iconPath?: vscode.ThemeIcon;
	children?: Node[];
}

interface SectionNode extends BaseNode {
	kind: 'section';
}

interface RepoNode extends BaseNode {
	kind: 'repo';
	repoPath: string;
}

interface ProviderNode extends BaseNode {
	kind: 'provider';
	provider: McpProviderInfo;
}

interface DetailNode extends BaseNode {
	kind: 'detail';
}

type Node = SectionNode | RepoNode | ProviderNode | DetailNode;

function formatKeyList(record?: Record<string, string>): string | undefined {
	if (!record) {
		return undefined;
	}
	const keys = Object.keys(record).sort();
	return keys.length ? keys.join(', ') : undefined;
}

export class McpProvidersTreeProvider implements vscode.TreeDataProvider<Node> {
	private _onDidChangeTreeData = new vscode.EventEmitter<Node | undefined | null | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	constructor(private readonly output: vscode.OutputChannel) {}

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
		item.contextValue = element.contextValue;
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
		const folders = vscode.workspace.workspaceFolders ?? [];
		const repoNodes = folders.map((folder) => this.toRepoNode(folder));

		const section: SectionNode = {
			kind: 'section',
			key: 'mcp-providers',
			label: 'Workspace MCP Providers',
			description: repoNodes.length.toString(),
			iconPath: new vscode.ThemeIcon('plug'),
			children: repoNodes
		};

		this.output.appendLine('[Skill Installer] MCP providers view refreshed');
		return [section];
	}

	private toRepoNode(folder: vscode.WorkspaceFolder): RepoNode {
		const providers = getMcpProviderInfos(folder.uri.fsPath);
		const enabledCount = providers.filter((p) => p.enabled).length;

		return {
			kind: 'repo',
			key: folder.uri.fsPath,
			label: folder.name,
			repoPath: folder.uri.fsPath,
			description: `${enabledCount}/${providers.length} enabled`,
			iconPath: new vscode.ThemeIcon('repo'),
			contextValue: 'skillInstaller.mcpRepo',
			children: providers.map((provider) => this.toProviderNode(provider))
		};
	}

	private toProviderNode(provider: McpProviderInfo): ProviderNode {
		const transport = provider.config.transport ?? 'unknown';
		const needsConfig = provider.issues?.includes('missing-config');
		const parts = [provider.enabled ? 'enabled' : 'disabled', transport];
		if (needsConfig) {
			parts.push('needs config');
		}
		const description = parts.join(' • ');

		let icon = provider.enabled ? 'check' : 'circle-slash';
		if (provider.enabled && needsConfig) {
			icon = 'warning';
		}

		return {
			kind: 'provider',
			key: `${provider.repoPath}::${provider.id}`,
			label: provider.label,
			description,
			iconPath: new vscode.ThemeIcon(icon),
			contextValue: provider.enabled
				? 'skillInstaller.mcpProvider.enabled'
				: 'skillInstaller.mcpProvider.disabled',
			provider,
			children: this.buildProviderDetails(provider)
		};
	}

	private buildProviderDetails(provider: McpProviderInfo): Node[] {
		const details: Node[] = [];
		const config = provider.config;

		details.push({
			kind: 'detail',
			key: `${provider.id}::id`,
			label: `ID: ${provider.id}`,
			iconPath: new vscode.ThemeIcon('tag')
		});

		if (config.transport) {
			details.push({
				kind: 'detail',
				key: `${provider.id}::transport`,
				label: `Transport: ${config.transport}`,
				iconPath: new vscode.ThemeIcon('pulse')
			});
		}

		if (config.url) {
			details.push({
				kind: 'detail',
				key: `${provider.id}::url`,
				label: `URL: ${config.url}`,
				iconPath: new vscode.ThemeIcon('link')
			});
		}

		if (config.command) {
			details.push({
				kind: 'detail',
				key: `${provider.id}::command`,
				label: `Command: ${config.command}`,
				iconPath: new vscode.ThemeIcon('terminal')
			});
		}

		if (config.args && config.args.length > 0) {
			details.push({
				kind: 'detail',
				key: `${provider.id}::args`,
				label: `Args: ${config.args.join(' ')}`,
				iconPath: new vscode.ThemeIcon('list-unordered')
			});
		}

		const envKeys = formatKeyList(config.env);
		if (envKeys) {
			details.push({
				kind: 'detail',
				key: `${provider.id}::env`,
				label: `Env: ${envKeys}`,
				iconPath: new vscode.ThemeIcon('key')
			});
		}

		const headerKeys = formatKeyList(config.headers);
		if (headerKeys) {
			details.push({
				kind: 'detail',
				key: `${provider.id}::headers`,
				label: `Headers: ${headerKeys}`,
				iconPath: new vscode.ThemeIcon('symbol-key')
			});
		}

		if (config.notes) {
			details.push({
				kind: 'detail',
				key: `${provider.id}::notes`,
				label: `Notes: ${config.notes}`,
				iconPath: new vscode.ThemeIcon('note')
			});
		}

		if (provider.issues?.length) {
			details.push({
				kind: 'detail',
				key: `${provider.id}::issues`,
				label: `Issues: ${provider.issues.join(', ')}`,
				iconPath: new vscode.ThemeIcon('warning')
			});
		}

		return details;
	}
}
