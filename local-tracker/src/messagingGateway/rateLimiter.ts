export interface RateLimitResult {
	allowed: boolean;
	limit: number;
	remaining: number;
	resetAtMs: number;
	retryAfterMs: number;
}

interface Bucket {
	windowStartMs: number;
	count: number;
}

/**
 * Simple fixed-window rate limiter.
 *
 * Notes:
 * - Per-process, in-memory only (sufficient for local gateway).
 * - Window resets are aligned to first request in the window (not wall-clock minute boundaries).
 */
export class FixedWindowRateLimiter {
	private readonly limit: number;
	private readonly windowMs: number;
	private readonly nowMs: () => number;
	private readonly buckets = new Map<string, Bucket>();

	constructor(options: { limit: number; windowMs: number; nowMs?: () => number }) {
		this.limit = options.limit;
		this.windowMs = options.windowMs;
		this.nowMs = options.nowMs ?? (() => Date.now());
		if (!Number.isFinite(this.limit) || this.limit <= 0) {
			throw new Error('[Gateway:RateLimit] limit must be a positive number');
		}
		if (!Number.isFinite(this.windowMs) || this.windowMs <= 0) {
			throw new Error('[Gateway:RateLimit] windowMs must be a positive number');
		}
	}

	check(key: string): RateLimitResult {
		const now = this.nowMs();
		const existing = this.buckets.get(key);
		const bucket: Bucket = existing ?? { windowStartMs: now, count: 0 };

		const elapsed = now - bucket.windowStartMs;
		if (elapsed >= this.windowMs || elapsed < 0) {
			bucket.windowStartMs = now;
			bucket.count = 0;
		}

		const nextCount = bucket.count + 1;
		const allowed = nextCount <= this.limit;
		if (allowed) bucket.count = nextCount;
		this.buckets.set(key, bucket);

		const resetAtMs = bucket.windowStartMs + this.windowMs;
		const remaining = Math.max(0, this.limit - bucket.count);
		const retryAfterMs = allowed ? 0 : Math.max(0, resetAtMs - now);

		return {
			allowed,
			limit: this.limit,
			remaining,
			resetAtMs,
			retryAfterMs,
		};
	}

	reset(key: string): void {
		this.buckets.delete(key);
	}
}
