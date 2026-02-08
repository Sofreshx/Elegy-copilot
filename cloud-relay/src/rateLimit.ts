/**
 * Token-Bucket Rate Limiter for per-client WebSocket message throttling.
 *
 * Each client gets a bucket that refills at a steady rate.
 * When the bucket is empty, the client is rate-limited until tokens refill.
 */

export interface RateLimiterConfig {
  /** Maximum tokens (burst capacity). Default: 100 */
  maxTokens: number;
  /** Tokens added per second. Default: 100/60 ≈ 1.67 (100 per minute) */
  refillRate: number;
  /** Interval (ms) between stale-bucket cleanup sweeps. Default: 60 000 */
  cleanupIntervalMs: number;
  /** Buckets idle longer than this (ms) are pruned. Default: 300 000 (5 min) */
  bucketTtlMs: number;
}

interface TokenBucket {
  tokens: number;
  lastRefill: number; // epoch ms
}

const DEFAULT_CONFIG: RateLimiterConfig = {
  maxTokens: 100,
  refillRate: 100 / 60, // 100 messages per minute
  cleanupIntervalMs: 60_000,
  bucketTtlMs: 300_000,
};

export interface ConsumeResult {
  allowed: boolean;
  /** Seconds until at least one token is available (present only when denied). */
  retryAfterSecs?: number;
}

export class RateLimiter {
  private buckets = new Map<string, TokenBucket>();
  private config: RateLimiterConfig;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(config?: Partial<RateLimiterConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startCleanup();
  }

  /**
   * Try to consume one token for `clientId`.
   * Returns `{ allowed: true }` if the request is permitted,
   * or `{ allowed: false, retryAfterSecs }` if rate-limited.
   */
  consume(clientId: string): ConsumeResult {
    const now = Date.now();
    let bucket = this.buckets.get(clientId);

    if (!bucket) {
      bucket = { tokens: this.config.maxTokens, lastRefill: now };
      this.buckets.set(clientId, bucket);
    }

    // Refill tokens based on elapsed time
    this.refill(bucket, now);

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true };
    }

    // Denied — compute retry-after
    const retryAfterSecs = Math.ceil(1 / this.config.refillRate);
    return { allowed: false, retryAfterSecs };
  }

  /** Remove a client's bucket (e.g. on disconnect). */
  remove(clientId: string): void {
    this.buckets.delete(clientId);
  }

  /** Stop the periodic cleanup timer. Call on shutdown. */
  shutdown(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.buckets.clear();
  }

  // ── internals ──────────────────────────────────────────────

  private refill(bucket: TokenBucket, now: number): void {
    const elapsed = (now - bucket.lastRefill) / 1000; // seconds
    const newTokens = elapsed * this.config.refillRate;
    bucket.tokens = Math.min(this.config.maxTokens, bucket.tokens + newTokens);
    bucket.lastRefill = now;
  }

  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, bucket] of this.buckets) {
        if (now - bucket.lastRefill > this.config.bucketTtlMs) {
          this.buckets.delete(id);
        }
      }
    }, this.config.cleanupIntervalMs);

    // Allow the process to exit even if the timer is still running
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }
}
