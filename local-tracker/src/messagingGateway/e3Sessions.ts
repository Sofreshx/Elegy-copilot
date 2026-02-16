import type { E3CliBridge } from './e3CliBridge';

export interface E3SessionListFilter {
	limit?: number;
	statuses?: string[];
	resumableOnly?: boolean;
}

export interface E3SessionSummaryRow {
	id: string;
	status: string;
	planId: string | null;
	requestSummary: string | null;
	startedAt: string;
	endedAt: string | null;
	replanCount: number;
	openTaskCount: number;
}

export interface E3TaskSummaryCounts {
	total: number;
	done: number;
	inProgress: number;
	notStarted: number;
	blocked: number;
	failed: number;
}

export interface E3SessionsSnapshot {
	workspaceRoot: string;
	dbPath: string;
	sessions: E3SessionSummaryRow[];
	taskSummariesBySessionId: Record<string, E3TaskSummaryCounts>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function asString(value: unknown, field: string): string {
	if (typeof value !== 'string') {
		throw new Error(`[Gateway:E3] Invalid ${field} (expected string)`);
	}
	return value;
}

function asNullableString(value: unknown, field: string): string | null {
	if (value === null) return null;
	if (value === undefined) return null;
	if (typeof value !== 'string') {
		throw new Error(`[Gateway:E3] Invalid ${field} (expected string|null)`);
	}
	return value;
}

function asNumber(value: unknown, field: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new Error(`[Gateway:E3] Invalid ${field} (expected number)`);
	}
	return value;
}

function asStringArray(value: unknown, field: string): string[] {
	if (!Array.isArray(value)) {
		throw new Error(`[Gateway:E3] Invalid ${field} (expected string[])`);
	}
	const out: string[] = [];
	for (const [index, entry] of value.entries()) {
		if (typeof entry !== 'string') {
			throw new Error(`[Gateway:E3] Invalid ${field}[${index}] (expected string)`);
		}
		out.push(entry);
	}
	return out;
}

function parseSessionRow(row: unknown): E3SessionSummaryRow {
	if (!isRecord(row)) {
		throw new Error('[Gateway:E3] Invalid session row (expected object)');
	}
	return {
		id: asString(row.id, 'session.id'),
		status: asString(row.status, 'session.status'),
		planId: asNullableString(row.plan_id, 'session.plan_id'),
		requestSummary: asNullableString(row.request_summary, 'session.request_summary'),
		startedAt: asString(row.started_at, 'session.started_at'),
		endedAt: asNullableString(row.ended_at, 'session.ended_at'),
		replanCount: asNumber(row.replan_count, 'session.replan_count'),
		openTaskCount: asNumber(row.open_task_count, 'session.open_task_count'),
	};
}

function parseTaskSummary(summary: unknown): E3TaskSummaryCounts {
	if (!isRecord(summary)) {
		throw new Error('[Gateway:E3] Invalid task summary (expected object)');
	}
	return {
		total: asNumber(summary.total, 'taskSummary.total'),
		done: asNumber(summary.done, 'taskSummary.done'),
		inProgress: asNumber(summary.inProgress, 'taskSummary.inProgress'),
		notStarted: asNumber(summary.notStarted, 'taskSummary.notStarted'),
		blocked: asNumber(summary.blocked, 'taskSummary.blocked'),
		failed: asNumber(summary.failed, 'taskSummary.failed'),
	};
}

export async function getE3SessionsSnapshot(params: {
	workspaceRoot: string;
	cli: E3CliBridge;
	filter?: E3SessionListFilter;
	/** When true, fetches task summaries for up to `taskSummaryLimit` sessions (default 5). */
	includeTaskSummaries?: boolean;
	taskSummaryLimit?: number;
}): Promise<E3SessionsSnapshot> {
	const ensured = await params.cli.ensureDb(params.workspaceRoot);

	const filterObj: Record<string, unknown> = {};
	if (params.filter?.limit !== undefined) filterObj.limit = params.filter.limit;
	if (params.filter?.resumableOnly !== undefined) filterObj.resumableOnly = params.filter.resumableOnly;
	if (params.filter?.statuses) filterObj.statuses = params.filter.statuses;

	const filterJson = Object.keys(filterObj).length > 0 ? JSON.stringify(filterObj) : undefined;
	const sessionsUnknown = await params.cli.call<unknown>({
		workspaceRoot: params.workspaceRoot,
		command: 'get-sessions',
		args: filterJson ? [filterJson] : [],
	});

	if (!Array.isArray(sessionsUnknown)) {
		throw new Error('[Gateway:E3] get-sessions returned non-array JSON');
	}

	const sessions = sessionsUnknown.map(parseSessionRow);
	const taskSummariesBySessionId: Record<string, E3TaskSummaryCounts> = {};

	if (params.includeTaskSummaries) {
		const limit = params.taskSummaryLimit ?? 5;
		const top = sessions.slice(0, Math.max(0, limit));
		for (const session of top) {
			const summaryUnknown = await params.cli.call<unknown>({
				workspaceRoot: params.workspaceRoot,
				command: 'get-task-summary',
				args: [session.id],
			});
			taskSummariesBySessionId[session.id] = parseTaskSummary(summaryUnknown);
		}
	}

	return {
		workspaceRoot: params.workspaceRoot,
		dbPath: ensured.path,
		sessions,
		taskSummariesBySessionId,
	};
}

export function validateE3SessionListFilter(input: unknown): E3SessionListFilter {
	if (input == null) return {};
	if (!isRecord(input)) throw new Error('[Gateway:E3] Invalid sessions filter (expected object)');

	const filter: E3SessionListFilter = {};
	if (input.limit !== undefined) {
		const limit = Number(input.limit);
		if (!Number.isFinite(limit) || limit <= 0) throw new Error('[Gateway:E3] Invalid filter.limit');
		filter.limit = Math.min(200, Math.floor(limit));
	}
	if (input.resumableOnly !== undefined) filter.resumableOnly = Boolean(input.resumableOnly);
	if (input.statuses !== undefined) filter.statuses = asStringArray(input.statuses, 'filter.statuses');

	return filter;
}
