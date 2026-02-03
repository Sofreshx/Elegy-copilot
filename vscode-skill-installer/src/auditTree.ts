import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// Types
export type AuditType = 'deploy' | 'stack' | 'test' | 'e2e' | 'security';

export interface AuditStats {
	pass: number;
	warn: number;
	fail: number;
}

export interface AuditReport {
	type: AuditType;
	path: string;
	timestamp?: string;
	durationMs?: number;
	stats?: AuditStats;
	exists: boolean;
}

// Node types for tree
type NodeKind = 'section' | 'repo' | 'audit' | 'stat';

interface BaseNode {
	kind: NodeKind;
	key: string;
	label: string;
	description?: string;
	tooltip?: string | vscode.MarkdownString;
	contextValue?: string;
	command?: vscode.Command;
	iconPath?: vscode.ThemeIcon;
	children?: Node[];
}

interface AuditNode extends BaseNode {
	kind: 'audit';
	report: AuditReport;
}

interface StatNode extends BaseNode {
	kind: 'stat';
}

interface SectionNode extends BaseNode {
	kind: 'section';
}

interface RepoNode extends BaseNode {
	kind: 'repo';
	repoPath: string;
}

type Node = AuditNode | StatNode | SectionNode | RepoNode;

// Audit type metadata
const AUDIT_TYPES: { type: AuditType; label: string; file: string }[] = [
	{ type: 'deploy', label: 'Deploy', file: 'deploy-audit.md' },
	{ type: 'stack', label: 'Stack', file: 'stack-audit.md' },
	{ type: 'test', label: 'Test', file: 'test-audit.md' },
	{ type: 'e2e', label: 'E2E', file: 'e2e-validation.md' },
	{ type: 'security', label: 'Security', file: 'security-audit.md' }
];

const AUDIT_DESCRIPTIONS: Record<AuditType, string> = {
	deploy: 'Deployment readiness: manifests, infra setup, and publish checks.',
	stack: 'Stack detection: frameworks, runtimes, and skill alignment.',
	test: 'Test posture: unit/integration coverage and gaps.',
	e2e: 'E2E health: startup, critical flows, and validation checks.',
	security: 'Security posture: OWASP risks, secrets, and hardening.'
};

function parseYamlFrontMatter(content: string): Record<string, unknown> {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) {
		return {};
	}

	const yaml = match[1];
	const result: Record<string, unknown> = {};

	// Simple YAML parser for flat and nested stats structure
	const lines = yaml.split(/\r?\n/);
	let currentKey: string | undefined;
	let currentIndent = 0;
	const nested: Record<string, Record<string, unknown>> = {};

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) {
			continue;
		}

		const indent = line.search(/\S/);
		const colonMatch = trimmed.match(/^([a-z_]+):\s*(.*)$/i);
		if (!colonMatch) {
			continue;
		}

		const [, key, value] = colonMatch;

		if (indent === 0) {
			currentKey = key;
			currentIndent = indent;
			if (value) {
				result[key] = parseYamlValue(value);
			}
		} else if (currentKey && indent > currentIndent) {
			if (!nested[currentKey]) {
				nested[currentKey] = {};
			}
			nested[currentKey][key] = parseYamlValue(value);
		}
	}

	// Merge nested objects
	for (const [key, obj] of Object.entries(nested)) {
		result[key] = obj;
	}

	return result;
}

function parseYamlValue(value: string): unknown {
	const trimmed = value.trim();
	if (trimmed === 'true') {
		return true;
	}
	if (trimmed === 'false') {
		return false;
	}
	const num = Number(trimmed);
	if (!isNaN(num) && trimmed !== '') {
		return num;
	}
	return trimmed;
}

function scanAuditReportsForRepo(repoPath: string): AuditReport[] {
	const outputDir = path.join(repoPath, '.instructions-output');
	const reports: AuditReport[] = [];

	for (const auditMeta of AUDIT_TYPES) {
		const filePath = path.join(outputDir, auditMeta.file);
		const exists = fs.existsSync(filePath);

		const report: AuditReport = {
			type: auditMeta.type,
			path: filePath,
			exists
		};

		if (exists) {
			try {
				const content = fs.readFileSync(filePath, 'utf-8');
				const frontMatter = parseYamlFrontMatter(content);

				if (frontMatter.timestamp) {
					report.timestamp = String(frontMatter.timestamp);
				}
				if (typeof frontMatter.duration_ms === 'number') {
					report.durationMs = frontMatter.duration_ms;
				}
				if (frontMatter.stats && typeof frontMatter.stats === 'object') {
					const stats = frontMatter.stats as Record<string, unknown>;
					report.stats = {
						pass: typeof stats.pass === 'number' ? stats.pass : 0,
						warn: typeof stats.warn === 'number' ? stats.warn : 0,
						fail: typeof stats.fail === 'number' ? stats.fail : 0
					};
				}
			} catch {
				// Ignore read errors
			}
		}

		reports.push(report);
	}

	return reports;
}

function getOverallIcon(reports: AuditReport[]): vscode.ThemeIcon {
	const existingReports = reports.filter((r) => r.exists && r.stats);
	if (existingReports.length === 0) {
		return new vscode.ThemeIcon('circle-outline');
	}

	const totalFail = existingReports.reduce((sum, r) => sum + (r.stats?.fail ?? 0), 0);
	const totalWarn = existingReports.reduce((sum, r) => sum + (r.stats?.warn ?? 0), 0);

	if (totalFail > 0) {
		return new vscode.ThemeIcon('error');
	}
	if (totalWarn > 0) {
		return new vscode.ThemeIcon('warning');
	}
	return new vscode.ThemeIcon('pass');
}

