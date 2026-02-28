import type {
	BridgeClient,
	BridgeClientStatus,
	InvokeAgentParams,
	CancelSessionParams,
	ResolvePermissionParams,
} from './bridgeClient';
import type { SandboxRegistry } from './sandboxRegistry';
import { getWorkflowTracer, isTracingEnabled } from './workflows/workflowTracing';

export interface SessionDriverEvent {
	type: string;
	timestamp: string; // ISO
	source: 'local' | 'sandbox';
	sandboxId?: string;
	data: unknown;
}

export class SessionDriverError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SessionDriverError';
	}
}

/**
 * SessionDriver — abstraction layer over BridgeClient that adds:
 * - Consistent event timestamps
 * - Source tagging (local vs sandbox)
 * - Unified error handling
 *
 * Wraps BridgeClient; does NOT replace it.
 */
export interface SessionDriver {
	getSessions(): Promise<unknown>;
	invokeAgent(params: InvokeAgentParams): Promise<unknown>;
	cancelSession(params: CancelSessionParams): Promise<unknown>;
	resolvePermission(params: ResolvePermissionParams): Promise<unknown>;
	getStatus(): BridgeClientStatus;
	getSource(): 'local' | 'sandbox';
}

/**
 * BridgeClientSessionDriver — wraps a single BridgeClient for local mode.
 */
export class BridgeClientSessionDriver implements SessionDriver {
	private readonly client: BridgeClient;

	constructor(client: BridgeClient) {
		this.client = client;
	}

	async getSessions(): Promise<unknown> {
		return this.client.get_sessions();
	}

	async invokeAgent(params: InvokeAgentParams): Promise<unknown> {
		const span = isTracingEnabled() ? getWorkflowTracer().startSpan('session.invokeAgent', { 'session.source': 'local' }) : undefined;
		try {
			const result = await this.client.invoke_agent(params);
			span?.setStatus('ok');
			return result;
		} catch (err) {
			span?.setStatus('error', err instanceof Error ? err.message : String(err));
			throw err;
		} finally {
			span?.end();
		}
	}

	async cancelSession(params: CancelSessionParams): Promise<unknown> {
		return this.client.cancel_session(params);
	}

	async resolvePermission(params: ResolvePermissionParams): Promise<unknown> {
		return this.client.resolve_permission(params);
	}

	getStatus(): BridgeClientStatus {
		return this.client.getStatus();
	}

	getSource(): 'local' {
		return 'local';
	}
}

/**
 * SandboxSessionDriver — routes operations to a specific sandbox's BridgeClient.
 *
 * - Multi-sandbox support: targets a specific sandboxId
 * - Missing sandbox → SessionDriverError
 */
export class SandboxSessionDriver implements SessionDriver {
	private readonly registry: SandboxRegistry;
	private readonly sandboxId: string;

	constructor(registry: SandboxRegistry, sandboxId: string) {
		this.registry = registry;
		this.sandboxId = sandboxId;
	}

	private getClient(): BridgeClient {
		const entry = this.registry.get(this.sandboxId);
		if (!entry) {
			throw new SessionDriverError(`Sandbox "${this.sandboxId}" not found`);
		}
		return entry.client;
	}

	async getSessions(): Promise<unknown> {
		return this.getClient().get_sessions();
	}

	async invokeAgent(params: InvokeAgentParams): Promise<unknown> {
		const span = isTracingEnabled() ? getWorkflowTracer().startSpan('session.invokeAgent', { 'session.source': 'sandbox', 'session.sandboxId': this.sandboxId }) : undefined;
		try {
			const result = await this.getClient().invoke_agent(params);
			span?.setStatus('ok');
			return result;
		} catch (err) {
			span?.setStatus('error', err instanceof Error ? err.message : String(err));
			throw err;
		} finally {
			span?.end();
		}
	}

	async cancelSession(params: CancelSessionParams): Promise<unknown> {
		return this.getClient().cancel_session(params);
	}

	async resolvePermission(params: ResolvePermissionParams): Promise<unknown> {
		return this.getClient().resolve_permission(params);
	}

	getStatus(): BridgeClientStatus {
		const entry = this.registry.get(this.sandboxId);
		return entry?.meta.status ?? 'stopped';
	}

	getSource(): 'sandbox' {
		return 'sandbox';
	}

	getSandboxId(): string {
		return this.sandboxId;
	}
}
