#!/usr/bin/env node

/**
 * Executive3 CLI Bridge
 *
 * Provides direct SQLite access to the E3 database for agents
 * that cannot read return values from VS Code command execution.
 *
 * Usage:
 *   node scripts/e3-cli.js <command> [args...]
 *
 * Commands:
 *   ensure-db                          Open/create the DB, print status JSON
 *   get-session [sessionId]            Get active session or specific session
 *   create-session <json>              Create a new session
 *   update-session-status <id> <status>  Update session status
 *   create-plan <json>                 Create a new plan
 *   get-tasks [filterJson]             List tasks (optional filter)
 *   create-task <json>                 Create a new task
 *   update-task <id> <status> [error]  Update task status
 *   get-next-task [sessionId]          Get next actionable task
 *   get-task-summary [sessionId] [planId]  Get progress summary
 *   log-execution <json>               Log an execution entry
 *   get-execution-log [filterJson]     Get execution log entries
 *   increment-task-attempt <taskId>    Increment attempt count
 *   increment-replan-count <sessionId> Increment replan count
 *   store-context <json>               Store a context note
 *   get-context <scope> [scopeId]      Get context notes
 *   smart-context-status               Show Phase B smart-context gate status
 *   store-context-link <json>          Store/update graph link between context notes (Phase B)
 *   store-context-embedding <json>     Store/update vector metadata contract for a note (Phase B)
 *   get-context-smart <json>           Ranked lexical retrieval + linked neighbors (Phase B)
 *   export-all                         Export entire DB as JSON
 *   reset                              Delete all data (keep schema; requires reset safety flags)
 *
 * All output is JSON to stdout. Errors are JSON with { "error": "..." }.
 * Human-readable messages go to stderr.
 *
 * DB path resolution contract (e3-db-path-v1):
 *   - Resolution is deterministic for a given invocation input.
 *   - ensure-db returns both the resolved absolute path and resolution metadata.
 *   - Post-bootstrap commands require explicit --db <path>.
 *   - Orchestrators should capture ensure-db.path once, then pass --db <path>
 *     on all subsequent CLI calls to guarantee single-path targeting across cwd changes.
 *
 * Resolution precedence (in order):
 *   1. --db <path> argument
 *   2. E3_DB_PATH environment variable
 *   3. .e3-local/db-path.txt (written by extension on startup)
 *   4. .e3-local/executive3.db (workspace-local default)
 *   5. <cwd>/.e3-local/executive3.db (fallback)
 *
 * Conflict guardrail:
 *   - If non-flag signals disagree (including stale discovery-file signals),
 *     CLI fails fast with structured diagnostics unless explicit --db is provided.
 *
 * Smart-context Phase B gate:
 *   - Disabled by default.
 *   - Enable explicitly via --smart-context or E3_SMART_CONTEXT_ENABLED=1.
 *   - Rollback to Phase A by removing --smart-context and unsetting E3_SMART_CONTEXT_ENABLED.
 */

const Database = require('better-sqlite3');
const fsMod = require('fs');
const pathMod = require('path');
const DB_PATH_CONTRACT_VERSION = 'e3-db-path-v1';
const DB_PATH_CONFLICT_CODE = 'E_DB_PATH_CONFLICT';
const DB_PATH_CONFLICT_CLASSIFICATION = 'db-path-signal-conflict';
const MAX_DISCOVERY_DEPTH = 10;
const OPTIONAL_DB_COMMANDS = new Set(['ensure-db']);
const SMART_CONTEXT_GATE_ENV = 'E3_SMART_CONTEXT_ENABLED';
const SMART_CONTEXT_GATE_FLAG = '--smart-context';
const SMART_CONTEXT_PHASE_B_CONTRACT_VERSION = 'smart-context-phase-b-v1';
const SMART_CONTEXT_DISABLED_CODE = 'E_SMART_CONTEXT_DISABLED';
const SMART_CONTEXT_ALLOWED_SCOPES = new Set(['project', 'session', 'task']);
const RESET_CONFIRM_FLAG = '--confirm-reset';
const RESET_ALLOW_CANONICAL_FLAG = '--allow-canonical-reset';
const RESET_CONFIRM_REQUIRED_CODE = 'E_RESET_CONFIRM_REQUIRED';
const RESET_CANONICAL_BLOCKED_CODE = 'E_CANONICAL_RESET_BLOCKED';

// ── DB Discovery ─────────────────────────────────────────────────────────────

function normalizePath(rawPath, baseDir) {
  return pathMod.resolve(baseDir, rawPath);
}

