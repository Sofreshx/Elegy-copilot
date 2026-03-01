import path from 'path';
import { z } from 'zod';

import { AuditLogger } from './auditLogger';
import { chunkText } from './chunking';
import type { BridgeClient } from './bridgeClient';
import type { SessionDriver } from './sessionDriver';
import { formatSummary } from './formatSummary';
import { getWorkspaceGitSnapshot } from './gitSnapshot';
import type { PermissionOrchestrator } from './permissionOrchestrator';
import type { SandboxRegistry } from './sandboxRegistry';
import { sanitizeInboundPrompt, sanitizeOutboundText } from './sanitizer';
import { FixedWindowRateLimiter } from './rateLimiter';
import { ArtefactsMonitor } from './artefactsMonitor';
import { formatSessionLine, parseBridgeSessions } from './sessionsHelpers';
import type { PlatformKind } from './platform';
import { executeWorkflow } from './workflows/workflowRuntime';
import type { WorkflowRuntimeObserver } from './workflows/workflowRuntime';
import { createDefaultRegistry } from './workflows/executors';
import { WorkflowDiscovery } from './workflows/workflowDiscovery';
import { WorkflowHistory } from './workflows/workflowHistory';
import type { WorkflowRunResult } from './workflows/workflowSchema';
import type { WorkflowStreamingModule } from './workflows/workflowStreaming';

export type CommandTier = 'read' | 'invoke' | 'admin';

export interface CommandScopeContext {
	userId: string;
	userDisplayName?: string;
	guildId?: string;
	channelId?: string;
	platform: PlatformKind;
	sandboxId?: string;
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
	allowlistedUserIdsByPlatform?: Partial<Record<PlatformKind, ReadonlyArray<string>>>;
	requiredGuildId?: string;
	requiredChannelId?: string;
	rateLimitsPerMinute: {
		read: number;
		invoke: number;
		admin: number;
	};
	maxActiveInvokeSessionsPerUser: number;
	/** Per-sandbox limit. When set and sandboxId is present, enforced per-sandbox instead of globally per-user. Default: same as maxActiveInvokeSessionsPerUser */
	maxActiveInvokeSessionsPerSandbox?: number;
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
	maxActiveInvokeSessionsPerSandbox: 1,
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
	if (policy.maxActiveInvokeSessionsPerSandbox !== undefined &&
		policy.maxActiveInvokeSessionsPerSandbox !== expected.maxActiveInvokeSessionsPerSandbox) {
		throw new Error('[Gateway] CommandRouter policy mismatch: maxActiveInvokeSessionsPerSandbox must match WU-002 contract');
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
	extensionClient?: BridgeClient;
	permissionOrchestrator?: PermissionOrchestrator;
	sandboxRegistry?: SandboxRegistry;
	sessionDriver?: SessionDriver;
	workflowHistory?: WorkflowHistory;
	workflowStreaming?: WorkflowStreamingModule;
	nowMs?: () => number;
}

interface CommandExecutionResult {
	messages: string[];
	meta?: Record<string, unknown>;
}

export const COMMAND_ROUTER_DISCOVERY_TELEMETRY_CONTRACT_VERSION = 'skill_discovery_telemetry_v1';
export const COMMAND_ROUTER_DISCOVERY_SAMPLE_CAPACITY = 12;

export type CommandDiscoveryMissReason = 'keyword_miss' | 'ambiguity' | 'stale_map' | 'no_route';

export interface CommandDiscoveryMissSample {
	sequence: number;
	reason: CommandDiscoveryMissReason;
	command: string;
	detail: string;
}

export interface CommandDiscoveryTelemetrySummary {
	contractVersion: typeof COMMAND_ROUTER_DISCOVERY_TELEMETRY_CONTRACT_VERSION;
	sample: {
		capacity: number;
		size: number;
		dropped: number;
		deterministic: true;
	};
	countersByReason: Record<CommandDiscoveryMissReason, number>;
	recent: CommandDiscoveryMissSample[];
}

function createDiscoveryCounters(): Record<CommandDiscoveryMissReason, number> {
	return {
		keyword_miss: 0,
		ambiguity: 0,
		stale_map: 0,
		no_route: 0,
	};
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

const WorkflowArgsSchema = z.object({
	subcommand: z.enum(['run', 'list', 'history', 'inspect']),
	name: z.string().min(1).max(64).optional(),
	limit: z.number().int().min(1).max(100).optional(),
}).strict();

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
	// When sandboxId is provided: tracks per-user-per-sandbox (allows multi-sandbox concurrency)
	// When sandboxId is absent ("__default__"): tracks per-user globally (backward compat)
	private readonly invokeInFlightByUser = new Map<string, Map<string, number>>();
	private workflowDiscovery?: WorkflowDiscovery;
	private readonly discoveryCounters = createDiscoveryCounters();
	private readonly discoveryRecentSamples: CommandDiscoveryMissSample[] = [];
	private discoveryDroppedSamples = 0;
	private discoverySequence = 0;

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
			platform: ctx.platform,
			activeWorkspaceRoot: this.deps.workspaces.getActiveWorkspaceRoot(),
		};

