/**
 * Executive3 SQLite Database Service
 *
 * Manages a per-workspace SQLite database for Executive3 orchestrator state:
 * plans, tasks, sessions, execution logs, and context notes.
 *
 * The database lives in VS Code's workspace storage directory —
 * it is never committed to git.
 *
 * All public methods are synchronous (better-sqlite3) and safe to call
 * from VS Code command handlers.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import Database from 'better-sqlite3';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface E3Plan {
	id: string;
	title: string;
	summary?: string;
	status: 'active' | 'superseded' | 'archived';
	created_at: string;
	updated_at: string;
}

export interface E3Session {
	id: string;
	plan_id?: string;
	status: 'active' | 'completed' | 'abandoned';
	request_summary?: string;
	context_snapshot?: string; // JSON
	started_at: string;
	ended_at?: string;
	replan_count: number;
}

export interface E3Task {
	id: string;
	plan_id?: string;
	session_id?: string;
	title: string;
	description?: string;
	acceptance_criteria?: string;
	status: 'not-started' | 'in-progress' | 'done' | 'blocked' | 'failed';
	group_id?: string;
	group_title?: string;
	group_order?: number;
	priority: number;
	depends_on: string; // JSON array
	skills: string; // JSON array
	attempt_count: number;
	error_summary?: string;
	created_at: string;
	updated_at: string;
	completed_at?: string;
}

export interface E3ExecutionLog {
	id?: number;
	session_id: string;
	task_id?: string;
	agent_name: string;
	action: string;
	detail?: string; // JSON
	timestamp?: string;
}

export interface E3ContextNote {
	id?: number;
	scope: 'project' | 'session' | 'task';
	scope_id?: string;
	key: string;
	value: string;
	citations?: string; // JSON
	created_at?: string;
	expires_at?: string;
}

export interface E3NextTask {
	task: E3Task | null;
	reason: string;
}

export interface E3TaskFilter {
	status?: string;
	group_id?: string;
	plan_id?: string;
	session_id?: string;
}

// ─── Database Service ────────────────────────────────────────────────────────

export class E3Database implements vscode.Disposable {
	private db: Database.Database | undefined;
	private dbPath: string | undefined;
	private readonly output: vscode.OutputChannel;

	constructor(output: vscode.OutputChannel) {
		this.output = output;
	}

	// ── Lifecycle ────────────────────────────────────────────────────────

	/**
	 * Open (or create) the database at the given storage directory.
	 * Runs schema migrations idempotently.
	 * Returns the full path to the database file.
	 */
	open(storageDir: string): string {
		if (this.db) {
			return this.dbPath!;
		}

		// Ensure the storage directory exists
		fs.mkdirSync(storageDir, { recursive: true });

		this.dbPath = path.join(storageDir, 'executive3.db');
		this.output.appendLine(`[E3 DB] Opening database at ${this.dbPath}`);

		this.db = new Database(this.dbPath);
		this.db.pragma('journal_mode = WAL');
		this.db.pragma('foreign_keys = ON');

		// Run schema
		const schemaPath = path.join(__dirname, 'e3-schema.sql');
		if (fs.existsSync(schemaPath)) {
			const schema = fs.readFileSync(schemaPath, 'utf-8');
			// Strip PRAGMA lines (already set above) and execute
			const cleaned = schema
				.split('\n')
				.filter((line) => !line.trim().startsWith('PRAGMA'))
				.join('\n');
			this.db.exec(cleaned);
			this.output.appendLine('[E3 DB] Schema applied successfully');
		} else {
			this.output.appendLine(`[E3 DB] Warning: schema file not found at ${schemaPath}`);
		}

		return this.dbPath;
	}

	/** Close the database connection. */
	close(): void {
		if (this.db) {
			this.db.close();
			this.db = undefined;
			this.output.appendLine('[E3 DB] Database closed');
		}
	}

	dispose(): void {
		this.close();
	}

	/** Throw if the database is not open. */
	private ensureOpen(): Database.Database {
		if (!this.db) {
			throw new Error('E3 Database is not open. Call ensureDb first.');
		}
		return this.db;
	}

	/** Get the path to the database file (or undefined if not open). */
	getDbPath(): string | undefined {
		return this.dbPath;
	}

	/** Check if the database is open. */
	isOpen(): boolean {
		return this.db !== undefined;
	}

	// ── Plans ────────────────────────────────────────────────────────────

	createPlan(plan: Pick<E3Plan, 'id' | 'title' | 'summary'>): E3Plan {
		const db = this.ensureOpen();
		const stmt = db.prepare(
			`INSERT INTO plans (id, title, summary) VALUES (@id, @title, @summary)`
		);
		stmt.run({ id: plan.id, title: plan.title, summary: plan.summary ?? null });
		return this.getPlan(plan.id)!;
	}

	getPlan(id: string): E3Plan | undefined {
		const db = this.ensureOpen();
		return db.prepare('SELECT * FROM plans WHERE id = ?').get(id) as E3Plan | undefined;
	}

	getActivePlan(): E3Plan | undefined {
		const db = this.ensureOpen();
		return db
			.prepare("SELECT * FROM plans WHERE status = 'active' ORDER BY created_at DESC LIMIT 1")
			.get() as E3Plan | undefined;
	}

	updatePlanStatus(id: string, status: E3Plan['status']): void {
		const db = this.ensureOpen();
		db.prepare(
			`UPDATE plans SET status = @status, updated_at = datetime('now') WHERE id = @id`
		).run({ id, status });
	}

	// ── Sessions ─────────────────────────────────────────────────────────

	createSession(session: Pick<E3Session, 'id' | 'plan_id' | 'request_summary' | 'context_snapshot'>): E3Session {
		const db = this.ensureOpen();
		db.prepare(
			`INSERT INTO sessions (id, plan_id, request_summary, context_snapshot)
			 VALUES (@id, @plan_id, @request_summary, @context_snapshot)`
		).run({
			id: session.id,
			plan_id: session.plan_id ?? null,
			request_summary: session.request_summary ?? null,
			context_snapshot: session.context_snapshot ?? null,
		});
		return this.getSession(session.id)!;
	}

	getSession(id: string): E3Session | undefined {
		const db = this.ensureOpen();
		return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as E3Session | undefined;
	}

	getActiveSession(): E3Session | undefined {
		const db = this.ensureOpen();
		return db
			.prepare("SELECT * FROM sessions WHERE status = 'active' ORDER BY started_at DESC LIMIT 1")
			.get() as E3Session | undefined;
	}

	updateSessionStatus(id: string, status: E3Session['status']): void {
		const db = this.ensureOpen();
		const ended = status === 'completed' || status === 'abandoned'
			? "datetime('now')"
			: 'NULL';
		db.prepare(
			`UPDATE sessions SET status = @status, ended_at = ${ended} WHERE id = @id`
		).run({ id, status });
	}

	incrementReplanCount(sessionId: string): number {
		const db = this.ensureOpen();
		db.prepare(
			`UPDATE sessions SET replan_count = replan_count + 1 WHERE id = ?`
		).run(sessionId);
		const session = this.getSession(sessionId);
		return session?.replan_count ?? 0;
	}

	// ── Tasks ────────────────────────────────────────────────────────────

	createTask(task: Omit<E3Task, 'created_at' | 'updated_at' | 'completed_at' | 'attempt_count'>): E3Task {
		const db = this.ensureOpen();
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
		return this.getTask(task.id)!;
	}

	getTask(id: string): E3Task | undefined {
		const db = this.ensureOpen();
		return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as E3Task | undefined;
	}

	getTasks(filter?: E3TaskFilter): E3Task[] {
		const db = this.ensureOpen();
		const conditions: string[] = [];
		const params: Record<string, unknown> = {};

		if (filter?.status) {
			conditions.push('status = @status');
			params.status = filter.status;
		}
		if (filter?.group_id) {
			conditions.push('group_id = @group_id');
			params.group_id = filter.group_id;
		}
		if (filter?.plan_id) {
			conditions.push('plan_id = @plan_id');
			params.plan_id = filter.plan_id;
		}
		if (filter?.session_id) {
			conditions.push('session_id = @session_id');
			params.session_id = filter.session_id;
		}

		const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
		return db
			.prepare(`SELECT * FROM tasks ${where} ORDER BY group_order ASC, priority DESC, created_at ASC`)
			.all(params) as E3Task[];
	}

	updateTaskStatus(id: string, status: E3Task['status'], errorSummary?: string): void {
		const db = this.ensureOpen();
		const completedAt = status === 'done' ? "datetime('now')" : 'NULL';
		db.prepare(
			`UPDATE tasks
			 SET status = @status,
			     error_summary = @error_summary,
			     updated_at = datetime('now'),
			     completed_at = ${completedAt}
			 WHERE id = @id`
		).run({ id, status, error_summary: errorSummary ?? null });
	}

	incrementTaskAttempt(id: string): number {
		const db = this.ensureOpen();
		db.prepare(
			`UPDATE tasks SET attempt_count = attempt_count + 1, updated_at = datetime('now') WHERE id = ?`
		).run(id);
		const task = this.getTask(id);
		return task?.attempt_count ?? 0;
	}

	/**
	 * Returns the next actionable task: not-started, with all dependencies done.
	 * Respects group ordering and priority.
	 */
	getNextTask(sessionId?: string): E3NextTask {
		const db = this.ensureOpen();

		// Get all done task IDs for dependency checking
		const doneTasks = new Set(
			(
				db
					.prepare("SELECT id FROM tasks WHERE status = 'done'")
					.all() as Array<{ id: string }>
			).map((r) => r.id)
		);

		// Get candidate tasks
		const filter: E3TaskFilter = { status: 'not-started' };
		if (sessionId) {
			filter.session_id = sessionId;
		}
		const candidates = this.getTasks(filter);

		for (const task of candidates) {
			const deps: string[] = JSON.parse(task.depends_on || '[]');
			const allDepsDone = deps.every((dep) => doneTasks.has(dep));
			if (allDepsDone) {
				return { task, reason: 'Next actionable task (dependencies satisfied)' };
			}
		}

		// Check if there are blocked/failed tasks
		const blocked = this.getTasks({ status: 'blocked' });
		const failed = this.getTasks({ status: 'failed' });
		const inProgress = this.getTasks({ status: 'in-progress' });

		if (inProgress.length > 0) {
			return { task: inProgress[0], reason: 'Resuming in-progress task' };
		}

		if (blocked.length > 0 || failed.length > 0) {
			return {
				task: null,
				reason: `No actionable tasks. ${blocked.length} blocked, ${failed.length} failed.`,
			};
		}

		return { task: null, reason: 'All tasks completed.' };
	}

	/**
	 * Get a summary of task progress for the current session or plan.
	 */
	getTaskSummary(sessionId?: string, planId?: string): {
		total: number;
		done: number;
		inProgress: number;
		notStarted: number;
		blocked: number;
		failed: number;
		groups: Array<{ group_id: string; group_title: string; total: number; done: number }>;
	} {
		const db = this.ensureOpen();

		const conditions: string[] = [];
		const params: Record<string, unknown> = {};
		if (sessionId) {
			conditions.push('session_id = @session_id');
			params.session_id = sessionId;
		}
		if (planId) {
			conditions.push('plan_id = @plan_id');
			params.plan_id = planId;
		}
		const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

		const tasks = db.prepare(`SELECT * FROM tasks ${where}`).all(params) as E3Task[];

		const summary = {
			total: tasks.length,
			done: tasks.filter((t) => t.status === 'done').length,
			inProgress: tasks.filter((t) => t.status === 'in-progress').length,
			notStarted: tasks.filter((t) => t.status === 'not-started').length,
			blocked: tasks.filter((t) => t.status === 'blocked').length,
			failed: tasks.filter((t) => t.status === 'failed').length,
			groups: [] as Array<{ group_id: string; group_title: string; total: number; done: number }>,
		};

		// Group summary
		const groupMap = new Map<string, { group_title: string; total: number; done: number }>();
		for (const task of tasks) {
			const gid = task.group_id ?? 'ungrouped';
			const existing = groupMap.get(gid) ?? { group_title: task.group_title ?? gid, total: 0, done: 0 };
			existing.total++;
			if (task.status === 'done') { existing.done++; }
			groupMap.set(gid, existing);
		}
		for (const [group_id, data] of groupMap) {
			summary.groups.push({ group_id, ...data });
		}

		return summary;
	}

	// ── Execution Log ────────────────────────────────────────────────────

	logExecution(entry: Omit<E3ExecutionLog, 'id' | 'timestamp'>): void {
		const db = this.ensureOpen();
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
	}

	getExecutionLog(filter?: { session_id?: string; task_id?: string; limit?: number }): E3ExecutionLog[] {
		const db = this.ensureOpen();
		const conditions: string[] = [];
		const params: Record<string, unknown> = {};

		if (filter?.session_id) {
			conditions.push('session_id = @session_id');
			params.session_id = filter.session_id;
		}
		if (filter?.task_id) {
			conditions.push('task_id = @task_id');
			params.task_id = filter.task_id;
		}

		const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
		const limit = filter?.limit ? `LIMIT ${filter.limit}` : '';

		return db
			.prepare(`SELECT * FROM execution_log ${where} ORDER BY timestamp DESC ${limit}`)
			.all(params) as E3ExecutionLog[];
	}

	// ── Context Notes ────────────────────────────────────────────────────

	storeContext(note: Omit<E3ContextNote, 'id' | 'created_at'>): void {
		const db = this.ensureOpen();
		// Upsert on scope + scope_id + key
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
	}

	getContext(scope: string, scopeId?: string): E3ContextNote[] {
		const db = this.ensureOpen();
		if (scopeId) {
			return db
				.prepare('SELECT * FROM context_notes WHERE scope = ? AND scope_id = ? ORDER BY created_at DESC')
				.all(scope, scopeId) as E3ContextNote[];
		}
		return db
			.prepare('SELECT * FROM context_notes WHERE scope = ? AND scope_id IS NULL ORDER BY created_at DESC')
			.all(scope) as E3ContextNote[];
	}

	// ── Utilities ────────────────────────────────────────────────────────

	/**
	 * Export the entire database state as a JSON object (for debugging).
	 */
	exportAll(): Record<string, unknown[]> {
		const db = this.ensureOpen();
		return {
			plans: db.prepare('SELECT * FROM plans').all(),
			sessions: db.prepare('SELECT * FROM sessions').all(),
			tasks: db.prepare('SELECT * FROM tasks ORDER BY group_order ASC, priority DESC').all(),
			execution_log: db.prepare('SELECT * FROM execution_log ORDER BY timestamp DESC LIMIT 200').all(),
			context_notes: db.prepare('SELECT * FROM context_notes ORDER BY created_at DESC').all(),
			schema_version: db.prepare('SELECT * FROM schema_version').all(),
		};
	}

	/**
	 * Reset the database: drop all data (keep schema).
	 */
	reset(): void {
		const db = this.ensureOpen();
		db.exec(`
			DELETE FROM execution_log;
			DELETE FROM context_notes;
			DELETE FROM tasks;
			DELETE FROM sessions;
			DELETE FROM plans;
		`);
		this.output.appendLine('[E3 DB] Database reset (all data deleted)');
	}
}
