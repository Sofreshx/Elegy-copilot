import { EventEmitter } from 'events';

export type AdapterHealthState = 'healthy' | 'degraded' | 'disconnected' | 'unknown';

export interface AdapterHealthSnapshot {
	adapterId: string;
	kind: string;
	state: AdapterHealthState;
	detail?: string;
	lastCheckedUtc: string;
	lastStateChangeUtc: string;
}

export interface HealthRegistryEvents {
	stateChange: (snapshot: AdapterHealthSnapshot, previousState: AdapterHealthState) => void;
}

export class HealthRegistry {
	private readonly snapshots = new Map<string, AdapterHealthSnapshot>();
	private readonly emitter = new EventEmitter();

	/** Register or update an adapter's state. Emits 'stateChange' if the state differs from previous. */
	update(adapterId: string, kind: string, state: AdapterHealthState, detail?: string): void {
		const now = new Date().toISOString();
		const existing = this.snapshots.get(adapterId);
		const previousState = existing?.state ?? 'unknown';
		const changed = previousState !== state;

		const snapshot: AdapterHealthSnapshot = {
			adapterId,
			kind,
			state,
			detail,
			lastCheckedUtc: now,
			lastStateChangeUtc: changed ? now : (existing?.lastStateChangeUtc ?? now),
		};

		this.snapshots.set(adapterId, snapshot);

		if (changed) {
			this.emitter.emit('stateChange', snapshot, previousState);
		}
	}

	/** Get all current snapshots. */
	getAll(): AdapterHealthSnapshot[] {
		return [...this.snapshots.values()];
	}

	/** Get a specific adapter's snapshot, or undefined if not registered. */
	get(adapterId: string): AdapterHealthSnapshot | undefined {
		return this.snapshots.get(adapterId);
	}

	/** Compute overall system health state. */
	getOverallState(): AdapterHealthState {
		const all = this.getAll();
		if (all.length === 0) return 'unknown';
		if (all.every(s => s.state === 'healthy')) return 'healthy';
		if (all.some(s => s.state === 'disconnected')) return 'disconnected';
		if (all.some(s => s.state === 'degraded')) return 'degraded';
		return 'unknown';
	}

	on(event: 'stateChange', listener: HealthRegistryEvents['stateChange']): this {
		this.emitter.on(event, listener);
		return this;
	}

	off(event: 'stateChange', listener: HealthRegistryEvents['stateChange']): this {
		this.emitter.off(event, listener);
		return this;
	}
}
