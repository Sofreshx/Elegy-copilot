import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { resolveE3DbPathForWorkspaceRoot } from './e3DbResolution';

export interface E3EnsureDbResult {
	status: string;
	path: string;
	schemaVersion: number;
	resolution?: {
		contractVersion?: string;
		source?: string;
		cwd?: string;
		discoveryRoot?: string | null;
		discoveryFile?: string | null;
		reuseHint?: string;
	};
}

export interface E3CliBridgeOptions {
	/**
	 * Optional override when running outside the instruction-engine repo.
	 * Expected to contain `vscode-skill-installer/scripts/e3-cli.js`.
	 */
	instructionEngineRoot?: string;
	maxScriptDiscoveryDepth?: number;
	defaultTimeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function asNonEmptyString(value: unknown, field: string): string {
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new Error(`[Gateway:E3] Invalid ${field} (expected non-empty string)`);
	}
	return value;
}

function asNumber(value: unknown, field: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new Error(`[Gateway:E3] Invalid ${field} (expected number)`);
	}
	return value;
}

function parseJsonStdout(stdout: string, commandLabel: string): unknown {
	const trimmed = stdout.trim();
	if (!trimmed) {
		throw new Error(`[Gateway:E3] ${commandLabel} produced empty stdout (expected JSON)`);
	}
	try {
		return JSON.parse(trimmed) as unknown;
	} catch {
		throw new Error(`[Gateway:E3] ${commandLabel} produced non-JSON stdout`);
	}
}

function findE3CliScriptPath(startDir: string, maxDepth: number): string {
	let dir = path.resolve(startDir);
	for (let depth = 0; depth <= maxDepth; depth++) {
		const candidate = path.join(dir, 'vscode-skill-installer', 'scripts', 'e3-cli.js');
		if (fs.existsSync(candidate)) return candidate;
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	throw new Error('[Gateway:E3] Unable to locate vscode-skill-installer/scripts/e3-cli.js (set instructionEngineRoot)');
}

export class E3CliBridge {
	private readonly e3CliScriptPath: string;
	private readonly ensureDbCache = new Map<string, E3EnsureDbResult>();
	private readonly defaultTimeoutMs: number;

	constructor(options: E3CliBridgeOptions = {}) {
		const maxDepth = options.maxScriptDiscoveryDepth ?? 12;
		this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;
		const root = options.instructionEngineRoot ? path.resolve(options.instructionEngineRoot) : undefined;
		this.e3CliScriptPath = root
			? path.join(root, 'vscode-skill-installer', 'scripts', 'e3-cli.js')
			: findE3CliScriptPath(__dirname, maxDepth);

		if (!fs.existsSync(this.e3CliScriptPath)) {
			throw new Error(`[Gateway:E3] E3 CLI script not found: ${this.e3CliScriptPath}`);
		}
	}

	/**
	 * Runs `ensure-db` once (per workspaceRoot) and caches the returned DB path.
	 *
	 * Contract: call ensure-db once with cwd=workspaceRoot, capture returned path,
	 * then pass `--db <path>` on all subsequent calls.
	 */
	async ensureDb(workspaceRoot: string): Promise<E3EnsureDbResult> {
		const normalizedRoot = path.resolve(workspaceRoot);
		const cacheKey = this.toCacheKey(normalizedRoot);
		const cached = this.ensureDbCache.get(cacheKey);
		const resolution = resolveE3DbPathForWorkspaceRoot(normalizedRoot);
		if (cached && this.pathsEqual(cached.path, resolution.dbPath)) {
			return cached;
		}

		const resultUnknown = await this.runCli({
			workspaceRoot: normalizedRoot,
			command: 'ensure-db',
			args: ['--db', resolution.dbPath],
			timeoutMs: this.defaultTimeoutMs,
		});

		if (!isRecord(resultUnknown)) {
			throw new Error('[Gateway:E3] ensure-db returned non-object JSON');
		}

		const ensured: E3EnsureDbResult = {
			status: asNonEmptyString(resultUnknown.status, 'ensure-db.status'),
			path: asNonEmptyString(resultUnknown.path, 'ensure-db.path'),
			schemaVersion: asNumber(resultUnknown.schemaVersion, 'ensure-db.schemaVersion'),
			resolution: isRecord(resultUnknown.resolution) ? (resultUnknown.resolution as E3EnsureDbResult['resolution']) : undefined,
		};

		this.ensureDbCache.set(cacheKey, ensured);
		return ensured;
	}

	getCachedDbPath(workspaceRoot: string): string | undefined {
		return this.ensureDbCache.get(this.toCacheKey(path.resolve(workspaceRoot)))?.path;
	}

	async call<T>(params: {
		workspaceRoot: string;
		command: string;
		args?: string[];
		/** If omitted, uses cached ensure-db path. */
		dbPath?: string;
		timeoutMs?: number;
	}): Promise<T> {
		const normalizedRoot = path.resolve(params.workspaceRoot);
		const dbPath = params.dbPath ?? this.getCachedDbPath(normalizedRoot);
		if (!dbPath) {
			throw new Error(`[Gateway:E3] Missing DB path for command ${params.command}; call ensureDb(workspaceRoot) first`);
		}
		const payload = await this.runCli({
			workspaceRoot: normalizedRoot,
			command: params.command,
			args: [...(params.args ?? []), '--db', dbPath],
			timeoutMs: params.timeoutMs ?? this.defaultTimeoutMs,
		});
		return payload as T;
	}

	private toCacheKey(workspaceRoot: string): string {
		const normalized = path.normalize(workspaceRoot);
		return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
	}

	private pathsEqual(a: string, b: string): boolean {
		const left = path.normalize(a);
		const right = path.normalize(b);
		return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
	}

	private runCli(params: {
		workspaceRoot: string;
		command: string;
		args: string[];
		timeoutMs: number;
	}): Promise<unknown> {
		const nodeExe = process.execPath;
		const commandLabel = `e3-cli ${params.command}`;
		const finalArgs = [this.e3CliScriptPath, params.command, ...params.args];

		return new Promise((resolve, reject) => {
			execFile(
				nodeExe,
				finalArgs,
				{
					cwd: params.workspaceRoot,
					timeout: params.timeoutMs,
					maxBuffer: 10 * 1024 * 1024,
				},
				(err, stdout, stderr) => {
					void stderr; // CLI uses stderr for human diagnostics; treat JSON stdout as authoritative.
					let json: unknown;
					try {
						json = parseJsonStdout(String(stdout ?? ''), commandLabel);
					} catch (parseErr) {
						reject(parseErr);
						return;
					}

					if (err) {
						// E3 CLI emits structured errors in stdout JSON.
						if (isRecord(json) && typeof json.error === 'string' && json.error.trim().length > 0) {
							reject(new Error(`[Gateway:E3] ${json.error}`));
							return;
						}
						reject(new Error(`[Gateway:E3] ${commandLabel} failed`));
						return;
					}

					resolve(json);
				},
			);
		});
	}
}