function getAuditIcon(report: AuditReport): vscode.ThemeIcon {
	if (!report.exists) {
		return new vscode.ThemeIcon('circle-outline');
	}
	if (!report.stats) {
		return new vscode.ThemeIcon('file');
	}
	if (report.stats.fail > 0) {
		return new vscode.ThemeIcon('error');
	}
	if (report.stats.warn > 0) {
		return new vscode.ThemeIcon('warning');
	}
	return new vscode.ThemeIcon('pass');
}

function formatTimestamp(timestamp?: string): string {
	if (!timestamp) {
		return '';
	}
	try {
		const date = new Date(timestamp);
		return date.toLocaleString();
	} catch {
		return timestamp;
	}
}

export class AuditTreeProvider implements vscode.TreeDataProvider<Node> {
	private _onDidChangeTreeData = new vscode.EventEmitter<Node | undefined | null | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private cache: Map<string, AuditReport[]> = new Map();

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
		item.tooltip = element.tooltip;
		item.contextValue = element.contextValue;
		item.command = element.command;
		item.iconPath = element.iconPath;
		return item;
	}

	async getChildren(element?: Node): Promise<Node[]> {
		if (!element) {
			return this.buildRootNodes();
		}

		if (element.kind === 'repo' || element.kind === 'section') {
			// Re-scan for fresh data when expanding
			this.cache.clear();
			const roots = this.buildRootNodes();
			const remapped = this.findMatchingNode(roots, element);
			return remapped?.children ?? [];
		}

		return element.children ?? [];
	}

	invalidateCache(): void {
		this.cache.clear();
		this.refresh();
	}

	private buildRootNodes(): Node[] {
		const folders = vscode.workspace.workspaceFolders ?? [];
		if (folders.length === 0) {
			return [];
		}

		const totalReportsExist = folders.reduce((sum: number, folder: vscode.WorkspaceFolder) => {
			const reports = this.getReportsForRepo(folder.uri.fsPath);
			return sum + reports.filter((r) => r.exists).length;
		}, 0);

		const section: SectionNode = {
			kind: 'section',
			key: 'audit-results',
			label: 'Audit Results',
			description: `${totalReportsExist} reports`,
			iconPath: new vscode.ThemeIcon('checklist'),
			children: folders.map((folder: vscode.WorkspaceFolder) => this.toRepoNode(folder))
		};

		return [section];
	}

	private getReportsForRepo(repoPath: string): AuditReport[] {
		if (!this.cache.has(repoPath)) {
			const reports = scanAuditReportsForRepo(repoPath);
			this.cache.set(repoPath, reports);
			this.logReports(repoPath, reports);
		}
		return this.cache.get(repoPath) ?? [];
	}

	private toRepoNode(folder: vscode.WorkspaceFolder): RepoNode {
		const reports = this.getReportsForRepo(folder.uri.fsPath);
		const existingCount = reports.filter((r) => r.exists).length;
		const icon = getOverallIcon(reports);

		return {
			kind: 'repo',
			key: folder.uri.fsPath,
			repoPath: folder.uri.fsPath,
			label: folder.name,
			description: existingCount > 0 ? `${existingCount} audits` : 'no audits',
			iconPath: icon,
			contextValue: 'skillInstaller.auditRepo',
			children: reports.map((r) => this.toAuditNode(r))
		};
	}

	private toAuditNode(report: AuditReport): AuditNode {
		const meta = AUDIT_TYPES.find((m) => m.type === report.type);
		const label = meta?.label ?? report.type;
		const icon = getAuditIcon(report);
		const tooltip = AUDIT_DESCRIPTIONS[report.type];

		let description = '';
		if (!report.exists) {
			description = 'not generated';
		} else if (report.stats) {
			const parts: string[] = [];
			if (report.stats.pass > 0) {
				parts.push(`✓${report.stats.pass}`);
			}
			if (report.stats.warn > 0) {
				parts.push(`⚠${report.stats.warn}`);
			}
			if (report.stats.fail > 0) {
				parts.push(`✗${report.stats.fail}`);
			}
			description = parts.join(' ');
		} else {
			description = formatTimestamp(report.timestamp) || 'exists';
		}

		const children: StatNode[] = [];
		if (report.exists && report.stats) {
			children.push(
				{
					kind: 'stat',
					key: `${report.path}::pass`,
					label: `Pass: ${report.stats.pass}`,
					iconPath: new vscode.ThemeIcon('pass')
				},
				{
					kind: 'stat',
					key: `${report.path}::warn`,
					label: `Warn: ${report.stats.warn}`,
					iconPath: new vscode.ThemeIcon('warning')
				},
				{
					kind: 'stat',
					key: `${report.path}::fail`,
					label: `Fail: ${report.stats.fail}`,
					iconPath: new vscode.ThemeIcon('error')
				}
			);
		}

		return {
			kind: 'audit',
			key: report.path,
			label,
			description,
			tooltip,
			iconPath: icon,
			report,
			contextValue: report.exists ? 'skillInstaller.auditReport' : 'skillInstaller.auditReportMissing',
			command: report.exists
				? {
						title: 'Open Report',
						command: 'vscode.open',
						arguments: [vscode.Uri.file(report.path)]
					}
				: undefined,
			children: children.length > 0 ? children : undefined
		};
	}

	private logReports(repoPath: string, reports: AuditReport[]): void {
		this.output.appendLine(`[Audit] Scanned ${repoPath}`);
		for (const r of reports) {
			const status = r.exists
				? r.stats
					? `pass=${r.stats.pass} warn=${r.stats.warn} fail=${r.stats.fail}`
					: 'exists (no stats)'
				: 'missing';
			this.output.appendLine(`  ${r.type}: ${status}`);
		}
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

export { AUDIT_TYPES };
