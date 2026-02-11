/**
 * Persistent Offline Queue (SQLite-backed)
 *
 * Drop-in replacement for OfflineQueue that persists messages
 * in the relay database's offline_messages table. Processed
 * message IDs are tracked in a separate processed_message_ids table.
 *
 * Uses the synchronous better-sqlite3 API.
 */

import type Database from "better-sqlite3";
import { RelayDatabase } from "./database";
import {
  OfflineQueueConfig,
  OfflineQueueStats,
  QueuedMessage,
  UserQueueStats,
} from "./offlineQueue";
import { RelayEnvelope } from "./types";

const DEFAULT_CONFIG: OfflineQueueConfig = {
  maxMessagesPerUser: parseInt(process.env.OFFLINE_QUEUE_MAX_PER_USER || "100", 10),
  defaultExpiryMs: 24 * 60 * 60 * 1000, // 24 hours
  processedIdsRetention: 1000,
  cleanupIntervalMs: 5 * 60 * 1000, // 5 minutes
};

export class PersistentOfflineQueue {
  private readonly config: OfflineQueueConfig;
  private readonly db: Database.Database;
  private cleanupTimer?: NodeJS.Timeout;

  // Metrics (in-memory, reset on restart)
  private metrics = {
    enqueued: 0,
    dequeued: 0,
    expired: 0,
    evicted: 0,
    duplicatesPrevented: 0,
  };

  // Prepared statements (lazy-initialized)
  private stmts!: ReturnType<PersistentOfflineQueue["prepareStatements"]>;

  constructor(database: RelayDatabase, config: Partial<OfflineQueueConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.db = database.getDb();
    this.ensureTables();
    this.stmts = this.prepareStatements();
    this.startCleanupTimer();
  }

  // ---------------------------------------------------------------------------
  // Schema bootstrap (processed_message_ids only; offline_messages exists)
  // ---------------------------------------------------------------------------

