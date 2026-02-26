import crypto from 'crypto';
import type http from 'http';

import type { AuditLogger } from './auditLogger';
import type { BridgeClient } from './bridgeClient';
import type { LifecycleAction } from './config';
import type { ContainerManager } from './containerManager';
import {
	containsUnsafeShellSyntax,
	LifecyclePayloadValidationError,
} from './lifecycleOpenTerminal';
import type { PortAllocator } from './portAllocator';
import { ensureSandboxDirs } from './sandboxDirs';
import type { SandboxRegistry } from './sandboxRegistry';

type ManagedLifecycleAction = Extract<LifecycleAction, 'create' | 'start' | 'stop' | 'pr-open' | 'finish'>;
type SandboxIdSource = 'user' | 'auto';
type FinishPrAction = 'skip-pr' | 'open-pr' | 'open-pr:canceled';

interface LifecycleRequestContext {
	actor: string;
	remoteAddress: string;
}

interface SandboxLifecyclePayload {
	sandboxId: string;
	sandboxIdSource?: SandboxIdSource;
}

interface PrOpenLifecyclePayload extends SandboxLifecyclePayload {
	baseBranch: string;
	headBranch: string;
}

interface ParsedFinishLifecyclePayload extends SandboxLifecyclePayload {
	prAction: FinishPrAction;
	baseBranch?: string;
	headBranch?: string;
}

type ParsedPayload = SandboxLifecyclePayload | PrOpenLifecyclePayload | ParsedFinishLifecyclePayload;

type LifecycleOperationResult = Record<string, unknown>;

interface InFlightEntry {
	promise: Promise<LifecycleOperationResult>;
	callerCount: number;
	payloadFingerprint: string;
	canonicalSandboxId: string | null;
}

export interface LifecycleOperationsHandlerOptions {
	auditLogger: AuditLogger;
	containerManager: ContainerManager;
	sandboxRegistry: SandboxRegistry;
	portAllocator: PortAllocator;
	createSandboxBridgeClient?: (params: { sandboxId: string; hostPort: number }) => BridgeClient;
}

const SANDBOX_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/;
const BRANCH_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/;
const FINISH_PR_ACTIONS = new Set<FinishPrAction>(['skip-pr', 'open-pr', 'open-pr:canceled']);

