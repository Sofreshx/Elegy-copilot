import path from 'path';
import { z } from 'zod';

import { AuditLogger } from './auditLogger';
import { chunkText } from './chunking';
import type { ExtensionBridgeClient } from './extensionBridgeClient';
import { formatSummary } from './formatSummary';
import { getWorkspaceGitSnapshot } from './gitSnapshot';
import type { PermissionOrchestrator } from './permissionOrchestrator';
import { sanitizeInboundPrompt, sanitizeOutboundText } from './sanitizer';
import { E3CliBridge } from './e3CliBridge';
import { getE3SessionsSnapshot } from './e3Sessions';
import { queueE3SessionViaCli } from './e3Queue';
import { FixedWindowRateLimiter } from './rateLimiter';
import { ArtefactsMonitor } from './artefactsMonitor';

export type CommandTier = 'read' | 'invoke' | 'admin';

export interface CommandScopeContext {
	userId: string;
	userDisplayName?: string;
	guildId?: string;
	channelId?: string;
	platform?: string;
}

export interface CommandRequest {
	/** e.g. "/status" or "status" */
	name: string;
	/** Structured args from the platform adapter (slash command options, button payloads, etc). */	args?: unknown;
}

export type CommandResultKind = 'ok' | 'denied' | 'error';

export interface CommandResult {
	kind: CommandResultKind;
	command: string;
	tier: CommandTier | 'unknown';
	messages: string[];
	/** Extra fields for adapters (ephemeral/visibility decisions, retry-after, etc). */	meta?: Record<string, unknown>;
}

export interface CommandRouterPolicy {
	allowlistedUserIds: ReadonlyArray<string>;
	requiredGuildId?: string;
	requiredChannelId?: string;
	rateLimitsPerMinute: {
		read: number;
		invoke: number;
		admin: number;
	};
	maxActiveInvokeSessionsPerUser: number;
	permissionTimeoutMs: number;
	maxPromptChars: number;
}

/**
 * Policy contract locked in WU-002.
 * These values are treated as security boundary configuration and must not drift silently.
 */
export const WU002_POLICY_CONTRACT = {
	rateLimitsPerMinute: { read: 30, invoke: 6, admin: 3 },
	maxActiveInvokeSessionsPerUser: 1,
	permissionTimeoutMs: 120_000,
	maxPromptChars: 4000,
} as const;

function assertPolicyContract(policy: CommandRouterPolicy): void {
	const expected = WU002_POLICY_CONTRACT;
	if (
		policy.rateLimitsPerMinute.read !== expected.rateLimitsPerMinute.read ||
		policy.rateLimitsPerMinute.invoke !== expected.rateLimitsPerMinute.invoke ||
		policy.rateLimitsPerMinute.admin !== expected.rateLimitsPerMinute.admin
	) {
		throw new Error('[Gateway] CommandRouter policy mismatch: rate limits must match WU-002 contract');
	}
	if (policy.maxActiveInvokeSessionsPerUser !== expected.maxActiveInvokeSessionsPerUser) {
		throw new Error('[Gateway] CommandRouter policy mismatch: maxActiveInvokeSessionsPerUser must match WU-002 contract');
	}
	if (policy.permissionTimeoutMs !== expected.permissionTimeoutMs) {
		throw new Error('[Gateway] CommandRouter policy mismatch: permissionTimeoutMs must match WU-002 contract');
	}
	if (policy.maxPromptChars !== expected.maxPromptChars) {
		throw new Error('[Gateway] CommandRouter policy mismatch: maxPromptChars must match WU-002 contract');
	}
}

export interface CommandRouterWorkspaceState {
	getActiveWorkspaceRoot: () => string;
	getAllowedWorkspaceRoots: () => ReadonlyArray<string>;
	/** Optional: used by /switch */	setActiveWorkspaceRoot?: (nextWorkspaceRoot: string) => void | Promise<void>;
}

