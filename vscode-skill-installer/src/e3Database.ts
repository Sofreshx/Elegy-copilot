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

export interface E3SessionFilter {
	statuses?: Array<E3Session['status']>;
	resumableOnly?: boolean;
	limit?: number;
}

export interface E3SessionListItem extends E3Session {
	open_task_count: number;
}

export interface E3Todo {
	id: string;
	session_id: string;
	title: string;
	summary?: string;
	status: 'active' | 'completed' | 'archived';
	task_ids: string;
	created_at: string;
	updated_at: string;
}

export interface E3TaskPlan {
	id: string;
	session_id: string;
	todo_id?: string;
	parent_plan_id?: string;
	task_id?: string;
	title: string;
	summary?: string;
	level: number;
	status: 'active' | 'completed' | 'superseded' | 'archived';
	created_at: string;
	updated_at: string;
}

export interface E3DbHealth {
	quick_check: string;
	foreign_key_violations: number;
	orphan_tasks_by_session: Array<{ session_id: string; count: number }>;
	open_tasks_without_active_session: number;
	sessions_total: number;
	tasks_total: number;
}

type E3TaskCreateInput = Omit<E3Task, 'created_at' | 'updated_at' | 'completed_at' | 'attempt_count'> & {
	depends_on?: string | string[];
	skills?: string | string[];
};

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
		this.db.pragma('busy_timeout = 5000');

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

	private normalizeArrayJson(value: string | string[] | undefined): string {
		if (Array.isArray(value)) {
			return JSON.stringify(value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0));
		}
		if (!value || !value.trim()) {
			return '[]';
		}
		try {
			const parsed = JSON.parse(value);
			if (!Array.isArray(parsed)) {
				return '[]';
			}
			return JSON.stringify(parsed.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0));
		} catch {
			return '[]';
		}
	}

	private ensureSessionExists(sessionId: string): void {
		const session = this.getSession(sessionId);
		if (!session) {
			throw new Error(`Session not found: ${sessionId}`);
		}
	}

	private ensurePlanExists(planId: string): void {
		const plan = this.getPlan(planId);
		if (!plan) {
			throw new Error(`Plan not found: ${planId}`);
		}
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
		if (session.plan_id) {
			this.ensurePlanExists(session.plan_id);
		}
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

	getSessions(filter?: E3SessionFilter): E3SessionListItem[] {
		const db = this.ensureOpen();
		const conditions: string[] = [];
		const params: Record<string, unknown> = {};

		if (filter?.statuses && filter.statuses.length > 0) {
			const names = filter.statuses.map((_, index) => `@status${index}`);
			conditions.push(`s.status IN (${names.join(', ')})`);
			for (const [index, status] of filter.statuses.entries()) {
				params[`status${index}`] = status;
			}
		}

		if (filter?.resumableOnly) {
			conditions.push(`EXISTS (
				SELECT 1 FROM tasks t
				WHERE t.session_id = s.id
				  AND t.status IN ('not-started', 'in-progress', 'blocked', 'failed')
			)`);
		}

		const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
		const limitValue = filter?.limit && filter.limit > 0 ? filter.limit : 25;

		return db
			.prepare(
				`SELECT
					s.*,
					(
						SELECT COUNT(*)
						FROM tasks t
						WHERE t.session_id = s.id
						  AND t.status IN ('not-started', 'in-progress', 'blocked', 'failed')
					) AS open_task_count
				 FROM sessions s
				 ${where}
				 ORDER BY s.started_at DESC
				 LIMIT @limit`
			)
			.all({ ...params, limit: limitValue }) as E3SessionListItem[];
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

	createTask(task: E3TaskCreateInput): E3Task {
		const db = this.ensureOpen();
		if (task.session_id) {
			this.ensureSessionExists(task.session_id);
		}
		if (task.plan_id) {
			this.ensurePlanExists(task.plan_id);
		}
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
			group_id: task.group_id ?? 'ungrouped',
			group_title: task.group_title ?? 'Ungrouped',
			group_order: task.group_order ?? 9999,
			priority: task.priority ?? 0,
			depends_on: this.normalizeArrayJson(task.depends_on),
			skills: this.normalizeArrayJson(task.skills),
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
		const statusScope = sessionId ? { session_id: sessionId } : {};
		const blocked = this.getTasks({ ...statusScope, status: 'blocked' });
		const failed = this.getTasks({ ...statusScope, status: 'failed' });
		const inProgress = this.getTasks({ ...statusScope, status: 'in-progress' });

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

	createTodo(todo: {
		id: string;
		session_id: string;
		title: string;
		summary?: string;
		status?: E3Todo['status'];
		task_ids?: string[];
	}): E3Todo {
		const db = this.ensureOpen();
		this.ensureSessionExists(todo.session_id);

		const tx = db.transaction(() => {
			db.prepare(
				`INSERT INTO todos (id, session_id, title, summary, status)
				 VALUES (@id, @session_id, @title, @summary, @status)`
			).run({
				id: todo.id,
				session_id: todo.session_id,
				title: todo.title,
				summary: todo.summary ?? null,
				status: todo.status ?? 'active',
			});

			for (const [index, taskId] of (todo.task_ids ?? []).entries()) {
				if (!this.getTask(taskId)) {
					throw new Error(`Task not found for todo link: ${taskId}`);
				}
				db.prepare(
					`INSERT INTO todo_tasks (todo_id, task_id, ordering)
					 VALUES (@todo_id, @task_id, @ordering)`
				).run({ todo_id: todo.id, task_id: taskId, ordering: index });
			}
		});

		tx();
		return this.getTodo(todo.id)!;
	}

	getTodo(id: string): E3Todo | undefined {
		const db = this.ensureOpen();
		const row = db.prepare(
			`SELECT
				t.id,
				t.session_id,
				t.title,
				t.summary,
				t.status,
				COALESCE(
					(
						SELECT json_group_array(task_id)
						FROM (
							SELECT task_id
							FROM todo_tasks
							WHERE todo_id = t.id
							ORDER BY ordering ASC
						)
					),
					'[]'
				) AS task_ids,
				t.created_at,
				t.updated_at
			 FROM todos t
			 WHERE t.id = ?`
		).get(id) as E3Todo | undefined;
		return row;
	}

	getTodos(filter?: { session_id?: string; status?: E3Todo['status']; limit?: number }): E3Todo[] {
		const db = this.ensureOpen();
		const conditions: string[] = [];
		const params: Record<string, unknown> = {};

		if (filter?.session_id) {
			conditions.push('t.session_id = @session_id');
			params.session_id = filter.session_id;
		}
		if (filter?.status) {
			conditions.push('t.status = @status');
			params.status = filter.status;
		}

		const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
		const limit = filter?.limit && filter.limit > 0 ? `LIMIT ${filter.limit}` : '';

		return db.prepare(
			`SELECT
				t.id,
				t.session_id,
				t.title,
				t.summary,
				t.status,
				COALESCE(
					(
						SELECT json_group_array(task_id)
						FROM (
							SELECT task_id
							FROM todo_tasks
							WHERE todo_id = t.id
							ORDER BY ordering ASC
						)
					),
					'[]'
				) AS task_ids,
				t.created_at,
				t.updated_at
			 FROM todos t
			 ${where}
			 ORDER BY t.created_at ASC
			 ${limit}`
		).all(params) as E3Todo[];
	}

	createTaskPlan(plan: {
		id: string;
		session_id: string;
		todo_id?: string;
		parent_plan_id?: string;
		task_id?: string;
		title: string;
		summary?: string;
		level?: number;
		status?: E3TaskPlan['status'];
	}): E3TaskPlan {
		const db = this.ensureOpen();
		this.ensureSessionExists(plan.session_id);
		if (plan.todo_id && !this.getTodo(plan.todo_id)) {
			throw new Error(`Todo not found: ${plan.todo_id}`);
		}
		if (plan.parent_plan_id && !this.getTaskPlan(plan.parent_plan_id)) {
			throw new Error(`Parent task plan not found: ${plan.parent_plan_id}`);
		}
		if (plan.task_id && !this.getTask(plan.task_id)) {
			throw new Error(`Task not found for plan link: ${plan.task_id}`);
		}

		db.prepare(
			`INSERT INTO task_plans (id, session_id, todo_id, parent_plan_id, task_id, title, summary, level, status)
			 VALUES (@id, @session_id, @todo_id, @parent_plan_id, @task_id, @title, @summary, @level, @status)`
		).run({
			id: plan.id,
			session_id: plan.session_id,
			todo_id: plan.todo_id ?? null,
			parent_plan_id: plan.parent_plan_id ?? null,
			task_id: plan.task_id ?? null,
			title: plan.title,
			summary: plan.summary ?? null,
			level: plan.level ?? 0,
			status: plan.status ?? 'active',
		});
		return this.getTaskPlan(plan.id)!;
	}

	getTaskPlan(id: string): E3TaskPlan | undefined {
		const db = this.ensureOpen();
		return db.prepare('SELECT * FROM task_plans WHERE id = ?').get(id) as E3TaskPlan | undefined;
	}

	getTaskPlans(filter?: { session_id?: string; todo_id?: string; status?: E3TaskPlan['status'] }): E3TaskPlan[] {
		const db = this.ensureOpen();
		const conditions: string[] = [];
		const params: Record<string, unknown> = {};
		if (filter?.session_id) {
			conditions.push('session_id = @session_id');
			params.session_id = filter.session_id;
		}
		if (filter?.todo_id) {
			conditions.push('todo_id = @todo_id');
			params.todo_id = filter.todo_id;
		}
		if (filter?.status) {
			conditions.push('status = @status');
			params.status = filter.status;
		}
		const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
		return db
			.prepare(`SELECT * FROM task_plans ${where} ORDER BY level ASC, created_at ASC`)
			.all(params) as E3TaskPlan[];
	}

	getDbHealth(): E3DbHealth {
		const db = this.ensureOpen();
		const quickRow = db.prepare('PRAGMA quick_check').get() as Record<string, string>;
		const quickCheck = quickRow.quick_check ?? Object.values(quickRow)[0] ?? 'unknown';
		const fkViolations = db.prepare('PRAGMA foreign_key_check').all() as Array<Record<string, unknown>>;
		const orphanTasks = db.prepare(
			`SELECT t.session_id AS session_id, COUNT(*) AS count
			 FROM tasks t
			 LEFT JOIN sessions s ON s.id = t.session_id
			 WHERE t.session_id IS NOT NULL AND s.id IS NULL
			 GROUP BY t.session_id`
		).all() as Array<{ session_id: string; count: number }>;
		const openTasksWithoutActiveSession = db.prepare(
			`SELECT COUNT(*) as c
			 FROM tasks t
			 LEFT JOIN sessions s ON s.id = t.session_id
			 WHERE t.status IN ('not-started', 'in-progress', 'blocked', 'failed')
			   AND (s.id IS NULL OR s.status <> 'active')`
		).get() as { c: number };
		const sessionCount = db.prepare('SELECT COUNT(*) as c FROM sessions').get() as { c: number };
		const taskCount = db.prepare('SELECT COUNT(*) as c FROM tasks').get() as { c: number };

		return {
			quick_check: quickCheck,
			foreign_key_violations: fkViolations.length,
			orphan_tasks_by_session: orphanTasks,
			open_tasks_without_active_session: openTasksWithoutActiveSession.c,
			sessions_total: sessionCount.c,
			tasks_total: taskCount.c,
		};
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
			todos: db.prepare('SELECT * FROM todos ORDER BY created_at ASC').all(),
			todo_tasks: db.prepare('SELECT * FROM todo_tasks ORDER BY todo_id, ordering').all(),
			task_plans: db.prepare('SELECT * FROM task_plans ORDER BY level ASC, created_at ASC').all(),
			tasks: db.prepare('SELECT * FROM tasks ORDER BY group_order ASC, priority DESC').all(),
			execution_log: db.prepare('SELECT * FROM execution_log ORDER BY timestamp DESC LIMIT 200').all(),
			context_notes: db.prepare('SELECT * FROM context_notes ORDER BY created_at DESC').all(),
			context_links: db.prepare('SELECT * FROM context_links ORDER BY created_at DESC').all(),
			context_embeddings: db.prepare('SELECT * FROM context_embeddings ORDER BY updated_at DESC').all(),
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
			DELETE FROM task_plans;
			DELETE FROM todo_tasks;
			DELETE FROM todos;
			DELETE FROM context_embeddings;
			DELETE FROM context_links;
			DELETE FROM context_notes;
			DELETE FROM tasks;
			DELETE FROM sessions;
			DELETE FROM plans;
		`);
		this.output.appendLine('[E3 DB] Database reset (all data deleted)');
	}
}
