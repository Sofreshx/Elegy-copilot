/**
 * Dead Letter Queue
 * Stores undeliverable messages for debugging and potential retry
 */
import { RelayEnvelope } from "./types";
export interface DeadLetter {
    id: string;
    envelope: RelayEnvelope;
    reason: string;
    targetClientId?: string;
    failedAt: Date;
    retryCount: number;
}
export interface DlqConfig {
    maxSize: number;
    ttlMs: number;
}
export interface DlqStats {
    size: number;
    totalReceived: number;
    oldestEntry?: Date;
    newestEntry?: Date;
}
export declare class DeadLetterQueue {
    private queue;
    private config;
    private totalReceived;
    private cleanupTimer?;
    constructor(config?: Partial<DlqConfig>);
    /**
     * Add a message to the dead letter queue
     */
    add(envelope: RelayEnvelope, reason: string, targetClientId?: string): DeadLetter;
    /**
     * Get a dead letter by ID
     */
    get(id: string): DeadLetter | undefined;
    /**
     * Remove a dead letter (after successful retry or manual removal)
     */
    remove(id: string): boolean;
    /**
     * Get all dead letters (optionally filtered)
     */
    list(options?: {
        limit?: number;
        targetClientId?: string;
        since?: Date;
    }): DeadLetter[];
    /**
     * Get dead letters for a specific message (by original messageId)
     */
    findByMessageId(messageId: string): DeadLetter | undefined;
    /**
     * Mark retry attempt on a dead letter
     */
    markRetried(id: string): boolean;
    /**
     * Get the oldest entry
     */
    private getOldestEntry;
    /**
     * Remove expired entries
     */
    private cleanup;
    /**
     * Start periodic cleanup
     */
    private startCleanup;
    /**
     * Get statistics
     */
    getStats(): DlqStats;
    /**
     * Clear all entries
     */
    clear(): void;
    /**
     * Shutdown cleanup timer
     */
    shutdown(): void;
}
//# sourceMappingURL=deadLetterQueue.d.ts.map