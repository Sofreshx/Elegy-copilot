import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

type NodeKind = 'workspace' | 'candidate' | 'status';

interface BaseNode {
	kind: NodeKind;
	key: string;
	label: string;
	description?: string;
	contextValue?: string;
	iconPath?: vscode.ThemeIcon;
	children?: Node[];
}

interface WorkspaceNode extends BaseNode {
	kind: 'workspace';
	workspaceFolder: vscode.WorkspaceFolder;
	workspaceRoot: string;
}

interface CandidateNode extends BaseNode {
	kind: 'candidate';
	workspaceFolder: vscode.WorkspaceFolder;
	workspaceRoot: string;
	candidatePath: string;
}

interface StatusNode extends BaseNode {
	kind: 'status';
}

type Node = WorkspaceNode | CandidateNode | StatusNode;

function normalizeFsPath(fsPath: string): string {
	const resolved = path.resolve(fsPath);
	const unified = resolved.replace(/[/\\]+/g, path.sep);
	return process.platform === 'win32' ? unified.toLowerCase() : unified;
}

function isWithinWorkspaceRoot(workspaceRoot: string, candidatePath: string): boolean {
	const root = normalizeFsPath(workspaceRoot);
	const candidate = normalizeFsPath(candidatePath);
	if (root === candidate) {
		return true;
	}
	const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
	return candidate.startsWith(prefix);
}

function globToRegExp(glob: string): RegExp {
	const escaped = glob.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const regexSource = `^${escaped.replace(/\\\*/g, '.*').replace(/\\\?/g, '.')}$`;
	return new RegExp(regexSource, process.platform === 'win32' ? 'i' : '');
}

function getPatterns(): string[] {
	const config = vscode.workspace.getConfiguration('skillInstaller.dumpCleaner');
	const patterns = config.get<string[]>('patterns', ['tmpclaude-*']);
	return Array.isArray(patterns)
		? patterns.map((p) => (typeof p === 'string' ? p.trim() : '')).filter((p) => p.length > 0)
		: ['tmpclaude-*'];
}

function compileMatchers(patterns: string[]): RegExp[] {
	const matchers: RegExp[] = [];
	for (const pattern of patterns) {
		try {
			matchers.push(globToRegExp(pattern));
		} catch {
			// Ignore invalid patterns
		}
	}
	return matchers;
}

function matchesAny(basename: string, matchers: RegExp[]): boolean {
	return matchers.some((m) => m.test(basename));
}

interface ScanResult {
	candidates: CandidateNode[];
	error?: string;
}

export class DumpCleanerTreeProvider implements vscode.TreeDataProvider<Node> {
	private _onDidChangeTreeData = new vscode.EventEmitter<Node | undefined | null | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private snapshot: Node[] | undefined;

	constructor(private readonly output: vscode.OutputChannel) {}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	invalidateCache(): void {
		this.snapshot = undefined;
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
			if (!this.snapshot) {
				this.snapshot = await this.scanWorkspaceRoots();
			}
			return this.snapshot;
		}