export interface CommandRouterDeps {
	policy: CommandRouterPolicy;
	workspaces: CommandRouterWorkspaceState;
	auditLogger: AuditLogger;
	e3Cli: E3CliBridge;
	extensionClient?: ExtensionBridgeClient;
	permissionOrchestrator?: PermissionOrchestrator;
	nowMs?: () => number;
}

interface CommandExecutionResult {
	messages: string[];
	meta?: Record<string, unknown>;
}

function canonicalPathForComparison(inputPath: string): string {
	const normalized = path.normalize(inputPath);
	return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function pathsEqual(a: string, b: string): boolean {
	return canonicalPathForComparison(a) === canonicalPathForComparison(b);
}

function normalizeCommandName(input: string): string {
	const trimmed = input.trim();
	if (!trimmed) return '';
	return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function formatRetryAfterMs(ms: number): string {
	const seconds = Math.ceil(ms / 1000);
	return seconds <= 1 ? '1s' : `${seconds}s`;
}

function sanitizeAndChunk(text: string): string[] {
	const sanitized = sanitizeOutboundText(text);
	return chunkText(sanitized, { maxChunkLength: 1800, maxChunks: 3 });
}

const EmptyArgsSchema = z.object({}).strict();

const PromptSchema = (maxPromptChars: number) =>
	z.preprocess(
		(value: unknown) =>
			typeof value === 'string' ? sanitizeInboundPrompt(value, { maxLength: maxPromptChars }) : value,
		z.string().min(1).max(maxPromptChars),
	);

const SessionIdSchema = z.preprocess(
	(value: unknown) => (typeof value === 'string' ? value.trim() : value),
	z.string().min(1).max(200),
);

const WorkspaceRootSchema = z.preprocess(
	(value: unknown) => (typeof value === 'string' ? value.trim() : value),
	z.string().min(1).max(600),
);

const OptionalIntSchema = (min: number, max: number) =>
	z
		.preprocess((v: unknown) => {
			if (typeof v === 'string' && v.trim().length > 0) return Number(v);
			return v;
		}, z.number().int().min(min).max(max))
		.optional();

const OptionalBoolSchema = z
	.preprocess((v: unknown) => {
		if (typeof v === 'string') {
			const t = v.trim().toLowerCase();
			if (t === 'true' || t === '1' || t === 'yes') return true;
			if (t === 'false' || t === '0' || t === 'no') return false;
		}
		return v;
	}, z.boolean())
	.optional();

const OptionalStringArraySchema = z
	.preprocess((v: unknown) => {
		if (typeof v === 'string') {
			const trimmed = v.trim();
			if (!trimmed) return [];
			return trimmed.split(',').map((s) => s.trim());
		}
		return v;
	}, z.array(z.string().min(1)).max(25))
	.optional();

export class CommandRouter {
	private readonly deps: CommandRouterDeps;
	private readonly limiterByTier: Record<CommandTier, FixedWindowRateLimiter>;
	private readonly invokeInFlightCountByUser = new Map<string, number>();

	constructor(deps: CommandRouterDeps) {
		assertPolicyContract(deps.policy);
		this.deps = deps;
		const nowMs = deps.nowMs ?? (() => Date.now());
		this.limiterByTier = {
			read: new FixedWindowRateLimiter({ limit: deps.policy.rateLimitsPerMinute.read, windowMs: 60_000, nowMs }),
			invoke: new FixedWindowRateLimiter({
				limit: deps.policy.rateLimitsPerMinute.invoke,
				windowMs: 60_000,
				nowMs,
			}),
			admin: new FixedWindowRateLimiter({ limit: deps.policy.rateLimitsPerMinute.admin, windowMs: 60_000, nowMs }),
		};
	}

	getCommandTier(commandNameInput: string): CommandTier | 'unknown' {
		const command = normalizeCommandName(commandNameInput);
		if (READ_COMMANDS.has(command)) return 'read';
		if (INVOKE_COMMANDS.has(command)) return 'invoke';
		if (ADMIN_COMMANDS.has(command)) return 'admin';
		return 'unknown';
	}

	async route(request: CommandRequest, ctx: CommandScopeContext): Promise<CommandResult> {
		const startedAt = Date.now();
		const command = normalizeCommandName(request.name);
		const tier = this.getCommandTier(command);

		const baseAudit = {
			kind: 'command',
			command,
			tier,
			userId: ctx.userId,
			guildId: ctx.guildId ?? null,
			channelId: ctx.channelId ?? null,
			platform: ctx.platform ?? null,
			activeWorkspaceRoot: this.deps.workspaces.getActiveWorkspaceRoot(),
		};

		if (!command || tier === 'unknown') {
			this.deps.auditLogger.log({ ...baseAudit, outcome: 'denied', reason: 'unknown_command' });
			return {
				kind: 'denied',
				command,
				tier,
				messages: sanitizeAndChunk('Unknown command.'),
				meta: { reason: 'unknown_command' },
			};
		}

		const authz = this.authorize(ctx);
		if (!authz.allowed) {
			this.deps.auditLogger.log({ ...baseAudit, outcome: 'denied', reason: authz.reason });
			return {
				kind: 'denied',
				command,
				tier,
				messages: sanitizeAndChunk('Unauthorized.'),
				meta: { reason: authz.reason, shouldRespond: true },
			};
		}

		const rl = this.limiterByTier[tier].check(ctx.userId);
		if (!rl.allowed) {
			this.deps.auditLogger.log({
				...baseAudit,
				outcome: 'denied',
				reason: 'rate_limited',
				rateLimit: { limit: rl.limit, remaining: rl.remaining, resetAtMs: rl.resetAtMs },
			});
			return {
				kind: 'denied',
				command,
				tier,
				messages: sanitizeAndChunk(`Rate limit exceeded. Try again in ${formatRetryAfterMs(rl.retryAfterMs)}.`),
				meta: { reason: 'rate_limited', retryAfterMs: rl.retryAfterMs },
			};
		}

		const consumesInvokeSlot = tier === 'invoke' && INVOKE_SLOT_COMMANDS.has(command);
		if (consumesInvokeSlot) {
			const max = this.deps.policy.maxActiveInvokeSessionsPerUser;
			const current = this.invokeInFlightCountByUser.get(ctx.userId) ?? 0;
			if (current >= max) {
				this.deps.auditLogger.log({
					...baseAudit,
					outcome: 'denied',
					reason: 'invoke_concurrency_limit',
				});
				return {
					kind: 'denied',
					command,
					tier,
					messages: sanitizeAndChunk('Only one active invoke session is allowed per user. Please wait.'),
					meta: { reason: 'invoke_concurrency_limit' },
				};
			}
			this.invokeInFlightCountByUser.set(ctx.userId, current + 1);
		}

		try {
			const executed = await this.executeCommand(command, request.args, ctx);
			const durationMs = Date.now() - startedAt;
			this.deps.auditLogger.log({ ...baseAudit, outcome: 'ok', durationMs });
			return {
				kind: 'ok',
				command,
				tier,
				messages: executed.messages,
				meta: { durationMs, ...(executed.meta ?? {}) },
			};
		} catch (err) {
			const durationMs = Date.now() - startedAt;
			const message = err instanceof Error ? err.message : String(err);
			this.deps.auditLogger.log({
				...baseAudit,
				outcome: 'error',
				durationMs,
				error: message,
			});
			return {
				kind: 'error',
				command,
				tier,
				messages: sanitizeAndChunk(`Command failed: ${message}`),
				meta: { durationMs },
			};
		} finally {
			if (consumesInvokeSlot) {
				const current = this.invokeInFlightCountByUser.get(ctx.userId) ?? 0;
				if (current <= 1) this.invokeInFlightCountByUser.delete(ctx.userId);
				else this.invokeInFlightCountByUser.set(ctx.userId, current - 1);
			}
		}
	}

	private authorize(ctx: CommandScopeContext): { allowed: boolean; reason?: string } {
		const policy = this.deps.policy;
		if (!policy.allowlistedUserIds.includes(ctx.userId)) return { allowed: false, reason: 'user_not_allowlisted' };

		if (policy.requiredGuildId) {
			if (!ctx.guildId || ctx.guildId !== policy.requiredGuildId) {
				return { allowed: false, reason: 'guild_scope_mismatch' };
			}
		}

		if (policy.requiredChannelId) {
			if (!ctx.channelId || ctx.channelId !== policy.requiredChannelId) {
				return { allowed: false, reason: 'channel_scope_mismatch' };
			}
		}

		return { allowed: true };
	}

	private async executeCommand(command: string, argsUnknown: unknown, ctx: CommandScopeContext): Promise<CommandExecutionResult> {
		switch (command) {
			case '/status':
				return { messages: await this.handleStatus(argsUnknown) };
			case '/sessions':
				return { messages: await this.handleSessions(argsUnknown) };
			case '/git':
				return { messages: await this.handleGit(argsUnknown) };
			case '/workspaces':
				return { messages: await this.handleWorkspaces(argsUnknown) };
			case '/queue':
				return { messages: await this.handleQueue(argsUnknown, ctx) };
			case '/task':
				return await this.handleTaskLike('task', argsUnknown);
			case '/plan':
				return await this.handleTaskLike('plan', argsUnknown);
			case '/resume':
				return await this.handleResume(argsUnknown, ctx);
			case '/stop':
				return { messages: await this.handleStop(argsUnknown) };
			case '/switch':
				return { messages: await this.handleSwitch(argsUnknown) };
			case '/approve':
				return { messages: await this.handlePermissionDecision(true, argsUnknown) };
			case '/deny':
				return { messages: await this.handlePermissionDecision(false, argsUnknown) };
			default:
				// Should be unreachable due to tier check.
				throw new Error('Unknown command');
		}
	}

	private async handleStatus(argsUnknown: unknown): Promise<string[]> {
		EmptyArgsSchema.optional().parse(argsUnknown);

		const workspaceRoot = this.deps.workspaces.getActiveWorkspaceRoot();
		this.assertWorkspaceAllowed(workspaceRoot);

		const extensionStatus = this.deps.extensionClient?.getStatus() ?? 'idle';
		const connected = extensionStatus === 'connected';

		const [git, sessions, artefacts] = await Promise.all([
			getWorkspaceGitSnapshot(workspaceRoot),
			getE3SessionsSnapshot({ workspaceRoot, cli: this.deps.e3Cli, filter: { limit: 5 } }).catch(() => null),
			this.getArtefactsSnapshot(workspaceRoot).catch(() => []),
		]);

		const summaryText = formatSummary(
			[
				{ key: 'mode', value: connected ? 'connected' : 'disconnected' },
				{ key: 'extension', value: extensionStatus },
				{ key: 'workspace', value: workspaceRoot },
				{ key: 'repo', value: git?.repoName ?? null },
				{ key: 'branch', value: git?.branch ?? null },
				{ key: 'dirty', value: git ? git.modified + git.untracked + git.staged : null },
				{ key: 'sessions(top5)', value: sessions ? sessions.sessions.length : null },
				{ key: 'artefacts', value: artefacts.length },
			],
			{ title: 'Status' },
		);

		return sanitizeAndChunk(summaryText);
	}

	private async handleWorkspaces(argsUnknown: unknown): Promise<string[]> {
		EmptyArgsSchema.optional().parse(argsUnknown);

		const active = this.deps.workspaces.getActiveWorkspaceRoot();
		const allowed = [...this.deps.workspaces.getAllowedWorkspaceRoots()];

		const snapshots = await Promise.all(
			allowed.map(async (root) => {
				const git = await getWorkspaceGitSnapshot(root);
				return { root, git };
			}),
		);

		const lines: string[] = [];
		lines.push('Workspaces');
		for (const { root, git } of snapshots) {
			const isActive = pathsEqual(root, active);
			const marker = isActive ? '*' : '-';
			const repo = git ? `${git.repoName}@${git.branch}` : '(no git repo)';
			lines.push(`${marker} ${root} — ${repo}`);
		}

		return sanitizeAndChunk(lines.join('\n'));
	}

	private async handleGit(argsUnknown: unknown): Promise<string[]> {
		EmptyArgsSchema.optional().parse(argsUnknown);

		const workspaceRoot = this.deps.workspaces.getActiveWorkspaceRoot();
		this.assertWorkspaceAllowed(workspaceRoot);

		const snap = await getWorkspaceGitSnapshot(workspaceRoot);
		if (!snap) return sanitizeAndChunk('No git repository detected for the active workspace.');

		const summaryText = formatSummary(
			[
				{ key: 'repo', value: snap.repoName },
				{ key: 'branch', value: snap.branch },
				{ key: 'ahead', value: snap.ahead },
				{ key: 'behind', value: snap.behind },
				{ key: 'modified', value: snap.modified },
				{ key: 'untracked', value: snap.untracked },
				{ key: 'staged', value: snap.staged },
			],
			{ title: 'Git' },
		);
		return sanitizeAndChunk(summaryText);
	}

	private async handleSessions(argsUnknown: unknown): Promise<string[]> {
		const args = z
			.object({
				limit: OptionalIntSchema(1, 200),
				resumableOnly: OptionalBoolSchema,
				statuses: OptionalStringArraySchema,
			})
			.strict()
			.optional()
			.default({})
			.parse(argsUnknown);

		const workspaceRoot = this.deps.workspaces.getActiveWorkspaceRoot();
		this.assertWorkspaceAllowed(workspaceRoot);

		const client = this.deps.extensionClient;
		if (client && client.getStatus() === 'connected') {
			const resUnknown = await client.get_sessions();
			const sessionsUnknown =
				typeof resUnknown === 'object' && resUnknown !== null
					? (resUnknown as Record<string, unknown>).sessions
					: undefined;

			const sessions = Array.isArray(sessionsUnknown) ? sessionsUnknown : [];
			const normalizedStatuses = (args.statuses ?? []).map((s) => s.toLowerCase()).filter((s) => s.length > 0);
			const filtered = sessions
				.filter((s) => typeof s === 'object' && s !== null)
				.map((s) => s as Record<string, unknown>)
				.filter((s) => {
					if (normalizedStatuses.length === 0) return true;
					const st = typeof s.status === 'string' ? s.status.toLowerCase() : '';
					return normalizedStatuses.includes(st);
				});

			const limit = args.limit ?? 50;
			const lines: string[] = [];
			lines.push(`Sessions (connected) (${Math.min(filtered.length, limit)})`);
			for (const s of filtered.slice(0, Math.min(limit, 12))) {
				const id = typeof s.id === 'string' ? s.id : '—';
				const status = typeof s.status === 'string' ? s.status : '—';
				const agentName = typeof s.agentName === 'string' ? s.agentName : undefined;
				lines.push(`- ${id} [${status}]${agentName ? ` @${agentName}` : ''}`);
			}
			return sanitizeAndChunk(lines.join('\n'));
		}

		const snapshot = await getE3SessionsSnapshot({
			workspaceRoot,
			cli: this.deps.e3Cli,
			filter: {
				limit: args.limit,
				resumableOnly: args.resumableOnly,
				statuses: args.statuses,
			},
			includeTaskSummaries: true,
		});

		const lines: string[] = [];
		lines.push(`Sessions (${snapshot.sessions.length})`);
		for (const session of snapshot.sessions.slice(0, 12)) {
			const taskSummary = snapshot.taskSummariesBySessionId[session.id];
			const taskStr = taskSummary ? ` tasks:${taskSummary.done}/${taskSummary.total}` : '';
			lines.push(`- ${session.id} [${session.status}]${taskStr}`);
		}

		return sanitizeAndChunk(lines.join('\n'));
	}

	private async handleQueue(argsUnknown: unknown, ctx: CommandScopeContext): Promise<string[]> {
		const args = z
			.object({
				prompt: PromptSchema(this.deps.policy.maxPromptChars),
			})
			.strict()
			.parse(argsUnknown);

		const workspaceRoot = this.deps.workspaces.getActiveWorkspaceRoot();
		this.assertWorkspaceAllowed(workspaceRoot);

		const result = await queueE3SessionViaCli({
			cli: this.deps.e3Cli,
			request: {
				workspaceRoot,
				prompt: args.prompt,
				requestedBy: ctx.userId,
			},
		});

		const summaryText = formatSummary(
			[
				{ key: 'workspace', value: result.workspaceRoot },
				{ key: 'sessionId', value: result.sessionId },
				{ key: 'planId', value: result.planId },
				{ key: 'todoId', value: result.todoId },
				{ key: 'taskId', value: result.taskId },
			],
			{ title: 'Queued' },
		);
		return sanitizeAndChunk(summaryText);
	}

	private async handleTaskLike(kind: 'task' | 'plan', argsUnknown: unknown): Promise<CommandExecutionResult> {
		const args = z
			.object({
				prompt: PromptSchema(this.deps.policy.maxPromptChars),
			})
			.strict()
			.parse(argsUnknown);

		const client = this.deps.extensionClient;
		if (!client || client.getStatus() !== 'connected') {
			return { messages: sanitizeAndChunk(`${kind} is connected-only (extension WS not connected).`) };
		}

		const prompt =
			kind === 'plan'
				? sanitizeInboundPrompt(`PLAN ONLY:\n${args.prompt}`, { maxLength: this.deps.policy.maxPromptChars })
				: args.prompt;

		const result = await client.invoke_agent({ agentName: 'executive3', prompt });
		const sessionId = this.tryExtractSessionId(result);
		const summaryText = formatSummary(
			[
				{ key: 'agent', value: 'executive3' },
				{ key: 'kind', value: kind },
				{ key: 'sessionId', value: sessionId },
			],
			{ title: 'Invoked' },
		);
		return { messages: sanitizeAndChunk(summaryText), meta: sessionId ? { sessionId } : undefined };
	}

	private async handleResume(argsUnknown: unknown, ctx: CommandScopeContext): Promise<CommandExecutionResult> {
		const args = z
			.object({
				sessionId: SessionIdSchema,
			})
			.strict()
			.parse(argsUnknown);

		const client = this.deps.extensionClient;
		if (client && client.getStatus() === 'connected') {
			const prompt = sanitizeInboundPrompt(`Resume session ${args.sessionId}`, { maxLength: this.deps.policy.maxPromptChars });
			const result = await client.invoke_agent({ agentName: 'executive3', prompt });
			const sessionId = this.tryExtractSessionId(result);
			return { messages: sanitizeAndChunk(`Resume requested. sessionId=${sessionId ?? '—'}`), meta: sessionId ? { sessionId } : undefined };
		}

		// Disconnected mode: queue a resumptive prompt via E3 CLI (offline-safe).
		const workspaceRoot = this.deps.workspaces.getActiveWorkspaceRoot();
		this.assertWorkspaceAllowed(workspaceRoot);
		const queued = await queueE3SessionViaCli({
			cli: this.deps.e3Cli,
			request: {
				workspaceRoot,
				prompt: sanitizeInboundPrompt(`Resume session ${args.sessionId}`, { maxLength: this.deps.policy.maxPromptChars }),
				requestedBy: ctx.userId,
			},
		});
		const summaryText = formatSummary(
			[
				{ key: 'workspace', value: queued.workspaceRoot },
				{ key: 'sessionId', value: queued.sessionId },
				{ key: 'planId', value: queued.planId },
				{ key: 'todoId', value: queued.todoId },
				{ key: 'taskId', value: queued.taskId },
			],
			{ title: 'Resumed (queued)' },
		);
		return { messages: sanitizeAndChunk(summaryText), meta: { queued: true, sessionId: queued.sessionId } };
	}

	private async handleStop(argsUnknown: unknown): Promise<string[]> {
		const args = z
			.object({
				sessionId: SessionIdSchema,
			})
			.strict()
			.parse(argsUnknown);

		const client = this.deps.extensionClient;
		if (!client || client.getStatus() !== 'connected') {
			return sanitizeAndChunk('stop is connected-only (extension WS not connected).');
		}

		await client.cancel_session({ sessionId: args.sessionId });
		return sanitizeAndChunk(`Stop requested for session ${args.sessionId}.`);
	}

	private async handleSwitch(argsUnknown: unknown): Promise<string[]> {
		const args = z
			.object({
				workspaceRoot: WorkspaceRootSchema,
			})
			.strict()
			.parse(argsUnknown);

		if (!this.deps.workspaces.setActiveWorkspaceRoot) {
			return sanitizeAndChunk('switch is not configured (no workspace state setter).');
		}

		const resolved = await this.resolveWorkspaceRootOrName(args.workspaceRoot);
		this.assertWorkspaceAllowed(resolved);

		await this.deps.workspaces.setActiveWorkspaceRoot(resolved);
		return sanitizeAndChunk(`Active workspace switched to: ${resolved}`);
	}

	private async resolveWorkspaceRootOrName(input: string): Promise<string> {
		const allowed = [...this.deps.workspaces.getAllowedWorkspaceRoots()];
		const raw = input.trim();
		if (!raw) throw new Error('Missing workspace root or name');

		// 1) Direct path match (resolved)
		const asPath = path.resolve(raw);
		const direct = allowed.find((r) => pathsEqual(r, asPath));
		if (direct) return direct;

		// 2) Basename match
		const norm = raw.toLowerCase();
		const byBase = allowed.filter((r) => path.basename(r).toLowerCase() === norm);
		if (byBase.length === 1) return byBase[0];
		if (byBase.length > 1) {
			throw new Error(`Ambiguous workspace name: ${raw}`);
		}

		// 3) Repo name match (best-effort)
		const snaps = await Promise.all(
			allowed.map(async (root) => {
				const snap = await getWorkspaceGitSnapshot(root).catch(() => null);
				return { root, repoName: snap?.repoName ?? null };
			}),
		);
		const byRepo = snaps.filter((s) => (s.repoName ?? '').toLowerCase() === norm).map((s) => s.root);
		if (byRepo.length === 1) return byRepo[0];
		if (byRepo.length > 1) throw new Error(`Ambiguous repo name: ${raw}`);

		throw new Error(`Workspace not found in allowlist: ${raw}`);
	}

	private async handlePermissionDecision(approved: boolean, argsUnknown: unknown): Promise<string[]> {
		const args = z
			.object({
				callbackId: z.string().min(1).max(200),
			})
			.strict()
			.parse(argsUnknown);

		const orch = this.deps.permissionOrchestrator;
		if (!orch) return sanitizeAndChunk('Permission orchestration is not configured.');

		if (approved) await orch.approve(args.callbackId);
		else await orch.deny(args.callbackId);

		return sanitizeAndChunk(`${approved ? 'Approved' : 'Denied'} permission ${args.callbackId}.`);
	}

	private assertWorkspaceAllowed(workspaceRoot: string): void {
		const allowed = this.deps.workspaces.getAllowedWorkspaceRoots();
		if (!allowed.some((r) => pathsEqual(r, workspaceRoot))) {
			throw new Error('Workspace root is not allowlisted');
		}
	}

	private tryExtractSessionId(result: unknown): string | undefined {
		if (typeof result !== 'object' || result === null) return undefined;
		const rec = result as Record<string, unknown>;
		const v = rec.sessionId ?? rec.session_id;
		return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
	}

	private async getArtefactsSnapshot(workspaceRoot: string): Promise<string[]> {
		const monitor = new ArtefactsMonitor({ workspaceRoot });
		await monitor.refreshSnapshot();
		return monitor.getSnapshot().map((i) => i.relativePath);
	}
}

const READ_COMMANDS = new Set<string>(['/status', '/sessions', '/git', '/workspaces']);
const INVOKE_COMMANDS = new Set<string>(['/task', '/plan', '/stop', '/queue', '/resume']);
// Admin includes /switch and permission decisions.
const ADMIN_COMMANDS = new Set<string>(['/switch', '/approve', '/deny']);

// Commands that should consume the "max active invoke sessions per user" slot.
const INVOKE_SLOT_COMMANDS = new Set<string>(['/task', '/plan', '/resume']);
