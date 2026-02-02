"use strict";
/**
 * Dead Letter Queue
 * Stores undeliverable messages for debugging and potential retry
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeadLetterQueue = void 0;
class DeadLetterQueue {
    queue = new Map();
    config;
    totalReceived = 0;
    cleanupTimer;
    constructor(config) {
        this.config = {
            maxSize: config?.maxSize ?? 1000,
            ttlMs: config?.ttlMs ?? 24 * 60 * 60 * 1000, // 24 hours
        };
        // Start periodic cleanup
        this.startCleanup();
    }
    /**
     * Add a message to the dead letter queue
     */
    add(envelope, reason, targetClientId) {
        const id = `dlq-${Date.now()}-${envelope.messageId}`;
        const deadLetter = {
            id,
            envelope,
            reason,
            targetClientId,
            failedAt: new Date(),
            retryCount: 0,
        };
        // Enforce max size (remove oldest entries)
        while (this.queue.size >= this.config.maxSize) {
            const oldest = this.getOldestEntry();
            if (oldest) {
                this.queue.delete(oldest.id);
            }
            else {
                break;
            }
        }
        this.queue.set(id, deadLetter);
        this.totalReceived++;
        console.log(`[DLQ] Message ${envelope.messageId} added: ${reason}` +
            (targetClientId ? ` (target: ${targetClientId})` : ""));
        return deadLetter;
    }
    /**
     * Get a dead letter by ID
     */
    get(id) {
        return this.queue.get(id);
    }
    /**
     * Remove a dead letter (after successful retry or manual removal)
     */
    remove(id) {
        return this.queue.delete(id);
    }
    /**
     * Get all dead letters (optionally filtered)
     */
    list(options) {
        let result = Array.from(this.queue.values());
        // Filter by target client
        if (options?.targetClientId) {
            result = result.filter((dl) => dl.targetClientId === options.targetClientId);
        }
        // Filter by time
        if (options?.since) {
            result = result.filter((dl) => dl.failedAt >= options.since);
        }
        // Sort by newest first
        result.sort((a, b) => b.failedAt.getTime() - a.failedAt.getTime());
        // Apply limit
        if (options?.limit) {
            result = result.slice(0, options.limit);
        }
        return result;
    }
    /**
     * Get dead letters for a specific message (by original messageId)
     */
    findByMessageId(messageId) {
        for (const dl of this.queue.values()) {
            if (dl.envelope.messageId === messageId) {
                return dl;
            }
        }
        return undefined;
    }
    /**
     * Mark retry attempt on a dead letter
     */
    markRetried(id) {
        const dl = this.queue.get(id);
        if (dl) {
            dl.retryCount++;
            return true;
        }
        return false;
    }
    /**
     * Get the oldest entry
     */
    getOldestEntry() {
        let oldest;
        for (const dl of this.queue.values()) {
            if (!oldest || dl.failedAt < oldest.failedAt) {
                oldest = dl;
            }
        }
        return oldest;
    }
    /**
     * Remove expired entries
     */
    cleanup() {
        const cutoff = Date.now() - this.config.ttlMs;
        let removed = 0;
        for (const [id, dl] of this.queue) {
            if (dl.failedAt.getTime() < cutoff) {
                this.queue.delete(id);
                removed++;
            }
        }
        if (removed > 0) {
            console.log(`[DLQ] Cleaned up ${removed} expired entries`);
        }
    }
    /**
     * Start periodic cleanup
     */
    startCleanup() {
        // Clean up every hour
        this.cleanupTimer = setInterval(() => this.cleanup(), 60 * 60 * 1000);
    }
    /**
     * Get statistics
     */
    getStats() {
        let oldestEntry;
        let newestEntry;
        for (const dl of this.queue.values()) {
            if (!oldestEntry || dl.failedAt < oldestEntry) {
                oldestEntry = dl.failedAt;
            }
            if (!newestEntry || dl.failedAt > newestEntry) {
                newestEntry = dl.failedAt;
            }
        }
        return {
            size: this.queue.size,
            totalReceived: this.totalReceived,
            oldestEntry,
            newestEntry,
        };
    }
    /**
     * Clear all entries
     */
    clear() {
        this.queue.clear();
    }
    /**
     * Shutdown cleanup timer
     */
    shutdown() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
        }
    }
}
exports.DeadLetterQueue = DeadLetterQueue;
//# sourceMappingURL=deadLetterQueue.js.map