import crypto from 'crypto';
import type { E3CliBridge } from './e3CliBridge';

export interface E3QueueRequest {
	workspaceRoot: string;
	prompt: string;
	requestedBy?: string;
}

export interface E3QueueResult {
	workspaceRoot: string;
	dbPath: string;
	sessionId: string;
	planId: string;
	todoId: string;
	taskId: string;
	cliResult: unknown;
}

function formatDateParts(date: Date): { yyyymmdd: string; hhmmss: string } {
	const pad = (n: number) => String(n).padStart(2, '0');
	const yyyymmdd = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
	const hhmmss = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
	return { yyyymmdd, hhmmss };
}

function randomSuffix4(): string {
	return crypto.randomBytes(2).toString('hex');
}

function normalizePrompt(prompt: string): string {
	const trimmed = prompt.trim();
	if (!trimmed) throw new Error('[Gateway:E3] Queue prompt must not be empty');
	// Match WU-002 input policy cap (defense-in-depth)
	return trimmed.length > 4000 ? trimmed.slice(0, 4000) : trimmed;
}

export async function queueE3SessionViaCli(params: {
	cli: E3CliBridge;
	request: E3QueueRequest;
}): Promise<E3QueueResult> {
	const prompt = normalizePrompt(params.request.prompt);
	const now = new Date();
	const { yyyymmdd, hhmmss } = formatDateParts(now);
	const rand = randomSuffix4();

	const sessionId = `e3-${yyyymmdd}-${hhmmss}-${rand}`;
	const planId = `plan-${yyyymmdd}-${rand}`;
	const todoId = `todo-${yyyymmdd}-${hhmmss}-${rand}`;
	const taskId = `e3t-${yyyymmdd}-${hhmmss}-${rand}-001`;

	const ensured = await params.cli.ensureDb(params.request.workspaceRoot);

	const bundle = {
		plan: {
			id: planId,
			title: 'Queued request',
			summary: 'Created via messaging gateway /queue',
		},
		session: {
			id: sessionId,
			plan_id: planId,
			request_summary: prompt,
			context_snapshot: JSON.stringify({
				source: 'messaging-gateway',
				queued_at: now.toISOString(),
				requested_by: params.request.requestedBy ?? null,
			}),
		},
		tasks: [
			{
				id: taskId,
				plan_id: planId,
				session_id: sessionId,
				title: 'Execute queued request',
				description: prompt,
				status: 'not-started',
				priority: 2,
				depends_on: [],
				skills: [],
			},
		],
		todo: {
			id: todoId,
			session_id: sessionId,
			title: 'Queued request',
			summary: prompt,
			status: 'active',
			task_ids: [taskId],
		},
		task_plans: [],
		options: {
			idempotent: false,
		},
	};

	const cliResult = await params.cli.call<unknown>({
		workspaceRoot: params.request.workspaceRoot,
		command: 'create-session-bundle',
		args: [JSON.stringify(bundle)],
		dbPath: ensured.path,
	});

	return {
		workspaceRoot: params.request.workspaceRoot,
		dbPath: ensured.path,
		sessionId,
		planId,
		todoId,
		taskId,
		cliResult,
	};
}
