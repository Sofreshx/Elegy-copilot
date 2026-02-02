/**
 * Message Acknowledgment Manager
 * Tracks message delivery with retry logic and exponential backoff
 */
import WebSocket from "ws";
import { RelayEnvelope } from "./types";
import { DeadLetterQueue } from "./deadLetterQueue";
export interface PendingAck {
    messageId: string;
    envelope: RelayEnvelope;
    targetClientId: string;
    targetWs: WebSocket;
    sentAt: Date;
    retryCount: number;
    retryTimer?: NodeJS.Timeout;
}
export interface AckConfig {
    ackTimeoutMs: number;
    maxRetries: number;
    baseBackoffMs: number;
    maxBackoffMs: number;
}
export interface AckStats {
    pending: number;
    acknowledged: number;
    retried: number;
    failed: number;
}
export declare class AcknowledgmentManager {
    private pending;
    private config;
    private deadLetterQueue;
    private stats;
    constructor(deadLetterQueue: DeadLetterQueue, config?: Partial<AckConfig>);
    /**
     * Register a message that requires acknowledgment
     */
    trackMessage(envelope: RelayEnvelope, targetClientId: string, targetWs: WebSocket): void;
    /**
     * Handle received acknowledgment
     */
    acknowledgeMessage(messageId: string): boolean;
    /**
     * Handle ACK timeout - retry or move to dead letter queue
     */
    private handleTimeout;
    /**
     * Cancel tracking for a message (e.g., if target disconnects)
     */
    cancelTracking(messageId: string): void;
    /**
     * Cancel all pending ACKs for a client (on disconnect)
     */
    cancelForClient(clientId: string): void;
    /**
     * Get statistics
     */
    getStats(): AckStats;
    /**
     * Clear all pending (for shutdown)
     */
    clear(): void;
}
//# sourceMappingURL=acknowledgment.d.ts.map