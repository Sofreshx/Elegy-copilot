import Database from "better-sqlite3";
import { RelayDatabase } from "../database";
import { PersistentOfflineQueue } from "../persistentOfflineQueue";
import { RelayEnvelope } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEnvelope(overrides: Partial<RelayEnvelope> = {}): RelayEnvelope {
  const id = overrides.messageId ?? `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    version: "1.0",
    messageId: id,
    timestamp: new Date().toISOString(),
    source: { type: "extension", clientId: "ext-1", userId: "user-src" },
    target: { type: "mobile", clientId: "mob-1", userId: "user-1" },
    payload: { jsonrpc: "2.0", id: "rpc-1", method: "execute_command", params: {} },
    ...overrides,
  };
}

/**
 * Create an in-memory RelayDatabase stub with just enough schema
 * so PersistentOfflineQueue can operate.
 */
function createTestDb(): RelayDatabase {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Create the offline_messages table (matches v1 migration)
  db.exec(`
    CREATE TABLE IF NOT EXISTS offline_messages (
      message_id TEXT PRIMARY KEY,
      target_user_id TEXT NOT NULL,
      target_client_id TEXT,
      message_type TEXT DEFAULT 'command',
      payload TEXT NOT NULL,
      enqueued_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_offline_messages_target_user_id ON offline_messages(target_user_id)`
  );

  // Stub RelayDatabase: we only need getDb()
  const relayDb = {
    getDb: () => db,
    initialize: async () => {},
    close: async () => db.close(),
  } as unknown as RelayDatabase;

  return relayDb;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PersistentOfflineQueue", () => {
  let relayDb: RelayDatabase;
  let queue: PersistentOfflineQueue;

  beforeEach(() => {
    relayDb = createTestDb();
    queue = new PersistentOfflineQueue(relayDb, {
      maxMessagesPerUser: 5,
      defaultExpiryMs: 60_000,
      processedIdsRetention: 10,
      cleanupIntervalMs: 999_999, // effectively disabled in tests
    });
  });

  afterEach(async () => {
    await queue.shutdown();
    await relayDb.close();
  });

  // ---- enqueue -----------------------------------------------------------

  it("enqueues a message and reports success", () => {
    const env = makeEnvelope();
    const result = queue.enqueue(env);
    expect(result).toEqual({ success: true });
  });

  it("rejects enqueue when target has no userId", () => {
    const env = makeEnvelope({ target: { type: "mobile" } });
    const result = queue.enqueue(env);
    expect(result.success).toBe(false);
    expect(result.reason).toContain("No target userId");
  });

  it("prevents duplicate enqueue of the same messageId", () => {
    const env = makeEnvelope({ messageId: "dup-1" });
    queue.enqueue(env);
    const result = queue.enqueue(env);
    expect(result.success).toBe(false);
    expect(result.reason).toContain("already queued");
  });

  it("prevents enqueue of a processed messageId", () => {
    const env = makeEnvelope({ messageId: "dup-2" });
    queue.markProcessed("user-1", "dup-2");
    const result = queue.enqueue(env);
    expect(result.success).toBe(false);
    expect(result.reason).toContain("already processed");
  });

  it("evicts oldest message when user queue is full", () => {
    // maxMessagesPerUser is 5
    for (let i = 0; i < 6; i++) {
      queue.enqueue(makeEnvelope({ messageId: `evict-${i}` }));
    }
    const stats = queue.getQueueStats("user-1");
    expect(stats.pending).toBe(5);
    const metrics = queue.getMetrics();
    expect(metrics.evicted).toBe(1);
  });

  // ---- dequeueForClient --------------------------------------------------

  it("dequeues messages for a user and removes them from the store", () => {
    queue.enqueue(makeEnvelope({ messageId: "dq-1" }));
    queue.enqueue(makeEnvelope({ messageId: "dq-2" }));

    const msgs = queue.dequeueForClient("user-1", "mob-1");
    expect(msgs.length).toBe(2);
    expect(msgs[0].messageId).toBe("dq-1");
    expect(msgs[1].messageId).toBe("dq-2");

    // Queue should be empty now
    const after = queue.dequeueForClient("user-1", "mob-1");
    expect(after.length).toBe(0);
  });

  it("skips messages targeted to a different clientId", () => {
    queue.enqueue(
      makeEnvelope({
        messageId: "client-specific-1",
        target: { type: "mobile", clientId: "mob-A", userId: "user-1" },
      })
    );
    queue.enqueue(
      makeEnvelope({
        messageId: "client-specific-2",
        target: { type: "mobile", clientId: "mob-B", userId: "user-1" },
      })
    );

    const msgs = queue.dequeueForClient("user-1", "mob-A");
    expect(msgs.length).toBe(1);
    expect(msgs[0].messageId).toBe("client-specific-1");

    // mob-B's message should still be there
    const remaining = queue.dequeueForClient("user-1", "mob-B");
    expect(remaining.length).toBe(1);
    expect(remaining[0].messageId).toBe("client-specific-2");
  });

  it("delivers messages with no targetClientId to any client", () => {
    queue.enqueue(
      makeEnvelope({
        messageId: "broadcast-1",
        target: { type: "mobile", userId: "user-1" },
      })
    );

    const msgs = queue.dequeueForClient("user-1", "mob-X");
    expect(msgs.length).toBe(1);
  });

  it("skips expired messages during dequeue", () => {
    // Insert a message that is already expired
    const db = relayDb.getDb();
    const now = Date.now();
    db.prepare(
      `INSERT INTO offline_messages (message_id, target_user_id, target_client_id, message_type, payload, enqueued_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run("expired-1", "user-1", null, "command", JSON.stringify(makeEnvelope({ messageId: "expired-1" })), now - 10000, now - 1);

    const msgs = queue.dequeueForClient("user-1");
    expect(msgs.length).toBe(0);
  });

  it("returns empty array when user has no queued messages", () => {
    const msgs = queue.dequeueForClient("nonexistent-user");
    expect(msgs.length).toBe(0);
  });

  // ---- cleanupExpired ----------------------------------------------------

  it("removes expired messages and returns count", () => {
    const db = relayDb.getDb();
    const now = Date.now();
    // Insert 3 expired messages directly
    for (let i = 0; i < 3; i++) {
      db.prepare(
        `INSERT INTO offline_messages (message_id, target_user_id, message_type, payload, enqueued_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(`exp-${i}`, "user-1", "command", "{}", now - 10000, now - 1);
    }

    const removed = queue.cleanupExpired();
    expect(removed).toBe(3);
  });

  // ---- isProcessed / markProcessed ----------------------------------------

  it("tracks processed message IDs per user", () => {
    expect(queue.isProcessed("user-1", "proc-1")).toBe(false);
    queue.markProcessed("user-1", "proc-1");
    expect(queue.isProcessed("user-1", "proc-1")).toBe(true);

    // Other user should not see it
    expect(queue.isProcessed("user-2", "proc-1")).toBe(false);
  });

  // ---- getQueueStats ------------------------------------------------------

  it("returns per-user queue stats", () => {
    queue.enqueue(makeEnvelope({ messageId: "stat-1" }));
    queue.enqueue(makeEnvelope({ messageId: "stat-2" }));

    const stats = queue.getQueueStats("user-1");
    expect(stats.pending).toBe(2);
    expect(stats.oldest instanceof Date).toBe(true);
  });

  it("returns zero stats for user with no messages", () => {
    const stats = queue.getQueueStats("nobody");
    expect(stats.pending).toBe(0);
    expect(stats.oldest).toBeUndefined();
  });

  // ---- getStats -----------------------------------------------------------

  it("returns overall queue statistics", () => {
    queue.enqueue(makeEnvelope({ messageId: "overall-1" }));
    queue.enqueue(
      makeEnvelope({
        messageId: "overall-2",
        target: { type: "mobile", userId: "user-2" },
      })
    );

    const stats = queue.getStats();
    expect(stats.totalPending).toBe(2);
    expect(stats.usersWithPending).toBe(2);
    expect(typeof stats.oldestMessageAge).toBe("number");
    expect(typeof stats.processedIdsCount).toBe("number");
  });

  // ---- getMetrics ---------------------------------------------------------

  it("tracks enqueue/dequeue/evict/duplicate metrics", () => {
    queue.enqueue(makeEnvelope({ messageId: "m-1" }));
    queue.enqueue(makeEnvelope({ messageId: "m-1" })); // dup
    queue.dequeueForClient("user-1", "mob-1");

    const m = queue.getMetrics();
    expect(m.enqueued).toBe(1);
    expect(m.dequeued).toBe(1);
    expect(m.duplicatesPrevented).toBe(1);
  });

  // ---- save / load (no-ops) -----------------------------------------------

  it("save and load are no-ops that resolve", async () => {
    await queue.save();
    await queue.load();
    // No errors = pass
  });

  // ---- clear ---------------------------------------------------------------

  it("clears all messages and processed IDs", () => {
    queue.enqueue(makeEnvelope({ messageId: "clear-1" }));
    queue.markProcessed("user-1", "clear-1");

    queue.clear();

    expect(queue.getStats().totalPending).toBe(0);
    expect(queue.isProcessed("user-1", "clear-1")).toBe(false);
  });

  // ---- shutdown ------------------------------------------------------------

  it("shutdown stops cleanup timer", async () => {
    await queue.shutdown();
    // should not throw on second shutdown
    await queue.shutdown();
  });

  // ---- processed ID trimming -----------------------------------------------

  it("trims processed IDs beyond retention limit", () => {
    // retention is 10
    for (let i = 0; i < 15; i++) {
      queue.markProcessed("user-1", `trim-${i}`);
    }

    // Trigger cleanup which internally trims processed IDs
    queue.cleanupExpired();

    const stats = queue.getStats();
    expect(stats.processedIdsCount <= 10).toBe(true);
  });
});
