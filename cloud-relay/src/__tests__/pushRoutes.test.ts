import express from "express";
import request from "supertest";
import Database from "better-sqlite3";
import { TokenService } from "../tokenService";
import { RelayDatabase } from "../database";
import { PushService } from "../pushService";
import { createPushRouter } from "../pushRoutes";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const TEST_SECRET = "test-secret-for-push";

const TEST_CONFIG = {
  jwtSecret: TEST_SECRET,
  jwtIssuer: "test-relay",
  jwtAudience: "test-audience",
  accessTokenTtlSeconds: 3600,
  refreshTokenTtlSeconds: 2592000,
};

const TEST_USER_ID = "github|12345";
const TEST_LOGIN = "testuser";
const TEST_CLIENT_ID = "client-abc";

const TEST_SUBSCRIPTION = {
  endpoint: "https://fcm.googleapis.com/fcm/send/test-endpoint-123",
  keys: {
    p256dh: "BNcR1KP0kKx1aLkPJ6W6J0Gp-test-p256dh",
    auth: "test-auth-key",
  },
};

function mintTestToken(
  tokenService: TokenService,
  overrides?: Partial<{ sub: string; github_login: string; client_id: string }>,
): string {
  return tokenService.mintAccessToken({
    userId: overrides?.sub ?? TEST_USER_ID,
    githubLogin: overrides?.github_login ?? TEST_LOGIN,
    clientType: "mobile",
    clientId: overrides?.client_id ?? TEST_CLIENT_ID,
    scopes: ["read:push", "write:push"],
  });
}

function createTestApp(pushService: PushService, tokenService: TokenService): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/api", createPushRouter(pushService, tokenService));
  return app;
}

// ---------------------------------------------------------------------------
// In-memory database helper
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