function canonicalPath(inputPath) {
	const normalized = pathMod.normalize(inputPath);
	return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function describeSignal(signal) {
	if (!signal) return null;
	return {
		source: signal.source,
		path: signal.path ?? null,
		targetExists: signal.targetExists ?? null,
		discoveryFile: signal.discoveryFile ?? null,
		discoveryRoot: signal.discoveryRoot ?? null,
		rawValue: signal.rawValue ?? null,
		notes: signal.notes ?? null,
	};
}

function createDbConflictError(cwd, reasonKeys, signals) {
	const observedSignals = signals
		.map(describeSignal)
		.filter(Boolean);

	const remediation = [
		'Pass --db <path> explicitly to make the target DB authoritative for this invocation.',
		'Align E3_DB_PATH and .e3-local/db-path.txt so they resolve to the same absolute DB path.',
		'Remove or rewrite stale .e3-local/db-path.txt, then rerun ensure-db and reuse returned path.',
	];

	return {
		error: 'Conflicting DB path signals detected; refusing implicit resolution.',
		code: DB_PATH_CONFLICT_CODE,
		classification: DB_PATH_CONFLICT_CLASSIFICATION,
		contractVersion: DB_PATH_CONTRACT_VERSION,
		cwd,
		reasons: reasonKeys,
		observedSignals,
		remediation,
	};
}

function collectDbSignals(cwd) {
	const signals = {
		envSignal: null,
		discoverySignal: null,
		workspaceSignal: null,
	};

	if (process.env.E3_DB_PATH) {
		const envPath = normalizePath(process.env.E3_DB_PATH, cwd);
		signals.envSignal = {
			source: 'env',
			path: envPath,
			targetExists: fsMod.existsSync(envPath),
		};
	}

	let dir = cwd;
	for (let i = 0; i < MAX_DISCOVERY_DEPTH; i++) {
		const dbPathFile = pathMod.join(dir, '.e3-local', 'db-path.txt');
		if (!signals.discoverySignal && fsMod.existsSync(dbPathFile)) {
			const rawValue = fsMod.readFileSync(dbPathFile, 'utf-8').trim();
			if (!rawValue) {
				signals.discoverySignal = {
					source: 'discovery-file',
					path: null,
					targetExists: null,
					discoveryFile: dbPathFile,
					rawValue,
					notes: 'empty-value',
				};
			} else {
				const normalized = normalizePath(rawValue, pathMod.dirname(dbPathFile));
				signals.discoverySignal = {
					source: 'discovery-file',
					path: normalized,
					targetExists: fsMod.existsSync(normalized),
					discoveryFile: dbPathFile,
					rawValue,
				};
			}
		}

		const directDb = pathMod.join(dir, '.e3-local', 'executive3.db');
		const localDir = pathMod.join(dir, '.e3-local');

		if (fsMod.existsSync(directDb)) {
			signals.workspaceSignal = {
				source: 'workspace-default',
				path: directDb,
				targetExists: true,
				discoveryRoot: dir,
			};
			break;
		}

		if (fsMod.existsSync(localDir)) {
			signals.workspaceSignal = {
				source: 'workspace-default',
				path: directDb,
				targetExists: false,
				discoveryRoot: dir,
			};
			break;
		}

		const parent = pathMod.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}

	return signals;
}

function detectDbSignalConflict(cwd, signals) {
	const reasonKeys = [];
	const comparableSignals = [signals.envSignal, signals.discoverySignal, signals.workspaceSignal]
		.filter(signal => signal && signal.path);

	const uniquePaths = new Map();
	for (const signal of comparableSignals) {
		const key = canonicalPath(signal.path);
		if (!uniquePaths.has(key)) {
			uniquePaths.set(key, []);
		}
		uniquePaths.get(key).push(signal.source);
	}

	if (uniquePaths.size > 1) {
		reasonKeys.push('signal-path-disagreement');
	}

	if (signals.discoverySignal?.notes === 'empty-value') {
		reasonKeys.push('discovery-file-empty');
	}

	const discovery = signals.discoverySignal;
	if (discovery?.path && discovery.targetExists === false) {
		const comparedSignals = [signals.envSignal, signals.workspaceSignal]
			.filter(signal => signal && signal.path);
		const disagreesWithOtherSignal = comparedSignals.some(
			signal => canonicalPath(signal.path) !== canonicalPath(discovery.path)
		);
		if (disagreesWithOtherSignal) {
			reasonKeys.push('stale-discovery-file');
		}
	}

	if (reasonKeys.length === 0) {
		return null;
	}

	return createDbConflictError(cwd, Array.from(new Set(reasonKeys)), [
		signals.envSignal,
		signals.discoverySignal,
		signals.workspaceSignal,
	]);
}

function findDbPath(parsedDbFlag) {
	const cwd = process.cwd();

	// 1. Explicit --db flag
	if (parsedDbFlag?.isPresent) {
		return {
			path: normalizePath(parsedDbFlag.value, cwd),
			source: 'flag',
			contractVersion: DB_PATH_CONTRACT_VERSION,
			cwd,
		};
	}

	const signals = collectDbSignals(cwd);
	const conflict = detectDbSignalConflict(cwd, signals);
	if (conflict) {
		const err = new Error(conflict.error);
		err.code = DB_PATH_CONFLICT_CODE;
		err.details = conflict;
		throw err;
	}

	// 2. Environment variable
	if (signals.envSignal?.path) {
		return {
			path: signals.envSignal.path,
			source: signals.envSignal.source,
			contractVersion: DB_PATH_CONTRACT_VERSION,
			cwd,
		};
	}

	// 3. Discovery file
	if (signals.discoverySignal?.path && signals.discoverySignal.targetExists) {
		return {
			path: signals.discoverySignal.path,
			source: signals.discoverySignal.source,
			contractVersion: DB_PATH_CONTRACT_VERSION,
			cwd,
			discoveryFile: signals.discoverySignal.discoveryFile,
		};
	}

	// 4. Workspace-local default
	if (signals.workspaceSignal?.path) {
		return {
			path: signals.workspaceSignal.path,
			source: signals.workspaceSignal.source,
			contractVersion: DB_PATH_CONTRACT_VERSION,
			cwd,
			discoveryRoot: signals.workspaceSignal.discoveryRoot,
		};
	}

	// 5. Default: create in cwd
	return {
		path: pathMod.join(cwd, '.e3-local', 'executive3.db'),
		source: 'cwd-default',
		contractVersion: DB_PATH_CONTRACT_VERSION,
		cwd,
	};
}

function dbFlagUsageError(reason) {
	return `${reason} Usage: --db <path> or --db=<path>`;
}

function parseStrictDbFlag(args) {
	let parsed = null;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];

		if (arg === '--db') {
			if (parsed) {
				throw new Error(dbFlagUsageError('Usage error: duplicate --db flag.'));
			}

			const value = args[i + 1];
			if (value === undefined) {
				throw new Error(dbFlagUsageError('Usage error: --db requires a path value.'));
			}

			const trimmed = String(value).trim();
			if (!trimmed) {
				throw new Error(dbFlagUsageError('Usage error: --db requires a non-empty path value.'));
			}

			if (trimmed.startsWith('-')) {
				throw new Error(dbFlagUsageError('Usage error: --db value cannot be another flag.'));
			}

			parsed = {
				isPresent: true,
				value: trimmed,
				startIndex: i,
				endIndex: i + 1,
			};
			i += 1;
			continue;
		}

		if (arg.startsWith('--db=')) {
			if (parsed) {
				throw new Error(dbFlagUsageError('Usage error: duplicate --db flag.'));
			}

			const value = arg.slice('--db='.length);
			const trimmed = String(value).trim();
			if (!trimmed) {
				throw new Error(dbFlagUsageError('Usage error: --db requires a non-empty path value.'));
			}

			if (trimmed.startsWith('-')) {
				throw new Error(dbFlagUsageError('Usage error: --db value cannot be another flag.'));
			}

			parsed = {
				isPresent: true,
				value: trimmed,
				startIndex: i,
				endIndex: i,
			};
		}
	}

	return parsed ?? {
		isPresent: false,
		value: null,
		startIndex: -1,
		endIndex: -1,
	};
}

