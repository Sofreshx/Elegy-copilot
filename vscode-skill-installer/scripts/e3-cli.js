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
 *   export-all                         Export entire DB as JSON
 *   reset                              Delete all data (keep schema)
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
 */

const Database = require('better-sqlite3');
const fsMod = require('fs');
const pathMod = require('path');
const DB_PATH_CONTRACT_VERSION = 'e3-db-path-v1';
const MAX_DISCOVERY_DEPTH = 10;
const OPTIONAL_DB_COMMANDS = new Set(['ensure-db']);

// ── DB Discovery ─────────────────────────────────────────────────────────────

function normalizePath(rawPath, baseDir) {
  return pathMod.resolve(baseDir, rawPath);
}

function findDbPath(args) {
	const cwd = process.cwd();

	// 1. Explicit --db flag
	const dbIdx = args.indexOf('--db');
	if (dbIdx !== -1 && args[dbIdx + 1]) {
		return {
			path: normalizePath(args[dbIdx + 1], cwd),
			source: 'flag',
			contractVersion: DB_PATH_CONTRACT_VERSION,
			cwd,
		};
	}

	// 2. Environment variable
	if (process.env.E3_DB_PATH) {
		return {
			path: normalizePath(process.env.E3_DB_PATH, cwd),
			source: 'env',
			contractVersion: DB_PATH_CONTRACT_VERSION,
			cwd,
		};
	}

	// 3. Walk up from cwd to find .e3-local/
	let dir = cwd;
	for (let i = 0; i < MAX_DISCOVERY_DEPTH; i++) {
		const dbPathFile = pathMod.join(dir, '.e3-local', 'db-path.txt');
		if (fsMod.existsSync(dbPathFile)) {
			const resolved = fsMod.readFileSync(dbPathFile, 'utf-8').trim();
			const normalized = normalizePath(resolved, pathMod.dirname(dbPathFile));
			if (fsMod.existsSync(normalized)) {
				return {
					path: normalized,
					source: 'discovery-file',
					contractVersion: DB_PATH_CONTRACT_VERSION,
					cwd,
					discoveryFile: dbPathFile,
				};
			}
		}

		const directDb = pathMod.join(dir, '.e3-local', 'executive3.db');
		if (fsMod.existsSync(directDb)) {
			return {
				path: directDb,
				source: 'workspace-default',
				contractVersion: DB_PATH_CONTRACT_VERSION,
				cwd,
				discoveryRoot: dir,
			};
		}

		const localDir = pathMod.join(dir, '.e3-local');
		if (fsMod.existsSync(localDir)) {
			return {
				path: directDb,
				source: 'workspace-default',
				contractVersion: DB_PATH_CONTRACT_VERSION,
				cwd,
				discoveryRoot: dir,
			};
		}

		const parent = pathMod.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}

	// 5. Default: create in cwd
	return {
		path: pathMod.join(cwd, '.e3-local', 'executive3.db'),
		source: 'cwd-default',
		contractVersion: DB_PATH_CONTRACT_VERSION,
		cwd,
	};
}

function stripDbFlag(args) {
	const stripped = [...args];
	const dbFlagIdx = stripped.indexOf('--db');
	if (dbFlagIdx !== -1) {
		if (!stripped[dbFlagIdx + 1]) {
			errorOut('Usage error: --db requires a path value');
		}
		stripped.splice(dbFlagIdx, 2);
	}
	return stripped;
}

function hasExplicitDbFlag(args) {
	const dbFlagIdx = args.indexOf('--db');
	return dbFlagIdx !== -1 && Boolean(args[dbFlagIdx + 1]);
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

	return db;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function jsonOut(data) {
	console.log(JSON.stringify(data, null, 2));
}

function errorOut(msg) {
	console.log(JSON.stringify({ error: msg }));
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

	'export-all': (db) => {
		jsonOut({
			plans: db.prepare('SELECT * FROM plans').all(),
			sessions: db.prepare('SELECT * FROM sessions').all(),
			tasks: db.prepare('SELECT * FROM tasks ORDER BY group_order ASC, priority DESC').all(),
			execution_log: db.prepare('SELECT * FROM execution_log ORDER BY timestamp DESC LIMIT 200').all(),
			context_notes: db.prepare('SELECT * FROM context_notes ORDER BY created_at DESC').all(),
			schema_version: db.prepare('SELECT * FROM schema_version').all(),
		});
	},

	'reset': (db) => {
		db.exec(`
			DELETE FROM execution_log;
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
	const args = stripDbFlag(rawArgs);

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
  export-all                          Export all DB data
  reset                               Delete all data

Options:
	--db <path>   Required for all commands except ensure-db

Output: JSON to stdout. Errors: JSON with { "error": "..." }
`);
		process.exit(0);
	}

	const handler = commands[command];
	if (!handler) {
		errorOut(`Unknown command: ${command}. Run with --help for usage.`);
	}

	if (requiresExplicitDb(command) && !hasExplicitDbFlag(rawArgs)) {
		errorOut(missingDbMessage(command));
	}

	const dbResolution = findDbPath(rawArgs);
	const dbPath = dbResolution.path;
	process.stderr.write(`[E3 CLI] DB (${dbResolution.source}): ${dbPath}\n`);

	let db;
	try {
		db = openDb(dbPath);
	} catch (err) {
		errorOut(`Failed to open DB: ${err.message}`);
	}

	try {
		handler(db, args, dbPath, dbResolution);
	} catch (err) {
		errorOut(`Command failed: ${err.message}`);
	} finally {
		db.close();
	}
}

main();
