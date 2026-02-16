import chokidar, { type FSWatcher } from 'chokidar';
import fs from 'fs';
import path from 'path';
import { getWorkspaceDbPathFile, resolveE3DbPathForWorkspaceRoot } from './e3DbResolution';

export type E3WatchReason =
	| 'db-changed'
	| 'wal-changed'
	| 'shm-changed'
	| 'db-path-file-changed'
	| 'poll';

export interface E3WatchEvent {
	workspaceRoot: string;
	dbPath: string;
	reason: E3WatchReason;
	filePath?: string;
	changedAt: string;
}

export interface E3WatchOptions {
	workspaceRoot: string;
	/** Debounce per-file to avoid bursts (default 350ms). */
	debounceMs?: number;
	/** If true, also polls file stat signatures as a fallback (default true). */
	pollFallback?: boolean;
	/** Poll interval in ms (default 1200ms). */
	pollIntervalMs?: number;
}

export class E3WatchHandle {
	private watcher: FSWatcher | null;
	private pollTimer: NodeJS.Timeout | null;
	private readonly stopPollFn: () => void;

	constructor(watcher: FSWatcher | null, pollTimer: NodeJS.Timeout | null, stopPollFn: () => void) {
		this.watcher = watcher;
		this.pollTimer = pollTimer;
		this.stopPollFn = stopPollFn;
	}

	async stop(): Promise<void> {
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
		this.stopPollFn();

		if (this.watcher) {
			await this.watcher.close();
			this.watcher = null;
		}
	}
}

function statSignature(filePath: string): string {
	try {
		const st = fs.statSync(filePath);
		return `${st.size}:${st.mtimeMs}`;
	} catch {
		return 'missing';
	}
}

function buildWatchTargets(dbPath: string): { db: string; wal: string; shm: string } {
	return {
		db: dbPath,
		wal: `${dbPath}-wal`,
		shm: `${dbPath}-shm`,
	};
}

export function startE3Watch(options: E3WatchOptions, onEvent: (event: E3WatchEvent) => void): E3WatchHandle {
	const workspaceRoot = path.resolve(options.workspaceRoot);
	const debounceMs = options.debounceMs ?? 350;
	const pollFallback = options.pollFallback ?? true;
	const pollIntervalMs = options.pollIntervalMs ?? 1200;

	let currentDbPath = resolveE3DbPathForWorkspaceRoot(workspaceRoot).dbPath;
	let targets = buildWatchTargets(currentDbPath);
	const dbPathFile = getWorkspaceDbPathFile(workspaceRoot);

	const debounceTimers = new Map<string, NodeJS.Timeout>();
	const debouncedEmit = (key: string, fn: () => void) => {
		const existing = debounceTimers.get(key);
		if (existing) clearTimeout(existing);
		debounceTimers.set(
			key,
			setTimeout(() => {
				debounceTimers.delete(key);
				fn();
			}, debounceMs),
		);
	};

	const emit = (reason: E3WatchReason, filePath?: string) => {
		onEvent({
			workspaceRoot,
			dbPath: currentDbPath,
			reason,
			filePath,
			changedAt: new Date().toISOString(),
		});
	};

	const watcher = chokidar.watch([targets.db, targets.wal, targets.shm, dbPathFile], {
		ignoreInitial: true,
		awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 100 },
	});

	watcher.on('change', (filePath) => {
		debouncedEmit(`change:${filePath}`, () => {
			if (path.normalize(filePath) === path.normalize(dbPathFile)) {
				const next = resolveE3DbPathForWorkspaceRoot(workspaceRoot).dbPath;
				if (path.normalize(next) !== path.normalize(currentDbPath)) {
					currentDbPath = next;
					targets = buildWatchTargets(currentDbPath);
					emit('db-path-file-changed', filePath);
					// Note: chokidar can watch non-existent targets, but to be safe we add new ones.
					void watcher.add([targets.db, targets.wal, targets.shm]);
					return;
				}
				emit('db-path-file-changed', filePath);
				return;
			}

			if (path.normalize(filePath) === path.normalize(targets.wal)) {
				emit('wal-changed', filePath);
				return;
			}
			if (path.normalize(filePath) === path.normalize(targets.shm)) {
				emit('shm-changed', filePath);
				return;
			}
			emit('db-changed', filePath);
		});
	});

	watcher.on('add', (filePath) => {
		debouncedEmit(`add:${filePath}`, () => {
			if (path.normalize(filePath) === path.normalize(targets.wal)) emit('wal-changed', filePath);
			else if (path.normalize(filePath) === path.normalize(targets.shm)) emit('shm-changed', filePath);
			else emit('db-changed', filePath);
		});
	});

	let lastSignatures = {
		db: statSignature(targets.db),
		wal: statSignature(targets.wal),
		shm: statSignature(targets.shm),
		pathFile: statSignature(dbPathFile),
	};

	let pollTimer: NodeJS.Timeout | null = null;
	if (pollFallback) {
		pollTimer = setInterval(() => {
			const nextPathFileSig = statSignature(dbPathFile);
			if (nextPathFileSig !== lastSignatures.pathFile) {
				lastSignatures.pathFile = nextPathFileSig;
				const nextDb = resolveE3DbPathForWorkspaceRoot(workspaceRoot).dbPath;
				if (path.normalize(nextDb) !== path.normalize(currentDbPath)) {
					currentDbPath = nextDb;
					targets = buildWatchTargets(currentDbPath);
					lastSignatures = {
						db: statSignature(targets.db),
						wal: statSignature(targets.wal),
						shm: statSignature(targets.shm),
						pathFile: lastSignatures.pathFile,
					};
				}
				emit('poll', dbPathFile);
			}

			const dbSig = statSignature(targets.db);
			const walSig = statSignature(targets.wal);
			const shmSig = statSignature(targets.shm);
			if (dbSig !== lastSignatures.db || walSig !== lastSignatures.wal || shmSig !== lastSignatures.shm) {
				lastSignatures = { ...lastSignatures, db: dbSig, wal: walSig, shm: shmSig };
				emit('poll', currentDbPath);
			}
		}, pollIntervalMs);
	}

	const stopPollFn = () => {
		for (const t of debounceTimers.values()) clearTimeout(t);
		debounceTimers.clear();
	};

	return new E3WatchHandle(watcher, pollTimer, stopPollFn);
}
