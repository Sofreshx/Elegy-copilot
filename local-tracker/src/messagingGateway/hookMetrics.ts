export class HookMetrics {
	private evaluationCount = 0;
	private allowCount = 0;
	private warnCount = 0;
	private blockCount = 0;
	private readonly checkpointIntervalMs: number;
	private lastCheckpointMs: number;
	private onCheckpoint?: (snapshot: HookMetricsSnapshot) => void;

	constructor(options?: { checkpointIntervalMs?: number; onCheckpoint?: (snapshot: HookMetricsSnapshot) => void }) {
		this.checkpointIntervalMs = options?.checkpointIntervalMs ?? 60_000;
		this.onCheckpoint = options?.onCheckpoint;
		this.lastCheckpointMs = Date.now();
	}

	record(decision: 'allow' | 'warn' | 'block'): void {
		this.evaluationCount++;
		if (decision === 'allow') this.allowCount++;
		else if (decision === 'warn') this.warnCount++;
		else if (decision === 'block') this.blockCount++;
		this.maybeCheckpoint();
	}

	getSnapshot(): HookMetricsSnapshot {
		return {
			evaluationCount: this.evaluationCount,
			allowCount: this.allowCount,
			warnCount: this.warnCount,
			blockCount: this.blockCount,
			snapshotAtMs: Date.now(),
		};
	}

	private maybeCheckpoint(): void {
		const now = Date.now();
		if (now - this.lastCheckpointMs >= this.checkpointIntervalMs) {
			this.lastCheckpointMs = now;
			this.onCheckpoint?.(this.getSnapshot());
		}
	}
}

export interface HookMetricsSnapshot {
	evaluationCount: number;
	allowCount: number;
	warnCount: number;
	blockCount: number;
	snapshotAtMs: number;
}