		return element.children ?? [];
	}

	async deleteCandidate(arg: unknown): Promise<void> {
		const node = arg as CandidateNode | undefined;
		if (!node || typeof node !== 'object' || node.kind !== 'candidate') {
			void vscode.window.showInformationMessage('Select a dump item to delete from the Dump Cleaner view.');
			return;
		}

		const workspaceRoot = node.workspaceRoot;
		const targetPath = node.candidatePath;
		const resolvedTarget = path.resolve(targetPath);

		if (!isWithinWorkspaceRoot(workspaceRoot, resolvedTarget)) {
			void vscode.window.showErrorMessage('Refusing to delete: path is outside the workspace root.');
			return;
		}

		let stat: fs.Stats;
		try {
			stat = await fs.promises.lstat(resolvedTarget);
		} catch (err) {
			const code = err && typeof err === 'object' && 'code' in err ? String((err as { code?: unknown }).code) : '';
			if (code === 'ENOENT') {
				void vscode.window.showInformationMessage('Item no longer exists.');
				this.invalidateCache();
				return;
			}
			const msg = err instanceof Error ? err.message : String(err);
			void vscode.window.showErrorMessage(`Failed to inspect path before delete: ${msg}`);
			return;
		}

		if (stat.isSymbolicLink()) {
			void vscode.window.showErrorMessage('Refusing to delete: symbolic links are not allowed.');
			return;
		}

		const baseName = path.basename(resolvedTarget);
		const choice = await vscode.window.showWarningMessage(
			`Move "${baseName}" to Trash?`,
			{ modal: true },
			'Move to Trash'
		);
		if (choice !== 'Move to Trash') {
			return;
		}

		try {
			await vscode.workspace.fs.delete(vscode.Uri.file(resolvedTarget), {
				recursive: true,
				useTrash: true,
			});
			this.invalidateCache();
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			void vscode.window.showErrorMessage(`Delete failed: ${msg}`);
		}
	}

	private async scanWorkspaceRoots(): Promise<Node[]> {
		const folders = vscode.workspace.workspaceFolders ?? [];
		if (folders.length === 0) {
			return [
				{
					kind: 'status',
					key: 'no-workspace',
					label: 'No workspace folders',
					description: 'Open a folder or workspace to scan for dump artefacts.',
					iconPath: new vscode.ThemeIcon('circle-slash'),
				},
			];
		}

		const patterns = getPatterns();
		const matchers = compileMatchers(patterns);

		const roots: Node[] = [];
		for (const folder of folders) {
			const workspaceRoot = folder.uri.fsPath;
			const result = await this.scanWorkspaceRoot(folder, workspaceRoot, matchers);
			const candidates = result.candidates;

			const description = result.error
				? 'error'
				: `${candidates.length} match${candidates.length === 1 ? '' : 'es'}`;
			roots.push({
				kind: 'workspace',
				key: folder.uri.toString(),
				label: folder.name,
				description,
				iconPath: new vscode.ThemeIcon('repo'),
				workspaceFolder: folder,
				workspaceRoot,
				children:
					result.error
						? [
							{
								kind: 'status',
								key: `${folder.uri.toString()}::scan-error`,
								label: 'Failed to scan workspace root',
								description: result.error,
								iconPath: new vscode.ThemeIcon('error'),
							},
						]
						: candidates.length > 0
						? candidates
						: [
							{
								kind: 'status',
								key: `${folder.uri.toString()}::empty`,
								label: 'No matches',
								description: patterns.length ? patterns.join(' • ') : undefined,
								iconPath: new vscode.ThemeIcon('check'),
							},
						],
			});
		}

		this.output.appendLine(`[Dump Cleaner] Scanned ${folders.length} workspace root(s) for patterns: ${patterns.join(', ')}`);
		return roots;
	}

	private async scanWorkspaceRoot(
		folder: vscode.WorkspaceFolder,
		workspaceRoot: string,
		matchers: RegExp[]
	): Promise<ScanResult> {
		let entries: fs.Dirent[];
		try {
			entries = await fs.promises.readdir(workspaceRoot, { withFileTypes: true });
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { candidates: [], error: msg };
		}

		const candidates: CandidateNode[] = [];
		for (const entry of entries) {
			if (!matchesAny(entry.name, matchers)) {
				continue;
			}

			const candidatePath = path.join(workspaceRoot, entry.name);
			const icon = entry.isDirectory() ? 'folder' : entry.isFile() ? 'file' : 'question';
			const description = entry.isDirectory() ? 'folder' : entry.isFile() ? 'file' : undefined;
			candidates.push({
				kind: 'candidate',
				key: candidatePath,
				label: entry.name,
				description,
				iconPath: new vscode.ThemeIcon(icon),
				contextValue: 'skillInstaller.dumpCleaner.item',
				workspaceFolder: folder,
				workspaceRoot,
				candidatePath,
			});
		}

		candidates.sort((a, b) => a.label.localeCompare(b.label));
		return { candidates };
	}
}