function isContainerConsideredActive(state: string | undefined): boolean {
	if (!state) return true;
	const normalized = state.trim().toLowerCase();
	return normalized === 'running' || normalized === 'restarting';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeKey(key: string): string {
	return key.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function isForbiddenEnvKey(key: string): boolean {
	const normalized = normalizeKey(key);
	return normalized === 'env'
		|| normalized === 'environment'
		|| normalized === 'processenv'
		|| normalized === 'shellenv'
		|| normalized === 'environmentvariables';
}

function findForbiddenEnvPath(value: unknown, prefix = ''): string | null {
	if (!isRecord(value)) return null;
	for (const [key, child] of Object.entries(value)) {
		const next = prefix ? `${prefix}.${key}` : key;
		if (isForbiddenEnvKey(key)) return next;
		const nested = findForbiddenEnvPath(child, next);
		if (nested) return nested;
	}
	return null;
}

function assertAllowedKeys(payload: Record<string, unknown>, allowedKeys: ReadonlyArray<string>, action: ManagedLifecycleAction): void {
	for (const key of Object.keys(payload)) {
		if (!allowedKeys.includes(key)) {
			throw new LifecyclePayloadValidationError({
				code: 'invalid_lifecycle_payload',
				reason: `unexpected_field:${key}`,
			}, action);
		}
	}
}

function validateSandboxId(value: unknown, action: ManagedLifecycleAction): string {
	if (typeof value !== 'string') {
		throw new LifecyclePayloadValidationError({
			code: 'invalid_lifecycle_payload',
			reason: 'missing_or_invalid_sandbox_id',
		}, action);
	}

	const sandboxId = value.trim();
	if (!sandboxId) {
		throw new LifecyclePayloadValidationError({
			code: 'invalid_lifecycle_payload',
			reason: 'missing_or_invalid_sandbox_id',
		}, action);
	}

	if (containsUnsafeShellSyntax(sandboxId)) {
		throw new LifecyclePayloadValidationError({
			code: 'invalid_lifecycle_payload',
			reason: 'unsafe_shell_syntax:sandboxId',
		}, action);
	}

	if (!SANDBOX_ID_RE.test(sandboxId)) {
		throw new LifecyclePayloadValidationError({
			code: 'invalid_lifecycle_payload',
			reason: 'invalid_sandbox_id_format',
		}, action);
	}

	return sandboxId;
}

function generateSandboxId(): string {
	return `sb-${crypto.randomUUID()}`;
}

function resolveCreateSandboxId(value: unknown): { sandboxId: string; sandboxIdSource: SandboxIdSource } {
	if (value === undefined || value === null) {
		return {
			sandboxId: generateSandboxId(),
			sandboxIdSource: 'auto',
		};
	}

	if (typeof value === 'string' && value.trim().length === 0) {
		return {
			sandboxId: generateSandboxId(),
			sandboxIdSource: 'auto',
		};
	}

	return {
		sandboxId: validateSandboxId(value, 'create'),
		sandboxIdSource: 'user',
	};
}

function validateBranch(value: unknown, fieldName: 'baseBranch' | 'headBranch', action: ManagedLifecycleAction): string {
	if (typeof value !== 'string') {
		throw new LifecyclePayloadValidationError({
			code: 'invalid_lifecycle_payload',
			reason: `missing_or_invalid_${fieldName}`,
		}, action);
	}

	const branch = value.trim();
	if (!branch) {
		throw new LifecyclePayloadValidationError({
			code: 'invalid_lifecycle_payload',
			reason: `missing_or_invalid_${fieldName}`,
		}, action);
	}

	if (containsUnsafeShellSyntax(branch)) {
		throw new LifecyclePayloadValidationError({
			code: 'invalid_lifecycle_payload',
			reason: `unsafe_shell_syntax:${fieldName}`,
		}, action);
	}

	if (!BRANCH_NAME_RE.test(branch)) {
		throw new LifecyclePayloadValidationError({
			code: 'invalid_lifecycle_payload',
			reason: `invalid_${fieldName}_format`,
		}, action);
	}

	return branch;
}

function parsePayload(action: ManagedLifecycleAction, payload: unknown): ParsedPayload {
	if (!isRecord(payload)) {
		throw new LifecyclePayloadValidationError({
			code: 'invalid_lifecycle_payload',
			reason: 'payload_not_object',
		}, action);
	}

	const forbiddenEnvPath = findForbiddenEnvPath(payload);
	if (forbiddenEnvPath) {
		throw new LifecyclePayloadValidationError({
			code: 'env_injection_denied',
			reason: `forbidden_field:${forbiddenEnvPath}`,
		}, action);
	}

	if (action === 'pr-open') {
		assertAllowedKeys(payload, ['sandboxId', 'baseBranch', 'headBranch'], action);
		const sandboxId = validateSandboxId(payload.sandboxId, action);
		const baseBranch = validateBranch(payload.baseBranch, 'baseBranch', action);
		const headBranch = validateBranch(payload.headBranch, 'headBranch', action);
		return {
			sandboxId,
			baseBranch,
			headBranch,
		};
	}

	if (action === 'finish') {
		assertAllowedKeys(payload, ['sandboxId', 'prAction', 'baseBranch', 'headBranch'], action);

		const sandboxId = validateSandboxId(payload.sandboxId, action);
		const rawPrAction = payload.prAction;
		const normalizedPrAction = rawPrAction === undefined || rawPrAction === null
			? 'skip-pr'
			: String(rawPrAction).trim();

		if (!FINISH_PR_ACTIONS.has(normalizedPrAction as FinishPrAction)) {
			throw new LifecyclePayloadValidationError({
				code: 'invalid_lifecycle_payload',
				reason: 'invalid_finish_pr_action',
			}, action);
		}

		const prAction = normalizedPrAction as FinishPrAction;
		if (prAction !== 'open-pr' && (payload.baseBranch !== undefined || payload.headBranch !== undefined)) {
			throw new LifecyclePayloadValidationError({
				code: 'invalid_lifecycle_payload',
				reason: 'pr_branches_require_open_pr_action',
			}, action);
		}

		if (prAction === 'open-pr') {
			const baseBranch = validateBranch(payload.baseBranch, 'baseBranch', action);
			const headBranch = validateBranch(payload.headBranch, 'headBranch', action);
			return {
				sandboxId,
				prAction,
				baseBranch,
				headBranch,
			};
		}

		return {
			sandboxId,
			prAction,
		};
	}

	if (action === 'create') {
		assertAllowedKeys(payload, ['sandboxId'], action);
		return resolveCreateSandboxId(payload.sandboxId);
	}

	assertAllowedKeys(payload, ['sandboxId'], action);
	return {
		sandboxId: validateSandboxId(payload.sandboxId, action),
	};
}

function isManagedLifecycleAction(action: LifecycleAction): action is ManagedLifecycleAction {
	return action === 'create' || action === 'start' || action === 'stop' || action === 'pr-open' || action === 'finish';
}

function stableSerialize(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
	}

	if (isRecord(value)) {
		const keys = Object.keys(value).sort((a, b) => a.localeCompare(b));
		const serialized = keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`);
		return `{${serialized.join(',')}}`;
	}

	return JSON.stringify(value);
}

function preserveCanonicalSandboxId(
	action: ManagedLifecycleAction,
	result: LifecycleOperationResult,
	canonicalSandboxId: string | null,
): LifecycleOperationResult {
	if (!canonicalSandboxId) return result;

	const normalizedResult: LifecycleOperationResult = {
		...result,
		sandboxId: canonicalSandboxId,
	};

	if (action !== 'finish') {
		return normalizedResult;
	}

	const close = normalizedResult.close;
	if (!isRecord(close)) {
		return normalizedResult;
	}

	const closeResult = close.result;
	if (!isRecord(closeResult)) {
		return normalizedResult;
	}

	normalizedResult.close = {
		...close,
		result: {
			...closeResult,
			sandboxId: canonicalSandboxId,
		},
	};

	return normalizedResult;
}

export class LifecycleOperationsHandler {
	private readonly auditLogger: AuditLogger;
	private readonly containerManager: ContainerManager;
	private readonly sandboxRegistry: SandboxRegistry;
	private readonly portAllocator: PortAllocator;
	private readonly createSandboxBridgeClient: ((params: { sandboxId: string; hostPort: number }) => BridgeClient) | undefined;

	private readonly inFlight = new Map<string, InFlightEntry>();
	private readonly sandboxOperationLock = new Map<string, Promise<void>>();

	constructor(options: LifecycleOperationsHandlerOptions) {
		this.auditLogger = options.auditLogger;
		this.containerManager = options.containerManager;
		this.sandboxRegistry = options.sandboxRegistry;
		this.portAllocator = options.portAllocator;
		this.createSandboxBridgeClient = options.createSandboxBridgeClient;
	}

	async handle(action: LifecycleAction, payload: unknown, req: http.IncomingMessage): Promise<LifecycleOperationResult> {
		if (!isManagedLifecycleAction(action)) {
			this.auditLogger.logSecurityEvent('gateway.lifecycle.denied', {
				action,
				reason: 'action_not_implemented',
				remoteAddress: req.socket.remoteAddress,
			});
			throw new Error(`[Gateway] Unsupported lifecycle action: ${action}`);
		}

		const context = this.getRequestContext(req);
		let parsed: ParsedPayload;
		try {
			parsed = parsePayload(action, payload);
		} catch (err) {
			if (err instanceof LifecyclePayloadValidationError) {
				this.auditLogger.logSecurityEvent(`gateway.lifecycle.${action}.denied`, {
					action,
					code: err.code,
					reason: err.reason,
					actor: context.actor,
					remoteAddress: context.remoteAddress,
				});
			}
			throw err;
		}

		const payloadFingerprint = this.getPayloadFingerprint(action, parsed);
		const canonicalSandboxId = this.resolveCanonicalSandboxId(parsed);
		const dedupeKey = this.getDedupeKey(action, parsed);
		return await this.executeCoalesced(dedupeKey, action, context, payloadFingerprint, canonicalSandboxId, async () => {
			try {
				let result: LifecycleOperationResult;
				if (action === 'create' || action === 'start') {
					result = await this.handleCreateOrStart(action, parsed as SandboxLifecyclePayload);
				} else if (action === 'stop') {
					result = await this.handleStop(parsed as SandboxLifecyclePayload);
				} else if (action === 'pr-open') {
					result = this.handlePrOpen(parsed as PrOpenLifecyclePayload);
				} else {
					result = await this.handleFinish(parsed as ParsedFinishLifecyclePayload);
				}

				this.auditLogger.logSecurityEvent(`gateway.lifecycle.${action}.allowed`, {
					action,
					...result,
					actor: context.actor,
					remoteAddress: context.remoteAddress,
				});

				return result;
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				this.auditLogger.logSecurityEvent(`gateway.lifecycle.${action}.error`, {
					action,
					reason: 'operation_failed',
					message,
					sandboxId: (parsed as SandboxLifecyclePayload).sandboxId,
					actor: context.actor,
					remoteAddress: context.remoteAddress,
				});
				throw err;
			}
		});
	}

	private getPayloadFingerprint(action: ManagedLifecycleAction, payload: ParsedPayload): string {
		return stableSerialize({
			action,
			payload,
		});
	}

	private resolveCanonicalSandboxId(payload: ParsedPayload): string | null {
		const sandboxId = (payload as SandboxLifecyclePayload).sandboxId;
		if (typeof sandboxId !== 'string') return null;
		const normalized = sandboxId.trim();
		return normalized.length > 0 ? normalized : null;
	}

	private getRequestContext(req: http.IncomingMessage): LifecycleRequestContext {
		return {
			actor: String(req.headers['x-ie-actor'] ?? '').trim() || 'unknown',
			remoteAddress: req.socket.remoteAddress ?? 'unknown',
		};
	}

	private getDedupeKey(action: ManagedLifecycleAction, payload: ParsedPayload): string {
		if (action === 'pr-open') {
			const prPayload = payload as PrOpenLifecyclePayload;
			return `${action}:${prPayload.sandboxId}:${prPayload.baseBranch}:${prPayload.headBranch}`;
		}

		if (action === 'finish') {
			const finishPayload = payload as ParsedFinishLifecyclePayload;
			if (finishPayload.prAction === 'open-pr') {
				return `${action}:${finishPayload.sandboxId}:${finishPayload.prAction}:${finishPayload.baseBranch}:${finishPayload.headBranch}`;
			}
			return `${action}:${finishPayload.sandboxId}:${finishPayload.prAction}`;
		}

		return `${action}:${(payload as SandboxLifecyclePayload).sandboxId}`;
	}

	private async executeCoalesced(
		key: string,
		action: ManagedLifecycleAction,
		context: LifecycleRequestContext,
		payloadFingerprint: string,
		canonicalSandboxId: string | null,
		execute: () => Promise<LifecycleOperationResult>,
	): Promise<LifecycleOperationResult> {
		const existing = this.inFlight.get(key);
		if (existing) {
			if (existing.payloadFingerprint !== payloadFingerprint) {
				this.auditLogger.logSecurityEvent(`gateway.lifecycle.${action}.conflict`, {
					action,
					dedupeKey: key,
					reason: 'idempotency_key_payload_mismatch',
					existingPayloadFingerprint: existing.payloadFingerprint,
					incomingPayloadFingerprint: payloadFingerprint,
					existingCanonicalSandboxId: existing.canonicalSandboxId,
					incomingCanonicalSandboxId: canonicalSandboxId,
					actor: context.actor,
					remoteAddress: context.remoteAddress,
				});
				throw new LifecyclePayloadValidationError({
					code: 'idempotency_conflict',
					reason: 'idempotency_key_payload_mismatch',
				}, action);
			}

			existing.callerCount += 1;
			this.auditLogger.logSecurityEvent(`gateway.lifecycle.${action}.deduped`, {
				action,
				dedupeKey: key,
				callerCount: existing.callerCount,
				actor: context.actor,
				remoteAddress: context.remoteAddress,
			});
			return await existing.promise;
		}

		const entry: InFlightEntry = {
			callerCount: 1,
			payloadFingerprint,
			canonicalSandboxId,
			promise: Promise.resolve({}),
		};
		const promise = (async () => {
			const result = preserveCanonicalSandboxId(action, await execute(), canonicalSandboxId);
			return {
				...result,
				deduped: entry.callerCount > 1,
				coalescedCallCount: entry.callerCount,
				dedupeKey: key,
			};
		})();

		entry.promise = promise;
		this.inFlight.set(key, entry);

		try {
			return await promise;
		} finally {
			this.inFlight.delete(key);
		}
	}

	private async withSandboxLock<T>(sandboxId: string, fn: () => Promise<T>): Promise<T> {
		const previous = this.sandboxOperationLock.get(sandboxId) ?? Promise.resolve();
		let releaseLock: (() => void) | undefined;
		const current = new Promise<void>((resolve) => {
			releaseLock = resolve;
		});
		this.sandboxOperationLock.set(sandboxId, current);

		await previous;
		try {
			return await fn();
		} finally {
			releaseLock?.();
			if (this.sandboxOperationLock.get(sandboxId) === current) {
				this.sandboxOperationLock.delete(sandboxId);
			}
		}
	}

	private async handleCreateOrStart(
		action: Extract<ManagedLifecycleAction, 'create' | 'start'>,
		payload: SandboxLifecyclePayload,
	): Promise<LifecycleOperationResult> {
		const createResultMetadata = action === 'create'
			? { sandboxIdSource: payload.sandboxIdSource ?? 'user' }
			: {};

		return await this.withSandboxLock(payload.sandboxId, async () => {
			const existingContainer = await this.containerManager.get(payload.sandboxId);
			if (existingContainer && isContainerConsideredActive(existingContainer.state)) {
				await this.ensureBridgeClientRegistered(payload.sandboxId, existingContainer.hostPort);
				return {
					sandboxId: payload.sandboxId,
					...createResultMetadata,
					status: 'already-active',
					idempotent: true,
					hostPort: existingContainer.hostPort,
					containerId: existingContainer.containerId,
				};
			}

			const existingRegistryEntry = this.sandboxRegistry.get(payload.sandboxId);
			if (existingRegistryEntry) {
				await this.sandboxRegistry.unregister(payload.sandboxId);
			}

			if (existingContainer) {
				await this.containerManager.stop(payload.sandboxId);
				if (Number.isInteger(existingContainer.hostPort) && existingContainer.hostPort > 0) {
					this.portAllocator.release(existingContainer.hostPort);
				}
			}

			ensureSandboxDirs(payload.sandboxId);

			const hostPort = await this.portAllocator.allocate();
			let operationSucceeded = false;
			try {
				const { info, created } = await this.containerManager.getOrSpawn(payload.sandboxId, hostPort);
				await this.ensureBridgeClientRegistered(payload.sandboxId, info.hostPort);
				operationSucceeded = true;
				return {
					sandboxId: payload.sandboxId,
					...createResultMetadata,
					status: created ? (action === 'create' ? 'created' : 'started') : 'already-active',
					idempotent: !created,
					hostPort: info.hostPort,
					containerId: info.containerId,
				};
			} finally {
				if (!operationSucceeded) {
					this.portAllocator.release(hostPort);
				}
			}
		});
	}

	private async ensureBridgeClientRegistered(sandboxId: string, hostPort: number): Promise<void> {
		if (!this.createSandboxBridgeClient) return;

		const existing = this.sandboxRegistry.get(sandboxId);
		if (existing) return;

		const { entry, created } = this.sandboxRegistry.getOrRegister(
			sandboxId,
			() => this.createSandboxBridgeClient!({ sandboxId, hostPort }),
			hostPort,
		);

		if (!created) return;

		try {
			entry.client.start();
		} catch (err) {
			await this.sandboxRegistry.unregister(sandboxId);
			throw err;
		}
	}

	private async handleStop(payload: SandboxLifecyclePayload): Promise<LifecycleOperationResult> {
		return await this.withSandboxLock(payload.sandboxId, async () => {
			const existingContainer = await this.containerManager.get(payload.sandboxId);
			const hostPort = existingContainer?.hostPort;

			const registryRemoved = await this.sandboxRegistry.unregister(payload.sandboxId);
			const containerRemoved = await this.containerManager.stop(payload.sandboxId);

			if (hostPort && Number.isInteger(hostPort) && hostPort > 0) {
				this.portAllocator.release(hostPort);
			}

			if (!registryRemoved && !containerRemoved) {
				return {
					sandboxId: payload.sandboxId,
					status: 'already-stopped',
					idempotent: true,
				};
			}

			return {
				sandboxId: payload.sandboxId,
				status: 'stopped',
				idempotent: false,
			};
		});
	}

	private handlePrOpen(payload: PrOpenLifecyclePayload): LifecycleOperationResult {
		return {
			sandboxId: payload.sandboxId,
			baseBranch: payload.baseBranch,
			headBranch: payload.headBranch,
			status: 'accepted',
			idempotent: false,
		};
	}

	private async handleFinish(payload: ParsedFinishLifecyclePayload): Promise<LifecycleOperationResult> {
		const prAction = payload.prAction;
		let prBranchResult: Record<string, unknown>;

		if (prAction === 'skip-pr') {
			prBranchResult = {
				action: 'skip-pr',
				outcome: 'skip-pr',
				blocking: false,
			};
		} else if (prAction === 'open-pr:canceled') {
			prBranchResult = {
				action: 'open-pr',
				outcome: 'open-pr:canceled',
				blocking: false,
				sideEffectCommitted: false,
			};
		} else {
			try {
				const prResult = this.handlePrOpen({
					sandboxId: payload.sandboxId,
					baseBranch: payload.baseBranch!,
					headBranch: payload.headBranch!,
				});

				prBranchResult = {
					action: 'open-pr',
					outcome: 'open-pr:success',
					blocking: false,
					result: prResult,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				prBranchResult = {
					action: 'open-pr',
					outcome: 'open-pr:failure',
					blocking: false,
					error: message,
				};
			}
		}

		let closeResult: LifecycleOperationResult | null = null;
		let closeError: string | null = null;
		try {
			closeResult = await this.handleStop({ sandboxId: payload.sandboxId });
		} catch (error) {
			closeError = error instanceof Error ? error.message : String(error);
		}

		return {
			sandboxId: payload.sandboxId,
			status: closeError ? 'finish-close-failed' : 'finished',
			closeAllowed: true,
			finishDeterministic: true,
			pr: prBranchResult,
			close: closeResult
				? {
					allowed: true,
					attempted: true,
					status: 'closed',
					result: closeResult,
				}
				: {
					allowed: true,
					attempted: true,
					status: 'close-failed',
					error: closeError ?? 'close_failed',
				},
			idempotent: closeResult?.idempotent === true,
		};
	}
}

export function createLifecycleOperationsHandler(options: LifecycleOperationsHandlerOptions): LifecycleOperationsHandler {
	return new LifecycleOperationsHandler(options);
}