  private ensureTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS processed_message_ids (
        user_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        processed_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, message_id)
      )
    `);
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_processed_message_ids_user ON processed_message_ids(user_id)`
    );
  }

  // ---------------------------------------------------------------------------
  // Prepared statements
  // ---------------------------------------------------------------------------

  private prepareStatements() {
    const db = this.db;
    return {
      insertMessage: db.prepare(`
        INSERT OR IGNORE INTO offline_messages
          (message_id, target_user_id, target_client_id, message_type, payload, enqueued_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `),

      countUserMessages: db.prepare(`
        SELECT COUNT(*) as cnt FROM offline_messages WHERE target_user_id = ?
      `),

      oldestUserMessage: db.prepare(`
        SELECT message_id FROM offline_messages
        WHERE target_user_id = ?
        ORDER BY enqueued_at ASC LIMIT 1
      `),

      deleteMessage: db.prepare(`
        DELETE FROM offline_messages WHERE message_id = ?
      `),

      selectForUser: db.prepare(`
        SELECT * FROM offline_messages
        WHERE target_user_id = ? AND expires_at > ?
        ORDER BY enqueued_at ASC
      `),

      deleteExpired: db.prepare(`
        DELETE FROM offline_messages WHERE expires_at <= ?
      `),

      isProcessed: db.prepare(`
        SELECT 1 FROM processed_message_ids WHERE user_id = ? AND message_id = ?
      `),

      insertProcessed: db.prepare(`
        INSERT OR IGNORE INTO processed_message_ids (user_id, message_id, processed_at)
        VALUES (?, ?, ?)
      `),

      countProcessedForUser: db.prepare(`
        SELECT COUNT(*) as cnt FROM processed_message_ids WHERE user_id = ?
      `),

      trimOldProcessed: db.prepare(`
        DELETE FROM processed_message_ids
        WHERE user_id = ? AND rowid IN (
          SELECT rowid FROM processed_message_ids
          WHERE user_id = ?
          ORDER BY processed_at ASC
          LIMIT ?
        )
      `),

      totalPending: db.prepare(`
        SELECT COUNT(*) as cnt FROM offline_messages WHERE expires_at > ?
      `),

      usersWithPending: db.prepare(`
        SELECT COUNT(DISTINCT target_user_id) as cnt FROM offline_messages WHERE expires_at > ?
      `),

      oldestMessage: db.prepare(`
        SELECT MIN(enqueued_at) as oldest FROM offline_messages WHERE expires_at > ?
      `),

      totalProcessedIds: db.prepare(`
        SELECT COUNT(*) as cnt FROM processed_message_ids
      `),

      userPendingStats: db.prepare(`
        SELECT COUNT(*) as cnt, MIN(enqueued_at) as oldest
        FROM offline_messages
        WHERE target_user_id = ? AND expires_at > ?
      `),

      deleteAllMessages: db.prepare(`DELETE FROM offline_messages`),
      deleteAllProcessed: db.prepare(`DELETE FROM processed_message_ids`),

      messageExists: db.prepare(`
        SELECT 1 FROM offline_messages WHERE message_id = ? AND target_user_id = ?
      `),
    };
  }

  // ---------------------------------------------------------------------------
  // Public API (matches OfflineQueue)
  // ---------------------------------------------------------------------------

  /**
   * Enqueue a message for an offline client.
   */
  enqueue(
    envelope: RelayEnvelope,
    messageType: "command" | "event" = "command"
  ): { success: boolean; reason?: string } {
    const { target, messageId } = envelope;
    const targetUserId = target.userId;

    if (!targetUserId) {
      return { success: false, reason: "No target userId in envelope" };
    }

    // Duplicate check against processed IDs
    if (this.isProcessed(targetUserId, messageId)) {
      this.metrics.duplicatesPrevented++;
      return { success: false, reason: "Message already processed" };
    }

    // Check if already queued
    const exists = this.stmts.messageExists.get(messageId, targetUserId);
    if (exists) {
      this.metrics.duplicatesPrevented++;
      return { success: false, reason: "Message already queued" };
    }

    // Calculate expiry
    const now = Date.now();
    const ttl = envelope.meta?.ttl ?? this.config.defaultExpiryMs;
    const expiresAt = now + ttl;

    // Enforce per-user queue size limit (evict oldest first)
    const { cnt } = this.stmts.countUserMessages.get(targetUserId) as { cnt: number };
    if (cnt >= this.config.maxMessagesPerUser) {
      const excess = cnt - this.config.maxMessagesPerUser + 1;
      for (let i = 0; i < excess; i++) {
        const oldest = this.stmts.oldestUserMessage.get(targetUserId) as
          | { message_id: string }
          | undefined;
        if (oldest) {
          this.stmts.deleteMessage.run(oldest.message_id);
          this.metrics.evicted++;
          console.log(
            `[PersistentOfflineQueue] Evicted oldest message ${oldest.message_id} for user ${targetUserId}`
          );
        }
      }
    }

    // Insert
    const payloadJson = JSON.stringify(envelope);
    this.stmts.insertMessage.run(
      messageId,
      targetUserId,
      target.clientId ?? null,
      messageType,
      payloadJson,
      now,
      expiresAt
    );

    this.metrics.enqueued++;

    const newCount = (this.stmts.countUserMessages.get(targetUserId) as { cnt: number })
      .cnt;
    console.log(
      `[PersistentOfflineQueue] Enqueued message ${messageId} for user ${targetUserId} (queue size: ${newCount})`
    );

    return { success: true };
  }

  /**
   * Dequeue all pending messages for a client. Returns in FIFO order.
   */
  dequeueForClient(userId: string, clientId?: string): QueuedMessage[] {
    const now = Date.now();
    const rows = this.stmts.selectForUser.all(userId, now) as Array<{
      message_id: string;
      target_user_id: string;
      target_client_id: string | null;
      message_type: string;
      payload: string;
      enqueued_at: number;
      expires_at: number;
    }>;

    if (rows.length === 0) {
      return [];
    }

    const delivered: QueuedMessage[] = [];
    const deleteIds: string[] = [];

    for (const row of rows) {
      const targetMatches =
        !row.target_client_id || row.target_client_id === clientId;

      if (targetMatches) {
        const parsed: RelayEnvelope = JSON.parse(row.payload);
        delivered.push({
          messageId: row.message_id,
          targetUserId: row.target_user_id,
          targetClientId: row.target_client_id ?? undefined,
          messageType: row.message_type as "command" | "event",
          payload: parsed,
          enqueuedAt: row.enqueued_at,
          expiresAt: row.expires_at,
        });

        deleteIds.push(row.message_id);
        this.markProcessed(userId, row.message_id);
      }
    }

    // Delete delivered messages in a transaction
    if (deleteIds.length > 0) {
      const deleteBatch = this.db.transaction(() => {
        for (const id of deleteIds) {
          this.stmts.deleteMessage.run(id);
        }
      });
      deleteBatch();
    }

    this.metrics.dequeued += delivered.length;

    if (delivered.length > 0) {
      console.log(
        `[PersistentOfflineQueue] Dequeued ${delivered.length} messages for user ${userId}${
          clientId ? ` (client: ${clientId})` : ""
        }`
      );
    }

    return delivered;
  }

  /**
   * Remove expired messages. Returns count of removed rows.
   */
  cleanupExpired(): number {
    const now = Date.now();
    const result = this.stmts.deleteExpired.run(now);
    const removed = result.changes;

    // Trim processed IDs per user
    this.trimProcessedIds();

    if (removed > 0) {
      this.metrics.expired += removed;
      console.log(
        `[PersistentOfflineQueue] Cleanup: removed ${removed} expired messages`
      );
    }

    return removed;
  }

  /**
   * Check if a message was already processed for a user.
   */
  isProcessed(userId: string, messageId: string): boolean {
    return !!this.stmts.isProcessed.get(userId, messageId);
  }

  /**
   * Mark a message as processed for a user.
   */
  markProcessed(userId: string, messageId: string): void {
    this.stmts.insertProcessed.run(userId, messageId, Date.now());
  }

  /**
   * Get queue stats for a specific user.
   */
  getQueueStats(userId: string): UserQueueStats {
    const now = Date.now();
    const row = this.stmts.userPendingStats.get(userId, now) as {
      cnt: number;
      oldest: number | null;
    };

    if (!row || row.cnt === 0) {
      return { pending: 0 };
    }

    return {
      pending: row.cnt,
      oldest: row.oldest ? new Date(row.oldest) : undefined,
    };
  }

  /**
   * Get overall queue statistics.
   */
  getStats(): OfflineQueueStats {
    const now = Date.now();

    const { cnt: totalPending } = this.stmts.totalPending.get(now) as {
      cnt: number;
    };
    const { cnt: usersWithPending } = this.stmts.usersWithPending.get(now) as {
      cnt: number;
    };
    const { oldest } = this.stmts.oldestMessage.get(now) as {
      oldest: number | null;
    };
    const { cnt: processedIdsCount } = this.stmts.totalProcessedIds.get() as {
      cnt: number;
    };

    return {
      totalPending,
      usersWithPending,
      oldestMessageAge: oldest ? now - oldest : undefined,
      processedIdsCount,
    };
  }

  /**
   * Get detailed metrics.
   */
  getMetrics(): typeof this.metrics {
    return { ...this.metrics };
  }

  /**
   * No-op — SQLite is always persisted.
   */
  async save(): Promise<void> {
    // No-op: SQLite writes are immediate
  }

  /**
   * No-op — data is already in SQLite on startup.
   */
  async load(): Promise<void> {
    // No-op: data is always in the database
    // Run an initial cleanup of expired messages
    const removed = this.cleanupExpired();
    if (removed > 0) {
      console.log(
        `[PersistentOfflineQueue] Loaded — cleaned ${removed} expired messages`
      );
    }
  }

  /**
   * Stop cleanup timer. Save is a no-op for SQLite.
   */
  async shutdown(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    console.log("[PersistentOfflineQueue] Shutdown complete");
  }

  /**
   * Clear all queued and processed data (mainly for testing).
   */
  clear(): void {
    this.stmts.deleteAllMessages.run();
    this.stmts.deleteAllProcessed.run();
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpired();
    }, this.config.cleanupIntervalMs);
  }

  /**
   * Trim processed IDs to the configured retention limit per user.
   * Deletes the oldest entries beyond the threshold.
   */
  private trimProcessedIds(): void {
    // Get distinct user IDs
    const users = this.db
      .prepare("SELECT DISTINCT user_id FROM processed_message_ids")
      .all() as Array<{ user_id: string }>;

    for (const { user_id } of users) {
      const { cnt } = this.stmts.countProcessedForUser.get(user_id) as {
        cnt: number;
      };
      if (cnt > this.config.processedIdsRetention) {
        const excess = cnt - this.config.processedIdsRetention;
        this.stmts.trimOldProcessed.run(user_id, user_id, excess);
      }
    }
  }
}
