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

type ManagedLifecycleAction = Extract<LifecycleAction, 'create' | 'start' | 'stop' | 'pr-open'>;

interface LifecycleRequestContext {
	actor: string;
	remoteAddress: string;
}

interface SandboxLifecyclePayload {
	sandboxId: string;
}

interface PrOpenLifecyclePayload extends SandboxLifecyclePayload {
	baseBranch: string;
	headBranch: string;
}

type ParsedPayload = SandboxLifecyclePayload | PrOpenLifecyclePayload;

type LifecycleOperationResult = Record<string, unknown>;

interface InFlightEntry {
	promise: Promise<LifecycleOperationResult>;
	callerCount: number;
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

	assertAllowedKeys(payload, ['sandboxId'], action);
	return {
		sandboxId: validateSandboxId(payload.sandboxId, action),
	};
}

function isManagedLifecycleAction(action: LifecycleAction): action is ManagedLifecycleAction {
	return action === 'create' || action === 'start' || action === 'stop' || action === 'pr-open';
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

		const dedupeKey = this.getDedupeKey(action, parsed);
		return await this.executeCoalesced(dedupeKey, action, context, async () => {
			try {
				let result: LifecycleOperationResult;
				if (action === 'create' || action === 'start') {
					result = await this.handleCreateOrStart(action, parsed as SandboxLifecyclePayload);
				} else if (action === 'stop') {
					result = await this.handleStop(parsed as SandboxLifecyclePayload);
				} else {
					result = this.handlePrOpen(parsed as PrOpenLifecyclePayload);
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

		return `${action}:${(payload as SandboxLifecyclePayload).sandboxId}`;
	}

	private async executeCoalesced(
		key: string,
		action: ManagedLifecycleAction,
		context: LifecycleRequestContext,
		execute: () => Promise<LifecycleOperationResult>,
	): Promise<LifecycleOperationResult> {
		const existing = this.inFlight.get(key);
		if (existing) {
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
			promise: Promise.resolve({}),
		};
		const promise = (async () => {
			const result = await execute();
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
		return await this.withSandboxLock(payload.sandboxId, async () => {
			const existingRegistryEntry = this.sandboxRegistry.get(payload.sandboxId);
			if (existingRegistryEntry) {
				return {
					sandboxId: payload.sandboxId,
					status: 'already-active',
					idempotent: true,
					hostPort: existingRegistryEntry.meta.hostPort,
				};
			}

			ensureSandboxDirs(payload.sandboxId);

			const existingContainer = await this.containerManager.get(payload.sandboxId);
			if (existingContainer) {
				await this.ensureBridgeClientRegistered(payload.sandboxId, existingContainer.hostPort);
				return {
					sandboxId: payload.sandboxId,
					status: 'already-active',
					idempotent: true,
					hostPort: existingContainer.hostPort,
					containerId: existingContainer.containerId,
				};
			}

			const hostPort = await this.portAllocator.allocate();
			let operationSucceeded = false;
			try {
				const { info, created } = await this.containerManager.getOrSpawn(payload.sandboxId, hostPort);
				await this.ensureBridgeClientRegistered(payload.sandboxId, info.hostPort);
				operationSucceeded = true;
				return {
					sandboxId: payload.sandboxId,
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
}

export function createLifecycleOperationsHandler(options: LifecycleOperationsHandlerOptions): LifecycleOperationsHandler {
	return new LifecycleOperationsHandler(options);
}