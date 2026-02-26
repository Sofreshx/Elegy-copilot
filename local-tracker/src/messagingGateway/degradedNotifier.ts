import type { HealthRegistry, AdapterHealthSnapshot, AdapterHealthState } from './adapterHealth';
import type { AuditLogger } from './auditLogger';

export interface DegradedNotifierOptions {
	registry: HealthRegistry;
	auditLogger: AuditLogger;
	/** Function to send a notification message to a platform by kind */
	sendNotification: (targetKind: string, message: string) => Promise<void>;
	/** Debounce period in ms (default 300_000 = 5 minutes) */
	debouncePeriodMs?: number;
}

export class DegradedNotifier {
	private readonly registry: HealthRegistry;
	private readonly auditLogger: AuditLogger;
	private readonly sendNotification: (targetKind: string, message: string) => Promise<void>;
	private readonly debouncePeriodMs: number;
	private readonly lastNotifiedAt = new Map<string, number>();
	private stateChangeListener: ((snapshot: AdapterHealthSnapshot, previousState: AdapterHealthState) => void) | null = null;

	constructor(options: DegradedNotifierOptions) {
		this.registry = options.registry;
		this.auditLogger = options.auditLogger;
		this.sendNotification = options.sendNotification;
		this.debouncePeriodMs = options.debouncePeriodMs ?? 300_000;
	}

	start(): void {
		if (this.stateChangeListener) return;
		this.stateChangeListener = (snapshot, previousState) => {
			void this.onStateChange(snapshot, previousState);
		};
		this.registry.on('stateChange', this.stateChangeListener);
	}

	stop(): void {
		if (this.stateChangeListener) {
			this.registry.off('stateChange', this.stateChangeListener);
			this.stateChangeListener = null;
		}
	}

	private async onStateChange(snapshot: AdapterHealthSnapshot, _previousState: AdapterHealthState): Promise<void> {
		// Only notify on disconnect events
		if (snapshot.state !== 'disconnected') return;

		// Debounce: don't re-notify about the same adapter within the debounce period
		const lastNotified = this.lastNotifiedAt.get(snapshot.adapterId);
		const now = Date.now();
		if (lastNotified && (now - lastNotified) < this.debouncePeriodMs) return;

		this.lastNotifiedAt.set(snapshot.adapterId, now);

		// Find surviving (healthy/degraded) adapters to notify
		const allSnapshots = this.registry.getAll();
		const survivors = allSnapshots.filter(s =>
			s.adapterId !== snapshot.adapterId &&
			(s.state === 'healthy' || s.state === 'degraded')
		);

		const message = `⚠️ Adapter "${snapshot.adapterId}" (${snapshot.kind}) disconnected. ${snapshot.detail ?? ''}`.trim();

		this.auditLogger.log({
			type: 'adapter_disconnected',
			adapterId: snapshot.adapterId,
			kind: snapshot.kind,
			detail: snapshot.detail,
			survivingAdapters: survivors.map(s => s.adapterId),
		});

		for (const survivor of survivors) {
			try {
				await this.sendNotification(survivor.kind, message);
			} catch (err) {
				console.error(`[Gateway] Failed to send degraded notification to ${survivor.kind}:`, err);
			}
		}
	}
}
