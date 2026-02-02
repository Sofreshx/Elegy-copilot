/**
 * Offline Message Queue
 * Buffers messages for offline clients with persistence and expiry
 */
import { RelayEnvelope } from "./types";
export interface QueuedMessage {
    messageId: string;
    targetUserId: string;
    targetClientId?: string;
    messageType: "command" | "event";
    payload: RelayEnvelope;
    enqueuedAt: number;
    expiresAt: number;
}
export interface OfflineQueueConfig {
    maxMessagesPerUser: number;
    defaultExpiryMs: number;
    processedIdsRetention: number;
    persistencePath?: string;
    cleanupIntervalMs: number;
}
export interface OfflineQueueStats {
    totalPending: number;
    usersWithPending: number;
    oldestMessageAge?: number;
    processedIdsCount: number;
}
export interface UserQueueStats {
    pending: number;
    oldest?: Date;
}
export declare class OfflineQueue {
    private config;
    private queues;
    private processedIds;
    private cleanupTimer?;
    private metrics;
    constructor(config?: Partial<OfflineQueueConfig>);
    /**
     * Enqueue a message for an offline client
     */
    enqueue(envelope: RelayEnvelope, messageType?: "command" | "event"): {
        success: boolean;
        reason?: string;
    };
    /**
     * Dequeue all pending messages for a client
     * Returns messages in FIFO order
     */
    dequeueForClient(userId: string, clientId?: string): QueuedMessage[];
    /**
     * Remove expired messages (background cleanup)
     * Returns count of removed messages
     */
    cleanupExpired(): number;
    /**
     * Check if messageId was already processed
     */
    isProcessed(userId: string, messageId: string): boolean;
    /**
     * Mark messageId as processed
     */
    markProcessed(userId: string, messageId: string): void;
    /**
     * Trim processed IDs to configured retention limit
     */
    private trimProcessedIds;
    /**
     * Get queue stats for a specific user
     */
    getQueueStats(userId: string): UserQueueStats;
    /**
     * Get overall queue statistics
     */
    getStats(): OfflineQueueStats;
    /**
     * Get detailed metrics
     */
    getMetrics(): typeof this.metrics;
    /**
     * Save queue state to file (optional persistence)
     */
    save(): Promise<void>;
    /**
     * Load queue state from file (optional persistence)
     */
    load(): Promise<void>;
    /**
     * Start periodic cleanup timer
     */
    private startCleanupTimer;
    /**
     * Shutdown: stop timer, optionally save state
     */
    shutdown(): Promise<void>;
    /**
     * Clear all queued messages (for testing)
     */
    clear(): void;
}
//# sourceMappingURL=offlineQueue.d.ts.map