function stripGlobalFlags(args, parsedDbFlag) {
	const stripped = [];
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (parsedDbFlag?.isPresent && i >= parsedDbFlag.startIndex && i <= parsedDbFlag.endIndex) {
			continue;
		}
		if (arg === SMART_CONTEXT_GATE_FLAG) {
			continue;
		}
		if (arg === RESET_CONFIRM_FLAG || arg === RESET_ALLOW_CANONICAL_FLAG) {
			continue;
		}
		stripped.push(arg);
	}
	return stripped;
}

function requiresExplicitDb(command) {
	return !OPTIONAL_DB_COMMANDS.has(command);
}

function missingDbMessage(command) {
	return [
		`Missing required --db <path> for command: ${command}`,
		'Run `node scripts/e3-cli.js ensure-db`, capture the returned `path`, then retry with `--db <path>`.',
		`Example: node scripts/e3-cli.js ${command} ... --db <captured-path>`,
	].join(' ');
}

function hasFlag(args, flag) {
	return args.includes(flag);
}

function isCanonicalLocalDbPath(dbPath) {
	const dbName = pathMod.basename(dbPath);
	const parentName = pathMod.basename(pathMod.dirname(dbPath));
	if (process.platform === 'win32') {
		return dbName.toLowerCase() === 'executive3.db'
			&& parentName.toLowerCase() === '.e3-local';
	}
	return dbName === 'executive3.db' && parentName === '.e3-local';
}

function createResetConfirmRequiredError(dbPath) {
	return {
		error: 'Reset is destructive and requires explicit confirmation.',
		code: RESET_CONFIRM_REQUIRED_CODE,
		classification: 'reset-confirmation-required',
		command: 'reset',
		dbPath,
		remediation: [
			`Re-run with ${RESET_CONFIRM_FLAG} to acknowledge destructive reset.`,
			`Example: node scripts/e3-cli.js reset --db "${dbPath}" ${RESET_CONFIRM_FLAG}`,
		],
	};
}

function createCanonicalResetBlockedError(dbPath) {
	return {
		error: 'Refusing to reset canonical local DB path without explicit override.',
		code: RESET_CANONICAL_BLOCKED_CODE,
		classification: 'canonical-reset-guard',
		command: 'reset',
		dbPath,
		canonicalPathPattern: '<repo>/.e3-local/executive3.db',
		remediation: [
			'Use a non-canonical DB path for disposable resets, or',
			`If intentional, add ${RESET_ALLOW_CANONICAL_FLAG} together with ${RESET_CONFIRM_FLAG}.`,
			`Example: node scripts/e3-cli.js reset --db "${dbPath}" ${RESET_CONFIRM_FLAG} ${RESET_ALLOW_CANONICAL_FLAG}`,
		],
	};
}

function enforceResetSafety(command, rawArgs, dbPath) {
	if (command !== 'reset') {
		return;
	}

	if (!hasFlag(rawArgs, RESET_CONFIRM_FLAG)) {
		const err = new Error('Reset requires explicit confirmation');
		err.code = RESET_CONFIRM_REQUIRED_CODE;
		err.details = createResetConfirmRequiredError(dbPath);
		throw err;
	}

	if (isCanonicalLocalDbPath(dbPath) && !hasFlag(rawArgs, RESET_ALLOW_CANONICAL_FLAG)) {
		const err = new Error('Canonical reset requires explicit override');
		err.code = RESET_CANONICAL_BLOCKED_CODE;
		err.details = createCanonicalResetBlockedError(dbPath);
		throw err;
	}
}

function hasSmartContextFlag(args) {
	return args.includes(SMART_CONTEXT_GATE_FLAG);
}

function isTruthyToggle(value) {
	if (typeof value !== 'string') return false;
	const normalized = value.trim().toLowerCase();
	return normalized === '1'
		|| normalized === 'true'
		|| normalized === 'yes'
		|| normalized === 'on'
		|| normalized === 'enabled'
		|| normalized === 'phase-b';
}

function resolveSmartContextGate(rawArgs) {
	const flagEnabled = hasSmartContextFlag(rawArgs);
	const envEnabled = isTruthyToggle(process.env[SMART_CONTEXT_GATE_ENV]);
	if (flagEnabled) {
		return {
			enabled: true,
			source: 'flag',
			phase: 'phase-b',
			envVar: SMART_CONTEXT_GATE_ENV,
			flag: SMART_CONTEXT_GATE_FLAG,
			contractVersion: SMART_CONTEXT_PHASE_B_CONTRACT_VERSION,
		};
	}
	if (envEnabled) {
		return {
			enabled: true,
			source: 'env',
			phase: 'phase-b',
			envVar: SMART_CONTEXT_GATE_ENV,
			flag: SMART_CONTEXT_GATE_FLAG,
			contractVersion: SMART_CONTEXT_PHASE_B_CONTRACT_VERSION,
		};
	}
	return {
		enabled: false,
		source: 'default-off',
		phase: 'phase-a',
		envVar: SMART_CONTEXT_GATE_ENV,
		flag: SMART_CONTEXT_GATE_FLAG,
		contractVersion: SMART_CONTEXT_PHASE_B_CONTRACT_VERSION,
	};
}

function smartContextDisabledError(command, gate) {
	return {
		error: `Smart-context Phase B is disabled for command: ${command}`,
		code: SMART_CONTEXT_DISABLED_CODE,
		classification: 'feature-gate-disabled',
		phase: 'phase-a',
		command,
		featureGate: {
			enabled: gate.enabled,
			source: gate.source,
			envVar: gate.envVar,
			flag: gate.flag,
		},
		remediation: [
			`Enable per-call: add ${SMART_CONTEXT_GATE_FLAG} to this command.`,
			`Enable process-wide: set ${SMART_CONTEXT_GATE_ENV}=1 before invoking the CLI.`,
			`Rollback to Phase A: unset ${SMART_CONTEXT_GATE_ENV} and omit ${SMART_CONTEXT_GATE_FLAG}.`,
		],
	};
}

function ensureSmartContextEnabled(command, gate) {
	if (!gate?.enabled) {
		const err = new Error(`Smart-context disabled for ${command}`);
		err.code = SMART_CONTEXT_DISABLED_CODE;
		err.details = smartContextDisabledError(command, gate ?? resolveSmartContextGate([]));
		throw err;
	}
}

