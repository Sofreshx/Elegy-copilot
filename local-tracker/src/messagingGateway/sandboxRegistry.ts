import type { BridgeClient, BridgeClientStatus } from './bridgeClient';
export type { BridgeClientStatus } from './bridgeClient';

export interface SandboxMeta {
	sandboxId: string;
	hostPort: number;
	registeredAt: string; // ISO timestamp
	status: BridgeClientStatus;
}

export interface SandboxEntry {
	client: BridgeClient;
	meta: SandboxMeta;
}

export interface SandboxEvent {
	sandboxId: string;
	event: unknown;
}

export interface SandboxStatusChange {
	sandboxId: string;
	status: BridgeClientStatus;
}

export interface SandboxRegistryOptions {
	/** Called when any sandbox emits an event (tagged with sandboxId). */
	onSandboxEvent?: (sandboxEvent: SandboxEvent) => void;
	/** Called when any sandbox's status changes. */
	onSandboxStatusChanged?: (change: SandboxStatusChange) => void;
}

/**
 * SandboxRegistry — manages a map of sandboxId → AcpBridgeClient instances.
 * Each sandbox gets its own AcpBridgeClient connected to its ACP port.
 * Events from individual sandboxes are tagged with sandboxId and forwarded.
 *
 * sandboxId validation: 1-64 chars, alphanumeric + hyphens, cannot start with hyphen.
 */
export class SandboxRegistry {
	private readonly sandboxes = new Map<string, SandboxEntry>();
	private readonly onSandboxEvent: ((e: SandboxEvent) => void) | undefined;
	private readonly onSandboxStatusChanged: ((c: SandboxStatusChange) => void) | undefined;

	constructor(options: SandboxRegistryOptions = {}) {
		this.onSandboxEvent = options.onSandboxEvent;
		this.onSandboxStatusChanged = options.onSandboxStatusChanged;
	}

	/** Validate sandboxId: 1-64 chars, alphanumeric + hyphens, no leading hyphen. */
	private validateSandboxId(sandboxId: string): void {
		if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/.test(sandboxId)) {
			throw new Error(`[SandboxRegistry] Invalid sandboxId: must be 1-64 alphanumeric/hyphen chars, cannot start with hyphen`);
		}
	}

	/**
	 * Register a sandbox with a pre-created BridgeClient.
	 * Throws if sandboxId is already registered.
	 */
	register(sandboxId: string, client: BridgeClient, hostPort: number): SandboxEntry {
		this.validateSandboxId(sandboxId);
		if (this.sandboxes.has(sandboxId)) {
			throw new Error(`[SandboxRegistry] Sandbox '${sandboxId}' is already registered`);
		}

		const entry: SandboxEntry = {
			client,
			meta: {
				sandboxId,
				hostPort,
				registeredAt: new Date().toISOString(),
				status: client.getStatus(),
			},
		};

		this.sandboxes.set(sandboxId, entry);
		return entry;
	}

	/**
	 * Idempotent register helper.
	 * Returns the existing entry if present; otherwise creates/registers a new entry.
	 */
	getOrRegister(
		sandboxId: string,
		createClient: () => BridgeClient,
		hostPort: number,
	): { entry: SandboxEntry; created: boolean } {
		this.validateSandboxId(sandboxId);
		const existing = this.sandboxes.get(sandboxId);
		if (existing) {
			return { entry: existing, created: false };
		}

		const client = createClient();
		const entry = this.register(sandboxId, client, hostPort);
		return { entry, created: true };
	}

	/**
	 * Unregister a sandbox. Stops the client before removing.
	 * Returns true if the sandbox existed; false otherwise.
	 */
	async unregister(sandboxId: string): Promise<boolean> {
		const entry = this.sandboxes.get(sandboxId);
		if (!entry) return false;

		try {
			await entry.client.stop();
		} catch {
			// Best-effort stop
		}

		this.sandboxes.delete(sandboxId);
		return true;
	}

	/** Get a sandbox entry by ID. */
	get(sandboxId: string): SandboxEntry | undefined {
		return this.sandboxes.get(sandboxId);
	}

	/** Get all registered sandbox entries. */
	getAll(): SandboxEntry[] {
		return [...this.sandboxes.values()];
	}

	/** Get count of registered sandboxes. */
	get size(): number {
		return this.sandboxes.size;
	}

	/** Check if a sandbox is registered. */
	has(sandboxId: string): boolean {
		return this.sandboxes.has(sandboxId);
	}

	/**
	 * Dispatch an event from a specific sandbox.
	 * Called by the event fan-in layer (WU-202) to tag events with sandboxId.
	 */
	dispatchEvent(sandboxId: string, event: unknown): void {
		if (!this.sandboxes.has(sandboxId)) return;
		this.onSandboxEvent?.({ sandboxId, event });
	}

	/**
	 * Update a sandbox's status.
	 * Called when a BridgeClient's status changes.
	 */
	updateStatus(sandboxId: string, status: BridgeClientStatus): void {
		const entry = this.sandboxes.get(sandboxId);
		if (!entry) return;
		entry.meta.status = status;
		this.onSandboxStatusChanged?.({ sandboxId, status });
	}

	/**
	 * Stop all sandboxes and clear the registry.
	 * Best-effort: individual failures logged but not thrown.
	 */
	async stopAll(): Promise<void> {
		const ids = [...this.sandboxes.keys()];
		await Promise.all(
			ids.map(async (id) => {
				try {
					await this.unregister(id);
				} catch {
					// Best-effort
				}
			}),
		);
	}
}

/**
 * Creates AcpBridgeClient callbacks that tag events with sandboxId and route through the registry.
 */
export function createSandboxEventRouter(
	registry: SandboxRegistry,
	sandboxId: string,
): { onEvent: (event: unknown) => void; onStatusChanged: (status: BridgeClientStatus) => void } {
	return {
		onEvent: (event: unknown) => {
			if (typeof event === 'object' && event !== null) {
				(event as Record<string, unknown>).sandboxId = sandboxId;
			}
			registry.dispatchEvent(sandboxId, event);
		},
		onStatusChanged: (status: BridgeClientStatus) => {
			registry.updateStatus(sandboxId, status);
		},
	};
}
