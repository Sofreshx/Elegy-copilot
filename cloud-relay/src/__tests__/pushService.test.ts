import Database from "better-sqlite3";
import { RelayDatabase } from "../database";
import { PushService } from "../pushService";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createInMemoryDb(): RelayDatabase {
  const relayDb = new RelayDatabase({ dbPath: ":memory:" });
  const sqliteDb = new Database(":memory:");
  sqliteDb.pragma("journal_mode = WAL");
  sqliteDb.pragma("foreign_keys = ON");

  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      github_login TEXT NOT NULL,
      avatar_url TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      last_seen_at TEXT
    )
  `);
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      endpoint TEXT NOT NULL,
      keys_p256dh TEXT NOT NULL,
      keys_auth TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, endpoint)
    )
  `);
  sqliteDb.exec(
    `CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id)`,
  );

  (relayDb as any).db = sqliteDb;
  return relayDb;
}

function seedUser(db: RelayDatabase, userId: string, login = "testuser"): void {
  db.getDb()
    .prepare("INSERT OR IGNORE INTO users (id, github_login) VALUES (?, ?)")
    .run(userId, login);
}

const TEST_USER_ID = "github|12345";
const TEST_SUBSCRIPTION = {
  endpoint: "https://fcm.googleapis.com/fcm/send/test-endpoint-123",
  keys: {
    p256dh: "BNcR1KP0kKx1aLkPJ6W6J0Gp-test-p256dh",
    auth: "test-auth-key",
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PushService", () => {
  let db: RelayDatabase;
  let pushService: PushService;

  beforeEach(() => {
    // Clear VAPID env vars to test unconfigured state by default
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_SUBJECT;

    db = createInMemoryDb();
    pushService = new PushService(db);
  });

  afterEach(async () => {
    await db.close();
  });

  // ==========================================================================
  // Configuration
  // ==========================================================================

  describe("configuration", () => {
    it("reports not configured when VAPID keys are missing", () => {
      expect(pushService.isConfigured()).toBe(false);
    });

    it("reports configured when VAPID keys are set", () => {
      process.env.VAPID_PUBLIC_KEY = "BNXlxLAx_0XRfDbUsj4N9z85PulC76QFa2eN-cwrfYEUOIfs0lFZa-JxdbgWfP_oP1-8wPjeny46E_1CWo6mOTU";
      process.env.VAPID_PRIVATE_KEY = "AZT3-i5xCTQgamVvxrqT-UFCLDzhHGSF1tk2ymjuz9Q";

      const configured = new PushService(db);
      expect(configured.isConfigured()).toBe(true);
    });

    it("returns null public key when not configured", () => {
      expect(pushService.getPublicKey()).toBeNull();
    });

    it("returns public key when configured", () => {
      process.env.VAPID_PUBLIC_KEY = "test-public-key";
      expect(pushService.getPublicKey()).toBe("test-public-key");
    });
  });

  // ==========================================================================
  // Subscriptions
  // ==========================================================================

  describe("subscribe", () => {
    it("stores a push subscription", () => {
      seedUser(db, TEST_USER_ID);
      pushService.subscribe(TEST_USER_ID, TEST_SUBSCRIPTION);

      const count = pushService.getSubscriptionCount(TEST_USER_ID);
      expect(count).toBe(1);
    });

    it("replaces subscription with the same endpoint (UNIQUE constraint)", () => {
      seedUser(db, TEST_USER_ID);
      pushService.subscribe(TEST_USER_ID, TEST_SUBSCRIPTION);
      pushService.subscribe(TEST_USER_ID, TEST_SUBSCRIPTION);

      const count = pushService.getSubscriptionCount(TEST_USER_ID);
      expect(count).toBe(1);
    });

    it("stores multiple subscriptions for different endpoints", () => {
      seedUser(db, TEST_USER_ID);
      pushService.subscribe(TEST_USER_ID, TEST_SUBSCRIPTION);
      pushService.subscribe(TEST_USER_ID, {
        endpoint: "https://fcm.googleapis.com/fcm/send/different-endpoint",
        keys: { p256dh: "different-p256dh", auth: "different-auth" },
      });

      const count = pushService.getSubscriptionCount(TEST_USER_ID);
      expect(count).toBe(2);
    });
  });

  describe("unsubscribe", () => {
    it("removes an existing subscription and returns true", () => {
      seedUser(db, TEST_USER_ID);
      pushService.subscribe(TEST_USER_ID, TEST_SUBSCRIPTION);

      const deleted = pushService.unsubscribe(TEST_USER_ID, TEST_SUBSCRIPTION.endpoint);
      expect(deleted).toBe(true);

      const count = pushService.getSubscriptionCount(TEST_USER_ID);
      expect(count).toBe(0);
    });

    it("returns false when subscription does not exist", () => {
      seedUser(db, TEST_USER_ID);
      const deleted = pushService.unsubscribe(TEST_USER_ID, "https://nonexistent.endpoint");
      expect(deleted).toBe(false);
    });

    it("does not affect other users' subscriptions", () => {
      const otherUser = "github|99999";
      seedUser(db, TEST_USER_ID);
      seedUser(db, otherUser);

      pushService.subscribe(TEST_USER_ID, TEST_SUBSCRIPTION);
      pushService.subscribe(otherUser, TEST_SUBSCRIPTION);

      pushService.unsubscribe(TEST_USER_ID, TEST_SUBSCRIPTION.endpoint);

      expect(pushService.getSubscriptionCount(TEST_USER_ID)).toBe(0);
      expect(pushService.getSubscriptionCount(otherUser)).toBe(1);
    });
  });

  // ==========================================================================
  // getSubscriptionCount
  // ==========================================================================

  describe("getSubscriptionCount", () => {
    it("returns 0 when no subscriptions exist", () => {
      expect(pushService.getSubscriptionCount(TEST_USER_ID)).toBe(0);
    });

    it("returns correct count for user with subscriptions", () => {
      seedUser(db, TEST_USER_ID);
      pushService.subscribe(TEST_USER_ID, TEST_SUBSCRIPTION);
      pushService.subscribe(TEST_USER_ID, {
        endpoint: "https://second-endpoint.example.com",
        keys: { p256dh: "key2", auth: "auth2" },
      });

      expect(pushService.getSubscriptionCount(TEST_USER_ID)).toBe(2);
    });
  });

  // ==========================================================================
  // sendToUser
  // ==========================================================================

  describe("sendToUser", () => {
    it("throws when VAPID is not configured", async () => {
      let threw = false;
      try {
        await pushService.sendToUser(TEST_USER_ID, { title: "Test" });
      } catch (err: any) {
        threw = true;
        expect(err.message).toContain("VAPID not configured");
      }
      expect(threw).toBe(true);
    });

    it("returns { sent: 0, failed: 0 } when user has no subscriptions", async () => {
      // Create a configured PushService using a mock approach
      // We can't actually configure webPush without real keys in unit tests,
      // so we test the unconfigured path and the "no subscriptions" path.
      // The full send path requires integration testing with real VAPID keys.
      // Here we test the DB-level behavior only.
      seedUser(db, TEST_USER_ID);

      // Force configured = true for this test
      (pushService as any).configured = true;

      const result = await pushService.sendToUser(TEST_USER_ID, { title: "Test" });
      expect(result).toEqual({ sent: 0, failed: 0 });
    });
  });
});