function ensureSmartContextScope(scope) {
	if (!SMART_CONTEXT_ALLOWED_SCOPES.has(scope)) {
		errorOut(`Invalid scope for smart-context: ${scope}. Expected one of project|session|task.`);
	}
}

function parseBoundedInt(value, fallback, min, max) {
	if (value === undefined || value === null || value === '') return fallback;
	const parsed = Number.parseInt(String(value), 10);
	if (!Number.isFinite(parsed) || Number.isNaN(parsed)) return fallback;
	return Math.max(min, Math.min(max, parsed));
}

function computeLexicalScore(row, query) {
	if (!query) return 0;
	const key = String(row.key ?? '').toLowerCase();
	const value = String(row.value ?? '').toLowerCase();
	const citations = String(row.citations ?? '').toLowerCase();
	let score = 0;

	if (key === query) score += 8;
	if (key.startsWith(query)) score += 5;
	if (key.includes(query)) score += 3;
	if (value.includes(query)) score += 2;
	if (citations.includes(query)) score += 1;

	const tokens = query.split(/\s+/).filter(Boolean);
	for (const token of tokens) {
		if (token.length < 2) continue;
		if (key.includes(token)) score += 1;
		if (value.includes(token)) score += 1;
	}

	return score;
}

function ensureSmartContextSchema(db) {
	db.exec(`
		CREATE TABLE IF NOT EXISTS schema_version (
			version     INTEGER PRIMARY KEY,
			applied_at  TEXT    NOT NULL DEFAULT (datetime('now'))
		);

		CREATE TABLE IF NOT EXISTS context_links (
			id              INTEGER PRIMARY KEY AUTOINCREMENT,
			source_note_id  INTEGER NOT NULL REFERENCES context_notes(id) ON DELETE CASCADE,
			target_note_id  INTEGER NOT NULL REFERENCES context_notes(id) ON DELETE CASCADE,
			link_type       TEXT    NOT NULL DEFAULT 'related',
			weight          REAL    NOT NULL DEFAULT 1.0,
			metadata        TEXT,
			created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
			UNIQUE(source_note_id, target_note_id, link_type)
		);

		CREATE TABLE IF NOT EXISTS context_embeddings (
			id                INTEGER PRIMARY KEY AUTOINCREMENT,
			note_id           INTEGER NOT NULL REFERENCES context_notes(id) ON DELETE CASCADE,
			provider          TEXT    NOT NULL,
			model             TEXT    NOT NULL,
			dimensions        INTEGER,
			embedding_ref     TEXT,
			embedding_preview TEXT,
			metadata          TEXT,
			created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
			updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
			UNIQUE(note_id, provider, model)
		);

		CREATE INDEX IF NOT EXISTS idx_context_links_source ON context_links(source_note_id);
		CREATE INDEX IF NOT EXISTS idx_context_links_target ON context_links(target_note_id);
		CREATE INDEX IF NOT EXISTS idx_context_embeddings_note ON context_embeddings(note_id);

		INSERT OR IGNORE INTO schema_version (version) VALUES (2);
	`);
}