function seedUser(db: RelayDatabase, userId = TEST_USER_ID, login = TEST_LOGIN): void {
  db.getDb()
    .prepare("INSERT OR IGNORE INTO users (id, github_login) VALUES (?, ?)")
    .run(userId, login);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Push Routes", () => {
  let tokenService: TokenService;
  let db: RelayDatabase;
  let pushService: PushService;
  let app: express.Express;
  let token: string;

  beforeEach(() => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_SUBJECT;

    tokenService = new TokenService(TEST_CONFIG);
    db = createInMemoryDb();
    pushService = new PushService(db);
    app = createTestApp(pushService, tokenService);
    token = mintTestToken(tokenService);
  });

  afterEach(async () => {
    await db.close();
  });

  // ==========================================================================
  // GET /api/push/vapid-public-key
  // ==========================================================================

  describe("GET /api/push/vapid-public-key", () => {
    it("returns 503 when VAPID is not configured", async () => {
      const res = await request(app).get("/api/push/vapid-public-key");

      expect(res.status).toBe(503);
      expect(res.body.error).toContain("not configured");
    });

    it("returns the public key when VAPID is configured", async () => {
      process.env.VAPID_PUBLIC_KEY = "test-public-key-123";
      // Recreate pushService with env set
      pushService = new PushService(db);
      app = createTestApp(pushService, tokenService);

      const res = await request(app).get("/api/push/vapid-public-key");

      expect(res.status).toBe(200);
      expect(res.body.publicKey).toBe("test-public-key-123");
    });

    it("does not require authentication", async () => {
      process.env.VAPID_PUBLIC_KEY = "test-public-key-123";
      pushService = new PushService(db);
      app = createTestApp(pushService, tokenService);

      const res = await request(app).get("/api/push/vapid-public-key");
      // No Authorization header — should still succeed
      expect(res.status).toBe(200);
    });
  });

  // ==========================================================================
  // Auth middleware (on protected endpoints)
  // ==========================================================================

  describe("Auth middleware", () => {
    it("rejects subscribe without Authorization header", async () => {
      const res = await request(app)
        .post("/api/push/subscribe")
        .send({ subscription: TEST_SUBSCRIPTION });

      expect(res.status).toBe(401);
      expect(res.body.error).toContain("Bearer token required");
    });

    it("rejects subscribe with invalid token", async () => {
      const res = await request(app)
        .post("/api/push/subscribe")
        .set("Authorization", "Bearer invalid-token")
        .send({ subscription: TEST_SUBSCRIPTION });

      expect(res.status).toBe(401);
      expect(res.body.error).toContain("Invalid or expired token");
    });

    it("rejects unsubscribe without Authorization header", async () => {
      const res = await request(app)
        .delete("/api/push/unsubscribe")
        .send({ endpoint: TEST_SUBSCRIPTION.endpoint });

      expect(res.status).toBe(401);
    });

    it("rejects send without Authorization header", async () => {
      const res = await request(app)
        .post("/api/push/send")
        .send({ userId: TEST_USER_ID, payload: { title: "Test" } });

      expect(res.status).toBe(401);
    });
  });

  // ==========================================================================
  // POST /api/push/subscribe
  // ==========================================================================

  describe("POST /api/push/subscribe", () => {
    it("stores a subscription and returns count", async () => {
      seedUser(db);

      const res = await request(app)
        .post("/api/push/subscribe")
        .set("Authorization", `Bearer ${token}`)
        .send({ subscription: TEST_SUBSCRIPTION });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.activeSubscriptions).toBe(1);
    });

    it("returns 400 when subscription is missing", async () => {
      const res = await request(app)
        .post("/api/push/subscribe")
        .set("Authorization", `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Invalid subscription");
    });

    it("returns 400 when subscription.endpoint is missing", async () => {
      const res = await request(app)
        .post("/api/push/subscribe")
        .set("Authorization", `Bearer ${token}`)
        .send({ subscription: { keys: { p256dh: "x", auth: "y" } } });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Invalid subscription");
    });

    it("returns 400 when subscription.keys is missing", async () => {
      const res = await request(app)
        .post("/api/push/subscribe")
        .set("Authorization", `Bearer ${token}`)
        .send({ subscription: { endpoint: "https://example.com" } });

      expect(res.status).toBe(400);
    });

    it("returns 400 when subscription.keys.p256dh is missing", async () => {
      const res = await request(app)
        .post("/api/push/subscribe")
        .set("Authorization", `Bearer ${token}`)
        .send({
          subscription: {
            endpoint: "https://example.com",
            keys: { auth: "y" },
          },
        });

      expect(res.status).toBe(400);
    });

    it("handles re-subscribing with the same endpoint", async () => {
      seedUser(db);

      await request(app)
        .post("/api/push/subscribe")
        .set("Authorization", `Bearer ${token}`)
        .send({ subscription: TEST_SUBSCRIPTION });

      const res = await request(app)
        .post("/api/push/subscribe")
        .set("Authorization", `Bearer ${token}`)
        .send({ subscription: TEST_SUBSCRIPTION });

      expect(res.status).toBe(201);
      expect(res.body.activeSubscriptions).toBe(1);
    });

    it("accumulates multiple different subscriptions", async () => {
      seedUser(db);

      await request(app)
        .post("/api/push/subscribe")
        .set("Authorization", `Bearer ${token}`)
        .send({ subscription: TEST_SUBSCRIPTION });

      const res = await request(app)
        .post("/api/push/subscribe")
        .set("Authorization", `Bearer ${token}`)
        .send({
          subscription: {
            endpoint: "https://different-endpoint.example.com",
            keys: { p256dh: "other-key", auth: "other-auth" },
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.activeSubscriptions).toBe(2);
    });
  });

  // ==========================================================================
  // DELETE /api/push/unsubscribe
  // ==========================================================================

  describe("DELETE /api/push/unsubscribe", () => {
    it("removes an existing subscription", async () => {
      seedUser(db);
      pushService.subscribe(TEST_USER_ID, TEST_SUBSCRIPTION);

      const res = await request(app)
        .delete("/api/push/unsubscribe")
        .set("Authorization", `Bearer ${token}`)
        .send({ endpoint: TEST_SUBSCRIPTION.endpoint });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.deleted).toBe(true);
    });

    it("returns 404 when subscription does not exist", async () => {
      const res = await request(app)
        .delete("/api/push/unsubscribe")
        .set("Authorization", `Bearer ${token}`)
        .send({ endpoint: "https://nonexistent.endpoint" });

      expect(res.status).toBe(404);
      expect(res.body.error).toContain("Subscription not found");
    });

    it("returns 400 when endpoint is missing", async () => {
      const res = await request(app)
        .delete("/api/push/unsubscribe")
        .set("Authorization", `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("endpoint is required");
    });

    it("does not allow removing another user's subscription", async () => {
      const otherUser = "github|99999";
      seedUser(db, otherUser);
      pushService.subscribe(otherUser, TEST_SUBSCRIPTION);

      const res = await request(app)
        .delete("/api/push/unsubscribe")
        .set("Authorization", `Bearer ${token}`)
        .send({ endpoint: TEST_SUBSCRIPTION.endpoint });

      expect(res.status).toBe(404);
      // The other user's subscription should still exist
      expect(pushService.getSubscriptionCount(otherUser)).toBe(1);
    });
  });

  // ==========================================================================
  // POST /api/push/send
  // ==========================================================================

  describe("POST /api/push/send", () => {
    it("returns 400 when userId is missing", async () => {
      const res = await request(app)
        .post("/api/push/send")
        .set("Authorization", `Bearer ${token}`)
        .send({ payload: { title: "Test" } });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("userId is required");
    });

    it("returns 400 when payload is missing", async () => {
      const res = await request(app)
        .post("/api/push/send")
        .set("Authorization", `Bearer ${token}`)
        .send({ userId: TEST_USER_ID });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("payload is required");
    });

    it("returns 503 when VAPID is not configured", async () => {
      const res = await request(app)
        .post("/api/push/send")
        .set("Authorization", `Bearer ${token}`)
        .send({ userId: TEST_USER_ID, payload: { title: "Test" } });

      expect(res.status).toBe(503);
      expect(res.body.error).toContain("not configured");
    });

    it("returns success with sent/failed counts when configured and no subs", async () => {
      // Force configured for this test
      (pushService as any).configured = true;

      const res = await request(app)
        .post("/api/push/send")
        .set("Authorization", `Bearer ${token}`)
        .send({ userId: TEST_USER_ID, payload: { title: "Test" } });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.sent).toBe(0);
      expect(res.body.failed).toBe(0);
    });
  });
});
