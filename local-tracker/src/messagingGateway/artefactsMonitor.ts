import chokidar, { type FSWatcher } from 'chokidar';
import fs from 'fs';
import path from 'path';

export interface ArtefactSnapshotItem {
	fileName: string;
	/** Workspace-root-relative path, POSIX-style (forward slashes). */
	relativePath: string;
	mtimeMs: number;
	size: number;
}

export type ArtefactsChangeKind = 'add' | 'change' | 'unlink';

export interface ArtefactsMonitorEvent {
	workspaceRoot: string;
	artefactsRoot: string;
	kind: ArtefactsChangeKind;
	/** Workspace-root-relative path, POSIX-style (forward slashes). */
	relativePath: string;
	changedAt: string;
}

export interface ArtefactsMonitorOptions {
	workspaceRoot: string;
	/** Debounce per-file to avoid bursts (default 350ms). */
	debounceMs?: number;
	/** Chokidar awaitWriteFinish settings (defaults mirror other watchers). */
	awaitWriteFinish?: { stabilityThreshold: number; pollInterval: number };
	/** Extensions considered markdown (default: ['.md', '.mdx']). */
	markdownExtensions?: ReadonlyArray<string>;
}

function toPosixPath(p: string): string {
	return p.replace(/\\/g, '/');
}

async function statToSnapshotItem(workspaceRoot: string, filePath: string): Promise<ArtefactSnapshotItem> {
	const st = await fs.promises.stat(filePath);
	return {
		fileName: path.basename(filePath),
		relativePath: toPosixPath(path.relative(workspaceRoot, filePath)),
		mtimeMs: st.mtimeMs,
		size: st.size,
	};
}

async function listMarkdownFiles(rootDir: string, markdownExtensions: ReadonlyArray<string>): Promise<string[]> {
	try {
		const entries = await fs.promises.readdir(rootDir, { withFileTypes: true });
		const output: string[] = [];
		for (const entry of entries) {
			const full = path.join(rootDir, entry.name);
			if (entry.isDirectory()) {
				output.push(...(await listMarkdownFiles(full, markdownExtensions)));
				continue;
			}
			if (!entry.isFile()) continue;
			const ext = path.extname(entry.name).toLowerCase();
			if (markdownExtensions.includes(ext)) output.push(full);
		}
		return output;
	} catch {
		return [];
	}
}

export class ArtefactsMonitor {
	private readonly workspaceRoot: string;
	private readonly artefactsRoot: string;
	private readonly debounceMs: number;
	private readonly awaitWriteFinish: { stabilityThreshold: number; pollInterval: number };
	private readonly markdownExtensions: ReadonlyArray<string>;

	private watcher: FSWatcher | null = null;
	private readonly snapshotByRelPath = new Map<string, ArtefactSnapshotItem>();
	private readonly debounceTimers = new Map<string, NodeJS.Timeout>();
	private readonly handlers: Array<(event: ArtefactsMonitorEvent) => void> = [];

	constructor(options: ArtefactsMonitorOptions) {
		this.workspaceRoot = path.resolve(options.workspaceRoot);
		this.artefactsRoot = path.join(this.workspaceRoot, '.instructions', 'artefacts');
		this.debounceMs = options.debounceMs ?? 350;
		this.awaitWriteFinish = options.awaitWriteFinish ?? { stabilityThreshold: 250, pollInterval: 100 };
		this.markdownExtensions = options.markdownExtensions ?? ['.md', '.mdx'];
	}

	on(handler: (event: ArtefactsMonitorEvent) => void): void {
		this.handlers.push(handler);
	}

	getWorkspaceRoot(): string {
		return this.workspaceRoot;
	}

	getArtefactsRoot(): string {
		return this.artefactsRoot;
	}

	getSnapshot(): ArtefactSnapshotItem[] {
		return [...this.snapshotByRelPath.values()].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
	}

	/**
	 * (Re)builds the snapshot by scanning the artefacts directory.
	 * Safe to call at any time; it overwrites entries for currently-existing files.
	 */
	async refreshSnapshot(): Promise<void> {
		const files = await listMarkdownFiles(this.artefactsRoot, this.markdownExtensions);
		const next = new Map<string, ArtefactSnapshotItem>();
		for (const filePath of files) {
			try {
				const item = await statToSnapshotItem(this.workspaceRoot, filePath);
				next.set(item.relativePath, item);
			} catch {
				// file disappeared between readdir and stat
			}
		}
		this.snapshotByRelPath.clear();
		for (const [k, v] of next.entries()) this.snapshotByRelPath.set(k, v);
	}

	async start(): Promise<void> {
		if (this.watcher) return;

		const globs = this.markdownExtensions.map((ext) => path.join(this.artefactsRoot, '**', `*${ext}`));
		this.watcher = chokidar.watch(globs, {
			ignoreInitial: true,
			awaitWriteFinish: this.awaitWriteFinish,
		});

		this.watcher.on('add', (filePath) => this.enqueueUpsert('add', filePath));
		this.watcher.on('change', (filePath) => this.enqueueUpsert('change', filePath));
		this.watcher.on('unlink', (filePath) => this.enqueueUnlink(filePath));

		await this.refreshSnapshot();
	}

	async stop(): Promise<void> {
		for (const timer of this.debounceTimers.values()) clearTimeout(timer);
		this.debounceTimers.clear();

		if (this.watcher) {
			await this.watcher.close();
			this.watcher = null;
		}
	}

	private emit(kind: ArtefactsChangeKind, relativePath: string): void {
		const event: ArtefactsMonitorEvent = {
			workspaceRoot: this.workspaceRoot,
			artefactsRoot: this.artefactsRoot,
			kind,
			relativePath,
			changedAt: new Date().toISOString(),
		};
		for (const handler of this.handlers) {
			try {
				handler(event);
			} catch {
				// avoid crashing the monitor on handler errors
			}
		}
	}

	private enqueueUpsert(kind: Exclude<ArtefactsChangeKind, 'unlink'>, filePath: string): void {
		const rel = toPosixPath(path.relative(this.workspaceRoot, filePath));
		const key = `upsert:${rel}`;
		const existing = this.debounceTimers.get(key);
		if (existing) clearTimeout(existing);
		this.debounceTimers.set(
			key,
			setTimeout(() => {
				this.debounceTimers.delete(key);
				void (async () => {
					try {
						const item = await statToSnapshotItem(this.workspaceRoot, filePath);
						this.snapshotByRelPath.set(item.relativePath, item);
						this.emit(kind, item.relativePath);
					} catch {
						// If the file vanished, treat as unlink.
						this.snapshotByRelPath.delete(rel);
						this.emit('unlink', rel);
					}
				})();
			}, this.debounceMs),
		);
	}

	private enqueueUnlink(filePath: string): void {
		const rel = toPosixPath(path.relative(this.workspaceRoot, filePath));
		const key = `unlink:${rel}`;
		const existing = this.debounceTimers.get(key);
		if (existing) clearTimeout(existing);
		this.debounceTimers.set(
			key,
			setTimeout(() => {
				this.debounceTimers.delete(key);
				this.snapshotByRelPath.delete(rel);
				this.emit('unlink', rel);
			}, this.debounceMs),
		);
	}
}
