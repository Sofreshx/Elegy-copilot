"use strict";
/**
 * Offline Message Queue
 * Buffers messages for offline clients with persistence and expiry
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OfflineQueue = void 0;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const DEFAULT_CONFIG = {
    maxMessagesPerUser: parseInt(process.env.OFFLINE_QUEUE_MAX_PER_USER || "100", 10),
    defaultExpiryMs: 24 * 60 * 60 * 1000, // 24 hours
    processedIdsRetention: 1000,
    persistencePath: process.env.OFFLINE_QUEUE_PERSISTENCE_PATH, // Optional
    cleanupIntervalMs: 5 * 60 * 1000, // 5 minutes
};
class OfflineQueue {
    config;
    // User queues: userId -> QueuedMessage[]
    queues = new Map();
    // Processed message IDs: userId -> messageId[]
    processedIds = new Map();
    // Cleanup timer
    cleanupTimer;
    // Metrics
    metrics = {
        enqueued: 0,
        dequeued: 0,
        expired: 0,
        evicted: 0, // Due to queue size limit
        duplicatesPrevented: 0,
    };
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.startCleanupTimer();
    }
    /**
     * Enqueue a message for an offline client
     */
    enqueue(envelope, messageType = "command") {
        const { target, messageId } = envelope;
        const targetUserId = target.userId;
        if (!targetUserId) {
            return { success: false, reason: "No target userId in envelope" };
        }
        // Check for duplicate
        if (this.isProcessed(targetUserId, messageId)) {
            this.metrics.duplicatesPrevented++;
            return { success: false, reason: "Message already processed" };
        }
        // Get or create queue for user
        if (!this.queues.has(targetUserId)) {
            this.queues.set(targetUserId, []);
        }
        const queue = this.queues.get(targetUserId);
        // Check if message already in queue
        if (queue.some((m) => m.messageId === messageId)) {
            this.metrics.duplicatesPrevented++;
            return { success: false, reason: "Message already queued" };
        }
        // Calculate expiry
        const now = Date.now();
        const ttl = envelope.meta?.ttl ?? this.config.defaultExpiryMs;
        const expiresAt = now + ttl;
        const queuedMessage = {
            messageId,
            targetUserId,
            targetClientId: target.clientId,
            messageType,
            payload: envelope,
            enqueuedAt: now,
            expiresAt,
        };
        // Enforce queue size limit (evict oldest first)
        while (queue.length >= this.config.maxMessagesPerUser) {
            const evicted = queue.shift();
            if (evicted) {
                this.metrics.evicted++;
                console.log(`[OfflineQueue] Evicted oldest message ${evicted.messageId} for user ${targetUserId}`);
            }
        }
        queue.push(queuedMessage);
        this.metrics.enqueued++;
        console.log(`[OfflineQueue] Enqueued message ${messageId} for user ${targetUserId} (queue size: ${queue.length})`);
        return { success: true };
    }
    /**
     * Dequeue all pending messages for a client
     * Returns messages in FIFO order
     */
    dequeueForClient(userId, clientId) {
        const queue = this.queues.get(userId);
        if (!queue || queue.length === 0) {
            return [];
        }
        const now = Date.now();
        const delivered = [];
        const remaining = [];
        for (const message of queue) {
            // Skip expired messages
            if (message.expiresAt <= now) {
                this.metrics.expired++;
                continue;
            }
            // Check if message targets this specific client or all clients
            const targetMatches = !message.targetClientId || message.targetClientId === clientId;
            if (targetMatches) {
                delivered.push(message);
                // Mark as processed
                this.markProcessed(userId, message.messageId);
            }
            else {
                remaining.push(message);
            }
        }
        // Update queue with remaining messages
        if (remaining.length > 0) {
            this.queues.set(userId, remaining);
        }
        else {
            this.queues.delete(userId);
        }
        this.metrics.dequeued += delivered.length;
        if (delivered.length > 0) {
            console.log(`[OfflineQueue] Dequeued ${delivered.length} messages for user ${userId}${clientId ? ` (client: ${clientId})` : ""}`);
        }
        return delivered;
    }
    /**
     * Remove expired messages (background cleanup)
     * Returns count of removed messages
     */
    cleanupExpired() {
        const now = Date.now();
        let removedCount = 0;
        for (const [userId, queue] of this.queues.entries()) {
            const beforeSize = queue.length;
            const filtered = queue.filter((m) => m.expiresAt > now);
            const removed = beforeSize - filtered.length;
            if (removed > 0) {
                removedCount += removed;
                this.metrics.expired += removed;
                if (filtered.length > 0) {
                    this.queues.set(userId, filtered);
                }
                else {
                    this.queues.delete(userId);
                }
            }
        }
        // Also trim processed IDs
        this.trimProcessedIds();
        if (removedCount > 0) {
            console.log(`[OfflineQueue] Cleanup: removed ${removedCount} expired messages`);
        }
        return removedCount;
    }
    /**
     * Check if messageId was already processed
     */
    isProcessed(userId, messageId) {
        const processed = this.processedIds.get(userId);
        return processed?.includes(messageId) ?? false;
    }
    /**
     * Mark messageId as processed
     */
    markProcessed(userId, messageId) {
        if (!this.processedIds.has(userId)) {
            this.processedIds.set(userId, []);
        }
        const processed = this.processedIds.get(userId);
        if (!processed.includes(messageId)) {
            processed.push(messageId);
        }
    }
    /**
     * Trim processed IDs to configured retention limit
     */
    trimProcessedIds() {
        for (const [userId, ids] of this.processedIds.entries()) {
            if (ids.length > this.config.processedIdsRetention) {
                // Keep only the most recent IDs
                const trimmed = ids.slice(-this.config.processedIdsRetention);
                this.processedIds.set(userId, trimmed);
            }
        }
    }
    /**
     * Get queue stats for a specific user
     */
    getQueueStats(userId) {
        const queue = this.queues.get(userId);
        if (!queue || queue.length === 0) {
            return { pending: 0 };
        }
        // Filter out expired for accurate stats
        const now = Date.now();
        const valid = queue.filter((m) => m.expiresAt > now);
        if (valid.length === 0) {
            return { pending: 0 };
        }
        const oldest = Math.min(...valid.map((m) => m.enqueuedAt));
        return {
            pending: valid.length,
            oldest: new Date(oldest),
        };
    }
    /**
     * Get overall queue statistics
     */
    getStats() {
        const now = Date.now();
        let totalPending = 0;
        let oldestTimestamp;
        let processedIdsCount = 0;
        for (const [, queue] of this.queues.entries()) {
            const valid = queue.filter((m) => m.expiresAt > now);
            totalPending += valid.length;
            for (const m of valid) {
                if (!oldestTimestamp || m.enqueuedAt < oldestTimestamp) {
                    oldestTimestamp = m.enqueuedAt;
                }
            }
        }
        for (const [, ids] of this.processedIds.entries()) {
            processedIdsCount += ids.length;
        }
        return {
            totalPending,
            usersWithPending: this.queues.size,
            oldestMessageAge: oldestTimestamp ? now - oldestTimestamp : undefined,
            processedIdsCount,
        };
    }
    /**
     * Get detailed metrics
     */
    getMetrics() {
        return { ...this.metrics };
    }
    /**
     * Save queue state to file (optional persistence)
     */
    async save() {
        if (!this.config.persistencePath) {
            return;
        }
        try {
            const data = {
                queues: Object.fromEntries(this.queues),
                processedIds: Object.fromEntries(this.processedIds),
                savedAt: new Date().toISOString(),
            };
            // Ensure directory exists
            const dir = path_1.default.dirname(this.config.persistencePath);
            await fs_1.promises.mkdir(dir, { recursive: true });
            await fs_1.promises.writeFile(this.config.persistencePath, JSON.stringify(data, null, 2));
            console.log(`[OfflineQueue] Saved state to ${this.config.persistencePath}`);
        }
        catch (error) {
            console.error(`[OfflineQueue] Failed to save state:`, error);
        }
    }
    /**
     * Load queue state from file (optional persistence)
     */
    async load() {
        if (!this.config.persistencePath) {
            return;
        }
        try {
            const content = await fs_1.promises.readFile(this.config.persistencePath, "utf-8");
            const data = JSON.parse(content);
            if (data.queues) {
                this.queues = new Map(Object.entries(data.queues));
            }
            if (data.processedIds) {
                this.processedIds = new Map(Object.entries(data.processedIds));
            }
            // Immediately cleanup expired messages after load
            const removed = this.cleanupExpired();
            console.log(`[OfflineQueue] Loaded state from ${this.config.persistencePath} (${removed} expired removed)`);
        }
        catch (error) {
            if (error.code === "ENOENT") {
                console.log(`[OfflineQueue] No persistence file found, starting fresh`);
            }
            else {
                console.error(`[OfflineQueue] Failed to load state:`, error);
            }
        }
    }
    /**
     * Start periodic cleanup timer
     */
    startCleanupTimer() {
        this.cleanupTimer = setInterval(() => {
            this.cleanupExpired();
        }, this.config.cleanupIntervalMs);
    }
    /**
     * Shutdown: stop timer, optionally save state
     */
    async shutdown() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = undefined;
        }
        // Save state on shutdown if persistence is enabled
        await this.save();
        console.log("[OfflineQueue] Shutdown complete");
    }
    /**
     * Clear all queued messages (for testing)
     */
    clear() {
        this.queues.clear();
        this.processedIds.clear();
    }
}
exports.OfflineQueue = OfflineQueue;
//# sourceMappingURL=offlineQueue.js.map