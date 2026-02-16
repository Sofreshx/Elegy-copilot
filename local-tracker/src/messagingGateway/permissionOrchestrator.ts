import { AuditLogger } from './auditLogger';
import type { ExtensionBridgeClient } from './extensionBridgeClient';

export interface PendingPermission {
	callbackId: string;
	receivedAt: string;
	expiresAt: string;
	/** Best-effort extracted text for UI; already sanitized for outbound display. */
	summary: string;
	/** Original event payload (sanitized/redacted by AuditLogger). */
	rawEvent: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function readString(obj: Record<string, unknown>, keys: string[]): string | undefined {
	for (const key of keys) {
		const value = obj[key];
		if (typeof value === 'string' && value.trim().length > 0) return value;
	}
	return undefined;
}

function extractPermissionEventRoot(input: unknown): Record<string, unknown> | null {
	if (!isRecord(input)) return null;
	// Common patterns: { type, ... }, { eventType, data }, { name, payload }
	if (isRecord(input.data)) return input.data;
	if (isRecord(input.payload)) return input.payload;
	return input;
}

function extractEventType(input: unknown): string | undefined {
	if (!isRecord(input)) return undefined;
	const direct = readString(input, ['type', 'eventType', 'name', 'kind']);
	if (direct) return direct;
	if (isRecord(input.data)) {
		const nested = readString(input.data, ['type', 'eventType', 'name', 'kind']);
		if (nested) return nested;
	}
	return undefined;
}

function isPermissionRequestedEvent(input: unknown): boolean {
	const t = (extractEventType(input) ?? '').toLowerCase();
	return t === 'permission_requested' || t === 'permission-requested' || t === 'permissionrequested';
}

function isPermissionResolvedEvent(input: unknown): boolean {
	const t = (extractEventType(input) ?? '').toLowerCase();
	return t === 'permission_resolved' || t === 'permission-resolved' || t === 'permissionresolved';
}

function safeSummaryFromEvent(eventRoot: Record<string, unknown>): string {
	// Keep this deliberately sparse: we don't want to surface secrets from tool args.
	const toolName = readString(eventRoot, ['toolName', 'tool', 'tool_name']);
	const operation = readString(eventRoot, ['operation']);
	const description = readString(eventRoot, ['description']);
	const title = readString(eventRoot, ['title', 'reason', 'message']);
	const parts = [
		toolName ? `tool=${toolName}` : undefined,
		operation ? operation : undefined,
		description ? description : undefined,
		title ? title : undefined,
	].filter(
		(p): p is string => typeof p === 'string' && p.trim().length > 0,
	);
	const joined = parts.join(' — ').trim();
	return joined.length > 0 ? joined : 'Permission requested';
}

export interface PermissionOrchestratorOptions {
	client?: ExtensionBridgeClient;
	auditLogger?: AuditLogger;
	permissionTimeoutMs?: number;
	defaultResolvedBy?: string;
	onPendingChanged?: (pending: PendingPermission[]) => void;
}

export class PermissionOrchestrator {
	private client: ExtensionBridgeClient | undefined;
	private readonly auditLogger: AuditLogger | undefined;
	private readonly permissionTimeoutMs: number;
	private readonly defaultResolvedBy: string;
	private readonly onPendingChanged: ((pending: PendingPermission[]) => void) | undefined;

	private readonly pendingByCallbackId = new Map<string, PendingPermission>();
	private readonly timersByCallbackId = new Map<string, NodeJS.Timeout>();

	constructor(options: PermissionOrchestratorOptions = {}) {
		this.client = options.client;
		this.auditLogger = options.auditLogger;
		this.permissionTimeoutMs = options.permissionTimeoutMs ?? 120_000;
		this.defaultResolvedBy = options.defaultResolvedBy ?? 'messaging-gateway';
		this.onPendingChanged = options.onPendingChanged;

		if (!Number.isFinite(this.permissionTimeoutMs) || this.permissionTimeoutMs <= 0) {
			throw new Error('[Gateway] permissionTimeoutMs must be a positive number');
		}
	}

	setClient(client: ExtensionBridgeClient | undefined): void {
		this.client = client;
	}

	getPending(): PendingPermission[] {
		return [...this.pendingByCallbackId.values()].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
	}