function openDb(dbPath) {
	const dbDir = pathMod.dirname(dbPath);
	fsMod.mkdirSync(dbDir, { recursive: true });

	const db = new Database(dbPath);
	db.pragma('journal_mode = WAL');
	db.pragma('foreign_keys = ON');

	// Apply schema if tables don't exist
	const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
	const tableNames = tables.map(t => t.name);

	if (!tableNames.includes('plans')) {
		const schemaPath = pathMod.join(__dirname, '..', 'src', 'e3-schema.sql');
		if (fsMod.existsSync(schemaPath)) {
			const schema = fsMod.readFileSync(schemaPath, 'utf-8');
			const cleaned = schema
				.split('\n')
				.filter(line => !line.trim().startsWith('PRAGMA'))
				.join('\n');
			db.exec(cleaned);
			process.stderr.write('[E3 CLI] Schema applied\n');
		} else {
			throw new Error(`Schema file not found: ${schemaPath}`);
		}
	}

	ensureSmartContextSchema(db);

	return db;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function jsonOut(data) {
	console.log(JSON.stringify(data, null, 2));
}

function errorOut(msg) {
	if (typeof msg === 'string') {
		console.log(JSON.stringify({ error: msg }));
	} else {
		console.log(JSON.stringify(msg, null, 2));
	}
	process.exit(1);
}

function parseJsonArg(arg, name) {
	if (!arg) {
		errorOut(`Missing required argument: ${name}`);
	}
	try {
		return JSON.parse(arg);
	} catch {
		errorOut(`Invalid JSON for ${name}: ${arg}`);
	}
}

// ── Commands ─────────────────────────────────────────────────────────────────

const commands = {
	'ensure-db': (db, args, dbPath, resolution) => {
		const version = db.prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1').get();
		jsonOut({
			status: 'ready',
			path: dbPath,
			schemaVersion: version?.version ?? 0,
			resolution: {
				contractVersion: resolution.contractVersion,
				source: resolution.source,
				cwd: resolution.cwd,
				discoveryRoot: resolution.discoveryRoot ?? null,
				discoveryFile: resolution.discoveryFile ?? null,
				reuseHint: 'Capture path once and pass --db <path> on all subsequent E3 CLI commands.',
			},
		});
	},

	'get-session': (db, args) => {
		const sessionId = args[0];
		if (sessionId) {
			const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
			jsonOut(session ?? null);
		} else {
			const session = db.prepare("SELECT * FROM sessions WHERE status = 'active' ORDER BY started_at DESC LIMIT 1").get();
			jsonOut(session ?? null);
		}
	},

	'create-session': (db, args) => {
		const session = parseJsonArg(args[0], 'session');
		db.prepare(
			`INSERT INTO sessions (id, plan_id, request_summary, context_snapshot)
			 VALUES (@id, @plan_id, @request_summary, @context_snapshot)`
		).run({
			id: session.id,
			plan_id: session.plan_id ?? null,
			request_summary: session.request_summary ?? null,
			context_snapshot: session.context_snapshot ?? null,
		});
		const created = db.prepare('SELECT * FROM sessions WHERE id = ?').get(session.id);
		jsonOut(created);
	},

	'update-session-status': (db, args) => {
		const [id, status] = args;
		if (!id || !status) errorOut('Usage: update-session-status <id> <status>');
		const ended = (status === 'completed' || status === 'abandoned') ? "datetime('now')" : 'NULL';
		db.prepare(
			`UPDATE sessions SET status = @status, ended_at = ${ended} WHERE id = @id`
		).run({ id, status });
		jsonOut({ success: true });
	},

	'create-plan': (db, args) => {
		const plan = parseJsonArg(args[0], 'plan');
		db.prepare(
			`INSERT INTO plans (id, title, summary) VALUES (@id, @title, @summary)`
		).run({ id: plan.id, title: plan.title, summary: plan.summary ?? null });
		const created = db.prepare('SELECT * FROM plans WHERE id = ?').get(plan.id);
		jsonOut(created);
	},

	'get-tasks': (db, args) => {
		const filter = args[0] ? parseJsonArg(args[0], 'filter') : {};
		const conditions = [];
		const params = {};

		if (filter.status) { conditions.push('status = @status'); params.status = filter.status; }
		if (filter.group_id) { conditions.push('group_id = @group_id'); params.group_id = filter.group_id; }
		if (filter.plan_id) { conditions.push('plan_id = @plan_id'); params.plan_id = filter.plan_id; }
		if (filter.session_id) { conditions.push('session_id = @session_id'); params.session_id = filter.session_id; }

		const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
		const tasks = db.prepare(`SELECT * FROM tasks ${where} ORDER BY group_order ASC, priority DESC, created_at ASC`).all(params);
		jsonOut(tasks);
	},

	'create-task': (db, args) => {
		const task = parseJsonArg(args[0], 'task');
		db.prepare(
			`INSERT INTO tasks (id, plan_id, session_id, title, description, acceptance_criteria,
			                    status, group_id, group_title, group_order, priority, depends_on, skills)
			 VALUES (@id, @plan_id, @session_id, @title, @description, @acceptance_criteria,
			         @status, @group_id, @group_title, @group_order, @priority, @depends_on, @skills)`
		).run({
			id: task.id,
			plan_id: task.plan_id ?? null,
			session_id: task.session_id ?? null,
			title: task.title,
			description: task.description ?? null,
			acceptance_criteria: task.acceptance_criteria ?? null,
			status: task.status ?? 'not-started',
			group_id: task.group_id ?? null,
			group_title: task.group_title ?? null,
			group_order: task.group_order ?? null,
			priority: task.priority ?? 0,
			depends_on: task.depends_on ?? '[]',
			skills: task.skills ?? '[]',
		});
		const created = db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id);
		jsonOut(created);
	},

	'update-task': (db, args) => {
		const [id, status, errorSummary] = args;
		if (!id || !status) errorOut('Usage: update-task <id> <status> [errorSummary]');
		const completedAt = status === 'done' ? "datetime('now')" : 'NULL';
		db.prepare(
			`UPDATE tasks
			 SET status = @status,
			     error_summary = @error_summary,
			     updated_at = datetime('now'),
			     completed_at = ${completedAt}
			 WHERE id = @id`
		).run({ id, status, error_summary: errorSummary ?? null });
		jsonOut({ success: true });
	},

	'get-next-task': (db, args) => {
		const sessionId = args[0];

		// Get all done task IDs
		const doneTasks = new Set(
			db.prepare("SELECT id FROM tasks WHERE status = 'done'").all().map(r => r.id)
		);

		// Get candidates
		const conditions = ["status = 'not-started'"];
		const params = {};
		if (sessionId) {
			conditions.push('session_id = @session_id');
			params.session_id = sessionId;
		}
		const candidates = db.prepare(
			`SELECT * FROM tasks WHERE ${conditions.join(' AND ')} ORDER BY group_order ASC, priority DESC, created_at ASC`
		).all(params);

		for (const task of candidates) {
			const deps = JSON.parse(task.depends_on || '[]');
			if (deps.every(dep => doneTasks.has(dep))) {
				jsonOut({ task, reason: 'Next actionable task (dependencies satisfied)' });
				return;
			}
		}

		// Check for in-progress
		const inProgress = db.prepare("SELECT * FROM tasks WHERE status = 'in-progress' LIMIT 1").get();
		if (inProgress) {
			jsonOut({ task: inProgress, reason: 'Resuming in-progress task' });
			return;
		}

		const blocked = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status = 'blocked'").get().c;
		const failed = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status = 'failed'").get().c;

		if (blocked > 0 || failed > 0) {
			jsonOut({ task: null, reason: `No actionable tasks. ${blocked} blocked, ${failed} failed.` });
		} else {
			jsonOut({ task: null, reason: 'All tasks completed.' });
		}
	},

	'get-task-summary': (db, args) => {
		const [sessionId, planId] = args;
		const conditions = [];
		const params = {};
		if (sessionId) { conditions.push('session_id = @session_id'); params.session_id = sessionId; }
		if (planId) { conditions.push('plan_id = @plan_id'); params.plan_id = planId; }
		const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
		const tasks = db.prepare(`SELECT * FROM tasks ${where}`).all(params);

		const summary = {
			total: tasks.length,
			done: tasks.filter(t => t.status === 'done').length,
			inProgress: tasks.filter(t => t.status === 'in-progress').length,
			notStarted: tasks.filter(t => t.status === 'not-started').length,
			blocked: tasks.filter(t => t.status === 'blocked').length,
			failed: tasks.filter(t => t.status === 'failed').length,
			groups: [],
		};

		const groupMap = new Map();
		for (const task of tasks) {
			const gid = task.group_id ?? 'ungrouped';
			const existing = groupMap.get(gid) ?? { group_title: task.group_title ?? gid, total: 0, done: 0 };
			existing.total++;
			if (task.status === 'done') existing.done++;
			groupMap.set(gid, existing);
		}
		for (const [group_id, data] of groupMap) {
			summary.groups.push({ group_id, ...data });
		}
		jsonOut(summary);
	},

	'log-execution': (db, args) => {
		const entry = parseJsonArg(args[0], 'entry');
		db.prepare(
			`INSERT INTO execution_log (session_id, task_id, agent_name, action, detail)
			 VALUES (@session_id, @task_id, @agent_name, @action, @detail)`
		).run({
			session_id: entry.session_id,
			task_id: entry.task_id ?? null,
			agent_name: entry.agent_name,
			action: entry.action,
			detail: entry.detail ?? null,
		});
		jsonOut({ success: true });
	},

	'get-execution-log': (db, args) => {
		const filter = args[0] ? parseJsonArg(args[0], 'filter') : {};
		const conditions = [];
		const params = {};
		if (filter.session_id) { conditions.push('session_id = @session_id'); params.session_id = filter.session_id; }
		if (filter.task_id) { conditions.push('task_id = @task_id'); params.task_id = filter.task_id; }
		const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
		const limit = filter.limit ? `LIMIT ${filter.limit}` : '';
		const rows = db.prepare(`SELECT * FROM execution_log ${where} ORDER BY timestamp DESC ${limit}`).all(params);
		jsonOut(rows);
	},

	'increment-task-attempt': (db, args) => {
		const taskId = args[0];
		if (!taskId) errorOut('Usage: increment-task-attempt <taskId>');
		db.prepare("UPDATE tasks SET attempt_count = attempt_count + 1, updated_at = datetime('now') WHERE id = ?").run(taskId);
		const task = db.prepare('SELECT attempt_count FROM tasks WHERE id = ?').get(taskId);
		jsonOut({ attempt_count: task?.attempt_count ?? 0 });
	},

	'increment-replan-count': (db, args) => {
		const sessionId = args[0];
		if (!sessionId) errorOut('Usage: increment-replan-count <sessionId>');
		db.prepare('UPDATE sessions SET replan_count = replan_count + 1 WHERE id = ?').run(sessionId);
		const session = db.prepare('SELECT replan_count FROM sessions WHERE id = ?').get(sessionId);
		jsonOut({ replan_count: session?.replan_count ?? 0 });
	},

	'store-context': (db, args) => {
		const note = parseJsonArg(args[0], 'note');
		db.prepare(
			`INSERT INTO context_notes (scope, scope_id, key, value, citations, expires_at)
			 VALUES (@scope, @scope_id, @key, @value, @citations, @expires_at)
			 ON CONFLICT DO NOTHING`
		).run({
			scope: note.scope,
			scope_id: note.scope_id ?? null,
			key: note.key,
			value: note.value,
			citations: note.citations ?? null,
			expires_at: note.expires_at ?? null,
		});
		jsonOut({ success: true });
	},

	'get-context': (db, args) => {
		const [scope, scopeId] = args;
		if (!scope) errorOut('Usage: get-context <scope> [scopeId]');
		const rows = scopeId
			? db.prepare('SELECT * FROM context_notes WHERE scope = ? AND scope_id = ? ORDER BY created_at DESC').all(scope, scopeId)
			: db.prepare('SELECT * FROM context_notes WHERE scope = ? AND scope_id IS NULL ORDER BY created_at DESC').all(scope);
		jsonOut(rows);
	},

	'smart-context-status': (db, args, dbPath, resolution, smartContextGate) => {
		jsonOut({
			phase: smartContextGate.phase,
			enabled: smartContextGate.enabled,
			source: smartContextGate.source,
			featureGate: {
				envVar: smartContextGate.envVar,
				flag: smartContextGate.flag,
				description: 'Phase B smart-context is opt-in and disabled by default.',
			},
			rollback: `Unset ${smartContextGate.envVar} and omit ${smartContextGate.flag} to revert to Phase A behavior.`,
			contractVersion: SMART_CONTEXT_PHASE_B_CONTRACT_VERSION,
		});
	},

	'store-context-link': (db, args, dbPath, resolution, smartContextGate) => {
		ensureSmartContextEnabled('store-context-link', smartContextGate);
		const input = parseJsonArg(args[0], 'link');
		const sourceNoteId = Number.parseInt(String(input.source_note_id), 10);
		const targetNoteId = Number.parseInt(String(input.target_note_id), 10);
		if (!Number.isInteger(sourceNoteId) || !Number.isInteger(targetNoteId)) {
			errorOut('Usage: store-context-link <json> where source_note_id and target_note_id are integers');
		}
		if (sourceNoteId === targetNoteId) {
			errorOut('store-context-link requires distinct source_note_id and target_note_id');
		}

		const sourceExists = db.prepare('SELECT 1 FROM context_notes WHERE id = ?').get(sourceNoteId);
		const targetExists = db.prepare('SELECT 1 FROM context_notes WHERE id = ?').get(targetNoteId);
		if (!sourceExists || !targetExists) {
			errorOut('store-context-link requires existing context_notes IDs for source_note_id and target_note_id');
		}

		const linkType = input.link_type ? String(input.link_type) : 'related';
		const weight = Number.isFinite(Number(input.weight)) ? Number(input.weight) : 1.0;
		const metadata = input.metadata == null ? null : JSON.stringify(input.metadata);
		const bidirectional = Boolean(input.bidirectional);

		const upsertLink = db.prepare(
			`INSERT INTO context_links (source_note_id, target_note_id, link_type, weight, metadata)
			 VALUES (@source_note_id, @target_note_id, @link_type, @weight, @metadata)
			 ON CONFLICT(source_note_id, target_note_id, link_type)
			 DO UPDATE SET
			 	weight = excluded.weight,
			 	metadata = excluded.metadata,
			 	created_at = datetime('now')`
		);

		upsertLink.run({
			source_note_id: sourceNoteId,
			target_note_id: targetNoteId,
			link_type: linkType,
			weight,
			metadata,
		});

		let linksWritten = 1;
		if (bidirectional) {
			upsertLink.run({
				source_note_id: targetNoteId,
				target_note_id: sourceNoteId,
				link_type: linkType,
				weight,
				metadata,
			});
			linksWritten = 2;
		}

		jsonOut({
			success: true,
			links_written: linksWritten,
			featureGate: {
				enabled: smartContextGate.enabled,
				source: smartContextGate.source,
			},
			contractVersion: SMART_CONTEXT_PHASE_B_CONTRACT_VERSION,
		});
	},

	'store-context-embedding': (db, args, dbPath, resolution, smartContextGate) => {
		ensureSmartContextEnabled('store-context-embedding', smartContextGate);
		const input = parseJsonArg(args[0], 'embedding');
		const noteId = Number.parseInt(String(input.note_id), 10);
		if (!Number.isInteger(noteId)) {
			errorOut('Usage: store-context-embedding <json> where note_id is an integer');
		}

		const noteExists = db.prepare('SELECT 1 FROM context_notes WHERE id = ?').get(noteId);
		if (!noteExists) {
			errorOut(`store-context-embedding requires existing context note id: ${noteId}`);
		}

		const provider = String(input.provider ?? '').trim();
		const model = String(input.model ?? '').trim();
		if (!provider || !model) {
			errorOut('store-context-embedding requires provider and model');
		}

		const dimensions = input.dimensions == null ? null : parseBoundedInt(input.dimensions, null, 1, 65535);
		const embeddingRef = input.embedding_ref == null ? null : String(input.embedding_ref);
		const embeddingPreview = input.embedding_preview == null ? null : String(input.embedding_preview);
		const metadata = input.metadata == null ? null : JSON.stringify(input.metadata);

		db.prepare(
			`INSERT INTO context_embeddings (note_id, provider, model, dimensions, embedding_ref, embedding_preview, metadata)
			 VALUES (@note_id, @provider, @model, @dimensions, @embedding_ref, @embedding_preview, @metadata)
			 ON CONFLICT(note_id, provider, model)
			 DO UPDATE SET
			 	dimensions = excluded.dimensions,
			 	embedding_ref = excluded.embedding_ref,
			 	embedding_preview = excluded.embedding_preview,
			 	metadata = excluded.metadata,
			 	updated_at = datetime('now')`
		).run({
			note_id: noteId,
			provider,
			model,
			dimensions,
			embedding_ref: embeddingRef,
			embedding_preview: embeddingPreview,
			metadata,
		});

		const stored = db.prepare(
			`SELECT id, note_id, provider, model, dimensions, embedding_ref, embedding_preview, metadata, created_at, updated_at
			 FROM context_embeddings
			 WHERE note_id = ? AND provider = ? AND model = ?`
		).get(noteId, provider, model);

		jsonOut({
			success: true,
			contractVersion: SMART_CONTEXT_PHASE_B_CONTRACT_VERSION,
			vectorContract: {
				description: 'Vector-ready metadata contract. Store external embedding reference and metadata per context note.',
				table: 'context_embeddings',
				key: ['note_id', 'provider', 'model'],
				fields: ['dimensions', 'embedding_ref', 'embedding_preview', 'metadata', 'updated_at'],
			},
			embedding: stored,
		});
	},

	'get-context-smart': (db, args, dbPath, resolution, smartContextGate) => {
		ensureSmartContextEnabled('get-context-smart', smartContextGate);
		const request = parseJsonArg(args[0], 'request');
		const scope = String(request.scope ?? '').trim();
		if (!scope) {
			errorOut('Usage: get-context-smart <json> where json includes scope');
		}
		ensureSmartContextScope(scope);

		const scopeId = request.scope_id ?? null;
		const query = String(request.query ?? '').trim().toLowerCase();
		const limit = parseBoundedInt(request.limit, 8, 1, 50);
		const neighborLimit = parseBoundedInt(request.neighbor_limit, 6, 0, 50);
		const includeEmbeddings = request.include_embeddings !== false;

		const candidates = scopeId == null
			? db.prepare('SELECT * FROM context_notes WHERE scope = ? AND scope_id IS NULL ORDER BY created_at DESC LIMIT 500').all(scope)
			: db.prepare('SELECT * FROM context_notes WHERE scope = ? AND scope_id = ? ORDER BY created_at DESC LIMIT 500').all(scope, scopeId);

		const ranked = candidates
			.map(row => ({
				...row,
				lexical_score: computeLexicalScore(row, query),
			}))
			.filter(row => (query ? row.lexical_score > 0 : true))
			.sort((left, right) => {
				if (right.lexical_score !== left.lexical_score) {
					return right.lexical_score - left.lexical_score;
				}
				return String(right.created_at).localeCompare(String(left.created_at));
			})
			.slice(0, limit);

		const anchorIds = ranked.map(row => row.id);
		const anchorSet = new Set(anchorIds);

		let linkedNeighbors = [];
		if (anchorIds.length > 0 && neighborLimit > 0) {
			const placeholders = anchorIds.map(() => '?').join(',');
			const linkRows = db.prepare(
				`SELECT
					cl.id AS link_id,
					cl.source_note_id,
					cl.target_note_id,
					cl.link_type,
					cl.weight,
					cl.metadata,
					cl.created_at,
					src.id AS src_id,
					src.scope AS src_scope,
					src.scope_id AS src_scope_id,
					src.key AS src_key,
					src.value AS src_value,
					src.citations AS src_citations,
					src.created_at AS src_created_at,
					tgt.id AS tgt_id,
					tgt.scope AS tgt_scope,
					tgt.scope_id AS tgt_scope_id,
					tgt.key AS tgt_key,
					tgt.value AS tgt_value,
					tgt.citations AS tgt_citations,
					tgt.created_at AS tgt_created_at
				 FROM context_links cl
				 JOIN context_notes src ON src.id = cl.source_note_id
				 JOIN context_notes tgt ON tgt.id = cl.target_note_id
				 WHERE cl.source_note_id IN (${placeholders}) OR cl.target_note_id IN (${placeholders})
				 ORDER BY cl.weight DESC, cl.created_at DESC
				 LIMIT ?`
			).all(...anchorIds, ...anchorIds, neighborLimit * 4);

			const seenNeighborIds = new Set();
			for (const row of linkRows) {
				const sourceIsAnchor = anchorSet.has(row.source_note_id);
				const targetIsAnchor = anchorSet.has(row.target_note_id);
				if (!sourceIsAnchor && !targetIsAnchor) {
					continue;
				}

				const neighbor = sourceIsAnchor
					? {
						id: row.tgt_id,
						scope: row.tgt_scope,
						scope_id: row.tgt_scope_id,
						key: row.tgt_key,
						value: row.tgt_value,
						citations: row.tgt_citations,
						created_at: row.tgt_created_at,
					}
					: {
						id: row.src_id,
						scope: row.src_scope,
						scope_id: row.src_scope_id,
						key: row.src_key,
						value: row.src_value,
						citations: row.src_citations,
						created_at: row.src_created_at,
					};

				if (anchorSet.has(neighbor.id) || seenNeighborIds.has(neighbor.id)) {
					continue;
				}

				seenNeighborIds.add(neighbor.id);
				linkedNeighbors.push({
					...neighbor,
					via: {
						link_id: row.link_id,
						link_type: row.link_type,
						weight: row.weight,
						metadata: row.metadata,
						source_note_id: row.source_note_id,
						target_note_id: row.target_note_id,
						created_at: row.created_at,
					},
				});

				if (linkedNeighbors.length >= neighborLimit) {
					break;
				}
			}
		}

		let embeddings = [];
		if (includeEmbeddings && anchorIds.length > 0) {
			const placeholders = anchorIds.map(() => '?').join(',');
			embeddings = db.prepare(
				`SELECT id, note_id, provider, model, dimensions, embedding_ref, embedding_preview, metadata, created_at, updated_at
				 FROM context_embeddings
				 WHERE note_id IN (${placeholders})
				 ORDER BY updated_at DESC`
			).all(...anchorIds);
		}

		jsonOut({
			phase: 'phase-b',
			featureGate: {
				enabled: smartContextGate.enabled,
				source: smartContextGate.source,
				envVar: smartContextGate.envVar,
				flag: smartContextGate.flag,
			},
			request: {
				scope,
				scope_id: scopeId,
				query,
				limit,
				neighbor_limit: neighborLimit,
				include_embeddings: includeEmbeddings,
			},
			ranked,
			linked_neighbors: linkedNeighbors,
			embeddings,
			vectorContract: {
				version: SMART_CONTEXT_PHASE_B_CONTRACT_VERSION,
				table: 'context_embeddings',
				usage: 'Store vector metadata and external embedding references keyed by note_id/provider/model.',
				fields: ['note_id', 'provider', 'model', 'dimensions', 'embedding_ref', 'embedding_preview', 'metadata', 'updated_at'],
			},
		});
	},

	'export-all': (db) => {
		jsonOut({
			plans: db.prepare('SELECT * FROM plans').all(),
			sessions: db.prepare('SELECT * FROM sessions').all(),
			tasks: db.prepare('SELECT * FROM tasks ORDER BY group_order ASC, priority DESC').all(),
			execution_log: db.prepare('SELECT * FROM execution_log ORDER BY timestamp DESC LIMIT 200').all(),
			context_notes: db.prepare('SELECT * FROM context_notes ORDER BY created_at DESC').all(),
			context_links: db.prepare('SELECT * FROM context_links ORDER BY created_at DESC').all(),
			context_embeddings: db.prepare('SELECT * FROM context_embeddings ORDER BY updated_at DESC').all(),
			schema_version: db.prepare('SELECT * FROM schema_version').all(),
		});
	},

	'reset': (db) => {
		db.exec(`
			DELETE FROM execution_log;
			DELETE FROM context_embeddings;
			DELETE FROM context_links;
			DELETE FROM context_notes;
			DELETE FROM tasks;
			DELETE FROM sessions;
			DELETE FROM plans;
		`);
		jsonOut({ success: true });
	},
};

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
	const rawArgs = process.argv.slice(2);
	let parsedDbFlag;
	try {
		parsedDbFlag = parseStrictDbFlag(rawArgs);
	} catch (err) {
		errorOut(err.message);
	}

	const args = stripGlobalFlags(rawArgs, parsedDbFlag);
	const smartContextGate = resolveSmartContextGate(rawArgs);

	const command = args.shift();
	if (!command || command === '--help' || command === '-h') {
		process.stderr.write(`E3 CLI — Executive3 database access for agents

Usage: node e3-cli.js <command> [args...]

Commands:
  ensure-db                           Check/create DB, print status
  get-session [sessionId]             Get active or specific session
  create-session <json>               Create session
  update-session-status <id> <status> Update session status
  create-plan <json>                  Create plan
  get-tasks [filterJson]              List tasks with optional filter
  create-task <json>                  Create task
  update-task <id> <status> [error]   Update task status
  get-next-task [sessionId]           Get next actionable task
  get-task-summary [sessionId] [planId] Get progress summary
  log-execution <json>                Add execution log entry
  get-execution-log [filterJson]      Get execution log
  increment-task-attempt <taskId>     Increment attempt count
  increment-replan-count <sessionId>  Increment replan count
  store-context <json>                Store context note
  get-context <scope> [scopeId]       Get context notes
	smart-context-status                Show smart-context Phase B gate status
	store-context-link <json>           Store/update graph link between context notes (Phase B)
	store-context-embedding <json>      Store/update vector metadata contract for note (Phase B)
	get-context-smart <json>            Ranked lexical retrieval + linked neighbors (Phase B)
  export-all                          Export all DB data
	reset                               Delete all data (requires --confirm-reset)

Options:
	--db <path> | --db=<path>   Required for all commands except ensure-db
	--smart-context   Opt in to Phase B smart-context commands for this invocation (default off)
	                 Alternative: set E3_SMART_CONTEXT_ENABLED=1
	--confirm-reset   Required for reset; acknowledges destructive data deletion
	--allow-canonical-reset Required with reset when --db points to <repo>/.e3-local/executive3.db

Output: JSON to stdout. Errors: JSON with { "error": "..." }
`);
		process.exit(0);
	}

	const handler = commands[command];
	if (!handler) {
		errorOut(`Unknown command: ${command}. Run with --help for usage.`);
	}

	if (requiresExplicitDb(command) && !parsedDbFlag.isPresent) {
		errorOut(missingDbMessage(command));
	}

	let dbResolution;
	try {
		dbResolution = findDbPath(parsedDbFlag);
	} catch (err) {
		if (err.code === DB_PATH_CONFLICT_CODE && err.details) {
			errorOut(err.details);
		}
		errorOut(`Failed to resolve DB path: ${err.message}`);
	}

	const dbPath = dbResolution.path;
	try {
		enforceResetSafety(command, rawArgs, dbPath);
	} catch (err) {
		if (err.details) {
			errorOut(err.details);
		}
		errorOut(`Command failed: ${err.message}`);
	}

	process.stderr.write(`[E3 CLI] DB (${dbResolution.source}): ${dbPath}\n`);

	let db;
	try {
		db = openDb(dbPath);
	} catch (err) {
		errorOut(`Failed to open DB: ${err.message}`);
	}

	try {
		handler(db, args, dbPath, dbResolution, smartContextGate);
	} catch (err) {
		if (err.code === SMART_CONTEXT_DISABLED_CODE && err.details) {
			errorOut(err.details);
		}
		errorOut(`Command failed: ${err.message}`);
	} finally {
		db.close();
	}
}

main();
