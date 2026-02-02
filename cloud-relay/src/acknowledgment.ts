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
  ackTimeoutMs: number; // Time to wait for ACK (default: 5000)
  maxRetries: number; // Max retry attempts (default: 3)
  baseBackoffMs: number; // Base backoff time (default: 1000)
  maxBackoffMs: number; // Max backoff time (default: 10000)
}

export interface AckStats {
  pending: number;
  acknowledged: number;
  retried: number;
  failed: number;
}

export class AcknowledgmentManager {
  private pending: Map<string, PendingAck> = new Map();
  private config: AckConfig;
  private deadLetterQueue: DeadLetterQueue;

  // Stats
  private stats = {
    acknowledged: 0,
    retried: 0,
    failed: 0,
  };

  constructor(deadLetterQueue: DeadLetterQueue, config?: Partial<AckConfig>) {
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
  trackMessage(
    envelope: RelayEnvelope,
    targetClientId: string,
    targetWs: WebSocket
  ): void {
    const messageId = envelope.messageId;

    // Skip if already tracking
    if (this.pending.has(messageId)) {
      return;
    }

    const pendingAck: PendingAck = {
      messageId,
      envelope,
      targetClientId,
      targetWs,
      sentAt: new Date(),
      retryCount: 0,
    };

    // Start ACK timeout
    pendingAck.retryTimer = setTimeout(
      () => this.handleTimeout(messageId),
      this.config.ackTimeoutMs
    );

    this.pending.set(messageId, pendingAck);

    console.log(
      `[AckManager] Tracking message ${messageId} to ${targetClientId}`
    );
  }

  /**
   * Handle received acknowledgment
   */
  acknowledgeMessage(messageId: string): boolean {
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

    console.log(
      `[AckManager] Message ${messageId} acknowledged after ${pendingAck.retryCount} retries`
    );

    return true;
  }

  /**
   * Handle ACK timeout - retry or move to dead letter queue
   */
  private handleTimeout(messageId: string): void {
    const pendingAck = this.pending.get(messageId);
    if (!pendingAck) return;

    pendingAck.retryCount++;

    if (pendingAck.retryCount >= this.config.maxRetries) {
      // Max retries exceeded - move to dead letter queue
      this.pending.delete(messageId);
      this.stats.failed++;

      this.deadLetterQueue.add(
        pendingAck.envelope,
        `ACK timeout after ${pendingAck.retryCount} retries`,
        pendingAck.targetClientId
      );

      console.log(
        `[AckManager] Message ${messageId} failed after ${pendingAck.retryCount} retries, moved to dead letter queue`
      );
      return;
    }

    // Retry with exponential backoff
    const backoffMs = Math.min(
      this.config.baseBackoffMs * Math.pow(2, pendingAck.retryCount - 1),
      this.config.maxBackoffMs
    );

    // Re-send message if WebSocket is still open
    if (pendingAck.targetWs.readyState === WebSocket.OPEN) {
      pendingAck.targetWs.send(JSON.stringify(pendingAck.envelope));
      this.stats.retried++;

      console.log(
        `[AckManager] Retrying message ${messageId} (attempt ${pendingAck.retryCount}/${this.config.maxRetries}, backoff ${backoffMs}ms)`
      );
    } else {
      // WebSocket closed - move to dead letter queue
      this.pending.delete(messageId);
      this.stats.failed++;

      this.deadLetterQueue.add(
        pendingAck.envelope,
        "WebSocket closed during retry",
        pendingAck.targetClientId
      );

      console.log(
        `[AckManager] Message ${messageId} failed - target WebSocket closed`
      );
      return;
    }

    // Schedule next timeout
    pendingAck.retryTimer = setTimeout(
      () => this.handleTimeout(messageId),
      this.config.ackTimeoutMs + backoffMs
    );
  }

  /**
   * Cancel tracking for a message (e.g., if target disconnects)
   */
  cancelTracking(messageId: string): void {
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
  cancelForClient(clientId: string): void {
    for (const [messageId, pendingAck] of this.pending) {
      if (pendingAck.targetClientId === clientId) {
        if (pendingAck.retryTimer) {
          clearTimeout(pendingAck.retryTimer);
        }

        this.deadLetterQueue.add(
          pendingAck.envelope,
          "Client disconnected",
          clientId
        );

        this.pending.delete(messageId);
        this.stats.failed++;
      }
    }
  }

  /**
   * Get statistics
   */
  getStats(): AckStats {
    return {
      pending: this.pending.size,
      ...this.stats,
    };
  }

  /**
   * Clear all pending (for shutdown)
   */
  clear(): void {
    for (const pendingAck of this.pending.values()) {
      if (pendingAck.retryTimer) {
        clearTimeout(pendingAck.retryTimer);
      }
    }
    this.pending.clear();
  }
}