		if (!command || tier === 'unknown') {
			this.recordDiscoveryMiss('keyword_miss', command, 'unknown_command');
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
			const sandboxId = ctx.sandboxId ?? '__default__';
			const perSandbox = this.deps.policy.maxActiveInvokeSessionsPerSandbox;
			const max = perSandbox !== undefined ? perSandbox : this.deps.policy.maxActiveInvokeSessionsPerUser;

			let userMap = this.invokeInFlightByUser.get(ctx.userId);
			if (!userMap) {
				userMap = new Map();
				this.invokeInFlightByUser.set(ctx.userId, userMap);
			}
			const current = userMap.get(sandboxId) ?? 0;
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
			userMap.set(sandboxId, current + 1);
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
			if (err instanceof z.ZodError) {
				this.recordDiscoveryMiss('no_route', command, 'argument_miss');
			}
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
				const sandboxId = ctx.sandboxId ?? '__default__';
				const userMap = this.invokeInFlightByUser.get(ctx.userId);
				if (userMap) {
					const current = userMap.get(sandboxId) ?? 0;
					if (current <= 1) {
						userMap.delete(sandboxId);
						if (userMap.size === 0) this.invokeInFlightByUser.delete(ctx.userId);
					} else {
						userMap.set(sandboxId, current - 1);
					}
				}
			}
		}
	}

	getDiscoveryTelemetrySummary(): CommandDiscoveryTelemetrySummary {
		return {
			contractVersion: COMMAND_ROUTER_DISCOVERY_TELEMETRY_CONTRACT_VERSION,
			sample: {
				capacity: COMMAND_ROUTER_DISCOVERY_SAMPLE_CAPACITY,
				size: this.discoveryRecentSamples.length,
				dropped: this.discoveryDroppedSamples,
				deterministic: true,
			},
			countersByReason: { ...this.discoveryCounters },
			recent: this.discoveryRecentSamples.map((sample) => ({ ...sample })),
		};
	}

	private authorize(ctx: CommandScopeContext): { allowed: boolean; reason?: string } {
		const policy = this.deps.policy;
		const platformAllowlist = policy.allowlistedUserIdsByPlatform?.[ctx.platform];
		const effectiveAllowlist = platformAllowlist ?? policy.allowlistedUserIds;
		if (!effectiveAllowlist.includes(ctx.userId)) return { allowed: false, reason: 'user_not_allowlisted' };

		// Guild/channel scope checks apply only to Discord
		if (ctx.platform === 'discord') {
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
			case '/task':
				return await this.handleTaskLike('task', argsUnknown);
			case '/plan':
				return await this.handleTaskLike('plan', argsUnknown);
			case '/stop':
				return { messages: await this.handleStop(argsUnknown) };
			case '/switch':
				return { messages: await this.handleSwitch(argsUnknown) };
			case '/sandbox':
				return { messages: await this.handleSandbox(argsUnknown) };
			case '/approve':
				return { messages: await this.handlePermissionDecision(true, argsUnknown) };
			case '/deny':
				return { messages: await this.handlePermissionDecision(false, argsUnknown) };
			case '/workflow':
				return await this.handleWorkflow(argsUnknown);
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

		const [git, artefacts] = await Promise.all([
			getWorkspaceGitSnapshot(workspaceRoot),
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
				statuses: OptionalStringArraySchema,
			})
			.strict()
			.optional()
			.default({})
			.parse(argsUnknown);

		const workspaceRoot = this.deps.workspaces.getActiveWorkspaceRoot();
		this.assertWorkspaceAllowed(workspaceRoot);

		const driver = this.getSessionDriver();
		const client = this.deps.extensionClient;
		const pending = this.deps.permissionOrchestrator?.getPending() ?? [];
		const pendingBySessionId = new Map<string, number>();
		for (const p of pending) {
			const sessionId = typeof p.sessionId === 'string' ? p.sessionId : '';
			if (!sessionId) continue;
			pendingBySessionId.set(sessionId, (pendingBySessionId.get(sessionId) ?? 0) + 1);
		}
		if (driver || (client && client.getStatus() === 'connected')) {
			const resUnknown = driver ? await driver.getSessions() : await client!.get_sessions();
			const sessions = parseBridgeSessions(resUnknown);
			const normalizedStatuses = (args.statuses ?? []).map((s) => s.toLowerCase()).filter((s) => s.length > 0);
			const filtered = sessions.filter((s) => {
				if (normalizedStatuses.length === 0) return true;
				return normalizedStatuses.includes((s.status ?? '').toLowerCase());
			});

			const limit = args.limit ?? 50;
			const lines: string[] = [];
			lines.push(`Sessions (connected) (${Math.min(filtered.length, limit)})`);
			lines.push(`Pending approvals: ${pending.length}`);
			for (const s of filtered.slice(0, Math.min(limit, 12))) {
				lines.push(formatSessionLine(s, pendingBySessionId.get(s.id)));
			}
			return sanitizeAndChunk(lines.join('\n'));
		}

		return sanitizeAndChunk(`sessions is connected-only (bridge not connected). Pending approvals: ${pending.length}`);
	}

	private async handleTaskLike(kind: 'task' | 'plan', argsUnknown: unknown): Promise<CommandExecutionResult> {
		const args = z
			.object({
				prompt: PromptSchema(this.deps.policy.maxPromptChars),
			})
			.strict()
			.parse(argsUnknown);

		const prompt =
			kind === 'plan'
				? sanitizeInboundPrompt(`PLAN ONLY:\n${args.prompt}`, { maxLength: this.deps.policy.maxPromptChars })
				: args.prompt;

		const driver = this.getSessionDriver();
		let result: unknown;
		if (driver) {
			result = await driver.invokeAgent({ agentName: 'orchestrator', prompt });
		} else {
			const client = this.deps.extensionClient;
			if (!client || client.getStatus() !== 'connected') {
				return { messages: sanitizeAndChunk(`${kind} is connected-only (extension WS not connected).`) };
			}
			result = await client.invoke_agent({ agentName: 'orchestrator', prompt });
		}

		const sessionId = this.tryExtractSessionId(result);
		const summaryText = formatSummary(
			[
				{ key: 'agent', value: 'orchestrator' },
				{ key: 'kind', value: kind },
				{ key: 'sessionId', value: sessionId },
			],
			{ title: 'Invoked' },
		);
		return { messages: sanitizeAndChunk(summaryText), meta: sessionId ? { sessionId } : undefined };
	}

	private async handleStop(argsUnknown: unknown): Promise<string[]> {
		const args = z
			.object({
				sessionId: SessionIdSchema,
			})
			.strict()
			.parse(argsUnknown);

		const driver = this.getSessionDriver();
		if (driver) {
			await driver.cancelSession({ sessionId: args.sessionId });
		} else {
			const client = this.deps.extensionClient;
			if (!client || client.getStatus() !== 'connected') {
				return sanitizeAndChunk('stop is connected-only (extension WS not connected).');
			}
			await client.cancel_session({ sessionId: args.sessionId });
		}

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
			this.recordDiscoveryMiss('ambiguity', '/switch', `workspace_name:${raw.toLowerCase()}`);
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
		if (byRepo.length > 1) {
			this.recordDiscoveryMiss('ambiguity', '/switch', `repo_name:${raw.toLowerCase()}`);
			throw new Error(`Ambiguous repo name: ${raw}`);
		}

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

		// Best-effort: also notify sessionDriver if available
		const driver = this.getSessionDriver();
		if (driver) {
			await driver.resolvePermission({ callbackId: args.callbackId, approved }).catch(() => {});
		}

		return sanitizeAndChunk(`${approved ? 'Approved' : 'Denied'} permission ${args.callbackId}.`);
	}

	private async handleSandbox(argsUnknown: unknown): Promise<string[]> {
		EmptyArgsSchema.optional().parse(argsUnknown);

		const registry = this.deps.sandboxRegistry;
		if (!registry) {
			return sanitizeAndChunk('Sandbox registry not available.');
		}

		const entries = registry.getAll();
		if (entries.length === 0) {
			return sanitizeAndChunk('No sandboxes registered.');
		}

		const lines: string[] = [`Sandboxes (${entries.length}):`];
		for (const entry of entries) {
			lines.push(`\u2022 ${entry.meta.sandboxId} \u2014 port ${entry.meta.hostPort} \u2014 ${entry.meta.status} \u2014 registered ${entry.meta.registeredAt}`);
		}
		return sanitizeAndChunk(lines.join('\n'));
	}

	private getWorkflowDiscovery(forceRefresh = false): WorkflowDiscovery {
		if (!this.workflowDiscovery) {
			this.workflowDiscovery = new WorkflowDiscovery();
		} else if (forceRefresh) {
			this.workflowDiscovery.refresh();
		}
		return this.workflowDiscovery;
	}

	private async handleWorkflow(argsUnknown: unknown): Promise<CommandExecutionResult> {
		const args = WorkflowArgsSchema.parse(argsUnknown);
		const discovery = this.getWorkflowDiscovery();

		if (args.subcommand === 'list') {
			const all = discovery.listAll();
			if (all.length === 0) {
				return { messages: sanitizeAndChunk('No workflow templates found.') };
			}
			const lines = ['**Available Workflows:**'];
			for (const def of all) {
				lines.push(`\u2022 \`${def.id}\` \u2014 ${def.name}${def.description ? ` (${def.description})` : ''}`);
			}
			return { messages: sanitizeAndChunk(lines.join('\n')) };
		}

		if (args.subcommand === 'history') {
			if (!args.name) {
				return { messages: sanitizeAndChunk('Usage: /workflow history <name> [--limit N]') };
			}
			if (!this.deps.workflowHistory) {
				return { messages: sanitizeAndChunk('Workflow history is not enabled.') };
			}
			const entries = this.deps.workflowHistory.readRecent(args.name, args.limit ?? 10);
			if (entries.length === 0) {
				return { messages: sanitizeAndChunk(`No history found for workflow "${args.name}".`) };
			}
			const lines = [`**Workflow History: ${args.name}** (${entries.length} recent runs)`];
			for (const entry of entries) {
				const dur = entry.completedAtMs - entry.startedAtMs;
				lines.push(`\u2022 ${entry.status} \u2014 ${dur}ms \u2014 ${new Date(entry.startedAtMs).toISOString()}`);
			}
			return { messages: sanitizeAndChunk(lines.join('\n')) };
		}

		if (args.subcommand === 'inspect') {
			if (!args.name) {
				return { messages: sanitizeAndChunk('Usage: /workflow inspect <name>') };
			}
			const def = discovery.get(args.name);
			if (!def) {
				this.recordDiscoveryMiss('stale_map', '/workflow', `inspect:${args.name}`);
				return { messages: sanitizeAndChunk(`Workflow "${args.name}" not found.`) };
			}
			const lines = [`**Workflow: ${def.name}** (v${def.version})`];
			if (def.description) lines.push(def.description);
			lines.push('', '**Steps:**');
			for (const step of def.steps) {
				const deps = step.dependsOn.length > 0 ? ` \u2192 depends on: ${step.dependsOn.join(', ')}` : '';
				lines.push(`\u2022 \`${step.id}\` \u2014 ${step.name} [${step.action}]${deps}`);
			}
			return { messages: sanitizeAndChunk(lines.join('\n')) };
		}

		// subcommand === 'run'
		if (!args.name) {
			return { messages: sanitizeAndChunk('Usage: /workflow run <name>. Use /workflow list to see available workflows.') };
		}

		const definition = discovery.get(args.name);
		if (!definition) {
			this.recordDiscoveryMiss('stale_map', '/workflow', `run:${args.name}`);
			return { messages: sanitizeAndChunk(`Workflow "${args.name}" not found. Use /workflow list to see available workflows.`) };
		}

		if (!this.deps.extensionClient) {
			return { messages: sanitizeAndChunk('Cannot run workflows: no bridge client connected.') };
		}

		let runId: string | undefined;
		let observer: WorkflowRuntimeObserver | undefined;
		if (this.deps.workflowStreaming) {
			const runContext = this.deps.workflowStreaming.createRunContext(definition);
			runId = runContext.runId;
			observer = runContext.observer;
		}

		const registry = createDefaultRegistry(this.deps.extensionClient);
		let result: WorkflowRunResult;
		try {
			result = await executeWorkflow(definition, registry.toStepExecutor(), {}, observer);
		} catch (error) {
			if (this.deps.workflowStreaming && runId) {
				this.deps.workflowStreaming.publishRunFailure({
					runId,
					workflowId: definition.id,
					error,
				});
			}
			throw error;
		}

		if (this.deps.workflowHistory) {
			try {
				this.deps.workflowHistory.append(result);
			} catch {
				// Graceful skip if history write fails
			}
		}

		const lines = [`**Workflow: ${definition.name}** (${result.status})`];
		if (runId) {
			lines.push(`Run ID: \`${runId}\``);
		}
		for (const sr of result.steps) {
			const icon = sr.status === 'success' ? '\u2705' : sr.status === 'failed' ? '\u274C' : '\u23ED\uFE0F';
			lines.push(`${icon} ${sr.stepId}: ${sr.status} (${sr.durationMs}ms)`);
		}
		return {
			messages: sanitizeAndChunk(lines.join('\n')),
			meta: runId ? { runId } : undefined,
		};
	}

	private getSessionDriver(): SessionDriver | undefined {
		if (this.deps.sessionDriver) return this.deps.sessionDriver;
		return undefined;
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

	private recordDiscoveryMiss(reason: CommandDiscoveryMissReason, command: string, detail: string): void {
		this.discoveryCounters[reason] += 1;
		const normalizedCommand = normalizeCommandName(command) || '(unknown)';
		const sample: CommandDiscoveryMissSample = {
			sequence: this.discoverySequence++,
			reason,
			command: normalizedCommand,
			detail: sanitizeOutboundText(detail).slice(0, 200),
		};

		if (this.discoveryRecentSamples.length >= COMMAND_ROUTER_DISCOVERY_SAMPLE_CAPACITY) {
			this.discoveryRecentSamples.shift();
			this.discoveryDroppedSamples += 1;
		}

		this.discoveryRecentSamples.push(sample);
	}
}

const READ_COMMANDS = new Set<string>(['/status', '/sessions', '/git', '/workspaces', '/sandbox']);
const INVOKE_COMMANDS = new Set<string>(['/task', '/plan', '/stop']);
// Admin includes /switch and permission decisions.
const ADMIN_COMMANDS = new Set<string>(['/switch', '/approve', '/deny', '/workflow']);

// Commands that should consume the "max active invoke sessions per user" slot.
const INVOKE_SLOT_COMMANDS = new Set<string>(['/task', '/plan']);