	/**
	 * Feed raw ExtensionBridge `event` payloads into this method.
	 * It will track `permission_requested` and clear on `permission_resolved`.
	 */
	handleExtensionEvent(event: unknown): void {
		if (isPermissionRequestedEvent(event)) {
			const root = extractPermissionEventRoot(event);
			if (!root) return;

			const callbackId = readString(root, ['callbackId', 'callback_id', 'id']);
			if (!callbackId) return;

			const now = Date.now();
			const pending: PendingPermission = {
				callbackId,
				receivedAt: new Date(now).toISOString(),
				expiresAt: new Date(now + this.permissionTimeoutMs).toISOString(),
				summary: safeSummaryFromEvent(root),
				rawEvent: event,
			};

			this.upsertPending(pending);
			this.auditLogger?.log({
				kind: 'permission_requested',
				callbackId,
				summary: pending.summary,
				expiresAt: pending.expiresAt,
			});
			return;
		}

		if (isPermissionResolvedEvent(event)) {
			const root = extractPermissionEventRoot(event);
			if (!root) return;
			const callbackId = readString(root, ['callbackId', 'callback_id', 'id']);
			if (!callbackId) return;
			this.clearPending(callbackId, 'resolved_event');
			return;
		}
	}

	async approve(callbackId: string, resolvedBy?: string): Promise<void> {
		await this.resolve(callbackId, true, resolvedBy);
	}

	async deny(callbackId: string, resolvedBy?: string): Promise<void> {
		await this.resolve(callbackId, false, resolvedBy);
	}

	async stop(): Promise<void> {
		for (const timer of this.timersByCallbackId.values()) clearTimeout(timer);
		this.timersByCallbackId.clear();
		this.pendingByCallbackId.clear();
		this.emitPendingChanged();
	}

	private upsertPending(pending: PendingPermission): void {
		this.pendingByCallbackId.set(pending.callbackId, pending);

		const existingTimer = this.timersByCallbackId.get(pending.callbackId);
		if (existingTimer) clearTimeout(existingTimer);

		this.timersByCallbackId.set(
			pending.callbackId,
			setTimeout(() => {
				void this.autoDeny(pending.callbackId);
			}, this.permissionTimeoutMs),
		);

		this.emitPendingChanged();
	}

	private clearPending(callbackId: string, reason: string): void {
		this.pendingByCallbackId.delete(callbackId);
		const timer = this.timersByCallbackId.get(callbackId);
		if (timer) clearTimeout(timer);
		this.timersByCallbackId.delete(callbackId);
		this.auditLogger?.log({ kind: 'permission_pending_cleared', callbackId, reason });
		this.emitPendingChanged();
	}

	private emitPendingChanged(): void {
		this.onPendingChanged?.(this.getPending());
	}

	private async autoDeny(callbackId: string): Promise<void> {
		if (!this.pendingByCallbackId.has(callbackId)) return;
		try {
			await this.resolve(callbackId, false, `${this.defaultResolvedBy}:timeout`);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.auditLogger?.log({ kind: 'permission_auto_deny_failed', callbackId, error: message });
			// Fail closed locally: clear pending so it can't be approved later through this orchestrator.
			this.clearPending(callbackId, 'auto_deny_failed');
		}
	}

	private async resolve(callbackId: string, approved: boolean, resolvedBy?: string): Promise<void> {
		const client = this.client;
		if (!client || client.getStatus() !== 'connected') {
			throw new Error('[Gateway] Cannot resolve permission: extension WS not connected');
		}
		if (!this.pendingByCallbackId.has(callbackId)) {
			throw new Error('[Gateway] Cannot resolve permission: callbackId is not pending');
		}

		// Clear pending first to prevent double-submit from adapters.
		this.clearPending(callbackId, approved ? 'approve_requested' : 'deny_requested');

		try {
			await client.resolve_permission({
				callbackId,
				approved,
				resolvedBy: resolvedBy ?? this.defaultResolvedBy,
			});

			this.auditLogger?.log({
				kind: 'permission_resolved',
				callbackId,
				approved,
				resolvedBy: resolvedBy ?? this.defaultResolvedBy,
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.auditLogger?.log({
				kind: 'permission_resolve_failed',
				callbackId,
				approved,
				error: message,
			});
			throw err instanceof Error ? err : new Error(String(err));
		}
	}
}
