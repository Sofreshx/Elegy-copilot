"use strict";
/**
 * Message Acknowledgment Manager
 * Tracks message delivery with retry logic and exponential backoff
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AcknowledgmentManager = void 0;
const ws_1 = __importDefault(require("ws"));
class AcknowledgmentManager {
    pending = new Map();
    config;
    deadLetterQueue;
    // Stats
    stats = {
        acknowledged: 0,
        retried: 0,
        failed: 0,
    };
    constructor(deadLetterQueue, config) {
        this.deadLetterQueue = deadLetterQueue;
        this.config = {
            ackTimeoutMs: config?.ackTimeoutMs ?? 5000,
            maxRetries: config?.maxRetries ?? 3,
            baseBackoffMs: config?.baseBackoffMs ?? 1000,
            maxBackoffMs: config?.maxBackoffMs ?? 10000,
        };
    }
    /**
     * Register a message that requires acknowledgment
     */
    trackMessage(envelope, targetClientId, targetWs) {
        const messageId = envelope.messageId;
        // Skip if already tracking
        if (this.pending.has(messageId)) {
            return;
        }
        const pendingAck = {
            messageId,
            envelope,
            targetClientId,
            targetWs,
            sentAt: new Date(),
            retryCount: 0,
        };
        // Start ACK timeout
        pendingAck.retryTimer = setTimeout(() => this.handleTimeout(messageId), this.config.ackTimeoutMs);
        this.pending.set(messageId, pendingAck);
        console.log(`[AckManager] Tracking message ${messageId} to ${targetClientId}`);
    }
    /**
     * Handle received acknowledgment
     */
    acknowledgeMessage(messageId) {
        const pendingAck = this.pending.get(messageId);
        if (!pendingAck) {
            return false; // Already acknowledged or unknown
        }
        // Clear timeout
        if (pendingAck.retryTimer) {
            clearTimeout(pendingAck.retryTimer);
        }
        this.pending.delete(messageId);
        this.stats.acknowledged++;
        console.log(`[AckManager] Message ${messageId} acknowledged after ${pendingAck.retryCount} retries`);
        return true;
    }
    /**
     * Handle ACK timeout - retry or move to dead letter queue
     */
    handleTimeout(messageId) {
        const pendingAck = this.pending.get(messageId);
        if (!pendingAck)
            return;
        pendingAck.retryCount++;
        if (pendingAck.retryCount >= this.config.maxRetries) {
            // Max retries exceeded - move to dead letter queue
            this.pending.delete(messageId);
            this.stats.failed++;
            this.deadLetterQueue.add(pendingAck.envelope, `ACK timeout after ${pendingAck.retryCount} retries`, pendingAck.targetClientId);
            console.log(`[AckManager] Message ${messageId} failed after ${pendingAck.retryCount} retries, moved to dead letter queue`);
            return;
        }
        // Retry with exponential backoff
        const backoffMs = Math.min(this.config.baseBackoffMs * Math.pow(2, pendingAck.retryCount - 1), this.config.maxBackoffMs);
        // Re-send message if WebSocket is still open
        if (pendingAck.targetWs.readyState === ws_1.default.OPEN) {
            pendingAck.targetWs.send(JSON.stringify(pendingAck.envelope));
            this.stats.retried++;
            console.log(`[AckManager] Retrying message ${messageId} (attempt ${pendingAck.retryCount}/${this.config.maxRetries}, backoff ${backoffMs}ms)`);
        }
        else {
            // WebSocket closed - move to dead letter queue
            this.pending.delete(messageId);
            this.stats.failed++;
            this.deadLetterQueue.add(pendingAck.envelope, "WebSocket closed during retry", pendingAck.targetClientId);
            console.log(`[AckManager] Message ${messageId} failed - target WebSocket closed`);
            return;
        }
        // Schedule next timeout
        pendingAck.retryTimer = setTimeout(() => this.handleTimeout(messageId), this.config.ackTimeoutMs + backoffMs);
    }
    /**
     * Cancel tracking for a message (e.g., if target disconnects)
     */
    cancelTracking(messageId) {
        const pendingAck = this.pending.get(messageId);
        if (pendingAck) {
            if (pendingAck.retryTimer) {
                clearTimeout(pendingAck.retryTimer);
            }
            this.pending.delete(messageId);
        }
    }
    /**
     * Cancel all pending ACKs for a client (on disconnect)
     */
    cancelForClient(clientId) {
        for (const [messageId, pendingAck] of this.pending) {
            if (pendingAck.targetClientId === clientId) {
                if (pendingAck.retryTimer) {
                    clearTimeout(pendingAck.retryTimer);
                }
                this.deadLetterQueue.add(pendingAck.envelope, "Client disconnected", clientId);
                this.pending.delete(messageId);
                this.stats.failed++;
            }
        }
    }
    /**
     * Get statistics
     */
    getStats() {
        return {
            pending: this.pending.size,
            ...this.stats,
        };
    }
    /**
     * Clear all pending (for shutdown)
     */
    clear() {
        for (const pendingAck of this.pending.values()) {
            if (pendingAck.retryTimer) {
                clearTimeout(pendingAck.retryTimer);
            }
        }
        this.pending.clear();
    }
}
exports.AcknowledgmentManager = AcknowledgmentManager;
//# sourceMappingURL=acknowledgment.js.map