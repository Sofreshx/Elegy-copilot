import * as vscode from 'vscode';
import { scanAgents } from './agentScanner';
import { AgentDiscoverySnapshot, AgentEntry, RepoAgents } from './types';

type NodeKind = 'section' | 'repo' | 'group' | 'agent';

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

interface RepoNode extends BaseNode {
	kind: 'repo';
	repo: RepoAgents;
}

interface GroupNode extends BaseNode {
	kind: 'group';
	groupKey: 'executive-agents' | 'agents';
}

interface AgentNode extends BaseNode {
	kind: 'agent';
	agent: AgentEntry;
}

type Node = SectionNode | RepoNode | GroupNode | AgentNode;

function isExecutiveRole(role: string | undefined): boolean {
	const r = (role ?? '').trim().toLowerCase();
	return r === 'executive' || r === 'planner';
}

function normalizeVisibility(value: string | undefined): string | undefined {
	const v = (value ?? '').trim();
	return v ? v.toLowerCase() : undefined;
}

export class AgentDiscoveryTreeProvider implements vscode.TreeDataProvider<Node> {
	private _onDidChangeTreeData = new vscode.EventEmitter<Node | undefined | null | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private snapshot: AgentDiscoverySnapshot | undefined;

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
				this.snapshot = await scanAgents();
				this.logSnapshot(this.snapshot);
			}
			return this.buildRootNodes(this.snapshot);
		}

		if (element.kind === 'section' || element.kind === 'repo' || element.kind === 'group') {
			this.snapshot = await scanAgents();
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

	private buildRootNodes(snapshot: AgentDiscoverySnapshot): Node[] {
		const totalAgents = snapshot.repos.reduce((sum, r) => sum + r.agents.length, 0);

		const section: SectionNode = {
			kind: 'section',
			key: 'workspace-agents',
			label: 'Workspace Agents',
			description: totalAgents.toString(),
			iconPath: new vscode.ThemeIcon('organization'),
			children: snapshot.repos.map((r) => this.toRepoNode(r))
		};

		return [section];
	}

	private toRepoNode(repo: RepoAgents): RepoNode {
		const hasAgentsDir = Boolean(repo.agentsDirPath);
		const repoIcon = repo.isInstructionEngine ? 'library' : 'repo';
		const groups = hasAgentsDir ? this.groupAgents(repo) : [];

		return {
			kind: 'repo',
			key: repo.repoPath,
			label: repo.repoName,
			description: hasAgentsDir ? `${repo.agents.length} agents` : 'no agents folder',
			iconPath: new vscode.ThemeIcon(hasAgentsDir ? repoIcon : 'circle-slash'),
			contextValue: 'skillInstaller.repo',
			repo,
			children: groups
		};
	}

	private groupAgents(repo: RepoAgents): GroupNode[] {
		const executives = repo.agents.filter((a) => isExecutiveRole(a.role));
		const others = repo.agents.filter((a) => !isExecutiveRole(a.role));

		const result: GroupNode[] = [];
		result.push({
			kind: 'group',
			key: `${repo.repoPath}::executive-agents`,
			label: 'Executive Agents',
			description: executives.length.toString(),
			iconPath: new vscode.ThemeIcon('star-full'),
			groupKey: 'executive-agents',
			children: executives.map((a) => this.toAgentNode(repo, a))
		});

		result.push({
			kind: 'group',
			key: `${repo.repoPath}::agents`,
			label: 'Agents',
			description: others.length.toString(),
			iconPath: new vscode.ThemeIcon('symbol-method'),
			groupKey: 'agents',
			children: others.map((a) => this.toAgentNode(repo, a))
		});

		return result;
	}

	private toAgentNode(repo: RepoAgents, agent: AgentEntry): AgentNode {
		const visibility = normalizeVisibility(agent.visibility);
		const enabled = agent.enabled !== false;
		const parts: string[] = [];
		if (agent.role) {
			parts.push(agent.role);
		}
		if (visibility) {
			parts.push(visibility);
		}
		if (agent.catalogLayer === 'repo-local') {
			parts.push('repo-local');
		} else if (agent.catalogLayer === 'user-installed') {
			parts.push('installed');
		} else {
			parts.push('discoverable');
		}
		if (agent.overridden) {
			parts.push('override');
		}
		if (!enabled) {
			parts.push('disabled');
		}
		const description = parts.length > 0 ? parts.join(' • ') : repo.repoName;

		let icon = visibility === 'internal' ? 'lock' : 'person';
		if (!enabled) {
			icon = 'circle-slash';
		}
		return {
			kind: 'agent',
			key: agent.path,
			label: agent.name,
			description,
			iconPath: new vscode.ThemeIcon(icon),
			contextValue: enabled
				? 'skillInstaller.agent.enabled'
				: 'skillInstaller.agent.disabled',
			agent,
			command: {
				title: 'Open Agent',
				command: 'vscode.open',
				arguments: [vscode.Uri.file(agent.openPath ?? agent.path)]
			}
		};
	}

	private logSnapshot(snapshot: AgentDiscoverySnapshot): void {
		this.output.appendLine('[Skill Installer] Agent discovery snapshot');
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
