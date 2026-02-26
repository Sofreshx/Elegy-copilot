import type { MessagePlatform, AdapterHealthProbeResult } from './platform';
import type { HealthRegistry } from './adapterHealth';
import type { AuditLogger } from './auditLogger';

export interface HealthWatchdogOptions {
	adapters: ReadonlyArray<MessagePlatform>;
	registry: HealthRegistry;
	auditLogger: AuditLogger;
	intervalMs?: number; // default 30_000
}

export class HealthWatchdog {
	private readonly adapters: ReadonlyArray<MessagePlatform>;
	private readonly registry: HealthRegistry;
	private readonly auditLogger: AuditLogger;
	private readonly intervalMs: number;
	private timer: ReturnType<typeof setInterval> | null = null;

	constructor(options: HealthWatchdogOptions) {
		this.adapters = options.adapters;
		this.registry = options.registry;
		this.auditLogger = options.auditLogger;
		this.intervalMs = options.intervalMs ?? 30_000;
	}

	start(): void {
		if (this.timer) return;
		// Run immediately then on interval
		void this.check();
		this.timer = setInterval(() => void this.check(), this.intervalMs);
	}

	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	async check(): Promise<void> {
		for (const adapter of this.adapters) {
			const adapterId = adapter.kind; // use kind as ID since we have one per kind
			try {
				if (adapter.getHealthProbe) {
					const result = await adapter.getHealthProbe();
					this.registry.update(adapterId, adapter.kind, result.state, result.detail);
				} else {
					// Adapter doesn't support health probes — assume healthy if it's in the list
					this.registry.update(adapterId, adapter.kind, 'healthy', 'No health probe available');
				}
			} catch (err) {
				const detail = err instanceof Error ? err.message : String(err);
				this.registry.update(adapterId, adapter.kind, 'disconnected', detail);
				this.auditLogger.log({
					type: 'health_check_error',
					adapterId,
					error: detail,
				});
			}
		}
	}
}
